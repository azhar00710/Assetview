import { useState, useRef, useEffect, useCallback } from 'react';
import { useTagSearch } from '../../hooks/useApi';
import { M3, SC } from '../../data/constants';

/**
 * TagSearchBar — Phase 0.5 Digital Index
 *
 * Type-ahead search for equipment/instrument tags.
 * Shows matching tags with their linked document counts.
 * Selecting a result triggers onSelectTag to open the TagDocumentPanel.
 *
 * Props:
 *   onSelectTag — callback(tag) when user selects a search result
 *   placeholder — optional placeholder text
 *   className   — optional additional CSS classes
 */
export default function TagSearchBar({
  onSelectTag,
  placeholder = 'Search tags...',
  className = '',
}) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const { data: results, isLoading } = useTagSearch(query);

  // Close dropdown when clicking outside
  const containerRef = useRef(null);
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  const handleSelect = useCallback(
    (tag) => {
      onSelectTag?.(tag);
      setQuery('');
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onSelectTag],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (!results?.length) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && results[activeIndex]) {
            handleSelect(results[activeIndex].tag);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          inputRef.current?.blur();
          break;
      }
    },
    [results, activeIndex, handleSelect],
  );

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const showDropdown = isOpen && query.length >= 2;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Search input */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors"
        style={{
          background: M3.surfaceContainerHigh,
          borderColor: isOpen ? `${M3.primary}50` : 'rgba(255,255,255,0.08)',
        }}
      >
        <SearchIcon color={isOpen ? M3.primary : M3.onSurfaceVariant} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-[12px]"
          style={{ color: M3.onSurface }}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-white/10 cursor-pointer text-[10px]"
            style={{ color: M3.onSurfaceVariant }}
            aria-label="Clear search"
          >
            &times;
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {showDropdown && (
        <div
          className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-white/[0.1] shadow-xl overflow-hidden z-50"
          style={{ background: M3.surfaceContainer }}
        >
          {isLoading && (
            <div className="px-3 py-3 text-center">
              <div className="text-[11px]" style={{ color: M3.onSurfaceVariant }}>
                Searching...
              </div>
            </div>
          )}

          {!isLoading && results?.length === 0 && (
            <div className="px-3 py-3 text-center">
              <div className="text-[11px]" style={{ color: M3.onSurfaceVariant }}>
                No tags matching &ldquo;{query}&rdquo;
              </div>
            </div>
          )}

          {!isLoading && results?.length > 0 && (
            <ul ref={listRef} className="max-h-64 overflow-auto py-1" role="listbox">
              {results.map((result, idx) => (
                <li
                  key={result.tag}
                  role="option"
                  aria-selected={idx === activeIndex}
                  className="px-3 py-2 cursor-pointer transition-colors"
                  style={{
                    background:
                      idx === activeIndex ? `${M3.primary}15` : 'transparent',
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => handleSelect(result.tag)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{
                          background: entityTypeColor(result.entityType),
                        }}
                      />
                      <span
                        className="text-[12px] font-semibold truncate"
                        style={{ color: M3.onSurface }}
                      >
                        {highlightMatch(result.tag, query)}
                      </span>
                    </div>
                    {result.documentCount > 0 && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 ml-2"
                        style={{
                          background: `${M3.primary}15`,
                          color: M3.primary,
                        }}
                      >
                        {result.documentCount} doc{result.documentCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {result.description && (
                    <div
                      className="text-[10px] mt-0.5 ml-3.5 truncate"
                      style={{ color: M3.onSurfaceVariant }}
                    >
                      {result.description}
                    </div>
                  )}
                  {result.systemCode && (
                    <div className="flex items-center gap-1 mt-0.5 ml-3.5">
                      <span
                        className="text-[9px]"
                        style={{ color: SC[result.systemType] || M3.onSurfaceVariant }}
                      >
                        {result.systemCode}
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Keyboard hint */}
          {!isLoading && results?.length > 0 && (
            <div
              className="px-3 py-1.5 border-t border-white/[0.06] flex items-center gap-3"
            >
              <span className="text-[9px]" style={{ color: M3.onSurfaceVariant }}>
                <kbd className="px-1 py-0.5 rounded text-[8px] border border-white/[0.1]" style={{ background: M3.surfaceContainerHigh }}>&#8593;&#8595;</kbd> navigate
              </span>
              <span className="text-[9px]" style={{ color: M3.onSurfaceVariant }}>
                <kbd className="px-1 py-0.5 rounded text-[8px] border border-white/[0.1]" style={{ background: M3.surfaceContainerHigh }}>&#9166;</kbd> select
              </span>
              <span className="text-[9px]" style={{ color: M3.onSurfaceVariant }}>
                <kbd className="px-1 py-0.5 rounded text-[8px] border border-white/[0.1]" style={{ background: M3.surfaceContainerHigh }}>esc</kbd> close
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon({ color }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function entityTypeColor(type) {
  switch (type) {
    case 'equipment':  return M3.primary;
    case 'instrument': return M3.warning;
    case 'line':       return M3.tertiary;
    default:           return M3.onSurfaceVariant;
  }
}

function highlightMatch(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: M3.primary, fontWeight: 700 }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
