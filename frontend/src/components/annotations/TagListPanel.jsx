import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import useAnnotationWorkspace from '../../hooks/useAnnotationWorkspace';
import { useLinkableEntities, useApproveAnnotation, useDeleteAnnotation, useBulkLinkPlaced, useBulkApprove, usePlaceEntity, useBulkDeleteAnnotations, useBulkRevertAnnotations } from '../../hooks/useAnnotations';

const TYPE_CONFIG = {
  equipment: { label: 'Equipment', color: '#3BE494', icon: 'precision_manufacturing', abbr: 'EQ' },
  instrument: { label: 'Instruments', color: '#FFD466', icon: 'sensors', abbr: 'IN' },
  line: { label: 'Lines', color: '#8AB4FF', icon: 'horizontal_rule', abbr: 'LN' },
};

// Entity status: approved > linked_draft > ai_positioned > placed_only > not_on_drawing
function classifyEntity(entity, linkedIds, approvedIds, annotations) {
  if (approvedIds.has(entity.id)) return 'approved';
  if (linkedIds.has(entity.id)) {
    return 'linked_draft';
  }
  if (entity.placed) {
    if (entity.source === 'ai') return 'ai_positioned';
    return 'placed_only';
  }
  return 'not_on_drawing';
}

const STATUS_CONFIG = {
  approved:       { icon: 'circle',              color: '#3BE494', label: 'Approved', priority: 0 },
  linked_draft:   { icon: 'circle',              color: '#F59E0B', label: 'Linked (Draft)', priority: 1 },
  ai_positioned:  { icon: 'circle',              color: '#8AB4FF', label: 'AI Positioned', priority: 2 },
  placed_only:    { icon: 'circle',              color: '#FFD466', label: 'Placed Only', priority: 3 },
  not_on_drawing: { icon: 'radio_button_unchecked', color: '#919A9B', label: 'Not on Drawing', priority: 4 },
};

const SOURCE_ICON = {
  ocr: { icon: 'smart_toy', color: '#8AB4FF', label: 'OCR' },
  ai: { icon: 'smart_toy', color: '#8AB4FF', label: 'OCR' },
  manual: { icon: 'edit', color: '#FFD466', label: 'Manual' },
  import: { icon: 'upload', color: '#3BE494', label: 'Import' },
  ai_positioned: { icon: 'smart_toy', color: '#8AB4FF', label: 'AI Positioned' },
};

export default function TagListPanel({ overlay, annotations = [], systems = [], pnidId, onDraftAnnotation }) {
  const [activeTab, setActiveTab] = useState('tags');
  const [entityFilter, setEntityFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('pnid');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectMode, setSelectMode] = useState(false);
  const selectedRowRef = useRef(null);

  const {
    selectedEntityId, selectEntity, highlightEntity,
    enterPlacementMode,
    selectedAnnotationIds, setSelectedAnnotationIds, selectByType, selectByState,
  } = useAnnotationWorkspace();

  const { data: linkable } = useLinkableEntities(pnidId);
  const approveAnnotation = useApproveAnnotation(pnidId);
  const deleteAnnotation = useDeleteAnnotation(pnidId);
  const bulkLink = useBulkLinkPlaced(pnidId);
  const bulkApprove = useBulkApprove(pnidId);
  const placeEntity = usePlaceEntity(pnidId);
  const bulkDelete = useBulkDeleteAnnotations(pnidId);
  const bulkRevert = useBulkRevertAnnotations(pnidId);

  // Build sets for status classification
  const { linkedIds, approvedIds } = useMemo(() => {
    const linked = new Set();
    const approved = new Set();
    for (const a of annotations) {
      if (a.linkedEntityId) {
        linked.add(a.linkedEntityId);
        if (a.approvalStatus === 'approved') approved.add(a.linkedEntityId);
      }
    }
    return { linkedIds: linked, approvedIds: approved };
  }, [annotations]);

  // Build registry: merge overlay (placed) with linkable (all available)
  const registry = useMemo(() => {
    if (!linkable) return [];
    const placedEquipIds = new Set((overlay?.equipment || []).filter(e => e.xPct != null && e.yPct != null).map(e => e.id));
    const placedInstIds = new Set((overlay?.instruments || []).filter(i => i.xPct != null && i.yPct != null).map(i => i.id));
    const placedLineIds = new Set((overlay?.lines || []).filter(l => l.xPct != null && l.yPct != null).map(l => l.id));

    const overlayMap = {};
    for (const e of (overlay?.equipment || [])) overlayMap[e.id] = e;
    for (const i of (overlay?.instruments || [])) overlayMap[i.id] = i;
    for (const l of (overlay?.lines || [])) overlayMap[l.id] = l;

    const entities = [
      ...(linkable.equipment || []).map(e => ({
        id: e.id, tag: e.tag, entityType: 'equipment', subType: e.type, description: e.description,
        placed: placedEquipIds.has(e.id) || linkedIds.has(e.id), overlay: overlayMap[e.id],
      })),
      ...(linkable.instruments || []).map(i => ({
        id: i.id, tag: i.tag, entityType: 'instrument', subType: i.type, description: i.description,
        placed: placedInstIds.has(i.id) || linkedIds.has(i.id), overlay: overlayMap[i.id],
      })),
      ...(linkable.lines || []).map(l => ({
        id: l.id, tag: l.lineNumber, entityType: 'line', subType: l.service, description: l.service,
        placed: placedLineIds.has(l.id) || linkedIds.has(l.id), overlay: overlayMap[l.id],
      })),
    ];

    return entities.map(e => ({
      ...e,
      status: classifyEntity(e, linkedIds, approvedIds, annotations),
      annotation: annotations.find(a => a.linkedEntityId === e.id) || null,
      systemCode: e.overlay?.systemCode || null,
      source: e.overlay?.source || 'manual',
      ocrTag: e.overlay?.ocrTag || null,
    }));
  }, [linkable, overlay, annotations, linkedIds, approvedIds]);

  // Apply filters
  const filteredEntities = useMemo(() => {
    let list = registry;
    if (scopeFilter === 'pnid') list = list.filter(e => e.placed);
    if (entityFilter !== 'all') list = list.filter(e => e.entityType === entityFilter);
    if (statusFilter !== 'all') list = list.filter(e => e.status === statusFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(e =>
        (e.tag || '').toLowerCase().includes(q) ||
        (e.subType || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      const pa = STATUS_CONFIG[a.status]?.priority ?? 9;
      const pb = STATUS_CONFIG[b.status]?.priority ?? 9;
      if (pa !== pb) return pa - pb;
      return (a.tag || '').localeCompare(b.tag || '');
    });
    // If user clicked entity on drawing and filters hide it,
    // keep it visible at the top so list and canvas stay synchronized.
    if (selectedEntityId) {
      const selected = registry.find(e => e.id === selectedEntityId);
      if (selected && !list.some(e => e.id === selectedEntityId)) {
        list = [selected, ...list];
      }
    }
    return list;
  }, [registry, scopeFilter, entityFilter, statusFilter, searchTerm, selectedEntityId]);

  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedEntityId, filteredEntities.length]);

  // Stats
  const stats = useMemo(() => {
    const onPnid = registry.filter(e => e.placed);
    return {
      total: registry.length,
      onPnid: onPnid.length,
      approved: registry.filter(e => e.status === 'approved').length,
      linkedDraft: registry.filter(e => e.status === 'linked_draft').length,
      positioned: registry.filter(e => e.status === 'ai_positioned' || e.status === 'placed_only').length,
      aiPositioned: registry.filter(e => e.status === 'ai_positioned').length,
      placedOnly: registry.filter(e => e.status === 'placed_only').length,
      notOnDrawing: registry.filter(e => e.status === 'not_on_drawing').length,
    };
  }, [registry]);

  // Annotation list (for Annotations tab)
  const annotationList = useMemo(() => {
    return annotations.map(ann => ({
      ...ann,
      entity: registry.find(e => e.id === ann.linkedEntityId) || null,
    }));
  }, [annotations, registry]);

  const handleEntityClick = useCallback((entity) => {
    selectEntity(entity.id, entity.entityType);
    if (entity.placed) {
      const o = entity.overlay;
      const a = entity.annotation;
      const x = o?.xPct ?? a?.xPct;
      const y = o?.yPct ?? a?.yPct;
      if (x != null && y != null) {
        highlightEntity(entity.id, { xPct: x, yPct: y });
      }
    }
  }, [selectEntity, highlightEntity]);

  const handlePlaceClick = useCallback((e, entity) => {
    e.stopPropagation();
    enterPlacementMode({ id: entity.id, type: entity.entityType, tag: entity.tag });
  }, [enterPlacementMode]);

  const handleApprove = useCallback((e, ann, approve) => {
    e.stopPropagation();
    approveAnnotation.mutate({ annotationId: ann.id, approve });
  }, [approveAnnotation]);

  const handleDelete = useCallback((e, annId) => {
    e.stopPropagation();
    deleteAnnotation.mutate(annId);
  }, [deleteAnnotation]);

  // Create an annotation link for a placed_only entity (has junction position but no annotation)
  const handleLinkSingle = useCallback((e, entity) => {
    e.stopPropagation();
    if (!entity.overlay) return;
    const o = entity.overlay;
    placeEntity.mutate({
      entityType: entity.entityType,
      entityId: entity.id,
      xPct: o.xPct,
      yPct: o.yPct,
      wPct: o.wPct || (entity.entityType === 'instrument' ? 6 : 8),
      hPct: o.hPct || (entity.entityType === 'instrument' ? 6 : 8),
      shape: entity.entityType === 'instrument' ? 'circle' : 'rectangle',
      color: entity.entityType === 'instrument' ? '#FFD466' : entity.entityType === 'line' ? '#8AB4FF' : '#3BE494',
      strokeWidth: 2,
    });
  }, [placeEntity]);

  const toggleSelect = useCallback((entity) => {
    if (!entity.annotation?.id) return;
    const next = new Set(selectedAnnotationIds || []);
    if (next.has(entity.annotation.id)) next.delete(entity.annotation.id);
    else next.add(entity.annotation.id);
    setSelectedAnnotationIds(Array.from(next));
  }, [selectedAnnotationIds, setSelectedAnnotationIds]);

  const selectAll = useCallback(() => {
    setSelectedAnnotationIds(filteredEntities.filter(e => e.annotation?.id).map(e => e.annotation.id));
  }, [filteredEntities, setSelectedAnnotationIds]);

  const clearSelection = useCallback(() => {
    setSelectedAnnotationIds([]);
    setSelectMode(false);
  }, [setSelectedAnnotationIds]);

  const handleBulkApproveSelected = useCallback(() => {
    for (const entity of filteredEntities) {
      if (selectedAnnotationIds?.has(entity.annotation?.id) && entity.annotation && entity.status !== 'approved') {
        approveAnnotation.mutate({ annotationId: entity.annotation.id, approve: true });
      }
    }
    clearSelection();
  }, [filteredEntities, selectedAnnotationIds, approveAnnotation, clearSelection]);

  const handleBulkDeleteSelected = useCallback((deleteEntities = false) => {
    const ids = filteredEntities
      .filter(e => selectedAnnotationIds?.has(e.annotation?.id) && e.annotation && e.status !== 'approved')
      .map(e => e.annotation.id);
    if (ids.length === 0) return;
    const msg = deleteEntities
      ? `Delete ${ids.length} annotation(s) AND their tags from the database?`
      : `Delete ${ids.length} annotation(s)?`;
    if (!confirm(msg)) return;
    bulkDelete.mutate({ annotationIds: ids, deleteEntities });
    clearSelection();
  }, [filteredEntities, selectedAnnotationIds, bulkDelete, clearSelection]);

  const handleBulkRevertSelected = useCallback(() => {
    const ids = filteredEntities
      .filter(e => selectedAnnotationIds?.has(e.annotation?.id) && e.annotation && e.status === 'approved')
      .map(e => e.annotation.id);
    if (ids.length === 0) return;
    if (!confirm(`Revert ${ids.length} approved annotation(s) to draft?`)) return;
    bulkRevert.mutate({ annotationIds: ids });
    clearSelection();
  }, [filteredEntities, selectedAnnotationIds, bulkRevert, clearSelection]);

  // Count how many selected have annotations (can be approved)
  const selectedWithAnnotations = useMemo(() => {
    return filteredEntities.filter(e => selectedAnnotationIds?.has(e.annotation?.id) && e.annotation && e.status !== 'approved').length;
  }, [filteredEntities, selectedAnnotationIds]);
  const selectableCount = useMemo(() => {
    return filteredEntities.filter(e => !!e.annotation?.id).length;
  }, [filteredEntities]);

  return (
    <div className="flex flex-col h-full bg-[#111D14] border-r border-[#919A9B]/10">
      {/* Tabs */}
      <div className="flex border-b border-[#919A9B]/10 shrink-0">
        {[
          { key: 'tags', label: 'TAGS', icon: 'sell' },
          { key: 'log', label: 'LOG', icon: 'history' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 px-1 py-2 text-[9px] uppercase tracking-wider font-semibold flex items-center justify-center gap-1 transition-colors ${
              activeTab === t.key ? 'text-[#3BE494] border-b-2 border-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
            }`}
          >
            <span className="material-symbols-outlined text-[12px]">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAGS TAB ═══ */}
      {activeTab === 'tags' && (
        <>
          {/* Status summary */}
          <div className="px-3 py-2 border-b border-[#919A9B]/10 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] text-[#919A9B] uppercase font-semibold">Tags on this P&ID</span>
              <span className="text-[11px] font-bold text-[#D3DFE2]">
                {stats.onPnid}<span className="text-[#919A9B] font-normal">/{stats.total}</span>
              </span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {[
                { key: 'all', label: `All ${filteredEntities.length}`, color: '#D3DFE2' },
                { key: 'approved', label: `${stats.approved}`, icon: 'check_circle', color: '#22c55e' },
                { key: 'linked_draft', label: `${stats.linkedDraft}`, icon: 'radio_button_checked', color: '#F59E0B' },
                { key: 'ai_positioned', label: `${stats.aiPositioned}`, icon: 'radio_button_checked', color: '#8AB4FF' },
                { key: 'placed_only', label: `${stats.placedOnly}`, icon: 'radio_button_checked', color: '#FFD466' },
                { key: 'not_on_drawing', label: `${stats.notOnDrawing}`, icon: 'radio_button_unchecked', color: '#919A9B' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => setStatusFilter(s.key === statusFilter ? 'all' : s.key)}
                  title={s.key === 'all' ? 'All tags in current filtered scope' : `${STATUS_CONFIG[s.key]?.label || s.key}: ${s.label}`}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-semibold transition-colors ${
                    statusFilter === s.key ? 'ring-1 ring-white/30' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ background: `${s.color}15`, color: s.color }}
                >
                  {s.icon && <span className="material-symbols-outlined text-[10px]">{s.icon}</span>}
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 mt-2">
              <button
                onClick={() => bulkLink.mutate()}
                disabled={bulkLink.isPending || stats.positioned === 0}
                className="flex-1 py-1 rounded text-[9px] font-bold bg-[#8AB4FF]/15 text-[#8AB4FF] hover:bg-[#8AB4FF]/25 disabled:opacity-40"
              >
                {bulkLink.isPending ? 'Linking...' : `Link All (${stats.positioned})`}
              </button>
              <button
                onClick={() => bulkApprove.mutate({})}
                disabled={bulkApprove.isPending || stats.linkedDraft === 0}
                className="flex-1 py-1 rounded text-[9px] font-bold bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25 disabled:opacity-40"
              >
                {bulkApprove.isPending ? 'Approving...' : 'Approve All'}
              </button>
            </div>
          </div>

          {/* Select mode + bulk actions on selection */}
          <div className="px-3 py-1 border-b border-[#919A9B]/10 flex items-center gap-2 shrink-0">
            <button
              onClick={() => { setSelectMode(!selectMode); if (selectMode) clearSelection(); }}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold transition-colors ${
                selectMode ? 'bg-[#3BE494]/15 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
              }`}
            >
              <span className="material-symbols-outlined text-[12px]">checklist</span>
              {selectMode ? `${selectedAnnotationIds?.size || 0} selected` : 'Select'}
            </button>
            {selectMode && (
              <>
                <button onClick={selectAll} className="text-[8px] text-[#3BE494] hover:underline">All</button>
                <button onClick={clearSelection} className="text-[8px] text-[#919A9B] hover:underline">None</button>
                <button onClick={() => selectByState('draft', annotations)} className="text-[8px] text-[#F59E0B] hover:underline">Drafts</button>
                <button onClick={() => selectByType('equipment', annotations)} className="text-[8px] text-[#3BE494] hover:underline">Equipment</button>
                {(selectedAnnotationIds?.size || 0) > 0 && (
                  <>
                    <button
                      onClick={handleBulkApproveSelected}
                      disabled={selectedWithAnnotations === 0}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[10px]">done_all</span>
                      Approve ({selectedWithAnnotations})
                    </button>
                    <button
                      onClick={() => handleBulkDeleteSelected(false)}
                      disabled={selectedWithAnnotations === 0}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#E74C3C]/15 text-[#E74C3C] hover:bg-[#E74C3C]/25 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[10px]">delete</span>
                      Delete
                    </button>
                    <button
                      onClick={() => handleBulkDeleteSelected(true)}
                      disabled={selectedWithAnnotations === 0}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#E74C3C]/25 text-[#E74C3C] hover:bg-[#E74C3C]/35 disabled:opacity-40"
                      title="Delete annotations and their tags from the database"
                    >
                      <span className="material-symbols-outlined text-[10px]">delete_forever</span>
                      +Tags
                    </button>
                    <button
                      onClick={handleBulkRevertSelected}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#F39C12]/15 text-[#F39C12] hover:bg-[#F39C12]/25 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined text-[10px]">undo</span>
                      Revert
                    </button>
                  </>
                )}
                {(selectedAnnotationIds?.size || 0) === 0 && (
                  <span className="text-[8px] text-[#919A9B]">
                    {selectableCount} with geometry selectable
                  </span>
                )}
              </>
            )}
          </div>

          {/* Scope + Type + Search */}
          <div className="px-3 py-2 border-b border-[#919A9B]/10 space-y-1.5 shrink-0">
            <div className="flex gap-0.5 bg-[#0D1F17] rounded p-0.5">
              {['pnid', 'all'].map(s => (
                <button key={s} onClick={() => setScopeFilter(s)}
                  className={`flex-1 px-2 py-1 text-[9px] rounded font-semibold transition-colors ${
                    scopeFilter === s ? 'bg-[#3BE494] text-[#0D1F17]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
                  }`}
                  title={s === 'all' ? 'Show all tags across this platform, including those not on this drawing' : ''}
                >{s === 'pnid' ? `This P&ID (${stats.onPnid})` : `Platform-wide (${stats.total})`}</button>
              ))}
            </div>
            <div className="flex gap-1">
              {['all', 'equipment', 'instrument', 'line'].map(type => {
                const cfg = TYPE_CONFIG[type];
                const count = type === 'all' ? filteredEntities.length : filteredEntities.filter(e => e.entityType === type).length;
                const color = cfg?.color || '#D3DFE2';
                return (
                  <button key={type} onClick={() => setEntityFilter(type)}
                    className={`flex-1 px-1 py-1 rounded text-center transition-colors ${entityFilter === type ? 'ring-1' : 'opacity-60 hover:opacity-100'}`}
                    style={{ background: `${color}10`, color, ringColor: entityFilter === type ? color : 'transparent' }}
                  >
                    <div className="text-[10px] font-bold">{count}</div>
                    <div className="text-[7px] uppercase tracking-wider">{type === 'all' ? 'All' : cfg.abbr}</div>
                  </button>
                );
              })}
            </div>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-[#919A9B]">search</span>
              <input type="text" placeholder="Search tags..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full h-7 pl-7 pr-2 rounded bg-[#0D1F17] border border-[#919A9B]/20 text-[10px] text-[#D3DFE2] placeholder-[#919A9B]" />
            </div>
          </div>

          {/* Combined Tag + Annotation table */}
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 px-2 py-1 border-b border-[#919A9B]/10 bg-[#111D14]">
              <div className="grid grid-cols-[minmax(0,1.2fr)_52px_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[8px] uppercase tracking-wider text-[#919A9B] font-semibold">
                <span title="Register tag from entity list">Tag</span>
                <span title="Discipline type">Type</span>
                <span title="Annotation/OCR compare and linkage">Annotation</span>
                <span title="Current workflow status and available actions">Status / Action</span>
              </div>
            </div>
            {filteredEntities.map((entity, idx) => {
              // Section divider: "From other drawings" when first not_placed entity appears
              const prevEntity = idx > 0 ? filteredEntities[idx - 1] : null;
              const showDivider = scopeFilter === 'all' && entity.status === 'not_on_drawing' && (!prevEntity || prevEntity.status !== 'not_on_drawing');
              const cfg = TYPE_CONFIG[entity.entityType];
              const sc = STATUS_CONFIG[entity.status];
              const isSelected = selectedEntityId === entity.id;
              const ann = entity.annotation;
              const isApproved = entity.status === 'approved';
              const srcCfg = SOURCE_ICON[ann?.metadata?.source || entity.source] || SOURCE_ICON.manual;
              const annotationTag = ann?.text || entity.ocrTag || null;
              const hasGeometry = !!ann;
              const tagMismatch = !!annotationTag && annotationTag.trim().toUpperCase() !== (entity.tag || '').trim().toUpperCase();

              return (
                <React.Fragment key={entity.id}>
                {showDivider && (
                  <div className="px-3 py-1.5 bg-[#FF897A]/8 border-y border-[#FF897A]/15 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[12px] text-[#FF897A]">other_houses</span>
                    <span className="text-[9px] font-bold text-[#FF897A] uppercase">From other drawings ({stats.notOnDrawing})</span>
                  </div>
                )}
                <div
                  ref={isSelected ? selectedRowRef : null}
                  onClick={() => handleEntityClick(entity)}
                  className={`px-2 py-1.5 border-b border-[#919A9B]/5 cursor-pointer transition-colors group ${isSelected ? 'bg-white/8' : 'hover:bg-white/4'}`}
                  style={{ borderLeft: `3px solid ${isSelected ? cfg.color : 'transparent'}` }}
                >
                  <div className="grid grid-cols-[minmax(0,1.2fr)_52px_minmax(0,1fr)_minmax(0,1fr)] gap-2 items-center">
                    {/* TAG COLUMN */}
                    <div className="flex items-center gap-1.5 min-w-0">
                    {selectMode && (
                      <input
                        type="checkbox"
                        checked={!!entity.annotation?.id && selectedAnnotationIds?.has(entity.annotation?.id)}
                        disabled={!entity.annotation?.id}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(entity); }}
                        title={entity.annotation?.id ? 'Select annotation' : 'No geometry to select'}
                        className={`w-3 h-3 shrink-0 accent-[#3BE494] ${entity.annotation?.id ? 'cursor-pointer' : 'opacity-30 cursor-not-allowed'}`}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-mono font-bold text-[#D3DFE2] truncate">{entity.tag}</span>
                        <span className="text-[7px] font-bold px-1 py-0.5 rounded shrink-0" style={{ background: `${cfg.color}20`, color: cfg.color }}>{cfg.abbr}</span>
                      </div>
                      <div className="text-[8px] text-[#919A9B] truncate">{entity.subType || entity.description || ''}</div>
                    </div>
                    </div>

                    {/* TYPE / DISCIPLINE COLUMN */}
                    <div className="min-w-0">
                      <span
                        className="inline-flex items-center justify-center w-full text-[8px] font-bold px-1 py-0.5 rounded"
                        style={{ background: `${cfg.color}20`, color: cfg.color }}
                        title={cfg.label}
                      >
                        {cfg.abbr}
                      </span>
                    </div>

                    {/* ANNOTATION COLUMN */}
                    <div className="min-w-0">
                      {ann || annotationTag ? (
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className={`material-symbols-outlined text-[10px] shrink-0 ${hasGeometry ? 'text-[#3BE494]' : 'text-[#919A9B]'}`}
                            title={hasGeometry ? 'Geometry available' : 'No geometry yet'}
                          >
                            {hasGeometry ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                          <span
                            className="material-symbols-outlined text-[10px] shrink-0 text-[#8AB4FF]"
                            title="Tag linked to annotation/OCR extraction"
                          >
                            link
                          </span>
                          <span className="text-[9px] text-[#919A9B]" title="Register tag and annotation/OCR are connected">
                            -
                          </span>
                          {ann?.shape && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-[#0D1F17] text-[#D3DFE2] capitalize">{ann.shape}</span>
                          )}
                          {annotationTag && (
                            <span
                              className={`text-[8px] font-mono truncate ${tagMismatch ? 'text-[#F59E0B]' : 'text-[#D3DFE2]'}`}
                              title={tagMismatch ? 'OCR/annotation tag differs from register tag' : 'OCR/annotation tag matches register tag'}
                            >
                              {annotationTag}
                            </span>
                          )}
                          <span
                            className="material-symbols-outlined text-[10px] shrink-0"
                            style={{ color: srcCfg.color }}
                            title={`Source: ${srcCfg.label}`}
                          >
                            {srcCfg.icon}
                          </span>
                          <span className="text-[8px] text-[#919A9B] truncate">{srcCfg.label}</span>
                        </div>
                      ) : (
                        <span className="text-[8px] text-[#919A9B] italic">No geometry</span>
                      )}
                    </div>

                    {/* STATUS / ACTION COLUMN */}
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="material-symbols-outlined text-[12px] shrink-0" style={{ color: sc.color }} title={sc.label}>
                          {sc.icon}
                        </span>
                        <span className="text-[8px] truncate" style={{ color: sc.color }}>{sc.label}</span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entity.status === 'placed_only' && (
                        <button onClick={(e) => handleLinkSingle(e, entity)}
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#8AB4FF]/15 text-[#8AB4FF] hover:bg-[#8AB4FF]/25" title="Create annotation link">
                          Link
                        </button>
                      )}
                      {(entity.status === 'ai_positioned' || entity.status === 'placed_only') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDraftAnnotation?.(entity);
                          }}
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold border border-dashed border-[#8AB4FF]/40 text-[#8AB4FF] hover:bg-[#8AB4FF]/15"
                          title="This tag appears on this P&ID but has no annotation geometry. Click to draw one."
                        >
                          Annotate
                        </button>
                      )}
                      {entity.status === 'not_on_drawing' && (
                        <button onClick={(e) => handlePlaceClick(e, entity)}
                          className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[#FF897A]/15 text-[#FF897A] hover:bg-[#FF897A]/25" title="Place on drawing">
                          Place
                        </button>
                      )}
                      {ann && !isApproved && (
                        <button onClick={(e) => handleApprove(e, ann, true)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#22c55e]/20" title="Approve">
                          <span className="material-symbols-outlined text-[12px] text-[#22c55e]">check</span>
                        </button>
                      )}
                      {isApproved && ann && (
                        <button onClick={(e) => handleApprove(e, ann, false)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#F39C12]/20" title="Revert to draft">
                          <span className="material-symbols-outlined text-[12px] text-[#F39C12]">undo</span>
                        </button>
                      )}
                      {ann && !isApproved && (
                        <button onClick={(e) => handleDelete(e, ann.id)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#E74C3C]/20" title="Delete annotation">
                          <span className="material-symbols-outlined text-[12px] text-[#E74C3C]">delete</span>
                        </button>
                      )}
                    </div>
                    </div>
                  </div>
                </div>
                </React.Fragment>
              );
            })}
            {filteredEntities.length === 0 && (
              <div className="px-3 py-8 text-center text-[11px] text-[#919A9B]">
                {scopeFilter === 'pnid' ? 'No tags on this P&ID match filters' : 'No tags found'}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ ANNOTATIONS TAB ═══ */}
      {activeTab === 'annotations' && (
        <div className="flex-1 overflow-y-auto">
          {annotationList.some(a => !a.linkedEntityId) && (
            <div className="px-3 py-1.5 bg-[#E74C3C]/8 border-b border-[#E74C3C]/20">
              <span className="text-[9px] font-bold text-[#FF897A] uppercase">
                Unlinked ({annotationList.filter(a => !a.linkedEntityId).length})
              </span>
            </div>
          )}
          {annotationList.filter(a => !a.linkedEntityId).map(ann => (
            <AnnotationRow key={ann.id} ann={ann} onApprove={handleApprove} onDelete={handleDelete} onSelect={selectEntity} />
          ))}
          <div className="px-3 py-1.5 bg-[#3BE494]/8 border-b border-[#3BE494]/20 border-t border-[#919A9B]/10">
            <span className="text-[9px] font-bold text-[#3BE494] uppercase">
              Linked ({annotationList.filter(a => a.linkedEntityId).length})
            </span>
          </div>
          {annotationList.filter(a => a.linkedEntityId).map(ann => (
            <AnnotationRow key={ann.id} ann={ann} onApprove={handleApprove} onDelete={handleDelete} onSelect={selectEntity} />
          ))}
          {annotations.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] text-[#919A9B]">
              No annotations yet. Use Edit mode to draw and link.
            </div>
          )}
        </div>
      )}

      {/* ═══ LOG TAB ═══ */}
      {activeTab === 'log' && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#919A9B]/10 flex items-center justify-between shrink-0">
            <span className="text-[9px] text-[#919A9B] uppercase font-semibold">{annotations.length} records</span>
            <button onClick={() => {
              const data = { pnidId, exportedAt: new Date().toISOString(), annotations };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob); const a = document.createElement('a');
              a.href = url; a.download = `annotations-${(pnidId || '').substring(0, 8)}.json`; a.click(); URL.revokeObjectURL(url);
            }} className="text-[9px] font-semibold px-2 py-0.5 rounded bg-[#3BE494]/15 text-[#3BE494] hover:bg-[#3BE494]/25">
              Export JSON
            </button>
          </div>
          {annotations.map(ann => {
            const entity = registry.find(e => e.id === ann.linkedEntityId);
            const isApproved = ann.approvalStatus === 'approved';
            return (
              <div key={ann.id} className={`px-3 py-1.5 border-b border-[#919A9B]/5 text-[9px] ${isApproved ? 'border-l-2 border-l-[#22c55e]' : 'border-l-2 border-l-[#F39C12]/50'}`}>
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ann.color || '#3BE494' }} />
                  <span className="font-mono font-bold text-[#D3DFE2] truncate">{entity?.tag || 'Unlinked'}</span>
                  <span className="text-[#919A9B]">{ann.shape}</span>
                  <span className={`font-bold px-1 py-0.5 rounded ${isApproved ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#F39C12]/15 text-[#F39C12]'}`}>
                    {isApproved ? 'Approved' : 'Draft'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[#919A9B] font-mono">
                  <span>pos({ann.xPct?.toFixed(1)}, {ann.yPct?.toFixed(1)})</span>
                  {ann.wPct && <span>size({ann.wPct?.toFixed(1)}x{ann.hPct?.toFixed(1)})</span>}
                  <span className="ml-auto">{ann.createdAt ? new Date(ann.createdAt).toLocaleDateString() : ''}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnnotationRow({ ann, onApprove, onDelete, onSelect }) {
  const isApproved = ann.approvalStatus === 'approved';
  const entity = ann.entity;
  const entityCfg = ann.linkedEntityType ? TYPE_CONFIG[ann.linkedEntityType] : null;
  return (
    <div className="px-3 py-1.5 border-b border-[#919A9B]/5 hover:bg-white/4 cursor-pointer group transition-colors"
      onClick={() => entity && onSelect(entity.id, entity.entityType)}>
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: ann.color || '#3BE494', opacity: 0.8 }} />
        {entity ? (
          <span className="text-[10px] font-bold truncate" style={{ color: entityCfg?.color }}>{entity.tag}</span>
        ) : (
          <span className="text-[10px] text-[#FF897A] italic">Unlinked shape</span>
        )}
        <span className={`text-[7px] font-bold px-1 py-0.5 rounded ${isApproved ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#F39C12]/15 text-[#F39C12]'}`}>
          {isApproved ? 'Approved' : 'Draft'}
        </span>
        <span className="text-[8px] text-[#919A9B] font-mono">{ann.shape}</span>
        <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {!isApproved && (
            <button onClick={(e) => onApprove(e, ann, true)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#22c55e]/20" title="Approve">
              <span className="material-symbols-outlined text-[12px] text-[#22c55e]">check</span>
            </button>
          )}
          {isApproved && (
            <button onClick={(e) => onApprove(e, ann, false)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#F39C12]/20" title="Revert">
              <span className="material-symbols-outlined text-[12px] text-[#F39C12]">undo</span>
            </button>
          )}
          {!isApproved && (
            <button onClick={(e) => onDelete(e, ann.id)} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#E74C3C]/20" title="Delete">
              <span className="material-symbols-outlined text-[12px] text-[#E74C3C]">delete</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
