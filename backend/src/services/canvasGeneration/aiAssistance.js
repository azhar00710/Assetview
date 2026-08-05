/**
 * aiAssistance.js
 *
 * Checks whether OCR bounding-box data is available for a P&ID sheet.
 * When OCR data exists, positions can be auto-suggested for entity placement.
 * When only CSV/text list data exists (no coordinates), manual placement is required.
 */

import prisma from '../../db.js';

// ── Confidence tier thresholds ──
const AUTO_THRESHOLD = 0.9;   // auto-accept: both confidence >= 0.9
const GHOST_THRESHOLD = 0.7;  // ghost suggest: either confidence >= 0.7

/**
 * Classify a suggestion into a confidence tier.
 * - 'auto': both OCR confidence and match confidence >= 0.9 → auto-place
 * - 'ghost': at least one confidence >= 0.7 → show as dashed ghost overlay
 * - 'hidden': both below 0.7 → hidden by default, shown via "Show All" toggle
 */
function classifyConfidenceTier(confidence, matchConfidence) {
  if (confidence >= AUTO_THRESHOLD && matchConfidence >= AUTO_THRESHOLD) return 'auto';
  if (confidence >= GHOST_THRESHOLD || matchConfidence >= GHOST_THRESHOLD) return 'ghost';
  return 'hidden';
}

/**
 * Check if OCR extraction data with bounding boxes exists for a P&ID.
 *
 * @param {string} pnidId
 * @returns {{ hasOcr: boolean, extractionCount: number, matchedCount: number, unplacedSuggestions: number }}
 */
export async function checkOcrAvailability(pnidId) {
  const [total, matched] = await Promise.all([
    prisma.ocr_extraction.count({
      where: {
        pnid_id: pnidId,
        status: { in: ['pending', 'approved'] },
      },
    }),
    prisma.ocr_extraction.count({
      where: {
        pnid_id: pnidId,
        status: { in: ['pending', 'approved'] },
        matched_entity_id: { not: null },
      },
    }),
  ]);

  // Count how many matched entities don't yet have annotation positions
  let unplacedSuggestions = 0;
  if (matched > 0) {
    const matchedExtractions = await prisma.ocr_extraction.findMany({
      where: {
        pnid_id: pnidId,
        status: { in: ['pending', 'approved'] },
        matched_entity_id: { not: null },
      },
      select: { matched_entity_id: true, tag_type: true },
    });

    const entityIds = matchedExtractions.map(e => e.matched_entity_id).filter(Boolean);

    if (entityIds.length > 0) {
      // Check which of these entities already have annotation positions on this P&ID
      const [placedEquipment, placedInstruments] = await Promise.all([
        prisma.pnid_equipment.findMany({
          where: {
            pnid_id: pnidId,
            equipment_id: { in: entityIds },
            annotation_x_pct: { not: null },
          },
          select: { equipment_id: true },
        }),
        prisma.pnid_instrument.findMany({
          where: {
            pnid_id: pnidId,
            instrument_id: { in: entityIds },
            annotation_x_pct: { not: null },
          },
          select: { instrument_id: true },
        }),
      ]);

      const placedIds = new Set([
        ...placedEquipment.map(p => p.equipment_id),
        ...placedInstruments.map(p => p.instrument_id),
      ]);

      unplacedSuggestions = entityIds.filter(id => !placedIds.has(id)).length;
    }
  }

  return {
    hasOcr: total > 0,
    extractionCount: total,
    matchedCount: matched,
    unplacedSuggestions,
  };
}

/**
 * Get OCR-based position suggestions for unplaced entities on a P&ID.
 * Returns suggested positions that the frontend can render as ghost overlays.
 *
 * @param {string} pnidId
 * @returns {Array<{ entityId, entityType, tag, suggestedXPct, suggestedYPct, suggestedWPct, suggestedHPct, confidence }>}
 */
export async function suggestPositionsFromOcr(pnidId) {
  // Get OCR extractions that matched entities and have bounding boxes
  const extractions = await prisma.ocr_extraction.findMany({
    where: {
      pnid_id: pnidId,
      status: { in: ['pending', 'approved'] },
      matched_entity_id: { not: null },
      bbox_x_pct: { gt: 0 },
    },
    select: {
      matched_entity_id: true,
      tag_type: true,
      extracted_text: true,
      bbox_x_pct: true,
      bbox_y_pct: true,
      bbox_w_pct: true,
      bbox_h_pct: true,
      confidence: true,
      match_confidence: true,
    },
  });

  if (extractions.length === 0) return [];

  const entityIds = extractions.map(e => e.matched_entity_id);

  // Find which entities already have positions
  const [placedEquipment, placedInstruments] = await Promise.all([
    prisma.pnid_equipment.findMany({
      where: {
        pnid_id: pnidId,
        equipment_id: { in: entityIds },
        annotation_x_pct: { not: null },
      },
      select: { equipment_id: true },
    }),
    prisma.pnid_instrument.findMany({
      where: {
        pnid_id: pnidId,
        instrument_id: { in: entityIds },
        annotation_x_pct: { not: null },
      },
      select: { instrument_id: true },
    }),
  ]);

  const placedIds = new Set([
    ...placedEquipment.map(p => p.equipment_id),
    ...placedInstruments.map(p => p.instrument_id),
  ]);

  // Return suggestions for unplaced entities with confidence tiers
  return extractions
    .filter(e => !placedIds.has(e.matched_entity_id))
    .map(e => {
      const confidence = parseFloat(e.confidence || 0);
      const matchConfidence = parseFloat(e.match_confidence || 0);
      const tier = classifyConfidenceTier(confidence, matchConfidence);

      return {
        entityId: e.matched_entity_id,
        entityType: e.tag_type === 'instrument' ? 'instrument' : 'equipment',
        tag: e.extracted_text,
        suggestedXPct: parseFloat(e.bbox_x_pct),
        suggestedYPct: parseFloat(e.bbox_y_pct),
        suggestedWPct: parseFloat(e.bbox_w_pct),
        suggestedHPct: parseFloat(e.bbox_h_pct),
        confidence,
        matchConfidence,
        tier,
      };
    });
}

/**
 * Get only auto-placeable (high confidence) suggestions for batch placement.
 */
export async function getAutoPlaceableSuggestions(pnidId) {
  const all = await suggestPositionsFromOcr(pnidId);
  return all.filter(s => s.tier === 'auto');
}

/**
 * Create draft Konva annotations from OCR extraction data.
 * For matched extractions: creates annotation linked to the entity.
 * For unmatched high-confidence (>= 0.8): creates unlinked annotation with OCR tag label.
 *
 * @param {object} prismaClient - Prisma client instance
 * @param {string} pnidId
 * @returns {{ created: number, skipped: number }}
 */
export async function createDraftAnnotationsFromOcr(prismaClient, pnidId) {
  const db = prismaClient || prisma;

  // Get OCR extractions with bounding boxes
  const extractions = await db.$queryRaw`
    SELECT id, extracted_text, tag_type, confidence, match_confidence,
           matched_entity_id,
           bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
           status
    FROM ocr_extraction
    WHERE pnid_id = ${pnidId}::uuid
      AND bbox_x_pct > 0
      AND (status = 'pending' OR status = 'approved')
  `;

  if (extractions.length === 0) return { created: 0, skipped: 0 };

  // Get existing annotations to avoid duplicates
  const existingAnnotations = await db.$queryRaw`
    SELECT linked_entity_id, metadata
    FROM annotation
    WHERE pnid_id = ${pnidId}::uuid AND deleted_at IS NULL
  `;

  const existingEntityIds = new Set(
    existingAnnotations
      .filter(a => a.linked_entity_id)
      .map(a => a.linked_entity_id)
  );

  const existingOcrIds = new Set(
    existingAnnotations
      .filter(a => a.metadata?.extraction_id)
      .map(a => a.metadata.extraction_id)
  );

  let created = 0;
  let skipped = 0;

  for (const ext of extractions) {
    // Skip if already has an annotation
    if (ext.matched_entity_id && existingEntityIds.has(ext.matched_entity_id)) {
      skipped++;
      continue;
    }
    if (existingOcrIds.has(ext.id)) {
      skipped++;
      continue;
    }

    const confidence = parseFloat(ext.confidence || 0);
    const matchConfidence = parseFloat(ext.match_confidence || 0);

    // For unmatched, only create if OCR confidence is high enough
    if (!ext.matched_entity_id && confidence < 0.8) {
      skipped++;
      continue;
    }

    const linkedEntityType = ext.matched_entity_id
      ? (ext.tag_type === 'instrument' ? 'instrument' : ext.tag_type === 'line' ? 'line' : 'equipment')
      : null;

    const metadata = {
      source: 'ocr_auto',
      extraction_id: ext.id,
      extracted_text: ext.extracted_text,
      tag_type: ext.tag_type,
      confidence,
      match_confidence: matchConfidence,
    };

    try {
      await db.$queryRaw`
        INSERT INTO annotation (
          pnid_id, x_pct, y_pct, w_pct, h_pct,
          shape, color, label,
          linked_entity_type, linked_entity_id,
          status, approval_status,
          metadata, created_by
        ) VALUES (
          ${pnidId}::uuid,
          ${Number(ext.bbox_x_pct)}, ${Number(ext.bbox_y_pct)},
          ${Number(ext.bbox_w_pct)}, ${Number(ext.bbox_h_pct)},
          'rectangle',
          ${ext.tag_type === 'equipment' ? '#3BE494' : ext.tag_type === 'instrument' ? '#F39C12' : '#2D33E0'},
          ${ext.extracted_text},
          ${linkedEntityType}, ${ext.matched_entity_id}::uuid,
          'open', 'draft',
          ${JSON.stringify(metadata)}::jsonb, 'ocr_auto'
        )
      `;
      created++;
    } catch (err) {
      // Skip annotation creation errors (e.g., constraint violations)
      skipped++;
    }
  }

  return { created, skipped };
}
