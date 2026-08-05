import { useState, useMemo, useEffect, useRef } from 'react';
import { md, systemColor } from '../../lib/theme';
import { useLinkableEntities, usePnidSystems } from '../../hooks/useAnnotations';

const ENTITY_TABS = [
  { key: 'equipment', label: 'Equipment', color: systemColor('process') },
  { key: 'instrument', label: 'Instruments', color: systemColor('instrument') },
  { key: 'line', label: 'Lines', color: md.secondary },
];

const EQUIPMENT_TYPES = [
  'Christmas Tree', 'Choke Valve', 'Safety Valve', 'Spectacle Blind',
  'Pump', 'Compressor', 'Separator', 'Heat Exchanger', 'Vessel', 'General',
];

const INSTRUMENT_TYPES = [
  'pressure', 'temperature', 'flow', 'level',
  'safety_valve', 'control_valve', 'analyzer', 'other',
];

export default function LinkDialog({ pnidId, defaultTab, onLink, onCancel, onSkip }) {
  const [activeTab, setActiveTab] = useState(defaultTab || 'equipment');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newTag, setNewTag] = useState('');
  const [newSubType, setNewSubType] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSystemId, setNewSystemId] = useState('');
  const [newService, setNewService] = useState('');
  const [newSize, setNewSize] = useState('');
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });

  const { data: linkable } = useLinkableEntities(pnidId);
  const { data: systems } = usePnidSystems(pnidId);

  // Filter entities by search
  const filtered = useMemo(() => {
    if (!linkable) return [];
    const q = search.toLowerCase();
    if (activeTab === 'equipment') {
      return (linkable.equipment || []).filter(e =>
        !q || e.tag.toLowerCase().includes(q) || e.type?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q)
      );
    }
    if (activeTab === 'instrument') {
      return (linkable.instruments || []).filter(i =>
        !q || i.tag.toLowerCase().includes(q) || i.type?.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q)
      );
    }
    if (activeTab === 'line') {
      return (linkable.lines || []).filter(l =>
        !q || l.lineNumber.toLowerCase().includes(q) || l.service?.toLowerCase().includes(q)
      );
    }
    return [];
  }, [linkable, activeTab, search]);

  const handleSelect = (entity) => {
    onLink({ entityType: activeTab, entityId: entity.id });
  };

  const handleCreate = () => {
    if (!newTag.trim()) return;
    const payload = {
      entityType: activeTab,
      entityId: null,
      tag: newTag.trim(),
      description: newDescription.trim() || undefined,
      systemId: newSystemId || undefined,
    };
    if (activeTab === 'equipment') {
      payload.entitySubType = newSubType || 'General';
    } else if (activeTab === 'instrument') {
      payload.entitySubType = newSubType || 'other';
    } else if (activeTab === 'line') {
      payload.service = newService || undefined;
      payload.nominalSize = newSize || undefined;
    }
    onLink(payload);
  };

  useEffect(() => {
    // Start near center-right so drawing remains visible behind.
    const defaultX = Math.max(40, Math.round((window.innerWidth - 480) * 0.62));
    const defaultY = Math.max(24, Math.round((window.innerHeight - 520) * 0.15));
    setPanelPos({ x: defaultX, y: defaultY });
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const x = Math.max(8, Math.min(window.innerWidth - 500, dragRef.current.baseX + dx));
      const y = Math.max(8, Math.min(window.innerHeight - 120, dragRef.current.baseY + dy));
      setPanelPos({ x, y });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50">
      <div
        className="bg-md-surface-container rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden border border-md-outline-variant/30"
        style={{ position: 'absolute', left: `${panelPos.x}px`, top: `${panelPos.y}px` }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 border-b border-md-outline-variant/30 cursor-move select-none"
          onMouseDown={(e) => {
            dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: panelPos.x, baseY: panelPos.y };
            setDragging(true);
          }}
        >
          <h3 className="text-sm font-bold text-md-on-surface">Link to Entity</h3>
          <p className="text-[10px] text-md-on-surface-variant mt-0.5">
            Select an existing entity or create a new one (drag this panel to move)
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-md-outline-variant/30">
          {ENTITY_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setShowCreate(false); setSearch(''); }}
              className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
              style={activeTab === tab.key ? { borderColor: tab.color, color: tab.color } : {}}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {!showCreate ? (
            <>
              {/* Search */}
              <input
                type="text"
                placeholder={`Search ${activeTab}...`}
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-md-surface-container-high border border-md-outline-variant/30 rounded px-3 py-1.5 text-xs text-md-on-surface placeholder-md-on-surface-variant mb-2"
                autoFocus
              />

              {/* Entity list */}
              <div className="flex flex-col gap-0.5 max-h-60 overflow-y-auto">
                {filtered.map(entity => (
                  <button
                    key={entity.id}
                    onClick={() => handleSelect(entity)}
                    className="text-left px-3 py-2 rounded hover:bg-md-primary/10 transition-colors flex items-center gap-2 group"
                  >
                    {activeTab === 'line' ? (
                      <>
                        <span className="text-xs font-bold font-mono text-md-on-surface">{entity.lineNumber}</span>
                        <span className="text-[10px] text-md-on-surface-variant">{entity.service}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-xs font-bold" style={{ color: ENTITY_TABS.find(t => t.key === activeTab)?.color }}>
                          {entity.tag}
                        </span>
                        <span className="text-[10px] text-md-on-surface-variant">{entity.type}</span>
                        {entity.description && (
                          <span className="text-[10px] text-md-on-surface-variant/60 truncate flex-1">{entity.description}</span>
                        )}
                      </>
                    )}
                    <span className="ml-auto text-[10px] text-md-primary opacity-0 group-hover:opacity-100">Select</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-[10px] text-md-on-surface-variant text-center py-4">
                    No {activeTab} found{search ? ` matching "${search}"` : ''}
                  </p>
                )}
              </div>

              {/* Create new button */}
              <button
                onClick={() => setShowCreate(true)}
                className="w-full mt-3 px-3 py-2 border border-dashed border-md-primary/40 rounded text-xs font-semibold hover:bg-md-primary/10 transition-colors"
                style={{ color: md.primary }}
              >
                + Create New {activeTab === 'line' ? 'Line' : activeTab === 'instrument' ? 'Instrument' : 'Equipment'}
              </button>
            </>
          ) : (
            /* Create new form */
            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold text-md-on-surface">
                New {activeTab === 'line' ? 'Line' : activeTab === 'instrument' ? 'Instrument' : 'Equipment'}
              </p>

              {/* Tag / Line Number */}
              <div>
                <label className="text-[10px] text-md-on-surface-variant uppercase">
                  {activeTab === 'line' ? 'Line Number' : 'Tag'}
                </label>
                <input
                  type="text"
                  value={newTag}
                  onChange={e => setNewTag(e.target.value)}
                  placeholder={activeTab === 'line' ? 'e.g. CO-6"-EC12NLD-1195AD' : 'e.g. PV019-XT'}
                  className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                  autoFocus
                />
              </div>

              {/* Type selector */}
              {activeTab === 'equipment' && (
                <div>
                  <label className="text-[10px] text-md-on-surface-variant uppercase">Type</label>
                  <select
                    value={newSubType}
                    onChange={e => setNewSubType(e.target.value)}
                    className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                  >
                    <option value="">Select type...</option>
                    {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
              {activeTab === 'instrument' && (
                <div>
                  <label className="text-[10px] text-md-on-surface-variant uppercase">Type</label>
                  <select
                    value={newSubType}
                    onChange={e => setNewSubType(e.target.value)}
                    className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                  >
                    <option value="">Select type...</option>
                    {INSTRUMENT_TYPES.map(t => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Line-specific fields */}
              {activeTab === 'line' && (
                <>
                  <div>
                    <label className="text-[10px] text-md-on-surface-variant uppercase">Service</label>
                    <input
                      type="text"
                      value={newService}
                      onChange={e => setNewService(e.target.value)}
                      placeholder="e.g. Production - Short"
                      className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-md-on-surface-variant uppercase">Nominal Size</label>
                    <input
                      type="text"
                      value={newSize}
                      onChange={e => setNewSize(e.target.value)}
                      placeholder='e.g. 6"'
                      className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                    />
                  </div>
                </>
              )}

              {/* Description */}
              {activeTab !== 'line' && (
                <div>
                  <label className="text-[10px] text-md-on-surface-variant uppercase">Description</label>
                  <input
                    type="text"
                    value={newDescription}
                    onChange={e => setNewDescription(e.target.value)}
                    placeholder="Brief description..."
                    className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                  />
                </div>
              )}

              {/* System selector */}
              {systems && systems.length > 1 && (
                <div>
                  <label className="text-[10px] text-md-on-surface-variant uppercase">System</label>
                  <select
                    value={newSystemId}
                    onChange={e => setNewSystemId(e.target.value)}
                    className="w-full mt-0.5 bg-md-surface-container-high border border-md-outline-variant/30 rounded px-2 py-1.5 text-xs text-md-on-surface"
                  >
                    <option value="">Primary system (default)</option>
                    {systems.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name} {s.isPrimary ? '(primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => setShowCreate(false)}
                className="text-[10px] text-md-on-surface-variant hover:text-md-on-surface"
              >
                &larr; Back to list
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-md-outline-variant/30 flex items-center gap-2">
          {onSkip && (
            <button
              onClick={onSkip}
              className="px-3 py-1.5 text-xs text-md-on-surface-variant hover:text-md-on-surface rounded transition-colors border border-md-outline-variant/30"
            >
              Save Without Link
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-md-on-surface-variant hover:text-md-on-surface rounded transition-colors"
          >
            Cancel
          </button>
          {showCreate && (
            <button
              onClick={handleCreate}
              disabled={!newTag.trim()}
              className="px-4 py-1.5 text-xs font-semibold rounded transition-colors disabled:opacity-30"
              style={{ backgroundColor: md.primary, color: md.onPrimary }}
            >
              Create &amp; Place
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
