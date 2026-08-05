import { useEffect, useMemo, useRef, useState } from 'react';
import PdfCanvas from '../pnid/PdfCanvas';
import {
  useGroupingDiagnostic,
  useRunGroupingDiagnosticRepass,
  useUpsertAtomLabel,
  useDeleteAtomLabel,
  useClearAllAtomLabels,
  getGroupingDiagnosticCsvUrl,
  getGroupingDiagnosticJsonUrl,
} from '../../hooks/useOcrPipelineV2';

/**
 * GroupingDiagnosticView
 * ─────────────────────────────────────────────────────────────────────────────
 * READ-ONLY visual audit of WordGrouper output for a single P&ID file.
 *
 * Painted on the drawing:
 *   - Every multi-word group, color-coded by its `source` pattern
 *   - Single-word "groups" (atoms that stayed alone) in slate gray when "Single
 *     atoms" is on (NOT when only "Horizontal" is on — they are decoupled)
 *   - Atoms that ended up in NO multi-word group (the smoking-gun list) in red
 *   - Conflict atoms (claimed by ≥2 multi-word groups) marked with a yellow X
 *
 * Toolbar:
 *   - Layer toggles per source pattern, plus single-atoms / ungrouped / conflicts
 *   - Arbitration mode pills: None / A Priority+Lock / B NMS-best / C Cluster
 *   - Horizontal stoppers checkboxes: median-gap / symbol-region / number-break
 *
 * Side panel exposes per-source counts + coverage + before→after delta.
 */

const SOURCE_STYLES = {
  vertical_paired_user:   { label: 'Vertical (user-labelled)', fill: 'rgba(236,72,153,0.40)', border: '#EC4899', text: '#EC4899' },
  horizontal:             { label: 'Horizontal',          fill: 'rgba(96,165,250,0.32)',   border: '#60A5FA', text: '#60A5FA' },
  vertical_paired:        { label: 'Vertical (paired)',   fill: 'rgba(34,197,94,0.40)',    border: '#22C55E', text: '#22C55E' },
  vertical_isa:           { label: 'Vertical ISA stack',  fill: 'rgba(59,228,148,0.34)',   border: '#3BE494', text: '#3BE494' },
  vertical_relaxed:       { label: 'Vertical (relaxed)',  fill: 'rgba(20,184,166,0.34)',   border: '#14B8A6', text: '#14B8A6' },
  rotated:                { label: 'Rotated / inclined',  fill: 'rgba(243,156,18,0.34)',   border: '#F39C12', text: '#F39C12' },
  structured_row:         { label: 'Structured row',      fill: 'rgba(168,85,247,0.32)',   border: '#A855F7', text: '#A855F7' },
  line_assembler:         { label: 'Line assembler',      fill: 'rgba(192,132,252,0.32)',  border: '#C084FC', text: '#C084FC' },
  ocr_confusion_variant:  { label: 'OCR confusion variant', fill: 'rgba(251,113,133,0.30)', border: '#FB7185', text: '#FB7185' },
};
const SINGLE_STYLE        = { label: 'Single-atom group', fill: 'rgba(148,163,184,0.18)', border: '#94A3B8', text: '#94A3B8' };
const UNGROUPED_STYLE     = { label: 'Ungrouped atom',    fill: 'rgba(239,68,68,0.18)',   border: '#EF4444', text: '#EF4444' };
const CONFLICT_STYLE      = { label: 'Conflict atom',     fill: 'transparent',            border: '#FACC15', text: '#FACC15' };

// Role definitions for the user-label feedback loop.  Order matters — it's the
// order pills appear in the chooser.  `noise` is intentionally placed last and
// styled distinctly so it doesn't get clicked by accident.
const LABEL_ROLES = [
  { id: 'prefix',        label: 'Prefix',     desc: 'Top of an ISA bubble (XS, ZSC, ZLO, …)',     fg: '#FBBF24', bg: 'rgba(251,191,36,0.15)', border: '#FBBF24' },
  { id: 'mid',           label: 'Mid',        desc: 'Loop number in middle of an ISA bubble',     fg: '#22D3EE', bg: 'rgba(34,211,238,0.15)', border: '#22D3EE' },
  { id: 'suffix',        label: 'Suffix',     desc: 'Bottom of an ISA bubble (A, A1, …)',         fg: '#A78BFA', bg: 'rgba(167,139,250,0.15)', border: '#A78BFA' },
  { id: 'line_tag',      label: 'Line tag',   desc: 'Part of a horizontal line tag',              fg: '#60A5FA', bg: 'rgba(96,165,250,0.15)', border: '#60A5FA' },
  { id: 'equipment_tag', label: 'Equipment',  desc: 'Equipment identifier (V-1234, P-1010A, …)',  fg: '#34D399', bg: 'rgba(52,211,153,0.15)', border: '#34D399' },
  { id: 'noise',         label: 'Noise',      desc: 'OCR junk — never group it',                  fg: '#F87171', bg: 'rgba(248,113,113,0.15)', border: '#F87171' },
];
const LABEL_ROLE_BY_ID = Object.fromEntries(LABEL_ROLES.map(r => [r.id, r]));

const ARBITRATION_OPTIONS = [
  { id: 'none',          label: 'None',          desc: 'All passes produce groups; conflicts allowed (baseline)' },
  { id: 'priority_lock', label: 'A · Priority+Lock', desc: 'Vertical-ISA → Rotated → Structured → Horizontal. Earlier wins lock atoms.' },
  { id: 'nms_best',      label: 'B · NMS-best',  desc: 'Each atom assigned to highest-scoring candidate (score × pattern prior × log(words))' },
  { id: 'cluster',       label: 'C · Cluster',   desc: 'DBSCAN atoms first; drop multi-word groups that span 2+ clusters; then NMS-best inside each cluster' },
];
const STOPPER_OPTIONS = [
  { id: 'median_gap',    label: 'Median-gap', desc: 'Split horizontal chain at any gap > 2.2× the chain median (catches "281010 281010 281011" hops)' },
  { id: 'symbol_region', label: 'Symbol-region', desc: 'Split when next atom is inside a different symbol region (needs symbolRegions in raw OCR)' },
  { id: 'number_break',  label: 'Num→Num', desc: 'Split when last and next atoms are both 4+ digit numbers (different tag IDs)' },
];

function styleForSource(source) {
  return SOURCE_STYLES[source] || { label: source || 'unknown', fill: 'rgba(255,0,148,0.28)', border: '#FF0094', text: '#FF0094' };
}

function pctBoxToPx(pct, dims) {
  if (!pct || !dims?.width || !dims?.height) return null;
  const x = (Number(pct.x_pct || 0) / 100) * dims.width;
  const y = (Number(pct.y_pct || 0) / 100) * dims.height;
  const w = Math.max(2, (Number(pct.w_pct || 0) / 100) * dims.width);
  const h = Math.max(2, (Number(pct.h_pct || 0) / 100) * dims.height);
  return { x, y, w, h };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const MANUAL_REGION_KINDS = [
  { id: 'instrument_bubble', label: 'Instrument bubble', color: '#EC4899' },
  { id: 'triple_stack_zone', label: 'Triple-stack zone', color: '#A855F7' },
  { id: 'line_tag_strip', label: 'Line-tag strip', color: '#F59E0B' },
  { id: 'custom', label: 'Custom', color: '#22D3EE' },
];

function regionKindMeta(kind) {
  return MANUAL_REGION_KINDS.find(k => k.id === kind) || MANUAL_REGION_KINDS[3];
}

function splitRegionIntoVerticalLayers(regionPx = {}) {
  const x = Number(regionPx.x || 0);
  const y = Number(regionPx.y || 0);
  const w = Math.max(1, Number(regionPx.w || 1));
  const h = Math.max(3, Number(regionPx.h || 3));
  const topH = Math.max(1, Math.round(h * 0.34));
  const midH = Math.max(1, Math.round(h * 0.33));
  const bottomH = Math.max(1, h - topH - midH);
  return [
    { slot: 'top', region_px: { x, y, w, h: topH } },
    { slot: 'mid', region_px: { x, y: y + topH, w, h: midH } },
    { slot: 'bottom', region_px: { x, y: y + topH + midH, w, h: bottomH } },
  ];
}

export default function GroupingDiagnosticView({ batchId, file, onClose }) {
  // ── Diagnostic knobs ────────────────────────────────────────────────────
  const [arbitration, setArbitration] = useState('none');
  // Default ON: Num→Num stopper prevents merged chains like
  // "281010 281010 281011" from painting as one group.
  const [stoppers, setStoppers] = useState(['number_break']); // subset of ['median_gap','symbol_region','number_break']
  const [verticalRelaxed, setVerticalRelaxed] = useState(false);
  const [bipartite, setBipartite] = useState(true); // ON by default — replaces messy vertical_isa+relaxed candidates with 1-to-1 paired
  const [bipartiteIncludeRelaxed, setBipartiteIncludeRelaxed] = useState(false); // OFF by default — strict mids only in bipartite pass

  const { data, isLoading, error, refetch, isFetching } = useGroupingDiagnostic(
    batchId,
    file?.id,
    { arbitration, stoppers, verticalRelaxed, bipartite, bipartiteIncludeRelaxed },
    !!batchId && !!file?.id,
  );
  const runRepass = useRunGroupingDiagnosticRepass();
  const upsertLabel = useUpsertAtomLabel();
  const deleteLabel = useDeleteAtomLabel();
  const clearAllLabels = useClearAllAtomLabels();
  const [repassDiagnostic, setRepassDiagnostic] = useState(null);
  const [repassSummary, setRepassSummary] = useState(null);
  const diag = repassDiagnostic || data?.diagnostic || null;
  const userLabels = diag?.userLabels || [];
  const labelImpact = diag?.labelImpact || null;
  const labelByAtomIdx = useMemo(() => {
    const m = new Map();
    for (const l of userLabels) {
      if (l && Number.isFinite(l.atomIdx)) m.set(Number(l.atomIdx), l.role);
    }
    return m;
  }, [userLabels]);

  // ── PDF state ───────────────────────────────────────────────────────────
  const [pdfData, setPdfData] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pageDims, setPageDims] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(100);
  const scrollRef = useRef(null);
  const pageLayerRef = useRef(null);

  // ── Manual region tool (Phase 1) ────────────────────────────────────────
  const [drawRegionMode, setDrawRegionMode] = useState(false);
  const [manualRegionKind, setManualRegionKind] = useState('instrument_bubble');
  const [manualRegions, setManualRegions] = useState([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState([]);
  const [manualRepassMode, setManualRepassMode] = useState('single'); // 'single' | 'layered3'
  const [showSlotGuides, setShowSlotGuides] = useState(true);
  const [draftRegion, setDraftRegion] = useState(null); // { x, y, w, h } in page px
  const draftStartRef = useRef(null); // { x, y } in page px

  // ── Layer toggles ───────────────────────────────────────────────────────
  const [showLabels, setShowLabels] = useState(false);
  const [showSingleAtoms, setShowSingleAtoms] = useState(false);
  const [showUngrouped, setShowUngrouped] = useState(true);
  const [showConflicts, setShowConflicts] = useState(true);
  const [enabledSources, setEnabledSources] = useState({
    horizontal: true,
    vertical_paired: true,
    vertical_isa: true,
    vertical_relaxed: true,
    rotated: true,
    structured_row: true,
    line_assembler: true,
    ocr_confusion_variant: true,
  });
  const [highlight, setHighlight] = useState(null);

  // Load file PDF binary
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

  // Fit-to-viewport on first PDF load
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pageDims.width || !pageDims.height) return;
    const fitW = (el.clientWidth - 16) / pageDims.width;
    const fitH = (el.clientHeight - 16) / pageDims.height;
    const fit = Math.max(0.2, Math.min(4, Math.min(fitW, fitH)));
    setZoom(Math.round(fit * 100));
  }, [pageDims.width, pageDims.height]);

  useEffect(() => {
    if (!file?.id) {
      setManualRegions([]);
      setSelectedRegionIds([]);
      return;
    }
    const key = `grouping-diagnostic.manual-regions.${file.id}`;
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      const rows = Array.isArray(parsed) ? parsed : [];
      const normalized = rows
        .map((r, idx) => ({
          id: r?.id || `mr-${idx + 1}`,
          kind: r?.kind || 'custom',
          region_px: {
            x: Number(r?.region_px?.x ?? 0),
            y: Number(r?.region_px?.y ?? 0),
            w: Math.max(1, Number(r?.region_px?.w ?? 1)),
            h: Math.max(1, Number(r?.region_px?.h ?? 1)),
          },
        }))
        .filter(r => Number.isFinite(r.region_px.x) && Number.isFinite(r.region_px.y));
      setManualRegions(normalized);
      setSelectedRegionIds([]);
    } catch {
      setManualRegions([]);
      setSelectedRegionIds([]);
    }
  }, [file?.id]);

  useEffect(() => {
    if (!file?.id) return;
    const key = `grouping-diagnostic.manual-regions.${file.id}`;
    try {
      localStorage.setItem(key, JSON.stringify(manualRegions));
    } catch {
      // ignore quota/storage errors in browser
    }
  }, [file?.id, manualRegions]);

  useEffect(() => {
    setSelectedRegionIds(prev => prev.filter(id => manualRegions.some(r => r.id === id)));
  }, [manualRegions]);

  const groups = diag?.groups || [];
  const rawWords = diag?.rawWords || [];
  const ungroupedIdx = diag?.ungroupedWordIndices || [];
  const conflicts = diag?.conflicts || [];
  const stats = diag?.stats || {};
  const sourceBreakdown = diag?.sourceBreakdown || [];
  const pipeline = diag?.pipeline || null;

  const ungroupedAtomIdxSet = useMemo(() => new Set(ungroupedIdx), [ungroupedIdx]);

  // Visible groups respect the legend toggles. Single-atom 'groups' are now
  // STRICTLY controlled by the "Single atoms" toggle, regardless of source —
  // toggling "Horizontal" off no longer hides single atoms (and vice versa).
  const visibleGroups = useMemo(() => {
    return groups.filter((g) => {
      const wc = g.wordCount || 1;
      if (wc <= 1) return showSingleAtoms;
      const src = g.source || 'unknown';
      if (!(src in enabledSources)) return true;
      return !!enabledSources[src];
    });
  }, [groups, enabledSources, showSingleAtoms]);

  // For multi-atom groups we still want a single "labelable" target — pick the
  // anchor (mid for vertical groups, otherwise first component atom).
  const focusAtomForGroup = (g) => {
    if (!g) return null;
    if (Number.isFinite(g.anchorWordIndex)) return g.anchorWordIndex;
    const wis = g.componentWordIndices || [];
    return wis.length ? wis[0] : null;
  };

  const onClickGroup = (g) => {
    const focus = focusAtomForGroup(g);
    setHighlight({ kind: 'group', id: g.id, focusAtomIdx: focus });
  };
  const onClickAtom = (idx) => setHighlight({ kind: 'atom', id: idx });

  const toPagePoint = (evt) => {
    const layer = pageLayerRef.current;
    if (!layer) return null;
    const rect = layer.getBoundingClientRect();
    const scale = Math.max(0.01, zoom / 100);
    const x = clamp((evt.clientX - rect.left) / scale, 0, pageDims.width);
    const y = clamp((evt.clientY - rect.top) / scale, 0, pageDims.height);
    return { x, y };
  };

  const beginRegionDraw = (evt) => {
    if (!drawRegionMode || !pageDims.width || !pageDims.height) return;
    if (evt.button !== 0) return;
    const p = toPagePoint(evt);
    if (!p) return;
    evt.preventDefault();
    evt.stopPropagation();
    draftStartRef.current = p;
    setDraftRegion({ x: p.x, y: p.y, w: 1, h: 1 });
  };

  const updateRegionDraft = (evt) => {
    if (!draftStartRef.current) return;
    const p = toPagePoint(evt);
    if (!p) return;
    const s = draftStartRef.current;
    const x = Math.min(s.x, p.x);
    const y = Math.min(s.y, p.y);
    const w = Math.max(1, Math.abs(p.x - s.x));
    const h = Math.max(1, Math.abs(p.y - s.y));
    setDraftRegion({ x, y, w, h });
  };

  const finishRegionDraw = (evt) => {
    if (!draftStartRef.current) return;
    const p = toPagePoint(evt);
    const s = draftStartRef.current;
    draftStartRef.current = null;
    if (!p || !s) {
      setDraftRegion(null);
      return;
    }
    const x = Math.min(s.x, p.x);
    const y = Math.min(s.y, p.y);
    const w = Math.max(1, Math.abs(p.x - s.x));
    const h = Math.max(1, Math.abs(p.y - s.y));
    setDraftRegion(null);
    if (w < 8 || h < 8) return;
    const id = `mr-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const next = { id, kind: manualRegionKind, region_px: { x: +x.toFixed(1), y: +y.toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) } };
    setManualRegions(prev => [...prev, next]);
    setSelectedRegionIds(prev => [...prev, id]);
  };

  const handleApplyLabel = async (atomIdx, role) => {
    if (!batchId || !file?.id || !Number.isFinite(atomIdx)) return;
    const text = rawWords[atomIdx]?.text || '';
    await upsertLabel.mutateAsync({ batchId, fileId: file.id, atomIdx, role, text });
  };
  const handleClearLabel = async (atomIdx) => {
    if (!batchId || !file?.id || !Number.isFinite(atomIdx)) return;
    await deleteLabel.mutateAsync({ batchId, fileId: file.id, atomIdx });
  };
  const handleClearAllLabels = async () => {
    if (!batchId || !file?.id) return;
    if (!userLabels.length) return;
    if (!window.confirm(`Clear all ${userLabels.length} labels for this drawing?`)) return;
    await clearAllLabels.mutateAsync({ batchId, fileId: file.id });
  };

  useEffect(() => {
    const onMove = (e) => updateRegionDraft(e);
    const onUp = (e) => finishRegionDraw(e);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  const toggleStopper = (id) => setStoppers(prev =>
    prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

  useEffect(() => {
    // Any diagnostic knob change means we should show server-query data again.
    setRepassDiagnostic(null);
    setRepassSummary(null);
  }, [file?.id, arbitration, verticalRelaxed, bipartite, bipartiteIncludeRelaxed, stoppers.join(',')]);

  const handleRunRepass = async (regions) => {
    if (!batchId || !file?.id || !Array.isArray(regions) || regions.length === 0) return;
    const result = await runRepass.mutateAsync({
      batchId,
      fileId: file.id,
      regions,
      arbitration,
      stoppers,
      verticalRelaxed,
      bipartite,
      bipartiteIncludeRelaxed,
      scale: 4,
    });
    if (result?.diagnostic) {
      setRepassDiagnostic(result.diagnostic);
      setRepassSummary(result.repass || null);
      setHighlight(null);
    }
  };

  const toggleRegionSelection = (id) => {
    setSelectedRegionIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleDeleteSelectedRegions = () => {
    if (!selectedRegionIds.length) return;
    setManualRegions(prev => prev.filter(r => !selectedRegionIds.includes(r.id)));
    setSelectedRegionIds([]);
  };

  const handleClearAllRegions = () => {
    if (!manualRegions.length) return;
    if (!window.confirm(`Delete all ${manualRegions.length} manual regions for this file?`)) return;
    setManualRegions([]);
    setSelectedRegionIds([]);
  };

  const handleRunRepassForSelectedRegions = () => {
    const selected = manualRegions.filter(r => selectedRegionIds.includes(r.id));
    if (!selected.length) return;
    const shouldLayer = (r) =>
      manualRepassMode === 'layered3' &&
      (r.kind === 'instrument_bubble' || r.kind === 'triple_stack_zone');
    const payload = selected.flatMap((r) => {
      if (!shouldLayer(r)) {
        return [{
          region_px: r.region_px,
          reason: `manual:${r.kind}`,
          regionLabel: r.kind,
          manualRegionId: r.id,
        }];
      }
      return splitRegionIntoVerticalLayers(r.region_px).map((layer) => ({
        region_px: layer.region_px,
        reason: `manual:${r.kind}:${layer.slot}`,
        regionLabel: `${r.kind}:${layer.slot}`,
        slot: layer.slot,
        manualRegionId: r.id,
      }));
    });
    handleRunRepass(payload);
  };

  return (
    <div className="fixed inset-0 z-50 bg-md-surface/95 backdrop-blur flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-md-outline-variant/30 bg-md-surface-container-high/80">
        <span className="material-symbols-outlined text-[20px] text-md-primary">group_work</span>
        <div className="flex-1 min-w-0">
          <div className="text-label-md font-bold text-md-on-surface truncate">
            Word Grouping Diagnostic — {file?.filename || 'unknown file'}
          </div>
          <div className="text-[10px] text-md-on-surface-variant">
            Read-only • re-runs WordGrouper.js with all passes enabled • no AI, no DB writes
          </div>
        </div>
        {diag && (
          <div className="text-[10px] text-md-on-surface-variant">
            Page {diag.pageWidth}×{diag.pageHeight}px • {diag.runtimeMs}ms •
            {' '}{stats.totalRawWords} atoms → {stats.totalGroups} groups ({stats.multiWordGroups} multi-word) •
            {' '}coverage {stats.coveragePct}%
          </div>
        )}
        {userLabels.length > 0 && (
          <button
            onClick={handleClearAllLabels}
            disabled={clearAllLabels.isPending}
            className="px-2 py-1 rounded text-[10px] font-bold bg-pink-500/15 text-pink-300 border border-pink-400/40 hover:bg-pink-500/25 disabled:opacity-50"
            title={`${userLabels.length} user labels applied to this drawing. Click to clear all.`}
          >
            <span className="material-symbols-outlined text-[12px] align-middle mr-1">label</span>
            Labels ({userLabels.length}) · Clear all
          </button>
        )}
        <button
          onClick={() => {
            setRepassDiagnostic(null);
            setRepassSummary(null);
            refetch();
          }}
          disabled={isFetching}
          className="px-2 py-1 rounded text-[10px] font-bold bg-md-primary/15 text-md-primary hover:bg-md-primary/25 disabled:opacity-50"
          title="Re-run grouping with current WordGrouper.js code"
        >
          <span className="material-symbols-outlined text-[12px] align-middle mr-1">refresh</span>
          Re-run
        </button>
        {batchId && file?.id && (
          <>
            <a href={getGroupingDiagnosticJsonUrl(batchId, file.id, { arbitration, stoppers, verticalRelaxed, bipartite, bipartiteIncludeRelaxed })} download
              className="px-2 py-1 rounded text-[10px] font-bold bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
              title="Download full diagnostic JSON (with current arbitration + stoppers)">
              <span className="material-symbols-outlined text-[12px] align-middle mr-1">download</span>JSON
            </a>
            <a href={getGroupingDiagnosticCsvUrl(batchId, file.id, { arbitration, stoppers, verticalRelaxed, bipartite, bipartiteIncludeRelaxed })} download
              className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              title="Download one-row-per-group CSV for offline audit">
              <span className="material-symbols-outlined text-[12px] align-middle mr-1">table_view</span>CSV
            </a>
          </>
        )}
        <button onClick={onClose} className="p-1 rounded text-md-on-surface-variant hover:bg-md-on-surface/10" title="Close">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Arbitration + stoppers strip */}
      <div className="px-3 py-2 border-b border-md-outline-variant/20 bg-md-surface-container-high/40 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mr-1">Arbitration</span>
          {ARBITRATION_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setArbitration(opt.id)}
              title={opt.desc}
              className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
                arbitration === opt.id
                  ? 'bg-md-primary/25 text-md-primary border-md-primary'
                  : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-md-primary/40'
              }`}
            >{opt.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mr-1">Horizontal stoppers</span>
          {STOPPER_OPTIONS.map(opt => {
            const on = stoppers.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggleStopper(opt.id)}
                title={opt.desc}
                className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
                  on
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400'
                    : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-cyan-400/50'
                }`}
              >
                <span className="mr-0.5">{on ? '✓' : ' '}</span>
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mr-1">Extra passes</span>
          <button
            onClick={() => setVerticalRelaxed(v => !v)}
            title="Run a relaxed copy of the vertical_isa pass with LOCAL median height (not page-wide) and looser regex tolerances. New groups appear in TEAL with source='vertical_relaxed'."
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
              verticalRelaxed
                ? 'bg-teal-500/20 text-teal-300 border-teal-400'
                : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-teal-400/50'
            }`}
          >
            <span className="mr-0.5">{verticalRelaxed ? '✓' : ' '}</span>
            Vertical (relaxed)
          </button>
          <button
            onClick={() => setBipartite(v => !v)}
            title="Bipartite vertical pairing (default ON): replaces ALL vertical_isa + vertical_relaxed candidates with 1-to-1 prefix↔mid pairings (Hungarian-style by xOffset+0.5*yGap). Eliminates the same-prefix-claims-multiple-mids defect that orphans numbers in tight bubble rows (XS/ZSC/ZLO/ZLC 289910). Paired groups appear in BRIGHT GREEN with source='vertical_paired'."
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
              bipartite
                ? 'bg-green-500/20 text-green-300 border-green-400'
                : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-green-400/50'
            }`}
          >
            <span className="mr-0.5">{bipartite ? '✓' : ' '}</span>
            Bipartite vertical
          </button>
          <button
            onClick={() => setBipartiteIncludeRelaxed(v => !v)}
            disabled={!bipartite}
            title="Include relaxed mids in bipartite pass (OFF by default). Keep this OFF for strict ISA-only pairing; turn ON only when you intentionally want loose 2–7 digit mids in bipartite pairing."
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
              !bipartite
                ? 'bg-transparent text-md-on-surface-variant/50 border-md-outline-variant/20'
                : bipartiteIncludeRelaxed
                  ? 'bg-lime-500/20 text-lime-300 border-lime-400'
                  : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-lime-400/50'
            }`}
          >
            <span className="mr-0.5">{bipartiteIncludeRelaxed ? '✓' : ' '}</span>
            Bipartite includes relaxed mids
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mr-1">Pattern regions</span>
          <select
            value={manualRegionKind}
            onChange={(e) => setManualRegionKind(e.target.value)}
            className="bg-transparent border border-md-outline-variant/30 rounded px-1.5 py-0.5 text-[10px] text-md-on-surface outline-none"
            title="Type assigned to newly drawn regions"
          >
            {MANUAL_REGION_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <button
            onClick={() => {
              setDrawRegionMode(v => !v);
              draftStartRef.current = null;
              setDraftRegion(null);
            }}
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
              drawRegionMode
                ? 'bg-pink-500/20 text-pink-300 border-pink-400'
                : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-pink-400/50'
            }`}
            title="Draw custom OCR re-pass regions directly on drawing"
          >
            <span className="mr-0.5">{drawRegionMode ? '✓' : ' '}</span>
            Draw region
          </button>
          <button
            onClick={handleRunRepassForSelectedRegions}
            disabled={!selectedRegionIds.length || runRepass.isPending}
            className="px-2 py-0.5 rounded border text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border-emerald-400/40 hover:bg-emerald-500/25 disabled:opacity-50"
            title="Run Vision re-OCR on selected manual regions (single-box or layered-3 mode)"
          >
            Re-OCR selected ({selectedRegionIds.length})
          </button>
          <select
            value={manualRepassMode}
            onChange={(e) => setManualRepassMode(e.target.value)}
            className="bg-transparent border border-md-outline-variant/30 rounded px-1.5 py-0.5 text-[10px] text-md-on-surface outline-none"
            title="Single = one OCR crop per selected region. Layered-3 = split instrument/triple regions into top-mid-bottom OCR crops."
          >
            <option value="single">Single-region OCR</option>
            <option value="layered3">Layered-3 OCR (top/mid/bottom)</option>
          </select>
          <button
            onClick={() => setShowSlotGuides(v => !v)}
            className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-colors ${
              showSlotGuides
                ? 'bg-violet-500/20 text-violet-300 border-violet-400'
                : 'bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-violet-400/50'
            }`}
            title="Show top/mid/bottom guides inside instrument/triple regions"
          >
            <span className="mr-0.5">{showSlotGuides ? '✓' : ' '}</span>
            Slot guides
          </button>
          <button
            onClick={handleDeleteSelectedRegions}
            disabled={!selectedRegionIds.length}
            className="px-2 py-0.5 rounded border text-[10px] font-bold bg-red-500/10 text-red-300 border-red-400/30 hover:bg-red-500/20 disabled:opacity-50"
            title="Delete selected manual regions"
          >
            Delete selected
          </button>
          <button
            onClick={handleClearAllRegions}
            disabled={!manualRegions.length}
            className="px-2 py-0.5 rounded border text-[10px] font-bold bg-transparent text-md-on-surface-variant border-md-outline-variant/30 hover:border-red-400/50 disabled:opacity-50"
            title="Clear all manual regions for this file"
          >
            Clear all ({manualRegions.length})
          </button>
        </div>
        <div className="flex-1" />
        {labelImpact?.applied && (
          <LabelImpact impact={labelImpact} />
        )}
        {(diag?.numericGuardSplitCount || 0) > 0 && (
          <span
            className="text-[9px] px-2 py-0.5 rounded border border-orange-400/40 bg-orange-500/10 text-orange-300"
            title="Auto-split pure numeric over-merges (e.g. 281010 281010 281011)"
          >
            numeric-guard: split {diag.numericGuardSplitCount}
          </span>
        )}
        {pipeline && (
          <PipelineDelta pipeline={pipeline} />
        )}
        {isFetching && (
          <span className="text-[10px] text-md-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
            running…
          </span>
        )}
      </div>

      {/* Body: legend toolbar + PDF + side panel */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Legend toolbar */}
          <div className="px-3 py-2 border-b border-md-outline-variant/20 bg-md-surface-container/50 flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-bold text-md-on-surface-variant uppercase tracking-wide mr-1">Layers</span>
            {Object.entries(SOURCE_STYLES).map(([key, s]) => {
              const breakdownEntry = sourceBreakdown.find(b => b.source === key);
              const total = breakdownEntry?.groupCount ?? 0;
              const multi = breakdownEntry?.multiWordCount ?? 0;
              const active = !!enabledSources[key];
              return (
                <button
                  key={key}
                  onClick={() => setEnabledSources(prev => ({ ...prev, [key]: !prev[key] }))}
                  className={`px-2 py-0.5 rounded border text-[10px] font-bold transition-opacity ${active ? 'opacity-100' : 'opacity-40'}`}
                  style={{ borderColor: s.border, color: s.text, background: 'transparent' }}
                  title={`${s.label} — ${total} total, ${multi} multi-word painted`}
                >
                  <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: s.border }}></span>
                  {s.label} ({total}{key === 'horizontal' && total > multi ? ` · ${multi} multi` : ''})
                </button>
              );
            })}
            <div className="w-px h-5 bg-md-outline-variant/30 mx-1" />
            <button
              onClick={() => setShowSingleAtoms(v => !v)}
              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${showSingleAtoms ? 'opacity-100' : 'opacity-40'}`}
              style={{ borderColor: SINGLE_STYLE.border, color: SINGLE_STYLE.text }}
              title="Show all single-atom 'groups' (words that didn't merge with anything) — strict toggle"
            >
              <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: SINGLE_STYLE.border }}></span>
              Single atoms ({stats.singleWordGroups || 0})
            </button>
            <button
              onClick={() => setShowUngrouped(v => !v)}
              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${showUngrouped ? 'opacity-100' : 'opacity-40'}`}
              style={{ borderColor: UNGROUPED_STYLE.border, color: UNGROUPED_STYLE.text }}
              title="Atoms that ended up in NO multi-word group — the misses"
            >
              <span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle border border-dashed" style={{ borderColor: UNGROUPED_STYLE.border }}></span>
              Ungrouped atoms ({stats.ungroupedAtoms || 0})
            </button>
            <button
              onClick={() => setShowConflicts(v => !v)}
              className={`px-2 py-0.5 rounded border text-[10px] font-bold ${showConflicts ? 'opacity-100' : 'opacity-40'}`}
              style={{ borderColor: CONFLICT_STYLE.border, color: CONFLICT_STYLE.text }}
              title="Atoms claimed by 2+ groups — ambiguity / scoring problem"
            >
              <span className="mr-1 align-middle">✕</span>
              Conflicts ({stats.conflictAtoms || 0})
            </button>
            <div className="w-px h-5 bg-md-outline-variant/30 mx-1" />
            <button
              onClick={() => setShowLabels(v => !v)}
              className={`px-2 py-0.5 rounded border border-md-outline-variant/40 text-[10px] font-bold ${showLabels ? 'text-md-primary border-md-primary' : 'text-md-on-surface-variant'}`}
              title="Toggle text label rendering on top of each group"
            >
              <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">title</span>
              Labels
            </button>
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

          {/* PDF + paint */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto bg-md-surface">
            {(isLoading || pdfLoading) && (
              <div className="p-6 text-[12px] text-md-on-surface-variant">Loading drawing & running grouping…</div>
            )}
            {error && <div className="p-6 text-[12px] text-red-400">Diagnostic error: {String(error?.message || error)}</div>}
            {pdfError && <div className="p-6 text-[12px] text-red-400">PDF load error: {pdfError}</div>}
            {pdfData && (
              <div className="relative inline-block min-w-full p-2">
                <div
                  ref={pageLayerRef}
                  onMouseDown={beginRegionDraw}
                  className="relative origin-top-left"
                  style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left', cursor: drawRegionMode ? 'crosshair' : 'default' }}
                >
                  <PdfCanvas
                    data={pdfData}
                    page={1}
                    onLoaded={() => {}}
                    onError={(err) => setPdfError(err?.message || 'PDF render failed')}
                    onDimensions={(d) => setPageDims(d || { width: 0, height: 0 })}
                    className="shadow-md border border-md-outline-variant/20 bg-white"
                  />

                  {pageDims.width > 0 && pageDims.height > 0 && visibleGroups.map((g) => {
                    const box = pctBoxToPx(g.position_pct, pageDims);
                    if (!box) return null;
                    const wc = g.wordCount || 1;
                    const s = wc > 1 ? styleForSource(g.source) : SINGLE_STYLE;
                    const isHighlighted = highlight?.kind === 'group' && highlight.id === g.id;
                    const tip = `[${g.source}] "${g.text}" • atoms ${g.componentWordIndices.join(',')}` +
                      ` • score ${g.assemblyScore ?? '-'} • margin ${g.marginToRunnerUp ?? '-'}` +
                      (g.medianGapPx != null ? ` • median-gap ${g.medianGapPx}px` : '') +
                      (g.maxGapPx != null ? ` • max-gap ${g.maxGapPx}px` : '') +
                      (g.assemblyRule ? ` • rule ${g.assemblyRule}` : '');
                    return (
                      <div
                        key={`g-${g.id}`}
                        onClick={() => onClickGroup(g)}
                        className="absolute pointer-events-auto cursor-pointer"
                        style={{
                          left: box.x, top: box.y, width: box.w, height: box.h,
                          background: s.fill, border: `${isHighlighted ? 2 : 1}px solid ${s.border}`,
                          boxShadow: isHighlighted ? `0 0 0 2px ${s.border}55` : 'none',
                        }}
                        title={tip}
                      >
                        {showLabels && (
                          <span
                            className="absolute -top-3 left-0 text-[8px] font-bold px-0.5 rounded-sm"
                            style={{ background: s.border, color: '#0D1F17' }}
                          >{g.text}</span>
                        )}
                      </div>
                    );
                  })}

                  {pageDims.width > 0 && manualRegions.map((r) => {
                    const box = r.region_px;
                    const meta = regionKindMeta(r.kind);
                    const isSelected = selectedRegionIds.includes(r.id);
                    const showLayers = showSlotGuides && (r.kind === 'instrument_bubble' || r.kind === 'triple_stack_zone');
                    const layers = showLayers ? splitRegionIntoVerticalLayers(box) : [];
                    return (
                      <div
                        key={`mr-${r.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleRegionSelection(r.id);
                        }}
                        className="absolute pointer-events-auto cursor-pointer"
                        style={{
                          left: box.x,
                          top: box.y,
                          width: box.w,
                          height: box.h,
                          background: `${meta.color}1A`,
                          border: `${isSelected ? 2 : 1}px dashed ${meta.color}`,
                          boxShadow: isSelected ? `0 0 0 2px ${meta.color}55` : 'none',
                        }}
                        title={`Manual region [${meta.label}] ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)}`}
                      >
                        <span
                          className="absolute -top-3 left-0 text-[8px] font-bold px-0.5 rounded-sm"
                          style={{ background: meta.color, color: '#0D1F17' }}
                        >
                          {meta.label}
                        </span>
                        {showLayers && layers.map((layer) => (
                          <div
                            key={`${r.id}-${layer.slot}`}
                            className="absolute pointer-events-none"
                            style={{
                              left: layer.region_px.x - box.x,
                              top: layer.region_px.y - box.y,
                              width: layer.region_px.w,
                              height: layer.region_px.h,
                              borderTop: '1px dashed rgba(255,255,255,0.55)',
                            }}
                          >
                            <span
                              className="absolute left-0 top-0 text-[7px] font-bold px-0.5 rounded-sm"
                              style={{ background: 'rgba(13,31,23,0.75)', color: '#E2E8F0' }}
                            >
                              {layer.slot}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {pageDims.width > 0 && draftRegion && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: draftRegion.x,
                        top: draftRegion.y,
                        width: draftRegion.w,
                        height: draftRegion.h,
                        border: '2px dashed #F472B6',
                        background: 'rgba(244,114,182,0.15)',
                      }}
                    />
                  )}

                  {showUngrouped && pageDims.width > 0 && rawWords.map((w) => {
                    if (!ungroupedAtomIdxSet.has(w.idx)) return null;
                    const box = pctBoxToPx(w.position_pct, pageDims);
                    if (!box) return null;
                    const isHighlighted = highlight?.kind === 'atom' && highlight.id === w.idx;
                    return (
                      <div
                        key={`u-${w.idx}`}
                        onClick={() => onClickAtom(w.idx)}
                        className="absolute pointer-events-auto cursor-pointer"
                        style={{
                          left: box.x, top: box.y, width: box.w, height: box.h,
                          background: UNGROUPED_STYLE.fill,
                          border: `${isHighlighted ? 2 : 1}px dashed ${UNGROUPED_STYLE.border}`,
                        }}
                        title={`UNGROUPED atom #${w.idx}: "${w.text}" • confidence: ${w.confidence ?? '-'}`}
                      />
                    );
                  })}

                  {showConflicts && pageDims.width > 0 && conflicts.map((c) => {
                    const box = pctBoxToPx(c.wordPosition_pct, pageDims);
                    if (!box) return null;
                    const cx = box.x + box.w / 2;
                    const cy = box.y + box.h / 2;
                    const size = Math.max(10, Math.min(box.w, box.h));
                    return (
                      <div
                        key={`x-${c.wordIndex}`}
                        className="absolute pointer-events-none flex items-center justify-center font-bold"
                        style={{
                          left: cx - size / 2, top: cy - size / 2, width: size, height: size,
                          color: CONFLICT_STYLE.border,
                          textShadow: '0 0 2px rgba(0,0,0,0.7)',
                          fontSize: Math.max(10, size * 0.8),
                          lineHeight: 1,
                        }}
                        title={`Conflict atom #${c.wordIndex} "${c.wordText}" claimed by groups: ${c.groupTexts.join(' | ')}`}
                      >✕</div>
                    );
                  })}

                  {/* User-label badges — small colored dot in top-right corner of every
                      labelled atom so the user can see at a glance which atoms they've
                      already given feedback on, and what role they assigned. */}
                  {pageDims.width > 0 && labelByAtomIdx.size > 0 && rawWords.map((w) => {
                    const role = labelByAtomIdx.get(w.idx);
                    if (!role) return null;
                    const box = pctBoxToPx(w.position_pct, pageDims);
                    if (!box) return null;
                    const meta = LABEL_ROLE_BY_ID[role];
                    if (!meta) return null;
                    return (
                      <div
                        key={`lb-${w.idx}`}
                        className="absolute pointer-events-none rounded-full border-2"
                        style={{
                          left: box.x + box.w - 6, top: box.y - 4,
                          width: 8, height: 8,
                          background: meta.border,
                          borderColor: '#0D1F17',
                          boxShadow: `0 0 0 1px ${meta.border}80`,
                        }}
                        title={`labelled "${role}"`}
                      />
                    );
                  })}

                  {/* Vertical-miss geometric explanation overlay: when a miss with a
                      candidate prefix is highlighted, draw a dashed line from the
                      mid atom to the rejected prefix so the X/Y rejection is visible. */}
                  {highlight?.kind === 'atom' && highlight.candidatePrefixIdx != null &&
                    pageDims.width > 0 && (() => {
                    const mid = rawWords[highlight.id];
                    const pref = rawWords[highlight.candidatePrefixIdx];
                    const a = pctBoxToPx(mid?.position_pct, pageDims);
                    const b = pctBoxToPx(pref?.position_pct, pageDims);
                    if (!a || !b) return null;
                    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
                    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
                    const minX = Math.min(ax, bx), minY = Math.min(ay, by);
                    const maxX = Math.max(ax, bx), maxY = Math.max(ay, by);
                    return (
                      <svg
                        className="absolute pointer-events-none"
                        style={{ left: minX - 4, top: minY - 4, width: maxX - minX + 8, height: maxY - minY + 8 }}
                        viewBox={`0 0 ${maxX - minX + 8} ${maxY - minY + 8}`}
                      >
                        <line
                          x1={ax - minX + 4} y1={ay - minY + 4}
                          x2={bx - minX + 4} y2={by - minY + 4}
                          stroke="#FACC15" strokeWidth="2" strokeDasharray="4 3"
                        />
                        <circle cx={ax - minX + 4} cy={ay - minY + 4} r="4" fill="#EF4444" />
                        <circle cx={bx - minX + 4} cy={by - minY + 4} r="4" fill="#FACC15" />
                      </svg>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="w-80 flex-shrink-0 border-l border-md-outline-variant/30 bg-md-surface-container/40 overflow-y-auto">
          <LabelPanel
            highlight={highlight}
            setHighlight={setHighlight}
            rawWords={rawWords}
            groups={groups}
            labelByAtomIdx={labelByAtomIdx}
            onApply={handleApplyLabel}
            onClear={handleClearLabel}
            applyPending={upsertLabel.isPending || deleteLabel.isPending}
          />
          <SidePanelStats stats={stats} sourceBreakdown={sourceBreakdown} pipeline={pipeline} />
          <SidePanelOcrAudit
            ocrAudit={diag?.ocrMissAudit}
            highlight={highlight}
            setHighlight={setHighlight}
            onRunRepass={handleRunRepass}
            repassRunning={runRepass.isPending}
            repassSummary={repassSummary}
            labelByAtomIdx={labelByAtomIdx}
          />
          <SidePanelVerticalMisses
            verticalMisses={diag?.verticalMisses}
            highlight={highlight}
            setHighlight={setHighlight}
            labelByAtomIdx={labelByAtomIdx}
          />
          <SidePanelConflicts
            conflicts={conflicts}
            highlight={highlight}
            setHighlight={setHighlight}
            labelByAtomIdx={labelByAtomIdx}
          />
          <SidePanelUngrouped
            rawWords={rawWords}
            ungroupedIdx={ungroupedIdx}
            highlight={highlight}
            setHighlight={setHighlight}
            labelByAtomIdx={labelByAtomIdx}
          />
        </div>
      </div>
    </div>
  );
}

// Tiny inline pill rendered next to atom-id labels everywhere a row references
// an atom.  When labelled, shows the role color + name; clicking opens the
// chooser by setting highlight (the user can label/clear from LabelPanel).
function LabelPill({ atomIdx, labelByAtomIdx, onClick = null, compact = false }) {
  if (!Number.isFinite(atomIdx)) return null;
  const clickable = typeof onClick === 'function';
  const role = labelByAtomIdx?.get(atomIdx);
  if (!role) {
    if (compact) return null;
    const className = 'ml-1 px-1 py-px rounded text-[8px] font-bold uppercase border border-dashed border-md-outline-variant/40 text-md-on-surface-variant/70';
    const title = 'No label — click to label this atom';
    if (clickable) {
      return (
        <button
          type="button"
          onClick={onClick}
          className={`${className} hover:text-md-primary hover:border-md-primary`}
          title={title}
        >+ label</button>
      );
    }
    return <span className={className} title={title}>+ label</span>;
  }
  const meta = LABEL_ROLE_BY_ID[role];
  if (!meta) return null;
  const className = 'ml-1 px-1 py-px rounded text-[8px] font-bold uppercase border';
  const style = { color: meta.fg, borderColor: meta.border, background: meta.bg };
  const title = `Labelled "${role}" — click to relabel/clear`;
  if (clickable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className}
        style={style}
        title={title}
      >{meta.label}</button>
    );
  }
  return <span className={className} style={style} title={title}>{meta.label}</span>;
}

function LabelImpact({ impact }) {
  if (!impact?.applied) return null;
  const item = (label, val, color) => (
    <span className="text-[10px] mr-2">
      <span className="text-md-on-surface-variant">{label}: </span>
      <span className={`font-bold ${color}`}>{val}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-pink-400/40 bg-pink-500/10">
      <span className="material-symbols-outlined text-[12px] text-pink-300 mr-0.5">label</span>
      <span className="text-[9px] uppercase tracking-wide text-pink-300 font-bold mr-1">Labels</span>
      {item('forced', impact.groupsForcedAdded || 0, 'text-emerald-300')}
      {item('dropped', (impact.groupsDroppedNoise || 0) + (impact.groupsDroppedContradiction || 0), 'text-yellow-300')}
      {item('noise', impact.noiseAtomCount || 0, 'text-red-300')}
      {item('atoms', impact.atomsLabelled || 0, 'text-md-on-surface')}
    </div>
  );
}

// Label panel pinned at the top of the side panel.  Always visible; reflects
// the currently highlighted atom (or the focus atom of the highlighted group).
// Clicking a role pill upserts the label via mutation; canvas re-paints.
function LabelPanel({
  highlight, setHighlight, rawWords, groups, labelByAtomIdx, onApply, onClear, applyPending,
}) {
  // Resolve "which atom are we labelling right now"?
  let targetAtomIdx = null;
  let multiAtomGroup = null;
  if (highlight?.kind === 'atom') targetAtomIdx = highlight.id;
  else if (highlight?.kind === 'group') {
    targetAtomIdx = Number.isFinite(highlight.focusAtomIdx) ? highlight.focusAtomIdx : null;
    const g = groups.find(x => x.id === highlight.id);
    if (g && (g.wordCount || 1) > 1) multiAtomGroup = g;
  }
  const targetAtom = Number.isFinite(targetAtomIdx) ? rawWords[targetAtomIdx] : null;
  const currentRole = Number.isFinite(targetAtomIdx) ? labelByAtomIdx.get(targetAtomIdx) : null;

  return (
    <div className="p-3 border-b border-md-outline-variant/30 bg-md-surface-container-high/40 sticky top-0 z-10">
      <div className="flex items-center justify-between mb-1">
        <div className="text-label-sm font-bold text-md-on-surface flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px] text-pink-300">label</span>
          Atom labels
        </div>
        {currentRole && (
          <button
            onClick={() => onClear(targetAtomIdx)}
            disabled={applyPending}
            className="text-[9px] text-red-300 hover:text-red-200 disabled:opacity-50"
            title="Remove the label from this atom"
          >clear</button>
        )}
      </div>
      {!targetAtom ? (
        <div className="text-[10px] text-md-on-surface-variant italic">
          Click any painted box, ungrouped atom, conflict, or panel row to select an atom — then label it here.
        </div>
      ) : (
        <>
          <div className="text-[10px] text-md-on-surface mb-1.5">
            <span className="font-mono font-bold">"{targetAtom.text}"</span>
            <span className="text-md-on-surface-variant ml-1">#{targetAtomIdx}</span>
            {targetAtom.confidence != null && (
              <span className="text-md-on-surface-variant ml-1">· conf {Number(targetAtom.confidence).toFixed(2)}</span>
            )}
            {currentRole && (
              <span className="ml-2">
                current: <LabelPill atomIdx={targetAtomIdx} labelByAtomIdx={labelByAtomIdx} compact={false} />
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {LABEL_ROLES.map(r => {
              const isCurrent = currentRole === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => onApply(targetAtomIdx, r.id)}
                  disabled={applyPending}
                  title={r.desc}
                  className={`px-1.5 py-1 rounded text-[10px] font-bold border transition-all disabled:opacity-50 ${isCurrent ? 'ring-1' : ''}`}
                  style={{
                    color: r.fg,
                    borderColor: r.border,
                    background: isCurrent ? r.bg : 'transparent',
                  }}
                >{r.label}</button>
              );
            })}
          </div>
          {multiAtomGroup && (
            <div className="mt-2 pt-2 border-t border-md-outline-variant/20">
              <div className="text-[9px] text-md-on-surface-variant mb-0.5">
                Other atoms in this group — click to label one of them:
              </div>
              <div className="flex flex-wrap gap-1">
                {(multiAtomGroup.componentWordIndices || []).map(i => {
                  if (i === targetAtomIdx) return null;
                  const w = rawWords[i];
                  if (!w) return null;
                  return (
                    <button
                      key={`gat-${i}`}
                      onClick={() => setHighlight({ kind: 'group', id: multiAtomGroup.id, focusAtomIdx: i })}
                      className="px-1 py-0.5 rounded text-[9px] border border-md-outline-variant/30 text-md-on-surface hover:border-md-primary"
                      title={`Switch focus to atom #${i} "${w.text}"`}
                    >
                      <span className="font-mono">{w.text}</span>
                      <span className="text-md-on-surface-variant ml-1">#{i}</span>
                      <LabelPill atomIdx={i} labelByAtomIdx={labelByAtomIdx} compact />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PipelineDelta({ pipeline }) {
  if (!pipeline) return null;
  const b = pipeline.baseline || {};
  const a = pipeline.afterStoppers || {};
  const f = pipeline.final || {};
  const item = (label, k) => {
    const bv = b[k] ?? 0, fv = f[k] ?? 0;
    const delta = fv - bv;
    const color = (k === 'conflictAtoms' || k === 'ungroupedAtoms')
      ? (delta < 0 ? 'text-emerald-400' : delta > 0 ? 'text-red-400' : 'text-md-on-surface-variant')
      : (delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-md-on-surface-variant');
    const sign = delta > 0 ? '+' : '';
    return (
      <span className="text-[10px] mr-3" key={k}>
        <span className="text-md-on-surface-variant">{label}: </span>
        <span className="text-md-on-surface font-bold">{bv}</span>
        <span className="text-md-on-surface-variant"> → </span>
        <span className="text-md-on-surface font-bold">{fv}</span>
        {delta !== 0 && (
          <span className={`ml-1 ${color}`}>({sign}{delta})</span>
        )}
      </span>
    );
  };
  // Show afterStoppers separately if it differs from baseline AND from final
  const showAfterStoppers = a.totalGroups !== b.totalGroups && a.totalGroups !== f.totalGroups;
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-md-on-surface-variant uppercase tracking-wide mr-1">Δ</span>
      {item('groups', 'totalGroups')}
      {item('multi', 'multiWordGroups')}
      {item('conflicts', 'conflictAtoms')}
      {item('ungrouped', 'ungroupedAtoms')}
      {showAfterStoppers && (
        <span className="text-[9px] text-cyan-300 ml-1" title="After stoppers (before arbitration)">
          [stoppers→ {a.totalGroups}g/{a.conflictAtoms}c]
        </span>
      )}
    </div>
  );
}

function SidePanelStats({ stats = {}, sourceBreakdown = [], pipeline = null }) {
  return (
    <div className="p-3 border-b border-md-outline-variant/20">
      <div className="text-label-sm font-bold text-md-on-surface mb-2">Coverage (final)</div>
      <div className="grid grid-cols-2 gap-2 text-[10px] text-md-on-surface-variant">
        <Stat label="Total atoms" value={stats.totalRawWords ?? 0} />
        <Stat label="Total groups" value={stats.totalGroups ?? 0} />
        <Stat label="Multi-word" value={stats.multiWordGroups ?? 0} />
        <Stat label="Single-word" value={stats.singleWordGroups ?? 0} />
        <Stat label="Atoms in multi-word" value={stats.atomsInMultiWordGroup ?? 0} />
        <Stat label="Ungrouped atoms" value={stats.ungroupedAtoms ?? 0} accent="text-red-400" />
        <Stat label="Conflicts" value={stats.conflictAtoms ?? 0} accent="text-yellow-400" />
        <Stat label="Coverage" value={`${stats.coveragePct ?? 0}%`} accent="text-emerald-400" />
      </div>

      {pipeline && (pipeline.baseline?.totalGroups !== pipeline.final?.totalGroups) && (
        <div className="mt-3">
          <div className="text-label-sm font-bold text-md-on-surface mb-1">Pipeline impact</div>
          <PipelineRow row="Baseline (no stoppers/arb)" v={pipeline.baseline} />
          <PipelineRow row="After stoppers" v={pipeline.afterStoppers} />
          <PipelineRow row="After arbitration" v={pipeline.final} />
        </div>
      )}

      <div className="text-label-sm font-bold text-md-on-surface mt-3 mb-1.5">Per-source breakdown</div>
      <div className="text-[10px]">
        <table className="w-full">
          <thead className="text-md-on-surface-variant">
            <tr>
              <th className="text-left font-semibold pb-1">Source</th>
              <th className="text-right font-semibold pb-1">Total</th>
              <th className="text-right font-semibold pb-1">≥2-word</th>
              <th className="text-right font-semibold pb-1">μ-conf</th>
              <th className="text-right font-semibold pb-1">μ-maxGap</th>
            </tr>
          </thead>
          <tbody>
            {sourceBreakdown.length === 0 && <tr><td colSpan={5} className="text-md-on-surface-variant py-1">No groups produced.</td></tr>}
            {sourceBreakdown.map(b => {
              const s = styleForSource(b.source);
              return (
                <tr key={b.source} className="border-t border-md-outline-variant/15">
                  <td className="py-1" style={{ color: s.text }}>{s.label}</td>
                  <td className="py-1 text-right text-md-on-surface">{b.groupCount}</td>
                  <td className="py-1 text-right text-md-on-surface">{b.multiWordCount}</td>
                  <td className="py-1 text-right text-md-on-surface-variant">{b.meanConfidence?.toFixed(2)}</td>
                  <td className="py-1 text-right text-md-on-surface-variant">{(b.meanMaxGapPx || 0).toFixed(0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PipelineRow({ row, v = {} }) {
  return (
    <div className="grid grid-cols-5 gap-1 text-[10px] py-0.5 border-b border-md-outline-variant/10 last:border-b-0">
      <span className="col-span-2 text-md-on-surface-variant truncate">{row}</span>
      <span className="text-right text-md-on-surface" title="total groups">{v.totalGroups ?? '-'}</span>
      <span className="text-right text-yellow-400" title="conflict atoms">{v.conflictAtoms ?? '-'}</span>
      <span className="text-right text-red-400" title="ungrouped atoms">{v.ungroupedAtoms ?? '-'}</span>
    </div>
  );
}

function SidePanelConflicts({ conflicts = [], highlight, setHighlight, labelByAtomIdx = new Map() }) {
  if (conflicts.length === 0) {
    return (
      <div className="p-3 border-b border-md-outline-variant/20">
        <div className="text-label-sm font-bold text-md-on-surface mb-1">Conflicts</div>
        <div className="text-[10px] text-md-on-surface-variant">No conflicts detected — every atom belongs to at most one multi-word group.</div>
      </div>
    );
  }
  return (
    <div className="p-3 border-b border-md-outline-variant/20">
      <div className="text-label-sm font-bold text-md-on-surface mb-1">Conflicts <span className="text-yellow-400">({conflicts.length})</span></div>
      <div className="text-[9px] text-md-on-surface-variant mb-2">
        Atoms claimed by 2+ multi-word groups. Pick an arbitration mode above to resolve them.
      </div>
      <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
        {conflicts.map(c => {
          const isActive = highlight?.kind === 'atom' && highlight.id === c.wordIndex;
          return (
            <button
              key={c.wordIndex}
              onClick={() => setHighlight({ kind: 'atom', id: c.wordIndex })}
              className={`block w-full text-left px-2 py-1 rounded text-[10px] border ${isActive ? 'border-yellow-400 bg-yellow-400/10' : 'border-md-outline-variant/20 hover:border-yellow-400/60'}`}
            >
              <div className="font-bold text-md-on-surface">
                "{c.wordText}"
                <span className="text-md-on-surface-variant font-normal"> (atom #{c.wordIndex})</span>
                <LabelPill atomIdx={c.wordIndex} labelByAtomIdx={labelByAtomIdx} />
              </div>
              <div className="text-md-on-surface-variant mt-0.5">
                {c.groupTexts.map((t, i) => (
                  <span key={i} className="inline-block mr-1">
                    <span style={{ color: styleForSource(c.groupSources[i]).text }}>[{c.groupSources[i]}]</span>{' '}
                    <span className="text-md-on-surface">{t}</span>
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidePanelUngrouped({ rawWords = [], ungroupedIdx = [], highlight, setHighlight, labelByAtomIdx = new Map() }) {
  const [filter, setFilter] = useState('');
  const list = useMemo(() => {
    const set = new Set(ungroupedIdx);
    const items = rawWords.filter(w => set.has(w.idx));
    if (!filter) return items;
    const t = filter.toLowerCase();
    return items.filter(w => String(w.text || '').toLowerCase().includes(t));
  }, [rawWords, ungroupedIdx, filter]);

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-label-sm font-bold text-md-on-surface">
          Ungrouped atoms <span className="text-red-400">({ungroupedIdx.length})</span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter…"
          className="bg-transparent border border-md-outline-variant/30 rounded px-1.5 py-0.5 text-[10px] text-md-on-surface placeholder:text-md-on-surface-variant/60 outline-none w-24"
        />
      </div>
      <div className="text-[9px] text-md-on-surface-variant mb-2">
        Atoms that ended up in NO multi-word group. Click an entry to highlight it on the drawing.
      </div>
      <div className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
        {list.length === 0 && (
          <div className="text-[10px] text-md-on-surface-variant italic">
            {ungroupedIdx.length === 0 ? 'Every atom landed inside a multi-word group.' : 'No atoms match the filter.'}
          </div>
        )}
        {list.slice(0, 500).map(w => {
          const isActive = highlight?.kind === 'atom' && highlight.id === w.idx;
          return (
            <button
              key={w.idx}
              onClick={() => setHighlight({ kind: 'atom', id: w.idx })}
              className={`block w-full text-left px-1.5 py-0.5 rounded text-[10px] border ${isActive ? 'border-red-400 bg-red-400/10' : 'border-transparent hover:border-red-400/40'}`}
            >
              <span className="text-md-on-surface font-mono">"{w.text}"</span>
              <span className="text-md-on-surface-variant ml-1">#{w.idx}</span>
              {w.confidence != null && <span className="text-md-on-surface-variant ml-1">· {Number(w.confidence).toFixed(2)}</span>}
              <LabelPill atomIdx={w.idx} labelByAtomIdx={labelByAtomIdx} />
            </button>
          );
        })}
        {list.length > 500 && (
          <div className="text-[9px] text-md-on-surface-variant italic mt-1">
            … {list.length - 500} more (use filter to narrow)
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'text-md-on-surface' }) {
  return (
    <div className="rounded border border-md-outline-variant/20 px-2 py-1">
      <div className="text-md-on-surface-variant uppercase tracking-wide">{label}</div>
      <div className={`text-[14px] font-bold ${accent}`}>{value}</div>
    </div>
  );
}

const OCR_AUDIT_LABELS = {
  prefix_returned_but_unpaired: { label: 'Prefix returned, pairing rejected', color: 'text-yellow-300', tag: 'ALG', tagColor: 'bg-yellow-400/25 text-yellow-300' },
  noisy_atoms_only:              { label: 'Only noise/numbers above',         color: 'text-orange-300', tag: 'OCR?', tagColor: 'bg-orange-400/25 text-orange-300' },
  prefix_dropped:                { label: 'Nothing above (OCR dropped prefix)', color: 'text-red-400', tag: 'OCR', tagColor: 'bg-red-400/25 text-red-300' },
  isolated:                      { label: 'No neighbours at all',              color: 'text-md-on-surface-variant', tag: '\u2014', tagColor: 'bg-md-on-surface/10 text-md-on-surface-variant' },
};

function ocrAuditMeta(code) {
  return OCR_AUDIT_LABELS[code] || { label: code, color: 'text-md-on-surface', tag: '?', tagColor: 'bg-md-on-surface/10 text-md-on-surface-variant' };
}

function SidePanelOcrAudit({
  ocrAudit,
  highlight,
  setHighlight,
  onRunRepass,
  repassRunning = false,
  repassSummary = null,
  labelByAtomIdx = new Map(),
}) {
  const reports = ocrAudit?.reports || [];
  const counts = ocrAudit?.counts || {};
  const repassRegions = ocrAudit?.suggestedRepassRegions?.length || 0;
  const [expandedClass, setExpandedClass] = useState(null);
  const [filter, setFilter] = useState('');

  const ordered = useMemo(() => {
    return ['prefix_dropped', 'noisy_atoms_only', 'prefix_returned_but_unpaired', 'isolated']
      .filter(k => counts[k] != null);
  }, [counts]);

  const filteredReports = useMemo(() => {
    if (!expandedClass) return [];
    let rows = reports.filter(r => r.classification === expandedClass);
    if (filter) {
      const t = filter.toLowerCase();
      rows = rows.filter(r => String(r.midText || '').toLowerCase().includes(t));
    }
    return rows;
  }, [reports, expandedClass, filter]);

  const totalUnpaired = reports.length;
  if (totalUnpaired === 0 && repassRegions === 0) {
    return (
      <div className="p-3 border-b border-md-outline-variant/20">
        <div className="text-label-sm font-bold text-md-on-surface mb-1">OCR-miss audit</div>
        <div className="text-[10px] text-md-on-surface-variant">Every ISA-mid is paired. No OCR-prefix-loss or unpaired bubbles.</div>
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-md-outline-variant/20">
      <div className="text-label-sm font-bold text-md-on-surface mb-1">
        OCR-miss audit
        <span className="text-md-on-surface-variant ml-1 font-normal">({totalUnpaired} unpaired ISA mids)</span>
      </div>
      <div className="text-[9px] text-md-on-surface-variant mb-2">
        For every ISA-shaped mid that ended up in NO multi-word group, classifies the cause as
        <span className="text-yellow-300"> algorithm </span>(prefix exists, pair rejected) vs
        <span className="text-red-300"> OCR-layer </span>(prefix not in OCR data).
        {repassRegions > 0 && <> <span className="text-emerald-300">{repassRegions} regions</span> are candidates for Vision API re-pass.</>}
      </div>
      {repassRegions > 0 && (
        <div className="mb-2">
          <button
            onClick={() => onRunRepass?.(ocrAudit?.suggestedRepassRegions || [])}
            disabled={repassRunning}
            className="w-full px-2 py-1 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/25 disabled:opacity-50"
            title="Re-run Vision OCR only on suggested bubble regions, merge rescued atoms, then re-run this diagnostic"
          >
            {repassRunning ? (
              <>
                <span className="material-symbols-outlined text-[12px] align-middle mr-1 animate-spin">progress_activity</span>
                Re-OCR missed bubbles…
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[12px] align-middle mr-1">document_scanner</span>
                Re-OCR missed bubbles
              </>
            )}
          </button>
          {repassSummary && (
            <div className="mt-1 text-[9px] text-md-on-surface-variant">
              processed {repassSummary.regionsProcessed ?? 0} region(s), succeeded {repassSummary.regionsSucceeded ?? 0},
              rescued {repassSummary.atomsRescued ?? 0} atom(s), merged +{repassSummary.mergedAddedCount ?? 0}
            </div>
          )}
        </div>
      )}
      <div className="space-y-1">
        {ordered.map(code => {
          const meta = ocrAuditMeta(code);
          const cnt = counts[code] || 0;
          const isOpen = expandedClass === code;
          return (
            <div key={code} className="border border-md-outline-variant/20 rounded">
              <button
                onClick={() => setExpandedClass(isOpen ? null : code)}
                className="w-full text-left px-2 py-1 flex items-center justify-between hover:bg-md-on-surface/5"
              >
                <span className={`text-[10px] ${meta.color} flex-1 truncate`}>{meta.label}</span>
                <span className={`text-[8px] font-bold uppercase rounded px-1 mr-1 ${meta.tagColor}`}>{meta.tag}</span>
                <span className="text-[10px] font-bold text-md-on-surface">{cnt}</span>
              </button>
              {isOpen && (
                <div className="border-t border-md-outline-variant/15 p-1.5">
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="filter by mid text…"
                    className="w-full bg-transparent border border-md-outline-variant/30 rounded px-1.5 py-0.5 text-[10px] text-md-on-surface placeholder:text-md-on-surface-variant/60 outline-none mb-1.5"
                  />
                  <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                    {filteredReports.slice(0, 200).map((r, i) => {
                      const isActive = highlight?.kind === 'atom' && highlight.id === r.midWordIndex;
                      return (
                        <button
                          key={`${r.midWordIndex}-${i}`}
                          onClick={() => setHighlight({
                            kind: 'atom',
                            id: r.midWordIndex,
                            candidatePrefixIdx: r.bestPrefixCandidate?.idx,
                          })}
                          className={`block w-full text-left px-1.5 py-1 rounded text-[10px] border ${isActive ? 'border-cyan-400 bg-cyan-400/10' : 'border-transparent hover:border-cyan-400/40'}`}
                        >
                          <div>
                            <span className="text-md-on-surface font-mono font-bold">"{r.midText}"</span>
                            <span className="text-md-on-surface-variant ml-1">#{r.midWordIndex}</span>
                            <span className="text-md-on-surface-variant ml-1">@({Math.round(r.midCoords.cx)},{Math.round(r.midCoords.cy)})</span>
                            <LabelPill atomIdx={r.midWordIndex} labelByAtomIdx={labelByAtomIdx} />
                          </div>
                          {r.bestPrefixCandidate ? (
                            <div className="text-md-on-surface-variant mt-0.5">
                              prefix <span className="text-md-on-surface font-mono">"{r.bestPrefixCandidate.text}"</span> at xOff={r.bestPrefixCandidate.xOff?.toFixed(0)}px, yOff={r.bestPrefixCandidate.yOff?.toFixed(0)}px
                            </div>
                          ) : r.neighborsAbove?.length ? (
                            <div className="text-md-on-surface-variant mt-0.5">
                              above: {r.neighborsAbove.slice(0, 2).map(n => `"${n.text}"`).join(', ')}
                            </div>
                          ) : (
                            <div className="text-red-300/80 mt-0.5">no text in bubble region above</div>
                          )}
                        </button>
                      );
                    })}
                    {filteredReports.length > 200 && (
                      <div className="text-[9px] text-md-on-surface-variant italic">… {filteredReports.length - 200} more (filter to narrow)</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const REASON_LABELS = {
  formed:                    { label: 'Formed (already in strict vertical_isa)', color: 'text-emerald-400', priority: 9 },
  no_prefix_in_range:        { label: 'No prefix above (no code-shaped atom in Y-range)', color: 'text-red-400', priority: 1 },
  prefix_too_far_y:          { label: 'Prefix exists but Y-gap > strict threshold', color: 'text-orange-400', priority: 2 },
  prefix_too_far_x:          { label: 'Prefix exists but X-offset > strict threshold', color: 'text-orange-400', priority: 3 },
  prefix_too_far_xy:         { label: 'Prefix exists but BOTH X and Y out of range', color: 'text-orange-300', priority: 4 },
  prefix_text_loose:         { label: 'Prefix found but text matches loose only (not /^[A-Z]{2,5}$/)', color: 'text-yellow-400', priority: 5 },
  no_suffix_but_prefix_ok:   { label: 'Prefix OK; suffix missing/score-pruned', color: 'text-yellow-300', priority: 6 },
  malformed_text:            { label: 'Mid text matches loose only (e.g. trailing letter/dot)', color: 'text-pink-300', priority: 7 },
};

function reasonMeta(code) {
  return REASON_LABELS[code] || { label: code, color: 'text-md-on-surface', priority: 8 };
}

function SidePanelVerticalMisses({ verticalMisses, highlight, setHighlight, labelByAtomIdx = new Map() }) {
  const counts = verticalMisses?.counts || {};
  const reports = verticalMisses?.reports || [];
  const [expandedReason, setExpandedReason] = useState(null);
  const [filter, setFilter] = useState('');

  // Order reasons by priority (problems first, "formed" last)
  const reasonOrder = useMemo(() => {
    return Object.keys(counts).sort((a, b) => reasonMeta(a).priority - reasonMeta(b).priority);
  }, [counts]);

  const filteredReports = useMemo(() => {
    if (!expandedReason) return [];
    let rows = reports.filter(r => r.reason === expandedReason);
    if (filter) {
      const t = filter.toLowerCase();
      rows = rows.filter(r => String(r.text || '').toLowerCase().includes(t));
    }
    return rows;
  }, [reports, expandedReason, filter]);

  const totalProblematic = reasonOrder
    .filter(r => r !== 'formed')
    .reduce((s, r) => s + (counts[r] || 0), 0);

  return (
    <div className="p-3 border-b border-md-outline-variant/20">
      <div className="text-label-sm font-bold text-md-on-surface mb-1">
        Vertical-miss explainer
        {totalProblematic > 0 && <span className="text-red-400 ml-1">({totalProblematic} problematic)</span>}
      </div>
      <div className="text-[9px] text-md-on-surface-variant mb-2">
        For every atom that LOOKS like an ISA mid (\d{'{3,7}'}) the strict vertical_isa logic is replayed against
        all atoms within local Y-window. Reasons rank why production WordGrouper.js failed to form a stack.
      </div>
      {reasonOrder.length === 0 && (
        <div className="text-[10px] text-md-on-surface-variant italic">No ISA-pattern mids on this page.</div>
      )}
      <div className="space-y-1">
        {reasonOrder.map(code => {
          const meta = reasonMeta(code);
          const cnt = counts[code] || 0;
          const isOpen = expandedReason === code;
          return (
            <div key={code} className="border border-md-outline-variant/20 rounded">
              <button
                onClick={() => setExpandedReason(isOpen ? null : code)}
                className="w-full text-left px-2 py-1 flex items-center justify-between hover:bg-md-on-surface/5"
              >
                <span className={`text-[10px] ${meta.color}`}>{meta.label}</span>
                <span className="text-[10px] font-bold text-md-on-surface ml-2">{cnt}</span>
              </button>
              {isOpen && (
                <div className="border-t border-md-outline-variant/15 p-1.5">
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="filter by mid text…"
                    className="w-full bg-transparent border border-md-outline-variant/30 rounded px-1.5 py-0.5 text-[10px] text-md-on-surface placeholder:text-md-on-surface-variant/60 outline-none mb-1.5"
                  />
                  <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                    {filteredReports.slice(0, 200).map((r, i) => {
                      const isActive = highlight?.kind === 'atom' && highlight.id === r.wordIndex;
                      return (
                        <button
                          key={`${r.wordIndex}-${i}`}
                          onClick={() => setHighlight({
                            kind: 'atom',
                            id: r.wordIndex,
                            candidatePrefixIdx: r.candidatePrefix?.wordIndex,
                          })}
                          className={`block w-full text-left px-1.5 py-1 rounded text-[10px] border ${isActive ? 'border-cyan-400 bg-cyan-400/10' : 'border-transparent hover:border-cyan-400/40'}`}
                        >
                          <div>
                            <span className="text-md-on-surface font-mono font-bold">"{r.text}"</span>
                            <span className="text-md-on-surface-variant ml-1">#{r.wordIndex}</span>
                            <LabelPill atomIdx={r.wordIndex} labelByAtomIdx={labelByAtomIdx} />
                          </div>
                          {r.candidatePrefix && (
                            <div className="text-md-on-surface-variant mt-0.5">
                              prefix candidate <span className="text-md-on-surface font-mono">"{r.candidatePrefix.text}"</span>
                              {' • '}xOffset {r.candidatePrefix.xOffsetPx}px / yGap {r.candidatePrefix.yGapPx}px
                            </div>
                          )}
                          {r.thresholds && (
                            <div className="text-md-on-surface-variant/80 mt-0.5">
                              strict allowed: alignTol≤{r.thresholds.alignTolPx}px, maxGapY≤{r.thresholds.maxGapYPx}px (localH={r.thresholds.localMeanH}px)
                            </div>
                          )}
                        </button>
                      );
                    })}
                    {filteredReports.length > 200 && (
                      <div className="text-[9px] text-md-on-surface-variant italic">… {filteredReports.length - 200} more (filter to narrow)</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
