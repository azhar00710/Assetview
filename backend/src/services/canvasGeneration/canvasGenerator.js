/**
 * canvasGenerator.js
 *
 * Core service: reads P&ID annotations across sheets for a system,
 * infers topology_edges from connection annotations, and computes
 * canvas_layout positions via multi-sheet coordinate stitching.
 */

import prisma from '../../db.js';
import { stitchCoordinates } from './coordinateStitcher.js';
import { stitchWithAffine } from './affineStitcher.js';
import { checkOcrAvailability } from './aiAssistance.js';

const ANNOTATION_SOURCE = 'annotation-generator';
const SNAP_THRESHOLD_PCT = 5; // percent distance for endpoint-to-entity matching

/**
 * Euclidean distance between two points (percentage space).
 */
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

/**
 * Get the center point of an entity's bounding box in percentage coords.
 */
function bboxCenter(entity) {
  const x = parseFloat(entity.xPct || 0);
  const y = parseFloat(entity.yPct || 0);
  const w = parseFloat(entity.wPct || 4);
  const h = parseFloat(entity.hPct || 3);
  return { x: x + w / 2, y: y + h / 2 };
}

/**
 * Find the nearest positioned entity to a given point.
 */
function findNearestEntity(px, py, entities) {
  let best = null;
  let bestDist = Infinity;
  for (const ent of entities) {
    const c = bboxCenter(ent);
    const d = dist(px, py, c.x, c.y);
    if (d < bestDist) {
      bestDist = d;
      best = ent;
    }
  }
  return bestDist <= SNAP_THRESHOLD_PCT ? { entity: best, distance: bestDist } : null;
}

/**
 * Map annotation connection type to topology edge type.
 */
function mapConnectionType(connType) {
  const mapping = {
    process: 'process',
    utility: 'utility',
    signal: 'signal',
    boundary: 'boundary',
  };
  return mapping[connType] || 'process';
}

/**
 * Collect all placed entity positions across P&ID sheets for a system.
 */
async function collectEntityPlacements(systemId, pnidIds) {
  const placements = [];

  if (pnidIds.length === 0) return placements;

  // Equipment positions from junction tables
  const equipmentPlacements = await prisma.pnid_equipment.findMany({
    where: { pnid_id: { in: pnidIds } },
    include: {
      equipment: {
        select: { id: true, tag: true, equipment_type: true, system_id: true, line_id: true },
      },
    },
  });

  for (const ep of equipmentPlacements) {
    if (!ep.equipment || ep.equipment.system_id !== systemId) continue;
    placements.push({
      entityId: ep.equipment.id,
      entityType: 'equipment',
      pnidId: ep.pnid_id,
      xPct: ep.annotation_x_pct,
      yPct: ep.annotation_y_pct,
      wPct: ep.annotation_w_pct,
      hPct: ep.annotation_h_pct,
      tag: ep.equipment.tag,
      lineId: ep.equipment.line_id,
    });
  }

  // Instrument positions from junction tables
  const instrumentPlacements = await prisma.pnid_instrument.findMany({
    where: { pnid_id: { in: pnidIds } },
    include: {
      instrument: {
        select: { id: true, tag: true, instrument_type: true, system_id: true, line_id: true },
      },
    },
  });

  for (const ip of instrumentPlacements) {
    if (!ip.instrument || ip.instrument.system_id !== systemId) continue;
    placements.push({
      entityId: ip.instrument.id,
      entityType: 'instrument',
      pnidId: ip.pnid_id,
      xPct: ip.annotation_x_pct,
      yPct: ip.annotation_y_pct,
      wPct: ip.annotation_w_pct,
      hPct: ip.annotation_h_pct,
      tag: ip.instrument.tag,
      lineId: ip.instrument.line_id,
    });
  }

  return placements;
}

/**
 * Collect connection annotations (lines drawn between entities) from the annotation table.
 * These have metadata.isConnection = true set by the connection drawing tool.
 */
async function collectConnectionAnnotations(pnidIds) {
  const annotations = await prisma.annotation.findMany({
    where: {
      pnid_id: { in: pnidIds },
      deleted_at: null,
      shape: 'line',
    },
    select: {
      id: true,
      pnid_id: true,
      x_pct: true,
      y_pct: true,
      x2_pct: true,
      y2_pct: true,
      metadata: true,
      linked_entity_type: true,
      linked_entity_id: true,
    },
  });

  return annotations;
}

/**
 * Infer topology edges from connection annotations.
 *
 * Priority 1: Annotations with metadata.isConnection (explicit connections from the Connection tool)
 * Priority 2: Line annotations whose endpoints are geometrically near entity bounding boxes
 */
function inferEdges(connectionAnnotations, entityPlacements, systemId) {
  const edges = [];
  const seen = new Set(); // avoid duplicate edges

  // Group placements by pnidId for proximity search
  const placementsByPnid = new Map();
  for (const p of entityPlacements) {
    if (!placementsByPnid.has(p.pnidId)) placementsByPnid.set(p.pnidId, []);
    placementsByPnid.get(p.pnidId).push(p);
  }

  for (const ann of connectionAnnotations) {
    const meta = ann.metadata || {};

    // Priority 1: Explicit connection metadata
    if (meta.isConnection && meta.fromEntityId && meta.toEntityId) {
      const key = `${meta.fromEntityId}->${meta.toEntityId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const fromPlacement = entityPlacements.find(p => p.entityId === meta.fromEntityId);
      const toPlacement = entityPlacements.find(p => p.entityId === meta.toEntityId);

      edges.push({
        fromEntityId: meta.fromEntityId,
        fromEntityType: fromPlacement?.entityType || 'equipment',
        toEntityId: meta.toEntityId,
        toEntityType: toPlacement?.entityType || 'equipment',
        edgeType: mapConnectionType(meta.connectionType),
        systemId,
        lineId: fromPlacement?.lineId || toPlacement?.lineId || null,
      });
      continue;
    }

    // Priority 2: Geometric proximity matching
    const x1 = parseFloat(ann.x_pct || 0);
    const y1 = parseFloat(ann.y_pct || 0);
    const x2 = parseFloat(ann.x2_pct || 0);
    const y2 = parseFloat(ann.y2_pct || 0);

    if (x1 === 0 && y1 === 0) continue;
    if (x2 === 0 && y2 === 0) continue;

    const sheetEntities = placementsByPnid.get(ann.pnid_id) || [];
    if (sheetEntities.length < 2) continue;

    const from = findNearestEntity(x1, y1, sheetEntities);
    const to = findNearestEntity(x2, y2, sheetEntities);

    if (from && to && from.entity.entityId !== to.entity.entityId) {
      const key = `${from.entity.entityId}->${to.entity.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      edges.push({
        fromEntityId: from.entity.entityId,
        fromEntityType: from.entity.entityType,
        toEntityId: to.entity.entityId,
        toEntityType: to.entity.entityType,
        edgeType: 'process',
        systemId,
        lineId: from.entity.lineId || to.entity.lineId || null,
      });
    }
  }

  return edges;
}

/**
 * Generate canvas from annotations for a system.
 *
 * @param {string} systemId
 * @param {{ dryRun?: boolean }} options
 * @returns {{ edgesCreated, layoutPositions, warnings, preview? }}
 */
export async function generateCanvasFromAnnotations(systemId, options = {}) {
  const { dryRun = false } = options;
  const warnings = [];

  // 1. Get all P&IDs for this system
  const pnidSystems = await prisma.pnid_system.findMany({
    where: { system_id: systemId },
    include: {
      pnid: {
        select: { id: true, drawing_number: true, title: true, sheet_number: true },
      },
    },
  });

  const sheets = pnidSystems.map(ps => ps.pnid).filter(Boolean);
  const pnidIds = sheets.map(s => s.id);

  if (sheets.length === 0) {
    return { edgesCreated: 0, layoutPositions: 0, warnings: ['No P&IDs found for this system'] };
  }

  // 2. Collect entity placements
  const entityPlacements = await collectEntityPlacements(systemId, pnidIds);

  if (entityPlacements.length === 0) {
    return {
      edgesCreated: 0,
      layoutPositions: 0,
      warnings: ['No placed entities found. Draft annotations on P&ID sheets first.'],
    };
  }

  // 3. Collect connection annotations and infer edges
  const connectionAnnotations = await collectConnectionAnnotations(pnidIds);
  const inferredEdges = inferEdges(connectionAnnotations, entityPlacements, systemId);

  if (inferredEdges.length === 0) {
    warnings.push('No connections found. Draw connection lines between entities on P&ID sheets.');
  }

  // 4. Stitch coordinates — try affine transform with continuation anchors first
  let canvasPositions;
  try {
    const continuationLines = await prisma.pnid_line.findMany({
      where: { pnid_id: { in: pnidIds }, is_continuation: true },
    });

    if (continuationLines.length >= 2) {
      // Build annotation positions for continuation line endpoints
      const annotationPositions = new Map();
      for (const cl of continuationLines) {
        // Use line annotation positions from pnid_line metadata or entity placement positions
        const lineAnnotations = connectionAnnotations.filter(
          a => a.pnid_id === cl.pnid_id && a.linked_entity_id === cl.line_id
        );
        for (const ann of lineAnnotations) {
          const key = `${cl.pnid_id}:${cl.line_id}`;
          annotationPositions.set(key, {
            xPct: parseFloat(ann.x_pct || 0),
            yPct: parseFloat(ann.y_pct || 0),
          });
        }
      }

      const affineResult = stitchWithAffine(sheets, entityPlacements, continuationLines, annotationPositions);
      canvasPositions = affineResult.positions;
      warnings.push(...affineResult.warnings);
    } else {
      // Not enough continuation lines — fallback to band placement
      canvasPositions = stitchCoordinates(sheets, entityPlacements);
    }
  } catch {
    // Fallback to simple stitching on any error
    canvasPositions = stitchCoordinates(sheets, entityPlacements);
    warnings.push('Affine stitching failed, using band placement fallback');
  }

  if (canvasPositions.length === 0) {
    warnings.push('No entity positions could be computed from annotations.');
  }

  // 5. Validate connections against line list
  let validation = null;
  if (inferredEdges.length > 0) {
    try {
      validation = await validateConnections(systemId, inferredEdges, entityPlacements);
      if (validation.warnings.length > 0) {
        warnings.push(...validation.warnings.map(w => `Validation: ${w}`));
      }
    } catch {
      // Validation failure is non-fatal
    }
  }

  // Dry run: return preview without writing
  if (dryRun) {
    return {
      edgesCreated: inferredEdges.length,
      layoutPositions: canvasPositions.length,
      warnings,
      validation: validation || null,
      preview: {
        edges: inferredEdges,
        positions: canvasPositions,
      },
    };
  }

  // 5. Write to database in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Clear previously generated edges (keep manually-created ones)
    await tx.$executeRaw`
      DELETE FROM topology_edges
      WHERE system_id = ${systemId}::uuid
        AND metadata->>'source' = ${ANNOTATION_SOURCE}
    `;

    // Insert new edges
    let edgesCreated = 0;
    for (const edge of inferredEdges) {
      await tx.$executeRaw`
        INSERT INTO topology_edges (id, from_entity_id, from_entity_type, to_entity_id, to_entity_type, edge_type, system_id, line_id, metadata, created_at)
        VALUES (
          gen_random_uuid(),
          ${edge.fromEntityId}::uuid,
          ${edge.fromEntityType},
          ${edge.toEntityId}::uuid,
          ${edge.toEntityType},
          ${edge.edgeType},
          ${systemId}::uuid,
          ${edge.lineId}::uuid,
          ${JSON.stringify({ source: ANNOTATION_SOURCE })}::jsonb,
          NOW()
        )
      `;
      edgesCreated++;
    }

    // Upsert canvas layout positions with source metadata
    let layoutPositions = 0;
    for (const pos of canvasPositions) {
      await tx.$executeRaw`
        INSERT INTO canvas_layout (id, system_id, entity_id, entity_type, x, y, pinned, updated_at)
        VALUES (gen_random_uuid(), ${systemId}::uuid, ${pos.entityId}::uuid, ${pos.entityType}, ${pos.x}, ${pos.y}, false, NOW())
        ON CONFLICT (system_id, entity_id)
        DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, pinned = false, updated_at = NOW()
      `;
      layoutPositions++;
    }

    return { edgesCreated, layoutPositions };
  });

  return {
    edgesCreated: result.edgesCreated,
    layoutPositions: result.layoutPositions,
    warnings,
    validation: validation || null,
  };
}

/**
 * Validate inferred connections against the line list data.
 * Cross-references drawn connections with pnid_line records to find:
 * - Unmatched: connections drawn but no matching line exists
 * - Missing: lines exist connecting entities but no connection was drawn
 * - Flow direction: inferred from line numbering convention
 *
 * @param {string} systemId
 * @param {Array} inferredEdges - edges from inferEdges()
 * @param {Array} entityPlacements - entity data with lineId
 * @returns {{ valid: boolean, matched: number, warnings: string[], suggestions: Array }}
 */
export async function validateConnections(systemId, inferredEdges, entityPlacements) {
  const warnings = [];
  const suggestions = [];
  let matched = 0;

  // Get all lines for this system
  const lines = await prisma.line.findMany({
    where: { system_id: systemId, deleted_at: null },
    select: { id: true, tag: true, line_number: true },
  });

  if (lines.length === 0) {
    return {
      valid: inferredEdges.length > 0,
      matched: 0,
      total: inferredEdges.length,
      warnings: ['No lines found in system — validation skipped'],
      suggestions: [],
    };
  }

  // Build entity→line mapping from placements
  const entityLineMap = new Map();
  for (const p of entityPlacements) {
    if (p.lineId) entityLineMap.set(p.entityId, p.lineId);
  }

  // Build line→entities mapping for suggestion generation
  const lineEntitiesMap = new Map();
  for (const p of entityPlacements) {
    if (!p.lineId) continue;
    if (!lineEntitiesMap.has(p.lineId)) lineEntitiesMap.set(p.lineId, []);
    lineEntitiesMap.get(p.lineId).push(p);
  }

  const lineTagMap = new Map(lines.map(l => [l.id, l.tag || l.line_number]));

  // Check each inferred edge against line list
  const connectedPairs = new Set();
  for (const edge of inferredEdges) {
    const fromLine = entityLineMap.get(edge.fromEntityId);
    const toLine = entityLineMap.get(edge.toEntityId);

    // Both entities should be on the same line or connected lines
    if (fromLine && toLine) {
      if (fromLine === toLine) {
        // Same line — valid connection
        matched++;
      } else {
        // Different lines — could be a cross-line connection (valid for boundary/utility)
        if (edge.edgeType === 'boundary' || edge.edgeType === 'utility') {
          matched++;
        } else {
          const fromTag = lineTagMap.get(fromLine) || 'unknown';
          const toTag = lineTagMap.get(toLine) || 'unknown';
          warnings.push(`Connection crosses lines: ${fromTag} → ${toTag}`);
        }
      }
    } else {
      // One or both entities not on a known line
      if (!fromLine && !toLine) {
        warnings.push('Connection between entities with no line assignment');
      }
      // Still count as partial match
      matched++;
    }

    connectedPairs.add(`${edge.fromEntityId}-${edge.toEntityId}`);
    connectedPairs.add(`${edge.toEntityId}-${edge.fromEntityId}`);
  }

  // Find lines with multiple entities that lack connections between them
  for (const [lineId, entities] of lineEntitiesMap) {
    if (entities.length < 2) continue;
    const tag = lineTagMap.get(lineId) || 'unknown';

    for (let i = 0; i < entities.length - 1; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const pair = `${entities[i].entityId}-${entities[j].entityId}`;
        const reverse = `${entities[j].entityId}-${entities[i].entityId}`;
        if (!connectedPairs.has(pair) && !connectedPairs.has(reverse)) {
          suggestions.push({
            fromEntityId: entities[i].entityId,
            fromTag: entities[i].tag,
            toEntityId: entities[j].entityId,
            toTag: entities[j].tag,
            lineTag: tag,
            lineId,
          });
        }
      }
    }
  }

  return {
    valid: warnings.length === 0,
    matched,
    total: inferredEdges.length,
    warnings,
    suggestions: suggestions.slice(0, 20), // limit to top 20
  };
}

/**
 * Check generation readiness for a system.
 * Returns per-sheet coverage stats and overall readiness.
 *
 * @param {string} systemId
 * @returns {{ systemId, sheets, overallCoverage, canGenerate, missingConnections }}
 */
export async function checkGenerationReadiness(systemId) {
  // Get all P&IDs for system
  const pnidSystems = await prisma.pnid_system.findMany({
    where: { system_id: systemId },
    include: {
      pnid: {
        select: { id: true, drawing_number: true, title: true },
      },
    },
  });

  const sheets = pnidSystems.map(ps => ps.pnid).filter(Boolean);
  const pnidIds = sheets.map(s => s.id);

  // Get total entities for this system
  const [totalEquipment, totalInstruments] = await Promise.all([
    prisma.equipment.count({ where: { system_id: systemId, deleted_at: null } }),
    prisma.instrument.count({ where: { system_id: systemId, deleted_at: null } }),
  ]);

  const totalEntities = totalEquipment + totalInstruments;

  // Check per-sheet placement and OCR status
  const sheetStats = await Promise.all(sheets.map(async (sheet) => {
    const [equipmentPlaced, instrumentsPlaced, connectionAnnotations, ocrStatus] = await Promise.all([
      prisma.pnid_equipment.count({
        where: { pnid_id: sheet.id, annotation_x_pct: { not: null } },
      }),
      prisma.pnid_instrument.count({
        where: { pnid_id: sheet.id, annotation_x_pct: { not: null } },
      }),
      prisma.annotation.count({
        where: {
          pnid_id: sheet.id,
          deleted_at: null,
          shape: 'line',
        },
      }),
      checkOcrAvailability(sheet.id),
    ]);

    const entitiesPlaced = equipmentPlaced + instrumentsPlaced;

    // Get total entities that appear on this specific sheet
    const [sheetEquipment, sheetInstruments] = await Promise.all([
      prisma.pnid_equipment.count({ where: { pnid_id: sheet.id } }),
      prisma.pnid_instrument.count({ where: { pnid_id: sheet.id } }),
    ]);
    const entitiesTotal = sheetEquipment + sheetInstruments;

    return {
      pnidId: sheet.id,
      drawingNumber: sheet.drawing_number,
      title: sheet.title,
      entitiesPlaced,
      entitiesTotal,
      coveragePct: entitiesTotal > 0 ? Math.round((entitiesPlaced / entitiesTotal) * 100) : 0,
      hasOcr: ocrStatus.hasOcr,
      ocrSuggestions: ocrStatus.unplacedSuggestions,
      connectionAnnotations,
    };
  }));

  // Overall stats
  const totalPlaced = sheetStats.reduce((sum, s) => sum + s.entitiesPlaced, 0);
  const totalConnections = sheetStats.reduce((sum, s) => sum + s.connectionAnnotations, 0);
  // Use unique placements (an entity may appear on multiple sheets)
  const overallCoverage = totalEntities > 0
    ? Math.round((Math.min(totalPlaced, totalEntities) / totalEntities) * 100)
    : 0;

  const missingConnections = [];
  if (totalConnections === 0) {
    missingConnections.push('No connection lines drawn between entities on any sheet');
  }
  for (const s of sheetStats) {
    if (s.entitiesTotal > 0 && s.entitiesPlaced === 0) {
      missingConnections.push(`Sheet ${s.drawingNumber}: no entities placed`);
    }
  }

  return {
    systemId,
    totalEntities,
    totalPlaced,
    totalConnections,
    sheets: sheetStats,
    overallCoverage,
    canGenerate: totalPlaced >= 2 && totalConnections >= 1,
    missingConnections,
  };
}
