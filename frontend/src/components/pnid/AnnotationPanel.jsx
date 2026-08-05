import { useState, useMemo, useRef } from 'react';
import { md, systemColor } from '../../lib/theme';
import { useLinkableEntities, useApproveAnnotation } from '../../hooks/useAnnotations';

const TYPE_CONFIG = {
  equipment: { label: 'Equipment', color: systemColor('process'), icon: 'EQ' },
  instrument: { label: 'Instruments', color: systemColor('instrument'), icon: 'IN' },
  line: { label: 'Lines', color: md.secondary, icon: 'LN' },
};

export default function AnnotationPanel({
  pnidId,
  annotations,
  overlay,
  selectedAnnotation,
  onSelectAnnotation,
  onDeleteAnnotation,
  onUpdateAnnotation,
  onPanToEntity,
  editMode = false,
  activeCategory = null,
  onCollapse,
}) {
  const [tab, setTab] = useState('registry'); // registry | repository
  const [entityFilter, setEntityFilter] = useState('all'); // all | equipment | instrument | line
  const [scopeFilter, setScopeFilter] = useState('pnid'); // pnid | all — 'pnid' shows only entities on this P&ID

  // Auto-switch entity filter and tab based on active drawing category
  const prevCat = useRef(activeCategory);
  if (activeCategory !== prevCat.current) {
    prevCat.current = activeCategory;
    if (activeCategory === 'equipment' || activeCategory === 'valve') {
      setEntityFilter('equipment');
      setTab('registry');
    } else if (activeCategory === 'instrument') {
      setEntityFilter('instrument');
      setTab('registry');
    } else if (activeCategory === 'piping') {
      setEntityFilter('line');
      setTab('registry');
    }
  }
  const [searchTerm, setSearchTerm] = useState('');
  const { data: linkable } = useLinkableEntities(pnidId);
  const approveAnnotation = useApproveAnnotation(pnidId);

  // Build entity registry: merge overlay (placed) with linkable (all available)
  const registry = useMemo(() => {
    if (!linkable) return { equipment: [], instruments: [], lines: [] };

    // Placed entity IDs from overlay
    const placedEquipIds = new Set((overlay?.equipment || []).map(e => e.id));
    const placedInstIds = new Set((overlay?.instruments || []).map(i => i.id));
    const placedLineIds = new Set((overlay?.lines || []).map(l => l.id));

    // Linked annotation entity IDs
    const linkedIds = new Set(
      annotations.filter(a => a.linkedEntityId).map(a => a.linkedEntityId)
    );

    const equipment = (linkable.equipment || []).map(e => ({
      ...e,
      entityType: 'equipment',
      placed: placedEquipIds.has(e.id),
      linked: linkedIds.has(e.id),
      overlayData: (overlay?.equipment || []).find(oe => oe.id === e.id),
    }));

    const instruments = (linkable.instruments || []).map(i => ({
      ...i,
      entityType: 'instrument',
      placed: placedInstIds.has(i.id),
      linked: linkedIds.has(i.id),
      overlayData: (overlay?.instruments || []).find(oi => oi.id === i.id),
    }));

    const lines = (linkable.lines || []).map(l => ({
      ...l,
      entityType: 'line',
      placed: placedLineIds.has(l.id),
      linked: linkedIds.has(l.id),
      overlayData: (overlay?.lines || []).find(ol => ol.id === l.id),
    }));

    return { equipment, instruments, lines };
  }, [linkable, overlay, annotations]);

  // Flat filtered list for display
  const filteredEntities = useMemo(() => {
    const q = searchTerm.toLowerCase();
    let all = [];
    if (entityFilter === 'all' || entityFilter === 'equipment') {
      all = all.concat(registry.equipment);
    }
    if (entityFilter === 'all' || entityFilter === 'instrument') {
      all = all.concat(registry.instruments);
    }
    if (entityFilter === 'all' || entityFilter === 'line') {
      all = all.concat(registry.lines);
    }
    // Scope filter: 'pnid' = only entities placed on this P&ID (from junction tables)
    if (scopeFilter === 'pnid') {
      all = all.filter(e => e.placed);
    }
    if (q) {
      all = all.filter(e =>
        (e.tag || e.lineNumber || '').toLowerCase().includes(q) ||
        (e.type || e.service || '').toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    }
    // Sort: placed first, then linked, then unlinked
    all.sort((a, b) => {
      if (a.placed !== b.placed) return a.placed ? -1 : 1;
      if (a.linked !== b.linked) return a.linked ? -1 : 1;
      return 0;
    });
    return all;
  }, [registry, entityFilter, searchTerm, scopeFilter]);

  // Stats
  const stats = useMemo(() => {
    const eqTotal = registry.equipment.length;
    const eqPlaced = registry.equipment.filter(e => e.placed).length;
    const instTotal = registry.instruments.length;
    const instPlaced = registry.instruments.filter(i => i.placed).length;
    const lnTotal = registry.lines.length;
    const lnPlaced = registry.lines.filter(l => l.placed).length;
    const total = eqTotal + instTotal + lnTotal;
    const placed = eqPlaced + instPlaced + lnPlaced;
    return { eqTotal, eqPlaced, instTotal, instPlaced, lnTotal, lnPlaced, total, placed };
  }, [registry]);

  // Count connection annotations (lines with isConnection metadata)
  const connectionCount = useMemo(() => {
    return annotations.filter(a => a.metadata?.isConnection || a.shape === 'line').length;
  }, [annotations]);

  // Repository: annotations with geometry data
  const repositoryData = useMemo(() => {
    return annotations.map(ann => {
      const entity = ann.linkedEntityType && ann.linkedEntityId
        ? filteredEntities.find(e => e.id === ann.linkedEntityId) || null
        : null;
      return { ...ann, linkedEntity: entity };
    });
  }, [annotations, filteredEntities]);

  const handleExportRepository = () => {
    const exportData = {
      pnidId,
      exportedAt: new Date().toISOString(),
      annotations: repositoryData.map(ann => ({
        id: ann.id,
        shape: ann.shape,
        geometry: {
          xPct: ann.xPct, yPct: ann.yPct,
          wPct: ann.wPct, hPct: ann.hPct,
          x2Pct: ann.x2Pct, y2Pct: ann.y2Pct,
        },
        style: { color: ann.color, strokeWidth: ann.strokeWidth },
        linkedEntity: ann.linkedEntityType ? {
          type: ann.linkedEntityType,
          id: ann.linkedEntityId,
          tag: ann.linkedEntity?.tag || ann.linkedEntity?.lineNumber || null,
        } : null,
        status: ann.status,
        text: ann.text,
        createdAt: ann.createdAt,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations-${pnidId.substring(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isOverlayEntity = selectedAnnotation?._isOverlayEntity;

  return (
    <div className="w-80 shrink-0 bg-md-surface-container border-l border-md-outline-variant/30 flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-md-outline-variant/30 items-stretch">
        {[
          { key: 'registry', label: 'Registry' },
          { key: 'repository', label: 'Repository' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-2 py-2 text-[10px] uppercase tracking-wider font-semibold ${
              tab === t.key ? 'text-md-primary border-b-2 border-md-primary' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="px-2 text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high transition-colors border-l border-md-outline-variant/20"
            title="Collapse panel"
          >
            <span className="material-symbols-outlined text-[18px]">chevron_right</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ═══ REGISTRY TAB ═══ */}
        {tab === 'registry' && (
          <div className="flex flex-col">
            {/* Coverage stats */}
            <div className="p-3 border-b border-md-outline-variant/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-md-on-surface-variant uppercase font-semibold">Coverage</span>
                <span className="text-xs font-bold" style={{ color: stats.placed === stats.total ? md.primary : md.tertiary }}>
                  {stats.placed}/{stats.total}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 bg-md-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: stats.total > 0 ? `${(stats.placed / stats.total) * 100}%` : '0%',
                    backgroundColor: stats.placed === stats.total ? md.primary : md.tertiary,
                  }}
                />
              </div>
              {/* Per-type mini stats */}
              <div className="flex gap-3 mt-2">
                {[
                  { key: 'equipment', placed: stats.eqPlaced, total: stats.eqTotal, cfg: TYPE_CONFIG.equipment },
                  { key: 'instrument', placed: stats.instPlaced, total: stats.instTotal, cfg: TYPE_CONFIG.instrument },
                  { key: 'line', placed: stats.lnPlaced, total: stats.lnTotal, cfg: TYPE_CONFIG.line },
                ].map(s => (
                  <div key={s.key} className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.cfg.color }} />
                    <span className="text-[9px] text-md-on-surface-variant">
                      {s.placed}/{s.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Search + Filter */}
            <div className="px-3 py-2 border-b border-md-outline-variant/20 flex flex-col gap-1.5">
              {/* Scope toggle: This P&ID vs All Available */}
              <div className="flex gap-0.5 bg-md-surface-container-high rounded p-0.5">
                {[
                  { key: 'pnid', label: 'This P&ID' },
                  { key: 'all', label: 'All Available' },
                ].map(s => (
                  <button
                    key={s.key}
                    onClick={() => setScopeFilter(s.key)}
                    className={`flex-1 px-1.5 py-0.5 text-[9px] rounded font-semibold transition-colors ${
                      scopeFilter === s.key
                        ? 'bg-md-primary text-md-on-primary'
                        : 'text-md-on-surface-variant hover:text-md-on-surface'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search entities..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1 text-[10px] text-md-on-surface placeholder-md-on-surface-variant"
              />
              <div className="flex gap-0.5">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'equipment', label: 'Equip', color: TYPE_CONFIG.equipment.color },
                  { key: 'instrument', label: 'Instr', color: TYPE_CONFIG.instrument.color },
                  { key: 'line', label: 'Lines', color: TYPE_CONFIG.line.color },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setEntityFilter(f.key)}
                    className={`flex-1 px-1 py-0.5 text-[9px] rounded font-semibold transition-colors ${
                      entityFilter === f.key
                        ? 'text-md-on-primary'
                        : 'text-md-on-surface-variant hover:text-md-on-surface'
                    }`}
                    style={entityFilter === f.key ? {
                      backgroundColor: f.color || md.primary,
                    } : {}}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Entity list */}
            <div className="flex flex-col">
              {filteredEntities.map(entity => {
                const cfg = TYPE_CONFIG[entity.entityType];
                const tag = entity.tag || entity.lineNumber;
                const sub = entity.type || entity.service || '';
                return (
                  <button
                    key={entity.id}
                    onClick={() => {
                      if (entity.placed && entity.overlayData) {
                        onSelectAnnotation({
                          _isOverlayEntity: true,
                          entityType: entity.entityType,
                          entity: entity.overlayData,
                        });
                        if (onPanToEntity && entity.overlayData.xPct != null) {
                          onPanToEntity(entity.overlayData.xPct, entity.overlayData.yPct);
                        }
                      }
                    }}
                    className={`text-left px-3 py-1.5 border-b border-md-outline-variant/10 hover:bg-md-surface-container-high/50 transition-colors flex items-center gap-2 ${
                      selectedAnnotation?._isOverlayEntity && selectedAnnotation?.entity?.id === entity.id
                        ? 'bg-md-primary/10' : ''
                    }`}
                  >
                    {/* Status indicator */}
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: entity.placed ? md.primary : entity.linked ? md.tertiary : md.error + '60',
                      }}
                      title={entity.placed ? 'Placed on drawing' : entity.linked ? 'Linked but no position' : 'Not placed'}
                    />
                    {/* Type badge */}
                    <span
                      className="text-[8px] font-bold shrink-0 w-4 text-center"
                      style={{ color: cfg.color }}
                    >
                      {cfg.icon}
                    </span>
                    {/* Entity info */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-bold text-md-on-surface truncate block" style={{ color: entity.placed ? cfg.color : undefined }}>
                        {tag}
                      </span>
                      {sub && <span className="text-[9px] text-md-on-surface-variant truncate block">{sub}</span>}
                    </div>
                    {/* Position badge */}
                    {entity.placed && entity.overlayData?.xPct != null && (
                      <span className="text-[8px] text-md-on-surface-variant font-mono shrink-0">
                        {Number(entity.overlayData.xPct).toFixed(0)},{Number(entity.overlayData.yPct).toFixed(0)}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredEntities.length === 0 && (
                <div className="p-4 text-center text-md-on-surface-variant text-[10px]">
                  No entities found
                </div>
              )}
            </div>

            {/* Canvas Generation Readiness */}
            <div className="p-3 border-t border-md-outline-variant/20" style={{ background: md.surfaceContainerLow }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] uppercase font-semibold tracking-wider" style={{ color: md.onSurfaceVariant }}>
                  Canvas Readiness
                </span>
                {stats.placed >= 2 && connectionCount >= 1 ? (
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: '#3BE49420', color: '#3BE494' }}>
                    Ready
                  </span>
                ) : (
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-semibold" style={{ background: '#F39C1220', color: '#F39C12' }}>
                    Incomplete
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-[9px]" style={{ color: md.onSurfaceVariant }}>
                <span>{stats.placed} entities placed</span>
                <span>{connectionCount} connections</span>
              </div>
              {stats.placed < 2 && (
                <div className="text-[8px] mt-1" style={{ color: '#F39C12' }}>
                  Place at least 2 entities to enable canvas generation
                </div>
              )}
              {stats.placed >= 2 && connectionCount < 1 && (
                <div className="text-[8px] mt-1" style={{ color: '#F39C12' }}>
                  Draw at least 1 connection (K shortcut) between entities
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ REPOSITORY TAB ═══ */}
        {tab === 'repository' && (
          <div className="flex flex-col">
            {/* Header + Export */}
            <div className="p-3 border-b border-md-outline-variant/20 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-md-on-surface-variant uppercase font-semibold">Annotation Log</p>
                <p className="text-[9px] text-md-on-surface-variant mt-0.5">{annotations.length} records</p>
              </div>
              <button
                onClick={handleExportRepository}
                className="px-2 py-1 text-[10px] font-semibold rounded transition-colors"
                style={{ backgroundColor: md.primary + '20', color: md.primary }}
              >
                Export JSON
              </button>
            </div>

            {/* Annotation records */}
            <div className="flex flex-col">
              {repositoryData.map(ann => {
                const entityCfg = ann.linkedEntityType ? TYPE_CONFIG[ann.linkedEntityType] : null;
                const isApproved = ann.approvalStatus === 'approved';
                const canDelete = editMode && !isApproved && onDeleteAnnotation;
                return (
                  <div
                    key={ann.id}
                    onClick={() => onSelectAnnotation(ann)}
                    className={`text-left px-3 py-2 border-b border-md-outline-variant/10 hover:bg-md-surface-container-high/50 transition-colors cursor-pointer group ${
                      selectedAnnotation?.id === ann.id ? 'bg-md-primary/10' : ''
                    } ${isApproved ? 'border-l-2 border-l-green-500' : 'border-l-2 border-l-amber-500/50'}`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Shape indicator */}
                      <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: ann.color, opacity: 0.7 }} />
                      {/* Linked entity tag */}
                      {ann.linkedEntity ? (
                        <span className="text-[11px] font-bold truncate" style={{ color: entityCfg?.color }}>
                          {ann.linkedEntity.tag || ann.linkedEntity.lineNumber}
                        </span>
                      ) : (
                        <span className="text-[10px] text-md-on-surface-variant italic">Unlinked</span>
                      )}
                      {/* Approval status badge */}
                      <span className={`text-[7px] font-bold px-1 py-0.5 rounded uppercase shrink-0 ${
                        isApproved ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {isApproved ? 'Approved' : 'Draft'}
                      </span>
                      <span className="text-[8px] text-md-on-surface-variant font-mono shrink-0">
                        {ann.shape}
                      </span>
                      {/* Inline delete button */}
                      {canDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteAnnotation(ann.id); }}
                          className="ml-auto opacity-0 group-hover:opacity-100 text-[9px] px-1.5 py-0.5 rounded hover:bg-red-500/20 transition-all shrink-0"
                          style={{ color: md.error }}
                          title="Delete annotation"
                        >
                          &times;
                        </button>
                      )}
                    </div>
                    {/* Geometry data */}
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[8px] text-md-on-surface-variant font-mono">
                        pos({ann.xPct?.toFixed(1)}, {ann.yPct?.toFixed(1)})
                      </span>
                      {ann.wPct && (
                        <span className="text-[8px] text-md-on-surface-variant font-mono">
                          size({ann.wPct.toFixed(1)}x{ann.hPct.toFixed(1)})
                        </span>
                      )}
                      <span className="text-[8px] text-md-on-surface-variant ml-auto">
                        {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString() : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
              {annotations.length === 0 && (
                <div className="p-4 text-center text-md-on-surface-variant text-[10px]">
                  No annotations yet. Use edit mode to place entities.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Entity detail overlay (when entity selected) ═══ */}
        {isOverlayEntity && (
          <div className="border-t border-md-outline-variant/30 bg-md-surface-container-high/50 p-3">
            <EntityDetail
              entityType={selectedAnnotation.entityType}
              entity={selectedAnnotation.entity}
            />
            <button
              onClick={() => onSelectAnnotation(null)}
              className="mt-2 w-full px-3 py-1 text-[10px] text-md-on-surface-variant hover:text-md-on-surface rounded bg-md-surface-container"
            >
              Close
            </button>
          </div>
        )}

        {/* ═══ Annotation detail overlay (when annotation selected from repository) ═══ */}
        {selectedAnnotation && !isOverlayEntity && selectedAnnotation.id && tab === 'repository' && (() => {
          const isApproved = selectedAnnotation.approvalStatus === 'approved';
          const canEdit = editMode && !isApproved;
          return (
            <div className={`border-t border-md-outline-variant/30 bg-md-surface-container-high/50 p-3 flex flex-col gap-2 ${
              isApproved ? 'border-t-green-500/50' : ''
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-md-on-surface-variant uppercase font-semibold">Detail</span>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${
                    isApproved ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {isApproved ? 'Approved' : 'Draft'}
                  </span>
                </div>
                {canEdit && onDeleteAnnotation && (
                  <button
                    onClick={() => onDeleteAnnotation(selectedAnnotation.id)}
                    className="text-[9px] px-1.5 py-0.5 rounded hover:bg-red-500/20"
                    style={{ color: md.error }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {/* Approve / Revert button */}
              {editMode && (
                <div>
                  {isApproved ? (
                    <button
                      onClick={() => approveAnnotation.mutate({ annotationId: selectedAnnotation.id, approve: false })}
                      className="w-full px-2 py-1 text-[10px] font-semibold rounded transition-colors bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                    >
                      Revert to Draft
                    </button>
                  ) : (
                    <button
                      onClick={() => approveAnnotation.mutate({ annotationId: selectedAnnotation.id, approve: true })}
                      className="w-full px-2 py-1 text-[10px] font-semibold rounded transition-colors bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    >
                      Approve Annotation
                    </button>
                  )}
                </div>
              )}
              {isApproved && (
                <p className="text-[9px] text-md-on-surface-variant italic">
                  Locked — revert to draft to edit
                </p>
              )}
              <div>
                <label className="text-[9px] text-md-on-surface-variant uppercase">Status</label>
                <div className="flex gap-1 mt-0.5">
                  {['open', 'resolved', 'closed'].map(s => (
                    <button
                      key={s}
                      onClick={() => canEdit && onUpdateAnnotation && onUpdateAnnotation(selectedAnnotation.id, { status: s })}
                      disabled={!canEdit}
                      className={`px-2 py-0.5 text-[9px] rounded font-semibold ${
                        selectedAnnotation.status === s
                          ? s === 'open' ? 'bg-md-primary/20 text-md-primary'
                            : s === 'resolved' ? 'bg-md-secondary/20 text-md-secondary'
                            : 'bg-md-on-surface-variant/20 text-md-on-surface-variant'
                          : 'text-md-on-surface-variant hover:text-md-on-surface'
                      } ${!canEdit ? 'cursor-default opacity-50' : ''}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {/* Color & Stroke editors */}
              {canEdit && onUpdateAnnotation && (
                <div className="flex flex-col gap-1.5">
                  <div>
                    <label className="text-[9px] text-md-on-surface-variant uppercase">Color</label>
                    <div className="flex gap-1 mt-0.5">
                      {['#4FE2B0', '#FFD466', '#8AB4FF', '#FF897A', '#CDB4FF', '#FFFFFF', '#333333'].map(c => (
                        <button
                          key={c}
                          onClick={() => onUpdateAnnotation(selectedAnnotation.id, { color: c })}
                          className={`w-4 h-4 rounded-full border-2 transition-transform ${
                            selectedAnnotation.color === c ? 'border-white scale-125' : 'border-md-outline-variant/30 hover:scale-110'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[9px] text-md-on-surface-variant uppercase">Stroke</label>
                    <div className="flex gap-1 mt-0.5">
                      {[1, 2, 3, 4].map(s => (
                        <button
                          key={s}
                          onClick={() => onUpdateAnnotation(selectedAnnotation.id, { strokeWidth: s })}
                          className={`w-5 h-5 rounded flex items-center justify-center ${
                            selectedAnnotation.strokeWidth === s ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant hover:text-md-on-surface'
                          }`}
                        >
                          <div className="rounded-full" style={{ width: s * 2 + 2, height: s * 2 + 2, backgroundColor: 'currentColor' }} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[8px] text-md-on-surface-variant italic mt-0.5">
                    Select annotation then drag on canvas to reposition
                  </p>
                </div>
              )}
              {canEdit && onUpdateAnnotation ? (
                <div>
                  <label className="text-[9px] text-md-on-surface-variant uppercase">Note</label>
                  <textarea
                    className="w-full mt-0.5 bg-md-surface-container border border-md-outline-variant/30 rounded px-2 py-1 text-[10px] text-md-on-surface resize-none"
                    rows={2}
                    defaultValue={selectedAnnotation.text || ''}
                    onBlur={(e) => onUpdateAnnotation(selectedAnnotation.id, { text: e.target.value })}
                    placeholder="Add a note..."
                  />
                </div>
              ) : selectedAnnotation.text ? (
                <div>
                  <label className="text-[9px] text-md-on-surface-variant uppercase">Note</label>
                  <p className="text-[10px] text-md-on-surface mt-0.5">{selectedAnnotation.text}</p>
                </div>
              ) : null}
              {selectedAnnotation.approvedAt && (
                <div className="text-[8px] text-md-on-surface-variant">
                  Approved: {new Date(selectedAnnotation.approvedAt).toLocaleDateString()}
                </div>
              )}
              <button
                onClick={() => onSelectAnnotation(null)}
                className="text-[10px] text-md-on-surface-variant hover:text-md-on-surface"
              >
                Close
              </button>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function EntityDetail({ entityType, entity }) {
  const cfg = TYPE_CONFIG[entityType];
  if (entityType === 'equipment') {
    return (
      <>
        <h3 className="text-xs font-bold" style={{ color: cfg.color }}>{entity.tag}</h3>
        <Row label="Type" value={entity.equipmentType} />
        <Row label="Description" value={entity.description} />
        <Row label="Criticality" value={entity.criticality} />
        <Row label="System" value={entity.systemCode} />
      </>
    );
  }
  if (entityType === 'instrument') {
    return (
      <>
        <h3 className="text-xs font-bold" style={{ color: cfg.color }}>{entity.tag}</h3>
        <Row label="Type" value={entity.instrumentType} />
        <Row label="Description" value={entity.description} />
        {entity.rangeMin && <Row label="Range" value={`${entity.rangeMin}-${entity.rangeMax} ${entity.rangeUnit}`} />}
        {entity.scadaTag && <Row label="SCADA" value={entity.scadaTag} />}
        <Row label="System" value={entity.systemCode} />
      </>
    );
  }
  if (entityType === 'line') {
    return (
      <>
        <h3 className="text-xs font-bold font-mono" style={{ color: cfg.color }}>{entity.lineNumber}</h3>
        <Row label="Service" value={entity.service} />
        <Row label="Size" value={entity.nominalSize} />
        <Row label="System" value={entity.systemCode} />
      </>
    );
  }
  return null;
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="mt-1">
      <span className="text-[8px] text-md-on-surface-variant uppercase">{label}</span>
      <p className="text-[10px] text-md-on-surface">{value}</p>
    </div>
  );
}
