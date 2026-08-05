/**
 * CleanedDataImporter — handles the download/clean/reload workflow.
 * Accepts cleaned JSON/CSV data and reconciles with existing OCR extractions.
 */

/**
 * Import cleaned data back into the system.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} batchId
 * @param {Array} records - Array of { extractedText, tagType, matchedTag?, action? }
 * @param {string} format - 'json' | 'csv'
 * @returns {Promise<{ added: number, updated: number, unchanged: number, errors: Array }>}
 */
export async function importCleanedData(prisma, batchId, records, format = 'json') {
  const result = { added: 0, updated: 0, unchanged: 0, errors: [] };

  // Get batch info
  const [batch] = await prisma.$queryRaw`
    SELECT id, platform_id FROM ocr_batch WHERE id = ${batchId}::uuid
  `;
  if (!batch) throw new Error(`Batch ${batchId} not found`);

  // Get all P&ID IDs in this batch
  const batchFiles = await prisma.$queryRaw`
    SELECT bf.pnid_id, bf.drawing_number
    FROM ocr_batch_file bf
    WHERE bf.batch_id = ${batchId}::uuid AND bf.pnid_id IS NOT NULL
  `;
  const pnidIds = batchFiles.filter(f => f.pnid_id).map(f => f.pnid_id);

  // Get existing extractions
  let existingExtractions = [];
  if (pnidIds.length > 0) {
    existingExtractions = await prisma.$queryRaw`
      SELECT id, pnid_id, extracted_text, tag_type, matched_entity_id, status
      FROM ocr_extraction
      WHERE pnid_id = ANY(${pnidIds}::uuid[])
    `;
  }

  // Build lookup map
  const existingByText = new Map();
  for (const ext of existingExtractions) {
    const key = `${ext.pnid_id}:${ext.extracted_text}`;
    existingByText.set(key, ext);
  }

  // Drawing number to pnid_id map
  const drawingToPnid = {};
  for (const f of batchFiles) {
    if (f.drawing_number && f.pnid_id) {
      drawingToPnid[f.drawing_number] = f.pnid_id;
    }
  }

  for (const record of records) {
    try {
      const pnidId = record.pnidId || drawingToPnid[record.drawingNumber] || pnidIds[0];
      if (!pnidId) {
        result.errors.push({ record, error: 'Cannot resolve P&ID for this record' });
        continue;
      }

      const key = `${pnidId}:${record.extractedText}`;
      const existing = existingByText.get(key);

      if (existing) {
        // Check if anything changed
        const tagTypeChanged = record.tagType && record.tagType !== existing.tag_type;
        const statusChanged = record.status && record.status !== existing.status;

        if (tagTypeChanged || statusChanged) {
          const updates = [];
          if (tagTypeChanged) updates.push(`tag_type = '${record.tagType}'`);
          if (statusChanged) updates.push(`status = '${record.status}'`);

          // Update tag type if changed
          if (record.tagType && record.tagType !== existing.tag_type) {
            await prisma.$queryRaw`
              UPDATE ocr_extraction SET tag_type = ${record.tagType}
              WHERE id = ${existing.id}::uuid
            `;
          }
          if (record.status && record.status !== existing.status) {
            await prisma.$queryRaw`
              UPDATE ocr_extraction SET status = ${record.status}, reviewed_at = NOW()
              WHERE id = ${existing.id}::uuid
            `;
          }
          result.updated++;
        } else {
          result.unchanged++;
        }
      } else {
        // New extraction — add it
        await prisma.$queryRaw`
          INSERT INTO ocr_extraction (
            pnid_id, extracted_text, tag_type, confidence,
            bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
            status
          ) VALUES (
            ${pnidId}::uuid, ${record.extractedText}, ${record.tagType || 'unknown'},
            ${record.confidence || 0.5},
            ${record.bboxXPct || 0}, ${record.bboxYPct || 0},
            ${record.bboxWPct || 0}, ${record.bboxHPct || 0},
            'pending'
          )
        `;
        result.added++;
      }
    } catch (err) {
      result.errors.push({ record: record.extractedText, error: err.message });
    }
  }

  return result;
}

/**
 * Parse CSV text into records array.
 */
export function parseCsvToRecords(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const record = {};
    for (let j = 0; j < headers.length && j < values.length; j++) {
      const key = mapCsvHeader(headers[j]);
      if (key) record[key] = values[j];
    }
    if (record.extractedText) records.push(record);
  }

  return records;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function mapCsvHeader(header) {
  const map = {
    extracted_text: 'extractedText',
    extractedtext: 'extractedText',
    tag: 'extractedText',
    tag_type: 'tagType',
    tagtype: 'tagType',
    type: 'tagType',
    drawing_number: 'drawingNumber',
    drawingnumber: 'drawingNumber',
    pnid: 'drawingNumber',
    confidence: 'confidence',
    status: 'status',
    bbox_x_pct: 'bboxXPct',
    bbox_y_pct: 'bboxYPct',
    bbox_w_pct: 'bboxWPct',
    bbox_h_pct: 'bboxHPct',
  };
  return map[header] || null;
}
