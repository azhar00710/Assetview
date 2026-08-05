import { md, systemColor } from '../../lib/theme';
import { PID_SYMBOL_CATEGORIES as SYMBOL_CATALOG, getSymbolCategoryId } from './smartIdent/pidSymbolCatalog';

// Single source of truth: eDraw-aligned P&ID symbol catalog
export const ANNOTATION_CATEGORIES = SYMBOL_CATALOG;

// Build a flat lookup: tool/symbol → category
const TOOL_TO_CATEGORY = {};
for (const cat of ANNOTATION_CATEGORIES) {
  for (const t of cat.tools) TOOL_TO_CATEGORY[t.id] = TOOL_TO_CATEGORY[t.id] || cat.id;
  for (const s of cat.symbols) TOOL_TO_CATEGORY[s.id] = cat.id;
}

// Legacy exports for backward compatibility
const PID_SYMBOL_CATEGORIES = ANNOTATION_CATEGORIES.filter(c => c.symbols.length > 0).map(c => ({
  id: c.id,
  label: c.label,
  symbols: c.symbols,
}));

export { getSymbolCategoryId };

const COLORS = [
  md.primary, md.secondary, md.error, md.tertiary,
  md.silPurple, systemColor('instrument'), md.white, '#333333',
];

const STROKES = [1, 2, 3, 4];

const OVERLAY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'instruments', label: 'Instruments' },
  { id: 'lines', label: 'Lines' },
];

export default function AnnotationToolbar({
  activeTool, onToolChange,
  activeColor, onColorChange,
  activeStroke, onStrokeChange,
  activeCategory, onCategoryChange,
  showOverlay, onToggleOverlay,
  showAnnotations, onToggleAnnotations,
  showLabels, onToggleLabels,
  overlayFilter, onOverlayFilterChange,
  onZoomIn, onZoomOut, onZoomReset,
  onRunOcr, ocrLoading, hasOcrResults,
  selectedAnnotation,
  onDeleteAnnotation,
  showSymbolPicker,
  onToggleSymbolPicker,
}) {
  const currentCat = ANNOTATION_CATEGORIES.find(c => c.id === activeCategory) || ANNOTATION_CATEGORIES[0];
  const isSymbolTool = activeTool?.startsWith('sym_');
  const canDelete = selectedAnnotation?.id && selectedAnnotation?.approvalStatus !== 'approved' && onDeleteAnnotation;

  // Select category → apply its defaults and activate its first tool
  const handleCategorySelect = (catId) => {
    const cat = ANNOTATION_CATEGORIES.find(c => c.id === catId);
    if (!cat) return;
    onCategoryChange(catId);
    onColorChange(cat.defaultColor);
    onStrokeChange(cat.defaultStroke);
    const catToolIds = [...cat.tools.map(t => t.id), ...cat.symbols.map(s => s.id)];
    if (!catToolIds.includes(activeTool)) {
      onToolChange(cat.tools[0]?.id || 'select');
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center px-3 py-1.5 bg-md-surface-container border-b border-md-outline-variant/30 gap-1 flex-wrap">
        {/* ── Category tabs ── */}
        <div className="flex items-center gap-0.5 mr-2">
          <button
            onClick={() => { onToolChange('select'); onCategoryChange(null); }}
            className={`px-2 py-1 text-[10px] rounded transition-colors font-semibold ${
              activeTool === 'select' && !activeCategory
                ? 'bg-md-on-surface/10 text-md-on-surface'
                : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-on-surface/5'
            }`}
            title="Select (V)"
          >
            Select
          </button>
          {ANNOTATION_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleCategorySelect(cat.id)}
              className={`px-2 py-1 text-[10px] rounded transition-colors font-semibold ${
                activeCategory === cat.id
                  ? 'text-white'
                  : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-on-surface/5'
              }`}
              style={activeCategory === cat.id ? { backgroundColor: cat.defaultColor + '30', color: cat.defaultColor } : {}}
              title={cat.label}
            >
              {cat.shortLabel}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-md-outline-variant/30 mr-1" />

        {/* ── Shape tools for active category ── */}
        {activeCategory && currentCat && (
          <div className="flex items-center gap-0.5 mr-2">
            {currentCat.tools.map(t => (
              <button
                key={t.id}
                onClick={() => onToolChange(t.id)}
                className={`px-2 py-1 text-[10px] rounded transition-colors ${
                  activeTool === t.id && !isSymbolTool
                    ? 'text-white'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-on-surface/5'
                }`}
                style={activeTool === t.id && !isSymbolTool ? { backgroundColor: currentCat.defaultColor + '25', color: currentCat.defaultColor } : {}}
                title={`${t.label} (${t.shortcut})`}
              >
                {t.label}
              </button>
            ))}
            {onToggleSymbolPicker && (
              <button
                onClick={onToggleSymbolPicker}
                className={`px-2 py-1 text-[10px] rounded font-semibold transition-colors ${
                  showSymbolPicker || isSymbolTool
                    ? 'text-white'
                    : 'text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-on-surface/5'
                }`}
                style={showSymbolPicker || isSymbolTool ? { backgroundColor: currentCat.defaultColor + '25', color: currentCat.defaultColor } : {}}
                title="Toggle P&ID symbol library (left panel)"
              >
                {showSymbolPicker ? 'Hide Symbols' : 'Symbol Library'}
              </button>
            )}
          </div>
        )}

        {canDelete && (
          <>
            <div className="h-4 w-px bg-md-outline-variant/30 mr-1" />
            <button
              onClick={() => onDeleteAnnotation(selectedAnnotation.id)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded font-semibold text-red-400 hover:bg-red-500/15"
              title="Delete selected annotation (Del)"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              Delete
            </button>
          </>
        )}

        <div className="h-4 w-px bg-md-outline-variant/30 mr-1" />

        {/* ── Colors ── */}
        <div className="flex items-center gap-1 mr-2">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className={`w-4 h-4 rounded-full border-2 transition-transform ${
                activeColor === c ? 'border-white scale-125' : 'border-md-outline-variant/30 hover:scale-110'
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>

        <div className="h-4 w-px bg-md-outline-variant/30 mr-1" />

        {/* ── Stroke width ── */}
        <div className="flex items-center gap-0.5 mr-2">
          {STROKES.map(s => (
            <button
              key={s}
              onClick={() => onStrokeChange(s)}
              className={`w-5 h-5 rounded flex items-center justify-center ${
                activeStroke === s ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant hover:text-md-on-surface'
              }`}
              title={`${s}px`}
            >
              <div
                className="rounded-full"
                style={{ width: s * 2 + 2, height: s * 2 + 2, backgroundColor: 'currentColor' }}
              />
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-md-outline-variant/30 mr-1" />

        {/* ── Overlay toggles ── */}
        <div className="flex items-center gap-0.5 mr-2">
          <button
            onClick={onToggleOverlay}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              showOverlay ? 'bg-md-secondary/20 text-md-secondary' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            Overlay
          </button>
          <button
            onClick={onToggleAnnotations}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              showAnnotations ? 'bg-md-primary/20 text-md-primary' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            Annotations
          </button>
          <button
            onClick={onToggleLabels}
            className={`px-1.5 py-0.5 text-[10px] rounded ${
              showLabels ? 'bg-md-tertiary/20 text-md-tertiary' : 'text-md-on-surface-variant hover:text-md-on-surface'
            }`}
          >
            Labels
          </button>
        </div>

        {/* Overlay filter */}
        {showOverlay && (
          <div className="flex items-center gap-0.5 mr-2">
            {OVERLAY_FILTERS.map(f => (
              <button
                key={f.id}
                onClick={() => onOverlayFilterChange(f.id)}
                className={`px-1 py-0.5 text-[9px] rounded ${
                  overlayFilter === f.id
                    ? 'bg-white/10 text-white'
                    : 'text-md-on-surface-variant hover:text-md-on-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <div className="h-4 w-px bg-md-outline-variant/30 mx-1" />

        {/* ── OCR button ── */}
        <button
          onClick={onRunOcr}
          disabled={ocrLoading}
          className={`px-2 py-1 text-[10px] rounded font-semibold transition-colors ${
            hasOcrResults
              ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
              : 'bg-md-tertiary/10 text-md-tertiary hover:bg-md-tertiary/20'
          } disabled:opacity-50`}
          title="Run OCR to auto-detect equipment, instrument, and line tags"
        >
          {ocrLoading ? 'Running OCR...' : hasOcrResults ? 'OCR Results' : 'Run OCR'}
        </button>

        <div className="flex-1" />

        {/* ── Zoom controls ── */}
        <div className="flex items-center gap-0.5">
          <button onClick={onZoomOut} className="px-1.5 py-0.5 text-xs text-md-on-surface-variant hover:text-md-on-surface">-</button>
          <button onClick={onZoomReset} className="px-1.5 py-0.5 text-[10px] text-md-on-surface-variant hover:text-md-on-surface">Fit</button>
          <button onClick={onZoomIn} className="px-1.5 py-0.5 text-xs text-md-on-surface-variant hover:text-md-on-surface">+</button>
        </div>
      </div>
    </div>
  );
}

// Export for use in other components
export { PID_SYMBOL_CATEGORIES, ANNOTATION_CATEGORIES as CATEGORIES, TOOL_TO_CATEGORY };
