import prisma from '../db.js';

export default async function pidModuleRoutes(fastify) {
  // GET /pid-module/pnids — Full P&ID list for the dedicated module with annotation/OCR columns
  fastify.get('/pid-module/pnids', async (request, reply) => {
    const { platform_id, status, annotation_status, ocr_status, search } = request.query;

    const where = { deleted_at: null };
    const andClauses = [];

    if (status) where.status = status;
    if (annotation_status) where.annotation_status_col = annotation_status;
    if (ocr_status) where.ocr_status = ocr_status;

    if (search) {
      andClauses.push({
        OR: [
          { drawing_number: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (platform_id) {
      andClauses.push({
        OR: [
          { pnid_system: { some: { system: { platform_id, deleted_at: null } } } },
          { pnid_system: { none: {} } },
        ],
      });
    }

    if (andClauses.length > 0) where.AND = andClauses;

    const pnids = await prisma.pnid.findMany({
      where,
      include: {
        pnid_system: {
          include: { system: { select: { id: true, code: true, name: true, sys_type: true } } },
        },
        pnid_line_pnid_line_pnid_idTopnid: {
          where: { line: { deleted_at: null } },
        },
        pnid_equipment: true,
        pnid_instrument: true,
        annotation: {
          where: { deleted_at: null },
          select: { id: true, approval_status: true },
        },
      },
      orderBy: { drawing_number: 'asc' },
    });

    // Enrich with batch file data for P&IDs that don't have ocr_raw_storage_key set
    const pnidIds = pnids.filter(p => !p.ocr_raw_storage_key && !p.ocr_raw_data).map(p => p.id);
    let batchFileMap = {};
    if (pnidIds.length > 0) {
      try {
        const batchFiles = await prisma.$queryRaw`
          SELECT DISTINCT ON (pnid_id) pnid_id, storage_key, status
          FROM ocr_batch_file
          WHERE pnid_id = ANY(${pnidIds}::uuid[]) AND status = 'completed'
          ORDER BY pnid_id, created_at DESC
        `;
        for (const bf of batchFiles) {
          batchFileMap[bf.pnid_id] = bf;
        }
      } catch (_e) { /* ocr_batch_file table may not exist yet */ }
    }

    return {
      pnids: pnids.map(p => {
        const bf = batchFileMap[p.id];
        const primarySys = p.pnid_system.find(ps => ps.is_primary);
        const totalAnnotations = p.annotation.length;
        const approvedAnnotations = p.annotation.filter(a => a.approval_status === 'approved').length;

        return {
          id: p.id,
          drawingNumber: p.drawing_number,
          title: p.title,
          revision: p.revision,
          revDate: p.updated_at,
          status: p.status,
          hasImage: p.has_image,
          storageKey: p.storage_key || null,
          fileUrl: p.storage_key ? `/api/v1/pnids/${p.id}/file` : null,
          sheetNumber: p.sheet_number,
          totalSheets: p.total_sheets,
          // Primary system info
          primarySystemId: primarySys?.system?.id || null,
          primarySystemCode: primarySys?.system?.code || null,
          primarySystemName: primarySys?.system?.name || null,
          primarySystemType: primarySys?.system?.sys_type || null,
          // Counts
          lineCount: p.pnid_line_pnid_line_pnid_idTopnid.length,
          equipmentCount: p.pnid_equipment.length,
          instrumentCount: p.pnid_instrument.length,
          systemCount: p.pnid_system.length,
          // Annotation status
          annotationStatus: p.annotation_status_col || 'not_annotated',
          totalAnnotations,
          approvedAnnotations,
          // OCR pipeline — also check batch file linkage for older batches
          ocrStatus: p.ocr_status || (bf?.status === 'completed' ? 'completed' : 'pending'),
          ocrRawStorageKey: p.ocr_raw_storage_key || bf?.storage_key || null,
          ocrCleanedStorageKey: p.ocr_cleaned_storage_key,
          ocrProcessedAt: p.ocr_processed_at,
          ocrError: p.ocr_error,
          hasOcrRaw: !!p.ocr_raw_storage_key || !!p.ocr_raw_data || bf?.status === 'completed',
          hasOcrCleaned: !!p.ocr_cleaned_storage_key || !!p.ocr_cleaned_data,
        };
      }),
    };
  });

  // PATCH /pid-module/pnids/:pnidId/annotation-status — Update annotation status
  fastify.patch('/pid-module/pnids/:pnidId/annotation-status', async (request, reply) => {
    const { pnidId } = request.params;
    const { annotationStatus } = request.body || {};

    const valid = ['not_annotated', 'in_progress', 'annotated', 'verified'];
    if (!valid.includes(annotationStatus)) {
      return reply.code(400).send({ error: `Invalid annotation status. Must be one of: ${valid.join(', ')}` });
    }

    const updated = await prisma.pnid.update({
      where: { id: pnidId },
      data: { annotation_status_col: annotationStatus },
    });

    return { success: true, annotationStatus: updated.annotation_status_col };
  });

  // POST /pid-module/pnids/:pnidId/ocr — Submit OCR data (raw or cleaned) from pipeline
  fastify.post('/pid-module/pnids/:pnidId/ocr', async (request, reply) => {
    const { pnidId } = request.params;
    const { type, storageKey, data, error } = request.body || {};

    if (!['raw', 'cleaned'].includes(type)) {
      return reply.code(400).send({ error: 'type must be "raw" or "cleaned"' });
    }

    const updateData = {};

    if (type === 'raw') {
      if (storageKey) updateData.ocr_raw_storage_key = storageKey;
      if (data) updateData.ocr_raw_data = data;
      updateData.ocr_status = 'processing';
      updateData.ocr_processed_at = new Date();
    } else {
      if (storageKey) updateData.ocr_cleaned_storage_key = storageKey;
      if (data) updateData.ocr_cleaned_data = data;
      updateData.ocr_status = 'completed';
      updateData.ocr_processed_at = new Date();
      // Auto-update annotation status when cleaned data arrives
      updateData.annotation_status_col = 'annotated';
    }

    if (error) {
      updateData.ocr_status = 'failed';
      updateData.ocr_error = error;
    }

    const updated = await prisma.pnid.update({
      where: { id: pnidId },
      data: updateData,
    });

    return {
      success: true,
      ocrStatus: updated.ocr_status,
      annotationStatus: updated.annotation_status_col,
    };
  });

  // GET /pid-module/pnids/:pnidId/ocr-data — Get OCR data for a specific P&ID
  fastify.get('/pid-module/pnids/:pnidId/ocr-data', async (request, reply) => {
    const { pnidId } = request.params;
    const { type } = request.query;

    const p = await prisma.pnid.findUnique({
      where: { id: pnidId },
      select: {
        id: true,
        drawing_number: true,
        ocr_raw_data: true,
        ocr_cleaned_data: true,
        ocr_raw_storage_key: true,
        ocr_cleaned_storage_key: true,
        ocr_status: true,
        ocr_processed_at: true,
        ocr_error: true,
      },
    });

    if (!p) return reply.code(404).send({ error: 'P&ID not found' });

    const result = {
      id: p.id,
      drawingNumber: p.drawing_number,
      ocrStatus: p.ocr_status,
      ocrProcessedAt: p.ocr_processed_at,
      ocrError: p.ocr_error,
    };

    if (!type || type === 'raw') {
      result.rawData = p.ocr_raw_data;
      result.rawStorageKey = p.ocr_raw_storage_key;
    }
    if (!type || type === 'cleaned') {
      result.cleanedData = p.ocr_cleaned_data;
      result.cleanedStorageKey = p.ocr_cleaned_storage_key;
    }

    return result;
  });

  // ═══ GET /pid-module/pnids/:pnidId/detail — Full P&ID detail with entity lists ═══
  fastify.get('/pid-module/pnids/:pnidId/detail', async (request, reply) => {
    const { pnidId } = request.params;

    const p = await prisma.pnid.findUnique({
      where: { id: pnidId },
      include: {
        pnid_system: {
          include: { system: { select: { id: true, code: true, name: true, sys_type: true } } },
        },
        pnid_line_pnid_line_pnid_idTopnid: {
          where: { line: { deleted_at: null } },
          include: {
            line: {
              include: { system: { select: { id: true, code: true, sys_type: true } } },
            },
          },
        },
        pnid_equipment: {
          where: { equipment: { deleted_at: null } },
          include: {
            equipment: {
              include: { system: { select: { id: true, code: true, sys_type: true } } },
            },
          },
        },
        pnid_instrument: {
          where: { instrument: { deleted_at: null } },
          include: {
            instrument: {
              include: {
                system: { select: { id: true, code: true, sys_type: true } },
                line: { select: { id: true, line_number: true } },
              },
            },
          },
        },
        annotation: {
          where: { deleted_at: null },
          select: { id: true, approval_status: true },
        },
      },
    });

    if (!p) return reply.code(404).send({ error: 'P&ID not found' });

    const totalAnnotations = p.annotation.length;
    const approvedAnnotations = p.annotation.filter(a => a.approval_status === 'approved').length;

    return {
      pnid: {
        id: p.id,
        drawingNumber: p.drawing_number,
        title: p.title,
        revision: p.revision,
        status: p.status,
        storageKey: p.storage_key,
        fileUrl: p.storage_key ? `/api/v1/pnids/${p.id}/file` : null,
        ocrRawStorageKey: p.ocr_raw_storage_key,
        ocrCleanedStorageKey: p.ocr_cleaned_storage_key,
        annotationStatus: p.annotation_status_col || 'not_annotated',
        ocrStatus: p.ocr_status || 'pending',
        sheetNumber: p.sheet_number,
        totalSheets: p.total_sheets,
      },
      systems: p.pnid_system.map(ps => ({
        id: ps.system.id,
        code: ps.system.code,
        name: ps.system.name,
        sysType: ps.system.sys_type,
        isPrimary: ps.is_primary,
      })),
      lines: p.pnid_line_pnid_line_pnid_idTopnid.map(pl => ({
        id: pl.line.id,
        lineNumber: pl.line.line_number,
        service: pl.line.service,
        nominalSize: pl.line.nominal_size,
        systemCode: pl.line.system?.code || null,
        isContinuation: pl.is_continuation,
        hasPosition: pl.annotation_x_pct != null,
      })),
      equipment: p.pnid_equipment.map(pe => ({
        id: pe.equipment.id,
        tag: pe.equipment.tag,
        type: pe.equipment.equipment_type,
        description: pe.equipment.description,
        criticality: pe.equipment.criticality,
        systemCode: pe.equipment.system?.code || null,
        positionVerified: pe.position_verified || false,
        hasPosition: pe.annotation_x_pct != null,
      })),
      instruments: p.pnid_instrument.map(pi => ({
        id: pi.instrument.id,
        tag: pi.instrument.tag,
        type: pi.instrument.instrument_type,
        description: pi.instrument.description,
        rangeMin: pi.instrument.range_min,
        rangeMax: pi.instrument.range_max,
        scadaTag: pi.instrument.scada_tag,
        systemCode: pi.instrument.system?.code || null,
        lineNumber: pi.instrument.line?.line_number || null,
        positionVerified: pi.position_verified || false,
        hasPosition: pi.annotation_x_pct != null,
      })),
      annotationSummary: {
        total: totalAnnotations,
        approved: approvedAnnotations,
        draft: totalAnnotations - approvedAnnotations,
      },
    };
  });

  // ═══ POST /pid-module/pnids/:pnidId/generate-annotations — Generate annotations from OCR data ═══
  fastify.post('/pid-module/pnids/:pnidId/generate-annotations', async (request, reply) => {
    const { pnidId } = request.params;
    const {
      mode = 'from_ocr',
      entityTypes = ['equipment', 'instrument', 'line'],
      overwriteExisting = false,
      createKonvaAnnotations = false,
    } = request.body || {};

    const DEFAULT_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';
    const ENTITY_COLORS = { equipment: '#4FE2B0', instrument: '#8AB4FF', line: '#FFB068' };

    // Mark as in_progress
    await prisma.pnid.update({
      where: { id: pnidId },
      data: { annotation_status_col: 'in_progress' },
    });

    // Helper: resolve percentage coordinates from an extraction record.
    // Falls back to computing from pixel coords + image dimensions when pct is zero/missing.
    function resolveCoordinates(ext) {
      let xPct = Number(ext.bbox_x_pct) || 0;
      let yPct = Number(ext.bbox_y_pct) || 0;
      let wPct = Number(ext.bbox_w_pct) || 0;
      let hPct = Number(ext.bbox_h_pct) || 0;

      // If percentage coords are 0 or very small but pixel coords + image dimensions exist, compute
      if (xPct < 0.5 && yPct < 0.5) {
        const xPx = Number(ext.bbox_x_px) || Number(ext.bbox_x_px) || 0;
        const yPx = Number(ext.bbox_y_px) || Number(ext.bbox_y_px) || 0;
        const wPx = Number(ext.bbox_w_px) || 0;
        const hPx = Number(ext.bbox_h_px) || 0;
        const imgW = Number(ext.image_width_px) || 0;
        const imgH = Number(ext.image_height_px) || 0;

        if (imgW > 0 && imgH > 0 && (xPx > 0 || yPx > 0)) {
          xPct = (xPx / imgW) * 100;
          yPct = (yPx / imgH) * 100;
          wPct = wPx > 0 ? (wPx / imgW) * 100 : 0;
          hPct = hPx > 0 ? (hPx / imgH) * 100 : 0;
        }
      }

      // If coordinates look like fractional 0-1 instead of 0-100, scale up
      if (xPct > 0 && xPct < 1 && yPct > 0 && yPct < 1) {
        xPct *= 100;
        yPct *= 100;
        wPct *= 100;
        hPct *= 100;
      }

      return { xPct, yPct, wPct, hPct };
    }

    // Get matched OCR extractions from ocr_extraction table
    // Note: OCR pipeline creates records with status='pending' and matched_entity_id set.
    // We intentionally do NOT filter by status — any extraction with a matched entity is valid.
    const extractions = await prisma.ocr_extraction.findMany({
      where: {
        pnid_id: pnidId,
        matched_entity_id: { not: null },
        tag_type: { in: entityTypes },
      },
    });

    fastify.log.info({ pnidId, extractionCount: extractions.length, entityTypes }, 'Generate annotations: found OCR extractions');

    if (extractions.length === 0) {
      // No OCR extractions with matched entities — nothing to auto-annotate.
      // Entities imported from CSV or created manually should be annotated manually via the P&ID Viewer.
      await prisma.pnid.update({ where: { id: pnidId }, data: { annotation_status_col: 'not_annotated' } });
      return { annotated: 0, skipped: 0, errors: 0, byType: { equipment: 0, instrument: 0, line: 0 },
               message: 'No OCR extractions with matched entities found. Use the P&ID Viewer to manually annotate.' };
    }

    const stats = { annotated: 0, skipped: 0, errors: 0, byType: { equipment: 0, instrument: 0, line: 0 } };

    for (const ext of extractions) {
      try {
        const entityType = ext.tag_type;
        const entityId = ext.matched_entity_id;
        const coords = resolveCoordinates(ext);
        let { xPct, yPct, wPct, hPct } = coords;

        // Apply defaults for width/height if still zero
        if (!wPct) wPct = entityType === 'line' ? null : 8;
        if (!hPct) hPct = entityType === 'line' ? null : 8;

        fastify.log.info({
          tag: ext.extracted_text, entityType, entityId,
          rawPct: { x: Number(ext.bbox_x_pct), y: Number(ext.bbox_y_pct), w: Number(ext.bbox_w_pct), h: Number(ext.bbox_h_pct) },
          rawPx: { x: Number(ext.bbox_x_px), y: Number(ext.bbox_y_px), w: Number(ext.bbox_w_px), h: Number(ext.bbox_h_px) },
          imgDim: { w: Number(ext.image_width_px), h: Number(ext.image_height_px) },
          resolved: { xPct, yPct, wPct, hPct },
        }, 'Generate annotations: processing extraction');

        // Skip if coordinates are still at origin (no usable position data)
        if (xPct < 0.5 && yPct < 0.5) { stats.skipped++; continue; }

        // Check existing junction and skip if not overwriting
        if (!overwriteExisting) {
          let existing = null;
          if (entityType === 'equipment') {
            existing = await prisma.pnid_equipment.findUnique({
              where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: entityId } },
            });
          } else if (entityType === 'instrument') {
            existing = await prisma.pnid_instrument.findUnique({
              where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: entityId } },
            });
          } else if (entityType === 'line') {
            existing = await prisma.pnid_line.findUnique({
              where: { pnid_id_line_id: { pnid_id: pnidId, line_id: entityId } },
            });
          }
          if (existing && existing.annotation_x_pct != null && Number(existing.annotation_x_pct) > 0.5) { stats.skipped++; continue; }
        }

        // Upsert junction table entry with coordinates
        if (entityType === 'equipment') {
          await prisma.pnid_equipment.upsert({
            where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: entityId } },
            create: { pnid_id: pnidId, equipment_id: entityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
            update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
          });
        } else if (entityType === 'instrument') {
          await prisma.pnid_instrument.upsert({
            where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: entityId } },
            create: { pnid_id: pnidId, instrument_id: entityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
            update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
          });
        } else if (entityType === 'line') {
          await prisma.pnid_line.upsert({
            where: { pnid_id_line_id: { pnid_id: pnidId, line_id: entityId } },
            create: { pnid_id: pnidId, line_id: entityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
            update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct, annotation_h_pct: hPct },
          });
        }

        // Optionally create Konva annotation record
        if (createKonvaAnnotations) {
          const existingAnnotation = await prisma.annotation.findFirst({
            where: { pnid_id: pnidId, linked_entity_id: entityId, deleted_at: null },
          });

          if (!existingAnnotation || overwriteExisting) {
            if (existingAnnotation && overwriteExisting) {
              await prisma.annotation.update({
                where: { id: existingAnnotation.id },
                data: { x_pct: xPct, y_pct: yPct, w_pct: wPct, h_pct: hPct },
              });
            } else if (!existingAnnotation) {
              await prisma.annotation.create({
                data: {
                  pnid_id: pnidId,
                  author_id: DEFAULT_AUTHOR_ID,
                  annotation_type: 'shape',
                  shape: entityType === 'line' ? 'pin' : 'rectangle',
                  x_pct: xPct,
                  y_pct: yPct,
                  w_pct: wPct,
                  h_pct: hPct,
                  color: ENTITY_COLORS[entityType] || '#4FE2B0',
                  stroke_width: 2,
                  linked_entity_type: entityType,
                  linked_entity_id: entityId,
                  text: ext.extracted_text || null,
                  metadata: { generatedFromOcr: true, ocrExtractionId: ext.id, appliedToDrawing: false, source: 'ocr' },
                },
              });
            }
          }
        }

        stats.annotated++;
        if (stats.byType[entityType] !== undefined) stats.byType[entityType]++;
      } catch (err) {
        stats.errors++;
        fastify.log.error({ err, extractionId: ext.id }, 'Error generating annotation');
      }
    }

    // Update annotation status:
    // - OCR positioned data exists, but still pending manual placement/approval in annotation workspace.
    if (stats.annotated > 0) {
      await prisma.pnid.update({
        where: { id: pnidId },
        data: { annotation_status_col: 'in_progress' },
      });
    } else {
      await prisma.pnid.update({
        where: { id: pnidId },
        data: { annotation_status_col: stats.skipped > 0 ? 'in_progress' : 'not_annotated' },
      });
    }

    return stats;
  });

  // ═══ POST /pid-module/bulk-generate-annotations — Bulk annotation generation ═══
  fastify.post('/pid-module/bulk-generate-annotations', async (request, reply) => {
    const {
      pnidIds = [],
      mode = 'from_ocr',
      entityTypes = ['equipment', 'instrument', 'line'],
      overwriteExisting = false,
      createKonvaAnnotations = true,
    } = request.body || {};

    if (!pnidIds.length) {
      return reply.code(400).send({ error: 'pnidIds array is required' });
    }

    // Get drawing numbers for results
    const pnidRecords = await prisma.pnid.findMany({
      where: { id: { in: pnidIds } },
      select: { id: true, drawing_number: true },
    });
    const drawingNumberMap = {};
    for (const p of pnidRecords) drawingNumberMap[p.id] = p.drawing_number;

    const results = [];
    let totalAnnotated = 0, totalSkipped = 0, totalErrors = 0;
    const byType = { equipment: 0, instrument: 0, line: 0 };

    for (const pnidId of pnidIds) {
      try {
        // Reuse single-P&ID generation by injecting a mock request
        const mockRequest = {
          params: { pnidId },
          body: { mode, entityTypes, overwriteExisting, createKonvaAnnotations },
        };
        const mockReply = { code: () => ({ send: (d) => d }) };
        const singleResult = await fastify.inject({
          method: 'POST',
          url: `/api/v1/pid-module/pnids/${pnidId}/generate-annotations`,
          payload: { mode, entityTypes, overwriteExisting, createKonvaAnnotations },
        });

        const result = JSON.parse(singleResult.body);
        results.push({
          pnidId,
          drawingNumber: drawingNumberMap[pnidId] || null,
          ...result,
        });
        totalAnnotated += result.annotated || 0;
        totalSkipped += result.skipped || 0;
        totalErrors += result.errors || 0;
        if (result.byType) {
          byType.equipment += result.byType.equipment || 0;
          byType.instrument += result.byType.instrument || 0;
          byType.line += result.byType.line || 0;
        }
      } catch (err) {
        fastify.log.error({ err, pnidId }, 'Bulk generation error');
        results.push({
          pnidId,
          drawingNumber: drawingNumberMap[pnidId] || null,
          annotated: 0, skipped: 0, errors: 1,
          byType: { equipment: 0, instrument: 0, line: 0 },
        });
        totalErrors++;
      }
    }

    return {
      total: pnidIds.length,
      completed: results.filter(r => r.errors === 0).length,
      failed: results.filter(r => r.errors > 0).length,
      results,
      summary: { totalAnnotated, totalSkipped, totalErrors, byType },
    };
  });

  // GET /pid-module/stats — Summary statistics for the P&ID module dashboard
  fastify.get('/pid-module/stats', async (request, reply) => {
    const { platform_id } = request.query;

    const platformFilter = platform_id
      ? { OR: [
          { pnid_system: { some: { system: { platform_id, deleted_at: null } } } },
          { pnid_system: { none: {} } },
        ] }
      : {};

    const [total, annotated, inProgress, verified, ocrCompleted, ocrFailed] = await Promise.all([
      prisma.pnid.count({ where: { deleted_at: null, ...platformFilter } }),
      prisma.pnid.count({ where: { deleted_at: null, annotation_status_col: 'annotated', ...platformFilter } }),
      prisma.pnid.count({ where: { deleted_at: null, annotation_status_col: 'in_progress', ...platformFilter } }),
      prisma.pnid.count({ where: { deleted_at: null, annotation_status_col: 'verified', ...platformFilter } }),
      prisma.pnid.count({ where: { deleted_at: null, ocr_status: 'completed', ...platformFilter } }),
      prisma.pnid.count({ where: { deleted_at: null, ocr_status: 'failed', ...platformFilter } }),
    ]);

    return {
      total,
      annotationStats: {
        notAnnotated: total - annotated - inProgress - verified,
        inProgress,
        annotated,
        verified,
      },
      ocrStats: {
        pending: total - ocrCompleted - ocrFailed,
        completed: ocrCompleted,
        failed: ocrFailed,
      },
    };
  });
}
