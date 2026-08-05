import prisma from '../db.js';
import {
  getDictionary, getAllEntries, addEntry, updateEntry, deleteEntry,
  importFromCsv, importFromJson, detectFromOcr, detectFromDataFiles,
  getEntryCount, getStandardTemplates, applyGlobalTemplate,
  getTagAnalyses, getTagAnalysisDetail,
} from '../services/ocr/TagDictionaryService.js';

export default async function tagDictionaryRoutes(fastify) {

  // ═══ GET /tag-dictionary/:platformId — Get active dictionary for platform ═══
  fastify.get('/tag-dictionary/:platformId', async (request) => {
    const { platformId } = request.params;
    const { all } = request.query; // ?all=true to include inactive

    const entries = all === 'true'
      ? await getAllEntries(prisma, platformId)
      : await getDictionary(prisma, platformId);

    const count = await getEntryCount(prisma, platformId);

    return {
      platformId,
      totalActive: count,
      entries: entries.map(formatEntry),
    };
  });

  // ═══ POST /tag-dictionary/:platformId — Add single entry ═══
  fastify.post('/tag-dictionary/:platformId', async (request, reply) => {
    const { platformId } = request.params;
    const { functionCode, entityType, discipline, description, tagPattern, numberFormat } = request.body;

    if (!functionCode || !entityType) {
      return reply.status(400).send({ error: 'functionCode and entityType are required' });
    }

    const entry = await addEntry(prisma, platformId, {
      functionCode, entityType, discipline, description, tagPattern, numberFormat,
    });

    return { success: true, entry: formatEntry(entry) };
  });

  // ═══ PUT /tag-dictionary/entries/:entryId — Update entry ═══
  fastify.put('/tag-dictionary/entries/:entryId', async (request) => {
    const { entryId } = request.params;
    const entry = await updateEntry(prisma, entryId, request.body);
    return { success: true, entry: formatEntry(entry) };
  });

  // ═══ DELETE /tag-dictionary/entries/:entryId — Deactivate entry ═══
  fastify.delete('/tag-dictionary/entries/:entryId', async (request) => {
    const { entryId } = request.params;
    await deleteEntry(prisma, entryId);
    return { success: true };
  });

  // ═══ POST /tag-dictionary/:platformId/import-csv — Upload CSV ═══
  fastify.post('/tag-dictionary/:platformId/import-csv', async (request, reply) => {
    const { platformId } = request.params;
    const { csvText } = request.body;

    if (!csvText) {
      return reply.status(400).send({ error: 'csvText is required' });
    }

    const result = await importFromCsv(prisma, platformId, csvText, 'user');
    return { success: true, ...result };
  });

  // ═══ POST /tag-dictionary/:platformId/import-json — Upload JSON entries ═══
  fastify.post('/tag-dictionary/:platformId/import-json', async (request, reply) => {
    const { platformId } = request.params;
    const { entries } = request.body;

    if (!entries?.length) {
      return reply.status(400).send({ error: 'entries array is required' });
    }

    const result = await importFromJson(prisma, platformId, entries, 'user');
    return { success: true, ...result };
  });

  // ═══ POST /tag-dictionary/:platformId/ai-detect — AI auto-detection from OCR batch + data files ═══
  // Accepts: { batchId?, dataFiles?: [{fileName, sheetName, headers, rowCount, sampleRows, csvText}] }
  // Also supports legacy: { batchId?, equipmentCsv?, instrumentCsv?, linesCsv? }
  fastify.post('/tag-dictionary/:platformId/ai-detect', {
    config: { rawBody: true },
    bodyLimit: 50 * 1024 * 1024, // 50MB for large Excel data
  }, async (request, reply) => {
    const { platformId } = request.params;
    const { batchId, apiKey, dataFiles, equipmentCsv, instrumentCsv, linesCsv } = request.body;

    const hasDataFiles = dataFiles?.length > 0;
    const hasLegacyCsv = !!(equipmentCsv || instrumentCsv || linesCsv);

    if (!batchId && !hasDataFiles && !hasLegacyCsv) {
      return reply.status(400).send({ error: 'Provide an OCR batchId and/or data files (dataFiles array or CSV strings)' });
    }

    // Support legacy format by converting to dataFiles
    const resolvedDataFiles = hasDataFiles ? dataFiles : undefined;
    if (hasLegacyCsv && !hasDataFiles) {
      const legacyFiles = [];
      if (equipmentCsv) legacyFiles.push({ fileName: 'equipment.csv', sheetName: 'Equipment', headers: [], rowCount: equipmentCsv.split('\n').length - 1, csvText: equipmentCsv });
      if (instrumentCsv) legacyFiles.push({ fileName: 'instruments.csv', sheetName: 'Instruments', headers: [], rowCount: instrumentCsv.split('\n').length - 1, csvText: instrumentCsv });
      if (linesCsv) legacyFiles.push({ fileName: 'lines.csv', sheetName: 'Lines', headers: [], rowCount: linesCsv.split('\n').length - 1, csvText: linesCsv });
    }

    const result = await detectFromOcr(prisma, platformId, batchId || null, {
      apiKey,
      dataFiles: resolvedDataFiles || (hasLegacyCsv ? undefined : undefined),
      // Legacy fallback
      ...(hasLegacyCsv && !hasDataFiles ? { equipmentCsv, instrumentCsv, linesCsv } : {}),
    });
    return result;
  });

  // ═══ POST /tag-dictionary/:platformId/ai-detect/apply — Save AI-detected entries ═══
  fastify.post('/tag-dictionary/:platformId/ai-detect/apply', async (request, reply) => {
    const { platformId } = request.params;
    const { entries } = request.body;

    if (!entries?.length) {
      return reply.status(400).send({ error: 'entries array is required' });
    }

    const result = { added: 0, errors: [] };
    for (const entry of entries) {
      try {
        await addEntry(prisma, platformId, { ...entry, source: 'ai_detected' });
        result.added++;
      } catch (err) {
        result.errors.push({ functionCode: entry.functionCode, error: err.message });
      }
    }

    return { success: true, ...result };
  });

  // ═══ GET /tag-dictionary/:platformId/analyses — List saved tag analyses ═══
  fastify.get('/tag-dictionary/:platformId/analyses', async (request) => {
    const { platformId } = request.params;
    const analyses = await getTagAnalyses(prisma, platformId);
    return {
      analyses: analyses.map(a => ({
        id: a.id,
        sourceType: a.source_type,
        ocrBatchId: a.ocr_batch_id,
        sourceFiles: a.source_files,
        totalEntries: a.total_entries,
        appliedCount: a.applied_count,
        totalRowsAnalyzed: a.total_rows_analyzed,
        totalSheetsAnalyzed: a.total_sheets_analyzed,
        aiSource: a.ai_source,
        createdAt: a.created_at,
      })),
    };
  });

  // ═══ GET /tag-dictionary/analyses/:analysisId — Get analysis detail ═══
  fastify.get('/tag-dictionary/analyses/:analysisId', async (request, reply) => {
    const { analysisId } = request.params;
    const analysis = await getTagAnalysisDetail(prisma, analysisId);

    if (!analysis) {
      return reply.status(404).send({ error: 'Analysis not found' });
    }

    return {
      id: analysis.id,
      platformId: analysis.platform_id,
      sourceType: analysis.source_type,
      ocrBatchId: analysis.ocr_batch_id,
      sourceFiles: analysis.source_files,
      columnMapping: analysis.column_mapping,
      suggestions: analysis.suggestions,
      tagFormat: analysis.tag_format,
      lineFormat: analysis.line_format,
      fluidCodes: analysis.fluid_codes,
      hasLocationCode: analysis.has_location_code,
      locationCodeLength: analysis.location_code_length,
      totalEntries: analysis.total_entries,
      appliedCount: analysis.applied_count,
      totalRowsAnalyzed: analysis.total_rows_analyzed,
      totalSheetsAnalyzed: analysis.total_sheets_analyzed,
      aiModel: analysis.ai_model,
      aiSource: analysis.ai_source,
      tokensInput: analysis.tokens_input,
      tokensOutput: analysis.tokens_output,
      createdAt: analysis.created_at,
    };
  });

  // ═══ POST /tag-dictionary/:platformId/detect-from-data — Detect function codes from data files ═══
  fastify.post('/tag-dictionary/:platformId/detect-from-data', async (request, reply) => {
    const { dataFiles, equipmentCsv, instrumentCsv, linesCsv } = request.body || {};

    if (!dataFiles?.length && !equipmentCsv && !instrumentCsv && !linesCsv) {
      return reply.status(400).send({ error: 'Provide dataFiles array or CSV strings' });
    }

    const result = detectFromDataFiles(dataFiles?.length ? { dataFiles } : { equipmentCsv, instrumentCsv, linesCsv });
    return result;
  });

  // ═══ GET /tag-dictionary/templates — List available standard templates ═══
  fastify.get('/tag-dictionary/templates', async () => {
    return { templates: getStandardTemplates() };
  });

  // ═══ POST /tag-dictionary/:platformId/apply-template — Apply global template to platform ═══
  fastify.post('/tag-dictionary/:platformId/apply-template', async (request) => {
    const { platformId } = request.params;
    await applyGlobalTemplate(prisma, platformId);
    const count = await getEntryCount(prisma, platformId);
    return { success: true, totalActive: count };
  });

  // ═══ GET /tag-dictionary/:platformId/stats — Quick stats ═══
  fastify.get('/tag-dictionary/:platformId/stats', async (request) => {
    const { platformId } = request.params;
    const count = await getEntryCount(prisma, platformId);

    // Discipline breakdown
    const breakdown = await prisma.$queryRaw`
      SELECT discipline, entity_type, COUNT(*)::int AS count
      FROM tag_dictionary
      WHERE platform_id = ${platformId}::uuid AND is_active = true
      GROUP BY discipline, entity_type
      ORDER BY discipline NULLS LAST, entity_type
    `;

    return {
      platformId,
      totalActive: count,
      byDiscipline: breakdown,
    };
  });

  // ═══ GET /tag-dictionary/:platformId/csv-template — Download empty CSV template ═══
  fastify.get('/tag-dictionary/:platformId/csv-template', async (request, reply) => {
    const csvContent = [
      'function_code,entity_type,discipline,description,tag_pattern,number_format',
      'V,equipment,mechanical,Vessel,,2-digit system + 2-digit sequence',
      'PT,instrument,instrumentation,Pressure Transmitter,,2-digit system + 4-digit sequence',
      'BDV,valve,valves,Blowdown Valve,,2-digit system + 4-digit sequence',
      'PSV,valve,valves,Pressure Safety Valve,,2-digit system + 4-digit sequence',
      'GD,instrument,fire_gas,Gas Detector,,2-digit system + 4-digit sequence',
    ].join('\n');

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', 'attachment; filename="tag_dictionary_template.csv"');
    return reply.send(csvContent);
  });
}

function formatEntry(e) {
  return {
    id: e.id,
    functionCode: e.function_code,
    entityType: e.entity_type,
    discipline: e.discipline,
    description: e.description,
    tagPattern: e.tag_pattern,
    numberFormat: e.number_format,
    source: e.source,
    confidence: e.confidence ? Number(e.confidence) : 1.0,
    isActive: e.is_active,
    createdAt: e.created_at,
  };
}
