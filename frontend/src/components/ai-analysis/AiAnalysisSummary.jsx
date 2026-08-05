import { useEffect } from 'react';
import { md } from '../../lib/theme';
import { useAiAnalysisJob, useAiAnalysisSummary, useRunAiAnalysis } from '../../hooks/useAiAnalysis';
import DataReadinessPanel from './DataReadinessPanel';

/**
 * AI Analysis Summary — Shows analysis results + trigger button.
 */
export default function AiAnalysisSummary({ batchId, jobId, onJobCreated }) {
  const runAnalysis = useRunAiAnalysis();
  const { data: jobData } = useAiAnalysisJob(jobId);
  const { data: summaryData } = useAiAnalysisSummary(jobId);

  const job = jobData?.job;
  const entityCounts = jobData?.entityCounts;

  // When analysis completes, propagate jobId
  useEffect(() => {
    if (runAnalysis.data?.jobId && !jobId) {
      onJobCreated?.(runAnalysis.data.jobId);
    }
  }, [runAnalysis.data?.jobId, jobId, onJobCreated]);

  const handleRun = () => {
    if (!batchId) return;
    runAnalysis.mutate({ batchId });
  };

  // No batch selected
  if (!batchId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-md-on-surface-variant gap-4">
        <span className="material-symbols-outlined text-[56px] opacity-20">folder_off</span>
        <div className="text-center">
          <div className="text-body-lg font-bold text-md-on-surface mb-1">No OCR Batch Available</div>
          <div className="text-body-sm max-w-md">
            Run OCR processing on P&ID files first, then come back here to analyze the results with AI.
            Go to <strong>Browse Storage</strong> to select files, or <strong>Processing History</strong> to pick an existing batch.
          </div>
        </div>
      </div>
    );
  }

  // No analysis run yet — show data readiness check
  if (!jobId && !runAnalysis.isPending && !runAnalysis.data) {
    return <DataReadinessPanel batchId={batchId} onRunAnalysis={handleRun} />;
  }

  // Processing
  if (runAnalysis.isPending || job?.status === 'processing' || job?.status === 'pending') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-md-on-surface-variant gap-4">
        <span className="material-symbols-outlined animate-spin text-[48px] text-purple-400">progress_activity</span>
        <div className="text-center">
          <div className="text-body-lg font-bold text-md-on-surface mb-1">Analyzing with AI...</div>
          <div className="text-body-sm">Claude is analyzing the OCR results. This may take a minute.</div>
        </div>
      </div>
    );
  }

  // Failed
  if (job?.status === 'failed') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-md-on-surface-variant gap-4">
        <span className="material-symbols-outlined text-[48px] text-red-400">error</span>
        <div className="text-center">
          <div className="text-body-lg font-bold text-red-400 mb-1">Analysis Failed</div>
          <div className="text-body-sm max-w-md">{job.errorMessage || 'Unknown error'}</div>
        </div>
        <button
          onClick={handleRun}
          className="flex items-center gap-2 px-4 py-2 rounded-md-full text-body-sm font-bold bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">refresh</span>
          Retry Analysis
        </button>
      </div>
    );
  }

  // Completed — show summary
  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {/* Summary card */}
      <div className="rounded-md-lg border border-purple-500/20 bg-purple-500/5 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-[20px] text-purple-400">summarize</span>
          <span className="text-body-md font-bold text-md-on-surface">AI Summary</span>
          {job?.aiModel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-md-on-surface/10 text-md-on-surface-variant font-mono">
              {job.aiModel}
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={handleRun}
            className="text-[10px] px-2 py-1 rounded bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 font-semibold transition-colors"
          >
            Re-run
          </button>
        </div>
        <div className="text-body-sm text-md-on-surface/90 whitespace-pre-wrap leading-relaxed">
          {summaryData?.summary || job?.summaryText || 'No summary available'}
        </div>
      </div>

      {/* Entity counts grid */}
      {entityCounts && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Systems', count: entityCounts.systems, icon: 'hub', color: '#A855F7' },
            { label: 'Lines', count: entityCounts.lines, icon: 'linear_scale', color: '#2D33E0' },
            { label: 'Equipment', count: entityCounts.equipment, icon: 'precision_manufacturing', color: '#3BE494' },
            { label: 'Instruments', count: entityCounts.instruments, icon: 'sensors', color: '#F39C12' },
          ].map(item => (
            <div key={item.label} className="rounded-md-lg border border-md-outline-variant/20 p-3 text-center">
              <span className="material-symbols-outlined text-[24px] mb-1" style={{ color: item.color }}>{item.icon}</span>
              <div className="text-title-lg font-bold" style={{ color: item.color }}>{item.count}</div>
              <div className="text-[10px] text-md-on-surface-variant font-semibold uppercase">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Status breakdown */}
      {entityCounts && (
        <div className="flex gap-4 rounded-md-lg border border-md-outline-variant/20 p-3">
          {[
            { label: 'Total Suggestions', value: entityCounts.total, color: md.onSurface },
            { label: 'Draft', value: entityCounts.drafts, color: '#F39C12' },
            { label: 'Approved', value: entityCounts.approved, color: '#3BE494' },
            { label: 'Rejected', value: entityCounts.rejected, color: '#E74C3C' },
          ].map(s => (
            <div key={s.label} className="text-center flex-1">
              <div className="text-title-sm font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-md-on-surface-variant">{s.label}</div>
            </div>
          ))}
          <div className="text-center flex-1">
            <div className="text-title-sm font-bold text-purple-400">{jobData?.relationshipCount || 0}</div>
            <div className="text-[10px] text-md-on-surface-variant">Relationships</div>
          </div>
        </div>
      )}

      {/* Token usage */}
      {summaryData?.tokens && (
        <div className="text-[10px] text-md-on-surface-variant flex gap-4">
          <span>Input tokens: {summaryData.tokens.input?.toLocaleString()}</span>
          <span>Output tokens: {summaryData.tokens.output?.toLocaleString()}</span>
          {summaryData.completedAt && (
            <span>Completed: {new Date(summaryData.completedAt).toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  );
}

