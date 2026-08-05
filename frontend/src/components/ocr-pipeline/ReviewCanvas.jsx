import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PdfCanvas from '../pnid/PdfCanvas';
import { useStageFile, useSaveReview } from '../../hooks/useOcrPipelineV2';

/**
 * ReviewCanvas
 * Phase 2 of the new end-user Review workflow.  Replaces the table-centric
 * legacy editor with a canvas-first surface driven by a single mode machine:
 *
 *   NAVIGATE   default; pan / zoom / click a tag to focus it
 *   EDIT_TEXT  text + classification edit on the focused tag
 *   EDIT_BBOX  8-handle drag to resize/translate the focused tag
 *   ADD_TAG    free-draw a new rectangle, then enter text + classification
 *
 * Keyboard:
 *   A approve  R reject  E edit text  B edit bbox  N add new
 *   Arrow keys navigate prev/next in the queue
 *   Esc back to NAVIGATE mode
 *
 * Props:
 *   batchId, file, threshold (from triage), onClose, onOpenLegacy
 */

const TAG_TYPES = ['instrument', 'equipment', 'line', 'drawing_ref'];

const TYPE_STYLES = {
  instrument:  { fill: 'rgba(243,156,18,0.32)',  border: '#F39C12' },
  equipment:   { fill: 'rgba(59,228,148,0.32)',  border: '#3BE494' },
  line:        { fill: 'rgba(45,51,224,0.32)',   border: '#2D33E0' },
  drawing_ref: { fill: 'rgba(168,85,247,0.32)',  border: '#A855F7' },
  noise:       { fill: 'rgba(231,76,60,0.18)',   border: '#E74C3C' },
  unknown:     { fill: 'rgba(148,163,184,0.18)', border: '#94A3B8' },
  manual:      { fill: 'rgba(236,72,153,0.32)',  border: '#EC4899' },
};
function styleForType(t) { return TYPE_STYLES[t] || TYPE_STYLES.unknown; }

const ACTION_STYLES = {
  approve:   { fill: 'rgba(34,197,94,0.20)',   border: '#22C55E', label: 'approved' },
  reject:    { fill: 'rgba(239,68,68,0.18)',   border: '#EF4444', label: 'rejected' },
  edit:      { fill: 'rgba(168,85,247,0.20)',  border: '#A855F7', label: 'edited' },
  // Synthetic statuses (not stored as a real decision until "Save & close")
  auto:      { fill: 'rgba(59,228,148,0.16)',  border: '#3BE494', label: 'auto-accepted' },
  pending:   { fill: 'rgba(243,156,18,0.20)',  border: '#F39C12', label: 'pending' },
  manual:    { fill: 'rgba(236,72,153,0.32)',  border: '#EC4899', label: 'manual add' },
  miss:      { fill: 'rgba(239,68,68,0.10)',   border: '#EF4444', label: 'missed (suggested)' },
};

function pctOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1.5) return Math.min(100, Math.max(0, n));
  return Math.min(100, Math.max(0, n * 100));
}

function isConflictTag(tag) {
  if (!tag) return false;
  if (Array.isArray(tag.conflictWith) && tag.conflictWith.length > 0) return true;
  const reason = String(tag.reasonCode || tag.reason_code || '').toLowerCase();
  if (reason.startsWith('conflict')) return true;
  if (!tag.type || tag.type === 'unknown') return true;
  return false;
}

function getTagPositionPct(tag, decisions) {
  const dec = decisions[tag?._index];
  const p = dec?.correctedPositionPct || tag?.position_pct || tag?.positionPct;
  if (!p) return null;
  return {
    x_pct: Number(p.x_pct ?? p.xPct ?? 0),
    y_pct: Number(p.y_pct ?? p.yPct ?? 0),
    w_pct: Number(p.w_pct ?? p.wPct ?? 0),
    h_pct: Number(p.h_pct ?? p.hPct ?? 0),
  };
}

function pctBoxToPx(pct, dims) {
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

function spatialKey(tag, decisions) {
  const p = getTagPositionPct(tag, decisions) || { x_pct: 1e6, y_pct: 1e6 };
  // Sort top-to-bottom, then left-to-right, banded so items in the same row stay together.
  const band = Math.floor(p.y_pct / 3);
  return band * 1e4 + p.x_pct;
}

export default function ReviewCanvas({
  batchId,
  file,
  threshold = 92,
  onClose,
  onOpenLegacy,
}) {
  const { data, isLoading, error, refetch } = useStageFile(batchId, file?.id, 'cleaned');
  const saveReview = useSaveReview();

  // ── Source data ─────────────────────────────────────────────────────────
  const classified = data?.data || null;
  const pageW = Number(classified?.pageWidth || 2400);
  const pageH = Number(classified?.pageHeight || 1700);

  // Reviewable tag list with stable indices matching what /save-review expects.
  // Index space: [...tags, ...uncertain, ...noise, ...manualTags(idx>=1e6)]
  const baseReviewable = useMemo(() => {
    if (!classified) return [];
    const tags = (classified.tags || []).map((t, i) => ({ ...t, _index: i, _source: 'tag' }));
    const unc  = (classified.uncertain || []).map((t, i) => ({ ...t, _index: tags.length + i, _source: 'uncertain' }));
    const noise = (classified.noise || []).map((t, i) => ({
      ...t,
      _index: tags.length + unc.length + i,
      _source: 'noise',
      type: t.type || 'noise',
    }));
    return [...tags, ...unc, ...noise];
  }, [classified]);

  // ── Component state ────────────────────────────────────────────────────
  const [decisions, setDecisions] = useState({});
  const [manualTags, setManualTags] = useState([]);
  const [mode, setMode] = useState('NAVIGATE');
  const [canvasTool, setCanvasTool] = useState('select');
  const [selectedSet, setSelectedSet] = useState(() => new Set());
  const [queueOrder, setQueueOrder] = useState('spatial');
  const [queueIndex, setQueueIndex] = useState(0);
  // Visibility filter: controls what is painted on the canvas + listed in the queue.
  // 'pending' = items still needing a decision (default); 'all' = everything;
  // 'approved'/'rejected'/'edited'/'manual' = decided buckets.
  const [filter, setFilter] = useState('pending');
  // Always overlay missed-tag suggestions (independent of which filter is active).
  const [alwaysShowMisses, setAlwaysShowMisses] = useState(true);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState('');
  const [bboxDraft, setBboxDraft] = useState(null);
  const [addDraft, setAddDraft] = useState(null);
  const [addText, setAddText] = useState('');
  const [addType, setAddType] = useState('instrument');
  const [zoom, setZoom] = useState(100);
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [pdfData, setPdfData] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const scrollRef = useRef(null);
  const dragStateRef = useRef(null);
  const manualIdxRef = useRef(1000000);
  const recordDecisionTrackedRef = useRef(null);
  const enterEditTextRef = useRef(null);
  const enterEditBboxRef = useRef(null);
  const deleteTagViaToolRef = useRef(null);

  // Reset queue index when the filter changes (lists differ in length).
  useEffect(() => {
    setQueueIndex(0);
    setSelectedSet(new Set());
  }, [filter]);

  // Reset on file switch
  useEffect(() => {
    setDecisions({});
    setManualTags([]);
    setMode('NAVIGATE');
    setQueueIndex(0);
    setEditText('');
    setEditType('');
    setBboxDraft(null);
    setAddDraft(null);
    setAddText('');
    setAddType('instrument');
    setSaveErr('');
  }, [file?.id]);

  // Combined pool with manual additions
  const reviewable = useMemo(
    () => [...baseReviewable, ...manualTags],
    [baseReviewable, manualTags],
  );

  // Helper: a tag NEEDS a decision iff it has no decision yet AND
  // (it's a conflict OR confidence is missing OR below the threshold from triage).
  const isPending = useCallback((t) => {
    if (!t) return false;
    if (t._source === 'noise') return false;
    if (decisions[t._index]?.action != null) return false;
    if (isConflictTag(t)) return true;
    const conf = pctOf(t.confidence);
    if (conf == null || conf < threshold) return true;
    return false;
  }, [decisions, threshold]);

  // Filter buckets — used both for the toolbar pill counts and for paint+queue
  // visibility filtering.  Each tag falls into exactly ONE bucket per render.
  const buckets = useMemo(() => {
    const b = { pending: [], approved: [], rejected: [], edited: [], manual: [], auto: [] };
    for (const t of reviewable) {
      if (t._source === 'manual') { b.manual.push(t); continue; }
      const dec = decisions[t._index];
      if (!dec) {
        if (isPending(t)) b.pending.push(t);
        else b.auto.push(t);   // implicitly auto-accept-eligible
        continue;
      }
      if (dec.action === 'approve') b.approved.push(t);
      else if (dec.action === 'reject') b.rejected.push(t);
      else if (dec.action === 'edit') b.edited.push(t);
    }
    return b;
  }, [reviewable, decisions, isPending]);


  // Coverage / visual-audit suggested misses.  Painted as dashed red boxes so
  // the user can see "what was missed" without having to dig into a panel.
  const misses = useMemo(() => {
    const va = Array.isArray(classified?.visualAudit?.misses) ? classified.visualAudit.misses : [];
    const cv = Array.isArray(classified?.coverageReport?.missingFromCleaned) ? classified.coverageReport.missingFromCleaned : [];
    const out = [];
    let mi = 0;
    for (const m of [...va, ...cv]) {
      const p = m?.position_pct || m?.positionPct || null;
      if (!p) continue;
      const w = Number(p.w_pct ?? p.wPct ?? 0);
      const h = Number(p.h_pct ?? p.hPct ?? 0);
      if (w <= 0 || h <= 0) continue;
      const text = String(m?.textCandidate || m?.text || m?.candidate_text_norm || '').trim();
      if (!text) continue;
      out.push({
        _missIndex: mi++,
        text,
        position_pct: {
          x_pct: Number(p.x_pct ?? p.xPct ?? 0),
          y_pct: Number(p.y_pct ?? p.yPct ?? 0),
          w_pct: w,
          h_pct: h,
        },
        reason: m?.reason || m?.reason_code || 'missing_from_cleaned',
      });
    }
    return out;
  }, [classified]);


  // Status string used for icons + tooltips; reflects the CURRENT user state.
  const statusOf = useCallback((tag) => {
    if (!tag) return 'pending';
    if (tag._source === 'manual') return 'manual';
    const dec = decisions[tag._index];
    if (dec?.action === 'approve') return 'approve';
    if (dec?.action === 'reject')  return 'reject';
    if (dec?.action === 'edit')    return 'edit';
    if (isPending(tag)) return 'pending';
    return 'auto';
  }, [decisions, isPending]);

  // ── Build the queue (visible items, ordered by user choice) ────────────
  const queue = useMemo(() => {
    let items;
    if (filter === 'all') {
      items = reviewable.filter(t => t._source !== 'noise' || decisions[t._index]?.action != null);
    } else if (filter === 'miss') {
      items = misses.map(m => ({
        _index: -1000 - m._missIndex,
        _source: 'miss',
        text: m.text,
        type: 'unknown',
        confidence: null,
        position_pct: m.position_pct,
        _miss: m,
      }));
    } else if (filter === 'pending') {
      items = reviewable.filter(t => {
        if (t._source === 'manual') return false;
        if (t._source === 'noise') return false;
        const dec = decisions[t._index];
        if (dec) return true;
        const conf = pctOf(t.confidence);
        if (isConflictTag(t)) return true;
        if (conf == null || conf < threshold) return true;
        return false;
      });
    } else {
      items = buckets[filter] || [];
    }
    items = [...items];
    if (queueOrder === 'spatial')    items.sort((a, b) => spatialKey(a, decisions) - spatialKey(b, decisions));
    if (queueOrder === 'confidence') items.sort((a, b) => (pctOf(a.confidence) ?? -1) - (pctOf(b.confidence) ?? -1));
    if (queueOrder === 'class')      items.sort((a, b) => String(a.type || '').localeCompare(String(b.type || '')));
    return items;
  }, [reviewable, decisions, buckets, filter, queueOrder, misses, threshold]);

  const focusTag = queue[Math.min(queueIndex, Math.max(0, queue.length - 1))] || null;



  // ── Load PDF binary ────────────────────────────────────────────────────
  useEffect(() => {
    if (!file?.storageKey) return;
    const API = import.meta.env.VITE_API_URL || '/api/v1';
    const url = `${API}/storage/files/${encodeURIComponent(file.storageKey)}`;
    let cancelled = false;
    setPdfLoading(true); setPdfError(''); setPdfData(null); setPageDims({ width: 0, height: 0 });
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        setPdfData(new Uint8Array(buf));
      })
      .catch((err) => { if (!cancelled) setPdfError(err?.message || 'PDF load failed'); })
      .finally(() => { if (!cancelled) setPdfLoading(false); });
    return () => { cancelled = true; };
  }, [file?.storageKey]);

  // Fit-to-viewport on first render
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pageDims.width || !pageDims.height) return;
    const fitW = (el.clientWidth - 16) / pageDims.width;
    const fitH = (el.clientHeight - 16) / pageDims.height;
    const fit = Math.max(0.2, Math.min(4, Math.min(fitW, fitH)));
    setZoom(Math.round(fit * 100));
  }, [pageDims.width, pageDims.height]);

  // Auto-scroll the canvas to the current focus item.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !focusTag || !pageDims.width) return;
    const pct = getTagPositionPct(focusTag, decisions);
    if (!pct) return;
    const cx = ((pct.x_pct + pct.w_pct / 2) / 100) * pageDims.width * (zoom / 100);
    const cy = ((pct.y_pct + pct.h_pct / 2) / 100) * pageDims.height * (zoom / 100);
    el.scrollTo({
      left: Math.max(0, cx - el.clientWidth / 2),
      top:  Math.max(0, cy - el.clientHeight / 2),
      behavior: 'smooth',
    });
  }, [focusTag?._index, pageDims.width, pageDims.height, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Decision recording ────────────────────────────────────────────────
  const recordDecision = useCallback((tag, action, extra = {}) => {
    if (!tag) return;
    setDecisions((prev) => ({
      ...prev,
      [tag._index]: {
        index: tag._index,
        tagText: tag.text,
        originalType: tag.type,
        action,
        decisionSource: 'explicit',
        ...extra,
      },
    }));
  }, []);

  const advance = useCallback(() => {
    setQueueIndex((idx) => Math.min(idx, Math.max(0, queue.length - 2)));
  }, [queue.length]);

  const deleteCurrent = useCallback(() => {
    if (!focusTag) return;
    if (focusTag._source === 'miss') {
      setQueueIndex((i) => Math.min(queue.length - 1, i + 1));
      return;
    }
    if (focusTag._source === 'manual') {
      setManualTags((prev) => prev.filter(t => t._index !== focusTag._index));
      setDecisions((prev) => {
        const { [focusTag._index]: _omit, ...rest } = prev;
        return rest;
      });
      advance();
      return;
    }
    recordDecision(focusTag, 'reject', { notes: 'deleted by user' });
    advance();
  }, [focusTag, recordDecision, advance, queue.length]);

  const promoteMissToTag = useCallback(() => {
    if (!focusTag || focusTag._source !== 'miss') return;
    const idx = manualIdxRef.current++;
    const newTag = {
      _index: idx,
      _source: 'manual',
      text: focusTag.text || '',
      type: 'instrument',
      confidence: 1,
      position_pct: focusTag.position_pct,
    };
    setManualTags((prev) => [...prev, newTag]);
    setDecisions((prev) => ({
      ...prev,
      [idx]: {
        index: idx,
        tagText: newTag.text,
        originalType: 'unknown',
        action: 'edit',
        correctedText: newTag.text,
        correctedType: newTag.type,
        correctedPositionPct: newTag.position_pct,
        decisionSource: 'promoted_from_miss',
      },
    }));
    setFilter('manual');
  }, [focusTag]);

  const lastDecisionRef = useRef(null);

  const recordDecisionTracked = useCallback((tag, action, extra = {}) => {
    if (!tag) return;
    lastDecisionRef.current = { index: tag._index, previous: decisions[tag._index] || null };
    recordDecision(tag, action, extra);
  }, [decisions, recordDecision]);

  const bulkApproveVisible = useCallback(() => {
    if (!queue.length) return;
    const useSelection = selectedSet.size > 0;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of queue) {
        if (useSelection && !selectedSet.has(t._index)) continue;
        if (t._source === 'miss' || t._source === 'manual') continue;
        next[t._index] = { index: t._index, tagText: t.text, originalType: t.type, action: 'approve', decisionSource: useSelection ? 'bulk_selected' : 'bulk_visible' };
      }
      return next;
    });
  }, [queue, selectedSet]);

  const bulkRejectVisible = useCallback(() => {
    if (!queue.length) return;
    const useSelection = selectedSet.size > 0;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of queue) {
        if (useSelection && !selectedSet.has(t._index)) continue;
        if (t._source === 'miss' || t._source === 'manual') continue;
        next[t._index] = { index: t._index, tagText: t.text, originalType: t.type, action: 'reject', decisionSource: useSelection ? 'bulk_selected' : 'bulk_visible', notes: 'bulk-rejected from queue' };
      }
      return next;
    });
  }, [queue, selectedSet]);

  const clearDecisionsVisible = useCallback(() => {
    if (!queue.length) return;
    const useSelection = selectedSet.size > 0;
    setDecisions((prev) => {
      const next = { ...prev };
      for (const t of queue) {
        if (useSelection && !selectedSet.has(t._index)) continue;
        if (next[t._index]) delete next[t._index];
      }
      return next;
    });
  }, [queue, selectedSet]);

  const undoLast = useCallback(() => {
    const last = lastDecisionRef.current;
    if (!last) return;
    setDecisions((prev) => {
      const next = { ...prev };
      if (last.previous) next[last.index] = last.previous;
      else delete next[last.index];
      return next;
    });
    lastDecisionRef.current = null;
  }, []);

  // ── Mode entry helpers ────────────────────────────────────────────────
  const enterEditText = useCallback(() => {
    if (!focusTag) return;
    setEditText(decisions[focusTag._index]?.correctedText ?? focusTag.text ?? '');
    setEditType(decisions[focusTag._index]?.correctedType ?? focusTag.type ?? 'instrument');
    setMode('EDIT_TEXT');
  }, [focusTag, decisions]);

  const enterEditBbox = useCallback(() => {
    if (!focusTag) return;
    const cur = getTagPositionPct(focusTag, decisions);
    setBboxDraft(cur ? { ...cur } : null);
    setMode('EDIT_BBOX');
  }, [focusTag, decisions]);

  // Combined edit: text + type + bbox all editable on the same right-panel form.
  // The bbox handles still draw on the canvas; the text/type fields live in the
  // panel.  Save commits a single \'edit\' decision with all three fields.
  const enterEditBoth = useCallback(() => {
    if (!focusTag) return;
    setEditText(decisions[focusTag._index]?.correctedText ?? focusTag.text ?? '');
    setEditType(decisions[focusTag._index]?.correctedType ?? focusTag.type ?? 'instrument');
    const cur = getTagPositionPct(focusTag, decisions);
    setBboxDraft(cur ? { ...cur } : null);
    setMode('EDIT_BOTH');
  }, [focusTag, decisions]);

  const enterAdd = useCallback(() => {
    setAddDraft(null);
    setAddText('');
    setAddType('instrument');
    setMode('ADD_TAG');
  }, []);

  const cancelMode = useCallback(() => {
    setMode('NAVIGATE');
    setBboxDraft(null);
    setAddDraft(null);
  }, []);

  // ── Approve / Reject from current mode ────────────────────────────────
  const approveCurrent = useCallback(() => {
    if (!focusTag) return;
    recordDecisionTracked(focusTag, 'approve');
    advance();
  }, [focusTag, recordDecisionTracked, advance]);

  const rejectCurrent = useCallback(() => {
    if (!focusTag) return;
    recordDecisionTracked(focusTag, 'reject');
    advance();
  }, [focusTag, recordDecisionTracked, advance]);

  const saveTextEdit = useCallback(() => {
    if (!focusTag) return;
    recordDecision(focusTag, 'edit', { correctedText: editText, correctedType: editType });
    setMode('NAVIGATE');
    advance();
  }, [focusTag, editText, editType, recordDecision, advance]);

  const saveBboxEdit = useCallback(() => {
    if (!focusTag || !bboxDraft) return;
    recordDecision(focusTag, 'edit', {
      correctedText: focusTag.text,
      correctedType: focusTag.type,
      correctedPositionPct: bboxDraft,
    });
    setMode('NAVIGATE');
    setBboxDraft(null);
  }, [focusTag, bboxDraft, recordDecision]);

  // Save the combined text + type + bbox edit in a single decision.
  const saveBothEdit = useCallback(() => {
    if (!focusTag) return;
    recordDecision(focusTag, 'edit', {
      correctedText: editText,
      correctedType: editType,
      correctedPositionPct: bboxDraft || getTagPositionPct(focusTag, decisions),
    });
    setMode('NAVIGATE');
    setBboxDraft(null);
    advance();
  }, [focusTag, editText, editType, bboxDraft, decisions, recordDecision, advance]);

  const saveAddTag = useCallback(() => {
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
        tagText: newTag.text,
        originalType: 'unknown',
        action: 'edit',
        correctedText: newTag.text,
        correctedType: newTag.type,
        correctedPositionPct: addDraft,
        decisionSource: 'manual_add',
      },
    }));
    setMode('NAVIGATE');
    setAddDraft(null);
    setAddText('');
  }, [addDraft, addText, addType]);

  // ── Bbox drag (8 handles + body translate) ─────────────────────────────
  const onBboxHandleMouseDown = useCallback((handle, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!bboxDraft || !pageDims.width) return;
    const startPx = pctBoxToPx(bboxDraft, pageDims);
    dragStateRef.current = {
      kind: 'bbox',
      handle,
      startPx,
      startMouse: { x: e.clientX, y: e.clientY },
      zoom: zoom / 100,
    };
  }, [bboxDraft, pageDims, zoom]);

  // ── Add-tag drag (free-draw rectangle) ─────────────────────────────────
  const onCanvasMouseDown = useCallback((e) => {
    if (mode !== 'ADD_TAG') return;
    if (!pageDims.width) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoom / 100);
    const y = (e.clientY - rect.top)  / (zoom / 100);
    dragStateRef.current = {
      kind: 'add',
      origin: { x, y },
      current: { x, y },
    };
    setAddDraft(pxBoxToPct({ x, y, w: 1, h: 1 }, pageDims));
  }, [mode, pageDims, zoom]);

  // Global mouse-move + mouse-up for both bbox and add drag.
  useEffect(() => {
    const onMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      if (st.kind === 'bbox') {
        const dx = (e.clientX - st.startMouse.x) / st.zoom;
        const dy = (e.clientY - st.startMouse.y) / st.zoom;
        const { startPx, handle } = st;
        let { x, y, w, h } = startPx;
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
        const cx = (e.clientX - rect.left + el.scrollLeft) / (zoom / 100);
        const cy = (e.clientY - rect.top  + el.scrollTop)  / (zoom / 100);
        st.current = { x: cx, y: cy };
        const x = Math.min(st.origin.x, cx);
        const y = Math.min(st.origin.y, cy);
        const w = Math.max(2, Math.abs(cx - st.origin.x));
        const h = Math.max(2, Math.abs(cy - st.origin.y));
        setAddDraft(pxBoxToPct({ x, y, w, h }, pageDims));
      }
    };
    const onUp = () => { dragStateRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pageDims, zoom]);

  // Keep tool-action refs in sync with their latest callback identities.
  useEffect(() => {
    recordDecisionTrackedRef.current = recordDecisionTracked;
    enterEditTextRef.current = enterEditText;
    enterEditBboxRef.current = enterEditBbox;
    deleteTagViaToolRef.current = (tag) => {
      if (!tag) return;
      if (tag._source === 'miss') return;
      if (tag._source === 'manual') {
        setManualTags((prev) => prev.filter(t => t._index !== tag._index));
        setDecisions((prev) => {
          const { [tag._index]: _omit, ...rest } = prev;
          return rest;
        });
        return;
      }
      recordDecisionTracked(tag, 'reject', { notes: 'deleted via canvas tool' });
    };
  }, [recordDecisionTracked, enterEditText, enterEditBbox]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when user is typing in an input/textarea.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { cancelMode(); setCanvasTool('select'); return; }
      if (mode !== 'NAVIGATE') return;
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); approveCurrent(); }
      else if (k === 'r') { e.preventDefault(); rejectCurrent(); }
      else if (k === 'd') { e.preventDefault(); deleteCurrent(); }
      else if (k === 'e') { e.preventDefault(); enterEditText(); }
      else if (k === 'b') { e.preventDefault(); enterEditBbox(); }
      else if (k === 'm') { e.preventDefault(); enterEditBoth(); }
      else if (k === 'n') { e.preventDefault(); enterAdd(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setQueueIndex((i) => Math.min(queue.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp'   || e.key === 'ArrowLeft')  { e.preventDefault(); setQueueIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, approveCurrent, rejectCurrent, deleteCurrent, enterEditText, enterEditBbox, enterEditBoth, enterAdd, cancelMode, queue.length]);

  // ── Save & close ──────────────────────────────────────────────────────
  const decidedCount = Object.keys(decisions).length;
  const handleSaveAndClose = async () => {
    if (decidedCount === 0) { onClose?.(); return; }
    setSaveErr('');
    try {
      const list = Object.values(decisions);
      await saveReview.mutateAsync({ batchId, fileId: file.id, decisions: list });
      await refetch();
      onClose?.();
    } catch (e) {
      setSaveErr(e?.message || String(e));
    }
  };

  // Click-on-canvas: dispatch based on the active canvas tool.
  const focusTagByClick = useCallback((tag) => {
    const i = queue.findIndex(q => q._index === tag._index);
    if (i >= 0) setQueueIndex(i);
    else {
      setFilter('all');
      setTimeout(() => {
        const j = (buckets.pending.concat(buckets.approved, buckets.rejected, buckets.edited, buckets.manual))
          .findIndex(q => q._index === tag._index);
        if (j >= 0) setQueueIndex(j);
      }, 0);
    }
    if (canvasTool === 'select') return;
    if (tag._source === 'miss') return;
    if (canvasTool === 'approve')      recordDecisionTrackedRef.current?.(tag, 'approve');
    else if (canvasTool === 'reject')  recordDecisionTrackedRef.current?.(tag, 'reject');
    else if (canvasTool === 'delete')  deleteTagViaToolRef.current?.(tag);
    else if (canvasTool === 'edit-text') setTimeout(() => enterEditTextRef.current?.(), 0);
    else if (canvasTool === 'edit-bbox') setTimeout(() => enterEditBboxRef.current?.(), 0);
  }, [queue, buckets, canvasTool]);

  // Decision-status badge (tiny icon overlaid in the bbox).
  const badgeForStatus = (status) => {
    if (status === 'approve') return { ch: '✓', color: '#22C55E' };
    if (status === 'reject')  return { ch: '✕', color: '#EF4444' };
    if (status === 'edit')    return { ch: '✎', color: '#A855F7' };
    if (status === 'manual')  return { ch: '+',     color: '#EC4899' };
    if (status === 'auto')    return { ch: 'a',     color: '#3BE494' };
    if (status === 'pending') return { ch: '?',     color: '#F39C12' };
    return null;
  };

  // ── Render helpers ─────────────────────────────────────────────────────
  const renderTagBox = (tag, key, opts = {}) => {
    const pct = opts.overridePct || getTagPositionPct(tag, decisions);
    if (!pct) return null;
    const box = pctBoxToPx(pct, pageDims);
    if (!box) return null;
    const isFocus = focusTag && focusTag._index === tag._index;
    const status = statusOf(tag);
    const dec = decisions[tag._index];
    // Status takes priority over type for fill/border colour so the user
    // can see "what they\'ve done" + "what\'s left" at a glance.
    const style = ACTION_STYLES[status] || styleForType(tag.type);
    const badge = badgeForStatus(status);
    const badgeSize = Math.min(14, Math.max(8, Math.min(box.w, box.h) * 0.6));
    return (
      <div
        key={key}
        onClick={(e) => { e.stopPropagation(); focusTagByClick(tag); }}
        className="absolute pointer-events-auto cursor-pointer"
        style={{
          left: box.x, top: box.y, width: box.w, height: box.h,
          background: style.fill,
          border: `${isFocus ? 3 : 1}px solid ${isFocus ? '#FACC15' : style.border}`,
          boxShadow: isFocus ? `0 0 0 4px rgba(250,204,21,0.45), 0 0 12px rgba(250,204,21,0.5)` : 'none',
        }}
        title={`[${tag.type || tag._source}] "${tag.text}" - ${ACTION_STYLES[status]?.label || status}${dec?.correctedText ? ` (was: ${tag.text})` : ''}`}
      >
        {badge && (
          <span
            className="absolute pointer-events-none font-bold"
            style={{
              right: 1, top: -1,
              color: badge.color,
              fontSize: badgeSize,
              lineHeight: 1,
              textShadow: '0 0 2px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)',
            }}
          >{badge.ch}</span>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <Frame title={file?.filename} onClose={onClose}><Loading text="Loading classified tags…" /></Frame>;
  }
  if (error) {
    return <Frame title={file?.filename} onClose={onClose}><Loading text={`Error: ${String(error?.message || error)}`} /></Frame>;
  }

  return (
    <Frame
      title={file?.filename}
      onClose={onClose}
      headerExtra={(
        <>
          <span className="text-[10px] text-md-on-surface-variant">
            {decidedCount} / {decidedCount + queue.length} decided &middot; threshold {threshold}%
          </span>
          {onOpenLegacy && (
            <button onClick={onOpenLegacy} className="px-2 py-1 rounded text-[10px] font-bold bg-md-on-surface/10 text-md-on-surface-variant hover:bg-md-on-surface/20" title="Open the legacy detailed editor (fallback)">legacy editor</button>
          )}
          <button
            onClick={enterAdd}
            className="px-3 py-1 rounded text-[11px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/40 hover:bg-cyan-500/25"
            title="Free-draw a rectangle on the canvas to add a missing tag"
          >+ Add tag</button>
          <button
            onClick={handleSaveAndClose}
            disabled={saveReview.isPending}
            className="px-3 py-1 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/25 disabled:opacity-50"
            title="Save all decisions and close (Phase 3 will replace this with sign-off + auto-push)"
          >
            {saveReview.isPending ? 'saving…' : `Save & close (${decidedCount})`}
          </button>
        </>
      )}
    >
      {/* Toolbar */}
      <div className="px-3 py-1.5 border-b border-md-outline-variant/20 bg-md-surface-container-high/40 flex items-center gap-3 flex-wrap">
        <ModeBadge mode={mode} />
        {/* Filter pills — control what is painted on the canvas AND listed in the queue */}
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] uppercase tracking-wide text-md-on-surface-variant mr-1">Show</span>
          <FilterPill id="pending"  label="Pending"  count={buckets.pending.length}  active={filter==='pending'}  color="#F39C12" onClick={setFilter} />
          <FilterPill id="auto"     label="Auto-accept" count={buckets.auto.length}  active={filter==='auto'}     color="#3BE494" onClick={setFilter} />
          <FilterPill id="approved" label="Approved" count={buckets.approved.length} active={filter==='approved'} color="#22C55E" onClick={setFilter} />
          <FilterPill id="edited"   label="Edited"   count={buckets.edited.length}   active={filter==='edited'}   color="#A855F7" onClick={setFilter} />
          <FilterPill id="rejected" label="Rejected" count={buckets.rejected.length} active={filter==='rejected'} color="#EF4444" onClick={setFilter} />
          <FilterPill id="manual"   label="Manual"   count={buckets.manual.length}   active={filter==='manual'}   color="#EC4899" onClick={setFilter} />
          <FilterPill id="miss"     label="Missed"   count={misses.length}           active={filter==='miss'}     color="#EF4444" onClick={setFilter} />
          <FilterPill id="all"      label="All"      count={null}                    active={filter==='all'}      color="#94A3B8" onClick={setFilter} />
        </div>
        <div className="w-px h-5 bg-md-outline-variant/30" />
        <div className="flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-wide text-md-on-surface-variant mr-1">Order</span>
          {['spatial', 'confidence', 'class'].map((id) => (
            <button
              key={id}
              onClick={() => setQueueOrder(id)}
              className={`px-1.5 py-0.5 rounded text-[10px] border ${queueOrder === id ? 'bg-md-primary/20 text-md-primary border-md-primary' : 'border-md-outline-variant/30 text-md-on-surface-variant hover:border-md-primary/40'}`}
            >{id}</button>
          ))}
        </div>
        <div className="w-px h-5 bg-md-outline-variant/30" />
        <div className="flex items-center gap-1.5 flex-wrap">
          <ShortcutHint k="A" label="approve" />
          <ShortcutHint k="R" label="reject" />
          <ShortcutHint k="E" label="edit" />
          <ShortcutHint k="B" label="bbox" />
          <ShortcutHint k="N" label="add new" />
          <ShortcutHint k="← →" label="navigate" />
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button onClick={() => setZoom(z => Math.max(20, z - 20))} className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">-</button>
          <span className="text-[10px] text-md-on-surface-variant w-10 text-center">{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(400, z + 20))} className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">+</button>
          <button onClick={() => setZoom(100)} className="px-1.5 py-0.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10">1:1</button>
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
        </div>
      </div>

      {saveErr && (
        <div className="mx-3 my-2 px-3 py-2 rounded text-[11px] bg-red-500/10 text-red-300 border border-red-400/30">
          Save failed: {saveErr}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Canvas */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-auto bg-md-surface relative"
            onMouseDown={onCanvasMouseDown}
            style={{ cursor: canvasTool === 'select' ? 'default' : 'crosshair' }}
          >
            {/* Floating tool palette — pick a tool, then click tags on the canvas */}
            <div
              className="absolute top-3 left-3 z-30 flex flex-col gap-1 p-1 rounded border border-md-outline-variant/40 bg-[#0D1F17]/95 shadow-lg"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <ToolBtn id="select"    icon="near_me"      active={canvasTool} onClick={setCanvasTool} color="#3BE494" hint="Select (default)" />
              <ToolBtn id="approve"   icon="check"        active={canvasTool} onClick={setCanvasTool} color="#22C55E" hint="Approve on click" />
              <ToolBtn id="reject"    icon="close"        active={canvasTool} onClick={setCanvasTool} color="#EF4444" hint="Reject on click" />
              <ToolBtn id="edit-text" icon="edit"         active={canvasTool} onClick={setCanvasTool} color="#A855F7" hint="Edit text on click" />
              <ToolBtn id="edit-bbox" icon="aspect_ratio" active={canvasTool} onClick={setCanvasTool} color="#EC4899" hint="Edit bbox on click" />
              <ToolBtn id="delete"    icon="delete"       active={canvasTool} onClick={setCanvasTool} color="#EF4444" hint="Delete on click" />
              <div className="h-px bg-md-outline-variant/30 my-0.5" />
              <button
                onClick={() => { setCanvasTool('select'); enterAdd(); }}
                className="flex items-center justify-center w-7 h-7 rounded border"
                style={{ color: '#06B6D4', borderColor: '#06B6D4', background: '#06B6D415' }}
                title="Add new tag (free-draw rectangle)"
              ><span className="material-symbols-outlined text-[16px]">add_box</span></button>
            </div>
            {pdfLoading && <Loading text="Loading drawing…" />}
            {pdfError && <Loading text={`PDF load error: ${pdfError}`} />}
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

                  {pageDims.width > 0 && (() => {
                    const visibleSet = new Map();
                    for (const t of queue) visibleSet.set(t._index, t);
                    if (filter !== 'rejected' && filter !== 'manual' && filter !== 'edited' && filter !== 'approved') {
                      for (const t of buckets.auto) visibleSet.set(t._index, t);
                    }
                    if (focusTag) visibleSet.set(focusTag._index, focusTag);
                    return Array.from(visibleSet.values()).map((t) => renderTagBox(t, `t-${t._index}`));
                  })()}

                  {/* Suggested misses overlay — dashed red rectangles for
                      anything Stage 2 flagged as missing from the cleaned
                      output.  Only painted when the Misses filter is active
                      so the user can isolate them, or when the legend toggle
                      "Show misses" is on. */}
                  {pageDims.width > 0 && (filter === 'miss' || alwaysShowMisses) && misses.map((m) => {
                    const box = pctBoxToPx(m.position_pct, pageDims);
                    if (!box) return null;
                    return (
                      <div
                        key={`miss-${m._missIndex}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: box.x, top: box.y, width: box.w, height: box.h,
                          background: ACTION_STYLES.miss.fill,
                          border: `1px dashed ${ACTION_STYLES.miss.border}`,
                        }}
                        title={`Suggested miss: "${m.text}" (${m.reason})`}
                      />
                    );
                  })}

                  {/* Floating action menu attached to the focused tag — so the
                      user does not have to look away from the canvas. */}
                  {focusTag && mode === 'NAVIGATE' && pageDims.width > 0 && (() => {
                    const pct = getTagPositionPct(focusTag, decisions);
                    if (!pct) return null;
                    const box = pctBoxToPx(pct, pageDims);
                    if (!box) return null;
                    // Position above the bbox; flip below if too close to the top.
                    const above = box.y > 36;
                    const fabY = above ? box.y - 30 : box.y + box.h + 4;
                    const fabX = box.x;
                    return (
                      <div
                        className="absolute pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded border bg-[#0D1F17]/95"
                        style={{
                          left: fabX, top: fabY,
                          borderColor: '#FACC15', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                          zIndex: 20,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FabBtn color="#22C55E" label="A · Approve"  onClick={approveCurrent} />
                        <FabBtn color="#EF4444" label="R · Reject"   onClick={rejectCurrent} />
                        <FabBtn color="#A855F7" label="E · Edit text"   onClick={enterEditText} />
                        <FabBtn color="#EC4899" label="B · Edit bbox"   onClick={enterEditBbox} />
                        <FabBtn color="#FACC15" label="M · Edit both"   onClick={enterEditBoth} />
                        <FabBtn color="#EF4444" label="D · Delete"      onClick={deleteCurrent} />
                      </div>
                    );
                  })()}

                  {/* Bbox handles when in EDIT_BBOX */}
                  {(mode === 'EDIT_BBOX' || mode === 'EDIT_BOTH') && bboxDraft && pageDims.width > 0 && (() => {
                    const box = pctBoxToPx(bboxDraft, pageDims);
                    if (!box) return null;
                    const handles = [
                      ['nw', box.x,         box.y],
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
                          style={{ left: box.x, top: box.y, width: box.w, height: box.h, border: '2px solid #EC4899', background: 'rgba(236,72,153,0.10)', cursor: 'move' }}
                        />
                        {handles.map(([h, hx, hy]) => (
                          <div
                            key={h}
                            onMouseDown={(e) => onBboxHandleMouseDown(h, e)}
                            className="absolute"
                            style={{
                              left: hx - 5, top: hy - 5, width: 10, height: 10,
                              background: '#EC4899', border: '1px solid white',
                              cursor: `${h}-resize`,
                            }}
                          />
                        ))}
                      </>
                    );
                  })()}

                  {/* Live add-tag rectangle */}
                  {mode === 'ADD_TAG' && addDraft && pageDims.width > 0 && (() => {
                    const box = pctBoxToPx(addDraft, pageDims);
                    if (!box) return null;
                    return (
                      <div
                        className="absolute pointer-events-none"
                        style={{ left: box.x, top: box.y, width: box.w, height: box.h, border: '2px dashed #EC4899', background: 'rgba(236,72,153,0.10)' }}
                      />
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-80 flex-shrink-0 border-l border-md-outline-variant/30 bg-md-surface-container/40 flex flex-col min-h-0 overflow-hidden">
          {/* Current item action area */}
          <div className="p-3 border-b border-md-outline-variant/30">
            <div className="text-[10px] uppercase tracking-wide text-md-on-surface-variant mb-1">
              {focusTag ? `Item ${queueIndex + 1} of ${queue.length}` : 'Queue empty'}
            </div>
            {focusTag ? (
              <CurrentItemPanel
                tag={focusTag}
                decision={decisions[focusTag._index]}
                mode={mode}
                editText={editText} setEditText={setEditText}
                editType={editType} setEditType={setEditType}
                onApprove={approveCurrent}
                onReject={rejectCurrent}
                onEditText={enterEditText}
                onEditBbox={enterEditBbox}
                onEditBoth={enterEditBoth}
                onSaveText={saveTextEdit}
                onSaveBbox={saveBboxEdit}
                onSaveBoth={saveBothEdit}
                onCancel={cancelMode}
                bboxDraft={bboxDraft}
                addText={addText} setAddText={setAddText}
                addType={addType} setAddType={setAddType}
                addDraft={addDraft}
                onSaveAdd={saveAddTag}
                onEnterAdd={enterAdd}
                onDelete={deleteCurrent}
                onPromoteMiss={promoteMissToTag}
              />
            ) : (
              <EmptyQueueState
                decided={decidedCount}
                onSave={handleSaveAndClose}
                onAdd={enterAdd}
              />
            )}
          </div>

          {/* Status summary + Legend (always visible, never scroll) */}
          <div className="flex-shrink-0">
            <StatusSummary buckets={buckets} misses={misses} />
            <Legend
              alwaysShowMisses={alwaysShowMisses}
              setAlwaysShowMisses={setAlwaysShowMisses}
            />
          </div>

          {/* Bulk action bar — selection-first, falls back to whole visible queue */}
          <div className="flex-shrink-0 px-2 py-1.5 border-b border-md-outline-variant/20 bg-md-surface-container-high/40 flex items-center gap-1 flex-wrap">
            <label className="flex items-center gap-1 text-[10px] text-md-on-surface-variant cursor-pointer mr-1">
              <input
                type="checkbox"
                checked={queue.length > 0 && selectedSet.size === queue.length}
                ref={(el) => { if (el) el.indeterminate = selectedSet.size > 0 && selectedSet.size < queue.length; }}
                onChange={(e) => {
                  if (e.target.checked) setSelectedSet(new Set(queue.map(t => t._index)));
                  else setSelectedSet(new Set());
                }}
              />
              <span className="font-bold">{selectedSet.size > 0 ? selectedSet.size + ' selected' : 'select all'}</span>
            </label>
            <button onClick={bulkApproveVisible} disabled={!queue.length} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/25 disabled:opacity-50" title={selectedSet.size > 0 ? 'Approve the ' + selectedSet.size + ' selected tag(s)' : 'Approve every tag in this filter'}>Approve {selectedSet.size > 0 ? '(' + selectedSet.size + ')' : '(' + queue.filter(t => t._source !== 'miss' && t._source !== 'manual').length + ')'}</button>
            <button onClick={bulkRejectVisible} disabled={!queue.length} className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-400/30 hover:bg-red-500/25 disabled:opacity-50" title={selectedSet.size > 0 ? 'Reject the ' + selectedSet.size + ' selected tag(s)' : 'Reject every tag in this filter'}>Reject</button>
            <button onClick={clearDecisionsVisible} disabled={!queue.length} className="px-1.5 py-0.5 rounded text-[10px] font-bold text-md-on-surface-variant border border-md-outline-variant/40 hover:bg-md-on-surface/10 disabled:opacity-50" title={selectedSet.size > 0 ? 'Clear decisions on selected' : 'Clear decisions on visible'}>Clear</button>
            <div className="flex-1" />
            <button onClick={undoLast} className="px-1.5 py-0.5 rounded text-[10px] font-bold text-yellow-300 border border-yellow-400/40 hover:bg-yellow-400/10" title="Undo the most recent per-row decision">Undo</button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {queue.map((t, i) => {
              const isCur = i === queueIndex;
              const conf = pctOf(t.confidence);
              const isMiss = t._source === 'miss';
              const isManual = t._source === 'manual';
              const s = isMiss
                ? { border: ACTION_STYLES.miss.border }
                : styleForType(isManual ? 'manual' : t.type);
              const status = isMiss ? null : statusOf(t);
              const meta = status ? ACTION_STYLES[status] : null;
              return (
                <div
                  key={`q-${t._index}`}
                  onMouseEnter={() => setQueueIndex(i)}
                  className={`px-2 py-1 border-b border-md-outline-variant/15 text-[10px] hover:bg-md-on-surface/5 ${isCur ? 'bg-md-primary/10' : ''}`}
                >
                  <div className="flex items-center">
                    {!isMiss && (
                      <input
                        type="checkbox"
                        checked={selectedSet.has(t._index)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setSelectedSet((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t._index);
                            else next.delete(t._index);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="mr-1.5 flex-shrink-0"
                      />
                    )}
                    <div onClick={() => setQueueIndex(i)} className="flex items-center cursor-pointer flex-1 min-w-0">
                    <span
                      className={`inline-block w-2 h-2 mr-1.5 align-middle flex-shrink-0 ${isMiss ? 'rounded-full border border-dashed' : 'rounded-sm'}`}
                      style={isMiss ? { borderColor: s.border } : { background: s.border }}
                    />
                    <span className="font-mono font-bold text-md-on-surface truncate">"{t.text}"</span>
                    <span className="text-md-on-surface-variant ml-1 flex-shrink-0">{isMiss ? 'missed' : (t.type || t._source)}</span>
                    {conf != null && <span className="text-md-on-surface-variant ml-1 flex-shrink-0">&middot; {Math.round(conf)}%</span>}
                    {!isMiss && isConflictTag(t) && <span className="text-yellow-300 ml-1">conflict</span>}
                    {meta && (
                      <span
                        className="ml-auto px-1 py-px rounded text-[8px] font-bold uppercase flex-shrink-0"
                        style={{ color: meta.border, borderColor: meta.border, border: '1px solid ' + meta.border + '66' }}
                      >{meta.label}</span>
                    )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 mt-1 ml-3.5">
                    {isMiss ? (
                      <>
                        <RowBtn color="#3BE494" onClick={(e) => { e.stopPropagation(); setQueueIndex(i); promoteMissToTag(); }}>Promote</RowBtn>
                        <RowBtn color="#94A3B8" onClick={(e) => { e.stopPropagation(); setQueueIndex(Math.min(queue.length - 1, i + 1)); }}>Dismiss</RowBtn>
                      </>
                    ) : (
                      <>
                        <RowBtn color="#22C55E" onClick={(e) => { e.stopPropagation(); recordDecisionTracked(t, 'approve'); }}>A</RowBtn>
                        <RowBtn color="#EF4444" onClick={(e) => { e.stopPropagation(); recordDecisionTracked(t, 'reject'); }}>R</RowBtn>
                        <RowBtn color="#A855F7" onClick={(e) => { e.stopPropagation(); setQueueIndex(i); setTimeout(() => enterEditText(), 0); }}>Edit</RowBtn>
                        <RowBtn color="#EC4899" onClick={(e) => { e.stopPropagation(); setQueueIndex(i); setTimeout(() => enterEditBbox(), 0); }}>Bbox</RowBtn>
                        <RowBtn color="#FACC15" onClick={(e) => { e.stopPropagation(); setQueueIndex(i); setTimeout(() => enterEditBoth(), 0); }}>Both</RowBtn>
                        {meta && (
                          <RowBtn color="#94A3B8" onClick={(e) => { e.stopPropagation(); setDecisions(prev => { const n = { ...prev }; delete n[t._index]; return n; }); }}>Undo</RowBtn>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {queue.length === 0 && (
              <div className="p-3 text-[10px] text-md-on-surface-variant italic">
                Nothing in this filter. Switch filters above or save and close.
              </div>
            )}
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Frame({ title, onClose, headerExtra, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-md-surface/95 backdrop-blur flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-md-outline-variant/30 bg-md-surface-container-high/80">
        <span className="material-symbols-outlined text-[20px] text-md-primary">rate_review</span>
        <div className="flex-1 min-w-0">
          <div className="text-label-md font-bold text-md-on-surface truncate">
            Review &mdash; {title || 'unknown file'}
          </div>
          <div className="text-[10px] text-md-on-surface-variant">
            Canvas-driven review &mdash; A approve, R reject, E edit, B bbox, N add, Esc cancel
          </div>
        </div>
        {headerExtra}
        <button onClick={onClose} className="p-1 rounded text-md-on-surface-variant hover:bg-md-on-surface/10" title="Close">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      {children}
    </div>
  );
}

function Loading({ text }) {
  return <div className="p-6 text-[12px] text-md-on-surface-variant">{text}</div>;
}

function ModeBadge({ mode }) {
  const styles = {
    NAVIGATE:  { color: '#3BE494', label: 'NAVIGATE' },
    EDIT_TEXT: { color: '#A855F7', label: 'EDIT TEXT' },
    EDIT_BBOX: { color: '#EC4899', label: 'EDIT BBOX' },
    ADD_TAG:   { color: '#EC4899', label: 'ADD TAG' },
  };
  const s = styles[mode] || styles.NAVIGATE;
  return (
    <span
      className="px-2 py-0.5 rounded text-[10px] font-bold border"
      style={{ color: s.color, borderColor: s.color, background: `${s.color}15` }}
    >{s.label}</span>
  );
}

function FilterPill({ id, label, count, active, color, onClick }) {
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-all ${active ? 'opacity-100' : 'opacity-55 hover:opacity-100'}`}
      style={{
        color, borderColor: color,
        background: active ? `${color}26` : 'transparent',
      }}
      title={`Show ${label.toLowerCase()} tags${count != null ? ` (${count})` : ''}`}
    >
      {label}{count != null && <span className="ml-1 text-md-on-surface-variant font-normal">({count})</span>}
    </button>
  );
}

function FabBtn({ color, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap"
      style={{
        color, borderColor: color,
        background: `${color}1f`,
      }}
    >{label}</button>
  );
}

function RowBtn({ color, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="px-1.5 py-0.5 rounded text-[9px] font-bold border whitespace-nowrap hover:brightness-125"
      style={{ color, borderColor: color, background: color + '15' }}
    >{children}</button>
  );
}

function ToolBtn({ id, icon, active, onClick, color, hint }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className="flex items-center justify-center w-7 h-7 rounded border transition-all"
      style={{
        color,
        borderColor: color,
        background: isActive ? color + '40' : 'transparent',
        boxShadow: isActive ? '0 0 0 2px ' + color + '60' : 'none',
      }}
      title={hint}
    >
      <span className="material-symbols-outlined text-[16px]">{icon}</span>
    </button>
  );
}

function ShortcutHint({ k, label }) {
  return (
    <span className="text-[9px] text-md-on-surface-variant">
      <kbd className="px-1 py-0.5 rounded bg-md-on-surface/10 text-md-on-surface font-mono mr-0.5">{k}</kbd>
      {label}
    </span>
  );
}

function CurrentItemPanel({
  tag, decision, mode,
  editText, setEditText, editType, setEditType,
  onApprove, onReject, onEditText, onEditBbox, onEditBoth,
  onSaveText, onSaveBbox, onSaveBoth, onCancel,
  bboxDraft,
  addText, setAddText, addType, setAddType, addDraft, onSaveAdd, onEnterAdd,
  onDelete, onPromoteMiss,
}) {
  const conf = pctOf(tag.confidence);
  if (tag?._source === 'miss') {
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-md-on-surface">
          <span className="material-symbols-outlined text-[12px] align-middle text-red-300 mr-1">report</span>
          <span className="font-mono font-bold">"{tag.text}"</span>
          <span className="text-md-on-surface-variant ml-1">missed (suggested)</span>
        </div>
        <div className="text-[10px] text-md-on-surface-variant">
          Stage 2 thinks this text exists on the drawing but did not produce a tag for it.
        </div>
        <button
          onClick={onPromoteMiss}
          className="w-full px-2 py-1 rounded text-[11px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40"
        >Promote to manual tag</button>
        <button
          onClick={onDelete}
          className="w-full px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10"
        >Dismiss this miss</button>
      </div>
    );
  }
  if (mode === 'ADD_TAG') {
    return (
      <div className="space-y-2">
        <div className="text-[11px] text-md-on-surface">
          <span className="material-symbols-outlined text-[12px] align-middle text-pink-300 mr-1">add_box</span>
          {addDraft ? 'Drag a rectangle on the canvas to set the bbox.' : 'Drag a rectangle on the canvas. The popup below will save it.'}
        </div>
        {addDraft && (
          <>
            <input
              autoFocus
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              placeholder="Tag text (e.g. XS-289930-A)"
              className="w-full bg-transparent border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
            />
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              className="w-full bg-md-surface-container border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
            >
              {TAG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-1">
              <button onClick={onSaveAdd} disabled={!addText.trim()} className="flex-1 px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 disabled:opacity-50">Save</button>
              <button onClick={onCancel} className="px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
            </div>
          </>
        )}
      </div>
    );
  }
  if (mode === 'EDIT_TEXT') {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-md-on-surface-variant">Editing &mdash; <span className="text-md-on-surface font-mono">"{tag.text}"</span></div>
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full bg-transparent border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
        />
        <select
          value={editType}
          onChange={(e) => setEditType(e.target.value)}
          className="w-full bg-md-surface-container border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
        >
          {TAG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-1">
          <button onClick={onSaveText} className="flex-1 px-2 py-1 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-400/40">Save edit</button>
          <button onClick={onCancel} className="px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
        </div>
      </div>
    );
  }
  if (mode === 'EDIT_BBOX') {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-md-on-surface-variant">Drag handles on the pink box to resize/move.</div>
        {bboxDraft && (
          <div className="text-[9px] text-md-on-surface-variant font-mono">
            x {bboxDraft.x_pct.toFixed(2)}% &middot; y {bboxDraft.y_pct.toFixed(2)}% &middot;
            w {bboxDraft.w_pct.toFixed(2)}% &middot; h {bboxDraft.h_pct.toFixed(2)}%
          </div>
        )}
        <div className="flex gap-1">
          <button onClick={onSaveBbox} disabled={!bboxDraft} className="flex-1 px-2 py-1 rounded text-[10px] font-bold bg-pink-500/20 text-pink-300 border border-pink-400/40 disabled:opacity-50">Save bbox</button>
          <button onClick={onCancel} className="px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
        </div>
      </div>
    );
  }
  if (mode === 'EDIT_BOTH') {
    return (
      <div className="space-y-2">
        <div className="text-[10px] text-md-on-surface-variant">Edit text + classification + bbox in one go.</div>
        <input
          autoFocus
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full bg-transparent border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
        />
        <select
          value={editType}
          onChange={(e) => setEditType(e.target.value)}
          className="w-full bg-md-surface-container border border-md-outline-variant/40 rounded px-2 py-1 text-[11px] text-md-on-surface outline-none"
        >
          {TAG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="text-[10px] text-md-on-surface-variant">Drag handles on the yellow box to resize/move.</div>
        {bboxDraft && (
          <div className="text-[9px] text-md-on-surface-variant font-mono">
            x {bboxDraft.x_pct.toFixed(2)}% &middot; y {bboxDraft.y_pct.toFixed(2)}% &middot;
            w {bboxDraft.w_pct.toFixed(2)}% &middot; h {bboxDraft.h_pct.toFixed(2)}%
          </div>
        )}
        <div className="flex gap-1">
          <button onClick={onSaveBoth} className="flex-1 px-2 py-1 rounded text-[10px] font-bold bg-yellow-400/20 text-yellow-300 border border-yellow-400/40">Save (text + bbox)</button>
          <button onClick={onCancel} className="px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/10">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[12px] text-md-on-surface">
        <span className="font-mono font-bold">"{tag.text}"</span>
        <span className="text-md-on-surface-variant ml-1">{tag.type || tag._source}</span>
        {conf != null && <span className="text-md-on-surface-variant ml-1">&middot; {Math.round(conf)}%</span>}
      </div>
      {decision && (
        <div className="text-[10px]" style={{ color: ACTION_STYLES[decision.action]?.border }}>
          decided: {ACTION_STYLES[decision.action]?.label}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1">
        <button onClick={onApprove} className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">A &middot; Approve</button>
        <button onClick={onReject}  className="px-2 py-1 rounded text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-400/30">R &middot; Reject</button>
        <button onClick={onEditText} className="px-2 py-1 rounded text-[10px] font-bold bg-purple-500/15 text-purple-300 border border-purple-400/30">E &middot; Edit text</button>
        <button onClick={onEditBbox} className="px-2 py-1 rounded text-[10px] font-bold bg-pink-500/15 text-pink-300 border border-pink-400/30">B &middot; Edit bbox</button>
      </div>
      <button onClick={onEditBoth} className="w-full px-2 py-1 rounded text-[10px] font-bold bg-yellow-400/15 text-yellow-300 border border-yellow-400/30">M &middot; Edit text + bbox together</button>
      <button onClick={onEnterAdd} className="w-full px-2 py-1 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">N &middot; Add new tag on canvas</button>
      <button onClick={onDelete} className="w-full px-2 py-1 rounded text-[10px] font-bold bg-red-500/15 text-red-300 border border-red-400/30">D &middot; Delete this tag</button>
    </div>
  );
}

function EmptyQueueState({ decided, onSave, onAdd }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-md-on-surface">
        Queue empty. {decided} decision{decided === 1 ? '' : 's'} made this session.
      </div>
      <button onClick={onAdd} className="w-full px-2 py-1 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">Add a missing tag</button>
      <button onClick={onSave} className="w-full px-2 py-1 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/40">Save & close</button>
    </div>
  );
}


function StatusSummary({ buckets, misses }) {
  const [open, setOpen] = useState(false);
  const total = buckets.auto.length + buckets.approved.length + buckets.edited.length
    + buckets.pending.length + buckets.rejected.length + buckets.manual.length;
  const Row = ({ color, label, count }) => (
    <div className="flex items-center justify-between text-[10px] py-0.5">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
        <span className="text-md-on-surface-variant">{label}</span>
      </span>
      <span className="font-mono font-bold text-md-on-surface">{count}</span>
    </div>
  );
  return (
    <div className="border-b border-md-outline-variant/30 bg-md-surface-container/40">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide font-bold text-md-on-surface-variant hover:bg-md-on-surface/5">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px]">{open ? 'expand_less' : 'expand_more'}</span>
          Status
          <span className="text-md-on-surface font-mono">{total}</span>
          <span className="text-emerald-300 normal-case">+{buckets.approved.length + buckets.edited.length}</span>
          <span className="text-orange-300 normal-case">{buckets.pending.length}?</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-2">
          <Row color="#3BE494" label="Auto-acceptable"  count={buckets.auto.length} />
          <Row color="#22C55E" label="Approved"         count={buckets.approved.length} />
          <Row color="#A855F7" label="Edited"           count={buckets.edited.length} />
          <Row color="#F39C12" label="Pending"          count={buckets.pending.length} />
          <Row color="#EF4444" label="Rejected"         count={buckets.rejected.length} />
          <Row color="#EC4899" label="Manual added"     count={buckets.manual.length} />
          <Row color="#EF4444" label="Suggested misses" count={misses.length} />
        </div>
      )}
    </div>
  );
}

function Legend({ alwaysShowMisses, setAlwaysShowMisses }) {
  const [open, setOpen] = useState(false);
  const Item = ({ color, ch, name, hint, dashed = false }) => (
    <div className="flex items-center gap-2 text-[10px] py-0.5">
      <span className="inline-block w-4 h-3 rounded-sm border" style={{ background: color + '33', borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
      <span className="font-mono font-bold" style={{ color }}>{ch}</span>
      <span className="text-md-on-surface">{name}</span>
      <span className="text-md-on-surface-variant ml-auto">{hint}</span>
    </div>
  );
  return (
    <div className="border-b border-md-outline-variant/30 bg-md-surface-container/30">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wide font-bold text-md-on-surface-variant hover:bg-md-on-surface/5">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px]">{open ? 'expand_less' : 'expand_more'}</span>
          Legend
        </span>
        <label className="flex items-center gap-1 normal-case text-md-on-surface-variant cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!alwaysShowMisses} onChange={(e) => setAlwaysShowMisses(e.target.checked)} />
          show misses
        </label>
      </button>
      {open && (
        <div className="px-3 pb-2">
          <Item color="#22C55E" ch="✓" name="Approved"           hint="A" />
          <Item color="#A855F7" ch="✎" name="Edited"             hint="E / B / M" />
          <Item color="#EF4444" ch="✕" name="Rejected"           hint="R" />
          <Item color="#3BE494" ch="a"      name="Auto-acceptable"    hint="bulk-accept" />
          <Item color="#F39C12" ch="?"      name="Pending"            hint="needs decision" />
          <Item color="#EC4899" ch="+"      name="Manual added"       hint="N" />
          <Item color="#EF4444" ch=""       name="Missed (suggested)" hint="dashed outline" dashed />
        </div>
      )}
    </div>
  );
}
