/**
 * ReviewWorkspace
 * --------------------------------------------------------------------------
 * Clean, action-oriented review surface for OCR Stage-2 outputs.
 *
 * Layout:
 *   [HEADER]   filename + progress + save buttons + close
 *   [KPIS]     5 stat cards with count + paint toggle (solid backgrounds)
 *   [BODY]     canvas (left) | sections accordion (right)
 *   [FOOTER]   save / save & next bar
 *
 * Sections (right panel, all visible by default):
 *   1. Auto-Accepted (confidence >= threshold) — class-grouped, bulk per class
 *   2. Quick Decide (below threshold, uncertain) — inline approve/reject
 *   3. Conflicts (must resolve) — same controls
 *   4. Suggested Misses (from coverage report) — push-to-tags / dismiss
 *
 * Sync:
 *   - Click row  -> setSelected, scroll canvas to that tag, pulse highlight.
 *   - Click painted tag on canvas -> setSelected, scroll list, expand section.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import PdfCanvas from '../pnid/PdfCanvas';
import { useStageFile, useSaveReview } from '../../hooks/useOcrPipelineV2';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const DEFAULT_THRESHOLD = 90; // percent
const TAG_TYPES = ['instrument', 'equipment', 'line', 'drawing_ref', 'noise'];

const CLASS_META = {
  instrument:  { color: '#F39C12', label: 'Instruments'  },
  equipment:   { color: '#3BE494', label: 'Equipment'    },
  line:        { color: '#2D33E0', label: 'Lines'        },
  drawing_ref: { color: '#A855F7', label: 'Drawing refs' },
  noise:       { color: '#E74C3C', label: 'Noise'        },
  unknown:     { color: '#94A3B8', label: 'Other'        },
};

// Highly distinct bucket colors so the canvas paint is unambiguous.
//   auto      = mint
//   approved  = forest green (similar family but darker, denotes "user approved")
//   pending   = amber (orange)
//   conflicts = hot pink (very loud — must resolve)
//   rejected  = red (cleanup / drop)
//   misses    = purple (suggested only)
const BUCKET_META = {
  auto:      { color: '#3BE494', label: 'Auto-accepted',    icon: 'check_circle', hint: 'High confidence — will be approved on save unless you reject.' },
  approved:  { color: '#16A34A', label: 'Approved',         icon: 'thumb_up',     hint: 'Explicitly approved by you.' },
  pending:   { color: '#F59E0B', label: 'Quick decide',     icon: 'rate_review',  hint: 'Below threshold or uncertain — needs your decision.' },
  conflicts: { color: '#EC4899', label: 'Conflicts',        icon: 'warning',      hint: 'Must resolve — ambiguous classification or competing groups.' },
  rejected:  { color: '#EF4444', label: 'Cleanup',          icon: 'gpp_bad',      hint: 'Rejected — will be dropped on save.' },
  misses:    { color: '#A855F7', label: 'Suggested misses', icon: 'help',         hint: 'Stage-2 thinks these tags exist but were not extracted.' },
};

function pctOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1.5) return Math.min(100, Math.max(0, n));
  return Math.min(100, Math.max(0, n * 100));
}

function isConflict(tag) {
  if (!tag) return false;
  if (Array.isArray(tag.conflictWith) && tag.conflictWith.length > 0) return true;
  const reason = String(tag.reasonCode || tag.reason_code || '').toLowerCase();
  if (reason.startsWith('conflict')) return true;
  if (!tag.type || tag.type === 'unknown') return true;
  return false;
}

function getPct(tag) {
  const p = tag?.position_pct || tag?.positionPct;
  if (!p) return null;
  return {
    x_pct: Number(p.x_pct ?? p.xPct ?? 0),
    y_pct: Number(p.y_pct ?? p.yPct ?? 0),
    w_pct: Number(p.w_pct ?? p.wPct ?? 0),
    h_pct: Number(p.h_pct ?? p.hPct ?? 0),
  };
}

function pctToBox(pct, dims) {
  if (!pct || !dims?.width || !dims?.height) return null;
  return {
    x: (pct.x_pct / 100) * dims.width,
    y: (pct.y_pct / 100) * dims.height,
    w: Math.max(2, (pct.w_pct / 100) * dims.width),
    h: Math.max(2, (pct.h_pct / 100) * dims.height),
  };
}

function pxBoxToPct(box, dims) {
  if (!box || !dims?.width || !dims?.height) return null;
  return {
    x_pct: Math.max(0, (box.x / dims.width) * 100),
    y_pct: Math.max(0, (box.y / dims.height) * 100),
    w_pct: Math.max(0.1, (box.w / dims.width) * 100),
    h_pct: Math.max(0.1, (box.h / dims.height) * 100),
  };
}

// Normalise common AI/legacy class synonyms to our 5 canonical classes so
// that piping/valve/drawing variations don't end up in the "Other" bucket.
const TYPE_SYNONYMS = {
  // Instrument family
  valve: 'instrument',
  control_valve: 'instrument',
  controlvalve: 'instrument',
  cv: 'instrument',
  psv: 'instrument',
  trans: 'instrument',
  transmitter: 'instrument',
  // Line / piping family
  pipe: 'line',
  piping: 'line',
  process_line: 'line',
  pipeline: 'line',
  // Drawing reference family
  drawing: 'drawing_ref',
  drawing_reference: 'drawing_ref',
  reference: 'drawing_ref',
  drawing_no: 'drawing_ref',
  drawing_number: 'drawing_ref',
  dwg: 'drawing_ref',
  // Equipment synonyms
  pump: 'equipment',
  vessel: 'equipment',
  tank: 'equipment',
  exchanger: 'equipment',
};

function normalizeType(type) {
  const t = String(type || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (!t) return 'unknown';
  if (CLASS_META[t]) return t;
  if (TYPE_SYNONYMS[t]) return TYPE_SYNONYMS[t];
  return 'unknown';
}

function classOfTag(tag) {
  return normalizeType(tag?.type);
}

export default function ReviewWorkspace({ batchId, file, allFiles, onClose, onNavigate }) {
  const { data, isLoading, error, refetch } = useStageFile(batchId, file?.id, 'cleaned');
  const saveReview = useSaveReview();

  const classified = data?.data || null;

  // ---------- Reviewable universe -----------------------------------------
  const reviewable = useMemo(() => {
    if (!classified) return [];
    const tags = (classified.tags || []).map((t, i) => ({ ...t, _index: i, _source: 'tag' }));
    const unc  = (classified.uncertain || []).map((t, i) => ({ ...t, _index: tags.length + i, _source: 'uncertain' }));
    const noise = (classified.noise || []).map((t, i) => ({ ...t, _index: tags.length + unc.length + i, _source: 'noise', type: t.type || 'noise' }));
    return [...tags, ...unc, ...noise];
  }, [classified]);

  const misses = useMemo(() => {
    const va = Array.isArray(classified?.visualAudit?.misses) ? classified.visualAudit.misses : [];
    const cv = Array.isArray(classified?.coverageReport?.missingFromCleaned) ? classified.coverageReport.missingFromCleaned : [];
    let mi = 0;
    const out = [];
    for (const m of [...cv, ...va]) {
      const p = m?.position_pct || m?.positionPct;
      if (!p) continue;
      const text = String(m?.text || m?.textCandidate || m?.candidate_text_norm || '').trim();
      if (!text) continue;
      out.push({
        _missIndex: mi++,
        text,
        type: m?.type || 'unknown',
        position_pct: {
          x_pct: Number(p.x_pct ?? p.xPct ?? 0),
          y_pct: Number(p.y_pct ?? p.yPct ?? 0),
          w_pct: Number(p.w_pct ?? p.wPct ?? 0),
          h_pct: Number(p.h_pct ?? p.hPct ?? 0),
        },
        reason: m?.reason || m?.reason_code || 'missing_from_cleaned',
        confidence: m?.confidence,
      });
    }
    return out;
  }, [classified]);

  // ---------- State --------------------------------------------------------
  const [decisions, setDecisions] = useState({});
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  // Default: paint EVERY bucket so the user immediately sees conflicts, cleanup
  // and misses on the canvas (previously only 4 of 6 were on by default).
  const [paintBuckets, setPaintBuckets] = useState(() => new Set(['auto', 'approved', 'pending', 'conflicts', 'rejected', 'misses']));
  // Per-class paint visibility — independent of bucket. Final visibility = bucket && class.
  const [paintClasses, setPaintClasses] = useState(() => new Set(['instrument', 'equipment', 'line', 'drawing_ref', 'noise', 'unknown']));
  // Misses multi-select + dismissed misses (only persisted in component state).
  const [selectedMissIds, setSelectedMissIds] = useState(() => new Set());
  const [dismissedMissIds, setDismissedMissIds] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState('instrument');
  const [openSections, setOpenSections] = useState(() => ({ auto: true, pending: true, conflicts: true, approved: false, rejected: false, misses: true }));
  // Search across all sections (filters every bucket list).
  const [searchTerm, setSearchTerm] = useState('');
  // Multi-select for cross-section bulk actions. Holds tag _index values.
  const [selectedRowIds, setSelectedRowIds] = useState(() => new Set());
  const [zoom, setZoom] = useState(100);
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [pdfData, setPdfData] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pulseTick, setPulseTick] = useState(0);
  // Canvas tool palette: 'select' | 'approve' | 'reject' | 'edit-bbox' | 'add' | 'delete'
  const [canvasTool, setCanvasTool] = useState('select');
  // BBox edit draft (when editing the focused tag's bounding box).
  const [bboxDraft, setBboxDraft] = useState(null);
  // Add-new-tag draft (free-draw rectangle followed by text/type entry).
  const [addDraft, setAddDraft] = useState(null);
  const [addText, setAddText] = useState('');
  const [addType, setAddType] = useState('instrument');
  // Manual tags appended by the user (live in the same _index space, but
  // start at 1_000_000 to avoid collisions with classified tags).
  const [manualTags, setManualTags] = useState([]);

  const scrollRef = useRef(null);
  const rowRefs = useRef(new Map());
  const sectionRefs = useRef(new Map());
  const dragRef = useRef(null);
  const manualIdxRef = useRef(1000000);
  // Files already marked as completed open locked by default.
  const [unlockedForReview, setUnlockedForReview] = useState(false);
  const reviewedAlready = String(file?.reviewStatus || '') === 'completed';
  const isLocked = reviewedAlready && !unlockedForReview;

  // Combined pool used for canvas paint + bulk lookups (manual tags = user
  // annotations from the Add tool). Declared after manualTags state above.
  const reviewableWithManual = useMemo(
    () => [...reviewable, ...manualTags.map((t) => ({ ...t }))],
    [reviewable, manualTags]
  );

  // Reset on file change
  useEffect(() => {
    setDecisions({});
    setSelectedId(null);
    setEditingIndex(null);
    setEditText('');
    setEditType('instrument');
    setPageDims({ width: 0, height: 0 });
    setPdfData(null);
    setPdfError('');
    setSearchTerm('');
    setSelectedRowIds(new Set());
    setSelectedMissIds(new Set());
    setDismissedMissIds(new Set());
    setCanvasTool('select');
    setBboxDraft(null);
    setAddDraft(null);
    setAddText('');
    setAddType('instrument');
    setManualTags([]);
    setUnlockedForReview(false);
  }, [file?.id]);

  // ---------- PDF binary ---------------------------------------------------
  useEffect(() => {
    if (!file?.storageKey) return;
    const url = `${API}/storage/files/${encodeURIComponent(file.storageKey)}`;
    let cancelled = false;
    setPdfLoading(true); setPdfError(''); setPdfData(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!cancelled) setPdfData(new Uint8Array(buf));
      })
      .catch((err) => { if (!cancelled) setPdfError(err?.message || 'PDF load failed'); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => { cancelled = true; };
  }, [file?.storageKey]);

  // Fit-to-viewport on first PDF render
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pageDims.width || !pageDims.height) return;
    const fitW = (el.clientWidth - 16) / pageDims.width;
    const fitH = (el.clientHeight - 16) / pageDims.height;
    const fit = Math.max(0.2, Math.min(4, Math.min(fitW, fitH)));
    setZoom(Math.round(fit * 100));
  }, [pageDims.width, pageDims.height]);

  // ---------- Categorisation ----------------------------------------------
  const classify = useCallback((tag) => {
    const dec = decisions[tag._index];
    if (dec?.action === 'approve' || dec?.action === 'edit') return 'approved';
    if (dec?.action === 'reject') return 'rejected';
    if (tag._source === 'noise') return 'rejected';
    if (tag._source === 'manual') return 'approved';
    if (isConflict(tag)) return 'conflicts';
    const conf = pctOf(tag.confidence);
    if (conf == null) return 'pending';
    if (conf >= threshold) return 'auto';
    return 'pending';
  }, [decisions, threshold]);

  const buckets = useMemo(() => {
    const b = { auto: [], approved: [], pending: [], conflicts: [], rejected: [] };
    for (const t of reviewableWithManual) {
      const cat = classify(t);
      if (b[cat]) b[cat].push(t);
    }
    return b;
  }, [reviewableWithManual, classify]);

  // Effective class respects the user's corrected type from the decision,
  // so a tag re-classified from "valve" to "instrument" moves into the
  // Instruments bucket immediately.
  const effectiveClass = useCallback((tag) => {
    const dec = decisions[tag?._index];
    return normalizeType(dec?.correctedType || tag?.type);
  }, [decisions]);

  // For sections: group bucket by class for cleaner action surface
  const groupByClass = useCallback((items) => {
    const out = {};
    for (const t of items) {
      const c = effectiveClass(t);
      if (!out[c]) out[c] = [];
      out[c].push(t);
    }
    return out;
  }, [effectiveClass]);

  // Apply the search term across the bucket BEFORE class-grouping so per-class
  // counts in each section reflect the active filter.
  const matchesSearch = useCallback((tag) => {
    const needle = String(searchTerm || '').trim().toLowerCase();
    if (!needle) return true;
    const txt = String(tag?.text || '').toLowerCase();
    const ty  = String(tag?.type || '').toLowerCase();
    return txt.includes(needle) || ty.includes(needle);
  }, [searchTerm]);

  const matchesSearchMiss = useCallback((m) => {
    const needle = String(searchTerm || '').trim().toLowerCase();
    if (!needle) return true;
    return String(m?.text || '').toLowerCase().includes(needle) || String(m?.reason || '').toLowerCase().includes(needle);
  }, [searchTerm]);

  const autoByClass      = useMemo(() => groupByClass(buckets.auto.filter(matchesSearch)),      [buckets.auto, groupByClass, matchesSearch]);
  const pendingByClass   = useMemo(() => groupByClass(buckets.pending.filter(matchesSearch)),   [buckets.pending, groupByClass, matchesSearch]);
  const conflictsByClass = useMemo(() => groupByClass(buckets.conflicts.filter(matchesSearch)), [buckets.conflicts, groupByClass, matchesSearch]);
  const approvedByClass  = useMemo(() => groupByClass(buckets.approved.filter(matchesSearch)),  [buckets.approved, groupByClass, matchesSearch]);
  const rejectedByClass  = useMemo(() => groupByClass(buckets.rejected.filter(matchesSearch)),  [buckets.rejected, groupByClass, matchesSearch]);
  const filteredMisses   = useMemo(
    () => misses.filter((m) => matchesSearchMiss(m) && !dismissedMissIds.has(`miss-${m._missIndex}`)),
    [misses, matchesSearchMiss, dismissedMissIds]
  );

  // KPI cards
  const stats = useMemo(() => ({
    auto:      buckets.auto.length,
    approved:  buckets.approved.length,
    pending:   buckets.pending.length,
    conflicts: buckets.conflicts.length,
    rejected:  buckets.rejected.length,
    misses:    misses.length,
    total:     reviewable.filter(t => t._source !== 'noise').length,
  }), [buckets, misses, reviewable]);

  const decisionsTaken = Object.keys(decisions).length;
  const remainingPending = stats.pending + stats.conflicts;
  const completionPct = stats.total > 0 ? Math.round(((stats.total - remainingPending) / stats.total) * 100) : 0;

  // ---------- Mutators -----------------------------------------------------
  const applyDecision = useCallback((index, action, extra = {}) => {
    if (isLocked) return;
    setDecisions((prev) => ({ ...prev, [index]: { index, action, ...extra } }));
  }, [isLocked]);

  const clearDecision = useCallback((index) => {
    if (isLocked) return;
    setDecisions((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, [isLocked]);

  const bulkApprove = useCallback((items = []) => {
    if (isLocked) return;
    if (!items.length) return;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of items) {
        next[t._index] = { index: t._index, action: 'approve', tagText: t.text, originalType: t.type, decisionSource: 'bulk_class' };
      }
      return next;
    });
  }, [isLocked]);

  const bulkReject = useCallback((items = []) => {
    if (isLocked) return;
    if (!items.length) return;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of items) {
        next[t._index] = { index: t._index, action: 'reject', tagText: t.text, originalType: t.type, decisionSource: 'bulk_class' };
      }
      return next;
    });
  }, [isLocked]);

  // Multi-select helpers used by row checkboxes and class group "select all".
  const toggleRowSelection = useCallback((index) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const setRowSelection = useCallback((indices = [], selected) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      for (const idx of indices) {
        if (selected) next.add(idx);
        else next.delete(idx);
      }
      return next;
    });
  }, []);

  const clearAllSelection = useCallback(() => setSelectedRowIds(new Set()), []);

  // Miss multi-select + bulk handlers ─────────────────────────────────────
  const toggleMissSelection = useCallback((missId) => {
    setSelectedMissIds((prev) => {
      const next = new Set(prev);
      if (next.has(missId)) next.delete(missId);
      else next.add(missId);
      return next;
    });
  }, []);

  const setMissSelectionAll = useCallback((missIds = [], selected) => {
    setSelectedMissIds((prev) => {
      const next = new Set(prev);
      for (const id of missIds) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearMissSelection = useCallback(() => setSelectedMissIds(new Set()), []);

  // Push selected misses into manual tags (becomes Approved automatically).
  const pushMissesAsTags = useCallback((missArr = [], type = 'instrument') => {
    if (isLocked) return;
    if (!missArr.length) return;
    const newTags = missArr.map((m) => ({
      _index: manualIdxRef.current++,
      _source: 'manual',
      text: m.text,
      type: type || 'instrument',
      confidence: 1,
      position_pct: m.position_pct,
    }));
    setManualTags((prev) => [...prev, ...newTags]);
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of newTags) {
        next[t._index] = {
          index: t._index,
          action: 'edit',
          tagText: t.text,
          originalType: 'manual',
          correctedText: t.text,
          correctedType: t.type,
          correctedPositionPct: t.position_pct,
          decisionSource: 'pushed_from_miss',
        };
      }
      return next;
    });
    // Hide the pushed misses so they don't sit around in the list anymore.
    setDismissedMissIds((prev) => {
      const next = new Set(prev);
      for (const m of missArr) next.add(`miss-${m._missIndex}`);
      return next;
    });
    setSelectedMissIds(new Set());
  }, [isLocked]);

  const dismissMisses = useCallback((missArr = []) => {
    if (isLocked) return;
    if (!missArr.length) return;
    setDismissedMissIds((prev) => {
      const next = new Set(prev);
      for (const m of missArr) next.add(`miss-${m._missIndex}`);
      return next;
    });
    setSelectedMissIds(new Set());
  }, [isLocked]);

  // Toggle paint visibility for a class on the canvas.
  const togglePaintClass = useCallback((cls) => {
    setPaintClasses((prev) => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }, []);

  const selectedTagsList = useMemo(
    () => reviewable.filter((t) => selectedRowIds.has(t._index)),
    [reviewable, selectedRowIds]
  );

  const bulkApproveSelected = useCallback(() => {
    bulkApprove(selectedTagsList);
    clearAllSelection();
  }, [bulkApprove, selectedTagsList, clearAllSelection]);

  const bulkRejectSelected = useCallback(() => {
    bulkReject(selectedTagsList);
    clearAllSelection();
  }, [bulkReject, selectedTagsList, clearAllSelection]);

  const bulkClearSelected = useCallback(() => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of selectedTagsList) delete next[t._index];
      return next;
    });
    clearAllSelection();
  }, [selectedTagsList, clearAllSelection]);

  const startEdit = useCallback((tag) => {
    if (isLocked) return;
    setEditingIndex(tag._index);
    setEditText(decisions[tag._index]?.correctedText || tag.text || '');
    setEditType(decisions[tag._index]?.correctedType || tag.type || 'instrument');
  }, [decisions, isLocked]);

  const confirmEdit = useCallback(() => {
    if (isLocked) return;
    if (editingIndex == null) return;
    const tag = reviewable.find(t => t._index === editingIndex);
    if (!tag) return;
    applyDecision(editingIndex, 'edit', { correctedText: editText, correctedType: editType, tagText: tag.text, originalType: tag.type });
    setEditingIndex(null);
  }, [editingIndex, editText, editType, reviewable, applyDecision, isLocked]);

  // ---------- Sync (list ↔ canvas) ---------------------------------------
  // Auto-zoom logic: if the tag would render smaller than ~80px wide at the
  // current zoom, bump zoom so the tag is comfortably visible (target 140px).
  const TARGET_TAG_PX = 140;
  const computeZoomForTag = useCallback((tag) => {
    if (!pageDims.width) return zoom;
    const pct = getPct(tag);
    if (!pct || pct.w_pct <= 0) return zoom;
    const tagWidthAtCurrentZoom = (pct.w_pct / 100) * pageDims.width * (zoom / 100);
    if (tagWidthAtCurrentZoom >= 80) return zoom;
    const tagWidthFullZoom = (pct.w_pct / 100) * pageDims.width;
    if (tagWidthFullZoom <= 0) return zoom;
    const desired = (TARGET_TAG_PX / tagWidthFullZoom) * 100;
    return Math.min(400, Math.max(zoom, Math.round(desired)));
  }, [pageDims.width, zoom]);

  const scrollCanvasToTag = useCallback((tag, opts = {}) => {
    const el = scrollRef.current;
    if (!el || !pageDims.width) return;
    // Prefer the user-corrected bbox so list-click lands where the painted box
    // actually sits on canvas (relevant after a bbox edit).
    const explicit = decisions[tag._index]?.correctedPositionPct;
    const pct = explicit || getPct(tag);
    if (!pct) return;
    const newZoom = opts.zoomIn ? computeZoomForTag(tag) : zoom;
    if (newZoom !== zoom) setZoom(newZoom);
    const z = newZoom / 100;
    const cx = ((pct.x_pct + pct.w_pct / 2) / 100) * pageDims.width  * z;
    const cy = ((pct.y_pct + pct.h_pct / 2) / 100) * pageDims.height * z;
    requestAnimationFrame(() => {
      el.scrollTo({
        left: Math.max(0, cx - el.clientWidth  / 2),
        top:  Math.max(0, cy - el.clientHeight / 2),
        behavior: 'smooth',
      });
    });
  }, [pageDims.width, pageDims.height, zoom, computeZoomForTag, decisions]);

  const scrollListToTag = useCallback((tag) => {
    const cat = classify(tag);
    // Auto-expand the section that contains this tag BEFORE scrolling to its row.
    const sectionKey = ['auto', 'pending', 'conflicts', 'approved', 'rejected'].includes(cat) ? cat : null;
    if (sectionKey) setOpenSections((prev) => (prev[sectionKey] ? prev : { ...prev, [sectionKey]: true }));
    // Defer to next tick so the row node exists after the section open.
    requestAnimationFrame(() => {
      const id = `tag-${tag._index}`;
      const node = rowRefs.current.get(id);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [classify]);

  const selectTag = useCallback((tag, opts = {}) => {
    if (!tag) { setSelectedId(null); return; }
    setSelectedId(tag._index);
    setPulseTick((p) => p + 1);
    setBboxDraft(null);
    if (opts.from === 'canvas') {
      scrollListToTag(tag);
    } else {
      // List → canvas: zoom in if tag is too small at current zoom, then center.
      scrollCanvasToTag(tag, { zoomIn: true });
    }
  }, [scrollCanvasToTag, scrollListToTag]);

  const selectMiss = useCallback((m) => {
    setSelectedId(`miss-${m._missIndex}`);
    setPulseTick((p) => p + 1);
    const id = `miss-${m._missIndex}`;
    const node = rowRefs.current.get(id);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Scroll canvas
    const el = scrollRef.current;
    if (!el || !pageDims.width || !m.position_pct) return;
    const pct = m.position_pct;
    const cx = ((pct.x_pct + pct.w_pct / 2) / 100) * pageDims.width  * (zoom / 100);
    const cy = ((pct.y_pct + pct.h_pct / 2) / 100) * pageDims.height * (zoom / 100);
    el.scrollTo({ left: Math.max(0, cx - el.clientWidth/2), top: Math.max(0, cy - el.clientHeight/2), behavior: 'smooth' });
  }, [pageDims.width, pageDims.height, zoom]);

  // ---------- BBox edit / Add new tag --------------------------------------
  const enterBboxEdit = useCallback((tag) => {
    if (isLocked) return;
    if (!tag) return;
    const explicitPct = decisions[tag._index]?.correctedPositionPct;
    const pct = explicitPct || getPct(tag);
    if (!pct) return;
    setSelectedId(tag._index);
    setBboxDraft({ ...pct });
  }, [decisions, isLocked]);

  const cancelBboxEdit = useCallback(() => setBboxDraft(null), []);

  const saveBboxEdit = useCallback(() => {
    if (isLocked) return;
    if (!bboxDraft || selectedId == null) return;
    const tag = reviewable.find((t) => t._index === selectedId);
    if (!tag) return;
    applyDecision(selectedId, 'edit', {
      tagText: tag.text,
      originalType: tag.type,
      correctedText: decisions[selectedId]?.correctedText || tag.text,
      correctedType: decisions[selectedId]?.correctedType || tag.type,
      correctedPositionPct: bboxDraft,
      notes: 'bbox_adjusted',
    });
    setBboxDraft(null);
  }, [bboxDraft, selectedId, reviewable, decisions, applyDecision, isLocked]);

  // Hard delete: manual tags are removed entirely; classified tags become
  // explicit rejects (so they're dropped on save).
  const deleteTag = useCallback((tag) => {
    if (isLocked) return;
    if (!tag) return;
    if (tag._source === 'manual') {
      setManualTags((prev) => prev.filter((t) => t._index !== tag._index));
      setDecisions((prev) => {
        const next = { ...prev };
        delete next[tag._index];
        return next;
      });
      if (selectedId === tag._index) setSelectedId(null);
      setBboxDraft(null);
      return;
    }
    applyDecision(tag._index, 'reject', { tagText: tag.text, originalType: tag.type, notes: 'deleted_via_canvas_tool' });
  }, [applyDecision, selectedId, isLocked]);

  // Canvas click dispatch — what happens when user clicks a painted tag.
  const handleCanvasTagClick = useCallback((tag) => {
    selectTag(tag, { from: 'canvas' });
    if (isLocked) return;
    if (canvasTool === 'select') return;
    if (canvasTool === 'approve')   applyDecision(tag._index, 'approve', { tagText: tag.text, originalType: tag.type });
    else if (canvasTool === 'reject') applyDecision(tag._index, 'reject', { tagText: tag.text, originalType: tag.type });
    else if (canvasTool === 'delete') deleteTag(tag);
    else if (canvasTool === 'edit-bbox') enterBboxEdit(tag);
  }, [canvasTool, selectTag, applyDecision, enterBboxEdit, deleteTag, isLocked]);

  // Keyboard: Delete/Backspace removes selected tag (manual = hard delete,
  // classified = reject). Esc cancels bbox/add modes.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        if (bboxDraft) { setBboxDraft(null); return; }
        if (addDraft) { setAddDraft(null); return; }
        if (canvasTool !== 'select') { setCanvasTool('select'); return; }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isLocked) return;
        if (typeof selectedId !== 'number') return;
        const t = reviewableWithManual.find((x) => x._index === selectedId);
        if (t) {
          e.preventDefault();
          deleteTag(t);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, reviewableWithManual, deleteTag, bboxDraft, addDraft, canvasTool, isLocked]);

  // Bbox handle drag (8 handles + body translate).
  const onBboxHandleMouseDown = useCallback((handle, e) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    if (!bboxDraft || !pageDims.width) return;
    const startBoxPx = pctToBox(bboxDraft, pageDims);
    dragRef.current = {
      kind: 'bbox',
      handle,
      startBoxPx,
      startMouse: { x: e.clientX, y: e.clientY },
      zoom: zoom / 100,
    };
  }, [bboxDraft, pageDims, zoom, isLocked]);

  // Free-draw add: mousedown on canvas while in 'add' mode begins a draft.
  const onCanvasMouseDown = useCallback((e) => {
    if (isLocked) return;
    if (canvasTool !== 'add') return;
    if (!pageDims.width) return;
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const z = zoom / 100;
    const cx = (e.clientX - rect.left + el.scrollLeft) / z;
    const cy = (e.clientY - rect.top  + el.scrollTop)  / z;
    dragRef.current = {
      kind: 'add',
      origin: { x: cx, y: cy },
    };
    setAddDraft(pxBoxToPct({ x: cx, y: cy, w: 1, h: 1 }, pageDims));
  }, [canvasTool, pageDims, zoom, isLocked]);

  // Global mouse-move + mouse-up dispatch for both bbox and add drag kinds.
  useEffect(() => {
    const onMove = (e) => {
      const st = dragRef.current;
      if (!st) return;
      if (st.kind === 'bbox') {
        const dx = (e.clientX - st.startMouse.x) / st.zoom;
        const dy = (e.clientY - st.startMouse.y) / st.zoom;
        const { startBoxPx, handle } = st;
        let { x, y, w, h } = startBoxPx;
        if (handle === 'move') { x += dx; y += dy; }
        if (handle.includes('w')) { x += dx; w -= dx; }
        if (handle.includes('e')) { w += dx; }
        if (handle.includes('n')) { y += dy; h -= dy; }
        if (handle.includes('s')) { h += dy; }
        if (w < 4) w = 4;
        if (h < 4) h = 4;
        setBboxDraft(pxBoxToPct({ x, y, w, h }, pageDims));
      } else if (st.kind === 'add') {
        const el = scrollRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const z = zoom / 100;
        const cx = (e.clientX - rect.left + el.scrollLeft) / z;
        const cy = (e.clientY - rect.top  + el.scrollTop)  / z;
        const x = Math.min(st.origin.x, cx);
        const y = Math.min(st.origin.y, cy);
        const w = Math.max(2, Math.abs(cx - st.origin.x));
        const h = Math.max(2, Math.abs(cy - st.origin.y));
        setAddDraft(pxBoxToPct({ x, y, w, h }, pageDims));
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pageDims, zoom]);

  const startAddTag = useCallback(() => {
    if (isLocked) return;
    setCanvasTool('add');
    setAddDraft(null);
    setAddText('');
    setAddType('instrument');
  }, [isLocked]);

  const cancelAddTag = useCallback(() => {
    if (isLocked) return;
    setCanvasTool('select');
    setAddDraft(null);
    setAddText('');
  }, [isLocked]);

  const saveAddTag = useCallback(() => {
    if (isLocked) return;
    if (!addDraft || !addText.trim()) return;
    const idx = manualIdxRef.current++;
    const newTag = {
      _index: idx,
      _source: 'manual',
      text: addText.trim(),
      type: addType || 'instrument',
      confidence: 1,
      position_pct: addDraft,
    };
    setManualTags((prev) => [...prev, newTag]);
    setDecisions((prev) => ({
      ...prev,
      [idx]: {
        index: idx,
        action: 'edit',
        tagText: newTag.text,
        originalType: 'manual',
        correctedText: newTag.text,
        correctedType: newTag.type,
        correctedPositionPct: addDraft,
        decisionSource: 'manual_add',
      },
    }));
    setSelectedId(idx);
    setCanvasTool('select');
    setAddDraft(null);
    setAddText('');
  }, [addDraft, addText, addType, isLocked]);

  // ---------- Save ---------------------------------------------------------
  const buildDecisionList = useCallback(() => {
    return reviewableWithManual.map((tag) => {
      const explicit = decisions[tag._index];
      let action;
      if (explicit) action = explicit.action;
      else if (tag._source === 'noise') action = 'reject';
      else if (tag.automationDecision === 'auto_reject') action = 'reject';
      else {
        const cat = classify(tag);
        if (cat === 'auto' || cat === 'approved') action = 'approve';
        else if (cat === 'rejected') action = 'reject';
        else action = 'pending';
      }
      return {
        index: tag._index,
        tagText: tag.text,
        originalType: tag.type,
        source: tag._source,
        action,
        correctedText: explicit?.correctedText,
        correctedType: explicit?.correctedType,
        correctedPositionPct: explicit?.correctedPositionPct,
        decisionSource: explicit?.decisionSource || (action === 'approve' && !explicit ? 'auto_above_threshold' : 'default_policy'),
        notes: explicit?.notes,
      };
    });
  }, [reviewableWithManual, decisions, classify]);

  const pendingForSave = remainingPending;
  const canSave = !isLocked && !saveReview.isPending && reviewable.length > 0 && pendingForSave === 0;

  // File navigation
  const currentIdx = (allFiles || []).findIndex((f) => f.id === file?.id);
  const nextFile   = currentIdx >= 0 ? (allFiles || [])[currentIdx + 1] : null;
  const prevFile   = currentIdx > 0  ? (allFiles || [])[currentIdx - 1] : null;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    try {
      await saveReview.mutateAsync({ batchId, fileId: file.id, decisions: buildDecisionList() });
      await refetch();
    } catch {
      /* keep in place; error surfaced below */
    }
  }, [canSave, saveReview, batchId, file?.id, buildDecisionList, refetch]);

  const handleSaveAndNext = useCallback(async () => {
    if (!canSave || !nextFile) return;
    try {
      await saveReview.mutateAsync({ batchId, fileId: file.id, decisions: buildDecisionList() });
      onNavigate?.(nextFile);
    } catch {
      /* keep in place */
    }
  }, [canSave, nextFile, saveReview, batchId, file?.id, buildDecisionList, onNavigate]);

  // ---------- Render -------------------------------------------------------
  if (!file) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-md-surface/98 backdrop-blur-sm">
      <div className="absolute inset-0 -z-10 bg-md-surface/95" onClick={onClose} />
      <div className="m-1 flex-1 min-h-0 flex flex-col rounded-md-lg border border-[#3BE494]/30 overflow-hidden bg-md-surface-container/95 shadow-2xl">

        {/* ============================================================== */}
        {/* HEADER                                                          */}
        {/* ============================================================== */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-md-outline-variant/20 bg-md-surface-container-high/40">
          <span className="material-symbols-outlined text-[18px] text-[#3BE494]">rate_review</span>
          <span className="text-[12px] font-bold text-md-on-surface truncate max-w-[280px]" title={file.filename}>
            {file.filename}
          </span>
          <div className="flex items-center gap-2 ml-2">
            <div className="w-32 h-1.5 rounded-full bg-md-on-surface/10 overflow-hidden">
              <div className="h-full bg-[#3BE494] transition-all" style={{ width: `${completionPct}%` }} />
            </div>
            <span className="text-[10px] text-md-on-surface-variant">{completionPct}%</span>
            <span className="text-[10px] text-md-on-surface-variant">·</span>
            <span className="text-[10px] text-md-on-surface-variant">decisions: {decisionsTaken}</span>
            {remainingPending > 0 && (
              <span className="text-[10px] text-[#F39C12] font-bold">· remaining: {remainingPending}</span>
            )}
          </div>

          {/* Threshold control */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[9px] uppercase font-bold text-md-on-surface-variant">Auto-accept</span>
            <input
              type="range" min={70} max={100} step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={isLocked}
              className="w-24 accent-[#3BE494]"
            />
            <span className="text-[10px] font-bold text-[#3BE494] w-8">{threshold}%</span>
          </div>
          {isLocked && (
            <span className="text-[10px] font-bold text-[#3BE494] px-2 py-0.5 rounded bg-[#3BE494]/12 border border-[#3BE494]/30">
              Review Complete (Locked)
            </span>
          )}

          <div className="flex-1" />

          {/* File nav */}
          {Array.isArray(allFiles) && allFiles.length > 1 && (
            <div className="flex items-center gap-1 mr-2">
              <button onClick={() => prevFile && onNavigate?.(prevFile)} disabled={!prevFile} className="p-0.5 rounded hover:bg-md-on-surface/5 disabled:opacity-20" title="Previous file">
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
              </button>
              <span className="text-[10px] text-md-on-surface-variant">{currentIdx + 1}/{allFiles.length}</span>
              <button onClick={() => nextFile && onNavigate?.(nextFile)} disabled={!nextFile} className="p-0.5 rounded hover:bg-md-on-surface/5 disabled:opacity-20" title="Next file">
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold bg-[#3BE494]/20 text-[#3BE494] border border-[#3BE494]/40 disabled:opacity-30"
            title={remainingPending > 0 ? `${remainingPending} rows still need decisions` : 'Save review'}
          >
            {saveReview.isPending ? (
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[14px]">save</span>
            )}
            {isLocked ? 'Locked' : 'Save'}
          </button>
          <button
            onClick={handleSaveAndNext}
            disabled={!canSave || !nextFile}
            className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold bg-[#8AB4FF]/20 text-[#8AB4FF] border border-[#8AB4FF]/40 disabled:opacity-30"
            title={!nextFile ? 'Last file' : (remainingPending > 0 ? 'Resolve remaining decisions first' : 'Save & open next file')}
          >
            <span className="material-symbols-outlined text-[14px]">skip_next</span>
            Save & Next
          </button>
          {reviewedAlready && (
            <button
              onClick={() => setUnlockedForReview((v) => !v)}
              className={`flex items-center gap-1 px-3 py-1 rounded text-[11px] font-bold border ${
                isLocked
                  ? 'bg-[#F39C12]/20 text-[#F39C12] border-[#F39C12]/40'
                  : 'bg-[#3BE494]/20 text-[#3BE494] border-[#3BE494]/40'
              }`}
              title={isLocked ? 'Unlock this completed review for edits' : 'Lock editing again'}
            >
              <span className="material-symbols-outlined text-[14px]">{isLocked ? 'lock_open' : 'lock'}</span>
              {isLocked ? 'Reopen Review' : 'Lock Review'}
            </button>
          )}
          <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface ml-1" title="Close review">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* ============================================================== */}
        {/* KPI STRIP                                                       */}
        {/* ============================================================== */}
        <div className="px-3 py-2 border-b border-md-outline-variant/20 bg-md-surface-container-high/20 flex items-center gap-2 flex-wrap">
          <KpiCard bucket="auto"      count={stats.auto}      paint={paintBuckets.has('auto')}      onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'auto')}      onJump={() => { setOpenSections((p) => ({ ...p, auto: true }));      jumpSection(sectionRefs, 'auto'); }} />
          <KpiCard bucket="approved"  count={stats.approved}  paint={paintBuckets.has('approved')}  onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'approved')}  onJump={() => { setOpenSections((p) => ({ ...p, approved: true }));  jumpSection(sectionRefs, 'approved'); }} />
          <KpiCard bucket="pending"   count={stats.pending}   paint={paintBuckets.has('pending')}   onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'pending')}   onJump={() => { setOpenSections((p) => ({ ...p, pending: true }));   jumpSection(sectionRefs, 'pending'); }} />
          <KpiCard bucket="conflicts" count={stats.conflicts} paint={paintBuckets.has('conflicts')} onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'conflicts')} onJump={() => { setOpenSections((p) => ({ ...p, conflicts: true })); jumpSection(sectionRefs, 'conflicts'); }} />
          <KpiCard bucket="rejected"  count={stats.rejected}  paint={paintBuckets.has('rejected')}  onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'rejected')}  onJump={() => { setOpenSections((p) => ({ ...p, rejected: true }));  jumpSection(sectionRefs, 'rejected'); }} />
          <KpiCard bucket="misses"    count={stats.misses}    paint={paintBuckets.has('misses')}    onTogglePaint={() => togglePaint(paintBuckets, setPaintBuckets, 'misses')}    onJump={() => { setOpenSections((p) => ({ ...p, misses: true }));    jumpSection(sectionRefs, 'misses'); }} />
          <span className="flex-1" />
          <span className="text-[9px] text-md-on-surface-variant">
            tags total <span className="text-md-on-surface font-bold">{stats.total}</span>
          </span>
        </div>

        {/* CLASS VISIBILITY STRIP — toggle paint per service/class on the canvas. */}
        <div className="px-3 py-1 border-b border-md-outline-variant/15 bg-md-surface-container/20 flex items-center gap-2 flex-wrap">
          <span className="text-[9px] uppercase font-bold text-md-on-surface-variant">Classes on canvas</span>
          {Object.entries(CLASS_META).map(([cls, meta]) => {
            const on = paintClasses.has(cls);
            return (
              <button
                key={cls}
                onClick={() => togglePaintClass(cls)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all"
                style={{
                  color: on ? '#0D1F17' : meta.color,
                  borderColor: meta.color,
                  background: on ? meta.color : 'transparent',
                }}
                title={`${on ? 'Hide' : 'Show'} ${meta.label} on canvas`}
              >
                <span className="material-symbols-outlined text-[12px]">{on ? 'visibility' : 'visibility_off'}</span>
                {meta.label}
              </button>
            );
          })}
          <span className="flex-1" />
          <button
            onClick={() => setPaintClasses(new Set(['instrument', 'equipment', 'line', 'drawing_ref', 'noise', 'unknown']))}
            className="text-[9px] text-md-on-surface-variant hover:underline"
            title="Show all classes"
          >Show all</button>
          <button
            onClick={() => setPaintClasses(new Set())}
            className="text-[9px] text-md-on-surface-variant hover:underline"
            title="Hide all classes"
          >Hide all</button>
        </div>

        {/* ============================================================== */}
        {/* BODY                                                            */}
        {/* ============================================================== */}
        <div className="flex-1 min-h-0 flex">

          {/* Canvas */}
          <div className="flex-1 min-w-0 flex flex-col border-r border-md-outline-variant/15 relative">
            <div className="flex items-center gap-1 px-2 py-1 border-b border-md-outline-variant/15 bg-md-surface-container/30">
              <span className="text-[9px] uppercase font-bold text-md-on-surface-variant mr-1">Canvas</span>
              <button onClick={() => setZoom(z => Math.max(20, z - 20))} className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">−</button>
              <span className="text-[10px] text-md-on-surface-variant w-10 text-center">{zoom}%</span>
              <button onClick={() => setZoom(z => Math.min(400, z + 20))} className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">+</button>
              <button
                onClick={() => {
                  const el = scrollRef.current;
                  if (!el || !pageDims.width || !pageDims.height) return;
                  const fitW = (el.clientWidth - 16) / pageDims.width;
                  const fitH = (el.clientHeight - 16) / pageDims.height;
                  const fit = Math.max(0.2, Math.min(4, Math.min(fitW, fitH)));
                  setZoom(Math.round(fit * 100));
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
              >Fit</button>
              <span className="flex-1" />
              {selectedId != null && typeof selectedId === 'number' && (
                <span className="text-[10px] text-[#FACC15]">
                  selected: <span className="font-mono">{reviewable.find(t => t._index === selectedId)?.text || '—'}</span>
                </span>
              )}
            </div>

            {/* Floating canvas tool palette — pinned to canvas wrapper so it
                stays visible regardless of scroll position. */}
            <div className="absolute top-9 left-2 z-30">
              <CanvasToolPalette
                tool={canvasTool}
                setTool={setCanvasTool}
                onAdd={startAddTag}
                hasSelection={typeof selectedId === 'number'}
                locked={isLocked}
                onEditBboxSelected={() => {
                  const t = reviewableWithManual.find((x) => x._index === selectedId);
                  if (t) enterBboxEdit(t);
                }}
                onDeleteSelected={() => {
                  const t = reviewableWithManual.find((x) => x._index === selectedId);
                  if (t) deleteTag(t);
                }}
              />
            </div>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-auto bg-md-surface relative"
              onMouseDown={(e) => onCanvasMouseDown(e)}
              style={{ cursor: canvasTool === 'select' ? 'default' : 'crosshair' }}
            >
              {pdfLoading && <div className="p-4 text-[11px] text-md-on-surface-variant">Loading drawing…</div>}
              {pdfError   && <div className="p-4 text-[11px] text-[#E74C3C]">PDF error: {pdfError}</div>}
              {pdfData && (
                <div className="relative inline-block min-w-full p-2">
                  <div className="relative origin-top-left" style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}>
                    <PdfCanvas
                      data={pdfData}
                      page={1}
                      onLoaded={() => {}}
                      onError={(e) => setPdfError(e?.message || 'PDF render failed')}
                      onDimensions={(d) => setPageDims(d || { width: 0, height: 0 })}
                      className="shadow-md border border-md-outline-variant/20 bg-white"
                    />

                    {/* Painted tag overlays — bucket fill + class color border */}
                    {pageDims.width > 0 && reviewableWithManual.map((tag) => {
                      const cat = classify(tag);
                      if (!paintBuckets.has(cat)) return null;
                      const cls = effectiveClass(tag);
                      if (!paintClasses.has(cls)) return null;
                      // Use the user-edited bbox if present, otherwise the tag's own bbox.
                      const explicitPct = decisions[tag._index]?.correctedPositionPct;
                      const pct = explicitPct || getPct(tag);
                      if (!pct) return null;
                      const box = pctToBox(pct, pageDims);
                      if (!box) return null;
                      const isSelected = selectedId === tag._index;
                      const isEditingBbox = isSelected && bboxDraft;
                      const meta = BUCKET_META[cat] || BUCKET_META.pending;
                      const classMeta = CLASS_META[cls] || CLASS_META.unknown;
                      // Hide painted box while bbox is being dragged so the
                      // editable handles below don't overlap with the source.
                      if (isEditingBbox) return null;
                      return (
                        <div
                          key={`paint-${tag._index}-${pulseTick}-${isSelected ? 'sel' : 'idle'}`}
                          onClick={(e) => { e.stopPropagation(); handleCanvasTagClick(tag); }}
                          className={`absolute pointer-events-auto cursor-pointer ${isSelected ? 'rw-pulse' : ''}`}
                          style={{
                            left: box.x, top: box.y, width: box.w, height: box.h,
                            background: hexAlpha(meta.color, isSelected ? 0.40 : 0.18),
                            border: `${isSelected ? 3 : 2}px solid ${isSelected ? '#FACC15' : classMeta.color}`,
                            outline: isSelected ? 'none' : `1px solid ${hexAlpha(meta.color, 0.7)}`,
                            outlineOffset: '-1px',
                            boxShadow: isSelected ? `0 0 0 4px rgba(250,204,21,0.45), 0 0 14px rgba(250,204,21,0.55)` : 'none',
                            transition: 'box-shadow 0.18s, border 0.18s',
                          }}
                          title={`[${cat}] "${tag.text}" — ${classMeta.label} — conf ${pctOf(tag.confidence) ?? '—'}%`}
                        >
                          <span
                            className="absolute font-bold pointer-events-none select-none"
                            style={{ top: -1, right: 1, color: meta.color, fontSize: Math.min(14, Math.max(8, Math.min(box.w, box.h) * 0.6)), lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.85)' }}
                          >
                            {cat === 'auto' ? '✓' : cat === 'approved' ? '✓' : cat === 'rejected' ? '✕' : cat === 'conflicts' ? '!' : '?'}
                          </span>
                          {/* Class color stripe at bottom for class-at-a-glance */}
                          <span
                            className="absolute pointer-events-none"
                            style={{ left: 0, right: 0, bottom: 0, height: 2, background: classMeta.color, opacity: 0.95 }}
                          />
                        </div>
                      );
                    })}

                    {/* BBox handles when editing the selected tag */}
                    {pageDims.width > 0 && bboxDraft && (() => {
                      const box = pctToBox(bboxDraft, pageDims);
                      if (!box) return null;
                      const handles = [
                        ['nw', box.x,           box.y],
                        ['n',  box.x + box.w/2, box.y],
                        ['ne', box.x + box.w,   box.y],
                        ['w',  box.x,           box.y + box.h/2],
                        ['e',  box.x + box.w,   box.y + box.h/2],
                        ['sw', box.x,           box.y + box.h],
                        ['s',  box.x + box.w/2, box.y + box.h],
                        ['se', box.x + box.w,   box.y + box.h],
                      ];
                      return (
                        <>
                          <div
                            onMouseDown={(e) => onBboxHandleMouseDown('move', e)}
                            className="absolute"
                            style={{ left: box.x, top: box.y, width: box.w, height: box.h, border: '2px solid #FACC15', background: 'rgba(250,204,21,0.12)', cursor: 'move', pointerEvents: 'auto' }}
                          />
                          {handles.map(([h, hx, hy]) => (
                            <div
                              key={h}
                              onMouseDown={(e) => onBboxHandleMouseDown(h, e)}
                              className="absolute"
                              style={{
                                left: hx - 5, top: hy - 5, width: 10, height: 10,
                                background: '#FACC15', border: '1px solid #1c1c1c',
                                cursor: `${h}-resize`, pointerEvents: 'auto',
                              }}
                            />
                          ))}
                        </>
                      );
                    })()}

                    {/* Live add-tag rectangle (free-draw) */}
                    {addDraft && pageDims.width > 0 && (() => {
                      const box = pctToBox(addDraft, pageDims);
                      if (!box) return null;
                      return (
                        <div
                          className="absolute pointer-events-none"
                          style={{ left: box.x, top: box.y, width: box.w, height: box.h, border: '2px dashed #06B6D4', background: 'rgba(6,182,212,0.12)' }}
                        />
                      );
                    })()}

                    {/* Persistent callout for the selected tag — makes it
                        unambiguous which painted box is the user's selection
                        even when the box is small or surrounded by other text. */}
                    {pageDims.width > 0 && typeof selectedId === 'number' && (() => {
                      const tag = reviewableWithManual.find((x) => x._index === selectedId);
                      if (!tag) return null;
                      const explicitPct = decisions[tag._index]?.correctedPositionPct;
                      const pct = explicitPct || getPct(tag);
                      if (!pct) return null;
                      const box = pctToBox(pct, pageDims);
                      if (!box) return null;
                      const above = box.y > 32;
                      const labelY = above ? box.y - 24 : box.y + box.h + 4;
                      const cls = effectiveClass(tag);
                      const classMeta = CLASS_META[cls] || CLASS_META.unknown;
                      return (
                        <div
                          className="absolute pointer-events-none flex items-center gap-1 px-1.5 py-0.5 rounded font-mono"
                          style={{
                            left: box.x,
                            top: labelY,
                            background: '#FACC15',
                            color: '#0D1F17',
                            fontSize: 11,
                            fontWeight: 700,
                            border: `2px solid ${classMeta.color}`,
                            boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                            whiteSpace: 'nowrap',
                            zIndex: 25,
                          }}
                          title={`${tag.text} (${classMeta.label})`}
                        >
                          ▶ {decisions[tag._index]?.correctedText || tag.text || '—'}
                        </div>
                      );
                    })()}

                    {/* Misses overlay */}
                    {pageDims.width > 0 && paintBuckets.has('misses') && misses.map((m) => {
                      const box = pctToBox(m.position_pct, pageDims);
                      if (!box) return null;
                      const isSelected = selectedId === `miss-${m._missIndex}`;
                      return (
                        <div
                          key={`miss-${m._missIndex}-${pulseTick}-${isSelected ? 'sel' : 'idle'}`}
                          onClick={(e) => { e.stopPropagation(); selectMiss(m); }}
                          className={`absolute pointer-events-auto cursor-pointer ${isSelected ? 'rw-pulse' : ''}`}
                          style={{
                            left: box.x, top: box.y, width: box.w, height: box.h,
                            background: hexAlpha('#A855F7', isSelected ? 0.45 : 0.18),
                            border: `${isSelected ? 3 : 1.5}px dashed ${isSelected ? '#FACC15' : '#A855F7'}`,
                          }}
                          title={`Suggested miss: "${m.text}" (${m.reason})`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* Add-tag entry footer (visible only while drafting a free-draw box) */}
            {addDraft && (
              <div className="px-2 py-1.5 border-t border-[#06B6D4]/40 bg-[#06B6D4]/10 flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-[#06B6D4]">Add tag</span>
                <input
                  autoFocus
                  value={addText}
                  onChange={(e) => setAddText(e.target.value)}
                  placeholder="Tag text (e.g. PT-101)"
                  className="flex-1 px-2 py-1 bg-md-surface border border-[#06B6D4]/40 rounded text-[11px] font-mono text-md-on-surface outline-none"
                />
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                  className="px-1.5 py-1 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
                >
                  {TAG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={cancelAddTag} className="px-2 py-1 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
                <button onClick={saveAddTag} disabled={!addText.trim()} className="px-2 py-1 rounded text-[10px] font-bold bg-[#06B6D4]/20 text-[#06B6D4] border border-[#06B6D4]/40 disabled:opacity-50">Save tag</button>
              </div>
            )}
            {/* BBox edit confirmation footer */}
            {bboxDraft && (
              <div className="px-2 py-1.5 border-t border-[#FACC15]/40 bg-[#FACC15]/8 flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold text-[#FACC15]">Adjust bbox</span>
                <span className="text-[10px] text-md-on-surface-variant font-mono">
                  x {bboxDraft.x_pct.toFixed(1)}% · y {bboxDraft.y_pct.toFixed(1)}% · w {bboxDraft.w_pct.toFixed(1)}% · h {bboxDraft.h_pct.toFixed(1)}%
                </span>
                <span className="flex-1" />
                <button onClick={cancelBboxEdit} className="px-2 py-1 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
                <button onClick={saveBboxEdit} className="px-2 py-1 rounded text-[10px] font-bold bg-[#FACC15]/20 text-[#FACC15] border border-[#FACC15]/40">Save bbox</button>
              </div>
            )}
          </div>

          {/* Sections panel */}
          <div className="w-[420px] flex-shrink-0 flex flex-col min-h-0 overflow-hidden bg-md-surface-container/30">
            {/* Sticky search across all sections */}
            <div className="sticky top-0 z-10 px-2 py-1.5 border-b border-md-outline-variant/15 bg-md-surface-container/60 backdrop-blur flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">search</span>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tag text or type…"
                className="flex-1 px-2 py-1 bg-md-surface border border-md-outline-variant/30 rounded text-[11px] text-md-on-surface placeholder:text-md-on-surface-variant/60 outline-none focus:border-[#3BE494]/50"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                  title="Clear search"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
              {selectedRowIds.size > 0 && (
                <button
                  onClick={clearAllSelection}
                  className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                  title="Clear row selection"
                >
                  Clear sel
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Section
                refMap={sectionRefs}
                sectionKey="auto"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.auto.color}
                icon={BUCKET_META.auto.icon}
                title="Auto-accepted"
                subtitle={`Confidence ≥ ${threshold}% — will be approved on save unless rejected`}
                count={stats.auto}
              >
                <ClassGroupedList
                  byClass={autoByClass}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  decisions={decisions}
                  bulkApprove={bulkApprove}
                  bulkReject={bulkReject}
                  applyDecision={applyDecision}
                  clearDecision={clearDecision}
                  selectTag={selectTag}
                  startEdit={startEdit}
                  selectedRowIds={selectedRowIds}
                  toggleRowSelection={toggleRowSelection}
                  setRowSelection={setRowSelection}
                  locked={isLocked}
                  emptyMsg="No tags currently meet the threshold."
                />
              </Section>

              <Section
                refMap={sectionRefs}
                sectionKey="pending"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.pending.color}
                icon={BUCKET_META.pending.icon}
                title="Quick decide"
                subtitle="Below threshold or uncertain — needs your decision"
                count={stats.pending}
              >
                <ClassGroupedList
                  byClass={pendingByClass}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  decisions={decisions}
                  bulkApprove={bulkApprove}
                  bulkReject={bulkReject}
                  applyDecision={applyDecision}
                  clearDecision={clearDecision}
                  selectTag={selectTag}
                  startEdit={startEdit}
                  selectedRowIds={selectedRowIds}
                  toggleRowSelection={toggleRowSelection}
                  setRowSelection={setRowSelection}
                  locked={isLocked}
                  emptyMsg="Nothing needs a quick decision right now."
                />
              </Section>

              <Section
                refMap={sectionRefs}
                sectionKey="conflicts"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.conflicts.color}
                icon={BUCKET_META.conflicts.icon}
                title="Conflicts"
                subtitle="Must resolve — ambiguous classification or competing groups"
                count={stats.conflicts}
              >
                <ClassGroupedList
                  byClass={conflictsByClass}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  decisions={decisions}
                  bulkApprove={bulkApprove}
                  bulkReject={bulkReject}
                  applyDecision={applyDecision}
                  clearDecision={clearDecision}
                  selectTag={selectTag}
                  startEdit={startEdit}
                  selectedRowIds={selectedRowIds}
                  toggleRowSelection={toggleRowSelection}
                  setRowSelection={setRowSelection}
                  locked={isLocked}
                  emptyMsg="No conflicts."
                />
              </Section>

              <Section
                refMap={sectionRefs}
                sectionKey="approved"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.approved.color}
                icon={BUCKET_META.approved.icon}
                title="Approved"
                subtitle="Explicitly approved by you (includes manual annotations)"
                count={stats.approved}
              >
                <ClassGroupedList
                  byClass={approvedByClass}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  decisions={decisions}
                  bulkApprove={bulkApprove}
                  bulkReject={bulkReject}
                  applyDecision={applyDecision}
                  clearDecision={clearDecision}
                  selectTag={selectTag}
                  startEdit={startEdit}
                  selectedRowIds={selectedRowIds}
                  toggleRowSelection={toggleRowSelection}
                  setRowSelection={setRowSelection}
                  locked={isLocked}
                  emptyMsg="Nothing approved yet. Use bulk actions or per-row approve."
                />
              </Section>

              <Section
                refMap={sectionRefs}
                sectionKey="rejected"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.rejected.color}
                icon={BUCKET_META.rejected.icon}
                title="Cleanup (rejected)"
                subtitle="Will be dropped on save — review before commit"
                count={stats.rejected}
              >
                <ClassGroupedList
                  byClass={rejectedByClass}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  decisions={decisions}
                  bulkApprove={bulkApprove}
                  bulkReject={bulkReject}
                  applyDecision={applyDecision}
                  clearDecision={clearDecision}
                  selectTag={selectTag}
                  startEdit={startEdit}
                  selectedRowIds={selectedRowIds}
                  toggleRowSelection={toggleRowSelection}
                  setRowSelection={setRowSelection}
                  locked={isLocked}
                  emptyMsg="Nothing in cleanup. Reject noise/auto from header to populate."
                />
              </Section>

              <Section
                refMap={sectionRefs}
                sectionKey="misses"
                openSections={openSections}
                setOpenSections={setOpenSections}
                color={BUCKET_META.misses.color}
                icon={BUCKET_META.misses.icon}
                title="Suggested misses"
                subtitle="Coverage report — text Stage 2 thinks should be tagged"
                count={stats.misses}
              >
                <MissList
                  misses={filteredMisses}
                  selectedId={selectedId}
                  rowRefs={rowRefs}
                  selectMiss={selectMiss}
                  selectedMissIds={selectedMissIds}
                  toggleMissSelection={toggleMissSelection}
                  setMissSelectionAll={setMissSelectionAll}
                  pushMissesAsTags={pushMissesAsTags}
                  dismissMisses={dismissMisses}
                  locked={isLocked}
                  emptyMsg={searchTerm ? 'No suggested misses match the search.' : 'No suggested misses for this drawing.'}
                />
              </Section>
            </div>

            {/* Inline edit footer */}
            {editingIndex != null && (
              <div className="border-t border-md-outline-variant/20 bg-md-surface-container/60 px-3 py-2 space-y-1.5">
                <div className="text-[10px] uppercase font-bold text-md-on-surface-variant">Edit tag</div>
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full px-2 py-1 bg-md-surface border border-md-primary/40 rounded text-[11px] font-mono text-md-on-surface outline-none"
                />
                <div className="flex items-center gap-1">
                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                    className="px-1.5 py-1 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
                  >
                    {TAG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span className="flex-1" />
                  <button onClick={() => setEditingIndex(null)} className="px-2 py-1 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
                  <button disabled={isLocked} onClick={confirmEdit} className="px-2 py-1 rounded text-[10px] font-bold bg-[#A855F7]/20 text-[#A855F7] border border-[#A855F7]/40 disabled:opacity-40">Save edit</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Multi-select bulk action bar (visible only when rows selected) */}
        {selectedRowIds.size > 0 && (
          <div className="border-t border-[#FACC15]/40 bg-[#1c1c1c]/95 px-3 py-1.5 flex items-center gap-2">
            <span className="text-[11px] font-bold text-[#FACC15]">
              {selectedRowIds.size} selected
            </span>
            <span className="text-[10px] text-md-on-surface-variant ml-1">
              Apply to all selected rows across every section
            </span>
            <span className="flex-1" />
            <button
              onClick={bulkApproveSelected}
              disabled={isLocked}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-[#3BE494]/20 text-[#3BE494] border border-[#3BE494]/40 hover:bg-[#3BE494]/30 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              Approve {selectedRowIds.size}
            </button>
            <button
              onClick={bulkRejectSelected}
              disabled={isLocked}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40 hover:bg-[#EF4444]/30 disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[14px]">cancel</span>
              Reject {selectedRowIds.size}
            </button>
            <button
              onClick={bulkClearSelected}
              disabled={isLocked}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold text-md-on-surface-variant border border-md-outline-variant/40 hover:bg-md-on-surface/10 disabled:opacity-40"
            >
              Clear decisions
            </button>
            <button
              onClick={clearAllSelection}
              className="px-2 py-1 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
              title="Cancel selection"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        )}

        {/* ============================================================== */}
        {/* FOOTER                                                          */}
        {/* ============================================================== */}
        <div className="border-t border-md-outline-variant/15 bg-md-surface-container/40 px-3 py-1.5 flex items-center gap-3">
          <span className="text-[10px] text-md-on-surface-variant">
            On save:
            {' '}<span className="text-[#3BE494] font-bold">{stats.auto + stats.approved} keep</span>
            {' · '}<span className="text-[#E74C3C] font-bold">{stats.rejected} drop</span>
            {' · '}<span className="text-[#F39C12] font-bold">{remainingPending} still pending</span>
          </span>
          {saveReview.isError && (
            <span className="text-[10px] text-[#E74C3C]">Error: {saveReview.error?.message}</span>
          )}
          {saveReview.isSuccess && (
            <span className="text-[10px] text-[#3BE494] font-bold">Saved.</span>
          )}
          <span className="flex-1" />
          {isLoading && <span className="text-[10px] text-md-on-surface-variant">Loading classified tags…</span>}
          {error && <span className="text-[10px] text-[#E74C3C]">Load error: {String(error?.message || error)}</span>}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function KpiCard({ bucket, count, paint, onTogglePaint, onJump }) {
  const meta = BUCKET_META[bucket];
  if (!meta) return null;
  return (
    <div
      className="flex items-center gap-1.5 rounded border px-2 py-1"
      style={{ borderColor: hexAlpha(meta.color, 0.5), background: hexAlpha(meta.color, 0.10) }}
    >
      <button
        onClick={onTogglePaint}
        className="flex items-center justify-center w-5 h-5 rounded border"
        style={{
          borderColor: meta.color,
          background: paint ? meta.color : 'transparent',
          color: paint ? '#0D1F17' : meta.color,
        }}
        title={paint ? 'Hide on canvas' : 'Show on canvas'}
      >
        <span className="material-symbols-outlined text-[12px]">{paint ? 'visibility' : 'visibility_off'}</span>
      </button>
      <button onClick={onJump} className="flex items-center gap-1.5 leading-none" title={meta.hint}>
        <span className="material-symbols-outlined text-[14px]" style={{ color: meta.color }}>{meta.icon}</span>
        <span className="text-[10px] uppercase font-bold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[12px] font-bold" style={{ color: meta.color }}>{count}</span>
      </button>
    </div>
  );
}

function Section({ refMap, sectionKey, openSections, setOpenSections, color, icon, title, subtitle, count, children }) {
  const open = !!openSections[sectionKey];
  return (
    <div
      ref={(el) => { if (el) refMap.current.set(sectionKey, el); else refMap.current.delete(sectionKey); }}
      className="border-b border-md-outline-variant/15"
    >
      <button
        onClick={() => setOpenSections((prev) => ({ ...prev, [sectionKey]: !open }))}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-md-on-surface/5 transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]" style={{ color }}>{icon}</span>
        <span className="text-[11px] font-bold" style={{ color }}>{title}</span>
        <span className="text-[10px] text-md-on-surface-variant ml-1">{subtitle}</span>
        <span className="flex-1" />
        <span className="text-[11px] font-bold" style={{ color }}>{count}</span>
        <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

function ClassGroupedList({
  byClass, selectedId, rowRefs, decisions,
  bulkApprove, bulkReject, applyDecision, clearDecision,
  selectTag, startEdit,
  selectedRowIds, toggleRowSelection, setRowSelection,
  locked = false,
  emptyMsg,
}) {
  // Local class tab — allows the user to focus one class at a time within the
  // section without losing per-class context. Persisted per-section instance.
  const [activeTab, setActiveTab] = useState('all');
  const classKeys = Object.keys(byClass).sort((a, b) => (byClass[b].length - byClass[a].length));
  const totalCount = classKeys.reduce((s, k) => s + byClass[k].length, 0);
  if (classKeys.length === 0) {
    return <div className="px-2 py-2 text-[10px] italic text-md-on-surface-variant">{emptyMsg}</div>;
  }
  const visibleClasses = activeTab === 'all'
    ? classKeys
    : (classKeys.includes(activeTab) ? [activeTab] : []);
  return (
    <div className="space-y-1.5">
      {/* Class tab strip — All + per-class with counts. Click to focus. */}
      <div className="flex items-center gap-1 flex-wrap border-b border-md-outline-variant/10 pb-1">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${activeTab === 'all' ? 'bg-md-on-surface/15 text-md-on-surface' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
        >
          All <span className="text-md-on-surface-variant">{totalCount}</span>
        </button>
        {classKeys.map((cls) => {
          const meta = CLASS_META[cls] || CLASS_META.unknown;
          const isActive = activeTab === cls;
          return (
            <button
              key={cls}
              onClick={() => setActiveTab(cls)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold transition-all border"
              style={{
                color: isActive ? '#0D1F17' : meta.color,
                borderColor: meta.color,
                background: isActive ? meta.color : 'transparent',
              }}
            >
              {meta.label} <span style={{ opacity: 0.85 }}>{byClass[cls].length}</span>
            </button>
          );
        })}
      </div>

      {visibleClasses.length === 0 && (
        <div className="px-2 py-2 text-[10px] italic text-md-on-surface-variant">No tags in this class.</div>
      )}
      {visibleClasses.map((cls) => {
        const meta = CLASS_META[cls] || CLASS_META.unknown;
        const items = byClass[cls];
        const allIndices = items.map((t) => t._index);
        const selectedInGroup = allIndices.filter((idx) => selectedRowIds?.has(idx)).length;
        const allSelected = selectedInGroup === items.length && items.length > 0;
        const someSelected = selectedInGroup > 0 && !allSelected;
        return (
          <div key={cls} className="rounded border border-md-outline-variant/15 bg-md-surface/40 overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 border-b border-md-outline-variant/15" style={{ background: hexAlpha(meta.color, 0.08) }}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected; }}
                onChange={(e) => setRowSelection?.(allIndices, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                disabled={locked}
                className="w-3 h-3 cursor-pointer"
                title={allSelected ? 'Unselect group' : 'Select all in group'}
              />
              <span className="inline-block w-2 h-2 rounded-sm" style={{ background: meta.color }} />
              <span className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="text-[10px] text-md-on-surface-variant">{items.length}</span>
              {selectedInGroup > 0 && (
                <span className="text-[9px] text-[#FACC15] font-bold">({selectedInGroup} sel)</span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => bulkApprove(items)}
                disabled={locked}
                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/20 text-[#3BE494] hover:bg-[#3BE494]/30 disabled:opacity-40"
                title={`Approve all ${items.length} ${meta.label.toLowerCase()}`}
              >Approve all</button>
              <button
                onClick={() => bulkReject(items)}
                disabled={locked}
                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#E74C3C]/20 text-[#E74C3C] hover:bg-[#E74C3C]/30 disabled:opacity-40"
                title={`Reject all ${items.length} ${meta.label.toLowerCase()}`}
              >Reject all</button>
            </div>
            <div className="divide-y divide-md-outline-variant/10">
              {items.map((tag) => (
                <TagRow
                  key={`tag-${tag._index}`}
                  tag={tag}
                  decision={decisions[tag._index]}
                  isSelected={selectedId === tag._index}
                  isChecked={selectedRowIds?.has(tag._index)}
                  onToggleCheck={() => toggleRowSelection?.(tag._index)}
                  locked={locked}
                  rowRefs={rowRefs}
                  onSelect={() => selectTag(tag)}
                  onApprove={() => applyDecision(tag._index, 'approve', { tagText: tag.text, originalType: tag.type })}
                  onReject={() => applyDecision(tag._index, 'reject', { tagText: tag.text, originalType: tag.type })}
                  onEdit={() => startEdit(tag)}
                  onClear={() => clearDecision(tag._index)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TagRow({ tag, decision, isSelected, isChecked, onToggleCheck, rowRefs, onSelect, onApprove, onReject, onEdit, onClear, locked = false }) {
  const conf = pctOf(tag.confidence);
  const action = decision?.action;
  const displayText = decision?.correctedText || tag.text || '';
  // Use corrected type when present so re-classified tags pick up the new
  // class color stripe and label immediately.
  const cls = normalizeType(decision?.correctedType || tag?.type);
  const classMeta = CLASS_META[cls] || CLASS_META.unknown;
  return (
    <div
      ref={(el) => { if (el) rowRefs.current.set(`tag-${tag._index}`, el); else rowRefs.current.delete(`tag-${tag._index}`); }}
      onClick={onSelect}
      style={{ borderLeft: `3px solid ${classMeta.color}` }}
      className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
        isSelected ? 'bg-[#FACC15]/15 ring-1 ring-[#FACC15]' :
        isChecked  ? 'bg-[#FACC15]/8' :
        action === 'approve' ? 'bg-[#3BE494]/8 hover:bg-[#3BE494]/12' :
        action === 'reject'  ? 'bg-[#E74C3C]/8 hover:bg-[#E74C3C]/12' :
        action === 'edit'    ? 'bg-[#A855F7]/8 hover:bg-[#A855F7]/12' :
        'hover:bg-md-on-surface/5'
      }`}
    >
      <input
        type="checkbox"
        checked={!!isChecked}
        onChange={onToggleCheck}
        onClick={(e) => e.stopPropagation()}
        disabled={locked}
        className="w-3 h-3 cursor-pointer"
        title={isChecked ? 'Remove from selection' : 'Add to selection'}
      />
      <span className={`font-mono text-[11px] flex-1 truncate ${action === 'reject' ? 'line-through opacity-60' : ''}`} title={`${tag.text} • ${classMeta.label}`}>
        {displayText}
      </span>
      {decision?.correctedText && decision.correctedText !== tag.text && (
        <span className="text-[9px] text-[#A855F7]">(was {tag.text})</span>
      )}
      <span className="text-[9px] text-md-on-surface-variant w-10 text-right">
        {conf == null ? '—' : `${Math.round(conf)}%`}
      </span>
      <button disabled={locked} onClick={(e) => { e.stopPropagation(); onApprove(); }} title="Approve" className={`p-0.5 rounded transition-colors disabled:opacity-40 ${action === 'approve' ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-md-on-surface-variant/40 hover:text-[#3BE494] hover:bg-[#3BE494]/10'}`}>
        <span className="material-symbols-outlined text-[14px]">check_circle</span>
      </button>
      <button disabled={locked} onClick={(e) => { e.stopPropagation(); onReject(); }} title="Reject" className={`p-0.5 rounded transition-colors disabled:opacity-40 ${action === 'reject' ? 'bg-[#E74C3C]/20 text-[#E74C3C]' : 'text-md-on-surface-variant/40 hover:text-[#E74C3C] hover:bg-[#E74C3C]/10'}`}>
        <span className="material-symbols-outlined text-[14px]">cancel</span>
      </button>
      <button disabled={locked} onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit text/type" className={`p-0.5 rounded transition-colors disabled:opacity-40 ${action === 'edit' ? 'bg-[#A855F7]/20 text-[#A855F7]' : 'text-md-on-surface-variant/40 hover:text-[#A855F7] hover:bg-[#A855F7]/10'}`}>
        <span className="material-symbols-outlined text-[14px]">edit</span>
      </button>
      {action && (
        <button disabled={locked} onClick={(e) => { e.stopPropagation(); onClear(); }} title="Clear decision" className="p-0.5 rounded text-md-on-surface-variant/40 hover:text-md-on-surface hover:bg-md-on-surface/10 disabled:opacity-40">
          <span className="material-symbols-outlined text-[14px]">undo</span>
        </button>
      )}
    </div>
  );
}

function MissList({
  misses, selectedId, rowRefs, selectMiss, emptyMsg,
  selectedMissIds, toggleMissSelection, setMissSelectionAll,
  pushMissesAsTags, dismissMisses,
  locked = false,
}) {
  const [pushType, setPushType] = useState('instrument');
  if (!misses.length) return <div className="px-2 py-2 text-[10px] italic text-md-on-surface-variant">{emptyMsg}</div>;
  const allIds = misses.map((m) => `miss-${m._missIndex}`);
  const selectedCount = allIds.filter((id) => selectedMissIds?.has(id)).length;
  const allSelected = selectedCount === misses.length && misses.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;
  const selectedMisses = misses.filter((m) => selectedMissIds?.has(`miss-${m._missIndex}`));
  return (
    <div className="space-y-1.5">
      {/* Bulk action bar for misses — checkboxes + push/dismiss */}
      <div className="flex items-center gap-2 px-2 py-1 rounded border border-md-outline-variant/15 bg-md-surface/40">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={(e) => setMissSelectionAll?.(allIds, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          disabled={locked}
          className="w-3 h-3 cursor-pointer"
          title={allSelected ? 'Unselect all misses' : 'Select all misses'}
        />
        <span className="text-[10px] font-bold text-md-on-surface-variant">
          {selectedCount > 0 ? `${selectedCount} sel` : `${misses.length} misses`}
        </span>
        <span className="flex-1" />
        <select
          value={pushType}
          onChange={(e) => setPushType(e.target.value)}
          disabled={locked}
          className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
          title="Class to assign when pushing selected misses to tags"
        >
          {Object.keys(CLASS_META).filter((c) => c !== 'unknown').map((c) => (
            <option key={c} value={c}>{CLASS_META[c].label}</option>
          ))}
        </select>
        <button
          onClick={() => pushMissesAsTags?.(selectedMisses, pushType)}
          disabled={locked || selectedCount === 0}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/20 text-[#3BE494] hover:bg-[#3BE494]/30 disabled:opacity-30"
          title={`Push ${selectedCount} selected misses to tags as ${CLASS_META[pushType]?.label || pushType}`}
        >
          Push to tags ({selectedCount})
        </button>
        <button
          onClick={() => dismissMisses?.(selectedMisses)}
          disabled={locked || selectedCount === 0}
          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#E74C3C]/15 text-[#E74C3C] hover:bg-[#E74C3C]/25 disabled:opacity-30"
          title={`Dismiss ${selectedCount} selected misses`}
        >
          Dismiss ({selectedCount})
        </button>
      </div>

      <div className="rounded border border-md-outline-variant/15 bg-md-surface/40 overflow-hidden divide-y divide-md-outline-variant/10">
        {misses.map((m) => {
          const id = `miss-${m._missIndex}`;
          const isSelected = selectedId === id;
          const isChecked = selectedMissIds?.has(id);
          return (
            <div
              key={id}
              ref={(el) => { if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id); }}
              onClick={() => selectMiss(m)}
              className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors ${
                isSelected ? 'bg-[#FACC15]/15 ring-1 ring-[#FACC15]' :
                isChecked  ? 'bg-[#FACC15]/8' :
                'hover:bg-md-on-surface/5'
              }`}
            >
              <input
                type="checkbox"
                checked={!!isChecked}
                onChange={(e) => { e.stopPropagation(); toggleMissSelection?.(id); }}
                onClick={(e) => e.stopPropagation()}
                disabled={locked}
                className="w-3 h-3 cursor-pointer"
                title={isChecked ? 'Remove from selection' : 'Add to selection'}
              />
              <span className="material-symbols-outlined text-[12px] text-[#A855F7]">help</span>
              <span className="font-mono text-[11px] flex-1 truncate" title={m.text}>{m.text}</span>
              <span className="text-[9px] text-md-on-surface-variant truncate max-w-[140px]" title={m.reason}>{m.reason}</span>
              <button
                onClick={(e) => { e.stopPropagation(); pushMissesAsTags?.([m], pushType); }}
                disabled={locked}
                title={`Push as ${CLASS_META[pushType]?.label || pushType}`}
                className="p-0.5 rounded text-md-on-surface-variant/40 hover:text-[#3BE494] hover:bg-[#3BE494]/10 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">add_circle</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); dismissMisses?.([m]); }}
                disabled={locked}
                title="Dismiss this miss"
                className="p-0.5 rounded text-md-on-surface-variant/40 hover:text-[#E74C3C] hover:bg-[#E74C3C]/10 disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function togglePaint(set, setSet, key) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  setSet(next);
}

function jumpSection(refMap, key) {
  const node = refMap.current.get(key);
  if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function hexAlpha(hex, alpha) {
  // hex: '#RRGGBB' → 'rgba(...)' with the requested alpha
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return hex;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Floating canvas tool palette — pin to top-left of the canvas surface.
function CanvasToolPalette({ tool, setTool, onAdd, hasSelection, onEditBboxSelected, onDeleteSelected, locked = false }) {
  const Btn = ({ id, icon, color, hint, onClick }) => {
    const isActive = tool === id;
    return (
      <button
        onClick={onClick || (() => setTool(id))}
        disabled={locked}
        className="flex items-center justify-center w-7 h-7 rounded border transition-all disabled:opacity-35"
        style={{
          color,
          borderColor: color,
          background: isActive ? color + '40' : 'rgba(13,31,23,0.85)',
          boxShadow: isActive ? `0 0 0 2px ${color}60` : 'none',
        }}
        title={hint}
      >
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      </button>
    );
  };
  return (
    <div
      className="flex flex-col gap-1 p-1 rounded border border-md-outline-variant/40 bg-[#0D1F17]/95 shadow-lg"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Btn id="select"    icon="near_me"      color="#3BE494" hint="Select (default) — click a tag to focus, then act on it from list or tools below" />
      <Btn id="approve"   icon="check"        color="#22C55E" hint="Approve on click — click any tag to approve" />
      <Btn id="reject"    icon="close"        color="#EF4444" hint="Reject on click — click any tag to reject" />
      <Btn id="edit-bbox" icon="aspect_ratio" color="#FACC15" hint="Adjust bbox on click — click any tag to drag handles" />
      <Btn id="delete"    icon="delete"       color="#EF4444" hint="Delete on click — rejects with note" />
      <div className="h-px bg-md-outline-variant/30 my-0.5" />
      <button
        onClick={() => { setTool('select'); onAdd?.(); }}
        disabled={locked}
        className="flex items-center justify-center w-7 h-7 rounded border disabled:opacity-35"
        style={{ color: '#06B6D4', borderColor: '#06B6D4', background: tool === 'add' ? '#06B6D440' : 'rgba(13,31,23,0.85)' }}
        title="Add new tag — free-draw a rectangle on the canvas"
      ><span className="material-symbols-outlined text-[16px]">add_box</span></button>
      <button
        onClick={() => hasSelection && onEditBboxSelected?.()}
        disabled={locked || !hasSelection}
        className="flex items-center justify-center w-7 h-7 rounded border disabled:opacity-30"
        style={{ color: '#FACC15', borderColor: '#FACC15', background: 'rgba(13,31,23,0.85)' }}
        title={hasSelection ? 'Adjust bbox of currently selected tag' : 'Select a tag first to enable bbox edit'}
      ><span className="material-symbols-outlined text-[16px]">crop_free</span></button>
      <button
        onClick={() => hasSelection && onDeleteSelected?.()}
        disabled={locked || !hasSelection}
        className="flex items-center justify-center w-7 h-7 rounded border disabled:opacity-30"
        style={{ color: '#EF4444', borderColor: '#EF4444', background: 'rgba(13,31,23,0.85)' }}
        title={hasSelection ? 'Delete currently selected tag (Del)' : 'Select a tag first'}
      ><span className="material-symbols-outlined text-[16px]">delete_forever</span></button>
    </div>
  );
}

// Inject pulse animation styles (idempotent).
if (typeof document !== 'undefined' && !document.getElementById('rw-pulse-style')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'rw-pulse-style';
  styleEl.textContent = `
    @keyframes rw-pulse {
      0%   { box-shadow: 0 0 0 0  rgba(250,204,21,0.85), 0 0 16px rgba(250,204,21,0.55); }
      50%  { box-shadow: 0 0 0 10px rgba(250,204,21,0.0),  0 0 22px rgba(250,204,21,0.85); }
      100% { box-shadow: 0 0 0 0  rgba(250,204,21,0.0),  0 0 16px rgba(250,204,21,0.55); }
    }
    .rw-pulse { animation: rw-pulse 1.4s ease-out 2; }
  `;
  document.head.appendChild(styleEl);
}
