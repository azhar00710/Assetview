import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { md, alpha } from '../../lib/theme';
import { useSearch } from '../../hooks/useApi';
import useCanvasStore from '../../canvas/store/useCanvasStore';

const TYPE_ICONS = {
  equipment: '⚙',
  instrument: '◎',
  line: '━',
  pnid: '📄',
  system: '■',
};

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10,
        fontWeight: active ? 700 : 500,
        padding: '3px 10px',
        borderRadius: 9999,
        border: `1px solid ${active ? md.primary : md.outlineVariant}`,
        background: active ? alpha(md.primary, 0.15) : 'transparent',
        color: active ? md.primary : md.onSurfaceVariant,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

export default function CanvasSearch({ platformId, onSelectNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const reactFlow = useReactFlow();
  const nodes = useCanvasStore((s) => s.nodes);

  // Filter state
  const [filterLine, setFilterLine] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [filterCrit, setFilterCrit] = useState(null);
  const setFilterState = useCanvasStore((s) => s.setFilterState);

  const { data: searchResults } = useSearch(platformId, query);

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // Derive unique lines, types, criticalities from nodes
  const { lineOptions, typeOptions, critOptions } = useMemo(() => {
    const lines = new Set();
    const types = new Set();
    const crits = new Set();
    for (const n of nodes) {
      if (n.data?.lineNumber) lines.add(n.data.lineNumber);
      const t = n.data?.equipmentType || n.data?.eqType;
      if (t) types.add(t.toLowerCase());
      if (n.data?.criticality) crits.add(n.data.criticality.toLowerCase());
    }
    return {
      lineOptions: [...lines].sort(),
      typeOptions: [...types].sort(),
      critOptions: [...crits].sort(),
    };
  }, [nodes]);

  // Sync filter state to store
  useEffect(() => {
    if (setFilterState) {
      setFilterState({ line: filterLine, equipmentType: filterType, criticality: filterCrit });
    }
  }, [filterLine, filterType, filterCrit, setFilterState]);

  const handleResultClick = useCallback(
    (result) => {
      // Find matching node in canvas
      const matchedNode = nodes.find(
        (n) => n.id === result.entityId || n.data?.tag === result.tag
      );
      if (matchedNode) {
        // Use React Flow's live node (with measured size/position) so fitView
        // centers correctly instead of zooming to a stale/empty bounds.
        const rfNode = reactFlow.getNode(matchedNode.id) || matchedNode;
        reactFlow.fitView({ nodes: [rfNode], duration: 400, padding: 0.5, maxZoom: 1.5 });
        onSelectNode?.(matchedNode);
      }
      setOpen(false);
      setQuery('');
    },
    [nodes, reactFlow, onSelectNode]
  );

  const clearAllFilters = useCallback(() => {
    setFilterLine(null);
    setFilterType(null);
    setFilterCrit(null);
  }, []);

  const hasFilters = filterLine || filterType || filterCrit;

  return (
    <div style={{ position: 'relative' }}>
      {/* Search trigger button */}
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        style={{
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 6,
          border: `1px solid ${md.outlineVariant}`,
          background: md.surfaceContainerHigh,
          color: md.onSurfaceVariant,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ fontSize: 12 }}>🔍</span>
        <span>Search</span>
        <span
          style={{
            fontSize: 9,
            color: md.outline,
            background: md.surfaceContainer,
            padding: '1px 4px',
            borderRadius: 3,
            marginLeft: 4,
          }}
        >
          ⌘K
        </span>
      </button>

      {/* Search dropdown */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            width: 340,
            background: md.surfaceContainerHigh,
            border: `1px solid ${md.outlineVariant}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {/* Input */}
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${md.outlineVariant}` }}>
            <input
              ref={inputRef}
              data-canvas-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tags, equipment, lines..."
              style={{
                width: '100%',
                background: md.surfaceContainer,
                border: 'none',
                outline: 'none',
                padding: '6px 8px',
                borderRadius: 4,
                fontSize: 12,
                color: md.onSurface,
              }}
            />
          </div>

          {/* Results */}
          {searchResults && searchResults.length > 0 && (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {searchResults.slice(0, 10).map((r) => (
                <button
                  key={r.entityId}
                  onClick={() => handleResultClick(r)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    background: 'transparent',
                    color: md.onSurface,
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = md.surfaceContainerHighest)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>
                    {TYPE_ICONS[r.entityType] || '•'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.tag}</span>
                  <span style={{ fontSize: 10, color: md.onSurfaceVariant, marginLeft: 'auto' }}>
                    {r.systemCode}
                  </span>
                </button>
              ))}
            </div>
          )}

          {query.length >= 2 && (!searchResults || searchResults.length === 0) && (
            <div style={{ padding: '12px', fontSize: 11, color: md.onSurfaceVariant, textAlign: 'center' }}>
              No results found
            </div>
          )}

          {/* Filter chips */}
          <div
            style={{
              padding: '8px 12px',
              borderTop: `1px solid ${md.outlineVariant}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: md.onSurfaceVariant, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Filter:
              </span>
              {/* Line chips */}
              {lineOptions.slice(0, 4).map((ln) => (
                <FilterChip
                  key={`line-${ln}`}
                  label={ln}
                  active={filterLine === ln}
                  onClick={() => setFilterLine(filterLine === ln ? null : ln)}
                />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {/* Type chips */}
              {typeOptions.slice(0, 4).map((t) => (
                <FilterChip
                  key={`type-${t}`}
                  label={t}
                  active={filterType === t}
                  onClick={() => setFilterType(filterType === t ? null : t)}
                />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {/* Criticality chips */}
              {critOptions.map((c) => (
                <FilterChip
                  key={`crit-${c}`}
                  label={c}
                  active={filterCrit === c}
                  onClick={() => setFilterCrit(filterCrit === c ? null : c)}
                />
              ))}
              {hasFilters && (
                <FilterChip label="Clear all" active={false} onClick={clearAllFilters} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
