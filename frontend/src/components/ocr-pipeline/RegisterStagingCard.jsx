import { useState, useMemo, useCallback } from 'react';
import {
  useRegisterStagingItems,
  usePushRegisterStaging,
  useApplyRegisterStaging,
  useCancelRegisterStaging,
} from '../../hooks/useOcrPipelineV2';
import StagingCoordinatePreview from './StagingCoordinatePreview';
import TagTraceabilityPanel from './TagTraceabilityPanel';

const DISCIPLINE_TABS = [
  { key: 'all', label: 'All', icon: 'list' },
  { key: 'line', label: 'Lines', icon: 'route' },
  { key: 'equipment', label: 'Equipment', icon: 'precision_manufacturing' },
  { key: 'instrument', label: 'Instruments', icon: 'speed' },
];

const ACTION_BADGES = {
  link_pnid:      { label: 'MATCH',   icon: 'check_circle', color: '#3BE494', bg: '#3BE494' },
  create_entity:  { label: 'NEW',     icon: 'add_circle',   color: '#8AB4FF', bg: '#2D33E0' },
  unlink_pnid:    { label: 'REMOVED', icon: 'warning',      color: '#FFB068', bg: '#F39C12' },
};

/**
 * Register Changes — unified panel for comparing OCR tags against registers
 * and applying changes in a single step.
 */
export default function RegisterStagingCard({ platformId, batches }) {
  const [expanded, setExpanded] = useState(true);
  const [selectedBatchIds, setSelectedBatchIds] = useState(() => new Set());
  const [discipline, setDiscipline] = useState('all');
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [showCoordinatePreview, setShowCoordinatePreview] = useState(false);
  const [traceItemId, setTraceItemId] = useState(null);
  const [applySummary, setApplySummary] = useState(null);

  const { data: listData, isLoading, refetch, isFetching } = useRegisterStagingItems(platformId, {
    status: 'pending',
    enabled: expanded && !!platformId,
  });

  const pushStaging = usePushRegisterStaging(platformId);
  const applyStaging = useApplyRegisterStaging(platformId);
  const cancelStaging = useCancelRegisterStaging(platformId);

  const allItems = listData?.items ?? [];

  // Filter by discipline tab
  const items = useMemo(() => {
    if (discipline === 'all') return allItems;
    return allItems.filter(i => i.entityKind === discipline);
  }, [allItems, discipline]);

  // Counts by action type for the badge pills
  const actionCounts = useMemo(() => {
    const counts = { link_pnid: 0, create_entity: 0, unlink_pnid: 0 };
    for (const item of items) {
      if (counts[item.actionType] !== undefined) counts[item.actionType]++;
    }
    return counts;
  }, [items]);

  // Counts by discipline for tab badges
  const disciplineCounts = useMemo(() => {
    const counts = { all: allItems.length, line: 0, equipment: 0, instrument: 0 };
    for (const item of allItems) {
      if (counts[item.entityKind] !== undefined) counts[item.entityKind]++;
    }
    return counts;
  }, [allItems]);

  const toggleBatch = useCallback((id) => {
    setSelectedBatchIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  // Step 1: Sync OCR tags + queue staging items
  const handleSync = () => {
    const batchIds = [...selectedBatchIds];
    if (!batchIds.length) return;
    pushStaging.mutate({ batchIds, entityKinds: ['line', 'equipment', 'instrument', 'system'] });
  };

  const toggleItem = useCallback((id) => {
    setSelectedItemIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  // Select helpers
  const selectByAction = useCallback((actionType) => {
    const ids = items
      .filter(i => i.status === 'pending' && i.actionType === actionType)
      .map(i => i.id);
    setSelectedItemIds(prev => {
      const n = new Set(prev);
      ids.forEach(id => n.add(id));
      return n;
    });
  }, [items]);

  const selectAll = useCallback(() => {
    setSelectedItemIds(new Set(items.filter(i => i.status === 'pending').map(i => i.id)));
  }, [items]);

  const clearSelection = useCallback(() => setSelectedItemIds(new Set()), []);

  const actionableSelected = useMemo(
    () => items.filter(i =>
      selectedItemIds.has(i.id)
      && i.status === 'pending'
      && ['link_pnid', 'create_entity', 'unlink_pnid'].includes(i.actionType)),
    [items, selectedItemIds]
  );

  // Apply to register — updates register + pnid junction links only (no auto-geometry)
  const handleApply = () => {
    if (!actionableSelected.length) return;
    setApplySummary(null);
    applyStaging.mutate(
      { stagingItemIds: actionableSelected.map(i => i.id), passToAnnotation: false },
      {
        onSuccess: (data) => {
          setSelectedItemIds(new Set());
          setApplySummary(data);
          refetch();
        },
      }
    );
  };

  const handleApplyAll = () => {
    setApplySummary(null);
    applyStaging.mutate(
      { applyAllPending: true, entityKinds: discipline === 'all' ? undefined : [discipline], passToAnnotation: false },
      {
        onSuccess: (data) => {
          setSelectedItemIds(new Set());
          setApplySummary(data);
          refetch();
        },
      }
    );
  };

  const handleCancelSelected = () => {
    if (!selectedItemIds.size) return;
    cancelStaging.mutate({ stagingItemIds: [...selectedItemIds] });
    setSelectedItemIds(new Set());
  };

  if (!batches?.length) return null;

  return (
    <div
      className="rounded-md-lg border border-md-outline-variant/20 overflow-hidden mt-3"
      style={{ background: 'var(--md-surface-container-low, rgba(26,37,33,0.5))' }}
    >
      {/* ── Header ── */}
      <div
        className="px-3 py-2 flex items-center gap-2 border-b border-md-outline-variant/15"
        style={{ background: 'var(--md-surface-container-high, rgba(36,51,48,0.35))' }}
      >
        <span className="material-symbols-outlined text-[18px]" style={{ color: 'var(--md-primary)' }}>
          inventory_2
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-label-sm font-bold text-md-on-surface">Register Changes</div>
          <div className="text-[10px] text-md-on-surface-variant leading-snug">
            Sync OCR tags, review register matches, and apply in one step
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
          style={{ color: 'var(--md-primary)', background: 'var(--md-primary-container)' }}
        >
          {expanded ? 'Hide' : 'Open'}
        </button>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">

          {/* ── Step 1: Sync OCR Tags ── */}
          <div className="rounded-lg border border-md-outline-variant/15 p-3"
               style={{ background: 'var(--md-surface-container, rgba(30,44,40,0.4))' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px] text-[#3BE494]">sync</span>
              <span className="text-[11px] font-bold text-md-on-surface">Sync OCR Tags</span>
              <span className="text-[10px] text-md-on-surface-variant">
                — Compare reviewed tags against existing registers
              </span>
            </div>

            {/* Batch selection */}
            <div className="max-h-28 overflow-auto space-y-1 border border-md-outline-variant/15 rounded-lg p-2 mb-2">
              {batches.map(b => (
                <label key={b.id} className="flex items-center gap-2 text-[11px] text-md-on-surface cursor-pointer hover:bg-md-on-surface/3 rounded px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={selectedBatchIds.has(b.id)}
                    onChange={() => toggleBatch(b.id)}
                    className="w-3.5 h-3.5 accent-[#3BE494]"
                  />
                  <span className="flex-1 truncate">{b.batchName || 'Batch'}</span>
                  <span className="text-[9px] text-md-on-surface-variant">{b.totalFiles} files</span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSync}
                disabled={pushStaging.isPending || !selectedBatchIds.size}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#3BE494]/20 text-[#3BE494] disabled:opacity-30 transition-colors"
              >
                {pushStaging.isPending ? (
                  <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                ) : (
                  <span className="material-symbols-outlined text-[14px]">sync</span>
                )}
                Sync & Compare
              </button>
              {pushStaging.isSuccess && (
                <span className="text-[10px] text-[#3BE494]">
                  {pushStaging.data?.reviewSync?.upserted ?? 0} tags synced
                  {' · '}{pushStaging.data?.inserted ?? 0} new staging items
                  {(pushStaging.data?.reviewSync?.updated ?? 0) > 0 && ` · ${pushStaging.data.reviewSync.updated} updated`}
                </span>
              )}
              {pushStaging.isError && (
                <span className="text-[10px] text-red-400">{pushStaging.error?.message}</span>
              )}
            </div>
          </div>

          {/* ── Step 2: Register Changes table ── */}
          <div className="border-t border-md-outline-variant/15 pt-3">

            {/* Discipline tabs */}
            <div className="flex items-center gap-1 mb-3">
              {DISCIPLINE_TABS.map(tab => {
                const count = disciplineCounts[tab.key] || 0;
                const active = discipline === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDiscipline(tab.key)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                      active
                        ? 'bg-[#3BE494]/15 text-[#3BE494] border border-[#3BE494]/30'
                        : 'border border-md-outline-variant/20 text-md-on-surface-variant hover:bg-md-on-surface/5'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
                    {tab.label}
                    {count > 0 && (
                      <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                        active ? 'bg-[#3BE494]/20' : 'bg-md-on-surface/8'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setShowCoordinatePreview(p => !p)}
                className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                  showCoordinatePreview
                    ? 'border-[#F39C12]/40 bg-[#F39C12]/10 text-[#F39C12] font-bold'
                    : 'border-md-outline-variant/30 text-md-on-surface-variant'
                }`}
              >
                <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">preview</span>
                Preview
              </button>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="text-[10px] px-2 py-1 rounded-md border border-md-outline-variant/30 text-md-on-surface-variant disabled:opacity-40"
              >
                {isFetching ? (
                  <span className="material-symbols-outlined animate-spin text-[12px] align-middle">progress_activity</span>
                ) : 'Refresh'}
              </button>
            </div>

            {/* Action type summary pills + bulk select */}
            {items.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-[9px] text-md-on-surface-variant font-bold uppercase tracking-wide">Bulk select:</span>
                {Object.entries(ACTION_BADGES).map(([actionType, badge]) => {
                  const count = actionCounts[actionType] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={actionType}
                      type="button"
                      onClick={() => selectByAction(actionType)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold border transition-colors hover:brightness-110"
                      style={{
                        borderColor: `${badge.bg}40`,
                        background: `${badge.bg}12`,
                        color: badge.color,
                      }}
                    >
                      <span className="material-symbols-outlined text-[11px]">{badge.icon}</span>
                      {badge.label} ({count})
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={selectAll}
                  className="px-2 py-0.5 rounded text-[9px] font-bold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-md-primary/10 hover:text-md-primary transition-colors"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="px-2 py-0.5 rounded text-[9px] font-bold border border-md-outline-variant/30 text-md-on-surface-variant hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  Clear
                </button>
                {selectedItemIds.size > 0 && (
                  <span className="text-[9px] text-md-primary font-bold ml-1">
                    {selectedItemIds.size} selected
                  </span>
                )}
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center gap-2 text-[11px] text-md-on-surface-variant py-6 justify-center">
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Loading register changes…
              </div>
            )}

            {/* Empty state */}
            {!isLoading && items.length === 0 && (
              <div className="text-center py-6">
                <span className="material-symbols-outlined text-[28px] text-md-on-surface-variant/20 block mb-1">fact_check</span>
                <p className="text-[11px] text-md-on-surface-variant">
                  No pending changes. Sync OCR tags from a batch above to see register comparisons.
                </p>
              </div>
            )}

            {/* Changes table */}
            {!isLoading && items.length > 0 && (
              <>
                <div className="max-h-[420px] overflow-auto rounded-lg border border-md-outline-variant/15">
                  <table className="w-full text-[10px]">
                    <thead className="sticky top-0 bg-md-surface-container-high/90 backdrop-blur-sm">
                      <tr className="text-left text-md-on-surface-variant">
                        <th className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={items.filter(r => r.status === 'pending').length > 0 && items.filter(r => r.status === 'pending').every(r => selectedItemIds.has(r.id))}
                            onChange={(e) => {
                              if (e.target.checked) selectAll();
                              else clearSelection();
                            }}
                            className="w-3 h-3 accent-md-primary"
                            title="Select / deselect all"
                          />
                        </th>
                        <th className="px-2 py-1.5">OCR Tag</th>
                        <th className="px-2 py-1.5">Register Match</th>
                        <th className="px-2 py-1.5">Type</th>
                        <th className="px-2 py-1.5">Action</th>
                        <th className="px-2 py-1.5">Conf.</th>
                        <th className="px-2 py-1.5">Drawing</th>
                        <th className="px-2 py-1.5 w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(row => {
                        const ocrTag = row.payload?.tagText || row.payload?.tag_text || '';
                        const registerTag = row.matchedEntityTag || '';
                        const canSelect = row.status === 'pending';
                        const badge = ACTION_BADGES[row.actionType] || { label: row.actionType, color: '#919A9B', bg: '#919A9B', icon: 'help' };
                        const isSelected = selectedItemIds.has(row.id);
                        const confidence = row.payload?.confidence;
                        return (
                          <tr
                            key={row.id}
                            className={`border-t border-md-outline-variant/8 transition-colors ${
                              isSelected ? 'bg-md-primary/5' : 'hover:bg-md-on-surface/3'
                            }`}
                          >
                            <td className="px-2 py-1.5">
                              {canSelect && (
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleItem(row.id)}
                                  className="w-3 h-3 accent-md-primary"
                                />
                              )}
                            </td>
                            <td className="px-2 py-1.5 font-mono text-md-on-surface max-w-[140px] truncate" title={ocrTag}>
                              {ocrTag || <span className="text-md-on-surface-variant/40">—</span>}
                            </td>
                            <td className="px-2 py-1.5 font-mono max-w-[140px] truncate" title={registerTag}>
                              {registerTag ? (
                                <span className={row.actionType === 'link_pnid' ? 'text-[#3BE494]' : row.actionType === 'unlink_pnid' ? 'text-[#FFB068]' : 'text-md-on-surface-variant/40'}>
                                  {registerTag}
                                </span>
                              ) : (
                                <span className="text-[#8AB4FF] text-[9px] italic">new entity</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-md-on-surface-variant capitalize">
                              {row.entityKind}
                            </td>
                            <td className="px-2 py-1.5">
                              <span
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold"
                                style={{ background: `${badge.bg}15`, color: badge.color }}
                              >
                                <span className="material-symbols-outlined text-[10px]">{badge.icon}</span>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-[9px] text-md-on-surface-variant">
                              {confidence != null ? `${Math.round(confidence * 100)}%` : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-[9px] text-md-on-surface-variant max-w-[120px] truncate" title={row.payload?.drawingNumber}>
                              {row.payload?.drawingNumber || '—'}
                            </td>
                            <td className="px-2 py-1.5">
                              {row.status === 'applied' && (
                                <button
                                  type="button"
                                  onClick={() => setTraceItemId(traceItemId === row.id ? null : row.id)}
                                  className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${
                                    traceItemId === row.id ? 'bg-[#A855F7]/20 text-[#A855F7]' : 'text-md-on-surface-variant hover:text-[#A855F7]'
                                  }`}
                                  title="View traceability"
                                >
                                  <span className="material-symbols-outlined text-[14px]">timeline</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Action bar — single "Apply to Register" */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleApply}
                    disabled={applyStaging.isPending || !actionableSelected.length}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-30"
                    style={{ background: '#3BE494', color: '#0D1F17' }}
                  >
                    {applyStaging.isPending ? (
                      <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    )}
                    Apply to Register ({actionableSelected.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyAll}
                    disabled={applyStaging.isPending || items.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#2D33E0]/20 text-[#8AB4FF] disabled:opacity-30 transition-colors"
                  >
                    Apply all pending
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelSelected}
                    disabled={cancelStaging.isPending || !selectedItemIds.size}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-md-on-surface/8 text-md-on-surface-variant disabled:opacity-30 transition-colors"
                  >
                    Dismiss selected
                  </button>
                </div>
              </>
            )}

            {/* Coordinate preview */}
            {showCoordinatePreview && allItems.length > 0 && (
              <div className="mt-3 p-3 rounded-lg border border-[#F39C12]/20 bg-[#F39C12]/5">
                <StagingCoordinatePreview
                  items={allItems}
                  onClose={() => setShowCoordinatePreview(false)}
                />
              </div>
            )}

            {/* Traceability panel */}
            {traceItemId && platformId && (
              <div className="mt-3 p-3 rounded-lg border border-[#A855F7]/20 bg-[#A855F7]/5">
                <TagTraceabilityPanel
                  platformId={platformId}
                  itemId={traceItemId}
                  onClose={() => setTraceItemId(null)}
                />
              </div>
            )}

            {/* ── Apply result / annotation summary ── */}
            {applySummary && applySummary.applied > 0 && (
              <div className="mt-3 rounded-lg border border-[#3BE494]/30 bg-[#3BE494]/8 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="material-symbols-outlined text-[18px] text-[#3BE494]">task_alt</span>
                  <span className="text-[12px] font-bold text-[#3BE494]">Register Updated</span>
                </div>
                <div className="text-[11px] text-md-on-surface space-y-0.5">
                  <div>
                    Applied <span className="font-bold text-[#3BE494]">{applySummary.applied}</span> changes
                    {applySummary.skipped > 0 && <span className="text-md-on-surface-variant"> · {applySummary.skipped} skipped</span>}
                  </div>
                  {applySummary.appliedSummary && (
                    <div className="text-[10px] text-md-on-surface-variant flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {applySummary.appliedSummary.equipment > 0 && (
                        <span><span className="font-bold text-[#3BE494]">{applySummary.appliedSummary.equipment}</span> equipment</span>
                      )}
                      {applySummary.appliedSummary.lines > 0 && (
                        <span><span className="font-bold text-[#3BE494]">{applySummary.appliedSummary.lines}</span> lines</span>
                      )}
                      {applySummary.appliedSummary.instruments > 0 && (
                        <span><span className="font-bold text-[#3BE494]">{applySummary.appliedSummary.instruments}</span> instruments</span>
                      )}
                      {applySummary.appliedSummary.pnidIds?.length > 0 && (
                        <span>applied to <span className="font-bold text-[#3BE494]">{applySummary.appliedSummary.pnidIds.length}</span> P&ID{applySummary.appliedSummary.pnidIds.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}
                  {applySummary.coordinatesFromReview > 0 && (
                    <div className="text-[9px] text-md-on-surface-variant/70">
                      {applySummary.coordinatesFromReview} coordinates resolved from review data
                    </div>
                  )}
                </div>
                {applySummary.errors?.length > 0 && (
                  <div className="mt-1 text-[10px] text-red-400">
                    {applySummary.errors.length} error{applySummary.errors.length !== 1 ? 's' : ''}:
                    {applySummary.errors.slice(0, 3).map((e, i) => (
                      <span key={i} className="ml-1">{e.error}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inline error/cancel feedback */}
            {applyStaging.isError && (
              <div className="text-[10px] text-red-400 mt-2">{applyStaging.error?.message}</div>
            )}
            {cancelStaging.isSuccess && cancelStaging.data?.cancelled != null && (
              <div className="text-[10px] text-md-on-surface-variant mt-2">
                Dismissed {cancelStaging.data.cancelled} items
              </div>
            )}
            {cancelStaging.isError && (
              <div className="text-[10px] text-red-400 mt-1">{cancelStaging.error?.message}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
