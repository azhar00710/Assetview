/**
 * OCR Result Exporter.
 * Generates JSON, XML, or CSV output from OCR extractions for handoff to annotation module.
 */

/**
 * Export OCR results for a batch in the specified format.
 * @param {object} prisma
 * @param {string} batchId
 * @param {string} format - 'json' | 'xml' | 'csv'
 * @returns {Promise<{ content: Buffer, filename: string, contentType: string }>}
 */
export async function exportBatchResults(prisma, batchId, format = 'json') {
  // Get batch info
  const [batch] = await prisma.$queryRaw`
    SELECT b.id, b.platform_id, b.batch_name, b.status,
           p.code AS platform_code, p.name AS platform_name
    FROM ocr_batch b
    JOIN platform p ON p.id = b.platform_id
    WHERE b.id = ${batchId}::uuid
  `;

  if (!batch) throw new Error(`Batch ${batchId} not found`);

  // Get all files in this batch with their OCR results
  const files = await prisma.$queryRaw`
    SELECT bf.id, bf.storage_key, bf.filename, bf.drawing_number, bf.revision,
           bf.pnid_id, bf.status, bf.tags_found, bf.tags_matched
    FROM ocr_batch_file bf
    WHERE bf.batch_id = ${batchId}::uuid
    ORDER BY bf.drawing_number, bf.filename
  `;

  // Get extractions for all P&IDs in this batch
  const pnidIds = files.filter(f => f.pnid_id).map(f => f.pnid_id);
  let extractions = [];
  if (pnidIds.length > 0) {
    extractions = await prisma.$queryRaw`
      SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.tag_type, oe.confidence,
             oe.bbox_x_pct, oe.bbox_y_pct, oe.bbox_w_pct, oe.bbox_h_pct,
             oe.matched_entity_id, oe.match_confidence, oe.match_method, oe.status
      FROM ocr_extraction oe
      WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
      ORDER BY oe.pnid_id, oe.tag_type, oe.extracted_text
    `;
  }

  // Get entity details for matched extractions
  const matchedEntityIds = extractions
    .filter(e => e.matched_entity_id)
    .map(e => e.matched_entity_id);

  let entityMap = {};
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

    for (const e of equipment) entityMap[e.id] = { tag: e.tag, type: 'equipment', description: e.description };
    for (const i of instruments) entityMap[i.id] = { tag: i.tag, type: 'instrument', description: i.description };
    for (const l of lines) entityMap[l.id] = { tag: l.line_number, type: 'line', description: l.service };
  }

  // Group extractions by pnid_id
  const extractionsByPnid = {};
  for (const ext of extractions) {
    if (!extractionsByPnid[ext.pnid_id]) extractionsByPnid[ext.pnid_id] = [];
    extractionsByPnid[ext.pnid_id].push({
      text: ext.extracted_text,
      tagType: ext.tag_type,
      confidence: Number(ext.confidence),
      bbox: {
        xPct: Number(ext.bbox_x_pct),
        yPct: Number(ext.bbox_y_pct),
        wPct: Number(ext.bbox_w_pct),
        hPct: Number(ext.bbox_h_pct),
      },
      matchedEntityId: ext.matched_entity_id,
      matchedEntity: ext.matched_entity_id ? entityMap[ext.matched_entity_id] || null : null,
      matchConfidence: Number(ext.match_confidence),
      matchMethod: ext.match_method,
      status: ext.status,
    });
  }

  // Build result object
  const result = {
    batch: {
      id: batch.id,
      name: batch.batch_name,
      platform: { code: batch.platform_code, name: batch.platform_name },
      exportedAt: new Date().toISOString(),
    },
    files: files.map(f => ({
      filename: f.filename,
      drawingNumber: f.drawing_number,
      revision: f.revision,
      storageKey: f.storage_key,
      status: f.status,
      tagsFound: f.tags_found,
      tagsMatched: f.tags_matched,
      extractions: extractionsByPnid[f.pnid_id] || [],
    })),
    summary: {
      totalFiles: files.length,
      processedFiles: files.filter(f => f.status === 'completed').length,
      failedFiles: files.filter(f => f.status === 'failed').length,
      totalTags: extractions.length,
      matchedTags: extractions.filter(e => e.matched_entity_id).length,
      approvedTags: extractions.filter(e => e.status === 'approved').length,
    },
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `ocr_results_${batch.platform_code}_${timestamp}`;

  switch (format) {
    case 'xml':
      return {
        content: Buffer.from(toXml(result)),
        filename: `${baseName}.xml`,
        contentType: 'application/xml',
      };
    case 'csv':
      return {
        content: Buffer.from(toCsv(result)),
        filename: `${baseName}.csv`,
        contentType: 'text/csv',
      };
    default:
      return {
        content: Buffer.from(JSON.stringify(result, null, 2)),
        filename: `${baseName}.json`,
        contentType: 'application/json',
      };
  }
}

/**
 * Convert result to XML.
 */
function toXml(result) {
  const escape = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<ocrResults>\n';
  xml += `  <batch id="${escape(result.batch.id)}" name="${escape(result.batch.name)}">\n`;
  xml += `    <platform code="${escape(result.batch.platform.code)}" name="${escape(result.batch.platform.name)}" />\n`;
  xml += `    <exportedAt>${escape(result.batch.exportedAt)}</exportedAt>\n`;
  xml += `  </batch>\n`;

  xml += '  <files>\n';
  for (const file of result.files) {
    xml += `    <file filename="${escape(file.filename)}" drawingNumber="${escape(file.drawingNumber)}" revision="${escape(file.revision)}" status="${escape(file.status)}" tagsFound="${file.tagsFound}" tagsMatched="${file.tagsMatched}">\n`;
    xml += '      <extractions>\n';
    for (const ext of file.extractions) {
      xml += `        <extraction text="${escape(ext.text)}" tagType="${escape(ext.tagType)}" confidence="${ext.confidence}" matchConfidence="${ext.matchConfidence}" status="${escape(ext.status)}"`;
      if (ext.matchedEntity) {
        xml += ` matchedTag="${escape(ext.matchedEntity.tag)}" matchedType="${escape(ext.matchedEntity.type)}"`;
      }
      xml += ` bboxX="${ext.bbox.xPct}" bboxY="${ext.bbox.yPct}" bboxW="${ext.bbox.wPct}" bboxH="${ext.bbox.hPct}"`;
      xml += ' />\n';
    }
    xml += '      </extractions>\n';
    xml += '    </file>\n';
  }
  xml += '  </files>\n';

  xml += `  <summary totalFiles="${result.summary.totalFiles}" processedFiles="${result.summary.processedFiles}" failedFiles="${result.summary.failedFiles}" totalTags="${result.summary.totalTags}" matchedTags="${result.summary.matchedTags}" approvedTags="${result.summary.approvedTags}" />\n`;
  xml += '</ocrResults>\n';
  return xml;
}

/**
 * Convert result to CSV (flat: one row per extraction).
 */
function toCsv(result) {
  const headers = [
    'filename', 'drawing_number', 'revision', 'file_status',
    'extracted_text', 'tag_type', 'confidence',
    'bbox_x_pct', 'bbox_y_pct', 'bbox_w_pct', 'bbox_h_pct',
    'matched_entity_tag', 'matched_entity_type', 'match_confidence', 'match_method',
    'extraction_status',
  ];

  const rows = [headers.join(',')];

  for (const file of result.files) {
    if (file.extractions.length === 0) {
      rows.push([
        csvEscape(file.filename), csvEscape(file.drawingNumber), csvEscape(file.revision), csvEscape(file.status),
        '', '', '', '', '', '', '', '', '', '', '', '',
      ].join(','));
    } else {
      for (const ext of file.extractions) {
        rows.push([
          csvEscape(file.filename), csvEscape(file.drawingNumber), csvEscape(file.revision), csvEscape(file.status),
          csvEscape(ext.text), csvEscape(ext.tagType), ext.confidence,
          ext.bbox.xPct, ext.bbox.yPct, ext.bbox.wPct, ext.bbox.hPct,
          csvEscape(ext.matchedEntity?.tag || ''), csvEscape(ext.matchedEntity?.type || ''),
          ext.matchConfidence, csvEscape(ext.matchMethod || ''),
          csvEscape(ext.status),
        ].join(','));
      }
    }
  }

  return rows.join('\n');
}

function csvEscape(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
