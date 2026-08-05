/**
 * Word Grouping Diagnostic
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY analysis of WordGrouper.groupAdjacentWords output.
 *
 * Purpose: surface ROOT CAUSES of missed/wrong tag assembly without changing
 * the production algorithm.  For every page of raw OCR words it returns:
 *   - groups[]                  — final post-stopper + post-arbitration groups
 *   - rawWords[]                — every input atom (text, bbox, position_pct)
 *   - wordToGroupIds            — map: wordIdx → list of group ids using it
 *   - ungroupedWordIndices      — atoms NOT inside any multi-word group
 *   - conflicts[]               — atoms claimed by ≥2 multi-word groups
 *   - sourceBreakdown           — counts + mean confidence per pattern source
 *   - coverage                  — % of atoms that landed inside a multi-word group
 *   - pipeline                  — per-stage stats (baseline → stoppers → arbitration)
 *
 * No AI calls. No DB writes. No storage writes.
 *
 * Optional inputs (controlled from the route):
 *   options.horizontalStoppers   — array of: 'median_gap', 'symbol_region',
 *                                  'number_break'. Applied as POST-FILTERS on the
 *                                  horizontal pass; do not touch WordGrouper.js.
 *   options.arbitration          — 'none' | 'priority_lock' | 'nms_best' | 'cluster'
 *   options.symbolRegions        — optional [{x_pct,y_pct,w_pct,h_pct}, ...]
 *                                  used by 'symbol_region' stopper and DBSCAN seed.
 */

import { groupAdjacentWords, verticesToPct, verticesToPixels } from './WordGrouper.js';

const DEFAULT_DIAGNOSTIC_OPTIONS = {
  enableVerticalGrouping: true,
  enableRotationGrouping: true,
  maxGapPx: 15,
  yOverlapThreshold: 0.5,
};

// Strategy B / C scoring: how much we trust each pattern source.  Higher prior
// → atoms tend to land in this source's groups when arbitration kicks in.
const PATTERN_PRIOR = {
  vertical_paired_user: 3.0, // user-labelled forced pairing — absolute trust
  vertical_paired: 1.8,    // Hungarian-paired bubbles — highest trust
  vertical_isa: 1.6,
  vertical_relaxed: 1.5,
  rotated: 1.4,
  line_assembler: 1.35,
  structured_row: 1.3,
  horizontal: 1.0,
  ocr_confusion_variant: 0.6,
  unknown: 0.9,
};

// Strategy A pass priority (lower number = runs first / locks atoms first).
//
// Order rationale: more SPECIFIC patterns win first, so that highly-constrained
// matches don't get stolen by permissive ones.  structured_row + line_assembler
// require multi-segment dash-separated text patterns (very specific shape) —
// they must outrank vertical_paired so that line tags like
// "2"-H-28-12-0114-H03S-N" are not partially eaten by spurious vertical pairs
// like "H-28" on the line-number atoms.  Vertical paired groups (Hungarian-
// assigned ISA bubbles) outrank vertical_isa/_relaxed because the pairing
// step already resolved competing hypotheses.
const SOURCE_PRIORITY = {
  vertical_paired_user: 0,  // user-labelled forced pairs always win
  structured_row: 1,
  line_assembler: 1,
  vertical_paired: 2,      // bipartite winners
  vertical_isa: 3,
  vertical_relaxed: 3,
  rotated: 4,
  horizontal: 5,
  ocr_confusion_variant: 6,
  unknown: 5,
};

const STOPPER_NAMES = new Set(['median_gap', 'symbol_region', 'number_break']);
const ARBITRATION_MODES = new Set(['none', 'priority_lock', 'nms_best', 'cluster']);

function bboxFromVertices(vertices = []) {
  const xs = (vertices || []).map(v => Number(v?.x ?? 0)).filter(Number.isFinite);
  const ys = (vertices || []).map(v => Number(v?.y ?? 0)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    width: Math.max(0, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(0, Math.max(...ys) - Math.min(...ys)),
  };
}

function safeAvg(arr) {
  if (!arr.length) return 0;
  const sum = arr.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  return +(sum / arr.length).toFixed(4);
}

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mergeVerticesArrays(arrs) {
  const all = arrs.filter(Boolean).flat();
  const xs = all.map(v => Number(v?.x ?? 0)).filter(Number.isFinite);
  const ys = all.map(v => Number(v?.y ?? 0)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...xs), maxY = Math.max(...ys);
  return [
    { x: minX, y: minY }, { x: maxX, y: minY },
    { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
}

function pctBoxCenter(pct) {
  if (!pct) return null;
  return {
    cx_pct: Number(pct.x_pct || 0) + Number(pct.w_pct || 0) / 2,
    cy_pct: Number(pct.y_pct || 0) + Number(pct.h_pct || 0) / 2,
  };
}

function pctContainsPct(outer, inner, slackPct = 0.5) {
  if (!outer || !inner) return false;
  const ox1 = Number(outer.x_pct || 0) - slackPct;
  const oy1 = Number(outer.y_pct || 0) - slackPct;
  const ox2 = ox1 + Number(outer.w_pct || 0) + slackPct * 2;
  const oy2 = oy1 + Number(outer.h_pct || 0) + slackPct * 2;
  const c = pctBoxCenter(inner);
  if (!c) return false;
  return c.cx_pct >= ox1 && c.cx_pct <= ox2 && c.cy_pct >= oy1 && c.cy_pct <= oy2;
}

// ─── Per-group geometry metrics ──────────────────────────────────────────────
//
// For a multi-word horizontal-ish group, compute median + max atom-to-atom
// X-gap so the UI can flag "looks like a greedy hop across bubbles".
function computeChainGapStats(group, rawWords) {
  const wis = (group.componentWordIndices || []).slice();
  if (wis.length < 2) return { medianGapPx: null, maxGapPx: null, gapPxList: [] };
  const sorted = wis
    .map(i => rawWords[i])
    .filter(Boolean)
    .map(w => ({ wi: w.idx, bbox: w.bbox }))
    .filter(x => x.bbox)
    .sort((a, b) => a.bbox.minX - b.bbox.minX);
  if (sorted.length < 2) return { medianGapPx: null, maxGapPx: null, gapPxList: [] };
  const gaps = [];
  for (let k = 1; k < sorted.length; k++) {
    gaps.push(Math.max(0, sorted[k].bbox.minX - sorted[k - 1].bbox.maxX));
  }
  return {
    medianGapPx: +median(gaps).toFixed(2),
    maxGapPx: +Math.max(...gaps).toFixed(2),
    gapPxList: gaps.map(g => +g.toFixed(2)),
  };
}

// ─── Horizontal stoppers (post-filter on horizontal-pass output) ─────────────
//
// Each stopper takes a SINGLE multi-word horizontal group and returns an array
// of sub-groups (1+).  If the chain is fine, returns [group] unchanged.

function splitByMedianGap(group, rawWords, ratio = 2.2) {
  const wis = group.componentWordIndices || [];
  if (wis.length < 3) return [group];
  const items = wis
    .map(i => rawWords[i])
    .filter(Boolean)
    .map(w => ({ wi: w.idx, bbox: w.bbox, text: w.text }))
    .filter(x => x.bbox)
    .sort((a, b) => a.bbox.minX - b.bbox.minX);
  if (items.length < 3) return [group];
  const gaps = [];
  for (let k = 1; k < items.length; k++) {
    gaps.push(Math.max(0, items[k].bbox.minX - items[k - 1].bbox.maxX));
  }
  const med = median(gaps);
  if (med <= 0) return [group];
  const splits = [];
  for (let k = 0; k < gaps.length; k++) {
    if (gaps[k] > med * ratio && gaps[k] > 6) splits.push(k + 1);
  }
  if (!splits.length) return [group];
  const chunks = [];
  let start = 0;
  for (const s of splits) {
    chunks.push(items.slice(start, s));
    start = s;
  }
  chunks.push(items.slice(start));
  return chunks
    .filter(c => c.length > 0)
    .map(c => rebuildGroupFromAtoms(group, c.map(x => x.wi), 'horizontal:median_gap_split'));
}

function splitBySymbolRegion(group, rawWords, symbolRegions = []) {
  if (!symbolRegions.length) return [group];
  const wis = group.componentWordIndices || [];
  if (wis.length < 2) return [group];
  // For each atom, find which symbol region (if any) contains its center.
  // Atoms outside ALL regions get bucket 'free'.  Then split chain by bucket transitions.
  const buckets = wis.map(i => {
    const w = rawWords[i];
    if (!w?.position_pct) return 'free';
    for (let r = 0; r < symbolRegions.length; r++) {
      if (pctContainsPct(symbolRegions[r], w.position_pct, 0.3)) return `r${r}`;
    }
    return 'free';
  });
  // If everything is in same bucket (or all free), nothing to split.
  const distinct = new Set(buckets);
  if (distinct.size <= 1) return [group];
  const items = wis.map((wi, k) => ({ wi, bbox: rawWords[wi]?.bbox, bucket: buckets[k] }))
    .filter(x => x.bbox)
    .sort((a, b) => a.bbox.minX - b.bbox.minX);
  const chunks = [];
  let cur = [items[0]];
  for (let k = 1; k < items.length; k++) {
    if (items[k].bucket === cur[cur.length - 1].bucket) cur.push(items[k]);
    else { chunks.push(cur); cur = [items[k]]; }
  }
  chunks.push(cur);
  if (chunks.length <= 1) return [group];
  return chunks.map(c => rebuildGroupFromAtoms(group, c.map(x => x.wi), 'horizontal:symbol_region_split'));
}

function splitByNumberBreak(group, rawWords) {
  const wis = group.componentWordIndices || [];
  if (wis.length < 2) return [group];
  const items = wis.map(i => rawWords[i])
    .filter(Boolean)
    .filter(w => w.bbox)
    .sort((a, b) => a.bbox.minX - b.bbox.minX);
  if (items.length < 2) return [group];
  const isLongNumber = (s) => /^\d{4,}$/.test(String(s || '').replace(/[^0-9]/g, ''));
  const splits = [];
  for (let k = 1; k < items.length; k++) {
    if (isLongNumber(items[k - 1].text) && isLongNumber(items[k].text)) splits.push(k);
  }
  if (!splits.length) return [group];
  const chunks = [];
  let start = 0;
  for (const s of splits) { chunks.push(items.slice(start, s)); start = s; }
  chunks.push(items.slice(start));
  return chunks.filter(c => c.length > 0)
    .map(c => rebuildGroupFromAtoms(group, c.map(x => x.idx), 'horizontal:number_break_split'));
}

function rebuildGroupFromAtoms(originalGroup, atomIndices, ruleSuffix) {
  const verticesArrays = atomIndices.map(i => null); // placeholder so map runs
  // We don't keep raw vertices on the diagnostic-enriched rawWords by index, so
  // accept that the caller must provide them via closure.  We'll patch this in
  // applyHorizontalStoppers where rawWords are in scope.
  return {
    ...originalGroup,
    text: '__REBUILD__',
    componentWordIndices: atomIndices.slice(),
    wordCount: atomIndices.length,
    assemblyRule: `${originalGroup.assemblyRule || originalGroup.source}:${ruleSuffix}`,
    __rebuildPending: true,
  };
}

function finalizeRebuilds(groups, rawWords, pageWidth, pageHeight) {
  return groups.map(g => {
    if (!g.__rebuildPending) return g;
    const wis = g.componentWordIndices || [];
    const verts = wis.map(i => rawWords[i]?.vertices).filter(Boolean);
    const merged = mergeVerticesArrays(verts);
    const text = wis.map(i => rawWords[i]?.text || '').join('');
    const conf = safeAvg(wis.map(i => rawWords[i]?.confidence).filter(Number.isFinite));
    const pct = merged ? verticesToPct(merged, pageWidth, pageHeight) : null;
    const px  = merged ? verticesToPixels(merged) : null;
    const bbox = bboxFromVertices(merged);
    const next = {
      ...g,
      text,
      confidence: conf || null,
      vertices: merged,
      bbox,
      position_pct: pct,
      position_px: px,
    };
    delete next.__rebuildPending;
    return next;
  });
}

function applyHorizontalStoppers(groups, rawWords, options) {
  const stoppers = (options.horizontalStoppers || []).filter(s => STOPPER_NAMES.has(s));
  if (!stoppers.length) return { groups, applied: [] };
  const symbolRegions = options.symbolRegions || [];
  const out = [];
  for (const g of groups) {
    if (g.source !== 'horizontal' || (g.wordCount || 1) < 2) { out.push(g); continue; }
    let chunks = [g];
    for (const stopper of stoppers) {
      const next = [];
      for (const c of chunks) {
        if (stopper === 'median_gap')      next.push(...splitByMedianGap(c, rawWords));
        else if (stopper === 'symbol_region') next.push(...splitBySymbolRegion(c, rawWords, symbolRegions));
        else if (stopper === 'number_break')  next.push(...splitByNumberBreak(c, rawWords));
      }
      chunks = next;
    }
    out.push(...chunks);
  }
  return { groups: out, applied: stoppers };
}

// Guard rail for over-merged numeric chains:
// if a non-vertical multi-word group consists only of long numeric atoms,
// split it into single-atom groups. Example: "281010 281010 281011".
function splitPureNumericChains(groups, rawWords) {
  const out = [];
  let splitCount = 0;
  const isNumericLike = (text) => {
    const t = normalizeTag(text || '');
    return /^\d{4,8}[A-Z]?$/.test(t);
  };
  for (const g of groups) {
    const wc = g.wordCount || 1;
    if (wc < 2) { out.push(g); continue; }
    if (isVerticalSource(g.source)) { out.push(g); continue; }
    const wis = g.componentWordIndices || [];
    if (wis.length < 2) { out.push(g); continue; }
    const allNumeric = wis.every(i => isNumericLike(rawWords[i]?.text));
    if (!allNumeric) { out.push(g); continue; }
    for (const wi of wis) {
      out.push(rebuildGroupFromAtoms(g, [wi], 'numeric_chain_split'));
    }
    splitCount += 1;
  }
  return { groups: out, splitCount };
}

// ─── Arbitration strategies ──────────────────────────────────────────────────

function arbitrateByPriorityLock(groups) {
  const sorted = [...groups].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 4;
    const pb = SOURCE_PRIORITY[b.source] ?? 4;
    if (pa !== pb) return pa - pb;
    // Same priority — prefer larger groups, then higher score
    if ((a.wordCount || 1) !== (b.wordCount || 1)) return (b.wordCount || 1) - (a.wordCount || 1);
    return (b.assemblyScore || 0) - (a.assemblyScore || 0);
  });
  const locked = new Set();
  const kept = [];
  for (const g of sorted) {
    const wis = g.componentWordIndices || [];
    if (wis.some(i => locked.has(i))) {
      // Skip this group — at least one atom is already claimed by a higher-priority group
      continue;
    }
    kept.push(g);
    if ((g.wordCount || 1) > 1) for (const i of wis) locked.add(i);
  }
  return kept;
}

function arbitrateByNmsBest(groups, rawWords) {
  const totalAtoms = rawWords.length;
  const atomScores = Array(totalAtoms).fill(null);
  const atomGroupId = Array(totalAtoms).fill(-1);
  for (const g of groups) {
    if ((g.wordCount || 1) < 2) continue;
    const prior = PATTERN_PRIOR[g.source] ?? PATTERN_PRIOR.unknown;
    const score = (Number(g.assemblyScore) || 0.5) * prior * Math.log10((g.wordCount || 1) + 1);
    for (const i of (g.componentWordIndices || [])) {
      if (atomScores[i] == null || score > atomScores[i]) {
        atomScores[i] = score;
        atomGroupId[i] = g.id;
      }
    }
  }
  // For each multi-word group, count how many of its atoms it actually "won".
  const wonAtomsByGroup = new Map();
  for (let i = 0; i < totalAtoms; i++) {
    const gid = atomGroupId[i];
    if (gid < 0) continue;
    if (!wonAtomsByGroup.has(gid)) wonAtomsByGroup.set(gid, []);
    wonAtomsByGroup.get(gid).push(i);
  }
  const kept = [];
  for (const g of groups) {
    if ((g.wordCount || 1) < 2) {
      kept.push(g);
      continue;
    }
    const won = wonAtomsByGroup.get(g.id) || [];
    if (won.length < 2) continue; // group lost too many atoms — drop
    // If the group survived intact, keep as-is. Otherwise rebuild from won atoms.
    if (won.length === (g.componentWordIndices || []).length) {
      kept.push(g);
    } else {
      kept.push({
        ...g,
        componentWordIndices: won.slice().sort((a, b) => a - b),
        wordCount: won.length,
        assemblyRule: `${g.assemblyRule || g.source}:nms_rebuilt`,
        __rebuildPending: true,
      });
    }
  }
  return kept;
}

function dbscan(points, eps, minPts) {
  // points: [{ idx, x, y }]
  const visited = new Array(points.length).fill(false);
  const cluster = new Array(points.length).fill(-1); // -1 = noise, else cluster id
  let clusterId = 0;
  const eps2 = eps * eps;
  function neighbors(p) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      if (i === p) continue;
      const dx = points[i].x - points[p].x;
      const dy = points[i].y - points[p].y;
      if (dx * dx + dy * dy <= eps2) out.push(i);
    }
    return out;
  }
  for (let i = 0; i < points.length; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const N = neighbors(i);
    if (N.length < minPts - 1) continue; // noise (will be revisited if absorbed)
    cluster[i] = clusterId;
    const queue = [...N];
    while (queue.length) {
      const j = queue.shift();
      if (!visited[j]) {
        visited[j] = true;
        const Nj = neighbors(j);
        if (Nj.length >= minPts - 1) for (const k of Nj) if (cluster[k] === -1) queue.push(k);
      }
      if (cluster[j] === -1) cluster[j] = clusterId;
    }
    clusterId++;
  }
  return { cluster, clusterCount: clusterId };
}

function arbitrateByCluster(groups, rawWords) {
  const points = [];
  for (let i = 0; i < rawWords.length; i++) {
    const bbox = rawWords[i]?.bbox;
    if (!bbox) continue;
    points.push({
      idx: i,
      x: (bbox.minX + bbox.maxX) / 2,
      y: (bbox.minY + bbox.maxY) / 2,
      h: bbox.height || 0,
      w: bbox.width || 0,
    });
  }
  if (points.length < 4) return arbitrateByNmsBest(groups, rawWords);
  const heights = points.map(p => p.h).filter(h => h > 0);
  const medH = median(heights) || 12;
  // eps tied to text height — atoms within ~3.5 line-heights cluster together.
  const eps = Math.max(20, medH * 3.5);
  const { cluster } = dbscan(points, eps, 2);
  const atomCluster = new Array(rawWords.length).fill(-1);
  for (const p of points) atomCluster[p.idx] = cluster[points.indexOf(p)];

  // Drop multi-word groups that span 2+ clusters (the over-merge case)
  const survivors = [];
  for (const g of groups) {
    if ((g.wordCount || 1) < 2) { survivors.push(g); continue; }
    const wis = g.componentWordIndices || [];
    const clusters = new Set(wis.map(i => atomCluster[i]).filter(c => c !== -1));
    // Allow noise-only groups (all atoms are -1) AND single-cluster groups
    if (clusters.size <= 1) survivors.push(g);
    // else drop
  }
  // Then run NMS-best within survivors so per-atom uniqueness is preserved.
  return arbitrateByNmsBest(survivors, rawWords);
}

function applyArbitration(groups, rawWords, mode) {
  if (mode === 'priority_lock') return arbitrateByPriorityLock(groups);
  if (mode === 'nms_best')      return arbitrateByNmsBest(groups, rawWords);
  if (mode === 'cluster')       return arbitrateByCluster(groups, rawWords);
  return groups;
}

// ─── Bipartite vertical pairing (Hungarian assignment) ──────────────────────
//
// The strict + relaxed vertical passes BOTH have a fundamental flaw: for each
// "mid" atom (number) they keep the top-N prefix candidates above and emit a
// group per candidate.  When bubbles sit shoulder-to-shoulder (DHSV row, SSV
// row, etc.) the SAME prefix atom ends up paired with multiple mids.
// Greedy lowest-cost-first assignment then locks the closest pair, leaving
// other mids orphaned — even when re-arranging would let everyone be paired.
//
// Fix: build cost matrix [prefix x mid], solve global minimum-cost perfect
// assignment using Hungarian algorithm.  Concretely for the DHSV row:
//   prefixes: XS#293, XS#295, XS#298
//   mids:     289961#294, 289972#296, 289910#301, 289910#302, 289910#303,
//             289910#304, 289921#305
// Greedy might pair XS#295 with 289972 (closest), leaving 289910#301 with no
// XS to claim.  Hungarian considers global cost: it picks the assignment that
// MINIMIZES TOTAL COST across all 3 prefixes simultaneously, which often
// produces XS#293→289961, XS#295→289910(closest one), XS#298→289921 (or
// similar).  Mids without any feasible prefix (#302, #303 in this row — OCR
// didn't return enough prefixes) stay unpaired and surface in the OCR-miss
// audit instead of being silently grabbed by the wrong group.

// In-place O(n^3) Hungarian algorithm for square cost matrix.
// Adapted from "Hungarian algorithm" by e-maxx-eng (MIT-style).
// Returns array `assign` where assign[i] = j means worker i → job j, or -1.
function hungarianMinCost(cost) {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0].length;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = -1;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assign = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) assign[p[j] - 1] = j - 1;
  }
  return assign;
}

// Wraps Hungarian for a non-square matrix by padding with dummy rows/cols at
// cost = INF_PAD.  Pairings whose final cost ≥ INF_PAD are dropped (treated as
// "no feasible match" — the prefix or mid is genuinely orphaned).
function hungarianAssign(prefixIdxs, midIdxs, costFn, INF_PAD = 1e9) {
  const nP = prefixIdxs.length;
  const nM = midIdxs.length;
  if (nP === 0 || nM === 0) return [];
  const N = Math.max(nP, nM);
  const matrix = [];
  for (let i = 0; i < N; i++) {
    const row = new Array(N).fill(INF_PAD);
    if (i < nP) {
      for (let j = 0; j < nM; j++) {
        const c = costFn(prefixIdxs[i], midIdxs[j]);
        row[j] = (c == null || !Number.isFinite(c)) ? INF_PAD : c;
      }
    }
    matrix.push(row);
  }
  const assign = hungarianMinCost(matrix);
  const pairs = [];
  for (let i = 0; i < nP; i++) {
    const j = assign[i];
    if (j == null || j < 0 || j >= nM) continue;
    if (matrix[i][j] >= INF_PAD - 1) continue;
    pairs.push({ prefixIdx: prefixIdxs[i], midIdx: midIdxs[j], cost: matrix[i][j] });
  }
  return pairs;
}

function applyBipartiteVerticalPairing(groups, rawWords, options = {}) {
  const includeRelaxedMids = options.includeRelaxedMids === true;
  // Pull every vertical-source candidate that has a clear prefix→mid pairing.
  const verticalish = groups.filter(g =>
    (g.source === 'vertical_isa' || (includeRelaxedMids && g.source === 'vertical_relaxed')) &&
    Array.isArray(g.componentWordIndices) &&
    g.componentWordIndices.length >= 2 &&
    Number.isFinite(g.anchorWordIndex)
  );

  // For each existing candidate group, extract (prefixIdx, midIdx, suffixIdx, cost).
  const allEdges = [];
  for (const g of verticalish) {
    const wis = g.componentWordIndices;
    const midIdx = g.anchorWordIndex;
    const mid = rawWords[midIdx];
    if (!mid?.bbox) continue;
    const midText = normalizeTag(mid.text);
    const midAllowed = includeRelaxedMids
      ? (ISA_MID_RE.test(midText) || ISA_MID_RE_LOOSE.test(midText))
      : ISA_MID_RE.test(midText);
    if (!midAllowed) continue;
    const prefixCandidates = [];
    let prefixIdx = -1;
    let suffixIdx = -1;
    for (const wi of wis) {
      if (wi === midIdx) continue;
      const w = rawWords[wi];
      if (!w?.bbox) continue;
      const above = ((w.bbox.minY + w.bbox.maxY) / 2) < ((mid.bbox.minY + mid.bbox.maxY) / 2);
      if (above && isAllowedInstrumentPrefixToken(w.text, { allowLoose: includeRelaxedMids })) {
        prefixCandidates.push(wi);
      }
      else if (!above) suffixIdx = wi;
    }
    if (prefixCandidates.length) {
      // When a seed candidate includes multiple above-atoms, keep the closest one.
      prefixIdx = prefixCandidates.sort((a, b) => {
        const pa = rawWords[a];
        const pb = rawWords[b];
        const ax = Math.abs(((pa.bbox.minX + pa.bbox.maxX) / 2) - ((mid.bbox.minX + mid.bbox.maxX) / 2));
        const ay = ((mid.bbox.minY + mid.bbox.maxY) / 2) - ((pa.bbox.minY + pa.bbox.maxY) / 2);
        const bx = Math.abs(((pb.bbox.minX + pb.bbox.maxX) / 2) - ((mid.bbox.minX + mid.bbox.maxX) / 2));
        const by = ((mid.bbox.minY + mid.bbox.maxY) / 2) - ((pb.bbox.minY + pb.bbox.maxY) / 2);
        return (ax + 0.5 * ay) - (bx + 0.5 * by);
      })[0];
    }
    if (prefixIdx === -1) continue;
    const pref = rawWords[prefixIdx];
    const xOffset = Math.abs(((pref.bbox.minX + pref.bbox.maxX) / 2) - ((mid.bbox.minX + mid.bbox.maxX) / 2));
    const yGap    = ((mid.bbox.minY + mid.bbox.maxY) / 2) - ((pref.bbox.minY + pref.bbox.maxY) / 2);
    const cost    = xOffset + 0.5 * yGap;
    allEdges.push({ prefixIdx, midIdx, suffixIdx, cost, sourceGroup: g });
  }

  // ─── Edge harvest pass ──────────────────────────────────────────────────
  //
  // The strict and relaxed passes both filter prefix candidates by tight X-
  // tolerance (≈18–20 px).  But in dense bubble rows, the CORRECT prefix
  // can sit 50–80 px sideways (because adjacent bubbles' OCR atoms get
  // physically pushed apart).  Hungarian assignment can only choose from the
  // edges we feed it — so directly harvest ALL plausible (prefix, mid) pairs
  // here using a much wider X-window.  The cost function (xOffset + 0.5*yGap)
  // ensures Hungarian still prefers tight pairings; the wide window only
  // matters for mids whose tight-window prefix was claimed by a closer mid.
  //
  // Width: dynamic around local text scale, capped lower than the previous 100px.
  // Y-window: -45..-4 above each mid (upper half of bubble).
  const HARVEST_Y_MIN = 4;
  const HARVEST_Y_MAX = 60;

  const indexed = rawWords
    .map(w => ({ atom: w, c: atomCenter(w) }))
    .filter(x => x.c);
  const heights = rawWords.map(w => w.bbox?.height || 0).filter(h => h > 0);
  const medH = median(heights) || 12;
  const HARVEST_X_WINDOW_BASE = Math.max(36, Math.min(72, medH * 4.2));
  const HARVEST_NEAREST_X_SLACK = Math.max(10, Math.min(18, medH * 1.1));
  const HARVEST_NEAREST_COST_SLACK = Math.max(10, Math.min(22, medH * 1.5));

  // For harvest pass: use STRICT mid pattern only (4-7 digits, no trailing
  // letter/dot).  The loose pattern picks up things like "28", "29" which are
  // line-number segments inside structured_row/line_assembler tags — pairing
  // them with nearby prefix-shaped atoms produces false vertical groups that
  // steal atoms from real horizontal line tags.  ISA loop numbers are virtually
  // always 4+ digits, so this stricter filter is safe.
  const HARVEST_MID_RE = includeRelaxedMids ? ISA_MID_RE_LOOSE : /^\d{4,7}$/;
  // Same for prefixes: strict pattern only (2-5 chars).  Single chars and
  // 6-char outliers create too many spurious pairs.
  const midAtoms = indexed.filter(x => HARVEST_MID_RE.test(normalizeTag(x.atom.text)));
  const prefixAtoms = indexed.filter(x =>
    isAllowedInstrumentPrefixToken(x.atom.text, { allowLoose: includeRelaxedMids })
  );
  const suffixAtoms = indexed.filter(x => {
    const t = normalizeTag(x.atom.text);
    return ISA_SUFFIX_RE_LOOSE.test(t) && !ISA_SUFFIX_STOP.has(t);
  });
  const windowForMid = (midEntry) => {
    const h = midEntry?.c?.h || medH;
    return Math.max(34, Math.min(72, Math.max(HARVEST_X_WINDOW_BASE, h * 4.6)));
  };
  const bestMidCostByPrefix = new Map();
  for (const p of prefixAtoms) {
    let bestCost = Infinity;
    for (const m of midAtoms) {
      if (p.atom.idx === m.atom.idx) continue;
      const yGap = m.c.cy - p.c.cy;
      if (yGap < HARVEST_Y_MIN || yGap > HARVEST_Y_MAX) continue;
      const xOff = Math.abs(p.c.cx - m.c.cx);
      if (xOff > windowForMid(m)) continue;
      const cost = xOff + 0.5 * yGap;
      if (cost < bestCost) bestCost = cost;
    }
    bestMidCostByPrefix.set(p.atom.idx, bestCost);
  }

  // Pre-existing edge keys so we don't double-add what the strict/relaxed pass
  // already produced.
  const existingKeys = new Set(allEdges.map(e => `${e.prefixIdx}|${e.midIdx}`));

  for (const m of midAtoms) {
    const dynamicXWindow = windowForMid(m);
    const feasiblePrefixes = [];
    for (const p of prefixAtoms) {
      if (p.atom.idx === m.atom.idx) continue;
      const yGap = m.c.cy - p.c.cy;
      if (yGap < HARVEST_Y_MIN || yGap > HARVEST_Y_MAX) continue;
      const xOff = Math.abs(p.c.cx - m.c.cx);
      if (xOff > dynamicXWindow) continue;
      const cost = xOff + 0.5 * yGap;
      feasiblePrefixes.push({ p, yGap, xOff, cost });
    }
    if (!feasiblePrefixes.length) continue;
    const nearestX = feasiblePrefixes.reduce((min, c) => Math.min(min, c.xOff), Infinity);
    for (const entry of feasiblePrefixes) {
      const { p, yGap, xOff, cost } = entry;
      if (xOff > nearestX + HARVEST_NEAREST_X_SLACK) continue;
      const prefixBestCost = bestMidCostByPrefix.get(p.atom.idx);
      if (Number.isFinite(prefixBestCost) && cost > prefixBestCost + HARVEST_NEAREST_COST_SLACK) continue;
      const k = `${p.atom.idx}|${m.atom.idx}`;
      if (existingKeys.has(k)) continue;
      // Find best suffix below (within similar X tolerance, Y just below mid)
      let bestSuffixIdx = -1;
      let bestSuffixCost = Infinity;
      for (const s of suffixAtoms) {
        if (s.atom.idx === m.atom.idx) continue;
        const sYGap = s.c.cy - m.c.cy;
        if (sYGap < 4 || sYGap > 30) continue;
        const sxOff = Math.abs(s.c.cx - m.c.cx);
        if (sxOff > dynamicXWindow) continue;
        const sCost = sxOff + 0.5 * sYGap;
        if (sCost < bestSuffixCost) { bestSuffixCost = sCost; bestSuffixIdx = s.atom.idx; }
      }
      allEdges.push({
        prefixIdx: p.atom.idx,
        midIdx: m.atom.idx,
        suffixIdx: bestSuffixIdx,
        cost,
        sourceGroup: {
          source: 'vertical_paired',
          assemblyRule: 'harvest_v1',
          componentWordIndices: bestSuffixIdx >= 0 ? [p.atom.idx, m.atom.idx, bestSuffixIdx] : [p.atom.idx, m.atom.idx],
          confidence: null,
        },
      });
      existingKeys.add(k);
    }
  }

  if (allEdges.length === 0) return groups;

  // Build cost lookup: best (lowest-cost) edge per (prefixIdx, midIdx) pair.
  // Also remember the source group so we can rebuild faithfully.
  const edgeMap = new Map(); // key "p|m" -> edge
  for (const e of allEdges) {
    const k = `${e.prefixIdx}|${e.midIdx}`;
    const prev = edgeMap.get(k);
    if (!prev || e.cost < prev.cost) edgeMap.set(k, e);
  }

  // Group atoms into row bands so Hungarian operates on small per-row matrices.
  // (Solving one giant matrix would be wasteful AND would let a prefix in row A
  // be assigned to a mid in row B — which is geometrically wrong.)
  // Row band tolerance: ~3x median atom height.
  const ROW_TOL = Math.max(20, medH * 4);

  const allPrefixIdxs = new Set();
  const allMidIdxs = new Set();
  for (const e of edgeMap.values()) {
    allPrefixIdxs.add(e.prefixIdx);
    allMidIdxs.add(e.midIdx);
  }

  const midList = [...allMidIdxs].map(i => ({ idx: i, cy: rawWords[i] ? (rawWords[i].bbox.minY + rawWords[i].bbox.maxY) / 2 : 0 }))
    .sort((a, b) => a.cy - b.cy);

  // Build row bands greedily by Y-center proximity.
  const bands = [];
  for (const m of midList) {
    const last = bands[bands.length - 1];
    if (last && Math.abs(m.cy - last.anchorY) <= ROW_TOL) {
      last.midIdxs.push(m.idx);
      last.anchorY = (last.anchorY * (last.midIdxs.length - 1) + m.cy) / last.midIdxs.length;
    } else {
      bands.push({ anchorY: m.cy, midIdxs: [m.idx] });
    }
  }

  // For each band, determine candidate prefixes (any prefix that has at least
  // one edge to a mid in the band).
  const winners = [];
  for (const band of bands) {
    const midSet = new Set(band.midIdxs);
    const prefixSet = new Set();
    for (const e of edgeMap.values()) {
      if (midSet.has(e.midIdx)) prefixSet.add(e.prefixIdx);
    }
    const prefixIdxs = [...prefixSet];
    const midIdxs = band.midIdxs;
    if (!prefixIdxs.length || !midIdxs.length) continue;

    const pairs = hungarianAssign(prefixIdxs, midIdxs, (p, m) => {
      const e = edgeMap.get(`${p}|${m}`);
      return e ? e.cost : null;
    });

    for (const pair of pairs) {
      const e = edgeMap.get(`${pair.prefixIdx}|${pair.midIdx}`);
      if (e) winners.push(e);
    }
  }

  // Suffix attachment: a suffix atom can only be claimed by ONE pairing.
  // Process winners in order of pair cost (cheaper = more confident pairing).
  winners.sort((a, b) => a.cost - b.cost);
  const usedSuffix = new Set();
  const pairedGroups = [];
  for (const w of winners) {
    let { suffixIdx } = w;
    if (suffixIdx != null && suffixIdx >= 0 && !usedSuffix.has(suffixIdx)) {
      usedSuffix.add(suffixIdx);
    } else {
      suffixIdx = -1;
    }
    const wis = suffixIdx >= 0 ? [w.prefixIdx, w.midIdx, suffixIdx] : [w.prefixIdx, w.midIdx];
    const verts = wis.map(i => rawWords[i]?.vertices).filter(Boolean);
    const merged = mergeVerticesArrays(verts);
    const conf = safeAvg(wis.map(i => rawWords[i]?.confidence).filter(Number.isFinite));
    const text = wis.map(i => normalizeTag(rawWords[i]?.text || '')).filter(Boolean).join('-');
    pairedGroups.push({
      ...w.sourceGroup,
      text,
      source: 'vertical_paired',
      assemblyRule: `${w.sourceGroup.assemblyRule || w.sourceGroup.source}:hungarian`,
      assemblyScore: +(1 / (1 + w.cost / 50)).toFixed(4),
      marginToRunnerUp: 1,
      competingPrefixCount: 1,
      isBestHypothesis: true,
      anchorWordIndex: w.midIdx,
      wordCount: wis.length,
      componentWordIndices: wis,
      vertices: merged,
      confidence: conf || w.sourceGroup.confidence,
      __rebuildPending: true,
    });
  }

  // Drop original vertical candidates that this pairing pass replaces.
  // By default only strict vertical_isa candidates are replaced; relaxed groups
  // are left untouched unless includeRelaxedMids=true is explicitly requested.
  const others = groups.filter(g =>
    g.source !== 'vertical_isa' && (!includeRelaxedMids || g.source !== 'vertical_relaxed')
  );
  return [...others, ...pairedGroups];
}

// ─── Vertical-pass investigation tools ───────────────────────────────────────
//
// Production WordGrouper.js vertical_isa pass uses page-wide meanHeight to set
// alignTol and maxGapY.  On dense P&IDs that mix tiny line-tag text with bigger
// ISA bubbles, this biases thresholds too tight and many bubbles never form a
// stack at all.  These helpers (a) explain WHY each ISA-pattern atom failed to
// form a stack and (b) run a relaxed version of the same pass using LOCAL
// median height instead of page-wide mean.

const ISA_MID_RE      = /^\d{3,7}$/;
const ISA_PREFIX_RE   = /^[A-Z]{2,5}$/;
const ISA_SUFFIX_RE   = /^[A-Z]{1,3}\d{0,2}$/;
// Relaxed variants (used only by relaxed pass + explainer to detect "looks like" patterns)
const ISA_MID_RE_LOOSE     = /^\d{2,7}[A-Z]?\.?$/;
const ISA_PREFIX_RE_LOOSE  = /^[A-Z]{1,6}\.?$/;
const ISA_SUFFIX_RE_LOOSE  = /^[A-Z]{1,4}\d{0,3}$/;
const ISA_SUFFIX_STOP      = new Set(['RTU', 'NOTE', 'PIPING', 'INST', 'TYP', 'NTS']);
const ISA_PREFIX_WHITELIST = new Set([
  'XA', 'XS', 'ZLC', 'ZLO', 'ZSC', 'ZSO',
  'PSL', 'PSH', 'PSV', 'PSHH', 'PSLL', 'PALL',
  'LSL', 'LSH', 'TSH', 'TSL', 'TSHH',
  'FE', 'FT', 'PT', 'TT', 'TW', 'TG',
  'HS', 'HV', 'PG', 'PI', 'TI', 'LI', 'LT', 'FI', 'FY',
  'LIT', 'PIT', 'FIT', 'TIT',
  'VHP', 'LAL', 'LAH', 'PAL', 'PAH', 'TAH', 'TAL',
  'VHV', 'VLV', 'CSO', 'CSC', 'CEM', 'CI',
]);
const ISA_PREFIX_STOP = new Set([
  'RTU', 'NOTE', 'DHSV', 'MANUAL', 'BYPASS', 'MAINTENANCE', 'PIPING', 'INST', 'FROM', 'TO', 'TOTAL',
]);

function normalizeTag(text = '') {
  return String(text || '').trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
}

function isAllowedInstrumentPrefixToken(text = '', { allowLoose = false } = {}) {
  let t = normalizeTag(text);
  if (!t) return false;
  if (allowLoose && t.endsWith('.')) t = t.slice(0, -1);
  if (ISA_PREFIX_STOP.has(t)) return false;
  if (allowLoose ? !ISA_PREFIX_RE_LOOSE.test(t) : !ISA_PREFIX_RE.test(t)) return false;
  return ISA_PREFIX_WHITELIST.has(t);
}

function atomCenter(atom) {
  if (atom?.bbox) {
    return {
      cx: (atom.bbox.minX + atom.bbox.maxX) / 2,
      cy: (atom.bbox.minY + atom.bbox.maxY) / 2,
      h: atom.bbox.height || 0,
      w: atom.bbox.width || 0,
    };
  }
  return null;
}

// For each atom compute the median bbox-height of atoms within ±yWindow of it.
// Cached per call so we only sort once.
function buildLocalHeightLookup(rawWords, yWindow = 120) {
  const items = rawWords
    .map(w => ({ idx: w.idx, c: atomCenter(w) }))
    .filter(x => x.c)
    .sort((a, b) => a.c.cy - b.c.cy);
  const n = items.length;
  const lookup = new Map();
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    const cyi = items[i].c.cy;
    while (lo < n && items[lo].c.cy < cyi - yWindow) lo++;
    while (hi < n && items[hi].c.cy <= cyi + yWindow) hi++;
    const heights = [];
    for (let k = lo; k < hi; k++) {
      const h = items[k].c.h;
      if (h > 0) heights.push(h);
    }
    lookup.set(items[i].idx, heights.length ? median(heights) : 0);
  }
  return lookup;
}

function pageMedianHeight(rawWords) {
  const heights = rawWords
    .map(w => atomCenter(w)?.h || 0)
    .filter(h => h > 0);
  return heights.length ? median(heights) : 12;
}

/**
 * For every atom on the page that LOOKS like an ISA pattern element, replay the
 * vertical_isa lookup logic and report what happened.  Useful even when the
 * relaxed pass is off — it tells us whether bubble misses are caused by:
 *   - pattern mismatch (OCR text doesn't match exact \d{3,7})
 *   - geometry (prefix exists but Y or X out of range under STRICT thresholds)
 *   - missing prefix entirely (no atom looks like a code above)
 *
 * Reason codes:
 *   formed                    — at least one strict vertical_isa group already
 *                                  contains this mid (no problem)
 *   malformed_text            — mid pattern only matches LOOSE regex (e.g.
 *                                  trailing letter or dot), so strict pass
 *                                  ignores the atom
 *   no_prefix_in_range        — no UP candidate matching prefix pattern within
 *                                  the strict X tolerance and Y range
 *   prefix_too_far_y          — UP candidate exists at right X but Y > strict
 *                                  threshold
 *   prefix_too_far_x          — UP candidate exists at right Y but X offset >
 *                                  strict threshold (same column shift problem)
 *   no_suffix_but_prefix_ok   — strict prefix found, no suffix below (production
 *                                  allows this but reports it)
 */
export function explainVerticalMisses(rawWords, strictGroupAtoms = new Set(), opts = {}) {
  const pageMean = pageMedianHeight(rawWords);
  const localH = buildLocalHeightLookup(rawWords, 120);
  const strictAlignRatio = opts.strictAlignRatio ?? 1.2;
  const strictGapRatio   = opts.strictGapRatio   ?? 2.5;
  const reports = [];

  // Build a lookup of atom centers for fast nearest-by-Y queries.
  const indexed = rawWords
    .map(w => ({ atom: w, c: atomCenter(w) }))
    .filter(x => x.c);
  const byY = [...indexed].sort((a, b) => a.c.cy - b.c.cy);

  for (const { atom: mid, c: midC } of indexed) {
    const text = normalizeTag(mid.text);
    const matchesStrict = ISA_MID_RE.test(text);
    const matchesLoose  = ISA_MID_RE_LOOSE.test(text);
    if (!matchesStrict && !matchesLoose) continue;

    const localMean = Math.max(localH.get(mid.idx) || 0, pageMean);
    const alignTol = Math.max(localMean * strictAlignRatio, 6);
    const maxGapY  = Math.max(localMean * strictGapRatio,  16);

    // Already in a strict vertical_isa group?
    const inStrictGroup = strictGroupAtoms.has(mid.idx);
    if (inStrictGroup) {
      reports.push({ reason: 'formed', wordIndex: mid.idx, text: mid.text, midPosition_pct: mid.position_pct });
      continue;
    }
    if (!matchesStrict && matchesLoose) {
      reports.push({
        reason: 'malformed_text',
        wordIndex: mid.idx, text: mid.text, midPosition_pct: mid.position_pct,
        detail: `text "${text}" matches loose ISA pattern but not strict /^\\d{3,7}$/`,
      });
      continue;
    }

    // Look UP for a prefix candidate within Y-window (regardless of X) — this
    // tells us "is there a code-shaped atom above at all?"
    const yLo = midC.cy - (maxGapY * 1.6);
    const upCandidates = byY
      .filter(x => x.c.cy < midC.cy && x.c.cy >= yLo)
      .filter(x => isAllowedInstrumentPrefixToken(x.atom.text, { allowLoose: true }))
      .map(x => ({
        atom: x.atom,
        c: x.c,
        xOffset: Math.abs(x.c.cx - midC.cx),
        yGap: midC.cy - x.c.cy,
      }))
      .sort((a, b) => a.yGap - b.yGap);

    if (upCandidates.length === 0) {
      reports.push({
        reason: 'no_prefix_in_range',
        wordIndex: mid.idx, text: mid.text, midPosition_pct: mid.position_pct,
        detail: `no atom matching prefix pattern found above within Y${(maxGapY * 1.6).toFixed(0)}px`,
        thresholds: { alignTolPx: +alignTol.toFixed(1), maxGapYPx: +maxGapY.toFixed(1), localMeanH: +localMean.toFixed(1) },
      });
      continue;
    }

    // Find the closest geometrically-valid UP candidate
    const inXAndY = upCandidates.find(c => c.xOffset <= alignTol && c.yGap <= maxGapY * 1.6);
    if (inXAndY) {
      // Strict pass should have found this — if it didn't, it's because the
      // text doesn't match the STRICT prefix regex (must be exactly [A-Z]{2,5}).
      const prefixText = normalizeTag(inXAndY.atom.text);
      const strictPrefix = isAllowedInstrumentPrefixToken(prefixText, { allowLoose: false });
      reports.push({
        reason: strictPrefix ? 'no_suffix_but_prefix_ok' : 'prefix_text_loose',
        wordIndex: mid.idx, text: mid.text, midPosition_pct: mid.position_pct,
        candidatePrefix: { wordIndex: inXAndY.atom.idx, text: inXAndY.atom.text, position_pct: inXAndY.atom.position_pct, xOffsetPx: +inXAndY.xOffset.toFixed(1), yGapPx: +inXAndY.yGap.toFixed(1) },
        thresholds: { alignTolPx: +alignTol.toFixed(1), maxGapYPx: +maxGapY.toFixed(1), localMeanH: +localMean.toFixed(1) },
        detail: strictPrefix
          ? `prefix "${prefixText}" geometrically OK; vertical_isa probably built but suffix missing or score-pruned`
          : `prefix "${prefixText}" matches loose pattern but not strict /^[A-Z]{2,5}$/`,
      });
      continue;
    }

    // Pick the BEST UP candidate (closest by Y) and report the geometric reason.
    const best = upCandidates[0];
    const reason = best.xOffset > alignTol && best.yGap > maxGapY
      ? 'prefix_too_far_xy'
      : best.yGap > maxGapY
        ? 'prefix_too_far_y'
        : 'prefix_too_far_x';
    reports.push({
      reason,
      wordIndex: mid.idx, text: mid.text, midPosition_pct: mid.position_pct,
      candidatePrefix: { wordIndex: best.atom.idx, text: best.atom.text, position_pct: best.atom.position_pct, xOffsetPx: +best.xOffset.toFixed(1), yGapPx: +best.yGap.toFixed(1) },
      thresholds: { alignTolPx: +alignTol.toFixed(1), maxGapYPx: +maxGapY.toFixed(1), localMeanH: +localMean.toFixed(1) },
      detail: `nearest prefix candidate "${best.atom.text}" out of range: xOffset=${best.xOffset.toFixed(1)}px (allowed ${alignTol.toFixed(1)}px), yGap=${best.yGap.toFixed(1)}px (allowed ${maxGapY.toFixed(1)}px)`,
    });
  }

  // Aggregate counts per reason
  const counts = {};
  for (const r of reports) counts[r.reason] = (counts[r.reason] || 0) + 1;

  return { reports, counts };
}

/**
 * For every ISA-mid atom that ended up unpaired in a vertical group, look at
 * what OCR DID return inside the bubble region (mid bbox expanded ~30px up,
 * 15px sideways, 15px down).  Classify each unpaired mid as:
 *
 *   prefix_dropped              — no prefix-shaped atom anywhere in bubble area;
 *                                 OCR genuinely lost the prefix text.  Root cause
 *                                 is OCR layer (Vision API confidence/sensitivity).
 *
 *   prefix_returned_but_unpaired— prefix-shaped atom EXISTS within bubble area
 *                                 but the pairing logic didn't pick it (often
 *                                 because another mid won the prefix).  Root cause
 *                                 is algorithm.
 *
 *   noisy_atoms_only            — text exists in bubble area but it's garbled
 *                                 (Greek letters, single chars, OCR confusion).
 *                                 Likely OCR layer too.
 *
 *   isolated                    — number sits with no neighbouring text at all
 *                                 (could be page-edge or text outside ISA bubble
 *                                 convention).
 *
 * Returns { reports[], counts, byClassification, suggestedRepassRegions[] }.
 *
 * suggestedRepassRegions is a deduped list of bbox coordinates (in px and pct)
 * around every prefix_dropped/noisy_atoms_only mid — ready to feed into a
 * Vision API re-pass.
 */
export function buildOcrMissAudit(rawWords = [], pairedAtomSet = new Set(), opts = {}) {
  const xRadius = opts.xRadius ?? 90;     // sideways search around mid center
  const yAbove  = opts.yAbove  ?? 35;     // how far above the mid we expect prefix
  const yBelow  = opts.yBelow  ?? 25;     // how far below for suffix
  const reports = [];

  const indexed = rawWords
    .map(w => ({ atom: w, c: atomCenter(w) }))
    .filter(x => x.c);

  for (const { atom: mid, c: midC } of indexed) {
    const text = normalizeTag(mid.text);
    if (!ISA_MID_RE.test(text) && !ISA_MID_RE_LOOSE.test(text)) continue;
    if (pairedAtomSet.has(mid.idx)) continue;

    // Define the "bubble region" centered on the mid, biased upward (where the
    // prefix sits in the canonical ISA stack).
    const xLo = midC.cx - xRadius;
    const xHi = midC.cx + xRadius;
    const yLo = midC.cy - yAbove;
    const yHi = midC.cy + yBelow;

    const neighbors = indexed
      .filter(n => n.atom.idx !== mid.idx &&
        n.c.cx >= xLo && n.c.cx <= xHi &&
        n.c.cy >= yLo && n.c.cy <= yHi)
      .map(n => ({
        idx: n.atom.idx,
        text: n.atom.text,
        normText: normalizeTag(n.atom.text),
        cx: n.c.cx, cy: n.c.cy,
        xOff: n.c.cx - midC.cx,
        yOff: n.c.cy - midC.cy,
        confidence: n.atom.confidence,
        looksLikePrefix: isAllowedInstrumentPrefixToken(n.atom.text, { allowLoose: true }),
        looksLikeSuffix: ISA_SUFFIX_RE_LOOSE.test(normalizeTag(n.atom.text)) && !ISA_SUFFIX_STOP.has(normalizeTag(n.atom.text)),
        isAbove: n.c.cy < midC.cy,
        isBelow: n.c.cy > midC.cy,
      }))
      .sort((a, b) => Math.abs(a.yOff) + Math.abs(a.xOff) - (Math.abs(b.yOff) + Math.abs(b.xOff)));

    const prefixCandidates = neighbors.filter(n => n.isAbove && n.looksLikePrefix);
    const suffixCandidates = neighbors.filter(n => n.isBelow && n.looksLikeSuffix);
    const aboveAny = neighbors.filter(n => n.isAbove);
    const belowAny = neighbors.filter(n => n.isBelow);

    let classification;
    let detail;
    if (prefixCandidates.length > 0) {
      classification = 'prefix_returned_but_unpaired';
      const best = prefixCandidates[0];
      detail = `prefix "${best.normText}" found at xOff=${best.xOff.toFixed(0)}px / yOff=${best.yOff.toFixed(0)}px but pairing didn't claim it (probably won by another mid)`;
    } else if (aboveAny.length > 0) {
      classification = 'noisy_atoms_only';
      const top = aboveAny.slice(0, 3).map(n => `"${n.text}"@(${n.xOff.toFixed(0)},${n.yOff.toFixed(0)})`).join(', ');
      detail = `${aboveAny.length} text atom(s) above but none match prefix pattern: ${top}`;
    } else {
      classification = 'prefix_dropped';
      detail = `no text atoms found in bubble region (X±${xRadius}, Y -${yAbove}..+${yBelow}) above the number — OCR did not return any prefix`;
    }

    if (classification === 'prefix_dropped' && belowAny.length === 0 && aboveAny.length === 0) {
      classification = 'isolated';
      detail = 'no neighbouring text within bubble region — atom is isolated';
    }

    reports.push({
      midWordIndex: mid.idx,
      midText: mid.text,
      midPosition_pct: mid.position_pct,
      midPosition_px: mid.position_px,
      midCoords: { cx: midC.cx, cy: midC.cy, h: midC.h },
      classification,
      detail,
      bubbleRegion_px: { x: xLo, y: yLo, w: xHi - xLo, h: yHi - yLo },
      neighborsAbove: aboveAny.slice(0, 5),
      neighborsBelow: belowAny.slice(0, 3),
      bestPrefixCandidate: prefixCandidates[0] || null,
      bestSuffixCandidate: suffixCandidates[0] || null,
    });
  }

  const counts = {};
  for (const r of reports) counts[r.classification] = (counts[r.classification] || 0) + 1;

  const byClassification = {};
  for (const r of reports) {
    if (!byClassification[r.classification]) byClassification[r.classification] = [];
    byClassification[r.classification].push(r);
  }

  // Build dedup'd region list ready to feed into a Vision API re-pass.
  // We only suggest regions for classifications that look like OCR-layer fails.
  const suggestedRepassRegions = [];
  for (const r of reports) {
    if (r.classification !== 'prefix_dropped' && r.classification !== 'noisy_atoms_only') continue;
    suggestedRepassRegions.push({
      midWordIndex: r.midWordIndex,
      midText: r.midText,
      reason: r.classification,
      region_px: r.bubbleRegion_px,
    });
  }

  return { reports, counts, byClassification, suggestedRepassRegions };
}

/**
 * Run a relaxed copy of WordGrouper's vertical_isa pass, using LOCAL median
 * height instead of page-wide mean and tolerating common OCR variations.
 * Produces groups with source='vertical_relaxed'.
 */
export function runVerticalRelaxed(rawWords, opts = {}) {
  const pageMean = pageMedianHeight(rawWords);
  const localH = buildLocalHeightLookup(rawWords, 120);
  const alignRatio = opts.alignRatio ?? 2.5;
  const gapRatio   = opts.gapRatio   ?? 4.0;

  const indexed = rawWords
    .map(w => ({ atom: w, c: atomCenter(w) }))
    .filter(x => x.c);
  const byY = [...indexed].sort((a, b) => a.c.cy - b.c.cy);

  const mids = indexed.filter(x => ISA_MID_RE_LOOSE.test(normalizeTag(x.atom.text)));
  const groups = [];

  for (const { atom: mid, c: midC } of mids) {
    const localMean = Math.max(localH.get(mid.idx) || 0, pageMean * 0.8);
    const alignTol = Math.max(localMean * alignRatio, 18);
    const maxGapY  = Math.max(localMean * gapRatio,  40);

    // Look up for prefix
    const upCandidates = byY
      .filter(x => x.atom.idx !== mid.idx && x.c.cy < midC.cy)
      .filter(x => (midC.cy - x.c.cy) <= maxGapY)
      .filter(x => Math.abs(x.c.cx - midC.cx) <= alignTol)
      .filter(x => isAllowedInstrumentPrefixToken(x.atom.text, { allowLoose: true }))
      .map(x => ({
        atom: x.atom, c: x.c,
        xOffset: Math.abs(x.c.cx - midC.cx),
        yGap: midC.cy - x.c.cy,
        score: 0,
      }));
    if (!upCandidates.length) continue;
    // Score: closer X + closer Y wins; also prefer text that's a known ISA family
    for (const c of upCandidates) {
      const familyBoost = /^(XS|XA|ZLC|ZLO|ZSC|PSL|PSH|PSV|LSL|LSH|TSH|TSL|FE|FT|PT|TT|TW|TG|HS|HV|PG|PI|TI|LI|LT|FI|FY|FY|LIT|PIT|FIT|TIT|VHP|LAL|LAH|PAL|PAH|TAH|TAL|VHV|VLV|CSO|CSC|CEM|CI)$/.test(normalizeTag(c.atom.text)) ? 0.3 : 0;
      c.score = (1 - c.xOffset / Math.max(1, alignTol)) * 0.55 + (1 - c.yGap / Math.max(1, maxGapY)) * 0.45 + familyBoost;
    }
    upCandidates.sort((a, b) => b.score - a.score);
    const bestPrefix = upCandidates[0];

    // Look down for suffix (optional)
    const downCandidates = byY
      .filter(x => x.atom.idx !== mid.idx && x.c.cy > midC.cy)
      .filter(x => (x.c.cy - midC.cy) <= maxGapY)
      .filter(x => Math.abs(x.c.cx - midC.cx) <= alignTol * 1.1)
      .filter(x => {
        const t = normalizeTag(x.atom.text);
        return ISA_SUFFIX_RE_LOOSE.test(t) && !ISA_SUFFIX_STOP.has(t);
      })
      .map(x => ({
        atom: x.atom, c: x.c,
        xOffset: Math.abs(x.c.cx - midC.cx),
        yGap: x.c.cy - midC.cy,
      }))
      .sort((a, b) => a.yGap - b.yGap);
    const bestSuffix = downCandidates[0] || null;

    const triple = bestSuffix ? [bestPrefix.atom, mid, bestSuffix.atom] : [bestPrefix.atom, mid];
    const indices = triple.map(a => a.idx);
    const verts = triple.map(a => a.vertices).filter(Boolean);
    const merged = mergeVerticesArrays(verts);
    const conf = safeAvg(triple.map(a => a.confidence).filter(Number.isFinite));
    const text = [normalizeTag(bestPrefix.atom.text), normalizeTag(mid.text), bestSuffix ? normalizeTag(bestSuffix.atom.text) : null]
      .filter(Boolean).join('-');

    groups.push({
      text,
      confidence: conf || null,
      vertices: merged,
      source: 'vertical_relaxed',
      assemblyRule: bestSuffix ? 'vertical_relaxed_v1' : 'vertical_relaxed_v1:no_suffix',
      assemblyScore: +bestPrefix.score.toFixed(3),
      marginToRunnerUp: upCandidates[1] ? +(bestPrefix.score - upCandidates[1].score).toFixed(3) : 1,
      competingPrefixCount: upCandidates.length,
      isBestHypothesis: true,
      anchorWordIndex: mid.idx,
      wordCount: indices.length,
      componentWordIndices: indices,
    });
  }
  return groups;
}

// ─── User labels (atom-role feedback loop) ───────────────────────────────────
//
// User-labelled atoms are the ground-truth primitive for the feedback loop.
// Each label records: { atomIdx, role, text }. Roles:
//   prefix         — top of an ISA bubble (e.g. XS, ZSC)
//   mid            — loop number in middle of an ISA bubble (e.g. 289910)
//   suffix         — bottom of an ISA bubble (e.g. A, A1)
//   line_tag       — part of a horizontal line tag (e.g. 8"-H-28-12-…)
//   equipment_tag  — equipment identifier (e.g. V-1234)
//   noise          — junk atom, never group it
//
// Label semantics applied here:
//   1. NOISE EXCLUSION — any group containing a noise atom is dropped
//      (the noise atom itself is also force-removed from singleton groups).
//   2. CONTRADICTION INVALIDATION — for vertical-source groups
//      (vertical_paired/_isa/_relaxed), each member's slot (top/mid/bottom by
//      Y-center) must be consistent with its label.  Mismatch => group dropped.
//      Equipment_tag and line_tag inside a vertical group is also a mismatch.
//   3. FORCED PAIRING — every labelled prefix paired with the closest labelled
//      mid below it (within ±90px X, 4–80px Y).  Optional labelled suffix below
//      the mid.  Result: a synthetic group with source='vertical_paired_user'
//      that supersedes any other group claiming those atoms.
//
// Labels are advisory.  Only labelled atoms see their group decisions changed;
// the rest of the page is untouched.  This keeps the feedback loop predictable
// and reversible — clearing all labels returns the user to the baseline output.

const VALID_ROLES = new Set(['prefix', 'mid', 'suffix', 'line_tag', 'equipment_tag', 'noise']);

function indexLabels(userLabels = []) {
  const byIdx = new Map();
  for (const l of (Array.isArray(userLabels) ? userLabels : [])) {
    const idx = Number(l?.atomIdx);
    const role = String(l?.role || '').toLowerCase();
    if (!Number.isFinite(idx) || !VALID_ROLES.has(role)) continue;
    byIdx.set(idx, role);
  }
  return byIdx;
}

function classifyVerticalGroupSlots(group, rawWords) {
  // Returns Map<atomIdx, 'top'|'middle'|'bottom'> by sorting members by Y-center.
  const wis = (group.componentWordIndices || []).slice();
  if (wis.length < 2) return new Map();
  const ranked = wis
    .map(i => ({ i, c: atomCenter(rawWords[i]) }))
    .filter(x => x.c)
    .sort((a, b) => a.c.cy - b.c.cy);
  if (ranked.length < 2) return new Map();
  const out = new Map();
  out.set(ranked[0].i, 'top');
  out.set(ranked[ranked.length - 1].i, ranked.length > 2 ? 'bottom' : 'bottom');
  for (let k = 1; k < ranked.length - 1; k++) out.set(ranked[k].i, 'middle');
  if (ranked.length === 2) {
    // 2-atom vertical: top=prefix, bottom=mid (no middle)
    out.set(ranked[0].i, 'top');
    out.set(ranked[1].i, 'middle'); // mid expected at bottom slot in 2-atom case
  }
  return out;
}

function isVerticalSource(src) {
  return src === 'vertical_paired' || src === 'vertical_paired_user' ||
         src === 'vertical_isa' || src === 'vertical_relaxed';
}

function groupContradictsLabels(group, rawWords, labelByIdx) {
  const wis = group.componentWordIndices || [];
  if (!wis.length) return false;

  // Rule 1: any noise member invalidates the group
  for (const i of wis) {
    if (labelByIdx.get(i) === 'noise') return true;
  }

  // Rule 2: vertical-source groups must have label-slot consistency
  if (isVerticalSource(group.source) && wis.length >= 2) {
    const slotMap = classifyVerticalGroupSlots(group, rawWords);
    for (const i of wis) {
      const role = labelByIdx.get(i);
      if (!role) continue;
      const slot = slotMap.get(i);
      if (role === 'line_tag' || role === 'equipment_tag') return true; // wrong context
      if (role === 'prefix' && slot !== 'top') return true;
      if (role === 'suffix' && slot !== 'bottom') return true;
      if (role === 'mid' && slot === 'top') return true;
    }
  }

  // Rule 3: horizontal/structured/line_assembler groups should not contain
  // atoms labelled as prefix/mid/suffix (which belong to ISA bubbles, not
  // horizontal line text).  Equipment_tag inside a horizontal line tag is
  // ambiguous — leave it alone.
  if (group.source === 'horizontal' || group.source === 'structured_row' || group.source === 'line_assembler') {
    for (const i of wis) {
      const role = labelByIdx.get(i);
      if (role === 'prefix' || role === 'mid' || role === 'suffix') return true;
    }
  }

  return false;
}

function buildForcedUserPairs(rawWords, labelByIdx) {
  // Find every labelled prefix.  For each, pair with the closest labelled mid
  // located below it within geometric tolerance.  Optionally attach a labelled
  // suffix sitting below the mid.
  const prefixes = [];
  const mids = [];
  const suffixes = [];
  for (const [idx, role] of labelByIdx.entries()) {
    const c = atomCenter(rawWords[idx]);
    if (!c) continue;
    const entry = { idx, c };
    if (role === 'prefix') prefixes.push(entry);
    else if (role === 'mid') mids.push(entry);
    else if (role === 'suffix') suffixes.push(entry);
  }
  if (!prefixes.length || !mids.length) return [];

  const X_TOL = 110;     // generous: dense bubble rows shift atoms sideways
  const Y_MIN = 4;
  const Y_MAX = 90;

  const usedMids = new Set();
  const usedSuffixes = new Set();
  const pairs = [];

  // Sort prefixes by Y so top-row prefixes pair first (they have first pick of mids).
  const sortedPrefixes = [...prefixes].sort((a, b) => a.c.cy - b.c.cy);

  for (const p of sortedPrefixes) {
    let bestMid = null;
    let bestCost = Infinity;
    for (const m of mids) {
      if (usedMids.has(m.idx)) continue;
      const yGap = m.c.cy - p.c.cy;
      if (yGap < Y_MIN || yGap > Y_MAX) continue;
      const xOff = Math.abs(m.c.cx - p.c.cx);
      if (xOff > X_TOL) continue;
      const cost = xOff + 0.5 * yGap;
      if (cost < bestCost) { bestCost = cost; bestMid = m; }
    }
    if (!bestMid) continue;
    usedMids.add(bestMid.idx);

    // Optional suffix
    let bestSuffix = null;
    let bestSuffixCost = Infinity;
    for (const s of suffixes) {
      if (usedSuffixes.has(s.idx)) continue;
      const yGap = s.c.cy - bestMid.c.cy;
      if (yGap < Y_MIN || yGap > Y_MAX) continue;
      const xOff = Math.abs(s.c.cx - bestMid.c.cx);
      if (xOff > X_TOL) continue;
      const cost = xOff + 0.5 * yGap;
      if (cost < bestSuffixCost) { bestSuffixCost = cost; bestSuffix = s; }
    }
    if (bestSuffix) usedSuffixes.add(bestSuffix.idx);

    pairs.push({
      prefixIdx: p.idx,
      midIdx: bestMid.idx,
      suffixIdx: bestSuffix?.idx ?? -1,
      cost: bestCost,
    });
  }
  return pairs;
}

function applyUserLabels(groups, rawWords, userLabels, pageWidth, pageHeight) {
  const labelByIdx = indexLabels(userLabels);
  if (labelByIdx.size === 0) {
    return {
      groups,
      impact: {
        applied: false,
        labelCount: 0,
        groupsDroppedNoise: 0,
        groupsDroppedContradiction: 0,
        groupsForcedAdded: 0,
        atomsLabelled: 0,
        noiseAtomCount: 0,
      },
    };
  }

  const noiseAtomCount = [...labelByIdx.values()].filter(r => r === 'noise').length;
  let droppedNoise = 0;
  let droppedContradiction = 0;

  // Step 1+2: drop groups invalidated by labels
  const survivors = [];
  for (const g of groups) {
    const hasNoise = (g.componentWordIndices || []).some(i => labelByIdx.get(i) === 'noise');
    if (hasNoise) { droppedNoise += 1; continue; }
    if (groupContradictsLabels(g, rawWords, labelByIdx)) {
      droppedContradiction += 1;
      continue;
    }
    survivors.push(g);
  }

  // Step 3: build forced user pairings, replacing any survivor groups that
  // claim those atoms (so the user choice always wins).
  const forcedPairs = buildForcedUserPairs(rawWords, labelByIdx);
  const claimedByForced = new Set();
  for (const p of forcedPairs) {
    claimedByForced.add(p.prefixIdx);
    claimedByForced.add(p.midIdx);
    if (p.suffixIdx >= 0) claimedByForced.add(p.suffixIdx);
  }

  // Drop any survivor whose membership overlaps a forced atom (the user has
  // explicitly chosen a different pairing for that atom).
  const finalSurvivors = survivors.filter(g => {
    if ((g.wordCount || 1) < 2) {
      // Singletons are kept but excluded if they ARE the forced atom (it'll be
      // re-emitted as part of the synthetic group).
      const wi = (g.componentWordIndices || [])[0];
      return !claimedByForced.has(wi);
    }
    return !(g.componentWordIndices || []).some(i => claimedByForced.has(i));
  });

  // Build synthetic vertical_paired_user groups for the forced pairs.
  const syntheticGroups = [];
  for (const p of forcedPairs) {
    const wis = p.suffixIdx >= 0 ? [p.prefixIdx, p.midIdx, p.suffixIdx] : [p.prefixIdx, p.midIdx];
    const verts = wis.map(i => rawWords[i]?.vertices).filter(Boolean);
    const merged = mergeVerticesArrays(verts);
    const conf = safeAvg(wis.map(i => rawWords[i]?.confidence).filter(Number.isFinite));
    const text = wis.map(i => normalizeTag(rawWords[i]?.text || '')).filter(Boolean).join('-');
    const pct = merged ? verticesToPct(merged, pageWidth, pageHeight) : null;
    const px  = merged ? verticesToPixels(merged) : null;
    syntheticGroups.push({
      text,
      source: 'vertical_paired_user',
      assemblyRule: 'user_label:forced_pair',
      assemblyScore: 1,
      marginToRunnerUp: 1,
      competingPrefixCount: 1,
      isBestHypothesis: true,
      anchorWordIndex: p.midIdx,
      wordCount: wis.length,
      componentWordIndices: wis,
      vertices: merged,
      confidence: conf || null,
      bbox: bboxFromVertices(merged),
      position_pct: pct,
      position_px: px,
    });
  }

  return {
    groups: [...finalSurvivors, ...syntheticGroups],
    impact: {
      applied: true,
      labelCount: labelByIdx.size,
      atomsLabelled: labelByIdx.size,
      noiseAtomCount,
      groupsDroppedNoise: droppedNoise,
      groupsDroppedContradiction: droppedContradiction,
      groupsForcedAdded: syntheticGroups.length,
    },
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

export function runGroupingDiagnostic(rawWords = [], options = {}) {
  const pageWidth = Number(options.pageWidth || 2400);
  const pageHeight = Number(options.pageHeight || 1700);
  const groupingOptions = {
    ...DEFAULT_DIAGNOSTIC_OPTIONS,
    ...(options.groupingOverrides || {}),
  };
  const horizontalStoppers = (options.horizontalStoppers || []).filter(s => STOPPER_NAMES.has(s));
  const arbitrationMode = ARBITRATION_MODES.has(options.arbitration) ? options.arbitration : 'none';
  const symbolRegions = Array.isArray(options.symbolRegions) ? options.symbolRegions : [];

  const startedAt = Date.now();

  // Preserve atom index for stable downstream conflict detection.
  const indexedRawWords = (Array.isArray(rawWords) ? rawWords : []).map((w, idx) => ({
    ...w,
    __rawIndex: idx,
  }));

  const enrichedRaw = indexedRawWords.map((w, idx) => {
    const bbox = bboxFromVertices(w.vertices);
    const pct = w.vertices ? verticesToPct(w.vertices, pageWidth, pageHeight) : null;
    const px  = w.vertices ? verticesToPixels(w.vertices) : null;
    return {
      idx,
      text: String(w.text || ''),
      confidence: Number.isFinite(w.confidence) ? w.confidence : null,
      vertices: w.vertices || null,
      bbox,
      position_pct: pct,
      position_px: px,
      provider: w.provider || null,
    };
  });

  let baseGroups = [];
  let groupingError = null;
  try {
    baseGroups = groupAdjacentWords(indexedRawWords, groupingOptions) || [];
  } catch (err) {
    groupingError = String(err?.message || err);
  }

  // Optional: relaxed vertical pass — adds candidates with source='vertical_relaxed'
  // BEFORE stoppers/arbitration so downstream arbitration can pick the better hypothesis
  // when both strict and relaxed produce the same bubble.
  if (options.verticalRelaxed) {
    try {
      const relaxed = runVerticalRelaxed(enrichedRaw, options.verticalRelaxedOpts || {});
      // Convert relaxed groups to the same shape as production groups
      for (const g of relaxed) baseGroups.push(g);
    } catch (err) {
      groupingError = (groupingError ? groupingError + ' | ' : '') + 'verticalRelaxed: ' + String(err?.message || err);
    }
  }

  // Enrich each candidate group up-front (id, position_pct, gap stats…)
  let enriched = baseGroups.map((g, gid) => {
    const componentWordIndices = Array.isArray(g.componentWordIndices) ? g.componentWordIndices : [];
    const pct = g.vertices ? verticesToPct(g.vertices, pageWidth, pageHeight) : null;
    const px  = g.vertices ? verticesToPixels(g.vertices) : null;
    const bbox = bboxFromVertices(g.vertices);
    const base = {
      id: gid,
      text: String(g.text || ''),
      confidence: Number.isFinite(g.confidence) ? +g.confidence.toFixed(4) : null,
      source: String(g.source || 'unknown'),
      assemblyRule: g.assemblyRule || null,
      assemblyScore: Number.isFinite(g.assemblyScore) ? +Number(g.assemblyScore).toFixed(4) : null,
      marginToRunnerUp: Number.isFinite(g.marginToRunnerUp) ? +Number(g.marginToRunnerUp).toFixed(4) : null,
      competingPrefixCount: Number.isFinite(g.competingPrefixCount) ? Number(g.competingPrefixCount) : null,
      isBestHypothesis: g.isBestHypothesis === true,
      anchorWordIndex: Number.isFinite(g.anchorWordIndex) ? Number(g.anchorWordIndex) : null,
      ocrVariantOf: g.ocrVariantOf || null,
      wordCount: Array.isArray(componentWordIndices) ? componentWordIndices.length : (g.wordCount || 1),
      componentWordIndices,
      vertices: g.vertices || null,
      bbox,
      position_pct: pct,
      position_px: px,
    };
    const gapStats = computeChainGapStats(base, enrichedRaw);
    return { ...base, ...gapStats };
  });

  const baselineStats = summarizeStats(enriched, enrichedRaw);

  // Apply horizontal stoppers (post-filter on horizontal pass)
  let stoppersApplied = [];
  if (horizontalStoppers.length) {
    const res = applyHorizontalStoppers(enriched, enrichedRaw, { horizontalStoppers, symbolRegions });
    enriched = finalizeRebuilds(res.groups, enrichedRaw, pageWidth, pageHeight);
    // Re-id after rebuilds
    enriched = enriched.map((g, gid) => ({
      ...g,
      id: gid,
      ...computeChainGapStats(g, enrichedRaw),
    }));
    stoppersApplied = res.applied;
  }
  // Always-on safety split for pure numeric over-merges.
  const numericGuard = splitPureNumericChains(enriched, enrichedRaw);
  if (numericGuard.splitCount > 0) {
    enriched = finalizeRebuilds(numericGuard.groups, enrichedRaw, pageWidth, pageHeight);
    enriched = enriched.map((g, gid) => ({
      ...g,
      id: gid,
      ...computeChainGapStats(g, enrichedRaw),
    }));
  }
  const afterStoppersStats = summarizeStats(enriched, enrichedRaw);

  // Bipartite vertical pairing (default ON, can be disabled for comparison).
  // Replaces vertical_isa + vertical_relaxed candidates with 1-to-1 pairings,
  // eliminating the "same-prefix-claims-multiple-mids" defect that was orphaning
  // numbers in tight bubble rows (DHSV/SSV).  Re-id and re-stat after.
  const bipartiteEnabled = options.bipartiteVerticalPairing !== false;
  const bipartiteIncludeRelaxed = options.bipartiteIncludeRelaxed === true;
  if (bipartiteEnabled) {
    enriched = applyBipartiteVerticalPairing(enriched, enrichedRaw, {
      includeRelaxedMids: bipartiteIncludeRelaxed,
    });
    enriched = finalizeRebuilds(enriched, enrichedRaw, pageWidth, pageHeight);
    enriched = enriched.map((g, gid) => ({
      ...g,
      id: gid,
      ...computeChainGapStats(g, enrichedRaw),
    }));
  }
  const afterBipartiteStats = summarizeStats(enriched, enrichedRaw);

  // ─── User-label feedback pass ──────────────────────────────────────────
  // Applied AFTER bipartite (so we let the algorithm finish its best guess
  // first) but BEFORE arbitration (so synthetic user pairs participate in
  // the final per-atom contention).  Labels are advisory: a drawing with no
  // labels behaves identically to before this pass existed.
  const userLabels = Array.isArray(options.userLabels) ? options.userLabels : [];
  const labelResult = applyUserLabels(enriched, enrichedRaw, userLabels, pageWidth, pageHeight);
  enriched = labelResult.groups;
  enriched = finalizeRebuilds(enriched, enrichedRaw, pageWidth, pageHeight);
  enriched = enriched.map((g, gid) => ({
    ...g,
    id: gid,
    ...computeChainGapStats(g, enrichedRaw),
  }));
  const afterLabelsStats = summarizeStats(enriched, enrichedRaw);

  // Apply arbitration
  let finalGroups = enriched;
  if (arbitrationMode !== 'none') {
    finalGroups = applyArbitration(enriched, enrichedRaw, arbitrationMode);
    finalGroups = finalizeRebuilds(finalGroups, enrichedRaw, pageWidth, pageHeight);
    finalGroups = finalGroups.map((g, gid) => ({
      ...g,
      id: gid,
      ...computeChainGapStats(g, enrichedRaw),
    }));
  }
  const finalStats = summarizeStats(finalGroups, enrichedRaw);

  // wordIdx → [groupId, ...]
  const wordToGroupIds = {};
  for (const g of finalGroups) {
    for (const wi of g.componentWordIndices) {
      if (!wordToGroupIds[wi]) wordToGroupIds[wi] = [];
      wordToGroupIds[wi].push(g.id);
    }
  }
  const ungroupedWordIndices = [];
  for (let idx = 0; idx < enrichedRaw.length; idx++) {
    const groupIds = wordToGroupIds[idx] || [];
    const inMultiWordGroup = groupIds.some(gid => (finalGroups[gid]?.wordCount || 1) > 1);
    if (!inMultiWordGroup) ungroupedWordIndices.push(idx);
  }
  const conflicts = [];
  for (const [wiStr, groupIds] of Object.entries(wordToGroupIds)) {
    const wi = Number(wiStr);
    const multiGroupIds = groupIds.filter(gid => (finalGroups[gid]?.wordCount || 1) > 1);
    if (multiGroupIds.length >= 2) {
      conflicts.push({
        wordIndex: wi,
        wordText: enrichedRaw[wi]?.text || '',
        wordPosition_pct: enrichedRaw[wi]?.position_pct || null,
        groupIds: multiGroupIds,
        groupTexts: multiGroupIds.map(gid => finalGroups[gid]?.text || ''),
        groupSources: multiGroupIds.map(gid => finalGroups[gid]?.source || ''),
      });
    }
  }

  // Vertical-miss explainer — runs against STRICT vertical_isa membership only,
  // so it tells us why the production WordGrouper.js failed to form bubbles
  // (regardless of whether the relaxed pass rescued them).
  const strictVerticalAtoms = new Set();
  for (const g of finalGroups) {
    if (g.source === 'vertical_isa') for (const i of (g.componentWordIndices || [])) strictVerticalAtoms.add(i);
  }
  let verticalMisses = { reports: [], counts: {} };
  try {
    verticalMisses = explainVerticalMisses(enrichedRaw, strictVerticalAtoms);
  } catch (err) {
    verticalMisses = { reports: [], counts: {}, error: String(err?.message || err) };
  }

  // OCR-miss audit — for every ISA-mid atom that ended up unpaired, classify
  // whether the OCR layer dropped the prefix or whether the algorithm rejected
  // a returned prefix.  Computed against the FINAL group set so it reflects
  // the actual outcome the user sees on screen.
  const finalPairedAtoms = new Set();
  for (const g of finalGroups) {
    if ((g.wordCount || 1) > 1) for (const i of (g.componentWordIndices || [])) finalPairedAtoms.add(i);
  }
  let ocrMissAudit = { reports: [], counts: {}, byClassification: {}, suggestedRepassRegions: [] };
  try {
    ocrMissAudit = buildOcrMissAudit(enrichedRaw, finalPairedAtoms);
  } catch (err) {
    ocrMissAudit = { reports: [], counts: {}, byClassification: {}, suggestedRepassRegions: [], error: String(err?.message || err) };
  }

  return {
    schemaVersion: 3,
    diagnostic: true,
    pageWidth,
    pageHeight,
    groupingOptions,
    appliedStoppers: stoppersApplied,
    numericGuardSplitCount: numericGuard.splitCount,
    arbitration: arbitrationMode,
    verticalRelaxed: !!options.verticalRelaxed,
    groupingError,
    runtimeMs: Date.now() - startedAt,
    rawWords: enrichedRaw,
    groups: finalGroups,
    wordToGroupIds,
    ungroupedWordIndices,
    conflicts,
    stats: finalStats.stats,
    sourceBreakdown: finalStats.sourceBreakdown,
    pipeline: {
      baseline: baselineStats.stats,
      afterStoppers: afterStoppersStats.stats,
      afterBipartite: afterBipartiteStats.stats,
      afterLabels: afterLabelsStats.stats,
      final: finalStats.stats,
    },
    bipartiteVerticalPairing: bipartiteEnabled,
    bipartiteIncludeRelaxed,
    verticalMisses,
    ocrMissAudit,
    userLabels,
    labelImpact: labelResult.impact,
    generatedAt: new Date().toISOString(),
  };
}

function summarizeStats(groups, enrichedRaw) {
  const totalAtoms = enrichedRaw.length;
  const wordToGroupIds = {};
  for (const g of groups) {
    for (const wi of (g.componentWordIndices || [])) {
      if (!wordToGroupIds[wi]) wordToGroupIds[wi] = [];
      wordToGroupIds[wi].push(g.id);
    }
  }
  let ungrouped = 0;
  for (let idx = 0; idx < totalAtoms; idx++) {
    const ids = wordToGroupIds[idx] || [];
    if (!ids.some(gid => (groups[gid]?.wordCount || 1) > 1)) ungrouped++;
  }
  let conflictAtoms = 0;
  for (const ids of Object.values(wordToGroupIds)) {
    const multi = ids.filter(gid => (groups[gid]?.wordCount || 1) > 1);
    if (multi.length >= 2) conflictAtoms++;
  }
  const sourceMap = {};
  for (const g of groups) {
    const src = g.source || 'unknown';
    if (!sourceMap[src]) sourceMap[src] = {
      source: src, groupCount: 0, multiWordCount: 0, atomsCovered: new Set(),
      confidences: [], assemblyScores: [], marginsToRunnerUp: [], maxGapsPx: [],
    };
    const slot = sourceMap[src];
    slot.groupCount += 1;
    if ((g.wordCount || 1) > 1) slot.multiWordCount += 1;
    for (const wi of (g.componentWordIndices || [])) slot.atomsCovered.add(wi);
    if (g.confidence != null) slot.confidences.push(g.confidence);
    if (g.assemblyScore != null) slot.assemblyScores.push(g.assemblyScore);
    if (g.marginToRunnerUp != null) slot.marginsToRunnerUp.push(g.marginToRunnerUp);
    if (Number.isFinite(g.maxGapPx)) slot.maxGapsPx.push(g.maxGapPx);
  }
  const sourceBreakdown = Object.values(sourceMap).map(s => ({
    source: s.source,
    groupCount: s.groupCount,
    multiWordCount: s.multiWordCount,
    atomsCovered: s.atomsCovered.size,
    meanConfidence: safeAvg(s.confidences),
    meanAssemblyScore: safeAvg(s.assemblyScores),
    meanMarginToRunnerUp: safeAvg(s.marginsToRunnerUp),
    meanMaxGapPx: safeAvg(s.maxGapsPx),
  })).sort((a, b) => b.groupCount - a.groupCount);
  const wordCountHistogram = {};
  for (const g of groups) {
    const k = (g.wordCount || 1) > 6 ? '7+' : String(g.wordCount || 1);
    wordCountHistogram[k] = (wordCountHistogram[k] || 0) + 1;
  }
  return {
    stats: {
      totalRawWords: totalAtoms,
      totalGroups: groups.length,
      multiWordGroups: groups.filter(g => (g.wordCount || 1) > 1).length,
      singleWordGroups: groups.filter(g => (g.wordCount || 1) === 1).length,
      ungroupedAtoms: ungrouped,
      atomsInMultiWordGroup: totalAtoms - ungrouped,
      coveragePct: totalAtoms > 0 ? +(((totalAtoms - ungrouped) / totalAtoms) * 100).toFixed(2) : 0,
      conflictAtoms,
      wordCountHistogram,
    },
    sourceBreakdown,
  };
}

export function groupingDiagnosticToCsv(diag) {
  const header = [
    'group_id', 'text', 'source', 'assembly_rule', 'word_count', 'confidence',
    'assembly_score', 'margin_to_runner_up', 'competing_prefix_count',
    'is_best_hypothesis', 'anchor_word_index', 'ocr_variant_of',
    'median_gap_px', 'max_gap_px',
    'x_pct', 'y_pct', 'w_pct', 'h_pct',
    'component_word_indices', 'component_atom_texts',
  ];
  const lines = [header.join(',')];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const atomsByIdx = new Map();
  for (const a of (diag.rawWords || [])) atomsByIdx.set(a.idx, a.text);
  for (const g of (diag.groups || [])) {
    const atomTexts = (g.componentWordIndices || []).map(i => atomsByIdx.get(i) || '').join('|');
    lines.push([
      g.id, g.text, g.source, g.assemblyRule || '', g.wordCount,
      g.confidence ?? '', g.assemblyScore ?? '', g.marginToRunnerUp ?? '',
      g.competingPrefixCount ?? '', g.isBestHypothesis ? '1' : '0',
      g.anchorWordIndex ?? '', g.ocrVariantOf || '',
      g.medianGapPx ?? '', g.maxGapPx ?? '',
      g.position_pct?.x_pct ?? '', g.position_pct?.y_pct ?? '',
      g.position_pct?.w_pct ?? '', g.position_pct?.h_pct ?? '',
      (g.componentWordIndices || []).join('|'), atomTexts,
    ].map(escape).join(','));
  }

  // Section 2: OCR-miss audit (one row per unpaired ISA-mid report)
  lines.push('');
  lines.push('section,ocr_miss_audit');
  const auditHeader = [
    'classification',
    'mid_word_index',
    'mid_text',
    'detail',
    'mid_x_pct',
    'mid_y_pct',
    'mid_w_pct',
    'mid_h_pct',
    'region_x_px',
    'region_y_px',
    'region_w_px',
    'region_h_px',
    'best_prefix_idx',
    'best_prefix_text',
    'best_prefix_x_off_px',
    'best_prefix_y_off_px',
    'suggest_repass',
  ];
  lines.push(auditHeader.join(','));
  const suggested = new Set(
    (diag?.ocrMissAudit?.suggestedRepassRegions || [])
      .map(r => Number(r?.midWordIndex))
      .filter(Number.isFinite),
  );
  for (const r of (diag?.ocrMissAudit?.reports || [])) {
    const suggest = suggested.has(Number(r.midWordIndex)) ? '1' : '0';
    lines.push([
      r.classification || '',
      r.midWordIndex ?? '',
      r.midText || '',
      r.detail || '',
      r.midPosition_pct?.x_pct ?? '',
      r.midPosition_pct?.y_pct ?? '',
      r.midPosition_pct?.w_pct ?? '',
      r.midPosition_pct?.h_pct ?? '',
      r.bubbleRegion_px?.x ?? '',
      r.bubbleRegion_px?.y ?? '',
      r.bubbleRegion_px?.w ?? '',
      r.bubbleRegion_px?.h ?? '',
      r.bestPrefixCandidate?.idx ?? '',
      r.bestPrefixCandidate?.text ?? '',
      r.bestPrefixCandidate?.xOff ?? '',
      r.bestPrefixCandidate?.yOff ?? '',
      suggest,
    ].map(escape).join(','));
  }

  return lines.join('\n');
}
