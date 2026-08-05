import { useState, useMemo, useCallback } from 'react';
import { md } from '../../lib/theme';
import {
  useAiAnalysisEntities,
  useApproveAiEntity,
  useBulkApproveAiEntities,
  useRejectAiEntity,
} from '../../hooks/useAiAnalysis';
import EntityEditDialog from './EntityEditDialog';

const ENTITY_TABS = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'line', label: 'Lines', icon: 'linear_scale', color: '#2D33E0' },
  { key: 'equipment', label: 'Equipment', icon: 'precision_manufacturing', color: '#3BE494' },
  { key: 'instrument', label: 'Instruments', icon: 'sensors', color: '#F39C12' },
  { key: 'system', label: 'Systems', icon: 'hub', color: '#A855F7' },
];

const STATUS_STYLES = {
  draft: { bg: 'bg-amber-500/15', text: 'text-amber-400', label: 'Draft' },
  approved: { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Approved' },
  rejected: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Rejected' },
  merged: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Merged' },
};

export default function EntityBrowser({ jobId }) {
  const [activeType, setActiveType] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editEntity, setEditEntity] = useState(null);

  const filters = useMemo(() => ({
    entityType: activeType === 'all' ? undefined : activeType,
    status: statusFilter === 'all' ? undefined : statusFilter,
  }), [activeType, statusFilter]);

  const { data, isLoading } = useAiAnalysisEntities(jobId, filters);
  const approveMutation = useApproveAiEntity();
  const bulkApproveMutation = useBulkApproveAiEntities();
  const rejectMutation = useRejectAiEntity();

  const entities = data?.entities || [];

  const handleBulkApprove = useCallback((minConfidence = 0.7) => {
    bulkApproveMutation.mutate({
      jobId,
      entityType: activeType === 'all' ? undefined : activeType,
      minConfidence,
    });
  }, [jobId, activeType, bulkApproveMutation]);

  const draftCount = entities.filter(e => e.status === 'draft').length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Type tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-md-outline-variant/20 shrink-0">
        {ENTITY_TABS.map(tab => {
          const count = tab.key === 'all' ? entities.length :
            entities.filter(e => e.entityType === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveType(tab.key)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-label-sm font-semibold transition-colors ${
                activeType === tab.key
                  ? 'bg-md-on-surface/10 text-md-on-surface'
                  : 'text-md-on-surface-variant hover:bg-md-on-surface/5'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]" style={{ color: tab.color }}>{tab.icon}</span>
              {tab.label}
              <span className="text-[10px] opacity-60">{count}</span>
            </button>
          );
        })}

        <div className="w-px h-4 bg-md-outline-variant/30 mx-1" />

        {/* Status filter */}
        {['all', 'draft', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-1.5 py-0.5 text-[9px] rounded font-semibold transition-colors ${
              statusFilter === s ? 'bg-white/10 text-white' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            {s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        <div className="flex-1" />

        {/* Bulk approve */}
        {draftCount > 0 && (
          <button
            onClick={() => handleBulkApprove(0.7)}
            disabled={bulkApproveMutation.isPending}
            className="flex items-center gap-1 px-3 py-1 rounded text-[10px] font-bold bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[12px]">done_all</span>
            {bulkApproveMutation.isPending ? 'Approving...' : `Approve All Drafts (${draftCount})`}
          </button>
        )}
      </div>

      {/* Entity list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-md-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-[16px] mr-2">progress_activity</span>
            Loading entities...
          </div>
        ) : entities.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-md-on-surface-variant">
            No entities found
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr className="text-left text-md-on-surface-variant bg-md-surface-container-high/80">
                <th className="px-3 py-2">Tag</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Details</th>
                <th className="px-3 py-2 text-center">Confidence</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entities.map(entity => {
                const statusStyle = STATUS_STYLES[entity.status] || STATUS_STYLES.draft;
                const data = entity.suggestedData || {};
                const confColor = entity.confidence >= 0.9 ? '#3BE494' :
                  entity.confidence >= 0.7 ? '#F39C12' : '#E74C3C';
                const typeTab = ENTITY_TABS.find(t => t.key === entity.entityType);

                return (
                  <tr key={entity.id} className="border-b border-md-outline-variant/10 hover:bg-md-on-surface/3">
                    <td className="px-3 py-2">
                      <span className="font-bold font-mono" style={{ color: typeTab?.color || md.onSurface }}>
                        {entity.suggestedTag}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]" style={{ color: typeTab?.color }}>{typeTab?.icon}</span>
                        {entity.entityType}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-md-on-surface-variant max-w-[300px] truncate">
                      {data.description || data.service || data.equipmentType || data.instrumentType || data.name || '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="font-bold" style={{ color: confColor }}>
                        {Math.round(entity.confidence * 100)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      {entity.status === 'draft' && (
                        <div className="flex items-center gap-1 justify-center">
                          <button
                            onClick={() => approveMutation.mutate({ entityId: entity.id })}
                            disabled={approveMutation.isPending}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
                            title="Approve"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setEditEntity(entity)}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => rejectMutation.mutate({ entityId: entity.id })}
                            disabled={rejectMutation.isPending}
                            className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
                            title="Reject"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      {entity.status === 'approved' && entity.mergedEntityId && (
                        <span className="text-[9px] text-green-400/70">Merged</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit dialog */}
      {editEntity && (
        <EntityEditDialog
          entity={editEntity}
          onClose={() => setEditEntity(null)}
        />
      )}
    </div>
  );
}
