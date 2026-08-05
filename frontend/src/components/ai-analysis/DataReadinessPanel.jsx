import { useState, useEffect } from 'react';
import { useBatchDataCheck, useReprocessFiles } from '../../hooks/useAiAnalysis';

/**
 * DataReadinessPanel — Shows extraction status per file and allows re-running OCR.
 */
export default function DataReadinessPanel({ batchId, onRunAnalysis }) {
  const { data, isLoading, refetch } = useBatchDataCheck(batchId);
  const reprocess = useReprocessFiles();
  const [isReprocessing, setIsReprocessing] = useState(false);

  const summary = data?.summary;
  const files = data?.files || [];

  // Poll data-check while reprocessing
  useEffect(() => {
    if (!isReprocessing) return;
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [isReprocessing, refetch]);

  // Stop polling when all files are ready
  useEffect(() => {
    if (isReprocessing && summary?.needsOcr === 0 && summary?.total > 0) {
      setIsReprocessing(false);
    }
  }, [isReprocessing, summary]);

  const handleReprocess = () => {
    setIsReprocessing(true);
    reprocess.mutate({ batchId });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-md-on-surface-variant gap-4">
        <span className="material-symbols-outlined animate-spin text-[48px] text-purple-400">progress_activity</span>
        <div className="text-body-sm">Checking data readiness...</div>
      </div>
    );
  }

  const hasData = summary?.ready > 0;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Header */}
      <div className="text-center">
        <span className="material-symbols-outlined text-[48px] text-purple-400/40 mb-2">psychology</span>
        <div className="text-body-lg font-bold text-md-on-surface mb-1">AI Analysis — Data Readiness</div>
        <div className="text-body-sm text-md-on-surface-variant max-w-lg mx-auto">
          Before running AI analysis, each P&ID file needs OCR extraction data. Files without
          extractions need OCR re-processing (now with native PDF support).
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="flex gap-3 justify-center">
          <div className="px-3 py-1.5 rounded-md-full text-body-sm font-bold bg-green-500/15 text-green-400">
            {summary.ready} Ready
          </div>
          <div className="px-3 py-1.5 rounded-md-full text-body-sm font-bold bg-amber-500/15 text-amber-400">
            {summary.needsOcr} Needs OCR
          </div>
          {summary.noPnid > 0 && (
            <div className="px-3 py-1.5 rounded-md-full text-body-sm font-bold bg-red-500/15 text-red-400">
              {summary.noPnid} No P&ID Link
            </div>
          )}
          {summary.failed > 0 && (
            <div className="px-3 py-1.5 rounded-md-full text-body-sm font-bold bg-red-500/15 text-red-400">
              {summary.failed} Failed
            </div>
          )}
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden max-h-[300px] overflow-y-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-md-surface-container sticky top-0">
              <tr className="text-[10px] uppercase text-md-on-surface-variant">
                <th className="text-left px-3 py-2">Drawing</th>
                <th className="text-left px-3 py-2">Filename</th>
                <th className="text-right px-3 py-2">Extractions</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id} className="border-t border-md-outline-variant/10">
                  <td className="px-3 py-1.5 font-mono text-[11px]">{f.drawingNumber || '—'}</td>
                  <td className="px-3 py-1.5 text-[11px] text-md-on-surface-variant truncate max-w-[200px]">{f.filename}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[11px]">{f.extractionCount}</td>
                  <td className="px-3 py-1.5 text-center">
                    {f.status === 'ready' && (
                      <span className="material-symbols-outlined text-[16px] text-green-400">check_circle</span>
                    )}
                    {f.status === 'needs_ocr' && (
                      <span className="material-symbols-outlined text-[16px] text-amber-400">pending</span>
                    )}
                    {f.status === 'no_pnid' && (
                      <span className="material-symbols-outlined text-[16px] text-red-400">link_off</span>
                    )}
                    {f.status === 'failed' && (
                      <span className="material-symbols-outlined text-[16px] text-red-400">error</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-center gap-3">
        {summary?.needsOcr > 0 && (
          <button
            onClick={handleReprocess}
            disabled={isReprocessing || reprocess.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-md-full text-body-sm font-bold bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40"
          >
            {isReprocessing ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                Re-processing {summary.needsOcr} files...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">refresh</span>
                Re-run OCR ({summary.needsOcr} files)
              </>
            )}
          </button>
        )}
        <button
          onClick={onRunAnalysis}
          disabled={!hasData}
          className="flex items-center gap-2 px-5 py-2.5 rounded-md-full text-body-md font-bold transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: hasData ? 'linear-gradient(135deg, #A855F7, #7C3AED)' : '#333', color: '#fff' }}
        >
          <span className="material-symbols-outlined text-[20px]">psychology</span>
          Analyze with AI {hasData ? `(${summary.ready} files)` : ''}
        </button>
      </div>

      {!hasData && !isReprocessing && (
        <div className="text-center text-[11px] text-md-on-surface-variant">
          No files have OCR extraction data yet. Click "Re-run OCR" to process the PDF files with native PDF support.
        </div>
      )}
    </div>
  );
}
