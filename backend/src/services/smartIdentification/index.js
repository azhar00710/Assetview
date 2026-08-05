/**
 * Smart Identification orchestration service.
 */

import prisma from '../../db.js';
import { getPnidRaster } from './pnidRaster.js';
import { extractSegmentsFromBoundary, colorForAssignment } from './segmentExtractor.js';
import { buildSnapPointsFromOverlay, snapSegments, pruneNoiseSegments } from './segmentSnap.js';

/** In-memory cache — guide-line extraction blocks the server for 30–90s on large PDFs. */
const guideLineCache = new Map();
const guideLineInflight = new Map();
const GUIDE_LINE_CACHE_TTL_MS = 30 * 60 * 1000;
const GUIDE_LINE_DPI = Number(process.env.SMART_IDENT_GUIDE_DPI || 180);

async function fetchSnapContext(pnidId) {
  const [equipmentPositions, instrumentPositions, linePositions, ocrExtractions] = await Promise.all([
    prisma.pnid_equipment.findMany({
      where: { pnid_id: pnidId },
      include: { equipment: { select: { id: true, tag: true } } },
    }),
    prisma.pnid_instrument.findMany({
      where: { pnid_id: pnidId },
      include: { instrument: { select: { id: true, tag: true } } },
    }),
    prisma.pnid_line.findMany({
      where: { pnid_id: pnidId },
      include: { line: { select: { id: true, line_number: true } } },
    }),
    prisma.$queryRaw`
      SELECT id, extracted_text, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
      FROM ocr_extraction
      WHERE pnid_id = ${pnidId}::uuid
        AND bbox_x_pct IS NOT NULL
      LIMIT 500
    `.catch(() => []),
  ]);

  const overlay = {
    equipment: equipmentPositions.map((ep) => ({
      id: ep.equipment.id,
      tag: ep.equipment.tag,
      xPct: ep.annotation_x_pct,
      yPct: ep.annotation_y_pct,
    })),
    instruments: instrumentPositions.map((ip) => ({
      id: ip.instrument.id,
      tag: ip.instrument.tag,
      xPct: ip.annotation_x_pct,
      yPct: ip.annotation_y_pct,
    })),
    lines: linePositions.map((lp) => ({
      id: lp.line.id,
      lineNumber: lp.line.line_number,
      xPct: lp.annotation_x_pct,
      yPct: lp.annotation_y_pct,
    })),
  };

  return buildSnapPointsFromOverlay(overlay, ocrExtractions);
}

export async function createDetectionSession(pnidId, { boundary, pageNumber = 1, enableSnap = true }) {
  const sessionRows = await prisma.$queryRaw`
    INSERT INTO smart_ident_session (
      pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
      page_number, status, metadata
    ) VALUES (
      ${pnidId}::uuid,
      ${boundary.xPct}, ${boundary.yPct}, ${boundary.wPct}, ${boundary.hPct},
      ${pageNumber}, 'processing', ${JSON.stringify({ mode: 'auto_detect' })}::jsonb
    )
    RETURNING id, pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
              page_number, status, segment_count, metadata, created_at, updated_at
  `;
  const session = sessionRows[0];

  try {
    const { rasterBuffer, width, height, sourceType } = await getPnidRaster(pnidId, pageNumber);
    let detected = await extractSegmentsFromBoundary(rasterBuffer, boundary, width, height);
    detected = pruneNoiseSegments(detected);

    if (enableSnap) {
      const snapPoints = await fetchSnapContext(pnidId);
      detected = snapSegments(detected, snapPoints);
    }

    const snapCount = detected.filter((s) => s.metadata?.snapped).length;

    const insertedSegments = [];
    for (const seg of detected) {
      const rows = await prisma.$queryRaw`
        INSERT INTO smart_ident_segment (
          session_id, pnid_id, segment_type, geometry, detection_confidence, metadata
        ) VALUES (
          ${session.id}::uuid,
          ${pnidId}::uuid,
          ${seg.segmentType},
          ${JSON.stringify(seg.geometry)}::jsonb,
          ${seg.confidence},
          ${JSON.stringify(seg.metadata || {})}::jsonb
        )
        RETURNING id, session_id, pnid_id, segment_type, geometry, detection_confidence,
                  linked_entity_type, linked_entity_id, parent_segment_id, display_color,
                  assigned_at, metadata, created_at, updated_at
      `;
      insertedSegments.push(formatSegment(rows[0]));
    }

    await prisma.$queryRaw`
      UPDATE smart_ident_session
      SET status = 'ready',
          segment_count = ${insertedSegments.length},
          metadata = ${JSON.stringify({
            sourceType,
            imageWidth: width,
            imageHeight: height,
            snapCount,
            warnings: insertedSegments.length === 0
              ? ['No segments detected in boundary — try a larger area or higher-contrast region']
              : [],
          })}::jsonb,
          updated_at = NOW()
      WHERE id = ${session.id}::uuid
    `;

    return {
      session: formatSession({ ...session, status: 'ready', segment_count: insertedSegments.length }),
      segments: insertedSegments,
    };
  } catch (err) {
    await prisma.$queryRaw`
      UPDATE smart_ident_session
      SET status = 'failed',
          metadata = ${JSON.stringify({ error: err.message })}::jsonb,
          updated_at = NOW()
      WHERE id = ${session.id}::uuid
    `;
    throw err;
  }
}

export async function getSession(pnidId, sessionId) {
  const sessions = await prisma.$queryRaw`
    SELECT id, pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
           page_number, status, segment_count, metadata, created_at, updated_at
    FROM smart_ident_session
    WHERE id = ${sessionId}::uuid AND pnid_id = ${pnidId}::uuid
  `;
  if (!sessions.length) return null;

  const segments = await prisma.$queryRaw`
    SELECT id, session_id, pnid_id, segment_type, geometry, detection_confidence,
           linked_entity_type, linked_entity_id, parent_segment_id, display_color,
           assigned_at, metadata, created_at, updated_at
    FROM smart_ident_segment
    WHERE session_id = ${sessionId}::uuid
    ORDER BY created_at ASC
  `;

  // Backfill overlay positions for already-assigned segments (tag search / highlight).
  for (const row of segments) {
    if (row.linked_entity_type && row.linked_entity_id && row.geometry) {
      try {
        await syncOverlayFromSegment(pnidId, {
          entityType: row.linked_entity_type,
          entityId: row.linked_entity_id,
          geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry,
        });
      } catch (err) {
        console.warn('[smart-ident] overlay backfill failed:', err.message);
      }
      try {
        await syncAnnotationFromSmartIdent(pnidId, {
          entityType: row.linked_entity_type,
          entityId: row.linked_entity_id,
          geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry,
          segmentId: row.id,
        });
      } catch (err) {
        console.warn('[smart-ident] annotation backfill failed:', err.message);
      }
    }
  }

  return {
    session: formatSession(sessions[0]),
    segments: segments.map(formatSegment),
  };
}

export async function listSessions(pnidId, { mode } = {}) {
  const rows = await prisma.$queryRaw`
    SELECT id, pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
           page_number, status, segment_count, metadata, created_at, updated_at
    FROM smart_ident_session
    WHERE pnid_id = ${pnidId}::uuid
      AND (${mode || null}::text IS NULL OR metadata->>'mode' = ${mode || null})
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 20
  `;
  return rows.map(formatSession);
}

export async function assignSegment(pnidId, segmentId, {
  linkedEntityType,
  linkedEntityId,
  parentSegmentId,
  label,
  metadataPatch,
  displayColor,
}) {
  const existing = await prisma.$queryRaw`
    SELECT linked_entity_type, linked_entity_id, parent_segment_id, metadata, geometry, display_color
    FROM smart_ident_segment
    WHERE id = ${segmentId}::uuid AND pnid_id = ${pnidId}::uuid
  `;
  if (!existing.length) return null;

  const cur = existing[0];
  const nextType = linkedEntityType !== undefined ? linkedEntityType : cur.linked_entity_type;
  const nextId = linkedEntityId !== undefined ? linkedEntityId : cur.linked_entity_id;
  const nextParent = parentSegmentId !== undefined ? parentSegmentId : cur.parent_segment_id;
  const curMeta = cur.metadata || {};
  const nextLabel = label !== undefined ? label : curMeta.label;

  const metaUpdates = { ...(metadataPatch || {}) };
  if (nextLabel) metaUpdates.label = nextLabel;
  const hasMetaUpdates = Object.keys(metaUpdates).length > 0;

  // Prefer explicit user color; otherwise keep existing so flow colors aren't wiped on tag assign.
  let color;
  if (displayColor !== undefined) {
    color = displayColor || null;
  } else if (cur.display_color) {
    color = cur.display_color;
  } else if (nextType && nextId) {
    color = colorForAssignment(nextType);
  } else {
    color = null;
  }

  const rows = await prisma.$queryRaw`
    UPDATE smart_ident_segment
    SET linked_entity_type = ${nextType || null},
        linked_entity_id = ${nextId || null}::uuid,
        parent_segment_id = ${nextParent || null}::uuid,
        display_color = ${color},
        assigned_at = CASE WHEN ${nextId || null}::text IS NOT NULL THEN NOW() ELSE NULL END,
        metadata = CASE
          WHEN ${hasMetaUpdates}::boolean
          THEN COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metaUpdates)}::jsonb
          ELSE metadata
        END,
        updated_at = NOW()
    WHERE id = ${segmentId}::uuid AND pnid_id = ${pnidId}::uuid
    RETURNING id, session_id, pnid_id, segment_type, geometry, detection_confidence,
              linked_entity_type, linked_entity_id, parent_segment_id, display_color,
              assigned_at, metadata, created_at, updated_at
  `;

  if (!rows.length) return null;

  const segment = formatSegment(rows[0]);
  if (segment.linkedEntityType && segment.linkedEntityId && segment.geometry) {
    try {
      await syncOverlayFromSegment(pnidId, {
        entityType: segment.linkedEntityType,
        entityId: segment.linkedEntityId,
        geometry: segment.geometry,
      });
    } catch (err) {
      console.warn('[smart-ident] overlay sync on assign failed:', err.message);
    }
    try {
      await syncAnnotationFromSmartIdent(pnidId, {
        entityType: segment.linkedEntityType,
        entityId: segment.linkedEntityId,
        geometry: segment.geometry,
        segmentId: segment.id,
      });
    } catch (err) {
      console.warn('[smart-ident] annotation sync on assign failed:', err.message);
    }
  }

  return segment;
}

/** Batch-update flowSequence metadata for multiple segments in one session. */
export async function batchUpdateFlowSequences(pnidId, updates) {
  const results = [];
  for (const { segmentId, flowSequence } of updates) {
    const rows = await prisma.$queryRaw`
      UPDATE smart_ident_segment
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ flowSequence })}::jsonb,
          updated_at = NOW()
      WHERE id = ${segmentId}::uuid AND pnid_id = ${pnidId}::uuid
      RETURNING id, session_id, pnid_id, segment_type, geometry, detection_confidence,
                linked_entity_type, linked_entity_id, parent_segment_id, display_color,
                assigned_at, metadata, created_at, updated_at
    `;
    if (rows.length) results.push(formatSegment(rows[0]));
  }
  return results;
}

/** Update segment geometry (position, size, rotation). */
export async function updateSegmentGeometry(pnidId, segmentId, geometry) {
  const rows = await prisma.$queryRaw`
    UPDATE smart_ident_segment
    SET geometry = ${JSON.stringify(geometry)}::jsonb,
        updated_at = NOW()
    WHERE id = ${segmentId}::uuid AND pnid_id = ${pnidId}::uuid
    RETURNING id, session_id, pnid_id, segment_type, geometry, detection_confidence,
              linked_entity_type, linked_entity_id, parent_segment_id, display_color,
              assigned_at, metadata, created_at, updated_at
  `;
  if (!rows.length) return null;

  const segment = formatSegment(rows[0]);
  if (segment.linkedEntityType && segment.linkedEntityId && segment.geometry) {
    try {
      await syncOverlayFromSegment(pnidId, {
        entityType: segment.linkedEntityType,
        entityId: segment.linkedEntityId,
        geometry: segment.geometry,
      });
    } catch (err) {
      console.warn('[smart-ident] overlay sync on geometry update failed:', err.message);
    }
    try {
      await syncAnnotationFromSmartIdent(pnidId, {
        entityType: segment.linkedEntityType,
        entityId: segment.linkedEntityId,
        geometry: segment.geometry,
        segmentId: segment.id,
      });
    } catch (err) {
      console.warn('[smart-ident] annotation sync on geometry update failed:', err.message);
    }
  }

  return segment;
}

export async function deleteSession(pnidId, sessionId) {
  const result = await prisma.$queryRaw`
    DELETE FROM smart_ident_session
    WHERE id = ${sessionId}::uuid AND pnid_id = ${pnidId}::uuid
    RETURNING id
  `;
  return result.length > 0;
}

export async function deleteSegment(pnidId, segmentId) {
  const rows = await prisma.$queryRaw`
    DELETE FROM smart_ident_segment
    WHERE id = ${segmentId}::uuid AND pnid_id = ${pnidId}::uuid
    RETURNING session_id
  `;
  if (!rows.length) return false;

  await prisma.$queryRaw`
    UPDATE smart_ident_session
    SET segment_count = GREATEST(0, segment_count - 1), updated_at = NOW()
    WHERE id = ${rows[0].session_id}::uuid
  `;
  return true;
}

/** Create an empty manual-draw session (full canvas). */
export async function createDrawSession(pnidId, { pageNumber = 1 } = {}) {
  const boundary = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
  const sessionRows = await prisma.$queryRaw`
    INSERT INTO smart_ident_session (
      pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
      page_number, status, segment_count, metadata
    ) VALUES (
      ${pnidId}::uuid, 0, 0, 100, 100,
      ${pageNumber}, 'ready', 0,
      ${JSON.stringify({ mode: 'manual_draw' })}::jsonb
    )
    RETURNING id, pnid_id, boundary_x_pct, boundary_y_pct, boundary_w_pct, boundary_h_pct,
              page_number, status, segment_count, metadata, created_at, updated_at
  `;
  return { session: formatSession(sessionRows[0]), segments: [] };
}

/** Add a user-drawn segment to an existing session. */
export async function addManualSegment(pnidId, sessionId, {
  segmentType,
  geometry,
  metadata = {},
  displayColor,
}) {
  const rows = await prisma.$queryRaw`
    INSERT INTO smart_ident_segment (
      session_id, pnid_id, segment_type, geometry, detection_confidence,
      display_color, metadata
    ) VALUES (
      ${sessionId}::uuid,
      ${pnidId}::uuid,
      ${segmentType},
      ${JSON.stringify(geometry)}::jsonb,
      1.0,
      ${displayColor || null},
      ${JSON.stringify({ ...metadata, source: 'manual' })}::jsonb
    )
    RETURNING id, session_id, pnid_id, segment_type, geometry, detection_confidence,
              linked_entity_type, linked_entity_id, parent_segment_id, display_color,
              assigned_at, metadata, created_at, updated_at
  `;

  await prisma.$queryRaw`
    UPDATE smart_ident_session
    SET segment_count = segment_count + 1, updated_at = NOW()
    WHERE id = ${sessionId}::uuid
  `;

  return formatSegment(rows[0]);
}

const DEFAULT_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

function computeTagSize(tag, entityType) {
  const len = (tag || '').length;
  if (entityType === 'line') {
    return { w: Math.max(2.8, Math.min(6.4, 2.1 + len * 0.22)), h: 0.9 };
  }
  if (entityType === 'instrument') {
    const d = Math.max(2.1, Math.min(3.6, 1.3 + len * 0.15));
    return { w: d, h: d };
  }
  return { w: Math.max(2.4, Math.min(5.6, 1.8 + len * 0.16)), h: 1.4 };
}

async function fetchEntityTagForAnnotation(entityType, entityId) {
  if (entityType === 'equipment') {
    const row = await prisma.equipment.findUnique({ where: { id: entityId }, select: { tag: true } });
    return row?.tag || null;
  }
  if (entityType === 'instrument') {
    const row = await prisma.instrument.findUnique({ where: { id: entityId }, select: { tag: true } });
    return row?.tag || null;
  }
  if (entityType === 'line') {
    const row = await prisma.line.findUnique({ where: { id: entityId }, select: { line_number: true } });
    return row?.line_number || null;
  }
  return null;
}

function annotationStyleForEntityType(entityType) {
  if (entityType === 'instrument') return { shape: 'circle', color: '#FFD466' };
  if (entityType === 'line') return { shape: 'rectangle', color: '#8AB4FF' };
  return { shape: 'rectangle', color: '#3BE494' };
}

/**
 * Create or update a draft annotation when a Smart ID segment is linked to a tag.
 */
async function syncAnnotationFromSmartIdent(pnidId, {
  entityType,
  entityId,
  geometry,
  segmentId = null,
}) {
  if (!pnidId || !entityType || !entityId || !geometry) return null;
  if (!['equipment', 'instrument', 'line'].includes(entityType)) return null;

  const placement = deriveEntityPlacement(entityType, geometry);
  const tag = await fetchEntityTagForAnnotation(entityType, entityId);
  const size = computeTagSize(tag, entityType);
  const { shape, color } = annotationStyleForEntityType(entityType);
  const rotation = Number(geometry.rotation);
  const hasRotation = Number.isFinite(rotation);

  const existing = await prisma.annotation.findFirst({
    where: {
      pnid_id: pnidId,
      linked_entity_id: entityId,
      linked_entity_type: entityType,
      deleted_at: null,
    },
    orderBy: { updated_at: 'desc' },
  });

  const metaPatch = {
    source: 'smart_ident',
    ...(segmentId ? { smartIdentSegmentId: segmentId } : {}),
  };

  if (existing) {
    if (existing.approval_status === 'approved') {
      return existing;
    }
    const prevMeta = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    return prisma.annotation.update({
      where: { id: existing.id },
      data: {
        x_pct: placement.xPct,
        y_pct: placement.yPct,
        w_pct: placement.wPct || size.w,
        h_pct: placement.hPct || size.h,
        shape,
        color,
        stroke_width: 1,
        fill_opacity: 0.08,
        show_label: true,
        ...(hasRotation ? { rotation } : {}),
        metadata: { ...prevMeta, ...metaPatch },
      },
    });
  }

  return prisma.annotation.create({
    data: {
      pnid_id: pnidId,
      author_id: DEFAULT_AUTHOR_ID,
      annotation_type: 'shape',
      shape,
      x_pct: placement.xPct,
      y_pct: placement.yPct,
      w_pct: placement.wPct || size.w,
      h_pct: placement.hPct || size.h,
      color,
      stroke_width: 1,
      fill_opacity: 0.08,
      show_label: true,
      linked_entity_type: entityType,
      linked_entity_id: entityId,
      ...(hasRotation ? { rotation } : {}),
      metadata: metaPatch,
    },
  });
}

function clampPct(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function deriveEntityPlacement(entityType, geometry = {}) {
  const firstPoint = geometry.points?.[0] || {};
  const xPct = clampPct(geometry.xPct ?? firstPoint.xPct, 0);
  const yPct = clampPct(geometry.yPct ?? firstPoint.yPct, 0);
  const wPct = Math.max(0.5, Number(geometry.wPct ?? (entityType === 'line' ? 6 : 3)) || 0.5);
  const hPct = Math.max(0.5, Number(geometry.hPct ?? (entityType === 'line' ? 1.2 : 2.5)) || 0.5);
  return { xPct, yPct, wPct, hPct };
}

/**
 * Publish Smart ID segment geometry into pnid_* overlay junction tables
 * so tag search / OverlayLayer can pan and highlight the entity.
 */
export async function syncOverlayFromSegment(pnidId, {
  entityType,
  entityId,
  geometry,
}) {
  if (!pnidId || !entityType || !entityId || !geometry) return false;
  if (!['equipment', 'instrument', 'line'].includes(entityType)) return false;

  const placement = deriveEntityPlacement(entityType, geometry);

  if (entityType === 'equipment') {
    await prisma.pnid_equipment.upsert({
      where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: entityId } },
      create: {
        pnid_id: pnidId,
        equipment_id: entityId,
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
      update: {
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
    });
    return true;
  }

  if (entityType === 'instrument') {
    await prisma.pnid_instrument.upsert({
      where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: entityId } },
      create: {
        pnid_id: pnidId,
        instrument_id: entityId,
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
      update: {
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
    });
    return true;
  }

  await prisma.pnid_line.upsert({
    where: { pnid_id_line_id: { pnid_id: pnidId, line_id: entityId } },
    create: {
      pnid_id: pnidId,
      line_id: entityId,
      annotation_x_pct: placement.xPct,
      annotation_y_pct: placement.yPct,
      annotation_w_pct: placement.wPct,
      annotation_h_pct: placement.hPct,
    },
    update: {
      annotation_x_pct: placement.xPct,
      annotation_y_pct: placement.yPct,
      annotation_w_pct: placement.wPct,
      annotation_h_pct: placement.hPct,
    },
  });
  return true;
}

async function resolvePrimarySystemId(pnidId) {
  const primary = await prisma.pnid_system.findFirst({
    where: { pnid_id: pnidId, is_primary: true },
    select: { system_id: true },
  });
  return primary?.system_id || null;
}

/** Create a missing line/equipment/instrument for Smart Identification (also creates a linked draft annotation). */
export async function createManualLinkableEntity(pnidId, {
  entityType,
  tag,
  entitySubType,
  description,
  service,
  nominalSize,
  systemId,
  lineId,
  geometry,
}) {
  const resolvedSystemId = systemId || await resolvePrimarySystemId(pnidId);
  if (!resolvedSystemId) {
    throw new Error('No primary system found for this P&ID');
  }
  if (!entityType || !['equipment', 'instrument', 'line'].includes(entityType)) {
    throw new Error('entityType must be equipment, instrument, or line');
  }
  if (!tag?.trim()) {
    throw new Error(entityType === 'line' ? 'line number is required' : 'tag is required');
  }

  const placement = deriveEntityPlacement(entityType, geometry);
  const cleanTag = tag.trim();

  if (entityType === 'equipment') {
    const equipment = await prisma.equipment.create({
      data: {
        system_id: resolvedSystemId,
        line_id: lineId || null,
        tag: cleanTag,
        equipment_type: (entitySubType || 'General').trim(),
        description: description?.trim() || null,
      },
    });
    await prisma.pnid_equipment.upsert({
      where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: equipment.id } },
      create: {
        pnid_id: pnidId,
        equipment_id: equipment.id,
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
      update: {
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
    });
    try {
      await syncAnnotationFromSmartIdent(pnidId, {
        entityType: 'equipment',
        entityId: equipment.id,
        geometry: geometry || {},
      });
    } catch (err) {
      console.warn('[smart-ident] annotation sync on entity create failed:', err.message);
    }
    return {
      entity: {
        id: equipment.id,
        entityType: 'equipment',
        tag: equipment.tag,
        label: equipment.tag,
        type: equipment.equipment_type,
        description: equipment.description,
        lineId: equipment.line_id,
        systemId: equipment.system_id,
      },
    };
  }

  if (entityType === 'instrument') {
    const instrument = await prisma.instrument.create({
      data: {
        system_id: resolvedSystemId,
        line_id: lineId || null,
        tag: cleanTag,
        instrument_type: entitySubType || 'other',
        description: description?.trim() || null,
      },
    });
    await prisma.pnid_instrument.upsert({
      where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: instrument.id } },
      create: {
        pnid_id: pnidId,
        instrument_id: instrument.id,
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
      update: {
        annotation_x_pct: placement.xPct,
        annotation_y_pct: placement.yPct,
        annotation_w_pct: placement.wPct,
        annotation_h_pct: placement.hPct,
      },
    });
    try {
      await syncAnnotationFromSmartIdent(pnidId, {
        entityType: 'instrument',
        entityId: instrument.id,
        geometry: geometry || {},
      });
    } catch (err) {
      console.warn('[smart-ident] annotation sync on entity create failed:', err.message);
    }
    return {
      entity: {
        id: instrument.id,
        entityType: 'instrument',
        tag: instrument.tag,
        label: instrument.tag,
        type: instrument.instrument_type,
        description: instrument.description,
        lineId: instrument.line_id,
        systemId: instrument.system_id,
      },
    };
  }

  const line = await prisma.line.create({
    data: {
      system_id: resolvedSystemId,
      line_number: cleanTag,
      service: service?.trim() || null,
      nominal_size: nominalSize?.trim() || null,
    },
  });
  await prisma.pnid_line.upsert({
    where: { pnid_id_line_id: { pnid_id: pnidId, line_id: line.id } },
    create: {
      pnid_id: pnidId,
      line_id: line.id,
      annotation_x_pct: placement.xPct,
      annotation_y_pct: placement.yPct,
    },
    update: {
      annotation_x_pct: placement.xPct,
      annotation_y_pct: placement.yPct,
    },
  });
  try {
    await syncAnnotationFromSmartIdent(pnidId, {
      entityType: 'line',
      entityId: line.id,
      geometry: geometry || {},
    });
  } catch (err) {
    console.warn('[smart-ident] annotation sync on entity create failed:', err.message);
  }
  return {
    entity: {
      id: line.id,
      entityType: 'line',
      lineNumber: line.line_number,
      label: line.line_number,
      service: line.service,
      nominalSize: line.nominal_size,
      systemId: line.system_id,
    },
  };
}

/** Extract black pipe lines from full drawing for snap guides (not saved as segments). */
async function computeGuideLines(pnidId, pageNumber = 1) {
  const boundary = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
  const { rasterBuffer, width, height } = await getPnidRaster(pnidId, pageNumber, { density: GUIDE_LINE_DPI });
  let lines = await extractSegmentsFromBoundary(rasterBuffer, boundary, width, height);
  lines = lines.filter((s) => s.segmentType === 'line');
  lines = pruneNoiseSegments(lines, 0.15);
  return lines.map((l) => ({
    points: l.geometry?.points || [],
    orientation: l.metadata?.orientation,
  }));
}

export async function getGuideLinesForPnid(pnidId, pageNumber = 1) {
  const key = `${pnidId}:${pageNumber}`;
  const cached = guideLineCache.get(key);
  if (cached && Date.now() - cached.at < GUIDE_LINE_CACHE_TTL_MS) {
    return cached.lines;
  }
  if (guideLineInflight.has(key)) {
    return guideLineInflight.get(key);
  }

  const promise = computeGuideLines(pnidId, pageNumber)
    .then((lines) => {
      guideLineCache.set(key, { lines, at: Date.now() });
      guideLineInflight.delete(key);
      return lines;
    })
    .catch((err) => {
      guideLineInflight.delete(key);
      throw err;
    });

  guideLineInflight.set(key, promise);
  return promise;
}

function formatSession(row) {
  return {
    id: row.id,
    pnidId: row.pnid_id,
    boundary: {
      xPct: Number(row.boundary_x_pct),
      yPct: Number(row.boundary_y_pct),
      wPct: Number(row.boundary_w_pct),
      hPct: Number(row.boundary_h_pct),
    },
    pageNumber: row.page_number,
    status: row.status,
    segmentCount: row.segment_count,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatSegment(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    pnidId: row.pnid_id,
    segmentType: row.segment_type,
    geometry: row.geometry || {},
    detectionConfidence: Number(row.detection_confidence),
    linkedEntityType: row.linked_entity_type,
    linkedEntityId: row.linked_entity_id,
    parentSegmentId: row.parent_segment_id,
    displayColor: row.display_color,
    assignedAt: row.assigned_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
