import { useState } from 'react';
import { md } from '../../lib/theme';
import { useAiAnalysisJob } from '../../hooks/useAiAnalysis';
import AiAnalysisSummary from './AiAnalysisSummary';
import EntityBrowser from './EntityBrowser';
import RelationshipView from './RelationshipView';
import ImportExportPanel from './ImportExportPanel';

/**
 * AI Analysis Layout — Main container for the AI analysis module.
 * Displayed as a tab within OcrPipelineLayout when a batch is completed.
 */
export default function AiAnalysisLayout({ batchId, platformId, onBack }) {
  const [activeTab, setActiveTab] = useState('summary');

  // Find the latest analysis job for this batch
  const { data: jobData, isLoading } = useAiAnalysisJob(
    // We need the jobId — fetch from batch detail's ai_analysis_job_id
    // For now, pass null and the summary component handles triggering
    null
  );

  // We store the jobId once analysis is triggered
  const [analysisJobId, setAnalysisJobId] = useState(null);
  const { data: analysisData } = useAiAnalysisJob(analysisJobId);

  const job = analysisData?.job;
  const entityCounts = analysisData?.entityCounts;
  const isCompleted = job?.status === 'completed';

  const tabs = [
    { key: 'summary', label: 'Summary', icon: 'summarize', enabled: true },
    { key: 'entities', label: 'Entities', icon: 'list_alt', badge: entityCounts?.total || null, enabled: !!analysisJobId },
    { key: 'relationships', label: 'Relationships', icon: 'account_tree', badge: analysisData?.relationshipCount || null, enabled: !!analysisJobId },
    { key: 'import-export', label: 'Import / Export', icon: 'swap_vert', enabled: true },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 bg-md-surface-container/50 border-b border-md-outline-variant/20 shrink-0">
        {onBack && (
          <>
            <button onClick={onBack} className="md-icon-btn w-7 h-7" title="Back">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </button>
            <div className="w-px h-5 bg-md-outline-variant/30 mx-1" />
          </>
        )}

        <span className="material-symbols-outlined text-[20px]" style={{ color: '#A855F7' }}>psychology</span>
        <span className="text-body-sm font-bold text-md-on-surface mr-3">AI Analysis</span>

        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => tab.enabled && setActiveTab(tab.key)}
            disabled={!tab.enabled}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-md font-semibold transition-all ${
              activeTab === tab.key
                ? 'bg-purple-500/15 text-purple-400'
                : tab.enabled
                  ? 'text-md-on-surface-variant hover:bg-md-on-surface/5'
                  : 'text-md-on-surface-variant/40 cursor-not-allowed'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
            {tab.badge != null && (
              <span className={`ml-1 text-label-sm px-1.5 py-0.5 rounded-md-full ${
                activeTab === tab.key ? 'bg-purple-500/20' : 'bg-md-on-surface/10'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}

        {/* Status badge */}
        <div className="flex-1" />
        {job && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
            job.status === 'completed' ? 'bg-green-500/15 text-green-400' :
            job.status === 'processing' ? 'bg-amber-500/15 text-amber-400' :
            job.status === 'failed' ? 'bg-red-500/15 text-red-400' :
            'bg-md-on-surface/10 text-md-on-surface-variant'
          }`}>
            {job.status === 'processing' && (
              <span className="material-symbols-outlined animate-spin text-[10px] mr-1">progress_activity</span>
            )}
            {job.status?.toUpperCase()}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'summary' && (
          <AiAnalysisSummary
            batchId={batchId}
            jobId={analysisJobId}
            onJobCreated={setAnalysisJobId}
          />
        )}
        {activeTab === 'entities' && analysisJobId && (
          <EntityBrowser jobId={analysisJobId} />
        )}
        {activeTab === 'relationships' && analysisJobId && (
          <RelationshipView jobId={analysisJobId} />
        )}
        {activeTab === 'import-export' && (
          <ImportExportPanel batchId={batchId} />
        )}
      </div>
    </div>
  );
}
