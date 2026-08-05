/**
 * OCR register staging — queue approved review tags, then apply pnid_* links.
 */
import prisma from '../db.js';
import {
  buildRegisterStagingFromBatches,
  listRegisterStagingItems,
  cancelRegisterStagingItems,
  applyRegisterStaging,
} from '../services/ocr/registerStagingService.js';
import { getStorageProvider } from '../services/storage/index.js';
import { syncBatchReviewToOcrExtractions } from '../services/ocr/reviewSyncToExtractions.js';

function mapItem(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    batchName: row.batch_name,
    batchFileId: row.batch_file_id,
    pnidId: row.pnid_id,
    entityKind: row.entity_kind,
    actionType: row.action_type,
    extractionId: row.extraction_id,
    matchedEntityId: row.matched_entity_id,
    payload: row.payload,
    status: row.status,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    applyRunId: row.apply_run_id,
    matchedEntityTag: row.matched_entity_tag || null,
  };
}

export default async function ocrRegisterStagingRoutes(fastify) {
  fastify.post('/ocr-pipeline/platforms/:platformId/register-staging/from-batches', async (request, reply) => {
    const { platformId } = request.params;
    const { batchIds, entityKinds } = request.body || {};

    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      return reply.status(400).send({ error: 'batchIds array required' });
    }

    try {
      const result = await buildRegisterStagingFromBatches(prisma, platformId, { batchIds, entityKinds });
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(400).send({ error: err.message || 'Failed to build staging' });
    }
  });

  fastify.get('/ocr-pipeline/platforms/:platformId/register-staging/items', async (request, reply) => {
    const { platformId } = request.params;
    const { status, batchId, entityKind, limit } = request.query || {};

    try {
      const { items, counts } = await listRegisterStagingItems(prisma, platformId, {
        status: status || undefined,
        batchId: batchId || undefined,
        entityKind: entityKind || undefined,
        limit: limit ? Number(limit) : 2000,
      });
      return {
        items: items.map(mapItem),
        counts,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'List failed' });
    }
  });

  fastify.post('/ocr-pipeline/platforms/:platformId/register-staging/apply', async (request, reply) => {
    const { platformId } = request.params;
    const { stagingItemIds, applyAllPending, entityKinds, appliedBy, passToAnnotation } = request.body || {};

    try {
      const result = await applyRegisterStaging(prisma, platformId, {
        stagingItemIds: Array.isArray(stagingItemIds) ? stagingItemIds : undefined,
        applyAllPending: !!applyAllPending,
        entityKinds: Array.isArray(entityKinds) ? entityKinds : undefined,
        appliedBy: appliedBy || 'user',
        passToAnnotation: !!passToAnnotation,
      });
      return result;
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Apply failed' });
    }
  });

  fastify.post('/ocr-pipeline/platforms/:platformId/register-staging/cancel', async (request, reply) => {
    const { platformId } = request.params;
    const { stagingItemIds } = request.body || {};

    if (!Array.isArray(stagingItemIds) || stagingItemIds.length === 0) {
      return reply.status(400).send({ error: 'stagingItemIds array required' });
    }

    try {
      return await cancelRegisterStagingItems(prisma, platformId, stagingItemIds);
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Cancel failed' });
    }
  });

  // ═══ GET /register-staging/traceability/:itemId — Full origin trail for a staging item ═══
  fastify.get('/ocr-pipeline/platforms/:platformId/register-staging/traceability/:itemId', async (request, reply) => {
    const { platformId, itemId } = request.params;

    try {
      // 1. Get the staging item
      const [item] = await prisma.$queryRaw`
        SELECT rsi.*, ob.batch_name, obf.drawing_number AS file_drawing_number
        FROM register_staging_item rsi
        LEFT JOIN ocr_batch ob ON ob.id = rsi.batch_id
        LEFT JOIN ocr_batch_file obf ON obf.id = rsi.batch_file_id
        WHERE rsi.id = ${itemId}::uuid AND rsi.platform_id = ${platformId}::uuid
      `;
      if (!item) return reply.status(404).send({ error: 'Staging item not found' });

      // 2. Get OCR extraction (if linked)
      let extraction = null;
      if (item.extraction_id) {
        const [ext] = await prisma.$queryRaw`
          SELECT oe.id, oe.extracted_text, oe.tag_type, oe.confidence, oe.match_confidence,
                 oe.match_method, oe.status AS extraction_status,
                 oe.bbox_x_pct, oe.bbox_y_pct, oe.bbox_w_pct, oe.bbox_h_pct,
                 oe.linked_annotation_id, oe.reviewed_by, oe.reviewed_at,
                 oj.id AS job_id, oj.status AS job_status, oj.started_at AS job_started_at,
                 oj.completed_at AS job_completed_at
          FROM ocr_extraction oe
          LEFT JOIN ocr_job oj ON oj.pnid_id = oe.pnid_id
          WHERE oe.id = ${item.extraction_id}::uuid
          ORDER BY oj.completed_at DESC NULLS LAST
          LIMIT 1
        `;
        extraction = ext || null;
      }

      // 3. Get P&ID info
      let pnid = null;
      if (item.pnid_id) {
        const [p] = await prisma.$queryRaw`
          SELECT id, drawing_number, title, revision, status
          FROM pnid WHERE id = ${item.pnid_id}::uuid
        `;
        pnid = p || null;
      }

      // 4. Get the matched/created entity from the register
      let entity = null;
      if (item.matched_entity_id) {
        if (item.entity_kind === 'line') {
          const [e] = await prisma.$queryRaw`
            SELECT l.id, l.line_number AS tag, 'line' AS kind, l.service, l.nominal_size,
                   s.code AS system_code, s.name AS system_name
            FROM line l JOIN system s ON s.id = l.system_id
            WHERE l.id = ${item.matched_entity_id}::uuid
          `;
          entity = e || null;
        } else if (item.entity_kind === 'equipment') {
          const [e] = await prisma.$queryRaw`
            SELECT e.id, e.tag, 'equipment' AS kind, e.equipment_type, e.description,
                   s.code AS system_code, s.name AS system_name
            FROM equipment e JOIN system s ON s.id = e.system_id
            WHERE e.id = ${item.matched_entity_id}::uuid
          `;
          entity = e || null;
        } else if (item.entity_kind === 'instrument') {
          const [e] = await prisma.$queryRaw`
            SELECT i.id, i.tag, 'instrument' AS kind, i.instrument_type, i.description,
                   s.code AS system_code, s.name AS system_name
            FROM instrument i JOIN system s ON s.id = i.system_id
            WHERE i.id = ${item.matched_entity_id}::uuid
          `;
          entity = e || null;
        } else if (item.entity_kind === 'system') {
          const [e] = await prisma.$queryRaw`
            SELECT id, code AS tag, 'system' AS kind, name, sys_type AS system_type
            FROM system WHERE id = ${item.matched_entity_id}::uuid
          `;
          entity = e || null;
        }
      }

      // 5. Get annotation (if extraction has linked_annotation_id)
      let annotation = null;
      if (extraction?.linked_annotation_id) {
        const [ann] = await prisma.$queryRaw`
          SELECT id, x_pct, y_pct, w_pct, h_pct, label, color, shape,
                 linked_entity_type, linked_entity_id, status, approval_status,
                 created_at
          FROM annotation WHERE id = ${extraction.linked_annotation_id}::uuid
        `;
        annotation = ann || null;
      }

      // 6. Get junction table position (current state)
      let junctionPosition = null;
      if (item.matched_entity_id && item.pnid_id) {
        if (item.entity_kind === 'equipment') {
          const [j] = await prisma.$queryRaw`
            SELECT annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct, position_verified
            FROM pnid_equipment WHERE pnid_id = ${item.pnid_id}::uuid AND equipment_id = ${item.matched_entity_id}::uuid
          `;
          junctionPosition = j || null;
        } else if (item.entity_kind === 'instrument') {
          const [j] = await prisma.$queryRaw`
            SELECT annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct, position_verified
            FROM pnid_instrument WHERE pnid_id = ${item.pnid_id}::uuid AND instrument_id = ${item.matched_entity_id}::uuid
          `;
          junctionPosition = j || null;
        } else if (item.entity_kind === 'line') {
          const [j] = await prisma.$queryRaw`
            SELECT annotation_x_pct, annotation_y_pct
            FROM pnid_line WHERE pnid_id = ${item.pnid_id}::uuid AND line_id = ${item.matched_entity_id}::uuid
          `;
          junctionPosition = j || null;
        }
      }

      // 7. Get change_log entries
      let changeLogs = [];
      if (item.matched_entity_id) {
        changeLogs = await prisma.$queryRaw`
          SELECT action, changes, source, created_by, created_at
          FROM change_log
          WHERE entity_id = ${item.matched_entity_id}::uuid
          ORDER BY created_at DESC
          LIMIT 10
        `;
      }

      // 8. Get apply run info
      let applyRun = null;
      if (item.apply_run_id) {
        const [run] = await prisma.$queryRaw`
          SELECT id, applied_by, summary, created_at
          FROM register_apply_run WHERE id = ${item.apply_run_id}::uuid
        `;
        applyRun = run || null;
      }

      return {
        stagingItem: {
          id: item.id,
          entityKind: item.entity_kind,
          actionType: item.action_type,
          status: item.status,
          payload: item.payload,
          createdAt: item.created_at,
          appliedAt: item.applied_at,
          batchName: item.batch_name,
          drawingNumber: item.file_drawing_number,
        },
        extraction: extraction ? {
          id: extraction.id,
          text: extraction.extracted_text,
          tagType: extraction.tag_type,
          confidence: Number(extraction.confidence),
          matchConfidence: Number(extraction.match_confidence),
          matchMethod: extraction.match_method,
          status: extraction.extraction_status,
          bbox: {
            xPct: Number(extraction.bbox_x_pct),
            yPct: Number(extraction.bbox_y_pct),
            wPct: Number(extraction.bbox_w_pct),
            hPct: Number(extraction.bbox_h_pct),
          },
          linkedAnnotationId: extraction.linked_annotation_id,
          reviewedBy: extraction.reviewed_by,
          reviewedAt: extraction.reviewed_at,
          ocrJob: extraction.job_id ? {
            id: extraction.job_id,
            status: extraction.job_status,
            startedAt: extraction.job_started_at,
            completedAt: extraction.job_completed_at,
          } : null,
        } : null,
        pnid: pnid ? {
          id: pnid.id,
          drawingNumber: pnid.drawing_number,
          title: pnid.title,
          revision: pnid.revision,
          status: pnid.status,
        } : null,
        entity,
        annotation: annotation ? {
          id: annotation.id,
          position: {
            xPct: Number(annotation.x_pct),
            yPct: Number(annotation.y_pct),
            wPct: Number(annotation.w_pct),
            hPct: Number(annotation.h_pct),
          },
          label: annotation.label,
          color: annotation.color,
          linkedEntityType: annotation.linked_entity_type,
          status: annotation.status,
          approvalStatus: annotation.approval_status,
          createdAt: annotation.created_at,
        } : null,
        junctionPosition: junctionPosition ? {
          xPct: Number(junctionPosition.annotation_x_pct),
          yPct: Number(junctionPosition.annotation_y_pct),
          wPct: junctionPosition.annotation_w_pct ? Number(junctionPosition.annotation_w_pct) : null,
          hPct: junctionPosition.annotation_h_pct ? Number(junctionPosition.annotation_h_pct) : null,
          positionVerified: junctionPosition.position_verified,
        } : null,
        applyRun: applyRun ? {
          id: applyRun.id,
          appliedBy: applyRun.applied_by,
          summary: applyRun.summary,
          createdAt: applyRun.created_at,
        } : null,
        changeLogs: changeLogs.map(cl => ({
          action: cl.action,
          changes: cl.changes,
          source: cl.source,
          createdBy: cl.created_by,
          createdAt: cl.created_at,
        })),
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Traceability query failed' });
    }
  });

  // ═══ POST /register-staging/repair-links — Create missing junction table entries ═══
  // For applied staging items that were created without pnid_id, this:
  // 1. Resolves pnid_id by matching batch file drawing_number to pnid records
  // 2. Creates missing pnid_system entries
  // 3. Creates missing pnid_line, pnid_equipment, pnid_instrument junction entries
  fastify.post('/ocr-pipeline/platforms/:platformId/register-staging/repair-links', async (request, reply) => {
    const { platformId } = request.params;

    try {
      let systemsLinked = 0;
      let linesLinked = 0;
      let equipmentLinked = 0;
      let instrumentsLinked = 0;
      let coordsFound = 0;
      let pnidSystemsCreated = 0;
      let batchFilesResolved = 0;

      // Step 1: Resolve pnid_id on batch files by matching drawing_number or filename
      const batchFiles = await prisma.$queryRaw`
        SELECT bf.id, bf.drawing_number, bf.storage_key, bf.pnid_id, bf.batch_id
        FROM ocr_batch_file bf
        JOIN ocr_batch ob ON ob.id = bf.batch_id
        WHERE ob.platform_id = ${platformId}::uuid
          AND bf.pnid_id IS NULL
      `;

      for (const bf of batchFiles) {
        let pnidId = null;
        // Try exact drawing_number match
        if (bf.drawing_number) {
          const [match] = await prisma.$queryRaw`
            SELECT p.id FROM pnid p
            LEFT JOIN pnid_system ps ON ps.pnid_id = p.id
            LEFT JOIN system s ON s.id = ps.system_id
            WHERE p.deleted_at IS NULL
              AND (
                LOWER(TRIM(p.drawing_number)) = LOWER(TRIM(${bf.drawing_number}))
                OR p.drawing_number LIKE ${'%' + bf.drawing_number + '%'}
              )
            LIMIT 1
          `.catch(() => []);
          if (match) pnidId = match.id;
        }
        // Try filename stem match
        if (!pnidId && bf.storage_key) {
          const stem = bf.storage_key.split('/').pop()?.replace(/\.[^.]+$/, '');
          if (stem) {
            const [match] = await prisma.$queryRaw`
              SELECT p.id FROM pnid p
              WHERE p.deleted_at IS NULL
                AND (
                  LOWER(TRIM(p.drawing_number)) = LOWER(TRIM(${stem}))
                  OR p.storage_key LIKE ${'%' + stem + '%'}
                )
              LIMIT 1
            `.catch(() => []);
            if (match) pnidId = match.id;
          }
        }
        if (pnidId) {
          await prisma.$executeRaw`
            UPDATE ocr_batch_file SET pnid_id = ${pnidId}::uuid WHERE id = ${bf.id}::uuid
          `.catch(() => {});
          batchFilesResolved++;
        }
      }

      // Step 2: Backfill pnid_id on staging items from resolved batch files
      await prisma.$executeRaw`
        UPDATE register_staging_item rsi
        SET pnid_id = bf.pnid_id, updated_at = NOW()
        FROM ocr_batch_file bf
        WHERE rsi.batch_file_id = bf.id
          AND rsi.platform_id = ${platformId}::uuid
          AND rsi.pnid_id IS NULL
          AND bf.pnid_id IS NOT NULL
      `.catch(() => {});

      // Step 2b: Sync review JSONs → ocr_extraction (ensures bbox coordinates exist)
      let extractionsSynced = 0;
      const allBatches = await prisma.$queryRaw`
        SELECT DISTINCT ob.id FROM ocr_batch ob
        JOIN ocr_batch_file bf ON bf.batch_id = ob.id
        WHERE ob.platform_id = ${platformId}::uuid
          AND bf.review_output_key IS NOT NULL
      `.catch(() => []);
      for (const b of allBatches) {
        try {
          const syncResult = await syncBatchReviewToOcrExtractions(prisma, b.id);
          extractionsSynced += (syncResult.upserted || 0) + (syncResult.updated || 0);
        } catch { /* batch sync failed, continue */ }
      }

      // Step 3: Get all applied staging items that now have pnid_id
      const appliedItems = await prisma.$queryRaw`
        SELECT rsi.id, rsi.entity_kind, rsi.action_type, rsi.matched_entity_id, rsi.pnid_id,
               rsi.payload, rsi.extraction_id
        FROM register_staging_item rsi
        WHERE rsi.platform_id = ${platformId}::uuid
          AND rsi.status = 'applied'
          AND rsi.pnid_id IS NOT NULL
          AND rsi.matched_entity_id IS NOT NULL
      `;

      // Step 4: Ensure pnid_system entries exist for all involved systems
      const systemIds = new Set();
      for (const item of appliedItems) {
        // Get the system_id from the entity
        let sysId = null;
        if (item.entity_kind === 'line') {
          const [row] = await prisma.$queryRaw`SELECT system_id FROM line WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
          sysId = row?.system_id;
        } else if (item.entity_kind === 'equipment') {
          const [row] = await prisma.$queryRaw`SELECT system_id FROM equipment WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
          sysId = row?.system_id;
        } else if (item.entity_kind === 'instrument') {
          const [row] = await prisma.$queryRaw`SELECT system_id FROM instrument WHERE id = ${item.matched_entity_id}::uuid`.catch(() => []);
          sysId = row?.system_id;
        }
        if (sysId) systemIds.add(`${sysId}::${item.pnid_id}`);
      }

      // Create pnid_system entries
      for (const key of systemIds) {
        const [sysId, pnidId] = key.split('::');
        const ins = await prisma.$queryRaw`
          INSERT INTO pnid_system (pnid_id, system_id, is_primary)
          VALUES (${pnidId}::uuid, ${sysId}::uuid, false)
          ON CONFLICT (pnid_id, system_id) DO NOTHING
          RETURNING id
        `.catch(() => []);
        if (ins?.length) pnidSystemsCreated++;
      }

      // Step 5: Build a tag→position map from review JSONs for accurate coordinates
      let storageProvider;
      try {
        storageProvider = await getStorageProvider(prisma, { platformId });
      } catch { storageProvider = null; }

      // Load review JSONs and build a map: normalized_tag_text → position_pct
      const tagPositionMap = new Map(); // key: "tagText::pnid_id" → { x_pct, y_pct, w_pct, h_pct }
      if (storageProvider) {
        const reviewFiles = await prisma.$queryRaw`
          SELECT bf.id, bf.pnid_id, bf.review_output_key
          FROM ocr_batch_file bf
          JOIN ocr_batch ob ON ob.id = bf.batch_id
          WHERE ob.platform_id = ${platformId}::uuid
            AND bf.review_output_key IS NOT NULL
            AND bf.pnid_id IS NOT NULL
        `.catch(() => []);

        // Helper to extract position from a tag object
        const extractPos = (tag) => {
          const pos = tag.position_pct || tag.positionPct;
          if (pos && (pos.x_pct || pos.xPct)) {
            return {
              x_pct: Number(pos.x_pct ?? pos.xPct ?? 0),
              y_pct: Number(pos.y_pct ?? pos.yPct ?? 0),
              w_pct: Number(pos.w_pct ?? pos.wPct ?? 0),
              h_pct: Number(pos.h_pct ?? pos.hPct ?? 0),
            };
          }
          // Also try boundingBox + pageWidth/Height
          const bb = tag.boundingBox;
          const pw = tag.pageWidth || tag.page_width;
          const ph = tag.pageHeight || tag.page_height;
          if (bb && pw && ph && bb.minX != null) {
            return {
              x_pct: +((bb.minX / pw) * 100).toFixed(2),
              y_pct: +((bb.minY / ph) * 100).toFixed(2),
              w_pct: +(((bb.maxX - bb.minX) / pw) * 100).toFixed(2),
              h_pct: +(((bb.maxY - bb.minY) / ph) * 100).toFixed(2),
            };
          }
          return null;
        };

        const addTagToMap = (tag, pnidId) => {
          const pos = extractPos(tag);
          if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) return;
          const text = (tag.text || '').trim().toLowerCase();
          if (!text) return;
          const key = `${text}::${pnidId}`;
          if (!tagPositionMap.has(key)) tagPositionMap.set(key, pos);
        };

        // Source A: Review JSONs (approved + edited tags)
        for (const rf of reviewFiles) {
          try {
            const downloaded = await storageProvider.download(rf.review_output_key);
            const buf = downloaded.buffer || downloaded;
            const reviewJson = JSON.parse(buf.toString('utf-8'));
            for (const tag of [...(reviewJson.approved || []), ...(reviewJson.edited || [])]) {
              addTagToMap(tag, rf.pnid_id);
            }
          } catch { /* skip unreadable review files */ }
        }

        // Source B: Stage 2/3 classified/cleaned JSONs (if review didn't have positions)
        const classifiedFiles = await prisma.$queryRaw`
          SELECT bf.id, bf.pnid_id, bf.cleaned_output_key
          FROM ocr_batch_file bf
          JOIN ocr_batch ob ON ob.id = bf.batch_id
          WHERE ob.platform_id = ${platformId}::uuid
            AND bf.cleaned_output_key IS NOT NULL
            AND bf.pnid_id IS NOT NULL
        `.catch(() => []);

        for (const cf of classifiedFiles) {
          try {
            const downloaded = await storageProvider.download(cf.cleaned_output_key);
            const buf = downloaded.buffer || downloaded;
            const classifiedJson = JSON.parse(buf.toString('utf-8'));
            for (const tag of [...(classifiedJson.tags || []), ...(classifiedJson.uncertain || [])]) {
              addTagToMap(tag, cf.pnid_id);
            }
          } catch { /* skip unreadable classified files */ }
        }
      }

      // Step 6: Create/update junction entries with accurate coordinates
      for (const item of appliedItems) {
        // Try multiple sources for coordinates:
        // 1. Review JSON position_pct (most accurate — from OCR bounding boxes)
        // 2. ocr_extraction bbox (synced from OCR stage data)
        // 3. Staging payload position_pct
        const tagText = (item.payload?.tagText || '').trim().toLowerCase();
        let pos = tagPositionMap.get(`${tagText}::${item.pnid_id}`);

        // Fallback: try ocr_extraction table
        if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) {
          if (item.extraction_id) {
            const [ex] = await prisma.$queryRaw`
              SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
              FROM ocr_extraction WHERE id = ${item.extraction_id}::uuid
            `.catch(() => []);
            if (ex && (Number(ex.bbox_x_pct) > 0 || Number(ex.bbox_y_pct) > 0)) {
              pos = { x_pct: Number(ex.bbox_x_pct), y_pct: Number(ex.bbox_y_pct), w_pct: Number(ex.bbox_w_pct), h_pct: Number(ex.bbox_h_pct) };
            }
          }
          // Also try matching by text in ocr_extraction
          if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) {
            const [ex] = await prisma.$queryRaw`
              SELECT bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
              FROM ocr_extraction
              WHERE pnid_id = ${item.pnid_id}::uuid
                AND LOWER(TRIM(extracted_text)) = ${tagText}
                AND bbox_x_pct > 0
              LIMIT 1
            `.catch(() => []);
            if (ex) {
              pos = { x_pct: Number(ex.bbox_x_pct), y_pct: Number(ex.bbox_y_pct), w_pct: Number(ex.bbox_w_pct), h_pct: Number(ex.bbox_h_pct) };
            }
          }
        }

        // Final fallback: staging payload
        if (!pos || (pos.x_pct === 0 && pos.y_pct === 0)) {
          const payloadPos = item.payload?.position_pct || {};
          pos = {
            x_pct: Number(payloadPos.x_pct || payloadPos.xPct || 0),
            y_pct: Number(payloadPos.y_pct || payloadPos.yPct || 0),
            w_pct: Number(payloadPos.w_pct || payloadPos.wPct || 0),
            h_pct: Number(payloadPos.h_pct || payloadPos.hPct || 0),
          };
        }

        // Only update if we have non-zero coordinates
        const hasCoords = pos.x_pct > 0 || pos.y_pct > 0;

        if (item.entity_kind === 'line') {
          const ins = hasCoords
            ? await prisma.$queryRaw`
                INSERT INTO pnid_line (pnid_id, line_id, is_continuation, annotation_x_pct, annotation_y_pct)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid, false, ${pos.x_pct}, ${pos.y_pct})
                ON CONFLICT (pnid_id, line_id) DO UPDATE SET annotation_x_pct = ${pos.x_pct}, annotation_y_pct = ${pos.y_pct}
                RETURNING id
              `.catch(() => [])
            : await prisma.$queryRaw`
                INSERT INTO pnid_line (pnid_id, line_id, is_continuation)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid, false)
                ON CONFLICT (pnid_id, line_id) DO NOTHING
                RETURNING id
              `.catch(() => []);
          if (ins?.length) linesLinked++;
        } else if (item.entity_kind === 'equipment') {
          const ins = hasCoords
            ? await prisma.$queryRaw`
                INSERT INTO pnid_equipment (pnid_id, equipment_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid, ${pos.x_pct}, ${pos.y_pct}, ${pos.w_pct}, ${pos.h_pct})
                ON CONFLICT (pnid_id, equipment_id) DO UPDATE SET
                  annotation_x_pct = ${pos.x_pct}, annotation_y_pct = ${pos.y_pct},
                  annotation_w_pct = ${pos.w_pct}, annotation_h_pct = ${pos.h_pct}
                RETURNING id
              `.catch(() => [])
            : await prisma.$queryRaw`
                INSERT INTO pnid_equipment (pnid_id, equipment_id)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid)
                ON CONFLICT (pnid_id, equipment_id) DO NOTHING
                RETURNING id
              `.catch(() => []);
          if (ins?.length) equipmentLinked++;
        } else if (item.entity_kind === 'instrument') {
          const ins = hasCoords
            ? await prisma.$queryRaw`
                INSERT INTO pnid_instrument (pnid_id, instrument_id, annotation_x_pct, annotation_y_pct, annotation_w_pct, annotation_h_pct)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid, ${pos.x_pct}, ${pos.y_pct}, ${pos.w_pct}, ${pos.h_pct})
                ON CONFLICT (pnid_id, instrument_id) DO UPDATE SET
                  annotation_x_pct = ${pos.x_pct}, annotation_y_pct = ${pos.y_pct},
                  annotation_w_pct = ${pos.w_pct}, annotation_h_pct = ${pos.h_pct}
                RETURNING id
              `.catch(() => [])
            : await prisma.$queryRaw`
                INSERT INTO pnid_instrument (pnid_id, instrument_id)
                VALUES (${item.pnid_id}::uuid, ${item.matched_entity_id}::uuid)
                ON CONFLICT (pnid_id, instrument_id) DO NOTHING
                RETURNING id
              `.catch(() => []);
          if (ins?.length) instrumentsLinked++;
        }
        if (hasCoords) coordsFound++;
      }

      return {
        message: 'Repair complete',
        batchFilesResolved,
        pnidSystemsCreated,
        linesLinked,
        equipmentLinked,
        instrumentsLinked,
        totalAppliedItems: appliedItems.length,
        extractionsSynced,
        coordinatesFromReview: tagPositionMap.size,
        coordinatesResolved: coordsFound,
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: err.message || 'Repair failed' });
    }
  });
}
