import { useMemo, useState } from 'react';
import { md } from '../../../lib/theme';
import {
  ISO_STANDARD_REF,
  ISO_GRAPHICS_REF,
  getSymbolPickerCategories,
  searchPidSymbols,
  getPidSymbol,
  getSymbolCatalogStats,
  getCatalogVersion,
} from './pidSymbolCatalog';
import SymbolPreview from './SymbolPreview';

const CATEGORY_COLORS = {
  instrument: '#F39C12',
  valve: '#E74C3C',
  pump: '#3BE494',
  equipment: '#3BE494',
  piping: '#2D33E0',
  general: '#94A3B8',
};

/**
 * Docked side-panel P&ID symbol toolbox (eDraw legend–aligned catalog).
 */
export default function SmartIdentSymbolPicker({
  open,
  onClose,
  activeTool,
  onSelectSymbol,
}) {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const catalogVersion = getCatalogVersion();

  const categories = useMemo(() => getSymbolPickerCategories(), [catalogVersion]);
  const catalogStats = useMemo(() => getSymbolCatalogStats(), [catalogVersion]);
  const results = useMemo(
    () => searchPidSymbols(search, filterCat),
    [search, filterCat, catalogVersion],
  );

  const activeSymbol = activeTool?.startsWith('sym_') ? getPidSymbol(activeTool) : null;

  if (!open) return null;

  return (
    <aside
      className="shrink-0 w-72 flex flex-col border-r overflow-hidden z-20"
      style={{
        background: md.surfaceContainer,
        borderColor: md.outlineVariant,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        className="shrink-0 px-3 py-2.5 flex items-start justify-between gap-2"
        style={{ borderBottom: `1px solid ${md.outlineVariant}`, background: md.surfaceContainerHigh }}
      >
        <div className="min-w-0">
          <h2 className="text-xs font-bold flex items-center gap-1.5" style={{ color: md.onSurface }}>
            <span className="material-symbols-outlined text-[18px]">category</span>
            Symbol Library
          </h2>
            <p className="text-[9px] mt-0.5 leading-snug" style={{ color: md.onSurfaceVariant }}>
              {ISO_STANDARD_REF} · graphics per {ISO_GRAPHICS_REF}
              {catalogStats.customCount > 0 && ` · ${catalogStats.customCount} custom`}
            </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:opacity-70 shrink-0"
          style={{ color: md.onSurfaceVariant }}
          aria-label="Close symbol library"
          title="Close panel"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 py-2 space-y-2" style={{ borderBottom: `1px solid ${md.outlineVariant}` }}>
        <div className="relative">
          <span
            className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[16px]"
            style={{ color: md.onSurfaceVariant }}
          >
            search
          </span>
          <input
            type="search"
            placeholder="gate valve, PT, HX…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg"
            style={{
              background: md.surface,
              color: md.onSurface,
              border: `1px solid ${md.outlineVariant}`,
            }}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setFilterCat('all')}
            className="px-1.5 py-0.5 rounded text-[9px] font-bold"
            style={{
              background: filterCat === 'all' ? `${md.primary}25` : md.surface,
              color: filterCat === 'all' ? md.primary : md.onSurfaceVariant,
              border: `1px solid ${filterCat === 'all' ? md.primary : md.outlineVariant}`,
            }}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setFilterCat(cat.id)}
              className="px-1.5 py-0.5 rounded text-[9px] font-bold"
              style={{
                background: filterCat === cat.id ? `${CATEGORY_COLORS[cat.id] || md.primary}25` : md.surface,
                color: filterCat === cat.id ? (CATEGORY_COLORS[cat.id] || md.primary) : md.onSurfaceVariant,
                border: `1px solid ${filterCat === cat.id ? (CATEGORY_COLORS[cat.id] || md.primary) : md.outlineVariant}`,
              }}
            >
              {cat.shortLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Active selection */}
      {activeSymbol && (
        <div
          className="shrink-0 mx-3 mt-2 px-2 py-1.5 rounded-lg flex items-center gap-2 text-[10px]"
          style={{
            background: `${CATEGORY_COLORS[activeSymbol.categoryId]}15`,
            border: `1px solid ${CATEGORY_COLORS[activeSymbol.categoryId]}40`,
          }}
        >
          <SymbolPreview symbol={activeSymbol} size={28} color={CATEGORY_COLORS[activeSymbol.categoryId]} active />
          <div className="min-w-0">
            <div className="font-bold truncate" style={{ color: md.onSurface }}>{activeSymbol.abbr}</div>
            <div className="truncate" style={{ color: md.onSurfaceVariant }}>{activeSymbol.label}</div>
          </div>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {results.length === 0 ? (
          <p className="text-center text-xs py-8" style={{ color: md.onSurfaceVariant }}>
            No symbols match &ldquo;{search}&rdquo;
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
              {results.map((sym) => {
                const color = CATEGORY_COLORS[sym.categoryId] || '#E8ECEF';
                const isActive = activeTool === sym.id;
                return (
                  <button
                    key={sym.id}
                    type="button"
                    onClick={() => onSelectSymbol?.(sym)}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all hover:opacity-90"
                    style={{
                      background: 'transparent',
                      border: `1px solid ${isActive ? color : md.outlineVariant}`,
                      boxShadow: isActive ? `0 0 0 1px ${color}` : undefined,
                    }}
                    title={sym.label}
                  >
                    <SymbolPreview symbol={sym} color={color} active={isActive} size={44} />
                  <span className="text-[9px] font-bold text-center leading-tight w-full truncate" style={{ color: md.onSurface }}>
                    {sym.abbr}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="shrink-0 px-3 py-1.5 text-[9px] text-center"
        style={{ color: md.onSurfaceVariant, borderTop: `1px solid ${md.outlineVariant}` }}
      >
        {filterCat === 'all'
          ? `${results.length} of ${catalogStats.total} symbols`
          : `${results.length} in ${categories.find((c) => c.id === filterCat)?.shortLabel || filterCat}`}
        {' · '}click drawing to place · add custom symbols in Admin → Symbols
      </div>
    </aside>
  );
}
