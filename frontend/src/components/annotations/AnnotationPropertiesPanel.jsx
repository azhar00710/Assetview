import { useMemo, useCallback } from 'react';
import useAnnotationWorkspace from '../../hooks/useAnnotationWorkspace';
import { useUpdateAnnotation, useDeleteAnnotation, useApproveAnnotation, useLinkableEntities, useBulkUpdateAnnotations, useBulkDeleteAnnotations, useBulkRevertAnnotations } from '../../hooks/useAnnotations';

const ENTITY_COLORS = { equipment: '#3BE494', instrument: '#FFD466', line: '#8AB4FF' };
const SHAPE_OPTIONS = ['rectangle', 'circle', 'diamond', 'pin'];
const STROKE_STYLES = ['solid', 'dashed', 'dotted'];
const PRESET_COLORS = [
  { label: 'Equipment', value: '#3BE494' },
  { label: 'Instrument', value: '#FFD466' },
  { label: 'Line', value: '#8AB4FF' },
  { label: 'Valve', value: '#FF897A' },
  { label: 'Safety', value: '#E74C3C' },
  { label: 'White', value: '#FFFFFF' },
];

function toShapeUpdate(annotation, shape) {
  const x = annotation.xPct || 0;
  const y = annotation.yPct || 0;
  const w = annotation.wPct || 0;
  const h = annotation.hPct || 0;
  const cx = x + w / 2;
  const cy = y + h / 2;

  if (shape === 'circle') {
    const d = Math.max(w, h) || 3;
    return { shape: 'circle', wPct: d, hPct: d, xPct: cx - d / 2, yPct: cy - d / 2 };
  }
  if (shape === 'pin') {
    return { shape: 'pin', wPct: null, hPct: null, xPct: cx, yPct: cy };
  }
  if (shape === 'diamond') {
    return { shape: 'diamond' };
  }
  return { shape: 'rectangle' };
}

export default function AnnotationPropertiesPanel({ overlay, annotations = [], pnidId }) {
  const { selectedEntityId, deselectEntity, enterPlacementMode, selectedAnnotationIds, setDrawMode, setActiveTool } = useAnnotationWorkspace();
  const updateAnnotation = useUpdateAnnotation(pnidId);
  const bulkUpdate = useBulkUpdateAnnotations(pnidId);
  const deleteAnnotation = useDeleteAnnotation(pnidId);
  const approveAnnotation = useApproveAnnotation(pnidId);
  const bulkDelete = useBulkDeleteAnnotations(pnidId);
  const bulkRevert = useBulkRevertAnnotations(pnidId);
  const { data: linkable } = useLinkableEntities(pnidId);

  // Find entity from overlay or linkable
  const entity = useMemo(() => {
    if (!selectedEntityId) return null;
    // Check overlay first (placed entities with position)
    const allOverlay = [
      ...(overlay?.equipment || []).map(e => ({ ...e, entityType: 'equipment', tag: e.tag })),
      ...(overlay?.instruments || []).map(i => ({ ...i, entityType: 'instrument', tag: i.tag })),
      ...(overlay?.lines || []).map(l => ({ ...l, entityType: 'line', tag: l.lineNumber })),
    ];
    const found = allOverlay.find(e => e.id === selectedEntityId);
    if (found) return found;
    // Check linkable (not placed yet)
    if (linkable) {
      const eq = (linkable.equipment || []).find(e => e.id === selectedEntityId);
      if (eq) return { ...eq, entityType: 'equipment', tag: eq.tag, placed: false };
      const inst = (linkable.instruments || []).find(i => i.id === selectedEntityId);
      if (inst) return { ...inst, entityType: 'instrument', tag: inst.tag, placed: false };
      const ln = (linkable.lines || []).find(l => l.id === selectedEntityId);
      if (ln) return { ...ln, entityType: 'line', tag: ln.lineNumber, placed: false };
    }
    return null;
  }, [selectedEntityId, overlay, linkable]);

  // Find linked annotation
  const annotation = useMemo(() => {
    if (!selectedEntityId) return null;
    return annotations.find(a => a.linkedEntityId === selectedEntityId) || null;
  }, [selectedEntityId, annotations]);
  const selectedAnnotations = useMemo(() => {
    const ids = selectedAnnotationIds ? Array.from(selectedAnnotationIds) : [];
    if (ids.length === 0) return [];
    return annotations.filter(a => ids.includes(a.id));
  }, [selectedAnnotationIds, annotations]);
  const bulkMode = selectedAnnotations.length > 1;

  const isApproved = annotation?.approvalStatus === 'approved';
  const canEdit = !!annotation && !isApproved;
  const hasPosition = entity?.xPct != null && entity?.yPct != null;
  const entityColor = ENTITY_COLORS[entity?.entityType] || '#D3DFE2';
  const source = entity?.source || (annotation?.metadata?.source === 'ocr' ? 'ai' : annotation ? 'manual' : null);

  const handleColorChange = useCallback((color) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, color });
  }, [canEdit, annotation, updateAnnotation]);

  const handleStrokeChange = useCallback((strokeWidth) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, strokeWidth });
  }, [canEdit, annotation, updateAnnotation]);

  const handleShapeChange = useCallback((shape) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, ...toShapeUpdate(annotation, shape) });
  }, [canEdit, annotation, updateAnnotation]);

  const handleRotationChange = useCallback((rotation) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, rotation: Number(rotation) });
  }, [canEdit, annotation, updateAnnotation]);

  const handleFillOpacityChange = useCallback((fillOpacity) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, fillOpacity: Number(fillOpacity) / 100 });
  }, [canEdit, annotation, updateAnnotation]);

  const handleStrokeStyleChange = useCallback((strokeStyle) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, strokeStyle });
  }, [canEdit, annotation, updateAnnotation]);

  const handleShowLabelChange = useCallback((showLabel) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, showLabel });
  }, [canEdit, annotation, updateAnnotation]);

  const handlePositionChange = useCallback((field, value) => {
    if (!canEdit || !annotation) return;
    const num = parseFloat(value);
    if (isNaN(num) || num < 0 || num > 100) return;
    updateAnnotation.mutate({ annotationId: annotation.id, [field]: num });
  }, [canEdit, annotation, updateAnnotation]);

  const handleStatusChange = useCallback((status) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, status });
  }, [canEdit, annotation, updateAnnotation]);

  const handleNoteChange = useCallback((text) => {
    if (!canEdit) return;
    updateAnnotation.mutate({ annotationId: annotation.id, text });
  }, [canEdit, annotation, updateAnnotation]);

  const handleApprove = useCallback((approve) => {
    if (!annotation) return;
    approveAnnotation.mutate({ annotationId: annotation.id, approve });
  }, [annotation, approveAnnotation]);

  const handleDelete = useCallback((alsoDeleteEntity = false) => {
    if (!annotation || isApproved) return;
    const msg = alsoDeleteEntity
      ? 'Delete this annotation AND the linked tag/entity from the database?'
      : 'Delete this annotation? (the tag will remain in the database)';
    if (!confirm(msg)) return;
    deleteAnnotation.mutate({ annotationId: annotation.id, deleteEntity: alsoDeleteEntity });
    deselectEntity();
  }, [annotation, isApproved, deleteAnnotation, deselectEntity]);

  const applyBulk = useCallback((updates) => {
    if (!selectedAnnotations.length) return;
    bulkUpdate.mutate({
      annotationIds: selectedAnnotations.map(a => a.id),
      updates,
    });
  }, [selectedAnnotations, bulkUpdate]);

  if (bulkMode) {
    const draftCount = selectedAnnotations.filter(a => a.approvalStatus !== 'approved').length;
    return (
      <div className="flex flex-col h-full bg-[#111D14] border-l border-[#919A9B]/10">
        <div className="px-3 py-2 border-b border-[#919A9B]/10">
          <span className="text-[11px] font-semibold text-[#D3DFE2]">{selectedAnnotations.length} annotations selected</span>
          <p className="text-[9px] text-[#919A9B] mt-1">Bulk edit properties and workflow state.</p>
        </div>
        <div className="p-3 space-y-2">
          <Row title="Color">
            {PRESET_COLORS.slice(0, 5).map(c => (
              <button key={c.value} onClick={() => applyBulk({ color: c.value })} className="w-5 h-5 rounded-full border border-white/20" style={{ background: c.value }} />
            ))}
          </Row>
          <Row title="Stroke">
            {[1, 2, 3, 4].map(s => (
              <button key={s} onClick={() => applyBulk({ strokeWidth: s })} className="px-2 py-1 text-[10px] rounded bg-[#0D1F17] text-[#D3DFE2]">{s}px</button>
            ))}
          </Row>
          <Row title="Opacity">
            <button onClick={() => applyBulk({ fillOpacity: 0.15 })} className="px-2 py-1 text-[10px] rounded bg-[#0D1F17] text-[#D3DFE2]">15%</button>
            <button onClick={() => applyBulk({ fillOpacity: 0.35 })} className="px-2 py-1 text-[10px] rounded bg-[#0D1F17] text-[#D3DFE2]">35%</button>
            <button onClick={() => applyBulk({ fillOpacity: 0.6 })} className="px-2 py-1 text-[10px] rounded bg-[#0D1F17] text-[#D3DFE2]">60%</button>
          </Row>
          <Row title="Shape">
            {SHAPE_OPTIONS.map(s => (
              <button key={s} onClick={() => applyBulk({ shape: s })} className="px-2 py-1 text-[10px] rounded bg-[#0D1F17] text-[#D3DFE2] capitalize">{s}</button>
            ))}
          </Row>
          <div className="pt-2 border-t border-[#919A9B]/10 space-y-1.5">
            <div className="flex gap-2">
              <button onClick={() => selectedAnnotations.forEach(a => a.approvalStatus !== 'approved' && approveAnnotation.mutate({ annotationId: a.id, approve: true }))} disabled={!draftCount} className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#22c55e]/15 text-[#22c55e] disabled:opacity-40">Approve All</button>
              <button onClick={() => {
                const approvedIds = selectedAnnotations.filter(a => a.approvalStatus === 'approved').map(a => a.id);
                if (approvedIds.length && confirm(`Revert ${approvedIds.length} approved annotation(s) to draft?`)) bulkRevert.mutate({ annotationIds: approvedIds });
              }} disabled={selectedAnnotations.length - draftCount === 0} className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#F39C12]/10 text-[#F39C12] disabled:opacity-40">Revert All</button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                const ids = selectedAnnotations.filter(a => a.approvalStatus !== 'approved').map(a => a.id);
                if (ids.length && confirm(`Delete ${ids.length} annotation(s)?`)) bulkDelete.mutate({ annotationIds: ids });
              }} disabled={!draftCount} className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#E74C3C]/10 text-[#E74C3C] disabled:opacity-40">Delete All</button>
              <button onClick={() => {
                const ids = selectedAnnotations.filter(a => a.approvalStatus !== 'approved').map(a => a.id);
                if (ids.length && confirm(`Delete ${ids.length} annotation(s) AND their linked tags from the database?`)) bulkDelete.mutate({ annotationIds: ids, deleteEntities: true });
              }} disabled={!draftCount} className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#E74C3C]/20 text-[#E74C3C] disabled:opacity-40">Delete + Tags</button>
            </div>
          </div>
          <button
            onClick={() => {
              applyBulk({ color: '#3BE494', strokeWidth: 2, fillOpacity: 0.15, strokeStyle: 'solid', showLabel: true });
            }}
            className="w-full py-1.5 rounded text-[10px] font-semibold bg-[#8AB4FF]/10 text-[#8AB4FF]"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    );
  }

  if (!entity) {
    return (
      <div className="flex flex-col h-full bg-[#111D14] border-l border-[#919A9B]/10">
        <div className="px-3 py-2 border-b border-[#919A9B]/10">
          <span className="text-[11px] font-semibold text-[#919A9B]">Properties</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center">
            <span className="material-symbols-outlined text-[32px] text-[#919A9B]/20">touch_app</span>
            <p className="text-[10px] text-[#919A9B] mt-2">Select a tag from the list or canvas</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#111D14] border-l border-[#919A9B]/10">
      {/* Header with tag name */}
      <div className="px-3 py-2 border-b border-[#919A9B]/10 flex items-center gap-2">
        <span className="text-[13px] font-mono font-bold" style={{ color: entityColor }}>{entity.tag || entity.lineNumber}</span>
        <span className="text-[7px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: `${entityColor}20`, color: entityColor }}>
          {entity.entityType}
        </span>
        <div className="flex-1" />
        <button onClick={deselectEntity} className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10">
          <span className="material-symbols-outlined text-[14px] text-[#919A9B]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Status Banner ── */}
        {!annotation && (
          <div className="px-3 py-2 bg-[#FF897A]/8 border-b border-[#FF897A]/20">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="material-symbols-outlined text-[14px] text-[#FF897A]">warning</span>
              <span className="text-[10px] font-bold text-[#FF897A]">No annotation linked</span>
            </div>
            <p className="text-[8px] text-[#919A9B]">
              This tag exists in the register but has no annotation on this P&ID.
              {!hasPosition ? ' It also has no position on the drawing.' : ''}
            </p>
            {hasPosition && (
              <button
                onClick={() => {
                  setActiveTool('rectangle');
                  setDrawMode(true, { id: entity.id, type: entity.entityType, tag: entity.tag || entity.lineNumber });
                }}
                className="mt-1.5 w-full py-1.5 rounded text-[10px] font-semibold border border-dashed border-[#8AB4FF]/40 text-[#8AB4FF] hover:bg-[#8AB4FF]/15 transition-colors"
              >
                Annotate Tag
              </button>
            )}
            {!hasPosition && (
              <button
                onClick={() => enterPlacementMode({ id: entity.id, type: entity.entityType, tag: entity.tag || entity.lineNumber })}
                className="mt-1.5 w-full py-1.5 rounded text-[10px] font-semibold bg-[#FF897A]/15 text-[#FF897A] hover:bg-[#FF897A]/25 transition-colors"
              >
                Place on Drawing
              </button>
            )}
          </div>
        )}

        {isApproved && (
          <div className="px-3 py-1.5 bg-[#22c55e]/8 border-b border-[#22c55e]/20 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[12px] text-[#22c55e]">lock</span>
            <span className="text-[9px] text-[#22c55e] font-semibold">Approved — revert to draft to edit</span>
          </div>
        )}

        {/* ── Identity ── */}
        <Section title="Identity" icon="badge">
          <Field label="Tag" value={entity.tag || entity.lineNumber} mono />
          <Field label="Type" value={entity.entityType} badge badgeColor={entityColor} />
          {(entity.subType || entity.equipmentType || entity.instrumentType) && (
            <Field label="Sub-type" value={entity.subType || entity.equipmentType || entity.instrumentType} />
          )}
          {entity.systemCode && <Field label="System" value={entity.systemCode} badge badgeColor="#A855F7" />}
          {entity.description && <Field label="Description" value={entity.description} />}
          {entity.criticality && <Field label="Criticality" value={entity.criticality} />}
          {entity.scadaTag && <Field label="SCADA" value={entity.scadaTag} mono />}
        </Section>

        {/* ── Appearance (only if annotation exists) ── */}
        {annotation && (
          <Section title="Appearance" icon="palette">
            <div className="mb-2">
              <div className="text-[9px] text-[#919A9B] mb-1">Color</div>
              <div className="flex gap-1.5 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button key={c.value} onClick={() => handleColorChange(c.value)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                      annotation.color === c.value ? 'border-white scale-110' : 'border-transparent'
                    } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{ background: c.value }} title={c.label} disabled={!canEdit}
                  />
                ))}
                {canEdit && (
                  <input type="color" value={annotation.color || '#3BE494'} onChange={(e) => handleColorChange(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 p-0" title="Custom color" />
                )}
              </div>
            </div>
            <div className="mb-2">
              <div className="text-[9px] text-[#919A9B] mb-1">Shape</div>
              <select
                value={annotation.shape || 'rectangle'}
                onChange={(e) => handleShapeChange(e.target.value)}
                disabled={!canEdit}
                className="w-full h-7 px-2 rounded bg-[#0D1F17] border border-[#919A9B]/20 text-[10px] text-[#D3DFE2] capitalize"
              >
                {SHAPE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="mb-2">
              <div className="text-[9px] text-[#919A9B] mb-1">Stroke Width</div>
              <div className="flex gap-1">
                {[1, 2, 3, 4].map(s => (
                  <button key={s} onClick={() => handleStrokeChange(s)} disabled={!canEdit}
                    className={`w-6 h-6 rounded flex items-center justify-center ${
                      annotation.strokeWidth === s ? 'bg-[#3BE494]/20 text-[#3BE494]' : 'text-[#919A9B] hover:text-[#D3DFE2]'
                    } ${!canEdit ? 'opacity-50' : ''}`}
                  >
                    <div className="rounded-full" style={{ width: s * 2 + 2, height: s * 2 + 2, background: 'currentColor' }} />
                  </button>
                ))}
              </div>
              {/* Rotation */}
              <div>
                <div className="text-[9px] text-[#919A9B] mb-1">Rotation</div>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min="0" max="360" step="5"
                    value={annotation.rotation || 0}
                    onChange={(e) => handleRotationChange(e.target.value)}
                    disabled={!canEdit}
                    className="flex-1 h-1 accent-[#3BE494]"
                  />
                  <span className="text-[10px] font-mono text-[#D3DFE2] w-8 text-right">{annotation.rotation || 0}°</span>
                </div>
              </div>
              <div className="mt-2">
                <div className="text-[9px] text-[#919A9B] mb-1">Opacity</div>
                <div className="flex items-center gap-2">
                  <input
                    type="range" min="0" max="100" step="5"
                    value={Math.round((annotation.fillOpacity ?? annotation.metadata?.fillOpacity ?? 0.15) * 100)}
                    onChange={(e) => handleFillOpacityChange(e.target.value)}
                    disabled={!canEdit}
                    className="flex-1 h-1 accent-[#3BE494]"
                  />
                  <span className="text-[10px] font-mono text-[#D3DFE2] w-9 text-right">
                    {Math.round((annotation.fillOpacity ?? annotation.metadata?.fillOpacity ?? 0.15) * 100)}%
                  </span>
                </div>
              </div>
              <div className="mt-2">
                <div className="text-[9px] text-[#919A9B] mb-1">Stroke style</div>
                <select
                  value={annotation.strokeStyle || annotation.metadata?.strokeStyle || 'solid'}
                  onChange={(e) => handleStrokeStyleChange(e.target.value)}
                  disabled={!canEdit}
                  className="w-full h-7 px-2 rounded bg-[#0D1F17] border border-[#919A9B]/20 text-[10px] text-[#D3DFE2] capitalize"
                >
                  {STROKE_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <label className="mt-2 flex items-center gap-2 text-[10px] text-[#D3DFE2]">
                <input
                  type="checkbox"
                  checked={annotation.showLabel !== false}
                  onChange={(e) => handleShowLabelChange(e.target.checked)}
                  disabled={!canEdit}
                  className="accent-[#3BE494]"
                />
                Show label
              </label>
            </div>
          </Section>
        )}

        {/* ── Position ── */}
        <Section title="Position & Size" icon="pin_drop">
          {hasPosition ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {[
                { label: 'X%', field: 'xPct', value: entity.xPct },
                { label: 'Y%', field: 'yPct', value: entity.yPct },
                { label: 'W%', field: 'wPct', value: entity.wPct },
                { label: 'H%', field: 'hPct', value: entity.hPct },
              ].filter(f => f.value != null).map(f => (
                <div key={f.field}>
                  <div className="text-[8px] text-[#919A9B]">{f.label}</div>
                  {canEdit ? (
                    <input
                      type="number" step="0.5" min="0" max="100"
                      defaultValue={Number(f.value).toFixed(1)}
                      onBlur={(e) => handlePositionChange(f.field, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handlePositionChange(f.field, e.target.value)}
                      className="w-full h-6 px-1.5 rounded bg-[#0D1F17] border border-[#919A9B]/20 text-[10px] font-mono text-[#D3DFE2]"
                    />
                  ) : (
                    <span className="text-[10px] font-mono text-[#D3DFE2]">{Number(f.value).toFixed(1)}%</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-1 text-center">
              <span className="material-symbols-outlined text-[16px] text-[#FF897A]/40">location_off</span>
              <p className="text-[8px] text-[#FF897A]">Not positioned</p>
            </div>
          )}
        </Section>

        {/* ── Source & Status ── */}
        {annotation && (
          <Section title="Source & Status" icon="info">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: source === 'ai' ? '#F39C1220' : source === 'import' ? '#3BE49420' : '#8AB4FF20', color: source === 'ai' ? '#F39C12' : source === 'import' ? '#3BE494' : '#8AB4FF' }}>
                {source === 'ai' ? 'OCR' : source === 'import' ? 'Import' : 'Manual'}
              </span>
              {entity.confidence != null && (
                <span className="text-[9px] text-[#F39C12]">{Math.round(entity.confidence * 100)}%</span>
              )}
            </div>
            {/* Workflow status */}
            <div className="mb-2">
              <div className="text-[9px] text-[#919A9B] mb-1">Status</div>
              <div className="flex gap-1">
                {['open', 'resolved', 'closed'].map(s => (
                  <button key={s} onClick={() => handleStatusChange(s)} disabled={!canEdit}
                    className={`px-2 py-0.5 text-[9px] rounded font-semibold capitalize transition-colors ${
                      annotation.status === s
                        ? s === 'open' ? 'bg-[#3BE494]/20 text-[#3BE494]' : s === 'resolved' ? 'bg-[#2D33E0]/20 text-[#8AB4FF]' : 'bg-[#919A9B]/20 text-[#919A9B]'
                        : 'text-[#919A9B]/50 hover:text-[#919A9B]'
                    } ${!canEdit ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >{s}</button>
                ))}
              </div>
            </div>
            <Field label="Approval" value={isApproved ? 'Approved' : 'Draft'} />
            <Field label="Created" value={annotation.createdAt ? new Date(annotation.createdAt).toLocaleDateString() : '-'} />
            <Field label="Updated" value={annotation.updatedAt ? new Date(annotation.updatedAt).toLocaleDateString() : '-'} />
            {annotation.approvedAt && <Field label="Approved" value={new Date(annotation.approvedAt).toLocaleDateString()} />}
          </Section>
        )}

        {/* ── Note ── */}
        {annotation && (
          <Section title="Note" icon="notes">
            {canEdit ? (
              <textarea
                className="w-full bg-[#0D1F17] border border-[#919A9B]/20 rounded px-2 py-1 text-[10px] text-[#D3DFE2] resize-none placeholder-[#919A9B]/50"
                rows={2} defaultValue={annotation.text || ''} placeholder="Add a note..."
                onBlur={(e) => handleNoteChange(e.target.value)}
              />
            ) : annotation.text ? (
              <p className="text-[10px] text-[#D3DFE2]">{annotation.text}</p>
            ) : (
              <p className="text-[9px] text-[#919A9B] italic">No note</p>
            )}
          </Section>
        )}

        {/* ── Actions ── */}
        <Section title="Actions" icon="bolt">
          <div className="flex flex-col gap-1.5">
            {annotation && (
              <button onClick={() => handleApprove(!isApproved)}
                className={`w-full py-1.5 rounded text-[10px] font-semibold transition-colors ${
                  isApproved ? 'bg-[#F39C12]/15 text-[#F39C12] hover:bg-[#F39C12]/25' : 'bg-[#22c55e]/15 text-[#22c55e] hover:bg-[#22c55e]/25'
                }`}
              >{isApproved ? 'Revert to Draft' : 'Approve Annotation'}</button>
            )}
            {!hasPosition && (
              <button onClick={() => enterPlacementMode({ id: entity.id, type: entity.entityType, tag: entity.tag || entity.lineNumber })}
                className="w-full py-1.5 rounded text-[10px] font-semibold bg-[#8AB4FF]/15 text-[#8AB4FF] hover:bg-[#8AB4FF]/25 transition-colors">
                Place on Drawing
              </button>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <button onClick={() => handleDelete(false)}
                  className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#E74C3C]/10 text-[#E74C3C] hover:bg-[#E74C3C]/20 transition-colors">
                  Delete Annotation
                </button>
                {annotation?.linkedEntityId && (
                  <button onClick={() => handleDelete(true)}
                    className="flex-1 py-1.5 rounded text-[10px] font-semibold bg-[#E74C3C]/20 text-[#E74C3C] hover:bg-[#E74C3C]/30 transition-colors"
                    title="Delete annotation and remove the tag from database">
                    Delete + Tag
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="px-3 py-2 border-b border-[#919A9B]/10">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="material-symbols-outlined text-[13px] text-[#919A9B]">{icon}</span>
        <span className="text-[9px] font-semibold text-[#919A9B] uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono, badge, badgeColor }) {
  if (badge) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-[9px] text-[#919A9B]">{label}</span>
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded capitalize"
          style={{ background: `${badgeColor}20`, color: badgeColor }}>{value}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[9px] text-[#919A9B]">{label}</span>
      <span className={`text-[10px] text-[#D3DFE2] ${mono ? 'font-mono' : ''} truncate max-w-[60%] text-right`}>{value}</span>
    </div>
  );
}

function Row({ title, children }) {
  return (
    <div>
      <div className="text-[9px] text-[#919A9B] mb-1">{title}</div>
      <div className="flex items-center gap-1 flex-wrap">{children}</div>
    </div>
  );
}
