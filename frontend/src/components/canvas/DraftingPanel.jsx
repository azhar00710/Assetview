import { useState, useEffect, useMemo, memo } from 'react';
import { md, alpha } from '../../lib/theme';

const API = import.meta.env.VITE_API_URL || '/api/v1';
const PANEL_WIDTH = 300;
const TABS = ['Lines', 'Equipment', 'Instruments'];

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 11,
        fontWeight: active ? 700 : 500,
        padding: '6px 0',
        background: active ? alpha(md.primary, 0.15) : 'transparent',
        color: active ? md.primary : md.onSurfaceVariant,
        border: 'none',
        borderBottom: active ? `2px solid ${md.primary}` : '2px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function Checkbox({ checked, onChange, label, sublabel }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        cursor: 'pointer',
        fontSize: 11,
        color: md.onSurface,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: '#3BE494', width: 14, height: 14, flexShrink: 0 }}
      />
      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{label}</span>
      {sublabel && (
        <span style={{ color: md.onSurfaceVariant, fontSize: 10, marginLeft: 'auto' }}>{sublabel}</span>
      )}
    </label>
  );
}

function GroupHeader({ label, count, allChecked, onToggle }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 0 2px',
        borderBottom: `1px solid ${md.outlineVariant}`,
      }}
    >
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={allChecked}
          onChange={onToggle}
          style={{ accentColor: '#3BE494', width: 14, height: 14 }}
        />
        <span style={{ fontSize: 10, fontWeight: 700, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
      </label>
      <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>{count}</span>
    </div>
  );
}

function DraftingPanel({ systemId, topologyNodes, topologyEdges, drafting }) {
  const [activeTab, setActiveTab] = useState(0);
  const [lines, setLines] = useState([]);
  const [draftName, setDraftName] = useState('');

  // Fetch lines for this system
  useEffect(() => {
    if (!systemId) return;
    let cancelled = false;
    fetch(`${API}/lines?system_id=${systemId}`)
      .then((r) => r.ok ? r.json() : { lines: [] })
      .then((data) => { if (!cancelled) setLines(data.lines || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [systemId]);

  // Group nodes by line
  const { equipmentByLine, instrumentsByLine, allNodeIds } = useMemo(() => {
    const eqByLine = new Map();
    const instByLine = new Map();
    const allIds = [];

    for (const node of topologyNodes) {
      allIds.push(node.id);
      const lineId = node.data?.lineId || 'standalone';
      if (node.type === 'equipment') {
        if (!eqByLine.has(lineId)) eqByLine.set(lineId, []);
        eqByLine.get(lineId).push(node);
      } else if (node.type === 'instrument') {
        if (!instByLine.has(lineId)) instByLine.set(lineId, []);
        instByLine.get(lineId).push(node);
      }
    }

    return { equipmentByLine: eqByLine, instrumentsByLine: instByLine, allNodeIds: allIds };
  }, [topologyNodes]);

  // Build line → entity mapping
  const lineEntityMap = useMemo(() => {
    const map = new Map();
    for (const node of topologyNodes) {
      const lineId = node.data?.lineId;
      if (!lineId) continue;
      if (!map.has(lineId)) map.set(lineId, []);
      map.get(lineId).push(node.id);
    }
    return map;
  }, [topologyNodes]);

  // Initialize selectedIds with all nodes when entering draft mode
  useEffect(() => {
    if (drafting.isDrafting && drafting.selectedIds.size === 0 && allNodeIds.length > 0) {
      drafting.selectAll(allNodeIds);
    }
  }, [drafting.isDrafting, allNodeIds.length]);

  const handleSelectAll = () => drafting.selectAll(allNodeIds);
  const handleDeselectAll = () => drafting.deselectAllEntities();

  const handleSave = () => {
    if (draftName.trim()) {
      drafting.saveDraft(draftName.trim());
      setDraftName('');
    }
  };

  const savedDraftNames = Object.keys(drafting.savedDrafts || {});

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        background: '#111D14',
        borderRight: `1px solid ${md.outlineVariant}`,
        zIndex: 51,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideInLeft 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: `1px solid ${md.outlineVariant}`,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: md.onSurface }}>Drafting View</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleSelectAll}
            style={{ fontSize: 10, color: md.primary, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            All
          </button>
          <button
            onClick={handleDeselectAll}
            style={{ fontSize: 10, color: md.onSurfaceVariant, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            None
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${md.outlineVariant}` }}>
        {TABS.map((tab, i) => (
          <TabButton key={tab} label={tab} active={activeTab === i} onClick={() => setActiveTab(i)} />
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        {/* Lines Tab */}
        {activeTab === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lines.map((line) => {
              const entityIds = lineEntityMap.get(line.id) || [];
              const allChecked = entityIds.length > 0 && entityIds.every((id) => drafting.selectedIds.has(id));
              return (
                <Checkbox
                  key={line.id}
                  checked={allChecked}
                  onChange={() => drafting.toggleLine(line.id, entityIds)}
                  label={line.lineNumber || line.id}
                  sublabel={line.service}
                />
              );
            })}
            {lines.length === 0 && (
              <span style={{ fontSize: 11, color: md.onSurfaceVariant }}>No lines in this system</span>
            )}
          </div>
        )}

        {/* Equipment Tab */}
        {activeTab === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...equipmentByLine.entries()].map(([lineId, eqNodes]) => {
              const lineLabel = lineId === 'standalone' ? 'Standalone' : (lines.find((l) => l.id === lineId)?.lineNumber || lineId.slice(0, 8));
              const allChecked = eqNodes.every((n) => drafting.selectedIds.has(n.id));
              return (
                <div key={lineId}>
                  <GroupHeader
                    label={lineLabel}
                    count={eqNodes.length}
                    allChecked={allChecked}
                    onToggle={() => {
                      const ids = eqNodes.map((n) => n.id);
                      for (const id of ids) drafting.toggleEntity(id);
                    }}
                  />
                  {eqNodes.map((n) => (
                    <Checkbox
                      key={n.id}
                      checked={drafting.selectedIds.has(n.id)}
                      onChange={() => drafting.toggleEntity(n.id)}
                      label={n.data?.tag || n.id}
                      sublabel={n.data?.equipmentType}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Instruments Tab */}
        {activeTab === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...instrumentsByLine.entries()].map(([lineId, instNodes]) => {
              const lineLabel = lineId === 'standalone' ? 'Standalone' : (lines.find((l) => l.id === lineId)?.lineNumber || lineId.slice(0, 8));
              const allChecked = instNodes.every((n) => drafting.selectedIds.has(n.id));
              return (
                <div key={lineId}>
                  <GroupHeader
                    label={lineLabel}
                    count={instNodes.length}
                    allChecked={allChecked}
                    onToggle={() => {
                      const ids = instNodes.map((n) => n.id);
                      for (const id of ids) drafting.toggleEntity(id);
                    }}
                  />
                  {instNodes.map((n) => (
                    <Checkbox
                      key={n.id}
                      checked={drafting.selectedIds.has(n.id)}
                      onChange={() => drafting.toggleEntity(n.id)}
                      label={n.data?.tag || n.id}
                      sublabel={n.data?.instrumentType}
                    />
                  ))}
                </div>
              );
            })}
            {instrumentsByLine.size === 0 && (
              <span style={{ fontSize: 11, color: md.onSurfaceVariant }}>No instruments in this system</span>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar: Save / Load / Reset */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: `1px solid ${md.outlineVariant}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {/* Saved drafts */}
        {savedDraftNames.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {savedDraftNames.map((name) => (
              <button
                key={name}
                onClick={() => drafting.loadDraft(name)}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: `1px solid ${md.outlineVariant}`,
                  background: md.surfaceContainerHigh,
                  color: md.onSurface,
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Save input */}
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Draft name..."
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            style={{
              flex: 1,
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 4,
              border: `1px solid ${md.outlineVariant}`,
              background: md.surfaceContainer,
              color: md.onSurface,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSave}
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 4,
              border: 'none',
              background: md.primary,
              color: '#000',
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>

        {/* Reset */}
        <button
          onClick={drafting.resetDraft}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: '6px 0',
            borderRadius: 4,
            border: `1px solid ${md.outlineVariant}`,
            background: 'transparent',
            color: md.onSurfaceVariant,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = md.surfaceContainerHigh)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Reset (Show All)
        </button>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-${PANEL_WIDTH}px); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

export default memo(DraftingPanel);
