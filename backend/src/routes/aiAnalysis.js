/**
 * AI Analysis Routes — Trigger analysis, browse entities, approve/reject, import/export.
 */
import prisma from '../db.js';
import { runAiAnalysis, approveAiEntity } from '../services/ocr/AiAnalysisService.js';
import { importCleanedData, parseCsvToRecords } from '../services/ocr/CleanedDataImporter.js';
import { createDraftAnnotationsFromOcr } from '../services/canvasGeneration/aiAssistance.js';
import { getStorageProvider } from '../services/storage/index.js';
import { runOcrPipeline } from '../services/ocr/OcrPipeline.js';

export default async function aiAnalysisRoutes(fastify) {

  // ═══ POST /ai-analysis/batches/:batchId/analyze — Trigger AI analysis ═══
  fastify.post('/ai-analysis/batches/:batchId/analyze', async (request, reply) => {
    const { batchId } = request.params;
    const { analysisType, apiKey } = request.body || {};

    if (!batchId || batchId === 'null' || batchId === 'undefined') {
      return reply.status(400).send({ error: 'batchId is required' });
    }

    try {
      // Run asynchronously — don't block the response
      const promise = runAiAnalysis(prisma, batchId, { analysisType, apiKey });

      // For short batches, wait up to 2s for inline result
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), 2000));
      const result = await Promise.race([promise, timeout]);

      if (result) {
        return reply.status(200).send({
          success: true,
          jobId: result.jobId,
          message: 'AI analysis completed',
        });
      }

      // Still processing — let it continue in background
      promise.catch(err => {
        console.error(`AI analysis for batch ${batchId} failed:`, err.message);
      });

      // Get the job ID from the DB
      const [job] = await prisma.$queryRaw`
        SELECT id FROM ai_analysis_job
        WHERE batch_id = ${batchId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `;

      return reply.status(202).send({
        success: true,
        jobId: job?.id,
        message: 'AI analysis started — processing in background',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `AI analysis failed: ${err.message}` });
    }
  });

  // ═══ GET /ai-analysis/jobs/:jobId — Job status ═══
  fastify.get('/ai-analysis/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params;

    const [job] = await prisma.$queryRaw`
      SELECT j.*, p.code AS platform_code, p.name AS platform_name,
             b.batch_name
      FROM ai_analysis_job j
      JOIN platform p ON p.id = j.platform_id
      JOIN ocr_batch b ON b.id = j.batch_id
      WHERE j.id = ${jobId}::uuid
    `;

    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // Count entities
    const [counts] = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE entity_type = 'system')::int AS systems,
        COUNT(*) FILTER (WHERE entity_type = 'line')::int AS lines,
        COUNT(*) FILTER (WHERE entity_type = 'equipment')::int AS equipment,
        COUNT(*) FILTER (WHERE entity_type = 'instrument')::int AS instruments,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
      FROM ai_generated_entity
      WHERE analysis_job_id = ${jobId}::uuid
    `;

    const [relCounts] = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS total
      FROM ai_relationship WHERE analysis_job_id = ${jobId}::uuid
    `;

    return {
      job: {
        id: job.id,
        batchId: job.batch_id,
        batchName: job.batch_name,
        platformCode: job.platform_code,
        platformName: job.platform_name,
        status: job.status,
        analysisType: job.analysis_type,
        aiModel: job.ai_model,
        summaryText: job.summary_text,
        inputTokens: job.input_token_count,
        outputTokens: job.output_token_count,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        errorMessage: job.error_message,
      },
      entityCounts: counts,
      relationshipCount: relCounts?.total || 0,
    };
  });

  // ═══ GET /ai-analysis/jobs/:jobId/entities — List entities ═══
  fastify.get('/ai-analysis/jobs/:jobId/entities', async (request, reply) => {
    const { jobId } = request.params;
    const { entity_type, status, min_confidence } = request.query;

    let entities = await prisma.$queryRaw`
      SELECT id, entity_type, suggested_tag, suggested_data, source_pnid_ids,
             confidence, status, merged_entity_id, reviewed_by, reviewed_at, created_at
      FROM ai_generated_entity
      WHERE analysis_job_id = ${jobId}::uuid
      ORDER BY entity_type, suggested_tag
    `;

    if (entity_type) entities = entities.filter(e => e.entity_type === entity_type);
    if (status) entities = entities.filter(e => e.status === status);
    if (min_confidence) entities = entities.filter(e => Number(e.confidence) >= parseFloat(min_confidence));

    return {
      entities: entities.map(e => ({
        id: e.id,
        entityType: e.entity_type,
        suggestedTag: e.suggested_tag,
        suggestedData: e.suggested_data,
        sourcePnidIds: e.source_pnid_ids,
        confidence: Number(e.confidence),
        status: e.status,
        mergedEntityId: e.merged_entity_id,
        reviewedBy: e.reviewed_by,
        reviewedAt: e.reviewed_at,
      })),
      total: entities.length,
    };
  });

  // ═══ GET /ai-analysis/jobs/:jobId/relationships — List relationships ═══
  fastify.get('/ai-analysis/jobs/:jobId/relationships', async (request, reply) => {
    const { jobId } = request.params;

    const relationships = await prisma.$queryRaw`
      SELECT id, from_entity_type, from_entity_tag, from_entity_id,
             to_entity_type, to_entity_tag, to_entity_id,
             relationship_type, pnid_id, confidence, status
      FROM ai_relationship
      WHERE analysis_job_id = ${jobId}::uuid
      ORDER BY relationship_type, from_entity_tag
    `;

    return {
      relationships: relationships.map(r => ({
        id: r.id,
        fromType: r.from_entity_type,
        fromTag: r.from_entity_tag,
        fromEntityId: r.from_entity_id,
        toType: r.to_entity_type,
        toTag: r.to_entity_tag,
        toEntityId: r.to_entity_id,
        type: r.relationship_type,
        pnidId: r.pnid_id,
        confidence: Number(r.confidence),
        status: r.status,
      })),
      total: relationships.length,
    };
  });

  // ═══ GET /ai-analysis/jobs/:jobId/summary — Summary with stats ═══
  fastify.get('/ai-analysis/jobs/:jobId/summary', async (request, reply) => {
    const { jobId } = request.params;

    const [job] = await prisma.$queryRaw`
      SELECT summary_text, relationships, status, ai_model,
             input_token_count, output_token_count, completed_at
      FROM ai_analysis_job WHERE id = ${jobId}::uuid
    `;

    if (!job) return reply.status(404).send({ error: 'Job not found' });

    return {
      summary: job.summary_text,
      relationships: job.relationships,
      status: job.status,
      aiModel: job.ai_model,
      tokens: { input: job.input_token_count, output: job.output_token_count },
      completedAt: job.completed_at,
    };
  });

  // ═══ POST /ai-analysis/entities/:entityId/approve — Approve entity ═══
  fastify.post('/ai-analysis/entities/:entityId/approve', async (request, reply) => {
    const { entityId } = request.params;

    try {
      const result = await approveAiEntity(prisma, entityId);
      return { success: true, mergedEntityId: result.mergedEntityId };
    } catch (err) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ═══ POST /ai-analysis/entities/bulk-approve — Bulk approve ═══
  fastify.post('/ai-analysis/entities/bulk-approve', async (request, reply) => {
    const { jobId, entityType, minConfidence = 0.7, entityIds } = request.body;

    let entitiesToApprove;

    if (entityIds?.length) {
      entitiesToApprove = await prisma.$queryRaw`
        SELECT id FROM ai_generated_entity
        WHERE id = ANY(${entityIds}::uuid[]) AND status = 'draft'
      `;
    } else if (jobId) {
      let query = `
        SELECT id FROM ai_generated_entity
        WHERE analysis_job_id = '${jobId}'::uuid
          AND status = 'draft'
          AND confidence >= ${minConfidence}
      `;
      if (entityType) query += ` AND entity_type = '${entityType}'`;
      entitiesToApprove = await prisma.$queryRawUnsafe(query);
    } else {
      return reply.status(400).send({ error: 'jobId or entityIds required' });
    }

    let approved = 0;
    const errors = [];

    for (const entity of entitiesToApprove) {
      try {
        await approveAiEntity(prisma, entity.id);
        approved++;
      } catch (err) {
        errors.push({ entityId: entity.id, error: err.message });
      }
    }

    return { success: true, approved, errors };
  });

  // ═══ POST /ai-analysis/entities/:entityId/reject — Reject entity ═══
  fastify.post('/ai-analysis/entities/:entityId/reject', async (request, reply) => {
    const { entityId } = request.params;

    await prisma.$queryRaw`
      UPDATE ai_generated_entity SET
        status = 'rejected', reviewed_by = 'admin', reviewed_at = NOW()
      WHERE id = ${entityId}::uuid AND status = 'draft'
    `;

    return { success: true };
  });

  // ═══ POST /ai-analysis/entities/:entityId/edit — Edit entity before approval ═══
  fastify.post('/ai-analysis/entities/:entityId/edit', async (request, reply) => {
    const { entityId } = request.params;
    const { suggestedData, suggestedTag } = request.body;

    if (suggestedData) {
      await prisma.$queryRaw`
        UPDATE ai_generated_entity SET suggested_data = ${JSON.stringify(suggestedData)}::jsonb
        WHERE id = ${entityId}::uuid AND status = 'draft'
      `;
    }
    if (suggestedTag) {
      await prisma.$queryRaw`
        UPDATE ai_generated_entity SET suggested_tag = ${suggestedTag}
        WHERE id = ${entityId}::uuid AND status = 'draft'
      `;
    }

    return { success: true };
  });

  // ═══ POST /ai-analysis/batches/:batchId/import-cleaned — Upload cleaned data ═══
  fastify.post('/ai-analysis/batches/:batchId/import-cleaned', async (request, reply) => {
    const { batchId } = request.params;
    const { records, csvText, format } = request.body;

    let parsedRecords = records;
    if (!parsedRecords && csvText) {
      parsedRecords = parseCsvToRecords(csvText);
    }
    if (!parsedRecords?.length) {
      return reply.status(400).send({ error: 'No records provided. Send { records: [...] } or { csvText: "..." }' });
    }

    // Archive the uploaded data to storage before processing
    let storageKey = null;
    try {
      const [batch] = await prisma.$queryRaw`
        SELECT b.platform_id, p.code AS platform_code
        FROM ocr_batch b JOIN platform p ON p.id = b.platform_id
        WHERE b.id = ${batchId}::uuid
      `;
      if (batch) {
        const storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
        const rawContent = csvText || JSON.stringify(records, null, 2);
        const ext = csvText ? 'csv' : 'json';
        storageKey = `${batch.platform_code}/ocr/imports/cleaned_${batchId.slice(0, 8)}_${Date.now()}.${ext}`;
        await storage.upload(storageKey, Buffer.from(rawContent, 'utf-8'), {
          contentType: csvText ? 'text/csv' : 'application/json',
        });
      }
    } catch (err) {
      // Archive is best-effort — continue with import
      fastify.log.warn(`Could not archive import to storage: ${err.message}`);
    }

    try {
      const result = await importCleanedData(prisma, batchId, parsedRecords, format);
      return { success: true, ...result, archivedTo: storageKey };
    } catch (err) {
      return reply.status(500).send({ error: `Import failed: ${err.message}` });
    }
  });

  // ═══ GET /ai-analysis/batches/:batchId/export-for-cleaning — Export for external cleaning ═══
  fastify.get('/ai-analysis/batches/:batchId/export-for-cleaning', async (request, reply) => {
    const { batchId } = request.params;
    const { format = 'json' } = request.query;

    // Get batch + platform info
    const [batch] = await prisma.$queryRaw`
      SELECT b.id, b.platform_id, p.code AS platform_code
      FROM ocr_batch b
      JOIN platform p ON p.id = b.platform_id
      WHERE b.id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Get batch files
    const files = await prisma.$queryRaw`
      SELECT bf.pnid_id, bf.drawing_number, bf.filename
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid AND bf.pnid_id IS NOT NULL
    `;

    const pnidIds = files.filter(f => f.pnid_id).map(f => f.pnid_id);

    let extractions = [];
    if (pnidIds.length > 0) {
      extractions = await prisma.$queryRaw`
        SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.tag_type, oe.confidence,
               oe.bbox_x_pct, oe.bbox_y_pct, oe.bbox_w_pct, oe.bbox_h_pct,
               oe.matched_entity_id, oe.match_confidence, oe.match_method, oe.status
        FROM ocr_extraction oe
        WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
        ORDER BY oe.pnid_id, oe.tag_type, oe.extracted_text
      `;
    }

    // Get AI suggestions if available
    let aiEntities = [];
    const analysisRows = await prisma.$queryRaw`
      SELECT id FROM ai_analysis_job WHERE batch_id = ${batchId}::uuid ORDER BY created_at DESC LIMIT 1
    `.catch(() => []);
    if (analysisRows?.length > 0) {
      aiEntities = await prisma.$queryRaw`
        SELECT suggested_tag, entity_type, suggested_data, confidence, status
        FROM ai_generated_entity WHERE analysis_job_id = ${analysisRows[0].id}::uuid
      `;
    }

    // Map pnid_id to drawing number
    const pnidToDrawing = {};
    for (const f of files) {
      if (f.pnid_id) pnidToDrawing[f.pnid_id] = f.drawing_number;
    }

    const result = {
      batchId,
      exportedAt: new Date().toISOString(),
      extractions: extractions.map(e => ({
        drawingNumber: pnidToDrawing[e.pnid_id] || '',
        pnidId: e.pnid_id,
        extractedText: e.extracted_text,
        tagType: e.tag_type,
        confidence: Number(e.confidence),
        bboxXPct: Number(e.bbox_x_pct),
        bboxYPct: Number(e.bbox_y_pct),
        bboxWPct: Number(e.bbox_w_pct),
        bboxHPct: Number(e.bbox_h_pct),
        matchedEntityId: e.matched_entity_id,
        matchConfidence: Number(e.match_confidence),
        matchMethod: e.match_method,
        status: e.status,
      })),
      aiSuggestions: aiEntities.map(e => ({
        suggestedTag: e.suggested_tag,
        entityType: e.entity_type,
        suggestedData: e.suggested_data,
        confidence: Number(e.confidence),
        status: e.status,
      })),
    };

    // Build file content
    let fileContent;
    let filename;
    const ext = format === 'csv' ? 'csv' : 'json';

    if (format === 'csv') {
      const headers = ['drawing_number', 'extracted_text', 'tag_type', 'confidence', 'status',
        'bbox_x_pct', 'bbox_y_pct', 'bbox_w_pct', 'bbox_h_pct'];
      const rows = [headers.join(',')];
      for (const e of result.extractions) {
        rows.push([e.drawingNumber, `"${e.extractedText}"`, e.tagType, e.confidence, e.status,
          e.bboxXPct, e.bboxYPct, e.bboxWPct, e.bboxHPct].join(','));
      }
      fileContent = rows.join('\n');
    } else {
      fileContent = JSON.stringify(result, null, 2);
    }

    filename = `ocr_cleaning_${batchId.slice(0, 8)}_${Date.now()}.${ext}`;

    // Persist export to storage for audit trail
    let downloadUrl = null;
    try {
      const storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
      const storageKey = `${batch.platform_code}/ocr/exports/${filename}`;
      await storage.upload(storageKey, Buffer.from(fileContent, 'utf-8'), {
        contentType: format === 'csv' ? 'text/csv' : 'application/json',
      });
      downloadUrl = await storage.getUrl(storageKey);
    } catch (err) {
      // Storage persistence is best-effort — still return the data inline
      fastify.log.warn(`Could not persist export to storage: ${err.message}`);
    }

    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      if (downloadUrl) reply.header('X-Storage-Url', downloadUrl);
      return reply.send(fileContent);
    }

    return { ...result, storageUrl: downloadUrl };
  });

  // ═══ GET /ai-analysis/batches/:batchId/browse — Aggregated tag browser ═══
  fastify.get('/ai-analysis/batches/:batchId/browse', async (request, reply) => {
    const { batchId } = request.params;
    const { entity_type } = request.query;

    const files = await prisma.$queryRaw`
      SELECT bf.pnid_id, bf.drawing_number
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid AND bf.pnid_id IS NOT NULL
    `;

    const pnidIds = files.filter(f => f.pnid_id).map(f => f.pnid_id);

    let extractions = [];
    if (pnidIds.length > 0) {
      extractions = await prisma.$queryRaw`
        SELECT oe.extracted_text, oe.tag_type, oe.confidence, oe.status,
               oe.matched_entity_id, oe.match_confidence
        FROM ocr_extraction oe
        WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
        ORDER BY oe.tag_type, oe.extracted_text
      `;
    }

    if (entity_type) {
      extractions = extractions.filter(e => e.tag_type === entity_type);
    }

    // Aggregate: unique tags with counts
    const tagMap = new Map();
    for (const ext of extractions) {
      const key = ext.extracted_text;
      if (!tagMap.has(key)) {
        tagMap.set(key, {
          tag: ext.extracted_text,
          tagType: ext.tag_type,
          confidence: Number(ext.confidence),
          isMatched: !!ext.matched_entity_id,
          matchConfidence: Number(ext.match_confidence || 0),
          status: ext.status,
          occurrences: 0,
        });
      }
      tagMap.get(key).occurrences++;
    }

    return {
      tags: [...tagMap.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
      total: tagMap.size,
      byType: {
        equipment: [...tagMap.values()].filter(t => t.tagType === 'equipment').length,
        instrument: [...tagMap.values()].filter(t => t.tagType === 'instrument').length,
        line: [...tagMap.values()].filter(t => t.tagType === 'line').length,
        unknown: [...tagMap.values()].filter(t => t.tagType === 'unknown').length,
      },
    };
  });

  // ═══ POST /ai-analysis/pnids/:pnidId/auto-annotate — Create draft Konva annotations ═══
  fastify.post('/ai-analysis/pnids/:pnidId/auto-annotate', async (request, reply) => {
    const { pnidId } = request.params;

    try {
      const result = await createDraftAnnotationsFromOcr(prisma, pnidId);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(500).send({ error: `Auto-annotate failed: ${err.message}` });
    }
  });

  // ═══ POST /ai-analysis/batches/:batchId/auto-annotate — Batch auto-annotate ═══
  fastify.post('/ai-analysis/batches/:batchId/auto-annotate', async (request, reply) => {
    const { batchId } = request.params;

    const [batch] = await prisma.$queryRaw`
      SELECT id, status, passed_to_annotation, ai_cleanup_status
      FROM ocr_batch WHERE id = ${batchId}::uuid
    `;
    if (!batch) {
      return reply.status(404).send({ error: 'Batch not found' });
    }
    if (batch.status !== 'completed' && batch.status !== 'partial') {
      return reply.status(409).send({
        error: 'Batch must be completed or partial before auto-annotate.',
        nextStep: 'complete_ocr',
      });
    }
    if (batch.ai_cleanup_status !== 'completed') {
      return reply.status(409).send({
        error: 'AI cleanup must complete before auto-annotate.',
        nextStep: 'complete_ai_cleanup',
        aiCleanupStatus: batch.ai_cleanup_status,
      });
    }
    if (!batch.passed_to_annotation) {
      return reply.status(409).send({
        error: 'Use "Pass to Annotation" first, then run auto-annotate.',
        nextStep: 'pass_to_annotation',
      });
    }

    const files = await prisma.$queryRaw`
      SELECT bf.pnid_id FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
        AND bf.pnid_id IS NOT NULL AND bf.status = 'completed'
    `;

    let totalCreated = 0;
    const errors = [];

    for (const file of files) {
      try {
        const result = await createDraftAnnotationsFromOcr(prisma, file.pnid_id);
        totalCreated += result.created || 0;
      } catch (err) {
        errors.push({ pnidId: file.pnid_id, error: err.message });
      }
    }

    return {
      success: true,
      pnidsProcessed: files.length,
      annotationsCreated: totalCreated,
      errors,
    };
  });

  // ═══ GET /ai-analysis/batches/:batchId/data-check — Check extraction readiness ═══
  fastify.get('/ai-analysis/batches/:batchId/data-check', async (request, reply) => {
    const { batchId } = request.params;

    // Get batch files with pnid linkage
    const batchFiles = await prisma.$queryRaw`
      SELECT bf.id, bf.pnid_id, bf.drawing_number, bf.filename, bf.status
      FROM ocr_batch_file bf
      WHERE bf.batch_id = ${batchId}::uuid
      ORDER BY bf.drawing_number, bf.filename
    `;

    if (batchFiles.length === 0) {
      return { files: [], summary: { total: 0, ready: 0, needsOcr: 0, noPnid: 0 } };
    }

    // Get extraction counts per pnid
    const pnidIds = batchFiles.filter(f => f.pnid_id).map(f => f.pnid_id);
    let extractionCounts = [];
    if (pnidIds.length > 0) {
      extractionCounts = await prisma.$queryRaw`
        SELECT pnid_id, COUNT(*)::int AS count
        FROM ocr_extraction
        WHERE pnid_id = ANY(${pnidIds}::uuid[])
        GROUP BY pnid_id
      `;
    }
    const countMap = new Map(extractionCounts.map(e => [e.pnid_id, e.count]));

    const files = batchFiles.map(f => {
      const extractionCount = f.pnid_id ? (countMap.get(f.pnid_id) || 0) : 0;
      let status = 'needs_ocr';
      if (!f.pnid_id) status = 'no_pnid';
      else if (extractionCount > 0) status = 'ready';
      else if (f.status === 'failed') status = 'failed';

      return {
        id: f.id,
        pnidId: f.pnid_id,
        drawingNumber: f.drawing_number,
        filename: f.filename,
        batchFileStatus: f.status,
        extractionCount,
        status,
      };
    });

    return {
      files,
      summary: {
        total: files.length,
        ready: files.filter(f => f.status === 'ready').length,
        needsOcr: files.filter(f => f.status === 'needs_ocr').length,
        noPnid: files.filter(f => f.status === 'no_pnid').length,
        failed: files.filter(f => f.status === 'failed').length,
      },
    };
  });

  // ═══ POST /ai-analysis/batches/:batchId/reprocess — Re-run OCR for batch files ═══
  fastify.post('/ai-analysis/batches/:batchId/reprocess', async (request, reply) => {
    const { batchId } = request.params;
    const { fileIds } = request.body || {};

    // Get batch info
    const [batch] = await prisma.$queryRaw`
      SELECT b.id, b.platform_id FROM ocr_batch b WHERE b.id = ${batchId}::uuid
    `;
    if (!batch) return reply.status(404).send({ error: 'Batch not found' });

    // Get storage provider
    let storage;
    try {
      storage = await getStorageProvider(prisma, { platformId: batch.platform_id });
    } catch (err) {
      return reply.status(400).send({ error: `No storage configured: ${err.message}` });
    }

    // Get files to reprocess
    let filesToProcess;
    if (fileIds?.length) {
      filesToProcess = await prisma.$queryRaw`
        SELECT bf.id, bf.pnid_id, bf.drawing_number, bf.filename
        FROM ocr_batch_file bf
        WHERE bf.batch_id = ${batchId}::uuid AND bf.id = ANY(${fileIds}::uuid[])
          AND bf.pnid_id IS NOT NULL
      `;
    } else {
      filesToProcess = await prisma.$queryRaw`
        SELECT bf.id, bf.pnid_id, bf.drawing_number, bf.filename
        FROM ocr_batch_file bf
        WHERE bf.batch_id = ${batchId}::uuid AND bf.pnid_id IS NOT NULL
      `;
    }

    if (filesToProcess.length === 0) {
      return reply.status(400).send({ error: 'No files with linked P&IDs to reprocess' });
    }

    // Get Vision credentials from storage config
    const credConfigs = await prisma.$queryRaw`
      SELECT vision_credentials_ref, credentials_ref
      FROM storage_config
      WHERE scope_type = 'platform' AND scope_id = ${batch.platform_id}::uuid AND is_active = true
      LIMIT 1
    `.catch(() => []);
    let credentialsJson = credConfigs[0]?.vision_credentials_ref || credConfigs[0]?.credentials_ref;
    if (!credentialsJson) {
      const globalConfigs = await prisma.$queryRaw`
        SELECT vision_credentials_ref, credentials_ref
        FROM storage_config
        WHERE scope_type = 'global' AND is_active = true
        LIMIT 1
      `.catch(() => []);
      credentialsJson = globalConfigs[0]?.vision_credentials_ref || globalConfigs[0]?.credentials_ref;
    }

    // Return immediately, process in background
    reply.status(202).send({
      success: true,
      message: `Reprocessing ${filesToProcess.length} files in background`,
      fileCount: filesToProcess.length,
    });

    // Background processing
    const results = { processed: 0, failed: 0, errors: [] };
    for (const file of filesToProcess) {
      try {
        console.log(`[Reprocess] Running OCR for pnid ${file.pnid_id} (${file.drawing_number})`);
        await runOcrPipeline(prisma, file.pnid_id, storage, { credentialsJson });

        // Update batch file status
        await prisma.$queryRaw`
          UPDATE ocr_batch_file SET status = 'completed' WHERE id = ${file.id}::uuid
        `;
        results.processed++;
      } catch (err) {
        console.error(`[Reprocess] Failed for ${file.drawing_number}: ${err.message}`);
        await prisma.$queryRaw`
          UPDATE ocr_batch_file SET status = 'failed', error_message = ${err.message}
          WHERE id = ${file.id}::uuid
        `;
        results.failed++;
        results.errors.push({ fileId: file.id, error: err.message });
      }
    }

    console.log(`[Reprocess] Done: ${results.processed} processed, ${results.failed} failed`);
  });
}
