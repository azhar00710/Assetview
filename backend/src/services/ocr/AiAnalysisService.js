/**
 * AI Analysis Service — Core orchestrator.
 * Gathers OCR data → builds Claude prompt → parses response → stores draft entities.
 */

import { SYSTEM_PROMPT, ANALYSIS_PROMPT_TEMPLATE } from './AiPromptTemplates.js';
import { getDictionary } from './TagDictionaryService.js';

const DEFAULT_AI_MODEL = 'claude-sonnet-4-20250514';
const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Resolve AI credentials from DB (platform → global) or env var fallback.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} platformId
 * @returns {Promise<{ apiKey: string, model: string }>}
 */
export async function resolveAiCredentials(prisma, platformId) {
  // 1. Platform-specific config
  if (platformId) {
    try {
      const configs = await prisma.$queryRaw`
        SELECT ai_credentials_ref, ai_model_preference
        FROM storage_config
        WHERE scope_type = 'platform' AND scope_id = ${platformId}::uuid AND is_active = true
      `;
      const config = configs[0];

      if (config?.ai_credentials_ref) {
        return {
          apiKey: config.ai_credentials_ref,
          model: config.ai_model_preference || DEFAULT_AI_MODEL,
        };
      }
    } catch (err) {
      // Column may not exist yet — fall through to env var
      console.warn('resolveAiCredentials platform lookup failed:', err.message);
    }
  }

  // 2. Global config
  try {
    const globalConfigs = await prisma.$queryRaw`
      SELECT ai_credentials_ref, ai_model_preference
      FROM storage_config
      WHERE scope_type = 'global' AND is_active = true
    `;
    const globalConfig = globalConfigs[0];

    if (globalConfig?.ai_credentials_ref) {
      return {
        apiKey: globalConfig.ai_credentials_ref,
        model: globalConfig.ai_model_preference || DEFAULT_AI_MODEL,
      };
    }
  } catch (err) {
    // Column may not exist yet — fall through to env var
    console.warn('resolveAiCredentials global lookup failed:', err.message);
  }

  // 3. Env var fallback
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: DEFAULT_AI_MODEL,
    };
  }

  throw new Error('No AI credentials configured. Set up Claude API key via OCR Pipeline settings or ANTHROPIC_API_KEY env var.');
}

/**
 * Run AI analysis on a completed OCR batch.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} batchId
 * @param {object} [options]
 * @param {string} [options.analysisType] - 'full' | 'summary_only' | 'entity_generation'
 * @param {string} [options.apiKey] - Anthropic API key (falls back to ANTHROPIC_API_KEY env)
 * @returns {Promise<{ jobId: string }>}
 */
export async function runAiAnalysis(prisma, batchId, options = {}) {
  const analysisType = options.analysisType || 'full';

  // 1. Validate batch exists and is completed
  const [batch] = await prisma.$queryRaw`
    SELECT b.id, b.platform_id, b.status, b.batch_name,
           p.code AS platform_code, p.name AS platform_name
    FROM ocr_batch b
    JOIN platform p ON p.id = b.platform_id
    WHERE b.id = ${batchId}::uuid
  `;

  if (!batch) throw new Error(`Batch ${batchId} not found`);
  if (batch.status !== 'completed' && batch.status !== 'partial') {
    throw new Error(`Batch must be completed/partial to analyze (current: ${batch.status})`);
  }

  // Check no analysis already running
  const [running] = await prisma.$queryRaw`
    SELECT id FROM ai_analysis_job
    WHERE batch_id = ${batchId}::uuid AND status IN ('pending', 'processing')
    LIMIT 1
  `;
  if (running) throw new Error(`Analysis already in progress (job ${running.id})`);

  // 2. Create analysis job
  const [job] = await prisma.$queryRaw`
    INSERT INTO ai_analysis_job (batch_id, platform_id, status, analysis_type, ai_model, started_at, created_by)
    VALUES (${batchId}::uuid, ${batch.platform_id}::uuid, 'processing', ${analysisType}, ${DEFAULT_AI_MODEL}, NOW(), 'system')
    RETURNING id
  `;
  const jobId = job.id;

  // Update batch
  await prisma.$queryRaw`
    UPDATE ocr_batch SET ai_analysis_status = 'processing', ai_analysis_job_id = ${jobId}::uuid
    WHERE id = ${batchId}::uuid
  `;

  try {
    // 3. Gather data
    const batchData = await gatherBatchData(prisma, batchId);
    const existingEntities = await gatherExistingEntities(prisma, batch.platform_id);

    // 3b. Load client tag dictionary (if configured)
    let tagDictionary = [];
    try {
      tagDictionary = await getDictionary(prisma, batch.platform_id);
    } catch {
      // Dictionary is optional
    }

    // 4. Build prompt
    const prompt = buildAnalysisPrompt(batchData, existingEntities, {
      platformCode: batch.platform_code,
      platformName: batch.platform_name,
      tagDictionary,
    });

    // 5. Call Claude API
    const resolved = options.apiKey
      ? { apiKey: options.apiKey, model: DEFAULT_AI_MODEL }
      : await resolveAiCredentials(prisma, batch.platform_id);

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: resolved.apiKey });

    const response = await client.messages.create({
      model: resolved.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

    // 6. Parse response
    const parsed = parseAiResponse(responseText);

    // 7. Store prompt template used
    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET
        prompt_template = ${prompt.substring(0, 5000)},
        input_token_count = ${inputTokens},
        output_token_count = ${outputTokens},
        raw_response = ${JSON.stringify(parsed)}::jsonb,
        summary_text = ${parsed.summary || ''},
        relationships = ${JSON.stringify(parsed.relationships || [])}::jsonb
      WHERE id = ${jobId}::uuid
    `;

    // 8. Store generated entities
    await storeAnalysisResults(prisma, jobId, parsed, batch.platform_id, batchId, batchData);

    // 9. Mark completed
    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET status = 'completed', completed_at = NOW()
      WHERE id = ${jobId}::uuid
    `;
    await prisma.$queryRaw`
      UPDATE ocr_batch SET ai_analysis_status = 'completed'
      WHERE id = ${batchId}::uuid
    `;

    return { jobId };
  } catch (err) {
    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET status = 'failed', error_message = ${err.message}, completed_at = NOW()
      WHERE id = ${jobId}::uuid
    `;
    await prisma.$queryRaw`
      UPDATE ocr_batch SET ai_analysis_status = 'failed'
      WHERE id = ${batchId}::uuid
    `;
    throw err;
  }
}

/**
 * Gather all OCR extractions for a batch grouped by P&ID.
 */
async function gatherBatchData(prisma, batchId) {
  const files = await prisma.$queryRaw`
    SELECT bf.pnid_id, bf.drawing_number, bf.filename
    FROM ocr_batch_file bf
    WHERE bf.batch_id = ${batchId}::uuid AND bf.status = 'completed' AND bf.pnid_id IS NOT NULL
    ORDER BY bf.drawing_number
  `;

  const pnidIds = files.filter(f => f.pnid_id).map(f => f.pnid_id);
  if (pnidIds.length === 0) return { files, extractions: [], byPnid: {} };

  const extractions = await prisma.$queryRaw`
    SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.tag_type, oe.confidence,
           oe.matched_entity_id, oe.match_confidence, oe.match_method, oe.status
    FROM ocr_extraction oe
    WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
    ORDER BY oe.pnid_id, oe.tag_type, oe.extracted_text
  `;

  // Group by pnid
  const byPnid = {};
  for (const ext of extractions) {
    const drawingNum = files.find(f => f.pnid_id === ext.pnid_id)?.drawing_number || 'Unknown';
    if (!byPnid[drawingNum]) byPnid[drawingNum] = [];
    byPnid[drawingNum].push(ext);
  }

  return { files, extractions, byPnid };
}

/**
 * Gather existing entities for the platform.
 */
async function gatherExistingEntities(prisma, platformId) {
  const systems = await prisma.system.findMany({
    where: { platform_id: platformId, deleted_at: null },
    select: { id: true, code: true, name: true, sys_type: true },
  });

  const systemIds = systems.map(s => s.id);

  const [lines, equipment, instruments] = await Promise.all([
    prisma.line.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, line_number: true, service: true, system_id: true },
    }),
    prisma.equipment.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, tag: true, equipment_type: true, system_id: true },
    }),
    prisma.instrument.findMany({
      where: { system_id: { in: systemIds }, deleted_at: null },
      select: { id: true, tag: true, instrument_type: true, system_id: true },
    }),
  ]);

  return { systems, lines, equipment, instruments };
}

/**
 * Build the analysis prompt from gathered data.
 */
function buildAnalysisPrompt(batchData, existingEntities, context) {
  let prompt = ANALYSIS_PROMPT_TEMPLATE;

  prompt = prompt.replace('{{platformCode}}', context.platformCode || '');
  prompt = prompt.replace('{{platformName}}', context.platformName || '');

  // Existing entities
  prompt = prompt.replace('{{existingSystems}}',
    existingEntities.systems.length > 0
      ? existingEntities.systems.map(s => `- ${s.code} (${s.name}) [${s.sys_type}]`).join('\n')
      : '(none)'
  );

  prompt = prompt.replace('{{existingLines}}',
    existingEntities.lines.length > 0
      ? existingEntities.lines.map(l => `- ${l.line_number} [${l.service || ''}]`).join('\n')
      : '(none)'
  );

  prompt = prompt.replace('{{existingEquipment}}',
    existingEntities.equipment.length > 0
      ? existingEntities.equipment.map(e => `- ${e.tag} [${e.equipment_type || ''}]`).join('\n')
      : '(none)'
  );

  prompt = prompt.replace('{{existingInstruments}}',
    existingEntities.instruments.length > 0
      ? existingEntities.instruments.map(i => `- ${i.tag} [${i.instrument_type || ''}]`).join('\n')
      : '(none)'
  );

  // Tag dictionary (client-specific classification rules)
  const dictEntries = context.tagDictionary || [];
  if (dictEntries.length > 0) {
    const dictLines = dictEntries.map(d =>
      `- ${d.function_code} → ${d.entity_type} (${d.discipline || 'general'}) — ${d.description || ''}`
    );
    prompt = prompt.replace('{{tagDictionary}}',
      `The following ${dictEntries.length} client-specific function codes are configured. ` +
      `Use these mappings when classifying tags — they take priority over generic ISA rules.\n` +
      dictLines.join('\n')
    );
  } else {
    prompt = prompt.replace('{{tagDictionary}}', '(No client-specific dictionary — using standard ISA S5.1 conventions)');
  }

  // OCR extractions grouped by P&ID
  const ocrSections = [];
  for (const [drawingNumber, exts] of Object.entries(batchData.byPnid)) {
    const lines = exts.map(e => {
      const matched = e.matched_entity_id ? `[MATCHED → DB]` : '[UNMATCHED]';
      return `  ${e.tag_type}: ${e.extracted_text} (conf: ${Number(e.confidence).toFixed(2)}) ${matched}`;
    });
    ocrSections.push(`### P&ID: ${drawingNumber}\n${lines.join('\n')}`);
  }
  prompt = prompt.replace('{{ocrExtractions}}', ocrSections.join('\n\n') || '(no extractions)');

  // Unmatched tags specifically
  const unmatched = batchData.extractions
    .filter(e => !e.matched_entity_id)
    .map(e => `- ${e.extracted_text} (type: ${e.tag_type}, conf: ${Number(e.confidence).toFixed(2)})`)
    .join('\n');
  prompt = prompt.replace('{{unmatchedTags}}', unmatched || '(all tags matched)');

  return prompt;
}

/**
 * Parse Claude's JSON response.
 */
function parseAiResponse(responseText) {
  // Try to extract JSON from the response
  let jsonStr = responseText.trim();

  // Remove markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) jsonStr = fenceMatch[1];

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Try to find JSON object in the text
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch (_) {
        // fall through
      }
    }
    throw new Error(`Failed to parse AI response as JSON: ${err.message}`);
  }
}

/**
 * Store parsed AI results into staging tables.
 */
async function storeAnalysisResults(prisma, jobId, parsed, platformId, batchId, batchData) {
  // Map drawing numbers to pnid IDs
  const drawingToPnidId = {};
  for (const f of batchData.files) {
    if (f.drawing_number && f.pnid_id) {
      drawingToPnidId[f.drawing_number] = f.pnid_id;
    }
  }

  // Helper to resolve pnid IDs from drawing numbers
  function resolvePnidIds(drawingNumbers) {
    if (!drawingNumbers?.length) return null;
    const ids = drawingNumbers
      .map(d => drawingToPnidId[d])
      .filter(Boolean);
    return ids.length > 0 ? ids : null;
  }

  // Helper to find source extractions for a tag
  function findSourceExtractions(tag) {
    return batchData.extractions
      .filter(e => e.extracted_text === tag)
      .map(e => e.id);
  }

  // Store suggested systems
  for (const sys of (parsed.suggestedSystems || [])) {
    const pnidIds = resolvePnidIds(sys.foundOnPnids);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids,
        confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'system',
        ${sys.code || sys.name}, ${JSON.stringify(sys)}::jsonb, ${pnidIds || []}::uuid[],
        ${sys.confidence || 0.5},
        ${(sys.confidence || 0) >= HIGH_CONFIDENCE_THRESHOLD ? 'draft' : 'draft'}
      )
    `;
  }

  // Store lines
  for (const line of (parsed.lineList || [])) {
    if (!line.isNew) continue;
    const pnidIds = resolvePnidIds(line.foundOnPnids);
    const sourceExts = findSourceExtractions(line.lineNumber);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions,
        confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'line',
        ${line.lineNumber}, ${JSON.stringify(line)}::jsonb,
        ${pnidIds || []}::uuid[], ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${line.confidence || 0.5},
        'draft'
      )
    `;
  }

  // Store equipment
  for (const eq of (parsed.equipmentList || [])) {
    if (!eq.isNew) continue;
    const pnidIds = resolvePnidIds(eq.foundOnPnids);
    const sourceExts = findSourceExtractions(eq.tag);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions,
        confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'equipment',
        ${eq.tag}, ${JSON.stringify(eq)}::jsonb,
        ${pnidIds || []}::uuid[], ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${eq.confidence || 0.5},
        'draft'
      )
    `;
  }

  // Store instruments
  for (const inst of (parsed.instrumentList || [])) {
    if (!inst.isNew) continue;
    const pnidIds = resolvePnidIds(inst.foundOnPnids);
    const sourceExts = findSourceExtractions(inst.tag);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions,
        confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'instrument',
        ${inst.tag}, ${JSON.stringify(inst)}::jsonb,
        ${pnidIds || []}::uuid[], ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${inst.confidence || 0.5},
        'draft'
      )
    `;
  }

  // Store relationships
  for (const rel of (parsed.relationships || [])) {
    const pnidId = drawingToPnidId[rel.pnid] || null;
    const pnidIdSql = pnidId ? `${pnidId}` : null;
    await prisma.$queryRaw`
      INSERT INTO ai_relationship (
        analysis_job_id, from_entity_type, from_entity_tag,
        to_entity_type, to_entity_tag, relationship_type,
        pnid_id, confidence
      ) VALUES (
        ${jobId}::uuid, ${rel.fromType}, ${rel.fromTag},
        ${rel.toType}, ${rel.toTag}, ${rel.type},
        ${pnidIdSql}::uuid, ${rel.confidence || 0.5}
      )
    `;
  }
}

/**
 * Approve a single AI-generated entity — creates the real entity in the database.
 */
export async function approveAiEntity(prisma, entityId) {
  const [entity] = await prisma.$queryRaw`
    SELECT * FROM ai_generated_entity WHERE id = ${entityId}::uuid AND status = 'draft'
  `;
  if (!entity) throw new Error('Entity not found or not in draft status');

  const data = typeof entity.suggested_data === 'string'
    ? JSON.parse(entity.suggested_data)
    : entity.suggested_data;

  let mergedEntityId = null;

  if (entity.entity_type === 'system') {
    // Find first available system slot for this platform
    const [newSystem] = await prisma.$queryRaw`
      INSERT INTO system (platform_id, code, name, sys_type)
      VALUES (${entity.platform_id}::uuid, ${data.code || entity.suggested_tag}, ${data.name || entity.suggested_tag}, ${data.type || 'process'})
      RETURNING id
    `;
    mergedEntityId = newSystem.id;

    // Link to source P&IDs
    if (entity.source_pnid_ids?.length) {
      for (const pnidId of entity.source_pnid_ids) {
        try {
          await prisma.$queryRaw`
            INSERT INTO pnid_system (pnid_id, system_id, is_primary)
            VALUES (${pnidId}::uuid, ${mergedEntityId}::uuid, false)
            ON CONFLICT DO NOTHING
          `;
        } catch (_) { /* skip conflicts */ }
      }
    }
  } else if (entity.entity_type === 'line') {
    // Find system by code or use first system on platform
    const systemId = await resolveSystemId(prisma, entity.platform_id, data.systemCode);

    const [newLine] = await prisma.$queryRaw`
      INSERT INTO line (system_id, line_number, service, nominal_size, pipe_class, fluid_code, from_connection, to_connection)
      VALUES (
        ${systemId}::uuid, ${data.lineNumber || entity.suggested_tag},
        ${data.service || null}, ${data.nominalSize || null},
        ${data.pipeClass || null}, ${data.fluidCode || null},
        ${data.fromConnection || null}, ${data.toConnection || null}
      )
      RETURNING id
    `;
    mergedEntityId = newLine.id;

    // Link to source P&IDs
    if (entity.source_pnid_ids?.length) {
      for (const pnidId of entity.source_pnid_ids) {
        try {
          await prisma.$queryRaw`
            INSERT INTO pnid_line (pnid_id, line_id)
            VALUES (${pnidId}::uuid, ${mergedEntityId}::uuid)
            ON CONFLICT DO NOTHING
          `;
        } catch (_) { /* skip conflicts */ }
      }
    }
  } else if (entity.entity_type === 'equipment') {
    const systemId = await resolveSystemId(prisma, entity.platform_id, data.systemCode);

    const [newEquip] = await prisma.$queryRaw`
      INSERT INTO equipment (system_id, tag, equipment_type, description)
      VALUES (${systemId}::uuid, ${data.tag || entity.suggested_tag}, ${data.equipmentType || null}, ${data.description || null})
      RETURNING id
    `;
    mergedEntityId = newEquip.id;

    // Link to source P&IDs
    if (entity.source_pnid_ids?.length) {
      for (const pnidId of entity.source_pnid_ids) {
        try {
          await prisma.$queryRaw`
            INSERT INTO pnid_equipment (pnid_id, equipment_id)
            VALUES (${pnidId}::uuid, ${mergedEntityId}::uuid)
            ON CONFLICT DO NOTHING
          `;
        } catch (_) { /* skip conflicts */ }
      }
    }
  } else if (entity.entity_type === 'instrument') {
    const systemId = await resolveSystemId(prisma, entity.platform_id, data.systemCode);

    const [newInst] = await prisma.$queryRaw`
      INSERT INTO instrument (system_id, tag, instrument_type, description)
      VALUES (${systemId}::uuid, ${data.tag || entity.suggested_tag}, ${data.instrumentType || 'other'}, ${data.description || null})
      RETURNING id
    `;
    mergedEntityId = newInst.id;

    if (entity.source_pnid_ids?.length) {
      for (const pnidId of entity.source_pnid_ids) {
        try {
          await prisma.$queryRaw`
            INSERT INTO pnid_instrument (pnid_id, instrument_id)
            VALUES (${pnidId}::uuid, ${mergedEntityId}::uuid)
            ON CONFLICT DO NOTHING
          `;
        } catch (_) { /* skip conflicts */ }
      }
    }
  }

  // Update staging entity
  await prisma.$queryRaw`
    UPDATE ai_generated_entity SET
      status = 'approved',
      merged_entity_id = ${mergedEntityId}::uuid,
      reviewed_by = 'admin',
      reviewed_at = NOW()
    WHERE id = ${entityId}::uuid
  `;

  return { mergedEntityId };
}

/**
 * Resolve system ID from a system code, or fall back to first system on the platform.
 */
async function resolveSystemId(prisma, platformId, systemCode) {
  if (systemCode) {
    const found = await prisma.system.findFirst({
      where: { platform_id: platformId, code: systemCode, deleted_at: null },
      select: { id: true },
    });
    if (found) return found.id;
  }

  // Fall back to first system
  const fallback = await prisma.system.findFirst({
    where: { platform_id: platformId, deleted_at: null },
    orderBy: { code: 'asc' },
    select: { id: true },
  });

  if (!fallback) throw new Error(`No systems found for platform ${platformId}`);
  return fallback.id;
}
