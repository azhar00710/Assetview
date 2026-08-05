import { useState, useMemo, useEffect } from 'react';
import { md, systemColor } from '../../../lib/theme';
import { useLinkableEntities } from '../../../hooks/useAnnotations';
import { SMART_IDENT_COLORS } from '../../../hooks/useSmartIdentification';
import {
  findNearestLineParent,
  getFlowDirection,
} from './flowDirection';

const ENTITY_TABS = [
  { key: 'equipment', label: 'Equipment', color: systemColor('process'), icon: 'precision_manufacturing' },
  { key: 'instrument', label: 'Instruments', color: systemColor('instrument'), icon: 'speed' },
  { key: 'line', label: 'Lines', color: md.secondary, icon: 'linear_scale' },
];

/** Distinct presets so multiple flows are easy to tell apart on the P&ID. */
const FLOW_COLOR_PRESETS = [
  '#2D33E0', // blue (default line)
  '#00E5A0', // mint
  '#E74C3C', // red
  '#F39C12', // amber
  '#9B59B6', // purple
  '#1ABC9C', // teal
  '#E91E63', // pink
  '#3498DB', // sky
];

function entityLabel(entity, type) {
  if (type === 'line') return entity.lineNumber || entity.line_number;
  return entity.tag;
}

function entitySubLabel(entity, type) {
  if (type === 'line') return [entity.service, entity.nominalSize].filter(Boolean).join(' · ');
  return entity.type || entity.equipmentType || entity.instrumentType || '';
}

function TagAutocomplete({
  value,
  onChange,
  suggestions = [],
  onPick,
  placeholder,
  disabled = false,
  inputClassName = '',
  inputStyle = {},
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const filtered = suggestions
    .filter((item) => !q || item.label?.toLowerCase().includes(q) || item.subLabel?.toLowerCase().includes(q))
    .slice(0, 8);

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={inputClassName}
        style={inputStyle}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg overflow-hidden shadow-xl"
          style={{ background: '#1a2420', border: '1px solid rgba(59,228,148,0.25)' }}
        >
          {filtered.map((item) => (
            <button
              key={item.id || item.label}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-white/5"
            >
              <div className="text-xs font-semibold text-white">{item.label}</div>
              {item.subLabel && (
                <div className="text-[9px] text-white/40">{item.subLabel}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SegmentAssignPanel({
  pnidId,
  segment,
  segments = [],
  onAssign,
  onCreateEntity,
  onDelete,
  onClose,
  onReverseFlow,
  onRunIsolation,
  assigning = false,
  deleting = false,
}) {
  const [activeTab, setActiveTab] = useState(
    segment?.segmentType === 'line' ? 'line' : segment?.segmentType === 'circle' ? 'instrument' : 'equipment'
  );
  const [search, setSearch] = useState('');
  const [parentSegmentId, setParentSegmentId] = useState(segment?.parentSegmentId || '');
  const [manualMode, setManualMode] = useState(false);
  const [manualForm, setManualForm] = useState({
    tag: '',
    entitySubType: '',
    description: '',
    service: '',
    nominalSize: '',
  });
  const [flowColor, setFlowColor] = useState(
    segment?.displayColor || SMART_IDENT_COLORS.line
  );

  const { data: linkable, isLoading: loadingLinkable, isError: linkableError } = useLinkableEntities(pnidId);

  const isSaving = String(segment?.id || '').startsWith('temp-');
  const [saveSlow, setSaveSlow] = useState(false);
  const isLine = segment?.segmentType === 'line';
  const flowDir = segment ? getFlowDirection(segment) : null;

  useEffect(() => {
    if (!isSaving) {
      setSaveSlow(false);
      return;
    }
    const t = setTimeout(() => setSaveSlow(true), 6000);
    return () => clearTimeout(t);
  }, [isSaving, segment?.id]);

  useEffect(() => {
    if (!segment) return;
    if (segment.segmentType === 'line') setActiveTab('line');
    else if (segment.segmentType === 'circle') setActiveTab('instrument');
    else if (segment.metadata?.category === 'piping') setActiveTab('line');
    else if (segment.metadata?.category === 'valve') setActiveTab('equipment');
    else if (segment.metadata?.category === 'instrument') setActiveTab('instrument');
    else setActiveTab('equipment');
    setParentSegmentId(segment.parentSegmentId || '');
    setFlowColor(segment.displayColor || SMART_IDENT_COLORS.line);
    setSearch('');
    setManualMode(false);
    setManualForm({
      tag: '',
      entitySubType: '',
      description: '',
      service: '',
      nominalSize: '',
    });
  }, [segment?.id]);

  useEffect(() => {
    if (segment?.displayColor) setFlowColor(segment.displayColor);
  }, [segment?.displayColor]);

  useEffect(() => {
    setManualMode(false);
    setManualForm((prev) => ({
      ...prev,
      tag: search.trim() || '',
      entitySubType: '',
      description: '',
      service: '',
      nominalSize: '',
    }));
  }, [activeTab]);

  const filtered = useMemo(() => {
    if (!linkable) return [];
    const q = search.toLowerCase();
    if (activeTab === 'equipment') {
      return (linkable.equipment || []).filter((e) =>
        !q || e.tag?.toLowerCase().includes(q) || e.type?.toLowerCase().includes(q)
      );
    }
    if (activeTab === 'instrument') {
      return (linkable.instruments || []).filter((i) =>
        !q || i.tag?.toLowerCase().includes(q) || i.type?.toLowerCase().includes(q)
      );
    }
    return (linkable.lines || []).filter((l) =>
      !q || l.lineNumber?.toLowerCase().includes(q) || l.service?.toLowerCase().includes(q)
    );
  }, [linkable, activeTab, search]);

  const autocompleteSuggestions = useMemo(() => {
    if (!linkable) return [];
    const list = activeTab === 'equipment'
      ? linkable.equipment || []
      : activeTab === 'instrument'
        ? linkable.instruments || []
        : linkable.lines || [];
    return list.map((entity) => ({
      id: entity.id,
      label: entityLabel(entity, activeTab),
      subLabel: entitySubLabel(entity, activeTab),
      entity,
    }));
  }, [linkable, activeTab]);

  const parentCandidates = useMemo(() =>
    segments.filter((s) => s.id !== segment?.id && s.linkedEntityId),
  [segments, segment?.id]);

  const suggestedLineParent = useMemo(() => {
    if (!segment || isLine) return null;
    return findNearestLineParent(segments, segment);
  }, [segments, segment, isLine]);

  const effectiveParentSegment = useMemo(() => {
    if (parentSegmentId) return segments.find((s) => s.id === parentSegmentId) || null;
    return suggestedLineParent || null;
  }, [segments, parentSegmentId, suggestedLineParent]);

  const suggestedLineId = effectiveParentSegment?.linkedEntityType === 'line'
    ? effectiveParentSegment.linkedEntityId
    : null;

  const handleSelect = (entity) => {
    if (isSaving) return;
    const autoParent = !isLine && !parentSegmentId && suggestedLineParent?.id
      ? suggestedLineParent.id
      : parentSegmentId || null;

    onAssign?.({
      linkedEntityType: activeTab,
      linkedEntityId: entity.id,
      parentSegmentId: autoParent,
      label: entityLabel(entity, activeTab),
      autoParentLine: autoParent,
      ...(isLine ? { displayColor: flowColor } : {}),
    });
  };

  const handleParentChange = (newParentId) => {
    setParentSegmentId(newParentId);
    if (isSaving || assigning) return;
    if (!segment.linkedEntityId) return;
    onAssign?.({
      linkedEntityType: segment.linkedEntityType,
      linkedEntityId: segment.linkedEntityId,
      parentSegmentId: newParentId || null,
      label: segment.metadata?.label,
      ...(isLine ? { displayColor: flowColor } : {}),
    });
  };

  const handleFlowColorChange = (color) => {
    if (!color || assigning || isSaving) return;
    setFlowColor(color);
    onAssign?.({ displayColor: color });
  };

  const handleClear = () => {
    onAssign?.({
      linkedEntityType: null,
      linkedEntityId: null,
      parentSegmentId: parentSegmentId || null,
    });
  };

  const updateManualField = (field, value) => {
    setManualForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateManual = () => {
    const tag = manualForm.tag.trim();
    if (!tag || assigning || isSaving) return;
    const autoParent = !isLine && !parentSegmentId && suggestedLineParent?.id
      ? suggestedLineParent.id
      : parentSegmentId || null;
    onCreateEntity?.({
      entityType: activeTab,
      tag,
      entitySubType: manualForm.entitySubType.trim() || undefined,
      description: manualForm.description.trim() || undefined,
      service: activeTab === 'line' ? (manualForm.service.trim() || undefined) : undefined,
      nominalSize: activeTab === 'line' ? (manualForm.nominalSize.trim() || undefined) : undefined,
      lineId: activeTab !== 'line' ? suggestedLineId : null,
      parentSegmentId: autoParent,
    });
  };

  if (!segment) return null;

  const typeLabel = segment.segmentType?.charAt(0).toUpperCase() + segment.segmentType?.slice(1);
  const flowSeq = segment.metadata?.flowSequence;

  return (
    <div
      className="absolute top-3 right-3 w-[340px] max-h-[calc(100%-24px)] flex flex-col rounded-xl overflow-hidden z-30"
      style={{
        background: 'linear-gradient(180deg, #1e2a24 0%, #152018 100%)',
        border: `1px solid ${SMART_IDENT_COLORS.boundary}35`,
        boxShadow: '0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,228,148,0.08) inset',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="shrink-0 px-4 py-3"
        style={{
          background: 'linear-gradient(90deg, rgba(59,228,148,0.15) 0%, rgba(45,51,224,0.1) 100%)',
          borderBottom: `1px solid ${SMART_IDENT_COLORS.boundary}25`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]" style={{ color: SMART_IDENT_COLORS.boundary }}>
              label
            </span>
            <div>
              <div className="text-sm font-bold text-white">Assign Tag</div>
              <div className="text-[10px] text-white/50">
                {typeLabel}
                {flowSeq != null && (
                  <span className="ml-2 px-1.5 py-0.5 rounded-full font-bold" style={{ background: `${SMART_IDENT_COLORS.instrument}25`, color: SMART_IDENT_COLORS.instrument }}>
                    #{flowSeq} downstream
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(segment.id)}
                disabled={deleting || assigning}
                className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-50"
                style={{ color: SMART_IDENT_COLORS.valve }}
                title="Delete shape"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
      </div>

      {isSaving && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg text-[10px] flex items-center gap-2" style={{ background: `${md.primary}15`, color: md.primary }}>
          <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
          {saveSlow ? 'Save is slow — wait or disable snap guides.' : 'Saving shape…'}
        </div>
      )}

      {segment.linkedEntityId && (
        <div
          className="mx-3 mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2"
          style={{
            background: `${segment.displayColor || SMART_IDENT_COLORS.boundary}15`,
            border: `1px solid ${segment.displayColor || SMART_IDENT_COLORS.boundary}35`,
          }}
        >
          <span className="material-symbols-outlined text-[16px]" style={{ color: segment.displayColor || SMART_IDENT_COLORS.boundary }}>
            check_circle
          </span>
          <span className="font-semibold text-white flex-1 truncate">{segment.metadata?.label || 'Assigned'}</span>
          <button onClick={handleClear} className="text-[10px] underline text-white/50 hover:text-white" disabled={assigning}>
            Clear
          </button>
        </div>
      )}

      {/* Flow direction for lines */}
      {isLine && onReverseFlow && (
        <div className="mx-3 mt-2 px-3 py-2.5 rounded-lg" style={{ background: `${SMART_IDENT_COLORS.line}12`, border: `1px solid ${SMART_IDENT_COLORS.line}30` }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/70 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                Flow Direction
              </div>
              <div className="text-[9px] text-white/45 mt-0.5">
                Dot = origin · Arrow = downstream
              </div>
            </div>
            <button
              type="button"
              onClick={onReverseFlow}
              disabled={assigning || isSaving}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: `${SMART_IDENT_COLORS.line}25`, color: SMART_IDENT_COLORS.line, border: `1px solid ${SMART_IDENT_COLORS.line}40` }}
            >
              <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
              Reverse
            </button>
          </div>
          {flowDir && (
            <div className="mt-2 text-[9px] text-white/40 font-mono">
              pt[{flowDir.fromIdx}] → pt[{flowDir.toIdx}]
            </div>
          )}
        </div>
      )}

      {/* Flow color — distinguish multiple line flows */}
      {isLine && (
        <div className="mx-3 mt-2 px-3 py-2.5 rounded-lg" style={{ background: `${flowColor}12`, border: `1px solid ${flowColor}35` }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-white/70 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]" style={{ color: flowColor }}>palette</span>
                Flow Color
              </div>
              <div className="text-[9px] text-white/45 mt-0.5">
                Used on the line stroke and animated flow
              </div>
            </div>
            <label
              className="relative shrink-0 w-8 h-8 rounded-lg cursor-pointer overflow-hidden"
              style={{ border: `2px solid ${flowColor}`, background: flowColor }}
              title="Custom color"
            >
              <input
                type="color"
                value={flowColor}
                disabled={assigning || isSaving}
                onChange={(e) => handleFlowColorChange(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {FLOW_COLOR_PRESETS.map((c) => {
              const selected = flowColor.toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  disabled={assigning || isSaving}
                  onClick={() => handleFlowColorChange(c)}
                  className="w-6 h-6 rounded-full transition-transform hover:scale-110 disabled:opacity-50"
                  style={{
                    background: c,
                    boxShadow: selected
                      ? `0 0 0 2px #152018, 0 0 0 4px ${c}`
                      : '0 0 0 1px rgba(255,255,255,0.2)',
                  }}
                  title={c}
                  aria-label={`Flow color ${c}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Isolation action — works on geometry even before entity assignment */}
      {onRunIsolation && (
        <div className="mx-3 mt-2">
          <button
            type="button"
            onClick={() => onRunIsolation(segment)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[11px] font-bold transition-all hover:brightness-110"
            style={{
              background: 'linear-gradient(90deg, rgba(231,76,60,0.2) 0%, rgba(243,156,18,0.15) 100%)',
              color: '#F39C12',
              border: '1px solid rgba(231,76,60,0.35)',
            }}
          >
            <span className="material-symbols-outlined text-[16px]">block</span>
            Run Isolation — show downstream affected
          </button>
        </div>
      )}

      {/* Auto-suggested parent line */}
      {!isLine && suggestedLineParent && !parentSegmentId && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg text-[10px] flex items-center gap-2" style={{ background: 'rgba(45,51,224,0.12)', border: '1px solid rgba(45,51,224,0.25)' }}>
          <span className="material-symbols-outlined text-[14px]" style={{ color: SMART_IDENT_COLORS.line }}>linear_scale</span>
          <span className="text-white/70">
            Will auto-link to line: <strong className="text-white">{suggestedLineParent.metadata?.label || 'nearest pipe'}</strong>
          </span>
        </div>
      )}

      {/* Parent segment picker */}
      <div className="px-3 pt-2 pb-1">
        <label className="text-[9px] font-bold uppercase tracking-widest text-white/45">
          Parent line / equipment
        </label>
        <select
          value={parentSegmentId}
          onChange={(e) => handleParentChange(e.target.value)}
          disabled={assigning || isSaving}
          className="w-full mt-1.5 text-xs rounded-lg px-3 py-2"
          style={{
            background: 'rgba(0,0,0,0.25)',
            color: 'white',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <option value="">— No parent —</option>
          {parentCandidates.map((s) => (
            <option key={s.id} value={s.id}>
              {s.metadata?.label || s.linkedEntityType} ({s.segmentType})
            </option>
          ))}
        </select>
        <p className="text-[9px] mt-1 text-white/35">
          Child tags are ranked by position along flow — farther downstream gets a higher number.
        </p>
      </div>

      {/* Entity tabs */}
      <div className="flex gap-1.5 px-3 py-2 shrink-0">
        {ENTITY_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-[9px] font-bold transition-all"
            style={{
              background: activeTab === tab.key ? `${tab.color}20` : 'rgba(255,255,255,0.04)',
              color: activeTab === tab.key ? tab.color : 'rgba(255,255,255,0.45)',
              border: `1px solid ${activeTab === tab.key ? `${tab.color}50` : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-2 shrink-0">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-white/30 z-10 pointer-events-none">search</span>
          <TagAutocomplete
            value={search}
            onChange={setSearch}
            suggestions={autocompleteSuggestions}
            onPick={(item) => {
              if (item.entity) handleSelect(item.entity);
              else setSearch(item.label || '');
            }}
            placeholder="Search tag register…"
            disabled={assigning || isSaving}
            inputClassName="w-full text-xs rounded-lg pl-9 pr-3 py-2"
            inputStyle={{
              background: 'rgba(0,0,0,0.25)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[9px] text-white/35">
            Can&apos;t find it? Create it here and assign it immediately.
          </p>
          <button
            type="button"
            onClick={() => {
              setManualMode((prev) => !prev);
              setManualForm((prev) => ({ ...prev, tag: prev.tag || search.trim() || '' }));
            }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg"
            style={{
              background: manualMode ? `${SMART_IDENT_COLORS.boundary}20` : 'rgba(255,255,255,0.04)',
              color: manualMode ? SMART_IDENT_COLORS.boundary : 'rgba(255,255,255,0.65)',
              border: `1px solid ${manualMode ? `${SMART_IDENT_COLORS.boundary}45` : 'rgba(255,255,255,0.08)'}`,
            }}
          >
            {manualMode ? 'Hide manual add' : `Add missing ${activeTab}`}
          </button>
        </div>
      </div>

      {manualMode && (
        <div className="mx-3 mb-2 p-3 rounded-xl shrink-0" style={{ background: 'rgba(59,228,148,0.06)', border: '1px solid rgba(59,228,148,0.18)' }}>
          <div className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: SMART_IDENT_COLORS.boundary }}>
            Create missing {activeTab}
          </div>
          <div className="space-y-2">
            <TagAutocomplete
              value={manualForm.tag}
              onChange={(val) => updateManualField('tag', val)}
              suggestions={autocompleteSuggestions}
              onPick={(item) => {
                if (item.entity) {
                  updateManualField('tag', entityLabel(item.entity, activeTab));
                  if (activeTab === 'line') {
                    updateManualField('service', item.entity.service || '');
                    updateManualField('nominalSize', item.entity.nominalSize || '');
                  } else {
                    updateManualField('entitySubType', item.entity.type || item.entity.equipmentType || '');
                    updateManualField('description', item.entity.description || '');
                  }
                } else {
                  updateManualField('tag', item.label || '');
                }
              }}
              placeholder={activeTab === 'line' ? 'Line number' : 'Tag'}
              disabled={assigning || isSaving}
              inputClassName="w-full text-xs rounded-lg px-3 py-2"
              inputStyle={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            {activeTab === 'line' ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={manualForm.service}
                  onChange={(e) => updateManualField('service', e.target.value)}
                  placeholder="Service"
                  className="w-full text-xs rounded-lg px-3 py-2"
                  style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <input
                  type="text"
                  value={manualForm.nominalSize}
                  onChange={(e) => updateManualField('nominalSize', e.target.value)}
                  placeholder='Nominal size'
                  className="w-full text-xs rounded-lg px-3 py-2"
                  style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
            ) : (
              <input
                type="text"
                value={manualForm.entitySubType}
                onChange={(e) => updateManualField('entitySubType', e.target.value)}
                placeholder={activeTab === 'equipment' ? 'Equipment type' : 'Instrument type'}
                className="w-full text-xs rounded-lg px-3 py-2"
                style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
              />
            )}
            <input
              type="text"
              value={manualForm.description}
              onChange={(e) => updateManualField('description', e.target.value)}
              placeholder="Description (optional)"
              className="w-full text-xs rounded-lg px-3 py-2"
              style={{ background: 'rgba(0,0,0,0.25)', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}
            />
            {activeTab !== 'line' && suggestedLineId && (
              <div className="text-[9px] text-white/45">
                This new {activeTab} will also be linked to the selected parent line.
              </div>
            )}
            <button
              type="button"
              onClick={handleCreateManual}
              disabled={assigning || isSaving || !manualForm.tag.trim()}
              className="w-full px-3 py-2 rounded-lg text-[11px] font-bold disabled:opacity-50"
              style={{ background: `${SMART_IDENT_COLORS.boundary}20`, color: SMART_IDENT_COLORS.boundary, border: `1px solid ${SMART_IDENT_COLORS.boundary}40` }}
            >
              Create and assign
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 pb-3 min-h-0">
        {loadingLinkable ? (
          <p className="text-[10px] text-center py-6 text-white/40">Loading register…</p>
        ) : linkableError ? (
          <p className="text-[10px] text-center py-6" style={{ color: SMART_IDENT_COLORS.valve }}>
            Could not load entities
          </p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-[10px] text-white/40">No matching {activeTab}</p>
            {!manualMode && (
              <button
                type="button"
                onClick={() => {
                  setManualMode(true);
                  setManualForm((prev) => ({ ...prev, tag: prev.tag || search.trim() || '' }));
                }}
                className="mt-2 text-[10px] underline"
                style={{ color: SMART_IDENT_COLORS.boundary }}
              >
                Create it manually
              </button>
            )}
          </div>
        ) : (
          filtered.slice(0, 50).map((entity) => (
            <button
              key={entity.id}
              onClick={() => handleSelect(entity)}
              disabled={assigning || isSaving}
              className="w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-all hover:brightness-110 disabled:opacity-50 group"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="text-xs font-bold text-white group-hover:text-white">{entityLabel(entity, activeTab)}</div>
              <div className="text-[9px] text-white/40 mt-0.5">
                {activeTab === 'line'
                  ? [entity.service, entity.nominalSize].filter(Boolean).join(' · ')
                  : entity.type || entity.equipmentType}
              </div>
            </button>
          ))
        )}
      </div>

      {assigning && (
        <div className="px-3 py-2 text-[10px] text-center shrink-0 flex items-center justify-center gap-2" style={{ color: SMART_IDENT_COLORS.boundary }}>
          <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
          Saving…
        </div>
      )}
    </div>
  );
}
