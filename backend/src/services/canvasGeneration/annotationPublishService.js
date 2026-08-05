/**
 * WP-D: Push Konva annotation geometry into pnid_* junction rows (overlay / engineering lists).
 * Optional: set ocr_extraction.linked_annotation_id from annotation.metadata.extraction_id
 */

import prisma from '../../db.js';

const DEFAULT_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string} pnidId
 * @param {{ onlyApproved?: boolean, syncExtractionLinks?: boolean }} [options]
 */
export async function publishAnnotationsToJunctions(db, pnidId, options = {}) {
  const client = db || prisma;
  const onlyApproved = options.onlyApproved === true;
  const syncExtractionLinks = options.syncExtractionLinks !== false;

  const where = {
    pnid_id: pnidId,
    deleted_at: null,
    linked_entity_id: { not: null },
    linked_entity_type: { in: ['equipment', 'instrument', 'line'] },
  };
  if (onlyApproved) where.approval_status = 'approved';

  const annotations = await client.annotation.findMany({ where });

  let equipment = 0;
  let instruments = 0;
  let lines = 0;
  let extractionLinks = 0;

  for (const ann of annotations) {
    const x = Number(ann.x_pct);
    const y = Number(ann.y_pct);
    const w = ann.w_pct != null ? Number(ann.w_pct) : 8;
    const h = ann.h_pct != null ? Number(ann.h_pct) : 8;
    const entityId = ann.linked_entity_id;
    if (!entityId) continue;

    try {
      if (ann.linked_entity_type === 'equipment') {
        await client.pnid_equipment.upsert({
          where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: entityId } },
          create: {
            pnid_id: pnidId,
            equipment_id: entityId,
            annotation_x_pct: x,
            annotation_y_pct: y,
            annotation_w_pct: w,
            annotation_h_pct: h,
            position_verified: true,
          },
          update: {
            annotation_x_pct: x,
            annotation_y_pct: y,
            annotation_w_pct: w,
            annotation_h_pct: h,
            position_verified: true,
          },
        });
        equipment++;
      } else if (ann.linked_entity_type === 'instrument') {
        await client.pnid_instrument.upsert({
          where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: entityId } },
          create: {
            pnid_id: pnidId,
            instrument_id: entityId,
            annotation_x_pct: x,
            annotation_y_pct: y,
            annotation_w_pct: w,
            annotation_h_pct: h,
            position_verified: true,
          },
          update: {
            annotation_x_pct: x,
            annotation_y_pct: y,
            annotation_w_pct: w,
            annotation_h_pct: h,
            position_verified: true,
          },
        });
        instruments++;
      } else if (ann.linked_entity_type === 'line') {
        await client.pnid_line.upsert({
          where: { pnid_id_line_id: { pnid_id: pnidId, line_id: entityId } },
          create: {
            pnid_id: pnidId,
            line_id: entityId,
            annotation_x_pct: x,
            annotation_y_pct: y,
          },
          update: {
            annotation_x_pct: x,
            annotation_y_pct: y,
          },
        });
        lines++;
      }

      if (syncExtractionLinks && ann.metadata && typeof ann.metadata === 'object' && ann.metadata.extraction_id) {
        const extId = ann.metadata.extraction_id;
        const r = await client.ocr_extraction.updateMany({
          where: { id: extId, pnid_id: pnidId },
          data: { linked_annotation_id: ann.id },
        });
        extractionLinks += r.count;
      }
    } catch (_e) {
      /* junction missing or FK — skip row */
    }
  }

  return {
    success: true,
    pnidId,
    equipment,
    instruments,
    lines,
    processed: annotations.length,
    extractionLinksUpdated: extractionLinks,
  };
}

export { DEFAULT_AUTHOR_ID };
