import { useState } from 'react';
import { useReconciliationReport, useRetryCleanup } from '../../hooks/useOcrPipelineV2';

/**
 * AiCleanupResults — Shows AI cleanup results after OCR processing.
 * Displays: summary stats, reconciliation diff, draft entity lists, per-P&ID breakdown.
 */
export default function AiCleanupResults({ batchId, batch }) {
  const { data: report, isLoading, error } = useReconciliationReport(
    batch?.aiCleanupStatus === 'completed' ? batchId : null
  );
  const retryCleanup = useRetryCleanup();
  const [expandedSection, setExpandedSection] = useState('summary');

  const cleanupStatus = batch?.aiCleanupStatus || 'pending';

  // Status display while cleanup is processing/pending/failed
  if (cleanupStatus === 'processing') {
    return (
      <div className="px-4 py-6 flex flex-col items-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[28px] text-amber-400">psychology</span>
        <span className="text-title-sm font-bold text-md-on-surface">AI Cleanup in Progress</span>
        <span className="text-body-sm text-md-on-surface-variant text-center max-w-md">
          Claude is analyzing OCR extractions: filtering noise, classifying tags,
          matching entities, and detecting revision changes...
        </span>
        <div className="w-48 h-1 bg-md-outline-variant/20 rounded-full overflow-hidden">
          <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  if (cleanupStatus === 'failed') {
    return (
      <div className="px-4 py-4">
        <div className="flex items-center gap-2 px-3 py-2 rounded-md-md bg-red-900/20 border border-red-600/30 mb-3">
          <span className="material-symbols-outlined text-[16px] text-red-400">error</span>
          <span className="text-body-sm font-semibold text-red-300">AI cleanup failed</span>
        </div>
        <button
          onClick={() => retryCleanup.mutate({ batchId })}
          disabled={retryCleanup.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-full text-label-sm font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 transition-all"
        >
          {retryCleanup.isPending ? (
            <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
          ) : (
            <span className="material-symbols-outlined text-[14px]">refresh</span>
          )}
          Retry AI Cleanup
        </button>
      </div>
    );
  }

  if (cleanupStatus === 'pending') {
    return (
      <div className="px-4 py-4 text-body-sm text-md-on-surface-variant">
        AI cleanup will start automatically after OCR processing completes.
      </div>
    );
  }

  // Completed — show results
  if (isLoading) {
    return (
      <div className="px-4 py-4 flex items-center gap-2 text-body-sm text-md-on-surface-variant">
        <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
        Loading cleanup results...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="px-4 py-4 text-body-sm text-red-400">
        Failed to load cleanup results.
      </div>
    );
  }

  const recon = report.reconciliation || {};
  const rev = recon.revision || {};
  const draft = recon.draftEntities || {};

  return (
    <div className="px-4 py-3">
      {/* Summary banner */}
      <div className="flex items-center gap-3 mb-4">
        <span className="material-symbols-outlined text-[22px] text-green-400">check_circle</span>
        <div>
          <span className="text-title-sm font-bold text-md-on-surface">AI Cleanup Complete</span>
          <p className="text-body-sm text-md-on-surface-variant mt-0.5">
            {recon.totalRealTags || 0} real tags found &bull; {recon.totalNoise || 0} noise filtered &bull; {recon.totalUncertain || 0} uncertain
          </p>
        </div>
        <button
          onClick={() => retryCleanup.mutate({ batchId })}
          disabled={retryCleanup.isPending}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md-full text-[11px] font-semibold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-on-surface/5 transition-all"
        >
          <span className="material-symbols-outlined text-[12px]">refresh</span>
          Re-run
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <StatCard label="Equipment" count={draft.equipment || 0} icon="precision_manufacturing" color="#3BE494" />
        <StatCard label="Instruments" count={draft.instruments || 0} icon="sensors" color="#F39C12" />
        <StatCard label="Lines" count={draft.lines || 0} icon="line_start" color="#2D33E0" />
        <StatCard label="Systems" count={draft.systems || 0} icon="account_tree" color="#A855F7" />
      </div>

      {/* Revision changes */}
      {(rev.added > 0 || rev.removed > 0 || rev.moved > 0) && (
        <div className="mb-4 px-3 py-2 rounded-md-md bg-md-surface-container-high border border-md-outline-variant/20">
          <span className="text-label-sm font-bold text-md-on-surface mb-1 block">Revision Changes</span>
          <div className="flex gap-4 text-body-sm">
            {rev.added > 0 && (
              <span className="flex items-center gap-1 text-green-400">
                <span className="material-symbols-outlined text-[14px]">add_circle</span>
                {rev.added} added
              </span>
            )}
            {rev.removed > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <span className="material-symbols-outlined text-[14px]">remove_circle</span>
                {rev.removed} removed (flagged for review)
              </span>
            )}
            {rev.unchanged > 0 && (
              <span className="flex items-center gap-1 text-md-on-surface-variant">
                <span className="material-symbols-outlined text-[14px]">check</span>
                {rev.unchanged} unchanged
              </span>
            )}
            {rev.moved > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                {rev.moved} moved
              </span>
            )}
          </div>
        </div>
      )}

      {/* Removed tags warning */}
      {(recon.removedTags || []).length > 0 && (
        <div className="mb-4 px-3 py-2 rounded-md-md bg-red-900/15 border border-red-600/20">
          <span className="text-label-sm font-bold text-red-300 mb-1 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">warning</span>
            Tags Missing in Revised Drawing
          </span>
          <div className="text-body-sm text-red-300/80 space-y-0.5">
            {recon.removedTags.slice(0, 10).map((t, i) => (
              <div key={i}>{t.tag} ({t.tagType}) on {(t.pnidDrawingNumbers || []).join(', ')}</div>
            ))}
            {recon.removedTags.length > 10 && (
              <div className="text-red-400/60">+ {recon.removedTags.length - 10} more</div>
            )}
          </div>
        </div>
      )}

      {/* Collapsible sections */}
      <SectionToggle
        label="Draft Entity Lists"
        icon="list"
        expanded={expandedSection === 'entities'}
        onToggle={() => setExpandedSection(expandedSection === 'entities' ? null : 'entities')}
      >
        <EntityTable entities={report.draftEntities || []} />
      </SectionToggle>

      <SectionToggle
        label="Cleaned Extractions"
        icon="filter_alt"
        expanded={expandedSection === 'extractions'}
        onToggle={() => setExpandedSection(expandedSection === 'extractions' ? null : 'extractions')}
      >
        <ExtractionTable extractions={report.cleanedExtractions || []} />
      </SectionToggle>

      {/* Per-P&ID summary */}
      {(recon.pnidSummary || []).length > 0 && (
        <SectionToggle
          label="Per-P&ID Breakdown"
          icon="description"
          expanded={expandedSection === 'pnids'}
          onToggle={() => setExpandedSection(expandedSection === 'pnids' ? null : 'pnids')}
        >
          <div className="space-y-1">
            {recon.pnidSummary.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-body-sm px-2 py-1 rounded bg-md-surface-container-high/50">
                <span className="font-mono text-[11px] text-md-on-surface">{p.drawingNumber}</span>
                <span className="text-md-on-surface-variant text-[11px]">
                  {p.realTags} tags &bull; {p.noise} noise &bull;
                  {p.equipment}E / {p.instruments}I / {p.lines}L
                </span>
              </div>
            ))}
          </div>
        </SectionToggle>
      )}

      {/* Summary text */}
      {recon.summary && (
        <div className="mt-3 px-3 py-2 rounded-md-md bg-md-surface-container-high/50 text-body-sm text-md-on-surface-variant">
          {recon.summary}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, count, icon, color }) {
  return (
    <div className="flex flex-col items-center py-2 px-2 rounded-md-md bg-md-surface-container-high/50 border border-md-outline-variant/10">
      <span className="material-symbols-outlined text-[18px] mb-1" style={{ color }}>{icon}</span>
      <span className="text-title-sm font-bold text-md-on-surface">{count}</span>
      <span className="text-[10px] text-md-on-surface-variant">{label}</span>
    </div>
  );
}

function SectionToggle({ label, icon, expanded, onToggle, children }) {
  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md-md text-label-sm font-semibold text-md-on-surface hover:bg-md-on-surface/5 transition-all"
      >
        <span className="material-symbols-outlined text-[16px] text-md-on-surface-variant">{icon}</span>
        {label}
        <span className="material-symbols-outlined text-[16px] ml-auto text-md-on-surface-variant">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {expanded && <div className="mt-1 ml-2">{children}</div>}
    </div>
  );
}

function EntityTable({ entities }) {
  if (entities.length === 0) return <div className="text-body-sm text-md-on-surface-variant px-2">No draft entities</div>;

  const grouped = {};
  for (const e of entities) {
    const type = e.entity_type || 'unknown';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(e);
  }

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type}>
          <span className="text-[10px] font-bold text-md-on-surface-variant uppercase px-2">{type}s ({items.length})</span>
          <div className="space-y-0.5 mt-0.5">
            {items.map(e => {
              const data = typeof e.suggested_data === 'string' ? JSON.parse(e.suggested_data) : e.suggested_data;
              return (
                <div key={e.id} className="flex items-center justify-between text-body-sm px-2 py-0.5 rounded bg-md-surface-container-high/30">
                  <span className="font-mono text-[11px] text-md-on-surface">{e.suggested_tag}</span>
                  <span className="text-[10px] text-md-on-surface-variant">
                    {data?.description || data?.equipmentType || data?.instrumentType || data?.service || ''}
                    {' '}&bull; conf: {(Number(e.confidence) * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExtractionTable({ extractions }) {
  if (extractions.length === 0) return <div className="text-body-sm text-md-on-surface-variant px-2">No cleaned extractions</div>;

  return (
    <div className="space-y-0.5 max-h-60 overflow-y-auto">
      {extractions.map(e => (
        <div key={e.id} className="flex items-center justify-between text-body-sm px-2 py-0.5 rounded bg-md-surface-container-high/30">
          <div className="flex items-center gap-2">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
              e.tag_type === 'equipment' ? 'bg-green-500/15 text-green-400' :
              e.tag_type === 'instrument' ? 'bg-amber-500/15 text-amber-400' :
              e.tag_type === 'line' ? 'bg-blue-500/15 text-blue-400' :
              'bg-gray-500/15 text-gray-400'
            }`}>{e.tag_type?.slice(0, 4)}</span>
            <span className="font-mono text-[11px] text-md-on-surface">{e.extracted_text}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-md-on-surface-variant">
            {e.matched_entity_id && (
              <span className="text-green-400 flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[10px]">link</span>
                matched
              </span>
            )}
            {e.revision_status && e.revision_status !== 'unchanged' && (
              <span className={
                e.revision_status === 'added' ? 'text-green-400' :
                e.revision_status === 'moved' ? 'text-amber-400' : 'text-md-on-surface-variant'
              }>{e.revision_status}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
