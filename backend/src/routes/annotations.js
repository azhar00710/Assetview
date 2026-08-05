import prisma from '../db.js';

// Default author ID for annotations (no auth system yet)
const DEFAULT_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

// Compute bounding box size based on tag text length (percentage of drawing)
function computeTagSize(tag, entityType) {
  const len = (tag || '').length;
  if (entityType === 'line') {
    // Lines: keep compact so labels don't look oversized
    return { w: Math.max(2.8, Math.min(6.4, 2.1 + len * 0.22)), h: 0.9 };
  }
  if (entityType === 'instrument') {
    // Instruments: compact circular marker around text
    const d = Math.max(2.1, Math.min(3.6, 1.3 + len * 0.15));
    return { w: d, h: d };
  }
  // Equipment: compact rectangle with readable padding
  return { w: Math.max(2.4, Math.min(5.6, 1.8 + len * 0.16)), h: 1.4 };
}

function normalizeStrokeStyle(strokeStyle) {
  if (!strokeStyle) return 'solid';
  if (['solid', 'dashed', 'dotted'].includes(strokeStyle)) return strokeStyle;
  return 'solid';
}

function toNullableNumber(v) {
  return v == null ? null : Number(v);
}

async function syncAnnotationToJunction(tx, annotation, updateFields) {
  if (!annotation?.linked_entity_id || !annotation?.linked_entity_type) return;
  const hasPos =
    updateFields.x_pct !== undefined ||
    updateFields.y_pct !== undefined ||
    updateFields.w_pct !== undefined ||
    updateFields.h_pct !== undefined;
  if (!hasPos) return;

  const junctionData = {};
  if (updateFields.x_pct !== undefined) junctionData.annotation_x_pct = updateFields.x_pct;
  if (updateFields.y_pct !== undefined) junctionData.annotation_y_pct = updateFields.y_pct;
  if (updateFields.w_pct !== undefined) junctionData.annotation_w_pct = updateFields.w_pct;
  if (updateFields.h_pct !== undefined) junctionData.annotation_h_pct = updateFields.h_pct;

  if (annotation.linked_entity_type === 'equipment') {
    await tx.pnid_equipment.updateMany({
      where: { pnid_id: annotation.pnid_id, equipment_id: annotation.linked_entity_id },
      data: junctionData,
    });
  } else if (annotation.linked_entity_type === 'instrument') {
    await tx.pnid_instrument.updateMany({
      where: { pnid_id: annotation.pnid_id, instrument_id: annotation.linked_entity_id },
      data: junctionData,
    });
  } else if (annotation.linked_entity_type === 'line') {
    const lineData = {};
    if (updateFields.x_pct !== undefined) lineData.annotation_x_pct = updateFields.x_pct;
    if (updateFields.y_pct !== undefined) lineData.annotation_y_pct = updateFields.y_pct;
    await tx.pnid_line.updateMany({
      where: { pnid_id: annotation.pnid_id, line_id: annotation.linked_entity_id },
      data: lineData,
    });
  }
}

export default async function annotationsRoutes(fastify) {

  // ═══ GET /annotations/search — Search tags across entity types ═══
  fastify.get('/annotations/search', async (request, reply) => {
    const { q, platform_id, pnid_id } = request.query;
    if (!q || q.length < 1) {
      return { results: [] };
    }

    const searchTerm = `%${q}%`;

    // Get system IDs scoped to the platform
    let systemFilter = {};
    if (platform_id) {
      const systems = await prisma.system.findMany({
        where: { platform_id, deleted_at: null },
        select: { id: true },
      });
      systemFilter = { system_id: { in: systems.map(s => s.id) } };
    }

    const [equipment, instruments, lines] = await Promise.all([
      prisma.equipment.findMany({
        where: {
          deleted_at: null,
          ...systemFilter,
          OR: [
            { tag: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { equipment_type: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          system: { select: { id: true, code: true } },
          pnid_equipment: {
            select: { pnid_id: true, annotation_x_pct: true, annotation_y_pct: true },
          },
        },
        take: 50,
      }),
      prisma.instrument.findMany({
        where: {
          deleted_at: null,
          ...systemFilter,
          OR: [
            { tag: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          system: { select: { id: true, code: true } },
          pnid_instrument: {
            select: { pnid_id: true, annotation_x_pct: true, annotation_y_pct: true },
          },
        },
        take: 50,
      }),
      prisma.line.findMany({
        where: {
          deleted_at: null,
          ...systemFilter,
          OR: [
            { line_number: { contains: q, mode: 'insensitive' } },
            { service: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: {
          system: { select: { id: true, code: true } },
          pnid_line: {
            select: { pnid_id: true, annotation_x_pct: true, annotation_y_pct: true },
          },
        },
        take: 50,
      }),
    ]);

    // Filter by specific pnid if requested
    const filterByPnid = (junctions) => {
      if (!pnid_id) return junctions;
      return junctions.filter(j => j.pnid_id === pnid_id);
    };

    const results = [
      ...equipment.map(e => ({
        id: e.id,
        tag: e.tag,
        entityType: 'equipment',
        subType: e.equipment_type,
        description: e.description,
        systemCode: e.system?.code,
        pnids: filterByPnid(e.pnid_equipment).map(j => ({
          pnidId: j.pnid_id,
          hasPosition: j.annotation_x_pct != null,
        })),
      })),
      ...instruments.map(i => ({
        id: i.id,
        tag: i.tag,
        entityType: 'instrument',
        subType: i.instrument_type,
        description: i.description,
        systemCode: i.system?.code,
        pnids: filterByPnid(i.pnid_instrument).map(j => ({
          pnidId: j.pnid_id,
          hasPosition: j.annotation_x_pct != null,
        })),
      })),
      ...lines.map(l => ({
        id: l.id,
        tag: l.line_number,
        entityType: 'line',
        subType: l.service,
        description: `${l.nominal_size || ''} ${l.service || ''}`.trim(),
        systemCode: l.system?.code,
        pnids: filterByPnid(l.pnid_line).map(j => ({
          pnidId: j.pnid_id,
          hasPosition: j.annotation_x_pct != null,
        })),
      })),
    ];

    return { results };
  });

  // ═══ GET /pnids/:pnidId/annotation-summary — Annotation stats for a P&ID ═══
  fastify.get('/pnids/:pnidId/annotation-summary', async (request, reply) => {
    const { pnidId } = request.params;

    const [annotations, equipJunctions, instrJunctions, lineJunctions] = await Promise.all([
      prisma.annotation.findMany({
        where: { pnid_id: pnidId, deleted_at: null },
        select: {
          id: true, linked_entity_type: true, linked_entity_id: true,
          metadata: true, approval_status: true,
        },
      }),
      prisma.pnid_equipment.findMany({
        where: { pnid_id: pnidId },
        select: { equipment_id: true, annotation_x_pct: true },
      }),
      prisma.pnid_instrument.findMany({
        where: { pnid_id: pnidId },
        select: { instrument_id: true, annotation_x_pct: true },
      }),
      prisma.pnid_line.findMany({
        where: { pnid_id: pnidId },
        select: { line_id: true, annotation_x_pct: true },
      }),
    ]);

    const totalEntities = equipJunctions.length + instrJunctions.length + lineJunctions.length;
    const positionedEquip = equipJunctions.filter(j => j.annotation_x_pct != null).length;
    const positionedInstr = instrJunctions.filter(j => j.annotation_x_pct != null).length;
    const positionedLines = lineJunctions.filter(j => j.annotation_x_pct != null).length;
    const positioned = positionedEquip + positionedInstr + positionedLines;

    let aiAnnotated = 0;
    let manualAnnotated = 0;
    let approved = 0;
    let draft = 0;
    for (const a of annotations) {
      const src = a.metadata?.source;
      if (src === 'ocr' || a.metadata?.extraction_id) {
        aiAnnotated++;
      } else {
        manualAnnotated++;
      }
      if (a.approval_status === 'approved') approved++;
      else draft++;
    }

    const linkedEntityIds = new Set(annotations.filter(a => a.linked_entity_id).map(a => a.linked_entity_id));
    const positionedNoAnnotation = [
      ...equipJunctions.filter(j => j.annotation_x_pct != null).map(j => j.equipment_id),
      ...instrJunctions.filter(j => j.annotation_x_pct != null).map(j => j.instrument_id),
      ...lineJunctions.filter(j => j.annotation_x_pct != null).map(j => j.line_id),
    ].filter(id => !linkedEntityIds.has(id)).length;

    return {
      total: totalEntities,
      positioned,
      unpositioned: totalEntities - positioned,
      aiAnnotated,
      manualAnnotated,
      approved,
      draft,
      positionedNoAnnotation,
      noGeometry: totalEntities - positioned,
      byType: {
        equipment: equipJunctions.length,
        instruments: instrJunctions.length,
        lines: lineJunctions.length,
      },
      positionedByType: {
        equipment: positionedEquip,
        instruments: positionedInstr,
        lines: positionedLines,
      },
    };
  });

  // ═══ GET /pnids/:pnidId/annotations — All annotations on a P&ID ═══
  fastify.get('/pnids/:pnidId/annotations', async (request, reply) => {
    const { pnidId } = request.params;
    const { status, type, include_staged } = request.query;

    const where = {
      pnid_id: pnidId,
      deleted_at: null,
    };
    if (status) where.status = status;
    if (type) where.annotation_type = type;

    const annotations = await prisma.annotation.findMany({
      where,
      include: {
        annotation_reply: {
          where: { deleted_at: null },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const includeStaged = include_staged === 'true' || include_staged === true;
    const visibleAnnotations = includeStaged
      ? annotations
      : annotations.filter(a => {
          const isOcrDraft = a.metadata?.generatedFromOcr || a.metadata?.source === 'ocr';
          return !(isOcrDraft && a.metadata?.appliedToDrawing !== true);
        });

    return {
      annotations: visibleAnnotations.map(formatAnnotation),
    };
  });

  // ═══ GET /pnids/:pnidId/overlay — Equipment + instrument + line positions for overlay ═══
  fastify.get('/pnids/:pnidId/overlay', async (request, reply) => {
    const { pnidId } = request.params;
    const { include_staged } = request.query;

    const [equipmentPositions, instrumentPositions, linePositions] = await Promise.all([
      prisma.pnid_equipment.findMany({
        where: { pnid_id: pnidId },
        include: {
          equipment: {
            include: { system: { select: { id: true, code: true, sys_type: true } } },
          },
        },
      }),
      prisma.pnid_instrument.findMany({
        where: { pnid_id: pnidId },
        include: {
          instrument: {
            include: {
              system: { select: { id: true, code: true, sys_type: true } },
              line: { select: { id: true, line_number: true } },
            },
          },
        },
      }),
      prisma.pnid_line.findMany({
        where: { pnid_id: pnidId },
        include: {
          line: {
            include: {
              system: { select: { id: true, code: true, sys_type: true } },
            },
          },
          pnid_pnid_line_continuation_from_pnid_idTopnid: {
            select: { id: true, drawing_number: true, title: true },
          },
        },
      }),
    ]);

    // Fetch annotations to determine source (AI vs manual) per entity
    const allAnnotations = await prisma.annotation.findMany({
      where: { pnid_id: pnidId, deleted_at: null, linked_entity_id: { not: null } },
      select: { linked_entity_id: true, metadata: true, approval_status: true },
    });
    const includeStaged = include_staged === 'true' || include_staged === true;
    const annotations = includeStaged
      ? allAnnotations
      : allAnnotations.filter(a => {
          const isOcrDraft = a.metadata?.generatedFromOcr || a.metadata?.source === 'ocr';
          return !(isOcrDraft && a.metadata?.appliedToDrawing !== true);
        });
    const annotationByEntity = {};
    for (const a of annotations) {
      annotationByEntity[a.linked_entity_id] = {
        source: (a.metadata?.source === 'ocr' || a.metadata?.extraction_id) ? 'ai' : 'manual',
        confidence: a.metadata?.ocrConfidence ?? a.metadata?.confidence ?? null,
        approvalStatus: a.approval_status,
      };
    }
    const ocrExtractions = await prisma.ocr_extraction.findMany({
      where: { pnid_id: pnidId, matched_entity_id: { not: null } },
      select: { matched_entity_id: true, confidence: true, extracted_text: true },
    });
    const ocrByEntity = {};
    for (const ext of ocrExtractions) {
      const confidence = ext.confidence != null ? Number(ext.confidence) : null;
      const existing = ocrByEntity[ext.matched_entity_id];
      // Keep the highest-confidence OCR extraction per entity for table comparison.
      if (existing && (existing.confidence ?? -1) >= (confidence ?? -1)) continue;
      ocrByEntity[ext.matched_entity_id] = {
        source: 'ai',
        confidence,
        ocrTag: ext.extracted_text || null,
      };
    }

    return {
      equipment: equipmentPositions.map(ep => ({
        id: ep.equipment.id,
        tag: ep.equipment.tag,
        equipmentType: ep.equipment.equipment_type,
        description: ep.equipment.description,
        criticality: ep.equipment.criticality,
        systemCode: ep.equipment.system?.code,
        systemType: ep.equipment.system?.sys_type,
        systemId: ep.equipment.system?.id,
        positionVerified: ep.position_verified || false,
        xPct: toNullableNumber(ep.annotation_x_pct),
        yPct: toNullableNumber(ep.annotation_y_pct),
        wPct: toNullableNumber(ep.annotation_w_pct),
        hPct: toNullableNumber(ep.annotation_h_pct),
        rotation: ep.annotation_rotation ? Number(ep.annotation_rotation) : 0,
        ...(annotationByEntity[ep.equipment.id] || ocrByEntity[ep.equipment.id] || {}),
      })),
      instruments: instrumentPositions.map(ip => ({
        id: ip.instrument.id,
        tag: ip.instrument.tag,
        instrumentType: ip.instrument.instrument_type,
        description: ip.instrument.description,
        rangeMin: ip.instrument.range_min,
        rangeMax: ip.instrument.range_max,
        rangeUnit: ip.instrument.range_unit,
        scadaTag: ip.instrument.scada_tag,
        systemCode: ip.instrument.system?.code,
        systemType: ip.instrument.system?.sys_type,
        systemId: ip.instrument.system?.id,
        positionVerified: ip.position_verified || false,
        lineNumber: ip.instrument.line?.line_number || null,
        xPct: toNullableNumber(ip.annotation_x_pct),
        yPct: toNullableNumber(ip.annotation_y_pct),
        wPct: toNullableNumber(ip.annotation_w_pct),
        hPct: toNullableNumber(ip.annotation_h_pct),
        rotation: ip.annotation_rotation ? Number(ip.annotation_rotation) : 0,
        ...(annotationByEntity[ip.instrument.id] || ocrByEntity[ip.instrument.id] || {}),
      })),
      lines: linePositions.map(lp => {
        const contPnid = lp.pnid_pnid_line_continuation_from_pnid_idTopnid;
        return {
          id: lp.line.id,
          lineNumber: lp.line.line_number,
          service: lp.line.service,
          nominalSize: lp.line.nominal_size,
          systemCode: lp.line.system?.code,
          systemType: lp.line.system?.sys_type,
          systemId: lp.line.system?.id,
          isContinuation: lp.is_continuation || false,
          continuationFromPnidId: lp.continuation_from_pnid_id,
          continuationFromDrawing: contPnid?.drawing_number || null,
          sheetEntryPoint: lp.sheet_entry_point,
          sheetExitPoint: lp.sheet_exit_point,
          xPct: lp.annotation_x_pct != null ? Number(lp.annotation_x_pct) : null,
          yPct: lp.annotation_y_pct != null ? Number(lp.annotation_y_pct) : null,
          wPct: lp.annotation_w_pct != null ? Number(lp.annotation_w_pct) : null,
          hPct: lp.annotation_h_pct != null ? Number(lp.annotation_h_pct) : null,
          ...(annotationByEntity[lp.line.id] || ocrByEntity[lp.line.id] || {}),
        };
      }),
    };
  });

  // ═══ GET /pnids/:pnidId/linkable-entities — Entities available for linking ═══
  fastify.get('/pnids/:pnidId/linkable-entities', async (request, reply) => {
    const { pnidId } = request.params;

    // Get systems associated with this P&ID via junction table
    const pnidSystems = await prisma.pnid_system.findMany({
      where: { pnid_id: pnidId },
      select: { system_id: true },
    });
    let systemIds = pnidSystems.map(ps => ps.system_id);

    // Fallback: if no pnid_system entries exist, find the platform this P&ID belongs to
    // and return ALL entities from all systems on that platform
    if (systemIds.length === 0) {
      // Try to find the platform via any system linked to this P&ID, or via the pnid record itself
      const pnid = await prisma.pnid.findUnique({
        where: { id: pnidId },
        select: {
          pnid_system: {
            include: { system: { select: { platform_id: true } } },
          },
        },
      });
      let platformId = pnid?.pnid_system?.[0]?.system?.platform_id;

      // If still no platform, try to find via storage_key path or other P&IDs
      if (!platformId) {
        // Get all platforms that have systems
        const allSystems = await prisma.system.findMany({
          where: { deleted_at: null },
          select: { id: true, platform_id: true },
        });
        // Use the first platform as fallback (small deployment)
        if (allSystems.length > 0) {
          platformId = allSystems[0].platform_id;
        }
      }

      if (platformId) {
        const platformSystems = await prisma.system.findMany({
          where: { platform_id: platformId, deleted_at: null },
          select: { id: true },
        });
        systemIds = platformSystems.map(s => s.id);
      }
    }

    // Get lines on this P&ID (from junction), or all lines from the platform systems
    const pnidLines = await prisma.pnid_line.findMany({
      where: { pnid_id: pnidId },
      include: { line: { select: { id: true, line_number: true, service: true, system_id: true } } },
    });

    // Also get all lines from the linked systems (may not be in pnid_line yet)
    const systemLines = systemIds.length > 0
      ? await prisma.line.findMany({
          where: { system_id: { in: systemIds }, deleted_at: null },
          select: { id: true, line_number: true, service: true, system_id: true },
        })
      : [];

    // Merge pnid_line lines with system lines (deduplicate by id)
    const lineMap = new Map();
    for (const pl of pnidLines) {
      lineMap.set(pl.line.id, pl.line);
    }
    for (const sl of systemLines) {
      if (!lineMap.has(sl.id)) lineMap.set(sl.id, sl);
    }
    const allLineIds = [...lineMap.keys()];

    // Get equipment from these systems
    const equipment = systemIds.length > 0
      ? await prisma.equipment.findMany({
          where: { system_id: { in: systemIds }, deleted_at: null },
          select: { id: true, tag: true, equipment_type: true, description: true, system_id: true },
        })
      : [];

    // Get instruments from these systems or lines
    const instrumentWhere = [];
    if (systemIds.length > 0) instrumentWhere.push({ system_id: { in: systemIds } });
    if (allLineIds.length > 0) instrumentWhere.push({ line_id: { in: allLineIds } });

    const instruments = instrumentWhere.length > 0
      ? await prisma.instrument.findMany({
          where: { OR: instrumentWhere, deleted_at: null },
          select: { id: true, tag: true, instrument_type: true, description: true, system_id: true },
        })
      : [];

    return {
      equipment: equipment.map(e => ({ id: e.id, tag: e.tag, type: e.equipment_type, description: e.description })),
      instruments: instruments.map(i => ({ id: i.id, tag: i.tag, type: i.instrument_type, description: i.description })),
      lines: [...lineMap.values()].map(l => ({ id: l.id, lineNumber: l.line_number, service: l.service })),
    };
  });

  // ═══ POST /pnids/:pnidId/annotations — Create annotation ═══
  fastify.post('/pnids/:pnidId/annotations', async (request, reply) => {
    const { pnidId } = request.params;
    const {
      annotationType, shape, text,
      xPct, yPct, wPct, hPct, x2Pct, y2Pct,
      color, strokeWidth, rotation,
      fillOpacity, strokeStyle, showLabel,
      linkedEntityType, linkedEntityId,
      metadata,
    } = request.body;

    if (!annotationType || xPct == null || yPct == null) {
      return reply.code(400).send({ error: 'annotationType, xPct, and yPct are required' });
    }

    const annotation = await prisma.annotation.create({
      data: {
        pnid_id: pnidId,
        author_id: DEFAULT_AUTHOR_ID,
        annotation_type: annotationType,
        shape: shape || null,
        text: text || null,
        x_pct: xPct,
        y_pct: yPct,
        w_pct: wPct ?? null,
        h_pct: hPct ?? null,
        x2_pct: x2Pct ?? null,
        y2_pct: y2Pct ?? null,
        color: color || '#4FE2B0',
        stroke_width: strokeWidth ?? 2,
        rotation: rotation ?? 0,
        fill_opacity: fillOpacity ?? 0.15,
        stroke_style: normalizeStrokeStyle(strokeStyle),
        show_label: showLabel ?? true,
        linked_entity_type: linkedEntityType || null,
        linked_entity_id: linkedEntityId || null,
        metadata: metadata || {},
      },
      include: {
        annotation_reply: true,
      },
    });

    return reply.code(201).send({ annotation: formatAnnotation(annotation) });
  });

  // ═══ PATCH /annotations/:annotationId — Update annotation ═══
  fastify.patch('/annotations/:annotationId', async (request, reply) => {
    const { annotationId } = request.params;
    const {
      text, status, xPct, yPct, wPct, hPct, x2Pct, y2Pct,
      color, strokeWidth, rotation, linkedEntityType, linkedEntityId, metadata,
      fillOpacity, strokeStyle, showLabel,
    } = request.body;

    // Check if annotation is approved — block modifications
    const existing = await prisma.annotation.findUnique({ where: { id: annotationId } });
    if (!existing) return reply.code(404).send({ error: 'Annotation not found' });
    if (existing.approval_status === 'approved') {
      return reply.code(403).send({ error: 'Cannot modify an approved annotation. Revert to draft first.' });
    }

    const data = {};
    if (text !== undefined) data.text = text;
    if (status !== undefined) data.status = status;
    if (xPct !== undefined) data.x_pct = xPct;
    if (yPct !== undefined) data.y_pct = yPct;
    if (wPct !== undefined) data.w_pct = wPct;
    if (hPct !== undefined) data.h_pct = hPct;
    if (x2Pct !== undefined) data.x2_pct = x2Pct;
    if (y2Pct !== undefined) data.y2_pct = y2Pct;
    if (color !== undefined) data.color = color;
    if (strokeWidth !== undefined) data.stroke_width = strokeWidth;
    if (rotation !== undefined) data.rotation = rotation;
    if (fillOpacity !== undefined) data.fill_opacity = fillOpacity;
    if (strokeStyle !== undefined) data.stroke_style = normalizeStrokeStyle(strokeStyle);
    if (showLabel !== undefined) data.show_label = !!showLabel;
    if (linkedEntityType !== undefined) data.linked_entity_type = linkedEntityType;
    if (linkedEntityId !== undefined) data.linked_entity_id = linkedEntityId;
    if (metadata !== undefined) data.metadata = metadata;

    if (status === 'resolved') {
      data.metadata = {
        ...(metadata || {}),
        resolvedAt: new Date().toISOString(),
        resolvedBy: DEFAULT_AUTHOR_ID,
      };
    }

    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data,
      include: { annotation_reply: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } } },
    });

    try {
      await syncAnnotationToJunction(prisma, existing, data);
    } catch (e) { /* junction sync is best-effort */ }

    return { annotation: formatAnnotation(annotation) };
  });

  // ═══ PATCH /annotations/bulk-update — Update many annotations in one transaction ═══
  fastify.patch('/annotations/bulk-update', async (request, reply) => {
    const { annotationIds, updates } = request.body || {};
    if (!Array.isArray(annotationIds) || annotationIds.length === 0) {
      return reply.code(400).send({ error: 'annotationIds must be a non-empty array' });
    }
    if (!updates || typeof updates !== 'object') {
      return reply.code(400).send({ error: 'updates object is required' });
    }

    const normalized = {};
    if (updates.text !== undefined) normalized.text = updates.text;
    if (updates.status !== undefined) normalized.status = updates.status;
    if (updates.xPct !== undefined) normalized.x_pct = updates.xPct;
    if (updates.yPct !== undefined) normalized.y_pct = updates.yPct;
    if (updates.wPct !== undefined) normalized.w_pct = updates.wPct;
    if (updates.hPct !== undefined) normalized.h_pct = updates.hPct;
    if (updates.x2Pct !== undefined) normalized.x2_pct = updates.x2Pct;
    if (updates.y2Pct !== undefined) normalized.y2_pct = updates.y2Pct;
    if (updates.color !== undefined) normalized.color = updates.color;
    if (updates.strokeWidth !== undefined) normalized.stroke_width = updates.strokeWidth;
    if (updates.rotation !== undefined) normalized.rotation = updates.rotation;
    if (updates.fillOpacity !== undefined) normalized.fill_opacity = updates.fillOpacity;
    if (updates.strokeStyle !== undefined) normalized.stroke_style = normalizeStrokeStyle(updates.strokeStyle);
    if (updates.showLabel !== undefined) normalized.show_label = !!updates.showLabel;
    if (updates.shape !== undefined) normalized.shape = updates.shape;

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.annotation.findMany({
        where: { id: { in: annotationIds }, deleted_at: null },
      });

      const editable = existing.filter(a => a.approval_status !== 'approved');
      const editableIds = editable.map(a => a.id);

      if (editableIds.length === 0) return [];

      await Promise.all(
        editableIds.map(id =>
          tx.annotation.update({ where: { id }, data: normalized })
        )
      );

      await Promise.all(
        editable.map(a => syncAnnotationToJunction(tx, a, normalized))
      );

      return tx.annotation.findMany({
        where: { id: { in: editableIds } },
        include: {
          annotation_reply: {
            where: { deleted_at: null },
            orderBy: { created_at: 'asc' },
          },
        },
      });
    });

    return {
      updatedCount: updated.length,
      annotations: updated.map(formatAnnotation),
    };
  });

  // ═══ PATCH /annotations/:annotationId/approve — Approve or revert annotation ═══
  fastify.patch('/annotations/:annotationId/approve', async (request, reply) => {
    const { annotationId } = request.params;
    const { approve } = request.body; // true = approve, false = revert to draft

    const existing = await prisma.annotation.findUnique({ where: { id: annotationId } });
    if (!existing) return reply.code(404).send({ error: 'Annotation not found' });

    const data = approve
      ? {
          approval_status: 'approved',
          approved_by: DEFAULT_AUTHOR_ID,
          approved_at: new Date(),
        }
      : {
          approval_status: 'draft',
          approved_by: null,
          approved_at: null,
        };

    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data,
      include: { annotation_reply: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } } },
    });

    return { annotation: formatAnnotation(annotation) };
  });

  // ═══ POST /annotations/:annotationId/replies — Add reply ═══
  fastify.post('/annotations/:annotationId/replies', async (request, reply) => {
    const { annotationId } = request.params;
    const { text } = request.body;

    if (!text) {
      return reply.code(400).send({ error: 'text is required' });
    }

    const newReply = await prisma.annotation_reply.create({
      data: {
        annotation_id: annotationId,
        author_id: DEFAULT_AUTHOR_ID,
        text,
      },
    });

    return reply.code(201).send({
      reply: {
        id: newReply.id,
        annotationId: newReply.annotation_id,
        authorId: newReply.author_id,
        text: newReply.text,
        createdAt: newReply.created_at,
      },
    });
  });

  // ═══ POST /pnids/:pnidId/place-entity — Create entity + junction + annotation in one step ═══
  fastify.post('/pnids/:pnidId/place-entity', async (request, reply) => {
    const { pnidId } = request.params;
    const {
      entityType, // 'equipment' | 'instrument' | 'line'
      entityId,   // existing entity ID (null if creating new)
      // For creating new entities:
      tag, entitySubType, description, systemId, lineId, service, nominalSize,
      // Position on P&ID:
      xPct, yPct, wPct, hPct, x2Pct, y2Pct,
      // Annotation shape/style:
      shape, color, strokeWidth,
      // Metadata (for symbol annotations):
      metadata,
    } = request.body;

    if (!entityType || xPct == null || yPct == null) {
      return reply.code(400).send({ error: 'entityType, xPct, and yPct are required' });
    }

    // If no systemId provided, get the primary system for this P&ID
    let resolvedSystemId = systemId;
    if (!resolvedSystemId) {
      const primarySys = await prisma.pnid_system.findFirst({
        where: { pnid_id: pnidId, is_primary: true },
      });
      if (primarySys) resolvedSystemId = primarySys.system_id;
    }

    let resolvedEntityId = entityId;

    // Create new entity if no existing entityId
    if (!resolvedEntityId) {
      if (!tag) return reply.code(400).send({ error: 'tag is required for new entities' });
      if (!resolvedSystemId) return reply.code(400).send({ error: 'systemId is required (no primary system found)' });

      if (entityType === 'equipment') {
        const eq = await prisma.equipment.create({
          data: {
            system_id: resolvedSystemId,
            tag,
            equipment_type: entitySubType || 'General',
            description: description || null,
            line_id: lineId || null,
          },
        });
        resolvedEntityId = eq.id;
      } else if (entityType === 'instrument') {
        const inst = await prisma.instrument.create({
          data: {
            system_id: resolvedSystemId,
            tag,
            instrument_type: entitySubType || 'other',
            description: description || null,
            line_id: lineId || null,
          },
        });
        resolvedEntityId = inst.id;
      } else if (entityType === 'line') {
        const ln = await prisma.line.create({
          data: {
            system_id: resolvedSystemId,
            line_number: tag,
            service: service || null,
            nominal_size: nominalSize || null,
          },
        });
        resolvedEntityId = ln.id;
      }
    }

    // Create junction table entry (place entity on P&ID with coordinates)
    const autoSize = computeTagSize(tag, entityType);
    let junction;
    if (entityType === 'equipment') {
      junction = await prisma.pnid_equipment.upsert({
        where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: resolvedEntityId } },
        create: { pnid_id: pnidId, equipment_id: resolvedEntityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
        update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
      });
    } else if (entityType === 'instrument') {
      junction = await prisma.pnid_instrument.upsert({
        where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: resolvedEntityId } },
        create: { pnid_id: pnidId, instrument_id: resolvedEntityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
        update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
      });
    } else if (entityType === 'line') {
      junction = await prisma.pnid_line.upsert({
        where: { pnid_id_line_id: { pnid_id: pnidId, line_id: resolvedEntityId } },
        create: { pnid_id: pnidId, line_id: resolvedEntityId, annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
        update: { annotation_x_pct: xPct, annotation_y_pct: yPct, annotation_w_pct: wPct || autoSize.w, annotation_h_pct: hPct || autoSize.h },
      });
    }

    // Create annotation linked to entity
    const annotation = await prisma.annotation.create({
      data: {
        pnid_id: pnidId,
        author_id: DEFAULT_AUTHOR_ID,
        annotation_type: 'shape',
        shape: shape || (entityType === 'instrument' ? 'circle' : 'rectangle'),
        x_pct: xPct,
        y_pct: yPct,
        w_pct: wPct ?? autoSize.w,
        h_pct: hPct ?? autoSize.h,
        x2_pct: x2Pct ?? null,
        y2_pct: y2Pct ?? null,
        color: color || '#4FE2B0',
        stroke_width: strokeWidth ?? 2,
        fill_opacity: metadata?.fillOpacity ?? 0.15,
        stroke_style: normalizeStrokeStyle(metadata?.strokeStyle),
        show_label: metadata?.showLabel ?? true,
        linked_entity_type: entityType,
        linked_entity_id: resolvedEntityId,
        metadata: metadata ?? null,
      },
      include: { annotation_reply: true },
    });

    return reply.code(201).send({
      annotation: formatAnnotation(annotation),
      entityId: resolvedEntityId,
      entityType,
    });
  });

  // ═══ POST /pnids/:pnidId/bulk-link-placed — Create annotations for placed entities that lack them ═══
  fastify.post('/pnids/:pnidId/bulk-link-placed', async (request, reply) => {
    const { pnidId } = request.params;

    // Get all placed entities from junction tables
    const [equipJunctions, instrJunctions, lineJunctions] = await Promise.all([
      prisma.pnid_equipment.findMany({
        where: { pnid_id: pnidId },
        include: { equipment: { select: { tag: true } } },
      }),
      prisma.pnid_instrument.findMany({
        where: { pnid_id: pnidId },
        include: { instrument: { select: { tag: true } } },
      }),
      prisma.pnid_line.findMany({
        where: { pnid_id: pnidId },
        include: { line: { select: { line_number: true } } },
      }),
    ]);

    // Get existing linked annotations to find which entities already have one
    const existingAnnotations = await prisma.annotation.findMany({
      where: { pnid_id: pnidId, deleted_at: null, linked_entity_id: { not: null } },
      select: { linked_entity_id: true },
    });
    const alreadyLinked = new Set(existingAnnotations.map(a => a.linked_entity_id));

    // OCR-derived entity ids for this P&ID (used to mark source correctly)
    const ocrMatched = await prisma.ocr_extraction.findMany({
      where: {
        pnid_id: pnidId,
        matched_entity_id: { not: null },
        status: 'approved',
      },
      select: { matched_entity_id: true },
    });
    const ocrEntityIds = new Set(ocrMatched.map(r => r.matched_entity_id));
    const ocrPosRows = await prisma.ocr_extraction.findMany({
      where: { pnid_id: pnidId, matched_entity_id: { not: null } },
      select: {
        matched_entity_id: true,
        bbox_x_pct: true,
        bbox_y_pct: true,
        bbox_w_pct: true,
        bbox_h_pct: true,
        confidence: true,
      },
      orderBy: [{ confidence: 'desc' }, { created_at: 'asc' }],
    });
    const ocrPosByEntity = new Map();
    for (const row of ocrPosRows) {
      if (ocrPosByEntity.has(row.matched_entity_id)) continue;
      if (row.bbox_x_pct == null || row.bbox_y_pct == null) continue;
      const x = Number(row.bbox_x_pct);
      const y = Number(row.bbox_y_pct);
      if (x === 0 && y === 0) continue;
      ocrPosByEntity.set(row.matched_entity_id, {
        x,
        y,
        w: row.bbox_w_pct == null ? null : Number(row.bbox_w_pct),
        h: row.bbox_h_pct == null ? null : Number(row.bbox_h_pct),
      });
    }

    // Build annotation records for unlinked placed entities
    const toCreate = [];
    for (const j of equipJunctions) {
      const fallback = ocrPosByEntity.get(j.equipment_id);
      const x = j.annotation_x_pct != null ? Number(j.annotation_x_pct) : (fallback?.x ?? null);
      const y = j.annotation_y_pct != null ? Number(j.annotation_y_pct) : (fallback?.y ?? null);
      const w = j.annotation_w_pct != null ? Number(j.annotation_w_pct) : (fallback?.w ?? null);
      const h = j.annotation_h_pct != null ? Number(j.annotation_h_pct) : (fallback?.h ?? null);
      if (!alreadyLinked.has(j.equipment_id) && x != null && y != null) {
        const sz = computeTagSize(j.equipment?.tag, 'equipment');
        toCreate.push({
          pnid_id: pnidId,
          author_id: DEFAULT_AUTHOR_ID,
          annotation_type: 'shape',
          shape: 'rectangle',
          x_pct: x,
          y_pct: y,
          w_pct: w || sz.w,
          h_pct: h || sz.h,
          color: '#3BE494',
          stroke_width: 1,
          linked_entity_type: 'equipment',
          linked_entity_id: j.equipment_id,
          fill_opacity: 0.08,
          metadata: { source: ocrEntityIds.has(j.equipment_id) ? 'ocr' : 'bulk_link' },
        });
      }
    }
    for (const j of instrJunctions) {
      const fallback = ocrPosByEntity.get(j.instrument_id);
      const x = j.annotation_x_pct != null ? Number(j.annotation_x_pct) : (fallback?.x ?? null);
      const y = j.annotation_y_pct != null ? Number(j.annotation_y_pct) : (fallback?.y ?? null);
      const w = j.annotation_w_pct != null ? Number(j.annotation_w_pct) : (fallback?.w ?? null);
      const h = j.annotation_h_pct != null ? Number(j.annotation_h_pct) : (fallback?.h ?? null);
      if (!alreadyLinked.has(j.instrument_id) && x != null && y != null) {
        const sz = computeTagSize(j.instrument?.tag, 'instrument');
        toCreate.push({
          pnid_id: pnidId,
          author_id: DEFAULT_AUTHOR_ID,
          annotation_type: 'shape',
          shape: 'circle',
          x_pct: x,
          y_pct: y,
          w_pct: w || sz.w,
          h_pct: h || sz.h,
          color: '#FFD466',
          stroke_width: 1,
          linked_entity_type: 'instrument',
          linked_entity_id: j.instrument_id,
          fill_opacity: 0.08,
          metadata: { source: ocrEntityIds.has(j.instrument_id) ? 'ocr' : 'bulk_link' },
        });
      }
    }
    for (const j of lineJunctions) {
      const fallback = ocrPosByEntity.get(j.line_id);
      const x = j.annotation_x_pct != null ? Number(j.annotation_x_pct) : (fallback?.x ?? null);
      const y = j.annotation_y_pct != null ? Number(j.annotation_y_pct) : (fallback?.y ?? null);
      const w = j.annotation_w_pct != null ? Number(j.annotation_w_pct) : (fallback?.w ?? null);
      const h = j.annotation_h_pct != null ? Number(j.annotation_h_pct) : (fallback?.h ?? null);
      if (!alreadyLinked.has(j.line_id) && x != null && y != null) {
        const sz = computeTagSize(j.line?.line_number, 'line');
        toCreate.push({
          pnid_id: pnidId,
          author_id: DEFAULT_AUTHOR_ID,
          annotation_type: 'shape',
          shape: 'rectangle',
          x_pct: x,
          y_pct: y,
          w_pct: w || sz.w,
          h_pct: h || sz.h,
          color: '#8AB4FF',
          stroke_width: 1,
          linked_entity_type: 'line',
          linked_entity_id: j.line_id,
          fill_opacity: 0.08,
          metadata: { source: ocrEntityIds.has(j.line_id) ? 'ocr' : 'bulk_link' },
        });
      }
    }

    if (toCreate.length === 0) {
      return { created: 0, message: 'All placed entities already have annotations' };
    }

    const result = await prisma.annotation.createMany({ data: toCreate });
    return { created: result.count, message: `Created ${result.count} annotation links` };
  });

  // ═══ POST /pnids/:pnidId/bulk-approve — Approve all draft annotations ═══
  fastify.post('/pnids/:pnidId/bulk-approve', async (request, reply) => {
    const { pnidId } = request.params;
    const { entityType } = request.body || {}; // optional filter

    const where = {
      pnid_id: pnidId,
      deleted_at: null,
      approval_status: { not: 'approved' },
      linked_entity_id: { not: null },
    };
    if (entityType) where.linked_entity_type = entityType;

    const result = await prisma.annotation.updateMany({
      where,
      data: {
        approval_status: 'approved',
        approved_by: DEFAULT_AUTHOR_ID,
        approved_at: new Date(),
      },
    });

    return { approved: result.count, message: `Approved ${result.count} annotations` };
  });

  // ═══ DELETE /annotations/:annotationId — Soft delete ═══
  fastify.delete('/annotations/:annotationId', async (request, reply) => {
    const { annotationId } = request.params;
    const { deleteEntity } = request.query || {};

    // Check if annotation is approved — block deletion
    const existing = await prisma.annotation.findUnique({ where: { id: annotationId } });
    if (!existing) return reply.code(404).send({ error: 'Annotation not found' });
    if (existing.approval_status === 'approved') {
      return reply.code(403).send({ error: 'Cannot delete an approved annotation. Revert to draft first.' });
    }

    // Soft-delete the annotation
    await prisma.annotation.update({
      where: { id: annotationId },
      data: { deleted_at: new Date() },
    });

    let entityDeleted = false;
    let junctionDeleted = false;

    // Optionally delete the linked entity + junction if requested and safe
    if (deleteEntity === 'true' && existing.linked_entity_id && existing.linked_entity_type) {
      const entityId = existing.linked_entity_id;
      const entityType = existing.linked_entity_type;

      // Check: is this entity linked by any OTHER non-deleted annotation?
      const otherLinks = await prisma.annotation.count({
        where: {
          linked_entity_id: entityId,
          deleted_at: null,
          id: { not: annotationId },
        },
      });

      if (otherLinks === 0) {
        // Safe to delete junction + entity — no other annotations reference it
        try {
          if (entityType === 'equipment') {
            await prisma.pnid_equipment.deleteMany({ where: { equipment_id: entityId } });
            await prisma.equipment.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
          } else if (entityType === 'instrument') {
            await prisma.pnid_instrument.deleteMany({ where: { instrument_id: entityId } });
            await prisma.instrument.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
          } else if (entityType === 'line') {
            await prisma.pnid_line.deleteMany({ where: { line_id: entityId } });
            await prisma.line.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
          }
          entityDeleted = true;
          junctionDeleted = true;
        } catch (err) {
          console.warn(`[annotations] Failed to delete entity ${entityType}/${entityId}: ${err.message}`);
        }
      }
    }

    return { success: true, entityDeleted, junctionDeleted };
  });

  // ═══ POST /annotations/bulk-delete — Delete multiple annotations at once ═══
  fastify.post('/annotations/bulk-delete', async (request, reply) => {
    const { annotationIds = [], deleteEntities = false } = request.body || {};
    if (!Array.isArray(annotationIds) || annotationIds.length === 0) {
      return reply.code(400).send({ error: 'annotationIds array is required' });
    }

    const annotations = await prisma.annotation.findMany({
      where: { id: { in: annotationIds }, deleted_at: null },
    });

    let deletedCount = 0;
    let skippedApproved = 0;
    let entitiesDeleted = 0;

    for (const ann of annotations) {
      if (ann.approval_status === 'approved') {
        skippedApproved++;
        continue;
      }

      // Soft-delete annotation
      await prisma.annotation.update({
        where: { id: ann.id },
        data: { deleted_at: new Date() },
      });
      deletedCount++;

      // Optionally delete entity + junction
      if (deleteEntities && ann.linked_entity_id && ann.linked_entity_type) {
        const otherLinks = await prisma.annotation.count({
          where: {
            linked_entity_id: ann.linked_entity_id,
            deleted_at: null,
            id: { not: ann.id },
          },
        });

        if (otherLinks === 0) {
          try {
            if (ann.linked_entity_type === 'equipment') {
              await prisma.pnid_equipment.deleteMany({ where: { equipment_id: ann.linked_entity_id } });
              await prisma.equipment.update({ where: { id: ann.linked_entity_id }, data: { deleted_at: new Date() } });
            } else if (ann.linked_entity_type === 'instrument') {
              await prisma.pnid_instrument.deleteMany({ where: { instrument_id: ann.linked_entity_id } });
              await prisma.instrument.update({ where: { id: ann.linked_entity_id }, data: { deleted_at: new Date() } });
            } else if (ann.linked_entity_type === 'line') {
              await prisma.pnid_line.deleteMany({ where: { line_id: ann.linked_entity_id } });
              await prisma.line.update({ where: { id: ann.linked_entity_id }, data: { deleted_at: new Date() } });
            }
            entitiesDeleted++;
          } catch (err) {
            console.warn(`[annotations] Bulk: failed to delete entity ${ann.linked_entity_type}/${ann.linked_entity_id}: ${err.message}`);
          }
        }
      }
    }

    return { deletedCount, skippedApproved, entitiesDeleted, total: annotations.length };
  });

  // ═══ POST /annotations/bulk-revert — Revert approved annotations to draft ═══
  fastify.post('/annotations/bulk-revert', async (request, reply) => {
    const { annotationIds = [] } = request.body || {};
    if (!Array.isArray(annotationIds) || annotationIds.length === 0) {
      return reply.code(400).send({ error: 'annotationIds array is required' });
    }

    const result = await prisma.annotation.updateMany({
      where: {
        id: { in: annotationIds },
        deleted_at: null,
        approval_status: 'approved',
      },
      data: {
        approval_status: 'draft',
        approved_by: null,
        approved_at: null,
      },
    });

    return { reverted: result.count };
  });

  // ═══ GET /annotations/orphaned-entities — Find entities with no active annotations ═══
  fastify.get('/annotations/orphaned-entities', async (request, reply) => {
    const { platformId } = request.query || {};

    // Find equipment, instruments, lines that have no active annotations.
    // Two query variants: with or without platform filter.
    const orphanedEquipment = platformId ? await prisma.$queryRaw`
      SELECT e.id, e.tag, 'equipment' as entity_type, e.system_id, e.created_at
      FROM equipment e
      WHERE e.deleted_at IS NULL
        AND e.system_id IN (SELECT id FROM system WHERE platform_id = ${platformId}::uuid AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = e.id AND a.linked_entity_type = 'equipment' AND a.deleted_at IS NULL)
      ORDER BY e.created_at DESC LIMIT 500
    `.catch(() => []) : await prisma.$queryRaw`
      SELECT e.id, e.tag, 'equipment' as entity_type, e.system_id, e.created_at
      FROM equipment e
      WHERE e.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = e.id AND a.linked_entity_type = 'equipment' AND a.deleted_at IS NULL)
      ORDER BY e.created_at DESC LIMIT 500
    `.catch(() => []);

    const orphanedInstruments = platformId ? await prisma.$queryRaw`
      SELECT i.id, i.tag, 'instrument' as entity_type, i.system_id, i.created_at
      FROM instrument i
      WHERE i.deleted_at IS NULL
        AND i.system_id IN (SELECT id FROM system WHERE platform_id = ${platformId}::uuid AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = i.id AND a.linked_entity_type = 'instrument' AND a.deleted_at IS NULL)
      ORDER BY i.created_at DESC LIMIT 500
    `.catch(() => []) : await prisma.$queryRaw`
      SELECT i.id, i.tag, 'instrument' as entity_type, i.system_id, i.created_at
      FROM instrument i
      WHERE i.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = i.id AND a.linked_entity_type = 'instrument' AND a.deleted_at IS NULL)
      ORDER BY i.created_at DESC LIMIT 500
    `.catch(() => []);

    const orphanedLines = platformId ? await prisma.$queryRaw`
      SELECT l.id, l.line_number as tag, 'line' as entity_type, l.system_id, l.created_at
      FROM line l
      WHERE l.deleted_at IS NULL
        AND l.system_id IN (SELECT id FROM system WHERE platform_id = ${platformId}::uuid AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = l.id AND a.linked_entity_type = 'line' AND a.deleted_at IS NULL)
      ORDER BY l.created_at DESC LIMIT 500
    `.catch(() => []) : await prisma.$queryRaw`
      SELECT l.id, l.line_number as tag, 'line' as entity_type, l.system_id, l.created_at
      FROM line l
      WHERE l.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM annotation a WHERE a.linked_entity_id = l.id AND a.linked_entity_type = 'line' AND a.deleted_at IS NULL)
      ORDER BY l.created_at DESC LIMIT 500
    `.catch(() => []);

    return {
      equipment: orphanedEquipment.map(e => ({ id: e.id, tag: e.tag, entityType: e.entity_type, systemId: e.system_id, createdAt: e.created_at })),
      instruments: orphanedInstruments.map(i => ({ id: i.id, tag: i.tag, entityType: i.entity_type, systemId: i.system_id, createdAt: i.created_at })),
      lines: orphanedLines.map(l => ({ id: l.id, tag: l.tag, entityType: l.entity_type, systemId: l.system_id, createdAt: l.created_at })),
      total: orphanedEquipment.length + orphanedInstruments.length + orphanedLines.length,
    };
  });

  // ═══ POST /annotations/cleanup-entities — Delete orphaned entities ═══
  fastify.post('/annotations/cleanup-entities', async (request, reply) => {
    const { entityIds = [], entityType } = request.body || {};

    if (!Array.isArray(entityIds) || entityIds.length === 0) {
      return reply.code(400).send({ error: 'entityIds array is required' });
    }
    if (!['equipment', 'instrument', 'line'].includes(entityType)) {
      return reply.code(400).send({ error: 'entityType must be equipment, instrument, or line' });
    }

    let deleted = 0;
    let skipped = 0;

    for (const entityId of entityIds) {
      // Double-check: only delete if no active annotations link to it
      const activeLinks = await prisma.annotation.count({
        where: { linked_entity_id: entityId, deleted_at: null },
      });
      if (activeLinks > 0) {
        skipped++;
        continue;
      }

      try {
        if (entityType === 'equipment') {
          await prisma.pnid_equipment.deleteMany({ where: { equipment_id: entityId } });
          await prisma.equipment.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
        } else if (entityType === 'instrument') {
          await prisma.pnid_instrument.deleteMany({ where: { instrument_id: entityId } });
          await prisma.instrument.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
        } else if (entityType === 'line') {
          await prisma.pnid_line.deleteMany({ where: { line_id: entityId } });
          await prisma.line.update({ where: { id: entityId }, data: { deleted_at: new Date() } });
        }
        deleted++;
      } catch (err) {
        console.warn(`[annotations] Failed to cleanup entity ${entityType}/${entityId}: ${err.message}`);
        skipped++;
      }
    }

    return { deleted, skipped, total: entityIds.length };
  });
}

function formatAnnotation(a) {
  return {
    id: a.id,
    pnidId: a.pnid_id,
    authorId: a.author_id,
    annotationType: a.annotation_type,
    shape: a.shape,
    text: a.text,
    xPct: Number(a.x_pct),
    yPct: Number(a.y_pct),
    wPct: a.w_pct != null ? Number(a.w_pct) : null,
    hPct: a.h_pct != null ? Number(a.h_pct) : null,
    x2Pct: a.x2_pct != null ? Number(a.x2_pct) : null,
    y2Pct: a.y2_pct != null ? Number(a.y2_pct) : null,
    color: a.color,
    strokeWidth: a.stroke_width,
    rotation: a.rotation ? Number(a.rotation) : 0,
    fillOpacity: a.fill_opacity != null ? Number(a.fill_opacity) : 0.15,
    strokeStyle: a.stroke_style || 'solid',
    showLabel: a.show_label !== false,
    linkedEntityType: a.linked_entity_type,
    linkedEntityId: a.linked_entity_id,
    status: a.status,
    approvalStatus: a.approval_status || 'draft',
    approvedBy: a.approved_by,
    approvedAt: a.approved_at,
    metadata: a.metadata,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    replies: (a.annotation_reply || []).map(r => ({
      id: r.id,
      authorId: r.author_id,
      text: r.text,
      createdAt: r.created_at,
    })),
  };
}
