/**
 * Unified register preview — compares OCR-extracted tags against DB registers
 * for any entity type (line, equipment, instrument).
 * Read-only. Human approval + apply comes via registerStagingService.
 */

const ENTITY_CONFIG = {
  line: {
    tagType: 'line',
    model: 'line',
    identifierField: 'line_number',
    contextField: 'service',
    junctionModel: 'pnid_line',
    junctionFk: 'line_id',
    label: 'line',
    hintNew: 'No platform line with this tag; may need a new line row after approval.',
    hintGap: 'Line is linked on this P&ID but no matching OCR tag was found on this sheet.',
  },
  equipment: {
    tagType: 'equipment',
    model: 'equipment',
    identifierField: 'tag',
    contextField: 'equipment_type',
    junctionModel: 'pnid_equipment',
    junctionFk: 'equipment_id',
    label: 'equipment',
    hintNew: 'No platform equipment with this tag; may need a new equipment row after approval.',
    hintGap: 'Equipment is linked on this P&ID but no matching OCR tag was found on this sheet.',
  },
  instrument: {
    tagType: 'instrument',
    model: 'instrument',
    identifierField: 'tag',
    contextField: 'instrument_type',
    junctionModel: 'pnid_instrument',
    junctionFk: 'instrument_id',
    label: 'instrument',
    hintNew: 'No platform instrument with this tag; may need a new instrument row after approval.',
    hintGap: 'Instrument is linked on this P&ID but no matching OCR tag was found on this sheet.',
  },
};

function norm(s) {
  if (s == null || s === '') return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

/**
 * Build a register preview for any entity type.
 * @param {import('@prisma/client').PrismaClient} db
 * @param {string} batchId
 * @param {'line'|'equipment'|'instrument'} entityType
 */
export async function buildRegisterPreview(db, batchId, entityType) {
  const cfg = ENTITY_CONFIG[entityType];
  if (!cfg) throw new Error(`Unsupported entity type: ${entityType}`);

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
      entityType,
      platformId,
      summary: { ocrExtractions: 0, matchedToRegister: 0, unmatchedOcr: 0, registerNotInOcr: 0 },
      matched: [],
      unmatchedOcr: [],
      registerNotInOcr: [],
    };
  }

  // 1. OCR extractions filtered by entity type
  const extractions = await db.$queryRaw`
    SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.matched_entity_id,
           oe.match_confidence, oe.confidence, oe.bbox_x_pct, oe.bbox_y_pct
    FROM ocr_extraction oe
    WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
      AND LOWER(oe.tag_type) = ${cfg.tagType}
  `;

  // 2. Platform register entities
  const registerEntities = await db[cfg.model].findMany({
    where: { deleted_at: null, system: { platform_id: platformId, deleted_at: null } },
    select: {
      id: true,
      [cfg.identifierField]: true,
      [cfg.contextField]: true,
      system_id: true,
      system: { select: { code: true } },
    },
  });
  const entityById = new Map(registerEntities.map(e => [e.id, e]));

  // 3. Junction table — which entities are already linked to these P&IDs
  const junctionRows = await db[cfg.junctionModel].findMany({
    where: { pnid_id: { in: pnidIds } },
    select: { pnid_id: true, [cfg.junctionFk]: true },
  });

  // 4. Match OCR extractions against register
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

    // Stage 1: direct entity link
    if (ex.matched_entity_id) {
      const entity = entityById.get(ex.matched_entity_id);
      if (entity) {
        matched.push({
          ...base,
          entityId: entity.id,
          systemCode: entity.system?.code || null,
          registerTag: entity[cfg.identifierField],
          contextValue: entity[cfg.contextField] || null,
          matchSource: 'matched_entity_id',
        });
        continue;
      }
    }

    // Stage 2: fuzzy text match
    const nt = norm(ex.extracted_text);
    let found = null;
    for (const e of registerEntities) {
      const regTag = norm(e[cfg.identifierField]);
      if (regTag === nt || regTag.toUpperCase() === nt.toUpperCase()) {
        found = e;
        break;
      }
    }
    if (found) {
      matched.push({
        ...base,
        entityId: found.id,
        systemCode: found.system?.code || null,
        registerTag: found[cfg.identifierField],
        contextValue: found[cfg.contextField] || null,
        matchSource: 'text_match',
      });
    } else {
      unmatchedOcr.push({ ...base, hint: cfg.hintNew });
    }
  }

  // 5. Gap detection — register entities linked to these P&IDs but not found by OCR
  const seenKey = new Set();
  for (const m of matched) {
    seenKey.add(`${m.pnidId}::${m.entityId}`);
  }

  const registerNotInOcr = [];
  for (const jr of junctionRows) {
    const entityId = jr[cfg.junctionFk];
    const entity = entityById.get(entityId);
    if (!entity) continue;
    const k = `${jr.pnid_id}::${entityId}`;
    if (seenKey.has(k)) continue;

    // Double-check: was there a text match we missed?
    let hit = false;
    for (const ex of extractions) {
      if (ex.pnid_id !== jr.pnid_id) continue;
      if (norm(ex.extracted_text) === norm(entity[cfg.identifierField])) {
        hit = true;
        break;
      }
    }
    if (hit) continue;

    registerNotInOcr.push({
      pnidId: jr.pnid_id,
      drawingNumber: drawingByPnid.get(jr.pnid_id) || '—',
      entityId: entity.id,
      systemCode: entity.system?.code || null,
      registerTag: entity[cfg.identifierField],
      contextValue: entity[cfg.contextField] || null,
      hint: cfg.hintGap,
    });
  }

  return {
    entityType,
    platformId,
    summary: {
      ocrExtractions: extractions.length,
      matchedToRegister: matched.length,
      unmatchedOcr: unmatchedOcr.length,
      registerNotInOcr: registerNotInOcr.length,
    },
    matched,
    unmatchedOcr,
    registerNotInOcr,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CSV Export
// ═══════════════════════════════════════════════════════════════════════════

function csvEscape(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvEscape).join(',');
}

/**
 * Generate CSV from preview data.
 * @param {object} previewData — result of buildRegisterPreview
 * @param {'matched'|'unmatched'|'gaps'|'all'} section
 * @returns {string} CSV content
 */
export function generatePreviewCsv(previewData, section = 'all') {
  const { entityType, matched, unmatchedOcr, registerNotInOcr } = previewData;
  const lines = [];

  const includeMatched = section === 'all' || section === 'matched';
  const includeUnmatched = section === 'all' || section === 'unmatched';
  const includeGaps = section === 'all' || section === 'gaps';

  if (includeMatched && matched.length > 0) {
    if (section === 'all') lines.push('');
    lines.push(csvRow(['Section', 'Matched to Register']));
    lines.push(csvRow(['Drawing', 'Extracted Text', 'System', 'Register Tag', 'Context', 'Match Source', 'Confidence']));
    for (const m of matched) {
      lines.push(csvRow([
        m.drawingNumber, m.extractedText, m.systemCode || '',
        m.registerTag, m.contextValue || '', m.matchSource,
        m.confidence != null ? (m.confidence * 100).toFixed(0) + '%' : '',
      ]));
    }
  }

  if (includeUnmatched && unmatchedOcr.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(csvRow(['Section', 'OCR Not in Register']));
    lines.push(csvRow(['Drawing', 'Extracted Text', 'Confidence', 'BBox X%', 'BBox Y%', 'Hint']));
    for (const u of unmatchedOcr) {
      lines.push(csvRow([
        u.drawingNumber, u.extractedText,
        u.confidence != null ? (u.confidence * 100).toFixed(0) + '%' : '',
        u.bboxXPct ?? '', u.bboxYPct ?? '', u.hint || '',
      ]));
    }
  }

  if (includeGaps && registerNotInOcr.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(csvRow(['Section', 'On P&ID Not in OCR']));
    lines.push(csvRow(['Drawing', 'System', 'Register Tag', 'Context', 'Note']));
    for (const g of registerNotInOcr) {
      lines.push(csvRow([
        g.drawingNumber, g.systemCode || '', g.registerTag,
        g.contextValue || '', g.hint || '',
      ]));
    }
  }

  const header = `Register Preview — ${entityType} (${section})\n`;
  return header + lines.join('\n') + '\n';
}
