import prisma from '../db.js';
import { getStorageProvider } from '../services/storage/index.js';
import { runOcrPipeline, approveExtractions } from '../services/ocr/OcrPipeline.js';

export default async function ocrRoutes(fastify) {

  // ═══ POST /ocr/extract/:pnidId — Run OCR pipeline on a P&ID ═══
  fastify.post('/ocr/extract/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;

    // Validate P&ID exists and has an image
    const pnid = await prisma.pnid.findFirst({
      where: { id: pnidId, deleted_at: null },
      select: {
        id: true,
        storage_key: true,
        pnid_system: {
          where: { is_primary: true },
          include: { system: { select: { platform_id: true } } },
        },
      },
    });

    if (!pnid) {
      return reply.status(404).send({ error: 'P&ID not found' });
    }

    // storage_key is optional — mock OCR works without an uploaded file

    try {
      const platformId = pnid.pnid_system[0]?.system?.platform_id;
      let storage;
      try {
        storage = await getStorageProvider(prisma, { platformId });
      } catch (_storageErr) {
        // No storage configured — create a minimal stub for mock mode
        storage = { download: () => { throw new Error('No storage configured'); }, config: {} };
      }

      const { jobId } = await runOcrPipeline(prisma, pnidId, storage, {
        credentialsJson: storage.config?.credentials_json || storage.config?.credentials_ref,
      });

      return reply.status(202).send({
        success: true,
        jobId,
        message: 'OCR extraction started',
      });
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: `OCR extraction failed: ${err.message}` });
    }
  });

  // ═══ GET /ocr/jobs/:jobId — Get OCR job status ═══
  fastify.get('/ocr/jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params;

    const jobs = await prisma.$queryRaw`
      SELECT id, pnid_id, status, total_words, tags_found, tags_matched,
             started_at, completed_at, error_message, created_at
      FROM ocr_job
      WHERE id = ${jobId}::uuid
    `;

    if (!jobs?.length) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return { job: jobs[0] };
  });

  // ═══ GET /ocr/results/:pnidId — Get all OCR extractions for a P&ID ═══
  fastify.get('/ocr/results/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;
    const { tag_type, status, min_confidence } = request.query;

    const extractions = await prisma.$queryRaw`
      SELECT id, pnid_id, extracted_text, tag_type, confidence,
             bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
             bbox_x_px, bbox_y_px, bbox_w_px, bbox_h_px,
             matched_entity_id, match_confidence, match_method,
             status, reviewed_by, reviewed_at,
             image_width_px, image_height_px, created_at
      FROM ocr_extraction
      WHERE pnid_id = ${pnidId}::uuid
      ORDER BY tag_type, extracted_text
    `;

    let filtered = extractions;
    if (tag_type) {
      filtered = filtered.filter(e => e.tag_type === tag_type);
    }
    if (status) {
      filtered = filtered.filter(e => e.status === status);
    }
    if (min_confidence) {
      const minConf = parseFloat(min_confidence);
      filtered = filtered.filter(e => Number(e.match_confidence) >= minConf);
    }

    // Get the latest job for this P&ID
    const latestJob = await prisma.$queryRaw`
      SELECT id, status, total_words, tags_found, tags_matched,
             started_at, completed_at, error_message
      FROM ocr_job
      WHERE pnid_id = ${pnidId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;

    // Get entity details for matched extractions
    const matchedEntityIds = filtered
      .filter(e => e.matched_entity_id)
      .map(e => e.matched_entity_id);

    let entityDetails = {};
    if (matchedEntityIds.length > 0) {
      const [equipment, instruments, lines] = await Promise.all([
        prisma.equipment.findMany({
          where: { id: { in: matchedEntityIds } },
          select: { id: true, tag: true, equipment_type: true, description: true },
        }),
        prisma.instrument.findMany({
          where: { id: { in: matchedEntityIds } },
          select: { id: true, tag: true, instrument_type: true, description: true },
        }),
        prisma.line.findMany({
          where: { id: { in: matchedEntityIds } },
          select: { id: true, line_number: true, service: true },
        }),
      ]);

      for (const e of equipment) entityDetails[e.id] = { ...e, entityType: 'equipment' };
      for (const i of instruments) entityDetails[i.id] = { ...i, entityType: 'instrument' };
      for (const l of lines) entityDetails[l.id] = { tag: l.line_number, ...l, entityType: 'line' };
    }

    return {
      extractions: filtered.map(e => ({
        id: e.id,
        pnidId: e.pnid_id,
        extractedText: e.extracted_text,
        tagType: e.tag_type,
        confidence: Number(e.confidence),
        bboxXPct: Number(e.bbox_x_pct),
        bboxYPct: Number(e.bbox_y_pct),
        bboxWPct: Number(e.bbox_w_pct),
        bboxHPct: Number(e.bbox_h_pct),
        matchedEntityId: e.matched_entity_id,
        matchedEntity: e.matched_entity_id ? entityDetails[e.matched_entity_id] || null : null,
        matchConfidence: Number(e.match_confidence),
        matchMethod: e.match_method,
        status: e.status,
        reviewedBy: e.reviewed_by,
        reviewedAt: e.reviewed_at,
      })),
      summary: {
        total: filtered.length,
        byType: {
          equipment: filtered.filter(e => e.tag_type === 'equipment').length,
          instrument: filtered.filter(e => e.tag_type === 'instrument').length,
          line: filtered.filter(e => e.tag_type === 'line').length,
          unknown: filtered.filter(e => e.tag_type === 'unknown').length,
        },
        matched: filtered.filter(e => e.matched_entity_id).length,
        unmatched: filtered.filter(e => !e.matched_entity_id).length,
        pending: filtered.filter(e => e.status === 'pending').length,
        approved: filtered.filter(e => e.status === 'approved').length,
        rejected: filtered.filter(e => e.status === 'rejected').length,
      },
      latestJob: latestJob?.[0] || null,
    };
  });

  // ═══ POST /ocr/results/:pnidId/approve — Approve extractions ═══
  fastify.post('/ocr/results/:pnidId/approve', async (request, reply) => {
    const { pnidId } = request.params;
    const { extractionIds, action } = request.body;

    if (!extractionIds?.length) {
      return reply.status(400).send({ error: 'extractionIds array is required' });
    }

    if (action === 'approve') {
      const result = await approveExtractions(prisma, pnidId, extractionIds);

      // Log to change_log
      await prisma.$queryRaw`
        INSERT INTO change_log (entity_type, entity_id, action, changes, source, created_by)
        VALUES ('pnid', ${pnidId}::uuid, 'ocr_approve', ${JSON.stringify({
          extractionIds,
          approved: result.approved,
        })}::jsonb, 'ocr', 'admin')
      `;

      return {
        success: true,
        approved: result.approved,
      };
    } else if (action === 'reject') {
      await prisma.$queryRaw`
        UPDATE ocr_extraction
        SET status = 'rejected', reviewed_at = NOW(), reviewed_by = 'admin'
        WHERE pnid_id = ${pnidId}::uuid
          AND id = ANY(${extractionIds}::uuid[])
          AND status = 'pending'
      `;

      return { success: true, rejected: extractionIds.length };
    }

    return reply.status(400).send({ error: 'action must be "approve" or "reject"' });
  });

  // ═══ POST /ocr/results/:pnidId/approve-all — Bulk approve above threshold ═══
  fastify.post('/ocr/results/:pnidId/approve-all', async (request, reply) => {
    const { pnidId } = request.params;
    const { minConfidence = 0.9 } = request.body || {};

    const extractions = await prisma.$queryRaw`
      SELECT id FROM ocr_extraction
      WHERE pnid_id = ${pnidId}::uuid
        AND status = 'pending'
        AND matched_entity_id IS NOT NULL
        AND match_confidence >= ${minConfidence}
    `;

    const extractionIds = extractions.map(e => e.id);

    if (extractionIds.length === 0) {
      return { success: true, approved: 0, message: 'No extractions above threshold' };
    }

    const result = await approveExtractions(prisma, pnidId, extractionIds);

    await prisma.$queryRaw`
      INSERT INTO change_log (entity_type, entity_id, action, changes, source, created_by)
      VALUES ('pnid', ${pnidId}::uuid, 'ocr_bulk_approve', ${JSON.stringify({
        minConfidence,
        extractionIds,
        approved: result.approved,
      })}::jsonb, 'ocr', 'admin')
    `;

    return {
      success: true,
      approved: result.approved,
      total: extractionIds.length,
    };
  });

  // ═══ PATCH /ocr/extractions/:extractionId — Modify a single extraction ═══
  fastify.patch('/ocr/extractions/:extractionId', async (request, reply) => {
    const { extractionId } = request.params;
    const { matchedEntityId, tagType, status } = request.body;

    const updates = [];
    const values = [];

    if (matchedEntityId !== undefined) {
      updates.push('matched_entity_id = $1::uuid');
      updates.push("match_method = 'manual'");
      updates.push('match_confidence = 1.0');
      values.push(matchedEntityId);
    }

    if (tagType) {
      await prisma.$queryRaw`
        UPDATE ocr_extraction SET tag_type = ${tagType}
        WHERE id = ${extractionId}::uuid
      `;
    }

    if (matchedEntityId !== undefined) {
      await prisma.$queryRaw`
        UPDATE ocr_extraction
        SET matched_entity_id = ${matchedEntityId}::uuid,
            match_method = 'manual',
            match_confidence = 1.0
        WHERE id = ${extractionId}::uuid
      `;
    }

    if (status) {
      await prisma.$queryRaw`
        UPDATE ocr_extraction
        SET status = ${status}, reviewed_at = NOW(), reviewed_by = 'admin'
        WHERE id = ${extractionId}::uuid
      `;
    }

    return { success: true };
  });

  // ═══ GET /ocr/jobs/pnid/:pnidId — Get all jobs for a P&ID ═══
  fastify.get('/ocr/jobs/pnid/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;

    const jobs = await prisma.$queryRaw`
      SELECT id, pnid_id, status, total_words, tags_found, tags_matched,
             started_at, completed_at, error_message, created_at
      FROM ocr_job
      WHERE pnid_id = ${pnidId}::uuid
      ORDER BY created_at DESC
    `;

    return { jobs };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // OCR PIPELINE MODULE — Separate from P&ID viewer
  // ═══════════════════════════════════════════════════════════════════════

  // ═══ GET /ocr/dashboard — All P&IDs with OCR status for pipeline view ═══
  fastify.get('/ocr/dashboard', async (request, reply) => {
    const { platformId } = request.query;

    if (!platformId) {
      return reply.status(400).send({ error: 'platformId query parameter is required' });
    }

    // Get all P&IDs for the platform with their OCR status
    const pnids = await prisma.$queryRaw`
      SELECT
        p.id,
        p.drawing_number,
        p.title,
        p.status AS doc_status,
        p.has_image,
        p.storage_key,
        ps.system_id,
        s.name AS system_name,
        s.code AS system_code,
        s.sys_type,
        -- Latest OCR job
        lj.id AS latest_job_id,
        lj.status AS ocr_job_status,
        lj.total_words,
        lj.tags_found,
        lj.tags_matched,
        lj.completed_at AS ocr_completed_at,
        lj.error_message AS ocr_error,
        -- Extraction summary
        COALESCE(es.total_extractions, 0)::int AS total_extractions,
        COALESCE(es.pending_count, 0)::int AS pending_count,
        COALESCE(es.approved_count, 0)::int AS approved_count,
        COALESCE(es.rejected_count, 0)::int AS rejected_count,
        COALESCE(es.matched_count, 0)::int AS matched_count
      FROM pnid p
      JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
      JOIN system s ON s.id = ps.system_id
      LEFT JOIN LATERAL (
        SELECT * FROM ocr_job oj
        WHERE oj.pnid_id = p.id
        ORDER BY oj.created_at DESC
        LIMIT 1
      ) lj ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_extractions,
          COUNT(*) FILTER (WHERE oe.status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE oe.status = 'approved')::int AS approved_count,
          COUNT(*) FILTER (WHERE oe.status = 'rejected')::int AS rejected_count,
          COUNT(*) FILTER (WHERE oe.matched_entity_id IS NOT NULL)::int AS matched_count
        FROM ocr_extraction oe
        WHERE oe.pnid_id = p.id
      ) es ON true
      WHERE s.platform_id = ${platformId}::uuid
        AND p.deleted_at IS NULL
      ORDER BY s.name, p.drawing_number
    `;

    // Compute pipeline status for each P&ID
    const items = pnids.map(p => {
      let pipelineStatus = 'no_ocr'; // no_ocr | processing | results_ready | review_pending | fully_approved | failed
      if (p.ocr_job_status === 'processing' || p.ocr_job_status === 'pending') {
        pipelineStatus = 'processing';
      } else if (p.ocr_job_status === 'failed') {
        pipelineStatus = 'failed';
      } else if (p.total_extractions > 0) {
        if (p.pending_count > 0) {
          pipelineStatus = 'review_pending';
        } else if (p.approved_count > 0 && p.pending_count === 0) {
          pipelineStatus = 'fully_approved';
        } else {
          pipelineStatus = 'results_ready';
        }
      }

      return {
        id: p.id,
        drawingNumber: p.drawing_number,
        title: p.title,
        docStatus: p.doc_status,
        hasImage: p.has_image,
        hasStorageKey: !!p.storage_key,
        systemId: p.system_id,
        systemName: p.system_name,
        systemCode: p.system_code,
        systemType: p.sys_type,
        pipelineStatus,
        latestJobId: p.latest_job_id,
        ocrJobStatus: p.ocr_job_status,
        ocrCompletedAt: p.ocr_completed_at,
        ocrError: p.ocr_error,
        totalExtractions: p.total_extractions,
        pendingCount: p.pending_count,
        approvedCount: p.approved_count,
        rejectedCount: p.rejected_count,
        matchedCount: p.matched_count,
        tagsFound: p.tags_found,
        tagsMatched: p.tags_matched,
      };
    });

    // Summary across all P&IDs
    const summary = {
      total: items.length,
      noOcr: items.filter(i => i.pipelineStatus === 'no_ocr').length,
      processing: items.filter(i => i.pipelineStatus === 'processing').length,
      reviewPending: items.filter(i => i.pipelineStatus === 'review_pending').length,
      fullyApproved: items.filter(i => i.pipelineStatus === 'fully_approved').length,
      failed: items.filter(i => i.pipelineStatus === 'failed').length,
    };

    return { items, summary };
  });

  // ═══ POST /ocr/batch-extract — Batch run OCR on multiple P&IDs ═══
  fastify.post('/ocr/batch-extract', async (request, reply) => {
    const { pnidIds } = request.body;

    if (!pnidIds?.length) {
      return reply.status(400).send({ error: 'pnidIds array is required' });
    }

    if (pnidIds.length > 50) {
      return reply.status(400).send({ error: 'Maximum 50 P&IDs per batch' });
    }

    // Validate all P&IDs exist
    const pnids = await prisma.pnid.findMany({
      where: { id: { in: pnidIds }, deleted_at: null },
      select: {
        id: true,
        storage_key: true,
        pnid_system: {
          where: { is_primary: true },
          include: { system: { select: { platform_id: true } } },
        },
      },
    });

    const foundIds = new Set(pnids.map(p => p.id));
    const notFound = pnidIds.filter(id => !foundIds.has(id));

    if (notFound.length > 0) {
      return reply.status(404).send({ error: `P&IDs not found: ${notFound.join(', ')}` });
    }

    // Queue all jobs — process sequentially to avoid overloading
    const jobs = [];
    const errors = [];

    for (const pnid of pnids) {
      try {
        const platformId = pnid.pnid_system[0]?.system?.platform_id;
        let storage;
        try {
          storage = await getStorageProvider(prisma, { platformId });
        } catch (_storageErr) {
          storage = { download: () => { throw new Error('No storage configured'); }, config: {} };
        }

        const { jobId } = await runOcrPipeline(prisma, pnid.id, storage, {
          credentialsJson: storage.config?.credentials_json || storage.config?.credentials_ref,
        });

        jobs.push({ pnidId: pnid.id, jobId, status: 'started' });
      } catch (err) {
        errors.push({ pnidId: pnid.id, error: err.message });
      }
    }

    return {
      success: true,
      started: jobs.length,
      failed: errors.length,
      jobs,
      errors,
    };
  });

  // ═══ GET /ocr/notifications — Notification counts for a platform ═══
  fastify.get('/ocr/notifications', async (request, reply) => {
    const { platformId, pnidId } = request.query;

    // If pnidId is specified, get notifications for a specific P&ID
    if (pnidId) {
      const result = await prisma.$queryRaw`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_review,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'pending' AND matched_entity_id IS NOT NULL)::int AS ready_to_approve
        FROM ocr_extraction
        WHERE pnid_id = ${pnidId}::uuid
      `;

      const jobs = await prisma.$queryRaw`
        SELECT status, completed_at
        FROM ocr_job
        WHERE pnid_id = ${pnidId}::uuid
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const latestJob = jobs?.[0];
      const counts = result?.[0] || { pending_review: 0, approved: 0, ready_to_approve: 0 };

      return {
        pnidId,
        hasOcrResults: counts.pending_review > 0 || counts.approved > 0,
        pendingReview: counts.pending_review,
        readyToApprove: counts.ready_to_approve,
        approved: counts.approved,
        latestJobStatus: latestJob?.status || null,
        latestJobCompletedAt: latestJob?.completed_at || null,
      };
    }

    // Platform-wide notifications
    if (!platformId) {
      return reply.status(400).send({ error: 'platformId or pnidId query parameter is required' });
    }

    const result = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT oe.pnid_id)::int AS pnids_with_pending,
        COUNT(*) FILTER (WHERE oe.status = 'pending')::int AS total_pending,
        COUNT(*) FILTER (WHERE oe.status = 'pending' AND oe.matched_entity_id IS NOT NULL)::int AS total_ready_to_approve
      FROM ocr_extraction oe
      JOIN pnid p ON p.id = oe.pnid_id AND p.deleted_at IS NULL
      JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
      JOIN system s ON s.id = ps.system_id
      WHERE s.platform_id = ${platformId}::uuid
        AND oe.status = 'pending'
    `;

    const processingJobs = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM ocr_job oj
      JOIN pnid p ON p.id = oj.pnid_id AND p.deleted_at IS NULL
      JOIN pnid_system ps ON ps.pnid_id = p.id AND ps.is_primary = true
      JOIN system s ON s.id = ps.system_id
      WHERE s.platform_id = ${platformId}::uuid
        AND oj.status IN ('pending', 'processing')
    `;

    const counts = result?.[0] || { pnids_with_pending: 0, total_pending: 0, total_ready_to_approve: 0 };

    return {
      platformId,
      pnidsWithPending: counts.pnids_with_pending,
      totalPending: counts.total_pending,
      totalReadyToApprove: counts.total_ready_to_approve,
      processingJobs: processingJobs?.[0]?.count || 0,
    };
  });
}
