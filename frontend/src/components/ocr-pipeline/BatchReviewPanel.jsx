import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { md } from '../../lib/theme';
import { useOcrBatches, useOcrBatchDetail, useBatchStages, useStageFile, useCandidateLedger, useRunStage2, useRunStage2GroupingOnly, useRunStage2Multi, useStage2Progress, useSaveReview, useReviewSummary, useExportBatch, usePassToAnnotation, getStageFileDownloadUrl } from '../../hooks/useOcrPipelineV2';
import PdfCanvas from '../pnid/PdfCanvas';
import GroupingDiagnosticView from './GroupingDiagnosticView';
import ReviewTriage from './ReviewTriage';
import ReviewCanvas from './ReviewCanvas';
import ReviewWorkspace from './ReviewWorkspace';


const BATCH_STATUS = {
  pending:    { label: 'Pending',    color: '#919A9B', icon: 'schedule' },
  processing: { label: 'Processing', color: '#F39C12', icon: 'hourglass_top' },
  completed:  { label: 'Completed',  color: '#3BE494', icon: 'check_circle' },
  partial:    { label: 'Partial',    color: '#E67E22', icon: 'warning' },
  failed:     { label: 'Failed',     color: '#E74C3C', icon: 'error' },
};

const STAGE_STATUS = {
  pending:    { color: '#919A9B', icon: 'radio_button_unchecked', label: 'Pending' },
  processing: { color: '#F39C12', icon: 'progress_activity', label: 'Processing' },
  completed:  { color: '#3BE494', icon: 'check_circle', label: 'Completed' },
  partial:    { color: '#E67E22', icon: 'warning', label: 'Partial' },
  failed:     { color: '#E74C3C', icon: 'error', label: 'Failed' },
};

const STAGES = [
  { key: 'stage1Status', label: 'Extract', num: 1, description: 'Raw OCR extraction', stageKey: 'raw' },
  { key: 'stage2Status', label: 'AI Classify', num: 2, description: 'Group + classify + filter noise', stageKey: 'cleaned' },
  { key: 'stage3Status', label: 'Review', num: 3, description: 'Human review — approve, reject, edit', stageKey: 'review' },
];

const STAGE2_PHASES = [
  { id: 'phase1_ai_only', label: 'A1: Baseline AI', hint: 'Fast baseline classification without grouped hints or rescue.', shortLabel: 'A1 Baseline' },
  { id: 'phase2_grouped_hints', label: 'A2: Assisted AI', hint: 'Recommended default. Uses grouped hints for better precision.', shortLabel: 'A2 Recommended' },
  { id: 'phase3_full_rescue', label: 'A3: Full Rescue', hint: 'Most aggressive pass with grouped hints and rescue logic.', shortLabel: 'A3 Full Rescue' },
];

function stage2ShortLabel(profileId) {
  return STAGE2_PHASES.find((p) => p.id === profileId)?.shortLabel || 'AI';
}

const MISSING_REASON_POLICY_STORAGE_KEY = 'ocr.missingReasonPolicy.v1';
const DEFAULT_MISSING_REASON_POLICY = {
  REJECT_ASSEMBLY_CONFLICT: 'rescue',
};

function loadMissingReasonPolicy() {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_MISSING_REASON_POLICY };
    const raw = window.localStorage.getItem(MISSING_REASON_POLICY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_MISSING_REASON_POLICY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_MISSING_REASON_POLICY };
    return { ...DEFAULT_MISSING_REASON_POLICY, ...parsed };
  } catch {
    return { ...DEFAULT_MISSING_REASON_POLICY };
  }
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * BatchReviewPanel — Multi-batch review with per-file selection.
 * Select batches via checkboxes, deselect individual files, run Stage 2 on all selected.
 */
export default function BatchReviewPanel({ platformId, initialBatchId }) {
  const { data: batches } = useOcrBatches(platformId);
  const completedBatches = useMemo(() =>
    (batches || []).filter(b => b.status === 'completed' || b.status === 'partial' || b.status === 'failed'),
    [batches]
  );

  // Multi-batch selection
  const [checkedBatchIds, setCheckedBatchIds] = useState(new Set());
  const [excludedFileIds, setExcludedFileIds] = useState(new Set());
  // Which batch is expanded to show files
  const [expandedBatchId, setExpandedBatchId] = useState(initialBatchId || '');
  // Multi-select mode
  const [multiMode, setMultiMode] = useState(false);

  const runStage2Multi = useRunStage2Multi();

  const toggleBatch = useCallback((batchId) => {
    setCheckedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
      return next;
    });
  }, []);

  const toggleFileExclude = useCallback((fileId) => {
    setExcludedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  }, []);

  const selectAll = () => setCheckedBatchIds(new Set(completedBatches.map(b => b.id)));
  const selectNone = () => { setCheckedBatchIds(new Set()); setExcludedFileIds(new Set()); };

  // Build selections for multi-batch Stage 2
  const handleRunMultiStage2 = () => {
    const selections = [...checkedBatchIds].map(batchId => ({
      batchId,
      // If any files excluded from this batch, pass only the included file IDs
      // (we don't have file IDs here, so we pass excluded and let backend handle it)
    }));
    if (selections.length === 0) return;
    runStage2Multi.mutate({ selections });
  };

  // Single batch mode — use expandedBatchId as the active batch
  const effectiveBatchId = expandedBatchId || completedBatches[0]?.id || '';
  const selectedBatch = completedBatches.find(b => b.id === effectiveBatchId);

  if (!completedBatches.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
        <span className="material-symbols-outlined text-[40px] opacity-30 mb-2">analytics</span>
        <span className="text-body-md">No completed batches to review</span>
        <span className="text-body-sm opacity-60 mt-1">Process some files first, then come back here</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header bar with mode toggle */}
      <div className="px-4 pt-3 pb-2 border-b border-md-outline-variant/15 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-[18px] text-md-primary">analytics</span>
          <span className="text-label-sm text-md-on-surface-variant font-semibold flex-1">
            {completedBatches.length} batch{completedBatches.length > 1 ? 'es' : ''} available
          </span>

          {/* Mode toggle */}
          <button
            onClick={() => { setMultiMode(!multiMode); selectNone(); }}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
              multiMode ? 'bg-[#A855F7]/15 text-[#A855F7]' : 'bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{multiMode ? 'checklist' : 'view_list'}</span>
            {multiMode ? 'Multi-Select Mode' : 'Single Batch Mode'}
          </button>

          {/* Multi-select actions */}
          {multiMode && (
            <>
              <button onClick={selectAll} className="text-[10px] text-md-primary hover:underline">Select All</button>
              <button onClick={selectNone} className="text-[10px] text-md-on-surface-variant hover:underline">Clear</button>
              <button
                onClick={handleRunMultiStage2}
                disabled={checkedBatchIds.size === 0 || runStage2Multi.isPending}
                className="flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-bold transition-all disabled:opacity-30"
                style={{ background: '#A855F718', color: '#A855F7' }}
              >
                {runStage2Multi.isPending ? (
                  <span className="material-symbols-outlined animate-spin text-[13px]">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-[13px]">psychology</span>
                )}
                Run Stage 2 on {checkedBatchIds.size} batch{checkedBatchIds.size !== 1 ? 'es' : ''}
              </button>
            </>
          )}
        </div>

        {runStage2Multi.isSuccess && (
          <div className="mt-1.5 text-[10px] text-green-400">Stage 2 started for {checkedBatchIds.size} batches — check progress below.</div>
        )}
        {runStage2Multi.isError && (
          <div className="mt-1.5 text-[10px] text-red-400">Error: {runStage2Multi.error?.message}</div>
        )}
      </div>

      {/* Multi-select: batch list with checkboxes */}
      {multiMode ? (
        <div className="flex-1 overflow-auto">
          {completedBatches.map(b => {
            const isChecked = checkedBatchIds.has(b.id);
            const isExpanded = expandedBatchId === b.id;
            const bStatus = BATCH_STATUS[b.status] || BATCH_STATUS.pending;
            const s1 = b.stage1Status || 'pending';
            const s2 = b.stage2Status || 'pending';
            return (
              <div key={b.id} className={`border-b border-md-outline-variant/10 ${isChecked ? 'bg-[#A855F7]/3' : ''}`}>
                <div className="flex items-center gap-2 px-4 py-2 hover:bg-md-on-surface/3 cursor-pointer"
                  onClick={() => setExpandedBatchId(isExpanded ? '' : b.id)}>
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={e => { e.stopPropagation(); toggleBatch(b.id); }}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 accent-[#A855F7]"
                  />
                  {/* Batch info */}
                  <span className="material-symbols-outlined text-[16px]" style={{ color: bStatus.color }}>{bStatus.icon}</span>
                  <span className="text-[12px] font-bold text-md-on-surface flex-1">{b.batchName || b.id.slice(0, 8)}</span>
                  <span className="text-[10px] text-md-on-surface-variant">{b.totalFiles} files</span>
                  {/* Stage badges */}
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                    style={{ background: `${STAGE_STATUS[s1]?.color}15`, color: STAGE_STATUS[s1]?.color }}>
                    S1: {s1}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                    style={{ background: `${STAGE_STATUS[s2]?.color}15`, color: STAGE_STATUS[s2]?.color }}>
                    S2: {s2}
                  </span>
                  <span className="text-[10px] text-md-on-surface-variant">{timeAgo(b.completedAt || b.startedAt)}</span>
                  <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">
                    {isExpanded ? 'expand_less' : 'expand_more'}
                  </span>
                </div>
                {/* Expanded: show files with checkboxes */}
                {isExpanded && (
                  <BatchFilesWithCheckboxes
                    batchId={b.id}
                    excludedFileIds={excludedFileIds}
                    onToggleFile={toggleFileExclude}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Single batch mode — dropdown + detail view */
        <>
          <div className="px-4 pt-2 pb-1 shrink-0">
            <select
              value={effectiveBatchId}
              onChange={e => setExpandedBatchId(e.target.value)}
              className="w-full max-w-md px-3 py-1.5 bg-md-surface rounded-md border border-md-outline-variant/30 text-body-sm text-md-on-surface outline-none focus:border-md-primary/50"
            >
              {completedBatches.map(b => {
                const s = BATCH_STATUS[b.status] || BATCH_STATUS.pending;
                return (
                  <option key={b.id} value={b.id}>
                    {b.batchName || b.id.slice(0, 8)} — {b.totalFiles} files — {s.label} — {timeAgo(b.completedAt || b.startedAt)}
                  </option>
                );
              })}
            </select>
          </div>
          {selectedBatch && (
            <BatchReview batch={selectedBatch} platformId={platformId} />
          )}
        </>
      )}

    </div>
  );
}

/** File list with checkboxes for multi-batch mode — allows deselecting individual files */
function BatchFilesWithCheckboxes({ batchId, excludedFileIds, onToggleFile }) {
  const { data: detail } = useOcrBatchDetail(batchId);
  if (!detail?.files) return <div className="px-8 py-2 text-[10px] text-md-on-surface-variant">Loading files...</div>;

  return (
    <div className="px-6 pb-2">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-md-on-surface-variant">
            <th className="px-2 py-1 w-6"></th>
            <th className="px-2 py-1">Filename</th>
            <th className="px-2 py-1">Drawing</th>
            <th className="px-2 py-1 text-center">Words</th>
            <th className="px-2 py-1 text-center">Raw</th>
            <th className="px-2 py-1 text-center">Classified</th>
            <th className="px-2 py-1 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {detail.files.map(f => {
            const excluded = excludedFileIds.has(f.id);
            const fStatus = BATCH_STATUS[f.status] || BATCH_STATUS.pending;
            return (
              <tr key={f.id} className={`border-t border-md-outline-variant/5 ${excluded ? 'opacity-30' : ''}`}>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={!excluded} onChange={() => onToggleFile(f.id)}
                    className="w-3 h-3 accent-[#A855F7]" />
                </td>
                <td className="px-2 py-1 font-mono text-md-on-surface">{f.filename}</td>
                <td className="px-2 py-1">{f.drawingNumber || '—'}</td>
                <td className="px-2 py-1 text-center">{f.tagsFound || '—'}</td>
                <td className="px-2 py-1 text-center">
                  {f.rawOutputKey ? <span className="text-[#3BE494]">&#10003;</span> : '—'}
                </td>
                <td className="px-2 py-1 text-center">
                  {f.cleanedOutputKey ? <span className="text-[#3BE494]">&#10003;</span> : '—'}
                </td>
                <td className="px-2 py-1 text-center">
                  <span style={{ color: fStatus.color }}>{fStatus.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BatchReview({ batch, platformId }) {
  const { data: detail } = useOcrBatchDetail(batch.id);
  const batchDetail = detail?.batch || batch;
  const statusInfo = BATCH_STATUS[batch.status] || BATCH_STATUS.pending;
  const runStage2 = useRunStage2();
  const runStage2MultiSingle = useRunStage2Multi();
  const runGroupingOnly = useRunStage2GroupingOnly();
  const exportBatch = useExportBatch();
  const passToAnnotation = usePassToAnnotation();
  const [groupingOnlyReport, setGroupingOnlyReport] = useState(null);
  const [stage2PhaseProfile, setStage2PhaseProfile] = useState('phase1_ai_only');
  const [selectedStage2FileIds, setSelectedStage2FileIds] = useState(new Set());

  // File selected for viewing stage output
  const [viewingFile, setViewingFile] = useState(null);
  const [viewingStage, setViewingStage] = useState(null);
  // File selected for human review (legacy detailed editor)
  const [reviewingFile, setReviewingFile] = useState(null);
  // File selected for the new triage dashboard (Phase 1 of Review redesign).
  // Triage is the FIRST surface; user opens canvas review from triage.
  const [triagingFile, setTriagingFile] = useState(null);
  // File selected for the new canvas review surface (Phase 2). Receives the
  // auto-accept threshold the user picked in triage so the queue is pre-filtered.
  const [canvasReviewFile, setCanvasReviewFile] = useState(null);
  const [canvasReviewThreshold, setCanvasReviewThreshold] = useState(92);
  // File selected for word-grouping diagnostic (read-only visual audit)
  const [diagnosticFile, setDiagnosticFile] = useState(null);
  // Stage-2 -> Stage-3 handoff queue (per file): rejected candidates promoted for review.
  const [reviewQueueByFile, setReviewQueueByFile] = useState({});
  // New cleaner ReviewWorkspace is the default surface; toggle to fall back to
  // the legacy FileReviewPanel for power-user features.
  const [useLegacyReviewPanel, setUseLegacyReviewPanel] = useState(false);
  const stageViewerRef = useRef(null);
  const selectionSeededForBatchRef = useRef(null);

  // Stage statuses from batch detail
  const s1 = batchDetail.stage1Status || batch.stage1Status || 'pending';
  const s2 = batchDetail.stage2Status || batch.stage2Status || 'pending';
  const s3 = batchDetail.stage3Status || batch.stage3Status || 'pending';

  const { data: progress } = useStage2Progress(batch.id, true);
  // Live progress tracking for Stage 2
  const isStage2Active =
    s2 === 'processing' ||
    progress?.status === 'processing' ||
    runStage2.isPending ||
    runStage2MultiSingle.isPending;
  const [activityLog, setActivityLog] = useState([]);
  const [lastSnapshot, setLastSnapshot] = useState(null);

  useEffect(() => {
    if (!progress?.files || Object.keys(progress.files).length === 0) return;
    setLastSnapshot(progress);
    setActivityLog(prev => {
      const next = [...prev];
      const nowIso = new Date().toISOString();
      for (const [fileId, fp] of Object.entries(progress.files)) {
        const eventKey = `${fileId}|${fp.status}|${fp.chunk || 0}|${fp.totalChunks || 0}|${fp.message || ''}`;
        if (next.some(e => e.key === eventKey)) continue;
        next.push({
          key: eventKey,
          at: nowIso,
          fileId,
          filename: fp.filename,
          status: fp.status,
          phase: fp.phase || '',
          chunk: fp.chunk || 0,
          totalChunks: fp.totalChunks || 0,
          tags: fp.tags || 0,
          noise: fp.noise || 0,
          continuationReferences: fp.continuationReferences || 0,
          autoApproveCount: fp.autoApproveCount || 0,
          humanReviewCount: fp.humanReviewCount || 0,
          autoRejectCount: fp.autoRejectCount || 0,
          latencyMs: fp.latencyMs || 0,
          chunkInputTokens: fp.chunkInputTokens || 0,
          chunkOutputTokens: fp.chunkOutputTokens || 0,
          message: fp.message || '',
          updatedAt: fp.updatedAt || nowIso,
        });
      }
      // Keep latest 150 events for readability.
      return next.slice(-150);
    });
  }, [progress]);

  useEffect(() => {
    if (!viewingFile || !viewingStage || reviewingFile) return;
    const id = setTimeout(() => {
      try {
        stageViewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch {
        // no-op
      }
    }, 60);
    return () => clearTimeout(id);
  }, [viewingFile, viewingStage, reviewingFile]);

  const handleQueueFromStage2 = useCallback((targetFile, candidates = []) => {
    if (!targetFile?.id || !Array.isArray(candidates) || candidates.length === 0) return;
    setReviewQueueByFile((prev) => {
      const existing = Array.isArray(prev[targetFile.id]) ? prev[targetFile.id] : [];
      const merged = [...existing, ...candidates];
      const seen = new Set();
      const deduped = [];
      for (const c of merged) {
        const key = [
          String(c?.text || '').toUpperCase(),
          String(c?.type || 'unknown'),
          String(c?.reason_code || c?.reason || 'unknown'),
          Number(c?.position_pct?.x_pct ?? -1).toFixed(2),
          Number(c?.position_pct?.y_pct ?? -1).toFixed(2),
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
      }
      return { ...prev, [targetFile.id]: deduped };
    });
    setViewingFile(null);
    setViewingStage(null);
    setReviewingFile(targetFile);
  }, []);

  const handleConsumeReviewQueue = useCallback((fileId) => {
    if (!fileId) return;
    setReviewQueueByFile((prev) => {
      if (!prev[fileId]) return prev;
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (selectionSeededForBatchRef.current === batch.id) return;
    if (!Array.isArray(detail?.files) || detail.files.length === 0) return;
    const ids = (detail?.files || [])
      .filter((f) => !!f.rawOutputKey)
      .map((f) => f.id);
    setSelectedStage2FileIds(new Set(ids));
    selectionSeededForBatchRef.current = batch.id;
  }, [detail?.files, batch.id]);

  const toggleStage2FileSelect = useCallback((fileId) => {
    setSelectedStage2FileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const handleRunStage2ByPhase = useCallback((phaseProfile) => {
    setStage2PhaseProfile(phaseProfile);
    runStage2.mutate({ batchId: batch.id, phaseProfile });
  }, [runStage2, batch.id]);

  const handleRunStage2SelectedByPhase = useCallback((phaseProfile) => {
    const ids = Array.from(selectedStage2FileIds);
    if (!ids.length) return;
    setStage2PhaseProfile(phaseProfile);
    runStage2MultiSingle.mutate({
      selections: [{ batchId: batch.id, fileIds: ids }],
      phaseProfile,
    });
  }, [selectedStage2FileIds, runStage2MultiSingle, batch.id]);

  // Smart Stage 2 dispatcher — the user works with ONE button. We auto-detect
  // whether they intend a whole-batch run (all eligible files selected) or a
  // selected-only run (a subset is checked) and route accordingly.
  const eligibleFileCount = useMemo(
    () => (detail?.files || []).filter((f) => !!f.rawOutputKey).length,
    [detail?.files]
  );
  const selectedScopeIsAll = eligibleFileCount > 0 && selectedStage2FileIds.size === eligibleFileCount;
  const stage2Scope = selectedScopeIsAll ? 'all' : 'selected';
  const effectiveStage2PhaseProfile = batchDetail.stage2PhaseProfile || stage2PhaseProfile;

  const handleRunStage2Smart = useCallback(() => {
    if (selectedScopeIsAll) {
      handleRunStage2ByPhase(stage2PhaseProfile);
    } else {
      handleRunStage2SelectedByPhase(stage2PhaseProfile);
    }
  }, [selectedScopeIsAll, stage2PhaseProfile, handleRunStage2ByPhase, handleRunStage2SelectedByPhase]);

  // Derive REAL pipeline status from actual file artefacts, not the (often
  // stale) batch flags. This drives the redesigned Process Panel header.
  const fileRollup = useMemo(() => {
    const list = detail?.files || [];
    const total = list.length;
    const withRaw       = list.filter((f) => !!f.rawOutputKey).length;
    const withClassified= list.filter((f) => !!f.cleanedOutputKey).length;
    const reviewedDone  = list.filter((f) => f.reviewStatus === 'completed').length;
    const reviewedPart  = list.filter((f) => f.reviewStatus === 'partial').length;
    const reviewedAny   = list.filter((f) => !!f.reviewOutputKey || ['completed', 'partial'].includes(String(f.reviewStatus))).length;
    return {
      total,
      stage1: { done: withRaw,       label: total > 0 && withRaw === total       ? 'completed' : (withRaw > 0       ? 'partial' : 'pending') },
      stage2: { done: withClassified,label: total > 0 && withClassified === total? 'completed' : (withClassified > 0? 'partial' : 'pending') },
      stage3: { done: reviewedDone,  any: reviewedAny, partial: reviewedPart, label: total > 0 && reviewedDone === total ? 'completed' : (reviewedAny > 0 ? 'partial' : 'pending') },
    };
  }, [detail?.files]);
  const shipReady = fileRollup.total > 0 && fileRollup.stage2.done === fileRollup.total && fileRollup.stage3.done === fileRollup.total;

  const stage2Snapshot = progress || lastSnapshot || null;
  const checklist = useMemo(() => {
    const p = stage2Snapshot;
    if (!p) return null;
    const total = Number(p.totalFiles || 0);
    const completed = Number(p.completedFiles || 0);
    const failed = Number(p.failedFiles || 0);
    const tags = Number(p.totalTags || 0);
    const recovered = Number(p.totalDeterministicRecovered || 0);
    const rescued = Number(p.totalCoverageRescued || 0);
    const continuation = Number(p.totalContinuationRefs || 0);
    return {
      phaseProfile: p.phaseProfile || runStage2.data?.phaseProfile || stage2PhaseProfile,
      total,
      completed,
      failed,
      tags,
      recovered,
      rescued,
      continuation,
      completionPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }, [stage2Snapshot, runStage2.data?.phaseProfile, stage2PhaseProfile]);

  const handleRunGroupingOnly = useCallback(async () => {
    try {
      const result = await runGroupingOnly.mutateAsync({ batchId: batch.id });
      setGroupingOnlyReport(result || null);
    } catch {
      // surface via mutation error state
    }
  }, [runGroupingOnly, batch.id]);

  return (
    <div className="flex-1 px-4 py-3 space-y-3">
      {!reviewingFile && (
        <>
      {/* Batch header */}
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-[22px]" style={{ color: statusInfo.color }}>
          {statusInfo.icon}
        </span>
        <div className="flex-1">
          <div className="text-body-md font-bold text-md-on-surface">{batch.batchName}</div>
          <div className="text-label-sm text-md-on-surface-variant flex items-center gap-2">
            <span>{batch.totalFiles} files · {timeAgo(batch.completedAt || batch.startedAt)}</span>
            {batchDetail.ocrProviderUsed && (
              <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5 text-[9px] uppercase font-bold">
                {batchDetail.ocrProviderUsed}
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{ background: `${statusInfo.color}18`, color: statusInfo.color }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Old StagePipeline replaced by the inline Pipeline Tracker below. */}

      {/* ─── PIPELINE TRACKER ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-3 py-2 rounded-md bg-md-surface-container/30 border border-md-outline-variant/10">
        <PipelineStep
          num={1}
          label="OCR Extract"
          status={fileRollup.stage1.label}
          done={fileRollup.stage1.done}
          total={fileRollup.total}
          color="#8AB4FF"
        />
        <PipelineConnector />
        <PipelineStep
          num={2}
          label="AI Classify"
          status={fileRollup.stage2.label}
          done={fileRollup.stage2.done}
          total={fileRollup.total}
          color="#A855F7"
          badge={fileRollup.stage2.done > 0 ? stage2ShortLabel(effectiveStage2PhaseProfile) : null}
        />
        <PipelineConnector />
        <PipelineStep
          num={3}
          label="Human Review"
          status={fileRollup.stage3.label}
          done={fileRollup.stage3.done}
          total={fileRollup.total}
          color="#3BE494"
          extra={fileRollup.stage3.partial > 0 ? `+${fileRollup.stage3.partial} in progress` : null}
        />
        <PipelineConnector />
        <PipelineStep
          num={4}
          label="Ready for P&ID"
          status={batchDetail.passedToAnnotation ? 'completed' : (shipReady ? 'ready' : 'pending')}
          done={batchDetail.passedToAnnotation ? fileRollup.total : 0}
          total={fileRollup.total}
          color="#F39C12"
        />
      </div>

      {/* ─── PROCESS CONTROLS ──────────────────────────────────────────── */}
      {(s1 === 'completed' || s1 === 'partial') && (
        <div className="rounded-md bg-md-surface-container/40 border border-md-outline-variant/10 px-3 py-2 flex flex-col gap-2">
          {/* Phase profile picker — single source of truth for run mode. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-md-on-surface-variant font-bold uppercase">AI strategy (pick one)</span>
            {STAGE2_PHASES.map((phase) => {
              const isActive = stage2PhaseProfile === phase.id;
              return (
                <button
                  key={`mode-${phase.id}`}
                  onClick={() => setStage2PhaseProfile(phase.id)}
                  disabled={runStage2.isPending || runStage2MultiSingle.isPending}
                  className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all disabled:opacity-50 border"
                  style={{
                    background: isActive ? '#A855F730' : 'transparent',
                    borderColor: '#A855F7',
                    color: isActive ? '#D8B4FE' : '#A855F7',
                  }}
                  title={`${phase.label} — ${phase.hint}`}
                >
                  {phase.shortLabel}
                </button>
              );
            })}
            <span className="text-[10px] text-md-on-surface-variant/90 ml-2">
              {STAGE2_PHASES.find((p) => p.id === stage2PhaseProfile)?.hint}
            </span>
            <span className="text-[10px] text-md-on-surface-variant ml-2">
              Scope: <span className="font-bold text-md-on-surface">
                {selectedScopeIsAll
                  ? `Whole batch (${eligibleFileCount} files)`
                  : `Selected (${selectedStage2FileIds.size} of ${eligibleFileCount} files)`}
              </span>
              <span className="text-md-on-surface-variant/70 ml-1">— uncheck files in the table to limit scope</span>
            </span>
          </div>
          <div className="text-[10px] text-md-on-surface-variant">
            Strategy selection does not start processing by itself. Pick A1/A2/A3, then click
            {' '}<span className="font-bold text-md-on-surface">Run/Re-run AI Classify</span>.
          </div>

          {/* Action buttons — single Stage 2 button + utilities + ship */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleRunStage2Smart}
              disabled={
                runStage2.isPending ||
                runStage2MultiSingle.isPending ||
                s2 === 'processing' ||
                (stage2Scope === 'selected' && selectedStage2FileIds.size === 0)
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-bold transition-all disabled:opacity-40"
              style={{ background: '#A855F726', color: '#D8B4FE' }}
              title={
                stage2Scope === 'all'
                  ? `Run AI Classify on the whole batch (${eligibleFileCount} files) with ${stage2PhaseProfile}`
                  : `Run AI Classify on ${selectedStage2FileIds.size} selected file(s) with ${stage2PhaseProfile}`
              }
            >
              {runStage2.isPending || runStage2MultiSingle.isPending || s2 === 'processing' ? (
                <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[14px]">psychology</span>
              )}
              {s2 === 'processing'
                ? 'AI Classifying...'
                : `${fileRollup.stage2.done > 0 ? 'Re-run' : 'Run'} AI Classify — ${selectedScopeIsAll ? `${eligibleFileCount} files` : `${selectedStage2FileIds.size} selected`}`}
            </button>

            <details className="rounded-md border border-[#8AB4FF]/25 bg-[#8AB4FF]/6 px-2 py-1">
              <summary className="cursor-pointer list-none flex items-center gap-1 text-[10px] font-semibold text-[#8AB4FF]">
                <span className="material-symbols-outlined text-[12px]">science</span>
                Advanced diagnostics
              </summary>
              <div className="pt-2">
                <button
                  onClick={handleRunGroupingOnly}
                  disabled={runGroupingOnly.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold transition-all disabled:opacity-50"
                  style={{ background: '#8AB4FF18', color: '#8AB4FF' }}
                  title="Deterministic grouping/classification only (no AI call) — use for troubleshooting only"
                >
                  {runGroupingOnly.isPending ? (
                    <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-[14px]">grid_view</span>
                  )}
                  Run Grouping-Only Comparison
                </button>
              </div>
            </details>

            {fileRollup.stage2.done > 0 && fileRollup.stage3.label !== 'completed' && (
              <button
                onClick={() => {
                  const firstFile = detail?.files?.find(f => f.cleanedOutputKey);
                  if (firstFile) setTriagingFile(firstFile);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold transition-all hover:brightness-110"
                style={{ background: '#3BE49418', color: '#3BE494' }}
              >
                <span className="material-symbols-outlined text-[14px]">rate_review</span>
                {fileRollup.stage3.any > 0 ? `Continue Review (${fileRollup.stage3.done}/${fileRollup.total} complete)` : 'Start Review'}
              </button>
            )}

            <span className="flex-1" />

            {/* Ship to P&ID + downloads — enabled only when all files are classified and fully reviewed. */}
            <button
              onClick={() => passToAnnotation.mutate({ batchId: batch.id })}
              disabled={passToAnnotation.isPending || batchDetail.passedToAnnotation || !shipReady}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md-full text-label-sm font-bold transition-all disabled:opacity-30"
              style={{ background: '#F39C1226', color: '#F39C12' }}
              title={
                batchDetail.passedToAnnotation
                  ? 'Already shipped to P&ID annotation'
                  : !shipReady
                    ? 'Complete full review for all classified files before shipping'
                    : `Ship ${fileRollup.stage3.done} reviewed file(s) to P&ID annotation`
              }
            >
              {passToAnnotation.isPending ? (
                <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
              ) : (
                <span className="material-symbols-outlined text-[14px]">{batchDetail.passedToAnnotation ? 'task_alt' : 'rocket_launch'}</span>
              )}
              {batchDetail.passedToAnnotation ? 'Shipped' : 'Finalize & Ship to P&ID'}
            </button>

            <button
              onClick={() => exportBatch.mutate({ batchId: batch.id, format: 'json' })}
              disabled={exportBatch.isPending || !shipReady}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md-full text-[10px] font-semibold transition-all disabled:opacity-30"
              style={{ background: '#8AB4FF18', color: '#8AB4FF' }}
              title="Download approved tags as JSON"
            >
              <span className="material-symbols-outlined text-[12px]">download</span>JSON
            </button>
            <button
              onClick={() => exportBatch.mutate({ batchId: batch.id, format: 'csv' })}
              disabled={exportBatch.isPending || !shipReady}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md-full text-[10px] font-semibold transition-all disabled:opacity-30"
              style={{ background: '#A855F718', color: '#A855F7' }}
              title="Download approved tag list as CSV"
            >
              <span className="material-symbols-outlined text-[12px]">table_view</span>CSV
            </button>
            <button
              onClick={() => exportBatch.mutate({ batchId: batch.id, format: 'xml' })}
              disabled={exportBatch.isPending || !shipReady}
              className="flex items-center gap-1 px-2 py-1.5 rounded-md-full text-[10px] font-semibold transition-all disabled:opacity-30"
              style={{ background: '#F39C1218', color: '#F39C12' }}
              title="Download approved tags as XML"
            >
              <span className="material-symbols-outlined text-[12px]">code</span>XML
            </button>
          </div>
          <div className="text-[10px] text-md-on-surface-variant/90">
            <span className="font-bold text-md-on-surface">Re-run AI Classify</span> updates actual Stage 2 outputs used for review and shipping.
            {' '}<span className="font-bold text-md-on-surface">Advanced diagnostics</span> is analysis-only (grouping comparison) and does not replace main AI outputs.
          </div>

          {/* Status / feedback messages */}
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            {!batchDetail.passedToAnnotation && !shipReady && (
              <span className="text-[#F39C12]">
                Ship gate: requires full completion ({fileRollup.stage2.done}/{fileRollup.total} classified, {fileRollup.stage3.done}/{fileRollup.total} reviewed).
              </span>
            )}
            {runStage2.isSuccess && (
              <span className="text-green-400">
                Stage 2 started ({runStage2.data?.phaseProfile || stage2PhaseProfile}) — validate results before next phase.
              </span>
            )}
            {runStage2.isError && (
              <span className="text-red-400">Error: {runStage2.error?.message}</span>
            )}
            {runStage2MultiSingle.isSuccess && (
              <span className="text-[#8AB4FF]">Stage 2 started for selected files only.</span>
            )}
            {runStage2MultiSingle.isError && (
              <span className="text-red-400">Selected-files run error: {runStage2MultiSingle.error?.message}</span>
            )}
            {runGroupingOnly.isSuccess && (
              <span className="text-[#8AB4FF]">Grouping-only comparison complete.</span>
            )}
            {runGroupingOnly.isError && (
              <span className="text-red-400">Grouping-only error: {runGroupingOnly.error?.message}</span>
            )}
            {passToAnnotation.isSuccess && (
              <span className="text-[#3BE494] font-bold">
                Shipped: {passToAnnotation.data?.linkedEntities ?? 0} entity positions linked across {passToAnnotation.data?.pnidIds?.length ?? 0} P&ID(s).
              </span>
            )}
            {passToAnnotation.isError && (
              <span className="text-red-400">Ship error: {passToAnnotation.error?.message}</span>
            )}
            {exportBatch.isSuccess && (
              <span className="text-[#8AB4FF]">Downloaded {exportBatch.data?.filename}</span>
            )}
            {exportBatch.isError && (
              <span className="text-red-400">Export error: {exportBatch.error?.message}</span>
            )}
          </div>
        </div>
      )}
      {s1 === 'pending' && (
        <div className="px-3 py-2 rounded-md bg-md-surface-container/40 border border-md-outline-variant/10 text-[11px] text-md-on-surface-variant">
          Waiting for Stage 1 (extraction) to complete…
        </div>
      )}

      {groupingOnlyReport?.totals && (
        <div className="rounded-md border border-[#8AB4FF]/20 bg-[#8AB4FF]/6 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-[#8AB4FF]/15 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-[#8AB4FF]">analytics</span>
            <span className="text-[11px] font-bold text-[#8AB4FF]">Grouping-Only vs Hybrid AI (same batch)</span>
            <span className="flex-1" />
            <span className="text-[10px] text-md-on-surface-variant">{Math.round((groupingOnlyReport.elapsedMs || 0) / 1000)}s</span>
          </div>
          <div className="grid grid-cols-2 gap-0 text-[10px]">
            <div className="px-3 py-2 border-r border-[#8AB4FF]/10">
              <div className="text-[10px] font-bold text-md-on-surface mb-1">Deterministic grouping-only</div>
              <div className="space-y-0.5 text-md-on-surface-variant">
                <div>files: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.totals.filesProcessed}</span></div>
                <div>words: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.totals.totalWords}</span></div>
                <div>groups: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.totals.totalGroups}</span></div>
                <div>multi-word groups: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.totals.totalMultiWordGroups}</span></div>
                <div>structured candidates: <span className="text-[#3BE494] font-semibold">{groupingOnlyReport.totals.structuredCandidates}</span></div>
                <div>unknown/noise candidates: <span className="text-[#E74C3C] font-semibold">{groupingOnlyReport.totals.unknownOrNoiseCandidates}</span></div>
                <div>avg words/group: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.totals.avgWordsPerGroup}</span></div>
              </div>
            </div>
            <div className="px-3 py-2">
              <div className="text-[10px] font-bold text-md-on-surface mb-1">Current hybrid AI snapshot</div>
              <div className="space-y-0.5 text-md-on-surface-variant">
                <div>files with AI output: <span className="text-md-on-surface font-semibold">{groupingOnlyReport.hybridAi?.filesWithCleaned || 0}</span></div>
                <div>AI tags: <span className="text-[#3BE494] font-semibold">{groupingOnlyReport.hybridAi?.totalTags || 0}</span></div>
                <div>AI noise: <span className="text-[#E74C3C] font-semibold">{groupingOnlyReport.hybridAi?.totalNoise || 0}</span></div>
                <div>AI uncertain: <span className="text-[#F39C12] font-semibold">{groupingOnlyReport.hybridAi?.totalUncertain || 0}</span></div>
                <div className="pt-1 text-[9px] text-md-on-surface-variant/80">
                  Compare structured candidates vs AI kept tags to decide whether to run full AI classify.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {checklist && (
        <div className="rounded-md border border-[#3BE494]/20 bg-[#3BE494]/6 overflow-hidden">
          <div className="px-3 py-1.5 border-b border-[#3BE494]/15 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-[#3BE494]">fact_check</span>
            <span className="text-[11px] font-bold text-[#3BE494]">Phase Validation Checklist</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#3BE494]/15 text-[#86EFAC] font-bold uppercase">
              {checklist.phaseProfile}
            </span>
            <span className="flex-1" />
            <span className="text-[10px] text-md-on-surface-variant">{checklist.completionPct}% complete</span>
          </div>
          <div className="px-3 py-2 grid grid-cols-2 xl:grid-cols-4 gap-2 text-[10px]">
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              files done/total: <span className="font-semibold text-md-on-surface">{checklist.completed}/{checklist.total}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              failures: <span className={`font-semibold ${checklist.failed > 0 ? 'text-[#E74C3C]' : 'text-[#3BE494]'}`}>{checklist.failed}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              total tags: <span className="font-semibold text-[#3BE494]">{checklist.tags}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              continuation refs: <span className="font-semibold text-[#8AB4FF]">{checklist.continuation}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              deterministic recovered: <span className="font-semibold text-[#F39C12]">{checklist.recovered}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1">
              coverage rescued: <span className="font-semibold text-[#D8B4FE]">{checklist.rescued}</span>
            </div>
            <div className="rounded bg-md-on-surface/5 px-2 py-1 col-span-2">
              validate: compare recovered/rescued gains vs false positives in review before moving to next phase.
            </div>
          </div>
        </div>
      )}

      {/* Live Progress Panel — shown during Stage 2 processing */}
      {(isStage2Active || activityLog.length > 0) && (
        <div className="rounded-md border border-[#A855F7]/20 bg-[#A855F7]/5 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#A855F7]/10">
            <span className={`material-symbols-outlined text-[14px] text-[#A855F7] ${isStage2Active ? 'animate-spin' : ''}`}>progress_activity</span>
            <span className="text-[11px] font-bold text-[#A855F7]">Stage 2 — Live Classification Activity</span>
            {(progress?.phaseProfile || lastSnapshot?.phaseProfile) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#A855F7]/15 text-[#D8B4FE] font-bold uppercase">
                {progress?.phaseProfile || lastSnapshot?.phaseProfile}
              </span>
            )}
            <span className="flex-1" />
            {(progress?.elapsed || lastSnapshot?.elapsed) && (
              <span className="text-[10px] text-md-on-surface-variant">
                {Math.round((progress?.elapsed || lastSnapshot?.elapsed || 0) / 1000)}s elapsed
              </span>
            )}
            {((progress?.totalTags || lastSnapshot?.totalTags || 0) > 0) && (
              <span className="text-[10px] font-bold text-[#3BE494]">{progress?.totalTags || lastSnapshot?.totalTags || 0} tags</span>
            )}
          </div>
          {(progress?.automation || lastSnapshot?.automation || progress?.totalContinuationRefs || lastSnapshot?.totalContinuationRefs) && (
            <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[#A855F7]/10 text-[10px]">
              <span className="text-md-on-surface-variant">Automation:</span>
              <span className="text-[#3BE494] font-semibold">Auto {progress?.automation?.autoApprove ?? lastSnapshot?.automation?.autoApprove ?? 0}</span>
              <span className="text-[#F39C12] font-semibold">Review {progress?.automation?.humanReview ?? lastSnapshot?.automation?.humanReview ?? 0}</span>
              <span className="text-[#E74C3C] font-semibold">Reject {progress?.automation?.autoReject ?? lastSnapshot?.automation?.autoReject ?? 0}</span>
              <span className="ml-2 text-md-on-surface-variant">Continuation refs:</span>
              <span className="text-[#8AB4FF] font-semibold">{progress?.totalContinuationRefs ?? lastSnapshot?.totalContinuationRefs ?? 0}</span>
            </div>
          )}
          {progress?.files && Object.keys(progress.files).length > 0 && (
            <div className="divide-y divide-[#A855F7]/5">
              {Object.entries(progress.files).map(([fileId, fp]) => (
                <div key={fileId} className="flex items-center gap-3 px-3 py-1.5">
                {/* Status icon */}
                <span className={`material-symbols-outlined text-[14px] ${fp.status === 'processing' ? 'animate-spin text-[#F39C12]' : fp.status === 'completed' ? 'text-[#3BE494]' : fp.status === 'failed' ? 'text-[#E74C3C]' : 'text-md-on-surface-variant/30'}`}>
                  {fp.status === 'processing' || fp.status === 'downloading' ? 'progress_activity' : fp.status === 'completed' ? 'check_circle' : fp.status === 'failed' ? 'error' : 'radio_button_unchecked'}
                </span>
                {/* Filename */}
                <span className="text-[11px] font-mono text-md-on-surface w-56 truncate">{fp.filename}</span>
                {/* Chunk progress bar */}
                {fp.totalChunks > 0 && (
                  <div className="flex items-center gap-1.5 w-24">
                    <div className="flex-1 h-1.5 rounded-full bg-md-on-surface/10 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(fp.chunk / fp.totalChunks) * 100}%`,
                          background: fp.status === 'completed' ? '#3BE494' : '#A855F7',
                        }} />
                    </div>
                    <span className="text-[9px] text-md-on-surface-variant whitespace-nowrap">{fp.chunk}/{fp.totalChunks}</span>
                  </div>
                )}
                {/* Tags count */}
                <div className="flex items-center gap-1.5">
                  {fp.tags > 0 && (
                    <span className="text-[10px] font-bold text-[#3BE494]">{fp.tags} tags</span>
                  )}
                  {fp.noise > 0 && (
                    <span className="text-[10px] font-semibold text-md-on-surface-variant">{fp.noise} noise</span>
                  )}
                  {fp.uncertain > 0 && (
                    <span className="text-[10px] font-semibold text-[#F39C12]">{fp.uncertain} uncertain</span>
                  )}
                </div>
                {/* Status message */}
                <span className="text-[10px] text-md-on-surface-variant flex-1 truncate">{fp.message}</span>
                <div className="flex items-center gap-2 text-[9px] text-md-on-surface-variant">
                  {fp.phase && <span className="uppercase">{fp.phase}</span>}
                  {fp.latencyMs > 0 && <span>{fp.latencyMs}ms</span>}
                  {(fp.chunkInputTokens > 0 || fp.chunkOutputTokens > 0) && (
                    <span>{fp.chunkInputTokens || 0}/{fp.chunkOutputTokens || 0} tok</span>
                  )}
                </div>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-[#A855F7]/10">
            <div className="px-3 py-1 text-[10px] font-semibold text-md-on-surface-variant">Event log</div>
            <div className="max-h-40 overflow-auto divide-y divide-[#A855F7]/5">
              {activityLog.length === 0 ? (
                <div className="px-3 py-1.5 text-[10px] text-md-on-surface-variant/70">No events yet.</div>
              ) : (
                [...activityLog].reverse().map(evt => (
                  <div key={`${evt.key}|${evt.at}`} className="px-3 py-1.5 text-[10px] flex items-center gap-2">
                    <span className={`material-symbols-outlined text-[12px] ${evt.status === 'failed' ? 'text-[#E74C3C]' : evt.status === 'completed' ? 'text-[#3BE494]' : 'text-[#A855F7]'}`}>
                      {evt.status === 'failed' ? 'error' : evt.status === 'completed' ? 'check_circle' : 'schedule'}
                    </span>
                    <span className="font-mono text-md-on-surface truncate max-w-[220px]">{evt.filename || evt.fileId}</span>
                    <span className="text-md-on-surface-variant truncate max-w-[300px]">{evt.message || evt.status}</span>
                    {evt.chunk > 0 && evt.totalChunks > 0 && (
                      <span className="text-[#A855F7]">{evt.chunk}/{evt.totalChunks}</span>
                    )}
                    <span className="flex-1" />
                    <span className="text-md-on-surface-variant/70">{new Date(evt.updatedAt).toLocaleTimeString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-6">
        {[
          { label: 'Total Files', value: batch.totalFiles, color: md.onSurface },
          { label: 'Processed', value: batch.processedFiles || 0, color: '#3BE494' },
          { label: 'Failed', value: batch.failedFiles || 0, color: batch.failedFiles > 0 ? '#E74C3C' : '#919A9B' },
        ].map(s => (
          <div key={s.label}>
            <span className="text-title-md font-bold" style={{ color: s.color }}>{s.value}</span>
            <span className="text-label-sm text-md-on-surface-variant ml-1.5">{s.label}</span>
          </div>
        ))}
      </div>

      {/* File list with stage outputs */}
      {detail?.files && (
        <div className="rounded-md-lg border border-md-outline-variant/15 overflow-hidden">
          <div className="px-3 py-2 bg-md-surface-container-high/30 border-b border-md-outline-variant/10">
            <div className="flex items-center gap-2">
              <span className="text-label-sm font-semibold text-md-on-surface-variant">
                Files ({detail.files.length}) — Click a stage icon to view output
              </span>
              <span className="flex-1" />
              <button
                onClick={() => {
                  const ids = (detail.files || []).filter((f) => !!f.rawOutputKey).map((f) => f.id);
                  setSelectedStage2FileIds(new Set(ids));
                }}
                className="text-[10px] text-[#8AB4FF] hover:underline"
              >
                Select all
              </button>
              <button
                onClick={() => setSelectedStage2FileIds(new Set())}
                className="text-[10px] text-md-on-surface-variant hover:underline"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0">
                <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/50">
                  <th className="px-2 py-1.5 text-center">Run</th>
                  <th className="px-3 py-1.5">Filename</th>
                  <th className="px-3 py-1.5">Drawing</th>
                  <th className="px-3 py-1.5 text-center">Words</th>
                  <th className="px-3 py-1.5 text-center">Raw OCR</th>
                  <th className="px-3 py-1.5 text-center">Groups (diag)</th>
                  <th className="px-3 py-1.5 text-center">AI Classified</th>
                  <th className="px-3 py-1.5 text-center">Review</th>
                  <th className="px-3 py-1.5 text-center">Coords</th>
                  <th className="px-3 py-1.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.files.map(f => {
                  const fStatus = BATCH_STATUS[f.status] || BATCH_STATUS.pending;
                  const canSelectForRun = !!f.rawOutputKey;
                  return (
                    <tr key={f.id} className={`border-b border-md-outline-variant/10 ${viewingFile?.id === f.id ? 'bg-md-primary/5' : ''}`}>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          disabled={!canSelectForRun}
                          checked={selectedStage2FileIds.has(f.id)}
                          onChange={() => toggleStage2FileSelect(f.id)}
                          className="w-3.5 h-3.5 accent-[#8AB4FF] disabled:opacity-30"
                          title={canSelectForRun ? 'Include file in selected Stage 2 run' : 'Run Stage 1 first'}
                        />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-md-on-surface">{f.filename}</td>
                      <td className="px-3 py-1.5 font-semibold">{f.drawingNumber || '—'}</td>
                      <td className="px-3 py-1.5 text-center">{f.tagsFound || '—'}</td>
                      <td className="px-3 py-1.5 text-center">
                        <StageButton
                          available={!!f.rawOutputKey}
                          active={viewingFile?.id === f.id && viewingStage === 'raw'}
                          onClick={() => {
                            if (f.rawOutputKey) {
                              setViewingFile(f);
                              setViewingStage('raw');
                            }
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {f.rawOutputKey ? (
                          <button
                            onClick={() => { setDiagnosticFile(f); setViewingFile(null); setViewingStage(null); setReviewingFile(null); }}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all hover:brightness-110 ${
                              diagnosticFile?.id === f.id
                                ? 'bg-md-primary/25 text-md-primary'
                                : 'bg-[#3BE494]/10 text-[#3BE494] hover:bg-[#3BE494]/20'
                            }`}
                            title="Open word-grouping diagnostic (read-only paint of every group on the drawing)"
                          >
                            <span className="material-symbols-outlined text-[11px]">group_work</span>
                            Paint
                          </button>
                        ) : (
                          <span className="text-md-on-surface-variant/30 text-[10px]" title="Run Stage 1 first">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <StageButton
                            available={!!f.cleanedOutputKey}
                            active={viewingFile?.id === f.id && viewingStage === 'cleaned'}
                            onClick={() => {
                              if (f.cleanedOutputKey) {
                                setViewingFile(f);
                                setViewingStage('cleaned');
                              }
                            }}
                          />
                          {f.cleanedOutputKey ? (
                            <span
                              className="text-[8px] font-bold uppercase px-1 py-0.5 rounded"
                              style={{ background: '#A855F7', color: '#0D1F17' }}
                              title={`Last Stage 2 strategy for this file: ${f.stage2PhaseProfile || batchDetail.stage2PhaseProfile || 'unknown'}`}
                            >
                              {stage2ShortLabel(f.stage2PhaseProfile || batchDetail.stage2PhaseProfile)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {f.cleanedOutputKey ? (
                          <button
                            onClick={() => {
                              // Completed reviews should open directly in the locked workspace.
                              if (f.reviewStatus === 'completed') {
                                setReviewingFile(f);
                                setTriagingFile(null);
                              } else {
                                setTriagingFile(f);
                                setReviewingFile(null);
                              }
                              setViewingFile(null);
                              setViewingStage(null);
                            }}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold transition-all hover:brightness-110 ${
                              f.reviewStatus === 'completed' ? 'bg-[#3BE494]/15 text-[#3BE494]' :
                              f.reviewStatus === 'partial' ? 'bg-[#F39C12]/15 text-[#F39C12]' :
                              'bg-[#A855F7]/10 text-[#A855F7] hover:bg-[#A855F7]/20'
                            }`}
                            title={
                              f.reviewStatus === 'completed'
                                ? 'Open review (locked by default). Click Reopen Review inside workspace to edit.'
                                : f.reviewStatus === 'partial'
                                  ? 'Continue review (in progress)'
                                  : 'Start review triage (decide auto-accept threshold first)'
                            }
                          >
                            <span className="material-symbols-outlined text-[11px]">
                              {f.reviewStatus === 'completed' ? 'check_circle' : f.reviewStatus === 'partial' ? 'edit_note' : 'rate_review'}
                            </span>
                            {f.reviewStatus === 'completed' && (
                              <span className="material-symbols-outlined text-[10px] -ml-0.5" title="Locked until reopened">lock</span>
                            )}
                            {f.reviewStatus === 'completed' ? 'Review Complete' : f.reviewStatus === 'partial' ? 'In Progress' : 'Review'}
                          </button>
                        ) : (
                          <span className="text-md-on-surface-variant/30 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {f.rawOutputKey ? (
                          <button
                            onClick={() => {
                              const API = import.meta.env.VITE_API_URL || '/api/v1';
                              window.open(`${API}/ocr-pipeline/batches/${batch.id}/files/${f.id}/coordinate-trace?format=csv`, '_blank');
                            }}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2D33E0]/10 text-[#8AB4FF] hover:bg-[#2D33E0]/20 transition-all hover:brightness-110"
                            title="Download coordinate trace CSV"
                          >
                            <span className="material-symbols-outlined text-[11px]">download</span>
                            CSV
                          </button>
                        ) : (
                          <span className="text-md-on-surface-variant/30 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className="inline-flex items-center gap-0.5" style={{ color: fStatus.color }}>
                          <span className="material-symbols-outlined text-[12px]">{fStatus.icon}</span>
                          {fStatus.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </>
      )}

      {/* Stage output viewer */}
      {viewingFile && viewingStage && !reviewingFile && (
        <div ref={stageViewerRef}>
          <StageOutputViewer
            batchId={batch.id}
            file={viewingFile}
            stage={viewingStage}
            onClose={() => { setViewingFile(null); setViewingStage(null); }}
            onChangeStage={setViewingStage}
            onSendToReviewCandidates={(candidates) => handleQueueFromStage2(viewingFile, candidates)}
          />
        </div>
      )}

      {/* Phase 1: Review TRIAGE (entry surface). User picks an auto-accept
          threshold and bulk-approves before opening the canvas review. */}
      {triagingFile && (
        <ReviewTriage
          batchId={batch.id}
          file={triagingFile}
          onClose={() => setTriagingFile(null)}
          onOpenDetailedReview={() => {
            const f = triagingFile;
            setTriagingFile(null);
            setReviewingFile(f);
          }}
        />
      )}

      {/* Phase 2 (ReviewCanvas) intentionally disabled per user feedback —
          the legacy FileReviewPanel below is the canonical review surface.
          Keeping the import + state plumbing in place so the experiment
          can be re-enabled by a one-line route change later. */}

      {/* Stage 3: Review surface — new clean ReviewWorkspace by default,
          legacy FileReviewPanel reachable via floating toggle. */}
      {reviewingFile && useLegacyReviewPanel && (
        <FileReviewPanel
          batchId={batch.id}
          file={reviewingFile}
          allFiles={detail?.files?.filter(f => f.cleanedOutputKey) || []}
          onClose={() => setReviewingFile(null)}
          onNavigate={(f) => setReviewingFile(f)}
          queuedCandidates={reviewQueueByFile[reviewingFile.id] || []}
          onConsumeQueuedCandidates={handleConsumeReviewQueue}
        />
      )}
      {reviewingFile && !useLegacyReviewPanel && (
        <ReviewWorkspace
          batchId={batch.id}
          file={reviewingFile}
          allFiles={detail?.files?.filter(f => f.cleanedOutputKey) || []}
          onClose={() => setReviewingFile(null)}
          onNavigate={(f) => setReviewingFile(f)}
        />
      )}
      {reviewingFile && (
        <button
          onClick={() => setUseLegacyReviewPanel((v) => !v)}
          className="fixed bottom-2 right-2 z-50 px-2 py-1 rounded text-[10px] font-bold bg-md-on-surface/15 text-md-on-surface-variant hover:bg-md-on-surface/25 border border-md-outline-variant/30 shadow-lg"
          title="Switch between the new workspace and the legacy detailed panel"
        >
          {useLegacyReviewPanel ? 'Switch to new workspace' : 'Switch to legacy panel'}
        </button>
      )}

      {/* Word-grouping diagnostic (read-only visual audit) */}
      {diagnosticFile && (
        <GroupingDiagnosticView
          batchId={batch.id}
          file={diagnosticFile}
          onClose={() => setDiagnosticFile(null)}
        />
      )}
    </div>
  );
}

/** Stage 3: Human Review Panel — approve/reject/edit individual tags */
function FileReviewPanel({ batchId, file, allFiles, onClose, onNavigate, queuedCandidates = [], onConsumeQueuedCandidates }) {
  const { data, isLoading, error } = useStageFile(batchId, file.id, 'cleaned');
  const { data: rawStageData } = useStageFile(batchId, file.id, 'raw');
  const saveReview = useSaveReview();

  // Decision state: Map of tagIndex → { action: 'approve'|'reject'|'edit', correctedText?, correctedType?, notes? }
  const [decisions, setDecisions] = useState({});
  const [editingIndex, setEditingIndex] = useState(null);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState('');
  const [manualTags, setManualTags] = useState([]);
  const [manualAddMode, setManualAddMode] = useState(false);
  const [manualDraft, setManualDraft] = useState(null);

  // Keyboard shortcuts dedicated to manual-add ergonomics.  N toggles add
  // mode (unless the user is in an input/textarea/select); Esc cancels.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setManualAddMode((v) => !v);
        setManualDraft(null);
      } else if (e.key === 'Escape') {
        if (manualAddMode) {
          setManualAddMode(false);
          setManualDraft(null);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualAddMode, onClose]);
  const [filterType, setFilterType] = useState('all'); // 'all', 'equipment', 'instrument', 'line', 'pending', 'approved', 'rejected'
  const [confidenceThreshold, setConfidenceThreshold] = useState(90); // percentage
  const [minConfidenceFilter, setMinConfidenceFilter] = useState(0); // percentage
  const [includeUnknownConfidence, setIncludeUnknownConfidence] = useState(true);
  const [showPdfPreview, setShowPdfPreview] = useState(true);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewTag, setPreviewTag] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedTagIndex, setSelectedTagIndex] = useState(null);
  const [bboxEdit, setBboxEdit] = useState(null);
  const [lockAspectRatio, setLockAspectRatio] = useState(false);
  const [showVisualMisses, setShowVisualMisses] = useState(true);
  const [paintAllExtracted, setPaintAllExtracted] = useState(false);
  const [paintGroups, setPaintGroups] = useState({
    equipment: true,
    instrument: true,
    line: true,
    drawing_ref: true,
    noise: false,
    rescued: true,
    rejected: true,
  });
  const [panMode, setPanMode] = useState(true);
  const [previewFloating, setPreviewFloating] = useState(false);
  const [showShortcutHints, setShowShortcutHints] = useState(false);
  const [strictShipLock, setStrictShipLock] = useState(true);
  const [compactListMode, setCompactListMode] = useState(true);
  const [splitRatio, setSplitRatio] = useState(48);
  const [bulkActionsExpanded, setBulkActionsExpanded] = useState(false);
  const [missingReasonPolicy, setMissingReasonPolicy] = useState(() => loadMissingReasonPolicy());
  const [defaultDecisionPolicy, setDefaultDecisionPolicy] = useState({
    autoReject: 'reject',
    noise: 'reject',
    uncertain: 'approve',
  });
  const [bulkRetypeTarget, setBulkRetypeTarget] = useState('instrument');
  const [missingPanelExpanded, setMissingPanelExpanded] = useState(false);
  const [missingReasonFilter, setMissingReasonFilter] = useState('all');
  const [dismissedMissingKeys, setDismissedMissingKeys] = useState(new Set());
  const [showRightMissingTools, setShowRightMissingTools] = useState(false);
  const [resolvedMissingKeys, setResolvedMissingKeys] = useState(new Set());
  const [selectedMissingKey, setSelectedMissingKey] = useState(null);
  const reasonForMissing = useCallback((m) => m?.reason_code || m?.reason || 'unknown', []);
  const policyForReason = useCallback(
    (reasonCode) => String(missingReasonPolicy?.[String(reasonCode || '')] || 'reject'),
    [missingReasonPolicy]
  );
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MISSING_REASON_POLICY_STORAGE_KEY, JSON.stringify(missingReasonPolicy || {}));
      }
    } catch {
      // Ignore storage failures; UI still works for this session.
    }
  }, [missingReasonPolicy]);
  // Per-column filters: substring on text/reason; multi-value on type/decision; numeric range on confidence.
  const [colFilters, setColFilters] = useState({
    text: '',
    type: '',       // '' | equipment | instrument | line | drawing_ref | noise
    confMin: '',    // empty = no lower bound; numeric percentage
    confMax: '',    // empty = no upper bound
    reason: '',
    decision: '',   // '' | pending | approve | reject | edit
  });
  const updateColFilter = useCallback((key, value) => {
    setColFilters(prev => ({ ...prev, [key]: value }));
  }, []);
  const clearColFilters = useCallback(() => {
    setColFilters({ text: '', type: '', confMin: '', confMax: '', reason: '', decision: '' });
  }, []);
  const [isWidePreviewLayout, setIsWidePreviewLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1280 : true
  );
  const [previewFocusBox, setPreviewFocusBox] = useState(null);
  const [previewPageDims, setPreviewPageDims] = useState({ width: 0, height: 0 });
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewPdfData, setPreviewPdfData] = useState(null);
  const [previewPdfLoading, setPreviewPdfLoading] = useState(false);
  const previewScrollRef = useRef(null);
  const rowRefs = useRef(new Map());
  const missingRowRefs = useRef(new Map());
  const dragStateRef = useRef(null);
  const splitDragRef = useRef(null);
  const panDragRef = useRef(null);
  const manualTagIndexRef = useRef(1000000);
  const autoFitDoneForFileRef = useRef(null);
  const autoListModeForFileRef = useRef(null);

  const normalizeConfidence = useCallback((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }, []);

  const formatConfidence = useCallback((value) => {
    const normalized = normalizeConfidence(value);
    if (normalized == null) return '—';
    return `${Math.round(normalized * 100)}%`;
  }, [normalizeConfidence]);

  // Reset transient review UI state when switching files to avoid cross-file decision leakage.
  useEffect(() => {
    setDecisions({});
    setManualTags([]);
    setManualAddMode(false);
    setManualDraft(null);
    setFilterType('all');
    setEditingIndex(null);
    setEditText('');
    setEditType('');
    setPreviewTag(null);
    setPreviewUrl('');
    setSelectedTagIndex(null);
    setBboxEdit(null);
    setPreviewFocusBox(null);
    setPreviewPageDims({ width: 0, height: 0 });
    setPreviewLoaded(false);
    setPreviewError('');
    setPreviewPdfData(null);
    setPreviewPdfLoading(false);
    setMinConfidenceFilter(0);
    setIncludeUnknownConfidence(true);
    setPreviewFloating(false);
    setPanMode(true);
    setDismissedMissingKeys(new Set());
    setResolvedMissingKeys(new Set());
    setSelectedMissingKey(null);
    setShowRightMissingTools(false);
    autoFitDoneForFileRef.current = null;
    autoListModeForFileRef.current = null;
  }, [file.id]);

  // Combined tags + uncertain for review
  const reviewableTags = useMemo(() => {
    if (!data?.data) return [];
    const tags = (data.data.tags || []).map((t, i) => ({ ...t, _index: i, _source: 'tag' }));
    const uncertain = (data.data.uncertain || []).map((t, i) => ({ ...t, _index: tags.length + i, _source: 'uncertain' }));
    const noise = (data.data.noise || []).map((t, i) => ({
      ...t,
      _index: tags.length + uncertain.length + i,
      _source: 'noise',
      type: t.type || 'noise',
    }));
    const base = [...tags, ...uncertain, ...noise];
    return [...base, ...manualTags];
  }, [data, manualTags]);

  const visualMisses = useMemo(() => {
    const misses = data?.data?.visualAudit?.misses;
    return Array.isArray(misses) ? misses : [];
  }, [data]);
  const filteredVisualMisses = useMemo(() => {
    return visualMisses.filter((m) => {
      const p = m?.position_pct || m?.positionPct;
      if (!p) return false;
      const x = Number(p.x_pct ?? p.xPct ?? 0);
      const y = Number(p.y_pct ?? p.yPct ?? 0);
      const w = Number(p.w_pct ?? p.wPct ?? 0);
      const h = Number(p.h_pct ?? p.hPct ?? 0);
      const wordCount = Number(m?.wordCount || 0);
      const textCandidate = String(m?.textCandidate || '').trim();
      // Hide phantom/low-signal misses that create corner artifacts in review.
      if (wordCount <= 0 || !textCandidate) return false;
      if (w <= 0 || h <= 0) return false;
      if (x <= 1 && y <= 1 && (w < 4 || h < 4)) return false;
      return true;
    });
  }, [visualMisses]);
  const coverageMissing = useMemo(() => {
    const misses = data?.data?.coverageReport?.missingFromCleaned;
    return Array.isArray(misses) ? misses : [];
  }, [data]);
  const candidateIdentityKey = useCallback((item) => {
    const id = String(item?.candidate_id || item?.candidateId || '').trim();
    if (id) return `id:${id}`;
    const text = String(item?.text || item?.candidate_text_norm || item?.candidate_text_raw || '').trim().toUpperCase();
    const type = String(item?.type || item?.candidate_type || 'unknown').trim().toLowerCase();
    const p = item?.position_pct || item?.positionPct || null;
    if (p) {
      const x = Number(p.x_pct ?? p.xPct ?? -1);
      const y = Number(p.y_pct ?? p.yPct ?? -1);
      const w = Number(p.w_pct ?? p.wPct ?? -1);
      const h = Number(p.h_pct ?? p.hPct ?? -1);
      return `${text}|${type}|pct:${x.toFixed(1)}|${y.toFixed(1)}|${w.toFixed(1)}|${h.toFixed(1)}`;
    }
    const bb = item?.bbox || item?.boundingBox || null;
    if (bb) {
      const minX = Number(bb.minX ?? bb.x ?? -1);
      const minY = Number(bb.minY ?? bb.y ?? -1);
      const maxX = Number(bb.maxX ?? (minX + Number(bb.width ?? -1)));
      const maxY = Number(bb.maxY ?? (minY + Number(bb.height ?? -1)));
      return `${text}|${type}|bbox:${minX.toFixed(0)}|${minY.toFixed(0)}|${maxX.toFixed(0)}|${maxY.toFixed(0)}`;
    }
    return `${text}|${type}|no-geom`;
  }, []);
  const missingCandidateKey = useCallback((m) => ([
    candidateIdentityKey(m),
  ].join('|')), [candidateIdentityKey]);
  const reviewableIdentitySet = useMemo(() => {
    const set = new Set();
    for (const t of reviewableTags) set.add(candidateIdentityKey(t));
    return set;
  }, [reviewableTags, candidateIdentityKey]);
  const includedMissingKeys = useMemo(() => {
    const set = new Set();
    for (const t of manualTags) {
      if (String(t?.source || '') !== 'coverage_rescue') continue;
      set.add(String(t?._originMissingKey || missingCandidateKey(t)));
    }
    return set;
  }, [manualTags, missingCandidateKey]);
  const filteredMissingRows = useMemo(() => {
    const textNeedle = colFilters.text.trim().toLowerCase();
    const reasonNeedle = colFilters.reason.trim().toLowerCase();
    return coverageMissing.filter((m) => {
      const key = missingCandidateKey(m);
      if (resolvedMissingKeys.has(key)) return false;
      if (dismissedMissingKeys.has(key)) return false;
      const reason = String(m?.reason_code || m?.reason || 'unknown');
      if (missingReasonFilter !== 'all' && reason !== missingReasonFilter) return false;
      if (textNeedle && !String(m?.text || '').toLowerCase().includes(textNeedle)) return false;
      if (colFilters.type && String(m?.type || '').toLowerCase() !== String(colFilters.type || '').toLowerCase()) return false;
      if (reasonNeedle && !reason.toLowerCase().includes(reasonNeedle)) return false;
      return true;
    });
  }, [coverageMissing, missingCandidateKey, dismissedMissingKeys, resolvedMissingKeys, missingReasonFilter, colFilters]);
  const visualAuditSummary = useMemo(() => {
    const s = data?.data?.visualAudit?.summary || {};
    const regionsTotal = Number(s.regionsTotal ?? (Array.isArray(data?.data?.visualAudit?.regions) ? data.data.visualAudit.regions.length : 0));
    const missesTotal = Number(filteredVisualMisses.length);
    const verticalMisses = Number(filteredVisualMisses.filter(m => m.layout === 'vertical').length);
    const provider = data?.data?.symbolRegionProvider || data?.data?.fusion?.symbolRegionProvider || 'heuristic';
    return { regionsTotal, missesTotal, verticalMisses, provider };
  }, [data, filteredVisualMisses]);

  // If a missing candidate already exists in the active reviewable universe, mark it resolved.
  useEffect(() => {
    if (!coverageMissing.length) return;
    setResolvedMissingKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const m of coverageMissing) {
        const idKey = candidateIdentityKey(m);
        if (!reviewableIdentitySet.has(idKey)) continue;
        const key = missingCandidateKey(m);
        if (next.has(key)) continue;
        next.add(key);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [coverageMissing, reviewableIdentitySet, candidateIdentityKey, missingCandidateKey]);

  // On first open per file, default the left list to rejected pool when missing candidates exist.
  useEffect(() => {
    if (!data?.data) return;
    if (autoListModeForFileRef.current === file.id) return;
    const hasMissing = coverageMissing.length > 0;
    setFilterType(hasMissing ? 'rejected_pool' : 'all');
    autoListModeForFileRef.current = file.id;
  }, [data, coverageMissing.length, file.id]);

  const togglePaintGroup = useCallback((key) => {
    setPaintGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const requiredReviewCount = useMemo(
    () => reviewableTags.filter(t => t._source !== 'noise').length,
    [reviewableTags]
  );

  // Load existing review if available (only fetch if file has a review)
  const hasReview = !!file.reviewOutputKey;
  const { data: existingReview } = useStageFile(batchId, hasReview ? file.id : null, 'review');
  useEffect(() => {
    if (existingReview?.data) {
      // Restore decisions from existing review
      const restored = {};
      for (const item of (existingReview.data.approved || [])) {
        const idx = reviewableTags.findIndex(t => t.text === item.text && t.type === item.type);
        if (idx >= 0) restored[idx] = { action: 'approve' };
      }
      for (const item of (existingReview.data.rejected || [])) {
        const idx = reviewableTags.findIndex(t => t.text === item.text && t.type === item.type);
        if (idx >= 0) restored[idx] = { action: 'reject' };
      }
      for (const item of (existingReview.data.edited || [])) {
        const idx = reviewableTags.findIndex(t => t.text === (item.originalText || item.text) && t.type === (item.originalType || item.type));
        if (idx >= 0) restored[idx] = {
          action: 'edit',
          correctedText: item.text,
          correctedType: item.type,
          correctedPositionPct: item.position_pct || item.positionPct || null,
          correctedBoundingBox: item.boundingBox || null,
        };
      }
      setDecisions(restored);
    }
  }, [existingReview, file.id, reviewableTags.length]);

  // Filtered tags — global filters first, then per-column filters from <thead>.
  const filteredTags = useMemo(() => {
    const textNeedle = colFilters.text.trim().toLowerCase();
    const reasonNeedle = colFilters.reason.trim().toLowerCase();
    const confMinPct = colFilters.confMin === '' ? null : Number(colFilters.confMin);
    const confMaxPct = colFilters.confMax === '' ? null : Number(colFilters.confMax);

    return reviewableTags.filter(t => {
      // === Global filters ===
      const conf = normalizeConfidence(t.confidence);
      const threshold = minConfidenceFilter / 100;
      if (conf == null && !includeUnknownConfidence) return false;
      if (conf != null && conf < threshold) return false;

      let passesGlobal = true;
      if (filterType === 'all') passesGlobal = true;
      else if (filterType === 'tags') passesGlobal = t._source === 'tag';
      else if (filterType === 'uncertain') passesGlobal = t._source === 'uncertain';
      else if (filterType === 'pending') passesGlobal = !decisions[t._index];
      else if (filterType === 'approved') passesGlobal = decisions[t._index]?.action === 'approve';
      else if (filterType === 'rejected') passesGlobal = decisions[t._index]?.action === 'reject';
      else if (filterType === 'edited') passesGlobal = decisions[t._index]?.action === 'edit';
      else if (filterType === 'auto_reject') passesGlobal = t.automationDecision === 'auto_reject';
      else if (filterType === 'noise') passesGlobal = t._source === 'noise';
      else if (filterType === 'missing' || filterType === 'rejected_pool') passesGlobal = false;
      else if (filterType === 'rescued') passesGlobal = ['coverage_rescue', 'deterministic_recovery'].includes(String(t.source || ''));
      else passesGlobal = t.type === filterType;
      if (!passesGlobal) return false;

      // === Per-column filters ===
      if (textNeedle) {
        const dec = decisions[t._index];
        const txt = String(dec?.correctedText || t.text || '').toLowerCase();
        if (!txt.includes(textNeedle)) return false;
      }
      if (colFilters.type) {
        const dec = decisions[t._index];
        const typ = String(dec?.correctedType || t.type || '').toLowerCase();
        if (typ !== colFilters.type.toLowerCase()) return false;
      }
      if (confMinPct != null) {
        if (conf == null) return false;
        if (conf * 100 < confMinPct) return false;
      }
      if (confMaxPct != null) {
        if (conf == null) return false;
        if (conf * 100 > confMaxPct) return false;
      }
      if (reasonNeedle) {
        const r = String(t.reason || '').toLowerCase();
        if (!r.includes(reasonNeedle)) return false;
      }
      if (colFilters.decision) {
        const action = decisions[t._index]?.action || 'pending';
        if (action !== colFilters.decision) return false;
      }
      return true;
    });
  }, [reviewableTags, filterType, decisions, minConfidenceFilter, includeUnknownConfidence, normalizeConfidence, colFilters]);
  const isMissingMode = filterType === 'missing' || filterType === 'rejected_pool';
  const activeFilteredCount = isMissingMode ? filteredMissingRows.length : filteredTags.length;

  // Stats
  const stats = useMemo(() => {
    const total = reviewableTags.length;
    const approved = Object.values(decisions).filter(d => d.action === 'approve').length;
    const rejected = Object.values(decisions).filter(d => d.action === 'reject').length;
    const edited = Object.values(decisions).filter(d => d.action === 'edit').length;
    const reviewedRequired = reviewableTags.filter(t => t._source !== 'noise' && decisions[t._index]).length;
    const pendingRequired = Math.max(0, requiredReviewCount - reviewedRequired);
    const autoReject = reviewableTags.filter(t => t.automationDecision === 'auto_reject').length;
    return { total, approved, rejected, edited, pending: pendingRequired, required: requiredReviewCount, autoReject };
  }, [reviewableTags, decisions, requiredReviewCount]);
  const shipRejectableCount = useMemo(
    () => reviewableTags.filter(t => t._source === 'noise' || t.automationDecision === 'auto_reject').length,
    [reviewableTags]
  );
  const showReasonColumn = !compactListMode;

  const setDecision = useCallback((index, action, extra = {}) => {
    setDecisions(prev => ({ ...prev, [index]: { action, ...extra } }));
  }, []);

  const toBoundingBoxFromPct = useCallback((pct) => {
    const pageW = Number(data?.data?.pageWidth || 1);
    const pageH = Number(data?.data?.pageHeight || 1);
    const x = Number(pct?.x_pct || 0);
    const y = Number(pct?.y_pct || 0);
    const w = Number(pct?.w_pct || 0);
    const h = Number(pct?.h_pct || 0);
    return {
      minX: Math.round((x / 100) * pageW),
      minY: Math.round((y / 100) * pageH),
      maxX: Math.round(((x + w) / 100) * pageW),
      maxY: Math.round(((y + h) / 100) * pageH),
    };
  }, [data?.data?.pageWidth, data?.data?.pageHeight]);

  const markTagDeleted = useCallback((tag) => {
    if (!tag) return;
    if (String(tag._source || '') === 'manual') {
      setManualTags((prev) => prev.filter((t) => t._index !== tag._index));
      setDecisions((prev) => {
        const next = { ...prev };
        delete next[tag._index];
        return next;
      });
      if (previewTag?._index === tag._index) {
        setPreviewTag(null);
        setBboxEdit(null);
        setSelectedTagIndex(null);
      }
      return;
    }
    setDecision(tag._index, 'reject', { notes: 'Deleted from review UI' });
  }, [setDecision, previewTag]);

  const approveAll = () => {
    const next = { ...decisions };
    reviewableTags.forEach((t, i) => {
      if (!next[t._index]) next[t._index] = { action: 'approve' };
    });
    setDecisions(next);
  };

  const applyDecisionToFiltered = useCallback((action = 'approve') => {
    const next = { ...decisions };
    for (const t of filteredTags) {
      next[t._index] = { action };
    }
    setDecisions(next);
  }, [decisions, filteredTags]);
  const rejectNoiseAndAutoReject = useCallback(() => {
    const next = { ...decisions };
    for (const t of reviewableTags) {
      if (t._source === 'noise' || t.automationDecision === 'auto_reject') {
        next[t._index] = { action: 'reject', notes: 'ship_mode_reject_noise_or_auto' };
      }
    }
    setDecisions(next);
  }, [decisions, reviewableTags]);
  const bulkRetypeFilteredTo = useCallback((targetType = bulkRetypeTarget) => {
    if (!targetType || !Array.isArray(filteredTags) || filteredTags.length === 0) return;
    const next = { ...decisions };
    for (const t of filteredTags) {
      const dec = decisions[t._index] || {};
      next[t._index] = {
        action: 'edit',
        correctedText: dec.correctedText || t.text,
        correctedType: targetType,
        correctedPositionPct: dec.correctedPositionPct,
        correctedBoundingBox: dec.correctedBoundingBox,
        notes: 'bulk_retype',
      };
    }
    setDecisions(next);
  }, [bulkRetypeTarget, filteredTags, decisions]);

  const approveAboveThreshold = () => {
    const threshold = confidenceThreshold / 100;
    const next = { ...decisions };
    reviewableTags.forEach(t => {
      const conf = normalizeConfidence(t.confidence);
      if (!next[t._index] && conf != null && conf >= threshold) next[t._index] = { action: 'approve' };
    });
    setDecisions(next);
  };

  // Count how many tags would be approved at current threshold
  const tagsAboveThreshold = useMemo(() => {
    const threshold = confidenceThreshold / 100;
    return reviewableTags.filter(t => {
      if (decisions[t._index]) return false;
      const conf = normalizeConfidence(t.confidence);
      return conf != null && conf >= threshold;
    }).length;
  }, [reviewableTags, decisions, confidenceThreshold, normalizeConfidence]);

  /**
   * Build the effective decision for a tag, using explicit user decisions
   * when present and falling back to safe defaults for untouched non-critical tags:
   *   - auto_reject tier  → default 'reject' (user can override)
   *   - noise source      → default 'reject' (pipeline flagged as noise)
   *   - classified/uncertain tags require explicit decision (no silent keeps)
   */
  const resolveEffectiveDecision = useCallback((tag) => {
    const explicit = decisions[tag._index];
    if (explicit) return { ...explicit, source: 'explicit' };
    if (tag._source === 'noise') return { action: defaultDecisionPolicy.noise, source: `default_noise_${defaultDecisionPolicy.noise}` };
    if (tag.automationDecision === 'auto_reject') {
      return { action: defaultDecisionPolicy.autoReject, source: `default_auto_reject_${defaultDecisionPolicy.autoReject}` };
    }
    if (tag._source === 'uncertain') return { action: 'pending', source: 'pending_uncertain' };
    return { action: 'pending', source: 'pending_tag' };
  }, [decisions, defaultDecisionPolicy]);

  // Summary of what Save will actually send (explicit + safe defaults)
  const saveSummary = useMemo(() => {
    let keep = 0;
    let drop = 0;
    let untouchedAutoReject = 0;
    let pendingRequired = 0;
    for (const t of reviewableTags) {
      const eff = resolveEffectiveDecision(t);
      if (eff.action === 'approve' || eff.action === 'edit') keep++;
      else if (eff.action === 'reject') drop++;
      else if (eff.action === 'pending') pendingRequired++;
      if (String(eff.source || '').startsWith('default_auto_reject')) untouchedAutoReject++;
    }
    return { keep, drop, untouchedAutoReject, pendingRequired, total: reviewableTags.length };
  }, [reviewableTags, resolveEffectiveDecision]);
  const workflowSummary = useMemo(() => ({
    decisionsTaken: Object.keys(decisions).length,
    remainingRequired: saveSummary.pendingRequired,
    readyToShip: saveSummary.keep,
    needsCleanup: saveSummary.drop,
    completionPct: saveSummary.total > 0 ? Math.round(((saveSummary.total - saveSummary.pendingRequired) / saveSummary.total) * 100) : 0,
  }), [decisions, saveSummary]);

  const buildDecisionListForSave = useCallback(() => (
    reviewableTags.map((tag) => {
      const eff = resolveEffectiveDecision(tag);
      return {
        index: tag._index,
        tagText: tag?.text,
        originalType: tag?.type,
        source: tag?._source || 'tag',
        action: eff.action,
        correctedText: eff.correctedText,
        correctedType: eff.correctedType,
        correctedPositionPct: eff.correctedPositionPct,
        correctedBoundingBox: eff.correctedBoundingBox,
        notes: eff.notes,
        decisionSource: eff.source, // explicit | pending_{tag|uncertain} | default_{auto_reject|noise}_{approve|reject}
      };
    })
  ), [reviewableTags, resolveEffectiveDecision]);

  const handleSave = useCallback(() => {
    if (saveSummary.pendingRequired > 0) return;
    saveReview.mutate({ batchId, fileId: file.id, decisions: buildDecisionListForSave() });
  }, [saveSummary.pendingRequired, saveReview, batchId, file.id, buildDecisionListForSave]);

  const startEdit = (tag) => {
    setEditingIndex(tag._index);
    setEditText(decisions[tag._index]?.correctedText || tag.text);
    setEditType(decisions[tag._index]?.correctedType || tag.type);
  };

  const confirmEdit = () => {
    if (editingIndex != null) {
      setDecision(editingIndex, 'edit', { correctedText: editText, correctedType: editType });
      setEditingIndex(null);
    }
  };

  const getTagPositionPct = useCallback((tag) => {
    const dec = decisions[tag?._index];
    const p = dec?.correctedPositionPct || tag?.position_pct || tag?.positionPct;
    if (!p) return null;
    return {
      x_pct: Number(p.x_pct ?? p.xPct ?? 0),
      y_pct: Number(p.y_pct ?? p.yPct ?? 0),
      w_pct: Number(p.w_pct ?? p.wPct ?? 0),
      h_pct: Number(p.h_pct ?? p.hPct ?? 0),
    };
  }, [decisions]);

  // A tag is "position-less" if it has no geometry OR all-zero geometry.
  // These were silently painted at (0,0) before — now we skip the paint and
  // surface a warning badge in the table so the reviewer can fix or delete.
  const hasValidPosition = useCallback((tag) => {
    const p = getTagPositionPct(tag);
    if (!p) return false;
    if (p.w_pct <= 0 || p.h_pct <= 0) return false;
    if (p.x_pct === 0 && p.y_pct === 0 && p.w_pct === 0 && p.h_pct === 0) return false;
    return true;
  }, [getTagPositionPct]);

  const getTagBoundingBox = useCallback((tag) => {
    const dec = decisions[tag?._index];
    return dec?.correctedBoundingBox || tag?.boundingBox || null;
  }, [decisions]);

  const applyBboxEdit = useCallback((tag, draft) => {
    if (!tag || !draft) return;
    const pageW = Number(data?.data?.pageWidth || 1);
    const pageH = Number(data?.data?.pageHeight || 1);
    const x = Math.max(0, Number(draft.x_pct || 0));
    const y = Math.max(0, Number(draft.y_pct || 0));
    const w = Math.max(0.1, Number(draft.w_pct || 0));
    const h = Math.max(0.1, Number(draft.h_pct || 0));
    const correctedPositionPct = {
      x_pct: +x.toFixed(3),
      y_pct: +y.toFixed(3),
      w_pct: +w.toFixed(3),
      h_pct: +h.toFixed(3),
    };
    const correctedBoundingBox = {
      minX: Math.round((x / 100) * pageW),
      minY: Math.round((y / 100) * pageH),
      maxX: Math.round(((x + w) / 100) * pageW),
      maxY: Math.round(((y + h) / 100) * pageH),
    };
    setDecision(tag._index, 'edit', {
      correctedText: decisions[tag._index]?.correctedText || tag.text,
      correctedType: decisions[tag._index]?.correctedType || tag.type,
      correctedPositionPct,
      correctedBoundingBox,
    });
  }, [data?.data?.pageWidth, data?.data?.pageHeight, decisions, setDecision]);

  const clampPctBox = useCallback((box) => {
    const minW = 0.3;
    const minH = 0.3;
    let x = Number(box?.x_pct || 0);
    let y = Number(box?.y_pct || 0);
    let w = Math.max(minW, Number(box?.w_pct || minW));
    let h = Math.max(minH, Number(box?.h_pct || minH));
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > 100) x = Math.max(0, 100 - w);
    if (y + h > 100) y = Math.max(0, 100 - h);
    return { x_pct: x, y_pct: y, w_pct: w, h_pct: h };
  }, []);

  const wordBoxFromVertices = useCallback((vertices) => {
    if (!Array.isArray(vertices) || vertices.length === 0) return null;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const v of vertices) {
      const x = Number(v?.x);
      const y = Number(v?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }, []);

  const snapBboxToNearbyText = useCallback(() => {
    if (!previewTag) return;
    const pageW = Number(data?.data?.pageWidth || 0);
    const pageH = Number(data?.data?.pageHeight || 0);
    if (!pageW || !pageH) return;
    const p = bboxEdit || getTagPositionPct(previewTag);
    const words = rawStageData?.data?.words || [];
    if (!p || !Array.isArray(words) || words.length === 0) return;

    const boxPx = {
      minX: (p.x_pct / 100) * pageW,
      minY: (p.y_pct / 100) * pageH,
      maxX: ((p.x_pct + p.w_pct) / 100) * pageW,
      maxY: ((p.y_pct + p.h_pct) / 100) * pageH,
    };
    const padX = Math.max(4, (boxPx.maxX - boxPx.minX) * 0.25);
    const padY = Math.max(4, (boxPx.maxY - boxPx.minY) * 0.25);
    const search = {
      minX: boxPx.minX - padX,
      minY: boxPx.minY - padY,
      maxX: boxPx.maxX + padX,
      maxY: boxPx.maxY + padY,
    };

    const near = words
      .map((w) => ({ w, bb: wordBoxFromVertices(w.vertices) }))
      .filter((x) => x.bb && x.bb.cx >= search.minX && x.bb.cx <= search.maxX && x.bb.cy >= search.minY && x.bb.cy <= search.maxY);
    if (!near.length) return;

    const minX = Math.min(...near.map(x => x.bb.minX));
    const minY = Math.min(...near.map(x => x.bb.minY));
    const maxX = Math.max(...near.map(x => x.bb.maxX));
    const maxY = Math.max(...near.map(x => x.bb.maxY));
    const tight = clampPctBox({
      x_pct: (Math.max(0, minX - 2) / pageW) * 100,
      y_pct: (Math.max(0, minY - 2) / pageH) * 100,
      w_pct: (Math.min(pageW, maxX + 2) - Math.max(0, minX - 2)) / pageW * 100,
      h_pct: (Math.min(pageH, maxY + 2) - Math.max(0, minY - 2)) / pageH * 100,
    });
    setBboxEdit(tight);
    applyBboxEdit(previewTag, tight);
  }, [previewTag, bboxEdit, getTagPositionPct, rawStageData?.data?.words, data?.data?.pageWidth, data?.data?.pageHeight, wordBoxFromVertices, clampPctBox, applyBboxEdit]);

  const beginBboxDrag = useCallback((mode, evt) => {
    if (!previewTag || !bboxEdit || !previewPageDims.width || !previewPageDims.height) return;
    evt.preventDefault();
    evt.stopPropagation();
    dragStateRef.current = {
      mode,
      startClientX: evt.clientX,
      startClientY: evt.clientY,
      startBox: { ...bboxEdit },
    };
  }, [previewTag, bboxEdit, previewPageDims.width, previewPageDims.height]);

  useEffect(() => {
    const onMove = (evt) => {
      const st = dragStateRef.current;
      if (!st || !previewPageDims.width || !previewPageDims.height) return;
      const zoomScale = previewZoom / 100;
      const dxPx = (evt.clientX - st.startClientX) / zoomScale;
      const dyPx = (evt.clientY - st.startClientY) / zoomScale;
      const dxPct = (dxPx / previewPageDims.width) * 100;
      const dyPct = (dyPx / previewPageDims.height) * 100;
      const b = { ...st.startBox };

      if (st.mode === 'move') {
        b.x_pct += dxPct;
        b.y_pct += dyPct;
      } else if (st.mode === 'nw') {
        b.x_pct += dxPct; b.y_pct += dyPct; b.w_pct -= dxPct; b.h_pct -= dyPct;
      } else if (st.mode === 'ne') {
        b.y_pct += dyPct; b.w_pct += dxPct; b.h_pct -= dyPct;
      } else if (st.mode === 'sw') {
        b.x_pct += dxPct; b.w_pct -= dxPct; b.h_pct += dyPct;
      } else if (st.mode === 'se') {
        b.w_pct += dxPct; b.h_pct += dyPct;
      }

      if (lockAspectRatio && st.mode !== 'move') {
        const ratio = Math.max(0.01, Number(st.startBox.w_pct || 1) / Math.max(0.01, Number(st.startBox.h_pct || 1)));
        const right = st.startBox.x_pct + st.startBox.w_pct;
        const bottom = st.startBox.y_pct + st.startBox.h_pct;
        if (['se', 'ne', 'sw', 'nw'].includes(st.mode)) {
          b.h_pct = b.w_pct / ratio;
          if (st.mode === 'ne' || st.mode === 'nw') b.y_pct = bottom - b.h_pct;
          if (st.mode === 'sw' || st.mode === 'nw') b.x_pct = right - b.w_pct;
        }
      }

      setBboxEdit(clampPctBox(b));
    };

    const onUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      if (previewTag && bboxEdit) {
        applyBboxEdit(previewTag, bboxEdit);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [previewZoom, previewPageDims.width, previewPageDims.height, bboxEdit, previewTag, applyBboxEdit, clampPctBox, lockAspectRatio]);

  const buildPdfPreviewUrl = useCallback(() => {
    if (!file?.storageKey) return;
    const API = import.meta.env.VITE_API_URL || '/api/v1';
    return `${API}/storage/files/${encodeURIComponent(file.storageKey)}`;
  }, [file?.storageKey]);

  const getTagFocus = useCallback((tag) => {
    if (!tag) return { x: 0, y: 0 };
    const pct = getTagPositionPct(tag);
    if (pct && data?.data?.pageWidth && data?.data?.pageHeight) {
      const x = ((Number(pct.x_pct || 0) + Number(pct.w_pct || 0) / 2) / 100) * data.data.pageWidth;
      const y = ((Number(pct.y_pct || 0) + Number(pct.h_pct || 0) / 2) / 100) * data.data.pageHeight;
      return { x, y };
    }
    const bb = getTagBoundingBox(tag);
    if (bb) {
      const minX = Number(bb.minX || 0);
      const minY = Number(bb.minY || 0);
      const maxX = Number(bb.maxX || minX);
      const maxY = Number(bb.maxY || minY);
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    return { x: 0, y: 0 };
  }, [data?.data?.pageWidth, data?.data?.pageHeight, getTagBoundingBox, getTagPositionPct]);

  const openTagInPdf = (tag, openNewTab = false) => {
    const fileUrl = buildPdfPreviewUrl();
    if (!fileUrl) return;
    setPreviewTag(tag);
    setPreviewFocusBox(null);
    setSelectedMissingKey(null);
    setSelectedTagIndex(tag?._index ?? null);
    const pct = getTagPositionPct(tag);
    if (pct) setBboxEdit({ ...pct });
    setPreviewUrl(fileUrl);
    if (openNewTab) {
      const focus = getTagFocus(tag);
      const x = Math.max(0, Math.round(focus.x || 0));
      const y = Math.max(0, Math.round(focus.y || 0));
      window.open(`${fileUrl}#zoom=${previewZoom},${x},${y}`, '_blank', 'noopener,noreferrer');
    }
  };

  const openRelativeFilteredTag = useCallback((delta = 1) => {
    if (!Array.isArray(filteredTags) || filteredTags.length === 0) return;
    const cur = filteredTags.findIndex(t => t._index === selectedTagIndex);
    const base = cur >= 0 ? cur : 0;
    const nextPos = (base + delta + filteredTags.length) % filteredTags.length;
    const nextTag = filteredTags[nextPos];
    if (nextTag) openTagInPdf(nextTag, false);
  }, [filteredTags, selectedTagIndex, openTagInPdf]);

  const decideSelectedTag = useCallback((action) => {
    if (!action) return;
    const target = reviewableTags.find(t => t._index === selectedTagIndex) || filteredTags[0];
    if (!target) return;
    if (action === 'edit') {
      startEdit(target);
      return;
    }
    setDecision(target._index, action);
    // Move forward after binary decisions so reviewer can keep rhythm.
    openRelativeFilteredTag(1);
  }, [reviewableTags, selectedTagIndex, filteredTags, startEdit, setDecision, openRelativeFilteredTag]);

  useEffect(() => {
    const isTextTarget = (el) => {
      if (!el) return false;
      const tag = String(el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
    };
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (isTextTarget(e.target)) return;
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        openRelativeFilteredTag(1);
        return;
      }
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        openRelativeFilteredTag(-1);
        return;
      }
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        decideSelectedTag('approve');
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        decideSelectedTag('reject');
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        decideSelectedTag('edit');
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setManualAddMode(v => !v);
        setManualDraft(null);
        setPreviewFocusBox(null);
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutHints(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openRelativeFilteredTag, decideSelectedTag]);

  const openVisualMissInPdf = useCallback((miss) => {
    if (!miss) return;
    const p = miss.position_pct || miss.positionPct || null;
    if (!p) return;
    setPreviewTag(null);
    setSelectedTagIndex(null);
    setBboxEdit(null);
    setPreviewFocusBox({
      x_pct: Number(p.x_pct ?? p.xPct ?? 0),
      y_pct: Number(p.y_pct ?? p.yPct ?? 0),
      w_pct: Number(p.w_pct ?? p.wPct ?? 0),
      h_pct: Number(p.h_pct ?? p.hPct ?? 0),
      text: miss.textCandidate || miss.regionLabel || 'visual-miss',
    });
  }, []);

  const openStandalonePdfWindow = useCallback(() => {
    if (!previewUrl) return;
    const sourceWidth = Number(data?.data?.pageWidth || 0);
    const sourceHeight = Number(data?.data?.pageHeight || 0);
    let x = 0;
    let y = 0;
    if (previewTag) {
      const focus = getTagFocus(previewTag);
      x = Math.max(0, Math.round(focus.x || 0));
      y = Math.max(0, Math.round(focus.y || 0));
    } else if (previewFocusBox && sourceWidth > 0 && sourceHeight > 0) {
      x = Math.max(0, Math.round(((Number(previewFocusBox.x_pct || 0) + Number(previewFocusBox.w_pct || 0) / 2) / 100) * sourceWidth));
      y = Math.max(0, Math.round(((Number(previewFocusBox.y_pct || 0) + Number(previewFocusBox.h_pct || 0) / 2) / 100) * sourceHeight));
    }
    window.open(`${previewUrl}#zoom=${previewZoom},${x},${y}`, '_blank', 'noopener,noreferrer');
  }, [previewUrl, previewZoom, previewTag, previewFocusBox, data?.data?.pageWidth, data?.data?.pageHeight, getTagFocus]);

  const beginSplitDrag = useCallback((evt) => {
    if (!isWidePreviewLayout) return;
    const container = evt.currentTarget?.parentElement;
    const rect = container?.getBoundingClientRect();
    splitDragRef.current = {
      startX: evt.clientX,
      startRatio: splitRatio,
      containerWidth: rect?.width || 1,
    };
    evt.preventDefault();
  }, [isWidePreviewLayout, splitRatio]);

  useEffect(() => {
    const url = buildPdfPreviewUrl();
    if (url) setPreviewUrl(url);
  }, [buildPdfPreviewUrl]);

  useEffect(() => {
    if (!previewUrl) return;
    let active = true;
    setPreviewPdfLoading(true);
    setPreviewError('');
    setPreviewLoaded(false);
    setPreviewPdfData(null);

    fetch(previewUrl)
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${t ? `: ${t.slice(0, 120)}` : ''}`);
        }
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      })
      .then((bytes) => {
        if (!active) return;
        setPreviewPdfData(bytes);
      })
      .catch((err) => {
        if (!active) return;
        setPreviewError(err?.message || 'Failed to fetch PDF');
      })
      .finally(() => {
        if (active) setPreviewPdfLoading(false);
      });

    return () => { active = false; };
  }, [previewUrl]);

  // Auto-fit PDF on first load per file so review starts from full page view.
  useEffect(() => {
    if (!previewLoaded || !previewPageDims.width || !previewPageDims.height) return;
    if (!previewScrollRef.current) return;
    if (autoFitDoneForFileRef.current === file.id) return;
    const el = previewScrollRef.current;
    const fitW = (el.clientWidth - 16) / previewPageDims.width;
    const fitH = (el.clientHeight - 16) / previewPageDims.height;
    const fit = Math.max(0.2, Math.min(6, Math.min(fitW, fitH)));
    const fitPct = Math.round(fit * 100);
    setPreviewZoom(fitPct);
    el.scrollLeft = 0;
    el.scrollTop = 0;
    autoFitDoneForFileRef.current = file.id;
  }, [previewLoaded, previewPageDims.width, previewPageDims.height, file.id]);

  useEffect(() => {
    if ((!previewTag && !previewFocusBox) || !previewLoaded) return;
    if (!previewScrollRef.current || !previewPageDims.width || !previewPageDims.height) return;

    const sourceWidth = Number(data?.data?.pageWidth || 0);
    const sourceHeight = Number(data?.data?.pageHeight || 0);
    if (!sourceWidth || !sourceHeight) return;

    const focus = previewTag
      ? getTagFocus(previewTag)
      : {
          x: ((Number(previewFocusBox?.x_pct || 0) + Number(previewFocusBox?.w_pct || 0) / 2) / 100) * sourceWidth,
          y: ((Number(previewFocusBox?.y_pct || 0) + Number(previewFocusBox?.h_pct || 0) / 2) / 100) * sourceHeight,
        };
    const zoomScale = previewZoom / 100;
    const scaledW = previewPageDims.width * zoomScale;
    const scaledH = previewPageDims.height * zoomScale;
    const x = (focus.x / sourceWidth) * scaledW;
    const y = (focus.y / sourceHeight) * scaledH;

    const sc = previewScrollRef.current;
    sc.scrollTo({
      left: Math.max(0, x - sc.clientWidth * 0.45),
      top: Math.max(0, y - sc.clientHeight * 0.4),
      behavior: 'smooth',
    });
  }, [previewTag, previewFocusBox, previewLoaded, previewPageDims, previewZoom, data?.data?.pageWidth, data?.data?.pageHeight, getTagFocus]);

  useEffect(() => {
    if (selectedTagIndex == null) return;
    const el = rowRefs.current.get(selectedTagIndex);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedTagIndex]);

  useEffect(() => {
    if (!selectedMissingKey) return;
    const el = missingRowRefs.current.get(selectedMissingKey);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedMissingKey]);

  useEffect(() => {
    if (!previewTag) return;
    const p = getTagPositionPct(previewTag);
    if (p) setBboxEdit({ ...p });
  }, [previewTag, getTagPositionPct]);

  useEffect(() => {
    const onResize = () => setIsWidePreviewLayout(window.innerWidth >= 1280);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onMove = (evt) => {
      const st = splitDragRef.current;
      if (!st) return;
      const dx = evt.clientX - st.startX;
      const containerW = Math.max(1, st.containerWidth);
      const deltaPct = (dx / containerW) * 100;
      const next = Math.max(35, Math.min(75, st.startRatio + deltaPct));
      setSplitRatio(next);
    };
    const onUp = () => { splitDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (evt) => {
      if (!previewTag || !bboxEdit) return;
      const activeEl = document.activeElement;
      const activeTag = String(activeEl?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(evt.key)) return;

      if (evt.key === 'Enter') {
        evt.preventDefault();
        applyBboxEdit(previewTag, bboxEdit);
        return;
      }

      const pageW = Math.max(1, Number(data?.data?.pageWidth || 1));
      const pageH = Math.max(1, Number(data?.data?.pageHeight || 1));
      const pxStep = evt.shiftKey ? 10 : 1;
      const stepXPct = (pxStep / pageW) * 100;
      const stepYPct = (pxStep / pageH) * 100;
      const next = { ...bboxEdit };
      if (evt.key === 'ArrowLeft') next.x_pct -= stepXPct;
      if (evt.key === 'ArrowRight') next.x_pct += stepXPct;
      if (evt.key === 'ArrowUp') next.y_pct -= stepYPct;
      if (evt.key === 'ArrowDown') next.y_pct += stepYPct;
      const clamped = clampPctBox(next);
      setBboxEdit(clamped);
      applyBboxEdit(previewTag, clamped);
      evt.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewTag, bboxEdit, data?.data?.pageWidth, data?.data?.pageHeight, clampPctBox, applyBboxEdit]);

  const handlePreviewClick = useCallback((evt) => {
    if (panMode) return;
    if (!previewScrollRef.current || !previewPageDims.width || !previewPageDims.height) return;
    const sourceWidth = Number(data?.data?.pageWidth || 0);
    const sourceHeight = Number(data?.data?.pageHeight || 0);
    if (!sourceWidth || !sourceHeight) return;

    const sc = previewScrollRef.current;
    const rect = sc.getBoundingClientRect();
    const zoomScale = previewZoom / 100;
    const xScaled = sc.scrollLeft + (evt.clientX - rect.left);
    const yScaled = sc.scrollTop + (evt.clientY - rect.top);
    const xCanvas = xScaled / zoomScale;
    const yCanvas = yScaled / zoomScale;
    const xSrc = (xCanvas / previewPageDims.width) * sourceWidth;
    const ySrc = (yCanvas / previewPageDims.height) * sourceHeight;

    if (isMissingMode) {
      let best = null;
      let bestDist = Infinity;
      for (const m of filteredMissingRows) {
        const p = getMissingCandidatePctBox(m);
        if (!p) continue;
        const fx = ((Number(p.x_pct || 0) + Number(p.w_pct || 0) / 2) / 100) * sourceWidth;
        const fy = ((Number(p.y_pct || 0) + Number(p.h_pct || 0) / 2) / 100) * sourceHeight;
        const d = Math.hypot(fx - xSrc, fy - ySrc);
        if (d < bestDist) {
          bestDist = d;
          best = m;
        }
      }
      if (best) {
        const key = missingCandidateKey(best);
        setSelectedMissingKey(key);
        previewMissingCandidate(best);
      }
      return;
    }

    if (manualAddMode) {
      const defaultW = 4.4;
      const defaultH = 2.6;
      const draft = clampPctBox({
        x_pct: ((xSrc / sourceWidth) * 100) - (defaultW / 2),
        y_pct: ((ySrc / sourceHeight) * 100) - (defaultH / 2),
        w_pct: defaultW,
        h_pct: defaultH,
      });
      setManualDraft({
        ...draft,
        text: 'NEW-TAG',
        type: 'instrument',
      });
      setPreviewTag(null);
      setPreviewFocusBox({
        ...draft,
        text: 'Manual annotation draft',
      });
      return;
    }

    let best = null;
    let bestDist = Infinity;
    for (const t of reviewableTags) {
      const focus = getTagFocus(t);
      const d = Math.hypot(focus.x - xSrc, focus.y - ySrc);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    if (best) {
      openTagInPdf(best, false);
    }
  }, [panMode, previewZoom, previewPageDims, data?.data?.pageWidth, data?.data?.pageHeight, isMissingMode, filteredMissingRows, missingCandidateKey, reviewableTags, getTagFocus, manualAddMode, clampPctBox]);

  const createManualTag = useCallback(() => {
    if (!manualDraft) return;
    const idx = manualTagIndexRef.current++;
    const tagText = String(manualDraft.text || '').trim().toUpperCase() || 'NEW-TAG';
    const tagType = String(manualDraft.type || 'instrument');
    const position_pct = {
      x_pct: Number(manualDraft.x_pct || 0),
      y_pct: Number(manualDraft.y_pct || 0),
      w_pct: Number(manualDraft.w_pct || 0),
      h_pct: Number(manualDraft.h_pct || 0),
    };
    const newTag = {
      _index: idx,
      _source: 'manual',
      source: 'manual_review_add',
      text: tagText,
      type: tagType,
      confidence: null,
      reason: 'Manual annotation added during review',
      position_pct,
      boundingBox: toBoundingBoxFromPct(position_pct),
    };
    setManualTags((prev) => [...prev, newTag]);
    setDecision(idx, 'edit', {
      correctedText: tagText,
      correctedType: tagType,
      correctedPositionPct: position_pct,
      correctedBoundingBox: toBoundingBoxFromPct(position_pct),
      notes: 'manual_add',
    });
    setManualDraft(null);
    setManualAddMode(false);
    setPreviewTag(newTag);
    setSelectedTagIndex(idx);
    setBboxEdit(position_pct);
  }, [manualDraft, setDecision, toBoundingBoxFromPct]);

  // Convert one missing-structured candidate into a manual tag (already approved-by-edit)
  // so it enters the review flow alongside everything else.
  const includeMissingCandidate = useCallback((m) => {
    if (!m) return null;
    const originKey = missingCandidateKey(m);
    const identityKey = candidateIdentityKey(m);
    if (reviewableIdentitySet.has(identityKey)) {
      setResolvedMissingKeys((prev) => {
        const next = new Set(prev);
        next.add(originKey);
        return next;
      });
      return null;
    }
    const idx = manualTagIndexRef.current++;
    const tagText = String(m.text || '').trim().toUpperCase();
    if (!tagText) return null;
    const tagType = String(m.type || 'instrument');
    const position_pct = m.position_pct
      ? {
          x_pct: Number(m.position_pct.x_pct ?? 0),
          y_pct: Number(m.position_pct.y_pct ?? 0),
          w_pct: Number(m.position_pct.w_pct ?? 0),
          h_pct: Number(m.position_pct.h_pct ?? 0),
        }
      : { x_pct: 0, y_pct: 0, w_pct: 0, h_pct: 0 };
    const newTag = {
      _index: idx,
      _source: 'manual',
      source: 'coverage_rescue',
      _originMissingKey: originKey,
      _originCandidateId: String(m?.candidate_id || m?.candidateId || ''),
      text: tagText,
      type: tagType,
      confidence: 0.85,
      reason: `Recovered missing structured (${m.reason || 'unknown'})`,
      position_pct,
      boundingBox: m.bbox || toBoundingBoxFromPct(position_pct),
    };
    setManualTags((prev) => [...prev, newTag]);
    setResolvedMissingKeys((prev) => {
      const next = new Set(prev);
      next.add(originKey);
      return next;
    });
    setDecision(idx, 'edit', {
      correctedText: tagText,
      correctedType: tagType,
      correctedPositionPct: position_pct,
      correctedBoundingBox: m.bbox || toBoundingBoxFromPct(position_pct),
      notes: `coverage_rescue:${m.reason || 'unknown'}`,
    });
    return newTag;
  }, [setDecision, toBoundingBoxFromPct, missingCandidateKey, candidateIdentityKey, reviewableIdentitySet]);

  const applyMissingReasonPolicies = useCallback((candidates = coverageMissing) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    let added = 0;
    for (const m of candidates) {
      const reasonCode = reasonForMissing(m);
      const policy = policyForReason(reasonCode);
      if (policy !== 'rescue') continue;
      if (includeMissingCandidate(m)) added++;
    }
    if (added > 0) {
      setMissingReasonFilter('all');
      setFilterType('rescued');
    }
    return added;
  }, [coverageMissing, reasonForMissing, policyForReason, includeMissingCandidate]);
  const pushFilteredMissingToTags = useCallback((candidates = filteredMissingRows) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    let added = 0;
    for (const m of candidates) {
      if (includeMissingCandidate(m)) added++;
    }
    if (added > 0) setFilterType('rescued');
    return added;
  }, [filteredMissingRows, includeMissingCandidate]);
  const keepFilteredMissingRejected = useCallback((candidates = filteredMissingRows) => {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    setResolvedMissingKeys((prev) => {
      const next = new Set(prev);
      for (const m of candidates) next.add(missingCandidateKey(m));
      return next;
    });
    setDismissedMissingKeys((prev) => {
      const next = new Set(prev);
      for (const m of candidates) next.add(missingCandidateKey(m));
      return next;
    });
    return candidates.length;
  }, [filteredMissingRows, missingCandidateKey]);

  useEffect(() => {
    if (!Array.isArray(queuedCandidates) || queuedCandidates.length === 0) return;
    let added = 0;
    for (const candidate of queuedCandidates) {
      if (includeMissingCandidate(candidate)) added++;
    }
    if (added > 0) {
      setFilterType('rescued');
    }
    if (typeof onConsumeQueuedCandidates === 'function') {
      onConsumeQueuedCandidates(file.id);
    }
  }, [queuedCandidates, includeMissingCandidate, onConsumeQueuedCandidates, file.id]);

  // Scroll the PDF preview so the given % point is centered (or as close as possible).
  // Used by "Missing structured" fly-to button.
  const flyToPositionPct = useCallback((position_pct) => {
    if (!position_pct) return;
    const el = previewScrollRef.current;
    if (!el || !previewPageDims.width || !previewPageDims.height) return;
    const cx_pct = Number(position_pct.x_pct || 0) + Number(position_pct.w_pct || 0) / 2;
    const cy_pct = Number(position_pct.y_pct || 0) + Number(position_pct.h_pct || 0) / 2;
    const scale = previewZoom / 100;
    const xPx = (cx_pct / 100) * previewPageDims.width * scale;
    const yPx = (cy_pct / 100) * previewPageDims.height * scale;
    el.scrollLeft = Math.max(0, xPx - el.clientWidth / 2);
    el.scrollTop = Math.max(0, yPx - el.clientHeight / 2);
  }, [previewZoom, previewPageDims]);

  const normalizePctBox = useCallback((box) => {
    if (!box) return null;
    const x = Number(box.x_pct);
    const y = Number(box.y_pct);
    const w = Number(box.w_pct);
    const h = Number(box.h_pct);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w <= 0 || h <= 0) return null;
    return {
      x_pct: Math.max(0, Math.min(100, x)),
      y_pct: Math.max(0, Math.min(100, y)),
      w_pct: Math.max(0.01, Math.min(100, w)),
      h_pct: Math.max(0.01, Math.min(100, h)),
    };
  }, []);

  const pctIou = useCallback((a, b) => {
    if (!a || !b) return 0;
    const ax1 = a.x_pct;
    const ay1 = a.y_pct;
    const ax2 = a.x_pct + a.w_pct;
    const ay2 = a.y_pct + a.h_pct;
    const bx1 = b.x_pct;
    const by1 = b.y_pct;
    const bx2 = b.x_pct + b.w_pct;
    const by2 = b.y_pct + b.h_pct;
    const ix1 = Math.max(ax1, bx1);
    const iy1 = Math.max(ay1, by1);
    const ix2 = Math.min(ax2, bx2);
    const iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    if (inter <= 0) return 0;
    const areaA = Math.max(0.0001, a.w_pct * a.h_pct);
    const areaB = Math.max(0.0001, b.w_pct * b.h_pct);
    return inter / (areaA + areaB - inter);
  }, []);

  const getMissingCandidatePctBox = useCallback((m) => {
    if (!m) return null;
    const p = m.position_pct || m.positionPct || null;
    const fromPct = p
      ? normalizePctBox({
          x_pct: Number(p.x_pct ?? p.xPct ?? 0),
          y_pct: Number(p.y_pct ?? p.yPct ?? 0),
          w_pct: Number(p.w_pct ?? p.wPct ?? 0),
          h_pct: Number(p.h_pct ?? p.hPct ?? 0),
        })
      : null;
    const bb = m.bbox || m.boundingBox || null;
    const pageW = Number(data?.data?.pageWidth || 0);
    const pageH = Number(data?.data?.pageHeight || 0);
    let fromBbox = null;
    if (bb && pageW > 0 && pageH > 0) {
      const minX = Number(bb.minX ?? bb.x ?? 0);
      const minY = Number(bb.minY ?? bb.y ?? 0);
      const maxX = Number(bb.maxX ?? (minX + Number(bb.width ?? 0)));
      const maxY = Number(bb.maxY ?? (minY + Number(bb.height ?? 0)));
      const w = Math.max(0, maxX - minX);
      const h = Math.max(0, maxY - minY);
      fromBbox = normalizePctBox({
        x_pct: (minX / pageW) * 100,
        y_pct: (minY / pageH) * 100,
        w_pct: (w / pageW) * 100,
        h_pct: (h / pageH) * 100,
      });
    }

    // If both are present but materially disagree, trust bbox-derived geometry.
    if (fromPct && fromBbox) {
      return pctIou(fromPct, fromBbox) < 0.15 ? fromBbox : fromPct;
    }
    return fromPct || fromBbox;
  }, [data?.data?.pageWidth, data?.data?.pageHeight, normalizePctBox, pctIou]);

  const previewMissingCandidate = useCallback((m) => {
    const pct = getMissingCandidatePctBox(m);
    if (!pct) return;
    setSelectedMissingKey(missingCandidateKey(m));
    setPreviewTag(null);
    setSelectedTagIndex(null);
    setBboxEdit(null);
    setPreviewFocusBox({
      ...pct,
      text: String(m?.text || m?.textCandidate || 'missing-candidate'),
    });
    flyToPositionPct(pct);
  }, [getMissingCandidatePctBox, flyToPositionPct, missingCandidateKey]);

  const beginPanDrag = useCallback((evt) => {
    if (!panMode || evt.button !== 0 || !previewScrollRef.current) return;
    const sc = previewScrollRef.current;
    panDragRef.current = {
      startX: evt.clientX,
      startY: evt.clientY,
      startLeft: sc.scrollLeft,
      startTop: sc.scrollTop,
    };
    evt.preventDefault();
  }, [panMode]);

  useEffect(() => {
    const onMove = (evt) => {
      const st = panDragRef.current;
      if (!st || !previewScrollRef.current) return;
      const dx = evt.clientX - st.startX;
      const dy = evt.clientY - st.startY;
      previewScrollRef.current.scrollLeft = st.startLeft - dx;
      previewScrollRef.current.scrollTop = st.startTop - dy;
    };
    const onUp = () => { panDragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Zoom helper that anchors at a viewport point (cursor or viewport center).
  // Keeps the focal point under the cursor stable across zoom changes by
  // adjusting scroll position proportionally to the zoom delta.
  const MIN_PREVIEW_ZOOM = 20;
  const MAX_PREVIEW_ZOOM = 600;
  const zoomAt = useCallback((nextZoomPct, anchorClientX, anchorClientY) => {
    const el = previewScrollRef.current;
    if (!el) {
      setPreviewZoom(() => Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, nextZoomPct)));
      return;
    }
    const rect = el.getBoundingClientRect();
    const ax = (anchorClientX != null) ? (anchorClientX - rect.left) : (rect.width / 2);
    const ay = (anchorClientY != null) ? (anchorClientY - rect.top) : (rect.height / 2);
    setPreviewZoom((prev) => {
      const next = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, nextZoomPct));
      if (next === prev) return prev;
      const ratio = next / prev;
      // Document coords under the anchor (before zoom).
      const docX = el.scrollLeft + ax;
      const docY = el.scrollTop + ay;
      // After zoom, the same content sits at docX*ratio. Keep the anchor
      // pinned by scrolling so docX*ratio - newScrollLeft = ax.
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, docX * ratio - ax);
        el.scrollTop = Math.max(0, docY * ratio - ay);
      });
      return next;
    });
  }, []);

  useEffect(() => {
    const el = previewScrollRef.current;
    if (!el) return;
    const onWheel = (evt) => {
      if (!evt.ctrlKey && !evt.metaKey) return;
      if (!evt.cancelable) return;
      evt.preventDefault();
      // Smaller step for trackpad-like devices, larger for mouse wheel.
      const step = Math.abs(evt.deltaY) < 30 ? 6 : 12;
      const direction = evt.deltaY > 0 ? -step : step;
      const target = previewZoom + direction;
      zoomAt(target, evt.clientX, evt.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [previewZoom, zoomAt]);

  // File navigation
  const currentFileIdx = allFiles.findIndex(f => f.id === file.id);
  const nextFile = currentFileIdx >= 0 ? allFiles[currentFileIdx + 1] : null;
  const prevFile = currentFileIdx > 0 ? allFiles[currentFileIdx - 1] : null;
  const strictLockBlocksNavigation = strictShipLock && saveSummary.pendingRequired > 0;
  const canSaveReview = !saveReview.isPending && reviewableTags.length > 0 && saveSummary.pendingRequired === 0;
  const canSaveAndNext = canSaveReview && !!nextFile;
  const navigateToFile = useCallback((targetFile) => {
    if (!targetFile) return;
    if (strictLockBlocksNavigation) return;
    onNavigate(targetFile);
  }, [strictLockBlocksNavigation, onNavigate]);
  const handleSaveAndNext = useCallback(async () => {
    if (!canSaveAndNext) return;
    try {
      await saveReview.mutateAsync({ batchId, fileId: file.id, decisions: buildDecisionListForSave() });
      navigateToFile(nextFile);
    } catch {
      // Keep user on current file when save fails.
    }
  }, [canSaveAndNext, saveReview, batchId, file.id, buildDecisionListForSave, navigateToFile, nextFile]);

  const typeColors = { equipment: '#60A5FA', instrument: '#F39C12', line: '#3BE494', drawing_ref: '#A855F7', noise: '#919A9B' };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-md-surface/98 backdrop-blur-sm">
      <div className="absolute inset-0 -z-10 bg-md-surface/95" onClick={onClose} />
      <div className="m-1 flex-1 min-h-0 flex flex-col rounded-md-lg border border-[#3BE494]/30 overflow-hidden bg-md-surface-container/95 shadow-2xl">
      {/* Compact unified header: title + progress + nav + bulk-actions toggle */}
      <div className="flex items-center gap-2 px-3 py-0.5 bg-[#3BE494]/8 border-b border-[#3BE494]/15">
        <span className="material-symbols-outlined text-[16px] text-[#3BE494]">rate_review</span>
        <span className="text-[11px] font-bold text-md-on-surface truncate max-w-[260px]" title={file.filename}>
          {file.filename}
        </span>

        {/* Progress ring with stats in tooltip — saves ~60px vs separate stats row */}
        <div
          className="flex items-center gap-1.5"
          title={`Total ${stats.total} • Required ${stats.required} • Approved ${stats.approved} • Rejected ${stats.rejected} • Edited ${stats.edited} • Pending ${stats.pending}${stats.autoReject ? ` • Auto-Rejected ${stats.autoReject}` : ''}`}
        >
          <div className="w-24 h-1.5 rounded-full bg-md-on-surface/10 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300 bg-[#3BE494]"
              style={{ width: `${stats.total > 0 ? ((stats.total - stats.pending) / stats.total * 100) : 0}%` }} />
          </div>
          <span className="text-[10px] text-md-on-surface-variant w-8">
            {stats.total > 0 ? Math.round((stats.total - stats.pending) / stats.total * 100) : 0}%
          </span>
          <span className="text-[10px] text-[#3BE494] font-semibold">{stats.approved}</span>
          <span className="text-[9px] text-md-on-surface-variant">/</span>
          <span className="text-[10px] text-[#E74C3C] font-semibold">{stats.rejected}</span>
          <span className="text-[9px] text-md-on-surface-variant">/</span>
          <span className="text-[10px] text-md-on-surface-variant font-semibold">{stats.pending}</span>
          {stats.autoReject > 0 && (
            <button
              onClick={() => setFilterType('auto_reject')}
              className="ml-1 text-[9px] font-bold text-[#E74C3C] hover:underline"
              title="Filter to auto-rejected — review/override low-confidence tags"
            >
              ! {stats.autoReject}
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Filter pills inline (always visible — primary control) */}
        <div className="flex gap-0.5">
          {[
            { key: 'all', label: 'All' },
            { key: 'tags', label: 'Tags' },
            { key: 'equipment', label: 'Eq' },
            { key: 'instrument', label: 'Inst' },
            { key: 'line', label: 'Line' },
            { key: 'uncertain', label: 'Unc' },
            { key: 'rescued', label: 'Rescued' },
            { key: 'rejected_pool', label: `RejPool ${coverageMissing.length}` },
            { key: 'noise', label: 'Noise' },
            { key: 'pending', label: 'Pend' },
            { key: 'approved', label: 'Appr' },
            { key: 'rejected', label: 'Rej' },
            ...(stats.autoReject > 0 ? [{ key: 'auto_reject', label: `Auto !${stats.autoReject}` }] : []),
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilterType(f.key)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
                filterType === f.key ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
              }`}
              title={`Filter: ${f.label}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setBulkActionsExpanded(v => !v)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${bulkActionsExpanded ? 'bg-[#8AB4FF]/15 text-[#8AB4FF]' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
          title="Toggle bulk-action controls (threshold, approve-all, reset)"
        >
          <span className="material-symbols-outlined text-[12px]">{bulkActionsExpanded ? 'expand_less' : 'tune'}</span>
          Bulk
        </button>

        <button
          onClick={() => decideSelectedTag('approve')}
          disabled={isMissingMode || filteredTags.length === 0}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25 disabled:opacity-30 transition-colors"
          title={isMissingMode ? 'Use Rejected Pool actions for missing candidates' : 'Approve current/selected row and jump to next'}
        >
          <span className="material-symbols-outlined text-[12px]">playlist_add_check</span>
          Approve+Next
        </button>

        <button
          onClick={rejectNoiseAndAutoReject}
          disabled={shipRejectableCount === 0}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#E74C3C]/14 text-[#E74C3C] hover:bg-[#E74C3C]/24 disabled:opacity-30 transition-colors"
          title="Force reject all tags currently marked as noise or auto-reject tier"
        >
          <span className="material-symbols-outlined text-[12px]">gpp_bad</span>
          Reject noise/auto ({shipRejectableCount})
        </button>

        <button
          onClick={() => setShowShortcutHints(v => !v)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${showShortcutHints ? 'bg-[#A855F7]/15 text-[#D8B4FE]' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
          title="Keyboard shortcuts"
        >
          <span className="material-symbols-outlined text-[12px]">keyboard</span>
          Keys
        </button>

        <button
          onClick={() => setShowPdfPreview(v => !v)}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${showPdfPreview ? 'bg-[#2D33E0]/15 text-[#8AB4FF]' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
          title={showPdfPreview ? 'Hide PDF preview' : 'Show PDF preview'}
        >
          <span className="material-symbols-outlined text-[12px]">picture_as_pdf</span>
        </button>

        {/* File navigation */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStrictShipLock(v => !v)}
            className={`p-0.5 rounded transition-colors ${strictShipLock ? 'text-[#F39C12] bg-[#F39C12]/10 hover:bg-[#F39C12]/20' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
            title={strictShipLock ? 'Strict ship lock ON (blocks file nav while required items are pending)' : 'Strict ship lock OFF'}
          >
            <span className="material-symbols-outlined text-[14px]">{strictShipLock ? 'lock' : 'lock_open'}</span>
          </button>
          <button
            disabled={!prevFile || strictLockBlocksNavigation}
            onClick={() => navigateToFile(prevFile)}
            className="p-0.5 rounded hover:bg-md-on-surface/5 disabled:opacity-20"
            title={strictLockBlocksNavigation ? 'Resolve pending required decisions or disable lock to navigate files' : 'Previous file'}
          >
            <span className="material-symbols-outlined text-[16px]">chevron_left</span>
          </button>
          <span className="text-[10px] text-md-on-surface-variant">
            {currentFileIdx + 1}/{allFiles.length}
          </span>
          <button
            disabled={!nextFile || strictLockBlocksNavigation}
            onClick={() => navigateToFile(nextFile)}
            className="p-0.5 rounded hover:bg-md-on-surface/5 disabled:opacity-20"
            title={strictLockBlocksNavigation ? 'Resolve pending required decisions or disable lock to navigate files' : 'Next file'}
          >
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>

        <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface ml-1" title="Close review">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {showShortcutHints && (
        <div className="px-3 py-1 border-b border-[#A855F7]/20 bg-[#A855F7]/8 text-[9px] text-md-on-surface-variant flex items-center gap-2 flex-wrap">
          <span className="font-bold text-[#D8B4FE]">Shortcuts:</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">J</kbd>/<kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">K</kbd> next/prev row</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">A</kbd> approve</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">R</kbd> reject</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">E</kbd> edit</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">M</kbd> manual add mode</span>
          <span><kbd className="px-1 rounded bg-md-on-surface/10 text-md-on-surface">?</kbd> toggle this help</span>
        </div>
      )}

      {coverageMissing.length > 0 && filterType !== 'rejected_pool' && (
        <div className="px-3 py-1 border-b border-[#A855F7]/20 bg-[#A855F7]/6 text-[9px] text-md-on-surface-variant flex items-center gap-2">
          <span className="font-bold text-[#D8B4FE]">Ship flow:</span>
          <span>{coverageMissing.length} missing candidates are waiting in Rejected Pool.</span>
          <button
            onClick={() => setFilterType('rejected_pool')}
            className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#A855F7]/20 text-[#D8B4FE] hover:bg-[#A855F7]/28"
            title="Open Rejected Pool to push valid misses into tags"
          >
            Open RejPool
          </button>
          <span className="text-md-on-surface-variant/80">Push valid misses, then continue approve/reject.</span>
        </div>
      )}
      {strictLockBlocksNavigation && (
        <div className="px-3 py-1 border-b border-[#F39C12]/20 bg-[#F39C12]/8 text-[9px] text-md-on-surface-variant flex items-center gap-2">
          <span className="font-bold text-[#F39C12]">Strict ship lock:</span>
          <span>{saveSummary.pendingRequired} required rows still pending, file navigation is blocked.</span>
          <span className="text-md-on-surface-variant/80">Finish decisions, then Save or Save & Next.</span>
        </div>
      )}
      <div className="px-3 py-1.5 border-b border-md-outline-variant/10 bg-md-surface-container/20 flex items-center gap-2 flex-wrap">
        <span className="text-[9px] uppercase font-bold text-md-on-surface-variant">Workflow</span>
        <button
          onClick={() => setFilterType('pending')}
          className={`px-2 py-0.5 rounded text-[9px] font-bold ${filterType === 'pending' ? 'bg-[#F39C12]/20 text-[#F39C12]' : 'bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10'}`}
          title="Rows still requiring an explicit decision"
        >
          Needs decision ({workflowSummary.remainingRequired})
        </button>
        <button
          onClick={() => setFilterType('approved')}
          className={`px-2 py-0.5 rounded text-[9px] font-bold ${filterType === 'approved' ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10'}`}
          title="Rows ready to ship as keep/approved"
        >
          Ready ({workflowSummary.readyToShip})
        </button>
        <button
          onClick={() => setFilterType('rejected')}
          className={`px-2 py-0.5 rounded text-[9px] font-bold ${filterType === 'rejected' ? 'bg-[#E74C3C]/20 text-[#E74C3C]' : 'bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10'}`}
          title="Rows set to drop/cleanup"
        >
          Cleanup ({workflowSummary.needsCleanup})
        </button>
        <span className="text-[9px] text-md-on-surface-variant ml-2">
          Decisions {workflowSummary.decisionsTaken} · Progress {workflowSummary.completionPct}%
        </span>
        <div className="w-24 h-1 rounded-full bg-md-on-surface/10 overflow-hidden">
          <div className="h-full bg-[#3BE494]" style={{ width: `${workflowSummary.completionPct}%` }} />
        </div>
        <span className="flex-1" />
        <button
          onClick={() => setCompactListMode((v) => !v)}
          className={`px-2 py-0.5 rounded text-[9px] font-bold ${compactListMode ? 'bg-[#8AB4FF]/18 text-[#8AB4FF]' : 'bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10'}`}
          title={compactListMode ? 'Compact list is ON' : 'Switch to compact list'}
        >
          {compactListMode ? 'Compact list' : 'Detailed list'}
        </button>
      </div>

      {/* Bulk actions — collapsed by default to save vertical space */}
      {bulkActionsExpanded && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-md-outline-variant/10 flex-wrap bg-md-surface-container/20">
          <div className="flex items-center gap-2 bg-[#3BE494]/8 rounded-md px-2 py-1">
            <span className="text-[9px] text-md-on-surface-variant font-bold whitespace-nowrap">Threshold:</span>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={confidenceThreshold}
              onChange={e => setConfidenceThreshold(Number(e.target.value))}
              className="w-20 h-1 accent-[#3BE494] cursor-pointer"
            />
            <span className="text-[11px] font-bold text-[#3BE494] w-8 text-center">{confidenceThreshold}%</span>
            <button onClick={approveAboveThreshold}
              disabled={tagsAboveThreshold === 0}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25 transition-colors disabled:opacity-30">
              <span className="material-symbols-outlined text-[12px]">done_all</span>
              Approve {tagsAboveThreshold} tags
            </button>
          </div>

          <div className="flex items-center gap-2 bg-md-on-surface/5 rounded-md px-2 py-1">
            <span className="text-[9px] text-md-on-surface-variant font-bold whitespace-nowrap">Min Conf:</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minConfidenceFilter}
              onChange={e => setMinConfidenceFilter(Number(e.target.value))}
              className="w-20 h-1 accent-[#60A5FA] cursor-pointer"
            />
            <span className="text-[10px] font-bold text-[#60A5FA] w-8 text-center">{minConfidenceFilter}%</span>
            <label className="flex items-center gap-1 text-[9px] text-md-on-surface-variant">
              <input
                type="checkbox"
                checked={includeUnknownConfidence}
                onChange={e => setIncludeUnknownConfidence(e.target.checked)}
                className="accent-[#60A5FA]"
              />
              Keep unknown
            </label>
          </div>
          <button onClick={approveAll}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-md-on-surface/5 text-md-on-surface-variant hover:bg-md-on-surface/10 transition-colors">
            <span className="material-symbols-outlined text-[12px]">select_all</span>
            Approve All
          </button>
          <button
            onClick={() => applyDecisionToFiltered('approve')}
            disabled={isMissingMode || filteredTags.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-[#3BE494]/12 text-[#3BE494] hover:bg-[#3BE494]/22 disabled:opacity-30 transition-colors"
            title={isMissingMode ? 'Use per-row actions for missing candidates' : 'Apply approve to currently filtered rows'}
          >
            <span className="material-symbols-outlined text-[12px]">done_all</span>
            Approve Filtered ({activeFilteredCount})
          </button>
          <button
            onClick={() => applyDecisionToFiltered('reject')}
            disabled={isMissingMode || filteredTags.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-[#E74C3C]/12 text-[#E74C3C] hover:bg-[#E74C3C]/22 disabled:opacity-30 transition-colors"
            title={isMissingMode ? 'Use per-row actions for missing candidates' : 'Apply reject to currently filtered rows'}
          >
            <span className="material-symbols-outlined text-[12px]">cancel</span>
            Reject Filtered ({activeFilteredCount})
          </button>
          <div className="flex items-center gap-1.5 bg-[#F39C12]/8 rounded-md px-2 py-1">
            <span className="text-[9px] font-bold text-[#F39C12] whitespace-nowrap">Promote filtered:</span>
            <select
              value={bulkRetypeTarget}
              onChange={(e) => setBulkRetypeTarget(e.target.value)}
              className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
            >
              <option value="equipment">Equipment</option>
              <option value="instrument">Instrument</option>
              <option value="line">Line</option>
              <option value="drawing_ref">Drawing Ref</option>
            </select>
            <button
              onClick={() => bulkRetypeFilteredTo(bulkRetypeTarget)}
              disabled={isMissingMode || filteredTags.length === 0}
              className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#F39C12]/15 text-[#F39C12] hover:bg-[#F39C12]/25 disabled:opacity-30 transition-colors"
              title={isMissingMode ? 'Use Rejected Pool push actions for missing candidates' : 'Set filtered rows to selected type as edited tags'}
            >
              Convert ({activeFilteredCount})
            </button>
          </div>
          <div className="flex items-center gap-2 bg-md-on-surface/5 rounded-md px-2 py-1">
            <span className="text-[9px] text-md-on-surface-variant font-bold whitespace-nowrap">Defaults:</span>
            <label className="text-[9px] text-md-on-surface-variant">Auto-reject</label>
            <select
              value={defaultDecisionPolicy.autoReject}
              onChange={(e) => setDefaultDecisionPolicy((prev) => ({ ...prev, autoReject: e.target.value }))}
              className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
            >
              <option value="reject">Reject</option>
              <option value="approve">Approve</option>
            </select>
            <label className="text-[9px] text-md-on-surface-variant">Noise</label>
            <select
              value={defaultDecisionPolicy.noise}
              onChange={(e) => setDefaultDecisionPolicy((prev) => ({ ...prev, noise: e.target.value }))}
              className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
            >
              <option value="reject">Reject</option>
              <option value="approve">Approve</option>
            </select>
            <label className="text-[9px] text-md-on-surface-variant">Uncertain</label>
            <select
              value={defaultDecisionPolicy.uncertain}
              onChange={(e) => setDefaultDecisionPolicy((prev) => ({ ...prev, uncertain: e.target.value }))}
              className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
            >
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
            </select>
          </div>
          <button onClick={() => setDecisions({})}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/5">
            <span className="material-symbols-outlined text-[12px]">restart_alt</span>
            Reset
          </button>
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-8 text-md-on-surface-variant">
          <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
          Loading classified tags...
        </div>
      )}
      {error && (
        <div className="px-4 py-4 text-body-sm text-red-400">Failed to load: {error.message}</div>
      )}

      {/* Tag review table */}
      {data && (
        <div className={`h-[calc(100vh-250px)] min-h-[640px] flex ${showPdfPreview ? 'flex-col xl:flex-row' : ''}`}>
          <div
            className={`${showPdfPreview ? 'w-full xl:border-r border-md-outline-variant/10' : 'w-full'} overflow-auto`}
            style={showPdfPreview && isWidePreviewLayout && !previewFloating ? { width: `${splitRatio}%` } : undefined}
          >
            {isMissingMode && (
              <div className="sticky top-0 z-20 px-3 py-1.5 border-b border-md-outline-variant/10 bg-[#A855F7]/8 text-[10px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[#D8B4FE]">Rejected Pool</span>
                  <span className="text-md-on-surface-variant">
                    Default state = rejected. Push only valid tags to accepted list.
                  </span>
                  <span className="flex-1" />
                  <select
                    value={missingReasonFilter}
                    onChange={(e) => setMissingReasonFilter(e.target.value)}
                    className="px-1.5 py-0.5 bg-md-surface rounded border border-md-outline-variant/30 text-[10px]"
                  >
                    <option value="all">Reason: all</option>
                    {Array.from(new Set(coverageMissing.map(reasonForMissing))).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => pushFilteredMissingToTags(filteredMissingRows)}
                    disabled={filteredMissingRows.length === 0}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25 disabled:opacity-30"
                    title="Push currently filtered rejected candidates to accepted-tag review list"
                  >
                    Push filtered to tags ({filteredMissingRows.length})
                  </button>
                  <button
                    onClick={() => keepFilteredMissingRejected(filteredMissingRows)}
                    disabled={filteredMissingRows.length === 0}
                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#E74C3C]/12 text-[#E74C3C] hover:bg-[#E74C3C]/20 disabled:opacity-30"
                    title="Keep currently filtered candidates rejected and hide from pool"
                  >
                    Keep filtered rejected ({filteredMissingRows.length})
                  </button>
                </div>
              </div>
            )}
            <table className={`w-full table-fixed ${compactListMode ? 'text-[10px]' : 'text-[11px]'}`}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col />
                <col style={{ width: '160px' }} />
                <col style={{ width: '90px' }} />
              <col style={{ width: compactListMode ? '130px' : '180px' }} />
                <col style={{ width: '110px' }} />
              <col style={{ width: compactListMode ? '0px' : '180px' }} />
              </colgroup>
            <thead className="sticky top-0 z-10 bg-md-surface-container-high/95 backdrop-blur">
              <tr className="text-left text-md-on-surface-variant">
                <th className="px-2 py-1.5">#</th>
                <th className="px-3 py-1.5">Tag</th>
                <th className="px-3 py-1.5">Type</th>
                <th className="px-3 py-1.5 text-center">Conf</th>
                {showReasonColumn && <th className="px-3 py-1.5">AI Reason</th>}
                <th className="px-3 py-1.5 text-center">Locate</th>
                <th className="px-3 py-1.5 text-center">Decision</th>
              </tr>
              <tr className="text-left bg-md-surface-container/60 border-t border-md-outline-variant/10">
                <th className="px-1 py-1">
                  <button
                    onClick={clearColFilters}
                    title="Clear all column filters"
                    className="text-md-on-surface-variant/60 hover:text-md-on-surface"
                  >
                    <span className="material-symbols-outlined text-[12px]">filter_alt_off</span>
                  </button>
                </th>
                <th className="px-2 py-1">
                  <input
                    type="text"
                    value={colFilters.text}
                    onChange={(e) => updateColFilter('text', e.target.value)}
                    placeholder="search…"
                    className="w-full px-1.5 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface placeholder:text-md-on-surface-variant/40 outline-none focus:border-[#3BE494]/50"
                  />
                </th>
                <th className="px-2 py-1">
                  <select
                    value={colFilters.type}
                    onChange={(e) => updateColFilter('type', e.target.value)}
                    className="w-full px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface outline-none focus:border-[#3BE494]/50"
                  >
                    <option value="">all</option>
                    <option value="equipment">equipment</option>
                    <option value="instrument">instrument</option>
                    <option value="line">line</option>
                    <option value="drawing_ref">drawing_ref</option>
                    <option value="noise">noise</option>
                  </select>
                </th>
                <th className="px-1 py-1">
                  <div className="flex items-center gap-0.5">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={colFilters.confMin}
                      onChange={(e) => updateColFilter('confMin', e.target.value)}
                      placeholder="min"
                      title="Minimum confidence (%)"
                      className="w-10 px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[9px] text-md-on-surface outline-none focus:border-[#3BE494]/50"
                    />
                    <span className="text-[9px] text-md-on-surface-variant/50">–</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={colFilters.confMax}
                      onChange={(e) => updateColFilter('confMax', e.target.value)}
                      placeholder="max"
                      title="Maximum confidence (%)"
                      className="w-10 px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[9px] text-md-on-surface outline-none focus:border-[#3BE494]/50"
                    />
                  </div>
                </th>
                {showReasonColumn && (
                  <th className="px-2 py-1">
                    <input
                      type="text"
                      value={colFilters.reason}
                      onChange={(e) => updateColFilter('reason', e.target.value)}
                      placeholder="search reason…"
                      className="w-full px-1.5 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface placeholder:text-md-on-surface-variant/40 outline-none focus:border-[#3BE494]/50"
                    />
                  </th>
                )}
                <th className="px-1 py-1 text-center text-[9px] text-md-on-surface-variant/40">—</th>
                <th className="px-2 py-1">
                  <select
                    value={colFilters.decision}
                    onChange={(e) => updateColFilter('decision', e.target.value)}
                    className="w-full px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface outline-none focus:border-[#3BE494]/50"
                  >
                    <option value="">all</option>
                    <option value="pending">pending</option>
                    <option value="approve">approved</option>
                    <option value="reject">rejected</option>
                    <option value="edit">edited</option>
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {isMissingMode ? (
                <>
                  {filteredMissingRows.map((m, idx) => {
                    const key = missingCandidateKey(m);
                    const alreadyIncluded = includedMissingKeys.has(key);
                    const reasonText = String(m?.reason_code || m?.reason || 'unknown');
                    const conf = normalizeConfidence(m?.confidence);
                    const geometryQuality = m?.position_pct
                      ? 'pct'
                      : (m?.bbox || m?.boundingBox) ? 'bbox' : 'none';
                    return (
                      <tr
                        key={`missing-${key}`}
                        ref={(el) => {
                          if (el) missingRowRefs.current.set(key, el);
                          else missingRowRefs.current.delete(key);
                        }}
                        onClick={() => previewMissingCandidate(m)}
                        className={`border-b border-md-outline-variant/5 hover:bg-md-on-surface/3 cursor-pointer ${
                          selectedMissingKey === key ? 'bg-[#8AB4FF]/14 ring-1 ring-[#8AB4FF] shadow-[inset_4px_0_0_0_#8AB4FF]' : ''
                        }`}
                      >
                        <td className="px-3 py-1.5 text-md-on-surface-variant">{idx + 1}</td>
                        <td className="px-3 py-1.5 align-middle">
                          <span className="font-mono font-semibold text-md-on-surface">{String(m?.text || '').toUpperCase() || '—'}</span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                            style={{ background: `${typeColors[m?.type || 'noise'] || '#919A9B'}18`, color: typeColors[m?.type || 'noise'] || '#919A9B' }}
                          >
                            {m?.type || 'unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {conf == null ? '—' : (
                            <span className={conf > 0.9 ? 'text-green-400' : conf > 0.7 ? 'text-yellow-400' : 'text-red-400'}>
                              {Math.round(conf * 100)}%
                            </span>
                          )}
                        </td>
                        {showReasonColumn && (
                          <td className="px-3 py-1.5 text-[10px] text-md-on-surface-variant truncate" title={reasonText}>
                            <span className="text-[#D8B4FE] font-semibold">{reasonText}</span>
                            <span className={`ml-1 px-1 py-[1px] rounded text-[8px] font-bold uppercase ${
                              geometryQuality === 'pct'
                                ? 'bg-[#3BE494]/15 text-[#3BE494]'
                                : geometryQuality === 'bbox'
                                  ? 'bg-[#F39C12]/15 text-[#F39C12]'
                                  : 'bg-[#E74C3C]/15 text-[#E74C3C]'
                            }`}>
                              {geometryQuality}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-1.5 text-center">
                          {getMissingCandidatePctBox(m) ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                previewMissingCandidate(m);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2D33E0]/10 text-[#8AB4FF] hover:bg-[#2D33E0]/20"
                              title="Focus this rejected candidate in PDF"
                            >
                              <span className="material-symbols-outlined text-[11px]">my_location</span>
                              Preview
                            </button>
                          ) : (
                            <span className="text-[9px] text-md-on-surface-variant/50">no-pos</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newTag = includeMissingCandidate(m);
                                if (newTag) previewMissingCandidate(m);
                              }}
                              disabled={alreadyIncluded}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25 disabled:opacity-40"
                              title="Promote this rejected candidate to reviewable tag list"
                            >
                              {alreadyIncluded ? 'Pushed' : 'Push to tags'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setResolvedMissingKeys((prev) => {
                                  const next = new Set(prev);
                                  next.add(key);
                                  return next;
                                });
                                setDismissedMissingKeys((prev) => {
                                  const next = new Set(prev);
                                  next.add(key);
                                  return next;
                                });
                              }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#E74C3C]/12 text-[#E74C3C] hover:bg-[#E74C3C]/20"
                              title="Keep this candidate rejected and hide it from current missing list"
                            >
                              Keep rejected
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredMissingRows.length === 0 && (
                    <tr>
                      <td colSpan={showReasonColumn ? 7 : 6} className="px-3 py-3 text-center text-[10px] text-md-on-surface-variant">
                        No missing candidates for current filters.
                      </td>
                    </tr>
                  )}
                </>
              ) : filteredTags.map((tag) => {
                const dec = decisions[tag._index];
                const isEditing = editingIndex === tag._index;
                const displayText = dec?.correctedText || tag.text;
                const displayType = dec?.correctedType || tag.type;
                const isAutoReject = tag.automationDecision === 'auto_reject';

                return (
                  <tr
                    key={tag._index}
                    ref={(el) => {
                      if (el) rowRefs.current.set(tag._index, el);
                      else rowRefs.current.delete(tag._index);
                    }}
                    onClick={() => openTagInPdf(tag, false)}
                    className={`border-b border-md-outline-variant/5 transition-colors ${
                      selectedTagIndex === tag._index ? 'bg-[#8AB4FF]/14 ring-1 ring-[#8AB4FF] shadow-[inset_4px_0_0_0_#8AB4FF]' :
                      dec?.action === 'approve' ? 'bg-[#3BE494]/5' :
                      dec?.action === 'reject' ? 'bg-[#E74C3C]/5' :
                      dec?.action === 'edit' ? 'bg-[#F39C12]/5' :
                      isAutoReject ? 'bg-[#E74C3C]/8 border-l-2 border-l-[#E74C3C]/40' :
                      tag._source === 'uncertain' ? 'bg-[#F39C12]/3' :
                      'hover:bg-md-on-surface/3'
                    }`}
                  >
                    <td className="px-3 py-1.5 text-md-on-surface-variant">{tag._index + 1}</td>
                    <td className="px-3 py-1.5 align-middle">
                      {isEditing ? (
                        <input
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          className="w-full px-1.5 py-0.5 bg-md-surface border border-md-primary/30 rounded text-[11px] font-mono text-md-on-surface outline-none"
                          autoFocus
                        />
                      ) : (
                        <span className={`font-mono font-semibold ${dec?.action === 'reject' ? 'line-through opacity-50' : ''} text-md-on-surface`}>
                          {displayText}
                          {dec?.correctedText && dec.correctedText !== tag.text && (
                            <span className="ml-1 text-[9px] text-[#F39C12]">(was: {tag.text})</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {isEditing ? (
                        <select
                          value={editType}
                          onChange={e => setEditType(e.target.value)}
                          className="px-1 py-0.5 bg-md-surface border border-md-primary/30 rounded text-[10px] text-md-on-surface"
                        >
                          <option value="equipment">Equipment</option>
                          <option value="instrument">Instrument</option>
                          <option value="line">Line</option>
                          <option value="drawing_ref">Drawing Ref</option>
                          <option value="noise">Noise</option>
                        </select>
                      ) : (
                        <div className="flex items-center gap-1 min-h-[22px]">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                            style={{ background: `${typeColors[displayType] || '#919A9B'}18`, color: typeColors[displayType] || '#919A9B' }}>
                            {tag.subType || displayType}
                          </span>
                          <select
                            value={displayType || 'noise'}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              const nextType = e.target.value;
                              setDecision(tag._index, 'edit', {
                                correctedText: dec?.correctedText || tag.text,
                                correctedType: nextType,
                                correctedPositionPct: dec?.correctedPositionPct,
                                correctedBoundingBox: dec?.correctedBoundingBox,
                                notes: 'type_recategorized',
                              });
                            }}
                            className="h-[22px] px-1 py-0 rounded bg-md-surface border border-md-outline-variant/25 text-[9px] text-md-on-surface"
                            title="Recategorize this tag type"
                          >
                            <option value="equipment">Equipment</option>
                            <option value="instrument">Instrument</option>
                            <option value="line">Line</option>
                            <option value="drawing_ref">Drawing Ref</option>
                            <option value="noise">Noise</option>
                          </select>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={
                        normalizeConfidence(tag.confidence) == null
                          ? 'text-md-on-surface-variant'
                          : normalizeConfidence(tag.confidence) > 0.9
                            ? 'text-green-400'
                            : normalizeConfidence(tag.confidence) > 0.7
                              ? 'text-yellow-400'
                              : 'text-red-400'
                      }>
                        {formatConfidence(tag.confidence)}
                      </span>
                    </td>
                    {showReasonColumn && (
                      <td className="px-3 py-1.5 text-[10px] text-md-on-surface-variant truncate"
                        title={isAutoReject ? `Auto-rejected (confidence ${(tag.confidence * 100).toFixed(0)}% below threshold). ${tag.reason || ''}` : tag.reason}>
                        {isAutoReject && <span className="text-[#E74C3C] font-bold mr-1" title="Auto-rejected: confidence below threshold. Override with Approve/Edit if valid.">[!]</span>}
                        {tag._source === 'uncertain' && !isAutoReject && <span className="text-[#F39C12] font-bold mr-1">[?]</span>}
                        {!hasValidPosition(tag) && (
                          <span
                            className="inline-block mr-1 px-1 py-[1px] rounded text-[8px] font-bold bg-[#A855F7]/20 text-[#D8B4FE] uppercase"
                            title="No position metadata — cannot paint on PDF. Use Add tag mode to place it, or delete."
                          >
                            no-pos
                          </span>
                        )}
                        {tag.reason || (isAutoReject ? 'Low confidence — review to recover' : '—')}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => openTagInPdf(tag, false)}
                          disabled={!file?.storageKey}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2D33E0]/10 text-[#8AB4FF] hover:bg-[#2D33E0]/20 disabled:opacity-30"
                          title="Preview source PDF near this tag position"
                        >
                          <span className="material-symbols-outlined text-[11px]">my_location</span>
                          {!compactListMode && 'Preview'}
                        </button>
                        <button
                          onClick={() => openTagInPdf(tag, true)}
                          disabled={!file?.storageKey}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-md-on-surface/8 text-md-on-surface-variant hover:bg-md-on-surface/12 disabled:opacity-30"
                          title="Open source PDF in new tab"
                        >
                          <span className="material-symbols-outlined text-[11px]">open_in_new</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={confirmEdit}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25">
                            Save
                          </button>
                          <button onClick={() => setEditingIndex(null)}
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold text-md-on-surface-variant hover:bg-md-on-surface/5">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-0.5">
                          {/* Approve */}
                          <button
                            onClick={() => setDecision(tag._index, 'approve')}
                            title={tag._source === 'noise' ? 'Approve (rare for noise)' : 'Approve'}
                            className={`p-1 rounded transition-colors ${
                              dec?.action === 'approve' ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-md-on-surface-variant/40 hover:text-[#3BE494] hover:bg-[#3BE494]/10'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          </button>
                          {/* Edit */}
                          <button
                            onClick={() => startEdit(tag)}
                            title={tag._source === 'noise' ? 'Promote noise to real tag' : 'Edit'}
                            className={`p-1 rounded transition-colors ${
                              dec?.action === 'edit' ? 'bg-[#F39C12]/20 text-[#F39C12]' : 'text-md-on-surface-variant/40 hover:text-[#F39C12] hover:bg-[#F39C12]/10'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                          </button>
                          {/* Reject */}
                          <button
                            onClick={() => setDecision(tag._index, 'reject')}
                            title={tag._source === 'noise' ? 'Keep as noise' : 'Reject'}
                            className={`p-1 rounded transition-colors ${
                              dec?.action === 'reject' ? 'bg-[#E74C3C]/20 text-[#E74C3C]' : 'text-md-on-surface-variant/40 hover:text-[#E74C3C] hover:bg-[#E74C3C]/10'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">cancel</span>
                          </button>
                          <button
                            onClick={() => markTagDeleted(tag)}
                            title={tag._source === 'manual' ? 'Delete manual annotation' : 'Delete annotation from review'}
                            className="p-1 rounded text-md-on-surface-variant/40 hover:text-[#E74C3C] hover:bg-[#E74C3C]/10"
                          >
                            <span className="material-symbols-outlined text-[13px]">delete</span>
                          </button>
                          {/* Undo */}
                          {dec && (
                            <button
                              onClick={() => {
                                setDecisions(prev => {
                                  const next = { ...prev };
                                  delete next[tag._index];
                                  return next;
                                });
                              }}
                              title="Undo"
                              className="p-1 rounded text-md-on-surface-variant/40 hover:text-md-on-surface hover:bg-md-on-surface/5"
                            >
                              <span className="material-symbols-outlined text-[12px]">undo</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          {showPdfPreview && isWidePreviewLayout && !previewFloating && (
            <div
              className="hidden xl:flex w-[8px] cursor-col-resize items-center justify-center bg-md-surface/20 border-r border-md-outline-variant/10"
              onMouseDown={beginSplitDrag}
              title="Drag to resize table and PDF panes"
            >
              <div className="h-12 w-[2px] bg-md-on-surface-variant/40 rounded" />
            </div>
          )}

          {showPdfPreview && (
            <>
            {previewFloating && (
              <div
                className="fixed inset-0 z-[70] bg-black/45"
                onClick={() => setPreviewFloating(false)}
              />
            )}
            <div
              className={`${previewFloating
                ? 'fixed inset-1 z-[80] flex flex-col rounded-md-lg border border-md-outline-variant/30 bg-[#0B1510] shadow-2xl'
                : 'w-full min-w-[320px] flex flex-col bg-md-surface-container/20 border-t xl:border-t-0 border-md-outline-variant/10'}`}
              style={showPdfPreview && isWidePreviewLayout && !previewFloating ? { width: `${100 - splitRatio}%` } : undefined}
            >
              <div className="flex items-center gap-2 px-2 py-0.5 border-b border-md-outline-variant/10 flex-wrap">
                <span className="material-symbols-outlined text-[14px] text-[#8AB4FF]">picture_as_pdf</span>
                <span className="text-[10px] font-semibold text-md-on-surface flex-1">
                  {previewTag ? `Preview: ${previewTag.text}` : previewFocusBox ? `Visual miss: ${previewFocusBox.text || 'candidate'}` : 'PDF preview'}
                </span>
                <button
                  onClick={() => setShowVisualMisses(v => !v)}
                  className={`p-1 rounded inline-flex items-center gap-1 text-[10px] font-bold ${showVisualMisses ? 'bg-[#F59E0B]/15 text-[#F59E0B]' : 'text-md-on-surface-variant hover:bg-md-on-surface/8'}`}
                  title={`${showVisualMisses ? 'Hide' : 'Show'} visual misses (${filteredVisualMisses.length})`}
                >
                  <span className="material-symbols-outlined text-[14px]">report</span>
                  {filteredVisualMisses.length}
                </button>
                <details className="relative">
                  <summary className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer list-none inline-flex items-center gap-1 ${paintAllExtracted ? 'bg-[#3BE494]/15 text-[#3BE494]' : 'text-md-on-surface-variant hover:bg-md-on-surface/10'}`}>
                    <span className="material-symbols-outlined text-[12px]">format_paint</span>
                    Paint
                  </summary>
                  <div className="absolute right-0 mt-1 z-30 w-44 p-2 rounded border border-md-outline-variant/30 bg-[#0D1F17]/97 shadow-lg">
                    <label className="flex items-center gap-1.5 text-[10px] text-md-on-surface mb-1.5 pb-1.5 border-b border-md-outline-variant/20">
                      <input
                        type="checkbox"
                        checked={paintAllExtracted}
                        onChange={(e) => setPaintAllExtracted(e.target.checked)}
                        className="accent-[#3BE494]"
                      />
                      Paint all extracted
                    </label>
                    {paintAllExtracted && (
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          ['equipment', '#60A5FA', 'Eq'],
                          ['instrument', '#F39C12', 'Inst'],
                          ['line', '#3BE494', 'Line'],
                          ['drawing_ref', '#A855F7', 'Draw'],
                          ['noise', '#FF4DB4', 'Noise'],
                          ['rescued', '#D8B4FE', 'Rescued'],
                          ['rejected', '#E74C3C', 'Rejected'],
                        ].map(([key, color, label]) => (
                          <button
                            key={key}
                            onClick={() => togglePaintGroup(key)}
                            className={`px-1 py-0.5 rounded border text-[9px] ${paintGroups[key] ? 'opacity-100' : 'opacity-35'}`}
                            style={{ borderColor: color, color }}
                            title={`Toggle ${label} paint`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="text-[8px] text-md-on-surface-variant/80 mt-1.5">
                      Rescued = AI-miss recovery
                    </div>
                  </div>
                </details>
                <button
                  onClick={() => setPanMode((v) => !v)}
                  className={`p-1 rounded ${panMode ? 'bg-[#8AB4FF]/20 text-[#8AB4FF]' : 'text-md-on-surface-variant hover:bg-md-on-surface/8'}`}
                  title="Pan mode: drag to move viewport"
                >
                  <span className="material-symbols-outlined text-[14px]">pan_tool</span>
                </button>
                <button
                  onClick={() => {
                    setManualAddMode((v) => !v);
                    setManualDraft(null);
                    setPreviewFocusBox(null);
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${manualAddMode
                    ? 'bg-[#3BE494]/25 text-[#3BE494] border-[#3BE494] shadow-[0_0_0_2px_rgba(59,228,148,0.25)]'
                    : 'bg-[#3BE494]/10 text-[#3BE494] border-[#3BE494]/60 hover:bg-[#3BE494]/20'}`}
                  title="Add a missing annotation: click here, then click on the drawing where the tag should go (or press N)"
                >
                  <span className="material-symbols-outlined text-[12px]">add_circle</span>
                  {manualAddMode ? 'Click drawing to place…' : 'Add tag'}
                </button>
                <button
                  onClick={openStandalonePdfWindow}
                  className="p-1 rounded text-md-on-surface-variant hover:bg-md-on-surface/8"
                  title="Open PDF in standalone browser window"
                >
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </button>
                <button
                  onClick={() => setPreviewFloating((v) => !v)}
                  className="p-1 rounded text-md-on-surface-variant hover:bg-md-on-surface/8"
                  title={previewFloating ? 'Dock preview back' : 'Float preview'}
                >
                  <span className="material-symbols-outlined text-[14px]">{previewFloating ? 'dock_to_left' : 'open_in_full'}</span>
                </button>
                {showPdfPreview && isWidePreviewLayout && !previewFloating && (
                  <div className="ml-1 inline-flex gap-1">
                    {[42, 48, 58].map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() => setSplitRatio(ratio)}
                        className={`px-1 py-0.5 rounded text-[9px] ${Math.round(splitRatio) === ratio ? 'bg-[#8AB4FF]/20 text-[#8AB4FF]' : 'text-md-on-surface-variant hover:bg-md-on-surface/8'}`}
                        title={`Set table width to ${ratio}%`}
                      >
                        {ratio}/{100 - ratio}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {showVisualMisses && (
                <div className="px-3 py-0.5 border-b border-md-outline-variant/10 text-[9px] text-md-on-surface-variant/70 truncate">
                  regions {visualAuditSummary.regionsTotal} · misses {visualAuditSummary.missesTotal} · vertical {visualAuditSummary.verticalMisses} · provider {visualAuditSummary.provider}
                </div>
              )}
              {data?.data?.coverageReport && (
                <details className="border-b border-md-outline-variant/10">
                  <summary className="px-3 py-0.5 cursor-pointer list-none text-[9px] text-md-on-surface-variant/70 inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">info</span>
                    Coverage report
                  </summary>
                  <div className="px-3 py-1 text-[9px] text-md-on-surface-variant">
                    universe {(data.data.coverageReport.candidateUniverseCount ?? data.data.coverageReport.rawStructuredCandidateCount) || 0} | kept {(data.data.coverageReport.keptCount ?? data.data.coverageReport.retainedStructuredCount) || 0} | uncertain {(data.data.coverageReport.uncertainCount ?? data.data.coverageReport.uncertainStructuredCount) || 0} | rejected {(data.data.coverageReport.rejectedCount ?? data.data.coverageReport.missingStructuredCount) || 0} | unexplained {data.data.coverageReport.unexplainedDrops || 0}
                  </div>
                </details>
              )}
              {previewTag && (
                <div className="px-3 py-1.5 border-b border-md-outline-variant/10 text-[10px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-md-on-surface">Geometry</span>
                    <span className="text-md-on-surface-variant">x y w h (%)</span>
                    <span className="flex-1" />
                    <label className="inline-flex items-center gap-1 text-[10px] text-md-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={lockAspectRatio}
                        onChange={(e) => setLockAspectRatio(e.target.checked)}
                        className="accent-[#8AB4FF]"
                      />
                      Lock ratio
                    </label>
                    <button
                      className="px-2 py-0.5 rounded bg-[#8AB4FF]/15 text-[#8AB4FF] font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        snapBboxToNearbyText();
                      }}
                      title="Snap bbox to nearby OCR words from raw extraction"
                    >
                      Snap text
                    </button>
                    <button
                      className="px-2 py-0.5 rounded bg-[#F39C12]/15 text-[#F39C12] font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        const p = getTagPositionPct(previewTag) || { x_pct: 0, y_pct: 0, w_pct: 1, h_pct: 1 };
                        setBboxEdit({ ...p });
                      }}
                    >
                      Load
                    </button>
                    <button
                      className="px-2 py-0.5 rounded bg-[#3BE494]/15 text-[#3BE494] font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (bboxEdit) applyBboxEdit(previewTag, bboxEdit);
                      }}
                    >
                      Apply
                    </button>
                    <button
                      className="px-2 py-0.5 rounded bg-[#E74C3C]/15 text-[#E74C3C] font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        markTagDeleted(previewTag);
                      }}
                      title="Delete selected annotation from review result"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {['x_pct', 'y_pct', 'w_pct', 'h_pct'].map((k) => (
                      <input
                        key={k}
                        type="number"
                        step="0.1"
                        value={bboxEdit?.[k] ?? ''}
                        onChange={(e) => setBboxEdit((prev) => clampPctBox({ ...(prev || {}), [k]: Number(e.target.value) }))}
                        className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
                      />
                    ))}
                  </div>
                  <div className="mt-1 text-[9px] text-md-on-surface-variant">
                    Drag box/handles to edit. Arrow keys nudge by 1px, Shift+Arrow by 10px, Enter applies.
                  </div>
                </div>
              )}
              {manualAddMode && !manualDraft && (
                <div className="px-3 py-1.5 border-b border-[#3BE494]/30 text-[11px] bg-[#3BE494]/10 text-[#3BE494] flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">touch_app</span>
                  <span className="font-semibold">Add tag mode is on.</span>
                  <span className="text-md-on-surface-variant">Click anywhere on the drawing where the missing tag should go. A draft box will appear for you to type the text and pick the type.</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => { setManualAddMode(false); setManualDraft(null); }}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold text-md-on-surface-variant hover:bg-md-on-surface/10"
                  >Cancel (Esc)</button>
                </div>
              )}
              {manualAddMode && manualDraft && (
                <div className="px-3 py-1.5 border-b border-md-outline-variant/10 text-[10px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-md-on-surface">New annotation</span>
                    <span className="text-md-on-surface-variant">Click drawing to reposition, then create</span>
                  </div>
                  <div className="grid grid-cols-2 xl:grid-cols-6 gap-1">
                    <input
                      value={manualDraft.text || ''}
                      onChange={(e) => setManualDraft((prev) => ({ ...(prev || {}), text: e.target.value }))}
                      className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface xl:col-span-2"
                      placeholder="Tag text"
                    />
                    <select
                      value={manualDraft.type || 'instrument'}
                      onChange={(e) => setManualDraft((prev) => ({ ...(prev || {}), type: e.target.value }))}
                      className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[10px] text-md-on-surface"
                    >
                      <option value="equipment">Equipment</option>
                      <option value="instrument">Instrument</option>
                      <option value="line">Line</option>
                      <option value="drawing_ref">Drawing Ref</option>
                      <option value="noise">Noise</option>
                    </select>
                    <button
                      onClick={createManualTag}
                      className="px-2 py-0.5 rounded bg-[#3BE494]/15 text-[#3BE494] font-semibold"
                    >
                      Create
                    </button>
                    <button
                      onClick={() => { setManualDraft(null); setManualAddMode(false); setPreviewFocusBox(null); }}
                      className="px-2 py-0.5 rounded bg-md-on-surface/10 text-md-on-surface-variant font-semibold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {showVisualMisses && filteredVisualMisses.length > 0 && (
                <div className="px-3 py-1.5 border-b border-md-outline-variant/10 text-[10px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-md-on-surface">Visual misses</span>
                    <span className="text-md-on-surface-variant">
                      {filteredVisualMisses.length} candidates
                    </span>
                  </div>
                  <div className="max-h-[88px] overflow-auto space-y-1">
                    {filteredVisualMisses.slice(0, 12).map((m) => (
                      <button
                        key={m.id}
                        onClick={(e) => { e.stopPropagation(); openVisualMissInPdf(m); }}
                        className="w-full text-left px-1.5 py-1 rounded bg-[#F59E0B]/10 hover:bg-[#F59E0B]/18 text-[#FDE68A]"
                        title="Focus this missed visual region on drawing"
                      >
                        {(m.typeHint || 'unknown').toUpperCase()} · {m.textCandidate || '(no text)'} · {m.layout || 'mixed'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {coverageMissing.length > 0 && (() => {
                const reasons = Array.from(new Set(coverageMissing.map(reasonForMissing)));
                const filtered = missingReasonFilter === 'all'
                  ? coverageMissing
                  : coverageMissing.filter(m => reasonForMissing(m) === missingReasonFilter);
                const filteredRescueEligible = filtered;
                const filteredRescueCount = filteredRescueEligible.filter((m) => policyForReason(reasonForMissing(m)) === 'rescue').length;
                const displayed = missingPanelExpanded ? filtered : filtered.slice(0, 4);
                const reasonCounts = reasons.reduce((acc, r) => {
                  acc[r] = coverageMissing.filter(m => reasonForMissing(m) === r).length;
                  return acc;
                }, {});
                if (isMissingMode) {
                  return (
                    <div className="px-3 py-1 border-b border-md-outline-variant/10 text-[9px] bg-[#A855F7]/6 text-md-on-surface-variant">
                      Missing structured tools hidden (using left-side Rejected Pool list). {filtered.length}/{coverageMissing.length} filtered.
                    </div>
                  );
                }
                if (!showRightMissingTools) {
                  return (
                    <div className="px-3 py-1 border-b border-md-outline-variant/10 text-[9px] bg-[#A855F7]/4 text-md-on-surface-variant flex items-center gap-2">
                      <span className="font-semibold text-[#D8B4FE]">Missing structured {filtered.length}/{coverageMissing.length}</span>
                      <span>Right-side tools collapsed to preserve drawing height.</span>
                      <span className="flex-1" />
                      <button
                        onClick={() => setShowRightMissingTools(true)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-md-on-surface/8 text-md-on-surface-variant hover:bg-md-on-surface/15"
                        title="Expand right-side missing tools"
                      >
                        Show tools
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="px-3 py-1.5 border-b border-md-outline-variant/10 text-[10px] bg-[#A855F7]/4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <button
                        onClick={() => setMissingPanelExpanded(v => !v)}
                        className="flex items-center gap-1 font-semibold text-md-on-surface hover:text-[#D8B4FE]"
                        title="Toggle missing-structured panel"
                      >
                        <span className="material-symbols-outlined text-[12px]">{missingPanelExpanded ? 'expand_more' : 'chevron_right'}</span>
                        Missing structured
                      </button>
                      <span className="text-md-on-surface-variant">
                        {filtered.length}{missingReasonFilter !== 'all' ? `/${coverageMissing.length}` : ''} candidates
                      </span>
                      <div className="flex gap-0.5 flex-wrap">
                        <button
                          onClick={() => setMissingReasonFilter('all')}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${missingReasonFilter === 'all' ? 'bg-[#A855F7]/25 text-[#D8B4FE]' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
                        >
                          all ({coverageMissing.length})
                        </button>
                        {reasons.map(r => (
                          <button
                            key={r}
                            onClick={() => {
                              setMissingReasonFilter(r);
                              setFilterType('rejected_pool');
                            }}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${missingReasonFilter === r ? 'bg-[#A855F7]/25 text-[#D8B4FE]' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'}`}
                            title={`Show only ${r}`}
                          >
                            {r} ({reasonCounts[r]})
                          </button>
                        ))}
                      </div>
                      <span className="flex-1" />
                      <button
                        onClick={() => setFilterType('rejected_pool')}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-md-on-surface/8 text-md-on-surface-variant hover:bg-md-on-surface/15"
                        title="Show missing candidates on the left decision list"
                      >
                        Show in left list
                      </button>
                      <button
                        onClick={() => setShowRightMissingTools(false)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-md-on-surface/8 text-md-on-surface-variant hover:bg-md-on-surface/15"
                        title="Collapse right-side missing tools"
                      >
                        Collapse
                      </button>
                      <button
                        onClick={() => {
                          setMissingReasonPolicy((prev) => {
                            const next = { ...(prev || {}) };
                            for (const r of reasons) {
                              if (String(r || '').toUpperCase() === 'REJECT_DEDUP_SUPERSEDED') next[r] = 'reject';
                              else next[r] = 'rescue';
                            }
                            return next;
                          });
                        }}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#F39C12]/15 text-[#F39C12] hover:bg-[#F39C12]/25"
                        title="Simple mode: recover most rejected candidates (except dedup-superseded)"
                      >
                        Simple mode preset
                      </button>
                      <button
                        onClick={() => {
                          // Bulk-include all currently filtered missing items as edited tags.
                          const added = applyMissingReasonPolicies(filteredRescueEligible);
                          if (added > 0) {
                            setMissingReasonFilter('all');
                            setFilterType('rescued');
                          }
                        }}
                        disabled={filteredRescueCount === 0}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25 disabled:opacity-30"
                        title="Push currently filtered rejected candidates into accepted-tag review list"
                      >
                        Push filtered to tags ({filteredRescueCount})
                      </button>
                      <button
                        onClick={() => applyMissingReasonPolicies(coverageMissing)}
                        className="px-2 py-0.5 rounded text-[9px] font-bold bg-[#8AB4FF]/15 text-[#8AB4FF] hover:bg-[#8AB4FF]/25"
                        title="Auto-push all reasons marked 'push to tags' into review list"
                      >
                        Auto-push by policy
                      </button>
                    </div>
                    <div className="flex items-center gap-1 mb-1 flex-wrap">
                      <span className="text-md-on-surface-variant">Reason policy:</span>
                      <span className="text-[9px] text-md-on-surface-variant/80">
                        Quick flow: choose reason -&gt; Push filtered to tags -&gt; edit text/type if needed -&gt; Save Review.
                      </span>
                      {reasons.map((r) => (
                        <label key={`policy-${r}`} className="inline-flex items-center gap-1 px-1 py-0.5 rounded bg-md-on-surface/5">
                          <span className="text-[9px] text-md-on-surface-variant max-w-[180px] truncate" title={r}>{r}</span>
                          <select
                            value={policyForReason(r)}
                            onChange={(e) => setMissingReasonPolicy((prev) => ({ ...prev, [r]: e.target.value }))}
                            className="px-1 py-0.5 bg-md-surface border border-md-outline-variant/30 rounded text-[9px] text-md-on-surface"
                          >
                            <option value="reject">stay rejected</option>
                            <option value="rescue">push to tags</option>
                          </select>
                        </label>
                      ))}
                    </div>
                    {missingPanelExpanded && (
                      <div className="max-h-[180px] overflow-auto space-y-0.5">
                        {displayed.map((m, idx) => (
                          <div
                            key={`${m.text}-${idx}`}
                            className="w-full flex items-center gap-2 px-1.5 py-1 rounded bg-[#A855F7]/10 hover:bg-[#A855F7]/18 text-[#D8B4FE]"
                          >
                            <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-[#A855F7]/20 w-16 text-center">
                              {(m.type || '?')}
                            </span>
                            <span className="font-mono font-bold flex-1 truncate" title={m.text}>{m.text}</span>
                            <span className="text-[9px] text-md-on-surface-variant truncate max-w-[120px]" title={m.reason_code || m.reason}>
                              {m.reason_code || m.reason || '—'}
                            </span>
                            <span className={`px-1 py-0.5 rounded text-[8px] font-bold uppercase ${policyForReason(reasonForMissing(m)) === 'rescue' ? 'bg-[#3BE494]/15 text-[#3BE494]' : 'bg-md-on-surface/8 text-md-on-surface-variant'}`}>
                              {policyForReason(reasonForMissing(m))}
                            </span>
                            {getMissingCandidatePctBox(m) ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); previewMissingCandidate(m); }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2D33E0]/10 text-[#8AB4FF] hover:bg-[#2D33E0]/20"
                                title="Fly drawing to this candidate's position"
                              >
                                <span className="material-symbols-outlined text-[10px]">my_location</span>
                              </button>
                            ) : (
                              <span className="px-1 text-[8px] text-md-on-surface-variant/40" title="No position metadata">no-pos</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newTag = includeMissingCandidate(m);
                                if (newTag) {
                                  setSelectedTagIndex(newTag._index);
                                  setPreviewTag(newTag);
                                  previewMissingCandidate(m);
                                }
                              }}
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25"
                              title="Push this rejected candidate into accepted-tag review list"
                            >
                              + Push to tags
                            </button>
                          </div>
                        ))}
                        {!missingPanelExpanded && filtered.length > 4 && (
                          <div className="text-center text-[9px] text-md-on-surface-variant py-1">
                            … {filtered.length - 4} more (click chevron to expand)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div
                ref={previewScrollRef}
                onClick={handlePreviewClick}
                onMouseDown={beginPanDrag}
                className={`flex-1 min-h-[560px] bg-md-surface overflow-auto ${panMode ? 'cursor-grab' : manualAddMode ? 'cursor-copy' : 'cursor-crosshair'}`}
                title={panMode ? 'Pan mode active: drag to move viewport. Ctrl+wheel to zoom.' : manualAddMode ? 'Add mode: click drawing to place a new annotation.' : 'Click near a tag to select nearest review row. Ctrl+wheel to zoom.'}
              >
                {previewUrl ? (
                  <div className="relative inline-block min-w-full p-2">
                    <div
                      className="relative origin-top-left"
                      style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: 'top left' }}
                    >
                      {previewPdfLoading && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-md-surface/70 text-[11px] text-md-on-surface-variant">
                          Loading PDF...
                        </div>
                      )}
                      <PdfCanvas
                        data={previewPdfData}
                        page={1}
                        onLoaded={() => { setPreviewLoaded(true); setPreviewError(''); }}
                        onError={(err) => { setPreviewLoaded(false); setPreviewError(err?.message || 'PDF load failed'); }}
                        onDimensions={(dims) => setPreviewPageDims(dims || { width: 0, height: 0 })}
                        className="shadow-md border border-md-outline-variant/20 bg-white"
                      />
                      <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1 px-1.5 py-1 rounded bg-[#0D1F17]/85 border border-md-outline-variant/30">
                        <button
                          onClick={() => zoomAt(previewZoom - 20)}
                          className="px-1 rounded text-[11px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                          title="Zoom out"
                        >-</button>
                        <span className="text-[10px] text-md-on-surface-variant w-10 text-center">{previewZoom}%</span>
                        <button
                          onClick={() => zoomAt(previewZoom + 20)}
                          className="px-1 rounded text-[11px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                          title="Zoom in"
                        >+</button>
                        <button
                          onClick={() => zoomAt(100)}
                          className="px-1.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                          title="Reset to 100%"
                        >1:1</button>
                        <button
                          onClick={() => {
                            const el = previewScrollRef.current;
                            if (!el || !previewPageDims.width || !previewPageDims.height) return;
                            const fitW = (el.clientWidth - 16) / previewPageDims.width;
                            const fitH = (el.clientHeight - 16) / previewPageDims.height;
                            const fit = Math.max(0.2, Math.min(6, Math.min(fitW, fitH)));
                            zoomAt(Math.round(fit * 100));
                          }}
                          className="px-1.5 rounded text-[10px] text-md-on-surface-variant hover:bg-md-on-surface/10"
                          title="Fit page to viewport"
                        >Fit</button>
                      </div>

                      {paintAllExtracted && previewPageDims.width > 0 && previewPageDims.height > 0 && data?.data?.pageWidth > 0 && data?.data?.pageHeight > 0 && (
                        <>
                          {reviewableTags.map((t) => {
                            const p = getTagPositionPct(t);
                            if (!p) return null;
                            const wp = Number(p.w_pct || 0);
                            const hp = Number(p.h_pct || 0);
                            // Skip phantom (0,0,0,0) boxes — these are tags missing geometry,
                            // surfaced separately via "no-pos" badge in the table.
                            if (p.x_pct === 0 && p.y_pct === 0 && wp === 0 && hp === 0) return null;
                            // Skip anomalous giant boxes in paint mode — thresholds per tag type.
                            // Line tags are legitimately wide (can span ~40% of drawing width), so
                            // applying the instrument/equipment cap (wp*hp > 220) silently dropped them.
                            if (wp <= 0 || hp <= 0) return null;
                            const dec = decisions[t._index];
                            const tagType = String(dec?.correctedType || t.type || '').toLowerCase();
                            if (tagType === 'line') {
                              if (wp > 80 || hp > 20 || (wp * hp) > 1200) return null;
                            } else if (tagType === 'drawing_ref') {
                              if (wp > 60 || hp > 25 || (wp * hp) > 700) return null;
                            } else {
                              if (wp > 60 || hp > 35 || (wp * hp) > 700) return null;
                            }
                            const isRescued = ['coverage_rescue', 'deterministic_recovery'].includes(String(t.source || ''));
                            const paintKey = isRescued ? 'rescued' : (tagType || 'noise');
                            if (!paintGroups[paintKey]) return null;
                            const x = (Number(p.x_pct || 0) / 100) * previewPageDims.width;
                            const y = (Number(p.y_pct || 0) / 100) * previewPageDims.height;
                            const w = Math.max(6, (wp / 100) * previewPageDims.width);
                            const h = Math.max(6, (hp / 100) * previewPageDims.height);
                            const fill = isRescued
                              ? 'rgba(216, 180, 254, 0.36)'
                              : tagType === 'instrument'
                              ? 'rgba(243, 156, 18, 0.34)'
                              : tagType === 'line'
                                ? 'rgba(59, 228, 148, 0.32)'
                                : tagType === 'drawing_ref'
                                  ? 'rgba(168, 85, 247, 0.32)'
                                  : tagType === 'equipment'
                                    ? 'rgba(96, 165, 250, 0.30)'
                                    : 'rgba(255, 0, 148, 0.34)';
                            const border = isRescued
                              ? '#D8B4FE'
                              : tagType === 'instrument'
                              ? '#F39C12'
                              : tagType === 'line'
                                ? '#3BE494'
                                : tagType === 'drawing_ref'
                                  ? '#A855F7'
                                  : tagType === 'equipment'
                                    ? '#60A5FA'
                                    : '#FF4DB4';
                            return (
                              <div
                                key={`paint-${t._index}`}
                                className="absolute pointer-events-none"
                                style={{
                                  left: `${x}px`,
                                  top: `${y}px`,
                                  width: `${w}px`,
                                  height: `${h}px`,
                                  background: fill,
                                  border: `2px solid ${border}`,
                                }}
                                title={t.text}
                              />
                            );
                          })}
                          {paintGroups.rejected && coverageMissing.map((m, i) => {
                            const key = missingCandidateKey(m);
                            if (resolvedMissingKeys.has(key)) return null;
                            if (dismissedMissingKeys.has(key)) return null;
                            if (includedMissingKeys.has(key)) return null;
                            const p = getMissingCandidatePctBox(m);
                            if (!p) return null;
                            const wp = Number(p.w_pct || 0);
                            const hp = Number(p.h_pct || 0);
                            if (wp <= 0 || hp <= 0) return null;
                            const x = (Number(p.x_pct || 0) / 100) * previewPageDims.width;
                            const y = (Number(p.y_pct || 0) / 100) * previewPageDims.height;
                            const w = Math.max(6, (wp / 100) * previewPageDims.width);
                            const h = Math.max(6, (hp / 100) * previewPageDims.height);
                            return (
                              <div
                                key={`paint-rejected-${i}-${key}`}
                                className="absolute pointer-events-none"
                                style={{
                                  left: `${x}px`,
                                  top: `${y}px`,
                                  width: `${w}px`,
                                  height: `${h}px`,
                                  background: 'rgba(231, 76, 60, 0.14)',
                                  border: '2px dashed #E74C3C',
                                }}
                                title={`Rejected: ${m?.text || ''} (${m?.reason_code || m?.reason || 'unknown'})`}
                              />
                            );
                          })}
                        </>
                      )}

                      {showVisualMisses && previewPageDims.width > 0 && previewPageDims.height > 0 && data?.data?.pageWidth > 0 && data?.data?.pageHeight > 0 && (
                        <>
                          {filteredVisualMisses.map((m) => {
                            const p = m.position_pct || m.positionPct;
                            if (!p) return null;
                            const x = (Number(p.x_pct ?? p.xPct ?? 0) / 100) * previewPageDims.width;
                            const y = (Number(p.y_pct ?? p.yPct ?? 0) / 100) * previewPageDims.height;
                            const w = Math.max(8, (Number(p.w_pct ?? p.wPct ?? 0) / 100) * previewPageDims.width);
                            const h = Math.max(8, (Number(p.h_pct ?? p.hPct ?? 0) / 100) * previewPageDims.height);
                            return (
                              <button
                                key={`miss-overlay-${m.id}`}
                                className="absolute border border-[#F59E0B] bg-[#F59E0B]/8"
                                style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
                                onClick={(e) => { e.stopPropagation(); openVisualMissInPdf(m); }}
                                title={`Miss candidate: ${m.textCandidate || m.regionLabel || 'unknown'}`}
                              />
                            );
                          })}
                        </>
                      )}

                      {(previewTag || previewFocusBox) && previewPageDims.width > 0 && previewPageDims.height > 0 && data?.data?.pageWidth > 0 && data?.data?.pageHeight > 0 && (
                        (() => {
                          const srcW = Number(data.data.pageWidth || 1);
                          const srcH = Number(data.data.pageHeight || 1);
                          const bb = previewTag ? getTagBoundingBox(previewTag) : null;
                          const pct = previewTag ? (bboxEdit || getTagPositionPct(previewTag)) : previewFocusBox;

                          // No geometry anywhere — show a banner instead of a phantom 0,0 box
                          if (previewTag && !bb && !pct) {
                            return (
                              <div
                                className="absolute left-1/2 top-4 -translate-x-1/2 z-10 px-3 py-2 rounded-md border border-[#A855F7]/50 bg-[#0D1F17]/90 backdrop-blur-sm shadow-lg max-w-[360px]"
                              >
                                <div className="flex items-start gap-2">
                                  <span className="material-symbols-outlined text-[14px] text-[#D8B4FE] mt-[1px]">location_off</span>
                                  <div className="text-[10px] text-[#D8B4FE] leading-[1.4]">
                                    <div className="font-bold mb-0.5">No position for "{previewTag.text}"</div>
                                    <div className="text-[9px] text-[#D8B4FE]/80">
                                      AI could not geolocate this tag. Use <span className="font-bold">Add tag</span> mode to draw a box on the drawing, or reject it.
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          let x = 0; let y = 0; let w = 20; let h = 12;
                          let hasGeometry = false;
                          if (bb && !pct && previewTag) {
                            const minX = Number(bb.minX || 0);
                            const minY = Number(bb.minY || 0);
                            const maxX = Number(bb.maxX || minX + 1);
                            const maxY = Number(bb.maxY || minY + 1);
                            x = (minX / srcW) * previewPageDims.width;
                            y = (minY / srcH) * previewPageDims.height;
                            w = Math.max(8, ((maxX - minX) / srcW) * previewPageDims.width);
                            h = Math.max(8, ((maxY - minY) / srcH) * previewPageDims.height);
                            hasGeometry = true;
                          } else if (pct) {
                            const pctW = Number(pct.w_pct || 0);
                            const pctH = Number(pct.h_pct || 0);
                            // All-zero pct (x=y=w=h=0) is a phantom — skip it
                            if (pctW > 0 && pctH > 0) {
                              x = (Number(pct.x_pct || 0) / 100) * previewPageDims.width;
                              y = (Number(pct.y_pct || 0) / 100) * previewPageDims.height;
                              w = Math.max(10, (pctW / 100) * previewPageDims.width);
                              h = Math.max(10, (pctH / 100) * previewPageDims.height);
                              hasGeometry = true;
                            }
                          }

                          if (!hasGeometry) {
                            if (!previewTag) return null;
                            return (
                              <div
                                className="absolute left-1/2 top-4 -translate-x-1/2 z-10 px-3 py-2 rounded-md border border-[#A855F7]/50 bg-[#0D1F17]/90 backdrop-blur-sm shadow-lg max-w-[360px]"
                              >
                                <div className="flex items-start gap-2">
                                  <span className="material-symbols-outlined text-[14px] text-[#D8B4FE] mt-[1px]">location_off</span>
                                  <div className="text-[10px] text-[#D8B4FE] leading-[1.4]">
                                    <div className="font-bold mb-0.5">No position for "{previewTag.text}"</div>
                                    <div className="text-[9px] text-[#D8B4FE]/80">
                                      AI could not geolocate this tag. Use <span className="font-bold">Add tag</span> mode to draw a box on the drawing, or reject it.
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              className={`absolute border-2 ${previewTag ? 'border-[#E74C3C] bg-[#E74C3C]/12' : 'border-[#FDE68A] border-dashed bg-[#FDE68A]/10'}`}
                              style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, cursor: previewTag ? 'move' : 'default' }}
                              onMouseDown={previewTag ? ((e) => beginBboxDrag('move', e)) : undefined}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {previewTag && ['nw', 'ne', 'sw', 'se'].map((hKey) => {
                                const pos = {
                                  nw: 'left-[-5px] top-[-5px] cursor-nwse-resize',
                                  ne: 'right-[-5px] top-[-5px] cursor-nesw-resize',
                                  sw: 'left-[-5px] bottom-[-5px] cursor-nesw-resize',
                                  se: 'right-[-5px] bottom-[-5px] cursor-nwse-resize',
                                }[hKey];
                                return (
                                  <div
                                    key={hKey}
                                    className={`absolute w-[10px] h-[10px] rounded-full bg-[#E74C3C] border border-white ${pos}`}
                                    onMouseDown={(e) => beginBboxDrag(hKey, e)}
                                  />
                                );
                              })}
                            </div>
                          );
                        })()
                      )}
                      {manualDraft && previewPageDims.width > 0 && previewPageDims.height > 0 && (
                        <div
                          className="absolute border-2 border-[#3BE494] border-dashed bg-[#3BE494]/12 pointer-events-none"
                          style={{
                            left: `${(Number(manualDraft.x_pct || 0) / 100) * previewPageDims.width}px`,
                            top: `${(Number(manualDraft.y_pct || 0) / 100) * previewPageDims.height}px`,
                            width: `${Math.max(10, (Number(manualDraft.w_pct || 0) / 100) * previewPageDims.width)}px`,
                            height: `${Math.max(10, (Number(manualDraft.h_pct || 0) / 100) * previewPageDims.height)}px`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-[11px] text-md-on-surface-variant">
                    Click "Preview" on any tag to zoom to its location in the source PDF.
                  </div>
                )}

                {previewError && (
                  <div className="px-3 py-2 text-[10px] text-[#E74C3C] border-t border-md-outline-variant/10">
                    PDF preview failed: {previewError}
                  </div>
                )}
              </div>
            </div>
            </>
          )}
        </div>
      )}

      {/* Footer with save */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-t border-md-outline-variant/10 bg-md-surface-container/20">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-md-on-surface-variant">
            {stats.required - stats.pending} of {stats.required} required tags reviewed
          </span>
          <span className="text-[10px] text-md-on-surface-variant">
            On save: <span className="text-[#3BE494] font-bold">{saveSummary.keep} keep</span>
            {' · '}
            <span className="text-[#E74C3C] font-bold">{saveSummary.drop} drop</span>
            {saveSummary.pendingRequired > 0 && (
              <span className="text-[#F39C12]/90 font-bold" title="These rows still need explicit approve/reject/edit decisions before save.">
                {' · '}{saveSummary.pendingRequired} pending required
              </span>
            )}
            {saveSummary.untouchedAutoReject > 0 && (
              <span className="text-[#E74C3C]/80 font-bold" title="Auto-rejected tags you haven't reviewed. They will be discarded on save unless you approve/edit them.">
                {' · '}{saveSummary.untouchedAutoReject} auto-rejected unreviewed
              </span>
            )}
          </span>
        </div>
        <div className="flex-1" />

        {saveReview.isSuccess && (
          <span className="text-[10px] text-[#3BE494] font-bold">
            Saved. Feedback events: {saveReview.data?.knowledge?.feedbackEventsInserted ?? 0}
            {` · Patterns promoted: ${saveReview.data?.knowledge?.patternsPromoted ?? 0}`}
          </span>
        )}
        {saveReview.isError && (
          <span className="text-[10px] text-[#E74C3C]">Error: {saveReview.error?.message}</span>
        )}

        <button
          onClick={handleSave}
          disabled={!canSaveReview}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-label-sm font-bold transition-all disabled:opacity-30"
          style={{ background: '#3BE49425', color: '#3BE494' }}
          title={
            saveSummary.pendingRequired > 0
              ? `${saveSummary.pendingRequired} classified/uncertain tags still need explicit decisions.`
              : (saveSummary.untouchedAutoReject > 0
                ? `${saveSummary.untouchedAutoReject} auto-rejected tags will be discarded. Filter to "Auto-Rejected" to review them first.`
                : undefined)
          }
        >
          {saveReview.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">save</span>
          )}
          Save Review ({saveSummary.keep}/{saveSummary.total})
        </button>
        <button
          onClick={handleSaveAndNext}
          disabled={!canSaveAndNext}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-label-sm font-bold transition-all disabled:opacity-30"
          style={{ background: '#8AB4FF25', color: '#8AB4FF' }}
          title={!nextFile ? 'Last file in the batch' : (saveSummary.pendingRequired > 0 ? 'Resolve pending required decisions before continuing' : 'Save this file and jump to next file')}
        >
          {saveReview.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">skip_next</span>
          )}
          Save & Next File
        </button>
      </div>
    </div>
      </div>
  );
}

/** Clickable stage icon in the file table */
// Pipeline step pill — shows status icon, label, file count and optional badge.
function PipelineStep({ num, label, status, done = 0, total = 0, color, badge, extra }) {
  const ICONS = {
    completed: 'check_circle',
    partial:   'pending',
    pending:   'radio_button_unchecked',
    ready:     'rocket_launch',
    processing:'progress_activity',
    failed:    'error',
  };
  const isDone   = status === 'completed';
  const isReady  = status === 'ready';
  const isPart   = status === 'partial';
  const isPending= status === 'pending';
  const fillBg   = isDone ? `${color}22` : (isPart || isReady ? `${color}14` : 'transparent');
  const textCol  = isDone || isPart || isReady ? color : '#919A9B';
  const borderCol= isDone || isPart || isReady ? color : 'rgba(255,255,255,0.1)';
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
      style={{ background: fillBg, borderColor: borderCol }}
      title={`${label}: ${status} ${total > 0 ? `· ${done}/${total} files` : ''}`}
    >
      <span
        className={`material-symbols-outlined text-[15px] ${status === 'processing' ? 'animate-spin' : ''}`}
        style={{ color: textCol }}
      >
        {ICONS[status] || 'radio_button_unchecked'}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[8px] uppercase font-bold opacity-70" style={{ color: textCol }}>Stage {num}</span>
        <span className="text-[11px] font-bold" style={{ color: textCol }}>{label}</span>
      </span>
      {total > 0 && (
        <span className="text-[10px] font-mono font-bold" style={{ color: textCol }}>
          {done}/{total}
        </span>
      )}
      {badge && (
        <span
          className="text-[8px] font-bold uppercase px-1 py-0.5 rounded"
          style={{ background: color, color: '#0D1F17' }}
        >
          {badge}
        </span>
      )}
      {extra && (
        <span className="text-[9px] opacity-80" style={{ color: textCol }}>{extra}</span>
      )}
      {isDone   && <span className="text-[9px] font-bold" style={{ color }}>✓</span>}
      {isReady  && <span className="text-[9px] font-bold" style={{ color }}>READY</span>}
      {isPending && !isPart && <span className="text-[9px] text-md-on-surface-variant/70 italic">waiting</span>}
    </div>
  );
}

function PipelineConnector() {
  return (
    <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant/40">arrow_forward</span>
  );
}

function StageButton({ available, active, onClick }) {
  if (!available) {
    return (
      <span className="material-symbols-outlined text-[12px] text-md-on-surface-variant/30">
        radio_button_unchecked
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`material-symbols-outlined text-[14px] cursor-pointer transition-all hover:scale-125 ${
        active ? 'text-md-primary' : 'text-green-400 hover:text-md-primary'
      }`}
      title="Click to view output"
    >
      {active ? 'visibility' : 'check_circle'}
    </button>
  );
}

/** Viewer panel for raw/grouped/cleaned JSON output */
function StageOutputViewer({ batchId, file, stage, onClose, onChangeStage, onSendToReviewCandidates }) {
  const { data, isLoading, error } = useStageFile(batchId, file.id, stage);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'json'
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerOutcomeFilter, setLedgerOutcomeFilter] = useState('all');
  const [ledgerReasonFilter, setLedgerReasonFilter] = useState('all');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const ledgerLimit = 50;
  const inferOutcomeFromReason = useCallback((code = '') => {
    const c = String(code || '').toUpperCase();
    if (c.startsWith('REJECT_')) return 'rejected';
    if (c.startsWith('KEPT_')) return 'kept';
    if (c.startsWith('UNCERTAIN_')) return 'uncertain';
    return 'all';
  }, []);

  const stageLabels = { raw: 'Raw OCR', grouped: 'Grouped Words', cleaned: 'Cleaned Tags', review: 'Review Decisions' };
  const stageColors = { raw: '#60A5FA', grouped: '#F39C12', cleaned: '#3BE494', review: '#A855F7' };

  // Filter for classified data (tags/noise/uncertain toggle)
  const [classifyFilter, setClassifyFilter] = useState('tags'); // 'tags', 'noise', 'uncertain', 'all'

  // Extract items from stage data
  const items = useMemo(() => {
    if (!data?.data) return [];
    let list;
    if (stage === 'cleaned' && data.data.tags) {
      // Classified stage: tags/noise/uncertain arrays
      if (classifyFilter === 'tags') list = data.data.tags || [];
      else if (classifyFilter === 'noise') list = data.data.noise || [];
      else if (classifyFilter === 'uncertain') list = data.data.uncertain || [];
      else list = [...(data.data.tags || []), ...(data.data.uncertain || []), ...(data.data.noise || [])];
    } else {
      list = data.data.groups || data.data.words || [];
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(w => (w.text || '').toLowerCase().includes(term));
    }
    return list;
  }, [data, searchTerm, stage, classifyFilter]);

  // Stats
  const classifyStats = data?.data?.stats || null;
  const isClassified = stage === 'cleaned' && data?.data?.tags;
  const docMetadata = data?.data?.documentMetadata || null;
  const coverageReport = data?.data?.coverageReport || null;
  const stage2RejectedCandidates = useMemo(() => {
    const missing = Array.isArray(coverageReport?.missingFromCleaned) ? coverageReport.missingFromCleaned : [];
    const term = String(searchTerm || '').trim().toLowerCase();
    if (ledgerOutcomeFilter !== 'all' && ledgerOutcomeFilter !== 'rejected') return [];
    return missing
      .filter((m) => {
        const reason = String(m?.reason_code || m?.reason || 'unknown');
        if (ledgerReasonFilter !== 'all' && reason !== ledgerReasonFilter) return false;
        if (term && !String(m?.text || '').toLowerCase().includes(term)) return false;
        return true;
      })
      .map((m) => ({
        text: String(m?.text || '').toUpperCase(),
        type: m?.type || 'unknown',
        reason: m?.reason || m?.reason_code || 'unknown',
        reason_code: m?.reason_code || (m?.reason === 'ai_rejected' ? 'REJECT_AI_REJECTED' : 'REJECT_ASSEMBLY_CONFLICT'),
        position_pct: m?.position_pct || null,
        bbox: m?.bbox || null,
      }))
      .filter((m) => m.text);
  }, [coverageReport, searchTerm, ledgerReasonFilter, ledgerOutcomeFilter]);
  const ledgerReasonOptions = useMemo(() => Object.keys(coverageReport?.byReason || {}), [coverageReport]);
  const ledgerParams = useMemo(() => ({
    outcome: ledgerOutcomeFilter === 'all' ? null : ledgerOutcomeFilter,
    reason: ledgerReasonFilter === 'all' ? null : ledgerReasonFilter,
    limit: ledgerLimit,
    offset: ledgerOffset,
  }), [ledgerOutcomeFilter, ledgerReasonFilter, ledgerOffset]);
  const { data: ledgerData, isLoading: ledgerLoading, error: ledgerError } = useCandidateLedger(
    batchId,
    file.id,
    ledgerParams,
    isClassified && showLedger
  );
  const embeddedLedgerRows = useMemo(() => {
    const raw = Array.isArray(data?.data?.candidateLedger)
      ? data.data.candidateLedger
      : Array.isArray(coverageReport?.candidateLedger)
        ? coverageReport.candidateLedger
        : [];
    const normalizedRaw = raw.map((r, i) => ({
      id: r.id || r.candidate_id || `embedded_${i + 1}`,
      candidate_text_raw: r.candidate_text_raw || r.text || '',
      candidate_text_norm: r.candidate_text_norm || r.text || '',
      candidate_type: r.candidate_type || r.type || 'unknown',
      terminal_outcome: r.terminal_outcome || 'rejected',
      reason_code: r.reason_code || 'REJECT_ASSEMBLY_CONFLICT',
      confidence_final: r.confidence_final,
      source: r.source || 'structured',
    }));
    if (normalizedRaw.length > 0) return normalizedRaw;

    // Legacy/stale classified files may not include candidateLedger.
    // Build a synthetic fallback from visible coverage/tag buckets so filters stay usable.
    const synthetic = [];
    const tags = Array.isArray(data?.data?.tags) ? data.data.tags : [];
    const uncertain = Array.isArray(data?.data?.uncertain) ? data.data.uncertain : [];
    const missing = Array.isArray(coverageReport?.missingFromCleaned) ? coverageReport.missingFromCleaned : [];

    for (let i = 0; i < tags.length; i++) {
      const t = tags[i] || {};
      synthetic.push({
        id: `synth_keep_${i + 1}`,
        candidate_text_raw: t.text || '',
        candidate_text_norm: t.text || '',
        candidate_type: t.type || 'unknown',
        terminal_outcome: 'kept',
        reason_code: String(t.source || '').includes('deterministic') ? 'KEPT_DETERMINISTIC_STRONG' : 'KEPT_AI_CONFIRMED',
        confidence_final: t.confidence,
        source: t.source || 'classified_tag',
      });
    }
    for (let i = 0; i < uncertain.length; i++) {
      const u = uncertain[i] || {};
      synthetic.push({
        id: `synth_unc_${i + 1}`,
        candidate_text_raw: u.text || '',
        candidate_text_norm: u.text || '',
        candidate_type: u.type || 'unknown',
        terminal_outcome: 'uncertain',
        reason_code: 'UNCERTAIN_LOW_CONFIDENCE',
        confidence_final: u.confidence,
        source: u.source || 'classified_uncertain',
      });
    }
    for (let i = 0; i < missing.length; i++) {
      const m = missing[i] || {};
      synthetic.push({
        id: `synth_rej_${i + 1}`,
        candidate_text_raw: m.text || '',
        candidate_text_norm: m.text || '',
        candidate_type: m.type || 'unknown',
        terminal_outcome: 'rejected',
        reason_code: m.reason_code || (m.reason === 'ai_rejected' ? 'REJECT_AI_REJECTED' : 'REJECT_ASSEMBLY_CONFLICT'),
        confidence_final: null,
        source: m.source || 'coverage_missing',
      });
    }
    return synthetic;
  }, [data, coverageReport]);
  const filteredEmbeddedLedgerRows = useMemo(() => {
    let rows = embeddedLedgerRows;
    if (ledgerOutcomeFilter !== 'all') {
      rows = rows.filter((r) => String(r.terminal_outcome || '') === ledgerOutcomeFilter);
    }
    if (ledgerReasonFilter !== 'all') {
      rows = rows.filter((r) => String(r.reason_code || '') === ledgerReasonFilter);
    }
    return rows;
  }, [embeddedLedgerRows, ledgerOutcomeFilter, ledgerReasonFilter]);
  const useEmbeddedLedgerFallback = !ledgerLoading && !ledgerError &&
    (Number(ledgerData?.total || 0) === 0) &&
    filteredEmbeddedLedgerRows.length > 0;
  const activeLedgerRows = useMemo(() => {
    if (useEmbeddedLedgerFallback) {
      return filteredEmbeddedLedgerRows.slice(ledgerOffset, ledgerOffset + ledgerLimit);
    }
    return ledgerData?.items || [];
  }, [useEmbeddedLedgerFallback, filteredEmbeddedLedgerRows, ledgerOffset, ledgerLimit, ledgerData]);
  const activeLedgerTotal = useEmbeddedLedgerFallback
    ? filteredEmbeddedLedgerRows.length
    : Number(ledgerData?.total || 0);
  useEffect(() => {
    setLedgerOffset(0);
  }, [ledgerOutcomeFilter, ledgerReasonFilter, file.id, stage]);
  useEffect(() => {
    if (!isClassified) setShowLedger(false);
  }, [isClassified]);

  return (
    <div className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden bg-md-surface-container/30">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-md-surface-container-high/40 border-b border-md-outline-variant/10">
        <span className="material-symbols-outlined text-[16px]" style={{ color: stageColors[stage] }}>
          {stage === 'raw' ? 'document_scanner' : stage === 'grouped' ? 'group_work' : 'auto_fix_high'}
        </span>
        <span className="text-label-sm font-bold text-md-on-surface flex-1">
          {stageLabels[stage]} — {file.filename}
        </span>

        {/* Stage tabs */}
        <div className="flex gap-1">
          {[
            { key: 'raw', label: 'Raw OCR', fileKey: 'rawOutputKey' },
            { key: 'cleaned', label: 'AI Classified', fileKey: 'cleanedOutputKey' },
            { key: 'review', label: 'Review', fileKey: 'reviewOutputKey' },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => onChangeStage(s.key)}
              disabled={!file[s.fileKey]}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${
                stage === s.key
                  ? 'bg-md-primary/20 text-md-primary'
                  : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => setViewMode('table')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${viewMode === 'table' ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant'}`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('json')}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${viewMode === 'json' ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant'}`}
          >
            JSON
          </button>
        </div>

        {/* Download button */}
        <a
          href={getStageFileDownloadUrl(batchId, file.id, stage)}
          download
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold text-md-primary hover:bg-md-primary/10 transition-colors"
          title="Download JSON file"
        >
          <span className="material-symbols-outlined text-[12px]">download</span>
          Download
        </a>

        <button onClick={onClose} className="text-md-on-surface-variant hover:text-md-on-surface">
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      {/* Search bar */}
      <div className="px-4 py-2 border-b border-md-outline-variant/10">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search words..."
            className="flex-1 bg-transparent text-body-sm text-md-on-surface outline-none placeholder:text-md-on-surface-variant/50"
          />
          {data?.data && (
            <span className="text-[10px] text-md-on-surface-variant">
              {items.length} {isClassified ? classifyFilter : (stage === 'raw' ? 'words' : 'items')}
              {classifyStats && ` · ${classifyStats.totalWords} words → ${classifyStats.tagsFound} tags`}
              {data.data.provider && ` · ${data.data.provider}`}
              {data.data.model && ` · ${data.data.model}`}
              {(data.data.extractedAt || data.data.classifiedAt) && ` · ${new Date(data.data.extractedAt || data.data.classifiedAt).toLocaleString()}`}
            </span>
          )}
        </div>
      </div>

      {/* Classification filter tabs (only for classified stage) */}
      {isClassified && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-md-outline-variant/10 bg-md-surface-container/20">
          {[
            { key: 'tags', label: 'Tags', count: data.data.tags?.length || 0, color: '#3BE494' },
            { key: 'noise', label: 'Noise', count: data.data.noise?.length || 0, color: '#919A9B' },
            { key: 'uncertain', label: 'Uncertain', count: data.data.uncertain?.length || 0, color: '#F39C12' },
            { key: 'all', label: 'All', count: (data.data.tags?.length || 0) + (data.data.noise?.length || 0) + (data.data.uncertain?.length || 0), color: '#60A5FA' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setClassifyFilter(f.key)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                classifyFilter === f.key ? 'bg-md-primary/15 text-md-primary' : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
              }`}
            >
              <span className="font-bold" style={{ color: f.color }}>{f.count}</span>
              {f.label}
            </button>
          ))}

          {/* Type breakdown */}
          <div className="flex-1" />
          {classifyStats && (
            <div className="flex gap-3 text-[10px]">
              <span><span className="font-bold text-blue-400">{classifyStats.equipmentCount}</span> Equipment</span>
              <span><span className="font-bold text-amber-400">{classifyStats.instrumentCount}</span> Instruments</span>
              <span><span className="font-bold text-green-400">{classifyStats.lineCount}</span> Lines</span>
            </div>
          )}
        </div>
      )}
      {isClassified && docMetadata && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-md-outline-variant/10 bg-md-surface-container/10 text-[10px] flex-wrap">
          <span className="text-md-on-surface-variant font-semibold">Doc metadata:</span>
          {docMetadata.drawingNumber && <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Drawing {docMetadata.drawingNumber}</span>}
          {docMetadata.revision && <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Rev {docMetadata.revision}</span>}
          {docMetadata.revisionDate && <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Rev Date {docMetadata.revisionDate}</span>}
          {docMetadata.latestRevisionDate && <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Latest Rev {docMetadata.latestRevisionDate}</span>}
          {docMetadata.fileName && <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">File {docMetadata.fileName}</span>}
        </div>
      )}
      {isClassified && coverageReport && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-md-outline-variant/10 bg-md-surface-container/10 text-[10px] flex-wrap">
          <span className="text-md-on-surface-variant font-semibold">Coverage:</span>
          <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Universe {(coverageReport.candidateUniverseCount ?? coverageReport.rawStructuredCandidateCount) || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Kept {(coverageReport.keptCount ?? coverageReport.retainedStructuredCount) || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Uncertain {(coverageReport.uncertainCount ?? coverageReport.uncertainStructuredCount) || 0}</span>
          <span className="px-1.5 py-0.5 rounded bg-md-on-surface/5">Rejected {(coverageReport.rejectedCount ?? coverageReport.missingStructuredCount) || 0}</span>
          <span className={`px-1.5 py-0.5 rounded ${(coverageReport.unexplainedDrops || 0) > 0 ? 'bg-[#E74C3C]/15 text-[#E74C3C]' : 'bg-md-on-surface/5'}`}>
            Unexplained {coverageReport.unexplainedDrops || 0}
          </span>
          {coverageReport.byReason && Object.entries(coverageReport.byReason).slice(0, 6).map(([code, count]) => (
            <button
              key={code}
              onClick={() => {
                setShowLedger(true);
                setLedgerReasonFilter(code);
                setLedgerOutcomeFilter(inferOutcomeFromReason(code));
                setViewMode('table');
              }}
              className="px-1.5 py-0.5 rounded bg-[#A855F7]/12 text-[#D8B4FE] hover:bg-[#A855F7]/22"
              title={`Open candidate ledger filtered by ${code}`}
            >
              {code} {count}
            </button>
          ))}
          <span className="flex-1" />
          <button
            onClick={() => setShowLedger(v => !v)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold ${showLedger ? 'bg-[#A855F7]/22 text-[#D8B4FE]' : 'bg-md-on-surface/8 text-md-on-surface-variant hover:bg-md-on-surface/12'}`}
            title="Toggle persisted candidate ledger drilldown"
          >
            {showLedger ? 'Hide ledger' : 'Show ledger'}
          </button>
        </div>
      )}
      {isClassified && showLedger && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-md-outline-variant/10 bg-[#A855F7]/6 text-[10px] flex-wrap">
          <span className="font-semibold text-md-on-surface">Ledger filters</span>
          <select
            value={ledgerOutcomeFilter}
            onChange={(e) => setLedgerOutcomeFilter(e.target.value)}
            className="px-1.5 py-0.5 bg-md-surface rounded border border-md-outline-variant/30 text-[10px]"
          >
            <option value="all">Outcome: all</option>
            <option value="kept">Outcome: kept</option>
            <option value="uncertain">Outcome: uncertain</option>
            <option value="rejected">Outcome: rejected</option>
          </select>
          <select
            value={ledgerReasonFilter}
            onChange={(e) => setLedgerReasonFilter(e.target.value)}
            className="px-1.5 py-0.5 bg-md-surface rounded border border-md-outline-variant/30 text-[10px]"
          >
            <option value="all">Reason: all</option>
            {ledgerReasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          {typeof onSendToReviewCandidates === 'function' && (
            <button
              onClick={() => onSendToReviewCandidates(stage2RejectedCandidates)}
              disabled={stage2RejectedCandidates.length === 0}
              className="px-2 py-0.5 rounded bg-[#3BE494]/15 text-[#3BE494] disabled:opacity-30"
              title="Send filtered rejected candidates directly to Stage 3 review queue"
            >
              Send Rejected -&gt; Review ({stage2RejectedCandidates.length})
            </button>
          )}
          <span className="flex-1" />
          <span className="text-md-on-surface-variant">
            {ledgerLoading ? 'Loading ledger…' : `Rows ${activeLedgerTotal > 0 ? ledgerOffset + 1 : 0}-${Math.min((ledgerOffset + ledgerLimit), ledgerOffset + activeLedgerRows.length)} / ${activeLedgerTotal}`}
          </span>
          <button
            onClick={() => setLedgerOffset(o => Math.max(0, o - ledgerLimit))}
            disabled={ledgerOffset <= 0}
            className="px-1.5 py-0.5 rounded bg-md-on-surface/8 disabled:opacity-30"
          >
            Prev
          </button>
          <button
            onClick={() => setLedgerOffset(o => o + ledgerLimit)}
            disabled={(ledgerOffset + ledgerLimit) >= activeLedgerTotal}
            className="px-1.5 py-0.5 rounded bg-md-on-surface/8 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}

      {/* Content */}
      <div className="max-h-96 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-md-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
            Loading {stage} output...
          </div>
        )}

        {error && (
          <div className="px-4 py-4 text-body-sm text-red-400">
            Failed to load: {error.message}
          </div>
        )}

        {data && viewMode === 'table' && showLedger && isClassified && (
          <>
            {ledgerError && (
              <div className="px-4 py-3 text-[11px] text-red-400">Ledger load failed: {ledgerError.message}</div>
            )}
            {!ledgerError && (
              <>
                {useEmbeddedLedgerFallback && (
                  <div className="px-3 py-1.5 text-[10px] text-[#FDE68A] bg-[#F59E0B]/10 border-b border-md-outline-variant/10">
                    Using embedded ledger fallback (persisted DB ledger not available for this file).
                  </div>
                )}
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0">
                    <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/50">
                      <th className="px-3 py-1.5 w-8">#</th>
                      <th className="px-3 py-1.5">Text</th>
                      <th className="px-3 py-1.5">Type</th>
                      <th className="px-3 py-1.5">Outcome</th>
                      <th className="px-3 py-1.5">Reason Code</th>
                      <th className="px-3 py-1.5 text-center">Confidence</th>
                      <th className="px-3 py-1.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLedgerRows.map((r, i) => (
                      <tr key={r.id || `${r.candidate_text_norm}-${i}`} className="border-b border-md-outline-variant/5 hover:bg-md-on-surface/3">
                        <td className="px-3 py-1 text-md-on-surface-variant">{ledgerOffset + i + 1}</td>
                        <td className="px-3 py-1 font-mono text-md-on-surface">{r.candidate_text_norm || r.candidate_text_raw}</td>
                        <td className="px-3 py-1 uppercase text-[10px]">{r.candidate_type || 'unknown'}</td>
                        <td className="px-3 py-1 uppercase text-[10px]">{r.terminal_outcome}</td>
                        <td className="px-3 py-1 text-[10px] text-[#D8B4FE]">{r.reason_code}</td>
                        <td className="px-3 py-1 text-center">{Number.isFinite(Number(r.confidence_final)) ? `${Math.round(Number(r.confidence_final) * 100)}%` : '—'}</td>
                        <td className="px-3 py-1 text-[10px] text-md-on-surface-variant">{r.source || '—'}</td>
                      </tr>
                    ))}
                    {!ledgerLoading && activeLedgerRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-md-on-surface-variant">No ledger rows for current filters</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {data && viewMode === 'table' && (!showLedger || !isClassified) && (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0">
              <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/50">
                <th className="px-3 py-1.5 w-8">#</th>
                <th className="px-3 py-1.5">Text</th>
                {isClassified && <th className="px-3 py-1.5">Type</th>}
                <th className="px-3 py-1.5 text-center">Confidence</th>
                {isClassified && <th className="px-3 py-1.5">Reason</th>}
                <th className="px-3 py-1.5 text-center">Position</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w, i) => {
                const typeColors = { equipment: '#60A5FA', instrument: '#F39C12', line: '#3BE494' };
                return (
                  <tr key={i} className="border-b border-md-outline-variant/5 hover:bg-md-on-surface/3">
                    <td className="px-3 py-1 text-md-on-surface-variant">{i + 1}</td>
                    <td className="px-3 py-1 font-mono text-md-on-surface font-semibold">{w.text}</td>
                    {isClassified && (
                      <td className="px-3 py-1">
                        {w.type && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
                            style={{ background: `${typeColors[w.type] || '#919A9B'}18`, color: typeColors[w.type] || '#919A9B' }}>
                            {w.subType || w.type}
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1 text-center">
                      {(() => {
                        const c = Number(w.confidence);
                        if (!Number.isFinite(c)) return '—';
                        return (
                          <span className={c > 0.9 ? 'text-green-400' : c > 0.7 ? 'text-yellow-400' : 'text-red-400'}>
                            {Math.round(c * 100)}%
                          </span>
                        );
                      })()}
                    </td>
                    {isClassified && (
                      <td className="px-3 py-1 text-[10px] text-md-on-surface-variant max-w-[200px] truncate" title={w.reason}>
                        {w.reason || '—'}
                      </td>
                    )}
                    <td className="px-3 py-1 text-center text-md-on-surface-variant text-[10px]">
                      {w.position_pct ? `${w.position_pct.x_pct.toFixed(1)}%, ${w.position_pct.y_pct.toFixed(1)}%` :
                       w.boundingBox ? `${w.boundingBox.minX}, ${w.boundingBox.minY}` :
                       w.x != null && w.y != null ? `${Math.round(w.x)}, ${Math.round(w.y)}` :
                       w.vertices ? `${w.vertices[0]?.x || 0}, ${w.vertices[0]?.y || 0}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {data && viewMode === 'json' && (
          <pre className="px-4 py-3 text-[10px] font-mono text-md-on-surface whitespace-pre-wrap break-all leading-relaxed">
            {JSON.stringify(data.data, null, 2)}
          </pre>
        )}
      </div>

      {/* Footer with metadata */}
      {data?.data && (
        <div className="px-4 py-2 border-t border-md-outline-variant/10 flex items-center gap-3 text-[10px] text-md-on-surface-variant">
          <span>Page: {data.data.pageWidth || '?'} × {data.data.pageHeight || '?'} px</span>
          <span>Storage: {data.storageKey}</span>
        </div>
      )}
    </div>
  );
}

/** Pipeline progress steps (used in review panel) */
function StagePipeline({ batch, batchDetail }) {
  return (
    <div className="flex items-center gap-1 px-3 py-2.5 rounded-md bg-md-surface-container/40 border border-md-outline-variant/10">
      {STAGES.map((stage, i) => {
        const status = batchDetail[stage.key] || batch[stage.key] || 'pending';
        const stageInfo = STAGE_STATUS[status] || STAGE_STATUS.pending;
        const isActive = status === 'processing';
        return (
          <div key={stage.key} className="flex items-center gap-1">
            {i > 0 && (
              <div className="w-8 h-0.5 rounded-full mx-1"
                style={{ background: status !== 'pending' ? stageInfo.color : '#919A9B30' }} />
            )}
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${isActive ? 'ring-1' : ''}`}
              style={{
                background: isActive ? `${stageInfo.color}15` : status !== 'pending' ? `${stageInfo.color}08` : 'transparent',
                ringColor: isActive ? stageInfo.color : undefined,
              }}>
              <span className={`material-symbols-outlined text-[14px] ${isActive ? 'animate-spin' : ''}`}
                style={{ color: stageInfo.color }}>
                {stageInfo.icon}
              </span>
              <div>
                <div className="text-[11px] font-bold" style={{ color: stageInfo.color }}>
                  {stage.num}. {stage.label}
                </div>
                <div className="text-[9px] text-md-on-surface-variant">{stage.description}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { StagePipeline };
