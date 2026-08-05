import { useState } from 'react';
import { md } from '../../lib/theme';
import { useOcrBatches, useOcrBatchDetail, useCancelBatch, useDeleteBatch, useClearFailedBatches, useResetStage2, useRerunOcr } from '../../hooks/useOcrPipelineV2';

const BATCH_STATUS = {
  pending:    { label: 'Pending',    color: '#919A9B', icon: 'schedule' },
  processing: { label: 'Processing', color: '#F39C12', icon: 'hourglass_top' },
  completed:  { label: 'Completed',  color: '#3BE494', icon: 'check_circle' },
  partial:    { label: 'Partial',    color: '#E67E22', icon: 'warning' },
  failed:     { label: 'Failed',     color: '#E74C3C', icon: 'error' },
};

const STAGE_STATUS = {
  pending:    { color: '#919A9B', icon: 'radio_button_unchecked' },
  processing: { color: '#F39C12', icon: 'progress_activity' },
  completed:  { color: '#3BE494', icon: 'check_circle' },
  partial:    { color: '#E67E22', icon: 'warning' },
  failed:     { color: '#E74C3C', icon: 'error' },
};

const STAGES = [
  { key: 'stage1Status', label: 'Extract', num: 1 },
  { key: 'stage2Status', label: 'AI Classify', num: 2 },
  { key: 'stage3Status', label: 'Import', num: 3 },
];

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
 * ProcessingHistory — Simplified batch list (step 3).
 * Shows batch cards with status, file list, and a "Review Results" button
 * that navigates to the BatchReviewPanel (step 4).
 *
 * Heavy actions (export, reprocessing, annotation) have been moved to BatchReviewPanel.
 */
export default function ProcessingHistory({ platformId, platformCode, onAddMore, onAnalyze, onReview }) {
  const { data: batches, isLoading } = useOcrBatches(platformId);
  const [expandedBatch, setExpandedBatch] = useState(null);
  const clearFailed = useClearFailedBatches();
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const failedCount = (batches || []).filter(b => b.status === 'failed' || b.status === 'processing' || b.status === 'pending').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-md-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
        Loading history...
      </div>
    );
  }

  if (!batches?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-md-on-surface-variant">
        <span className="material-symbols-outlined text-[40px] opacity-30 mb-2">history</span>
        <span className="text-body-md">No processing history</span>
        <span className="text-body-sm opacity-60 mt-1">Select files in the previous step to start OCR processing</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-4 pt-3 pb-2 flex items-center gap-3">
        <span className="text-label-sm text-md-on-surface-variant font-bold uppercase flex-1">
          {batches.length} batch{batches.length !== 1 ? 'es' : ''} processed for {platformCode}
        </span>

        {/* Clear All Failed/Stale button */}
        {failedCount > 0 && (
          <button
            onClick={() => {
              if (confirmClearAll) {
                clearFailed.mutate({ platformId });
                setConfirmClearAll(false);
              } else {
                setConfirmClearAll(true);
                setTimeout(() => setConfirmClearAll(false), 4000);
              }
            }}
            disabled={clearFailed.isPending}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
              confirmClearAll
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-md-on-surface/5 text-md-on-surface-variant hover:text-red-400 hover:bg-red-500/10'
            }`}
          >
            <span className="material-symbols-outlined text-[12px]">
              {clearFailed.isPending ? 'progress_activity' : 'delete_sweep'}
            </span>
            {confirmClearAll ? `Confirm — Clear ${failedCount} batch${failedCount !== 1 ? 'es' : ''}` : 'Clear Failed'}
          </button>
        )}
      </div>

      <div className="flex-1 px-4 space-y-2 pb-4">
        {batches.map(batch => (
          <BatchCard
            key={batch.id}
            batch={batch}
            platformId={platformId}
            isExpanded={expandedBatch === batch.id}
            onToggle={() => setExpandedBatch(expandedBatch === batch.id ? null : batch.id)}
            onAddMore={onAddMore}
            onReview={onReview}
          />
        ))}
      </div>
    </div>
  );
}

function BatchCard({ batch, platformId, isExpanded, onToggle, onAddMore, onReview }) {
  const statusInfo = BATCH_STATUS[batch.status] || BATCH_STATUS.pending;
  const { data: detail } = useOcrBatchDetail(isExpanded ? batch.id : null);
  const cancelBatch = useCancelBatch();
  const deleteBatch = useDeleteBatch();
  const resetStage2 = useResetStage2();
  const rerunOcr = useRerunOcr();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmResetStage2, setConfirmResetStage2] = useState(false);
  const [confirmRerun, setConfirmRerun] = useState(false);

  const s1 = batch.stage1Status || 'pending';
  const s2 = batch.stage2Status || 'pending';

  const progress = batch.totalFiles > 0
    ? Math.round(((batch.processedFiles || 0) / batch.totalFiles) * 100)
    : 0;

  const isProcessing = batch.status === 'processing' || batch.status === 'pending';
  const isComplete = batch.status === 'completed' || batch.status === 'partial';
  const isFailed = batch.status === 'failed';
  const canDelete = !isProcessing; // can delete completed, partial, or failed
  const canResetStage2 = (s1 === 'completed' || s1 === 'partial') &&
    (s2 === 'completed' || s2 === 'partial' || s2 === 'failed');
  const canRerunOcr = !isProcessing && (isFailed || s1 === 'failed' || (s1 === 'pending' && s2 === 'pending'));

  return (
    <div className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden transition-all">
      {/* Header — div role=button so we can nest the Stop/Cancel button inside
          without violating HTML's "no button-in-button" rule. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-md-on-surface/3 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-md-primary/40"
      >
        <span className="material-symbols-outlined text-[20px]" style={{ color: statusInfo.color }}>
          {statusInfo.icon}
        </span>

        <div className="flex-1 text-left min-w-0">
          <div className="text-body-sm font-bold text-md-on-surface truncate">{batch.batchName}</div>
          <div className="text-[10px] text-md-on-surface-variant flex items-center gap-2">
            <span>{timeAgo(batch.completedAt || batch.startedAt)} · {batch.totalFiles} file{batch.totalFiles !== 1 ? 's' : ''}</span>
            {batch.ocrProviderUsed && (
              <span className="px-1 py-0.5 rounded bg-md-on-surface/5 text-[9px] uppercase font-bold">
                {batch.ocrProviderUsed}
              </span>
            )}
          </div>
        </div>

        {/* Progress or status */}
        {isProcessing ? (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-md-on-surface/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: statusInfo.color }} />
            </div>
            <span className="text-[10px] text-md-on-surface-variant">{progress}%</span>
            <span className="material-symbols-outlined animate-spin text-[14px] text-amber-400">progress_activity</span>
            {/* Stop/Cancel button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirmCancel) {
                  cancelBatch.mutate({ batchId: batch.id });
                  setConfirmCancel(false);
                } else {
                  setConfirmCancel(true);
                  setTimeout(() => setConfirmCancel(false), 4000);
                }
              }}
              disabled={cancelBatch.isPending}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                confirmCancel
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-md-on-surface/5 text-md-on-surface-variant hover:text-red-400 hover:bg-red-500/10'
              }`}
              title={confirmCancel ? 'Click again to confirm' : 'Stop processing'}
            >
              <span className="material-symbols-outlined text-[12px]">
                {cancelBatch.isPending ? 'progress_activity' : 'stop_circle'}
              </span>
              {confirmCancel ? 'Confirm Stop' : 'Stop'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
              style={{ background: `${statusInfo.color}18`, color: statusInfo.color }}>
              {statusInfo.label}
            </span>
            {batch.passedToAnnotation && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-semibold">
                Annotated
              </span>
            )}
          </div>
        )}

        <span className={`material-symbols-outlined text-[16px] text-md-on-surface-variant transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </div>

      {/* Expanded detail — simplified: stages + stats + file list + review button */}
      {isExpanded && (
        <div className="border-t border-md-outline-variant/20 bg-md-surface-container/30">
          {/* Stage progress pipeline */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-md-outline-variant/10">
            {STAGES.map((stage, i) => {
              const status = batch[stage.key] || 'pending';
              const stageInfo = STAGE_STATUS[status] || STAGE_STATUS.pending;
              const isActive = status === 'processing';
              return (
                <div key={stage.key} className="flex items-center gap-1">
                  {i > 0 && (
                    <div className="w-6 h-0.5 rounded-full mx-0.5"
                      style={{ background: status !== 'pending' ? stageInfo.color : '#919A9B30' }} />
                  )}
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded"
                    style={{ background: isActive ? `${stageInfo.color}15` : 'transparent' }}>
                    <span className={`material-symbols-outlined text-[12px] ${isActive ? 'animate-spin' : ''}`}
                      style={{ color: stageInfo.color }}>
                      {stageInfo.icon}
                    </span>
                    <span className="text-[10px] font-semibold" style={{ color: stageInfo.color }}>
                      {stage.num}. {stage.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-md-outline-variant/10">
            {[
              { label: 'Total', value: batch.totalFiles, color: md.onSurface },
              { label: 'Processed', value: batch.processedFiles || 0, color: '#3BE494' },
              { label: 'Failed', value: batch.failedFiles || 0, color: batch.failedFiles > 0 ? '#E74C3C' : '#919A9B' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-title-sm font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-md-on-surface-variant">{s.label}</div>
              </div>
            ))}

            <div className="flex-1" />

            {/* Review Results — main CTA for completed batches */}
            {isComplete && onReview && (
              <button
                onClick={() => onReview(batch.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold bg-md-primary text-md-on-primary hover:bg-md-primary/90 transition-all"
              >
                <span className="material-symbols-outlined text-[14px]">analytics</span>
                Review Results
              </button>
            )}

            {/* Add more files */}
            <button
              onClick={() => onAddMore?.(batch.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold text-md-on-surface-variant hover:text-md-on-surface bg-md-on-surface/5 transition-colors"
            >
              <span className="material-symbols-outlined text-[12px]">add</span>
              Add Files
            </button>

            {canRerunOcr && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmRerun) {
                    rerunOcr.mutate({ batchId: batch.id, platformId });
                    setConfirmRerun(false);
                  } else {
                    setConfirmRerun(true);
                    setTimeout(() => setConfirmRerun(false), 4000);
                  }
                }}
                disabled={rerunOcr.isPending}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                  confirmRerun
                    ? 'bg-[#3BE494]/20 text-[#3BE494] hover:bg-[#3BE494]/30'
                    : 'bg-[#3BE494]/10 text-[#3BE494] hover:bg-[#3BE494]/20'
                }`}
                title={confirmRerun ? 'Click again to confirm OCR rerun' : 'Restart raw OCR extraction for this batch'}
              >
                <span className="material-symbols-outlined text-[12px]">
                  {rerunOcr.isPending ? 'progress_activity' : 'refresh'}
                </span>
                {confirmRerun ? 'Confirm Rerun OCR' : 'Rerun OCR'}
              </button>
            )}

            {canResetStage2 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmResetStage2) {
                    resetStage2.mutate({ batchId: batch.id, platformId });
                    setConfirmResetStage2(false);
                  } else {
                    setConfirmResetStage2(true);
                    setTimeout(() => setConfirmResetStage2(false), 4000);
                  }
                }}
                disabled={resetStage2.isPending}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                  confirmResetStage2
                    ? 'bg-[#A855F7]/20 text-[#A855F7] hover:bg-[#A855F7]/30'
                    : 'bg-[#A855F7]/10 text-[#A855F7] hover:bg-[#A855F7]/20'
                }`}
                title={confirmResetStage2 ? 'Click again to confirm Stage 2 reset' : 'Clear only AI classify + review outputs and keep raw OCR'}
              >
                <span className="material-symbols-outlined text-[12px]">
                  {resetStage2.isPending ? 'progress_activity' : 'restart_alt'}
                </span>
                {confirmResetStage2 ? 'Confirm Reset Stage 2' : 'Reset Stage 2'}
              </button>
            )}

            {/* Delete batch */}
            {canDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmDelete) {
                    deleteBatch.mutate({ batchId: batch.id });
                    setConfirmDelete(false);
                  } else {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 4000);
                  }
                }}
                disabled={deleteBatch.isPending}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                  confirmDelete
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'text-md-on-surface-variant hover:text-red-400 hover:bg-red-500/10'
                }`}
                title={confirmDelete ? 'Click again to confirm delete' : 'Delete this batch'}
              >
                <span className="material-symbols-outlined text-[12px]">
                  {deleteBatch.isPending ? 'progress_activity' : 'delete'}
                </span>
                {confirmDelete ? 'Confirm Delete' : 'Delete'}
              </button>
            )}
          </div>

          {/* File list */}
          {detail?.files && (
            <div className="max-h-60 overflow-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0">
                  <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/50">
                    <th className="px-3 py-1.5">Filename</th>
                    <th className="px-3 py-1.5">Drawing</th>
                    <th className="px-3 py-1.5 text-center">Words</th>
                    <th className="px-3 py-1.5 text-center">Raw OCR</th>
                    <th className="px-3 py-1.5 text-center">AI Classified</th>
                    <th className="px-3 py-1.5 text-center">Coords</th>
                    <th className="px-3 py-1.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.files.map(f => {
                    const fStatus = BATCH_STATUS[f.status] || BATCH_STATUS.pending;
                    return (
                      <tr key={f.id} className="border-b border-md-outline-variant/10">
                        <td className="px-3 py-1 font-mono text-md-on-surface">{f.filename}</td>
                        <td className="px-3 py-1 font-semibold">{f.drawingNumber || '—'}</td>
                        <td className="px-3 py-1 text-center">{f.tagsFound || '—'}</td>
                        <td className="px-3 py-1 text-center">
                          {f.rawOutputKey
                            ? <span className="material-symbols-outlined text-[12px] text-green-400" title="Raw OCR available">check_circle</span>
                            : <span className="material-symbols-outlined text-[12px] text-md-on-surface-variant/30">radio_button_unchecked</span>
                          }
                        </td>
                        <td className="px-3 py-1 text-center">
                          {f.cleanedOutputKey
                            ? <span className="material-symbols-outlined text-[12px] text-green-400" title="AI Classified available">check_circle</span>
                            : <span className="material-symbols-outlined text-[12px] text-md-on-surface-variant/30">radio_button_unchecked</span>
                          }
                        </td>
                        <td className="px-3 py-1 text-center">
                          {f.rawOutputKey ? (
                            <button
                              onClick={() => {
                                const API = import.meta.env.VITE_API_URL || '/api/v1';
                                window.open(`${API}/ocr-pipeline/batches/${batch.id}/files/${f.id}/coordinate-trace?format=csv`, '_blank');
                              }}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#2D33E0]/10 text-[#8AB4FF] hover:bg-[#2D33E0]/20 transition-all"
                              title="Download coordinate trace CSV"
                            >
                              <span className="material-symbols-outlined text-[11px]">download</span>
                              CSV
                            </button>
                          ) : (
                            <span className="text-md-on-surface-variant/30 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1 text-center">
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
          )}
        </div>
      )}
    </div>
  );
}
