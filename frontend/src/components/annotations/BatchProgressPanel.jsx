import DetectionReviewOverlay from './DetectionReviewOverlay';

function confidenceClass(confidence) {
  if (confidence >= 0.85) return 'text-[#3BE494]';
  if (confidence >= 0.7) return 'text-[#FFD466]';
  return 'text-[#FF897A]';
}

function statusIcon(status) {
  if (status === 'completed') return '\u2713';
  if (status === 'failed') return '\u2717';
  if (status === 'processing') return '\u25CB';
  return '\u2022';
}

function statusColor(status) {
  if (status === 'completed') return 'text-[#3BE494]';
  if (status === 'failed') return 'text-[#FF897A]';
  if (status === 'processing') return 'text-[#FFD466]';
  return 'text-[#919A9B]';
}

export default function BatchProgressPanel({
  batchProgress,
  batchReviewPnidId,
  batchReviewDetections = [],
  batchDecisionMap = {},
  highlightedIndex = null,
  onSelectDrawing,
  onToggleBatchAccept,
  onHighlight,
}) {
  if (!batchProgress) return null;

  const { status, totalDrawings, processed, failed, results = [] } = batchProgress;
  const isRunning = status === 'processing';
  const progressPct = totalDrawings > 0 ? Math.round((processed / totalDrawings) * 100) : 0;
  const totalDetections = results.reduce((sum, r) => sum + (r.detectionCount || 0), 0);

  return (
    <div className="bg-[#0D1F17] border border-[#919A9B]/20 rounded backdrop-blur-sm max-h-[500px] flex flex-col">
      {/* Header with progress */}
      <div className="sticky top-0 bg-[#0D1F17] px-3 py-2 border-b border-[#919A9B]/20">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-[#D3DFE2]">
            Batch Detection
          </span>
          <span className="text-[10px] text-[#919A9B]">
            {isRunning
              ? `${processed}/${totalDrawings} drawings`
              : `${totalDetections} detections across ${totalDrawings} drawings`
            }
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-1.5 bg-[#919A9B]/20 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${failed > 0 && !isRunning ? 'bg-[#FFD466]' : 'bg-[#3BE494]'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {failed > 0 && (
          <div className="text-[9px] text-[#FF897A] mt-0.5">{failed} drawing{failed !== 1 ? 's' : ''} failed</div>
        )}
      </div>

      {/* Drawing list */}
      <div className="overflow-auto flex-1 max-h-48">
        {results.map(r => {
          const isSelected = r.pnidId === batchReviewPnidId;
          return (
            <div
              key={r.pnidId}
              className={`px-3 py-1.5 border-b border-[#919A9B]/10 last:border-b-0 flex items-center gap-2 cursor-pointer transition-colors
                ${isSelected ? 'bg-[#3BE494]/15' : 'hover:bg-[#919A9B]/10'}
                ${r.status === 'failed' ? 'opacity-50' : ''}`}
              onClick={() => r.status === 'completed' && onSelectDrawing?.(r.pnidId)}
            >
              <span className={`text-[10px] font-mono ${statusColor(r.status)}`}>
                {statusIcon(r.status)}
              </span>
              <span className="text-[11px] font-semibold text-[#D3DFE2] truncate max-w-36">
                {r.drawingNumber || 'Unknown'}
              </span>
              {r.status === 'completed' && (
                <span className="text-[10px] text-[#919A9B] ml-auto whitespace-nowrap">
                  {r.detectionCount} detection{r.detectionCount !== 1 ? 's' : ''}
                </span>
              )}
              {r.status === 'processing' && (
                <span className="text-[9px] text-[#FFD466] ml-auto animate-pulse">Processing...</span>
              )}
              {r.status === 'failed' && (
                <span className="text-[9px] text-[#FF897A] ml-auto truncate max-w-32" title={r.errorMessage || ''}>
                  Failed
                </span>
              )}
              {r.processingMs && r.status === 'completed' && (
                <span className="text-[9px] text-[#919A9B]/60">{(r.processingMs / 1000).toFixed(1)}s</span>
              )}
              {isSelected && <span className="text-[8px] text-[#3BE494]">&#9679;</span>}
            </div>
          );
        })}
      </div>

      {/* Per-drawing detection review */}
      {batchReviewPnidId && batchReviewDetections.length > 0 && (
        <div className="border-t border-[#919A9B]/20">
          <div className="px-3 py-1 bg-[#111D14] text-[10px] text-[#919A9B]">
            Reviewing: {results.find(r => r.pnidId === batchReviewPnidId)?.drawingNumber || batchReviewPnidId}
          </div>
          <DetectionReviewOverlay
            detections={batchReviewDetections}
            decisionMap={batchDecisionMap}
            onToggleAccept={onToggleBatchAccept}
            highlightedIndex={highlightedIndex}
            onHighlight={onHighlight}
          />
        </div>
      )}
    </div>
  );
}
