import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLinkableEntities } from '../../hooks/useAnnotations';
import {
  MIN_SEARCH_CHARS,
  buildTagSearchIndex,
  filterTagSearch,
  buildEntityTagLookup,
  resolveEntityRelations,
  ENTITY_COLORS_MAP,
} from './pnidTagSearchUtils';

const ENTITY_COLORS = ENTITY_COLORS_MAP;

const ENTITY_ICONS = {
  equipment: 'precision_manufacturing',
  instrument: 'speed',
  line: 'linear_scale',
};

export default function PnidTagSearch({
  pnidId,
  overlay,
  smartIdentSegments = [],
  onSelectTag,
  className = '',
}) {
  const inputRef = useRef(null);
  const rootRef = useRef(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const { data: linkable } = useLinkableEntities(pnidId);

  const searchIndex = useMemo(
    () => buildTagSearchIndex(linkable, overlay),
    [linkable, overlay],
  );
  const tagLookup = useMemo(
    () => buildEntityTagLookup(linkable, overlay),
    [linkable, overlay],
  );

  const results = useMemo(() => {
    const filtered = filterTagSearch(searchIndex, query);
    return filtered.map((item) => ({
      ...item,
      relations: resolveEntityRelations(item.id, item.entityType, smartIdentSegments, tagLookup),
    }));
  }, [searchIndex, query, smartIdentSegments, tagLookup]);

  const showDropdown = focused && query.trim().length >= MIN_SEARCH_CHARS;

  const handleSelect = useCallback((item) => {
    onSelectTag?.(item);
    setFocused(false);
    setActiveIndex(-1);
    setQuery(item.tag || '');
  }, [onSelectTag]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (!showDropdown || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter' && activeIndex >= 0 && results[activeIndex]) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    }
  }, [showDropdown, results, activeIndex, handleSelect]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey
        && document.activeElement?.tagName !== 'INPUT'
        && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <span className="material-symbols-outlined absolute left-2.5 text-[16px] text-md-on-surface-variant pointer-events-none">
          search
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={`Search tag on P&ID (${MIN_SEARCH_CHARS}+ chars, /)`}
          className="w-full h-8 pl-9 pr-8 rounded-lg bg-md-surface-container-high border border-md-outline-variant/30 text-md-on-surface text-[11px] placeholder-md-on-surface-variant focus:border-md-primary/50 focus:outline-none transition-colors"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(''); setActiveIndex(-1); inputRef.current?.focus(); }}
            className="absolute right-2 w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
          >
            <span className="material-symbols-outlined text-[14px] text-md-on-surface-variant">close</span>
          </button>
        )}
      </div>

      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-md-surface-container border border-md-outline-variant/30 rounded-lg shadow-xl max-h-80 overflow-y-auto z-[60]"
        >
          {results.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-md-on-surface-variant">
              No tags matching &ldquo;{query}&rdquo; on this P&ID
            </div>
          ) : results.map((item, i) => {
            const color = ENTITY_COLORS[item.entityType] || '#D3DFE2';
            const icon = ENTITY_ICONS[item.entityType] || 'tag';
            const rel = item.relations;
            const relCount = (rel?.parent ? 1 : 0) + (rel?.children?.length || 0);
            return (
              <button
                key={`${item.entityType}-${item.id}`}
                type="button"
                className={`w-full px-3 py-2.5 flex items-start gap-2.5 text-left hover:bg-white/5 transition-colors ${
                  i === activeIndex ? 'bg-white/10' : ''
                }`}
                onClick={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="material-symbols-outlined text-[16px] mt-0.5 shrink-0" style={{ color }}>
                  {icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono font-semibold text-md-on-surface truncate">
                      {item.tag}
                    </span>
                    <span
                      className="text-[9px] font-semibold uppercase px-1 py-0.5 rounded"
                      style={{ background: `${color}20`, color }}
                    >
                      {item.entityType}
                    </span>
                    {item.hasPosition ? (
                      <span className="text-[8px] font-semibold text-md-primary">ON SHEET</span>
                    ) : (
                      <span className="text-[8px] text-md-on-surface-variant">not positioned</span>
                    )}
                  </div>
                  {(item.subType || item.description) && (
                    <div className="text-[9px] text-md-on-surface-variant truncate mt-0.5">
                      {[item.subType, item.description].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {rel && relCount > 0 && (
                    <div className="text-[9px] text-md-on-surface-variant mt-1 space-y-0.5">
                      {rel.parent && (
                        <div>
                          <span className="text-md-secondary font-semibold">Parent:</span>{' '}
                          {rel.parent.label}
                        </div>
                      )}
                      {rel.children?.length > 0 && (
                        <div>
                          <span className="text-md-primary font-semibold">Children:</span>{' '}
                          {rel.children.map((c) => c.label).join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
