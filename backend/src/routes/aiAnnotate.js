import sharp from 'sharp';
import prisma from '../db.js';
import { getStorageProvider } from '../services/storage/index.js';
import VisionOCRProvider from '../services/ocr/VisionOCRProvider.js';
import { saveProfile, getProfile, listProfiles, updateProfileStats } from '../services/ai/DetectionKnowledgeService.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_AUTHOR_ID = '00000000-0000-0000-0000-000000000001';
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Debug / diagnostic helpers
// ---------------------------------------------------------------------------
const DEBUG_DIR = path.join(os.tmpdir(), 'ai-annotate-debug');

function isDebugEnabled() {
  return ['1', 'true', 'yes'].includes(String(process.env.AI_ANNOTATE_DEBUG || '').toLowerCase());
}

async function ensureDebugDir() {
  await fs.mkdir(DEBUG_DIR, { recursive: true });
  return DEBUG_DIR;
}

/**
 * Draw bounding rectangles on an image for visual debugging.
 * Uses sharp composite with SVG overlay — no native canvas dependency.
 * @param {Buffer} imageBuffer - PNG image buffer
 * @param {Array<{x:number,y:number,w:number,h:number,color?:string,label?:string}>} rects
 * @param {string} outputPath - file path to save the annotated image
 */
async function saveImageWithRects(imageBuffer, rects, outputPath) {
  const meta = await sharp(imageBuffer).metadata();
  const svgParts = rects.map((r, i) => {
    const color = r.color || '#FF0000';
    const label = r.label || `${i}`;
    const fontSize = Math.max(10, Math.min(16, Math.round(r.h * 0.6)));
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${color}" stroke-width="2"/>` +
           `<text x="${r.x + 2}" y="${r.y - 3}" fill="${color}" font-size="${fontSize}" font-family="monospace">${label}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${svgParts.join('')}</svg>`;
  await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);
  console.log(`[ai-debug] Saved annotated image: ${outputPath} (${rects.length} rects)`);
}

/**
 * Save an individual OCR crop for inspection.
 */
async function saveOcrCrop(cropBuffer, index, tag, outputDir) {
  const filename = `ocr-crop-${index}-${(tag || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_')}.png`;
  const filepath = path.join(outputDir, filename);
  await fs.writeFile(filepath, cropBuffer);
  return filepath;
}

function isPilotEnabled() {
  const value = String(process.env.AI_ANNOTATE_PILOT_ENABLED || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function hasTrexConfig(config = null) {
  const endpoint = config?.provider === 'trex2' ? (config.endpointUrl || null) : (process.env.TREX2_API_URL || null);
  const token = config?.provider === 'trex2' ? (config.token || null) : (process.env.TREX2_API_KEY || null);
  return !!endpoint && !!token;
}

function hasGroundingConfig(config = null) {
  if (config?.provider === 'grounding_dino' && config.endpointUrl) return true;
  // Check DB-stored separate GroundingDINO config (from admin UI)
  if (config?._groundingUrl) return true;
  if (process.env.GROUNDING_DINO_API_URL) return true;
  // GroundingDINO is available on the same DDS Cloud API as T-Rex2 — same key, different endpoint.
  // If T-Rex2 is configured via DDS, we can derive the GroundingDINO endpoint automatically.
  if (config?.provider === 'trex2' && config.endpointUrl && config.token && isDdsTaskEndpoint(config.endpointUrl)) return true;
  if (process.env.TREX2_API_URL && process.env.TREX2_API_KEY && isDdsTaskEndpoint(process.env.TREX2_API_URL)) return true;
  return false;
}

/**
 * Derive the GroundingDINO DDS endpoint URL from the T-Rex2 endpoint.
 * DDS Cloud API canonical paths:
 *   T-Rex:         /v2/task/trex/detection   (also /v2/task/trex2/infer/detect on older API)
 *   GroundingDINO: /v2/task/grounding_dino/detection
 */
function deriveGroundingDinoEndpoint(trexUrl) {
  if (!trexUrl) return null;
  const base = String(trexUrl).replace(/\/v2\/task\/.*$/, '');
  return `${base}/v2/task/grounding_dino/detection`;
}

/**
 * Get GroundingDINO endpoint + token + model.
 * Priority: 1) DB grounding_* columns, 2) env vars, 3) derive from T-Rex2 DDS config.
 */
async function resolveGroundingConfig(visualConfig = null, platformId = null) {
  // 1. Check DB for separate GroundingDINO config (grounding_api_url column)
  try {
    let rows;
    if (platformId && isUuid(platformId)) {
      rows = await prisma.$queryRaw`
        SELECT grounding_api_url, grounding_api_token, grounding_model_preference
        FROM storage_config
        WHERE ((scope_type = 'platform' AND scope_id = ${platformId}::uuid) OR scope_type = 'global')
          AND is_active = true
        ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
        LIMIT 1
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT grounding_api_url, grounding_api_token, grounding_model_preference
        FROM storage_config
        WHERE scope_type = 'global' AND is_active = true
        LIMIT 1
      `;
    }
    const row = rows?.[0];
    if (row?.grounding_api_url) {
      return {
        url: row.grounding_api_url,
        token: row.grounding_api_token || visualConfig?.token || '',
        model: row.grounding_model_preference || 'GroundingDino-1.6-Pro',
      };
    }
  } catch (_) { /* columns may not exist yet */ }

  // 2. Explicit GroundingDINO primary config
  if (visualConfig?.provider === 'grounding_dino' && visualConfig.endpointUrl) {
    return { url: visualConfig.endpointUrl, token: visualConfig.token || '', model: visualConfig.model || 'GroundingDino-1.6-Pro' };
  }
  // 3. Env vars
  if (process.env.GROUNDING_DINO_API_URL) {
    return { url: process.env.GROUNDING_DINO_API_URL, token: process.env.GROUNDING_DINO_API_KEY || '', model: process.env.AI_ANNOTATE_DDS_MODEL || 'GroundingDino-1.6-Pro' };
  }
  // 4. Derive from T-Rex2 DDS config (same API key, different endpoint path)
  const trexUrl = visualConfig?.provider === 'trex2' ? visualConfig.endpointUrl : process.env.TREX2_API_URL;
  const trexToken = visualConfig?.provider === 'trex2' ? visualConfig.token : process.env.TREX2_API_KEY;
  if (trexUrl && trexToken && isDdsTaskEndpoint(trexUrl)) {
    const derivedUrl = deriveGroundingDinoEndpoint(trexUrl);
    if (derivedUrl) {
      console.log(`[ai-annotate] Derived GroundingDINO endpoint from T-Rex2: ${derivedUrl}`);
      return { url: derivedUrl, token: trexToken, model: 'GroundingDino-1.6-Pro' };
    }
  }
  return null;
}

function getVisualProviderName(config = null) {
  if (config?.provider === 'trex2' && hasTrexConfig(config)) return 'trex2';
  if (config?.provider === 'grounding_dino' && hasGroundingConfig(config)) return 'grounding_dino';
  if (hasTrexConfig(config)) return 'trex2';
  if (hasGroundingConfig(config)) return 'grounding_dino';
  return null;
}

function assertPilotEnabled(reply) {
  if (isPilotEnabled()) return true;
  reply.code(503).send({
    error: 'AI annotate pilot is disabled',
    hint: 'Set AI_ANNOTATE_PILOT_ENABLED=true to enable pilot routes',
  });
  return false;
}

function normalizeEntityType(value) {
  const v = String(value || '').toLowerCase();
  if (['equipment', 'instrument', 'line'].includes(v)) return v;
  return 'equipment';
}

function inferTypeFromTag(tag, fallbackType = 'equipment') {
  const t = String(tag || '').toUpperCase();
  if (!t) return fallbackType;
  // Line number patterns:
  //   2"-MT-28-29, 10-P-1234-A1A, 3-PI-101 (digit-prefix format)
  //   MT-28-29, P-1234 (service-code + number, >=2 segments with dash)
  //   Also handle OCR artifacts: 2MT2829 etc.
  if (/^\d+-[A-Z]+-\d+/.test(t)) return 'line';
  // Service code + line number: XX-NN or XXX-NN (e.g., MT-28, PW-101, HD-5)
  // But NOT instrument-like prefixes (TI, PI, etc.)
  if (/^[A-Z]{2,4}-\d+(-[A-Z0-9]+)*$/.test(t) && !/^(TI|PI|FI|LI|PT|TT|FT|LT|PSV|XV|CV|FV|LV|TV)-/.test(t) && !/^(P|V|E|TK|C|HX|M|D)-?\d+$/.test(t)) return 'line';
  // Digit-dash-digit patterns with 2+ dashes (e.g., 2-28-29, 10-1234-A1): likely line numbers
  if (/^\d+(-[A-Z0-9]+){2,}$/.test(t)) return 'line';
  if (/^(TI|PI|FI|LI|PT|TT|FT|LT|PSV|XV|CV|FV|LV|TV)[-\d]/.test(t)) return 'instrument';
  if (/^(P|V|E|TK|C|HX|M|D)-?\d+/.test(t)) return 'equipment';
  return fallbackType;
}

function toPctNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function coerceBox(box) {
  if (!box) return null;
  const xPct = toPctNumber(box.x_pct ?? box.xPct, null);
  const yPct = toPctNumber(box.y_pct ?? box.yPct, null);
  const wPct = toPctNumber(box.w_pct ?? box.wPct, null);
  const hPct = toPctNumber(box.h_pct ?? box.hPct, null);
  if (xPct == null || yPct == null || wPct == null || hPct == null) return null;
  return { xPct, yPct, wPct, hPct };
}

function hasMeaningfulBox(box) {
  if (!box) return false;
  return Number(box.wPct) > 0 && Number(box.hPct) > 0;
}

/**
 * Match OCR-extracted tag text against existing entities in the database.
 * For lines, tries fuzzy matching: strips size prefix (e.g., "2-" from "2-MT-28"),
 * tries contains match, and normalizes dashes to catch OCR variations.
 */
async function matchEntityByTag(db, matchCache, entityType, tagText) {
  const cacheKey = `${entityType}:${tagText}`;
  if (matchCache.has(cacheKey)) return matchCache.get(cacheKey);

  let matchedId = null;
  if (entityType === 'equipment') {
    const row = await db.equipment.findFirst({
      where: { tag: { equals: tagText, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    matchedId = row?.id || null;
  } else if (entityType === 'instrument') {
    const row = await db.instrument.findFirst({
      where: { tag: { equals: tagText, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    matchedId = row?.id || null;
  } else {
    // Exact match first
    const row = await db.line.findFirst({
      where: { line_number: { equals: tagText, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    matchedId = row?.id || null;

    // Fuzzy matching for lines: OCR often captures partial text
    if (!matchedId) {
      // Try: existing line_number CONTAINS the OCR text (e.g., DB has "2"-MT-28-29", OCR got "MT-28")
      const containsRows = await db.line.findMany({
        where: { line_number: { contains: tagText, mode: 'insensitive' }, deleted_at: null },
        select: { id: true, line_number: true },
        take: 5,
      });
      if (containsRows.length === 1) {
        matchedId = containsRows[0].id;
      } else if (containsRows.length === 0) {
        // Try: OCR text CONTAINS an existing line_number
        // Strip common size prefix pattern: leading digits + dash (e.g., "2-" or "10-")
        const stripped = tagText.replace(/^\d+-/, '');
        if (stripped !== tagText && stripped.length >= 3) {
          const strippedRow = await db.line.findFirst({
            where: { line_number: { contains: stripped, mode: 'insensitive' }, deleted_at: null },
            select: { id: true },
          });
          matchedId = strippedRow?.id || null;
        }
      }
    }
  }
  matchCache.set(cacheKey, matchedId);
  return matchedId;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTagText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[^\w\-\/]/g, '')
    .toUpperCase()
    .trim();
}

function likelyTag(token) {
  if (!token) return false;
  if (token.length < 2) return false;
  return /[A-Z]/.test(token) && /\d/.test(token);
}

function extractTagFromOcr(ocrResult) {
  const candidates = [];
  const fullText = String(ocrResult?.fullText || '');
  const words = Array.isArray(ocrResult?.words) ? ocrResult.words : [];

  // Strategy 1: Check individual words
  for (const w of words) {
    const t = normalizeTagText(w?.text);
    if (likelyTag(t)) candidates.push(t);
  }

  // Strategy 2: Check individual tokens from fullText
  for (const token of fullText.split(/\s+/)) {
    const t = normalizeTagText(token);
    if (likelyTag(t)) candidates.push(t);
  }

  // Strategy 3: Join ALL words with dashes — Google Vision often splits
  // instrument tags like "FT-1001" into separate words ["FT", "-", "1001"]
  // or ["FT", "1001"]. Joining recovers the full tag.
  if (candidates.length === 0 && words.length >= 1) {
    const joined = words.map(w => normalizeTagText(w?.text)).filter(Boolean).join('-');
    if (likelyTag(joined)) candidates.push(joined);
    // Also try without dashes (just concatenated)
    const concat = words.map(w => normalizeTagText(w?.text)).filter(Boolean).join('');
    if (likelyTag(concat) && concat !== joined) candidates.push(concat);
  }

  // Strategy 4: Use the entire fullText stripped of whitespace
  if (candidates.length === 0) {
    const stripped = normalizeTagText(fullText.replace(/\n/g, '-'));
    if (likelyTag(stripped)) candidates.push(stripped);
  }

  // Strategy 5: If still nothing, accept shorter tokens that look like
  // instrument function codes (2-4 uppercase letters like FT, PSV, LV, TI)
  // paired with adjacent number tokens
  if (candidates.length === 0 && words.length >= 2) {
    const wordTexts = words.map(w => normalizeTagText(w?.text)).filter(Boolean);
    for (let i = 0; i < wordTexts.length - 1; i++) {
      const a = wordTexts[i];
      const b = wordTexts[i + 1];
      // Letter part + number part (e.g., "FT" + "1001" → "FT-1001")
      if (/^[A-Z]{1,4}$/.test(a) && /^\d+[A-Z]?$/.test(b)) {
        candidates.push(`${a}-${b}`);
      }
      // Number part + letter part (e.g., "1001" + "A" → less common but possible)
      if (/^\d+$/.test(a) && /^[A-Z]{1,4}\d*$/.test(b)) {
        candidates.push(`${a}-${b}`);
      }
    }
  }

  if (candidates.length === 0) return null;

  // Prefer tokens with dashes and richer alnum mix (typical P&ID tags).
  candidates.sort((a, b) => {
    const score = (t) => (t.includes('-') ? 3 : 0) + (/\d/.test(t) ? 2 : 0) + (/[A-Z]/.test(t) ? 2 : 0) + Math.min(t.length, 10) / 10;
    return score(b) - score(a);
  });
  return candidates[0];
}

// ---------------------------------------------------------------------------
// OCR Extraction DB Lookup — use existing full-page OCR results instead of
// re-running Google Vision on small detection crops.
// ---------------------------------------------------------------------------

/**
 * Fetch OCR text entries for a given P&ID.
 * Sources (tried in order):
 *   1. ocr_extraction table (populated after review sync)
 *   2. Classified/review stage JSON files from OCR batch pipeline
 *
 * Returns array of { text, tag_type, x_pct, y_pct, w_pct, h_pct, cx, cy, matched_entity_id }.
 */
async function fetchOcrExtractions(db, pnidId) {
  // --- Source 1: ocr_extraction table ---
  const rows = await db.$queryRaw`
    SELECT extracted_text, tag_type, confidence,
           bbox_x_pct::float AS x_pct, bbox_y_pct::float AS y_pct,
           bbox_w_pct::float AS w_pct, bbox_h_pct::float AS h_pct,
           matched_entity_id, status
    FROM ocr_extraction
    WHERE pnid_id = ${pnidId}::uuid
      AND extracted_text IS NOT NULL
      AND LENGTH(TRIM(extracted_text)) >= 1
    ORDER BY confidence DESC
  `.catch(err => {
    console.warn(`[ai-annotate] Failed to fetch ocr_extraction for pnid ${pnidId}: ${err.message}`);
    return [];
  });

  if (rows.length > 0) {
    console.log(`[ai-annotate] OCR source: ocr_extraction table (${rows.length} entries)`);
    return rows.map(r => toOcrEntry(r.extracted_text, r.tag_type, r.confidence, r.x_pct, r.y_pct, r.w_pct, r.h_pct, r.matched_entity_id));
  }

  // --- Source 2: Classified/review stage JSON from OCR batch pipeline ---
  try {
    const batchFiles = await db.$queryRaw`
      SELECT bf.id, bf.cleaned_output_key, bf.review_output_key, bf.pnid_id,
             b.platform_id
      FROM ocr_batch_file bf
      JOIN ocr_batch b ON b.id = bf.batch_id
      WHERE bf.pnid_id = ${pnidId}::uuid
        AND (bf.cleaned_output_key IS NOT NULL OR bf.review_output_key IS NOT NULL)
      ORDER BY bf.created_at DESC
      LIMIT 1
    `;

    if (batchFiles.length > 0) {
      const file = batchFiles[0];
      const storage = await getStorageProvider(db, { platformId: file.platform_id });

      // Prefer review data (human-verified), fall back to classified
      const stageKey = file.review_output_key || file.cleaned_output_key;
      const stageName = file.review_output_key ? 'review' : 'classified';

      const downloaded = await storage.download(stageKey);
      const buf = downloaded.buffer || downloaded;
      const stageData = JSON.parse(buf.toString('utf-8'));

      const entries = [];
      const pageW = stageData.pageWidth || 0;
      const pageH = stageData.pageHeight || 0;

      // Collect tags from the stage data
      const allItems = [
        ...(stageData.tags || []),
        ...(stageData.uncertain || []),
        ...(stageData.approved || []),
        ...(stageData.edited || []),
      ];

      for (const tag of allItems) {
        const text = String(tag.text || tag._finalText || '').trim();
        if (!text || text.length < 1) continue;

        const tagType = normalizeOcrTagType(tag.type);
        const conf = Number(tag.confidence ?? 0.8);

        // Get position in percentage
        const pct = tag.position_pct || tag.positionPct;
        let xPct = 0, yPct = 0, wPct = 0, hPct = 0;

        if (pct && (pct.x_pct != null || pct.xPct != null)) {
          xPct = Number(pct.x_pct ?? pct.xPct ?? 0);
          yPct = Number(pct.y_pct ?? pct.yPct ?? 0);
          wPct = Number(pct.w_pct ?? pct.wPct ?? 0);
          hPct = Number(pct.h_pct ?? pct.hPct ?? 0);
        } else if (tag.boundingBox && pageW && pageH) {
          const bb = tag.boundingBox;
          xPct = Number(((bb.minX / pageW) * 100).toFixed(2));
          yPct = Number(((bb.minY / pageH) * 100).toFixed(2));
          wPct = Number((((bb.maxX - bb.minX) / pageW) * 100).toFixed(2));
          hPct = Number((((bb.maxY - bb.minY) / pageH) * 100).toFixed(2));
        }

        if (wPct > 0 && hPct > 0) {
          entries.push(toOcrEntry(text, tagType, conf, xPct, yPct, wPct, hPct, null));
        }
      }

      if (entries.length > 0) {
        console.log(`[ai-annotate] OCR source: batch ${stageName} stage (${entries.length} entries from ${stageKey})`);
        return entries;
      }
    }
  } catch (err) {
    console.warn(`[ai-annotate] Failed to load OCR batch stage data for pnid ${pnidId}: ${err.message}`);
  }

  return [];
}

/** Normalize tag type from OCR stage format to DB-compatible values. */
function normalizeOcrTagType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'equipment' || t === 'instrument' || t === 'line') return t;
  if (t.includes('line') || t.includes('header')) return 'line';
  return 'unknown';
}

/** Build a standardized OCR entry object. */
function toOcrEntry(text, tagType, confidence, xPct, yPct, wPct, hPct, matchedEntityId) {
  return {
    text: String(text).trim(),
    tag_type: tagType || 'unknown',
    confidence: Number(confidence || 0),
    x_pct: Number(xPct || 0),
    y_pct: Number(yPct || 0),
    w_pct: Number(wPct || 0),
    h_pct: Number(hPct || 0),
    cx: Number(xPct || 0) + Number(wPct || 0) / 2,
    cy: Number(yPct || 0) + Number(hPct || 0) / 2,
    matched_entity_id: matchedEntityId || null,
  };
}

/**
 * Find the best OCR text match for a detection bounding box by looking up
 * pre-existing OCR extraction entries from the database.
 *
 * Search strategy:
 *   1. Expand the detection box with padding (larger below for instruments)
 *   2. Find OCR entries whose center falls within the expanded region
 *   3. Among matches, prefer entries that pass likelyTag() and are closest
 *
 * @param {Array} ocrEntries — pre-fetched from fetchOcrExtractions()
 * @param {Object} detBbox — detection bbox in pct { x_pct, y_pct, w_pct, h_pct }
 * @param {boolean} isInstrumentLike — true for roughly square (circle) detections
 * @returns {{ tagText: string|null, matchedEntityId: string|null, ocrEntry: object|null }}
 */
function lookupTagFromOcrExtractions(ocrEntries, detBbox, isInstrumentLike) {
  if (!ocrEntries || ocrEntries.length === 0) return { tagText: null, matchedEntityId: null, ocrEntry: null };

  // Expand detection region to search for nearby OCR text.
  // For instruments: wide horizontal, extra below (tag number is below the bubble).
  // For equipment: moderate padding all around.
  const padX = detBbox.w_pct * (isInstrumentLike ? 0.8 : 0.5);
  const padTop = detBbox.h_pct * (isInstrumentLike ? 0.5 : 0.5);
  const padBottom = detBbox.h_pct * (isInstrumentLike ? 2.0 : 0.8);

  const searchLeft = detBbox.x_pct - padX;
  const searchRight = detBbox.x_pct + detBbox.w_pct + padX;
  const searchTop = detBbox.y_pct - padTop;
  const searchBottom = detBbox.y_pct + detBbox.h_pct + padBottom;

  // Center of the detection box
  const detCx = detBbox.x_pct + detBbox.w_pct / 2;
  const detCy = detBbox.y_pct + detBbox.h_pct / 2;

  // Find all OCR entries whose center is within the search region
  const nearby = [];
  for (const entry of ocrEntries) {
    if (entry.cx >= searchLeft && entry.cx <= searchRight &&
        entry.cy >= searchTop && entry.cy <= searchBottom) {
      const dist = Math.sqrt((entry.cx - detCx) ** 2 + (entry.cy - detCy) ** 2);
      const normalized = normalizeTagText(entry.text);
      const isTag = likelyTag(normalized);
      nearby.push({ ...entry, dist, normalized, isTag });
    }
  }

  if (nearby.length === 0) return { tagText: null, matchedEntityId: null, ocrEntry: null };

  // Sort: prefer likelyTag entries first, then closest distance
  nearby.sort((a, b) => {
    if (a.isTag !== b.isTag) return a.isTag ? -1 : 1;
    return a.dist - b.dist;
  });

  // For instruments: try to build a combined tag from nearby function letters + number
  // e.g., "FT" at the circle center + "1001" below → "FT-1001"
  if (isInstrumentLike && !nearby[0].isTag && nearby.length >= 2) {
    const letters = nearby.filter(e => /^[A-Z]{1,4}$/.test(e.normalized));
    const numbers = nearby.filter(e => /^\d+[A-Z]?$/.test(e.normalized));
    if (letters.length > 0 && numbers.length > 0) {
      // Pick the closest letter part and closest number part
      const letter = letters.sort((a, b) => a.dist - b.dist)[0];
      const number = numbers.sort((a, b) => a.dist - b.dist)[0];
      const combined = `${letter.normalized}-${number.normalized}`;
      return {
        tagText: combined,
        matchedEntityId: letter.matched_entity_id || number.matched_entity_id || null,
        ocrEntry: letter,
      };
    }
  }

  const best = nearby[0];
  const tagText = best.isTag ? best.normalized : (best.normalized.length >= 2 ? best.normalized : null);

  return {
    tagText,
    matchedEntityId: best.matched_entity_id || null,
    ocrEntry: best,
  };
}

function toPixelBox(pctBox, width, height) {
  const x = clamp(Math.round((pctBox.xPct / 100) * width), 0, width - 1);
  const y = clamp(Math.round((pctBox.yPct / 100) * height), 0, height - 1);
  const w = clamp(Math.round((pctBox.wPct / 100) * width), 4, width - x);
  const h = clamp(Math.round((pctBox.hPct / 100) * height), 4, height - y);
  return { x, y, w, h };
}

function pixelToPctBox(pixelBox, width, height) {
  return {
    x_pct: Number(((pixelBox.x / width) * 100).toFixed(4)),
    y_pct: Number(((pixelBox.y / height) * 100).toFixed(4)),
    w_pct: Number(((pixelBox.w / width) * 100).toFixed(4)),
    h_pct: Number(((pixelBox.h / height) * 100).toFixed(4)),
  };
}

function normalizeTrexBbox(item) {
  const raw = item?.bbox || item?.box || item?.bounding_box || item?.rect;
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length >= 4) {
    const [a, b, c, d] = raw.map(Number);
    if (![a, b, c, d].every(Number.isFinite)) return null;
    // Heuristic: [x, y, w, h] if c/d look like sizes, else [x1,y1,x2,y2].
    if (c > a && d > b && (c - a) > 2 && (d - b) > 2) {
      return { x: a, y: b, w: c - a, h: d - b };
    }
    return { x: a, y: b, w: c, h: d };
  }
  if (typeof raw === 'object') {
    const x = Number(raw.x ?? raw.left ?? raw.x1);
    const y = Number(raw.y ?? raw.top ?? raw.y1);
    const w = Number(raw.w ?? raw.width ?? ((raw.x2 != null && raw.x1 != null) ? raw.x2 - raw.x1 : NaN));
    const h = Number(raw.h ?? raw.height ?? ((raw.y2 != null && raw.y1 != null) ? raw.y2 - raw.y1 : NaN));
    if (![x, y, w, h].every(Number.isFinite)) return null;
    return { x, y, w, h };
  }
  return null;
}

async function getPnidFileBuffer(pnidId) {
  const pnid = await prisma.pnid.findFirst({
    where: { id: pnidId, deleted_at: null },
    select: {
      storage_key: true,
      pnid_system: {
        where: { is_primary: true },
        include: { system: { select: { platform_id: true } } },
      },
    },
  });
  if (!pnid?.storage_key) throw new Error('No P&ID file found for this drawing');

  const platformId = pnid.pnid_system?.[0]?.system?.platform_id || null;
  const storage = await getStorageProvider(prisma, { platformId });
  const downloaded = await storage.download(pnid.storage_key);
  return { buffer: downloaded.buffer, contentType: downloaded.contentType || '', platformId };
}

function isPdfBuffer(buffer, contentType = '') {
  return String(contentType).toLowerCase().includes('pdf') || buffer.slice(0, 5).toString() === '%PDF-';
}

async function toDetectionRaster({ fileBuffer, contentType }) {
  if (!isPdfBuffer(fileBuffer, contentType)) {
    return { rasterBuffer: fileBuffer, sourceType: 'raster' };
  }

  // Automatic PDF first-page rasterization for visual few-shot detection.
  // Page index 0 aligns with default viewer page when explicit page is not supplied.
  try {
    const raster = await sharp(fileBuffer, { density: Number(process.env.AI_ANNOTATE_PDF_DENSITY || 420), page: 0 })
      .png()
      .toBuffer();
    return { rasterBuffer: raster, sourceType: 'pdf_rasterized_page_1' };
  } catch (_) {
    // Fallback for environments where sharp lacks PDF codec support.
    try {
      const dpi = Number(process.env.AI_ANNOTATE_PDF_DENSITY || 420);
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-annotate-pdf-'));
      const inPdf = path.join(tmpRoot, 'input.pdf');
      const outPrefix = path.join(tmpRoot, 'page1');
      const outPng = `${outPrefix}.png`;
      await fs.writeFile(inPdf, fileBuffer);
      await execFileAsync('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', String(dpi), inPdf, outPrefix]);
      const raster = await fs.readFile(outPng);
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      return { rasterBuffer: raster, sourceType: 'pdf_rasterized_page_1_poppler' };
    } catch (err2) {
      throw new Error(`Unable to rasterize PDF for visual detection: ${err2.message}`);
    }
  }
}

/**
 * Resize image to fit within DDS API's expected max dimension (default 1536px).
 * The official dds-cloudapi-sdk resizes to 1536px on the longest edge before submission.
 * Without this, our 420 DPI rasters (14,000-20,000px) cause the server to internally
 * downscale, breaking pixel-based prompt coordinates and producing 0 detections.
 *
 * Returns { buffer, width, height, scale } where scale is the downscale factor applied.
 * Coordinates must be multiplied by `scale` to map from original to resized space.
 */
async function resizeForDetection(imageBuffer, { maxDimOverride } = {}) {
  const maxDim = maxDimOverride || Math.max(512, Number(process.env.AI_ANNOTATE_DDS_MAX_DIM || 1536));
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height) {
    return { buffer: imageBuffer, width: meta.width || 0, height: meta.height || 0, scale: 1 };
  }
  const longest = Math.max(meta.width, meta.height);
  if (longest <= maxDim) {
    return { buffer: imageBuffer, width: meta.width, height: meta.height, scale: 1 };
  }
  const scale = maxDim / longest;
  const newW = Math.round(meta.width * scale);
  const newH = Math.round(meta.height * scale);
  const resized = await sharp(imageBuffer)
    .resize(newW, newH, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return { buffer: resized, width: newW, height: newH, scale };
}

async function resolveVisionCredentials(platformId) {
  if (process.env.VISION_CREDENTIALS_JSON) return process.env.VISION_CREDENTIALS_JSON;
  if (platformId) {
    const platformRows = await prisma.$queryRaw`
      SELECT vision_credentials_ref, credentials_ref
      FROM storage_config
      WHERE scope_type = 'platform'
        AND scope_id = ${platformId}::uuid
        AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
    `.catch(() => []);
    const creds = platformRows?.[0]?.vision_credentials_ref || platformRows?.[0]?.credentials_ref;
    if (creds) return creds;
  }
  const globalRows = await prisma.$queryRaw`
    SELECT vision_credentials_ref, credentials_ref
    FROM storage_config
    WHERE scope_type = 'global'
      AND is_active = true
    ORDER BY updated_at DESC
    LIMIT 1
  `.catch(() => []);
  return globalRows?.[0]?.vision_credentials_ref || globalRows?.[0]?.credentials_ref || null;
}

async function resolveVisualConfigForPlatform(platformId) {
  const defaultProvider = process.env.GROUNDING_DINO_API_URL ? 'grounding_dino' : 'trex2';
  const defaultModelFor = (provider) => {
    if (provider === 'trex2') return process.env.AI_ANNOTATE_TREX_MODEL || 'T-Rex-2.0';
    return process.env.AI_ANNOTATE_DDS_MODEL || 'GroundingDino-1.6-Pro';
  };

  // Always check DB — global scope covers cases where platformId is missing.
  // This ensures the T-Rex2 URL/token saved via Admin > OCR Pipeline Settings is used
  // without requiring TREX2_API_URL / TREX2_API_KEY environment variables.
  let rows;
  if (platformId && isUuid(platformId)) {
    rows = await prisma.$queryRaw`
      SELECT visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference,
             grounding_api_url, grounding_api_token, grounding_model_preference
      FROM storage_config
      WHERE ((scope_type = 'platform' AND scope_id = ${platformId}::uuid) OR scope_type = 'global')
        AND is_active = true
      ORDER BY CASE scope_type WHEN 'platform' THEN 0 ELSE 1 END
      LIMIT 1
    `.catch(() => []);
  } else {
    rows = await prisma.$queryRaw`
      SELECT visual_provider_preference, visual_api_url, visual_api_token, visual_model_preference,
             grounding_api_url, grounding_api_token, grounding_model_preference
      FROM storage_config
      WHERE scope_type = 'global' AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1
    `.catch(() => []);
  }

  const row = rows?.[0];
  const provider = row?.visual_provider_preference || defaultProvider;
  const endpointUrl = row?.visual_api_url || (provider === 'grounding_dino' ? process.env.GROUNDING_DINO_API_URL : process.env.TREX2_API_URL);
  const token = row?.visual_api_token || (provider === 'grounding_dino' ? process.env.GROUNDING_DINO_API_KEY : process.env.TREX2_API_KEY);
  const model = row?.visual_model_preference || defaultModelFor(provider);

  return {
    provider,
    endpointUrl: endpointUrl || null,
    token: token || null,
    model,
    source: row ? 'db' : 'env',
    // Expose GroundingDINO DB config for hasGroundingConfig() sync check
    _groundingUrl: row?.grounding_api_url || null,
    _groundingToken: row?.grounding_api_token || null,
    _groundingModel: row?.grounding_model_preference || null,
  };
}

async function resolveVisualConfigForPnid(pnidId) {
  const pnid = await prisma.pnid.findFirst({
    where: { id: pnidId, deleted_at: null },
    select: {
      pnid_system: {
        where: { is_primary: true },
        include: { system: { select: { platform_id: true } } },
      },
    },
  });
  const platformId = pnid?.pnid_system?.[0]?.system?.platform_id || null;
  return resolveVisualConfigForPlatform(platformId);
}

async function callTrex2Detect({ imageBuffer, examples, imageWidth, imageHeight, visualConfig, promptImageBuffer, promptImageWidth, promptImageHeight }) {
  const url = visualConfig?.endpointUrl || process.env.TREX2_API_URL;
  const apiKey = visualConfig?.token || process.env.TREX2_API_KEY;
  if (isDdsTaskEndpoint(url)) {
    const dds = await callDdsAsyncDetect({
      endpointUrl: url,
      token: apiKey,
      model: visualConfig?.model,
      imageBuffer,
      examples,
      mode: 'trex',
      imageWidth,
      imageHeight,
      promptImageBuffer,
      promptImageWidth,
      promptImageHeight,
    });
    const categoryMap = dds?.meta?.categoryMap || {};
    const invScale = dds?.meta?.resizeScale ? (1 / dds.meta.resizeScale) : 1;
    const rawDetections = extractDdsDetections(dds.result);
    console.log(`[ai-annotate] DDS T-Rex returned ${rawDetections.length} raw detections (invScale=${invScale.toFixed(3)})`);
    const detections = rawDetections.map((item, idx) => {
      const box = normalizeDdsDetectionBox(item);
      if (!box) return null;
      const categoryId = Number(item?.category_id);
      const score = Number(item?.score ?? item?.confidence ?? 0.5);
      // Upscale detection boxes from resized coordinates back to original image space.
      // Use object format {x,y,w,h} so normalizeTrexBbox doesn't misinterpret via heuristic.
      const upscaled = { x: box.x * invScale, y: box.y * invScale, w: box.w * invScale, h: box.h * invScale };
      if (idx < 5) {
        console.log(`[ai-annotate] Det[${idx}] resized=(${box.x.toFixed(0)},${box.y.toFixed(0)},${box.w.toFixed(0)},${box.h.toFixed(0)}) upscaled=(${upscaled.x.toFixed(0)},${upscaled.y.toFixed(0)},${upscaled.w.toFixed(0)},${upscaled.h.toFixed(0)}) score=${score.toFixed(3)}`);
      }
      return {
        bbox: upscaled,
        score,
        label: categoryMap[categoryId] || String(item?.label || item?.category || ''),
      };
    }).filter(Boolean);
    if (rawDetections.length > 5) console.log(`[ai-annotate] ... and ${rawDetections.length - 5} more detections`);
    return { detections };
  }
  const payload = {
    image_base64: imageBuffer.toString('base64'),
    prompts: examples.map(ex => {
      const px = toPixelBox(ex.bbox, imageWidth, imageHeight);
      return {
        prompt_type: 'bbox',
        label: ex.label,
        text: ex.tag || undefined,
        bbox: [px.x, px.y, px.w, px.h],
      };
    }),
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`T-Rex2 request failed (${res.status}): ${txt}`);
  }
  return res.json();
}

async function callGroundingDinoDetect({ imageBuffer, examples, imageWidth, imageHeight, visualConfig, platformId }) {
  // Resolve GroundingDINO endpoint — checks DB config, env vars, or derives from T-Rex2
  const gConfig = await resolveGroundingConfig(visualConfig, platformId);
  const url = gConfig?.url || visualConfig?.endpointUrl || process.env.GROUNDING_DINO_API_URL;
  const apiKey = gConfig?.token || visualConfig?.token || process.env.GROUNDING_DINO_API_KEY || '';
  const groundingModel = gConfig?.model || null;
  console.log(`[ai-annotate] GroundingDINO call: url=${url} hasToken=${!!apiKey} model=${groundingModel} imageSize=${imageWidth}x${imageHeight} examples=${examples.length} prompt="${toDdsTextPrompt(examples)}"`);
  if (isDdsTaskEndpoint(url)) {
    const dds = await callDdsAsyncDetect({
      endpointUrl: url,
      token: apiKey,
      model: groundingModel,
      imageBuffer,
      examples,
      mode: 'grounding',
      imageWidth,
      imageHeight,
    });
    const invScale = dds?.meta?.resizeScale ? (1 / dds.meta.resizeScale) : 1;
    const detW = dds?.meta?.detectionWidth || imageWidth;
    const detH = dds?.meta?.detectionHeight || imageHeight;
    const rawDets = extractDdsDetections(dds.result);
    console.log(`[ai-annotate] GroundingDINO extractDdsDetections returned ${rawDets.length} items (invScale=${invScale.toFixed(3)})`);
    const detections = rawDets.map((item, idx) => {
      const box = normalizeDdsDetectionBox(item);
      if (!box) return null;
      // Filter out detections that cover > 30% of the image area — these are
      // obviously wrong (GroundingDINO matched the whole page instead of individual elements)
      const areaRatio = (box.w * box.h) / (detW * detH);
      if (areaRatio > 0.3) {
        console.log(`[ai-annotate] GDino Det[${idx}] FILTERED: covers ${(areaRatio * 100).toFixed(0)}% of image (too large)`);
        return null;
      }
      const upscaled = { x: box.x * invScale, y: box.y * invScale, w: box.w * invScale, h: box.h * invScale };
      const score = Number(item?.score ?? item?.confidence ?? item?.bbox_score ?? 0.5);
      if (idx < 10) {
        console.log(`[ai-annotate] GDino Det[${idx}] box=(${box.x.toFixed(0)},${box.y.toFixed(0)},${box.w.toFixed(0)},${box.h.toFixed(0)}) upscaled=(${upscaled.x.toFixed(0)},${upscaled.y.toFixed(0)},${upscaled.w.toFixed(0)},${upscaled.h.toFixed(0)}) score=${score.toFixed(3)} area=${(areaRatio * 100).toFixed(1)}% label="${item?.label || item?.category || ''}"`)
      }
      return { bbox: upscaled, score, label: String(item?.label || item?.category || item?.category_name || '') };
    }).filter(Boolean);
    if (rawDets.length > 10) console.log(`[ai-annotate] ... and ${rawDets.length - 10} more GroundingDINO detections`);
    return { detections };
  }
  const promptFromExamples = [...new Set(examples.map(ex => ex.label))]
    .map(label => {
      if (label === 'line') return 'piping line number tag';
      if (label === 'instrument') return 'instrument tag bubble';
      return 'equipment tag label';
    })
    .join(', ');

  const payload = {
    image_base64: imageBuffer.toString('base64'),
    text_prompt: promptFromExamples || 'equipment tag, instrument tag, line tag',
    box_threshold: Number(process.env.GROUNDING_DINO_BOX_THRESHOLD || 0.25),
    text_threshold: Number(process.env.GROUNDING_DINO_TEXT_THRESHOLD || 0.25),
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GroundingDINO request failed (${res.status}): ${txt}`);
  }
  return res.json();
}

function isDdsTaskEndpoint(url) {
  return /api\.deepdataspace\.com\/v2\/task\//i.test(String(url || ''));
}

function makeDdsHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Token = token;
    headers.Authorization = `Bearer ${token}`;
    headers['x-api-key'] = token;
  }
  return headers;
}

function toDdsTextPrompt(examples) {
  const labels = [...new Set((examples || []).map(ex => ex.label))];
  // GroundingDINO uses CLIP text-image matching. Prompts must describe what the
  // target objects LOOK LIKE, not what they mean. Use period-separated phrases
  // for multi-class detection. Avoid generic terms like "text label" which match
  // the entire drawing.
  const promptFromExamples = labels
    .map(label => {
      if (label === 'line') return 'small text . number . pipe tag';
      if (label === 'instrument') return 'circle with text . instrument bubble';
      return 'equipment name . tag number';
    })
    .join(' . ');
  return promptFromExamples || 'small text . number';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeTrexPromptVariants({ interactions, promptImageDataUrl }) {
  // Per the official dds-cloudapi-sdk and T-Rex2 demo code, the canonical prompt format is
  // `visual_images` with interactions. When the prompt image differs from the target image
  // (cross-drawing batch mode), include the prompt image explicitly in visual_images so
  // T-Rex2 knows which image the prompt rects reference.
  const imageEntry = promptImageDataUrl ? { image: promptImageDataUrl } : {};
  return [
    // Variant A: canonical format from official SDK (visual_images with category_id).
    {
      type: 'visual_images',
      visual_images: [{
        ...imageEntry,
        interactions,
      }],
    },
    // Variant A2: same but without category_id (some endpoints treat it as optional).
    {
      type: 'visual_images',
      visual_images: [{
        ...imageEntry,
        interactions: interactions.map(it => ({ type: 'rect', rect: it.rect })),
      }],
    },
    // Variant B: single-interaction shorthand. Sends ALL interactions, not just first.
    {
      type: 'visual_interaction',
      visual_interactions: interactions,
    },
  ];
}

async function callDdsAsyncDetect({ endpointUrl, token, model, imageBuffer, examples, mode = 'grounding', imageWidth, imageHeight, promptImageBuffer, promptImageWidth, promptImageHeight }) {
  // Resize image to DDS-expected max dimension (default 1536px) to match official SDK behavior.
  // Without this, 420 DPI rasters (14,000+ px) cause coordinate misalignment and 0 detections.
  // For text-based detection (GroundingDINO), allow higher resolution via AI_ANNOTATE_TEXT_MAX_DIM
  // since text labels need more pixels to be readable (default 3072px for text, 1536px for visual).
  const textMaxDim = mode === 'grounding' ? Number(process.env.AI_ANNOTATE_TEXT_MAX_DIM || 0) : 0;
  const resized = await resizeForDetection(imageBuffer, textMaxDim ? { maxDimOverride: textMaxDim } : {});
  const detectionWidth = resized.width;
  const detectionHeight = resized.height;
  const resizeScale = resized.scale;

  const imageBase64 = resized.buffer.toString('base64');
  const imageDataUrl = `data:image/png;base64,${imageBase64}`;
  const promptText = toDdsTextPrompt(examples);
  const headers = makeDdsHeaders(token);

  const trexScoreThreshold = Number(process.env.AI_ANNOTATE_TREX_SCORE_THRESHOLD || 0.2);

  if (resizeScale < 1) {
    console.log(`[ai-annotate] Image resized for DDS: ${imageWidth}x${imageHeight} → ${detectionWidth}x${detectionHeight} (scale=${resizeScale.toFixed(4)})`);
  }

  // Cross-drawing batch mode: prompt image differs from target image.
  // Prompt rects must be computed relative to the PROMPT image, not the target.
  let promptImageDataUrl = null;
  let promptResizeScale = resizeScale;
  let promptW = imageWidth;
  let promptH = imageHeight;
  if (promptImageBuffer) {
    const promptResized = await resizeForDetection(promptImageBuffer);
    promptResizeScale = promptResized.scale;
    promptW = promptImageWidth || promptResized.width;
    promptH = promptImageHeight || promptResized.height;
    const promptBase64 = promptResized.buffer.toString('base64');
    promptImageDataUrl = `data:image/png;base64,${promptBase64}`;
    console.log(`[ai-annotate] Cross-drawing: prompt image ${promptW}x${promptH} (scale=${promptResizeScale.toFixed(4)}), target ${detectionWidth}x${detectionHeight}`);
  }

  const payload = mode === 'trex'
    ? (() => {
        const labelToCategory = new Map();
        let nextCategory = 1;
        for (const ex of (examples || [])) {
          if (!labelToCategory.has(ex.label)) {
            labelToCategory.set(ex.label, nextCategory++);
          }
        }
        // Compute prompt rects relative to the PROMPT image coordinate space.
        // When cross-drawing, bbox percentages reference the source drawing dimensions.
        const promptRefW = promptImageBuffer ? promptW : imageWidth;
        const promptRefH = promptImageBuffer ? promptH : imageHeight;
        const promptScale = promptImageBuffer ? promptResizeScale : resizeScale;
        const interactions = (examples || []).map((ex, i) => {
          const px = toPixelBox(ex.bbox, promptRefW, promptRefH);
          const rect = [
            Math.round(px.x * promptScale),
            Math.round(px.y * promptScale),
            Math.round((px.x + px.w) * promptScale),
            Math.round((px.y + px.h) * promptScale),
          ];
          console.log(`[ai-annotate] Prompt[${i}] pct=(${ex.bbox.xPct.toFixed(2)},${ex.bbox.yPct.toFixed(2)},${ex.bbox.wPct.toFixed(2)},${ex.bbox.hPct.toFixed(2)}) origPx=(${px.x},${px.y},${px.w},${px.h}) rect=[${rect}] promptRef=${promptRefW}x${promptRefH} scale=${promptScale.toFixed(4)} label=${ex.label} tag=${ex.tag || ''}`);
          return {
            type: 'rect',
            category_id: labelToCategory.get(ex.label),
            rect,
          };
        });

        return {
          image: imageDataUrl,
          model: model || process.env.AI_ANNOTATE_TREX_MODEL || 'T-Rex-2.0',
          targets: ['bbox', 'embedding'],
          bbox_threshold: trexScoreThreshold,
          _trexPromptVariants: makeTrexPromptVariants({ interactions, promptImageDataUrl }),
          _categoryMap: Object.fromEntries([...labelToCategory.entries()].map(([label, id]) => [id, label])),
          _resizeScale: resizeScale,
          _detectionWidth: detectionWidth,
          _detectionHeight: detectionHeight,
          _debugInteractions: interactions,
        };
      })()
    : {
        image: imageDataUrl,
        model: model || process.env.AI_ANNOTATE_DDS_MODEL || 'GroundingDino-1.6-Pro',
        prompt: { type: 'text', text: promptText },
        bbox_threshold: Number(process.env.GROUNDING_DINO_BOX_THRESHOLD || 0.1),
        targets: ['bbox'],
        _resizeScale: resizeScale,
        _detectionWidth: detectionWidth,
        _detectionHeight: detectionHeight,
      };

  const categoryMap = payload._categoryMap || {};
  const trexPromptVariants = payload._trexPromptVariants || null;
  const payloadResizeScale = payload._resizeScale || 1;
  const payloadDetectionWidth = payload._detectionWidth || imageWidth;
  const payloadDetectionHeight = payload._detectionHeight || imageHeight;
  if (payload._categoryMap) delete payload._categoryMap;
  const debugInteractions = payload._debugInteractions || null;
  if (payload._trexPromptVariants) delete payload._trexPromptVariants;
  if (payload._resizeScale) delete payload._resizeScale;
  if (payload._detectionWidth) delete payload._detectionWidth;
  if (payload._detectionHeight) delete payload._detectionHeight;
  if (payload._debugInteractions) delete payload._debugInteractions;

  // Debug: save resized image with prompt rects drawn on it (async, outside sync IIFE)
  if (isDebugEnabled() && debugInteractions) {
    try {
      const dDir = await ensureDebugDir();
      const debugRects = debugInteractions.map((it, i) => ({
        x: it.rect[0], y: it.rect[1],
        w: it.rect[2] - it.rect[0], h: it.rect[3] - it.rect[1],
        color: '#FF0000', label: `P${i}`,
      }));
      await saveImageWithRects(resized.buffer, debugRects, path.join(dDir, `trex-prompt-rects-${Date.now()}.png`));
      console.log(`[ai-debug] Prompt rects on ${detectionWidth}x${detectionHeight} image: ${JSON.stringify(debugInteractions.map(it => it.rect))}`);
    } catch (e) { console.warn(`[ai-debug] Failed to save debug image: ${e.message}`); }
  }

  const tryCreateTask = async (bodyPayload) => {
    const res = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };

  let createRes = null;
  let createJson = null;
  if (mode === 'trex' && Array.isArray(trexPromptVariants) && trexPromptVariants.length > 0) {
    const errors = [];
    for (const promptVariant of trexPromptVariants) {
      const { res, json } = await tryCreateTask({ ...payload, prompt: promptVariant });
      if (res.ok && Number(json?.code ?? 0) === 0 && json?.data?.task_uuid) {
        createRes = res;
        createJson = json;
        break;
      }
      errors.push(`${res.status}:${JSON.stringify(json)}`);
    }
    if (!createJson?.data?.task_uuid) {
      throw new Error(`DDS task create failed (trex prompt variants): ${errors.join(' | ')}`);
    }
  } else {
    const attempt = await tryCreateTask(payload);
    createRes = attempt.res;
    createJson = attempt.json;
    if (!createRes.ok || Number(createJson?.code ?? 0) !== 0 || !createJson?.data?.task_uuid) {
      throw new Error(`DDS task create failed (${createRes.status}): ${JSON.stringify(createJson)}`);
    }
  }

  const taskUuid = createJson.data.task_uuid;
  console.log(`[ai-annotate] DDS task created: ${taskUuid} (mode=${mode}, endpoint=${endpointUrl}, model=${model || 'default'})`);
  const statusUrl = `https://api.deepdataspace.com/v2/task_status/${taskUuid}`;
  const timeoutMs = Math.max(8000, Number(process.env.AI_ANNOTATE_DDS_TIMEOUT_MS || 90000));
  const pollEveryMs = Math.max(400, Number(process.env.AI_ANNOTATE_DDS_POLL_MS || 1200));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const statusRes = await fetch(statusUrl, { method: 'GET', headers });
    const statusJson = await statusRes.json().catch(() => ({}));
    const status = String(statusJson?.data?.status || '').toLowerCase();
    if (status === 'success') {
      const result = statusJson?.data?.result || {};
      const resultKeys = Object.keys(result);
      const detectionArrays = ['objects', 'detections', 'results'].filter(k => Array.isArray(result[k]));
      const totalDetections = detectionArrays.reduce((sum, k) => sum + (result[k]?.length || 0), 0);
      const sampleDetection = detectionArrays.length > 0 ? result[detectionArrays[0]]?.[0] : null;
      console.log(`[ai-annotate] DDS task ${taskUuid} completed (${mode}): resultKeys=[${resultKeys.join(',')}] detectionArrays=[${detectionArrays.join(',')}] totalDetections=${totalDetections}`);
      if (sampleDetection) {
        console.log(`[ai-annotate] Sample detection: ${JSON.stringify(sampleDetection)}`);
      } else if (totalDetections === 0) {
        // Log full result structure to diagnose empty results
        const resultJson = JSON.stringify(result).slice(0, 500);
        console.log(`[ai-annotate] DDS returned 0 detections. Full result (truncated): ${resultJson}`);
      }
      return {
        result,
        meta: { categoryMap, resizeScale: payloadResizeScale, detectionWidth: payloadDetectionWidth, detectionHeight: payloadDetectionHeight },
      };
    }
    if (status === 'failed') {
      throw new Error(`DDS task failed: ${statusJson?.data?.error || 'unknown error'}`);
    }
    await sleep(pollEveryMs);
  }
  throw new Error('DDS task timed out while waiting for detection result');
}

function normalizeDdsDetectionBox(item) {
  const raw = item?.bbox || item?.box || item?.rect || item?.position;
  if (Array.isArray(raw) && raw.length >= 4) {
    const [x1, y1, x2, y2] = raw.map(Number);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      if (x2 > x1 && y2 > y1) return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      return { x: x1, y: y1, w: x2, h: y2 };
    }
  }
  return normalizeTrexBbox(item);
}

function extractDdsDetections(result) {
  const candidates = [];
  const arrays = [
    result?.objects,
    result?.detections,
    result?.results,
    result?.data?.objects,
    result?.data?.detections,
    result?.predictions,
  ].filter(Array.isArray);
  for (const arr of arrays) {
    for (const item of arr) candidates.push(item);
  }
  return candidates;
}

function extractRawDetectionsFromResponse(rawDetectionResponse) {
  return rawDetectionResponse?.detections
    || rawDetectionResponse?.results
    || rawDetectionResponse?.data?.detections
    || rawDetectionResponse?.data?.results
    || [];
}

function dedupeRawBoxes(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const box = normalizeTrexBbox(item);
    if (!box) continue;
    const key = `${Math.round(box.x)}:${Math.round(box.y)}:${Math.round(box.w)}:${Math.round(box.h)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function getPrimarySystemId(pnidId) {
  const primary = await prisma.pnid_system.findFirst({
    where: { pnid_id: pnidId, is_primary: true },
    select: { system_id: true },
  });
  if (primary?.system_id) return primary.system_id;
  const fallback = await prisma.pnid_system.findFirst({
    where: { pnid_id: pnidId },
    select: { system_id: true },
  });
  return fallback?.system_id || null;
}

async function findOrCreateEntity(tx, { pnidId, entityType, tagText, matchedEntityId }) {
  if (matchedEntityId) return matchedEntityId;

  const normalizedType = normalizeEntityType(entityType);
  const normalizedTag = String(tagText || '').trim();
  if (!normalizedTag) return null;

  if (normalizedType === 'equipment') {
    const existing = await tx.equipment.findFirst({
      where: { tag: { equals: normalizedTag, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    if (existing) return existing.id;
  } else if (normalizedType === 'instrument') {
    const existing = await tx.instrument.findFirst({
      where: { tag: { equals: normalizedTag, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    if (existing) return existing.id;
  } else {
    // Exact match
    const existing = await tx.line.findFirst({
      where: { line_number: { equals: normalizedTag, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Fuzzy: check if any existing line contains this text
    const fuzzy = await tx.line.findFirst({
      where: { line_number: { contains: normalizedTag, mode: 'insensitive' }, deleted_at: null },
      select: { id: true },
    });
    if (fuzzy) return fuzzy.id;

    // Fuzzy: strip size prefix and retry
    const stripped = normalizedTag.replace(/^\d+-/, '');
    if (stripped !== normalizedTag && stripped.length >= 3) {
      const strippedMatch = await tx.line.findFirst({
        where: { line_number: { contains: stripped, mode: 'insensitive' }, deleted_at: null },
        select: { id: true },
      });
      if (strippedMatch) return strippedMatch.id;
    }
  }

  const systemId = await getPrimarySystemId(pnidId);
  if (!systemId) return null;

  // Guard against creating garbage entities from poor OCR:
  // Lines must have at least one dash and minimum 4 characters to look like a real line number.
  // Tags like "28", "MT", "X1" are likely OCR fragments, not real line numbers.
  if (normalizedType === 'line') {
    if (normalizedTag.length < 4 || !normalizedTag.includes('-')) {
      console.log(`[ai-annotate] Skipping line creation for suspicious OCR text: "${normalizedTag}"`);
      return null;
    }
  }

  if (normalizedType === 'equipment') {
    const created = await tx.equipment.create({
      data: {
        system_id: systemId,
        tag: normalizedTag,
        equipment_type: 'General',
      },
      select: { id: true },
    });
    return created.id;
  }
  if (normalizedType === 'instrument') {
    const created = await tx.instrument.create({
      data: {
        system_id: systemId,
        tag: normalizedTag,
        instrument_type: 'other',
      },
      select: { id: true },
    });
    return created.id;
  }
  const created = await tx.line.create({
    data: {
      system_id: systemId,
      line_number: normalizedTag,
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertJunction(tx, { pnidId, entityType, entityId, box }) {
  const safeBox = box || { xPct: 0, yPct: 0, wPct: 3, hPct: 2 };
  if (entityType === 'equipment') {
    await tx.pnid_equipment.upsert({
      where: { pnid_id_equipment_id: { pnid_id: pnidId, equipment_id: entityId } },
      create: {
        pnid_id: pnidId,
        equipment_id: entityId,
        annotation_x_pct: safeBox.xPct,
        annotation_y_pct: safeBox.yPct,
        annotation_w_pct: safeBox.wPct,
        annotation_h_pct: safeBox.hPct,
      },
      update: {
        annotation_x_pct: safeBox.xPct,
        annotation_y_pct: safeBox.yPct,
        annotation_w_pct: safeBox.wPct,
        annotation_h_pct: safeBox.hPct,
      },
    });
    return;
  }
  if (entityType === 'instrument') {
    await tx.pnid_instrument.upsert({
      where: { pnid_id_instrument_id: { pnid_id: pnidId, instrument_id: entityId } },
      create: {
        pnid_id: pnidId,
        instrument_id: entityId,
        annotation_x_pct: safeBox.xPct,
        annotation_y_pct: safeBox.yPct,
        annotation_w_pct: safeBox.wPct,
        annotation_h_pct: safeBox.hPct,
      },
      update: {
        annotation_x_pct: safeBox.xPct,
        annotation_y_pct: safeBox.yPct,
        annotation_w_pct: safeBox.wPct,
        annotation_h_pct: safeBox.hPct,
      },
    });
    return;
  }
  await tx.pnid_line.upsert({
    where: { pnid_id_line_id: { pnid_id: pnidId, line_id: entityId } },
    create: {
      pnid_id: pnidId,
      line_id: entityId,
      annotation_x_pct: safeBox.xPct,
      annotation_y_pct: safeBox.yPct,
      annotation_w_pct: safeBox.wPct || null,
      annotation_h_pct: safeBox.hPct || null,
    },
    update: {
      annotation_x_pct: safeBox.xPct,
      annotation_y_pct: safeBox.yPct,
      annotation_w_pct: safeBox.wPct || null,
      annotation_h_pct: safeBox.hPct || null,
    },
  });
}

export default async function aiAnnotateRoutes(fastify) {
  fastify.get('/ai/models', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const platformId = request.query?.platformId || null;
    const visualConfig = await resolveVisualConfigForPlatform(platformId);
    const resolvedVisualProvider = getVisualProviderName(visualConfig);
    return {
      pilotEnabled: true,
      models: {
        trex2: {
          available: hasTrexConfig(visualConfig) || !!process.env.TREX2_API_URL,
          mode: hasTrexConfig(visualConfig) ? 'configured' : 'not_configured',
          endpoint: (visualConfig.provider === 'trex2' ? visualConfig.endpointUrl : process.env.TREX2_API_URL) || null,
        },
        groundingDino: {
          available: hasGroundingConfig(visualConfig) || !!process.env.GROUNDING_DINO_API_URL,
          mode: hasGroundingConfig(visualConfig) ? 'configured' : 'not_configured',
          endpoint: (visualConfig.provider === 'grounding_dino' ? visualConfig.endpointUrl : process.env.GROUNDING_DINO_API_URL) || null,
        },
        claude: {
          available: !!process.env.ANTHROPIC_API_KEY,
          mode: process.env.ANTHROPIC_API_KEY ? 'configured' : 'not_configured',
        },
        visualFewShot: {
          available: !!resolvedVisualProvider,
          mode: resolvedVisualProvider ? `enabled:${resolvedVisualProvider}` : 'disabled',
          source: visualConfig.source,
        },
      },
    };
  });

  fastify.post('/ai/annotate', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    const { pnidId, examples = [], mode = 'few_shot' } = request.body || {};
    if (!pnidId) return reply.code(400).send({ error: 'pnidId is required' });
    if (!Array.isArray(examples) || examples.length === 0) {
      return reply.code(400).send({ error: 'examples must contain at least one item' });
    }

    try {

    const visualConfig = await resolveVisualConfigForPnid(pnidId);
    const visualProvider = getVisualProviderName(visualConfig);
    if (!visualProvider) {
      return reply.code(503).send({
        error: 'Visual few-shot provider is not configured',
        hint: 'Configure visual detector in Admin > OCR Pipeline Settings (or set environment variables)',
      });
    }

    const runId = `pilot-${Date.now()}`;
    const parsedExamples = examples
      .map(ex => {
        const box = coerceBox(ex.bbox);
        if (!box) return null;
        const label = normalizeEntityType(ex.label || inferTypeFromTag(ex.tag, 'equipment'));
        return {
          bbox: box,
          label,
          tag: String(ex.tag || '').trim() || null,
        };
      })
      .filter(Boolean);

    if (parsedExamples.length === 0) {
      return reply.code(400).send({ error: 'examples must include valid bbox values' });
    }

    // Debug: log full parsed examples with coordinates
    parsedExamples.forEach((ex, i) => {
      console.log(`[ai-annotate] ParsedExample[${i}] bbox=(${ex.bbox.xPct.toFixed(2)},${ex.bbox.yPct.toFixed(2)},${ex.bbox.wPct.toFixed(2)},${ex.bbox.hPct.toFixed(2)}) label=${ex.label} tag=${ex.tag || '(none)'}`);
    });

    const { buffer: fileBuffer, contentType, platformId } = await getPnidFileBuffer(pnidId);
    const { rasterBuffer: imageBuffer, sourceType } = await toDetectionRaster({ fileBuffer, contentType });

    const meta = await sharp(imageBuffer).metadata();
    if (!meta.width || !meta.height) {
      return reply.code(400).send({ error: 'Unable to read drawing dimensions for segmentation' });
    }

    // Smart provider selection: GroundingDINO is fundamentally better for text-based
    // entities (line numbers, instrument tags) because it uses text prompts to find
    // semantic matches. T-Rex2 is visual-similarity-based and struggles with small text
    // on technical drawings (trained on natural images, not P&IDs).
    const exampleLabels = parsedExamples.map(ex => ex.label);
    const lineRatio = exampleLabels.filter(l => l === 'line').length / exampleLabels.length;
    const groundingAvailable = hasGroundingConfig(visualConfig) || !!process.env.GROUNDING_DINO_API_URL;
    let effectiveProvider = visualProvider;
    if (lineRatio >= 0.5 && groundingAvailable && visualProvider === 'trex2') {
      effectiveProvider = 'grounding_dino';
      console.log(`[ai-annotate] Auto-switching to GroundingDINO for line detection (${(lineRatio * 100).toFixed(0)}% line examples). T-Rex2 is not well-suited for text/label detection on P&IDs.`);
    }

    console.log(`[ai-annotate] pnid=${pnidId} provider=${effectiveProvider} (configured=${visualProvider}) raster=${meta.width}x${meta.height} examples=${parsedExamples.length} sourceType=${sourceType}`);

    const rawDetectionResponse = effectiveProvider === 'trex2'
      ? await callTrex2Detect({
          imageBuffer,
          examples: parsedExamples,
          imageWidth: meta.width,
          imageHeight: meta.height,
          visualConfig,
        })
      : await callGroundingDinoDetect({
          imageBuffer,
          examples: parsedExamples,
          imageWidth: meta.width,
          imageHeight: meta.height,
          visualConfig,
          platformId,
        });
    let visualDetectionsRaw = extractRawDetectionsFromResponse(rawDetectionResponse);

    // Fallback: if primary provider returns 0 detections, try the other provider
    if (visualDetectionsRaw.length === 0 && effectiveProvider !== visualProvider) {
      console.log(`[ai-annotate] ${effectiveProvider} returned 0 detections, falling back to ${visualProvider}`);
      const fallbackResponse = await callTrex2Detect({
        imageBuffer,
        examples: parsedExamples,
        imageWidth: meta.width,
        imageHeight: meta.height,
        visualConfig,
      });
      visualDetectionsRaw = extractRawDetectionsFromResponse(fallbackResponse);
    } else if (visualDetectionsRaw.length === 0 && effectiveProvider === 'trex2' && groundingAvailable) {
      console.log(`[ai-annotate] T-Rex2 returned 0 detections, falling back to GroundingDINO`);
      const fallbackResponse = await callGroundingDinoDetect({
        imageBuffer,
        examples: parsedExamples,
        imageWidth: meta.width,
        imageHeight: meta.height,
        visualConfig,
        platformId,
      });
      visualDetectionsRaw = extractRawDetectionsFromResponse(fallbackResponse);
      if (visualDetectionsRaw.length > 0) {
        effectiveProvider = 'grounding_dino';
        console.log(`[ai-annotate] GroundingDINO fallback recovered ${visualDetectionsRaw.length} detections`);
      }
    }

    // Trex recall booster: if first pass returns too few boxes, expand prompts and run once more.
    if (effectiveProvider === 'trex2' && String(process.env.AI_ANNOTATE_TREX_EXPAND ?? 'true').toLowerCase() !== 'false') {
      const expandThreshold = Math.max(1, Number(process.env.AI_ANNOTATE_TREX_EXPAND_THRESHOLD || 12));
      if (visualDetectionsRaw.length < expandThreshold) {
        if (visualDetectionsRaw.length > 0) {
          // Second pass: use top detections from first pass as additional prompt examples.
          const sorted = [...visualDetectionsRaw].sort((a, b) => Number(b?.score ?? b?.confidence ?? 0) - Number(a?.score ?? a?.confidence ?? 0));
          const seed = sorted.slice(0, Math.min(6, sorted.length));
          const firstLabel = parsedExamples[0]?.label || 'line';
          const autoExamples = [];
          for (const item of seed) {
            const box = normalizeTrexBbox(item);
            if (!box) continue;
            const pct = pixelToPctBox(
              {
                x: clamp(Math.round(box.x), 0, meta.width - 1),
                y: clamp(Math.round(box.y), 0, meta.height - 1),
                w: clamp(Math.round(box.w), 4, meta.width),
                h: clamp(Math.round(box.h), 4, meta.height),
              },
              meta.width,
              meta.height
            );
            autoExamples.push({
              bbox: { xPct: pct.x_pct, yPct: pct.y_pct, wPct: pct.w_pct, hPct: pct.h_pct },
              label: normalizeEntityType(item?.label || item?.class || item?.type || firstLabel),
              tag: null,
            });
          }
          if (autoExamples.length > 0) {
            const secondPass = await callTrex2Detect({
              imageBuffer,
              examples: [...parsedExamples, ...autoExamples].slice(0, 10),
              imageWidth: meta.width,
              imageHeight: meta.height,
              visualConfig,
            });
            const secondRaw = extractRawDetectionsFromResponse(secondPass);
            visualDetectionsRaw = dedupeRawBoxes([...visualDetectionsRaw, ...secondRaw]);
          }
        } else {
          // Zero detections from visual prompt — retry with slightly expanded example boxes
          // to account for tight cropping that may exclude visual context the model needs.
          console.log('[ai-annotate] First pass returned 0 detections — retrying with padded examples');
          const paddedExamples = parsedExamples.map(ex => ({
            ...ex,
            bbox: {
              xPct: Math.max(0, ex.bbox.xPct - 0.5),
              yPct: Math.max(0, ex.bbox.yPct - 0.5),
              wPct: Math.min(100, ex.bbox.wPct + 1.0),
              hPct: Math.min(100, ex.bbox.hPct + 1.0),
            },
          }));
          const retryPass = await callTrex2Detect({
            imageBuffer,
            examples: paddedExamples,
            imageWidth: meta.width,
            imageHeight: meta.height,
            visualConfig,
          });
          const retryRaw = extractRawDetectionsFromResponse(retryPass);
          if (retryRaw.length > 0) {
            visualDetectionsRaw = retryRaw;
            console.log(`[ai-annotate] Retry with padded examples recovered ${retryRaw.length} detections`);
          }
        }
      }
    }

    // --- OCR Text Extraction Strategy ---
    // Primary: Use existing full-page OCR results from ocr_extraction table (fast, accurate).
    // Fallback: Run Google Vision on cropped detection regions (slow, less accurate on small crops).
    const ocrEntries = await fetchOcrExtractions(prisma, pnidId);
    const useDbOcr = ocrEntries.length > 0;
    console.log(`[ai-annotate] OCR extraction DB lookup: found ${ocrEntries.length} entries for pnid ${pnidId} — ${useDbOcr ? 'using DB lookup' : 'falling back to crop-based Vision API'}`);

    let vision = null;
    if (!useDbOcr) {
      const visionCreds = await resolveVisionCredentials(platformId);
      const ocrAvailable = !!visionCreds;
      console.log(`[ai-annotate] Vision credentials: available=${ocrAvailable} source=${process.env.VISION_CREDENTIALS_JSON ? 'env' : (visionCreds ? 'database' : 'NONE')} platformId=${platformId}`);
      if (!ocrAvailable) {
        console.warn('[ai-annotate] OCR credentials not found — VISION_CREDENTIALS_JSON env var or storage_config DB entry required. Detection will proceed without OCR tag extraction.');
      }
      vision = ocrAvailable ? new VisionOCRProvider(visionCreds) : null;
    }
    const matchCache = new Map();

    const detections = [];
    const ocrDiagnostics = { attempted: 0, succeeded: 0, emptyTag: 0, failed: 0, skipped: 0, dbLookups: 0, dbHits: 0, credentialsMissing: !useDbOcr && !vision };
    const debugDir = isDebugEnabled() ? await ensureDebugDir().catch(() => null) : null;
    const maxDetections = Math.min(Number(process.env.AI_ANNOTATE_MAX_DETECTIONS || 200), 500);

    // Debug: save the detection image with all detection boxes drawn on it
    if (debugDir && visualDetectionsRaw.length > 0) {
      try {
        const debugRects = visualDetectionsRaw.slice(0, 50).map((item, i) => {
          const box = normalizeTrexBbox(item);
          if (!box) return null;
          const score = Number(item?.score ?? item?.confidence ?? 0);
          return { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h), color: score > 0.5 ? '#00FF00' : '#FFAA00', label: `D${i}:${score.toFixed(2)}` };
        }).filter(Boolean);
        await saveImageWithRects(imageBuffer, debugRects, path.join(debugDir, `detection-results-${Date.now()}.png`));
      } catch (e) { console.warn(`[ai-debug] Failed to save detection debug image: ${e.message}`); }
    }

    for (const item of visualDetectionsRaw.slice(0, maxDetections)) {
      const boxPx = normalizeTrexBbox(item);
      if (!boxPx) continue;
      const safeBox = {
        x: clamp(Math.round(boxPx.x), 0, meta.width - 1),
        y: clamp(Math.round(boxPx.y), 0, meta.height - 1),
        w: clamp(Math.round(boxPx.w), 4, meta.width),
        h: clamp(Math.round(boxPx.h), 4, meta.height),
      };
      if (safeBox.x + safeBox.w > meta.width) safeBox.w = meta.width - safeBox.x;
      if (safeBox.y + safeBox.h > meta.height) safeBox.h = meta.height - safeBox.y;
      if (safeBox.w < 4 || safeBox.h < 4) continue;

      const isInstrumentLike = safeBox.w > 0 && Math.abs(safeBox.w - safeBox.h) / safeBox.w < 0.3; // roughly square = circle
      const bbox = pixelToPctBox(safeBox, meta.width, meta.height);

      let tagText = null;
      let dbMatchedEntityId = null;

      // --- Primary: DB OCR lookup ---
      if (useDbOcr) {
        ocrDiagnostics.dbLookups += 1;
        const lookup = lookupTagFromOcrExtractions(ocrEntries, bbox, isInstrumentLike);
        if (lookup.tagText) {
          tagText = lookup.tagText;
          dbMatchedEntityId = lookup.matchedEntityId;
          ocrDiagnostics.dbHits += 1;
          ocrDiagnostics.succeeded += 1;
          if (ocrDiagnostics.dbHits <= 5) {
            console.log(`[ai-annotate] DB-OCR[${ocrDiagnostics.dbLookups}] tag="${tagText}" from="${lookup.ocrEntry?.text}" dist=${lookup.ocrEntry?.dist?.toFixed(1) || '?'} type=${lookup.ocrEntry?.tag_type || '?'}`);
          }
        } else {
          ocrDiagnostics.emptyTag += 1;
        }
      }

      // --- Fallback: Crop-based Vision API OCR ---
      if (!tagText && !useDbOcr) {
        const padX = Math.round(safeBox.w * (isInstrumentLike ? 0.8 : 0.5));
        const padTop = Math.round(safeBox.h * (isInstrumentLike ? 0.5 : 0.5));
        const padBottom = Math.round(safeBox.h * (isInstrumentLike ? 1.5 : 0.5));
        const ocrBox = {
          left: Math.max(0, safeBox.x - padX),
          top: Math.max(0, safeBox.y - padTop),
          width: Math.min(meta.width - Math.max(0, safeBox.x - padX), safeBox.w + padX * 2),
          height: Math.min(meta.height - Math.max(0, safeBox.y - padTop), safeBox.h + padTop + padBottom),
        };

        if (!vision) {
          ocrDiagnostics.skipped += 1;
        } else {
          ocrDiagnostics.attempted += 1;
        }
        try {
          const crop = await sharp(imageBuffer).extract(ocrBox).png().toBuffer();
          if (debugDir && ocrDiagnostics.attempted <= 10) {
            await saveOcrCrop(crop, ocrDiagnostics.attempted, null, debugDir).catch(() => {});
          }
          if (vision) {
            const ocr = await vision.extractFromImage(crop);
            if (ocrDiagnostics.attempted <= 5) {
              const wordTexts = (ocr?.words || []).slice(0, 10).map(w => w.text).join(', ');
              const fullSnippet = (ocr?.fullText || '').slice(0, 80).replace(/\n/g, ' ');
              console.log(`[ai-annotate] OCR[${ocrDiagnostics.attempted}] crop=${ocrBox.width}x${ocrBox.height} words=${ocr?.words?.length || 0} fullText="${fullSnippet}" wordSamples=[${wordTexts}]`);
            }
            tagText = extractTagFromOcr(ocr);
            if (tagText) {
              ocrDiagnostics.succeeded += 1;
              if (ocrDiagnostics.succeeded <= 5) {
                console.log(`[ai-annotate] OCR extracted tag: "${tagText}"`);
              }
            } else {
              ocrDiagnostics.emptyTag += 1;
            }
          }
        } catch (err) {
          ocrDiagnostics.failed += 1;
          if (ocrDiagnostics.failed <= 5) {
            console.warn(`[ai-annotate] OCR failed on detection crop: ${err?.message || 'unknown error'}`);
          }
          tagText = null;
        }
      }

      const labelHint = normalizeEntityType(item?.label || item?.class || item?.type || null);
      const entityType = normalizeEntityType(inferTypeFromTag(tagText, labelHint));
      const confidence = Math.max(0, Math.min(1, Number(item?.score ?? item?.confidence ?? 0.5)));

      let matchedEntityId = dbMatchedEntityId || null;
      if (tagText && !matchedEntityId) {
        matchedEntityId = await matchEntityByTag(prisma, matchCache, entityType, tagText);
      }

      detections.push({
        bbox,
        tag_text: tagText,
        entity_type: entityType,
        confidence,
        matched_entity_id: matchedEntityId,
        is_new_tag: !!tagText && !matchedEntityId,
        detection_source: effectiveProvider === 'trex2' ? 't-rex2-visual' : 'grounding-dino-visual',
        extraction_id: null,
      });
    }

    const stats = {
      total: detections.length,
      equipment: detections.filter(d => d.entity_type === 'equipment').length,
      instruments: detections.filter(d => d.entity_type === 'instrument').length,
      lines: detections.filter(d => d.entity_type === 'line').length,
      uncertain: detections.filter(d => d.confidence < 0.7).length,
    };

    // Log detections with coordinates for debugging
    console.log(`[ai-annotate] Detection summary: total=${detections.length} lines=${stats.lines} instruments=${stats.instruments} equipment=${stats.equipment}`);
    console.log(`[ai-annotate] OCR summary: dbLookups=${ocrDiagnostics.dbLookups} dbHits=${ocrDiagnostics.dbHits} cropAttempted=${ocrDiagnostics.attempted} succeeded=${ocrDiagnostics.succeeded} empty=${ocrDiagnostics.emptyTag} failed=${ocrDiagnostics.failed} skipped=${ocrDiagnostics.skipped || 0}`);
    detections.slice(0, 8).forEach((d, i) => {
      console.log(`[ai-annotate] Final[${i}] pct=(${d.bbox.x_pct},${d.bbox.y_pct},${d.bbox.w_pct},${d.bbox.h_pct}) tag=${d.tag_text || '(none)'} conf=${d.confidence.toFixed(3)} type=${d.entity_type} matched=${d.matched_entity_id ? 'yes' : 'no'}`);
    });

    return { runId, mode, detections, stats, provider: effectiveProvider, configuredProvider: visualProvider, sourceType, _diagnostics: { ocr: ocrDiagnostics, debugDir: debugDir || null } };

    } catch (err) {
      console.error(`[ai-annotate] Unhandled error in /ai/annotate: ${err.message}`, err.stack);
      return reply.code(500).send({
        error: `Detection pipeline failed: ${err.message}`,
        hint: 'Check backend logs for details. Common causes: missing API token, network timeout, or invalid drawing file.',
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Debug diagnostic endpoint — pipeline health check
  // ---------------------------------------------------------------------------
  fastify.post('/ai/debug/pipeline', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    const { pnidId, examples = [] } = request.body || {};
    if (!pnidId) return reply.code(400).send({ error: 'pnidId is required' });

    const diagnostics = {
      timestamp: new Date().toISOString(),
      config: {},
      credentials: {},
      imageInfo: {},
      promptBoxes: [],
      providerSelection: {},
      errors: [],
    };

    // 1. Check configuration
    const visualConfig = await resolveVisualConfigForPnid(pnidId);
    const visualProvider = getVisualProviderName(visualConfig);
    diagnostics.config = {
      provider: visualProvider,
      trex2Available: hasTrexConfig(visualConfig) || !!process.env.TREX2_API_URL,
      groundingDinoAvailable: hasGroundingConfig(visualConfig) || !!process.env.GROUNDING_DINO_API_URL,
      maxDim: Number(process.env.AI_ANNOTATE_DDS_MAX_DIM || 1536),
      textMaxDim: Number(process.env.AI_ANNOTATE_TEXT_MAX_DIM || 0),
      pdfDensity: Number(process.env.AI_ANNOTATE_PDF_DENSITY || 420),
      scoreThreshold: Number(process.env.AI_ANNOTATE_TREX_SCORE_THRESHOLD || 0.2),
      debugEnabled: isDebugEnabled(),
    };

    // 2. Check OCR credentials
    try {
      const { buffer: fileBuffer, contentType, platformId } = await getPnidFileBuffer(pnidId);
      const visionCreds = await resolveVisionCredentials(platformId);
      diagnostics.credentials = {
        visionCredentials: !!visionCreds,
        source: process.env.VISION_CREDENTIALS_JSON ? 'env_var' : (visionCreds ? 'database' : 'none'),
      };

      // 3. Rasterize and get image info
      const { rasterBuffer, sourceType } = await toDetectionRaster({ fileBuffer, contentType });
      const meta = await sharp(rasterBuffer).metadata();
      const resized = await resizeForDetection(rasterBuffer);
      diagnostics.imageInfo = {
        sourceType,
        originalWidth: meta.width,
        originalHeight: meta.height,
        resizedWidth: resized.width,
        resizedHeight: resized.height,
        resizeScale: resized.scale,
        originalSizeMB: (rasterBuffer.length / (1024 * 1024)).toFixed(2),
      };

      // 4. Calculate prompt box dimensions in pixels
      if (examples.length > 0) {
        const parsedExamples = examples.map(ex => {
          const box = coerceBox(ex.bbox);
          if (!box) return null;
          return { bbox: box, label: normalizeEntityType(ex.label || 'equipment'), tag: ex.tag || '' };
        }).filter(Boolean);

        diagnostics.promptBoxes = parsedExamples.map((ex, i) => {
          const origPx = toPixelBox(ex.bbox, meta.width, meta.height);
          const resizedPx = {
            x: Math.round(origPx.x * resized.scale),
            y: Math.round(origPx.y * resized.scale),
            w: Math.round(origPx.w * resized.scale),
            h: Math.round(origPx.h * resized.scale),
          };
          return {
            index: i,
            label: ex.label,
            tag: ex.tag,
            pctBox: { xPct: ex.bbox.xPct, yPct: ex.bbox.yPct, wPct: ex.bbox.wPct, hPct: ex.bbox.hPct },
            originalPixels: origPx,
            resizedPixels: resizedPx,
            resizedHeightPx: resizedPx.h,
            assessment: resizedPx.h < 10 ? 'TOO_SMALL — prompt box < 10px tall after resize, detection likely to fail' :
                        resizedPx.h < 20 ? 'MARGINAL — prompt box 10-20px tall, detection may be unreliable' :
                        'OK',
          };
        });

        // 5. Provider selection logic
        const lineRatio = parsedExamples.filter(ex => ex.label === 'line').length / parsedExamples.length;
        const groundingAvailable = hasGroundingConfig(visualConfig) || !!process.env.GROUNDING_DINO_API_URL;
        diagnostics.providerSelection = {
          configuredProvider: visualProvider,
          lineExampleRatio: lineRatio,
          groundingDinoAvailable: groundingAvailable,
          wouldAutoSwitch: lineRatio >= 0.5 && groundingAvailable && visualProvider === 'trex2',
          effectiveProvider: (lineRatio >= 0.5 && groundingAvailable && visualProvider === 'trex2') ? 'grounding_dino' : visualProvider,
          recommendation: lineRatio >= 0.5 && !groundingAvailable
            ? 'Configure GroundingDINO for better line number detection. T-Rex2 is not well-suited for text/label detection on P&IDs.'
            : null,
        };
      }
    } catch (err) {
      diagnostics.errors.push(err.message);
    }

    return diagnostics;
  });

  // ---------------------------------------------------------------------------
  // Batch detection across multiple P&IDs
  // ---------------------------------------------------------------------------

  const batchProgress = new Map(); // batchId → { status, startedAt, totalDrawings, processed, failed, results }

  function updateBatchProgress(batchId, pnidId, data) {
    if (!batchProgress.has(batchId)) return;
    const bp = batchProgress.get(batchId);
    if (pnidId) {
      bp.results = bp.results || {};
      bp.results[pnidId] = { ...bp.results[pnidId], ...data, updatedAt: Date.now() };
    }
    Object.assign(bp, { processed: data._processed ?? bp.processed, failed: data._failed ?? bp.failed });
  }

  function finishBatch(batchId, status) {
    if (batchProgress.has(batchId)) {
      const bp = batchProgress.get(batchId);
      bp.status = status;
      bp.completedAt = Date.now();
      setTimeout(() => batchProgress.delete(batchId), 5 * 60 * 1000);
    }
  }

  /**
   * Process raw detection items into structured detection objects with OCR tag text.
   * Extracted as a helper for reuse between single-drawing and batch endpoints.
   * Uses DB OCR extractions (fast) when available, falls back to crop-based Vision API.
   */
  async function buildDetections({ visualDetectionsRaw, imageBuffer, imageWidth, imageHeight, platformId, visualProvider, pnidId }) {
    // Primary: DB OCR lookup
    const ocrEntries = pnidId ? await fetchOcrExtractions(prisma, pnidId) : [];
    const useDbOcr = ocrEntries.length > 0;

    // Fallback: Vision API crops
    let vision = null;
    if (!useDbOcr) {
      const visionCreds = await resolveVisionCredentials(platformId);
      if (visionCreds) {
        vision = new VisionOCRProvider(visionCreds);
      } else {
        console.warn('[ai-batch] No OCR source — no DB extractions and no Vision credentials');
      }
    } else {
      console.log(`[ai-batch] Using ${ocrEntries.length} DB OCR entries for pnid ${pnidId}`);
    }

    const matchCache = new Map();
    const detections = [];
    const maxDetections = Math.min(Number(process.env.AI_ANNOTATE_MAX_DETECTIONS || 200), 500);
    let ocrFailuresLogged = 0;
    let dbHits = 0;

    for (const item of visualDetectionsRaw.slice(0, maxDetections)) {
      const boxPx = normalizeTrexBbox(item);
      if (!boxPx) continue;
      const safeBox = {
        x: clamp(Math.round(boxPx.x), 0, imageWidth - 1),
        y: clamp(Math.round(boxPx.y), 0, imageHeight - 1),
        w: clamp(Math.round(boxPx.w), 4, imageWidth),
        h: clamp(Math.round(boxPx.h), 4, imageHeight),
      };
      if (safeBox.x + safeBox.w > imageWidth) safeBox.w = imageWidth - safeBox.x;
      if (safeBox.y + safeBox.h > imageHeight) safeBox.h = imageHeight - safeBox.y;
      if (safeBox.w < 4 || safeBox.h < 4) continue;

      const isInstrumentLike = safeBox.w > 0 && Math.abs(safeBox.w - safeBox.h) / safeBox.w < 0.3;
      const bbox = pixelToPctBox(safeBox, imageWidth, imageHeight);

      let tagText = null;
      let dbMatchedEntityId = null;

      // Primary: DB OCR lookup
      if (useDbOcr) {
        const lookup = lookupTagFromOcrExtractions(ocrEntries, bbox, isInstrumentLike);
        if (lookup.tagText) {
          tagText = lookup.tagText;
          dbMatchedEntityId = lookup.matchedEntityId;
          dbHits += 1;
        }
      }

      // Fallback: crop-based Vision API
      if (!tagText && !useDbOcr && vision) {
        const padX = Math.round(safeBox.w * (isInstrumentLike ? 0.8 : 0.5));
        const padTop = Math.round(safeBox.h * (isInstrumentLike ? 0.5 : 0.5));
        const padBottom = Math.round(safeBox.h * (isInstrumentLike ? 1.5 : 0.5));
        const ocrBox = {
          left: Math.max(0, safeBox.x - padX),
          top: Math.max(0, safeBox.y - padTop),
          width: Math.min(imageWidth - Math.max(0, safeBox.x - padX), safeBox.w + padX * 2),
          height: Math.min(imageHeight - Math.max(0, safeBox.y - padTop), safeBox.h + padTop + padBottom),
        };
        try {
          const crop = await sharp(imageBuffer).extract(ocrBox).png().toBuffer();
          const ocr = await vision.extractFromImage(crop);
          tagText = extractTagFromOcr(ocr);
        } catch (err) {
          if (ocrFailuresLogged < 3) {
            ocrFailuresLogged += 1;
            console.warn(`[ai-batch] OCR failed on batch crop: ${err?.message || 'unknown error'}`);
          }
          tagText = null;
        }
      }

      const labelHint = normalizeEntityType(item?.label || item?.class || item?.type || null);
      const entityType = normalizeEntityType(inferTypeFromTag(tagText, labelHint));
      const confidence = Math.max(0, Math.min(1, Number(item?.score ?? item?.confidence ?? 0.5)));

      let matchedEntityId = dbMatchedEntityId || null;
      if (tagText && !matchedEntityId) {
        matchedEntityId = await matchEntityByTag(prisma, matchCache, entityType, tagText);
      }

      detections.push({
        bbox,
        tag_text: tagText,
        entity_type: entityType,
        confidence,
        matched_entity_id: matchedEntityId,
        is_new_tag: !!tagText && !matchedEntityId,
        detection_source: visualProvider === 'trex2' ? 't-rex2-visual' : 'grounding-dino-visual',
        extraction_id: null,
      });
    }
    if (useDbOcr) console.log(`[ai-batch] DB OCR: ${dbHits}/${detections.length} detections matched text`);
    return detections;
  }

  /**
   * Run detection on a single P&ID drawing using given examples and visual config.
   * For cross-drawing batch mode, pass sourceImage with the rasterized source drawing
   * so the detector knows which image the example bboxes reference.
   * Automatically selects GroundingDINO for line number detection when available.
   */
  async function detectOnDrawing({ pnidId, parsedExamples, visualConfig, visualProvider, sourceImage }) {
    const { buffer: fileBuffer, contentType, platformId } = await getPnidFileBuffer(pnidId);
    const { rasterBuffer: imageBuffer } = await toDetectionRaster({ fileBuffer, contentType });
    const meta = await sharp(imageBuffer).metadata();
    if (!meta.width || !meta.height) throw new Error('Unable to read drawing dimensions');

    // Smart provider selection for batch mode (same as single-drawing)
    const lineRatio = parsedExamples.filter(ex => ex.label === 'line').length / parsedExamples.length;
    const groundingAvailable = hasGroundingConfig(visualConfig) || !!process.env.GROUNDING_DINO_API_URL;
    let effectiveProvider = visualProvider;
    if (lineRatio >= 0.5 && groundingAvailable && visualProvider === 'trex2') {
      effectiveProvider = 'grounding_dino';
    }

    const rawResponse = effectiveProvider === 'trex2'
      ? await callTrex2Detect({
          imageBuffer,
          examples: parsedExamples,
          imageWidth: meta.width,
          imageHeight: meta.height,
          visualConfig,
          promptImageBuffer: sourceImage?.buffer || null,
          promptImageWidth: sourceImage?.width || null,
          promptImageHeight: sourceImage?.height || null,
        })
      : await callGroundingDinoDetect({ imageBuffer, examples: parsedExamples, imageWidth: meta.width, imageHeight: meta.height, visualConfig, platformId });

    let visualDetectionsRaw = extractRawDetectionsFromResponse(rawResponse);

    // Recall booster for T-Rex2 (same logic as single-drawing endpoint)
    if (effectiveProvider === 'trex2' && String(process.env.AI_ANNOTATE_TREX_EXPAND ?? 'true').toLowerCase() !== 'false') {
      const expandThreshold = Math.max(1, Number(process.env.AI_ANNOTATE_TREX_EXPAND_THRESHOLD || 12));
      if (visualDetectionsRaw.length < expandThreshold) {
        if (visualDetectionsRaw.length > 0) {
          const sorted = [...visualDetectionsRaw].sort((a, b) => Number(b?.score ?? b?.confidence ?? 0) - Number(a?.score ?? a?.confidence ?? 0));
          const seed = sorted.slice(0, Math.min(6, sorted.length));
          const firstLabel = parsedExamples[0]?.label || 'line';
          const autoExamples = [];
          for (const item of seed) {
            const box = normalizeTrexBbox(item);
            if (!box) continue;
            const pct = pixelToPctBox(
              { x: clamp(Math.round(box.x), 0, meta.width - 1), y: clamp(Math.round(box.y), 0, meta.height - 1), w: clamp(Math.round(box.w), 4, meta.width), h: clamp(Math.round(box.h), 4, meta.height) },
              meta.width, meta.height
            );
            autoExamples.push({ bbox: { xPct: pct.x_pct, yPct: pct.y_pct, wPct: pct.w_pct, hPct: pct.h_pct }, label: normalizeEntityType(item?.label || item?.class || item?.type || firstLabel), tag: null });
          }
          if (autoExamples.length > 0) {
            const secondPass = await callTrex2Detect({ imageBuffer, examples: [...parsedExamples, ...autoExamples].slice(0, 10), imageWidth: meta.width, imageHeight: meta.height, visualConfig });
            visualDetectionsRaw = dedupeRawBoxes([...visualDetectionsRaw, ...extractRawDetectionsFromResponse(secondPass)]);
          }
        } else {
          const paddedExamples = parsedExamples.map(ex => ({
            ...ex,
            bbox: {
              xPct: Math.max(0, ex.bbox.xPct - 0.5),
              yPct: Math.max(0, ex.bbox.yPct - 0.5),
              wPct: Math.min(100, ex.bbox.wPct + 1.0),
              hPct: Math.min(100, ex.bbox.hPct + 1.0),
            },
          }));
          const retryPass = await callTrex2Detect({
            imageBuffer,
            examples: paddedExamples,
            imageWidth: meta.width,
            imageHeight: meta.height,
            visualConfig,
          });
          const retryRaw = extractRawDetectionsFromResponse(retryPass);
          if (retryRaw.length > 0) {
            visualDetectionsRaw = retryRaw;
          }
        }
      }
    }

    const detections = await buildDetections({ visualDetectionsRaw, imageBuffer, imageWidth: meta.width, imageHeight: meta.height, platformId, visualProvider: effectiveProvider, pnidId });
    return { detections, imageWidth: meta.width, imageHeight: meta.height };
  }

  fastify.post('/ai/annotate/batch', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    const { platformId, sourcePnidId, examples = [], category = 'line', targetPnidIds, threshold = 0.25 } = request.body || {};
    if (!platformId) return reply.code(400).send({ error: 'platformId is required' });
    if (!sourcePnidId) return reply.code(400).send({ error: 'sourcePnidId is required' });
    if (!Array.isArray(examples) || examples.length === 0) {
      return reply.code(400).send({ error: 'examples must contain at least one item' });
    }

    const parsedExamples = examples
      .map(ex => {
        const box = coerceBox(ex.bbox);
        if (!box) return null;
        const label = normalizeEntityType(ex.label || inferTypeFromTag(ex.tag, 'equipment'));
        return { bbox: box, label, tag: String(ex.tag || '').trim() || null };
      })
      .filter(Boolean);
    if (parsedExamples.length === 0) return reply.code(400).send({ error: 'examples must include valid bbox values' });

    const visualConfig = await resolveVisualConfigForPlatform(platformId);
    const visualProvider = getVisualProviderName(visualConfig);
    if (!visualProvider) {
      return reply.code(503).send({ error: 'Visual few-shot provider is not configured' });
    }

    // Resolve target P&IDs
    let pnidRows;
    if (Array.isArray(targetPnidIds) && targetPnidIds.length > 0) {
      pnidRows = await prisma.pnid.findMany({
        where: { id: { in: targetPnidIds }, deleted_at: null },
        select: { id: true, drawing_number: true },
      });
    } else {
      // All P&IDs for platform
      pnidRows = await prisma.$queryRaw`
        SELECT DISTINCT p.id, p.drawing_number
        FROM pnid p
        JOIN pnid_system ps ON ps.pnid_id = p.id
        JOIN system s ON s.id = ps.system_id
        WHERE s.platform_id = ${platformId}::uuid
          AND p.deleted_at IS NULL
          AND s.deleted_at IS NULL
        ORDER BY p.drawing_number
      `;
    }

    if (!pnidRows?.length) return reply.code(404).send({ error: 'No P&IDs found for this platform' });

    // Create batch record with proper UUID
    const batchIdRows = await prisma.$queryRaw`
      INSERT INTO ai_detection_batch (platform_id, source_pnid_id, category, status, total_drawings, example_data, threshold)
      VALUES (${platformId}::uuid, ${sourcePnidId}::uuid, ${category}, 'processing', ${pnidRows.length}, ${JSON.stringify(parsedExamples)}::jsonb, ${threshold})
      RETURNING id
    `.catch(() => []);
    const batchId = batchIdRows?.[0]?.id;
    if (!batchId) return reply.code(500).send({ error: 'Failed to create batch record' });

    // Initialize in-memory progress
    batchProgress.set(batchId, {
      status: 'processing',
      startedAt: Date.now(),
      totalDrawings: pnidRows.length,
      processed: 0,
      failed: 0,
      results: {},
    });

    // Initialize per-drawing progress
    for (const row of pnidRows) {
      const pnidId = row.id;
      batchProgress.get(batchId).results[pnidId] = {
        pnidId,
        drawingNumber: row.drawing_number || '',
        status: 'pending',
        detectionCount: 0,
      };
    }

    // Process drawings asynchronously (fire-and-forget)
    setImmediate(async () => {
      let processedCount = 0;
      let failedCount = 0;

      // Rasterize the source drawing once for cross-drawing prompt support.
      // T-Rex2 needs the source image to interpret prompt bbox positions correctly.
      let sourceImage = null;
      try {
        const { buffer: srcFileBuffer, contentType: srcContentType } = await getPnidFileBuffer(sourcePnidId);
        const { rasterBuffer: srcRaster } = await toDetectionRaster({ fileBuffer: srcFileBuffer, contentType: srcContentType });
        const srcMeta = await sharp(srcRaster).metadata();
        if (srcMeta.width && srcMeta.height) {
          sourceImage = { buffer: srcRaster, width: srcMeta.width, height: srcMeta.height };
          console.log(`[ai-batch] Source drawing rasterized: ${srcMeta.width}x${srcMeta.height}`);
        }
      } catch (err) {
        console.error(`[ai-batch] Failed to rasterize source drawing:`, err.message);
      }

      for (const row of pnidRows) {
        const pnidId = row.id;
        const drawingNumber = row.drawing_number || '';
        updateBatchProgress(batchId, pnidId, { status: 'processing', drawingNumber });

        // For the source drawing itself, don't use cross-drawing mode (same image)
        const isSameDrawing = pnidId === sourcePnidId;
        const crossImage = isSameDrawing ? null : sourceImage;

        const startMs = Date.now();
        try {
          console.log(`[ai-batch] Processing ${drawingNumber} (${pnidId}) [${processedCount + 1}/${pnidRows.length}]${isSameDrawing ? ' (source)' : ''}`);
          const { detections } = await detectOnDrawing({ pnidId, parsedExamples, visualConfig, visualProvider, sourceImage: crossImage });

          processedCount++;
          updateBatchProgress(batchId, pnidId, {
            status: 'completed',
            detectionCount: detections.length,
            processingMs: Date.now() - startMs,
            _processed: processedCount,
          });

          // Store results in DB
          await prisma.$executeRaw`
            INSERT INTO ai_detection_batch_result (batch_id, pnid_id, drawing_number, status, detection_count, detections, processing_ms, completed_at)
            VALUES (${batchId}::uuid, ${pnidId}::uuid, ${drawingNumber}, 'completed', ${detections.length}, ${JSON.stringify(detections)}::jsonb, ${Date.now() - startMs}, NOW())
          `.catch(err => console.error(`[ai-batch] Failed to store results for ${pnidId}:`, err.message));

          console.log(`[ai-batch] ${drawingNumber}: ${detections.length} detections in ${Date.now() - startMs}ms`);
        } catch (err) {
          failedCount++;
          processedCount++;
          updateBatchProgress(batchId, pnidId, {
            status: 'failed',
            errorMessage: err.message,
            _processed: processedCount,
            _failed: failedCount,
          });

          await prisma.$executeRaw`
            INSERT INTO ai_detection_batch_result (batch_id, pnid_id, drawing_number, status, error_message, processing_ms, completed_at)
            VALUES (${batchId}::uuid, ${pnidId}::uuid, ${drawingNumber}, 'failed', ${err.message}, ${Date.now() - startMs}, NOW())
          `.catch(() => {});

          console.error(`[ai-batch] ${drawingNumber} failed:`, err.message);
        }
      }

      // Finalize
      const finalStatus = failedCount === pnidRows.length ? 'failed' : 'completed';
      finishBatch(batchId, finalStatus);
      await prisma.$executeRaw`
        UPDATE ai_detection_batch
        SET status = ${finalStatus}, processed = ${processedCount}, failed = ${failedCount}, completed_at = NOW()
        WHERE id = ${batchId}::uuid
      `.catch(() => {});

      console.log(`[ai-batch] Batch ${batchId} ${finalStatus}: ${processedCount}/${pnidRows.length} drawings, ${failedCount} failed`);
    });

    return { batchId, totalDrawings: pnidRows.length, status: 'processing' };
  });

  fastify.get('/ai/annotate/batch/:batchId/progress', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { batchId } = request.params;

    // Try in-memory first
    const mem = batchProgress.get(batchId);
    if (mem) {
      const results = Object.values(mem.results || {}).map(r => ({
        pnidId: r.pnidId,
        drawingNumber: r.drawingNumber || '',
        status: r.status,
        detectionCount: r.detectionCount || 0,
        errorMessage: r.errorMessage || null,
        processingMs: r.processingMs || null,
      }));
      return {
        batchId,
        status: mem.status,
        totalDrawings: mem.totalDrawings,
        processed: mem.processed,
        failed: mem.failed,
        results,
      };
    }

    // Fallback to DB
    const batchRows = await prisma.$queryRaw`
      SELECT status, total_drawings, processed, failed FROM ai_detection_batch WHERE id = ${batchId}::uuid LIMIT 1
    `.catch(() => []);
    if (!batchRows?.length) return reply.code(404).send({ error: 'Batch not found' });

    const batch = batchRows[0];
    const resultRows = await prisma.$queryRaw`
      SELECT pnid_id, drawing_number, status, detection_count, error_message, processing_ms
      FROM ai_detection_batch_result WHERE batch_id = ${batchId}::uuid ORDER BY created_at
    `.catch(() => []);

    return {
      batchId,
      status: batch.status,
      totalDrawings: batch.total_drawings,
      processed: batch.processed,
      failed: batch.failed,
      results: (resultRows || []).map(r => ({
        pnidId: r.pnid_id,
        drawingNumber: r.drawing_number || '',
        status: r.status,
        detectionCount: r.detection_count || 0,
        errorMessage: r.error_message || null,
        processingMs: r.processing_ms || null,
      })),
    };
  });

  fastify.get('/ai/annotate/batch/:batchId/results/:pnidId', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { batchId, pnidId } = request.params;

    const rows = await prisma.$queryRaw`
      SELECT detections, detection_count, status, error_message, drawing_number
      FROM ai_detection_batch_result
      WHERE batch_id = ${batchId}::uuid AND pnid_id = ${pnidId}::uuid
      LIMIT 1
    `.catch(() => []);

    if (!rows?.length) return reply.code(404).send({ error: 'Results not found' });
    const row = rows[0];
    return {
      pnidId,
      drawingNumber: row.drawing_number || '',
      status: row.status,
      detectionCount: row.detection_count || 0,
      detections: row.detections || [],
      errorMessage: row.error_message || null,
    };
  });

  fastify.post('/ai/annotate/batch/:batchId/accept', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { batchId } = request.params;
    const { decisions = [] } = request.body || {};

    if (!Array.isArray(decisions) || decisions.length === 0) {
      return reply.code(400).send({ error: 'decisions array is required' });
    }

    // Group decisions by pnidId
    const byPnid = {};
    for (const d of decisions) {
      if (!d.pnidId) continue;
      if (!byPnid[d.pnidId]) byPnid[d.pnidId] = [];
      byPnid[d.pnidId].push(d);
    }

    let totalCreated = 0;
    let totalRejected = 0;
    let totalSkippedNoBox = 0;

    // Retrieve batch info for feedback recording
    const batchRows = await prisma.$queryRaw`
      SELECT platform_id, category FROM ai_detection_batch WHERE id = ${batchId}::uuid LIMIT 1
    `.catch(() => []);
    const batchInfo = batchRows?.[0];

    for (const [pnidId, pnidDecisions] of Object.entries(byPnid)) {
      // Load detections for this drawing
      const resultRows = await prisma.$queryRaw`
        SELECT detections FROM ai_detection_batch_result
        WHERE batch_id = ${batchId}::uuid AND pnid_id = ${pnidId}::uuid
        LIMIT 1
      `.catch(() => []);
      const allDetections = resultRows?.[0]?.detections || [];
      if (allDetections.length === 0) continue;

      await prisma.$transaction(async tx => {
        for (const decision of pnidDecisions) {
          const idx = Number(decision.detectionIndex);
          if (!Number.isInteger(idx) || idx < 0 || idx >= allDetections.length) continue;
          const detection = allDetections[idx];

          // Record feedback
          if (batchInfo?.platform_id) {
            const action = decision.accepted ? 'accept' : 'reject';
            await tx.$executeRaw`
              INSERT INTO ai_detection_feedback (platform_id, batch_id, pnid_id, category, action, tag_text, entity_type, confidence, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct)
              VALUES (${batchInfo.platform_id}::uuid, ${batchId}::uuid, ${pnidId}::uuid, ${batchInfo.category || 'line'}, ${action},
                      ${detection.tag_text || null}, ${detection.entity_type || null}, ${detection.confidence || 0},
                      ${detection.bbox?.x_pct || 0}, ${detection.bbox?.y_pct || 0}, ${detection.bbox?.w_pct || 0}, ${detection.bbox?.h_pct || 0})
            `.catch(() => {});
          }

          if (!decision.accepted) {
            totalRejected++;
            continue;
          }

          const entityType = normalizeEntityType(detection.entity_type);
          const tagText = String(detection.tag_text || '').trim();
          const box = coerceBox(detection.bbox);
          if (!hasMeaningfulBox(box)) {
            totalSkippedNoBox++;
            continue;
          }

          const entityId = await findOrCreateEntity(tx, {
            pnidId,
            entityType,
            tagText,
            matchedEntityId: detection.matched_entity_id,
          });
          if (!entityId) continue;

          await upsertJunction(tx, { pnidId, entityType, entityId, box });

          await tx.annotation.create({
            data: {
              pnid_id: pnidId,
              author_id: DEFAULT_AUTHOR_ID,
              annotation_type: 'shape',
              shape: entityType === 'instrument' ? 'circle' : 'rectangle',
              text: tagText || null,
              x_pct: box.xPct,
              y_pct: box.yPct,
              w_pct: box.wPct,
              h_pct: box.hPct,
              color: entityType === 'line' ? '#8AB4FF' : entityType === 'instrument' ? '#FFD466' : '#3BE494',
              stroke_width: 2,
              fill_opacity: 0.15,
              linked_entity_type: entityType,
              linked_entity_id: entityId,
              metadata: {
                source: 'ai_batch',
                review_decision: 'accepted',
                confidence: Number(detection.confidence ?? 0),
                batch_id: batchId,
                detection_source: detection.detection_source || 't-rex2',
                original_tag_text: tagText || null,
                bbox_source: 'detector',
              },
            },
          });
          totalCreated++;
        }
      });
    }

    return {
      created: totalCreated,
      rejected: totalRejected,
      skippedNoBox: totalSkippedNoBox,
      totalReviewed: decisions.length,
      message: `Applied ${totalCreated} accepted detections across ${Object.keys(byPnid).length} drawings`,
    };
  });

  // ---------------------------------------------------------------------------
  // Batch Accept All — apply all detections above a confidence threshold
  // ---------------------------------------------------------------------------

  fastify.post('/ai/annotate/batch/:batchId/accept-all', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { batchId } = request.params;
    const { threshold = 0.15 } = request.body || {};

    // Load batch info
    const batchRows = await prisma.$queryRaw`
      SELECT platform_id, category FROM ai_detection_batch WHERE id = ${batchId}::uuid LIMIT 1
    `.catch(() => []);
    const batchInfo = batchRows?.[0];
    if (!batchInfo) return reply.code(404).send({ error: 'Batch not found' });

    // Load all completed results
    const resultRows = await prisma.$queryRaw`
      SELECT pnid_id, detections FROM ai_detection_batch_result
      WHERE batch_id = ${batchId}::uuid AND status = 'completed' AND detections IS NOT NULL
    `.catch(() => []);

    let totalCreated = 0;
    let totalSkipped = 0;
    let totalSkippedNoBox = 0;
    let drawingsProcessed = 0;

    for (const row of resultRows) {
      const pnidId = row.pnid_id;
      const allDetections = row.detections || [];
      if (allDetections.length === 0) continue;

      const aboveThreshold = allDetections.filter(d => Number(d.confidence || 0) >= threshold);
      if (aboveThreshold.length === 0) { totalSkipped += allDetections.length; continue; }

      drawingsProcessed++;

      await prisma.$transaction(async tx => {
        for (const detection of aboveThreshold) {
          const entityType = normalizeEntityType(detection.entity_type);
          const tagText = String(detection.tag_text || '').trim();
          const box = coerceBox(detection.bbox);
          if (!hasMeaningfulBox(box)) {
            totalSkippedNoBox++;
            continue;
          }

          const entityId = await findOrCreateEntity(tx, {
            pnidId,
            entityType,
            tagText,
            matchedEntityId: detection.matched_entity_id,
          });
          if (!entityId) continue;

          await upsertJunction(tx, { pnidId, entityType, entityId, box });

          await tx.annotation.create({
            data: {
              pnid_id: pnidId,
              author_id: DEFAULT_AUTHOR_ID,
              annotation_type: 'shape',
              shape: entityType === 'instrument' ? 'circle' : 'rectangle',
              text: tagText || null,
              x_pct: box.xPct,
              y_pct: box.yPct,
              w_pct: box.wPct,
              h_pct: box.hPct,
              color: entityType === 'line' ? '#8AB4FF' : entityType === 'instrument' ? '#FFD466' : '#3BE494',
              stroke_width: 2,
              fill_opacity: 0.15,
              linked_entity_type: entityType,
              linked_entity_id: entityId,
              metadata: {
                source: 'ai_batch',
                review_decision: 'auto_accepted',
                confidence: Number(detection.confidence ?? 0),
                batch_id: batchId,
                detection_source: detection.detection_source || 't-rex2',
                original_tag_text: tagText || null,
                bbox_source: 'detector',
              },
            },
          });
          totalCreated++;

          // Record feedback
          if (batchInfo.platform_id) {
            await tx.$executeRaw`
              INSERT INTO ai_detection_feedback (platform_id, batch_id, pnid_id, category, action, tag_text, entity_type, confidence, bbox_x_pct, bbox_y_pct, bbox_w_pct, bbox_h_pct)
              VALUES (${batchInfo.platform_id}::uuid, ${batchId}::uuid, ${pnidId}::uuid, ${batchInfo.category || 'line'}, 'accept',
                      ${detection.tag_text || null}, ${detection.entity_type || null}, ${detection.confidence || 0},
                      ${detection.bbox?.x_pct || 0}, ${detection.bbox?.y_pct || 0}, ${detection.bbox?.w_pct || 0}, ${detection.bbox?.h_pct || 0})
            `.catch(() => {});
          }
        }

        totalSkipped += allDetections.length - aboveThreshold.length;
      });
    }

    console.log(`[ai-annotate] Batch accept-all: created=${totalCreated} skipped=${totalSkipped} drawings=${drawingsProcessed}`);

    return {
      created: totalCreated,
      skipped: totalSkipped,
      skippedNoBox: totalSkippedNoBox,
      drawingsProcessed,
      message: `Applied ${totalCreated} detections across ${drawingsProcessed} drawings`,
    };
  });

  // ---------------------------------------------------------------------------
  // Repair: backfill text field on AI-created annotations that are missing it
  // ---------------------------------------------------------------------------

  fastify.post('/ai/annotate/repair-text', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    // Diagnostic: count AI annotations
    let diagnostic = {};
    try {
      const total = await prisma.$queryRaw`SELECT count(*) as cnt FROM annotation WHERE metadata->>'source' IN ('ai_pilot', 'ai_batch')`;
      const noText = await prisma.$queryRaw`SELECT count(*) as cnt FROM annotation WHERE text IS NULL AND metadata->>'source' IN ('ai_pilot', 'ai_batch')`;
      const noLinked = await prisma.$queryRaw`SELECT count(*) as cnt FROM annotation WHERE linked_entity_id IS NULL AND metadata->>'source' IN ('ai_pilot', 'ai_batch')`;
      diagnostic = {
        totalAiAnnotations: Number(total?.[0]?.cnt || 0),
        missingText: Number(noText?.[0]?.cnt || 0),
        missingLinkedEntity: Number(noLinked?.[0]?.cnt || 0),
      };
    } catch (e) {
      diagnostic = { error: e.message };
    }

    // Repair: backfill text from linked entities
    let repaired = 0;
    try {
      // Step 1: lines
      const lines = await prisma.$queryRaw`
        UPDATE annotation a SET text = l.line_number, fill_opacity = 0.15
        FROM line l
        WHERE a.linked_entity_id = l.id
          AND a.linked_entity_type = 'line'
          AND a.text IS NULL
          AND a.metadata->>'source' IN ('ai_pilot', 'ai_batch')
        RETURNING a.id
      `;
      repaired += lines?.length || 0;

      // Step 2: equipment
      const equip = await prisma.$queryRaw`
        UPDATE annotation a SET text = e.tag, fill_opacity = 0.15
        FROM equipment e
        WHERE a.linked_entity_id = e.id
          AND a.linked_entity_type = 'equipment'
          AND a.text IS NULL
          AND a.metadata->>'source' IN ('ai_pilot', 'ai_batch')
        RETURNING a.id
      `;
      repaired += equip?.length || 0;

      // Step 3: instruments
      const instr = await prisma.$queryRaw`
        UPDATE annotation a SET text = i.tag, fill_opacity = 0.15
        FROM instrument i
        WHERE a.linked_entity_id = i.id
          AND a.linked_entity_type = 'instrument'
          AND a.text IS NULL
          AND a.metadata->>'source' IN ('ai_pilot', 'ai_batch')
        RETURNING a.id
      `;
      repaired += instr?.length || 0;
    } catch (e) {
      return { repaired, diagnostic, error: e.message };
    }

    // Also fix annotations where text is NULL but metadata has original_tag_text
    try {
      const fromMeta = await prisma.$queryRaw`
        UPDATE annotation SET text = metadata->>'original_tag_text', fill_opacity = 0.15
        WHERE text IS NULL
          AND metadata->>'original_tag_text' IS NOT NULL
          AND metadata->>'original_tag_text' != ''
          AND metadata->>'source' IN ('ai_pilot', 'ai_batch')
        RETURNING id
      `;
      repaired += fromMeta?.length || 0;
    } catch (_) {}

    return { repaired, diagnostic };
  });

  // ---------------------------------------------------------------------------
  // Cleanup: remove ALL AI-created annotations, junction entries, and garbage entities
  // ---------------------------------------------------------------------------

  fastify.post('/ai/annotate/cleanup', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    const { mode = 'ai_only' } = request.body || {};
    const results = {};

    if (mode === 'all') {
      // ══════ NUCLEAR: Delete ALL annotations, ALL junctions, ALL OCR data ══════
      // This gives a completely clean slate across all drawings.

      // Delete all annotation replies first (FK constraint)
      const deletedReplies = await prisma.$executeRaw`DELETE FROM annotation_reply`.catch(() => 0);
      results.deletedReplies = deletedReplies;

      // Delete ALL annotations
      const deletedAnnotations = await prisma.$executeRaw`DELETE FROM annotation`.catch(() => 0);
      results.deletedAnnotations = deletedAnnotations;

      // Delete ALL junction entries
      const deletedLineJunctions = await prisma.$executeRaw`DELETE FROM pnid_line`.catch(() => 0);
      const deletedEquipJunctions = await prisma.$executeRaw`DELETE FROM pnid_equipment`.catch(() => 0);
      const deletedInstrJunctions = await prisma.$executeRaw`DELETE FROM pnid_instrument`.catch(() => 0);
      results.deletedJunctions = { lines: deletedLineJunctions, equipment: deletedEquipJunctions, instruments: deletedInstrJunctions };

      // Delete ALL OCR extractions
      const deletedOcrExtractions = await prisma.$executeRaw`DELETE FROM ocr_extraction`.catch(() => 0);
      results.deletedOcrExtractions = deletedOcrExtractions;

      // Delete ALL OCR runs
      const deletedOcrRuns = await prisma.$executeRaw`DELETE FROM ocr_run`.catch(() => 0);
      results.deletedOcrRuns = deletedOcrRuns;

      // Clean up batch detection tables
      const deletedBatchResults = await prisma.$executeRaw`DELETE FROM ai_detection_batch_result`.catch(() => 0);
      const deletedBatches = await prisma.$executeRaw`DELETE FROM ai_detection_batch`.catch(() => 0);
      const deletedFeedback = await prisma.$executeRaw`DELETE FROM ai_detection_feedback`.catch(() => 0);
      results.deletedBatchData = { results: deletedBatchResults, batches: deletedBatches, feedback: deletedFeedback };

      // Delete ALL entities (lines, equipment, instruments) — they'll be recreated when needed
      const deletedInstruments = await prisma.$executeRaw`DELETE FROM instrument`.catch(() => 0);
      const deletedEquipment = await prisma.$executeRaw`DELETE FROM equipment`.catch(() => 0);
      // Delete topology edges that reference equipment before deleting lines
      const deletedTopoEdges = await prisma.$executeRaw`DELETE FROM topology_edge`.catch(() => 0);
      const deletedLines = await prisma.$executeRaw`DELETE FROM line`.catch(() => 0);
      results.deletedEntities = { lines: deletedLines, equipment: deletedEquipment, instruments: deletedInstruments, topologyEdges: deletedTopoEdges };

      console.log(`[ai-annotate] FULL CLEANUP: annotations=${deletedAnnotations} junctions=(L:${deletedLineJunctions},E:${deletedEquipJunctions},I:${deletedInstrJunctions}) entities=(L:${deletedLines},E:${deletedEquipment},I:${deletedInstruments}) ocr=(extractions=${deletedOcrExtractions},runs=${deletedOcrRuns})`);

      return { message: 'FULL cleanup complete — all annotations, entities, OCR data removed', ...results };
    }

    // ══════ AI-ONLY cleanup (default) ══════
    // 1. Collect entity IDs linked from AI annotations before deleting them
    const aiLinked = await prisma.$queryRaw`
      SELECT linked_entity_type, linked_entity_id
      FROM annotation
      WHERE metadata->>'source' IN ('ai_pilot', 'ai_batch')
        AND linked_entity_id IS NOT NULL
        AND deleted_at IS NULL
    `.catch(() => []);

    const lineIds = [...new Set(aiLinked.filter(r => r.linked_entity_type === 'line').map(r => r.linked_entity_id))];
    const equipIds = [...new Set(aiLinked.filter(r => r.linked_entity_type === 'equipment').map(r => r.linked_entity_id))];
    const instrIds = [...new Set(aiLinked.filter(r => r.linked_entity_type === 'instrument').map(r => r.linked_entity_id))];

    // 2. Delete ALL AI-created annotations
    const deletedAnnotations = await prisma.$executeRaw`
      DELETE FROM annotation
      WHERE metadata->>'source' IN ('ai_pilot', 'ai_batch')
    `.catch(() => 0);
    results.deletedAnnotations = deletedAnnotations;

    // 3. Remove AI-created junction entries
    let deletedLineJunctions = 0, deletedEquipJunctions = 0, deletedInstrJunctions = 0;
    for (const lineId of lineIds) {
      deletedLineJunctions += await prisma.$executeRaw`
        DELETE FROM pnid_line WHERE line_id = ${lineId}::uuid
          AND NOT EXISTS (SELECT 1 FROM annotation WHERE linked_entity_id = ${lineId}::uuid AND deleted_at IS NULL AND (metadata->>'source' IS NULL OR metadata->>'source' NOT IN ('ai_pilot', 'ai_batch')))
      `.catch(() => 0);
    }
    for (const equipId of equipIds) {
      deletedEquipJunctions += await prisma.$executeRaw`
        DELETE FROM pnid_equipment WHERE equipment_id = ${equipId}::uuid
          AND NOT EXISTS (SELECT 1 FROM annotation WHERE linked_entity_id = ${equipId}::uuid AND deleted_at IS NULL AND (metadata->>'source' IS NULL OR metadata->>'source' NOT IN ('ai_pilot', 'ai_batch')))
      `.catch(() => 0);
    }
    for (const instrId of instrIds) {
      deletedInstrJunctions += await prisma.$executeRaw`
        DELETE FROM pnid_instrument WHERE instrument_id = ${instrId}::uuid
          AND NOT EXISTS (SELECT 1 FROM annotation WHERE linked_entity_id = ${instrId}::uuid AND deleted_at IS NULL AND (metadata->>'source' IS NULL OR metadata->>'source' NOT IN ('ai_pilot', 'ai_batch')))
      `.catch(() => 0);
    }
    results.deletedJunctions = { lines: deletedLineJunctions, equipment: deletedEquipJunctions, instruments: deletedInstrJunctions };

    // 4. Clean up batch detection tables
    const deletedBatchResults = await prisma.$executeRaw`DELETE FROM ai_detection_batch_result`.catch(() => 0);
    const deletedBatches = await prisma.$executeRaw`DELETE FROM ai_detection_batch`.catch(() => 0);
    const deletedFeedback = await prisma.$executeRaw`DELETE FROM ai_detection_feedback`.catch(() => 0);
    results.deletedBatchData = { results: deletedBatchResults, batches: deletedBatches, feedback: deletedFeedback };

    console.log(`[ai-annotate] AI-only cleanup: annotations=${deletedAnnotations} junctions=(L:${deletedLineJunctions},E:${deletedEquipJunctions},I:${deletedInstrJunctions})`);

    return { message: 'AI annotation cleanup complete', ...results };
  });

  // ---------------------------------------------------------------------------
  // Detection Profiles — save/load named detection configurations
  // ---------------------------------------------------------------------------

  fastify.get('/ai/annotate/profiles', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { platformId } = request.query;
    if (!platformId) return reply.code(400).send({ error: 'platformId query param is required' });
    const profiles = await listProfiles(prisma, platformId);
    return { profiles };
  });

  fastify.get('/ai/annotate/profiles/:name', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { platformId } = request.query;
    const { name } = request.params;
    if (!platformId) return reply.code(400).send({ error: 'platformId query param is required' });
    const profile = await getProfile(prisma, platformId, name);
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });
    return profile;
  });

  fastify.post('/ai/annotate/profiles', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;
    const { platformId, name, category, examples, embeddings } = request.body || {};
    if (!platformId || !name || !category || !examples) {
      return reply.code(400).send({ error: 'platformId, name, category, and examples are required' });
    }
    const result = await saveProfile(prisma, { platformId, name, category, examples, embeddings });
    if (!result.saved) return reply.code(500).send({ error: result.error || 'Failed to save profile' });
    return { saved: true, name };
  });

  // ---------------------------------------------------------------------------
  // Single-drawing accept (original endpoint)
  // ---------------------------------------------------------------------------

  fastify.post('/ai/annotate/accept', async (request, reply) => {
    if (!assertPilotEnabled(reply)) return;

    const { pnidId, runId = null, detections = [], accepted = [] } = request.body || {};
    if (!pnidId) return reply.code(400).send({ error: 'pnidId is required' });
    if (!Array.isArray(detections) || detections.length === 0) {
      return reply.code(400).send({ error: 'detections array is required' });
    }
    if (!Array.isArray(accepted)) {
      return reply.code(400).send({ error: 'accepted must be an array' });
    }

    const acceptedOps = accepted.filter(item => !item?.rejected);
    const rejectedCount = accepted.filter(item => item?.rejected).length;
    let created = 0;
    let skippedNoBox = 0;

    await prisma.$transaction(async tx => {
      for (const item of acceptedOps) {
        const idx = Number(item.detection_index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= detections.length) continue;
        const detection = detections[idx];
        const entityType = normalizeEntityType(detection.entity_type);
        const tagText = String(detection.tag_text || '').trim();
        const adjusted = coerceBox(item.adjusted_bbox);
        const detectedBox = coerceBox(detection.bbox);
        const box = adjusted || detectedBox;
        if (!hasMeaningfulBox(box)) {
          skippedNoBox += 1;
          continue;
        }

        const entityId = await findOrCreateEntity(tx, {
          pnidId,
          entityType,
          tagText,
          matchedEntityId: detection.matched_entity_id,
        });
        if (!entityId) continue;

        await upsertJunction(tx, { pnidId, entityType, entityId, box });

        await tx.annotation.create({
          data: {
            pnid_id: pnidId,
            author_id: DEFAULT_AUTHOR_ID,
            annotation_type: 'shape',
            shape: entityType === 'instrument' ? 'circle' : 'rectangle',
            text: tagText || null,
            x_pct: box.xPct,
            y_pct: box.yPct,
            w_pct: box.wPct,
            h_pct: box.hPct,
            color: entityType === 'line' ? '#8AB4FF' : entityType === 'instrument' ? '#FFD466' : '#3BE494',
            stroke_width: 2,
            fill_opacity: 0.15,
            linked_entity_type: entityType,
            linked_entity_id: entityId,
            metadata: {
              source: 'ai_pilot',
              review_decision: 'accepted',
              confidence: Number(detection.confidence ?? 0),
              run_id: runId,
              detection_source: detection.detection_source || 't-rex2',
              extraction_id: detection.extraction_id || null,
              original_tag_text: tagText || null,
              bbox_source: adjusted ? 'review_adjusted' : 'detector',
            },
          },
        });
        created += 1;
      }
    });

    return {
      created,
      rejected: rejectedCount,
      skippedNoBox,
      totalReviewed: accepted.length,
      message: `Applied ${created} accepted detections`,
    };
  });
}

