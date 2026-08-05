/**
 * Spatially groups adjacent OCR words to reassemble split tags.
 * E.g., "V" + "-" + "1001" → "V-1001"
 */

import { classifyTag } from './TagClassifier.js';

const DEFAULT_OPTIONS = {
  maxGapPx: 15,
  yOverlapThreshold: 0.5,
  enableVerticalGrouping: false,
  enableRotationGrouping: false,
  verticalAlignRatio: 1.2,
  verticalGapRatio: 2.5,
  rotationMinAbsDeg: 15,
  rotationAngleToleranceDeg: 20,
  rotatedPerpRatio: 0.9,
  rotatedAlongRatio: 3.0,
};

const OCR_PREFIX_CONFUSION_GROUPS = [
  ['XA', 'XS'],
  ['ZLC', 'ZSC'],
  ['ZLO', 'ZSO'],
];

const OCR_PREFIX_VARIANT_MAP = OCR_PREFIX_CONFUSION_GROUPS.reduce((map, group) => {
  for (const prefix of group) {
    map.set(prefix, group.filter(other => other !== prefix));
  }
  return map;
}, new Map());

const OCR_SUFFIX_VARIANT_MAP = new Map([
  ['A', ['D']],
  ['D', ['A']],
]);

/**
 * Get bounding box from vertices array.
 */
function getBbox(vertices) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function getCenter(bbox) {
  return {
    cx: (bbox.minX + bbox.maxX) / 2,
    cy: (bbox.minY + bbox.maxY) / 2,
    width: Math.max(0, bbox.maxX - bbox.minX),
    height: Math.max(0, bbox.maxY - bbox.minY),
  };
}

function estimateAngleDeg(vertices = []) {
  if (!vertices || vertices.length < 2) return 0;
  const v0 = vertices[0];
  const v1 = vertices[1];
  const dx = (v1.x || 0) - (v0.x || 0);
  const dy = (v1.y || 0) - (v0.y || 0);
  if (dx === 0 && dy === 0) return 0;
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  // normalize to [-90, 90] so text direction buckets are stable.
  if (deg > 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

function normalizeWords(words = []) {
  return words
    .map((w, idx) => {
      const bbox = getBbox(w.vertices || []);
      const c = getCenter(bbox);
      return {
        idx,
        word: w,
        bbox,
        ...c,
        angleDeg: estimateAngleDeg(w.vertices || []),
      };
    })
    .filter(w => Number.isFinite(w.cx) && Number.isFinite(w.cy));
}

function parseOptions(maxGapPxOrOptions, yOverlapThreshold) {
  if (maxGapPxOrOptions && typeof maxGapPxOrOptions === 'object') {
    return { ...DEFAULT_OPTIONS, ...maxGapPxOrOptions };
  }
  return {
    ...DEFAULT_OPTIONS,
    maxGapPx: typeof maxGapPxOrOptions === 'number' ? maxGapPxOrOptions : DEFAULT_OPTIONS.maxGapPx,
    yOverlapThreshold: typeof yOverlapThreshold === 'number' ? yOverlapThreshold : DEFAULT_OPTIONS.yOverlapThreshold,
  };
}

function avgWordHeight(normalized = []) {
  if (normalized.length === 0) return 12;
  const sum = normalized.reduce((s, w) => s + (w.height || 0), 0);
  return Math.max(6, sum / normalized.length);
}

function normalizeTagToken(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizeLineAssemblyText(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[“”″]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, '')
    .replace(/--+/g, '-')
    .replace(/""+/g, '"')
    .replace(/^-+|-+$/g, '');
}

function parseStructuredInstrumentCandidate(text = '') {
  const cleaned = String(text || '').trim().toUpperCase();
  const match = cleaned.match(/^([A-Z]{2,5})-(\d{3,7})(?:\.([A-Z0-9]{1,3}))?(?:-([A-Z0-9]{1,3}))?$/);
  if (!match) return null;
  return {
    prefix: match[1],
    number: match[2],
    dotSuffix: match[3] || '',
    dashSuffix: match[4] || '',
  };
}

function buildStructuredInstrumentText(parts = {}) {
  if (!parts?.prefix || !parts?.number) return '';
  let text = `${parts.prefix}-${parts.number}`;
  if (parts.dotSuffix) text += `.${parts.dotSuffix}`;
  if (parts.dashSuffix) text += `-${parts.dashSuffix}`;
  return text;
}

function buildOcrConfusionVariantTexts(text = '') {
  const parsed = parseStructuredInstrumentCandidate(text);
  if (!parsed) return [];

  const variants = new Set();
  const prefixVariants = OCR_PREFIX_VARIANT_MAP.get(parsed.prefix) || [];
  const suffixField = parsed.dashSuffix
    ? 'dashSuffix'
    : (parsed.dotSuffix ? 'dotSuffix' : null);
  const suffixValue = suffixField ? parsed[suffixField] : '';
  const suffixVariants = suffixValue ? (OCR_SUFFIX_VARIANT_MAP.get(suffixValue) || []) : [];

  for (const prefix of prefixVariants) {
    const candidate = buildStructuredInstrumentText({ ...parsed, prefix });
    if (candidate) variants.add(candidate);
  }

  for (const suffix of suffixVariants) {
    const candidate = buildStructuredInstrumentText({ ...parsed, [suffixField]: suffix });
    if (candidate) variants.add(candidate);
  }

  for (const prefix of prefixVariants) {
    for (const suffix of suffixVariants) {
      const candidate = buildStructuredInstrumentText({ ...parsed, prefix, [suffixField]: suffix });
      if (candidate) variants.add(candidate);
    }
  }

  return [...variants].filter((candidate) => {
    if (candidate === String(text || '').trim().toUpperCase()) return false;
    return classifyTag(candidate)?.type === 'instrument';
  });
}

function looksLikeLineStart(text = '') {
  const t = normalizeLineAssemblyText(text);
  return /^(\d{1,2}|\d\/\d|\d{1,2}-\d\/\d)"?$/.test(t) ||
    /^(\d{1,2}|\d\/\d|\d{1,2}-\d\/\d)-$/.test(t) ||
    /^(\d{1,2}|\d\/\d|\d{1,2}-\d\/\d)"?-?[A-Z]?$/.test(t);
}

function buildMergedGroup(componentWords, source = 'horizontal') {
  const mergedText = componentWords.map(w => w.word.text).join('');
  const mergedVertices = mergeVertices(componentWords.map(w => w.word.vertices));
  const avgConfidence = componentWords.reduce((s, w) => s + (w.word.confidence || 0), 0) / componentWords.length;
  return {
    text: mergedText,
    confidence: avgConfidence,
    vertices: mergedVertices,
    pageWidth: componentWords[0].word.pageWidth,
    pageHeight: componentWords[0].word.pageHeight,
    wordCount: componentWords.length,
    source,
    componentWordIndices: componentWords.map(w => w.idx),
  };
}

// ─── Production post-passes ───────────────────────────────────────────────────
//
// Validated by the diagnostic.  Run as the LAST step of groupAdjacentWords so
// every consumer (Stage 2 grouping, AI Classify prompt context, rescue passes)
// gets the same protection automatically.
//
//  splitPureNumericChains  — if a horizontal-source multi-word group is made
//      ENTIRELY of long numeric atoms (e.g. "281010 281010 281011"), split it
//      back into single-atom groups.  Repeated/adjacent numeric tags are
//      different IDs that the greedy horizontal pass over-merged.
//
//  splitHorizontalAtNumberBreaks — within a horizontal multi-word group, split
//      at every position where two consecutive atoms are both long numbers.
//      This catches "281010 281020" merges where one number is the line tag
//      and the next is an unrelated equipment tag in the same row.
//
// Both helpers preserve the original word indices and rebuild merged-group
// metadata via buildSingletonOrSubgroup() so downstream callers can rely on
// `componentWordIndices`, `vertices`, and `text` shape.

const NUMERIC_LIKE_TOKEN_RE = /^\d{4,8}[A-Z]?$/;

function isPureNumericGroup(group, normalized) {
  if (!group || (group.wordCount || 1) < 2) return false;
  if (group.source !== 'horizontal') return false;
  const wis = group.componentWordIndices || [];
  if (wis.length < 2) return false;
  return wis.every(i => {
    const w = normalized[i]?.word;
    const t = normalizeTagToken(w?.text || '');
    return NUMERIC_LIKE_TOKEN_RE.test(t);
  });
}

function buildSingletonOrSubgroup(originalGroup, atomIndices, normalized, suffix) {
  const subset = atomIndices
    .map(i => normalized[i])
    .filter(Boolean);
  if (subset.length === 0) return null;
  const merged = buildMergedGroup(subset, originalGroup.source);
  return {
    ...merged,
    assemblyRule: `${originalGroup.assemblyRule || originalGroup.source}:${suffix}`,
  };
}

function splitPureNumericChains(groups, normalized) {
  const out = [];
  let splits = 0;
  for (const g of groups) {
    if (!isPureNumericGroup(g, normalized)) { out.push(g); continue; }
    for (const wi of (g.componentWordIndices || [])) {
      const sub = buildSingletonOrSubgroup(g, [wi], normalized, 'numeric_chain_split');
      if (sub) out.push(sub);
    }
    splits += 1;
  }
  return { groups: out, splits };
}

function splitHorizontalAtNumberBreaks(groups, normalized) {
  const out = [];
  let splits = 0;
  for (const g of groups) {
    if (!g || g.source !== 'horizontal' || (g.wordCount || 1) < 3) { out.push(g); continue; }
    const wis = g.componentWordIndices || [];
    if (wis.length < 3) { out.push(g); continue; }
    // Sort by minX to walk left-to-right.
    const items = wis
      .map(i => ({ i, w: normalized[i]?.word, bbox: normalized[i]?.bbox }))
      .filter(x => x.w && x.bbox)
      .sort((a, b) => a.bbox.minX - b.bbox.minX);
    if (items.length < 3) { out.push(g); continue; }
    const isLong = (text) => NUMERIC_LIKE_TOKEN_RE.test(normalizeTagToken(text || ''));
    const cuts = [];
    for (let k = 1; k < items.length; k++) {
      if (isLong(items[k - 1].w.text) && isLong(items[k].w.text)) cuts.push(k);
    }
    if (!cuts.length) { out.push(g); continue; }
    const chunks = [];
    let start = 0;
    for (const c of cuts) { chunks.push(items.slice(start, c)); start = c; }
    chunks.push(items.slice(start));
    for (const chunk of chunks) {
      if (!chunk.length) continue;
      const sub = buildSingletonOrSubgroup(g, chunk.map(x => x.i), normalized, 'number_break_split');
      if (sub) out.push(sub);
    }
    splits += 1;
  }
  return { groups: out, splits };
}

function applyProductionPostPasses(groups, normalized, options = {}) {
  let cur = groups;
  let totalSplits = 0;
  if (options.enableNumberBreakStopper !== false) {
    const r = splitHorizontalAtNumberBreaks(cur, normalized);
    cur = r.groups; totalSplits += r.splits;
  }
  if (options.enableNumericGuard !== false) {
    const r = splitPureNumericChains(cur, normalized);
    cur = r.groups; totalSplits += r.splits;
  }
  return { groups: cur, splits: totalSplits };
}

function createGroupKey(indices = [], text = '') {
  const base = [...indices].sort((a, b) => a - b).join(',');
  const suffix = String(text || '').trim().toUpperCase();
  return suffix ? `${base}|${suffix}` : base;
}

function buildStructuredRowCandidates(normalized = [], meanHeight = 12, groupKeys = new Set()) {
  const groups = [];
  const rowTol = Math.max(8, meanHeight * 0.8);
  const maxGap = Math.max(20, meanHeight * 1.8);
  const sorted = [...normalized].sort((a, b) => (a.cy - b.cy) || (a.bbox.minX - b.bbox.minX));
  const rows = [];

  for (const item of sorted) {
    const row = rows.find(r => Math.abs(r.anchorY - item.cy) <= rowTol);
    if (row) {
      row.items.push(item);
      row.anchorY = (row.anchorY * (row.items.length - 1) + item.cy) / row.items.length;
    } else {
      rows.push({ anchorY: item.cy, items: [item] });
    }
  }

  for (const row of rows) {
    const items = [...row.items].sort((a, b) => a.bbox.minX - b.bbox.minX);
    for (let i = 0; i < items.length; i++) {
      const seed = items[i];
      if (!looksLikeLineStart(seed.word.text) && !/^[A-Z]{1,5}-?\d{0,2}$/i.test(seed.word.text || '')) continue;
      const chain = [seed];
      let last = seed;
      for (let j = i + 1; j < items.length && chain.length < 14; j++) {
        const next = items[j];
        const gap = next.bbox.minX - last.bbox.maxX;
        if (gap < -4 || gap > maxGap) break;
        chain.push(next);
        last = next;
        const assembled = normalizeLineAssemblyText(chain.map(x => x.word.text).join(''));
        const cls = classifyTag(assembled);
        if (!cls) continue;
        if (!['line', 'instrument', 'equipment', 'drawing_ref'].includes(cls.type)) continue;
        const componentWordIndices = chain.map(x => x.idx);
        const key = createGroupKey(componentWordIndices);
        if (groupKeys.has(key)) continue;
        const mergedVertices = mergeVertices(chain.map(x => x.word.vertices));
        const avgConfidence = chain.reduce((s, x) => s + (x.word.confidence || 0), 0) / chain.length;
        const assemblyRule = cls.type === 'line' ? 'line_row_v2' : 'structured_row_v2';
        groups.push({
          text: cls.text,
          confidence: avgConfidence,
          vertices: mergedVertices,
          pageWidth: seed.word.pageWidth,
          pageHeight: seed.word.pageHeight,
          wordCount: chain.length,
          source: cls.type === 'line' ? 'line_assembler' : 'structured_row',
          componentWordIndices,
          assemblyRule,
          // Row assemblers extend greedily; if a tag classified, treat as
          // unambiguous (no competing prefix slot like vertical_isa has).
          assemblyScore: 1,
          competingPrefixCount: 1,
          marginToRunnerUp: 1,
          isBestHypothesis: true,
        });
        groupKeys.add(key);
      }
    }
  }

  return groups;
}

function buildOcrConfusionVariantGroups(groups = []) {
  const exactKeys = new Set(
    groups.map(g => createGroupKey(g.componentWordIndices || [], g.text || ''))
  );
  const variants = [];

  for (const group of groups) {
    const groupText = String(group?.text || '').trim().toUpperCase();
    if (!groupText) continue;
    const candidateTexts = buildOcrConfusionVariantTexts(groupText);
    if (candidateTexts.length === 0) continue;

    for (const variantText of candidateTexts) {
      const variantKey = createGroupKey(group.componentWordIndices || [], variantText);
      if (exactKeys.has(variantKey)) continue;
      variants.push({
        ...group,
        text: variantText,
        source: 'ocr_confusion_variant',
        assemblyRule: group.assemblyRule ? `${group.assemblyRule}:ocr_confusion` : 'ocr_confusion_variant',
        assemblyScore: Math.max(0.01, Number(group.assemblyScore ?? 0.5) - 0.12),
        competingPrefixCount: Math.max(Number(group.competingPrefixCount ?? 1), 2),
        marginToRunnerUp: Math.min(Number(group.marginToRunnerUp ?? 1), 0.01),
        isBestHypothesis: false,
        ocrVariantOf: groupText,
      });
      exactKeys.add(variantKey);
    }
  }

  return variants;
}

function buildFallbackPrefixCandidates({
  byY = [],
  mids = [],
  mid,
  midText = '',
  meanHeight = 12,
  alignTol = 14,
  maxGapY = 24,
  codeRegex,
  familyBoost = new Set(),
}) {
  const nearbySameNumberCount = mids.filter((candidate) =>
    candidate.idx !== mid.idx &&
    normalizeTagToken(candidate.word.text) === midText &&
    Math.abs(candidate.cy - mid.cy) <= Math.max(meanHeight * 1.4, 14)
  ).length;

  // Fallback should only activate on repeated loop numbers (common ISA bubble
  // OCR failure pattern), otherwise it can over-link unrelated labels.
  if (nearbySameNumberCount === 0) return [];

  const fallbackAlignTol = Math.max(alignTol * 12, meanHeight * 16);
  const fallbackGapY = Math.max(maxGapY * 1.4, meanHeight * 2.2);

  return byY
    .filter((w) =>
      w.idx !== mid.idx &&
      w.cy < mid.cy &&
      (mid.cy - w.cy) <= fallbackGapY &&
      Math.abs(w.cx - mid.cx) <= fallbackAlignTol
    )
    .map((w) => {
      const topText = normalizeTagToken(w.word.text);
      if (!codeRegex.test(topText)) return null;
      if (!familyBoost.has(topText)) return null;

      const xDelta = Math.abs(w.cx - mid.cx);
      const yDelta = Math.max(1, mid.cy - w.cy);
      const alignScore = 1 - Math.min(1, xDelta / Math.max(1, fallbackAlignTol));
      const gapScore = 1 - Math.min(1, yDelta / Math.max(1, fallbackGapY));

      return {
        token: w,
        topText,
        score: +(alignScore * 0.75 + gapScore * 0.25).toFixed(4),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Math.abs(a.token.cx - mid.cx) - Math.abs(b.token.cx - mid.cx))
    .slice(0, 2);
}

/**
 * Check if two words are on the same horizontal line and close enough.
 */
function areAdjacent(wordA, wordB, maxGapPx, yOverlapThreshold) {
  const a = getBbox(wordA.vertices);
  const b = getBbox(wordB.vertices);

  // Check vertical overlap
  const overlapTop = Math.max(a.minY, b.minY);
  const overlapBottom = Math.min(a.maxY, b.maxY);
  const overlapHeight = overlapBottom - overlapTop;
  const minHeight = Math.min(a.maxY - a.minY, b.maxY - b.minY);

  if (minHeight <= 0) return false;
  if (overlapHeight / minHeight < yOverlapThreshold) return false;

  // Check horizontal gap (b should be to the right of a)
  const gap = b.minX - a.maxX;
  return gap >= -2 && gap <= maxGapPx;
}

/**
 * Merge multiple bounding boxes into one encompassing box.
 */
function mergeVertices(verticesArrays) {
  const allVertices = verticesArrays.flat();
  const xs = allVertices.map(v => v.x || 0);
  const ys = allVertices.map(v => v.y || 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Group spatially adjacent words and concatenate their text.
 * @param {Array} words - OCR words with { text, confidence, vertices, pageWidth, pageHeight }
 * @param {number} maxGapPx - Maximum horizontal gap between words (pixels)
 * @param {number} yOverlapThreshold - Minimum vertical overlap ratio (0-1)
 * @returns {Array} Grouped words with merged bounding boxes
 */
export function groupAdjacentWords(words, maxGapPx = 15, yOverlapThreshold = 0.5) {
  if (!words || words.length === 0) return [];

  const options = parseOptions(maxGapPx, yOverlapThreshold);
  const normalized = normalizeWords(words);
  const meanHeight = avgWordHeight(normalized);
  const groups = [];
  const groupKeys = new Set();

  // Horizontal pass (legacy behavior, now scale-aware).
  const sorted = [...normalized].sort((a, b) => {
    if (Math.abs(a.bbox.minY - b.bbox.minY) > 10) return a.bbox.minY - b.bbox.minY;
    return a.bbox.minX - b.bbox.minX;
  });
  const used = new Set();
  const maxHorizontalGap = Math.max(options.maxGapPx, Math.round(meanHeight * 0.9));

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    const group = [sorted[i]];
    used.add(i);

    // Greedy: keep extending the group to the right
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = i + 1; j < sorted.length; j++) {
        if (used.has(j)) continue;
        const last = group[group.length - 1];
        if (areAdjacent(last.word, sorted[j].word, maxHorizontalGap, options.yOverlapThreshold)) {
          group.push(sorted[j]);
          used.add(j);
          changed = true;
        }
      }
    }
    const merged = buildMergedGroup(group, 'horizontal');
    const key = createGroupKey(merged.componentWordIndices);
    if (!groupKeys.has(key)) {
      groups.push(merged);
      groupKeys.add(key);
    }
  }

  // Vertical ISA-style stack pass.
  if (options.enableVerticalGrouping) {
    const byY = [...normalized].sort((a, b) => a.cy - b.cy);
    const alignTol = meanHeight * options.verticalAlignRatio;
    const maxGapY = meanHeight * options.verticalGapRatio;
    const codeRegex = /^[A-Z]{2,5}$/;
    const numberRegex = /^\d{3,7}$/;
    const suffixRegex = /^[A-Z]{1,3}\d{0,2}$/;
    const suffixStopWords = new Set(['RTU', 'NOTE', 'PIPING', 'INST']);
    const familyBoost = new Set(['XA', 'XS', 'ZLC', 'ZLO', 'ZSC', 'PSL', 'PSH', 'LSL', 'TSH']);
    const mids = byY.filter((w) => numberRegex.test(normalizeTagToken(w.word.text)));

    for (const mid of mids) {
      const midText = normalizeTagToken(mid.word.text);
      let prefixCandidates = byY
        .filter((w) =>
          w.idx !== mid.idx &&
          w.cy < mid.cy &&
          (mid.cy - w.cy) <= (maxGapY * 1.6) &&
          Math.abs(w.cx - mid.cx) <= alignTol
        )
        .map((w) => {
          const topText = normalizeTagToken(w.word.text);
          if (!codeRegex.test(topText)) return null;
          const xDelta = Math.abs(w.cx - mid.cx);
          const yDelta = Math.max(1, mid.cy - w.cy);
          const alignScore = 1 - Math.min(1, xDelta / Math.max(1, alignTol));
          const gapScore = 1 - Math.min(1, yDelta / Math.max(1, maxGapY * 1.6));
          const boost = familyBoost.has(topText) ? 0.3 : 0;
          return {
            token: w,
            topText,
            score: +(alignScore * 0.62 + gapScore * 0.38 + boost).toFixed(4),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || b.token.cy - a.token.cy)
        .slice(0, 4);

      if (!prefixCandidates.length) {
        prefixCandidates = buildFallbackPrefixCandidates({
          byY,
          mids,
          mid,
          midText,
          meanHeight,
          alignTol,
          maxGapY,
          codeRegex,
          familyBoost,
        });
      }

      if (!prefixCandidates.length) continue;

      const suffixCandidates = byY
        .filter((w) =>
          w.idx !== mid.idx &&
          w.cy > mid.cy &&
          (w.cy - mid.cy) <= (maxGapY * 1.4) &&
          Math.abs(w.cx - mid.cx) <= (alignTol * 1.1)
        )
        .map((w) => {
          const t = normalizeTagToken(w.word.text);
          if (!suffixRegex.test(t) || suffixStopWords.has(t)) return null;
          const xDelta = Math.abs(w.cx - mid.cx);
          const yDelta = Math.max(1, w.cy - mid.cy);
          const alignScore = 1 - Math.min(1, xDelta / Math.max(1, alignTol * 1.1));
          const gapScore = 1 - Math.min(1, yDelta / Math.max(1, maxGapY * 1.4));
          return {
            token: w,
            suffixText: t,
            score: +(alignScore * 0.6 + gapScore * 0.4).toFixed(4),
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score || a.token.cy - b.token.cy)
        .slice(0, 2);

      const suffixOptions = suffixCandidates.length ? suffixCandidates : [null];

      // Phase 1.1 — expose assembly metadata so the pipeline can decide whether
      // a vertical_isa candidate is "deterministic strong" (single hypothesis or
      // clear margin over runner-up) vs a competing hypothesis that needs AI
      // arbitration. marginToRunnerUp = 1.0 means no competition.
      const competingPrefixCount = prefixCandidates.length;
      const bestPrefixScore = prefixCandidates[0]?.score ?? 0;
      const runnerUpPrefixScore = prefixCandidates[1]?.score ?? null;
      const marginToRunnerUp = runnerUpPrefixScore == null
        ? 1
        : +(bestPrefixScore - runnerUpPrefixScore).toFixed(4);

      for (const prefix of prefixCandidates) {
        for (const suffix of suffixOptions) {
          const wordsInGroup = suffix
            ? [prefix.token, mid, suffix.token]
            : [prefix.token, mid];
          const assembledTag = [
            prefix.topText,
            midText,
            suffix?.suffixText || null,
          ].filter(Boolean).join('-');

          const componentWordIndices = wordsInGroup.map(w => w.idx);
          const key = createGroupKey(componentWordIndices);
          if (groupKeys.has(key)) continue;

          const mergedVertices = mergeVertices(wordsInGroup.map(w => w.word.vertices));
          const avgConfidence = wordsInGroup.reduce((s, w) => s + (w.word.confidence || 0), 0) / wordsInGroup.length;
          // isBestHypothesis: this row is the top-scoring prefix for its anchor.
          // Pipeline uses this + marginToRunnerUp + competingPrefixCount to decide
          // whether to promote to KEPT_DETERMINISTIC_STRONG.
          const isBestHypothesis = prefix === prefixCandidates[0];
          groups.push({
            text: assembledTag,
            confidence: avgConfidence,
            vertices: mergedVertices,
            pageWidth: mid.word.pageWidth,
            pageHeight: mid.word.pageHeight,
            wordCount: wordsInGroup.length,
            source: 'vertical_isa',
            componentWordIndices,
            assemblyRule: 'vertical_stack_v2',
            assemblyScore: prefix.score,
            competingPrefixCount,
            marginToRunnerUp,
            isBestHypothesis,
            anchorWordIndex: mid.idx,
          });
          groupKeys.add(key);
        }
      }
    }
  }

  // Rotation-aware pass for non-horizontal runs.
  if (options.enableRotationGrouping) {
    const minAbs = Math.abs(options.rotationMinAbsDeg);
    const candidates = normalized.filter(w => Math.abs(w.angleDeg) >= minAbs);
    const usedRot = new Set();
    const perpTol = meanHeight * options.rotatedPerpRatio;
    const alongMaxGap = Math.max(options.maxGapPx * 2, meanHeight * options.rotatedAlongRatio);

    const isRotAdjacent = (a, b) => {
      const angle = (a.angleDeg + b.angleDeg) / 2;
      const theta = angle * (Math.PI / 180);
      const dirX = Math.cos(theta);
      const dirY = Math.sin(theta);
      const dx = b.cx - a.cx;
      const dy = b.cy - a.cy;
      const along = dx * dirX + dy * dirY;
      const perp = Math.abs((-dx * dirY) + (dy * dirX));
      return along >= -2 && along <= alongMaxGap && perp <= perpTol;
    };

    for (let i = 0; i < candidates.length; i++) {
      if (usedRot.has(i)) continue;
      const seed = candidates[i];
      const group = [seed];
      usedRot.add(i);

      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < candidates.length; j++) {
          if (usedRot.has(j)) continue;
          const last = group[group.length - 1];
          const angleDelta = Math.abs(last.angleDeg - candidates[j].angleDeg);
          if (angleDelta > options.rotationAngleToleranceDeg) continue;
          if (isRotAdjacent(last, candidates[j])) {
            group.push(candidates[j]);
            usedRot.add(j);
            changed = true;
          }
        }
      }

      if (group.length < 2) continue;

      const theta = (group.reduce((s, g) => s + g.angleDeg, 0) / group.length) * (Math.PI / 180);
      const dirX = Math.cos(theta);
      const dirY = Math.sin(theta);
      group.sort((a, b) => ((a.cx * dirX + a.cy * dirY) - (b.cx * dirX + b.cy * dirY)));

      const merged = buildMergedGroup(group, 'rotated');
      const key = createGroupKey(merged.componentWordIndices);
      if (!groupKeys.has(key)) {
        groups.push(merged);
        groupKeys.add(key);
      }
    }
  }

  // Structured row pass for long line numbers and other fragmented tags that may
  // fail strict adjacency due to quotes, slashes, or wider separator spacing.
  const structuredRowGroups = buildStructuredRowCandidates(normalized, meanHeight, groupKeys);
  if (structuredRowGroups.length > 0) {
    groups.push(...structuredRowGroups);
  }

  const ocrConfusionVariants = buildOcrConfusionVariantGroups(groups);
  if (ocrConfusionVariants.length > 0) {
    groups.push(...ocrConfusionVariants);
  }

  // Production post-passes (numeric guard + number-break stopper).  Default ON;
  // can be turned off by passing { enableNumericGuard: false } /
  // { enableNumberBreakStopper: false } via the options bag.
  const postPassed = applyProductionPostPasses(groups, normalized, options);
  return postPassed.groups;
}

/**
 * Convert vertices to percentage-based bounding box.
 */
export function verticesToPct(vertices, imageWidth, imageHeight) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x_pct: (minX / imageWidth) * 100,
    y_pct: (minY / imageHeight) * 100,
    w_pct: ((maxX - minX) / imageWidth) * 100,
    h_pct: ((maxY - minY) / imageHeight) * 100,
  };
}

/**
 * Convert vertices to pixel-based bounding box.
 */
export function verticesToPixels(vertices) {
  const xs = vertices.map(v => v.x || 0);
  const ys = vertices.map(v => v.y || 0);

  return {
    x_px: Math.min(...xs),
    y_px: Math.min(...ys),
    w_px: Math.max(...xs) - Math.min(...xs),
    h_px: Math.max(...ys) - Math.min(...ys),
  };
}
