/**
 * OCR Pipeline orchestrator.
 * Runs the complete OCR → classify → match → stage flow for a P&ID.
 *
 * Stage-based architecture:
 *   Stage 1: Extract raw OCR words from PDF/image (runStage1_Extract)
 *   Stage 2: Group adjacent words into tags (runStage2_Group) — TODO
 *   Stage 3: AI cleanup & classification (runStage3_Cleanup) — TODO
 *   Stage 4: Database import with human review (runStage4_Import) — TODO
 */

import { Prisma } from '@prisma/client';
import VisionOCRProvider from './VisionOCRProvider.js';
import ClaudeVisionOCRProvider from './ClaudeVisionOCRProvider.js';
import PaddleOCRProvider from './PaddleOCRProvider.js';
import FlorenceOCRProvider from './FlorenceOCRProvider.js';
import MockOCRProvider from './MockOCRProvider.js';
import { normalizePaddleWords } from './PaddleWordNormalizer.js';
import { detectSymbolRegions, fuseSymbolRegionWords } from './SymbolRegionDetector.js';
import { rasterizeForVisualDetection } from './VisualDetectionUtils.js';
import { groupAdjacentWords, verticesToPct, verticesToPixels } from './WordGrouper.js';
import { classifyAll, classifyTag } from './TagClassifier.js';
import { matchTagsToEntities } from './TagMatcher.js';
import { getDictionary } from './TagDictionaryService.js';
import { detectContinuationReferences } from './ContinuationReferenceService.js';

function boolFlag(v, fallback = false) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function numFlag(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeWordsByProvider(words = [], provider = '') {
  const p = String(provider || '').trim().toLowerCase();
  if (p !== 'paddle') return Array.isArray(words) ? words : [];
  return normalizePaddleWords(Array.isArray(words) ? words : []);
}

function extractDocumentMetadata(fullText = '', drawingNumberHint = '') {
  const text = String(fullText || '');
  const normalized = text.replace(/\r/g, '');
  const metadata = {
    drawingNumber: null,
    revision: null,
    revisionDate: null,
    latestRevisionDate: null,
    fileName: null,
  };

  const drawingCandidates = [
    drawingNumberHint,
    normalized.match(/\b[A-Z]{2,4}-\d{2}-[A-Z]-\d{5,}-SHT-\d{3}\b/i)?.[0],
    normalized.match(/\b[A-Z]{2,5}-\d{2}-[A-Z]-\d{4,}\b/i)?.[0],
  ].filter(Boolean);
  metadata.drawingNumber = drawingCandidates.length > 0 ? String(drawingCandidates[0]).toUpperCase() : null;

  const revMatch = normalized.match(/\bREV(?:ISION)?\s*[:\-]?\s*([A-Z0-9]{1,4})\b/i);
  if (revMatch) metadata.revision = String(revMatch[1]).toUpperCase();

  const dateRegex = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g;
  const dateMatches = [...normalized.matchAll(dateRegex)].map(m => m[1]).filter(Boolean);
  if (dateMatches.length > 0) {
    metadata.revisionDate = dateMatches[0];
    metadata.latestRevisionDate = dateMatches[dateMatches.length - 1];
  }

  const fileMatch = normalized.match(/\bFILE(?:\s*NAME|\s*NO\.?|\s*NUMBER)?\s*[:\-]?\s*([A-Z0-9._-]{4,})\b/i);
  if (fileMatch) metadata.fileName = fileMatch[1];

  return metadata;
}

function resolveGroupingOptions(options = {}) {
  return {
    maxGapPx: options.maxGapPx ?? 15,
    yOverlapThreshold: options.yOverlapThreshold ?? 0.5,
    // Production lift (validated by the diagnostic): vertical + rotation passes
    // are now ON by default because they recover ISA-stack tags (XS/289910/A,
    // ZSC/ZLO/ZLC) and inclined line tags that the horizontal-only grouper
    // misses.  Set OCR_ENABLE_VERTICAL_GROUPING=false to revert per-instance.
    enableVerticalGrouping: options.enableVerticalGrouping ?? boolFlag(process.env.OCR_ENABLE_VERTICAL_GROUPING, true),
    enableRotationGrouping: options.enableRotationGrouping ?? boolFlag(process.env.OCR_ENABLE_ROTATION_GROUPING, true),
    // Production post-passes (validated by the diagnostic): split pure-numeric
    // over-merges (e.g. "281010 281010 281011") and break horizontal chains at
    // number→number boundaries so adjacent line/equipment tags don't collapse.
    // Set OCR_ENABLE_NUMERIC_GUARD=false / OCR_ENABLE_NUMBER_BREAK=false to revert.
    enableNumericGuard: options.enableNumericGuard ?? boolFlag(process.env.OCR_ENABLE_NUMERIC_GUARD, true),
    enableNumberBreakStopper: options.enableNumberBreakStopper ?? boolFlag(process.env.OCR_ENABLE_NUMBER_BREAK, true),
  };
}

const DEFAULT_ZONE_NOISE_TERMS = [
  'ISSUED', 'REV', 'DATE', 'NOTES', 'SCALE', 'DRAWN', 'CHECKED', 'APPROVED',
  'CONFIDENTIAL', 'INFORMATION', 'DIAGRAM', 'PLATFORM',
];

function wordCenterPctFromVertices(vertices = [], pageWidth = 2400, pageHeight = 1700) {
  if (!Array.isArray(vertices) || !vertices.length || !pageWidth || !pageHeight) return null;
  const xs = vertices.map(v => Number(v?.x)).filter(Number.isFinite);
  const ys = vertices.map(v => Number(v?.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x_pct: (cx / pageWidth) * 100, y_pct: (cy / pageHeight) * 100 };
}

function applyEarlyNoisePrefilter(words = [], { zoneProfiles = [], pageWidth = 2400, pageHeight = 1700 } = {}) {
  const kept = [];
  const filteredNoise = [];
  const zones = Array.isArray(zoneProfiles) ? zoneProfiles : [];
  for (const word of words) {
    const text = String(word?.text || '').trim().toUpperCase();
    let reason = null;
    if (DEFAULT_ZONE_NOISE_TERMS.some(t => text.includes(t))) {
      reason = 'lexical_noise_term';
    } else {
      const c = wordCenterPctFromVertices(word?.vertices || [], pageWidth, pageHeight);
      if (c) {
        const hit = zones.find((z) => {
          if (String(z?.noise_mode || '').toLowerCase() !== 'exclude') return false;
          const x = Number(z?.x_pct || 0);
          const y = Number(z?.y_pct || 0);
          const w = Number(z?.w_pct || 0);
          const h = Number(z?.h_pct || 0);
          return c.x_pct >= x && c.x_pct <= (x + w) && c.y_pct >= y && c.y_pct <= (y + h);
        });
        if (hit) reason = `zone_exclude:${hit.zone_name || 'unnamed'}`;
      }
    }
    if (reason) filteredNoise.push({ text, reason });
    else kept.push(word);
  }
  return { kept, filteredNoise };
}

function isStrongStructuredCandidate(text = '', type = '') {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return false;
  if (type === 'instrument' || type === 'valve') return /^[A-Z]{2,5}-?\d{3,7}(?:\.[A-Z0-9]{1,3})?(?:-[A-Z0-9]{1,3}){0,3}$/.test(t);
  if (type === 'equipment') return /^[A-Z]{1,5}-\d{1,7}(?:\.[A-Z0-9]+)?(?:-[A-Z0-9]{1,3}){0,3}$/.test(t);
  if (type === 'line') return /^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i.test(t);
  if (type === 'drawing_ref') return /^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/.test(t) && /(SHT|SHEET|DWG|DRG|\d{4,})/.test(t);
  return false;
}

// Phase 1.2 — minimum margin for vertical_isa candidate to be auto-kept as
// "deterministic strong" without AI confirmation. Tuned so that a single
// hypothesis (marginToRunnerUp = 1) always wins, and competing prefixes within
// 0.15 of each other route to UNCERTAIN_COMPETING_HYPOTHESES.
const VERTICAL_ISA_STRONG_MARGIN = 0.15;

/**
 * Robustly extract a JSON object from a Claude Stage 2 classify response.
 * Handles four formats observed in production:
 *   1. raw JSON  — `{ "tags": [...] }`
 *   2. fenced     — ```json\n{...}\n```
 *   3. prose+raw — "Looking at... :\n{...}"
 *   4. prose+fenced — "Looking at...:\n```json\n{...}\n```"
 *
 * Returns the parsed object, or throws with a helpful message.
 */
export function parseStage2Response(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) throw new Error('Empty response');

  // Strategy 1: try as-is.
  try { return normalizeStage2Payload(JSON.parse(text)); } catch { /* fall through */ }

  // Strategy 2: strip a single leading ```json (or ```) and trailing ```.
  // Use a non-anchored regex so prose before the fence doesn't block stripping.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    try { return normalizeStage2Payload(JSON.parse(fenceMatch[1].trim())); } catch { /* fall through */ }
  }

  // Strategy 3: locate the first top-level `{` and walk to its matching `}`.
  // This handles "Looking at the OCR words... { ... }" without a fence.
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = false; continue; }
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(firstBrace, i + 1);
          try { return normalizeStage2Payload(JSON.parse(candidate)); } catch { /* fall through */ }
          break;
        }
      }
    }
  }

  // Strategy 4: salvage complete array items from a partially broken JSON body.
  // This handles cases where the root object never closes, but Claude already
  // emitted valid completed items for tags/noise/uncertain.
  const salvaged = salvagePartialStage2Payload(firstBrace >= 0 ? text.slice(firstBrace) : text);
  if (salvaged) return normalizeStage2Payload(salvaged);

  // Strategy 5: salvage a truncated response by best-effort closing of any open
  // braces and brackets. Drops the trailing partial item but rescues every
  // complete item before it. Used when Claude hit max_tokens mid-array.
  if (firstBrace >= 0) {
    const repaired = repairTruncatedJson(text.slice(firstBrace));
    if (repaired) {
      try { return normalizeStage2Payload(JSON.parse(repaired)); } catch { /* fall through */ }
    }
  }

  // All strategies failed — surface a clear error with a snippet for the log.
  throw new Error(`Could not extract JSON from Claude response (starts with: "${text.slice(0, 80)}…")`);
}

function normalizeStage2Payload(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const hasRelevantKeys = Object.prototype.hasOwnProperty.call(parsed, 'tags')
    || Object.prototype.hasOwnProperty.call(parsed, 'noise')
    || Object.prototype.hasOwnProperty.call(parsed, 'uncertain');
  if (!hasRelevantKeys) return parsed;
  return {
    ...parsed,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    noise: Array.isArray(parsed.noise) ? parsed.noise : [],
    uncertain: Array.isArray(parsed.uncertain) ? parsed.uncertain : [],
  };
}

function salvagePartialStage2Payload(text = '') {
  const tags = extractArrayItemsFromKey(text, 'tags');
  const noise = extractArrayItemsFromKey(text, 'noise');
  const uncertain = extractArrayItemsFromKey(text, 'uncertain');
  if (tags === null && noise === null && uncertain === null) return null;
  return {
    tags: Array.isArray(tags) ? tags : [],
    noise: Array.isArray(noise) ? noise : [],
    uncertain: Array.isArray(uncertain) ? uncertain : [],
  };
}

function extractArrayItemsFromKey(text = '', key = '') {
  if (!text || !key) return null;
  const keyRe = new RegExp(`"${key}"\\s*:\\s*\\[`, 'i');
  const match = keyRe.exec(text);
  if (!match) return null;

  const items = [];
  let inString = false;
  let escape = false;
  let objectDepth = 0;
  let nestedArrayDepth = 0;
  let itemStart = -1;

  for (let i = match.index + match[0].length; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }

    if (ch === '{') {
      if (objectDepth === 0) itemStart = i;
      objectDepth++;
      continue;
    }
    if (ch === '}') {
      if (objectDepth > 0) {
        objectDepth--;
        if (objectDepth === 0 && itemStart >= 0) {
          const candidate = text.slice(itemStart, i + 1);
          try { items.push(JSON.parse(candidate)); } catch { /* ignore malformed item */ }
          itemStart = -1;
        }
      }
      continue;
    }

    // Only track array boundaries while not inside an object.
    if (objectDepth === 0) {
      if (ch === '[') {
        nestedArrayDepth++;
        continue;
      }
      if (ch === ']') {
        if (nestedArrayDepth === 0) return items;
        nestedArrayDepth--;
      }
    }
  }

  // End-of-text with an open array: return all complete items we collected.
  return items;
}

/**
 * Best-effort repair of a JSON object that was truncated mid-stream.
 *
 * The algorithm:
 *   1. Walk the text, tracking nested `{` `[` and the most recent comma at
 *      every depth, ignoring contents of strings.
 *   2. When we run out of input with structures still open, climb the stack
 *      from deepest to shallowest. At each level we ask: did this structure
 *      see a comma at its own depth? If yes, that comma marks the end of the
 *      last complete sibling — truncate there and close everything from this
 *      level outward. The partial child(ren) we just unwound past are dropped.
 *   3. If no level on the stack ever saw a comma, the very first item of the
 *      outermost array got truncated; we have nothing to salvage.
 *
 * This drops the partial trailing item entirely (no `{}` placeholder) and
 * keeps every complete sibling that was already serialised.
 *
 * Returns repaired text or null if nothing is salvageable.
 */
function repairTruncatedJson(text = '') {
  if (!text || typeof text !== 'string') return null;

  // Per-depth state: { open: '{'|'[', firstChildStart: number, lastSafeEnd: number }
  // - lastSafeEnd: index of the last comma at THIS depth, or -1 if none yet.
  const stack = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = false; continue; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }

    if (ch === '{' || ch === '[') {
      stack.push({ open: ch, firstChildStart: i + 1, lastSafeEnd: -1 });
    } else if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null; // mismatched closer
      stack.pop();
    } else if (ch === ',' && stack.length > 0) {
      stack[stack.length - 1].lastSafeEnd = i;
    }
  }

  if (stack.length === 0) return text; // already balanced — nothing to repair

  // Find the level to cut at. Preference order:
  //   1. Deepest ARRAY level with a comma — its commas reliably separate
  //      whole sibling items, so the prefix is guaranteed-valid JSON.
  //   2. Deepest OBJECT level with a comma — its commas separate key-value
  //      pairs, which is also safe to truncate at (you'd just lose the last
  //      partial field of the partial item, but the surrounding object's
  //      shape stays valid).
  //
  // We deliberately reject "salvaged" partial objects whose own siblings
  // would be incomplete: for a truncated `{"text":"V-28195","type":"equipment","s`
  // we drop V-28195 entirely (the array's outer comma is the safe cut),
  // because keeping a partial object risks downstream code thinking it
  // received a real classified tag with missing fields.
  let cutLevel = -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].open === '[' && stack[i].lastSafeEnd >= 0) { cutLevel = i; break; }
  }
  if (cutLevel < 0) {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].lastSafeEnd >= 0) { cutLevel = i; break; }
    }
  }

  let cutAt;
  let levelsToClose;
  if (cutLevel >= 0) {
    // Truncate at the last comma of the chosen level, then close from this
    // level outward. Slicing at the comma index drops the partial item AND
    // the comma, which is what we want before appending the closing bracket.
    cutAt = stack[cutLevel].lastSafeEnd;
    levelsToClose = cutLevel + 1;
  } else {
    // No level ever saw a comma — the very first item got truncated.
    // Best we can do is empty the outermost structure.
    cutAt = stack[0].firstChildStart;
    levelsToClose = 1;
  }

  const head = text.slice(0, cutAt);
  let tail = '';
  for (let i = levelsToClose - 1; i >= 0; i--) {
    tail += stack[i].open === '{' ? '}' : ']';
  }
  return head + tail;
}

/**
 * Decide whether a deterministic group is "strong enough" to bypass AI.
 * Strong = single hypothesis OR clear top-N margin AND text passes strict
 * structured pattern for its predicted type. Returns true → KEPT_DETERMINISTIC_STRONG.
 */
function isDeterministicStrongGroup(group = {}, predictedType = '') {
  if (!group) return false;
  const text = String(group.text || '').trim().toUpperCase();
  if (!text) return false;
  const type = String(predictedType || group.type || '').toLowerCase();
  if (!isStrongStructuredCandidate(text, type === 'valve' ? 'instrument' : type)) return false;
  const source = String(group.source || '');
  // Row assemblers (line/structured) are unambiguous by construction.
  if (source === 'line_assembler' || source === 'structured_row') return true;
  if (source !== 'vertical_isa') return false;
  if (group.isBestHypothesis !== true) return false;
  const margin = Number.isFinite(Number(group.marginToRunnerUp))
    ? Number(group.marginToRunnerUp)
    : 1;
  return margin >= VERTICAL_ISA_STRONG_MARGIN;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1: RAW OCR EXTRACTION
// Downloads file, sends to OCR provider, returns raw words + fullText
// Output saved as JSON per file: ocr-stages/{batchId}/raw/{filename}_raw.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 1: Extract raw OCR text from a file.
 * Does NOT create P&ID records, does NOT classify, does NOT match.
 * Just downloads the file, sends to OCR provider, returns raw result.
 *
 * @param {object} storageProvider - Storage provider instance
 * @param {string} storageKey - File path in storage bucket
 * @param {object} options
 * @param {string} options.ocrProvider - 'google' | 'claude' | 'both' | 'paddle' | 'florence'
 * @param {string} options.credentialsJson - Vision API credentials
 * @param {string} options.claudeApiKey - Claude API key
 * @param {string} options.claudeModel - Claude model
 * @returns {Promise<{ words: Array, fullText: string, pageWidth: number, pageHeight: number, provider: string }>}
 */
export async function runStage1_Extract(storageProvider, storageKey, options = {}) {
  const providerChoice = options.ocrProvider || 'google';

  // 1. Download the file buffer
  let fileBuffer = null;
  try {
    const downloaded = await storageProvider.download(storageKey);
    fileBuffer = downloaded.buffer || downloaded;
  } catch (downloadErr) {
    throw new Error(`File download failed for ${storageKey}: ${downloadErr.message}`);
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error(`Empty file buffer for ${storageKey}`);
  }

  // 2. Determine file type
  const isPdf = storageKey.toLowerCase().endsWith('.pdf');
  const isGcs = storageProvider.type === 'gcs';

  // 3. Run OCR with selected provider
  let ocrResult;
  const pnidStub = { storage_key: storageKey, id: 'stage1-temp' };

  if (providerChoice === 'claude') {
    ocrResult = await _runClaudeVision(fileBuffer, isPdf, options);
  } else if (providerChoice === 'paddle') {
    ocrResult = await _runPaddleVision(fileBuffer, isPdf, options);
  } else if (providerChoice === 'florence') {
    ocrResult = await _runFlorenceVision(fileBuffer, isPdf, options);
  } else if (providerChoice === 'both') {
    const [googleResult, claudeResult] = await Promise.allSettled([
      _runGoogleVision(fileBuffer, isPdf, isGcs, pnidStub, storageProvider, options),
      _runClaudeVision(fileBuffer, isPdf, options),
    ]);

    const gResult = googleResult.status === 'fulfilled' ? googleResult.value : { words: [], fullText: '' };
    const cResult = claudeResult.status === 'fulfilled' ? claudeResult.value : { words: [], fullText: '' };

    const googleTexts = new Set(gResult.words.map(w => w.text.toUpperCase().replace(/\s+/g, '')));
    const uniqueClaudeWords = cResult.words.filter(w =>
      !googleTexts.has(w.text.toUpperCase().replace(/\s+/g, ''))
    );

    ocrResult = {
      words: [...gResult.words, ...uniqueClaudeWords],
      fullText: gResult.fullText || cResult.fullText,
      pageWidth: gResult.pageWidth || cResult.pageWidth || 2400,
      pageHeight: gResult.pageHeight || cResult.pageHeight || 1700,
    };
  } else {
    ocrResult = await _runGoogleVision(fileBuffer, isPdf, isGcs, pnidStub, storageProvider, options);
  }

  const normalizedWords = normalizeWordsByProvider(ocrResult.words || [], providerChoice);
  const pageWidth = ocrResult.pageWidth || 2400;
  const pageHeight = ocrResult.pageHeight || 1700;
  const contentType = isPdf ? 'application/pdf' : 'image/png';
  let visualInput = {
    rasterBuffer: fileBuffer,
    contentType: isPdf ? 'application/pdf' : 'image/png',
    sourceType: isPdf ? 'pdf' : 'raster',
    width: pageWidth,
    height: pageHeight,
  };
  try {
    visualInput = await rasterizeForVisualDetection({
      fileBuffer,
      contentType,
      density: Number(options.pdfVisualDensity || process.env.OCR_SYMBOL_PDF_DENSITY || process.env.AI_ANNOTATE_PDF_DENSITY || 420),
      page: Number(options.pdfVisualPage || 0),
    });
  } catch (visualErr) {
    console.warn(`[Stage1] Visual raster preparation failed, fallback to OCR-only heuristics: ${visualErr.message}`);
  }

  const symbolRegionResult = await detectSymbolRegions({
    words: normalizedWords,
    fileBuffer: visualInput.rasterBuffer,
    contentType: visualInput.contentType,
    sourceWidth: visualInput.width,
    sourceHeight: visualInput.height,
    pageWidth,
    pageHeight,
    options,
  });
  const fusionResult = fuseSymbolRegionWords(
    normalizedWords,
    symbolRegionResult.regions,
    pageWidth,
    pageHeight
  );

  return {
    words: fusionResult.words,
    fullText: ocrResult.fullText || '',
    pageWidth,
    pageHeight,
    provider: providerChoice,
    symbolRegions: symbolRegionResult.regions,
    symbolRegionProvider: symbolRegionResult.provider,
    fusion: {
      rawWords: normalizedWords.length,
      fusedWords: fusionResult.words.length,
      addedByRegionFusion: fusionResult.addedWords,
      symbolRegionCount: symbolRegionResult.regions.length,
    },
    extractedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: WORD GROUPING
// Reads raw OCR output, groups adjacent words into tags
// Output saved as JSON per file: ocr-stages/{batchId}/grouped/{filename}_grouped.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 2: Group adjacent words from raw OCR output.
 * Takes the raw words array and groups spatially adjacent words into tags.
 *
 * @param {Array} rawWords - Array of raw OCR words with { text, confidence, vertices }
 * @param {object} options
 * @param {number} options.maxGapPx - Max horizontal gap between words (default 15)
 * @param {number} options.yOverlapThreshold - Min vertical overlap ratio (default 0.5)
 * @param {number} options.pageWidth - Page width in pixels
 * @param {number} options.pageHeight - Page height in pixels
 * @returns {{ groups: Array, stats: object }}
 */
export function runStage2_Group(rawWords, options = {}) {
  const {
    pageWidth = 2400,
    pageHeight = 1700,
  } = options;
  const groupingOptions = resolveGroupingOptions(options);

  if (!rawWords || rawWords.length === 0) {
    return {
      groups: [],
      stats: { totalWords: 0, totalGroups: 0, avgWordsPerGroup: 0 },
      pageWidth,
      pageHeight,
      groupedAt: new Date().toISOString(),
    };
  }

  const grouped = groupAdjacentWords(rawWords, groupingOptions);

  // Enrich groups with percentage-based positions
  const enrichedGroups = grouped.map((g, idx) => {
    const pct = g.vertices ? verticesToPct(g.vertices, pageWidth, pageHeight) : null;
    const px = g.vertices ? verticesToPixels(g.vertices) : null;
    return {
      id: idx,
      text: g.text,
      confidence: g.confidence,
      wordCount: g.wordCount || 1,
      vertices: g.vertices,
      position_pct: pct,
      position_px: px,
    };
  });

  return {
    groups: enrichedGroups,
    stats: {
      totalWords: rawWords.length,
      totalGroups: enrichedGroups.length,
      avgWordsPerGroup: enrichedGroups.length > 0 ? +(rawWords.length / enrichedGroups.length).toFixed(1) : 0,
      singleWordGroups: enrichedGroups.filter(g => g.wordCount === 1).length,
      multiWordGroups: enrichedGroups.filter(g => g.wordCount > 1).length,
      verticalGroupingEnabled: !!groupingOptions.enableVerticalGrouping,
      rotationGroupingEnabled: !!groupingOptions.enableRotationGrouping,
    },
    pageWidth,
    pageHeight,
    groupedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: AI CLASSIFY
// Reads raw OCR words + tag dictionary, sends to Claude for intelligent
// grouping, classification, and noise filtering. Returns classified tags
// with merged bounding boxes.
// Output saved as JSON: ocr-stages/{batchId}/classified/{filename}_classified.json
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stage 2: AI-powered classification of raw OCR words.
 * Groups words into tags, classifies by type, filters noise.
 *
 * @param {object} rawData - Stage 1 output: { words, fullText, pageWidth, pageHeight }
 * @param {object} options
 * @param {string} options.apiKey - Claude API key
 * @param {string} options.model - Claude model (default: claude-sonnet-4-20250514)
 * @param {string} options.drawingNumber - Drawing number for context
 * @param {string} options.platformCode - Platform code
 * @param {string} options.platformName - Platform name
 * @param {Array} options.tagDictionary - Tag dictionary entries
 * @returns {Promise<object>} Classified tags with bounding boxes
 */
export async function runStage2_AiClassify(rawData, options = {}) {
  const {
    apiKey,
    model = 'claude-sonnet-4-20250514',
    drawingNumber = 'Unknown',
    platformCode = '',
    platformName = '',
    tagDictionary = [],
    learnedPatterns = [],
    zoneProfiles = [],
    // callback(progress)
    // progress: {
    //   phase, chunk, totalChunks, chunkWords, chunkStartWordIndex, chunkEndWordIndex,
    //   chunkTags, chunkNoise, chunkUncertain, tagsSoFar, noiseSoFar, uncertainSoFar,
    //   chunkInputTokens, chunkOutputTokens, inputTokensSoFar, outputTokensSoFar,
    //   latencyMs, retries, retryWaitMs, model
    // }
    onChunkProgress = null,
    // Keep Stage 2 chunks moderate-sized. Large chunks caused extremely slow
    // Opus/Sonnet responses when the model emitted exhaustive noise arrays.
    // 450 words keeps prompt/context rich without generating huge per-call
    // outputs on dense drawings.
    maxWordsPerCall = numFlag(process.env.OCR_STAGE2_MAX_WORDS_PER_CALL, 450),
    maxFullTextChars = numFlag(process.env.OCR_STAGE2_MAX_FULLTEXT_CHARS, 3000),
    phaseProfile = 'phase3_full_rescue',
    includeGroupedCandidatesInPrompt = true,
    enableDeterministicPromotion = true,
    enableCoverageRescue = true,
  } = options;

  if (!apiKey) throw new Error('Claude API key required for Stage 2 AI Classify');

  const { STAGE2_CLASSIFY_SYSTEM_PROMPT, STAGE2_CLASSIFY_PROMPT_TEMPLATE } =
    await import('./AiPromptTemplates.js');

  // Format tag dictionary for prompt
  const dictText = tagDictionary.length > 0
    ? tagDictionary.map(d =>
        `- ${d.function_code} → ${d.entity_type} (${d.discipline}) — ${d.description}${d.tag_pattern ? ` — pattern: ${d.tag_pattern}` : ''}${d.number_format ? ` — format: ${d.number_format}` : ''}`
      ).join('\n')
    : 'No client-specific dictionary provided. Use standard ISA S5.1 and O&G conventions.';
  const learnedPatternText = learnedPatterns.length > 0
    ? `\n\nLearned Patterns From Prior Review:\n${learnedPatterns.map(p => `- ${p.pattern_key} → ${p.target_type} (support=${p.support_count}, conf=${p.confidence}) regex:${p.regex_pattern}`).join('\n')}`
    : '';

  const providerUsed = String(rawData.provider || options.ocrProvider || '').toLowerCase();
  const stage2NormalizedWords = normalizeWordsByProvider(rawData.words || [], providerUsed);
  const prefilterResult = applyEarlyNoisePrefilter(stage2NormalizedWords, {
    zoneProfiles,
    pageWidth: rawData.pageWidth || 2400,
    pageHeight: rawData.pageHeight || 1700,
  });
  const stage2BaseWords = prefilterResult.kept;
  const stage2Fusion = fuseSymbolRegionWords(
    stage2BaseWords,
    rawData.symbolRegions || [],
    rawData.pageWidth || 2400,
    rawData.pageHeight || 1700
  );
  const stage2Words = stage2Fusion.words;

  // Format raw words COMPACTLY for prompt — only send essential data
  // Instead of full vertices (4 x/y pairs = ~80 chars/word), send center point (x,y)
  const wordsForPrompt = stage2Words.map((w, idx) => {
    // Calculate center point from vertices
    const verts = w.vertices || [];
    const cx = verts.length > 0 ? Math.round(verts.reduce((s, v) => s + (v.x || 0), 0) / verts.length) : 0;
    const cy = verts.length > 0 ? Math.round(verts.reduce((s, v) => s + (v.y || 0), 0) / verts.length) : 0;
    return [idx, w.text, cx, cy]; // Compact array: [index, text, centerX, centerY]
  });

  // With compact format, each word is ~30 chars vs ~100 chars before
  // Can safely do 1000 words per call (~8K tokens including prompt)
  const MAX_WORDS_PER_CALL = Math.max(100, Math.floor(maxWordsPerCall));
  let groupedCandidatesForPrompt = [];
  if (includeGroupedCandidatesInPrompt) {
    const groupedForPrompt = groupAdjacentWords(stage2Words, {
      maxGapPx: 15,
      yOverlapThreshold: 0.5,
      enableVerticalGrouping: true,
      enableRotationGrouping: true,
    });
    groupedCandidatesForPrompt = groupedForPrompt
      .filter(g => {
        const t = String(g.text || '').trim().toUpperCase();
        if (!t || t.length < 4) return false;
        return g.source === 'vertical_isa' ||
          /^[A-Z]{2,5}-\d{3,7}(?:-[A-Z0-9]{1,3})?$/.test(t) ||
          (/^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/.test(t) && /(SHT|SHEET|DWG|DRG)/.test(t)) ||
          /^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i.test(t);
      })
      .map(g => [String(g.text || '').trim().toUpperCase(), g.source || 'grouped', g.componentWordIndices || []])
      .slice(0, 250);
  }
  const wordChunks = [];
  for (let i = 0; i < wordsForPrompt.length; i += MAX_WORDS_PER_CALL) {
    wordChunks.push(wordsForPrompt.slice(i, i + MAX_WORDS_PER_CALL));
  }

  let allTags = [];
  let allNoise = [];
  let allUncertain = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let coverageRescuedCount = 0;

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  // Light throttle — 500ms between calls to stay well under rate limits
  const THROTTLE_MS = 500;
  let lastCallTime = 0;

  for (let chunkIdx = 0; chunkIdx < wordChunks.length; chunkIdx++) {
    const chunk = wordChunks[chunkIdx];
    const chunkNumber = chunkIdx + 1;
    const chunkStartWordIndex = chunkIdx * MAX_WORDS_PER_CALL;
    const chunkEndWordIndex = chunkStartWordIndex + chunk.length - 1;

    if (onChunkProgress) {
      onChunkProgress({
        phase: 'chunk_prepare',
        chunk: chunkNumber,
        totalChunks: wordChunks.length,
        chunkWords: chunk.length,
        chunkStartWordIndex,
        chunkEndWordIndex,
        tagsSoFar: allTags.length,
        noiseSoFar: allNoise.length,
        uncertainSoFar: allUncertain.length,
        inputTokensSoFar: totalInputTokens,
        outputTokensSoFar: totalOutputTokens,
        model,
      });
    }

    // Build prompt from template
    const prompt = STAGE2_CLASSIFY_PROMPT_TEMPLATE
      .replace('{{drawingNumber}}', drawingNumber)
      .replace('{{platformCode}}', platformCode)
      .replace('{{platformName}}', platformName)
      .replace('{{tagDictionary}}', `${dictText}${learnedPatternText}`)
      .replace('{{wordCount}}', String(chunk.length))
      .replace('{{rawWords}}', JSON.stringify(chunk))
      .replace('{{groupedCandidates}}', JSON.stringify(groupedCandidatesForPrompt))
      .replace('{{fullText}}', (rawData.fullText || '').substring(0, Math.max(500, Math.floor(maxFullTextChars))));

    // Retry logic for rate limits (429)
    let response;
    let retries = 0;
    const MAX_RETRIES = 3;
    // Phase 1.5 — truncation guard. Sonnet 4 supports up to 64k output tokens
    // per call, far more than the previous 16k cap. Densely-tagged P&IDs were
    // hitting the cap and returning truncated JSON ('{ "tags": [, ...') that the
    // parser correctly refused to load. Lift the cap so a single chunk's
    // response always fits, and detect stop_reason === 'max_tokens' as a real
    // error rather than letting it surface as a parser failure later.
    const MAX_OUTPUT_TOKENS = numFlag(process.env.OCR_STAGE2_MAX_OUTPUT_TOKENS, 32000);

    let latencyMs = 0;
    while (retries < MAX_RETRIES) {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallTime;
      if (timeSinceLastCall < THROTTLE_MS) {
        await new Promise(resolve => setTimeout(resolve, THROTTLE_MS - timeSinceLastCall));
      }

      try {
        if (onChunkProgress) {
          onChunkProgress({
            phase: 'ai_call',
            chunk: chunkNumber,
            totalChunks: wordChunks.length,
            chunkWords: chunk.length,
            chunkStartWordIndex,
            chunkEndWordIndex,
            tagsSoFar: allTags.length,
            noiseSoFar: allNoise.length,
            uncertainSoFar: allUncertain.length,
            inputTokensSoFar: totalInputTokens,
            outputTokensSoFar: totalOutputTokens,
            retries,
            model,
          });
        }

        const callStartedAt = Date.now();
        // Phase 1.5 — STREAMING. Anthropic SDK rejects non-streaming requests
        // with high max_tokens (it may exceed the 10-minute non-streaming
        // ceiling). Use the streaming helper which transparently aggregates
        // chunks back into the same final-message shape we already use.
        const stream = client.messages.stream({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: STAGE2_CLASSIFY_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: prompt }],
        });
        response = await stream.finalMessage();
        latencyMs = Date.now() - callStartedAt;

        // Phase 1.5 — explicit truncation detection.
        if (response?.stop_reason === 'max_tokens') {
          const used = response?.usage?.output_tokens || 0;
          throw new Error(`Claude response truncated at output token limit (${used}/${MAX_OUTPUT_TOKENS}). Reduce OCR_STAGE2_MAX_WORDS_PER_CALL or raise OCR_STAGE2_MAX_OUTPUT_TOKENS.`);
        }

        lastCallTime = Date.now();
        break; // Success, exit retry loop
      } catch (err) {
        if (err.status === 429) {
          retries++;
          if (retries >= MAX_RETRIES) {
            throw new Error(`Claude rate limit exceeded after ${MAX_RETRIES} retries. Please try again in a few minutes.`);
          }
          // Exponential backoff: 5s, 10s, 15s
          const waitMs = (retries * 5000);
          console.log(`[Stage2 AI] Rate limited (chunk ${chunkIdx + 1}/${wordChunks.length}). Retry ${retries}/${MAX_RETRIES} in ${waitMs}ms...`);
          if (onChunkProgress) {
            onChunkProgress({
              phase: 'rate_limited',
              chunk: chunkNumber,
              totalChunks: wordChunks.length,
              chunkWords: chunk.length,
              chunkStartWordIndex,
              chunkEndWordIndex,
              tagsSoFar: allTags.length,
              noiseSoFar: allNoise.length,
              uncertainSoFar: allUncertain.length,
              inputTokensSoFar: totalInputTokens,
              outputTokensSoFar: totalOutputTokens,
              retries,
              retryWaitMs: waitMs,
              model,
            });
          }
          await new Promise(resolve => setTimeout(resolve, waitMs));
        } else {
          throw err; // Not a rate limit error, re-throw
        }
      }
    }

    const chunkInputTokens = response.usage?.input_tokens || 0;
    const chunkOutputTokens = response.usage?.output_tokens || 0;
    totalInputTokens += chunkInputTokens;
    totalOutputTokens += chunkOutputTokens;

    const responseText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Parse JSON response. Claude sometimes ignores "Return ONLY the JSON object"
    // and prefixes a sentence ("Looking at the OCR words..."), wraps in a
    // markdown code fence, or both. Try several extraction strategies in order
    // before giving up — losing a whole chunk to fragile parsing wastes the
    // tokens we already spent.
    let parsed;
    try {
      parsed = parseStage2Response(responseText);
    } catch (parseErr) {
      console.error('[Stage2 AI] Failed to parse response:', parseErr.message);
      console.error('[Stage2 AI] Raw response (first 800 chars):', responseText.substring(0, 800));
      throw new Error(`AI response parse failed: ${parseErr.message}`);
    }

    const chunkTags = parsed.tags?.length || 0;
    const chunkNoise = parsed.noise?.length || 0;
    const chunkUncertain = parsed.uncertain?.length || 0;
    if (parsed.tags) allTags.push(...parsed.tags);
    if (parsed.noise) allNoise.push(...parsed.noise);
    if (parsed.uncertain) allUncertain.push(...parsed.uncertain);

    console.log(`[Stage2 AI] Chunk ${chunkNumber}/${wordChunks.length}: ${chunkTags} tags, ${chunkNoise} noise (${chunkInputTokens} in / ${chunkOutputTokens} out tokens, ${latencyMs}ms)`);

    // Emit progress callback
    if (onChunkProgress) {
      onChunkProgress({
        phase: 'chunk_done',
        chunk: chunkNumber,
        totalChunks: wordChunks.length,
        chunkWords: chunk.length,
        chunkStartWordIndex,
        chunkEndWordIndex,
        chunkTags,
        chunkNoise,
        chunkUncertain,
        tagsSoFar: allTags.length,
        noiseSoFar: allNoise.length,
        uncertainSoFar: allUncertain.length,
        chunkInputTokens,
        chunkOutputTokens,
        inputTokensSoFar: totalInputTokens,
        outputTokensSoFar: totalOutputTokens,
        latencyMs,
        retries,
        model,
      });
    }
  }

  // ── PHASE 1.2 — DETERMINISTIC-STRONG PROMOTION ──
  // Goal: any unambiguous deterministic candidate (single vertical_isa hypothesis
  // with strong pattern, or row-assembler hit) MUST land in `kept`, even if AI
  // returned a competing reading. Competing hypotheses (margin < 0.15) route to
  // `uncertain` with reason UNCERTAIN_COMPETING_HYPOTHESES so the reviewer sees them.
  // This replaces the older "deterministic recovery" pass which silently lost
  // candidates already present in allTags under a slightly different spelling.
  const recoveredDeterministic = [];
  const promotedCompeting = [];
  let suppressedAiTagCount = 0;
  if (enableDeterministicPromotion) try {
    const groupedCandidates = groupAdjacentWords(stage2Words, {
      maxGapPx: 15,
      yOverlapThreshold: 0.5,
      enableVerticalGrouping: true,
      enableRotationGrouping: true,
    });

    const classifiedGrouped = classifyAll(
      groupedCandidates.map(g => ({
        text: g.text,
        confidence: g.confidence,
        vertices: g.vertices,
        pageWidth: g.pageWidth,
        pageHeight: g.pageHeight,
        wordCount: g.wordCount,
        wordIndices: g.componentWordIndices || [],
        source: g.source || 'grouped',
        // Carry assembly metadata through classification.
        assemblyRule: g.assemblyRule || null,
        assemblyScore: g.assemblyScore ?? null,
        competingPrefixCount: g.competingPrefixCount ?? null,
        marginToRunnerUp: g.marginToRunnerUp ?? null,
        isBestHypothesis: g.isBestHypothesis ?? null,
        anchorWordIndex: g.anchorWordIndex ?? null,
      })),
      { dictionary: tagDictionary }
    );

    // Map raw grouped candidate index → its assembly metadata so we can recover it
    // after classifyAll (classifyAll spreads the full input object, but the original
    // text may have been normalized).
    const existingTagMap = new Map(
      allTags.map(t => [String(t.text || '').trim().toUpperCase(), t])
    );
    const existingUncertainSet = new Set(
      allUncertain.map(t => String(t.text || '').trim().toUpperCase())
    );

    // Group classified candidates by their anchor (vertical_isa anchorWordIndex
    // or text for row assemblers) so we can detect when multiple hypotheses
    // compete for the same physical bubble.
    const byAnchor = new Map();
    for (const c of classifiedGrouped) {
      const recoverableType = c.type === 'instrument' || c.type === 'equipment' ||
        c.type === 'line' || c.type === 'drawing_ref' || c.type === 'valve';
      if (!recoverableType) continue;
      const anchor = c.anchorWordIndex != null
        ? `anchor:${c.anchorWordIndex}`
        : `text:${String(c.text || '').toUpperCase()}`;
      if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
      byAnchor.get(anchor).push(c);
    }

    for (const [, hypotheses] of byAnchor) {
      // Sort by score desc — best hypothesis first.
      hypotheses.sort((a, b) => (Number(b.assemblyScore || 0) - Number(a.assemblyScore || 0)));
      const best = hypotheses[0];
      const text = String(best.text || '').trim().toUpperCase();
      if (!text) continue;

      const isStrong = isDeterministicStrongGroup(best, best.type);

      if (isStrong) {
        // Promote the best hypothesis to KEPT_DETERMINISTIC_STRONG.
        // If AI already emitted the same text, replace its source so the
        // ledger correctly attributes the keep to deterministic geometry.
        const existing = existingTagMap.get(text);
        if (existing) {
          existing.source = 'deterministic_strong';
          existing.assemblyRule = best.assemblyRule || existing.assemblyRule || null;
          existing.assemblyScore = best.assemblyScore ?? existing.assemblyScore ?? null;
          existing.marginToRunnerUp = best.marginToRunnerUp ?? existing.marginToRunnerUp ?? null;
          existing.competingPrefixCount = best.competingPrefixCount ?? existing.competingPrefixCount ?? null;
          existing.confidence = Math.max(Number(existing.confidence || 0), Number(best.confidence || 0));
        } else if (existingUncertainSet.has(text)) {
          // Promote out of uncertain into kept.
          const idx = allUncertain.findIndex(u => String(u.text || '').toUpperCase() === text);
          if (idx >= 0) {
            const promoted = {
              ...allUncertain[idx],
              source: 'deterministic_strong',
              assemblyRule: best.assemblyRule || null,
              assemblyScore: best.assemblyScore ?? null,
              marginToRunnerUp: best.marginToRunnerUp ?? null,
              competingPrefixCount: best.competingPrefixCount ?? null,
            };
            allUncertain.splice(idx, 1);
            existingUncertainSet.delete(text);
            recoveredDeterministic.push(promoted);
            existingTagMap.set(text, promoted);
          }
        } else {
          // Net-new strong candidate AI never returned.
          const newTag = {
            ...best,
            text,
            type: best.type || 'instrument',
            source: 'deterministic_strong',
            reason: 'Promoted by deterministic strong assembly',
          };
          recoveredDeterministic.push(newTag);
          existingTagMap.set(text, newTag);
        }

        // Surface remaining hypotheses (runner-ups) to uncertain so the reviewer
        // can override if the prefix family was guessed wrong.
        for (let i = 1; i < hypotheses.length; i++) {
          const h = hypotheses[i];
          const ht = String(h.text || '').trim().toUpperCase();
          if (!ht || ht === text) continue;
          if (existingTagMap.has(ht) || existingUncertainSet.has(ht)) continue;
          promotedCompeting.push({
            ...h,
            text: ht,
            type: h.type || 'instrument',
            source: 'deterministic_competing',
            reason: 'Competing hypothesis for same anchor (lost to runner-up)',
            reason_code: 'UNCERTAIN_COMPETING_HYPOTHESES',
          });
          existingUncertainSet.add(ht);
        }
        continue;
      }

      // No strong winner: route ALL hypotheses to uncertain so the reviewer
      // chooses. Avoids silently picking the highest-score one when the margin
      // is too small.
      if (hypotheses.length > 1) {
        for (const h of hypotheses) {
          const ht = String(h.text || '').trim().toUpperCase();
          if (!ht) continue;
          if (existingTagMap.has(ht) || existingUncertainSet.has(ht)) continue;
          promotedCompeting.push({
            ...h,
            text: ht,
            type: h.type || 'instrument',
            source: 'deterministic_competing',
            reason: 'Competing hypotheses with no clear margin winner',
            reason_code: 'UNCERTAIN_COMPETING_HYPOTHESES',
          });
          existingUncertainSet.add(ht);
        }
      } else {
        // Single weak hypothesis — keep legacy recovery behavior (add to tags
        // if not already present, since downstream integrity filter will demote
        // it if the pattern is bad).
        const isStrongLine = best.type === 'line' &&
          /^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i.test(text);
        const isStrongDrawing = best.type === 'drawing_ref' &&
          /^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/.test(text);
        const isVerticalIsa = String(best.source || '') === 'vertical_isa';
        if (!isVerticalIsa && best.type !== 'instrument' && !isStrongLine && !isStrongDrawing) continue;
        if (existingTagMap.has(text)) continue;
        const newTag = {
          ...best,
          text,
          type: best.type || 'instrument',
          source: 'deterministic_recovery',
          reason: isStrongLine
            ? 'Deterministic grouped-word recovery (line-pattern assembly)'
            : 'Deterministic grouped-word recovery (vertical/rotated assembly)',
        };
        recoveredDeterministic.push(newTag);
        existingTagMap.set(text, newTag);
      }
    }

    if (recoveredDeterministic.length > 0) {
      allTags.push(...recoveredDeterministic);
      console.log(`[Stage2 AI] Deterministic strong promotion added ${recoveredDeterministic.length} kept tags`);
    }
    if (promotedCompeting.length > 0) {
      allUncertain.push(...promotedCompeting);
      console.log(`[Stage2 AI] Deterministic competing routed ${promotedCompeting.length} uncertain candidates`);
    }
  } catch (recoveryErr) {
    console.warn(`[Stage2 AI] Deterministic-strong promotion failed: ${recoveryErr.message}`);
  }
  // Counter so coverage stats can report it.
  void suppressedAiTagCount;

  // ── COVERAGE RESCUE: flexible post-AI pass over structured candidates ──
  // Goal: reduce misses from raw->cleaned by recovering any strong-looking tags
  // that AI did not return, across instrument/equipment/line/drawing_ref.
  if (enableCoverageRescue) try {
    const classifyOptions = Array.isArray(tagDictionary)
      ? { dictionary: tagDictionary }
      : {};
    const existingKeySet = new Set(
      [...allTags, ...allUncertain].map((t) => String(t.text || '').trim().toUpperCase())
    );

    const rescueGrouped = groupAdjacentWords(stage2Words, {
      maxGapPx: 18,
      yOverlapThreshold: 0.45,
      enableVerticalGrouping: true,
      enableRotationGrouping: true,
    });
    const rescueSingles = (stage2Words || []).map((w) => ({
      text: w?.text,
      confidence: w?.confidence,
      vertices: w?.vertices,
      pageWidth: w?.pageWidth,
      pageHeight: w?.pageHeight,
      wordCount: 1,
      source: 'raw_single',
      componentWordIndices: [],
    }));
    const rescuePool = [...rescueGrouped, ...rescueSingles];

    const INSTRUMENT_STRICT = /^[A-Z]{2,5}-?\d{3,7}(?:-[A-Z0-9]{1,3})?$/;
    const EQUIPMENT_STRICT = /^[A-Z]{1,5}-\d{1,7}(?:\.[A-Z0-9]{1,3})?(?:-[A-Z0-9]{1,3})?$/;
    const LINE_STRICT = /^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i;
    const DRAWING_STRICT = /^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/;

    function normCandidateText(input = '') {
      return String(input || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+|-+$/g, '')
        .trim();
    }

    function isStrongByType(text = '', type = '') {
      if (type === 'instrument') return INSTRUMENT_STRICT.test(text);
      if (type === 'equipment') return EQUIPMENT_STRICT.test(text);
      if (type === 'line') return LINE_STRICT.test(text);
      if (type === 'drawing_ref') return DRAWING_STRICT.test(text) && /(SHT|SHEET|DWG|DRG|\d{4,})/.test(text);
      return false;
    }

    const rescued = [];
    for (const c of rescuePool) {
      const text = normCandidateText(c?.text || '');
      if (!text || text.length < 4) continue;
      if (existingKeySet.has(text)) continue;

      const cls = classifyTag(text, classifyOptions);
      const type = cls?.type;
      if (!type || type === 'unknown') continue;
      if (!isStrongByType(text, type)) continue;

      const vb = computeBoundingBoxFromVertices(c?.vertices || []);
      if (!vb) continue;
      const vbW = Math.max(1, vb.maxX - vb.minX);
      const vbH = Math.max(1, vb.maxY - vb.minY);
      const areaPct = (vbW * vbH) / Math.max(1, pageW * pageH) * 100;
      if ((type === 'instrument' || type === 'equipment') && areaPct > 3.5) continue;
      if (type === 'line' && areaPct > 5.5) continue;

      const candidate = {
        text,
        type,
        confidence: Number(c?.confidence || 0.6),
        reason: 'Coverage rescue: structured candidate recovered after AI pass',
        source: 'coverage_rescue',
        vertices: c?.vertices || [],
        wordIndices: c?.componentWordIndices || [],
      };
      rescued.push(candidate);
      existingKeySet.add(text);
    }

    if (rescued.length) {
      // Route rescued items to uncertain for human validation instead of auto-approving.
      allUncertain.push(...rescued);
      coverageRescuedCount = rescued.length;
      console.log(`[Stage2 AI] Coverage rescue added ${rescued.length} uncertain candidates`);
    }
  } catch (coverageErr) {
    console.warn(`[Stage2 AI] Coverage rescue failed: ${coverageErr.message}`);
  }

  // ── POST-PROCESS: Calculate bounding boxes from original Google Vision vertices ──
  // AI only returns wordIndices — we compute accurate boxes ourselves
  const originalWords = stage2Words;
  const pageW = rawData.pageWidth || 2400;
  const pageH = rawData.pageHeight || 1700;

  function computeBoundingBoxFromVertices(vertices) {
    if (!Array.isArray(vertices) || vertices.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of vertices) {
      const x = Number(v?.x);
      const y = Number(v?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (minX === Infinity) return null;
    return {
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
    };
  }

  function computeBoundingBox(wordIndices) {
    if (!wordIndices || wordIndices.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const idx of wordIndices) {
      const w = originalWords[idx];
      if (!w?.vertices) continue;
      for (const v of w.vertices) {
        if (v.x < minX) minX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.x > maxX) maxX = v.x;
        if (v.y > maxY) maxY = v.y;
      }
    }
    if (minX === Infinity) return null;
    return {
      minX: Math.round(minX), minY: Math.round(minY),
      maxX: Math.round(maxX), maxY: Math.round(maxY),
    };
  }

  function computeAverageWordConfidence(wordIndices) {
    if (!Array.isArray(wordIndices) || wordIndices.length === 0) return null;
    let sum = 0;
    let count = 0;
    for (const idx of wordIndices) {
      const w = originalWords[idx];
      const c = Number(w?.confidence);
      if (Number.isFinite(c)) {
        sum += c;
        count++;
      }
    }
    if (!count) return null;
    return +(sum / count).toFixed(3);
  }

  function padBoundingBox(box, item = {}) {
    if (!box) return null;
    const itemType = String(item.type || '').toLowerCase();
    const w = Math.max(1, box.maxX - box.minX);
    const h = Math.max(1, box.maxY - box.minY);
    const minDimW = itemType === 'instrument' ? 24 : itemType === 'drawing_ref' ? 32 : 16;
    const minDimH = itemType === 'instrument' ? 16 : itemType === 'drawing_ref' ? 12 : 10;
    const padX = itemType === 'instrument' ? 0.22 : itemType === 'drawing_ref' ? 0.1 : 0.06;
    const padY = itemType === 'instrument' ? 0.28 : itemType === 'drawing_ref' ? 0.1 : 0.08;

    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const paddedW = Math.max(minDimW, w * (1 + padX * 2));
    const paddedH = Math.max(minDimH, h * (1 + padY * 2));

    const maxDimsByType = {
      instrument: { w: pageW * 0.18, h: pageH * 0.12 },
      equipment: { w: pageW * 0.2, h: pageH * 0.12 },
      valve: { w: pageW * 0.2, h: pageH * 0.12 },
      line: { w: pageW * 0.42, h: pageH * 0.1 },
      drawing_ref: { w: pageW * 0.26, h: pageH * 0.1 },
      unknown: { w: pageW * 0.22, h: pageH * 0.12 },
    };
    const caps = maxDimsByType[itemType] || maxDimsByType.unknown;
    const safeW = Math.max(1, Math.min(paddedW, caps.w));
    const safeH = Math.max(1, Math.min(paddedH, caps.h));

    const minX = Math.max(0, Math.round(cx - safeW / 2));
    const minY = Math.max(0, Math.round(cy - safeH / 2));
    const maxX = Math.min(pageW, Math.round(cx + safeW / 2));
    const maxY = Math.min(pageH, Math.round(cy + safeH / 2));
    return { minX, minY, maxX, maxY };
  }

  function intersectionOverUnion(a, b) {
    if (!a || !b) return 0;
    const x1 = Math.max(a.minX, b.minX);
    const y1 = Math.max(a.minY, b.minY);
    const x2 = Math.min(a.maxX, b.maxX);
    const y2 = Math.min(a.maxY, b.maxY);
    if (x2 <= x1 || y2 <= y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    const areaA = Math.max(1, (a.maxX - a.minX) * (a.maxY - a.minY));
    const areaB = Math.max(1, (b.maxX - b.minX) * (b.maxY - b.minY));
    return inter / (areaA + areaB - inter);
  }

  function boxCenterDistance(a, b) {
    if (!a || !b) return Infinity;
    const ax = (a.minX + a.maxX) / 2;
    const ay = (a.minY + a.maxY) / 2;
    const bx = (b.minX + b.maxX) / 2;
    const by = (b.minY + b.maxY) / 2;
    return Math.hypot(ax - bx, ay - by);
  }

  function dedupeByGeometry(items = []) {
    const kept = [];
    for (const item of items) {
      const text = String(item.text || '').trim().toUpperCase();
      const t = { ...item, text };
      const existingIdx = kept.findIndex((k) => {
        if (String(k.type || '') !== String(t.type || '')) return false;
        const iou = intersectionOverUnion(k.boundingBox, t.boundingBox);
        const nearCenter = boxCenterDistance(k.boundingBox, t.boundingBox) <= 12;
        const sameText = k.text === t.text;
        const overlapContainment = (sameText || k.text.includes(t.text) || t.text.includes(k.text)) && iou > 0.4;
        return sameText ? (iou > 0.55 || nearCenter) : overlapContainment;
      });

      if (existingIdx < 0) {
        kept.push(t);
        continue;
      }

      const existing = kept[existingIdx];
      const existingScore = Number(existing.confidence || 0) + ((existing.wordIndices?.length || 0) * 0.01);
      const candidateScore = Number(t.confidence || 0) + ((t.wordIndices?.length || 0) * 0.01);
      const preferCandidate = candidateScore > existingScore || (
        Math.abs(candidateScore - existingScore) < 0.001 &&
        String(t.text || '').length > String(existing.text || '').length
      );
      if (preferCandidate) kept[existingIdx] = t;
    }
    return kept;
  }

  // Phase 1.4 — fragment suppression hardened.
  // Old behaviour dropped any short tag (<5 chars) overlapping a longer tag
  // with IoU≥0.45, which silently killed real standalone prefixes (XA, LAL, PAL)
  // sitting inside larger labels. New rules require the longer tag to actually
  // CONTAIN the fragment text AND share at least one source word index — i.e.
  // the fragment must be a true sub-token of the longer tag, not a coincidence
  // of geometric overlap. Higher IoU floor (0.55) further reduces false drops.
  // Items dropped here record reason_code REJECT_DEDUP_SUPERSEDED + the
  // superseder's text so the ledger can explain the loss.
  function suppressFragmentDetections(tagItems = [], uncertainItems = [], noiseItems = []) {
    const strong = [...tagItems, ...uncertainItems]
      .filter(i => i?.boundingBox && String(i?.text || '').trim().length >= 5)
      .map(i => ({
        ...i,
        _textU: String(i.text || '').trim().toUpperCase(),
        _wordIdxSet: new Set(Array.isArray(i.wordIndices) ? i.wordIndices : []),
      }));

    const droppedBy = new WeakMap();

    const findSuperseder = (item) => {
      const itemText = String(item?.text || '').trim().toUpperCase();
      if (!item?.boundingBox || !itemText || itemText.length >= 5) return null;
      // Phase 1.2 invariant: deterministic-strong candidates are never suppressed.
      if (String(item.source || '') === 'deterministic_strong') return null;
      const itemIdxSet = new Set(Array.isArray(item.wordIndices) ? item.wordIndices : []);
      for (const s of strong) {
        if (!s.boundingBox || !s._textU) continue;
        const iou = intersectionOverUnion(item.boundingBox, s.boundingBox);
        if (iou < 0.55) continue;
        if (!s._textU.includes(itemText)) continue;
        // Require shared word indices — the fragment must come from the same
        // OCR words as the longer tag, not just be near it.
        let sharedWords = false;
        if (itemIdxSet.size > 0 && s._wordIdxSet.size > 0) {
          for (const i of itemIdxSet) {
            if (s._wordIdxSet.has(i)) { sharedWords = true; break; }
          }
        }
        if (!sharedWords) continue;
        const itemConf = Number(item.confidence || 0);
        const strongConf = Number(s.confidence || 0);
        if (strongConf < itemConf) continue;
        return s;
      }
      return null;
    };

    const filterAndAnnotate = (list = []) => list.filter((i) => {
      const sup = findSuperseder(i);
      if (!sup) return true;
      // Annotate so ledger writer can attribute REJECT_DEDUP_SUPERSEDED.
      i.reason_code = 'REJECT_DEDUP_SUPERSEDED';
      i.reason = `Suppressed: contained in longer candidate ${sup._textU}`;
      i.superseded_by_text = sup._textU;
      droppedBy.set(i, sup);
      return false;
    });

    return {
      tags: filterAndAnnotate(tagItems),
      uncertain: filterAndAnnotate(uncertainItems),
      noise: filterAndAnnotate(noiseItems),
    };
  }

  // Phase 1.3 — dictionary-aware integrity filter.
  // A tag whose prefix is in the platform's tag_dictionary, or whose text matches
  // a learned regex from prior reviewer feedback, is NEVER demoted to noise even
  // if it fails the hardcoded isStrongStructuredCandidate regex. Demotions emit
  // a reason_code so the candidate ledger can attribute the loss correctly.
  function enforceStructuredTypeIntegrity(tagItems = [], uncertainItems = [], noiseItems = [], ctx = {}) {
    const typeChecked = new Set(['instrument', 'equipment', 'line', 'drawing_ref', 'valve']);
    const dictPrefixes = new Set(
      (Array.isArray(ctx.dictionary) ? ctx.dictionary : [])
        .map(d => String(d?.function_code || '').toUpperCase())
        .filter(Boolean)
    );
    const learnedRegexes = (Array.isArray(ctx.learnedPatterns) ? ctx.learnedPatterns : [])
      .map(p => {
        try { return p?.regex_pattern ? new RegExp(p.regex_pattern, 'i') : null; }
        catch { return null; }
      })
      .filter(Boolean);
    let reclassifiedCount = 0;
    let dictionaryRescuedCount = 0;
    let learnedRescuedCount = 0;
    // Phase 1.2 invariant: deterministic-strong promotions must never be demoted.
    const lockedSources = new Set(['deterministic_strong']);

    const normalizeItem = (item = {}) => ({
      ...item,
      text: String(item.text || '').trim().toUpperCase().replace(/\s+/g, ''),
    });

    const isAcceptedByLearning = (text = '') => {
      const upper = String(text || '').toUpperCase();
      if (!upper) return null;
      const prefix = upper.split('-')[0];
      if (prefix && dictPrefixes.has(prefix)) return 'dictionary';
      if (learnedRegexes.some(rx => rx.test(upper))) return 'learned_pattern';
      return null;
    };

    const reclassifyWeak = (item = {}, bucket = 'tag') => {
      const normalized = normalizeItem(item);
      const rawType = String(normalized.type || '').toLowerCase();
      const checkType = rawType === 'valve' ? 'instrument' : rawType;
      const itemSource = String(normalized.source || '');
      if (lockedSources.has(itemSource)) return { keep: true, item: normalized };
      if (!typeChecked.has(rawType)) return { keep: true, item: normalized };
      if (isStrongStructuredCandidate(normalized.text, checkType)) return { keep: true, item: normalized };
      const learnedHit = isAcceptedByLearning(normalized.text);
      if (learnedHit === 'dictionary') {
        dictionaryRescuedCount++;
        return {
          keep: true,
          item: {
            ...normalized,
            source: itemSource || 'dictionary_accepted',
            reason: normalized.reason || 'Accepted by platform tag dictionary',
          },
        };
      }
      if (learnedHit === 'learned_pattern') {
        learnedRescuedCount++;
        return {
          keep: true,
          item: {
            ...normalized,
            source: itemSource || 'learned_pattern_accepted',
            reason: normalized.reason || 'Accepted by learned reviewer pattern',
          },
        };
      }
      reclassifiedCount++;
      return {
        keep: false,
        item: {
          ...normalized,
          type: 'noise',
          original_type: rawType,
          source: normalized.source || 'integrity_filter',
          reason_code: 'REJECT_PATTERN_INVALID',
          reason: `Weak structured ${rawType} candidate moved from ${bucket}`,
        },
      };
    };

    const tags = [];
    const uncertain = [];
    const reclassified = [];

    for (const t of tagItems) {
      const out = reclassifyWeak(t, 'tag');
      if (out.keep) tags.push(out.item);
      else reclassified.push(out.item);
    }

    for (const u of uncertainItems) {
      const out = reclassifyWeak(u, 'uncertain');
      if (out.keep) uncertain.push(out.item);
      else reclassified.push(out.item);
    }

    return {
      tags,
      uncertain,
      noise: [...(noiseItems || []).map(normalizeItem), ...reclassified],
      reclassifiedCount,
      dictionaryRescuedCount,
      learnedRescuedCount,
    };
  }

  // Retype likely instrument tags that AI labeled as drawing references.
  // This catches common false positives where compact instrument patterns are
  // incorrectly routed to `drawing_ref` despite strong instrument structure.
  function retagLikelyInstrumentFromDrawing(tagItems = [], uncertainItems = []) {
    const INSTRUMENT_STRICT = /^[A-Z]{2,5}-?\d{3,7}(?:-[A-Z0-9]{1,3})?$/;
    const DRAWING_HINTS = /(SHT|SHEET|DWG|DRG|DETAIL|REV|ISOMETRIC|LEGEND)/i;
    let convertedCount = 0;

    const convert = (item = {}, bucket = 'tag') => {
      const rawType = String(item?.type || '').toLowerCase();
      if (rawType !== 'drawing_ref') return item;
      const text = String(item?.text || '').toUpperCase().replace(/\s+/g, '');
      if (!text || !INSTRUMENT_STRICT.test(text)) return item;
      if (DRAWING_HINTS.test(text)) return item;
      convertedCount++;
      return {
        ...item,
        type: 'instrument',
        original_type: item?.original_type || 'drawing_ref',
        source: item?.source || 'post_retype_instrument',
        reason_code: 'RETYPE_DRAWING_TO_INSTRUMENT',
        reason: `Retyped from drawing_ref in ${bucket}: strict instrument pattern`,
      };
    };

    return {
      tags: (tagItems || []).map((t) => convert(t, 'tag')),
      uncertain: (uncertainItems || []).map((u) => convert(u, 'uncertain')),
      convertedCount,
    };
  }

  // Text-token cluster fallback: if AI returned no/bad wordIndices AND no vertices,
  // try to locate the tag by finding words whose text matches the tag's tokens.
  // Uses a proximity-based cluster to avoid picking up unrelated duplicates elsewhere on the page.
  function recoverBoxFromTextTokens(text) {
    const t = String(text || '').toUpperCase();
    if (!t || t.length < 3) return null;
    const tokens = t.split(/[^A-Z0-9]+/).filter((tok) => tok && tok.length >= 2);
    if (!tokens.length) return null;

    // Collect (index, word-center) for every word whose text matches any token.
    const hits = [];
    for (let i = 0; i < originalWords.length; i++) {
      const w = originalWords[i];
      const wt = String(w?.text || '').toUpperCase().replace(/\s+/g, '');
      if (!wt || !Array.isArray(w.vertices) || w.vertices.length === 0) continue;
      const matched = tokens.some((tok) => (
        wt === tok ||
        (tok.length >= 3 && wt.includes(tok)) ||
        (wt.length >= 3 && tok.includes(wt))
      ));
      if (!matched) continue;
      const vb = computeBoundingBoxFromVertices(w.vertices);
      if (!vb) continue;
      hits.push({ idx: i, cx: (vb.minX + vb.maxX) / 2, cy: (vb.minY + vb.maxY) / 2 });
    }
    if (!hits.length) return null;

    // Greedy cluster on proximity: pick the densest cluster by radius.
    // Radius tuned to typical inter-word gaps for fragmented line tags.
    const RADIUS = Math.max(120, Math.min(pageW, pageH) * 0.08);
    let bestCluster = [];
    for (const seed of hits) {
      const cluster = hits.filter((h) => Math.hypot(h.cx - seed.cx, h.cy - seed.cy) <= RADIUS);
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    }
    if (bestCluster.length < 1) return null;
    const indices = bestCluster.map((h) => h.idx);
    const box = computeBoundingBox(indices);
    return box ? { box, indices } : null;
  }

  function addBoundingBox(item) {
    const fromWordIndices = computeBoundingBox(item.wordIndices);
    const fromVertices = computeBoundingBoxFromVertices(item.vertices);
    let baseBox = fromWordIndices || fromVertices;
    if (fromWordIndices && fromVertices) {
      const a1 = Math.max(1, (fromWordIndices.maxX - fromWordIndices.minX) * (fromWordIndices.maxY - fromWordIndices.minY));
      const a2 = Math.max(1, (fromVertices.maxX - fromVertices.minX) * (fromVertices.maxY - fromVertices.minY));
      if (a1 > a2 * 2.5) baseBox = fromVertices;
      else if (a2 > a1 * 2.5) baseBox = fromWordIndices;
      else baseBox = a1 <= a2 ? fromWordIndices : fromVertices;
    }

    // Fallback: AI sometimes omits/gets wordIndices wrong for line tags with many fragments.
    // Recover geometry by matching the tag's text tokens against original OCR words.
    let fromTextFallback = null;
    if (!baseBox) {
      const recovered = recoverBoxFromTextTokens(item.text);
      if (recovered) {
        fromTextFallback = recovered.box;
        baseBox = recovered.box;
        // Backfill wordIndices so downstream confidence inference / sync has something to work with.
        if (!Array.isArray(item.wordIndices) || item.wordIndices.length === 0) {
          item.wordIndices = recovered.indices;
        }
        item.positionSource = 'text_token_fallback';
      }
    }

    const box = padBoundingBox(baseBox, item);
    if (box) {
      item.boundingBox = box;
      item.position_pct = {
        x_pct: +(box.minX / pageW * 100).toFixed(1),
        y_pct: +(box.minY / pageH * 100).toFixed(1),
        w_pct: +((box.maxX - box.minX) / pageW * 100).toFixed(1),
        h_pct: +((box.maxY - box.minY) / pageH * 100).toFixed(1),
      };
    } else {
      // Mark items that could not be geolocated so the reviewer UI can surface them.
      item.no_position = true;
    }
    if (!Number.isFinite(Number(item.confidence))) {
      const inferred = computeAverageWordConfidence(item.wordIndices);
      if (Number.isFinite(inferred)) item.confidence = inferred;
    }
    return item;
  }

  // Enrich all items with accurate bounding boxes from Google Vision vertices
  allTags.forEach(addBoundingBox);
  allUncertain.forEach(addBoundingBox);
  allNoise.forEach(addBoundingBox);

  // Strictly enforce structured tag shape for typed outputs from AI/recovery.
  // This prevents partial fragments like "LAL"/"PAL"/"ZLO" from surviving as instruments.
  // Phase 1.3: dictionary/learned-pattern aware so that platform-known prefixes
  // are NEVER reclassified to noise even if they fail the hardcoded regex.
  const integrity = enforceStructuredTypeIntegrity(allTags, allUncertain, allNoise, {
    dictionary: tagDictionary,
    learnedPatterns,
  });
  allTags = integrity.tags;
  allUncertain = integrity.uncertain;
  allNoise = integrity.noise;
  const retyped = retagLikelyInstrumentFromDrawing(allTags, allUncertain);
  allTags = retyped.tags;
  allUncertain = retyped.uncertain;
  if (retyped.convertedCount > 0) {
    console.log(`[Stage2 AI] Retyped ${retyped.convertedCount} drawing_ref items to instrument`);
  }

  const tagsBeforeDedup = allTags.length;
  allTags = dedupeByGeometry(allTags);
  allUncertain = dedupeByGeometry(allUncertain);
  allNoise = dedupeByGeometry(allNoise);
  const tagsAfterGeometryDedup = allTags.length;
  const fragmentSuppressed = suppressFragmentDetections(allTags, allUncertain, allNoise);
  const beforeFragSuppress = { tags: allTags.length, uncertain: allUncertain.length, noise: allNoise.length };
  allTags = fragmentSuppressed.tags;
  allUncertain = fragmentSuppressed.uncertain;
  allNoise = fragmentSuppressed.noise;

  // Detect off-sheet continuation references from all classified textual outputs.
  const continuationReferences = detectContinuationReferences([
    ...allTags,
    ...allUncertain,
    ...(allNoise || []),
  ]);

  // Confidence-tier automation labels (metadata only, no auto-write side effects here).
  const autoApproveThreshold = numFlag(process.env.OCR_AUTO_APPROVE_CONFIDENCE, 0.95);
  const reviewThreshold = numFlag(process.env.OCR_REVIEW_CONFIDENCE_MIN, 0.7);
  let autoApproveCount = 0;
  let humanReviewCount = 0;
  let autoRejectCount = 0;

  for (const t of allTags) {
    const c = Number(t.confidence || 0);
    if (c >= autoApproveThreshold) {
      t.automationDecision = 'auto_approve';
      autoApproveCount++;
    } else if (c >= reviewThreshold) {
      t.automationDecision = 'human_review';
      humanReviewCount++;
    } else {
      t.automationDecision = 'auto_reject';
      autoRejectCount++;
    }
  }
  for (const u of allUncertain) {
    const c = Number(u.confidence || 0);
    if (c >= autoApproveThreshold) {
      u.automationDecision = 'auto_approve';
      autoApproveCount++;
    } else if (c >= reviewThreshold) {
      u.automationDecision = 'human_review';
      humanReviewCount++;
    } else {
      u.automationDecision = 'auto_reject';
      autoRejectCount++;
    }
  }

  // Visual audit: regions detected by T-Rex2/GroundingDINO/heuristics that still
  // have no classified tag mapped to them. This gives an explicit "what was missed"
  // list in OCR review, with extra focus on vertical stacks.
  function toBoxFromRegion(region) {
    if (region?.bbox) {
      const x = Number(region.bbox.x || 0);
      const y = Number(region.bbox.y || 0);
      const w = Math.max(1, Number(region.bbox.w || 1));
      const h = Math.max(1, Number(region.bbox.h || 1));
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
    const p = region?.position_pct || region?.positionPct;
    if (!p) return null;
    const x = (Number(p.x_pct ?? p.xPct ?? 0) / 100) * pageW;
    const y = (Number(p.y_pct ?? p.yPct ?? 0) / 100) * pageH;
    const w = (Number(p.w_pct ?? p.wPct ?? 0) / 100) * pageW;
    const h = (Number(p.h_pct ?? p.hPct ?? 0) / 100) * pageH;
    return { minX: x, minY: y, maxX: x + w, maxY: y + h };
  }

  function boxCenter(box) {
    if (!box) return { x: 0, y: 0 };
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }

  function classifyAuditCandidate(text = '', regionLabel = '') {
    const t = String(text || '').trim().toUpperCase();
    const lbl = String(regionLabel || '').toLowerCase();
    if (/^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/.test(t) && /(SHT|SHEET|DWG|DRG)/.test(t)) return 'drawing_ref';
    if (/^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i.test(t)) return 'line';
    if (/^[A-Z]{2,5}-?\d{3,7}(?:-[A-Z0-9]{1,3})?$/.test(t)) return 'instrument';
    if (lbl.includes('drawing')) return 'drawing_ref';
    if (lbl.includes('line')) return 'line';
    if (lbl.includes('instrument') || lbl.includes('bubble') || lbl.includes('circle')) return 'instrument';
    return 'unknown';
  }

  const classifiedForOverlay = [...allTags, ...allUncertain].filter(t => t?.boundingBox);
  const ocrWordTokens = (stage2BaseWords || [])
    .map((w) => {
      const b = computeBoundingBoxFromVertices(w?.vertices || []);
      if (!b) return null;
      const c = boxCenter(b);
      return {
        text: String(w?.text || '').trim(),
        confidence: Number(w?.confidence || 0),
        box: b,
        cx: c.x,
        cy: c.y,
      };
    })
    .filter(Boolean);

  const visualMisses = [];
  const visualRegions = Array.isArray(rawData.symbolRegions) ? rawData.symbolRegions : [];
  for (const region of visualRegions) {
    const rBox = toBoxFromRegion(region);
    if (!rBox) continue;
    const rCenter = boxCenter(rBox);
    const matched = classifiedForOverlay.some((t) => {
      const iou = intersectionOverUnion(rBox, t.boundingBox);
      if (iou > 0.2) return true;
      const c = boxCenter(t.boundingBox);
      const inside =
        c.x >= rBox.minX && c.x <= rBox.maxX &&
        c.y >= rBox.minY && c.y <= rBox.maxY;
      return inside;
    });
    if (matched) continue;

    const padX = Math.max(3, (rBox.maxX - rBox.minX) * 0.12);
    const padY = Math.max(3, (rBox.maxY - rBox.minY) * 0.12);
    const inside = ocrWordTokens
      .filter((w) =>
        w.cx >= (rBox.minX - padX) &&
        w.cx <= (rBox.maxX + padX) &&
        w.cy >= (rBox.minY - padY) &&
        w.cy <= (rBox.maxY + padY)
      )
      .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));

    const normalizedParts = inside
      .map(w => String(w.text || '').replace(/[^A-Z0-9]/gi, '').toUpperCase())
      .filter(Boolean)
      .slice(0, 8);
    const candidateText = normalizedParts.join('-');
    const avgConfidence = inside.length
      ? +(inside.reduce((s, w) => s + (Number.isFinite(w.confidence) ? w.confidence : 0), 0) / inside.length).toFixed(3)
      : null;
    const xSpread = inside.length ? Math.max(...inside.map(w => w.cx)) - Math.min(...inside.map(w => w.cx)) : 0;
    const ySpread = inside.length ? Math.max(...inside.map(w => w.cy)) - Math.min(...inside.map(w => w.cy)) : 0;
    const layout = ySpread > xSpread * 1.2 ? 'vertical' : 'horizontal';

    if (inside.length === 0 || !candidateText) continue;
    visualMisses.push({
      id: String(region.id || `visual_miss_${visualMisses.length + 1}`),
      source: region.source || 'symbol_region',
      regionLabel: String(region.label || 'symbol'),
      typeHint: classifyAuditCandidate(candidateText, region.label),
      textCandidate: candidateText || null,
      wordCount: inside.length,
      confidence: avgConfidence,
      layout,
      center: { x: +rCenter.x.toFixed(1), y: +rCenter.y.toFixed(1) },
      boundingBox: {
        minX: Math.round(rBox.minX),
        minY: Math.round(rBox.minY),
        maxX: Math.round(rBox.maxX),
        maxY: Math.round(rBox.maxY),
      },
      position_pct: {
        x_pct: +((rBox.minX / pageW) * 100).toFixed(2),
        y_pct: +((rBox.minY / pageH) * 100).toFixed(2),
        w_pct: +(((rBox.maxX - rBox.minX) / pageW) * 100).toFixed(2),
        h_pct: +(((rBox.maxY - rBox.minY) / pageH) * 100).toFixed(2),
      },
      reason: 'Visual region has no classified tag overlap',
    });
  }

  const classifyOptions = Array.isArray(tagDictionary) ? { dictionary: tagDictionary } : {};
  const coverageGrouped = groupAdjacentWords(stage2NormalizedWords, {
    maxGapPx: 18,
    yOverlapThreshold: 0.45,
    enableVerticalGrouping: true,
    enableRotationGrouping: true,
  });
  // Carry vertices through classification so the coverage map can compute bbox
  // for the frontend "Missing structured" panel (fly-to + bulk-include).
  const groupedStructuredCandidates = classifyAll(
    coverageGrouped.map((g) => ({
      text: g.text,
      confidence: g.confidence,
      vertices: g.vertices,
      source: g.source || 'grouped',
      wordIndices: g.componentWordIndices || [],
    })),
    classifyOptions
  ).map((c, i) => ({ ...c, vertices: coverageGrouped[i]?.vertices || c.vertices }));
  const singleStructuredCandidates = stage2NormalizedWords
    .map((w) => {
      const cls = classifyTag(String(w?.text || ''), classifyOptions);
      if (!cls || !['instrument', 'equipment', 'line', 'drawing_ref', 'valve'].includes(cls.type)) return null;
      if (!isStrongStructuredCandidate(cls.text, cls.type)) return null;
      return {
        text: cls.text,
        type: cls.type,
        confidence: w?.confidence,
        source: 'raw_single',
        vertices: w?.vertices,
      };
    })
    .filter(Boolean);
  const structuredCoverageCandidates = [];
  const coverageDedupKeySet = new Set();
  const bboxKeyFromVertices = (verts) => {
    if (!Array.isArray(verts) || verts.length === 0) return 'no_bbox';
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const v of verts) {
      const x = Number(v?.x); const y = Number(v?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return 'no_bbox';
    return `${Math.round(minX)}:${Math.round(minY)}:${Math.round(maxX)}:${Math.round(maxY)}`;
  };

  function pushCoverageCandidate(c = {}, prefilterReason = null) {
    const text = String(c?.text || '').trim().toUpperCase();
    if (!text) return;
    const source = c.source || 'structured';
    const bboxKey = bboxKeyFromVertices(c?.vertices || []);
    const dedupKey = `${text}|${source}|${bboxKey}`;
    if (coverageDedupKeySet.has(dedupKey)) return;
    coverageDedupKeySet.add(dedupKey);
    structuredCoverageCandidates.push({
      text,
      type: c.type,
      source,
      vertices: c.vertices || null,
      confidence: Number(c?.confidence || 0),
      prefilterReason,
    });
  }

  for (const c of [...groupedStructuredCandidates, ...singleStructuredCandidates]) {
    pushCoverageCandidate(c, null);
  }
  for (const n of prefilterResult.filteredNoise || []) {
    const text = String(n?.text || '').trim().toUpperCase();
    if (!text) continue;
    const cls = classifyTag(text, classifyOptions);
    if (!cls || !['instrument', 'equipment', 'line', 'drawing_ref', 'valve'].includes(cls.type)) continue;
    if (!isStrongStructuredCandidate(cls.text, cls.type)) continue;
    pushCoverageCandidate({
      text,
      type: cls.type,
      source: 'prefiltered_word',
      vertices: n?.vertices || null,
      confidence: Number(n?.confidence || 0),
    }, n.reason);
  }

  const retainedTagSet = new Set(allTags.map(t => String(t.text || '').trim().toUpperCase()));
  const uncertainTagSet = new Set(allUncertain.map(t => String(t.text || '').trim().toUpperCase()));
  const noiseTagSet = new Set(allNoise.map(t => String(t.text || '').trim().toUpperCase()));
  const retainedTagMap = new Map(allTags.map(t => [String(t.text || '').trim().toUpperCase(), t]));
  const uncertainTagMap = new Map(allUncertain.map(t => [String(t.text || '').trim().toUpperCase(), t]));
  const noiseTagMap = new Map(allNoise.map(t => [String(t.text || '').trim().toUpperCase(), t]));
  const coveragePageW = rawData.pageWidth || 2400;
  const coveragePageH = rawData.pageHeight || 1700;
  const verticesToBboxAndPct = (verts) => {
    if (!Array.isArray(verts) || verts.length === 0) return { bbox: null, position_pct: null };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of verts) {
      const x = Number(v?.x); const y = Number(v?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return { bbox: null, position_pct: null };
    const bbox = { minX, minY, maxX, maxY };
    const position_pct = {
      x_pct: +((minX / coveragePageW) * 100).toFixed(3),
      y_pct: +((minY / coveragePageH) * 100).toFixed(3),
      w_pct: +(((maxX - minX) / coveragePageW) * 100).toFixed(3),
      h_pct: +(((maxY - minY) / coveragePageH) * 100).toFixed(3),
    };
    return { bbox, position_pct };
  };
  const missingFromCleaned = [];
  const missingByType = { instrument: 0, equipment: 0, line: 0, drawing_ref: 0 };
  const missingByReason = {};
  const coverageByType = {};
  const coverageByReason = {};
  const candidateLedger = [];
  const promotedCoverageUncertain = [];
  let keptCount = 0;
  let uncertainCount = 0;
  let rejectedCount = 0;

  function ensureTypeBucket(type = 'unknown') {
    const t = String(type || 'unknown');
    if (!coverageByType[t]) coverageByType[t] = { kept: 0, uncertain: 0, rejected: 0 };
    return t;
  }

  // Phase 1.5 — honor reason_code already set upstream (integrity filter,
  // fragment suppressor) so the ledger preserves the most specific reason.
  // matchedNoiseItem may carry { reason_code: 'REJECT_PATTERN_INVALID' | 'REJECT_DEDUP_SUPERSEDED' | ... }.
  function rejectReasonCode(candidate = {}, matchedNoiseItem = null) {
    const upstream = String(matchedNoiseItem?.reason_code || '').trim();
    if (upstream && upstream.startsWith('REJECT_')) return upstream;
    if (noiseTagSet.has(candidate.text)) return 'REJECT_AI_REJECTED';
    if (candidate.prefilterReason?.startsWith('zone_exclude')) return 'REJECT_ZONE_SUPPRESSED';
    if (candidate.prefilterReason) return 'REJECT_ZONE_SUPPRESSED';
    if (candidate.source === 'raw_single') return 'REJECT_ASSEMBLY_CONFLICT';
    return 'REJECT_ASSEMBLY_CONFLICT';
  }

  function toLegacyReason(reasonCode = '') {
    if (reasonCode === 'REJECT_AI_REJECTED') return 'ai_rejected';
    if (reasonCode === 'REJECT_ZONE_SUPPRESSED') return 'zone_suppressed';
    if (reasonCode === 'REJECT_ASSEMBLY_CONFLICT') return 'grouping_failed';
    if (reasonCode === 'REJECT_DEDUP_SUPERSEDED') return 'dedup_superseded';
    return 'rejected';
  }
  const keptRemainingByText = new Map();
  const uncertainRemainingByText = new Map();
  for (const t of allTags) {
    const text = String(t?.text || '').trim().toUpperCase();
    if (!text) continue;
    keptRemainingByText.set(text, (keptRemainingByText.get(text) || 0) + 1);
  }
  for (const t of allUncertain) {
    const text = String(t?.text || '').trim().toUpperCase();
    if (!text) continue;
    uncertainRemainingByText.set(text, (uncertainRemainingByText.get(text) || 0) + 1);
  }
  function consumeRemaining(map, text) {
    const left = Number(map.get(text) || 0);
    if (left <= 0) return false;
    map.set(text, left - 1);
    return true;
  }

  for (const candidate of structuredCoverageCandidates) {
    const text = String(candidate.text || '').trim().toUpperCase();
    const type = candidate.type || 'unknown';
    const typeBucket = ensureTypeBucket(type);
    const { bbox, position_pct } = verticesToBboxAndPct(candidate.vertices);
    let terminal_outcome = 'rejected';
    let reason_code = 'REJECT_ASSEMBLY_CONFLICT';
    let reason = 'grouping_failed';
    let confidence_final = 0.5;
    let matchedItem = null;

    const consumedKept = consumeRemaining(keptRemainingByText, text);
    const consumedUncertain = consumedKept ? false : consumeRemaining(uncertainRemainingByText, text);
    if (consumedKept) {
      terminal_outcome = 'kept';
      matchedItem = retainedTagMap.get(text) || null;
      confidence_final = Number(matchedItem?.confidence || candidate.confidence || 0.8);
      reason_code = String(matchedItem?.source || '').includes('deterministic')
        ? 'KEPT_DETERMINISTIC_STRONG'
        : 'KEPT_AI_CONFIRMED';
      reason = reason_code;
      keptCount++;
      coverageByType[typeBucket].kept++;
    } else if (consumedUncertain) {
      terminal_outcome = 'uncertain';
      matchedItem = uncertainTagMap.get(text) || null;
      confidence_final = Number(matchedItem?.confidence || candidate.confidence || 0.6);
      reason_code = String(matchedItem?.source || '').includes('coverage_rescue')
        ? 'UNCERTAIN_LOW_CONFIDENCE'
        : 'UNCERTAIN_COMPETING_HYPOTHESES';
      reason = reason_code;
      uncertainCount++;
      coverageByType[typeBucket].uncertain++;
    } else {
      matchedItem = noiseTagMap.get(text) || null;
      confidence_final = Number(matchedItem?.confidence || candidate.confidence || 0.5);
      reason_code = (retainedTagSet.has(text) || uncertainTagSet.has(text))
        ? 'REJECT_DEDUP_SUPERSEDED'
        : rejectReasonCode(candidate, matchedItem);
      const structuredCheckType = String(type || '').toLowerCase() === 'valve' ? 'instrument' : type;
      const isStrongStructuredConflict =
        reason_code === 'REJECT_ASSEMBLY_CONFLICT' &&
        isStrongStructuredCandidate(text, structuredCheckType);

      if (isStrongStructuredConflict) {
        terminal_outcome = 'uncertain';
        reason_code = 'UNCERTAIN_COMPETING_HYPOTHESES';
        reason = reason_code;
        uncertainCount++;
        coverageByType[typeBucket].uncertain++;
        promotedCoverageUncertain.push({
          text,
          type,
          confidence: +Number(confidence_final || candidate.confidence || 0.55).toFixed(3),
          reason: 'Promoted from assembly conflict for human review',
          source: 'coverage_promoted_uncertain',
          boundingBox: bbox
            ? {
                minX: Math.round(bbox.minX),
                minY: Math.round(bbox.minY),
                maxX: Math.round(bbox.maxX),
                maxY: Math.round(bbox.maxY),
              }
            : null,
          position_pct,
        });
      } else {
        reason = toLegacyReason(reason_code);
        rejectedCount++;
        coverageByType[typeBucket].rejected++;
        missingFromCleaned.push({
          text,
          type,
          source: candidate.source,
          reason,
          reason_code,
          // Geometry — enables fly-to + paint in the review UI.
          bbox,
          position_pct,
        });
        if (missingByType[type] != null) missingByType[type]++;
        missingByReason[reason] = (missingByReason[reason] || 0) + 1;
      }
    }

    coverageByReason[reason_code] = (coverageByReason[reason_code] || 0) + 1;
    candidateLedger.push({
      candidate_id: `cand_${candidateLedger.length + 1}`,
      text,
      type,
      source: candidate.source || 'structured',
      terminal_outcome,
      reason_code,
      confidence_final: +Number(confidence_final).toFixed(3),
      bbox,
      position_pct,
    });
  }

  if (promotedCoverageUncertain.length > 0) {
    const existingKeys = new Set(
      [...allTags, ...allUncertain].map((t) => String(t?.text || '').trim().toUpperCase())
    );
    for (const item of promotedCoverageUncertain) {
      const key = String(item?.text || '').trim().toUpperCase();
      if (!key || existingKeys.has(key)) continue;
      const c = Number(item.confidence || 0);
      if (c >= autoApproveThreshold) item.automationDecision = 'auto_approve';
      else if (c >= reviewThreshold) item.automationDecision = 'human_review';
      else item.automationDecision = 'auto_reject';
      allUncertain.push(item);
      existingKeys.add(key);
    }
  }

  const candidateUniverseCount = structuredCoverageCandidates.length;
  const unexplainedDrops = Math.max(0, candidateUniverseCount - (keptCount + uncertainCount + rejectedCount));

  // Phase 1.5 — mass-conservation guard.
  // Every structured candidate must land in exactly one of {kept, uncertain, rejected}.
  // In strict mode (env OCR_STRICT_MASS_CONSERVATION=true) we throw so CI fixtures
  // catch silent drops at build time; otherwise we warn loudly so production keeps
  // running but the issue is visible in logs and coverageReport.
  if (unexplainedDrops > 0) {
    const msg = `[Stage2 AI] Mass conservation broken: universe=${candidateUniverseCount}, kept=${keptCount}, uncertain=${uncertainCount}, rejected=${rejectedCount}, unexplained=${unexplainedDrops}`;
    if (boolFlag(process.env.OCR_STRICT_MASS_CONSERVATION, false)) {
      throw new Error(msg);
    }
    console.warn(msg);
  }
  // Phase 1.5 — audit reason code registry. Any reason_code outside the canonical
  // set surfaces as a warning so legacy 'regex_failed' / 'grouping_failed' literals
  // can be spotted in any new code path. Keep canonical list in sync with
  // database/migrations/017_ocr_candidate_ledger.sql ocr_reason_code seed.
  const CANONICAL_REASON_CODES = new Set([
    'KEPT_DETERMINISTIC_STRONG',
    'KEPT_AI_CONFIRMED',
    'UNCERTAIN_LOW_CONFIDENCE',
    'UNCERTAIN_COMPETING_HYPOTHESES',
    'REJECT_PATTERN_INVALID',
    'REJECT_PARTIAL_FRAGMENT',
    'REJECT_ZONE_SUPPRESSED',
    'REJECT_AI_REJECTED',
    'REJECT_DEDUP_SUPERSEDED',
    'REJECT_ASSEMBLY_CONFLICT',
    'REJECT_NO_GEOMETRY',
  ]);
  const nonCanonicalReasons = Object.keys(coverageByReason).filter(r => !CANONICAL_REASON_CODES.has(r));
  if (nonCanonicalReasons.length > 0) {
    console.warn(`[Stage2 AI] Non-canonical reason codes emitted: ${nonCanonicalReasons.join(', ')}`);
  }

  const coverageReport = {
    // New accounting model (ledger-based, single universe).
    candidateUniverseCount,
    keptCount,
    uncertainCount,
    rejectedCount,
    byReason: coverageByReason,
    byType: coverageByType,
    unexplainedDrops,
    // Legacy compatibility fields.
    rawStructuredCandidateCount: candidateUniverseCount,
    retainedStructuredCount: keptCount,
    uncertainStructuredCount: uncertainCount,
    missingStructuredCount: missingFromCleaned.length,
    missingByType,
    missingByReason,
    prefilteredWordCount: prefilterResult.filteredNoise.length,
    missingFromCleaned: missingFromCleaned.slice(0, 250),
    candidateLedger: candidateLedger.slice(0, 500),
    // Phase 1 audit metadata.
    nonCanonicalReasons,
    integrityFilter: {
      reclassifiedCount: integrity?.reclassifiedCount || 0,
      dictionaryRescuedCount: integrity?.dictionaryRescuedCount || 0,
      learnedRescuedCount: integrity?.learnedRescuedCount || 0,
    },
    deterministicStrong: {
      promotedCount: recoveredDeterministic.length,
      competingCount: promotedCompeting.length,
    },
  };

  // Build final result
  const result = {
    tags: allTags,
    noise: allNoise,
    uncertain: allUncertain,
    stats: {
      totalWords: originalWords.length,
      rawInputWords: Array.isArray(rawData.words) ? rawData.words.length : 0,
      normalizedInputWords: originalWords.length,
      regionFusionAddedWords: stage2Fusion.addedWords || 0,
      symbolRegionCount: Array.isArray(rawData.symbolRegions) ? rawData.symbolRegions.length : 0,
      tagsFound: allTags.length,
      noiseFiltered: allNoise.length,
      uncertainCount: allUncertain.length,
      equipmentCount: allTags.filter(t => t.type === 'equipment').length,
      instrumentCount: allTags.filter(t => t.type === 'instrument').length,
      lineCount: allTags.filter(t => t.type === 'line').length,
      drawingRefCount: allTags.filter(t => t.type === 'drawing_ref').length,
      continuationReferenceCount: continuationReferences.length,
      deterministicRecoveredCount: recoveredDeterministic.length,
      groupedCandidateCount: groupedCandidatesForPrompt.length,
      weakTypedReclassifiedCount: integrity.reclassifiedCount,
      geometryDedupedCount: Math.max(0, tagsBeforeDedup - tagsAfterGeometryDedup),
      fragmentSuppressedCount: Math.max(0,
        (beforeFragSuppress.tags + beforeFragSuppress.uncertain + beforeFragSuppress.noise) -
        (allTags.length + allUncertain.length + allNoise.length)
      ),
      coverageRescuedCount,
      phaseProfile,
      phaseConfig: {
        includeGroupedCandidatesInPrompt,
        enableDeterministicPromotion,
        enableCoverageRescue,
      },
      rawStructuredCandidateCount: coverageReport.rawStructuredCandidateCount,
      missingStructuredCount: coverageReport.missingStructuredCount,
      visualRegionCount: visualRegions.length,
      visualMissCount: visualMisses.length,
      visualVerticalMissCount: visualMisses.filter(m => m.layout === 'vertical').length,
      automation: {
        autoApproveThreshold,
        reviewThreshold,
        autoApproveCount,
        humanReviewCount,
        autoRejectCount,
      },
    },
    pageWidth: pageW,
    pageHeight: pageH,
    model,
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    continuationReferences,
    candidateLedger: coverageReport.candidateLedger,
    coverageReport,
    visualAudit: {
      regions: visualRegions,
      misses: visualMisses,
      summary: {
        regionsTotal: visualRegions.length,
        missesTotal: visualMisses.length,
        verticalMisses: visualMisses.filter(m => m.layout === 'vertical').length,
      },
    },
    documentMetadata: extractDocumentMetadata(rawData.fullText || '', drawingNumber),
    classifiedAt: new Date().toISOString(),
    summary: allTags.length > 0
      ? `Found ${allTags.length} tags from ${originalWords.length} words. Equipment: ${allTags.filter(t => t.type === 'equipment').length}, Instruments: ${allTags.filter(t => t.type === 'instrument').length}, Lines: ${allTags.filter(t => t.type === 'line').length}, Drawing refs: ${allTags.filter(t => t.type === 'drawing_ref').length}. Filtered ${allNoise.length} noise, ${allUncertain.length} uncertain.`
      : 'No tags classified.',
  };

  return result;
}

/**
 * Run the full OCR pipeline for a P&ID.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} pnidId - P&ID UUID
 * @param {import('../storage/StorageProvider.js').default} storageProvider
 * @param {object} [options]
 * @param {string} [options.credentialsJson] - GCS/Vision credentials
 * @param {string} [options.ocrProvider] - 'google' (default), 'claude', 'both', 'paddle', or 'florence'
 * @param {string} [options.claudeApiKey] - Claude API key (required when ocrProvider is 'claude' or 'both')
 * @param {string} [options.claudeModel] - Claude model (optional, defaults to claude-sonnet-4-20250514)
 * @returns {Promise<{ jobId: string }>}
 */
export async function runOcrPipeline(prisma, pnidId, storageProvider, options = {}) {
  const providerChoice = options.ocrProvider || 'google';

  // 1. Create job record
  const [job] = await prisma.$queryRaw`
    INSERT INTO ocr_job (pnid_id, status, started_at, created_by)
    VALUES (${pnidId}::uuid, 'processing', NOW(), 'system')
    RETURNING id
  `;
  const jobId = job.id;

  try {
    // 2. Get P&ID record and its storage key
    const pnid = await prisma.pnid.findUnique({
      where: { id: pnidId },
      select: { id: true, storage_key: true, drawing_number: true, active_version_id: true },
    });

    // 3. Determine if file is a PDF or raster image
    const isPdf = pnid?.storage_key?.toLowerCase().endsWith('.pdf');
    const isGcs = storageProvider.type === 'gcs';

    // 4. Download the file buffer (needed for Claude Vision and raster Google Vision)
    let fileBuffer = null;
    if (pnid?.storage_key) {
      try {
        const downloaded = await storageProvider.download(pnid.storage_key);
        fileBuffer = downloaded.buffer || downloaded;
      } catch (downloadErr) {
        console.error(`[OcrPipeline] File download failed for ${pnid.storage_key}: ${downloadErr.message}`);
      }
    }

    // 5. Run OCR with selected provider
    let ocrResult;

    if (providerChoice === 'claude') {
      // ═══ CLAUDE VISION PROVIDER ═══
      ocrResult = await _runClaudeVision(fileBuffer, isPdf, options);
    } else if (providerChoice === 'paddle') {
      // ═══ PADDLE OCR PROVIDER ═══
      ocrResult = await _runPaddleVision(fileBuffer, isPdf, options);
    } else if (providerChoice === 'florence') {
      // ═══ FLORENCE-2 OCR PROVIDER ═══
      ocrResult = await _runFlorenceVision(fileBuffer, isPdf, options);
    } else if (providerChoice === 'both') {
      // ═══ BOTH PROVIDERS — merge results ═══
      const [googleResult, claudeResult] = await Promise.allSettled([
        _runGoogleVision(fileBuffer, isPdf, isGcs, pnid, storageProvider, options),
        _runClaudeVision(fileBuffer, isPdf, options),
      ]);

      const gResult = googleResult.status === 'fulfilled' ? googleResult.value : { words: [], fullText: '' };
      const cResult = claudeResult.status === 'fulfilled' ? claudeResult.value : { words: [], fullText: '' };

      console.log(`[OcrPipeline] Merging results: Google=${gResult.words.length} words, Claude=${cResult.words.length} words`);

      // Merge: use Google words as base, add Claude words that aren't duplicates
      const googleTexts = new Set(gResult.words.map(w => w.text.toUpperCase().replace(/\s+/g, '')));
      const uniqueClaudeWords = cResult.words.filter(w =>
        !googleTexts.has(w.text.toUpperCase().replace(/\s+/g, ''))
      );

      ocrResult = {
        words: [...gResult.words, ...uniqueClaudeWords],
        fullText: gResult.fullText || cResult.fullText,
        pageWidth: gResult.pageWidth || cResult.pageWidth || 2400,
        pageHeight: gResult.pageHeight || cResult.pageHeight || 1700,
      };
    } else {
      // ═══ GOOGLE VISION (default) ═══
      ocrResult = await _runGoogleVision(fileBuffer, isPdf, isGcs, pnid, storageProvider, options);
    }

    ocrResult.words = normalizeWordsByProvider(ocrResult.words || [], providerChoice);

    if (ocrResult.words.length === 0) {
      await updateJob(prisma, jobId, 'completed', {
        totalWords: 0, tagsFound: 0, tagsMatched: 0,
      });
      return { jobId };
    }

    const pageWidth = ocrResult.pageWidth || 1;
    const pageHeight = ocrResult.pageHeight || 1;

    // 5. Group adjacent words (reassemble split tags)
    const grouped = groupAdjacentWords(ocrResult.words, resolveGroupingOptions(options));

    // Also try individual words (some tags come as single words)
    const allCandidates = [...grouped, ...ocrResult.words];

    // 5b. Load client-specific tag dictionary (if configured for this platform)
    let dictionary = [];
    try {
      // Resolve platform_id from P&ID → system → platform chain
      const [pnidSystem] = await prisma.$queryRaw`
        SELECT s.platform_id FROM pnid_system ps
        JOIN system s ON s.id = ps.system_id
        WHERE ps.pnid_id = ${pnidId}::uuid LIMIT 1
      `;
      if (pnidSystem?.platform_id) {
        dictionary = await getDictionary(prisma, pnidSystem.platform_id);
      }
    } catch {
      // Dictionary is optional — continue with generic classification
    }

    // 6. Classify tags (dictionary-aware if available)
    const classified = classifyAll(allCandidates, { dictionary });

    // 6b. Also keep UNCLASSIFIED candidates that look like potential tags
    //     (3+ chars, not pure numbers, not single letter) so AI cleanup can evaluate them.
    //     Without this, the regex filter silently drops valid tags the AI never sees.
    const classifiedTexts = new Set(classified.map(c => c.text));
    const unclassified = allCandidates
      .filter(w => {
        const t = (w.text || '').trim().toUpperCase().replace(/\s+/g, '');
        // Skip if already classified, too short, pure numbers, or pure whitespace
        if (classifiedTexts.has(t)) return false;
        if (t.length < 3) return false;
        if (/^\d+$/.test(t)) return false;
        // Skip obvious noise: single letters, common drawing text
        if (/^[A-Z]$/.test(t)) return false;
        // Keep anything that has letters + numbers (potential tag)
        // or has a dash (potential structured tag)
        return /[A-Z]/.test(t) && (/\d/.test(t) || t.includes('-'));
      })
      .map(w => ({
        ...w,
        text: (w.text || '').trim().toUpperCase().replace(/\s+/g, ''),
        type: 'unknown',
        source: 'candidate',
      }));

    const allTags = [...classified, ...unclassified];

    // Deduplicate — prefer groups over individual words at same location
    const deduped = deduplicateTags(allTags);

    // 7. Match against database entities (only for classified tags)
    const matched = await matchTagsToEntities(prisma, pnidId, deduped);

    // 8. Clear previous extractions for this P&ID
    await prisma.$queryRaw`
      DELETE FROM ocr_extraction WHERE pnid_id = ${pnidId}::uuid
    `;

    // 9. Store results in ocr_extraction staging table
    for (const tag of matched) {
      const pct = verticesToPct(tag.vertices, tag.pageWidth || pageWidth, tag.pageHeight || pageHeight);
      const px = verticesToPixels(tag.vertices);

      const versionIdSql = pnid.active_version_id
        ? Prisma.sql`${pnid.active_version_id}::uuid`
        : Prisma.sql`NULL`;
      const entityIdSql = tag.matchedEntityId
        ? Prisma.sql`${tag.matchedEntityId}::uuid`
        : Prisma.sql`NULL`;

      await prisma.$queryRaw`
        INSERT INTO ocr_extraction (
          pnid_id, pnid_version_id, extracted_text, tag_type, confidence,
          bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct,
          bbox_x_px, bbox_y_px, bbox_w_px, bbox_h_px,
          matched_entity_id, match_confidence, match_method,
          image_width_px, image_height_px, status
        ) VALUES (
          ${pnidId}::uuid,
          ${versionIdSql},
          ${tag.text},
          ${tag.type},
          ${tag.confidence || 0},
          ${pct.x_pct}, ${pct.y_pct}, ${pct.w_pct}, ${pct.h_pct},
          ${px.x_px}, ${px.y_px}, ${px.w_px}, ${px.h_px},
          ${entityIdSql},
          ${tag.matchConfidence || 0},
          ${tag.matchMethod || null},
          ${tag.pageWidth || pageWidth},
          ${tag.pageHeight || pageHeight},
          'pending'
        )
      `;
    }

    // 10. Store raw OCR output to storage for debugging
    try {
      if (!pnid.storage_key) throw new Error('No storage key — skip debug output');
      const ocrOutputKey = pnid.storage_key.replace(/\.[^.]+$/, '_ocr_output.json');
      await storageProvider.upload(
        Buffer.from(JSON.stringify({
          fullText: ocrResult.fullText,
          wordCount: ocrResult.words.length,
          groupedCount: grouped.length,
          classifiedCount: classified.length,
          matchedCount: matched.filter(m => m.matchedEntityId).length,
          extractedAt: new Date().toISOString(),
        }, null, 2)),
        ocrOutputKey,
        { contentType: 'application/json' }
      );

      // 10b. Store full word-level data with bounding boxes for coordinate recovery
      const ocrWordsKey = pnid.storage_key.replace(/\.[^.]+$/, '_ocr_words.json');
      await storageProvider.upload(
        Buffer.from(JSON.stringify({
          pageWidth,
          pageHeight,
          words: matched.map(tag => ({
            text: tag.text,
            type: tag.type,
            confidence: tag.confidence || 0,
            matchedEntityId: tag.matchedEntityId || null,
            vertices: tag.vertices,
            bbox: verticesToPct(tag.vertices, tag.pageWidth || pageWidth, tag.pageHeight || pageHeight),
            bboxPx: verticesToPixels(tag.vertices),
          })),
          extractedAt: new Date().toISOString(),
        }, null, 2)),
        ocrWordsKey,
        { contentType: 'application/json' }
      );
    } catch (_e) {
      // Non-critical — don't fail the pipeline
    }

    // 11. Update job with stats
    await updateJob(prisma, jobId, 'completed', {
      totalWords: ocrResult.words.length,
      tagsFound: deduped.length,
      tagsMatched: matched.filter(m => m.matchedEntityId).length,
    });

    return { jobId };
  } catch (err) {
    await updateJob(prisma, jobId, 'failed', {
      totalWords: 0, tagsFound: 0, tagsMatched: 0,
      errorMessage: err.message,
    });
    throw err;
  }
}

/**
 * Run Google Vision OCR on file buffer.
 */
async function _runGoogleVision(fileBuffer, isPdf, isGcs, pnid, storageProvider, options) {
  if (isPdf && isGcs) {
    try {
      const provider = new VisionOCRProvider(
        options.credentialsJson || storageProvider.config?.credentials_json || null
      );
      const gcsInputUri = `gs://${storageProvider.bucketName}/${storageProvider._fullKey(pnid.storage_key)}`;
      const gcsOutputPrefix = `gs://${storageProvider.bucketName}/${storageProvider._fullKey(`ocr-output/${pnid.id}/`)}`;

      console.log(`[OcrPipeline] PDF detected, using async GCS flow: ${gcsInputUri}`);
      const { outputUri } = await provider.extractFromPdf(gcsInputUri, gcsOutputPrefix);
      return await provider.parseAsyncResults(storageProvider, outputUri);
    } catch (pdfErr) {
      console.error(`[OcrPipeline] PDF async OCR failed: ${pdfErr.message}`);
      return { words: [], fullText: '', pageWidth: 0, pageHeight: 0 };
    }
  } else {
    try {
      const provider = new VisionOCRProvider(
        options.credentialsJson || storageProvider.config?.credentials_json || null
      );
      if (!fileBuffer) throw new Error('No image to process');
      return await provider.extractFromImage(fileBuffer);
    } catch (visionErr) {
      console.log(`Vision API unavailable (${visionErr.message}), using mock OCR provider`);
      return { words: [], fullText: '', pageWidth: 0, pageHeight: 0 };
    }
  }
}

/**
 * Run Claude Vision OCR on file buffer.
 */
async function _runClaudeVision(fileBuffer, isPdf, options) {
  if (!options.claudeApiKey) {
    throw new Error('Claude API key required for Claude Vision OCR provider');
  }
  if (!fileBuffer) {
    throw new Error('No file buffer to process with Claude Vision');
  }

  const provider = new ClaudeVisionOCRProvider(options.claudeApiKey, {
    model: options.claudeModel,
  });

  console.log(`[OcrPipeline] Using Claude Vision OCR (isPdf=${isPdf})`);

  if (isPdf) {
    return await provider.extractFromPdf(fileBuffer);
  } else {
    return await provider.extractFromImage(fileBuffer);
  }
}

/**
 * Run Paddle OCR on file buffer.
 */
async function _runPaddleVision(fileBuffer, isPdf, options) {
  if (!fileBuffer) {
    throw new Error('No file buffer to process with Paddle OCR');
  }

  const provider = new PaddleOCRProvider({
    endpointUrl: options.paddleEndpointUrl,
    apiKey: options.paddleApiKey,
    timeoutMs: options.paddleTimeoutMs,
  });

  console.log(`[OcrPipeline] Using Paddle OCR (isPdf=${isPdf})`);
  return isPdf
    ? provider.extractFromPdf(fileBuffer)
    : provider.extractFromImage(fileBuffer);
}

/**
 * Run Florence OCR on file buffer.
 */
async function _runFlorenceVision(fileBuffer, isPdf, options) {
  if (!fileBuffer) {
    throw new Error('No file buffer to process with Florence OCR');
  }

  const provider = new FlorenceOCRProvider({
    endpointUrl: options.florenceEndpointUrl,
    apiKey: options.florenceApiKey,
    timeoutMs: options.florenceTimeoutMs,
  });

  console.log(`[OcrPipeline] Using Florence OCR (isPdf=${isPdf})`);
  return isPdf
    ? provider.extractFromPdf(fileBuffer)
    : provider.extractFromImage(fileBuffer);
}

/**
 * Update job record.
 */
async function updateJob(prisma, jobId, status, stats) {
  await prisma.$queryRaw`
    UPDATE ocr_job SET
      status = ${status},
      total_words = ${stats.totalWords || 0},
      tags_found = ${stats.tagsFound || 0},
      tags_matched = ${stats.tagsMatched || 0},
      completed_at = NOW(),
      error_message = ${stats.errorMessage || null}
    WHERE id = ${jobId}::uuid
  `;
}

/**
 * Approve OCR extractions and write to junction tables.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} pnidId
 * @param {Array<string>} extractionIds - IDs to approve
 * @returns {Promise<{ approved: number }>}
 */
export async function approveExtractions(prisma, pnidId, extractionIds, options = {}) {
  const { skipStatusCheck = false } = options;
  let approved = 0;

  const extractions = skipStatusCheck
    ? await prisma.$queryRaw`
        SELECT id, extracted_text, tag_type, matched_entity_id,
               bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        FROM ocr_extraction
        WHERE pnid_id = ${pnidId}::uuid
          AND id = ANY(${extractionIds}::uuid[])
          AND matched_entity_id IS NOT NULL
      `
    : await prisma.$queryRaw`
        SELECT id, extracted_text, tag_type, matched_entity_id,
               bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct
        FROM ocr_extraction
        WHERE pnid_id = ${pnidId}::uuid
          AND id = ANY(${extractionIds}::uuid[])
          AND matched_entity_id IS NOT NULL
          AND status = 'pending'
      `;

  for (const ext of extractions) {
    try {
      if (ext.tag_type === 'equipment') {
        await prisma.pnid_equipment.upsert({
          where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: ext.matched_entity_id } },
          create: {
            pnid_id: pnidId,
            equipment_id: ext.matched_entity_id,
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
            annotation_w_pct: ext.bbox_w_pct,
            annotation_h_pct: ext.bbox_h_pct,
            position_verified: true,
          },
          update: {
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
            annotation_w_pct: ext.bbox_w_pct,
            annotation_h_pct: ext.bbox_h_pct,
            position_verified: true,
          },
        });
      } else if (ext.tag_type === 'instrument') {
        await prisma.pnid_instrument.upsert({
          where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: ext.matched_entity_id } },
          create: {
            pnid_id: pnidId,
            instrument_id: ext.matched_entity_id,
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
            annotation_w_pct: ext.bbox_w_pct,
            annotation_h_pct: ext.bbox_h_pct,
            position_verified: true,
          },
          update: {
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
            annotation_w_pct: ext.bbox_w_pct,
            annotation_h_pct: ext.bbox_h_pct,
            position_verified: true,
          },
        });
      } else if (ext.tag_type === 'line') {
        await prisma.pnid_line.upsert({
          where: { pnid_id_line_id: { pnid_id: pnidId, line_id: ext.matched_entity_id } },
          create: {
            pnid_id: pnidId,
            line_id: ext.matched_entity_id,
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
          },
          update: {
            annotation_x_pct: ext.bbox_x_pct,
            annotation_y_pct: ext.bbox_y_pct,
          },
        });
      }

      // Mark extraction as approved
      await prisma.$queryRaw`
        UPDATE ocr_extraction
        SET status = 'approved', reviewed_at = NOW(), reviewed_by = 'admin'
        WHERE id = ${ext.id}::uuid
      `;

      approved++;
    } catch (err) {
      // Log but continue — one failure shouldn't block others
      console.error(`Failed to approve extraction ${ext.id}:`, err.message);
    }
  }

  return { approved };
}

/**
 * Compute a coarse position bucket key for a tag so that the same tag text
 * appearing at genuinely different locations on the drawing is preserved
 * rather than collapsed into a single row.
 *
 * Bucket size = ~5% of page dimensions. Tags whose centroids fall in the
 * same bucket are treated as the same physical detection (OCR-vs-grouped
 * duplicates). Tags in different buckets stay as separate extractions.
 *
 * Returns null when no usable geometry is available, signalling "fall back
 * to text-only dedup" — better than inventing a fake position.
 */
function positionBucketKey(tag) {
  const verts = Array.isArray(tag.vertices) ? tag.vertices : null;
  if (!verts || verts.length === 0) return null;

  const xs = verts.map(v => Number(v.x) || 0);
  const ys = verts.map(v => Number(v.y) || 0);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;

  const pageW = Number(tag.pageWidth) || 0;
  const pageH = Number(tag.pageHeight) || 0;

  if (pageW > 0 && pageH > 0) {
    // 5% buckets in percent space — two tags within the same 5% cell collapse.
    const bx = Math.round((cx / pageW) * 20);
    const by = Math.round((cy / pageH) * 20);
    return `${bx}:${by}`;
  }

  // No page size → bucket by raw pixel centroid at 50-px cells.
  return `${Math.round(cx / 50)}:${Math.round(cy / 50)}`;
}

/**
 * Deduplicate classified tags — prefer grouped tags over individual words
 * AT THE SAME POSITION. Same text at different positions is kept separate
 * (line numbers repeated along a pipe, cross-refs, etc.) — otherwise we
 * silently lose real detections.
 */
function deduplicateTags(tags) {
  const seen = new Map();

  for (const tag of tags) {
    const posKey = positionBucketKey(tag);
    // When we have geometry, dedup within (text, position) bucket.
    // Without geometry, fall back to text-only to avoid duplicate clutter.
    const key = posKey ? `${tag.text}@${posKey}` : tag.text;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, tag);
    } else {
      // Prefer the one with more words (grouped) or higher confidence
      if ((tag.wordCount || 1) > (existing.wordCount || 1) ||
          (tag.confidence || 0) > (existing.confidence || 0)) {
        seen.set(key, tag);
      }
    }
  }

  return [...seen.values()];
}
