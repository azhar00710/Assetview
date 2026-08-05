/**
 * OCR Pipeline V2 Routes
 * Platform-centric workflow: Platform → Storage Browse → File Select → OCR → Export → Annotation
 */
import prisma from '../db.js';
import { getStorageProvider, parsePnidFilename, clearProviderCache } from '../services/storage/index.js';
import { runOcrPipeline, runStage1_Extract, runStage2_Group, runStage2_AiClassify } from '../services/ocr/OcrPipeline.js';
import { classifyAll } from '../services/ocr/TagClassifier.js';
import { runGroupingDiagnostic, groupingDiagnosticToCsv } from '../services/ocr/WordGroupingDiagnostic.js';
import { runOcrRepassForRegions, mergeRescuedAtoms } from '../services/ocr/OcrRepassService.js';
import { resolveAiCredentials } from '../services/ocr/AiAnalysisService.js';
import { getDictionary } from '../services/ocr/TagDictionaryService.js';
import { exportBatchResults } from '../services/ocr/ResultExporter.js';
import VisionOCRProvider from '../services/ocr/VisionOCRProvider.js';
import { runAiCleanup } from '../services/ocr/AiCleanupService.js';
import { buildLineRegisterPreview } from '../services/ocr/lineRegisterPreview.js';
import { buildRegisterPreview, generatePreviewCsv } from '../services/ocr/registerPreview.js';
import { syncBatchReviewToOcrExtractions } from '../services/ocr/reviewSyncToExtractions.js';
import { getLearnedPatterns, recordReviewFeedbackEvents, promoteLearnedPatternsFromFeedback } from '../services/ocr/OcrKnowledgeService.js';

// ═══════════════════════════════════════════════════════════════════════════
// In-memory Stage 2 progress tracker (per batch → per file live updates)
// Automatically cleaned up 5 minutes after batch completes
// ═══════════════════════════════════════════════════════════════════════════
const stage2Progress = new Map(); // batchId → { status, files: { fileId → { filename, status, chunk, totalChunks, tags, noise, message, updatedAt } } }
const DEFAULT_STAGE2_MODEL = 'claude-sonnet-4-20250514';

function updateProgress(batchId, fileId, data) {
  if (!stage2Progress.has(batchId)) {
    stage2Progress.set(batchId, { status: 'processing', startedAt: Date.now(), files: {} });
  }
  const batch = stage2Progress.get(batchId);
  batch.files[fileId] = { ...batch.files[fileId], ...data, updatedAt: Date.now() };
}

function finishBatchProgress(batchId, status) {
  if (stage2Progress.has(batchId)) {
    stage2Progress.get(batchId).status = status;
    stage2Progress.get(batchId).completedAt = Date.now();
    // Auto-cleanup after 5 minutes
    setTimeout(() => stage2Progress.delete(batchId), 5 * 60 * 1000);
  }
}

function allowOpusForStage2() {
  return String(process.env.OCR_STAGE2_ALLOW_OPUS || '').trim().toLowerCase() === 'true';
}

function resolveStage2Model(configuredModel = '') {
  const override = String(process.env.OCR_STAGE2_MODEL || '').trim();
  if (override) return override;
  const configured = String(configuredModel || '').trim();
  if (!configured) return DEFAULT_STAGE2_MODEL;
  if (/claude-opus/i.test(configured) && !allowOpusForStage2()) return DEFAULT_STAGE2_MODEL;
  return configured;
}

function resolveStage2PhaseConfig(profileRaw = 'phase3_full_rescue') {
  const profile = String(profileRaw || 'phase3_full_rescue').trim();
  if (profile === 'phase1_ai_only') {
    return {
      profile,
      includeGroupedCandidatesInPrompt: false,
      enableDeterministicPromotion: false,
      enableCoverageRescue: false,
    };
  }
  if (profile === 'phase2_grouped_hints') {
    return {
      profile,
      includeGroupedCandidatesInPrompt: true,
      enableDeterministicPromotion: false,
      enableCoverageRescue: false,
    };
  }
  return {
    profile: 'phase3_full_rescue',
    includeGroupedCandidatesInPrompt: true,
    enableDeterministicPromotion: true,
    enableCoverageRescue: true,
  };
}

export default async function ocrPipelineRoutes(fastify) {

  // ─── Auto-create tables if they don't exist ────────────────────────────────
  // Each block is isolated so one failure doesn't prevent subsequent migrations
  try {
    // Ensure storage_config table exists (may be missing if migration_v2.1 never ran)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS storage_config (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        scope_type      VARCHAR(20) NOT NULL DEFAULT 'global',
        scope_id        UUID,
        provider        VARCHAR(20) NOT NULL DEFAULT 'local',
        bucket_or_container TEXT,
        region          VARCHAR(50),
        endpoint_url    TEXT,
        base_path       TEXT,
        credentials_ref TEXT,
        is_active       BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(scope_type, scope_id)
      );
    `);
  } catch (err) {
    fastify.log.warn('storage_config table creation:', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ocr_batch (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        platform_id     UUID NOT NULL REFERENCES platform(id) ON DELETE CASCADE,
        batch_name      VARCHAR(200),
        status          VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
        storage_config_id UUID,
        storage_bucket  VARCHAR(255),
        storage_prefix  VARCHAR(500),
        total_files     INTEGER DEFAULT 0,
        processed_files INTEGER DEFAULT 0,
        failed_files    INTEGER DEFAULT 0,
        result_format   VARCHAR(20),
        result_storage_key VARCHAR(500),
        exported_at     TIMESTAMPTZ,
        passed_to_annotation BOOLEAN DEFAULT false,
        annotation_passed_at TIMESTAMPTZ,
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        error_message   TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        created_by      VARCHAR(100)
      )
    `);
  } catch (err) {
    fastify.log.warn('ocr_batch table creation:', err.message);
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_batch_platform ON ocr_batch(platform_id)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_batch_status ON ocr_batch(status)`);
  } catch (_) { /* indexes may already exist */ }
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ocr_batch_file (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        batch_id        UUID NOT NULL REFERENCES ocr_batch(id) ON DELETE CASCADE,
        storage_key     VARCHAR(500) NOT NULL,
        filename        VARCHAR(255) NOT NULL,
        file_size_bytes BIGINT DEFAULT 0,
        drawing_number  VARCHAR(100),
        revision        VARCHAR(20),
        pnid_id         UUID,
        ocr_job_id      UUID,
        status          VARCHAR(20) DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
        error_message   TEXT,
        tags_found      INTEGER DEFAULT 0,
        tags_matched    INTEGER DEFAULT 0,
        raw_output_key       TEXT,
        grouped_output_key   TEXT,
        cleaned_output_key   TEXT,
        review_output_key    TEXT,
        raw_ocr_data         JSONB,
        word_count           INTEGER DEFAULT 0,
        completed_at         TIMESTAMPTZ,
        review_status        VARCHAR(20),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    fastify.log.warn('ocr_batch_file table creation:', err.message);
  }
  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_batch ON ocr_batch_file(batch_id)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_status ON ocr_batch_file(status)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_batch_file_pnid ON ocr_batch_file(pnid_id)`);
  } catch (_) { /* indexes may already exist */ }

  // Ensure all required columns exist on ocr_batch_file (for existing DBs)
  const batchFileColumns = [
    'raw_output_key TEXT',
    'grouped_output_key TEXT',
    'cleaned_output_key TEXT',
    'review_output_key TEXT',
    'stage2_phase_profile VARCHAR(40)',
    'raw_ocr_data JSONB',
    'word_count INTEGER DEFAULT 0',
    'completed_at TIMESTAMPTZ',
    'review_status VARCHAR(20)',
    // Per-drawing user labels for the grouping diagnostic feedback loop
    // Shape: { labels: [ { atomIdx, role, text, decidedAt, decidedBy } ] }
    `user_labels_json JSONB DEFAULT '{"labels":[]}'::jsonb`,
  ];
  for (const col of batchFileColumns) {
    const colName = col.split(' ')[0];
    await prisma.$executeRawUnsafe(`ALTER TABLE ocr_batch_file ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  // Ensure all required columns exist on ocr_batch (for existing DBs)
  const batchColumns = [
    'current_stage VARCHAR(30)',
    'stage1_status VARCHAR(20) DEFAULT \'pending\'',
    'stage2_status VARCHAR(20) DEFAULT \'pending\'',
    'stage3_status VARCHAR(20) DEFAULT \'pending\'',
    'stage4_status VARCHAR(20) DEFAULT \'pending\'',
    'stage1_completed_at TIMESTAMPTZ',
    'stage2_completed_at TIMESTAMPTZ',
    'stage3_completed_at TIMESTAMPTZ',
    'stage4_completed_at TIMESTAMPTZ',
    'ocr_provider_used VARCHAR(30)',
    'ai_model_used VARCHAR(100)',
    'stage2_phase_profile VARCHAR(40)',
  ];
  for (const col of batchColumns) {
    const colName = col.split(' ')[0];
    await prisma.$executeRawUnsafe(`ALTER TABLE ocr_batch ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
  }

  try {
    // Add batch_id to ocr_job if missing
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ocr_job' AND column_name = 'batch_id'
        ) THEN
          ALTER TABLE ocr_job ADD COLUMN batch_id UUID;
          CREATE INDEX IF NOT EXISTS idx_ocr_job_batch ON ocr_job(batch_id);
        END IF;
      END $$;
    `);
  } catch (err) {
    fastify.log.warn('ocr_job batch_id column:', err.message);
  }

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS ocr_candidate_ledger (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ocr_job_id UUID NOT NULL REFERENCES ocr_job(id) ON DELETE CASCADE,
        pnid_id UUID NOT NULL REFERENCES pnid(id) ON DELETE CASCADE,
        extraction_stage VARCHAR(16) NOT NULL DEFAULT 'stage2',
        candidate_text_raw TEXT NOT NULL,
        candidate_text_norm TEXT NOT NULL,
        candidate_type VARCHAR(32) NOT NULL,
        source VARCHAR(64) NOT NULL,
        source_stage VARCHAR(16) NOT NULL,
        assembly_rule VARCHAR(64),
        assembly_score NUMERIC(6,4),
        word_indices JSONB NOT NULL DEFAULT '[]'::jsonb,
        bbox JSONB,
        confidence_det NUMERIC(6,4),
        confidence_ai NUMERIC(6,4),
        confidence_final NUMERIC(6,4) NOT NULL,
        terminal_outcome VARCHAR(16) NOT NULL,
        reason_code VARCHAR(64) NOT NULL,
        reason_detail TEXT,
        superseded_by_candidate_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_job ON ocr_candidate_ledger(ocr_job_id)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_pnid ON ocr_candidate_ledger(pnid_id)`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ocr_candidate_ledger_outcome ON ocr_candidate_ledger(terminal_outcome, reason_code)`);
  } catch (err) {
    fastify.log.warn('ocr_candidate_ledger table creation:', err.message);
  }

  try {
    // Ensure storage_config has AI/Vision columns (may be missing on existing DBs)
    // Must be separate calls — $executeRawUnsafe doesn't support multiple statements
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS vision_credentials_ref TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_credentials_ref TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ai_model_preference VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS ocr_provider_preference VARCHAR(20) DEFAULT 'google'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_provider_preference VARCHAR(30) DEFAULT 'trex2'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_api_url TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_api_token TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS visual_model_preference VARCHAR(80)`);
    // GroundingDINO secondary config — allows both T-Rex2 + GroundingDINO to be configured
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_api_url TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_api_token TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE storage_config ADD COLUMN IF NOT EXISTS grounding_model_preference VARCHAR(80)`);
  } catch (err) {
    fastify.log.warn('storage_config AI/Vision columns:', err.message);
  }

  // ═══ RECOVERY: unstick batches that were mid-Stage on previous boot ═══
  // Stage 1, Stage 2, AI cleanup all run as fire-and-forget in-process promises.
  // If the Node process is restarted (node --watch on file save, or a crash) any
  // such promise is killed silently and the batch sits at status='processing'
  // forever, blocking the user from re-running. On startup, reset any rows
  // marked 'processing' back to 'pending' so they can be retried.
  try {
    const stageColumns = ['stage1_status', 'stage2_status', 'stage3_status', 'stage4_status', 'ai_cleanup_status'];
    const unstuckBy = {};
    for (const col of stageColumns) {
      const rows = await prisma.$queryRawUnsafe(
        `UPDATE ocr_batch SET ${col} = 'pending' WHERE ${col} = 'processing' RETURNING id`
      ).catch((e) => {
        fastify.log.warn(`Stuck-batch recovery for ${col} failed: ${e.message}`);
        return [];
      });
      const count = Array.isArray(rows) ? rows.length : 0;
      if (count > 0) unstuckBy[col] = count;
    }
    // Same for the per-file table
    const fileRows = await prisma.$queryRawUnsafe(
      `UPDATE ocr_batch_file SET status = 'pending' WHERE status = 'processing' RETURNING id`
    ).catch((e) => {
      fastify.log.warn(`Stuck-file recovery failed: ${e.message}`);
      return [];
    });
    const fileCount = Array.isArray(fileRows) ? fileRows.length : 0;
    if (fileCount > 0) unstuckBy.file_status = fileCount;

    // Re-label batches whose in-process promise died mid-flight so they do not
    // remain "processing" forever after the stage columns were reset above.
    const stage1Interrupted = await prisma.$queryRawUnsafe(`
      UPDATE ocr_batch
      SET status = 'failed',
          current_stage = 'extraction',
          error_message = COALESCE(error_message, 'Interrupted during OCR extraction; rerun OCR to continue.'),
          completed_at = NOW()
      WHERE status = 'processing'
        AND stage1_status = 'pending'
        AND stage2_status = 'pending'
        AND stage3_status = 'pending'
        AND stage4_status = 'pending'
        AND ai_cleanup_status = 'pending'
      RETURNING id
    `).catch((e) => {
      fastify.log.warn(`Stuck-batch recovery relabel stage1 failed: ${e.message}`);
      return [];
    });
    const stage1InterruptedCount = Array.isArray(stage1Interrupted) ? stage1Interrupted.length : 0;
    if (stage1InterruptedCount > 0) unstuckBy.batch_stage1_failed = stage1InterruptedCount;

    const stage2Interrupted = await prisma.$queryRawUnsafe(`
      UPDATE ocr_batch
      SET status = 'partial',
          current_stage = 'classify',
          error_message = COALESCE(error_message, 'Interrupted before Stage 2 completed; rerun Stage 2 to continue.'),
          completed_at = NULL
      WHERE status = 'processing'
        AND stage1_status IN ('completed', 'partial')
        AND stage2_status = 'pending'
        AND stage3_status = 'pending'
        AND stage4_status = 'pending'
      RETURNING id
    `).catch((e) => {
      fastify.log.warn(`Stuck-batch recovery relabel stage2 partial: ${e.message}`);
      return [];
    });
    const stage2InterruptedCount = Array.isArray(stage2Interrupted) ? stage2Interrupted.length : 0;
    if (stage2InterruptedCount > 0) unstuckBy.batch_stage2_partial = stage2InterruptedCount;

    if (Object.keys(unstuckBy).length > 0) {
      fastify.log.info(`Stuck-batch recovery unstuck rows on boot: ${JSON.stringify(unstuckBy)}`);
    }
  } catch (err) {
    fastify.log.warn(`Stuck-batch recovery failed: ${err.message}`);
  }

  // ═══ CLEANUP: Fix stale provider='local' rows created by old ai-config bug ═══
  try {
    // Move AI credentials from ghost 'local' platform rows to the global config,
    // then delete the ghost rows so they stop shadowing the real GCS config.
    const ghostRows = await prisma.$queryRaw`
      SELECT id, scope_id, ai_credentials_ref, ai_model_preference, vision_credentials_ref, ocr_provider_preference
      FROM storage_config
      WHERE scope_type = 'platform' AND provider = 'local'
        AND (ai_credentials_ref IS NOT NULL OR vision_credentials_ref IS NOT NULL)
        AND (bucket_or_container IS NULL OR bucket_or_container = '')
        AND (base_path IS NULL OR base_path = '')
    `;
    for (const ghost of ghostRows) {
      // Migrate AI creds to global config if it exists and has no AI creds yet
      if (ghost.ai_credentials_ref) {
        await prisma.$executeRawUnsafe(`
          UPDATE storage_config
          SET ai_credentials_ref = COALESCE(ai_credentials_ref, $1),
              ai_model_preference = COALESCE(ai_model_preference, $2),
              updated_at = NOW()
          WHERE scope_type = 'global' AND is_active = true
            AND ai_credentials_ref IS NULL
        `, ghost.ai_credentials_ref, ghost.ai_model_preference);
      }
      // Migrate vision creds to global config
      if (ghost.vision_credentials_ref) {
        await prisma.$executeRawUnsafe(`
          UPDATE storage_config
          SET vision_credentials_ref = COALESCE(vision_credentials_ref, $1),
              ocr_provider_preference = COALESCE(ocr_provider_preference, $2),
              updated_at = NOW()
          WHERE scope_type = 'global' AND is_active = true
            AND vision_credentials_ref IS NULL
        `, ghost.vision_credentials_ref, ghost.ocr_provider_preference || 'google');
      }
      // Delete the ghost row so it stops shadowing the real GCS config
      await prisma.$executeRawUnsafe(`DELETE FROM storage_config WHERE id = $1::uuid`, ghost.id);
      fastify.log.info(`Cleaned up ghost local storage_config for platform ${ghost.scope_id}`);
    }
    // Clear provider cache so the wrong LocalStorageProvider doesn't persist
    if (ghostRows.length > 0) clearProviderCache();
  } catch (err) {
    fastify.log.warn('storage_config cleanup:', err.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: PLATFORM LIST — All platforms with OCR processing summary
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/platforms', async (request, reply) => {
    let platforms;
    try {
      platforms = await prisma.$queryRaw`
        SELECT
          p.id, p.name, p.code, p.status,
          -- Storage config
          sc.id AS storage_config_id,
          sc.provider AS storage_provider,
          sc.bucket_or_container AS storage_bucket,
          sc.base_path AS storage_base_path,
          -- P&ID counts
          (SELECT COUNT(*)::int FROM pnid pn
           JOIN pnid_system ps ON ps.pnid_id = pn.id AND ps.is_primary = true
           JOIN system s ON s.id = ps.system_id
           WHERE s.platform_id = p.id AND pn.deleted_at IS NULL) AS total_pnids,
          -- Batch history
          (SELECT COUNT(*)::int FROM ocr_batch ob WHERE ob.platform_id = p.id) AS total_batches,
          (SELECT COUNT(*)::int FROM ocr_batch ob WHERE ob.platform_id = p.id AND ob.status = 'completed') AS completed_batches,
          (SELECT COUNT(*)::int FROM ocr_batch ob WHERE ob.platform_id = p.id AND ob.passed_to_annotation = true) AS annotated_batches,
          -- Latest batch
          lb.id AS latest_batch_id,
          lb.status AS latest_batch_status,
          lb.completed_at AS latest_batch_completed,
          lb.total_files AS latest_batch_files
        FROM platform p
        LEFT JOIN LATERAL (
          SELECT * FROM storage_config sc1
          WHERE sc1.is_active = true
            AND (
              (sc1.scope_type = 'platform' AND sc1.scope_id = p.id)
              OR (sc1.scope_type = 'global')
            )
          ORDER BY CASE sc1.scope_type WHEN 'platform' THEN 0 ELSE 1 END
          LIMIT 1
        ) sc ON true
        LEFT JOIN LATERAL (
          SELECT * FROM ocr_batch ob
          WHERE ob.platform_id = p.id
          ORDER BY ob.created_at DESC LIMIT 1
        ) lb ON true
        WHERE p.deleted_at IS NULL
        ORDER BY p.name
      `;
    } catch (_err) {
      // Fallback if ocr_batch table doesn't exist yet — still include storage_config
      try {
        platforms = await prisma.$queryRaw`
          SELECT p.id, p.name, p.code, p.status,
            sc.id AS storage_config_id, sc.provider AS storage_provider,
            sc.bucket_or_container AS storage_bucket, sc.base_path AS storage_base_path,
            (SELECT COUNT(*)::int FROM pnid pn
             JOIN pnid_system ps ON ps.pnid_id = pn.id AND ps.is_primary = true
             JOIN system s ON s.id = ps.system_id
             WHERE s.platform_id = p.id AND pn.deleted_at IS NULL) AS total_pnids,
            0 AS total_batches, 0 AS completed_batches, 0 AS annotated_batches,
            NULL AS latest_batch_id, NULL AS latest_batch_status,
            NULL AS latest_batch_completed, NULL AS latest_batch_files
          FROM platform p
          LEFT JOIN LATERAL (
            SELECT * FROM storage_config sc1
            WHERE sc1.is_active = true
              AND (
                (sc1.scope_type = 'platform' AND sc1.scope_id = p.id)
                OR (sc1.scope_type = 'global')
              )
            ORDER BY CASE sc1.scope_type WHEN 'platform' THEN 0 ELSE 1 END
            LIMIT 1
          ) sc ON true
          WHERE p.deleted_at IS NULL
          ORDER BY p.name
        `;
      } catch (_err2) {
        // Final fallback if storage_config also doesn't exist
        platforms = await prisma.$queryRaw`
          SELECT p.id, p.name, p.code, p.status,
            NULL AS storage_config_id, NULL AS storage_provider,
            NULL AS storage_bucket, NULL AS storage_base_path,
            (SELECT COUNT(*)::int FROM pnid pn
             JOIN pnid_system ps ON ps.pnid_id = pn.id AND ps.is_primary = true
             JOIN system s ON s.id = ps.system_id
             WHERE s.platform_id = p.id AND pn.deleted_at IS NULL) AS total_pnids,
            0 AS total_batches, 0 AS completed_batches, 0 AS annotated_batches,
            NULL AS latest_batch_id, NULL AS latest_batch_status,
            NULL AS latest_batch_completed, NULL AS latest_batch_files
          FROM platform p
          WHERE p.deleted_at IS NULL
          ORDER BY p.name
        `;
      }
    }

    return {
      platforms: platforms.map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        hasStorage: !!p.storage_config_id,
        storageProvider: p.storage_provider,
        storageBucket: p.storage_bucket,
        storageBasePath: p.storage_base_path,
        totalPnids: p.total_pnids,
        totalBatches: p.total_batches,
        completedBatches: p.completed_batches,
        annotatedBatches: p.annotated_batches,
        latestBatch: p.latest_batch_id ? {
          id: p.latest_batch_id,
          status: p.latest_batch_status,
          completedAt: p.latest_batch_completed,
          totalFiles: p.latest_batch_files,
        } : null,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: BROWSE STORAGE — List files/folders in platform's storage
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/platforms/:platformId/storage/browse', async (request, reply) => {
    const { platformId } = request.params;
    const { prefix = '' } = request.query;

    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, code: true, name: true },
    });

    if (!platform) {
      return reply.status(404).send({ error: 'Platform not found' });
    }

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      return reply.status(400).send({
        error: 'No storage configured for this platform',
        detail: err.message,
      });
    }

    // Construct full prefix: platform code / user-specified path
    const basePrefix = prefix || `${platform.code}/pids/`;

    // Helper to list files from storage
    const listStorageFiles = async (pfx) => {
      if (typeof storage.listFiles === 'function') {
        return storage.listFiles(pfx);
      } else if (storage.config?.base_path) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const fullDir = path.join(storage.config.base_path, pfx);
        return walkDir(fullDir, storage.config.base_path);
      }
      return [];
    };

    try {
      let files = await listStorageFiles(basePrefix);

      // If no files found with enforced prefix, try alternative prefixes
      let usedPrefix = basePrefix;
      if (files.length === 0 && !prefix) {
        const alternativePrefixes = [
          `${platform.code}/`,           // platform code without /pids/
          `${platform.name}/pids/`,      // platform name instead of code
          `${platform.name}/`,           // platform name without /pids/
          '',                            // bucket root
        ];
        for (const alt of alternativePrefixes) {
          files = await listStorageFiles(alt);
          if (files.length > 0) {
            usedPrefix = alt;
            break;
          }
        }
      }

      // Filter to supported P&ID file types
      const SUPPORTED = ['.pdf', '.png', '.tiff', '.tif', '.jpg', '.jpeg'];
      const pidFiles = files.filter(f => {
        const ext = f.key.toLowerCase().match(/\.[^.]+$/)?.[0];
        return ext && SUPPORTED.includes(ext);
      });

      // Build folder structure
      const folders = new Map();
      const flatFiles = [];

      for (const file of pidFiles) {
        const relativePath = file.key.startsWith(usedPrefix)
          ? file.key.slice(usedPrefix.length)
          : file.key;
        const parts = relativePath.split('/');

        if (parts.length > 1) {
          const folderName = parts[0];
          if (!folders.has(folderName)) {
            folders.set(folderName, { name: folderName, prefix: `${usedPrefix}${folderName}/`, fileCount: 0, totalSize: 0 });
          }
          const folder = folders.get(folderName);
          folder.fileCount++;
          folder.totalSize += file.size || 0;
        }

        // Parse filename for metadata
        const filename = file.key.split('/').pop();
        const parsed = parsePnidFilename(filename);

        flatFiles.push({
          key: file.key,
          filename,
          size: file.size || 0,
          updated: file.updated || null,
          drawingNumber: parsed.drawingNumber,
          revision: parsed.revision,
        });
      }

      // Check which files are already processed (from database — authoritative source)
      const processedKeys = await prisma.$queryRaw`
        SELECT DISTINCT ON (bf.storage_key)
               bf.storage_key, bf.filename, bf.status, bf.batch_id,
               bf.raw_output_key, bf.grouped_output_key, bf.cleaned_output_key,
               ob.passed_to_annotation
        FROM ocr_batch_file bf
        JOIN ocr_batch ob ON ob.id = bf.batch_id
        WHERE ob.platform_id = ${platformId}::uuid
        ORDER BY bf.storage_key, bf.completed_at DESC NULLS LAST
      `.catch(() => []);

      // Build lookup by both storage_key and filename for cross-prefix matching
      const processedMap = {};
      const processedByFilename = {};
      for (const pk of processedKeys) {
        const entry = {
          status: pk.status,
          batchId: pk.batch_id,
          passedToAnnotation: pk.passed_to_annotation,
          rawOutputKey: pk.raw_output_key,
          hasOcrData: !!(pk.raw_output_key || pk.grouped_output_key || pk.cleaned_output_key),
        };
        processedMap[pk.storage_key] = entry;
        if (pk.filename) {
          processedByFilename[pk.filename] = entry;
        }
      }

      // Also check which files are already linked to P&IDs
      const linkedPnids = await prisma.$queryRaw`
        SELECT p.storage_key, p.id AS pnid_id, p.drawing_number
        FROM pnid p
        JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
        JOIN system s ON s.id = ps.system_id
        WHERE s.platform_id = ${platformId}::uuid
          AND p.storage_key IS NOT NULL
          AND p.deleted_at IS NULL
      `.catch(() => []);

      const linkedMap = {};
      for (const lp of linkedPnids) {
        linkedMap[lp.storage_key] = { pnidId: lp.pnid_id, drawingNumber: lp.drawing_number };
      }

      // Check for OCR output JSON files among the already-listed files (sibling detection)
      const allFileKeys = new Set(files.map(f => f.key));
      const ocrFileMap = {};
      const ocrJsonFiles = [];
      for (const f of files) {
        if (f.key.endsWith('_ocr_output.json')) {
          ocrJsonFiles.push({
            key: f.key,
            filename: f.key.split('/').pop(),
            size: f.size || 0,
            updated: f.updated || null,
          });
        }
      }

      // Match OCR JSON files to their parent P&ID files
      // Try full path match first, then filename-only match
      for (const ocrFile of ocrJsonFiles) {
        const pnidKeyPattern = ocrFile.key.replace(/_ocr_output\.json$/, '');
        const ocrBaseName = ocrFile.filename.replace(/_ocr_output\.json$/, '');
        let matched = false;
        // Full path match
        for (const pidFile of flatFiles) {
          if (pidFile.key.replace(/\.[^.]+$/, '') === pnidKeyPattern) {
            ocrFileMap[pidFile.key] = ocrFile.key;
            matched = true;
            break;
          }
        }
        // Filename-only match (for OCR files in different folders)
        if (!matched) {
          for (const pidFile of flatFiles) {
            const pidBaseName = pidFile.filename.replace(/\.[^.]+$/, '');
            if (pidBaseName === ocrBaseName && !ocrFileMap[pidFile.key]) {
              ocrFileMap[pidFile.key] = ocrFile.key;
              break;
            }
          }
        }
      }

      // Also check same-folder siblings for P&ID files without a match yet
      for (const f of flatFiles) {
        if (ocrFileMap[f.key]) continue;
        const ocrKey = f.key.replace(/\.[^.]+$/, '_ocr_output.json');
        if (allFileKeys.has(ocrKey)) {
          ocrFileMap[f.key] = ocrKey;
        }
      }

      // Build final file list with OCR status from both DB and storage
      const enrichedFiles = flatFiles.map(f => {
        // Look up OCR status: by storage_key first, then by filename
        const dbStatus = processedMap[f.key] || processedByFilename[f.filename] || null;
        // OCR data is available if found in DB (with raw_output_key) OR as storage sibling
        const hasOcrFromDb = dbStatus?.hasOcrData || false;
        const hasOcrFromStorage = !!ocrFileMap[f.key];
        const ocrOutputKey = dbStatus?.rawOutputKey || ocrFileMap[f.key] || null;

        return {
          ...f,
          ocrStatus: dbStatus,
          linkedPnid: linkedMap[f.key] || null,
          hasOcrOutputFile: hasOcrFromDb || hasOcrFromStorage,
          ocrOutputKey,
        };
      });

      const ocrAvailableCount = enrichedFiles.filter(f => f.hasOcrOutputFile).length;

      return {
        platform: { id: platform.id, code: platform.code, name: platform.name },
        currentPrefix: usedPrefix,
        folders: [...folders.values()],
        files: enrichedFiles,
        ocrJsonFiles,
        totalFiles: flatFiles.length,
        totalOcrFiles: ocrJsonFiles.length,
        totalOcrAvailable: ocrAvailableCount,
        totalFolders: folders.size,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to browse storage: ${err.message}` });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECT OCR FILES — Scan storage for existing OCR output files
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/platforms/:platformId/detect-ocr-files', async (request, reply) => {
    const { platformId } = request.params;

    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, code: true, name: true },
    });

    if (!platform) {
      return reply.status(404).send({ error: 'Platform not found' });
    }

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      return reply.status(400).send({ error: 'No storage configured', detail: err.message });
    }

    try {
      // Scan from platform root — OCR files could be in any subfolder
      const scanPrefixes = [
        `${platform.code}/`,           // platform root (most common)
        `${platform.code}/pids/`,      // pids subfolder
        `${platform.code}/ocr/`,       // ocr-specific subfolder
      ];

      // Walk storage for all files across possible prefixes
      let allFiles = [];
      const seenKeys = new Set();

      for (const prefix of scanPrefixes) {
        let prefixFiles = [];
        try {
          if (typeof storage.listFiles === 'function') {
            prefixFiles = await storage.listFiles(prefix);
          } else if (storage.config?.base_path) {
            const fs = await import('fs/promises');
            const path = await import('path');
            const fullDir = path.join(storage.config.base_path, prefix);
            prefixFiles = await walkDir(fullDir, storage.config.base_path);
          }
        } catch (_e) { /* prefix may not exist */ }

        for (const f of prefixFiles) {
          if (!seenKeys.has(f.key)) {
            seenKeys.add(f.key);
            allFiles.push(f);
          }
        }
      }

      // Find all _ocr_output.json files
      const ocrFiles = allFiles.filter(f => f.key.endsWith('_ocr_output.json'));

      // Get all P&IDs for this platform
      const pnids = await prisma.$queryRaw`
        SELECT p.id, p.drawing_number, p.storage_key, p.ocr_status,
               p.ocr_raw_storage_key, p.has_image
        FROM pnid p
        JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
        JOIN system s ON s.id = ps.system_id
        WHERE s.platform_id = ${platformId}::uuid
          AND p.deleted_at IS NULL
      `.catch(() => []);

      // Match OCR files to P&IDs by storage_key pattern
      const detected = [];
      for (const ocrFile of ocrFiles) {
        // Derive the original P&ID storage key from the OCR output key
        // e.g. "WHT5/pids/DWG-001.pdf" → "WHT5/pids/DWG-001_ocr_output.json"
        const pnidKeyPattern = ocrFile.key.replace(/_ocr_output\.json$/, '');

        // Find matching P&ID by storage_key prefix
        const matchedPnid = pnids.find(p =>
          p.storage_key && p.storage_key.replace(/\.[^.]+$/, '') === pnidKeyPattern
        );

        // Also try matching by drawing number from filename
        const filename = ocrFile.key.split('/').pop();
        const drawingFromFile = filename.replace(/_ocr_output\.json$/, '');
        const parsed = parsePnidFilename(drawingFromFile);

        const matchedByDrawing = !matchedPnid
          ? pnids.find(p =>
              p.drawing_number &&
              parsed.drawingNumber &&
              p.drawing_number.toLowerCase() === parsed.drawingNumber.toLowerCase()
            )
          : null;

        const pnid = matchedPnid || matchedByDrawing;

        // Read a preview of the OCR output to show stats
        let ocrMeta = null;
        try {
          const { buffer } = await storage.download(ocrFile.key);
          ocrMeta = JSON.parse(buffer.toString('utf-8'));
        } catch (_e) { /* non-critical */ }

        detected.push({
          ocrOutputKey: ocrFile.key,
          ocrFileSize: ocrFile.size || 0,
          ocrFileUpdated: ocrFile.updated || null,
          pnidId: pnid?.id || null,
          drawingNumber: pnid?.drawing_number || parsed.drawingNumber || drawingFromFile,
          pnidStorageKey: pnid?.storage_key || null,
          currentOcrStatus: pnid?.ocr_status || null,
          alreadyImported: pnid?.ocr_status === 'completed' || !!pnid?.ocr_raw_storage_key,
          ocrMeta: ocrMeta ? {
            wordCount: ocrMeta.wordCount,
            groupedCount: ocrMeta.groupedCount,
            classifiedCount: ocrMeta.classifiedCount,
            matchedCount: ocrMeta.matchedCount,
            extractedAt: ocrMeta.extractedAt,
          } : null,
        });
      }

      // Also check for batch export files
      const exportPrefix = `${platform.code}/ocr/exports/`;
      let exportFiles = [];
      try {
        if (typeof storage.listFiles === 'function') {
          exportFiles = await storage.listFiles(exportPrefix);
        } else if (storage.config?.base_path) {
          const fs = await import('fs/promises');
          const path = await import('path');
          const fullDir = path.join(storage.config.base_path, exportPrefix);
          exportFiles = await walkDir(fullDir, storage.config.base_path);
        }
      } catch (_e) { /* no exports dir */ }

      return {
        platform: { id: platform.id, code: platform.code, name: platform.name },
        detected,
        totalOcrFiles: ocrFiles.length,
        matchedToPnids: detected.filter(d => d.pnidId).length,
        alreadyImported: detected.filter(d => d.alreadyImported).length,
        readyToImport: detected.filter(d => d.pnidId && !d.alreadyImported).length,
        exportFiles: exportFiles.map(f => ({
          key: f.key,
          filename: f.key.split('/').pop(),
          size: f.size || 0,
          updated: f.updated || null,
        })),
      };

    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Detection failed: ${err.message}` });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IMPORT OCR FILES — Re-link detected OCR output files to P&ID records
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/platforms/:platformId/import-ocr-files', async (request, reply) => {
    const { platformId } = request.params;
    const { files: filesToImport } = request.body || {};

    // files = [{ pnidId, ocrOutputKey }]
    if (!filesToImport?.length) {
      return reply.status(400).send({ error: 'files array is required (each: { pnidId, ocrOutputKey })' });
    }

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      return reply.status(400).send({ error: 'No storage configured', detail: err.message });
    }

    const results = { imported: 0, skipped: 0, failed: 0, details: [] };

    for (const { pnidId, ocrOutputKey } of filesToImport) {
      try {
        // Read the OCR output JSON from storage
        const { buffer } = await storage.download(ocrOutputKey);
        const ocrData = JSON.parse(buffer.toString('utf-8'));

        // Update the P&ID record with OCR info
        await prisma.$queryRaw`
          UPDATE pnid SET
            ocr_status = 'completed',
            ocr_raw_storage_key = ${ocrOutputKey},
            ocr_raw_data = ${JSON.stringify(ocrData)}::jsonb,
            ocr_processed_at = ${ocrData.extractedAt ? new Date(ocrData.extractedAt) : new Date()}
          WHERE id = ${pnidId}::uuid
        `;

        results.imported++;
        results.details.push({
          pnidId,
          ocrOutputKey,
          status: 'imported',
          wordCount: ocrData.wordCount || 0,
          extractedAt: ocrData.extractedAt,
        });
      } catch (err) {
        results.failed++;
        results.details.push({
          pnidId,
          ocrOutputKey,
          status: 'failed',
          error: err.message,
        });
      }
    }

    return { success: true, ...results };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET OCR STATUS — Clear batch file records so files can be re-processed
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/platforms/:platformId/reset-ocr-status', async (request, reply) => {
    const { platformId } = request.params;

    try {
      // Delete ocr_extraction rows for all P&IDs in this platform
      const deletedExtractions = await prisma.$queryRaw`
        DELETE FROM ocr_extraction
        WHERE pnid_id IN (
          SELECT p.id FROM pnid p
          JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
          JOIN system s ON s.id = ps.system_id
          WHERE s.platform_id = ${platformId}::uuid
        )
      `.catch(() => []);

      // Delete batch file records for this platform
      const deletedFiles = await prisma.$queryRaw`
        DELETE FROM ocr_batch_file
        WHERE batch_id IN (
          SELECT id FROM ocr_batch WHERE platform_id = ${platformId}::uuid
        )
      `.catch(() => []);

      // Delete batch records
      const deletedBatches = await prisma.$queryRaw`
        DELETE FROM ocr_batch WHERE platform_id = ${platformId}::uuid
      `.catch(() => []);

      // Reset pnid ocr_status for this platform
      await prisma.$queryRaw`
        UPDATE pnid SET
          ocr_status = NULL,
          ocr_raw_data = NULL,
          ocr_cleaned_data = NULL,
          ocr_raw_storage_key = NULL,
          ocr_cleaned_storage_key = NULL,
          ocr_processed_at = NULL,
          ocr_error = NULL
        WHERE id IN (
          SELECT p.id FROM pnid p
          JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
          JOIN system s ON s.id = ps.system_id
          WHERE s.platform_id = ${platformId}::uuid
        )
      `.catch(() => []);

      // Delete OCR jobs for this platform's P&IDs
      await prisma.$queryRaw`
        DELETE FROM ocr_job
        WHERE pnid_id IN (
          SELECT p.id FROM pnid p
          JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
          JOIN system s ON s.id = ps.system_id
          WHERE s.platform_id = ${platformId}::uuid
        )
      `.catch(() => []);

      return {
        success: true,
        message: 'OCR status reset. All files are now available for re-processing.',
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Reset failed: ${err.message}` });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: CREATE BATCH & RUN OCR — Select files and process them
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/platforms/:platformId/batches', async (request, reply) => {
    const { platformId } = request.params;
    const {
      storageKeys,
      batchName,
      ocrProvider: ocrProviderChoice,
      storageConfigId,  // NEW: explicit storage config selection
      aiModel           // NEW: explicit AI model selection
    } = request.body || {};

    if (!storageKeys?.length) {
      return reply.status(400).send({ error: 'storageKeys array is required' });
    }

    if (storageKeys.length > 100) {
      return reply.status(400).send({ error: 'Maximum 100 files per batch' });
    }

    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, code: true, name: true },
    });
    if (!platform) return reply.status(404).send({ error: 'Platform not found' });

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      // Stub for mock mode
      storage = { download: () => { throw new Error('No storage configured'); }, config: {} };
    }

    // Step 1: Resolve storage config with fallback chain
    let storageConfig;
    if (storageConfigId) {
      // Explicit choice provided
      const explicit = await prisma.$queryRaw`
        SELECT id, bucket_or_container, base_path, scope_type, scope_id
        FROM storage_config
        WHERE id = ${storageConfigId}::uuid AND is_active = true
      `.catch(() => []);

      if (!explicit[0]) {
        return reply.status(400).send({ error: 'Selected storage config not found' });
      }

      // Verify it's accessible for this platform
      if (explicit[0].scope_type === 'platform' && explicit[0].scope_id !== platformId) {
        return reply.status(403).send({ error: 'Storage config not accessible for this platform' });
      }

      storageConfig = explicit;
    } else {
      // Use platform's primary storage config (fallback: global)
      storageConfig = await prisma.$queryRaw`
        SELECT id, bucket_or_container, base_path
        FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
           OR (scope_type = 'global' AND is_active = true)
        ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
        LIMIT 1
      `.catch(() => []);
    }

    // Step 2: Resolve OCR provider options with explicit choices
    let ocrOptions;
    if (ocrProviderChoice && !['google', 'claude', 'both', 'paddle', 'florence'].includes(ocrProviderChoice)) {
      return reply.status(400).send({ error: 'ocrProvider must be one of: google, claude, both, paddle, florence' });
    }

    if (ocrProviderChoice || aiModel) {
      ocrOptions = await resolveOcrOptions(prisma, platformId, {
        storageConfig: storageConfig[0],
        aiModel
      });
      if (ocrProviderChoice) {
        ocrOptions.ocrProvider = ocrProviderChoice; // override with explicit choice
      }
      if ((ocrOptions.ocrProvider === 'claude' || ocrOptions.ocrProvider === 'both') && !ocrOptions.claudeApiKey) {
        return reply.status(400).send({ error: `Claude Vision requires a Claude API key. Configure it in Pipeline Settings.` });
      }
      if (ocrOptions.ocrProvider === 'paddle' && !ocrOptions.paddleEndpointUrl) {
        return reply.status(400).send({ error: 'Paddle OCR requires PADDLE_OCR_URL to be configured.' });
      }
      if (ocrOptions.ocrProvider === 'florence' && !ocrOptions.florenceEndpointUrl) {
        return reply.status(400).send({ error: 'Florence OCR requires FLORENCE_OCR_URL to be configured.' });
      }
    } else {
      ocrOptions = await resolveOcrOptions(prisma, platformId, {
        storageConfig: storageConfig[0]
      });
      if (ocrOptions.ocrProvider === 'paddle' && !ocrOptions.paddleEndpointUrl) {
        return reply.status(400).send({ error: 'Paddle OCR requires PADDLE_OCR_URL to be configured.' });
      }
      if (ocrOptions.ocrProvider === 'florence' && !ocrOptions.florenceEndpointUrl) {
        return reply.status(400).send({ error: 'Florence OCR requires FLORENCE_OCR_URL to be configured.' });
      }
    }

    // Step 3: Create batch record with stage tracking
    const [batch] = await prisma.$queryRaw`
      INSERT INTO ocr_batch (
        platform_id, batch_name, status,
        storage_config_id, storage_bucket,
        total_files, started_at, created_by,
        current_stage, stage1_status, stage2_status, stage3_status, stage4_status,
        ocr_provider_used, ai_model_used
      ) VALUES (
        ${platformId}::uuid,
        ${batchName || `Batch ${new Date().toISOString().slice(0, 16)}`},
        'processing',
        ${storageConfig[0]?.id || null}::uuid,
        ${storageConfig[0]?.bucket_or_container || null},
        ${storageKeys.length},
        NOW(),
        'admin',
        'extraction', 'pending', 'pending', 'pending', 'pending',
        ${ocrOptions.ocrProvider || 'google'},
        ${ocrOptions.claudeModel || null}
      )
      RETURNING id
    `;

    const batchId = batch.id;

    // Create batch file records
    for (const key of storageKeys) {
      const filename = key.split('/').pop();
      const parsed = parsePnidFilename(filename);

      await prisma.$queryRaw`
        INSERT INTO ocr_batch_file (
          batch_id, storage_key, filename, drawing_number, revision, status
        ) VALUES (
          ${batchId}::uuid, ${key}, ${filename},
          ${parsed.drawingNumber}, ${parsed.revision}, 'pending'
        )
      `;
    }

    // Process files asynchronously (don't block the response)
    processBatchAsync(prisma, batchId, platformId, storage, ocrOptions).catch(err => {
      console.error(`Batch ${batchId} processing error:`, err);
    });

    return reply.status(202).send({
      success: true,
      batchId,
      message: `Batch created with ${storageKeys.length} files. Processing started.`,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE BATCH FROM EXISTING OCR — Skip extraction, load from storage JSONs
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/platforms/:platformId/batches/from-existing', async (request, reply) => {
    const { platformId } = request.params;
    const { files: ocrFiles, batchName } = request.body || {};

    // files = [{ storageKey, ocrOutputKey, filename, drawingNumber }]
    if (!ocrFiles?.length) {
      return reply.status(400).send({ error: 'files array is required (each: { storageKey, ocrOutputKey })' });
    }

    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, code: true, name: true },
    });
    if (!platform) return reply.status(404).send({ error: 'Platform not found' });

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch (err) {
      return reply.status(400).send({ error: 'No storage configured', detail: err.message });
    }

    // Get storage config
    const storageConfig = await prisma.$queryRaw`
      SELECT id, bucket_or_container
      FROM storage_config
      WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
         OR (scope_type = 'global' AND is_active = true)
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);

    // Create batch record — mark extraction as already completed
    const [batch] = await prisma.$queryRaw`
      INSERT INTO ocr_batch (
        platform_id, batch_name, status,
        storage_config_id, storage_bucket,
        total_files, started_at, created_by,
        current_stage, stage1_status, stage2_status, stage3_status, stage4_status,
        ocr_provider_used
      ) VALUES (
        ${platformId}::uuid,
        ${batchName || `Existing OCR — ${new Date().toISOString().slice(0, 16)}`},
        'processing',
        ${storageConfig[0]?.id || null}::uuid,
        ${storageConfig[0]?.bucket_or_container || null},
        ${ocrFiles.length},
        NOW(),
        'admin',
        'grouping', 'completed', 'pending', 'pending', 'pending',
        'existing'
      )
      RETURNING id
    `;

    const batchId = batch.id;
    const results = { loaded: 0, failed: 0, errors: [] };

    for (const { storageKey, ocrOutputKey, filename: rawFilename, drawingNumber: rawDN } of ocrFiles) {
      const filename = rawFilename || storageKey.split('/').pop();
      const parsed = parsePnidFilename(filename);

      try {
        // Read existing OCR output from storage
        const { buffer } = await storage.download(ocrOutputKey);
        const ocrData = JSON.parse(buffer.toString('utf-8'));

        // Create batch file record with OCR data already loaded
        await prisma.$queryRaw`
          INSERT INTO ocr_batch_file (
            batch_id, storage_key, filename, drawing_number, revision,
            status, raw_ocr_data, word_count, completed_at
          ) VALUES (
            ${batchId}::uuid, ${storageKey}, ${filename},
            ${rawDN || parsed.drawingNumber}, ${parsed.revision},
            'completed',
            ${JSON.stringify(ocrData)}::jsonb,
            ${ocrData.wordCount || ocrData.words?.length || 0},
            NOW()
          )
        `;
        results.loaded++;
      } catch (err) {
        // Create record as failed so user sees which ones had issues
        await prisma.$queryRaw`
          INSERT INTO ocr_batch_file (
            batch_id, storage_key, filename, drawing_number, revision, status
          ) VALUES (
            ${batchId}::uuid, ${storageKey}, ${filename},
            ${rawDN || parsed.drawingNumber}, ${parsed.revision}, 'failed'
          )
        `.catch(() => {});
        results.failed++;
        results.errors.push({ storageKey, error: err.message });
      }
    }

    // Update batch stage1 completion
    const completedCount = results.loaded;
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        stage1_status = 'completed',
        stage1_completed_at = NOW(),
        current_stage = 'grouping'
      WHERE id = ${batchId}::uuid
    `;

    return reply.status(202).send({
      success: true,
      batchId,
      loaded: results.loaded,
      failed: results.failed,
      errors: results.errors,
      message: `Batch created from ${results.loaded} existing OCR files. Ready for AI classification.`,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: BATCH STATUS & HISTORY
  // ═══════════════════════════════════════════════════════════════════════════

  // Get all batches for a platform (processing history)
  fastify.get('/ocr-pipeline/platforms/:platformId/batches', async (request, reply) => {
    const { platformId } = request.params;

    let batches = [];
    try {
      // Some environments can lag migrations; build a compatible SELECT that
      // falls back when newer status/model columns are absent.
      const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ocr_batch'
      `);
      const colSet = new Set((cols || []).map((c) => String(c.column_name || '').toLowerCase()));
      const has = (name) => colSet.has(String(name || '').toLowerCase());
      const pick = (name, fallbackSql) => (has(name) ? `b.${name}` : `${fallbackSql} AS ${name}`);

      const sql = `
        SELECT
          b.id, b.batch_name, b.status,
          b.total_files, b.processed_files, b.failed_files,
          b.result_format, b.result_storage_key,
          b.passed_to_annotation, b.annotation_passed_at,
          ${pick('current_stage', `'extraction'::text`)},
          ${pick('stage1_status', `'pending'::text`)},
          ${pick('stage2_status', `'pending'::text`)},
          ${pick('stage3_status', `'pending'::text`)},
          ${pick('stage4_status', `'pending'::text`)},
          ${pick('ocr_provider_used', 'NULL::text')},
          ${pick('ai_model_used', 'NULL::text')},
          ${pick('stage2_phase_profile', 'NULL::text')},
          b.started_at, b.completed_at, b.error_message,
          b.created_at, b.created_by
        FROM ocr_batch b
        WHERE b.platform_id = $1::uuid
        ORDER BY b.created_at DESC
      `;
      batches = await prisma.$queryRawUnsafe(sql, platformId);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to load OCR batches: ${err.message}` });
    }

    return {
      batches: batches.map(b => ({
        id: b.id,
        batchName: b.batch_name,
        status: b.status,
        totalFiles: b.total_files,
        processedFiles: b.processed_files,
        failedFiles: b.failed_files,
        resultFormat: b.result_format,
        hasResults: !!b.result_storage_key,
        passedToAnnotation: b.passed_to_annotation,
        annotationPassedAt: b.annotation_passed_at,
        // Stage tracking
        currentStage: b.current_stage || 'extraction',
        stage1Status: b.stage1_status || 'pending',
        stage2Status: b.stage2_status || 'pending',
        stage3Status: b.stage3_status || 'pending',
        stage4Status: b.stage4_status || 'pending',
        ocrProviderUsed: b.ocr_provider_used,
        aiModelUsed: b.ai_model_used,
        stage2PhaseProfile: b.stage2_phase_profile || null,
        startedAt: b.started_at,
        completedAt: b.completed_at,
        errorMessage: b.error_message,
        createdAt: b.created_at,
      })),
    };
  });

  // Get single batch detail with files
  fastify.get('/ocr-pipeline/batches/:batchId', async (request, reply) => {
    const { batchId } = request.params;

    let batch;
    try {
      const batches = await prisma.$queryRaw`
        SELECT b.*, p.code AS platform_code, p.name AS platform_name
        FROM ocr_batch b
        JOIN platform p ON p.id = b.platform_id
        WHERE b.id = ${batchId}::uuid
      `;
      batch = batches[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Failed to load batch: ${err.message}` });
    }

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.storage_key, bf.filename, bf.drawing_number, bf.revision,
             bf.pnid_id, bf.ocr_job_id, bf.status, bf.error_message,
             bf.tags_found, bf.tags_matched, bf.file_size_bytes,
             bf.raw_output_key, bf.grouped_output_key, bf.cleaned_output_key,
             bf.review_output_key, bf.review_status, bf.reviewed_at, bf.review_stats,
             bf.stage2_phase_profile,
             bf.created_at
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
      ORDER BY bf.drawing_number, bf.filename
    `;

    return {
      batch: {
        id: batch.id,
        platformId: batch.platform_id,
        batchName: batch.batch_name,
        platformCode: batch.platform_code,
        platformName: batch.platform_name,
        status: batch.status,
        totalFiles: batch.total_files,
        processedFiles: batch.processed_files,
        failedFiles: batch.failed_files,
        resultFormat: batch.result_format,
        hasResults: !!batch.result_storage_key,
        passedToAnnotation: batch.passed_to_annotation,
        annotationPassedAt: batch.annotation_passed_at,
        aiCleanupStatus: batch.ai_cleanup_status || 'pending',
        aiCleanupJobId: batch.ai_cleanup_job_id,
        reconciliationSummary: batch.reconciliation_summary || null,
        aiAnalysisStatus: batch.ai_analysis_status,
        // Stage tracking
        currentStage: batch.current_stage || 'extraction',
        stage1Status: batch.stage1_status || 'pending',
        stage2Status: batch.stage2_status || 'pending',
        stage3Status: batch.stage3_status || 'pending',
        stage4Status: batch.stage4_status || 'pending',
        ocrProviderUsed: batch.ocr_provider_used,
        aiModelUsed: batch.ai_model_used,
        stage2PhaseProfile: batch.stage2_phase_profile || null,
        startedAt: batch.started_at,
        completedAt: batch.completed_at,
        errorMessage: batch.error_message,
        createdAt: batch.created_at,
      },
      files: files.map(f => ({
        id: f.id,
        storageKey: f.storage_key,
        filename: f.filename,
        drawingNumber: f.drawing_number,
        revision: f.revision,
        pnidId: f.pnid_id,
        ocrJobId: f.ocr_job_id,
        status: f.status,
        errorMessage: f.error_message,
        tagsFound: f.tags_found,
        tagsMatched: f.tags_matched,
        fileSizeBytes: f.file_size_bytes != null ? Number(f.file_size_bytes) : null,
        // Stage output keys
        rawOutputKey: f.raw_output_key,
        groupedOutputKey: f.grouped_output_key,
        cleanedOutputKey: f.cleaned_output_key,
        stage2PhaseProfile: f.stage2_phase_profile || null,
        reviewOutputKey: f.review_output_key,
        reviewStatus: f.review_status || 'pending',
        reviewedAt: f.reviewed_at,
        reviewStats: f.review_stats,
      })),
    };
  });

  // ═══ Stage 1: Line register preview (OCR line tags vs DB + pnid_line) — read-only ═══
  fastify.get('/ocr-pipeline/batches/:batchId/line-register/preview', async (request, reply) => {
    const { batchId } = request.params;
    try {
      const data = await buildLineRegisterPreview(prisma, batchId);
      return data;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Line register preview failed' });
    }
  });

  // ═══ Unified register preview — equipment + instrument (same pattern as line) ═══
  fastify.get('/ocr-pipeline/batches/:batchId/equipment-register/preview', async (request, reply) => {
    const { batchId } = request.params;
    try {
      return await buildRegisterPreview(prisma, batchId, 'equipment');
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Equipment register preview failed' });
    }
  });

  fastify.get('/ocr-pipeline/batches/:batchId/instrument-register/preview', async (request, reply) => {
    const { batchId } = request.params;
    try {
      return await buildRegisterPreview(prisma, batchId, 'instrument');
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Instrument register preview failed' });
    }
  });

  // ═══ CSV export for any entity type preview ═══
  fastify.get('/ocr-pipeline/batches/:batchId/register-preview/:entityType/export-csv', async (request, reply) => {
    const { batchId, entityType } = request.params;
    const { section = 'all' } = request.query;
    if (!['line', 'equipment', 'instrument'].includes(entityType)) {
      return reply.status(400).send({ error: 'entityType must be: line, equipment, or instrument' });
    }
    try {
      const data = await buildRegisterPreview(prisma, batchId, entityType);
      const csv = generatePreviewCsv(data, section);
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${entityType}-register-preview-${section}.csv"`);
      return reply.send(csv);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'CSV export failed' });
    }
  });

  /**
   * Write approved/edited review tags to ocr_extraction with OCR coordinates (position_pct).
   * Existing rows matched by pnid + text: bbox updated from OCR; matched_entity_id left unchanged.
   */
  fastify.post('/ocr-pipeline/batches/:batchId/sync-review-to-extractions', async (request, reply) => {
    const { batchId } = request.params;
    try {
      const result = await syncBatchReviewToOcrExtractions(prisma, batchId);
      return { success: true, ...result };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message || 'Sync failed' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE FILES: View/download raw, grouped, cleaned JSON per batch file
  // ═══════════════════════════════════════════════════════════════════════════

  // Get stage file content (raw/grouped/cleaned JSON)
  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/stage/:stage', async (request, reply) => {
    const { batchId, fileId, stage } = request.params;

    if (!['raw', 'grouped', 'cleaned', 'review'].includes(stage)) {
      return reply.status(400).send({ error: 'Stage must be: raw, grouped, cleaned, or review' });
    }

    // Get the file record and its stage output key
    const columnMap = { raw: 'raw_output_key', grouped: 'grouped_output_key', cleaned: 'cleaned_output_key', review: 'review_output_key' };
    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.raw_output_key, bf.grouped_output_key, bf.cleaned_output_key,
             bf.review_output_key, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `;

    if (!files[0]) return reply.status(404).send({ error: 'File not found in batch' });

    const file = files[0];
    const outputKey = file[columnMap[stage]];

    if (!outputKey) {
      return reply.status(404).send({ error: `No ${stage} output available for this file. Run stage ${stage === 'raw' ? '1' : stage === 'grouped' ? '2' : '3'} first.` });
    }

    // Download the JSON from storage
    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    try {
      const downloaded = await storageProvider.download(outputKey);
      const buffer = downloaded.buffer || downloaded;
      const jsonContent = JSON.parse(buffer.toString('utf-8'));

      return {
        file: file.filename,
        stage,
        storageKey: outputKey,
        data: jsonContent,
      };
    } catch (err) {
      return reply.status(500).send({ error: `Failed to read ${stage} file: ${err.message}` });
    }
  });

  // List all stage files for a batch (summary view)
  fastify.get('/ocr-pipeline/batches/:batchId/stages', async (request, reply) => {
    const { batchId } = request.params;

    const batch = await prisma.$queryRaw`
      SELECT id, current_stage, stage1_status, stage2_status, stage3_status, stage4_status,
             ocr_provider_used, ai_model_used, status
      FROM ocr_batch
      WHERE id = ${batchId}::uuid
    `.then(r => r[0]).catch(() => null);

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    const files = await prisma.$queryRaw`
      SELECT id, filename, drawing_number, status, error_message,
             raw_output_key, grouped_output_key, cleaned_output_key,
             tags_found
      FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid
      ORDER BY drawing_number, filename
    `;

    return {
      batchId: batch.id,
      currentStage: batch.current_stage,
      stages: {
        extraction: { status: batch.stage1_status, provider: batch.ocr_provider_used },
        grouping: { status: batch.stage2_status },
        cleanup: { status: batch.stage3_status, aiModel: batch.ai_model_used },
        import: { status: batch.stage4_status },
      },
      files: files.map(f => ({
        id: f.id,
        filename: f.filename,
        drawingNumber: f.drawing_number,
        status: f.status,
        errorMessage: f.error_message,
        wordsExtracted: f.tags_found,
        stages: {
          raw: f.raw_output_key ? { available: true, key: f.raw_output_key } : { available: false },
          grouped: f.grouped_output_key ? { available: true, key: f.grouped_output_key } : { available: false },
          cleaned: f.cleaned_output_key ? { available: true, key: f.cleaned_output_key } : { available: false },
        },
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WORD GROUPING DIAGNOSTIC — read-only, no AI, no DB writes, no storage writes
  // Reads Stage-1 raw OCR for a single file and re-runs WordGrouper with all
  // passes enabled, returning rich audit metadata for visual inspection.
  //
  // GET  /ocr-pipeline/batches/:batchId/files/:fileId/grouping-diagnostic[?csv=1]
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/grouping-diagnostic', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const wantCsv = String(request.query?.csv || '') === '1' || String(request.query?.format || '') === 'csv';

    // Optional knobs that control the diagnostic itself (read-only)
    const arbitrationParam = String(request.query?.arbitration || 'none').toLowerCase();
    const arbitration = ['none', 'priority_lock', 'nms_best', 'cluster'].includes(arbitrationParam)
      ? arbitrationParam : 'none';
    const horizontalStoppers = String(request.query?.stoppers || '')
      .split(',').map(s => s.trim()).filter(Boolean)
      .filter(s => ['median_gap', 'symbol_region', 'number_break'].includes(s));
    const verticalRelaxed = String(request.query?.vertical_relaxed || '') === '1' ||
      String(request.query?.verticalRelaxed || '') === '1' ||
      String(request.query?.vrelaxed || '') === '1';
    // Bipartite vertical pairing is ON by default. Pass ?bipartite=0 to disable.
    const bipartiteVerticalPairing = !(String(request.query?.bipartite || '') === '0');
    // Keep relaxed mids OUT of bipartite pairing by default.
    const bipartiteIncludeRelaxed = String(request.query?.bipartite_relaxed || '') === '1' ||
      String(request.query?.bipartiteIncludeRelaxed || '') === '1';

    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.raw_output_key, bf.user_labels_json, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `.catch(() => []);

    if (!files[0]) return reply.status(404).send({ error: 'File not found in batch' });
    const file = files[0];
    if (!file.raw_output_key) {
      return reply.status(409).send({
        error: 'No raw OCR output for this file. Run Stage 1 first.',
        hint: 'Stage 1 must produce raw_output_key before grouping diagnostics can run.',
      });
    }

    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    let rawData;
    try {
      const downloaded = await storageProvider.download(file.raw_output_key);
      const buffer = downloaded.buffer || downloaded;
      rawData = JSON.parse(buffer.toString('utf-8'));
    } catch (err) {
      return reply.status(500).send({ error: `Failed to read raw OCR file: ${err.message}` });
    }

    const rawWords = Array.isArray(rawData?.words) ? rawData.words : [];
    const pageWidth = Number(rawData?.pageWidth || 2400);
    const pageHeight = Number(rawData?.pageHeight || 1700);
    // symbolRegions are optional — used by the symbol_region stopper and as DBSCAN seed.
    const symbolRegions = Array.isArray(rawData?.symbolRegions)
      ? rawData.symbolRegions.map(r => r?.position_pct || r).filter(Boolean)
      : [];
    // User labels live on the batch_file row.  Shape: { labels: [...] }.
    // Pass-through to the diagnostic, which applies them as a feedback pass.
    const labelsRaw = file.user_labels_json || null;
    const userLabels = Array.isArray(labelsRaw?.labels) ? labelsRaw.labels : [];

    let diag;
    try {
      diag = runGroupingDiagnostic(rawWords, {
        pageWidth,
        pageHeight,
        groupingOverrides: {
          enableVerticalGrouping: true,
          enableRotationGrouping: true,
        },
        horizontalStoppers,
        arbitration,
        symbolRegions,
        verticalRelaxed,
        bipartiteVerticalPairing,
        bipartiteIncludeRelaxed,
        userLabels,
      });
    } catch (err) {
      return reply.status(500).send({ error: `Diagnostic failed: ${err.message}` });
    }

    if (wantCsv) {
      const csv = groupingDiagnosticToCsv(diag);
      const downloadName = `${(file.filename || 'file').replace(/\.[^.]+$/, '')}_grouping_diagnostic.csv`;
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${downloadName}"`);
      return reply.send(csv);
    }

    return {
      file: {
        id: file.id,
        filename: file.filename,
        platformId: file.platform_id,
        rawOutputKey: file.raw_output_key,
      },
      requested: {
        arbitration,
        horizontalStoppers,
        verticalRelaxed,
        bipartiteVerticalPairing,
        bipartiteIncludeRelaxed,
      },
      diagnostic: diag,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // USER LABELS — feedback loop ground truth for the grouping diagnostic.
  //
  // Labels are stored in ocr_batch_file.user_labels_json and mirrored into
  // ocr_feedback_event so platform-level promotion (vocabulary / thresholds /
  // arbitration priors) can later aggregate them.  No storage writes.
  //
  // GET    /ocr-pipeline/batches/:batchId/files/:fileId/labels         → list
  // PUT    /ocr-pipeline/batches/:batchId/files/:fileId/labels/:atomIdx → upsert
  // DELETE /ocr-pipeline/batches/:batchId/files/:fileId/labels/:atomIdx → clear
  // DELETE /ocr-pipeline/batches/:batchId/files/:fileId/labels         → clear all
  // ═══════════════════════════════════════════════════════════════════════════

  const VALID_LABEL_ROLES = ['prefix', 'mid', 'suffix', 'line_tag', 'equipment_tag', 'noise'];

  async function loadFileForLabels(batchId, fileId) {
    const rows = await prisma.$queryRaw`
      SELECT bf.id, bf.user_labels_json, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `.catch(() => []);
    return rows[0] || null;
  }

  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/labels', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const file = await loadFileForLabels(batchId, fileId);
    if (!file) return reply.status(404).send({ error: 'File not found in batch' });
    const labels = Array.isArray(file.user_labels_json?.labels) ? file.user_labels_json.labels : [];
    return { fileId, labels };
  });

  fastify.put('/ocr-pipeline/batches/:batchId/files/:fileId/labels/:atomIdx', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const atomIdx = Number(request.params.atomIdx);
    const { role, text, decidedBy } = request.body || {};
    if (!Number.isFinite(atomIdx) || atomIdx < 0) {
      return reply.status(400).send({ error: 'atomIdx must be a non-negative integer' });
    }
    const normRole = String(role || '').toLowerCase();
    if (!VALID_LABEL_ROLES.includes(normRole)) {
      return reply.status(400).send({ error: `role must be one of ${VALID_LABEL_ROLES.join(', ')}` });
    }
    const file = await loadFileForLabels(batchId, fileId);
    if (!file) return reply.status(404).send({ error: 'File not found in batch' });

    const existing = Array.isArray(file.user_labels_json?.labels) ? file.user_labels_json.labels : [];
    const next = existing.filter(l => Number(l?.atomIdx) !== atomIdx);
    const entry = {
      atomIdx,
      role: normRole,
      text: String(text || '').slice(0, 200),
      decidedAt: new Date().toISOString(),
      decidedBy: String(decidedBy || '').slice(0, 100) || null,
    };
    next.push(entry);

    try {
      await prisma.$executeRaw`
        UPDATE ocr_batch_file
        SET user_labels_json = ${JSON.stringify({ labels: next })}::jsonb
        WHERE id = ${fileId}::uuid
      `;
    } catch (err) {
      return reply.status(500).send({ error: `Failed to persist label: ${err.message}` });
    }

    // Mirror into ocr_feedback_event (best-effort, doesn't fail the request)
    try {
      const { recordAtomLabelEvent } = await import('../services/ocr/OcrKnowledgeService.js');
      await recordAtomLabelEvent(prisma, {
        platformId: file.platform_id,
        batchId,
        fileId,
        atomIdx,
        role: normRole,
        text: entry.text,
        decidedBy: entry.decidedBy,
      });
    } catch { /* best-effort */ }

    return { ok: true, label: entry, totalLabels: next.length };
  });

  fastify.delete('/ocr-pipeline/batches/:batchId/files/:fileId/labels/:atomIdx', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const atomIdx = Number(request.params.atomIdx);
    if (!Number.isFinite(atomIdx) || atomIdx < 0) {
      return reply.status(400).send({ error: 'atomIdx must be a non-negative integer' });
    }
    const file = await loadFileForLabels(batchId, fileId);
    if (!file) return reply.status(404).send({ error: 'File not found in batch' });
    const existing = Array.isArray(file.user_labels_json?.labels) ? file.user_labels_json.labels : [];
    const next = existing.filter(l => Number(l?.atomIdx) !== atomIdx);
    try {
      await prisma.$executeRaw`
        UPDATE ocr_batch_file
        SET user_labels_json = ${JSON.stringify({ labels: next })}::jsonb
        WHERE id = ${fileId}::uuid
      `;
    } catch (err) {
      return reply.status(500).send({ error: `Failed to clear label: ${err.message}` });
    }
    return { ok: true, totalLabels: next.length };
  });

  fastify.delete('/ocr-pipeline/batches/:batchId/files/:fileId/labels', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const file = await loadFileForLabels(batchId, fileId);
    if (!file) return reply.status(404).send({ error: 'File not found in batch' });
    try {
      await prisma.$executeRaw`
        UPDATE ocr_batch_file
        SET user_labels_json = '{"labels":[]}'::jsonb
        WHERE id = ${fileId}::uuid
      `;
    } catch (err) {
      return reply.status(500).send({ error: `Failed to clear labels: ${err.message}` });
    }
    return { ok: true, totalLabels: 0 };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // WORD GROUPING DIAGNOSTIC — Vision re-pass for OCR-miss bubbles (read-only)
  // Re-OCR selected bubble regions, merge rescued atoms into raw OCR in memory,
  // and re-run grouping diagnostic. No DB writes, no storage writes.
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.post('/ocr-pipeline/batches/:batchId/files/:fileId/grouping-diagnostic/repass', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const body = request.body || {};

    const arbitrationParam = String(body?.arbitration || request.query?.arbitration || 'none').toLowerCase();
    const arbitration = ['none', 'priority_lock', 'nms_best', 'cluster'].includes(arbitrationParam)
      ? arbitrationParam : 'none';
    const stoppersRaw = body?.stoppers ?? request.query?.stoppers ?? '';
    const horizontalStoppers = Array.isArray(stoppersRaw)
      ? stoppersRaw.map(s => String(s || '').trim()).filter(Boolean)
      : String(stoppersRaw || '').split(',').map(s => s.trim()).filter(Boolean);
    const stoppers = horizontalStoppers.filter(s => ['median_gap', 'symbol_region', 'number_break'].includes(s));
    const verticalRelaxed = body?.verticalRelaxed === true ||
      String(body?.vertical_relaxed || request.query?.vertical_relaxed || '') === '1';
    const bipartiteVerticalPairing = body?.bipartite === false
      ? false
      : !(String(body?.bipartite || request.query?.bipartite || '') === '0');
    const bipartiteIncludeRelaxed = body?.bipartiteIncludeRelaxed === true ||
      String(body?.bipartite_relaxed || request.query?.bipartite_relaxed || '') === '1';
    const scale = Number(body?.scale || 4);
    const rasterDensity = body?.rasterDensity != null ? Number(body.rasterDensity) : undefined;

    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.storage_key, bf.raw_output_key, bf.user_labels_json, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `.catch(() => []);
    if (!files[0]) return reply.status(404).send({ error: 'File not found in batch' });
    const file = files[0];
    if (!file.raw_output_key) {
      return reply.status(409).send({
        error: 'No raw OCR output for this file. Run Stage 1 first.',
      });
    }
    if (!file.storage_key) {
      return reply.status(409).send({
        error: 'No source storage key for this file. Cannot run re-OCR.',
      });
    }

    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    let rawData;
    try {
      const downloaded = await storageProvider.download(file.raw_output_key);
      const buffer = downloaded.buffer || downloaded;
      let text = buffer.toString('utf-8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      rawData = JSON.parse(text);
    } catch (err) {
      return reply.status(500).send({ error: `Failed to read raw OCR file: ${err.message}` });
    }

    const rawWords = Array.isArray(rawData?.words) ? rawData.words : [];
    const pageWidth = Number(rawData?.pageWidth || 2400);
    const pageHeight = Number(rawData?.pageHeight || 1700);
    const symbolRegions = Array.isArray(rawData?.symbolRegions)
      ? rawData.symbolRegions.map(r => r?.position_pct || r).filter(Boolean)
      : [];
    const userLabels = Array.isArray(file.user_labels_json?.labels) ? file.user_labels_json.labels : [];

    let baselineDiag;
    try {
      baselineDiag = runGroupingDiagnostic(rawWords, {
        pageWidth,
        pageHeight,
        groupingOverrides: { enableVerticalGrouping: true, enableRotationGrouping: true },
        horizontalStoppers: stoppers,
        arbitration,
        symbolRegions,
        verticalRelaxed,
        bipartiteVerticalPairing,
        bipartiteIncludeRelaxed,
        userLabels,
      });
    } catch (err) {
      return reply.status(500).send({ error: `Baseline diagnostic failed: ${err.message}` });
    }

    const requestedRegions = Array.isArray(body?.regions) ? body.regions : [];
    const regions = requestedRegions.length > 0
      ? requestedRegions
      : (baselineDiag?.ocrMissAudit?.suggestedRepassRegions || []);
    if (!regions.length) {
      return reply.status(400).send({ error: 'No suggested repass regions found for this file.' });
    }
    if (regions.length > 100) {
      return reply.status(400).send({ error: 'Too many regions requested (max 100 per call).' });
    }

    let visionCreds = body?.credentialsJson || null;
    if (!visionCreds) {
      const configs = await prisma.$queryRaw`
        SELECT vision_credentials_ref, credentials_ref
        FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${file.platform_id}::uuid AND is_active = true)
          OR (scope_type = 'global' AND is_active = true)
        ORDER BY
          CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END,
          CASE WHEN vision_credentials_ref IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN credentials_ref IS NOT NULL THEN 0 ELSE 1 END
      `.catch(() => []);
      for (const cfg of configs) {
        if (cfg.vision_credentials_ref) { visionCreds = cfg.vision_credentials_ref; break; }
        if (cfg.credentials_ref) { visionCreds = cfg.credentials_ref; break; }
      }
    }
    if (!visionCreds) {
      return reply.status(400).send({
        error: 'No Vision credentials available. Configure Vision API credentials first.',
      });
    }

    let sourceBuffer;
    try {
      const downloaded = await storageProvider.download(file.storage_key);
      sourceBuffer = downloaded.buffer || downloaded;
    } catch (err) {
      return reply.status(500).send({ error: `Failed to read source drawing: ${err.message}` });
    }

    const keyLower = String(file.storage_key || '').toLowerCase();
    const filenameLower = String(file.filename || '').toLowerCase();
    const isPdf = keyLower.endsWith('.pdf') || filenameLower.endsWith('.pdf');
    const contentType = isPdf ? 'application/pdf' : 'image/png';

    let repassResult;
    try {
      repassResult = await runOcrRepassForRegions({
        pdfBuffer: sourceBuffer,
        contentType,
        visionCreds,
        pageWidth,
        pageHeight,
        regions,
        scale,
        rasterDensity,
      });
    } catch (err) {
      return reply.status(500).send({ error: `Vision re-pass failed: ${err.message}` });
    }

    const merged = mergeRescuedAtoms(rawWords, repassResult.newAtoms || []);
    let mergedDiag;
    try {
      mergedDiag = runGroupingDiagnostic(merged.merged, {
        pageWidth,
        pageHeight,
        groupingOverrides: { enableVerticalGrouping: true, enableRotationGrouping: true },
        horizontalStoppers: stoppers,
        arbitration,
        symbolRegions,
        verticalRelaxed,
        bipartiteVerticalPairing,
        bipartiteIncludeRelaxed,
        userLabels,
      });
    } catch (err) {
      return reply.status(500).send({ error: `Merged diagnostic failed: ${err.message}` });
    }

    return {
      file: {
        id: file.id,
        filename: file.filename,
        platformId: file.platform_id,
        rawOutputKey: file.raw_output_key,
        sourceStorageKey: file.storage_key,
      },
      requested: {
        arbitration,
        horizontalStoppers: stoppers,
        verticalRelaxed,
        bipartiteVerticalPairing,
        bipartiteIncludeRelaxed,
        regionCount: regions.length,
        scale,
        rasterDensity: rasterDensity ?? null,
      },
      repass: {
        regionsProcessed: repassResult.regionsProcessed,
        regionsSucceeded: repassResult.regionsSucceeded,
        atomsRescued: repassResult.atomsRescued,
        mergedAddedCount: merged.addedCount,
        mergedSkippedDupCount: merged.skippedDupCount,
        perRegion: repassResult.perRegion,
      },
      baseline: {
        totalAtoms: baselineDiag?.stats?.totalRawWords ?? 0,
        coveragePct: baselineDiag?.stats?.coveragePct ?? 0,
        ungroupedAtoms: baselineDiag?.stats?.ungroupedAtoms ?? 0,
      },
      diagnostic: mergedDiag,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 2: AI CLASSIFY — Groups words, classifies tags, filters noise
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/batches/:batchId/run-stage2', async (request, reply) => {
    const { batchId } = request.params;
    const { phaseProfile = 'phase3_full_rescue' } = request.body || {};
    const phaseConfig = resolveStage2PhaseConfig(phaseProfile);

    // Verify batch exists and Stage 1 is complete
    const [batch] = await prisma.$queryRaw`
      SELECT id, platform_id, stage1_status, stage2_status, status, ai_model_used
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `.catch(() => []);

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });
    if (batch.stage1_status !== 'completed' && batch.stage1_status !== 'partial') {
      return reply.status(400).send({ error: `Stage 1 must be completed first (current: ${batch.stage1_status})` });
    }
    if (batch.stage2_status === 'processing') {
      return reply.status(400).send({ error: 'Stage 2 is already processing' });
    }

    // Resolve AI credentials
    let aiCreds;
    try {
      aiCreds = await resolveAiCredentials(prisma, batch.platform_id);
    } catch {
      return reply.status(400).send({ error: 'Claude API key not configured. Go to Admin → Storage Settings → AI & Vision tab.' });
    }
    if (!aiCreds?.apiKey) {
      return reply.status(400).send({ error: 'Claude API key not found. Configure it in Pipeline Settings.' });
    }

    // Get storage provider
    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    // Get platform info
    const [platform] = await prisma.$queryRaw`
      SELECT code, name FROM platform WHERE id = ${batch.platform_id}::uuid
    `.catch(() => []);

    // Get tag dictionary
    let tagDictionary = [];
    try { tagDictionary = await getDictionary(prisma, batch.platform_id); } catch { /* optional */ }
    let learnedPatterns = [];
    try { learnedPatterns = await getLearnedPatterns(prisma, batch.platform_id); } catch { /* optional */ }
    const zoneProfiles = await prisma.$queryRaw`
      SELECT zone_name, x_pct, y_pct, w_pct, h_pct, noise_mode
      FROM ocr_zone_profile
      WHERE platform_id = ${batch.platform_id}::uuid AND is_active = true
      ORDER BY zone_name
    `.catch(() => []);

    const requestedModel = batch.ai_model_used || aiCreds.model;
    const stage2Model = resolveStage2Model(requestedModel);

    // Mark Stage 2 as processing
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        status = 'processing',
        current_stage = 'classify',
        stage2_status = 'processing',
        completed_at = NULL,
        ai_model_used = ${stage2Model},
        stage2_phase_profile = ${phaseConfig.profile}
      WHERE id = ${batchId}::uuid
    `;

    // Process async (don't block response)
    runStage2AiAsync(prisma, batchId, storage, {
      apiKey: aiCreds.apiKey,
      model: stage2Model,
      platformCode: platform?.code || '',
      platformName: platform?.name || '',
      tagDictionary,
      learnedPatterns,
      zoneProfiles,
      phaseProfile: phaseConfig.profile,
      includeGroupedCandidatesInPrompt: phaseConfig.includeGroupedCandidatesInPrompt,
      enableDeterministicPromotion: phaseConfig.enableDeterministicPromotion,
      enableCoverageRescue: phaseConfig.enableCoverageRescue,
    }).catch(err => {
      console.error(`[Stage2 AI] Batch ${batchId} error:`, err);
    });

    return reply.status(202).send({
      success: true,
      phaseProfile: phaseConfig.profile,
      message: `Stage 2 (AI Classify) started using ${stage2Model} in ${phaseConfig.profile}. Processing ${batch.stage1_status === 'completed' ? 'all' : 'successful'} files...`,
    });
  });

  // Stage 2 deterministic-only runner (no AI call).
  // Useful to compare grouping progress against AI classify output on same batch.
  fastify.post('/ocr-pipeline/batches/:batchId/run-stage2-grouping-only', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, platform_id, stage1_status
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `.catch(() => []);

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });
    if (batch.stage1_status !== 'completed' && batch.stage1_status !== 'partial') {
      return reply.status(400).send({ error: `Stage 1 must be completed first (current: ${batch.stage1_status})` });
    }

    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    let tagDictionary = [];
    try { tagDictionary = await getDictionary(prisma, batch.platform_id); } catch { /* optional */ }

    const files = await prisma.$queryRaw`
      SELECT id, filename, drawing_number, raw_output_key, cleaned_output_key
      FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid AND raw_output_key IS NOT NULL
      ORDER BY created_at
    `;

    if (!files.length) {
      return reply.status(400).send({ error: 'No Stage 1 raw outputs found for this batch' });
    }

    const startedAt = Date.now();
    const totals = {
      filesProcessed: 0,
      filesFailed: 0,
      totalWords: 0,
      totalGroups: 0,
      totalMultiWordGroups: 0,
      totalSingleWordGroups: 0,
      structuredCandidates: 0,
      unknownOrNoiseCandidates: 0,
    };
    const hybridAi = {
      filesWithCleaned: 0,
      totalTags: 0,
      totalNoise: 0,
      totalUncertain: 0,
    };
    const perFile = [];

    for (const file of files) {
      try {
        const downloaded = await storage.download(file.raw_output_key);
        const buffer = downloaded.buffer || downloaded;
        const rawData = JSON.parse(buffer.toString('utf-8').replace(/^\uFEFF/, ''));
        const words = rawData.words || rawData.data?.words || [];
        const pageWidth = rawData.pageWidth || words?.[0]?.pageWidth || 2400;
        const pageHeight = rawData.pageHeight || words?.[0]?.pageHeight || 1700;

        const grouped = runStage2_Group(words, {
          pageWidth,
          pageHeight,
          enableVerticalGrouping: true,
          enableRotationGrouping: true,
        });

        const classified = classifyAll(
          (grouped.groups || []).map((g) => ({ text: g.text })),
          { dictionary: tagDictionary }
        );
        const structuredCount = classified.filter((c) => (
          ['equipment', 'instrument', 'line', 'drawing_ref'].includes(String(c?.type || '').toLowerCase())
        )).length;
        const unknownOrNoise = Math.max(0, (classified.length || 0) - structuredCount);

        const groupedOutputKey = `ocr-stages/${batchId}/grouped/${file.filename.replace(/\.[^.]+$/, '')}_grouped_only.json`;
        await storage.upload(
          Buffer.from(JSON.stringify(grouped, null, 2), 'utf-8'),
          groupedOutputKey,
          {
            contentType: 'application/json',
            metadata: { batchId, stage: 'grouped_only', sourceFile: file.raw_output_key },
          }
        );

        await prisma.$queryRaw`
          UPDATE ocr_batch_file SET
            grouped_output_key = ${groupedOutputKey}
          WHERE id = ${file.id}::uuid
        `;

        const fileMetrics = {
          fileId: file.id,
          filename: file.filename,
          words: grouped.stats?.totalWords || words.length || 0,
          groups: grouped.stats?.totalGroups || 0,
          multiWordGroups: grouped.stats?.multiWordGroups || 0,
          singleWordGroups: grouped.stats?.singleWordGroups || 0,
          structuredCandidates: structuredCount,
          unknownOrNoiseCandidates: unknownOrNoise,
          failed: false,
        };
        perFile.push(fileMetrics);

        totals.filesProcessed += 1;
        totals.totalWords += fileMetrics.words;
        totals.totalGroups += fileMetrics.groups;
        totals.totalMultiWordGroups += fileMetrics.multiWordGroups;
        totals.totalSingleWordGroups += fileMetrics.singleWordGroups;
        totals.structuredCandidates += structuredCount;
        totals.unknownOrNoiseCandidates += unknownOrNoise;

        if (file.cleaned_output_key) {
          try {
            const cleanedDownloaded = await storage.download(file.cleaned_output_key);
            const cleanedBuffer = cleanedDownloaded.buffer || cleanedDownloaded;
            const cleaned = JSON.parse(cleanedBuffer.toString('utf-8').replace(/^\uFEFF/, ''));
            hybridAi.filesWithCleaned += 1;
            hybridAi.totalTags += Array.isArray(cleaned.tags) ? cleaned.tags.length : 0;
            hybridAi.totalNoise += Array.isArray(cleaned.noise) ? cleaned.noise.length : 0;
            hybridAi.totalUncertain += Array.isArray(cleaned.uncertain) ? cleaned.uncertain.length : 0;
          } catch {
            // Ignore cleaned parse/download failures in compare snapshot.
          }
        }
      } catch (err) {
        totals.filesFailed += 1;
        perFile.push({
          fileId: file.id,
          filename: file.filename,
          failed: true,
          error: err.message,
        });
      }
    }

    const avgWordsPerGroup = totals.totalGroups > 0
      ? Number((totals.totalWords / totals.totalGroups).toFixed(2))
      : 0;

    return reply.status(200).send({
      success: true,
      mode: 'grouping_only',
      batchId,
      elapsedMs: Date.now() - startedAt,
      totals: {
        ...totals,
        avgWordsPerGroup,
      },
      hybridAi,
      perFile,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 2 PROGRESS — Live polling endpoint for frontend
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/batches/:batchId/stage2-progress', async (request, reply) => {
    const { batchId } = request.params;
    const progress = stage2Progress.get(batchId);

    if (!progress) {
      // No in-memory progress — check DB for status
      const [batch] = await prisma.$queryRaw`
        SELECT stage2_status FROM ocr_batch WHERE id = ${batchId}::uuid
      `.catch(() => []);
      return reply.send({
        status: batch?.stage2_status || 'pending',
        files: {},
        message: batch?.stage2_status === 'completed' ? 'Stage 2 completed' : null,
      });
    }

    // Calculate overall stats
    const fileEntries = Object.values(progress.files);
    const completed = fileEntries.filter(f => f.status === 'completed').length;
    const failed = fileEntries.filter(f => f.status === 'failed').length;
    const processing = fileEntries.filter(f => f.status === 'processing').length;
    const totalTags = fileEntries.reduce((s, f) => s + (f.tags || 0), 0);
    const totalContinuationRefs = fileEntries.reduce((s, f) => s + (f.continuationReferences || 0), 0);
    const totalAutoApprove = fileEntries.reduce((s, f) => s + (f.autoApproveCount || 0), 0);
    const totalHumanReview = fileEntries.reduce((s, f) => s + (f.humanReviewCount || 0), 0);
    const totalAutoReject = fileEntries.reduce((s, f) => s + (f.autoRejectCount || 0), 0);
    const totalDeterministicRecovered = fileEntries.reduce((s, f) => s + (f.deterministicRecoveredCount || 0), 0);
    const totalCoverageRescued = fileEntries.reduce((s, f) => s + (f.coverageRescuedCount || 0), 0);

    return reply.send({
      status: progress.status,
      phaseProfile: progress.phaseProfile || null,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
      totalFiles: fileEntries.length,
      completedFiles: completed,
      failedFiles: failed,
      processingFiles: processing,
      totalTags,
      totalContinuationRefs,
      totalDeterministicRecovered,
      totalCoverageRescued,
      automation: {
        autoApprove: totalAutoApprove,
        humanReview: totalHumanReview,
        autoReject: totalAutoReject,
      },
      elapsed: Date.now() - progress.startedAt,
      files: progress.files,
    });
  });

  // Candidate ledger (Stage 2 coverage accounting)
  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/candidate-ledger', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const {
      outcome = null,
      reason = null,
      limit: limitRaw = 100,
      offset: offsetRaw = 0,
    } = request.query || {};

    const limit = Math.max(1, Math.min(500, Number(limitRaw) || 100));
    const offset = Math.max(0, Number(offsetRaw) || 0);

    const [file] = await prisma.$queryRaw`
      SELECT bf.id, bf.ocr_job_id, bf.pnid_id
      FROM ocr_batch_file bf
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
      LIMIT 1
    `.catch(() => []);

    if (!file) return reply.status(404).send({ error: 'File not found in batch' });
    if (!file.ocr_job_id || !file.pnid_id) {
      return reply.send({ items: [], total: 0, limit, offset });
    }

    const items = await prisma.$queryRaw`
      SELECT
        id,
        ocr_job_id,
        pnid_id,
        extraction_stage,
        candidate_text_raw,
        candidate_text_norm,
        candidate_type,
        source,
        source_stage,
        assembly_rule,
        assembly_score,
        word_indices,
        bbox,
        confidence_det,
        confidence_ai,
        confidence_final,
        terminal_outcome,
        reason_code,
        reason_detail,
        superseded_by_candidate_id,
        created_at
      FROM ocr_candidate_ledger
      WHERE ocr_job_id = ${file.ocr_job_id}::uuid
        AND pnid_id = ${file.pnid_id}::uuid
        AND (${outcome}::text IS NULL OR terminal_outcome = ${outcome})
        AND (${reason}::text IS NULL OR reason_code = ${reason})
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `.catch((err) => {
      fastify.log.warn(`candidate-ledger query failed: ${err.message}`);
      return [];
    });

    const [countRow] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM ocr_candidate_ledger
      WHERE ocr_job_id = ${file.ocr_job_id}::uuid
        AND pnid_id = ${file.pnid_id}::uuid
        AND (${outcome}::text IS NULL OR terminal_outcome = ${outcome})
        AND (${reason}::text IS NULL OR reason_code = ${reason})
    `.catch(() => [{ total: 0 }]);

    return reply.send({
      items,
      total: Number(countRow?.total || 0),
      limit,
      offset,
    });
  });

  // STAGE 2: MULTI-BATCH AI CLASSIFY — Process multiple batches/files together
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/run-stage2-multi', async (request, reply) => {
    const { selections, phaseProfile = 'phase3_full_rescue' } = request.body || {};
    const phaseConfig = resolveStage2PhaseConfig(phaseProfile);
    // selections: [{ batchId, fileIds? }] — fileIds optional, defaults to all files in batch

    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return reply.status(400).send({ error: 'selections required: [{ batchId, fileIds? }]' });
    }

    const batchIds = selections.map(s => s.batchId);

    // Verify all batches exist and Stage 1 is complete
    const batches = await prisma.$queryRaw`
      SELECT id, platform_id, stage1_status, stage2_status, ai_model_used
      FROM ocr_batch WHERE id = ANY(${batchIds}::uuid[])
    `;

    if (batches.length !== batchIds.length) {
      const found = new Set(batches.map(b => b.id));
      const missing = batchIds.filter(id => !found.has(id));
      return reply.status(404).send({ error: `Batches not found: ${missing.join(', ')}` });
    }

    const notReady = batches.filter(b => b.stage1_status !== 'completed' && b.stage1_status !== 'partial');
    if (notReady.length > 0) {
      return reply.status(400).send({ error: `Stage 1 not complete for: ${notReady.map(b => b.id.slice(0, 8)).join(', ')}` });
    }

    const alreadyProcessing = batches.filter(b => b.stage2_status === 'processing');
    if (alreadyProcessing.length > 0) {
      return reply.status(400).send({ error: `Stage 2 already processing for: ${alreadyProcessing.map(b => b.id.slice(0, 8)).join(', ')}` });
    }

    // All batches must belong to same platform (for shared AI credentials + tag dictionary)
    const platformIds = [...new Set(batches.map(b => b.platform_id))];
    if (platformIds.length > 1) {
      return reply.status(400).send({ error: 'All batches must belong to the same platform for multi-batch processing' });
    }
    const platformId = platformIds[0];

    // Resolve AI credentials
    let aiCreds;
    try {
      aiCreds = await resolveAiCredentials(prisma, platformId);
    } catch {
      return reply.status(400).send({ error: 'Claude API key not configured. Go to Admin → Storage Settings → AI & Vision tab.' });
    }
    if (!aiCreds?.apiKey) {
      return reply.status(400).send({ error: 'Claude API key not found. Configure it in Pipeline Settings.' });
    }

    // Get storage provider
    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    // Get platform info + tag dictionary
    const [platform] = await prisma.$queryRaw`
      SELECT code, name FROM platform WHERE id = ${platformId}::uuid
    `.catch(() => []);

    let tagDictionary = [];
    try { tagDictionary = await getDictionary(prisma, platformId); } catch { /* optional */ }
    let learnedPatterns = [];
    try { learnedPatterns = await getLearnedPatterns(prisma, platformId); } catch { /* optional */ }
    const zoneProfiles = await prisma.$queryRaw`
      SELECT zone_name, x_pct, y_pct, w_pct, h_pct, noise_mode
      FROM ocr_zone_profile
      WHERE platform_id = ${platformId}::uuid AND is_active = true
      ORDER BY zone_name
    `.catch(() => []);

    // Build file selection map: { batchId -> Set(fileIds) or null (= all files) }
    const selectionMap = {};
    for (const sel of selections) {
      selectionMap[sel.batchId] = sel.fileIds && sel.fileIds.length > 0
        ? new Set(sel.fileIds) : null; // null = all files
    }

    const requestedModel = batches[0].ai_model_used || aiCreds.model;
    const model = resolveStage2Model(requestedModel);

    // Mark all batches as Stage 2 processing
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        status = 'processing',
        current_stage = 'classify',
        stage2_status = 'processing',
        completed_at = NULL,
        ai_model_used = ${model},
        stage2_phase_profile = ${phaseConfig.profile}
      WHERE id = ANY(${batchIds}::uuid[])
    `;

    // Count total selected files
    let totalFiles = 0;
    const batchFileCounts = {};

    for (const batch of batches) {
      const files = await prisma.$queryRaw`
        SELECT id FROM ocr_batch_file
        WHERE batch_id = ${batch.id}::uuid AND raw_output_key IS NOT NULL
      `;
      const selectedFiles = selectionMap[batch.id]
        ? files.filter(f => selectionMap[batch.id].has(f.id))
        : files;
      batchFileCounts[batch.id] = selectedFiles.length;
      totalFiles += selectedFiles.length;
    }

    // Process async
    runStage2MultiAsync(prisma, batches, selectionMap, storage, {
      apiKey: aiCreds.apiKey,
      model,
      platformCode: platform?.code || '',
      platformName: platform?.name || '',
      tagDictionary,
      learnedPatterns,
      zoneProfiles,
      phaseProfile: phaseConfig.profile,
      includeGroupedCandidatesInPrompt: phaseConfig.includeGroupedCandidatesInPrompt,
      enableDeterministicPromotion: phaseConfig.enableDeterministicPromotion,
      enableCoverageRescue: phaseConfig.enableCoverageRescue,
    }).catch(err => {
      console.error(`[Stage2 Multi] Error:`, err);
    });

    return reply.status(202).send({
      success: true,
      phaseProfile: phaseConfig.profile,
      message: `Stage 2 (AI Classify) started for ${batches.length} batches, ${totalFiles} files using ${model} in ${phaseConfig.profile}`,
      batches: batches.map(b => ({ batchId: b.id, fileCount: batchFileCounts[b.id] })),
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD STAGE FILE — Returns JSON as downloadable file
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/stage/:stage/download', async (request, reply) => {
    const { batchId, fileId, stage } = request.params;

    if (!['raw', 'grouped', 'cleaned', 'review'].includes(stage)) {
      return reply.status(400).send({ error: 'Stage must be: raw, grouped, cleaned, or review' });
    }

    const columnMap = { raw: 'raw_output_key', grouped: 'grouped_output_key', cleaned: 'cleaned_output_key', review: 'review_output_key' };
    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.raw_output_key, bf.grouped_output_key, bf.cleaned_output_key,
             bf.review_output_key, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `;

    if (!files[0]) return reply.status(404).send({ error: 'File not found in batch' });

    const file = files[0];
    const outputKey = file[columnMap[stage]];

    if (!outputKey) {
      return reply.status(404).send({ error: `No ${stage} output available for this file.` });
    }

    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    try {
      const downloaded = await storageProvider.download(outputKey);
      const buffer = downloaded.buffer || downloaded;
      const downloadFilename = `${file.filename.replace(/\.[^.]+$/, '')}_${stage}.json`;

      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${downloadFilename}"`);
      return reply.send(buffer);
    } catch (err) {
      return reply.status(500).send({ error: `Failed to download: ${err.message}` });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STAGE 3: HUMAN REVIEW — Save per-file review decisions
  // ═══════════════════════════════════════════════════════════════════════════

  // Save review decisions for a single file
  fastify.post('/ocr-pipeline/batches/:batchId/files/:fileId/save-review', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const { decisions } = request.body || {};
    // decisions: array of {
    //   index, tagText, originalType, action: 'approve'|'reject'|'edit',
    //   correctedText?, correctedType?, notes?, source?: 'tag'|'uncertain'|'noise'
    // }

    if (!decisions || !Array.isArray(decisions)) {
      return reply.status(400).send({ error: 'decisions array required' });
    }

    // Get file + batch
    const [file] = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.cleaned_output_key, bf.batch_id, b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `.catch(() => []);

    if (!file) return reply.status(404).send({ error: 'File not found in batch' });
    if (!file.cleaned_output_key) {
      return reply.status(400).send({ error: 'Stage 2 (AI Classify) must complete before review. No classified output found.' });
    }

    // Load the classified data from storage
    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    let classifiedData;
    try {
      const downloaded = await storageProvider.download(file.cleaned_output_key);
      const buffer = downloaded.buffer || downloaded;
      classifiedData = JSON.parse(buffer.toString('utf-8'));
    } catch (err) {
      return reply.status(500).send({ error: `Failed to read classified data: ${err.message}` });
    }

    // Build review result: apply decisions to classified tags/noise
    const allTags = classifiedData.tags || [];
    const allUncertain = classifiedData.uncertain || [];
    const allNoise = classifiedData.noise || [];
    const requiredReviewItems = [...allTags, ...allUncertain];
    const combinedTags = [...requiredReviewItems, ...allNoise];
    const requiredCount = requiredReviewItems.length;

    const approved = [];
    const rejected = [];
    const edited = [];
    let approvedCount = 0, rejectedCount = 0, editedCount = 0;
    let reviewedRequiredCount = 0; // explicit decisions on required set
    let implicitRequiredCount = 0; // default decisions on required set
    let reviewedNoiseCount = 0; // explicit decisions on optional noise
    let implicitNoiseCount = 0; // default decisions on optional noise

    for (const dec of decisions) {
      const tag = combinedTags[dec.index] || { text: dec.tagText, type: dec.originalType };

      if (dec.action === 'approve') {
        approved.push({
          ...tag,
          reviewAction: 'approved',
          reviewNotes: dec.notes || null,
          reviewDecisionSource: dec.decisionSource || 'unknown',
        });
        approvedCount++;
      } else if (dec.action === 'reject') {
        rejected.push({
          ...tag,
          reviewAction: 'rejected',
          reviewNotes: dec.notes || null,
          reviewDecisionSource: dec.decisionSource || 'unknown',
        });
        rejectedCount++;
      } else if (dec.action === 'edit') {
        const correctedPositionPct = dec.correctedPositionPct || null;
        const correctedBoundingBox = dec.correctedBoundingBox || null;
        edited.push({
          ...tag,
          text: dec.correctedText || tag.text,
          type: dec.correctedType || tag.type,
          subType: dec.correctedSubType || tag.subType,
          position_pct: correctedPositionPct || tag.position_pct || tag.positionPct || null,
          boundingBox: correctedBoundingBox || tag.boundingBox || null,
          reviewAction: 'edited',
          originalText: tag.text,
          originalType: tag.type,
          reviewNotes: dec.notes || null,
          reviewDecisionSource: dec.decisionSource || 'unknown',
        });
        editedCount++;
      }

      // Counts: any approve/reject/edit on a required item satisfies the gate,
      // regardless of how the decision was made. Auto-above-threshold decisions
      // count too — when the user clicked Save Review they confirmed them.
      const isExplicit = String(dec.decisionSource || 'explicit') === 'explicit';
      const isDecided = ['approve', 'reject', 'edit'].includes(String(dec.action));
      const isRequired = dec.index < requiredCount;
      if (isRequired) {
        if (isDecided) reviewedRequiredCount++;
        if (!isExplicit) implicitRequiredCount++;
      } else {
        if (isExplicit) reviewedNoiseCount++;
        else implicitNoiseCount++;
      }
    }

    const reviewResult = {
      approved,
      rejected,
      edited,
      // Keep original classified data reference
      sourceFile: file.cleaned_output_key,
      stats: {
        totalReviewed: decisions.length,
        totalTags: requiredCount,
        optionalNoiseItems: allNoise.length,
        reviewedNoiseItems: reviewedNoiseCount,
        implicitNoiseItems: implicitNoiseCount,
        explicitRequiredReviewed: reviewedRequiredCount,
        implicitRequiredDefaults: implicitRequiredCount,
        approved: approvedCount,
        rejected: rejectedCount,
        edited: editedCount,
        pending: Math.max(0, requiredCount - reviewedRequiredCount),
      },
      reviewedAt: new Date().toISOString(),
    };

    // Upload review result to storage
    const reviewKey = file.cleaned_output_key.replace('_classified.json', '_reviewed.json')
      .replace('/classified/', '/reviewed/');
    try {
      await storageProvider.upload(Buffer.from(JSON.stringify(reviewResult, null, 2)), reviewKey, {
        contentType: 'application/json',
        metadata: { batchId, stage: 'review' },
      });
    } catch (err) {
      return reply.status(500).send({ error: `Failed to save review: ${err.message}` });
    }

    // Determine review status from required review set (tags + uncertain), not optional noise.
    const isComplete = reviewedRequiredCount >= requiredCount;
    const reviewStatus = isComplete ? 'completed' : 'partial';

    // Update file record
    await prisma.$executeRaw`
      UPDATE ocr_batch_file
      SET review_output_key = ${reviewKey},
          review_status = ${reviewStatus},
          reviewed_at = NOW(),
          review_stats = ${JSON.stringify(reviewResult.stats)}::jsonb
      WHERE id = ${fileId}::uuid
    `;

    // Update batch-level stage3 status
    await updateBatchStage3Status(prisma, batchId);

    // Persist review feedback and refresh learned patterns (best effort).
    let knowledge = { feedbackEventsInserted: 0, patternsPromoted: 0 };
    try {
      const feedbackRes = await recordReviewFeedbackEvents(prisma, {
        platformId: file.platform_id,
        batchId,
        fileId,
        decisions,
        includeImplicit: false,
      });
      const promotedRes = await promoteLearnedPatternsFromFeedback(prisma, file.platform_id, 3);
      knowledge = {
        feedbackEventsInserted: feedbackRes?.inserted || 0,
        patternsPromoted: promotedRes?.promoted || 0,
      };
    } catch (knowledgeErr) {
      fastify.log.warn(`OCR feedback learning update failed: ${knowledgeErr.message}`);
    }

    return {
      success: true,
      reviewKey,
      status: reviewStatus,
      stats: reviewResult.stats,
      knowledge,
    };
  });

  // Get review summary for all files in a batch
  fastify.get('/ocr-pipeline/batches/:batchId/review-summary', async (request, reply) => {
    const { batchId } = request.params;

    const files = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.drawing_number,
             bf.cleaned_output_key, bf.review_output_key,
             bf.review_status, bf.reviewed_at, bf.review_stats,
             bf.tags_found
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
      ORDER BY bf.drawing_number, bf.filename
    `;

    const summary = {
      totalFiles: files.length,
      reviewedFiles: files.filter(f => f.review_status === 'completed').length,
      partialFiles: files.filter(f => f.review_status === 'partial').length,
      pendingFiles: files.filter(f => !f.review_status || f.review_status === 'pending').length,
      files: files.map(f => ({
        id: f.id,
        filename: f.filename,
        drawingNumber: f.drawing_number,
        hasClassified: !!f.cleaned_output_key,
        hasReview: !!f.review_output_key,
        reviewStatus: f.review_status || 'pending',
        reviewedAt: f.reviewed_at,
        reviewStats: f.review_stats,
        tagsFound: f.tags_found,
      })),
    };

    return summary;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: EXPORT RESULTS — Generate JSON/XML/CSV
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/batches/:batchId/export', async (request, reply) => {
    const { batchId } = request.params;
    const { format = 'json' } = request.body || {};

    if (!['json', 'xml', 'csv'].includes(format)) {
      return reply.status(400).send({ error: 'format must be json, xml, or csv' });
    }

    try {
      const { content, filename, contentType } = await exportBatchResults(prisma, batchId, format);

      // Store result file in storage if possible
      const [batch] = await prisma.$queryRaw`
        SELECT platform_id FROM ocr_batch WHERE id = ${batchId}::uuid
      `;

      if (batch) {
        try {
          const storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
          const platform = await prisma.platform.findUnique({
            where: { id: batch.platform_id },
            select: { code: true },
          });
          const resultKey = `${platform.code}/ocr_results/${filename}`;
          await storage.upload(content, resultKey, { contentType });

          await prisma.$queryRaw`
            UPDATE ocr_batch SET
              result_format = ${format},
              result_storage_key = ${resultKey},
              exported_at = NOW()
            WHERE id = ${batchId}::uuid
          `;
        } catch (_) {
          // Storage save failed — still return the content directly
        }
      }

      // Update batch with export info
      await prisma.$queryRaw`
        UPDATE ocr_batch SET
          result_format = ${format},
          exported_at = NOW()
        WHERE id = ${batchId}::uuid
      `;

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(content);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `Export failed: ${err.message}` });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: PASS TO ANNOTATION MODULE
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/batches/:batchId/pass-to-annotation', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, status, passed_to_annotation, ai_cleanup_status, stage2_status, stage3_status
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `;

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Derive readiness from actual per-file artefacts so a stale batch flag
    // (e.g. after a partial re-run that didn't roll the batch_status forward)
    // doesn't block shipping when the files clearly do have output.
    const fileRollup = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN cleaned_output_key IS NOT NULL THEN 1 END)::int AS with_classified,
        COUNT(CASE WHEN review_output_key  IS NOT NULL THEN 1 END)::int AS with_review,
        COUNT(CASE WHEN review_status = 'completed' THEN 1 END)::int    AS reviewed_completed,
        COUNT(CASE WHEN review_status = 'partial'   THEN 1 END)::int    AS reviewed_partial
      FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid
    `;
    const f = fileRollup[0] || { total: 0, with_classified: 0, with_review: 0, reviewed_completed: 0, reviewed_partial: 0 };

    const stage2Ready = f.with_classified > 0
      || ['completed', 'partial'].includes(String(batch.stage2_status));
    const stage3Ready = f.with_review > 0
      || f.reviewed_completed > 0
      || f.reviewed_partial > 0
      || ['completed', 'partial'].includes(String(batch.stage3_status));
    const legacyCleanupReady = batch.ai_cleanup_status === 'completed';

    if (!stage2Ready) {
      return reply.status(400).send({
        error: 'Stage 2 (AI Classify) must run before passing to annotation. Run Stage 2 first.',
      });
    }
    if (!stage3Ready && !legacyCleanupReady) {
      return reply.status(400).send({
        error: 'Save at least one file in Stage 3 (Review) before passing to annotation. ' +
          'Open Review for any file and click Save Review to produce review output.',
      });
    }

    // Mark as passed
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        passed_to_annotation = true,
        annotation_passed_at = NOW()
      WHERE id = ${batchId}::uuid
    `;

    // Get all P&IDs in this batch that have been processed
    const batchFiles = await prisma.$queryRaw`
      SELECT bf.pnid_id FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
        AND bf.pnid_id IS NOT NULL
        AND bf.status = 'completed'
    `;

    // ── Copy bbox from ocr_extraction to junction tables for each P&ID ──
    let totalLinked = 0;
    for (const file of batchFiles) {
      const pnidId = file.pnid_id;

      // Get matched extractions with valid bounding boxes
      const extractions = await prisma.$queryRaw`
        SELECT id, extracted_text, tag_type, matched_entity_id,
               bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        FROM ocr_extraction
        WHERE pnid_id = ${pnidId}::uuid
          AND matched_entity_id IS NOT NULL
          AND status IN ('pending', 'approved', 'ai_reviewed')
          AND bbox_x_pct IS NOT NULL AND bbox_x_pct > 0.5
      `;

      for (const ext of extractions) {
        try {
          if (ext.tag_type === 'equipment') {
            await prisma.$queryRaw`
              INSERT INTO pnid_equipment (pnid_id, equipment_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct, position_verified)
              VALUES (${pnidId}::uuid, ${ext.matched_entity_id}::uuid, ${ext.bbox_x_pct}, ${ext.bbox_y_pct}, ${ext.bbox_w_pct}, ${ext.bbox_h_pct}, true)
              ON CONFLICT (pnid_id, equipment_id) DO UPDATE SET
                annotation_x_pct = EXCLUDED.annotation_x_pct,
                annotation_y_pct = EXCLUDED.annotation_y_pct,
                annotation_w_pct = EXCLUDED.annotation_w_pct,
                annotation_h_pct = EXCLUDED.annotation_h_pct,
                position_verified = true
            `;
          } else if (ext.tag_type === 'instrument') {
            await prisma.$queryRaw`
              INSERT INTO pnid_instrument (pnid_id, instrument_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct, position_verified)
              VALUES (${pnidId}::uuid, ${ext.matched_entity_id}::uuid, ${ext.bbox_x_pct}, ${ext.bbox_y_pct}, ${ext.bbox_w_pct}, ${ext.bbox_h_pct}, true)
              ON CONFLICT (pnid_id, instrument_id) DO UPDATE SET
                annotation_x_pct = EXCLUDED.annotation_x_pct,
                annotation_y_pct = EXCLUDED.annotation_y_pct,
                annotation_w_pct = EXCLUDED.annotation_w_pct,
                annotation_h_pct = EXCLUDED.annotation_h_pct,
                position_verified = true
            `;
          } else if (ext.tag_type === 'line') {
            await prisma.$queryRaw`
              INSERT INTO pnid_line (pnid_id, line_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct)
              VALUES (${pnidId}::uuid, ${ext.matched_entity_id}::uuid, ${ext.bbox_x_pct}, ${ext.bbox_y_pct}, ${ext.bbox_w_pct || null}, ${ext.bbox_h_pct || null})
              ON CONFLICT (pnid_id, line_id) DO UPDATE SET
                annotation_x_pct = EXCLUDED.annotation_x_pct,
                annotation_y_pct = EXCLUDED.annotation_y_pct,
                annotation_w_pct = EXCLUDED.annotation_w_pct,
                annotation_h_pct = EXCLUDED.annotation_h_pct
            `;
          }
          totalLinked++;
        } catch (err) {
          // Log but continue — one failure shouldn't block others
          console.error(`Pass-to-annotation: failed to link ${ext.extracted_text}:`, err.message);
        }
      }
    }

    return {
      success: true,
      message: `Batch passed to annotation module. ${batchFiles.length} P&IDs ready for annotation. ${totalLinked} entity positions linked to junction tables.`,
      pnidIds: batchFiles.map(f => f.pnid_id),
      linkedEntities: totalLinked,
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADD MORE FILES TO EXISTING BATCH
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post('/ocr-pipeline/batches/:batchId/add-files', async (request, reply) => {
    const { batchId } = request.params;
    const { storageKeys } = request.body;

    if (!storageKeys?.length) {
      return reply.status(400).send({ error: 'storageKeys array is required' });
    }

    const [batch] = await prisma.$queryRaw`
      SELECT id, platform_id, status
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `;

    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Add new files
    let addedCount = 0;
    for (const key of storageKeys) {
      // Check if already in batch
      const [existing] = await prisma.$queryRaw`
        SELECT id FROM ocr_batch_file WHERE batch_id = ${batchId}::uuid AND storage_key = ${key}
      `.catch(() => [null]);

      if (existing) continue;

      const filename = key.split('/').pop();
      const parsed = parsePnidFilename(filename);

      await prisma.$queryRaw`
        INSERT INTO ocr_batch_file (
          batch_id, storage_key, filename, drawing_number, revision, status
        ) VALUES (
          ${batchId}::uuid, ${key}, ${filename},
          ${parsed.drawingNumber}, ${parsed.revision}, 'pending'
        )
      `;
      addedCount++;
    }

    // Update batch totals
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        total_files = total_files + ${addedCount},
        status = 'processing'
      WHERE id = ${batchId}::uuid
    `;

    // Process new files — resolve OCR provider options
    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
    } catch (_) {
      storage = { download: () => { throw new Error('No storage configured'); }, config: {} };
    }

    const ocrOptions = await resolveOcrOptions(prisma, batch.platform_id);
    processBatchAsync(prisma, batchId, batch.platform_id, storage, ocrOptions).catch(err => {
      console.error(`Batch ${batchId} add-files processing error:`, err);
    });

    return {
      success: true,
      added: addedCount,
      message: `${addedCount} new files added. Processing started.`,
    };
  });

  // ═══ VISION API CREDENTIALS ════════════════════════════════════════════════

  // GET vision config status for a platform
  fastify.get('/ocr-pipeline/platforms/:platformId/vision-config', async (request, reply) => {
    const { platformId } = request.params;

    try {
      const configs = await prisma.$queryRaw`
        SELECT vision_credentials_ref, credentials_ref
        FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;
      const config = configs[0];

      if (!config) {
        // Try global config
        const globalConfigs = await prisma.$queryRaw`
          SELECT vision_credentials_ref, credentials_ref
          FROM storage_config
          WHERE scope_type = 'global' AND is_active = true
        `;
        const globalConfig = globalConfigs[0];

        return {
          hasVisionCredentials: !!(globalConfig?.vision_credentials_ref || globalConfig?.credentials_ref),
          usesSeparateCredentials: !!globalConfig?.vision_credentials_ref,
          source: globalConfig ? 'global' : 'none',
        };
      }

      return {
        hasVisionCredentials: !!(config.vision_credentials_ref || config.credentials_ref),
        usesSeparateCredentials: !!config.vision_credentials_ref,
        source: 'platform',
      };
    } catch (err) {
      // Any DB error (missing column, missing table, type mismatch) — return safe default
      fastify.log.warn('vision-config GET failed (schema may need migration):', err.message);
      return { hasVisionCredentials: false, usesSeparateCredentials: false, source: 'none', migrationNeeded: true };
    }
  });

  // PUT — save vision credentials for a platform
  fastify.put('/ocr-pipeline/platforms/:platformId/vision-config', async (request, reply) => {
    const { platformId } = request.params;
    const { visionCredentialsJson } = request.body || {};

    // Validate JSON if provided
    if (visionCredentialsJson) {
      try {
        const parsed = JSON.parse(visionCredentialsJson);
        if (!parsed.project_id || !parsed.private_key) {
          return reply.code(400).send({ error: 'Invalid service account JSON — missing project_id or private_key' });
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON format' });
      }
    }

    try {
      // Update vision credentials — prefer platform config, fall back to global
      // NEVER create a ghost platform row with provider='local' — it shadows the real GCS config
      const existing = await prisma.$queryRaw`
        SELECT id, scope_type FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
           OR (scope_type = 'global' AND is_active = true)
        ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
        LIMIT 1
      `;

      if (!existing[0]) {
        return reply.code(400).send({ error: 'No storage configuration found. Configure storage in Admin first.' });
      }

      await prisma.$queryRaw`
        UPDATE storage_config
        SET vision_credentials_ref = ${visionCredentialsJson || null},
            updated_at = NOW()
        WHERE id = ${existing[0].id}::uuid
      `;

      return { success: true, usesSeparateCredentials: !!visionCredentialsJson };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Failed to save vision config: ${err.message}` });
    }
  });

  // ═══ CANCEL / STOP BATCH — Mark batch and pending files as cancelled ═══════

  fastify.post('/ocr-pipeline/batches/:batchId/cancel', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, status FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Mark pending/processing files as cancelled
    await prisma.$queryRaw`
      UPDATE ocr_batch_file SET status = 'failed', error_message = 'Cancelled by user'
      WHERE batch_id = ${batchId}::uuid AND status IN ('pending', 'processing')
    `;

    // Count what we have
    const [counts] = await prisma.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*)::int AS total
      FROM ocr_batch_file WHERE batch_id = ${batchId}::uuid
    `;

    // Update batch status
    const newStatus = counts.completed > 0 ? 'partial' : 'failed';
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        status = ${newStatus},
        processed_files = ${counts.completed},
        failed_files = ${counts.failed},
        completed_at = NOW(),
        error_message = 'Cancelled by user'
      WHERE id = ${batchId}::uuid
    `;

    return {
      success: true,
      message: `Batch cancelled. ${counts.completed} completed, ${counts.failed} cancelled/failed.`,
      status: newStatus,
    };
  });

  // ═══ DELETE SINGLE BATCH ═══════════════════════════════════════════════════

  fastify.delete('/ocr-pipeline/batches/:batchId', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, status FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Don't delete actively processing batches — cancel first
    if (batch.status === 'processing') {
      return reply.status(400).send({ error: 'Cannot delete a processing batch. Stop it first.' });
    }

    // Delete related OCR jobs
    await prisma.$queryRaw`
      DELETE FROM ocr_job WHERE batch_id = ${batchId}::uuid
    `.catch(() => {});

    // Delete batch files
    await prisma.$queryRaw`
      DELETE FROM ocr_batch_file WHERE batch_id = ${batchId}::uuid
    `;

    // Delete the batch
    await prisma.$queryRaw`
      DELETE FROM ocr_batch WHERE id = ${batchId}::uuid
    `;

    return { success: true, message: 'Batch deleted.' };
  });

  // ═══ CLEAR FAILED/STALE BATCHES FOR PLATFORM ════════════════════════════

  fastify.post('/ocr-pipeline/platforms/:platformId/clear-failed', async (request, reply) => {
    const { platformId } = request.params;

    // First cancel any stuck "processing" batches
    await prisma.$queryRaw`
      UPDATE ocr_batch SET status = 'failed', error_message = 'Force-stopped (stale)', completed_at = NOW()
      WHERE platform_id = ${platformId}::uuid AND status IN ('processing', 'pending')
    `;

    // Delete all failed batches and their files
    const failedBatches = await prisma.$queryRaw`
      SELECT id FROM ocr_batch WHERE platform_id = ${platformId}::uuid AND status = 'failed'
    `;

    for (const b of failedBatches) {
      await prisma.$queryRaw`DELETE FROM ocr_job WHERE batch_id = ${b.id}::uuid`.catch(() => {});
      await prisma.$queryRaw`DELETE FROM ocr_batch_file WHERE batch_id = ${b.id}::uuid`;
      await prisma.$queryRaw`DELETE FROM ocr_batch WHERE id = ${b.id}::uuid`;
    }

    return {
      success: true,
      deleted: failedBatches.length,
      message: `Cleared ${failedBatches.length} failed/stale batch${failedBatches.length !== 1 ? 'es' : ''}.`,
    };
  });

  // ═══ RE-RUN OCR — Reprocess files with current or different provider ══════

  fastify.post('/ocr-pipeline/batches/:batchId/rerun-ocr', async (request, reply) => {
    const { batchId } = request.params;
    const { ocrProvider: providerOverride, fileIds } = request.body || {};

    const [batch] = await prisma.$queryRaw`
      SELECT id, platform_id, status FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Reset selected files (or all) to pending.
    // Important: clear prior raw/stage counters so UI does not show stale counts
    // while a rerun is in progress.
    if (fileIds?.length) {
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          status = 'pending',
          error_message = NULL,
          word_count = 0,
          tags_found = 0,
          tags_matched = 0,
          raw_output_key = NULL,
          grouped_output_key = NULL,
          cleaned_output_key = NULL,
          stage2_phase_profile = NULL,
          review_output_key = NULL,
          raw_ocr_data = NULL,
          completed_at = NULL
        WHERE batch_id = ${batchId}::uuid AND id = ANY(${fileIds}::uuid[])
      `;
    } else {
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          status = 'pending',
          error_message = NULL,
          word_count = 0,
          tags_found = 0,
          tags_matched = 0,
          raw_output_key = NULL,
          grouped_output_key = NULL,
          cleaned_output_key = NULL,
          stage2_phase_profile = NULL,
          review_output_key = NULL,
          raw_ocr_data = NULL,
          completed_at = NULL
        WHERE batch_id = ${batchId}::uuid
      `;
    }

    // Update batch status
    await prisma.$queryRaw`
      UPDATE ocr_batch SET status = 'processing', error_message = NULL, stage2_phase_profile = NULL
      WHERE id = ${batchId}::uuid
    `;

    // Resolve OCR options (with optional provider override)
    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
    } catch (_) {
      storage = { download: () => { throw new Error('No storage configured'); }, config: {} };
    }

    const ocrOptions = await resolveOcrOptions(prisma, batch.platform_id);
    if (providerOverride && ['google', 'claude', 'both', 'paddle', 'florence'].includes(providerOverride)) {
      ocrOptions.ocrProvider = providerOverride;
    }
    if (ocrOptions.ocrProvider === 'paddle' && !ocrOptions.paddleEndpointUrl) {
      return reply.status(400).send({ error: 'Paddle OCR requires PADDLE_OCR_URL to be configured.' });
    }
    if (ocrOptions.ocrProvider === 'florence' && !ocrOptions.florenceEndpointUrl) {
      return reply.status(400).send({ error: 'Florence OCR requires FLORENCE_OCR_URL to be configured.' });
    }

    processBatchAsync(prisma, batchId, batch.platform_id, storage, ocrOptions).catch(err => {
      console.error(`Batch ${batchId} re-run OCR error:`, err);
    });

    return reply.status(202).send({
      success: true,
      message: `Re-running OCR with ${ocrOptions.ocrProvider} provider on ${fileIds?.length || 'all'} files.`,
    });
  });

  // ═══ RESET STAGE 2 ONLY — Keep raw OCR, clear classified/review outputs ═══

  fastify.post('/ocr-pipeline/batches/:batchId/reset-stage2', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, stage1_status, stage2_status
      FROM ocr_batch
      WHERE id = ${batchId}::uuid
    `.catch(() => []);
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    if (batch.stage1_status !== 'completed' && batch.stage1_status !== 'partial') {
      return reply.status(400).send({ error: `Stage 1 must be completed first (current: ${batch.stage1_status})` });
    }
    if (batch.stage2_status === 'processing') {
      return reply.status(400).send({ error: 'Stage 2 is currently processing. Stop it first.' });
    }
    if (batch.stage2_status === 'pending') {
      return reply.status(400).send({ error: 'Stage 2 is already pending.' });
    }

    await prisma.$queryRaw`
      UPDATE ocr_batch_file
      SET cleaned_output_key = NULL,
          stage2_phase_profile = NULL,
          review_output_key = NULL,
          review_status = 'pending',
          reviewed_at = NULL,
          review_stats = NULL,
          error_message = NULL
      WHERE batch_id = ${batchId}::uuid
    `;

    await prisma.$queryRaw`
      UPDATE ocr_batch
      SET status = 'partial',
          current_stage = 'classify',
          stage2_status = 'pending',
          stage3_status = 'pending',
          stage4_status = 'pending',
          ai_cleanup_status = 'pending',
          ai_cleanup_job_id = NULL,
          reconciliation_summary = NULL,
          ai_analysis_status = NULL,
          stage2_phase_profile = NULL,
          passed_to_annotation = FALSE,
          annotation_passed_at = NULL,
          error_message = NULL,
          completed_at = NULL
      WHERE id = ${batchId}::uuid
    `;

    await prisma.$executeRaw`
      DELETE FROM ocr_candidate_ledger
      WHERE extraction_stage = 'stage2'
        AND ocr_job_id IN (
          SELECT ocr_job_id
          FROM ocr_batch_file
          WHERE batch_id = ${batchId}::uuid
            AND ocr_job_id IS NOT NULL
        )
    `.catch(() => {});

    stage2Progress.delete(batchId);

    return reply.send({
      success: true,
      message: 'Stage 2 reset. Raw OCR was kept; you can rerun AI Classify now.',
    });
  });

  // ═══ AI CLEANUP — RECONCILIATION & RETRY ═════════════════════════════════

  // GET reconciliation report for a batch
  fastify.get('/ocr-pipeline/batches/:batchId/reconciliation', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT reconciliation_summary, ai_cleanup_status, ai_cleanup_job_id
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    if (batch.ai_cleanup_status !== 'completed' || !batch.reconciliation_summary) {
      return reply.status(400).send({
        error: 'AI cleanup has not completed for this batch',
        aiCleanupStatus: batch.ai_cleanup_status,
      });
    }

    // Also get detailed extraction breakdown
    const pnidIds = (await prisma.$queryRaw`
      SELECT DISTINCT pnid_id FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid AND pnid_id IS NOT NULL
    `).map(r => r.pnid_id);

    const extractions = pnidIds.length > 0 ? await prisma.$queryRaw`
      SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.tag_type, oe.confidence,
             oe.ai_classification, oe.ai_reason, oe.revision_status,
             oe.matched_entity_id, oe.match_method, oe.status,
             oe.bbox_x_pct, oe.bbox_y_pct
      FROM ocr_extraction oe
      WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
        AND oe.ai_classification = 'real_tag'
      ORDER BY oe.tag_type, oe.extracted_text
    ` : [];

    // Get draft entities for this batch
    const draftEntities = await prisma.$queryRaw`
      SELECT id, entity_type, suggested_tag, suggested_data, confidence, status, source_pnid_ids
      FROM ai_generated_entity
      WHERE batch_id = ${batchId}::uuid AND status = 'draft'
      ORDER BY entity_type, suggested_tag
    `;

    return {
      reconciliation: batch.reconciliation_summary,
      cleanedExtractions: extractions,
      draftEntities,
    };
  });

  // POST retry AI cleanup (manual trigger)
  fastify.post('/ocr-pipeline/batches/:batchId/retry-cleanup', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, platform_id, status, ai_cleanup_status
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });
    if (batch.status !== 'completed' && batch.status !== 'partial') {
      return reply.status(400).send({ error: 'Batch OCR must be completed first' });
    }
    if (batch.ai_cleanup_status === 'processing') {
      return reply.status(400).send({ error: 'AI cleanup already in progress' });
    }

    // Reset extractions to pending (undo previous cleanup)
    const pnidIds = (await prisma.$queryRaw`
      SELECT DISTINCT pnid_id FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid AND pnid_id IS NOT NULL
    `).map(r => r.pnid_id);

    if (pnidIds.length > 0) {
      await prisma.$queryRaw`
        UPDATE ocr_extraction SET
          ai_classification = NULL, ai_reason = NULL,
          revision_status = NULL, status = 'pending'
        WHERE pnid_id = ANY(${pnidIds}::uuid[])
      `;
    }

    // Clear old draft entities for this batch
    await prisma.$queryRaw`
      DELETE FROM ai_generated_entity WHERE batch_id = ${batchId}::uuid AND status = 'draft'
    `;

    // Re-run cleanup
    runAiCleanup(prisma, batchId, batch.platform_id).catch(err => {
      console.error(`[OCR Pipeline] Retry cleanup failed for batch ${batchId}:`, err.message);
    });

    return reply.status(202).send({
      success: true,
      message: 'AI cleanup restarted. Poll batch detail for status.',
    });
  });

  // ═══ AI (CLAUDE) CREDENTIALS ══════════════════════════════════════════════

  // GET — prompt preview (resolved Stage 2 prompt with current dictionary + learned patterns)
  fastify.get('/ocr-pipeline/platforms/:platformId/prompt-preview', async (request, reply) => {
    const { platformId } = request.params;
    const drawingNumber = String(request.query?.drawingNumber || 'AD-28-D-100001-SHT-001');

    let tagDictionary = [];
    let learnedPatterns = [];
    try { tagDictionary = await getDictionary(prisma, platformId); } catch { /* optional */ }
    try { learnedPatterns = await getLearnedPatterns(prisma, platformId); } catch { /* optional */ }

    const dictText = tagDictionary.length > 0
      ? tagDictionary.map(d =>
          `- ${d.function_code} -> ${d.entity_type} (${d.discipline || ''})${d.tag_pattern ? ` pattern:${d.tag_pattern}` : ''}`
        ).join('\n')
      : 'No client-specific dictionary provided. Use standard ISA S5.1 and O&G conventions.';
    const learnedPatternText = learnedPatterns.length > 0
      ? `\n\nLearned Patterns From Prior Review:\n${learnedPatterns
          .map(p => `- ${p.pattern_key} -> ${p.target_type} (support=${p.support_count}, conf=${p.confidence}) regex:${p.regex_pattern}`)
          .join('\n')}`
      : '';

    const rawWordsSample = [
      [0, 'ZLO', 100, 100],
      [1, '281053', 100, 122],
      [2, 'C', 100, 142],
      [3, 'PT', 300, 100],
      [4, '281020', 330, 100],
    ];
    const groupedCandidatesSample = [
      ['ZLO-281053-C', 'vertical_isa', [0, 1, 2]],
      ['PT-281020', 'horizontal', [3, 4]],
    ];

    const { STAGE2_CLASSIFY_SYSTEM_PROMPT, STAGE2_CLASSIFY_PROMPT_TEMPLATE } =
      await import('../services/ocr/AiPromptTemplates.js');

    const resolvedUserPrompt = STAGE2_CLASSIFY_PROMPT_TEMPLATE
      .replace('{{drawingNumber}}', drawingNumber)
      .replace('{{platformCode}}', String(request.query?.platformCode || 'PLATFORM'))
      .replace('{{platformName}}', String(request.query?.platformName || 'Platform'))
      .replace('{{tagDictionary}}', `${dictText}${learnedPatternText}`)
      .replace('{{wordCount}}', String(rawWordsSample.length))
      .replace('{{rawWords}}', JSON.stringify(rawWordsSample))
      .replace('{{groupedCandidates}}', JSON.stringify(groupedCandidatesSample))
      .replace('{{fullText}}', String(request.query?.fullText || 'Sample title block / line tags / instrument bubbles'));

    return reply.send({
      stage: 'stage2_classify',
      dictionaryCount: tagDictionary.length,
      learnedPatternCount: learnedPatterns.length,
      systemPrompt: STAGE2_CLASSIFY_SYSTEM_PROMPT,
      userPrompt: resolvedUserPrompt,
      meta: {
        drawingNumber,
        generatedAt: new Date().toISOString(),
      },
    });
  });

  // GET — learning history summary for prompt evolution visibility
  fastify.get('/ocr-pipeline/platforms/:platformId/learning-history', async (request, reply) => {
    const { platformId } = request.params;
    const days = Math.max(7, Math.min(180, Number(request.query?.days || 30)));

    try {
      const feedbackEvents = await prisma.$queryRaw`
        SELECT action, original_text, corrected_text, original_type, corrected_type, created_at
        FROM ocr_feedback_event
        WHERE platform_id = ${platformId}::uuid
          AND created_at >= NOW() - (${days} * INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT 500
      `;

      const daily = await prisma.$queryRaw`
        SELECT
          DATE(created_at) AS day,
          COUNT(*)::int AS total_events,
          COUNT(*) FILTER (WHERE action = 'approve')::int AS approved_events,
          COUNT(*) FILTER (WHERE action = 'edit')::int AS edited_events,
          COUNT(*) FILTER (WHERE action = 'reject')::int AS rejected_events
        FROM ocr_feedback_event
        WHERE platform_id = ${platformId}::uuid
          AND created_at >= NOW() - (${days} * INTERVAL '1 day')
        GROUP BY DATE(created_at)
        ORDER BY day DESC
      `;

      const patterns = await prisma.$queryRaw`
        SELECT pattern_key, regex_pattern, target_type, support_count, confidence, source, created_at, updated_at, is_active
        FROM ocr_learned_pattern
        WHERE platform_id = ${platformId}::uuid
        ORDER BY updated_at DESC
        LIMIT 200
      `;

      return reply.send({
        days,
        summary: {
          totalFeedbackEvents: feedbackEvents.length,
          totalPatterns: patterns.length,
          activePatterns: patterns.filter(p => !!p.is_active).length,
        },
        daily,
        recentFeedback: feedbackEvents.slice(0, 100),
        patterns,
      });
    } catch (err) {
      fastify.log.warn(`learning-history unavailable: ${err.message}`);
      return reply.send({
        days,
        summary: { totalFeedbackEvents: 0, totalPatterns: 0, activePatterns: 0 },
        daily: [],
        recentFeedback: [],
        patterns: [],
      });
    }
  });

  // GET AI config status for a platform
  fastify.get('/ocr-pipeline/platforms/:platformId/ai-config', async (request, reply) => {
    const { platformId } = request.params;

    try {
      const configs = await prisma.$queryRaw`
        SELECT ai_credentials_ref, ai_model_preference
        FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;
      const config = configs[0];

      if (config?.ai_credentials_ref) {
        return {
          hasAiCredentials: true,
          aiModel: config.ai_model_preference || 'claude-sonnet-4-20250514',
          source: 'platform',
        };
      }

      // Try global config
      const globalConfigs = await prisma.$queryRaw`
        SELECT ai_credentials_ref, ai_model_preference
        FROM storage_config
        WHERE scope_type = 'global' AND is_active = true
      `;
      const globalConfig = globalConfigs[0];

      if (globalConfig?.ai_credentials_ref) {
        return {
          hasAiCredentials: true,
          aiModel: globalConfig.ai_model_preference || 'claude-sonnet-4-20250514',
          source: 'global',
        };
      }
    } catch (err) {
      // Any DB error (missing column, missing table) — fall through to env var check
      fastify.log.warn('ai-config GET failed (schema may need migration):', err.message);
    }

    // Check env var fallback
    return {
      hasAiCredentials: !!process.env.ANTHROPIC_API_KEY,
      aiModel: 'claude-sonnet-4-20250514',
      source: process.env.ANTHROPIC_API_KEY ? 'env' : 'none',
    };
  });

  // PUT — save AI credentials for a platform
  fastify.put('/ocr-pipeline/platforms/:platformId/ai-config', async (request, reply) => {
    const { platformId } = request.params;
    const { apiKey, model } = request.body || {};

    if (apiKey && !apiKey.startsWith('sk-ant-')) {
      return reply.code(400).send({ error: 'Invalid API key format — must start with sk-ant-' });
    }

    try {
      const existing = await prisma.$queryRaw`
        SELECT id FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;

      if (!existing[0]) {
        // No platform-specific storage config — update global config with AI credentials
        // (avoids creating a shadow 'local' provider row that overrides GCS storage config)
        const globalConfigs = await prisma.$queryRaw`
          SELECT id FROM storage_config
          WHERE scope_type = 'global' AND is_active = true
          LIMIT 1
        `;
        if (globalConfigs[0]) {
          await prisma.$queryRaw`
            UPDATE storage_config
            SET ai_credentials_ref = ${apiKey || null},
                ai_model_preference = ${model || 'claude-sonnet-4-20250514'},
                updated_at = NOW()
            WHERE id = ${globalConfigs[0].id}::uuid
          `;
        } else {
          // No global config either — create a credentials-only global entry (no provider conflict)
          await prisma.$executeRawUnsafe(`
            INSERT INTO storage_config (scope_type, scope_id, provider, ai_credentials_ref, ai_model_preference, is_active)
            VALUES ('global', NULL, 'none', $1, $2, true)
          `, apiKey || null, model || 'claude-sonnet-4-20250514');
        }
        return { success: true, hasAiCredentials: !!apiKey };
      }

      await prisma.$queryRaw`
        UPDATE storage_config
        SET ai_credentials_ref = ${apiKey || null},
            ai_model_preference = ${model || 'claude-sonnet-4-20250514'},
            updated_at = NOW()
        WHERE id = ${existing[0].id}::uuid
      `;

      return { success: true, hasAiCredentials: !!apiKey };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Failed to save AI config: ${err.message}` });
    }
  });

  // POST — test AI (Claude) connectivity
  fastify.post('/ocr-pipeline/platforms/:platformId/ai-test', async (request, reply) => {
    const { platformId } = request.params;
    const { apiKey: providedKey } = request.body || {};

    // Resolve credentials: provided > platform > global > env
    let apiKey = providedKey;
    if (!apiKey) {
      const { resolveAiCredentials } = await import('../services/ocr/AiAnalysisService.js');
      try {
        const resolved = await resolveAiCredentials(prisma, platformId);
        apiKey = resolved.apiKey;
      } catch {
        return reply.code(400).send({ ok: false, message: 'No AI credentials configured. Add an API key first.' });
      }
    }

    try {
      const startMs = Date.now();
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Reply with only: OK' }],
      });
      const latencyMs = Date.now() - startMs;
      const text = resp.content?.find(b => b.type === 'text')?.text || '';
      return { ok: true, message: `Claude API connected (${latencyMs}ms)`, model: resp.model, response: text.trim() };
    } catch (err) {
      return { ok: false, message: `Claude API test failed: ${err.message}` };
    }
  });

  // GET visual detector config (T-Rex2 / GroundingDINO)
  fastify.get('/ocr-pipeline/platforms/:platformId/visual-config', async (request, reply) => {
    const { platformId } = request.params;

    try {
      const configs = await prisma.$queryRaw`
        SELECT visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference
        FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
           OR (scope_type = 'global' AND is_active = true)
        ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
        LIMIT 1
      `;
      const config = configs[0];
      return {
        provider: config?.visual_provider_preference || 'trex2',
        endpointUrl: config?.visual_api_url || '',
        hasToken: !!config?.visual_api_token,
        model: config?.visual_model_preference || '',
        source: config ? 'configured' : 'none',
      };
    } catch (err) {
      fastify.log.warn('visual-config GET failed:', err.message);
      return { provider: 'trex2', endpointUrl: '', hasToken: false, model: '', source: 'none' };
    }
  });

  // PUT visual detector config
  fastify.put('/ocr-pipeline/platforms/:platformId/visual-config', async (request, reply) => {
    const { platformId } = request.params;
    const { provider, endpointUrl, token, model } = request.body || {};

    if (!['trex2', 'grounding_dino'].includes(String(provider || ''))) {
      return reply.code(400).send({ error: 'provider must be trex2 or grounding_dino' });
    }
    if (!endpointUrl || !String(endpointUrl).startsWith('http')) {
      return reply.code(400).send({ error: 'endpointUrl must be a valid http/https URL' });
    }

    try {
      const existing = await prisma.$queryRaw`
        SELECT id FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;
      // Only update token if explicitly provided — omitting it preserves the stored token
      const tokenProvided = token !== undefined && token !== null;
      if (existing[0]) {
        if (tokenProvided) {
          await prisma.$queryRaw`
            UPDATE storage_config
            SET visual_provider_preference = ${provider},
                visual_api_url = ${endpointUrl},
                visual_api_token = ${token},
                visual_model_preference = ${model || null},
                updated_at = NOW()
            WHERE id = ${existing[0].id}::uuid
          `;
        } else {
          await prisma.$queryRaw`
            UPDATE storage_config
            SET visual_provider_preference = ${provider},
                visual_api_url = ${endpointUrl},
                visual_model_preference = ${model || null},
                updated_at = NOW()
            WHERE id = ${existing[0].id}::uuid
          `;
        }
      } else {
        const globalConfigs = await prisma.$queryRaw`
          SELECT id FROM storage_config
          WHERE scope_type = 'global' AND is_active = true
          LIMIT 1
        `;
        if (globalConfigs[0]) {
          if (tokenProvided) {
            await prisma.$queryRaw`
              UPDATE storage_config
              SET visual_provider_preference = ${provider},
                  visual_api_url = ${endpointUrl},
                  visual_api_token = ${token},
                  visual_model_preference = ${model || null},
                  updated_at = NOW()
              WHERE id = ${globalConfigs[0].id}::uuid
            `;
          } else {
            await prisma.$queryRaw`
              UPDATE storage_config
              SET visual_provider_preference = ${provider},
                  visual_api_url = ${endpointUrl},
                  visual_model_preference = ${model || null},
                  updated_at = NOW()
              WHERE id = ${globalConfigs[0].id}::uuid
            `;
          }
        } else {
          await prisma.$executeRawUnsafe(`
            INSERT INTO storage_config (scope_type, provider, visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference, is_active)
            VALUES ('global', 'none', $1, $2, $3, $4, true)
          `, provider, endpointUrl, token || null, model || null);
        }
      }

      return { success: true, provider, endpointUrl, hasToken: !!token, model: model || '' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Failed to save visual config: ${err.message}` });
    }
  });

  // GET GroundingDINO secondary config (for line detection auto-selection)
  fastify.get('/ocr-pipeline/platforms/:platformId/grounding-config', async (request, reply) => {
    const { platformId } = request.params;
    try {
      const configs = await prisma.$queryRaw`
        SELECT grounding_api_url, grounding_api_token, grounding_model_preference
        FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
           OR (scope_type = 'global' AND is_active = true)
        ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
        LIMIT 1
      `;
      const config = configs[0];
      return {
        endpointUrl: config?.grounding_api_url || '',
        hasToken: !!config?.grounding_api_token,
        model: config?.grounding_model_preference || '',
        source: config?.grounding_api_url ? 'configured' : 'none',
      };
    } catch (err) {
      fastify.log.warn('grounding-config GET failed:', err.message);
      return { endpointUrl: '', hasToken: false, model: '', source: 'none' };
    }
  });

  // PUT GroundingDINO secondary config
  fastify.put('/ocr-pipeline/platforms/:platformId/grounding-config', async (request, reply) => {
    const { platformId } = request.params;
    const { endpointUrl, token, model } = request.body || {};

    if (!endpointUrl || !String(endpointUrl).startsWith('http')) {
      return reply.code(400).send({ error: 'endpointUrl must be a valid http/https URL' });
    }

    try {
      const existing = await prisma.$queryRaw`
        SELECT id FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;
      const targetId = existing[0]?.id;
      if (!targetId) {
        const globalConfigs = await prisma.$queryRaw`
          SELECT id FROM storage_config WHERE scope_type = 'global' AND is_active = true LIMIT 1
        `;
        if (!globalConfigs[0]) {
          return reply.code(400).send({ error: 'No storage config found. Configure primary visual detector first.' });
        }
        await prisma.$queryRaw`
          UPDATE storage_config
          SET grounding_api_url = ${endpointUrl},
              grounding_api_token = ${token || null},
              grounding_model_preference = ${model || null},
              updated_at = NOW()
          WHERE id = ${globalConfigs[0].id}::uuid
        `;
      } else {
        await prisma.$queryRaw`
          UPDATE storage_config
          SET grounding_api_url = ${endpointUrl},
              grounding_api_token = ${token || null},
              grounding_model_preference = ${model || null},
              updated_at = NOW()
          WHERE id = ${targetId}::uuid
        `;
      }
      return { success: true, endpointUrl, hasToken: !!token, model: model || '' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Failed to save grounding config: ${err.message}` });
    }
  });

  // POST visual detector connectivity test
  fastify.post('/ocr-pipeline/platforms/:platformId/visual-test', async (request, reply) => {
    const { platformId } = request.params;
    const {
      provider: providedProvider,
      endpointUrl: providedUrl,
      token: providedToken,
      model: providedModel,
    } = request.body || {};

    let provider = providedProvider;
    let endpointUrl = providedUrl;
    let token = providedToken;
    let model = providedModel;

    // Always fetch stored DB config — need it for token fallback even when URL is provided
    const configs = await prisma.$queryRaw`
      SELECT visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference,
             grounding_api_url, grounding_api_token, grounding_model_preference
      FROM storage_config
      WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
         OR (scope_type = 'global' AND is_active = true)
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);
    const dbConfig = configs[0];

    // For grounding_dino provider, use grounding-specific DB columns
    if (provider === 'grounding_dino') {
      endpointUrl = endpointUrl || dbConfig?.grounding_api_url;
      token = token || dbConfig?.grounding_api_token || dbConfig?.visual_api_token;
      model = model || dbConfig?.grounding_model_preference;
    } else {
      // T-Rex2 or unset provider
      provider = provider || dbConfig?.visual_provider_preference;
      endpointUrl = endpointUrl || dbConfig?.visual_api_url;
      token = token || dbConfig?.visual_api_token;
      model = model || dbConfig?.visual_model_preference;
    }

    if (!provider || !endpointUrl) {
      return reply.code(400).send({ ok: false, message: 'No visual detector config found. Save config first.' });
    }

    try {
      const isDdsTaskApi = /api\.deepdataspace\.com\/v2\/task\//i.test(String(endpointUrl || ''));
      const payload = isDdsTaskApi
        ? provider === 'trex2'
          ? {
              image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
              model: model || process.env.AI_ANNOTATE_TREX_MODEL || 'T-Rex-2.0',
              targets: ['bbox'],
              prompt: {
                type: 'visual_interaction',
                visual_interaction: { type: 'rect', category_id: 1, rect: [0, 0, 1, 1] },
              },
            }
          : {
              image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
              model: model || process.env.AI_ANNOTATE_DDS_MODEL || 'GroundingDino-1.6-Pro',
              prompt: { type: 'text', text: 'tag label' },
              bbox_threshold: 0.25,
              targets: ['bbox'],
            }
        : provider === 'trex2'
          ? { image_base64: '', prompts: [] }
          : { image_base64: '', text_prompt: 'tag label', box_threshold: 0.25, text_threshold: 0.25 };

      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Token = token;
        headers.Authorization = `Bearer ${token}`;
        headers['x-api-key'] = token;
      }

      const startMs = Date.now();
      const attemptOnce = async (body) => {
        const res = await fetch(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        const txt = await res.text().catch(() => '');
        let json = null;
        try { json = JSON.parse(txt); } catch { json = null; }
        return { res, txt, json };
      };

      let res;
      let txt;
      let json;
      if (isDdsTaskApi && provider === 'trex2') {
        const variants = [
          payload,
          {
            ...payload,
            prompt: {
              type: 'visual_images',
              visual_images: [{ interactions: [{ type: 'rect', rect: [0, 0, 1, 1] }] }],
            },
          },
        ];
        let ok = false;
        const errors = [];
        for (const variant of variants) {
          const r = await attemptOnce(variant);
          if (r.res.ok && Number(r.json?.code ?? 0) === 0 && r.json?.data?.task_uuid) {
            res = r.res; txt = r.txt; json = r.json; ok = true; break;
          }
          errors.push(`${r.res.status}:${r.txt}`);
        }
        if (!ok) {
          return {
            ok: false,
            message: `DDS task create failed (trex variants): ${errors.join(' | ')}`,
            statusCode: 400,
          };
        }
      } else {
        const r = await attemptOnce(payload);
        res = r.res; txt = r.txt; json = r.json;
      }
      const latencyMs = Date.now() - startMs;

      if (isDdsTaskApi) {
        const taskUuid = json?.data?.task_uuid;
        if (res.ok && Number(json?.code ?? 0) === 0 && taskUuid) {
          return {
            ok: true,
            message: `DDS task endpoint reachable (${latencyMs}ms, task created)`,
            statusCode: res.status,
            taskUuid,
          };
        }
        return {
          ok: false,
          message: `DDS task create failed (${res.status}): ${txt}`,
          statusCode: res.status,
        };
      }

      if (res.ok || res.status === 400) {
        return { ok: true, message: `Visual endpoint reachable (${latencyMs}ms)`, statusCode: res.status };
      }
      return { ok: false, message: `Visual test failed (${res.status}): ${txt}`, statusCode: res.status };
    } catch (err) {
      return { ok: false, message: `Visual test failed: ${err.message}` };
    }
  });

  // POST — test Vision API connectivity
  fastify.post('/ocr-pipeline/platforms/:platformId/vision-test', async (request, reply) => {
    const { platformId } = request.params;
    const { credentialsJson } = request.body || {};

    // Determine which credentials to test
    let creds = credentialsJson;

    if (!creds) {
      // Fall back to stored vision or storage credentials (platform → global fallback)
      // Check all matching configs to handle multiple rows (e.g. separate AI config row)
      const configs = await prisma.$queryRaw`
        SELECT vision_credentials_ref, credentials_ref
        FROM storage_config
        WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
           OR (scope_type = 'global' AND is_active = true)
        ORDER BY
          CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END,
          CASE WHEN vision_credentials_ref IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN credentials_ref IS NOT NULL THEN 0 ELSE 1 END
      `.catch(() => []);
      for (const cfg of configs) {
        if (cfg.vision_credentials_ref) { creds = cfg.vision_credentials_ref; break; }
        if (cfg.credentials_ref) { creds = cfg.credentials_ref; break; }
      }
    }

    if (!creds) {
      return reply.code(400).send({ ok: false, message: 'No credentials available. Configure storage first or provide Vision credentials.' });
    }

    try {
      const provider = new VisionOCRProvider(creds);
      // Test by creating a tiny 1x1 white PNG and sending it
      const testPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64'
      );
      await provider.extractFromImage(testPng);
      return { ok: true, message: 'Vision API connected successfully' };
    } catch (err) {
      return { ok: false, message: `Vision API test failed: ${err.message}` };
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OCR PROVIDER CONFIG — Select between Google Vision, Claude Vision, or Both
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/platforms/:platformId/ocr-provider', async (request, reply) => {
    const { platformId } = request.params;

    // Check platform-scoped config first, then global
    const configs = await prisma.$queryRaw`
      SELECT ocr_provider_preference
      FROM storage_config
      WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
         OR (scope_type = 'global' AND is_active = true)
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);

    return {
      provider: configs[0]?.ocr_provider_preference || 'google',
      options: ['google', 'claude', 'both', 'paddle', 'florence'],
      paddleReady: !!process.env.PADDLE_OCR_URL,
      florenceReady: !!process.env.FLORENCE_OCR_URL,
    };
  });

  fastify.put('/ocr-pipeline/platforms/:platformId/ocr-provider', async (request, reply) => {
    const { platformId } = request.params;
    const { provider } = request.body || {};

    if (!['google', 'claude', 'both', 'paddle', 'florence'].includes(provider)) {
      return reply.status(400).send({ error: 'provider must be one of: google, claude, both, paddle, florence' });
    }

    // Update platform-scoped config, or global if no platform config exists
    const existing = await prisma.$queryRaw`
      SELECT id FROM storage_config
      WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
    `.catch(() => []);

    if (existing[0]) {
      await prisma.$executeRawUnsafe(`
        UPDATE storage_config SET ocr_provider_preference = $1, updated_at = NOW()
        WHERE id = $2::uuid
      `, provider, existing[0].id);
    } else {
      // Try global config
      const global = await prisma.$queryRaw`
        SELECT id FROM storage_config
        WHERE scope_type = 'global' AND is_active = true LIMIT 1
      `.catch(() => []);

      if (global[0]) {
        await prisma.$executeRawUnsafe(`
          UPDATE storage_config SET ocr_provider_preference = $1, updated_at = NOW()
          WHERE id = $2::uuid
        `, provider, global[0].id);
      } else {
        // No config at all — create global entry
        await prisma.$executeRawUnsafe(`
          INSERT INTO storage_config (scope_type, provider, ocr_provider_preference, is_active)
          VALUES ('global', 'none', $1, true)
        `, provider);
      }
    }

    return { success: true, provider };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /ocr-pipeline/platforms/:platformId/storage-configs
  // Returns array of available storage configs for batch selection dropdown
  // Includes platform-scoped + global configs, ordered by primary first
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.get('/ocr-pipeline/platforms/:platformId/storage-configs', async (request, reply) => {
    const { platformId } = request.params;

    const configs = await prisma.$queryRaw`
      SELECT
        id, provider, bucket_or_container, region, scope_type, created_at
      FROM storage_config
      WHERE is_active = true
        AND (
          (scope_type = 'platform' AND scope_id = ${platformId}::uuid)
          OR scope_type = 'global'
        )
      ORDER BY
        CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END,
        created_at ASC
    `.catch(() => []);

    const formatted = configs.map((c, idx) => ({
      id: c.id,
      provider: c.provider.toUpperCase(),
      bucket: c.bucket_or_container,
      region: c.region || '(default)',
      scope: c.scope_type === 'platform' ? 'Platform' : 'Global',
      isPrimary: idx === 0,
      label: `${c.provider.toUpperCase()} — ${c.bucket_or_container}${c.region ? ' (' + c.region + ')' : ''}${c.scope_type === 'platform' ? ' [Platform]' : ' [Admin]'}`
    }));

    return reply.send(formatted);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DIAGNOSTIC: CSV export of coordinates at every pipeline stage
  // GET /ocr-pipeline/batches/:batchId/files/:fileId/coordinate-trace
  // Returns: { csvStages: { rawWords, classifiedTags, reviewedTags, ocrExtractions, junctionEntries, overlayOutput } }
  // ═══════════════════════════════════════════════════════════════════════════
  fastify.get('/ocr-pipeline/batches/:batchId/files/:fileId/coordinate-trace', async (request, reply) => {
    const { batchId, fileId } = request.params;
    const { format = 'json' } = request.query; // 'json' or 'csv'

    const [file] = await prisma.$queryRaw`
      SELECT bf.id, bf.filename, bf.drawing_number, bf.pnid_id,
             bf.storage_key, bf.raw_output_key, bf.grouped_output_key,
             bf.cleaned_output_key, bf.review_output_key,
             b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.id = ${fileId}::uuid AND bf.batch_id = ${batchId}::uuid
    `.catch(() => []);

    if (!file) return reply.status(404).send({ error: 'File not found' });

    let storageProvider;
    try {
      storageProvider = await getStorageProvider(prisma, { platformId: file.platform_id });
    } catch {
      return reply.status(500).send({ error: 'Storage not configured' });
    }

    const loadJson = async (key) => {
      if (!key) return null;
      try {
        const downloaded = await storageProvider.download(key);
        const buf = downloaded.buffer || downloaded;
        return JSON.parse(buf.toString('utf-8'));
      } catch { return null; }
    };

    // ── Stage 1: Raw OCR words ──
    const rawData = await loadJson(file.raw_output_key);
    const rawWordsCsv = [];
    if (rawData?.words) {
      const pageW = rawData.pageWidth || 0;
      const pageH = rawData.pageHeight || 0;
      for (let i = 0; i < rawData.words.length; i++) {
        const w = rawData.words[i];
        const verts = w.vertices || [];
        const xs = verts.map(v => v.x || 0);
        const ys = verts.map(v => v.y || 0);
        const minX = xs.length ? Math.min(...xs) : 0;
        const minY = ys.length ? Math.min(...ys) : 0;
        const maxX = xs.length ? Math.max(...xs) : 0;
        const maxY = ys.length ? Math.max(...ys) : 0;
        rawWordsCsv.push({
          wordIndex: i,
          text: w.text,
          confidence: w.confidence,
          minX_px: minX,
          minY_px: minY,
          maxX_px: maxX,
          maxY_px: maxY,
          width_px: maxX - minX,
          height_px: maxY - minY,
          x_pct: pageW ? +((minX / pageW) * 100).toFixed(2) : 0,
          y_pct: pageH ? +((minY / pageH) * 100).toFixed(2) : 0,
          w_pct: pageW ? +(((maxX - minX) / pageW) * 100).toFixed(2) : 0,
          h_pct: pageH ? +(((maxY - minY) / pageH) * 100).toFixed(2) : 0,
          pageWidth: pageW,
          pageHeight: pageH,
        });
      }
    }

    // ── Stage 2a: Grouped words ──
    const groupedData = await loadJson(file.grouped_output_key);
    const groupedCsv = [];
    if (groupedData?.groups) {
      for (const g of groupedData.groups) {
        const pct = g.position_pct || {};
        const px = g.position_px || {};
        groupedCsv.push({
          groupId: g.id,
          text: g.text,
          wordCount: g.wordCount || 1,
          confidence: g.confidence,
          x_px: px.x_px ?? '',
          y_px: px.y_px ?? '',
          w_px: px.w_px ?? '',
          h_px: px.h_px ?? '',
          x_pct: pct.x_pct ?? '',
          y_pct: pct.y_pct ?? '',
          w_pct: pct.w_pct ?? '',
          h_pct: pct.h_pct ?? '',
          pageWidth: groupedData.pageWidth || '',
          pageHeight: groupedData.pageHeight || '',
        });
      }
    }

    // ── Stage 2b: Classified tags ──
    const classifiedData = await loadJson(file.cleaned_output_key);
    const classifiedCsv = [];
    if (classifiedData?.tags) {
      const pw = classifiedData.pageWidth || 0;
      const ph = classifiedData.pageHeight || 0;
      const allItems = [...(classifiedData.tags || []), ...(classifiedData.uncertain || [])];
      for (let i = 0; i < allItems.length; i++) {
        const t = allItems[i];
        const bb = t.boundingBox || {};
        const pct = t.position_pct || {};
        classifiedCsv.push({
          index: i,
          text: t.text,
          type: t.type,
          subType: t.subType || '',
          confidence: t.confidence,
          wordIndices: (t.wordIndices || []).join(';'),
          bb_minX_px: bb.minX ?? '',
          bb_minY_px: bb.minY ?? '',
          bb_maxX_px: bb.maxX ?? '',
          bb_maxY_px: bb.maxY ?? '',
          bb_w_px: bb.maxX != null ? bb.maxX - bb.minX : '',
          bb_h_px: bb.maxY != null ? bb.maxY - bb.minY : '',
          x_pct: pct.x_pct ?? '',
          y_pct: pct.y_pct ?? '',
          w_pct: pct.w_pct ?? '',
          h_pct: pct.h_pct ?? '',
          pageWidth: pw,
          pageHeight: ph,
          isUncertain: i >= (classifiedData.tags?.length || 0),
        });
      }
    }

    // ── Stage 3: Reviewed tags ──
    const reviewData = await loadJson(file.review_output_key);
    const reviewCsv = [];
    if (reviewData) {
      const allReviewed = [
        ...(reviewData.approved || []).map(t => ({ ...t, _action: 'approved' })),
        ...(reviewData.edited || []).map(t => ({ ...t, _action: 'edited' })),
        ...(reviewData.rejected || []).map(t => ({ ...t, _action: 'rejected' })),
      ];
      for (let i = 0; i < allReviewed.length; i++) {
        const t = allReviewed[i];
        const pct = t.position_pct || t.positionPct || {};
        const bb = t.boundingBox || {};
        reviewCsv.push({
          index: i,
          text: t.text,
          type: t.type,
          reviewAction: t._action,
          confidence: t.confidence,
          has_position_pct: !!(t.position_pct || t.positionPct),
          x_pct: pct.x_pct ?? pct.xPct ?? '',
          y_pct: pct.y_pct ?? pct.yPct ?? '',
          w_pct: pct.w_pct ?? pct.wPct ?? '',
          h_pct: pct.h_pct ?? pct.hPct ?? '',
          has_boundingBox: !!t.boundingBox,
          bb_minX_px: bb.minX ?? '',
          bb_minY_px: bb.minY ?? '',
          bb_maxX_px: bb.maxX ?? '',
          bb_maxY_px: bb.maxY ?? '',
          has_pageWidth: !!(t.pageWidth || t.page_width),
          pageWidth: t.pageWidth || t.page_width || '',
          pageHeight: t.pageHeight || t.page_height || '',
        });
      }
    }

    // ── Stage 4: ocr_extraction table ──
    const ocrExtractions = file.pnid_id ? await prisma.$queryRaw`
      SELECT id, extracted_text, tag_type, confidence,
             bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
             bbox_x_px, bbox_y_px, bbox_w_px, bbox_h_px,
             matched_entity_id, status
      FROM ocr_extraction
      WHERE pnid_id = ${file.pnid_id}::uuid
      ORDER BY extracted_text
    `.catch(() => []) : [];
    const extractionCsv = ocrExtractions.map(e => ({
      id: e.id,
      text: e.extracted_text,
      type: e.tag_type,
      status: e.status,
      bbox_x_pct: Number(e.bbox_x_pct),
      bbox_y_pct: Number(e.bbox_y_pct),
      bbox_w_pct: Number(e.bbox_w_pct),
      bbox_h_pct: Number(e.bbox_h_pct),
      bbox_x_px: e.bbox_x_px,
      bbox_y_px: e.bbox_y_px,
      bbox_w_px: e.bbox_w_px,
      bbox_h_px: e.bbox_h_px,
      matchedEntityId: e.matched_entity_id || '',
      coords_are_zero: Number(e.bbox_x_pct) === 0 && Number(e.bbox_y_pct) === 0,
    }));

    // ── Stage 5: Junction tables ──
    const junctionCsv = [];
    if (file.pnid_id) {
      const eqRows = await prisma.$queryRaw`
        SELECT 'equipment' as entity_kind, e.tag as tag_text,
               pe.annotation_x_pct, pe.annotation_y_pct,
               pe.annotation_w_pct, pe.annotation_h_pct,
               pe.position_verified
        FROM pnid_equipment pe
        JOIN equipment e ON e.id = pe.equipment_id
        WHERE pe.pnid_id = ${file.pnid_id}::uuid
      `.catch(() => []);
      const instRows = await prisma.$queryRaw`
        SELECT 'instrument' as entity_kind, i.tag as tag_text,
               pi.annotation_x_pct, pi.annotation_y_pct,
               pi.annotation_w_pct, pi.annotation_h_pct,
               pi.position_verified
        FROM pnid_instrument pi
        JOIN instrument i ON i.id = pi.instrument_id
        WHERE pi.pnid_id = ${file.pnid_id}::uuid
      `.catch(() => []);
      const lineRows = await prisma.$queryRaw`
        SELECT 'line' as entity_kind, l.line_number as tag_text,
               pl.annotation_x_pct, pl.annotation_y_pct,
               null as annotation_w_pct, null as annotation_h_pct,
               null as position_verified
        FROM pnid_line pl
        JOIN line l ON l.id = pl.line_id
        WHERE pl.pnid_id = ${file.pnid_id}::uuid
      `.catch(() => []);

      for (const row of [...eqRows, ...instRows, ...lineRows]) {
        junctionCsv.push({
          entityKind: row.entity_kind,
          tagText: row.tag_text,
          annotation_x_pct: row.annotation_x_pct != null ? Number(row.annotation_x_pct) : null,
          annotation_y_pct: row.annotation_y_pct != null ? Number(row.annotation_y_pct) : null,
          annotation_w_pct: row.annotation_w_pct != null ? Number(row.annotation_w_pct) : null,
          annotation_h_pct: row.annotation_h_pct != null ? Number(row.annotation_h_pct) : null,
          positionVerified: row.position_verified,
          coords_are_zero: Number(row.annotation_x_pct || 0) === 0 && Number(row.annotation_y_pct || 0) === 0,
        });
      }
    }

    // ── Build summary ──
    const summary = {
      file: file.filename,
      drawingNumber: file.drawing_number,
      pnidId: file.pnid_id,
      storageKeys: {
        raw: file.raw_output_key || null,
        grouped: file.grouped_output_key || null,
        classified: file.cleaned_output_key || null,
        review: file.review_output_key || null,
      },
      counts: {
        rawWords: rawWordsCsv.length,
        groupedWords: groupedCsv.length,
        classifiedTags: classifiedCsv.length,
        reviewedTags: reviewCsv.length,
        ocrExtractions: extractionCsv.length,
        junctionEntries: junctionCsv.length,
      },
      coordHealth: {
        classifiedWithCoords: classifiedCsv.filter(t => t.x_pct !== '' && t.x_pct > 0).length,
        classifiedMissing: classifiedCsv.filter(t => t.x_pct === '' || t.x_pct === 0).length,
        reviewedWithCoords: reviewCsv.filter(t => t.x_pct !== '' && t.x_pct > 0).length,
        reviewedMissing: reviewCsv.filter(t => t.has_position_pct === false && t.has_boundingBox === false).length,
        extractionsWithCoords: extractionCsv.filter(e => !e.coords_are_zero).length,
        extractionsAtZero: extractionCsv.filter(e => e.coords_are_zero).length,
        junctionWithCoords: junctionCsv.filter(j => !j.coords_are_zero).length,
        junctionAtZero: junctionCsv.filter(j => j.coords_are_zero).length,
      },
    };

    if (format === 'csv') {
      // Return a multi-sheet CSV (sections separated by headers)
      const toCsvSection = (title, rows) => {
        if (!rows.length) return `\n--- ${title} --- (no data)\n`;
        const headers = Object.keys(rows[0]);
        const lines = [
          `\n--- ${title} ---`,
          headers.join(','),
          ...rows.map(r => headers.map(h => {
            const val = r[h];
            if (val == null) return '';
            const s = String(val);
            return s.includes(',') || s.includes('"') || s.includes('\n')
              ? '"' + s.replace(/"/g, '""') + '"'
              : s;
          }).join(',')),
        ];
        return lines.join('\n');
      };

      const csv = [
        `# Coordinate Trace: ${file.filename} (${file.drawing_number || 'no drawing#'})`,
        `# Generated: ${new Date().toISOString()}`,
        `# Batch: ${batchId}  File: ${fileId}`,
        `# P&ID: ${file.pnid_id || 'NOT LINKED'}`,
        toCsvSection('STAGE 1: RAW OCR WORDS (pixel + percentage coords)', rawWordsCsv),
        toCsvSection('STAGE 2a: GROUPED WORDS (pixel + percentage coords)', groupedCsv),
        toCsvSection('STAGE 2b: CLASSIFIED TAGS (pixel + percentage coords)', classifiedCsv),
        toCsvSection('STAGE 3: REVIEWED TAGS (percentage coords + boundingBox)', reviewCsv),
        toCsvSection('STAGE 4: OCR_EXTRACTION TABLE (percentage coords)', extractionCsv),
        toCsvSection('STAGE 5: JUNCTION TABLES (annotation percentage coords)', junctionCsv),
      ].join('\n');

      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="coord_trace_${file.drawing_number || fileId}.csv"`);
      return csv;
    }

    return {
      summary,
      stages: {
        rawWords: rawWordsCsv,
        groupedWords: groupedCsv,
        classifiedTags: classifiedCsv,
        reviewedTags: reviewCsv,
        ocrExtractions: extractionCsv,
        junctionEntries: junctionCsv,
      },
    };
  });

}

// ═══════════════════════════════════════════════════════════════════════════
// OCR OPTIONS RESOLVER — used by batch creation + add-files + re-run
// ═══════════════════════════════════════════════════════════════════════════

async function resolveOcrOptions(prisma, platformId, options = {}) {
  const { storageConfig, aiModel } = options;

  // 1. Read OCR provider preference from storage_config (use provided or fetch)
  let config = storageConfig;
  if (!config) {
    const configs = await prisma.$queryRaw`
      SELECT ocr_provider_preference, ai_credentials_ref, ai_model_preference,
             visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference
      FROM storage_config
      WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
         OR (scope_type = 'global' AND is_active = true)
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);
    config = configs[0];
  }

  const providerPref = config?.ocr_provider_preference || 'google';
  const ocrOptions = { ocrProvider: providerPref };

  // 1b. Resolve Paddle runtime config (env-driven for now)
  ocrOptions.paddleEndpointUrl = process.env.PADDLE_OCR_URL || '';
  ocrOptions.paddleApiKey = process.env.PADDLE_OCR_API_KEY || '';
  ocrOptions.paddleTimeoutMs = Number(process.env.PADDLE_OCR_TIMEOUT_MS || 120000);
  ocrOptions.florenceEndpointUrl = process.env.FLORENCE_OCR_URL || '';
  ocrOptions.florenceApiKey = process.env.FLORENCE_OCR_API_KEY || '';
  ocrOptions.florenceTimeoutMs = Number(process.env.FLORENCE_OCR_TIMEOUT_MS || 600000);
  ocrOptions.symbolDetectProvider = config?.visual_provider_preference || process.env.OCR_SYMBOL_PROVIDER || 'grounding_dino';
  ocrOptions.groundingEndpointUrl = process.env.GROUNDING_DINO_API_URL || config?.visual_api_url || '';
  ocrOptions.groundingApiKey = process.env.GROUNDING_DINO_API_KEY || config?.visual_api_token || process.env.TREX2_API_KEY || '';
  ocrOptions.groundingModel = config?.visual_model_preference || process.env.AI_ANNOTATE_DDS_MODEL || '';
  ocrOptions.trexEndpointUrl = process.env.TREX2_API_URL || config?.visual_api_url || '';
  ocrOptions.trexApiKey = process.env.TREX2_API_KEY || config?.visual_api_token || '';
  ocrOptions.trexModel = config?.visual_model_preference || process.env.AI_ANNOTATE_TREX_MODEL || '';
  ocrOptions.symbolBoxThreshold = Number(process.env.OCR_SYMBOL_BOX_THRESHOLD || 0.25);
  ocrOptions.symbolTextThreshold = Number(process.env.OCR_SYMBOL_TEXT_THRESHOLD || 0.2);
  ocrOptions.pdfVisualDensity = Number(process.env.OCR_SYMBOL_PDF_DENSITY || process.env.AI_ANNOTATE_PDF_DENSITY || 420);

  // 2. If Claude is needed, resolve API key and model
  if (providerPref === 'claude' || providerPref === 'both') {
    try {
      const { resolveAiCredentials } = await import('../services/ocr/AiAnalysisService.js');
      const { apiKey, model } = await resolveAiCredentials(prisma, platformId);
      ocrOptions.claudeApiKey = apiKey;
      // Use: explicit aiModel parameter → platform preference → default
      ocrOptions.claudeModel = aiModel || config?.ai_model_preference || 'claude-sonnet-4-20250514';
    } catch (err) {
      console.warn(`[resolveOcrOptions] Could not resolve Claude credentials: ${err.message}`);
      // Fall back to google if Claude key unavailable
      if (providerPref === 'claude') ocrOptions.ocrProvider = 'google';
      if (providerPref === 'both') ocrOptions.ocrProvider = 'google';
    }
  }

  // 3. If Paddle selected but endpoint missing, degrade safely to Google.
  // API handlers may still reject explicitly when user forces paddle.
  if (ocrOptions.ocrProvider === 'paddle' && !ocrOptions.paddleEndpointUrl) {
    console.warn('[resolveOcrOptions] Paddle selected but PADDLE_OCR_URL is not configured. Falling back to google.');
    ocrOptions.ocrProvider = 'google';
  }
  if (ocrOptions.ocrProvider === 'florence' && !ocrOptions.florenceEndpointUrl) {
    console.warn('[resolveOcrOptions] Florence selected but FLORENCE_OCR_URL is not configured. Falling back to google.');
    ocrOptions.ocrProvider = 'google';
  }

  return ocrOptions;
}

// ═══════════════════════════════════════════════════════════════════════════
// ASYNC BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

async function processBatchAsync(prisma, batchId, platformId, storage, ocrOptions = {}) {
  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 1 ONLY: Raw OCR Extraction
  // Downloads each file, sends to OCR provider, saves raw JSON to storage.
  // Does NOT create P&ID records, classify, match, or import to DB.
  // ═══════════════════════════════════════════════════════════════════════

  // Mark batch as Stage 1 processing
  await prisma.$queryRaw`
    UPDATE ocr_batch SET
      current_stage = 'extraction',
      stage1_status = 'processing',
      ocr_provider_used = ${ocrOptions.ocrProvider || 'google'},
      ai_model_used = ${ocrOptions.claudeModel || null}
    WHERE id = ${batchId}::uuid
  `;

  const pendingFiles = await prisma.$queryRaw`
    SELECT id, storage_key, filename, drawing_number, revision
    FROM ocr_batch_file
    WHERE batch_id = ${batchId}::uuid AND status = 'pending'
    ORDER BY created_at
  `;

  let processedCount = 0;
  let failedCount = 0;
  const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');

  // Resolve vision credentials once for the whole batch
  let visionCreds = storage.config?.vision_credentials_ref || storage.config?.credentials_json || storage.config?.credentials_ref;
  if (!visionCreds) {
    const [platformCfg] = await prisma.$queryRaw`
      SELECT vision_credentials_ref, credentials_ref
      FROM storage_config
      WHERE (scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true)
         OR (scope_type = 'global' AND is_active = true)
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);
    visionCreds = platformCfg?.vision_credentials_ref || platformCfg?.credentials_ref || null;
  }

  for (const file of pendingFiles) {
    try {
      // Check if batch was cancelled
      const [batchCheck] = await prisma.$queryRaw`
        SELECT status FROM ocr_batch WHERE id = ${batchId}::uuid
      `;
      if (batchCheck?.status === 'failed' || batchCheck?.status === 'cancelled') {
        console.log(`[Stage1] Batch ${batchId} was cancelled — stopping.`);
        break;
      }

      // Mark file as processing
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET status = 'processing' WHERE id = ${file.id}::uuid
      `;

      console.log(`[Stage1] Processing file: ${file.filename} (provider: ${ocrOptions.ocrProvider || 'google'})`);

      // Run Stage 1: raw OCR extraction only
      const rawResult = await runStage1_Extract(storage, file.storage_key, {
        credentialsJson: visionCreds,
        ...ocrOptions,
      });

      // Save raw result as JSON to storage
      const providerKey = (rawResult.provider || ocrOptions.ocrProvider || 'google').toLowerCase();
      const rawOutputKey = `ocr-stages/${batchId}/raw/${file.filename.replace(/\.[^.]+$/, '')}_raw_${providerKey}_${runStamp}.json`;
      const rawJson = JSON.stringify(rawResult, null, 2);
      const rawBuffer = Buffer.from(rawJson, 'utf-8');

      await storage.upload(rawBuffer, rawOutputKey, {
        contentType: 'application/json',
        metadata: {
          batchId,
          stage: 'raw',
          provider: rawResult.provider,
          sourceFile: file.storage_key,
        },
      });

      console.log(`[Stage1] Saved raw OCR: ${rawOutputKey} (${rawResult.words.length} words)`);

      // Update batch file record with raw output path AND raw OCR data
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          status = 'completed',
          raw_output_key = ${rawOutputKey},
          raw_ocr_data = ${JSON.stringify(rawResult)}::jsonb,
          word_count = ${rawResult.words?.length || 0},
          tags_found = ${rawResult.words?.length || 0},
          completed_at = NOW()
        WHERE id = ${file.id}::uuid
      `;

      processedCount++;
    } catch (err) {
      console.error(`[Stage1] Failed to process file ${file.filename}:`, err.message);
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          status = 'failed',
          error_message = ${err.message}
        WHERE id = ${file.id}::uuid
      `;
      failedCount++;
    }

    // Update batch progress
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        processed_files = ${processedCount},
        failed_files = ${failedCount}
      WHERE id = ${batchId}::uuid
    `;
  }

  // Finalize Stage 1
  const finalStatus = failedCount === pendingFiles.length ? 'failed'
    : failedCount > 0 ? 'partial'
    : 'completed';

  const stage1Status = failedCount === pendingFiles.length ? 'failed'
    : failedCount > 0 ? 'partial'
    : 'completed';

  await prisma.$queryRaw`
    UPDATE ocr_batch SET
      status = ${finalStatus},
      current_stage = 'extraction',
      stage1_status = ${stage1Status},
      processed_files = ${processedCount},
      failed_files = ${failedCount},
      completed_at = NOW()
    WHERE id = ${batchId}::uuid
  `;

  console.log(`[Stage1] Batch ${batchId} complete: ${processedCount} processed, ${failedCount} failed. Stage1=${stage1Status}`);
}

async function persistCandidateLedger(prisma, file, classifiedResult = {}) {
  try {
    if (!file?.ocr_job_id || !file?.pnid_id) return { inserted: 0, skipped: 'missing_job_or_pnid' };
    const ledger = Array.isArray(classifiedResult?.candidateLedger)
      ? classifiedResult.candidateLedger
      : Array.isArray(classifiedResult?.coverageReport?.candidateLedger)
        ? classifiedResult.coverageReport.candidateLedger
        : [];
    if (!ledger.length) return { inserted: 0, skipped: 'empty_ledger' };

    await prisma.$executeRaw`
      DELETE FROM ocr_candidate_ledger
      WHERE ocr_job_id = ${file.ocr_job_id}::uuid
        AND pnid_id = ${file.pnid_id}::uuid
        AND extraction_stage = 'stage2'
    `;

    let inserted = 0;
    for (const row of ledger) {
      const textRaw = String(row?.text || row?.text_raw || '').trim();
      const textNorm = String(row?.text_normalized || textRaw).trim().toUpperCase();
      if (!textNorm) continue;

      await prisma.$executeRaw`
        INSERT INTO ocr_candidate_ledger (
          ocr_job_id, pnid_id, extraction_stage,
          candidate_text_raw, candidate_text_norm, candidate_type,
          source, source_stage, assembly_rule, assembly_score,
          word_indices, bbox,
          confidence_det, confidence_ai, confidence_final,
          terminal_outcome, reason_code, reason_detail,
          superseded_by_candidate_id
        ) VALUES (
          ${file.ocr_job_id}::uuid,
          ${file.pnid_id}::uuid,
          'stage2',
          ${textRaw},
          ${textNorm},
          ${String(row?.type || 'unknown')},
          ${String(row?.source || 'structured')},
          'S2_POST',
          ${row?.assembly_rule || null},
          ${row?.assembly_score != null ? Number(row.assembly_score) : null},
          ${JSON.stringify(row?.word_indices || row?.token_word_indices || [])}::jsonb,
          ${row?.bbox ? JSON.stringify(row.bbox) : null}::jsonb,
          ${row?.confidence_det != null ? Number(row.confidence_det) : null},
          ${row?.confidence_ai != null ? Number(row.confidence_ai) : null},
          ${Number(row?.confidence_final || 0.5)},
          ${String(row?.terminal_outcome || 'rejected')},
          ${String(row?.reason_code || 'REJECT_ASSEMBLY_CONFLICT')},
          ${row?.reason_detail || null},
          ${row?.superseded_by_candidate_id || null}
        )
      `;
      inserted++;
    }
    return { inserted };
  } catch (err) {
    return { inserted: 0, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2 ASYNC PROCESSOR — AI Classify (Groups + Classifies + Filters)
// ═══════════════════════════════════════════════════════════════════════════

async function runStage2AiAsync(prisma, batchId, storage, aiOptions) {
  const {
    apiKey,
    model,
    platformCode,
    platformName,
    tagDictionary,
    learnedPatterns = [],
    zoneProfiles = [],
    phaseProfile = 'phase3_full_rescue',
    includeGroupedCandidatesInPrompt = true,
    enableDeterministicPromotion = true,
    enableCoverageRescue = true,
  } = aiOptions;

  // Get files that have raw output
  const files = await prisma.$queryRaw`
    SELECT id, filename, drawing_number, raw_output_key, pnid_id, ocr_job_id
    FROM ocr_batch_file
    WHERE batch_id = ${batchId}::uuid AND raw_output_key IS NOT NULL
    ORDER BY created_at
  `;

  // Initialize progress tracking
  stage2Progress.set(batchId, { status: 'processing', startedAt: Date.now(), phaseProfile, files: {} });
  for (const f of files) {
    updateProgress(batchId, f.id, { filename: f.filename, status: 'pending', chunk: 0, totalChunks: 0, tags: 0, noise: 0, message: 'Waiting...' });
  }

  let processedCount = 0;
  let failedCount = 0;
  let totalTags = 0;

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    try {
      updateProgress(batchId, file.id, { status: 'downloading', message: `Downloading raw OCR (file ${fileIdx + 1}/${files.length})...` });

      // Download raw JSON from Stage 1
      const downloaded = await storage.download(file.raw_output_key);
      const buffer = downloaded.buffer || downloaded;
      const rawData = JSON.parse(buffer.toString('utf-8'));
      const wordCount = rawData.words?.length || 0;

      updateProgress(batchId, file.id, { status: 'processing', message: `Classifying ${wordCount} words...`, words: wordCount });

      // Run AI classify with progress callback
      const classifiedResult = await runStage2_AiClassify(rawData, {
        apiKey,
        model,
        drawingNumber: file.drawing_number || file.filename,
        platformCode,
        platformName,
        tagDictionary,
        learnedPatterns,
        zoneProfiles,
        phaseProfile,
        includeGroupedCandidatesInPrompt,
        enableDeterministicPromotion,
        enableCoverageRescue,
        onChunkProgress: (progressPayload, totalChunksLegacy, tagsLegacy, noiseLegacy) => {
          const payload = typeof progressPayload === 'object'
            ? progressPayload
            : {
                phase: 'chunk_done',
                chunk: Number(progressPayload) || 0,
                totalChunks: Number(totalChunksLegacy) || 0,
                tagsSoFar: Number(tagsLegacy) || 0,
                noiseSoFar: Number(noiseLegacy) || 0,
              };

          const chunk = payload.chunk || 0;
          const totalChunks = payload.totalChunks || 0;
          const tags = payload.tagsSoFar ?? payload.chunkTags ?? 0;
          const noise = payload.noiseSoFar ?? payload.chunkNoise ?? 0;
          const uncertain = payload.uncertainSoFar ?? payload.chunkUncertain ?? 0;
          const phase = payload.phase || 'chunk_done';
          const chunkTokensIn = payload.chunkInputTokens || 0;
          const chunkTokensOut = payload.chunkOutputTokens || 0;
          const callMs = payload.latencyMs || 0;
          const retryCount = payload.retries || 0;

          let message = `Chunk ${chunk}/${totalChunks} — tags:${tags} noise:${noise}`;
          if (phase === 'chunk_prepare') {
            message = `Preparing chunk ${chunk}/${totalChunks} (${payload.chunkWords || 0} words)`;
          } else if (phase === 'ai_call') {
            message = `Calling AI for chunk ${chunk}/${totalChunks} (${payload.chunkWords || 0} words)`;
          } else if (phase === 'rate_limited') {
            message = `Rate limited on chunk ${chunk}/${totalChunks}; retry ${retryCount} in ${payload.retryWaitMs || 0}ms`;
          } else if (phase === 'chunk_done') {
            message = `Chunk ${chunk}/${totalChunks} done: +${payload.chunkTags || 0} tags, +${payload.chunkNoise || 0} noise, +${payload.chunkUncertain || 0} uncertain (${callMs}ms)`;
          }

          updateProgress(batchId, file.id, {
            phase,
            chunk,
            totalChunks,
            chunkWords: payload.chunkWords || 0,
            chunkStartWordIndex: payload.chunkStartWordIndex ?? null,
            chunkEndWordIndex: payload.chunkEndWordIndex ?? null,
            tags,
            noise,
            uncertain,
            chunkTags: payload.chunkTags || 0,
            chunkNoise: payload.chunkNoise || 0,
            chunkUncertain: payload.chunkUncertain || 0,
            inputTokensSoFar: payload.inputTokensSoFar || 0,
            outputTokensSoFar: payload.outputTokensSoFar || 0,
            chunkInputTokens: chunkTokensIn,
            chunkOutputTokens: chunkTokensOut,
            latencyMs: callMs,
            retries: retryCount,
            message,
          });
        },
      });

      // Save classified result to storage
      const classifiedOutputKey = `ocr-stages/${batchId}/classified/${file.filename.replace(/\.[^.]+$/, '')}_classified.json`;
      const classifiedJson = JSON.stringify(classifiedResult, null, 2);
      const classifiedBuffer = Buffer.from(classifiedJson, 'utf-8');

      updateProgress(batchId, file.id, { message: 'Uploading results...' });

      await storage.upload(classifiedBuffer, classifiedOutputKey, {
        contentType: 'application/json',
        metadata: { batchId, stage: 'classified', model, sourceFile: file.raw_output_key },
      });

      const tagCount = classifiedResult.tags?.length || 0;
      totalTags += tagCount;

      const ledgerPersist = await persistCandidateLedger(prisma, file, classifiedResult);

      // Update file record
      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          cleaned_output_key = ${classifiedOutputKey},
          tags_found = ${tagCount},
          tags_matched = ${classifiedResult.stats?.equipmentCount || 0},
          stage2_phase_profile = ${phaseProfile},
          error_message = NULL
        WHERE id = ${file.id}::uuid
      `;

      updateProgress(batchId, file.id, {
        status: 'completed',
        tags: tagCount,
        noise: classifiedResult.noise?.length || 0,
        uncertain: classifiedResult.uncertain?.length || 0,
        continuationReferences: classifiedResult.continuationReferences?.length || 0,
        candidateUniverse: classifiedResult.coverageReport?.candidateUniverseCount || 0,
        keptCandidates: classifiedResult.coverageReport?.keptCount || 0,
        uncertainCandidates: classifiedResult.coverageReport?.uncertainCount || 0,
        rejectedCandidates: classifiedResult.coverageReport?.rejectedCount || 0,
        ledgerInserted: ledgerPersist.inserted || 0,
        autoApproveCount: classifiedResult.stats?.automation?.autoApproveCount || 0,
        humanReviewCount: classifiedResult.stats?.automation?.humanReviewCount || 0,
        autoRejectCount: classifiedResult.stats?.automation?.autoRejectCount || 0,
        deterministicRecoveredCount: classifiedResult.stats?.deterministicRecoveredCount || 0,
        coverageRescuedCount: classifiedResult.stats?.coverageRescuedCount || 0,
        message: `Done — ${tagCount} tags, ${classifiedResult.noise?.length || 0} noise, ${classifiedResult.continuationReferences?.length || 0} continuation refs`,
        tokens: classifiedResult.tokens,
      });

      processedCount++;
      console.log(`[Stage2 AI] ✓ ${file.filename}: ${tagCount} tags (${classifiedResult.tokens?.input || 0} in / ${classifiedResult.tokens?.output || 0} out)`);
    } catch (err) {
      console.error(`[Stage2 AI] ✗ ${file.filename}:`, err.message);

      updateProgress(batchId, file.id, {
        status: 'failed',
        message: `Error: ${err.message.substring(0, 100)}`,
      });

      await prisma.$queryRaw`
        UPDATE ocr_batch_file SET
          error_message = ${`Stage 2 AI: ${err.message}`}
        WHERE id = ${file.id}::uuid
      `.catch(() => {});

      failedCount++;
    }
  }

  // Finalize Stage 2
  const stage2Status = failedCount === files.length ? 'failed'
    : failedCount > 0 ? 'partial'
    : 'completed';

  await prisma.$queryRaw`
    UPDATE ocr_batch SET
      status = ${stage2Status},
      current_stage = 'classify',
      stage2_status = ${stage2Status},
      ai_model_used = ${model},
      completed_at = CASE
        WHEN ${stage2Status} IN ('completed', 'partial', 'failed') THEN NOW()
        ELSE completed_at
      END
    WHERE id = ${batchId}::uuid
  `;

  finishBatchProgress(batchId, stage2Status);
  console.log(`[Stage2 AI] Batch ${batchId} complete: ${processedCount} classified (${totalTags} total tags), ${failedCount} failed. Stage2=${stage2Status}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2 MULTI-BATCH ASYNC PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

async function runStage2MultiAsync(prisma, batches, selectionMap, storage, aiOptions) {
  const {
    apiKey,
    model,
    platformCode,
    platformName,
    tagDictionary,
    learnedPatterns = [],
    zoneProfiles = [],
    phaseProfile = 'phase3_full_rescue',
    includeGroupedCandidatesInPrompt = true,
    enableDeterministicPromotion = true,
    enableCoverageRescue = true,
  } = aiOptions;

  for (const batch of batches) {
    const batchId = batch.id;
    const fileFilter = selectionMap[batchId]; // Set of fileIds or null (all)

    // Get files with raw output
    const allFiles = await prisma.$queryRaw`
      SELECT id, filename, drawing_number, raw_output_key, pnid_id, ocr_job_id
      FROM ocr_batch_file
      WHERE batch_id = ${batchId}::uuid AND raw_output_key IS NOT NULL
      ORDER BY created_at
    `;

    // Apply file selection filter
    const files = fileFilter
      ? allFiles.filter(f => fileFilter.has(f.id))
      : allFiles;

    // Initialize per-batch live progress so UI can show event log while processing.
    stage2Progress.set(batchId, { status: 'processing', startedAt: Date.now(), phaseProfile, files: {} });
    for (const f of files) {
      updateProgress(batchId, f.id, {
        filename: f.filename,
        status: 'pending',
        chunk: 0,
        totalChunks: 0,
        tags: 0,
        noise: 0,
        message: 'Waiting...',
      });
    }

    let processedCount = 0;
    let failedCount = 0;
    let totalTags = 0;

    for (const file of files) {
      try {
        console.log(`[Stage2 Multi] Classifying: ${file.filename} (batch: ${batchId.slice(0, 8)}, model: ${model})`);
        updateProgress(batchId, file.id, { status: 'downloading', message: 'Downloading raw OCR...' });

        const downloaded = await storage.download(file.raw_output_key);
        const buffer = downloaded.buffer || downloaded;
        const rawData = JSON.parse(buffer.toString('utf-8'));
        const wordCount = rawData.words?.length || 0;
        updateProgress(batchId, file.id, { status: 'processing', words: wordCount, message: `Classifying ${wordCount} words...` });

        const classifiedResult = await runStage2_AiClassify(rawData, {
          apiKey,
          model,
          drawingNumber: file.drawing_number || file.filename,
          platformCode,
          platformName,
          tagDictionary,
          learnedPatterns,
          zoneProfiles,
          phaseProfile,
          includeGroupedCandidatesInPrompt,
          enableDeterministicPromotion,
          enableCoverageRescue,
          onChunkProgress: (progressPayload, totalChunksLegacy, tagsLegacy, noiseLegacy) => {
            const payload = typeof progressPayload === 'object'
              ? progressPayload
              : {
                  phase: 'chunk_done',
                  chunk: Number(progressPayload) || 0,
                  totalChunks: Number(totalChunksLegacy) || 0,
                  tagsSoFar: Number(tagsLegacy) || 0,
                  noiseSoFar: Number(noiseLegacy) || 0,
                };
            const chunk = payload.chunk || 0;
            const totalChunks = payload.totalChunks || 0;
            const tags = payload.tagsSoFar ?? payload.chunkTags ?? 0;
            const noise = payload.noiseSoFar ?? payload.chunkNoise ?? 0;
            const uncertain = payload.uncertainSoFar ?? payload.chunkUncertain ?? 0;
            const phase = payload.phase || 'chunk_done';
            let message = `Chunk ${chunk}/${totalChunks} — tags:${tags} noise:${noise}`;
            if (phase === 'chunk_prepare') {
              message = `Preparing chunk ${chunk}/${totalChunks} (${payload.chunkWords || 0} words)`;
            } else if (phase === 'ai_call') {
              message = `Calling AI for chunk ${chunk}/${totalChunks} (${payload.chunkWords || 0} words)`;
            } else if (phase === 'chunk_done') {
              message = `Chunk ${chunk}/${totalChunks} done: +${payload.chunkTags || 0} tags, +${payload.chunkNoise || 0} noise, +${payload.chunkUncertain || 0} uncertain`;
            }
            updateProgress(batchId, file.id, {
              phase,
              chunk,
              totalChunks,
              tags,
              noise,
              uncertain,
              chunkTags: payload.chunkTags || 0,
              chunkNoise: payload.chunkNoise || 0,
              chunkUncertain: payload.chunkUncertain || 0,
              chunkInputTokens: payload.chunkInputTokens || 0,
              chunkOutputTokens: payload.chunkOutputTokens || 0,
              latencyMs: payload.latencyMs || 0,
              retries: payload.retries || 0,
              message,
            });
          },
        });

        const classifiedOutputKey = `ocr-stages/${batchId}/classified/${file.filename.replace(/\.[^.]+$/, '')}_classified.json`;
        const classifiedJson = JSON.stringify(classifiedResult, null, 2);
        const classifiedBuffer = Buffer.from(classifiedJson, 'utf-8');
        updateProgress(batchId, file.id, { message: 'Uploading results...' });

        await storage.upload(classifiedBuffer, classifiedOutputKey, {
          contentType: 'application/json',
          metadata: { batchId, stage: 'classified', model, sourceFile: file.raw_output_key },
        });

        const tagCount = classifiedResult.tags?.length || 0;
        totalTags += tagCount;
        const ledgerPersist = await persistCandidateLedger(prisma, file, classifiedResult);

        await prisma.$queryRaw`
          UPDATE ocr_batch_file SET
            cleaned_output_key = ${classifiedOutputKey},
            tags_found = ${tagCount},
            tags_matched = ${classifiedResult.stats?.equipmentCount || 0},
            stage2_phase_profile = ${phaseProfile}
          WHERE id = ${file.id}::uuid
        `;

        updateProgress(batchId, file.id, {
          status: 'completed',
          tags: tagCount,
          noise: classifiedResult.noise?.length || 0,
          uncertain: classifiedResult.uncertain?.length || 0,
          continuationReferences: classifiedResult.continuationReferences?.length || 0,
          candidateUniverse: classifiedResult.coverageReport?.candidateUniverseCount || 0,
          keptCandidates: classifiedResult.coverageReport?.keptCount || 0,
          uncertainCandidates: classifiedResult.coverageReport?.uncertainCount || 0,
          rejectedCandidates: classifiedResult.coverageReport?.rejectedCount || 0,
          ledgerInserted: ledgerPersist.inserted || 0,
          autoApproveCount: classifiedResult.stats?.automation?.autoApproveCount || 0,
          humanReviewCount: classifiedResult.stats?.automation?.humanReviewCount || 0,
          autoRejectCount: classifiedResult.stats?.automation?.autoRejectCount || 0,
          deterministicRecoveredCount: classifiedResult.stats?.deterministicRecoveredCount || 0,
          coverageRescuedCount: classifiedResult.stats?.coverageRescuedCount || 0,
          message: `Done — ${tagCount} tags, ${classifiedResult.noise?.length || 0} noise, ${classifiedResult.continuationReferences?.length || 0} continuation refs`,
          tokens: classifiedResult.tokens,
        });

        processedCount++;
        console.log(`[Stage2 Multi] Done: ${file.filename} (${tagCount} tags)`);
      } catch (err) {
        console.error(`[Stage2 Multi] Failed: ${file.filename}:`, err.message);
        updateProgress(batchId, file.id, {
          status: 'failed',
          message: `Error: ${String(err.message || 'Unknown error').substring(0, 100)}`,
        });
        await prisma.$queryRaw`
          UPDATE ocr_batch_file SET error_message = ${`Stage 2 AI: ${err.message}`}
          WHERE id = ${file.id}::uuid
        `.catch(() => {});
        failedCount++;
      }
    }

    // Finalize this batch
    const stage2Status = files.length === 0 ? 'completed'
      : failedCount === files.length ? 'failed'
      : failedCount > 0 ? 'partial'
      : 'completed';

    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        status = ${stage2Status},
        current_stage = 'classify',
        stage2_status = ${stage2Status},
        ai_model_used = ${model},
        completed_at = CASE
          WHEN ${stage2Status} IN ('completed', 'partial', 'failed') THEN NOW()
          ELSE completed_at
        END
      WHERE id = ${batchId}::uuid
    `;

    finishBatchProgress(batchId, stage2Status);

    console.log(`[Stage2 Multi] Batch ${batchId.slice(0, 8)} complete: ${processedCount}/${files.length} classified (${totalTags} tags). Status=${stage2Status}`);
  }

  console.log(`[Stage2 Multi] All ${batches.length} batches processed.`);
}

// Helper: update batch-level stage3 status based on file review statuses
async function updateBatchStage3Status(prisma, batchId) {
  const files = await prisma.$queryRaw`
    SELECT review_status, cleaned_output_key
    FROM ocr_batch_file
    WHERE batch_id = ${batchId}::uuid AND cleaned_output_key IS NOT NULL
  `;

  if (files.length === 0) return;

  const completed = files.filter(f => f.review_status === 'completed').length;
  const partial = files.filter(f => f.review_status === 'partial').length;

  let stage3Status;
  if (completed === files.length) {
    stage3Status = 'completed';
  } else if (completed > 0 || partial > 0) {
    stage3Status = 'partial';
  } else {
    stage3Status = 'pending';
  }

  await prisma.$executeRaw`
    UPDATE ocr_batch SET
      stage3_status = ${stage3Status},
      current_stage = CASE WHEN ${stage3Status} = 'completed' THEN 'review' ELSE current_stage END
    WHERE id = ${batchId}::uuid
  `;
}

// Helper: walk local directory
async function walkDir(dir, basePath) {
  const fs = await import('fs/promises');
  const path = await import('path');
  const files = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkDir(fullPath, basePath));
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        files.push({
          key: path.relative(basePath, fullPath).replace(/\\/g, '/'),
          size: stat.size,
          updated: stat.mtime.toISOString(),
        });
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return files;
}
