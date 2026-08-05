import { useState, useRef, useEffect, useCallback } from 'react';
import { useAnnotationSearch } from '../../hooks/useAnnotationSearch';
import useAnnotationWorkspace from '../../hooks/useAnnotationWorkspace';

const ENTITY_COLORS = {
  equipment: '#3BE494',
  instrument: '#FFD466',
  line: '#8AB4FF',
};

const ENTITY_ICONS = {
  equipment: 'precision_manufacturing',
  instrument: 'sensors',
  line: 'horizontal_rule',
};

export default function TagSearchBar({ platformId }) {
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const {
    searchQuery, setSearchQuery, searchScope, setSearchScope,
    filterChips, addFilterChip, removeFilterChip, clearFilterChips,
    selectedPnidId, selectEntity, highlightEntity, selectPnid,
  } = useAnnotationWorkspace();

  const { data: results = [], isLoading } = useAnnotationSearch(searchQuery, {
    platformId,
    pnidId: searchScope === 'current' ? selectedPnidId : undefined,
  });

  // Keyboard shortcut: / to focus
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      handleSelect(results[activeIndex]);
    }
  }, [activeIndex, results]);

  const handleSelect = (result) => {
    selectEntity(result.id, result.entityType);
    // If result has position on current P&ID, highlight it
    const currentPnidPos = result.pnids?.find(p => p.pnidId === selectedPnidId && p.hasPosition);
    if (currentPnidPos) {
      // Will be resolved to actual position in workspace
      highlightEntity(result.id, null);
    } else if (result.pnids?.length > 0) {
      // Switch to the P&ID where this entity exists
      const firstPnid = result.pnids[0];
      if (firstPnid.pnidId !== selectedPnidId) {
        selectPnid(firstPnid.pnidId, null);
      }
      highlightEntity(result.id, null);
    }
    setFocused(false);
    setActiveIndex(-1);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showDropdown = focused && searchQuery.length >= 1;

  return (
    <div className="relative flex-1 max-w-2xl">
      <div className="relative flex items-center">
        <span className="material-symbols-outlined absolute left-3 text-[18px] text-[#919A9B] pointer-events-none">
          search
        </span>
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setActiveIndex(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search tags, equipment, instruments, lines... ( / )"
          className="w-full h-9 pl-10 pr-28 rounded-lg bg-[#16352B] border border-[#919A9B]/20 text-[#D3DFE2] text-[11px] placeholder-[#919A9B] focus:border-[#3BE494]/50 focus:outline-none transition-colors"
        />
        {/* Scope toggle */}
        <div className="absolute right-2 flex items-center gap-1">
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); clearFilterChips(); }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px] text-[#919A9B]">close</span>
            </button>
          )}
          <button
            onClick={() => setSearchScope(searchScope === 'current' ? 'platform' : 'current')}
            className="px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              background: searchScope === 'platform' ? '#3BE49420' : 'transparent',
              color: searchScope === 'platform' ? '#3BE494' : '#919A9B',
              border: `1px solid ${searchScope === 'platform' ? '#3BE49440' : '#919A9B30'}`,
            }}
            title={searchScope === 'current' ? 'Searching current P&ID' : 'Searching all P&IDs'}
          >
            {searchScope === 'current' ? 'This P&ID' : 'All P&IDs'}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      {filterChips.length > 0 && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {filterChips.map((chip, i) => (
            <span
              key={`${chip.type}-${chip.value}-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold"
              style={{ background: `${ENTITY_COLORS[chip.value] || '#3BE494'}20`, color: ENTITY_COLORS[chip.value] || '#3BE494' }}
            >
              {chip.label}
              <button onClick={() => removeFilterChip(chip.type, chip.value)} className="hover:opacity-70">
                <span className="material-symbols-outlined text-[10px]">close</span>
              </button>
            </span>
          ))}
          <button onClick={clearFilterChips} className="text-[9px] text-[#919A9B] hover:text-[#D3DFE2] ml-1">
            Clear all
          </button>
        </div>
      )}

      {/* Search results dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-[#111D14] border border-[#919A9B]/20 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50"
        >
          {isLoading && (
            <div className="px-3 py-4 text-center text-[11px] text-[#919A9B]">Searching...</div>
          )}
          {!isLoading && results.length === 0 && searchQuery.length >= 1 && (
            <div className="px-3 py-4 text-center text-[11px] text-[#919A9B]">
              No results for "{searchQuery}"
            </div>
          )}
          {!isLoading && results.map((r, i) => {
            const color = ENTITY_COLORS[r.entityType] || '#D3DFE2';
            const icon = ENTITY_ICONS[r.entityType] || 'tag';
            const hasPos = r.pnids?.some(p => p.hasPosition);
            const onCurrentPnid = r.pnids?.some(p => p.pnidId === selectedPnidId);
            return (
              <button
                key={`${r.entityType}-${r.id}`}
                className={`w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-white/5 transition-colors ${
                  i === activeIndex ? 'bg-white/10' : ''
                }`}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="material-symbols-outlined text-[16px]" style={{ color }}>
                  {icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-semibold text-[#D3DFE2] truncate">
                      {r.tag}
                    </span>
                    <span className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded" style={{ background: `${color}20`, color }}>
                      {r.entityType}
                    </span>
                    {r.systemCode && (
                      <span className="text-[9px] text-[#919A9B]">{r.systemCode}</span>
                    )}
                  </div>
                  {r.description && (
                    <div className="text-[9px] text-[#919A9B] truncate mt-0.5">{r.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Position status */}
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: hasPos ? '#3BE494' : '#FF897A' }}
                    title={hasPos ? 'Positioned' : 'Not positioned'}
                  />
                  {onCurrentPnid && (
                    <span className="text-[8px] text-[#3BE494] font-semibold">ON THIS P&ID</span>
                  )}
                  {!onCurrentPnid && r.pnids?.length > 0 && (
                    <span className="text-[8px] text-[#919A9B]">{r.pnids.length} P&ID{r.pnids.length > 1 ? 's' : ''}</span>
                  )}
                </div>
              </button>
            );
          })}
          {/* Quick filter buttons at bottom */}
          {results.length > 0 && (
            <div className="px-3 py-2 border-t border-[#919A9B]/10 flex gap-2">
              {['equipment', 'instrument', 'line'].map(type => {
                const count = results.filter(r => r.entityType === type).length;
                if (count === 0) return null;
                return (
                  <button
                    key={type}
                    onClick={() => addFilterChip({ type: 'entityType', value: type, label: `${type}: ${count}` })}
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                    style={{ background: `${ENTITY_COLORS[type]}15`, color: ENTITY_COLORS[type] }}
                  >
                    {type} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
