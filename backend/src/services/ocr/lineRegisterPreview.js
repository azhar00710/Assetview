/**
 * Stage 1 — read-only preview: OCR line tags vs registered lines (DB + pnid_line).
 * No writes. Human approval + apply comes in a later stage.
 */

import prisma from '../../db.js';

function norm(s) {
  if (s == null || s === '') return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

/**
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string} batchId
 */
export async function buildLineRegisterPreview(db, batchId) {
  const [batch] = await db.$queryRaw`
    SELECT id, platform_id FROM ocr_batch WHERE id = ${batchId}::uuid
  `;
  if (!batch) throw new Error('Batch not found');

  const platformId = batch.platform_id;

  const files = await db.$queryRaw`
    SELECT id, pnid_id, drawing_number FROM ocr_batch_file
    WHERE batch_id = ${batchId}::uuid AND pnid_id IS NOT NULL
  `;
  const pnidIds = [...new Set(files.map(f => f.pnid_id).filter(Boolean))];
  const drawingByPnid = new Map(files.map(f => [f.pnid_id, f.drawing_number]));

  if (pnidIds.length === 0) {
    return {
      platformId,
      summary: {
        ocrLineExtractions: 0,
        matchedToRegister: 0,
        unmatchedOcrLines: 0,
        registerLinesNotSeenInOcr: 0,
      },
      matched: [],
      unmatchedOcr: [],
      registerNotInOcr: [],
    };
  }

  const extractions = await db.$queryRaw`
    SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.matched_entity_id,
           oe.match_confidence, oe.confidence, oe.bbox_x_pct, oe.bbox_y_pct
    FROM ocr_extraction oe
    WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
      AND LOWER(oe.tag_type) = 'line'
  `;

  const platformLines = await db.line.findMany({
    where: { deleted_at: null, system: { platform_id: platformId, deleted_at: null } },
    select: {
      id: true,
      line_number: true,
      system_id: true,
      system: { select: { code: true } },
    },
  });
  const lineById = new Map(platformLines.map(l => [l.id, l]));

  const pnidLines = await db.pnid_line.findMany({
    where: { pnid_id: { in: pnidIds } },
    select: { pnid_id: true, line_id: true },
  });

  const matched = [];
  const unmatchedOcr = [];

  for (const ex of extractions) {
    const drawing = drawingByPnid.get(ex.pnid_id) || '—';
    const base = {
      extractionId: ex.id,
      pnidId: ex.pnid_id,
      drawingNumber: drawing,
      extractedText: ex.extracted_text,
      matchConfidence: ex.match_confidence != null ? Number(ex.match_confidence) : null,
      confidence: ex.confidence != null ? Number(ex.confidence) : null,
      bboxXPct: ex.bbox_x_pct != null ? Number(ex.bbox_x_pct) : null,
      bboxYPct: ex.bbox_y_pct != null ? Number(ex.bbox_y_pct) : null,
    };

    if (ex.matched_entity_id) {
      const line = lineById.get(ex.matched_entity_id);
      if (line) {
        matched.push({
          ...base,
          lineId: line.id,
          systemCode: line.system?.code || null,
          lineNumber: line.line_number,
          matchSource: 'matched_entity_id',
        });
        continue;
      }
    }

    const nt = norm(ex.extracted_text);
    let found = null;
    for (const l of platformLines) {
      if (norm(l.line_number) === nt || norm(l.line_number).toUpperCase() === nt.toUpperCase()) {
        found = l;
        break;
      }
    }
    if (found) {
      matched.push({
        ...base,
        lineId: found.id,
        systemCode: found.system?.code || null,
        lineNumber: found.line_number,
        matchSource: 'line_number_text',
      });
    } else {
      unmatchedOcr.push({
        ...base,
        hint: 'No platform line with this line number; may need a new line row after approval.',
      });
    }
  }

  const seenRegisterKeyOnPnid = new Map();
  for (const m of matched) {
    const k = `${m.pnidId}::${m.lineId}`;
    seenRegisterKeyOnPnid.set(k, true);
  }

  const registerNotInOcr = [];
  for (const pl of pnidLines) {
    const line = lineById.get(pl.line_id);
    if (!line) continue;
    const k = `${pl.pnid_id}::${pl.line_id}`;
    if (seenRegisterKeyOnPnid.has(k)) continue;

    let hit = false;
    for (const ex of extractions) {
      if (ex.pnid_id !== pl.pnid_id) continue;
      if (norm(ex.extracted_text) === norm(line.line_number)) {
        hit = true;
        break;
      }
    }
    if (hit) continue;

    registerNotInOcr.push({
      pnidId: pl.pnid_id,
      drawingNumber: drawingByPnid.get(pl.pnid_id) || '—',
      lineId: line.id,
      systemCode: line.system?.code || null,
      lineNumber: line.line_number,
      hint: 'Line is linked on this P&ID but no matching OCR line tag was found on this sheet.',
    });
  }

  return {
    platformId,
    summary: {
      ocrLineExtractions: extractions.length,
      matchedToRegister: matched.length,
      unmatchedOcrLines: unmatchedOcr.length,
      registerLinesNotSeenInOcr: registerNotInOcr.length,
    },
    matched,
    unmatchedOcr,
    registerNotInOcr,
  };
}
