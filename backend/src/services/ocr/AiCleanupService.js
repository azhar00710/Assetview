/**
 * AI Cleanup Service — runs immediately after OCR to filter noise and classify tags.
 * This is the core of the reworked pipeline: OCR → AI Cleanup → Human Review → Import.
 */

import { CLEANUP_SYSTEM_PROMPT, CLEANUP_PROMPT_TEMPLATE } from './AiPromptTemplates.js';
import { resolveAiCredentials } from './AiAnalysisService.js';
import { getDictionary } from './TagDictionaryService.js';
import { getLearnedPatterns, formatLearnedPatternsForPrompt } from './OcrKnowledgeService.js';

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_NOISE_TERMS = [
  'ISSUED FOR',
  'REV',
  'DATE',
  'NOTES',
  'SCALE',
  'DRAWN BY',
  'CHECKED BY',
  'APPROVED BY',
];

function boolFlag(v, fallback = false) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * Run AI cleanup on a completed OCR batch.
 * Filters noise, classifies real tags, matches entities, detects revision changes.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} batchId
 * @param {string} platformId
 * @returns {Promise<{ jobId: string, summary: object }>}
 */
export async function runAiCleanup(prisma, batchId, platformId) {
  // 1. Resolve AI credentials
  const { apiKey, model } = await resolveAiCredentials(prisma, platformId);

  // 2. Get platform info
  const [platform] = await prisma.$queryRaw`
    SELECT code, name FROM platform WHERE id = ${platformId}::uuid
  `;
  if (!platform) throw new Error(`Platform ${platformId} not found`);

  // 3. Create analysis job for tracking
  const [job] = await prisma.$queryRaw`
    INSERT INTO ai_analysis_job (batch_id, platform_id, status, analysis_type, ai_model, started_at, created_by)
    VALUES (${batchId}::uuid, ${platformId}::uuid, 'processing', 'cleanup', ${model}, NOW(), 'system')
    RETURNING id
  `;
  const jobId = job.id;

  await prisma.$queryRaw`
    UPDATE ocr_batch SET ai_cleanup_status = 'processing', ai_cleanup_job_id = ${jobId}::uuid
    WHERE id = ${batchId}::uuid
  `;

  try {
    // 4. Gather all inputs
    const rawExtractions = await gatherRawExtractions(prisma, batchId);
    const existingEntities = await gatherExistingEntities(prisma, platformId);
    const previouslyApproved = await gatherPreviouslyApproved(prisma, rawExtractions.pnidIds);
    let tagDictionary = [];
    try { tagDictionary = await getDictionary(prisma, platformId); } catch { /* optional */ }
    let learnedPatterns = [];
    try { learnedPatterns = await getLearnedPatterns(prisma, platformId); } catch { /* optional */ }
    const zoneProfiles = await getZoneProfiles(prisma, platformId);
    const prefilterEnabled = boolFlag(process.env.OCR_ENABLE_ZONE_NOISE_FILTER, false);
    const prefilterResult = prefilterEnabled
      ? applyDeterministicPrefilters(rawExtractions.extractions, zoneProfiles)
      : { kept: rawExtractions.extractions, filteredNoise: [] };
    rawExtractions.extractions = prefilterResult.kept;
    rawExtractions.prefilteredNoise = prefilterResult.filteredNoise;

    // 5. Build prompt
    const prompt = buildCleanupPrompt(rawExtractions, existingEntities, previouslyApproved, {
      platformCode: platform.code,
      platformName: platform.name,
      tagDictionary,
      learnedPatterns,
      zoneProfiles,
    });

    // 6. Call Claude API
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: 32768,
      system: CLEANUP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

    // 7. Parse response
    const parsed = parseCleanupResponse(responseText);

    // 8. Store raw response in job
    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET
        prompt_template = ${prompt.substring(0, 5000)},
        input_token_count = ${inputTokens},
        output_token_count = ${outputTokens},
        raw_response = ${JSON.stringify(parsed)}::jsonb,
        summary_text = ${parsed.summary || ''}
      WHERE id = ${jobId}::uuid
    `;

    // 9. Apply classifications to ocr_extraction table
    const classificationStats = await applyClassifications(prisma, parsed, rawExtractions);

    // 10. Store draft entities
    await storeDraftEntities(prisma, jobId, batchId, platformId, parsed, rawExtractions);

    // 11. Build and store reconciliation summary
    const reconciliation = buildReconciliationSummary(parsed);
    await prisma.$queryRaw`
      UPDATE ocr_batch SET
        ai_cleanup_status = 'completed',
        reconciliation_summary = ${JSON.stringify(reconciliation)}::jsonb
      WHERE id = ${batchId}::uuid
    `;

    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET status = 'completed', completed_at = NOW()
      WHERE id = ${jobId}::uuid
    `;

    return { jobId, summary: reconciliation, stats: classificationStats };
  } catch (err) {
    await prisma.$queryRaw`
      UPDATE ai_analysis_job SET status = 'failed', error_message = ${err.message}, completed_at = NOW()
      WHERE id = ${jobId}::uuid
    `;
    await prisma.$queryRaw`
      UPDATE ocr_batch SET ai_cleanup_status = 'failed'
      WHERE id = ${batchId}::uuid
    `;
    throw err;
  }
}

// ═══ DATA GATHERING ═══════════════════════════════════════════════════════════

async function gatherRawExtractions(prisma, batchId) {
  const files = await prisma.$queryRaw`
    SELECT bf.pnid_id, bf.drawing_number, bf.filename
    FROM ocr_batch_file bf
    WHERE bf.batch_id = ${batchId}::uuid AND bf.status = 'completed' AND bf.pnid_id IS NOT NULL
    ORDER BY bf.drawing_number
  `;

  const pnidIds = files.filter(f => f.pnid_id).map(f => f.pnid_id);
  if (pnidIds.length === 0) return { files, extractions: [], byPnid: {}, pnidIds: [], rawFullText: {} };

  const extractions = await prisma.$queryRaw`
    SELECT oe.id, oe.pnid_id, oe.extracted_text, oe.tag_type, oe.confidence,
           oe.matched_entity_id, oe.match_confidence, oe.match_method, oe.status,
           oe.bbox_x_pct, oe.bbox_y_pct, oe.bbox_w_pct, oe.bbox_h_pct
    FROM ocr_extraction oe
    WHERE oe.pnid_id = ANY(${pnidIds}::uuid[])
    ORDER BY oe.pnid_id, oe.extracted_text
  `;

  // Also fetch raw OCR full text from pnid records — this contains ALL text Vision extracted,
  // including candidates that the regex classifier dropped. Critical for AI to find missed tags.
  const rawFullText = {};
  try {
    const pnidRawData = await prisma.$queryRaw`
      SELECT p.id, p.drawing_number, p.ocr_raw_data
      FROM pnid p
      WHERE p.id = ANY(${pnidIds}::uuid[]) AND p.ocr_raw_data IS NOT NULL
    `;
    for (const p of pnidRawData) {
      if (p.ocr_raw_data?.fullText) {
        const drawingNum = p.drawing_number || files.find(f => f.pnid_id === p.id)?.drawing_number || 'Unknown';
        rawFullText[drawingNum] = p.ocr_raw_data.fullText;
      }
    }
  } catch {
    // Non-critical — raw full text is a bonus for AI
  }

  // Group by drawing number
  const byPnid = {};
  const drawingToPnidId = {};
  for (const f of files) {
    if (f.drawing_number && f.pnid_id) {
      drawingToPnidId[f.drawing_number] = f.pnid_id;
    }
  }

  for (const ext of extractions) {
    const drawingNum = files.find(f => f.pnid_id === ext.pnid_id)?.drawing_number || 'Unknown';
    if (!byPnid[drawingNum]) byPnid[drawingNum] = [];
    byPnid[drawingNum].push(ext);
  }

  return { files, extractions, byPnid, pnidIds, drawingToPnidId, rawFullText };
}

async function gatherExistingEntities(prisma, platformId) {
  const systems = await prisma.system.findMany({
    where: { platform_id: platformId, deleted_at: null },
    select: { id: true, code: true, name: true, sys_type: true },
  });

  const systemIds = systems.map(s => s.id);
  if (systemIds.length === 0) return { systems: [], lines: [], equipment: [], instruments: [] };

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

async function getZoneProfiles(prisma, platformId) {
  try {
    return await prisma.$queryRaw`
      SELECT zone_name, x_pct, y_pct, w_pct, h_pct, noise_mode
      FROM ocr_zone_profile
      WHERE platform_id = ${platformId}::uuid AND is_active = true
      ORDER BY zone_name
    `;
  } catch {
    // Table may not exist before migration
    return [];
  }
}

function extractionCenter(ext) {
  const x = Number(ext.bbox_x_pct || 0);
  const y = Number(ext.bbox_y_pct || 0);
  const w = Number(ext.bbox_w_pct || 0);
  const h = Number(ext.bbox_h_pct || 0);
  return { x: x + (w / 2), y: y + (h / 2) };
}

function isInsideZone(ext, zone) {
  const c = extractionCenter(ext);
  const zx = Number(zone.x_pct || 0);
  const zy = Number(zone.y_pct || 0);
  const zw = Number(zone.w_pct || 0);
  const zh = Number(zone.h_pct || 0);
  return c.x >= zx && c.x <= (zx + zw) && c.y >= zy && c.y <= (zy + zh);
}

function applyDeterministicPrefilters(extractions, zoneProfiles = []) {
  const kept = [];
  const filteredNoise = [];
  const noiseTerms = DEFAULT_NOISE_TERMS.map(s => s.toUpperCase());
  const zones = zoneProfiles || [];

  for (const ext of extractions) {
    const text = String(ext.extracted_text || '').toUpperCase();
    let reason = null;

    if (noiseTerms.some(t => text.includes(t))) {
      reason = 'lexical_noise_term';
    } else {
      const zoneHit = zones.find(z => String(z.noise_mode || '').toLowerCase() === 'exclude' && isInsideZone(ext, z));
      if (zoneHit) reason = `zone_exclude:${zoneHit.zone_name}`;
    }

    if (reason) {
      filteredNoise.push({
        id: ext.id,
        text: ext.extracted_text,
        reason,
      });
    } else {
      kept.push(ext);
    }
  }

  return { kept, filteredNoise };
}

async function gatherPreviouslyApproved(prisma, pnidIds) {
  if (!pnidIds || pnidIds.length === 0) return { equipment: [], instruments: [], lines: [] };

  const [equipment, instruments, lines] = await Promise.all([
    prisma.$queryRaw`
      SELECT pe.pnid_id, pe.equipment_id, e.tag, e.equipment_type,
             pe.annotation_x_pct, pe.annotation_y_pct
      FROM pnid_equipment pe
      JOIN equipment e ON e.id = pe.equipment_id
      WHERE pe.pnid_id = ANY(${pnidIds}::uuid[])
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT pi.pnid_id, pi.instrument_id, i.tag, i.instrument_type,
             pi.annotation_x_pct, pi.annotation_y_pct
      FROM pnid_instrument pi
      JOIN instrument i ON i.id = pi.instrument_id
      WHERE pi.pnid_id = ANY(${pnidIds}::uuid[])
    `.catch(() => []),
    prisma.$queryRaw`
      SELECT pl.pnid_id, pl.line_id, l.line_number, l.service,
             pl.annotation_x_pct, pl.annotation_y_pct
      FROM pnid_line pl
      JOIN line l ON l.id = pl.line_id
      WHERE pl.pnid_id = ANY(${pnidIds}::uuid[])
    `.catch(() => []),
  ]);

  return { equipment, instruments, lines };
}

// ═══ PROMPT BUILDING ══════════════════════════════════════════════════════════

function buildCleanupPrompt(rawExtractions, existingEntities, previouslyApproved, context) {
  let prompt = CLEANUP_PROMPT_TEMPLATE;

  prompt = prompt.replace('{{platformCode}}', context.platformCode || '');
  prompt = prompt.replace('{{platformName}}', context.platformName || '');

  // Existing entities
  prompt = prompt.replace('{{existingSystems}}',
    existingEntities.systems.length > 0
      ? existingEntities.systems.map(s => `- ${s.code} (${s.name}) [${s.sys_type}] id:${s.id}`).join('\n')
      : '(none — no systems configured yet)'
  );
  prompt = prompt.replace('{{existingLines}}',
    existingEntities.lines.length > 0
      ? existingEntities.lines.map(l => `- ${l.line_number} [${l.service || ''}] id:${l.id}`).join('\n')
      : '(none)'
  );
  prompt = prompt.replace('{{existingEquipment}}',
    existingEntities.equipment.length > 0
      ? existingEntities.equipment.map(e => `- ${e.tag} [${e.equipment_type || ''}] id:${e.id}`).join('\n')
      : '(none)'
  );
  prompt = prompt.replace('{{existingInstruments}}',
    existingEntities.instruments.length > 0
      ? existingEntities.instruments.map(i => `- ${i.tag} [${i.instrument_type || ''}] id:${i.id}`).join('\n')
      : '(none)'
  );

  // Previously approved tags (for revision diff)
  const prevLines = [];
  for (const e of previouslyApproved.equipment) {
    prevLines.push(`- [equipment] ${e.tag} on P&ID ${e.pnid_id} (entity:${e.equipment_id})`);
  }
  for (const i of previouslyApproved.instruments) {
    prevLines.push(`- [instrument] ${i.tag} on P&ID ${i.pnid_id} (entity:${i.instrument_id})`);
  }
  for (const l of previouslyApproved.lines) {
    prevLines.push(`- [line] ${l.line_number} on P&ID ${l.pnid_id} (entity:${l.line_id})`);
  }
  prompt = prompt.replace('{{previouslyApproved}}',
    prevLines.length > 0 ? prevLines.join('\n') : '(none — first time processing these P&IDs)'
  );

  // Tag dictionary — function codes + descriptions
  const dictEntries = context.tagDictionary || [];
  if (dictEntries.length > 0) {
    const dictLines = dictEntries.map(d => {
      let line = `- ${d.function_code} → ${d.entity_type} (${d.discipline || 'general'}) — ${d.description || ''}`;
      if (d.tag_pattern) line += ` [pattern: ${d.tag_pattern}]`;
      if (d.number_format) line += ` [format: ${d.number_format}]`;
      return line;
    });
    prompt = prompt.replace('{{tagDictionary}}',
      `Client-specific function codes (take priority over generic ISA rules):\n` + dictLines.join('\n')
    );
  } else {
    prompt = prompt.replace('{{tagDictionary}}', '(No client-specific dictionary — using standard ISA S5.1 conventions)');
  }

  // Tag format patterns — grouped by entity type for clearer AI reference
  const patternsWithFormat = dictEntries.filter(d => d.tag_pattern || d.number_format);
  if (patternsWithFormat.length > 0) {
    const byType = {};
    for (const d of patternsWithFormat) {
      const type = d.entity_type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push({
        code: d.function_code,
        pattern: d.tag_pattern || '',
        format: d.number_format || '',
        description: d.description || '',
      });
    }
    const patternLines = [];
    for (const [type, entries] of Object.entries(byType)) {
      patternLines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)} Tag Patterns:`);
      for (const e of entries) {
        let line = `- ${e.code}`;
        if (e.pattern) line += ` — pattern: ${e.pattern}`;
        if (e.format) line += ` — format: ${e.format}`;
        if (e.description) line += ` (${e.description})`;
        patternLines.push(line);
      }
    }
    patternLines.push('');
    patternLines.push('Any OCR text matching these patterns is a REAL engineering tag — do NOT classify as noise.');
    prompt = prompt.replace('{{tagPatterns}}', patternLines.join('\n'));
  } else {
    prompt = prompt.replace('{{tagPatterns}}', '(No client-specific patterns — using standard conventions. Equipment: V-XXXX, P-XXXX; Instruments: ISA S5.1 e.g. PT-XXXXXX, TT-XXXX; Lines: size"-service-number e.g. 6"-PG-1001)');
  }

  const learnedPatternsText = formatLearnedPatternsForPrompt(context.learnedPatterns || []);
  if (learnedPatternsText) {
    prompt += `\n\n## Learned Patterns From Prior Human Review\n${learnedPatternsText}`;
  }

  // Zone profile priors + deterministic prefilter summary
  const zoneProfiles = context.zoneProfiles || [];
  if (zoneProfiles.length > 0) {
    const zoneLines = zoneProfiles.map(z =>
      `- ${z.zone_name}: x=${z.x_pct} y=${z.y_pct} w=${z.w_pct} h=${z.h_pct} mode=${z.noise_mode}`
    );
    prompt += `\n\n## Zone Profile Priors\n${zoneLines.join('\n')}`;
  }
  const prefiltered = rawExtractions.prefilteredNoise || [];
  if (prefiltered.length > 0) {
    const sample = prefiltered.slice(0, 40).map(p => `- ${p.text} (${p.reason})`);
    prompt += `\n\n## Deterministic Prefiltered Noise (${prefiltered.length})\nThese items were pre-filtered before AI classification:\n${sample.join('\n')}`;
  }

  // Raw extractions grouped by P&ID
  const sections = [];
  for (const [drawingNumber, exts] of Object.entries(rawExtractions.byPnid)) {
    const lines = exts.map(e => {
      const pos = (e.bbox_x_pct != null && e.bbox_y_pct != null)
        ? ` pos:(${Number(e.bbox_x_pct).toFixed(1)}%,${Number(e.bbox_y_pct).toFixed(1)}%)`
        : '';
      return `  id:${e.id} text:"${e.extracted_text}" type:${e.tag_type} conf:${Number(e.confidence).toFixed(2)}${pos}`;
    });
    sections.push(`### P&ID: ${drawingNumber}\n${lines.join('\n')}`);
  }
  prompt = prompt.replace('{{rawExtractions}}', sections.join('\n\n') || '(no extractions)');

  // Raw full text — unfiltered Vision OCR output for each P&ID
  const rawFullText = rawExtractions.rawFullText || {};
  if (Object.keys(rawFullText).length > 0) {
    const fullTextSections = [];
    for (const [drawingNumber, text] of Object.entries(rawFullText)) {
      // Truncate to ~3000 chars per drawing to avoid token explosion
      const truncated = text.length > 3000 ? text.substring(0, 3000) + '\n... (truncated)' : text;
      fullTextSections.push(`### P&ID: ${drawingNumber}\n\`\`\`\n${truncated}\n\`\`\``);
    }
    prompt = prompt.replace('{{rawFullText}}', fullTextSections.join('\n\n'));
  } else {
    prompt = prompt.replace('{{rawFullText}}', '(Raw full text not available — only pre-classified extractions above)');
  }

  return prompt;
}

// ═══ RESPONSE PROCESSING ══════════════════════════════════════════════════════

function parseCleanupResponse(responseText) {
  let jsonStr = responseText.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) jsonStr = fenceMatch[1];

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
    throw new Error(`Failed to parse AI cleanup response as JSON: ${err.message}`);
  }
}

async function applyClassifications(prisma, parsed, rawExtractions) {
  let tagCount = 0, noiseCount = 0, uncertainCount = 0;

  // Resolve drawing number → pnid_id mapping for new tags found in full text
  const drawingToPnidId = rawExtractions.drawingToPnidId || {};

  for (const c of (parsed.classifications || [])) {
    if (!c.extractionId) continue;

    const classification = c.classification || 'uncertain';
    const newStatus = classification === 'noise' ? 'rejected' : 'pending';
    const tagType = c.tagType || null;
    const reason = c.reason || null;
    const correctedText = c.correctedText || null;

    // Handle NEW tags discovered from raw full text (extractionId starts with "new-")
    if (c.extractionId.startsWith('new-') && classification === 'real_tag') {
      // Parse drawing number from ID format: "new-{drawingNumber}-{seq}"
      const parts = c.extractionId.split('-');
      // Drawing number is everything between first "new-" and last "-{seq}"
      const drawingNumber = parts.slice(1, -1).join('-');
      const pnidId = drawingToPnidId[drawingNumber];
      const tagText = correctedText || c.extractionId;

      if (pnidId && tagText) {
        try {
          await prisma.$queryRaw`
            INSERT INTO ocr_extraction (
              pnid_id, extracted_text, tag_type, confidence,
              ai_classification, ai_reason, status
            ) VALUES (
              ${pnidId}::uuid,
              ${tagText},
              ${tagType || 'unknown'},
              ${c.confidence || 0.5},
              ${classification},
              ${'Discovered from raw OCR full text by AI: ' + (reason || '')},
              'pending'
            )
          `;
          tagCount++;
        } catch {
          // Skip duplicates or insert errors
        }
      }
      continue;
    }

    // Update existing ocr_extraction
    if (correctedText && correctedText !== '') {
      await prisma.$queryRaw`
        UPDATE ocr_extraction SET
          ai_classification = ${classification},
          ai_reason = ${reason},
          tag_type = COALESCE(${tagType}, tag_type),
          status = ${newStatus},
          extracted_text = COALESCE(${correctedText}, extracted_text)
        WHERE id = ${c.extractionId}::uuid
      `;
    } else {
      await prisma.$queryRaw`
        UPDATE ocr_extraction SET
          ai_classification = ${classification},
          ai_reason = ${reason},
          tag_type = COALESCE(${tagType}, tag_type),
          status = ${newStatus}
        WHERE id = ${c.extractionId}::uuid
      `;
    }

    if (classification === 'real_tag') tagCount++;
    else if (classification === 'noise') noiseCount++;
    else uncertainCount++;
  }

  // Apply entity matches
  for (const m of (parsed.entityMatches || [])) {
    if (!m.extractionId || !m.matchedEntityId) continue;
    await prisma.$queryRaw`
      UPDATE ocr_extraction SET
        matched_entity_id = ${m.matchedEntityId}::uuid,
        match_confidence = ${m.matchConfidence || 0},
        match_method = ${m.matchMethod || 'ai'}
      WHERE id = ${m.extractionId}::uuid
    `;
  }

  // Apply revision statuses
  const revChanges = parsed.revisionChanges || {};
  for (const item of (revChanges.unchanged || [])) {
    if (!item.extractionId) continue;
    await prisma.$queryRaw`
      UPDATE ocr_extraction SET revision_status = 'unchanged'
      WHERE id = ${item.extractionId}::uuid
    `;
  }
  for (const item of (revChanges.added || [])) {
    // Find extraction by tag text across batch P&IDs
    if (item.extractionId) {
      await prisma.$queryRaw`
        UPDATE ocr_extraction SET revision_status = 'added'
        WHERE id = ${item.extractionId}::uuid
      `;
    }
  }
  for (const item of (revChanges.moved || [])) {
    if (!item.extractionId) continue;
    await prisma.$queryRaw`
      UPDATE ocr_extraction SET revision_status = 'moved'
      WHERE id = ${item.extractionId}::uuid
    `;
  }

  return { tagCount, noiseCount, uncertainCount };
}

async function storeDraftEntities(prisma, jobId, batchId, platformId, parsed, rawExtractions) {
  const drawingToPnidId = rawExtractions.drawingToPnidId || {};

  function resolvePnidIds(drawingNumbers) {
    if (!drawingNumbers?.length) return [];
    return drawingNumbers.map(d => drawingToPnidId[d]).filter(Boolean);
  }

  function findSourceExtractions(tag) {
    return rawExtractions.extractions
      .filter(e => e.extracted_text === tag)
      .map(e => e.id);
  }

  const draftEntities = parsed.draftEntities || {};

  // Systems
  for (const sys of (draftEntities.systems || [])) {
    const pnidIds = resolvePnidIds(sys.foundOnPnids);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'system',
        ${sys.code || sys.name}, ${JSON.stringify(sys)}::jsonb,
        ${pnidIds.length > 0 ? pnidIds : []}::uuid[],
        ${sys.confidence || 0.5}, 'draft'
      )
    `;
  }

  // Equipment
  for (const eq of (draftEntities.equipment || [])) {
    if (!eq.isNew) continue;
    const pnidIds = resolvePnidIds(eq.foundOnPnids);
    const sourceExts = findSourceExtractions(eq.tag);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions, confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'equipment',
        ${eq.tag}, ${JSON.stringify(eq)}::jsonb,
        ${pnidIds.length > 0 ? pnidIds : []}::uuid[],
        ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${eq.confidence || 0.5}, 'draft'
      )
    `;
  }

  // Instruments
  for (const inst of (draftEntities.instruments || [])) {
    if (!inst.isNew) continue;
    const pnidIds = resolvePnidIds(inst.foundOnPnids);
    const sourceExts = findSourceExtractions(inst.tag);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions, confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'instrument',
        ${inst.tag}, ${JSON.stringify(inst)}::jsonb,
        ${pnidIds.length > 0 ? pnidIds : []}::uuid[],
        ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${inst.confidence || 0.5}, 'draft'
      )
    `;
  }

  // Lines
  for (const line of (draftEntities.lines || [])) {
    if (!line.isNew) continue;
    const pnidIds = resolvePnidIds(line.foundOnPnids);
    const sourceExts = findSourceExtractions(line.lineNumber);
    await prisma.$queryRaw`
      INSERT INTO ai_generated_entity (
        analysis_job_id, batch_id, platform_id, entity_type,
        suggested_tag, suggested_data, source_pnid_ids, source_extractions, confidence, status
      ) VALUES (
        ${jobId}::uuid, ${batchId}::uuid, ${platformId}::uuid, 'line',
        ${line.lineNumber}, ${JSON.stringify(line)}::jsonb,
        ${pnidIds.length > 0 ? pnidIds : []}::uuid[],
        ${sourceExts.length > 0 ? sourceExts : []}::uuid[],
        ${line.confidence || 0.5}, 'draft'
      )
    `;
  }
}

function buildReconciliationSummary(parsed) {
  const revChanges = parsed.revisionChanges || {};
  const draftEntities = parsed.draftEntities || {};
  const pnidSummary = parsed.pnidSummary || [];

  return {
    totalRealTags: (parsed.classifications || []).filter(c => c.classification === 'real_tag').length,
    totalNoise: (parsed.classifications || []).filter(c => c.classification === 'noise').length,
    totalUncertain: (parsed.classifications || []).filter(c => c.classification === 'uncertain').length,
    revision: {
      added: (revChanges.added || []).length,
      removed: (revChanges.removed || []).length,
      unchanged: (revChanges.unchanged || []).length,
      moved: (revChanges.moved || []).length,
    },
    draftEntities: {
      systems: (draftEntities.systems || []).length,
      equipment: (draftEntities.equipment || []).filter(e => e.isNew).length,
      instruments: (draftEntities.instruments || []).filter(i => i.isNew).length,
      lines: (draftEntities.lines || []).filter(l => l.isNew).length,
    },
    removedTags: revChanges.removed || [],
    pnidSummary,
    summary: parsed.summary || '',
  };
}
