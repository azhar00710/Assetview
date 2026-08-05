import { useCallback, useEffect, useMemo, useState } from 'react';
import AIConfidenceSlider from './AIConfidenceSlider';
import DetectionReviewOverlay from './DetectionReviewOverlay';
import BatchProgressPanel from './BatchProgressPanel';
import { useAiAnnotate, useAiAnnotateAccept, useAiModels, useAiBatchAnnotate, useAiBatchProgress, useAiBatchResults, useAiBatchAccept, useAiBatchAcceptAll, useAiProfiles, useAiProfileSave } from '../../hooks/useAiAnnotate';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inferExampleLabel(annotation) {
  const explicit = String(annotation?.linkedEntityType || '').toLowerCase();
  if (['line', 'instrument', 'equipment'].includes(explicit)) return explicit;

  const tag = String(annotation?.text || '').toUpperCase();
  if (!tag) return 'equipment';
  if (/^\d+-[A-Z]+-\d+/.test(tag)) return 'line';
  if (/^[A-Z]{2,4}-\d+(-[A-Z0-9]+)*$/.test(tag) && !/^(TI|PI|FI|LI|PT|TT|FT|LT|PSV|XV|CV|FV|LV|TV)-/.test(tag)) return 'line';
  if (/^\d+(-[A-Z0-9]+){2,}$/.test(tag)) return 'line';
  if (/^(TI|PI|FI|LI|PT|TT|FT|LT|PSV|XV|CV|FV|LV|TV)[-\d]/.test(tag)) return 'instrument';
  return 'equipment';
}

function toExample(annotation) {
  const label = inferExampleLabel(annotation);
  const tag = annotation.text || '';
  const hasExplicitSize = annotation.wPct != null && annotation.hPct != null;

  if (hasExplicitSize) {
    return {
      bbox: {
        x_pct: clamp(Number(annotation.xPct || 0), 0, 100),
        y_pct: clamp(Number(annotation.yPct || 0), 0, 100),
        w_pct: clamp(Number(annotation.wPct), 0.1, 100),
        h_pct: clamp(Number(annotation.hPct), 0.1, 100),
      },
      label,
      tag,
    };
  }

  // Point annotation (e.g., line number placed without drawing a box).
  // Prompt boxes need to be large enough for the detector to extract visual features.
  // On a 14000px drawing resized to 1536px, 1% height ≈ 15px — barely visible.
  // Use generous sizing so the detector can see the text in context.
  const tagLen = (tag || '').length;
  const w = label === 'line'
    ? Math.max(3.5, Math.min(7.5, 1.8 + tagLen * 0.22))
    : (label === 'instrument' ? 2.5 : 3.0);
  const h = label === 'line' ? 1.6 : (label === 'instrument' ? 2.5 : 1.6);

  const cx = Number(annotation.xPct || 0);
  const cy = Number(annotation.yPct || 0);
  return {
    bbox: {
      x_pct: clamp(cx - w / 2, 0, 100),
      y_pct: clamp(cy - h / 2, 0, 100),
      w_pct: clamp(w, 0.1, 100),
      h_pct: clamp(h, 0.1, 100),
    },
    label,
    tag,
  };
}

/** Minimum detection box area as % of image to filter tiny noise boxes. */
const MIN_BOX_AREA_PCT = 0.01;

export default function AIAnnotateMode({
  pnidId,
  platformId,
  annotations = [],
  selectedAnnotationIds = [],
  onAiSuggestionsChange,
  pnidList = [],
  onNavigatePnid,
}) {
  const enabled = String(import.meta.env.VITE_AI_ANNOTATE_PILOT_ENABLED || '').toLowerCase() === 'true';
  const { data: modelStatus, isLoading: modelLoading } = useAiModels(platformId, enabled && !!pnidId);
  const runAnnotate = useAiAnnotate(pnidId);
  const acceptAnnotate = useAiAnnotateAccept(pnidId);
  const runBatch = useAiBatchAnnotate();
  // batchId is set after batch starts — hooks must be called unconditionally

  const [threshold, setThreshold] = useState(0.35);
  const [runPayload, setRunPayload] = useState(null);
  const [decisionMap, setDecisionMap] = useState({});
  const [highlightedIndex, setHighlightedIndex] = useState(null);
  const [showPanel, setShowPanel] = useState(false);

  // Batch state
  const [batchScope, setBatchScope] = useState('current'); // 'current' | 'all'
  const [batchId, setBatchId] = useState(null);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [batchReviewPnidId, setBatchReviewPnidId] = useState(null);
  const [batchDecisionMap, setBatchDecisionMap] = useState({}); // { pnidId: { detectionIndex: bool } }

  const { data: batchProgress } = useAiBatchProgress(batchId);
  const { data: batchDrawingResults } = useAiBatchResults(batchId, batchReviewPnidId);
  const batchAccept = useAiBatchAccept(batchId);
  const batchAcceptAll = useAiBatchAcceptAll(batchId);

  // Profile state
  const { data: profilesData } = useAiProfiles(platformId);
  const profileSave = useAiProfileSave(platformId);
  const [showProfileSave, setShowProfileSave] = useState(false);
  const [profileName, setProfileName] = useState('');

  const selectedSet = useMemo(() => new Set(selectedAnnotationIds || []), [selectedAnnotationIds]);
  const selectedExamples = useMemo(() => {
    return annotations
      .filter(a => selectedSet.has(a.id))
      .map(toExample)
      .slice(0, 10);
  }, [annotations, selectedSet]);

  // Infer category from majority of selected examples
  const inferredCategory = useMemo(() => {
    const counts = { line: 0, instrument: 0, equipment: 0 };
    selectedExamples.forEach(ex => { counts[ex.label] = (counts[ex.label] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'line';
  }, [selectedExamples]);

  const filteredDetections = useMemo(() => {
    const rows = (runPayload?.detections || [])
      .map((d, index) => ({
        index,
        tagText: d.tag_text,
        entityType: d.entity_type,
        confidence: Number(d.confidence || 0),
        bbox: d.bbox,
      }))
      .filter(d => d.confidence >= threshold)
      .filter(d => {
        const area = (d.bbox?.w_pct || 0) * (d.bbox?.h_pct || 0);
        if (!d.tagText && area < MIN_BOX_AREA_PCT) return false;
        // For line detections without OCR text, reject implausibly large/tall boxes.
        // This removes many empty-space and header-like false positives from visual-only runs.
        if (!d.tagText && d.entityType === 'line') {
          const h = Number(d.bbox?.h_pct || 0);
          if (area > 20 || h > 3.2) return false;
        }
        return true;
      });
    return rows;
  }, [runPayload, threshold]);

  const visibleDetectionIndexes = useMemo(() => {
    return new Set(filteredDetections.map(d => d.index));
  }, [filteredDetections]);

  const aiSuggestions = useMemo(() => {
    return filteredDetections
      .filter(d => decisionMap[d.index] !== false)
      .map(d => ({
        entityId: `ai-${d.index}`,
        entityType: d.entityType,
        tag: d.tagText,
        tier: d.confidence >= 0.85 ? 'auto' : 'ghost',
        suggestedXPct: d.bbox?.x_pct ?? 0,
        suggestedYPct: d.bbox?.y_pct ?? 0,
        suggestedWPct: d.bbox?.w_pct ?? 3,
        suggestedHPct: d.bbox?.h_pct ?? 2,
        _highlighted: d.index === highlightedIndex,
      }));
  }, [filteredDetections, decisionMap, highlightedIndex]);

  // Batch review: build suggestions from batch results for the reviewed drawing
  const batchReviewDetections = useMemo(() => {
    if (!batchDrawingResults?.detections) return [];
    return batchDrawingResults.detections
      .map((d, index) => ({
        index,
        tagText: d.tag_text,
        entityType: d.entity_type,
        confidence: Number(d.confidence || 0),
        bbox: d.bbox,
      }))
      .filter(d => d.confidence >= threshold)
      .filter(d => {
        const area = (d.bbox?.w_pct || 0) * (d.bbox?.h_pct || 0);
        if (!d.tagText && area < MIN_BOX_AREA_PCT) return false;
        return true;
      });
  }, [batchDrawingResults, threshold]);

  const batchReviewSuggestions = useMemo(() => {
    const decisions = batchDecisionMap[batchReviewPnidId] || {};
    return batchReviewDetections
      .filter(d => decisions[d.index] !== false)
      .map(d => ({
        entityId: `ai-batch-${d.index}`,
        entityType: d.entityType,
        tag: d.tagText,
        tier: d.confidence >= 0.85 ? 'auto' : 'ghost',
        suggestedXPct: d.bbox?.x_pct ?? 0,
        suggestedYPct: d.bbox?.y_pct ?? 0,
        suggestedWPct: d.bbox?.w_pct ?? 3,
        suggestedHPct: d.bbox?.h_pct ?? 2,
        _highlighted: d.index === highlightedIndex,
      }));
  }, [batchReviewDetections, batchDecisionMap, batchReviewPnidId, highlightedIndex]);

  const selectedCount = useMemo(() => {
    return filteredDetections.filter(d => decisionMap[d.index] !== false).length;
  }, [filteredDetections, decisionMap]);

  const runFindSimilar = async () => {
    if (!pnidId || selectedExamples.length === 0) return;
    console.log('[AIAnnotate] Examples sent to backend:', JSON.stringify(selectedExamples, null, 2));

    if (batchScope === 'all' && platformId) {
      // Batch mode: scan all platform drawings
      const result = await runBatch.mutateAsync({
        platformId,
        sourcePnidId: pnidId,
        examples: selectedExamples,
        category: inferredCategory,
        threshold,
      });
      setBatchId(result.batchId);
      setShowBatchPanel(true);
      setBatchReviewPnidId(null);
      setBatchDecisionMap({});
    } else {
      // Single drawing mode (existing behavior)
      const result = await runAnnotate.mutateAsync({ examples: selectedExamples, mode: 'few_shot' });
      setRunPayload(result);
      setDecisionMap({});
      setShowPanel(true);
    }
  };

  const canRunVisual = !!modelStatus?.models?.visualFewShot?.available;

  const applyAccepted = async () => {
    if (!runPayload) return;
    const accepted = runPayload.detections.map((_, index) => ({
      detection_index: index,
      rejected: !visibleDetectionIndexes.has(index)
        || decisionMap[index] === false
        || Number(runPayload.detections[index]?.confidence || 0) < threshold,
    }));
    await acceptAnnotate.mutateAsync({
      runId: runPayload.runId,
      detections: runPayload.detections,
      accepted,
    });
  };

  const applyBatchAccepted = async () => {
    if (!batchId || !batchReviewPnidId) return;
    const decisions = batchDecisionMap[batchReviewPnidId] || {};
    const decisionList = batchReviewDetections.map(d => ({
      pnidId: batchReviewPnidId,
      detectionIndex: d.index,
      accepted: decisions[d.index] !== false,
    }));
    await batchAccept.mutateAsync({ decisions: decisionList });
  };

  const applyBatchAcceptAll = async () => {
    if (!batchId) return;
    await batchAcceptAll.mutateAsync({ threshold });
  };

  const handleHighlight = useCallback((index) => {
    setHighlightedIndex(prev => prev === index ? null : index);
  }, []);

  const handleBatchDrawingSelect = useCallback((selectedPnidId) => {
    setBatchReviewPnidId(selectedPnidId);
    setShowBatchPanel(true);
    // Navigate the workspace to the selected drawing
    onNavigatePnid?.(selectedPnidId);
  }, [onNavigatePnid]);

  // Sync suggestions up to workspace viewer.
  useEffect(() => {
    if (batchReviewPnidId && batchReviewSuggestions.length > 0) {
      onAiSuggestionsChange?.(batchReviewSuggestions);
    } else {
      onAiSuggestionsChange?.(aiSuggestions);
    }
  }, [aiSuggestions, batchReviewSuggestions, batchReviewPnidId, onAiSuggestionsChange]);

  if (!enabled) {
    return (
      <div className="text-[10px] text-[#919A9B] px-2 py-1 border border-[#919A9B]/20 rounded">
        AI pilot disabled (`VITE_AI_ANNOTATE_PILOT_ENABLED=true` required)
      </div>
    );
  }

  const hasResults = runPayload && filteredDetections.length > 0;
  const isBatchRunning = batchProgress && batchProgress.status === 'processing';
  const isBatchComplete = batchProgress && (batchProgress.status === 'completed' || batchProgress.status === 'failed');
  const batchTotalDetections = isBatchComplete
    ? (batchProgress.results || []).reduce((sum, r) => sum + (r.detectionCount || 0), 0)
    : 0;
  const isPending = runAnnotate.isPending || runBatch.isPending;

  return (
    <div className="relative flex items-center gap-2">
      <div className="text-[10px] text-[#3BE494] font-semibold whitespace-nowrap">AI Annotate</div>
      <AIConfidenceSlider value={threshold} onChange={setThreshold} />

      {/* Scope selector */}
      <div className="flex items-center bg-[#0D1F17] rounded p-0.5 gap-0.5">
        <button
          onClick={() => setBatchScope('current')}
          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors ${
            batchScope === 'current' ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
          }`}
          title="Search current drawing only"
        >
          This Drawing
        </button>
        <button
          onClick={() => setBatchScope('all')}
          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors ${
            batchScope === 'all' ? 'bg-[#8AB4FF]/20 text-[#8AB4FF]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
          }`}
          title={`Search all ${pnidList.length || '?'} drawings in platform`}
        >
          All Drawings{pnidList.length ? ` (${pnidList.length})` : ''}
        </button>
      </div>

      <button
        onClick={runFindSimilar}
        disabled={isPending || selectedExamples.length === 0 || !canRunVisual}
        className="px-2 py-1 rounded text-[10px] font-semibold bg-[#3BE494]/20 text-[#3BE494] disabled:opacity-40 whitespace-nowrap"
        title={canRunVisual ? 'Select 3-5 annotation boxes first' : 'Configure Visual Detector in OCR Pipeline Settings'}
      >
        {isPending
          ? (batchScope === 'all' ? 'Starting batch...' : 'Finding...')
          : `Find Similar (${selectedExamples.length})`
        }
      </button>

      {/* Single-drawing accept */}
      {batchScope === 'current' && (
        <button
          onClick={applyAccepted}
          disabled={acceptAnnotate.isPending || !runPayload}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#8AB4FF]/20 text-[#8AB4FF] disabled:opacity-40 whitespace-nowrap"
        >
          {acceptAnnotate.isPending ? 'Applying...' : `Accept Selected (${selectedCount})`}
        </button>
      )}

      {/* Batch accept all drawings */}
      {batchScope === 'all' && isBatchComplete && batchTotalDetections > 0 && (
        <button
          onClick={applyBatchAcceptAll}
          disabled={batchAcceptAll.isPending}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#3BE494]/20 text-[#3BE494] disabled:opacity-40 whitespace-nowrap"
        >
          {batchAcceptAll.isPending ? 'Applying all...' : `Accept All (${batchTotalDetections})`}
        </button>
      )}

      {/* Batch accept for reviewed drawing */}
      {batchScope === 'all' && batchReviewPnidId && (
        <button
          onClick={applyBatchAccepted}
          disabled={batchAccept.isPending || !batchReviewPnidId}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#8AB4FF]/20 text-[#8AB4FF] disabled:opacity-40 whitespace-nowrap"
        >
          {batchAccept.isPending ? 'Applying...' : `Accept Drawing (${batchReviewDetections.filter(d => (batchDecisionMap[batchReviewPnidId] || {})[d.index] !== false).length})`}
        </button>
      )}

      {/* Single-drawing panel toggle */}
      {hasResults && batchScope === 'current' && (
        <button
          onClick={() => setShowPanel(prev => !prev)}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#919A9B]/20 text-[#D3DFE2] whitespace-nowrap"
          title="Toggle detection review panel"
        >
          {showPanel ? 'Hide' : 'Show'} ({filteredDetections.length})
        </button>
      )}

      {/* Batch progress/results toggle */}
      {batchId && batchScope === 'all' && (
        <button
          onClick={() => setShowBatchPanel(prev => !prev)}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#919A9B]/20 text-[#D3DFE2] whitespace-nowrap"
          title="Toggle batch results panel"
        >
          {isBatchRunning
            ? `Scanning ${batchProgress.processed}/${batchProgress.totalDrawings}...`
            : showBatchPanel ? 'Hide Batch' : `Batch (${batchTotalDetections})`
          }
        </button>
      )}

      {/* Floating single-drawing panel */}
      {showPanel && hasResults && batchScope === 'current' && (
        <div className="absolute top-full right-0 mt-1 z-50 w-96 shadow-lg">
          <DetectionReviewOverlay
            detections={filteredDetections}
            decisionMap={decisionMap}
            onToggleAccept={toggleAccept}
            highlightedIndex={highlightedIndex}
            onHighlight={handleHighlight}
          />
        </div>
      )}

      {/* Floating batch panel */}
      {showBatchPanel && batchId && batchScope === 'all' && (
        <div className="absolute top-full right-0 mt-1 z-50 w-[480px] shadow-lg">
          <BatchProgressPanel
            batchProgress={batchProgress}
            batchReviewPnidId={batchReviewPnidId}
            batchReviewDetections={batchReviewDetections}
            batchDecisionMap={batchDecisionMap[batchReviewPnidId] || {}}
            highlightedIndex={highlightedIndex}
            onSelectDrawing={handleBatchDrawingSelect}
            onToggleBatchAccept={toggleBatchAccept}
            onHighlight={handleHighlight}
            threshold={threshold}
          />
        </div>
      )}

      {/* Status text */}
      <div className="text-[10px] text-[#919A9B] whitespace-nowrap">
        {modelLoading
          ? 'Checking models...'
          : isBatchRunning
            ? `Scanning drawing ${batchProgress.processed + 1}/${batchProgress.totalDrawings}...`
            : runPayload
              ? `${filteredDetections.length} found`
              : isBatchComplete
                ? `${batchTotalDetections} found across ${batchProgress.totalDrawings} drawings`
                : modelStatus?.pilotEnabled
                  ? (canRunVisual ? 'Visual few-shot ready' : 'Visual detector not configured')
                  : 'Pilot API unavailable'}
      </div>

      {acceptAnnotate.isSuccess && (
        <div className="text-[10px] text-[#3BE494] whitespace-nowrap">
          Applied! Select more examples to find missed items.
        </div>
      )}
      {batchAccept.isSuccess && (
        <div className="text-[10px] text-[#3BE494] whitespace-nowrap">
          Applied! Select next drawing to review.
        </div>
      )}
      {batchAcceptAll.isSuccess && (
        <div className="text-[10px] text-[#3BE494] whitespace-nowrap">
          All detections applied across all drawings!
        </div>
      )}
      {batchAcceptAll.error && (
        <div className="text-[10px] text-[#FF897A] max-w-72 truncate" title={String(batchAcceptAll.error?.message || '')}>
          Accept all failed: {String(batchAcceptAll.error?.message || '')}
        </div>
      )}
      {(runAnnotate.error || runBatch.error) && (
        <div className="text-[10px] text-[#FF897A] max-w-72 truncate" title={String(runAnnotate.error?.message || runBatch.error?.message || '')}>
          {String(runAnnotate.error?.message || runBatch.error?.message || 'AI annotate failed')}
        </div>
      )}

      {/* Profile save button — appears after batch completion */}
      {isBatchComplete && selectedExamples.length > 0 && (
        <button
          onClick={() => setShowProfileSave(prev => !prev)}
          className="px-2 py-1 rounded text-[10px] font-semibold bg-[#F39C12]/20 text-[#F39C12] whitespace-nowrap"
          title="Save examples as a reusable detection profile"
        >
          Save Profile
        </button>
      )}

      {/* Profile save dialog */}
      {showProfileSave && (
        <div className="absolute top-full right-0 mt-1 z-50 w-72 bg-[#0D1F17] border border-[#919A9B]/20 rounded p-3 shadow-lg">
          <div className="text-[11px] font-semibold text-[#D3DFE2] mb-2">Save Detection Profile</div>
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Profile name (e.g., piping numbers)"
            className="w-full px-2 py-1 rounded text-[11px] bg-[#111D14] border border-[#919A9B]/20 text-[#D3DFE2] placeholder-[#919A9B]/50 mb-2"
          />
          <div className="text-[9px] text-[#919A9B] mb-2">
            Category: {inferredCategory} | {selectedExamples.length} examples
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (!profileName.trim()) return;
                await profileSave.mutateAsync({
                  name: profileName.trim(),
                  category: inferredCategory,
                  examples: selectedExamples,
                });
                setShowProfileSave(false);
                setProfileName('');
              }}
              disabled={!profileName.trim() || profileSave.isPending}
              className="px-2 py-1 rounded text-[10px] font-semibold bg-[#3BE494]/20 text-[#3BE494] disabled:opacity-40"
            >
              {profileSave.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setShowProfileSave(false)}
              className="px-2 py-1 rounded text-[10px] text-[#919A9B] hover:text-[#D3DFE2]"
            >
              Cancel
            </button>
          </div>
          {profileSave.isSuccess && <div className="text-[9px] text-[#3BE494] mt-1">Profile saved!</div>}
        </div>
      )}

      {/* Saved profiles quick-start */}
      {profilesData?.profiles?.length > 0 && !runPayload && !batchId && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#919A9B]">Profiles:</span>
          {profilesData.profiles.slice(0, 3).map(p => (
            <button
              key={p.id}
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[#F39C12]/10 text-[#F39C12] hover:bg-[#F39C12]/20 whitespace-nowrap"
              title={`${p.category} | ${p.total_accepted} accepted, ${p.total_rejected} rejected`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  function toggleAccept(index) {
    setDecisionMap(prev => ({ ...prev, [index]: prev[index] === false ? true : false }));
  }

  function toggleBatchAccept(index) {
    const pid = batchReviewPnidId;
    if (!pid) return;
    setBatchDecisionMap(prev => ({
      ...prev,
      [pid]: { ...(prev[pid] || {}), [index]: (prev[pid] || {})[index] === false ? true : false },
    }));
  }
}
