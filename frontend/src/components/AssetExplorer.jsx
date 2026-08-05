import { useState, useEffect, useMemo, useCallback } from 'react';
import { SC, M3, EC } from '../data/constants';
import SunburstChart from './SunburstChart';
import XrefNetwork from './XrefNetwork';
import ConstellationMap from './ConstellationMap';

const API = import.meta.env.VITE_API_URL || '/api/v1';

// Platform IDs now come directly from API as UUIDs

const TYPE_ICONS = {
  platform: '🏗',
  system: '⚙',
  line: '━',
  equipment: '◆',
  instrument: '◉',
  pnid: '📄',
};

const TYPE_LABELS = {
  platform: 'Platform',
  system: 'System',
  line: 'Line',
  equipment: 'Equipment',
  instrument: 'Instrument',
  pnid: 'P&ID',
};

const SYS_COLORS = {
  process: SC.process,
  utility: SC.utility,
  safety: SC.safety,
  instrument: SC.instrument,
};

export default function AssetExplorer({ platformId, platforms, onBack, onPlatformChange }) {
  const isDark = true; // Always dark mode for this branch
  const [treeData, setTreeData] = useState(null);
  const [xrefData, setXrefData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [viewMode, setViewMode] = useState('sunburst');

  // Resolve platform ID to DB UUID
  const dbPlatformId = platformId;

  // Fetch tree data
  useEffect(() => {
    if (!dbPlatformId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API}/asset-tree/${dbPlatformId}`).then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      }),
      fetch(`${API}/asset-tree/${dbPlatformId}/xref-map`).then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      }),
    ]).then(([tree, xref]) => {
      setTreeData(tree);
      setXrefData(xref);
      setSelected(null);
      setBreadcrumb([tree]);
      setLoading(false);
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  }, [dbPlatformId]);

  // Handle sunburst selection
  const handleSelect = useCallback((node) => {
    setSelected(node);
    if (!treeData) return;

    const path = [];
    function findPath(current, target) {
      path.push(current);
      if (current.name === target.name && current.type === target.type) return true;
      if (current.children) {
        for (const child of current.children) {
          if (findPath(child, target)) return true;
        }
      }
      path.pop();
      return false;
    }
    findPath(treeData, node);
    if (path.length > 0) setBreadcrumb(path);
  }, [treeData]);

  // Stats from tree data
  const stats = useMemo(() => {
    if (!treeData) return {};
    let systems = 0, lines = 0, equipment = 0, instruments = 0;
    function walk(node) {
      if (node.type === 'system') systems++;
      if (node.type === 'line') lines++;
      if (node.type === 'equipment') equipment++;
      if (node.type === 'instrument') instruments++;
      if (node.children) node.children.forEach(walk);
    }
    walk(treeData);
    return { systems, lines, equipment, instruments };
  }, [treeData]);

  // Detail panel content
  const detailContent = useMemo(() => {
    if (!selected) return null;
    const d = selected;
    const fields = [];

    fields.push({ label: 'Type', value: TYPE_LABELS[d.type] || d.type });
    if (d.fullName && d.fullName !== d.name) fields.push({ label: 'Full Name', value: d.fullName });
    if (d.sysType) fields.push({ label: 'System Type', value: d.sysType, color: SYS_COLORS[d.sysType] });
    if (d.service) fields.push({ label: 'Service', value: d.service });
    if (d.size) fields.push({ label: 'Nominal Size', value: d.size });
    if (d.equipType) fields.push({ label: 'Equipment Type', value: d.equipType });
    if (d.instType) fields.push({ label: 'Instrument Type', value: d.instType });
    if (d.criticality) fields.push({ label: 'Criticality', value: d.criticality });
    if (d.status) fields.push({ label: 'Status', value: d.status });
    if (d.drawingNumber) fields.push({ label: 'Drawing #', value: d.drawingNumber });
    if (d.pnidCount !== undefined) fields.push({ label: 'Appears on P&IDs', value: d.pnidCount });
    if (d.children) fields.push({ label: 'Children', value: d.children.length });

    return fields;
  }, [selected]);

  // Children list for selected node
  const childrenByType = useMemo(() => {
    if (!selected?.children) return {};
    const groups = {};
    for (const child of selected.children) {
      const type = child.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(child);
    }
    return groups;
  }, [selected]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-md-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-md-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-md-on-surface-variant">Loading asset tree...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-md-surface">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="text-2xl">⚠</span>
          <span className="text-sm text-md-on-surface-variant">Failed to load: {error}</span>
          <span className="text-xs text-md-on-surface-variant">Make sure the backend is running on port 3001</span>
          <button onClick={onBack} className="px-3 py-1 rounded text-xs border border-white/10 text-md-on-surface-variant hover:text-md-on-surface cursor-pointer">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-md-surface">
      {/* Header */}
      <div className="flex items-center px-4 py-2.5 bg-md-surface-container border-b border-white/[0.06] gap-3 shrink-0">
        <button
          onClick={onBack}
          className="px-2 py-1 rounded text-xs font-medium border border-white/[0.06] text-md-on-surface-variant hover:text-md-on-surface transition-colors cursor-pointer"
        >
          ← Back
        </button>

        <div className="w-px h-4 bg-white/10" />

        <h2 className="text-sm font-bold text-md-on-surface">
          Asset Explorer
        </h2>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 ml-2">
          {breadcrumb.map((node, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-[10px] text-md-on-surface-variant">›</span>}
              <span
                className={`text-[11px] font-medium ${
                  i === breadcrumb.length - 1
                    ? 'text-md-primary font-semibold'
                    : 'text-md-on-surface-variant'
                }`}
              >
                {node.name}
              </span>
            </span>
          ))}
        </nav>

        <div className="flex-1" />

        {/* View mode toggle */}
        <div className="flex rounded-lg border border-white/[0.06] overflow-hidden">
          {[
            { key: 'sunburst', label: 'Sunburst' },
            { key: 'constellation', label: 'Constellation' },
            { key: 'xref', label: 'X-Ref Network' },
          ].map(mode => (
            <button
              key={mode.key}
              onClick={() => setViewMode(mode.key)}
              className={`px-3 py-1 text-[10px] font-semibold transition-colors cursor-pointer ${
                viewMode === mode.key
                  ? 'bg-md-primary/15 text-md-primary'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Platform selector */}
        <select
          value={platformId || ''}
          onChange={e => onPlatformChange(e.target.value)}
          className="px-2 py-1 rounded text-[11px] font-medium border border-white/[0.06] bg-md-surface-container-high text-md-on-surface outline-none cursor-pointer"
        >
          {platforms?.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      </div>

      {/* Stats bar */}
      <div className="flex items-center px-4 py-1.5 gap-4 bg-md-surface-container border-b border-white/[0.06] shrink-0">
        {[
          { label: 'Systems', value: stats.systems, color: M3.primary },
          { label: 'Lines', value: stats.lines, color: EC.line },
          { label: 'Equipment', value: stats.equipment, color: EC.equipment },
          { label: 'Instruments', value: stats.instruments, color: M3.warning },
          { label: 'Cross-Refs', value: xrefData?.edges?.length || 0, color: M3.tertiary },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
            <span className="text-[10px] text-md-on-surface-variant">{s.label}</span>
            <span className="text-[11px] font-bold text-md-on-surface">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Visualization area */}
        <div className="flex-1 flex items-center justify-center overflow-auto p-4">
          {viewMode === 'sunburst' && treeData && (
            <SunburstChart
              data={treeData}
              width={620}
              height={620}
              onSelect={handleSelect}
              isDark={isDark}
            />
          )}
          {viewMode === 'constellation' && treeData && (
            <ConstellationMap
              data={treeData}
              xrefData={xrefData}
              width={960}
              height={680}
              onSelect={handleSelect}
              isDark={isDark}
            />
          )}
          {viewMode === 'xref' && xrefData && (
            <XrefNetwork
              data={xrefData}
              width={700}
              height={550}
              isDark={isDark}
              onSelectSystem={(sysCode) => {
                if (treeData?.children) {
                  const sys = treeData.children.find(c => c.name === sysCode);
                  if (sys) handleSelect(sys);
                }
              }}
            />
          )}
        </div>

        {/* Detail panel */}
        <div className="w-72 bg-md-surface-container border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0">
          {selected ? (
            <>
              {/* Selected item header */}
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{TYPE_ICONS[selected.type]}</span>
                  <div>
                    <div className="text-sm font-bold text-md-on-surface">{selected.name}</div>
                    {selected.fullName && selected.fullName !== selected.name && (
                      <div className="text-[10px] text-md-on-surface-variant">{selected.fullName}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Properties */}
              <div className="px-4 py-3 border-b border-white/[0.06] space-y-2">
                <div className="text-[10px] font-semibold tracking-wider text-md-on-surface-variant">PROPERTIES</div>
                {detailContent?.map((field, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-[11px] text-md-on-surface-variant">{field.label}</span>
                    <span className="text-[11px] font-medium text-md-on-surface" style={field.color ? { color: field.color } : {}}>
                      {field.value}
                    </span>
                  </div>
                ))}
              </div>

              {/* Children breakdown */}
              {Object.keys(childrenByType).length > 0 && (
                <div className="flex-1 overflow-auto px-4 py-3">
                  <div className="text-[10px] font-semibold tracking-wider text-md-on-surface-variant mb-2">CONTENTS</div>
                  {Object.entries(childrenByType).map(([type, items]) => (
                    <div key={type} className="mb-3">
                      <div className="text-[10px] font-semibold text-md-on-surface-variant mb-1">
                        {TYPE_LABELS[type] || type} ({items.length})
                      </div>
                      <div className="space-y-0.5">
                        {items.slice(0, 20).map((item, i) => (
                          <div
                            key={i}
                            className="px-2 py-1 rounded text-[11px] bg-md-surface-container-high text-md-on-surface cursor-pointer hover:ring-1 hover:ring-md-primary/30 transition-all"
                            onClick={() => handleSelect(item)}
                          >
                            <span className="mr-1.5 opacity-50">{TYPE_ICONS[item.type]}</span>
                            {item.name}
                          </div>
                        ))}
                        {items.length > 20 && (
                          <div className="text-[10px] text-md-on-surface-variant px-2">+{items.length - 20} more</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl mb-2 opacity-30">🎯</div>
                <div className="text-xs text-md-on-surface-variant">Click a segment to explore</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center px-4 py-1.5 gap-4 bg-md-surface-container border-t border-white/[0.06] shrink-0">
        <span className="text-[9px] font-semibold tracking-wider text-md-on-surface-variant">LEGEND</span>
        {Object.entries(SYS_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            <span className="text-[10px] capitalize text-md-on-surface-variant">{type}</span>
          </div>
        ))}
        <div className="w-px h-3 bg-white/10" />
        {[
          { type: 'line', color: EC.line },
          { type: 'equipment', color: EC.equipment },
          { type: 'instrument', color: SYS_COLORS.instrument },
        ].map(({ type, color }) => (
          <div key={type} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            <span className="text-[10px] capitalize text-md-on-surface-variant">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
