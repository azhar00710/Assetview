/**
 * OCR-side symbol region detection + OCR fusion helpers.
 *
 * Goal:
 * 1) Detect likely symbol regions (instrument bubbles / tag boxes) as early as possible.
 * 2) Feed region-aware text candidates back into OCR Stage 2 classification.
 */

import {
  callDdsDetect,
  extractDdsDetections,
  isDdsTaskEndpoint,
  toPixelBoxFromPct,
} from './VisualDetectionUtils.js';

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function boxFromVertices(vertices = []) {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const v of vertices) {
    const x = num(v?.x, NaN);
    const y = num(v?.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function overlapRatio(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  return inter / minArea;
}

function classifyTagShape(text = '') {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return null;
  if (/^\d{1,2}(?:-\d\/\d)?["']?-?[A-Z]{1,4}(?:-\d{1,4}){2,3}-[A-Z0-9]{2,8}-[A-Z]$/i.test(t)) return 'line';
  if (/^[A-Z]{2,5}-?\d{3,7}(?:-[A-Z0-9]{1,3})?$/.test(t)) return 'instrument';
  if (/^[A-Z]-\d{3,6}(?:\.[A-Z0-9]{1,2})?$/.test(t)) return 'equipment';
  if (/^(?:[A-Z0-9]{1,8}-){2,7}[A-Z0-9]{1,8}$/.test(t) && /(SHT|SHEET|DWG|DRG)/.test(t)) return 'drawing_ref';
  return null;
}

function normalizeDetectionBox(item) {
  if (!item || typeof item !== 'object') return null;
  const direct = item.bbox || item.box || item.bounding_box || item.rect || item.xywh;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const x = num(direct.x, NaN);
    const y = num(direct.y, NaN);
    const w = num(direct.w ?? direct.width, NaN);
    const h = num(direct.h ?? direct.height, NaN);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) return { x, y, w, h };
  }

  const arr = Array.isArray(direct) ? direct : (Array.isArray(item.bbox) ? item.bbox : null);
  if (arr && arr.length >= 4) {
    const [a, b, c, d] = arr.map(v => num(v, NaN));
    if ([a, b, c, d].every(Number.isFinite)) {
      if (c > a && d > b) return { x: a, y: b, w: c - a, h: d - b }; // xyxy
      if (c > 0 && d > 0) return { x: a, y: b, w: c, h: d }; // xywh
    }
  }
  return null;
}

function labelsToGroundingPrompt(labels = []) {
  const uniq = [...new Set((labels || []).map(l => String(l || '').toLowerCase()).filter(Boolean))];
  if (!uniq.length) {
    return 'instrument bubble . circular tag . equipment tag . line number tag . label box';
  }
  return uniq.map((label) => {
    if (label.includes('instrument') || label.includes('bubble') || label.includes('circle')) {
      return 'instrument bubble . circular tag';
    }
    if (label.includes('line')) return 'pipe line number tag . small text';
    if (label.includes('drawing')) return 'drawing callout box . sheet identifier';
    return 'equipment tag label';
  }).join(' . ');
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
  return normalizeDetectionBox(item);
}

function makeTrexPromptVariants(interactions) {
  return [
    {
      type: 'visual_images',
      visual_images: [{ interactions }],
    },
    {
      type: 'visual_images',
      visual_images: [{ interactions: interactions.map(it => ({ type: 'rect', rect: it.rect })) }],
    },
    {
      type: 'visual_interaction',
      visual_interactions: interactions,
    },
  ];
}

async function callGroundingDino(imageBuffer, options, labels = []) {
  const {
    groundingEndpointUrl,
    groundingApiKey,
    groundingModel,
    symbolBoxThreshold = 0.25,
    symbolTextThreshold = 0.2,
  } = options;
  if (isDdsTaskEndpoint(groundingEndpointUrl)) {
    const dds = await callDdsDetect({
      endpointUrl: groundingEndpointUrl,
      token: groundingApiKey,
      imageBuffer,
      maxDimOverride: Number(process.env.AI_ANNOTATE_TEXT_MAX_DIM || 3072),
      payloadBuilder: ({ imageDataUrl }) => ({
        image: imageDataUrl,
        model: groundingModel || process.env.AI_ANNOTATE_DDS_MODEL || 'GroundingDino-1.6-Pro',
        prompt: { type: 'text', text: labelsToGroundingPrompt(labels) },
        bbox_threshold: num(symbolBoxThreshold, 0.25),
        text_threshold: num(symbolTextThreshold, 0.2),
        targets: ['bbox'],
      }),
    });
    const invScale = dds?.meta?.resizeScale ? (1 / dds.meta.resizeScale) : 1;
    return extractDdsDetections(dds.result).map((item) => {
      const box = normalizeDdsDetectionBox(item);
      if (!box) return null;
      return {
        bbox: { x: box.x * invScale, y: box.y * invScale, w: box.w * invScale, h: box.h * invScale },
        score: num(item?.score ?? item?.confidence ?? item?.bbox_score, 0.5),
        label: String(item?.label || item?.category || item?.category_name || 'symbol'),
        source: 'grounding_dino',
      };
    }).filter(Boolean);
  }
  const payload = {
    image_base64: imageBuffer.toString('base64'),
    text_prompt: labelsToGroundingPrompt(labels),
    box_threshold: num(symbolBoxThreshold, 0.25),
    text_threshold: num(symbolTextThreshold, 0.2),
  };
  const headers = { 'Content-Type': 'application/json' };
  if (groundingApiKey) {
    headers.Authorization = `Bearer ${groundingApiKey}`;
    headers['x-api-key'] = groundingApiKey;
    headers.Token = groundingApiKey;
  }
  const res = await fetch(groundingEndpointUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GroundingDINO detect failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  const raw = Array.isArray(data?.detections) ? data.detections
    : Array.isArray(data?.result?.objects) ? data.result.objects
      : Array.isArray(data?.objects) ? data.objects
        : [];
  return raw.map((d) => {
    const box = normalizeDetectionBox(d);
    if (!box) return null;
    return {
      bbox: box,
      score: num(d?.score ?? d?.confidence, 0.5),
      label: String(d?.label || d?.category || d?.category_name || 'symbol'),
      source: 'grounding_dino',
    };
  }).filter(Boolean);
}

async function callTrex2(imageBuffer, options, seedRegions = [], sourceWidth = 0, sourceHeight = 0, pageWidth = 0, pageHeight = 0) {
  const { trexEndpointUrl, trexApiKey, trexModel } = options;
  if (!trexEndpointUrl || !seedRegions.length || !sourceWidth || !sourceHeight || !pageWidth || !pageHeight) return [];

  const examples = seedRegions.slice(0, 8).map((r) => ({
    bbox: {
      xPct: Number(r.position_pct?.x_pct ?? 0),
      yPct: Number(r.position_pct?.y_pct ?? 0),
      wPct: Number(r.position_pct?.w_pct ?? 0),
      hPct: Number(r.position_pct?.h_pct ?? 0),
    },
    label: String(r.label || 'instrument'),
  }));

  if (isDdsTaskEndpoint(trexEndpointUrl)) {
    const dds = await callDdsDetect({
      endpointUrl: trexEndpointUrl,
      token: trexApiKey,
      imageBuffer,
      payloadBuilder: ({ imageDataUrl, resizeScale }) => {
        const labelToCategory = new Map();
        let nextCategory = 1;
        for (const ex of examples) {
          if (!labelToCategory.has(ex.label)) labelToCategory.set(ex.label, nextCategory++);
        }
        const interactions = examples.map((ex) => {
          const px = toPixelBoxFromPct(ex.bbox, sourceWidth, sourceHeight, resizeScale);
          return {
            type: 'rect',
            category_id: labelToCategory.get(ex.label),
            rect: [px.x, px.y, px.x + px.w, px.y + px.h],
          };
        });
        return {
          image: imageDataUrl,
          model: trexModel || process.env.AI_ANNOTATE_TREX_MODEL || 'T-Rex-2.0',
          targets: ['bbox', 'embedding'],
          bbox_threshold: Number(process.env.AI_ANNOTATE_TREX_SCORE_THRESHOLD || 0.2),
          prompt: makeTrexPromptVariants(interactions)[0],
          _meta: { labelToCategory: Object.fromEntries([...labelToCategory.entries()].map(([k, v]) => [v, k])) },
        };
      },
    });
    const categoryMap = dds?.meta?.payloadMeta?.labelToCategory || {};
    const invScale = dds?.meta?.resizeScale ? (1 / dds.meta.resizeScale) : 1;
    return extractDdsDetections(dds.result).map((item) => {
      const box = normalizeDdsDetectionBox(item);
      if (!box) return null;
      const categoryId = Number(item?.category_id);
      return {
        bbox: { x: box.x * invScale, y: box.y * invScale, w: box.w * invScale, h: box.h * invScale },
        score: num(item?.score ?? item?.confidence, 0.5),
        label: categoryMap[categoryId] || String(item?.label || item?.category || 'symbol'),
        source: 'trex2',
      };
    }).filter(Boolean);
  }

  const payload = {
    image_base64: imageBuffer.toString('base64'),
    prompts: examples.map((ex) => {
      const px = toPixelBoxFromPct(ex.bbox, sourceWidth, sourceHeight);
      return {
        prompt_type: 'bbox',
        label: ex.label,
        bbox: [px.x, px.y, px.w, px.h],
      };
    }),
  };
  const res = await fetch(trexEndpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${trexApiKey}`,
      'x-api-key': trexApiKey,
      Token: trexApiKey,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`T-Rex2 detect failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  const raw = Array.isArray(data?.detections) ? data.detections
    : Array.isArray(data?.result?.objects) ? data.result.objects
      : Array.isArray(data?.objects) ? data.objects
        : [];
  return raw.map((item) => {
    const box = normalizeDetectionBox(item);
    if (!box) return null;
    return {
      bbox: box,
      score: num(item?.score ?? item?.confidence, 0.5),
      label: String(item?.label || item?.category || 'symbol'),
      source: 'trex2',
    };
  }).filter(Boolean);
}

/**
 * Lightweight heuristic fallback: infer symbol-like regions from OCR words.
 */
function detectFromOcrWords(words = []) {
  const candidates = [];
  const tokenized = words.map((w) => {
    const text = String(w?.text || '').trim();
    const box = boxFromVertices(w?.vertices || []);
    if (!text || !box) return null;
    return {
      text,
      confidence: num(w?.confidence, 0.5),
      box,
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
    };
  }).filter(Boolean);

  // 1) Single-word direct candidates.
  for (const w of words) {
    const text = String(w?.text || '').trim();
    const kind = classifyTagShape(text);
    if (!kind) continue;
    const box = boxFromVertices(w?.vertices || []);
    if (!box) continue;
    const padX = kind === 'line' ? 0.18 : kind === 'drawing_ref' ? 0.25 : 0.45;
    const padYTop = kind === 'instrument' ? 0.55 : kind === 'drawing_ref' ? 0.2 : 0.28;
    const padYBottom = kind === 'instrument' ? 1.0 : kind === 'drawing_ref' ? 0.25 : 0.45;
    candidates.push({
      bbox: {
        x: box.x - box.w * padX,
        y: box.y - box.h * padYTop,
        w: box.w * (1 + padX * 2),
        h: box.h * (1 + padYTop + padYBottom),
      },
      score: num(w?.confidence, 0.65),
      label: kind,
      source: 'ocr_heuristic',
      seedText: text,
    });
  }

  // 2) Vertical stack candidate (e.g. ZLO / 289910 / A1).
  const alignTol = 40;
  const maxGapY = 38;
  for (const top of tokenized) {
    if (!/^[A-Z]{2,5}$/i.test(top.text)) continue;
    const mid = tokenized.find((w) =>
      w.cy > top.cy &&
      Math.abs(w.cx - top.cx) <= alignTol &&
      (w.cy - top.cy) <= maxGapY &&
      /^\d{3,7}$/.test(w.text)
    );
    if (!mid) continue;
    const suffix = tokenized.find((w) =>
      w.cy > mid.cy &&
      Math.abs(w.cx - top.cx) <= alignTol &&
      (w.cy - mid.cy) <= maxGapY &&
      /^[A-Z0-9.]{1,3}$/i.test(w.text)
    );
    const assembled = [top.text, mid.text, suffix?.text || null]
      .filter(Boolean)
      .map(t => String(t).replace(/[^A-Z0-9]/gi, '').toUpperCase())
      .join('-');
    const kind = classifyTagShape(assembled);
    if (!kind) continue;

    const parts = [top, mid, suffix].filter(Boolean);
    const minX = Math.min(...parts.map(p => p.box.x));
    const minY = Math.min(...parts.map(p => p.box.y));
    const maxX = Math.max(...parts.map(p => p.box.x + p.box.w));
    const maxY = Math.max(...parts.map(p => p.box.y + p.box.h));
    const box = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    candidates.push({
      bbox: {
        x: box.x - box.w * 0.5,
        y: box.y - box.h * 0.55,
        w: box.w * 2.0,
        h: box.h * 2.0,
      },
      score: +(parts.reduce((s, p) => s + p.confidence, 0) / parts.length).toFixed(3),
      label: kind,
      source: 'ocr_vertical_stack',
      seedText: assembled,
    });
  }

  // 3) Horizontal boxed-callout candidate for drawing/sheet refs.
  // Example: 100001 - SHT - 001, AD219 - 490 - D - 15101
  const byRow = [...tokenized].sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
  for (let i = 0; i < byRow.length; i++) {
    const base = byRow[i];
    const row = byRow.filter(w => Math.abs(w.cy - base.cy) <= 18).sort((a, b) => a.cx - b.cx);
    if (row.length < 3) continue;
    const joined = row.map(r => String(r.text || '').replace(/[^A-Z0-9]/gi, '').toUpperCase())
      .filter(Boolean)
      .join('-');
    const kind = classifyTagShape(joined);
    if (kind !== 'drawing_ref') continue;

    const minX = Math.min(...row.map(p => p.box.x));
    const minY = Math.min(...row.map(p => p.box.y));
    const maxX = Math.max(...row.map(p => p.box.x + p.box.w));
    const maxY = Math.max(...row.map(p => p.box.y + p.box.h));
    const box = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    candidates.push({
      bbox: {
        x: box.x - box.w * 0.15,
        y: box.y - box.h * 0.2,
        w: box.w * 1.3,
        h: box.h * 1.4,
      },
      score: +(row.reduce((s, p) => s + p.confidence, 0) / row.length).toFixed(3),
      label: 'drawing_ref',
      source: 'ocr_rect_block',
      seedText: joined,
    });
  }

  const deduped = [];
  for (const c of candidates) {
    const exists = deduped.some((d) => overlapRatio(c.bbox, d.bbox) > 0.7);
    if (!exists) deduped.push(c);
  }
  return deduped;
}

export async function detectSymbolRegions({
  words = [],
  fileBuffer = null,
  contentType = '',
  sourceWidth = 0,
  sourceHeight = 0,
  pageWidth = 2400,
  pageHeight = 1700,
  options = {},
} = {}) {
  const mode = String(options.symbolDetectProvider || '').toLowerCase();
  const canUseVisual = Buffer.isBuffer(fileBuffer) && /^image\//i.test(String(contentType || ''));
  let detected = [];
  let provider = 'heuristic';
  const heuristicSeed = detectFromOcrWords(words);
  const promptLabels = heuristicSeed.map((r) => r.label).filter(Boolean);

  if ((mode === 'grounding_dino' || mode === 'auto') && options.groundingEndpointUrl && canUseVisual) {
    try {
      detected = await callGroundingDino(fileBuffer, options, promptLabels);
      provider = 'grounding_dino';
    } catch (err) {
      console.warn(`[SymbolRegionDetector] GroundingDINO failed, fallback to heuristic: ${err.message}`);
    }
  }

  if (!detected.length && mode === 'trex2' && options.trexEndpointUrl && canUseVisual) {
    try {
      detected = await callTrex2(fileBuffer, options, heuristicSeed, sourceWidth || pageWidth, sourceHeight || pageHeight, pageWidth, pageHeight);
      provider = 'trex2';
    } catch (err) {
      console.warn(`[SymbolRegionDetector] T-Rex2 failed, fallback to heuristic: ${err.message}`);
    }
  }

  if (!detected.length) {
    detected = heuristicSeed;
  }

  const normalized = detected.map((d, idx) => {
    const b = d.bbox || { x: 0, y: 0, w: 1, h: 1 };
    const srcW = Math.max(1, Number(sourceWidth || pageWidth || 1));
    const srcH = Math.max(1, Number(sourceHeight || pageHeight || 1));
    const scaleX = pageWidth / srcW;
    const scaleY = pageHeight / srcH;
    const x = clamp(num(b.x, 0) * scaleX, 0, Math.max(0, pageWidth - 1));
    const y = clamp(num(b.y, 0) * scaleY, 0, Math.max(0, pageHeight - 1));
    const maxW = Math.max(1, pageWidth - x);
    const maxH = Math.max(1, pageHeight - y);
    const w = clamp(num(b.w, 1) * scaleX, 1, maxW);
    const h = clamp(num(b.h, 1) * scaleY, 1, maxH);
    return {
      id: `sym_${idx + 1}`,
      label: String(d.label || 'symbol'),
      score: num(d.score, 0.5),
      source: d.source || provider,
      bbox: { x, y, w, h },
      position_pct: {
        x_pct: +(x / pageWidth * 100).toFixed(2),
        y_pct: +(y / pageHeight * 100).toFixed(2),
        w_pct: +(w / pageWidth * 100).toFixed(2),
        h_pct: +(h / pageHeight * 100).toFixed(2),
      },
    };
  });

  return {
    provider: normalized.some(r => r.source === 'grounding_dino') ? 'grounding_dino' : provider,
    regions: normalized,
    detectedAt: new Date().toISOString(),
  };
}

export function fuseSymbolRegionWords(rawWords = [], symbolRegions = [], pageWidth = 2400, pageHeight = 1700) {
  if (!Array.isArray(rawWords) || rawWords.length === 0) {
    return { words: [], addedWords: 0 };
  }
  if (!Array.isArray(symbolRegions) || symbolRegions.length === 0) {
    return { words: rawWords, addedWords: 0 };
  }

  const tokens = rawWords.map((w, idx) => {
    const box = boxFromVertices(w?.vertices || []);
    if (!box) return null;
    return {
      idx,
      text: String(w?.text || '').trim(),
      confidence: num(w?.confidence, 0.5),
      box,
      word: w,
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
    };
  }).filter(Boolean);

  const synthetic = [];
  for (const r of symbolRegions) {
    const rb = r?.bbox;
    if (!rb) continue;
    const pad = {
      x: rb.x - rb.w * 0.15,
      y: rb.y - rb.h * 0.2,
      w: rb.w * 1.3,
      h: rb.h * 1.5,
    };
    const inside = tokens
      .filter(t => t.cx >= pad.x && t.cx <= (pad.x + pad.w) && t.cy >= pad.y && t.cy <= (pad.y + pad.h))
      .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
    if (inside.length < 2) continue;

    const normParts = inside.map(t => String(t.text || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()).filter(Boolean);
    const joined = normParts.join('');
    const joinedDashed = normParts.join('-');
    const tagType = classifyTagShape(joinedDashed) || classifyTagShape(joined);
    if (!tagType) continue;

    const minX = Math.min(...inside.map(t => t.box.x));
    const minY = Math.min(...inside.map(t => t.box.y));
    const maxX = Math.max(...inside.map(t => t.box.x + t.box.w));
    const maxY = Math.max(...inside.map(t => t.box.y + t.box.h));
    synthetic.push({
      text: classifyTagShape(joinedDashed) ? joinedDashed : joined,
      confidence: +(inside.reduce((s, t) => s + t.confidence, 0) / inside.length).toFixed(3),
      vertices: [
        { x: clamp(minX, 0, pageWidth), y: clamp(minY, 0, pageHeight) },
        { x: clamp(maxX, 0, pageWidth), y: clamp(minY, 0, pageHeight) },
        { x: clamp(maxX, 0, pageWidth), y: clamp(maxY, 0, pageHeight) },
        { x: clamp(minX, 0, pageWidth), y: clamp(maxY, 0, pageHeight) },
      ],
      source: 'symbol_region_fusion',
      regionId: r.id || null,
      regionLabel: r.label || null,
    });
  }

  const seen = new Set(rawWords.map(w => {
    const b = boxFromVertices(w?.vertices || []);
    if (!b) return `${String(w?.text || '').toUpperCase()}|0|0`;
    return `${String(w?.text || '').toUpperCase()}|${Math.round(b.x)}|${Math.round(b.y)}`;
  }));

  const uniqueSynthetic = synthetic.filter((w) => {
    const b = boxFromVertices(w.vertices || []);
    const key = `${String(w.text || '').toUpperCase()}|${Math.round(b?.x || 0)}|${Math.round(b?.y || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    words: [...rawWords, ...uniqueSynthetic],
    addedWords: uniqueSynthetic.length,
  };
}
