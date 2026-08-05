/**
 * TagDictionaryService — Manages client-specific tag classification dictionaries.
 *
 * Each platform/concession can have its own set of function-code → entity-type
 * mappings that the TagClassifier consults before falling back to generic ISA rules.
 *
 * Three input modes:
 *  1. CSV/JSON upload from client tagging standard documents
 *  2. Manual single-entry add via UI
 *  3. AI auto-detection from OCR batch results
 */

/**
 * Get the active tag dictionary for a platform.
 * Resolution order: platform-specific → concession-wide → global (both NULL).
 * All active entries across matched scopes are merged (platform overrides concession overrides global).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} platformId
 * @returns {Promise<Array<{function_code: string, entity_type: string, discipline: string, description: string, tag_pattern: string, source: string}>>}
 */
export async function getDictionary(prisma, platformId) {
  // Get platform's concession_id for scope resolution
  let concessionId = null;
  try {
    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      include: { complex: { include: { location: true } } },
    });
    concessionId = platform?.complex?.location?.concession_id || null;
  } catch {
    // If platform lookup fails, just skip concession scope
  }

  // Fetch all matching scopes in priority order
  const entries = await prisma.$queryRaw`
    SELECT id, platform_id, concession_id, function_code, entity_type,
           discipline, description, tag_pattern, number_format, source, confidence,
           is_active, created_at
    FROM tag_dictionary
    WHERE is_active = true
      AND (
        (platform_id = ${platformId}::uuid)
        OR (platform_id IS NULL AND concession_id = ${concessionId}::uuid)
        OR (platform_id IS NULL AND concession_id IS NULL)
      )
    ORDER BY
      -- Platform-specific first, then concession, then global
      CASE
        WHEN platform_id IS NOT NULL THEN 1
        WHEN concession_id IS NOT NULL THEN 2
        ELSE 3
      END,
      function_code
  `;

  // Deduplicate: platform overrides concession overrides global
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.function_code)) {
      seen.set(entry.function_code, entry);
    }
  }

  return Array.from(seen.values());
}

/**
 * Get all dictionary entries for a platform (including inactive, for admin view).
 */
export async function getAllEntries(prisma, platformId) {
  return prisma.$queryRaw`
    SELECT id, platform_id, concession_id, function_code, entity_type,
           discipline, description, tag_pattern, number_format, source,
           confidence, is_active, created_at, created_by
    FROM tag_dictionary
    WHERE platform_id = ${platformId}::uuid
    ORDER BY discipline NULLS LAST, function_code
  `;
}

/**
 * Add a single dictionary entry.
 */
export async function addEntry(prisma, platformId, entry) {
  const { functionCode, entityType, discipline, description, tagPattern, numberFormat, source } = entry;

  const [result] = await prisma.$queryRaw`
    INSERT INTO tag_dictionary (platform_id, function_code, entity_type, discipline, description, tag_pattern, number_format, source)
    VALUES (${platformId}::uuid, ${functionCode.toUpperCase()}, ${entityType}, ${discipline || null}, ${description || null}, ${tagPattern || null}, ${numberFormat || null}, ${source || 'manual'})
    ON CONFLICT (platform_id, concession_id, function_code) DO UPDATE SET
      entity_type = EXCLUDED.entity_type,
      discipline = EXCLUDED.discipline,
      description = EXCLUDED.description,
      tag_pattern = EXCLUDED.tag_pattern,
      number_format = EXCLUDED.number_format,
      source = EXCLUDED.source,
      is_active = true,
      updated_at = NOW()
    RETURNING *
  `;
  return result;
}

/**
 * Update an existing dictionary entry.
 */
export async function updateEntry(prisma, entryId, updates) {
  const { entityType, discipline, description, tagPattern, numberFormat, isActive } = updates;

  const [result] = await prisma.$queryRaw`
    UPDATE tag_dictionary SET
      entity_type = COALESCE(${entityType}, entity_type),
      discipline = COALESCE(${discipline}, discipline),
      description = COALESCE(${description}, description),
      tag_pattern = COALESCE(${tagPattern}, tag_pattern),
      number_format = COALESCE(${numberFormat}, number_format),
      is_active = COALESCE(${isActive}, is_active),
      updated_at = NOW()
    WHERE id = ${entryId}::uuid
    RETURNING *
  `;
  return result;
}

/**
 * Deactivate (soft-delete) a dictionary entry.
 */
export async function deleteEntry(prisma, entryId) {
  await prisma.$queryRaw`
    UPDATE tag_dictionary SET is_active = false, updated_at = NOW()
    WHERE id = ${entryId}::uuid
  `;
}

/**
 * Import entries from CSV text.
 * Expected columns: function_code, entity_type, discipline, description, tag_pattern, number_format
 *
 * @returns {{ total: number, added: number, updated: number, skipped: number, errors: Array }}
 */
export async function importFromCsv(prisma, platformId, csvText, uploadedBy) {
  const result = { total: 0, added: 0, updated: 0, skipped: 0, errors: [] };

  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    result.errors.push({ row: 0, error: 'CSV must have a header row and at least one data row' });
    return result;
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  const codeIdx = headers.indexOf('function_code');
  const typeIdx = headers.indexOf('entity_type');
  if (codeIdx === -1 || typeIdx === -1) {
    result.errors.push({ row: 0, error: 'CSV must have function_code and entity_type columns' });
    return result;
  }

  const discIdx = headers.indexOf('discipline');
  const descIdx = headers.indexOf('description');
  const patIdx = headers.indexOf('tag_pattern');
  const numIdx = headers.indexOf('number_format');

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    result.total++;

    const functionCode = (values[codeIdx] || '').trim().toUpperCase();
    const entityType = (values[typeIdx] || '').trim().toLowerCase();

    if (!functionCode || !entityType) {
      result.errors.push({ row: i + 1, error: `Missing function_code or entity_type` });
      result.skipped++;
      continue;
    }

    try {
      const [row] = await prisma.$queryRaw`
        INSERT INTO tag_dictionary (platform_id, function_code, entity_type, discipline, description, tag_pattern, number_format, source, created_by)
        VALUES (
          ${platformId}::uuid,
          ${functionCode},
          ${entityType},
          ${discIdx >= 0 ? (values[discIdx] || '').trim().toLowerCase() || null : null},
          ${descIdx >= 0 ? (values[descIdx] || '').trim() || null : null},
          ${patIdx >= 0 ? (values[patIdx] || '').trim() || null : null},
          ${numIdx >= 0 ? (values[numIdx] || '').trim() || null : null},
          'csv_upload',
          ${uploadedBy || null}
        )
        ON CONFLICT (platform_id, concession_id, function_code) DO UPDATE SET
          entity_type = EXCLUDED.entity_type,
          discipline = COALESCE(EXCLUDED.discipline, tag_dictionary.discipline),
          description = COALESCE(EXCLUDED.description, tag_dictionary.description),
          tag_pattern = COALESCE(EXCLUDED.tag_pattern, tag_dictionary.tag_pattern),
          number_format = COALESCE(EXCLUDED.number_format, tag_dictionary.number_format),
          source = 'csv_upload',
          is_active = true,
          updated_at = NOW()
        RETURNING (xmax = 0) AS is_insert
      `;

      if (row.is_insert) {
        result.added++;
      } else {
        result.updated++;
      }
    } catch (err) {
      result.errors.push({ row: i + 1, functionCode, error: err.message });
      result.skipped++;
    }
  }

  // Record the upload for audit
  await prisma.$queryRaw`
    INSERT INTO tag_dictionary_upload (platform_id, filename, total_entries, added_entries, updated_entries, skipped_entries, errors, uploaded_by)
    VALUES (${platformId}::uuid, 'csv_import', ${result.total}, ${result.added}, ${result.updated}, ${result.skipped}, ${JSON.stringify(result.errors)}::jsonb, ${uploadedBy || null})
  `;

  return result;
}

/**
 * Import entries from JSON array.
 * Each entry: { functionCode, entityType, discipline?, description?, tagPattern?, numberFormat? }
 */
export async function importFromJson(prisma, platformId, entries, uploadedBy) {
  const result = { total: entries.length, added: 0, updated: 0, skipped: 0, errors: [] };

  for (const entry of entries) {
    try {
      const row = await addEntry(prisma, platformId, { ...entry, source: 'csv_upload' });
      // If it existed and was updated vs newly created — approximate detection
      if (row) result.added++;
    } catch (err) {
      result.errors.push({ functionCode: entry.functionCode, error: err.message });
      result.skipped++;
    }
  }

  await prisma.$queryRaw`
    INSERT INTO tag_dictionary_upload (platform_id, filename, total_entries, added_entries, updated_entries, skipped_entries, errors, uploaded_by)
    VALUES (${platformId}::uuid, 'json_import', ${result.total}, ${result.added}, ${0}, ${result.skipped}, ${JSON.stringify(result.errors)}::jsonb, ${uploadedBy || null})
  `;

  return result;
}

/**
 * AI auto-detection: Analyze OCR batch results AND/OR uploaded data files
 * (CSV + Excel) to infer the client's tagging convention.
 *
 * Enhanced approach:
 *  - Accepts dataFiles[] with all sheets and all columns (parsed client-side)
 *  - AI identifies which columns contain tags (no hardcoded column names)
 *  - Captures descriptions, specs, and other context from surrounding columns
 *  - Saves full analysis to tag_analysis table for future reference
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} platformId
 * @param {string} [batchId] - OCR batch ID (optional)
 * @param {{ apiKey?: string, dataFiles?: Array<{fileName, sheetName, headers, rowCount, sampleRows, csvText}> }} options
 * @returns {Promise<object>}
 */
export async function detectFromOcr(prisma, platformId, batchId, options = {}) {
  const { dataFiles } = options;
  const hasDataFiles = dataFiles?.length > 0;

  // ── Phase 1: Programmatic scan of all data files ──
  let programmaticResults = null;
  if (hasDataFiles) {
    programmaticResults = detectFromDataFiles({ dataFiles });
  }

  // ── Gather OCR extractions (if batchId provided) ──
  let extractions = [];
  if (batchId) {
    extractions = await prisma.$queryRaw`
      SELECT DISTINCT oe.extracted_text, oe.tag_type, oe.confidence
      FROM ocr_extraction oe
      JOIN ocr_batch_file bf ON bf.pnid_id = oe.pnid_id
      WHERE bf.batch_id = ${batchId}::uuid
      ORDER BY oe.extracted_text
    `;
  }

  if (!extractions.length && !programmaticResults) {
    return { suggestions: [], message: 'No data provided. Select an OCR batch or upload data files.' };
  }

  // ── Resolve AI key ──
  let apiKey = options.apiKey;
  if (!apiKey) {
    try {
      const { resolveAiCredentials } = await import('./AiAnalysisService.js');
      const resolved = await resolveAiCredentials(prisma, platformId);
      apiKey = resolved.apiKey;
    } catch {
      apiKey = process.env.ANTHROPIC_API_KEY;
    }
  }
  if (!apiKey) {
    if (programmaticResults) {
      const result = buildProgrammaticResult(programmaticResults, 'No AI key available — showing programmatic analysis only');
      await saveAnalysis(prisma, platformId, batchId, dataFiles, result);
      return result;
    }
    return { suggestions: [], message: 'No API key available for AI detection' };
  }

  // ── Phase 2: Build AI prompt combining ALL sources ──

  // OCR prefix analysis
  const prefixCounts = {};
  for (const ext of extractions) {
    const text = (ext.extracted_text || '').toUpperCase().trim();
    const parts = text.split('-');
    if (parts.length >= 2) {
      for (const part of parts) {
        if (/^[A-Z]{1,5}$/.test(part) && !/^\d+$/.test(part)) {
          prefixCounts[part] = (prefixCounts[part] || 0) + 1;
        }
      }
    }
  }

  const ocrTagSamples = extractions.slice(0, 200).map(e => e.extracted_text);
  const prefixSummary = Object.entries(prefixCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([code, count]) => `${code} (${count} occurrences)`)
    .join(', ');

  // Build data files section — show ALL columns and headers for AI to analyze
  let dataFilesSection = '';
  if (hasDataFiles) {
    dataFilesSection = '\n## Uploaded Data Files\n';
    for (const df of dataFiles) {
      const csvLines = df.csvText.split('\n').filter(l => l.trim());
      const preview = csvLines.slice(0, 40).join('\n');
      dataFilesSection += `\n### File: ${df.fileName} — Sheet: ${df.sheetName} (${df.rowCount} rows, ${df.headers.length} columns)
**All Column Headers**: ${df.headers.join(' | ')}
**Sample Rows** (first ${Math.min(df.sampleRows?.length || 0, 5)} shown):
${(df.sampleRows || []).slice(0, 5).map(row => row.join(' | ')).join('\n')}

**Full Data Preview** (first 40 rows):
${preview}
`;
    }
  }

  // Programmatic results section
  let programmaticSection = '';
  if (programmaticResults) {
    programmaticSection = `\n## Programmatic Pre-Analysis
${programmaticResults.stats.totalTagsParsed} tags found across ${programmaticResults.stats.totalSheetsAnalyzed || 0} sheets.
${programmaticResults.stats.uniquePrefixes} unique function code prefixes detected.

### Detected Function Codes
${programmaticResults.entries.map(e =>
  `- **${e.functionCode}** (${e.count}x): ${e.description || 'unknown'} → ${e.entityType}/${e.discipline || '?'} | samples: ${e.sampleTags?.slice(0, 3).join(', ')}`
).join('\n')}

### Column Analysis
${(programmaticResults.columnInsights || []).map(c =>
  `- **${c.fileName}/${c.sheetName}**: tag column="${c.tagColumn}", description columns=[${c.descriptionColumns.join(', ')}]`
).join('\n')}
`;
  }

  const prompt = `You are an expert in oil & gas P&ID tagging standards (ISA S5.1, NOC, ADNOC, Saudi Aramco, etc.).

Analyze ALL data sources below to identify the client's complete tagging convention and generate a comprehensive tag dictionary.

IMPORTANT INSTRUCTIONS:
- Scan EVERY column in EVERY sheet — tags may appear in any column (Tag, Tag Number, Equipment Tag, Tag Code, Device, TagID, etc.)
- Capture descriptions, types, specifications, locations, services from ALL surrounding columns
- Do NOT assume column names — identify tag columns by recognizing oil & gas tag patterns in the data
- Process data from ALL sheets in multi-sheet workbooks
- Be comprehensive: include ALL function codes you can find across ALL sources

${ocrTagSamples.length > 0 ? `## OCR-Extracted Tag Samples (up to 200)
${ocrTagSamples.join('\n')}

## OCR Prefix Frequency
${prefixSummary}
` : ''}
${programmaticSection}
${dataFilesSection}

## Task
Produce a comprehensive analysis. For each unique function code prefix found:
1. **functionCode**: The alphabetic prefix (e.g., "PT", "PSHH", "BDV", "V", "HV")
2. **entityType**: one of "equipment", "instrument", "valve", "line", "cable", "signal", "structural", "safety", "hvac", "telecom", "fire_gas", "piping"
3. **discipline**: one of "mechanical", "electrical", "instrumentation", "telecom", "fire_gas", "safety", "valves", "hvac", "piping", "structural"
4. **description**: Human-readable description (e.g., "Pressure Transmitter") — use the description columns from the data if available
5. **tagPattern**: A regex that matches tags with this prefix. Account for all suffix variations seen in the data.
6. **numberFormat**: Description of the numbering convention
7. **confidence**: 0-1 how sure you are
8. **sampleTags**: Up to 5 example tags from the data
9. **sourceFile**: Which file/sheet this was found in (or "OCR" if from OCR batch)
10. **additionalContext**: Any extra info captured from surrounding columns (spec, material, location, service, etc.)

Also detect and report:
- **columnMapping**: For each file/sheet, which columns contain tags and which contain contextual data. Format: { "fileName/sheetName": { "columnName": "role" } } where role is one of: "tag", "description", "type", "specification", "location", "service", "size", "material", "other"
- The general tag structure format for this platform
- Whether location codes are used (e.g., ASBAA-PT-340201)
- The line numbering convention
- Fluid code catalog mapping

Return ONLY valid JSON:
{
  "tagFormat": "description of overall tag structure",
  "hasLocationCode": true/false,
  "locationCodeLength": number or null,
  "lineFormat": "description of line numbering convention",
  "fluidCodes": { "H": "Hydrocarbon", ... },
  "pipeClasses": ["J16", "B03", ...],
  "columnMapping": { "fileName/sheetName": { "Tag": "tag", "Description": "description", ... } },
  "entries": [
    {
      "functionCode": "PT",
      "entityType": "instrument",
      "discipline": "instrumentation",
      "description": "Pressure Transmitter",
      "tagPattern": "^PT-\\\\d{6}(?:\\\\.[A-Z])?$",
      "numberFormat": "6-digit: 2-digit system + 4-digit sequence",
      "confidence": 0.95,
      "sampleTags": ["PT-281010", "PT-281010.A"],
      "sourceFile": "Instrument_List.xlsx/Sheet1",
      "additionalContext": "Spec: Class 2500, Location: Wellhead Platform"
    }
  ]
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      if (programmaticResults) {
        const result = buildProgrammaticResult(programmaticResults, 'AI response invalid — showing programmatic analysis');
        await saveAnalysis(prisma, platformId, batchId, dataFiles, result);
        return result;
      }
      return { suggestions: [], message: 'AI response did not contain valid JSON' };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      suggestions: (parsed.entries || []).map(e => ({
        functionCode: e.functionCode,
        entityType: e.entityType,
        discipline: e.discipline,
        description: e.description,
        tagPattern: e.tagPattern || null,
        numberFormat: e.numberFormat || null,
        confidence: e.confidence || 0.5,
        sampleTags: e.sampleTags || [],
        sourceFile: e.sourceFile || null,
        additionalContext: e.additionalContext || null,
      })),
      tagFormat: parsed.tagFormat,
      hasLocationCode: parsed.hasLocationCode,
      locationCodeLength: parsed.locationCodeLength,
      lineFormat: parsed.lineFormat,
      fluidCodes: parsed.fluidCodes || programmaticResults?.lineInfo?.fluidCodes || null,
      pipeClasses: parsed.pipeClasses || programmaticResults?.lineInfo?.pipeClasses || null,
      columnMapping: parsed.columnMapping || null,
      lineInfo: programmaticResults?.lineInfo || null,
      stats: programmaticResults?.stats || null,
      source: 'ai',
      tokenUsage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
    };

    // Save analysis for future reference
    const analysisId = await saveAnalysis(prisma, platformId, batchId, dataFiles, result);
    result.analysisId = analysisId;

    return result;
  } catch (err) {
    if (programmaticResults) {
      const result = buildProgrammaticResult(programmaticResults, `AI detection failed (${err.message}) — showing programmatic analysis`);
      await saveAnalysis(prisma, platformId, batchId, dataFiles, result);
      return result;
    }
    return { suggestions: [], message: `AI detection failed: ${err.message}` };
  }
}

/**
 * Build a result object from programmatic analysis only.
 */
function buildProgrammaticResult(programmaticResults, message) {
  return {
    suggestions: programmaticResults.entries.map(e => ({
      functionCode: e.functionCode,
      entityType: e.entityType,
      discipline: e.discipline,
      description: e.description,
      tagPattern: e.tagPattern,
      confidence: e.confidence,
      sampleTags: e.sampleTags,
      count: e.count,
    })),
    tagFormat: programmaticResults.lineInfo?.lineFormat || null,
    lineFormat: programmaticResults.lineInfo?.lineFormat || null,
    lineInfo: programmaticResults.lineInfo,
    stats: programmaticResults.stats,
    source: 'programmatic',
    message,
  };
}

/**
 * Save analysis results to tag_analysis table for future reference.
 */
async function saveAnalysis(prisma, platformId, batchId, dataFiles, result) {
  try {
    const sourceFiles = (dataFiles || []).map(df => ({
      fileName: df.fileName,
      sheetName: df.sheetName,
      headers: df.headers,
      rowCount: df.rowCount,
    }));

    const [row] = await prisma.$queryRaw`
      INSERT INTO tag_analysis (
        platform_id, source_type, ocr_batch_id,
        source_files, column_mapping, suggestions,
        tag_format, line_format, fluid_codes,
        has_location_code, location_code_length,
        total_entries, total_rows_analyzed, total_sheets_analyzed,
        ai_model, ai_source,
        tokens_input, tokens_output
      ) VALUES (
        ${platformId}::uuid,
        ${batchId && dataFiles?.length ? 'mixed' : batchId ? 'ocr_batch' : 'data_files'},
        ${batchId || null}::uuid,
        ${JSON.stringify(sourceFiles)}::jsonb,
        ${JSON.stringify(result.columnMapping || {})}::jsonb,
        ${JSON.stringify(result.suggestions || [])}::jsonb,
        ${result.tagFormat || null},
        ${result.lineFormat || null},
        ${JSON.stringify(result.fluidCodes || {})}::jsonb,
        ${result.hasLocationCode || false},
        ${result.locationCodeLength || null},
        ${result.suggestions?.length || 0},
        ${(dataFiles || []).reduce((s, df) => s + (df.rowCount || 0), 0)},
        ${(dataFiles || []).length},
        ${'claude-sonnet-4-20250514'},
        ${result.source || 'programmatic'},
        ${result.tokenUsage?.input || 0},
        ${result.tokenUsage?.output || 0}
      )
      RETURNING id
    `;
    return row?.id || null;
  } catch (err) {
    console.warn('Failed to save tag analysis:', err.message);
    return null;
  }
}

/**
 * Get saved analyses for a platform.
 */
export async function getTagAnalyses(prisma, platformId) {
  return prisma.$queryRaw`
    SELECT id, source_type, ocr_batch_id, source_files,
           total_entries, applied_count, total_rows_analyzed, total_sheets_analyzed,
           ai_source, created_at
    FROM tag_analysis
    WHERE platform_id = ${platformId}::uuid
    ORDER BY created_at DESC
    LIMIT 20
  `;
}

/**
 * Get a single analysis detail.
 */
export async function getTagAnalysisDetail(prisma, analysisId) {
  const [row] = await prisma.$queryRaw`
    SELECT * FROM tag_analysis WHERE id = ${analysisId}::uuid
  `;
  return row || null;
}

/**
 * Get count of active dictionary entries for a platform.
 */
export async function getEntryCount(prisma, platformId) {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM tag_dictionary
    WHERE platform_id = ${platformId}::uuid AND is_active = true
  `;
  return row?.count || 0;
}

/**
 * Get available standard templates.
 */
export function getStandardTemplates() {
  return [
    {
      id: 'isa_s51_base',
      name: 'ISA S5.1 Base',
      description: 'Standard ISA S5.1 instrumentation codes + common equipment prefixes',
      entryCount: 90,
    },
    {
      id: 'noc_al_shaheen',
      name: 'NOC Al Shaheen (SD-NOC-EC-106)',
      description: 'North Oil Company equipment tagging and facilities numbering standard — 200+ function codes across 10 disciplines',
      entryCount: 200,
    },
    {
      id: 'generic_offshore',
      name: 'Generic Offshore Platform',
      description: 'Common offshore oil & gas tagging patterns covering process, utility, safety, and marine systems',
      entryCount: 120,
    },
  ];
}

/**
 * Apply the global template entries to a platform (copy global → platform scope).
 */
export async function applyGlobalTemplate(prisma, platformId) {
  const result = await prisma.$queryRaw`
    INSERT INTO tag_dictionary (platform_id, function_code, entity_type, discipline, description, tag_pattern, number_format, source, confidence)
    SELECT ${platformId}::uuid, function_code, entity_type, discipline, description, tag_pattern, number_format, 'template', confidence
    FROM tag_dictionary
    WHERE platform_id IS NULL AND concession_id IS NULL AND is_active = true
    ON CONFLICT (platform_id, concession_id, function_code) DO NOTHING
  `;
  return result;
}

// ── Detect from Data Files ─────────────────────────────────

/**
 * Type description → { entityType, discipline } mapping.
 * Handles common oil & gas equipment/instrument type descriptions from CSV data.
 */
const TYPE_INFERENCE_MAP = {
  // Equipment
  'pump': { entityType: 'equipment', discipline: 'mechanical' },
  'vessel': { entityType: 'equipment', discipline: 'mechanical' },
  'heat exchanger': { entityType: 'equipment', discipline: 'mechanical' },
  'compressor': { entityType: 'equipment', discipline: 'mechanical' },
  'tank': { entityType: 'equipment', discipline: 'mechanical' },
  'filter': { entityType: 'equipment', discipline: 'mechanical' },
  'separator': { entityType: 'equipment', discipline: 'mechanical' },
  'reactor': { entityType: 'equipment', discipline: 'mechanical' },
  'blower': { entityType: 'equipment', discipline: 'mechanical' },
  'crane': { entityType: 'equipment', discipline: 'mechanical' },
  'wellhead': { entityType: 'equipment', discipline: 'mechanical' },
  'package equipment': { entityType: 'equipment', discipline: 'mechanical' },
  'generator': { entityType: 'equipment', discipline: 'electrical' },
  'motor': { entityType: 'equipment', discipline: 'electrical' },
  'transformer': { entityType: 'equipment', discipline: 'electrical' },
  'switchboard': { entityType: 'equipment', discipline: 'electrical' },
  'panel': { entityType: 'equipment', discipline: 'electrical' },
  // Instruments
  'pressure transmitter': { entityType: 'instrument', discipline: 'instrumentation' },
  'temperature transmitter': { entityType: 'instrument', discipline: 'instrumentation' },
  'flow transmitter': { entityType: 'instrument', discipline: 'instrumentation' },
  'level transmitter': { entityType: 'instrument', discipline: 'instrumentation' },
  'pressure gauge': { entityType: 'instrument', discipline: 'instrumentation' },
  'pressure indicator': { entityType: 'instrument', discipline: 'instrumentation' },
  'flow indicator': { entityType: 'instrument', discipline: 'instrumentation' },
  'level indicator': { entityType: 'instrument', discipline: 'instrumentation' },
  'level gauge': { entityType: 'instrument', discipline: 'instrumentation' },
  'temperature indicator': { entityType: 'instrument', discipline: 'instrumentation' },
  'pressure switch high high': { entityType: 'instrument', discipline: 'instrumentation' },
  'pressure switch low low': { entityType: 'instrument', discipline: 'instrumentation' },
  'level switch low low': { entityType: 'instrument', discipline: 'instrumentation' },
  'pressure switch': { entityType: 'instrument', discipline: 'instrumentation' },
  'level switch': { entityType: 'instrument', discipline: 'instrumentation' },
  'temperature switch': { entityType: 'instrument', discipline: 'instrumentation' },
  'flow switch': { entityType: 'instrument', discipline: 'instrumentation' },
  'analyzer': { entityType: 'instrument', discipline: 'instrumentation' },
  'position switch': { entityType: 'instrument', discipline: 'instrumentation' },
  'gas detector': { entityType: 'instrument', discipline: 'fire_gas' },
  'flame detector': { entityType: 'instrument', discipline: 'fire_gas' },
  'smoke detector': { entityType: 'instrument', discipline: 'fire_gas' },
  // Valves
  'hydraulic valve': { entityType: 'valve', discipline: 'valves' },
  'hydraulic control valve': { entityType: 'valve', discipline: 'valves' },
  'control valve': { entityType: 'valve', discipline: 'valves' },
  'safety valve': { entityType: 'valve', discipline: 'valves' },
  'pressure safety valve': { entityType: 'valve', discipline: 'valves' },
  'pressure relief valve': { entityType: 'valve', discipline: 'valves' },
  'emergency shutdown valve': { entityType: 'valve', discipline: 'valves' },
  'shutdown valve': { entityType: 'valve', discipline: 'valves' },
  'blowdown valve': { entityType: 'valve', discipline: 'valves' },
  'check valve': { entityType: 'valve', discipline: 'valves' },
  'ball valve': { entityType: 'valve', discipline: 'valves' },
  'gate valve': { entityType: 'valve', discipline: 'valves' },
  'globe valve': { entityType: 'valve', discipline: 'valves' },
  'needle valve': { entityType: 'valve', discipline: 'valves' },
  'plug valve': { entityType: 'valve', discipline: 'valves' },
  'butterfly valve': { entityType: 'valve', discipline: 'valves' },
  'restriction orifice': { entityType: 'valve', discipline: 'valves' },
  'double block and bleed': { entityType: 'valve', discipline: 'valves' },
  'solenoid valve': { entityType: 'valve', discipline: 'valves' },
  'motor operated valve': { entityType: 'valve', discipline: 'valves' },
};

/**
 * Infer entityType and discipline from a type description string.
 */
function inferTypeFromDescription(typeDesc) {
  if (!typeDesc) return { entityType: 'unknown', discipline: null };
  const lower = typeDesc.toLowerCase().trim();

  // Try exact match first
  if (TYPE_INFERENCE_MAP[lower]) return TYPE_INFERENCE_MAP[lower];

  // Try partial match (e.g., "Part of G-2802" → check keywords)
  for (const [key, val] of Object.entries(TYPE_INFERENCE_MAP)) {
    if (lower.includes(key)) return val;
  }

  // Keyword-based fallback
  if (/valve/i.test(lower)) return { entityType: 'valve', discipline: 'valves' };
  if (/pump|vessel|tank|compressor|exchanger|separator|filter|skid|package|crane/i.test(lower)) {
    return { entityType: 'equipment', discipline: 'mechanical' };
  }
  if (/transmitter|indicator|gauge|switch|detector|element|sensor|controller/i.test(lower)) {
    return { entityType: 'instrument', discipline: 'instrumentation' };
  }
  if (/motor|generator|transformer|panel|switchboard|ups|battery/i.test(lower)) {
    return { entityType: 'equipment', discipline: 'electrical' };
  }

  return { entityType: 'unknown', discipline: null };
}

/**
 * Extract function code prefix from a tag string.
 * Strips suffixes (.A, .A-01, .04) and returns the alphabetic prefix.
 * @returns {{ prefix: string, digits: string } | null}
 */
function extractTagPrefix(tag) {
  if (!tag) return null;
  const cleaned = tag.toUpperCase().trim().replace(/\s+/g, '');
  // Strip suffix patterns: .A, .B2, .04, .A-01, /PT-xxx
  const stripped = cleaned.replace(/(\.[A-Z0-9]+(?:-\d{1,2})?)(\/.*)?$/, '');
  const match = stripped.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return null;
  return { prefix: match[1], digits: match[2] };
}

/**
 * Auto-generate a tag_pattern regex from sample tags for a given prefix.
 */
function generateTagPattern(prefix, sampleTags) {
  if (!sampleTags?.length) return null;

  // Analyze digit lengths
  const digitLengths = new Set();
  let hasDotSuffix = false;
  let hasDotDigitSuffix = false;
  let hasDashSuffix = false;

  for (const tag of sampleTags) {
    const cleaned = tag.toUpperCase().trim();
    const afterPrefix = cleaned.slice(prefix.length + 1); // Skip "PREFIX-"

    // Check for dot suffix
    if (/\.[A-Z](?:\d)?(?:-\d{1,2})?$/.test(afterPrefix)) hasDotSuffix = true;
    if (/\.\d{1,2}$/.test(afterPrefix)) hasDotDigitSuffix = true;
    if (/\.[A-Z]-\d{1,2}$/.test(afterPrefix)) hasDashSuffix = true;

    // Extract digit portion
    const digitMatch = afterPrefix.match(/^(\d+)/);
    if (digitMatch) digitLengths.add(digitMatch[1].length);
  }

  const minDigits = Math.min(...digitLengths);
  const maxDigits = Math.max(...digitLengths);
  const digitPart = minDigits === maxDigits ? `\\d{${minDigits}}` : `\\d{${minDigits},${maxDigits}}`;

  // Build suffix pattern
  let suffixPart = '';
  if (hasDotSuffix && hasDashSuffix) {
    suffixPart = '(?:\\.[A-Z](?:\\d)?(?:-\\d{1,2})?)?';
  } else if (hasDotDigitSuffix) {
    suffixPart = '(?:\\.\\d{1,2})?';
  } else if (hasDotSuffix) {
    suffixPart = '(?:\\.[A-Z](?:\\d)?)?';
  }

  return `^${prefix}-${digitPart}${suffixPart}$`;
}

/**
 * Detect tag dictionary entries from data files.
 * Enhanced: scans ALL columns in ALL sheets to find tags — no hardcoded column names.
 * Identifies tag columns by recognizing oil & gas tag patterns in cell values.
 *
 * @param {object} input - { dataFiles: Array<{fileName, sheetName, headers, rowCount, sampleRows, csvText}> }
 *                       OR legacy: { equipmentCsv, instrumentCsv, linesCsv }
 * @returns {{ entries: Array, lineInfo: object, stats: object, columnInsights: Array }}
 */
export function detectFromDataFiles(input) {
  // Support legacy 3-CSV format for backward compatibility
  if (input.equipmentCsv || input.instrumentCsv || input.linesCsv) {
    return detectFromDataFilesLegacy(input);
  }

  const { dataFiles } = input;
  if (!dataFiles?.length) return { entries: [], lineInfo: { fluidCodes: {}, pipeClasses: [], sizes: [] }, stats: { totalTagsParsed: 0, uniquePrefixes: 0, totalSheetsAnalyzed: 0 }, columnInsights: [] };

  const prefixMap = new Map();
  const lineInfo = { fluidCodes: {}, pipeClasses: new Set(), sizes: new Set(), lineFormat: null };
  const columnInsights = [];

  for (const df of dataFiles) {
    const csvLines = (df.csvText || '').split('\n').filter(l => l.trim());
    if (csvLines.length < 2) continue;

    const headers = parseCsvLine(csvLines[0]);
    const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));

    // ── Scan ALL columns to identify which contain tags ──
    const tagColumnIdxs = [];
    const descriptionColumnIdxs = [];
    const contextColumnIdxs = [];

    // Score each column by checking sample values for tag patterns
    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      let tagHits = 0;
      let lineHits = 0;
      const sampleSize = Math.min(csvLines.length - 1, 20);

      for (let rowIdx = 1; rowIdx <= sampleSize; rowIdx++) {
        const values = parseCsvLine(csvLines[rowIdx]);
        const val = (values[colIdx] || '').trim();
        if (!val) continue;

        // Check if value looks like a tag (LETTERS-DIGITS pattern)
        if (extractTagPrefix(val)) tagHits++;
        // Check for line number patterns
        if (/^\d{1,2}["-].*-[A-Z]-\d/.test(val) || /^[A-Z]{2,5}-\d{1,2}["-]/.test(val)) lineHits++;
      }

      const tagScore = tagHits / sampleSize;
      const headerNorm = normalizedHeaders[colIdx];

      // Identify column role
      if (tagScore >= 0.3 || /^(tag|tag_?number|tag_?code|tag_?id|device|equipment_?tag|instrument_?tag)$/.test(headerNorm)) {
        tagColumnIdxs.push(colIdx);
      } else if (/^(description|desc|type|equipment_?type|instrument_?type|service_?desc|function)$/.test(headerNorm)) {
        descriptionColumnIdxs.push(colIdx);
      } else if (/^(spec|specification|material|location|area|system|size|nominal_?size|pipe_?class|fluid|fluid_?code|service|rating|class)$/.test(headerNorm)) {
        contextColumnIdxs.push(colIdx);
      } else if (lineHits > 0) {
        tagColumnIdxs.push(colIdx);
      }
    }

    // Record column insights for AI
    columnInsights.push({
      fileName: df.fileName,
      sheetName: df.sheetName,
      tagColumn: tagColumnIdxs.map(i => headers[i]).join(', ') || '(none detected)',
      descriptionColumns: descriptionColumnIdxs.map(i => headers[i]),
      contextColumns: contextColumnIdxs.map(i => headers[i]),
    });

    // ── Extract tags from identified tag columns ──
    for (const tagIdx of tagColumnIdxs) {
      // Find best description column for this tag column
      const descIdx = descriptionColumnIdxs[0] ?? -1;

      for (let rowIdx = 1; rowIdx < csvLines.length; rowIdx++) {
        const values = parseCsvLine(csvLines[rowIdx]);
        const tag = (values[tagIdx] || '').trim();
        const typeDesc = descIdx >= 0 ? (values[descIdx] || '').trim() : '';

        // Collect context from all context columns
        const contextParts = [];
        for (const ctxIdx of contextColumnIdxs) {
          const v = (values[ctxIdx] || '').trim();
          if (v) contextParts.push(`${headers[ctxIdx]}: ${v}`);
        }

        const extracted = extractTagPrefix(tag);
        if (!extracted) {
          // Check for line number patterns
          if (/^\d{1,2}["-]/.test(tag) && tag.includes('-') && tag.split('-').length >= 4) {
            // Line number — extract fluid code if present
            const parts = tag.replace(/"/g, '').split('-');
            if (parts.length >= 3) {
              const fluidCode = parts[1];
              if (/^[A-Z]{1,4}$/.test(fluidCode)) {
                const service = typeDesc || fluidCode;
                if (!lineInfo.fluidCodes[fluidCode]) {
                  lineInfo.fluidCodes[fluidCode] = service;
                }
              }
            }
            // Try to extract pipe class
            if (parts.length >= 6) {
              const pipeClass = parts[parts.length - 2];
              if (/^[A-Z]\d{2}/.test(pipeClass)) lineInfo.pipeClasses.add(pipeClass);
            }
            if (!lineInfo.lineFormat && parts.length >= 5) {
              lineInfo.lineFormat = 'size"-fluid-area-system-seq-class-insulation';
            }
          }
          continue;
        }

        const { prefix } = extracted;
        const inferred = inferTypeFromDescription(typeDesc);

        if (!prefixMap.has(prefix)) {
          prefixMap.set(prefix, {
            entityType: inferred.entityType,
            discipline: inferred.discipline,
            description: typeDesc || null,
            sampleTags: [],
            count: 0,
          });
        }
        const entry = prefixMap.get(prefix);
        entry.count++;
        if (entry.sampleTags.length < 5 && !entry.sampleTags.includes(tag)) {
          entry.sampleTags.push(tag);
        }
        if (typeDesc && (!entry.description || entry.description === 'unknown')) {
          entry.description = typeDesc;
          const betterInferred = inferTypeFromDescription(typeDesc);
          if (betterInferred.entityType !== 'unknown') {
            entry.entityType = betterInferred.entityType;
            entry.discipline = betterInferred.discipline;
          }
        }
      }
    }
  }

  // Build result entries
  const entries = [];
  for (const [prefix, data] of prefixMap) {
    const tagPattern = generateTagPattern(prefix, data.sampleTags);
    entries.push({
      functionCode: prefix,
      entityType: data.entityType,
      discipline: data.discipline,
      description: data.description,
      tagPattern,
      sampleTags: data.sampleTags,
      count: data.count,
      confidence: data.entityType !== 'unknown' ? 0.9 : 0.5,
    });
  }

  entries.sort((a, b) => b.count - a.count);

  lineInfo.pipeClasses = [...lineInfo.pipeClasses].sort();
  lineInfo.sizes = [...lineInfo.sizes].sort();

  return {
    entries,
    lineInfo,
    columnInsights,
    stats: {
      totalTagsParsed: entries.reduce((sum, e) => sum + e.count, 0),
      uniquePrefixes: entries.length,
      fluidCodes: Object.keys(lineInfo.fluidCodes).length,
      pipeClasses: lineInfo.pipeClasses.length,
      totalSheetsAnalyzed: dataFiles.length,
    },
  };
}

/**
 * Legacy 3-CSV format support for backward compatibility.
 */
function detectFromDataFilesLegacy({ equipmentCsv, instrumentCsv, linesCsv }) {
  const dataFiles = [];
  if (equipmentCsv) {
    const lines = equipmentCsv.split('\n').filter(l => l.trim());
    dataFiles.push({ fileName: 'equipment.csv', sheetName: 'Equipment', headers: lines[0] ? parseCsvLine(lines[0]) : [], rowCount: lines.length - 1, csvText: equipmentCsv });
  }
  if (instrumentCsv) {
    const lines = instrumentCsv.split('\n').filter(l => l.trim());
    dataFiles.push({ fileName: 'instruments.csv', sheetName: 'Instruments', headers: lines[0] ? parseCsvLine(lines[0]) : [], rowCount: lines.length - 1, csvText: instrumentCsv });
  }
  if (linesCsv) {
    const lines = linesCsv.split('\n').filter(l => l.trim());
    dataFiles.push({ fileName: 'lines.csv', sheetName: 'Lines', headers: lines[0] ? parseCsvLine(lines[0]) : [], rowCount: lines.length - 1, csvText: linesCsv });
  }
  return detectFromDataFiles({ dataFiles });
}

// ── CSV helpers ─────────────────────────────────────────────

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
