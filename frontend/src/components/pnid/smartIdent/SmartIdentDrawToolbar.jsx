import { useState } from 'react';

import { md } from '../../../lib/theme';

import { PID_SYMBOL_CATEGORIES, getPidSymbol, getSymbolCategoryId } from './pidSymbolCatalog';

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

 * Premium draw toolbar for Smart Identification mode.

 */

export default function SmartIdentDrawToolbar({

  activeTool,

  activeCategory,

  onToolChange,

  onCategoryChange,

  onViewRelationships,

  onOpenSymbolPicker,

  symbolPickerOpen = false,

  segmentCount = 0,

  selectedSegment = null,

  onDeleteSegment,

  deletingSegment = false,

  onRunIsolation,

  isolationActive = false,

  onClearIsolation,

  canUndo = false,

  canRedo = false,

  onUndo,

  onRedo,

}) {

  const [expandedCat, setExpandedCat] = useState(activeCategory || 'piping');

  const category = PID_SYMBOL_CATEGORIES.find((c) => c.id === expandedCat);

  const activeSymbol = activeTool?.startsWith('sym_') ? getPidSymbol(activeTool) : null;



  const btnBase = 'px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all duration-150';



  return (

    <div

      className="flex flex-wrap items-center gap-2 px-4 py-2.5 shrink-0"

      style={{

        background: 'linear-gradient(180deg, #1a2820 0%, #152018 100%)',

        borderBottom: `1px solid ${CATEGORY_COLORS.piping}25`,

        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',

      }}

    >

      <div className="flex items-center gap-1.5 mr-1">

        <span className="material-symbols-outlined text-[18px]" style={{ color: '#3BE494' }}>draw</span>

        <span className="text-[11px] font-bold text-white/90 hidden sm:inline">Smart ID</span>

      </div>



      <div className="h-6 w-px bg-white/10" />



      <button

        onClick={() => onToolChange('select')}

        className={btnBase}

        style={{

          background: activeTool === 'select' ? 'rgba(59,228,148,0.2)' : 'rgba(255,255,255,0.05)',

          color: activeTool === 'select' ? '#3BE494' : 'rgba(255,255,255,0.55)',

          border: `1px solid ${activeTool === 'select' ? '#3BE49450' : 'rgba(255,255,255,0.08)'}`,

        }}

        title="Select shapes (V)"

      >

        <span className="material-symbols-outlined text-[14px] align-middle mr-0.5">near_me</span>

        Select
        <kbd className="ml-1 px-1 py-0.5 rounded text-[8px] font-mono opacity-60" style={{ background: 'rgba(255,255,255,0.1)' }}>V</kbd>

      </button>



      <button

        type="button"

        onClick={() => {

          onCategoryChange('piping');

          setExpandedCat('piping');

          onToolChange('line');

        }}

        className={btnBase}

        style={{

          background: activeTool === 'line' ? `${CATEGORY_COLORS.piping}25` : 'rgba(255,255,255,0.05)',

          color: activeTool === 'line' ? CATEGORY_COLORS.piping : 'rgba(255,255,255,0.55)',

          border: `1px solid ${activeTool === 'line' ? `${CATEGORY_COLORS.piping}50` : 'rgba(255,255,255,0.08)'}`,

        }}

        title="Draw pipe line with flow direction (L)"

      >

        <span className="material-symbols-outlined text-[14px] align-middle mr-0.5">linear_scale</span>

        Line
        <kbd className="ml-1 px-1 py-0.5 rounded text-[8px] font-mono opacity-60" style={{ background: 'rgba(255,255,255,0.1)' }}>L</kbd>

      </button>



      <button

        type="button"

        onClick={() => {

          onCategoryChange('piping');

          setExpandedCat('piping');

          onToolChange('trace');

        }}

        className={btnBase}

        style={{

          background: activeTool === 'trace' ? `${CATEGORY_COLORS.piping}25` : 'rgba(255,255,255,0.05)',

          color: activeTool === 'trace' ? CATEGORY_COLORS.piping : 'rgba(255,255,255,0.55)',

          border: `1px solid ${activeTool === 'trace' ? `${CATEGORY_COLORS.piping}50` : 'rgba(255,255,255,0.08)'}`,

        }}

        title="Trace polyline — click corners, double-click to finish (T)"

      >

        Trace
        <kbd className="ml-1 px-1 py-0.5 rounded text-[8px] font-mono opacity-60" style={{ background: 'rgba(255,255,255,0.1)' }}>T</kbd>

      </button>



      <div className="h-6 w-px bg-white/10" />



      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className={btnBase}
          style={{
            background: 'rgba(255,255,255,0.05)',
            color: canUndo ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: canUndo ? 1 : 0.5,
          }}
          title="Undo (Ctrl+Z)"
        >
          <span className="material-symbols-outlined text-[14px] align-middle">undo</span>
        </button>
      )}

      {onRedo && (
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          className={btnBase}
          style={{
            background: 'rgba(255,255,255,0.05)',
            color: canRedo ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.08)',
            opacity: canRedo ? 1 : 0.5,
          }}
          title="Redo (Ctrl+Y)"
        >
          <span className="material-symbols-outlined text-[14px] align-middle">redo</span>
        </button>
      )}



      {PID_SYMBOL_CATEGORIES.filter((c) => c.id !== 'general').map((cat) => (

        <button

          key={cat.id}

          onClick={() => {

            setExpandedCat(cat.id);

            onCategoryChange(cat.id);

            const firstTool = cat.tools[0]?.id || 'line';

            onToolChange(firstTool);

          }}

          className={btnBase}

          style={{

            background: expandedCat === cat.id ? `${CATEGORY_COLORS[cat.id]}20` : 'rgba(255,255,255,0.05)',

            color: expandedCat === cat.id ? CATEGORY_COLORS[cat.id] : 'rgba(255,255,255,0.55)',

            border: `1px solid ${expandedCat === cat.id ? `${CATEGORY_COLORS[cat.id]}45` : 'rgba(255,255,255,0.08)'}`,

          }}

        >

          {cat.shortLabel}

        </button>

      ))}



      <button

        type="button"

        onClick={onOpenSymbolPicker}

        className={`${btnBase} flex items-center gap-1.5`}

        style={{

          background: symbolPickerOpen ? 'rgba(59,228,148,0.2)' : activeSymbol ? `${CATEGORY_COLORS[activeSymbol.categoryId]}18` : 'rgba(59,228,148,0.1)',

          color: symbolPickerOpen ? '#3BE494' : activeSymbol ? CATEGORY_COLORS[activeSymbol.categoryId] : '#3BE494',

          border: `1px solid ${symbolPickerOpen ? '#3BE49450' : 'rgba(59,228,148,0.3)'}`,

        }}

      >

        {activeSymbol ? (

          <SymbolPreview symbol={activeSymbol} size={18} color={CATEGORY_COLORS[activeSymbol.categoryId]} />

        ) : (

          <span className="material-symbols-outlined text-[16px]">category</span>

        )}

        {symbolPickerOpen ? 'Hide Library' : activeSymbol ? activeSymbol.abbr : 'Symbols'}

      </button>



      {category && (

        <div className="flex items-center gap-1 flex-wrap border-l pl-2 border-white/10">

          {category.tools.map((t) => (

            <button

              key={t.id}

              onClick={() => onToolChange(t.id)}

              title={t.label}

              className="px-2 py-1 rounded-md text-[9px] font-semibold"

              style={{

                background: activeTool === t.id ? `${CATEGORY_COLORS[category.id]}25` : 'rgba(255,255,255,0.04)',

                color: activeTool === t.id ? CATEGORY_COLORS[category.id] : 'rgba(255,255,255,0.45)',

                border: '1px solid rgba(255,255,255,0.08)',

              }}

            >

              {t.label}

            </button>

          ))}

        </div>

      )}



      <div className="h-6 w-px bg-white/10 ml-auto" />



      {onRunIsolation && selectedSegment && (

        isolationActive ? (

          <button

            type="button"

            onClick={onClearIsolation}

            className={`${btnBase} flex items-center gap-1`}

            style={{

              background: 'rgba(231,76,60,0.25)',

              color: '#E74C3C',

              border: '1px solid rgba(231,76,60,0.45)',

            }}

          >

            <span className="material-symbols-outlined text-[14px]">close</span>

            Clear Isolation

          </button>

        ) : (

          <button

            type="button"

            onClick={onRunIsolation}

            className={`${btnBase} flex items-center gap-1`}

            style={{

              background: 'rgba(243,156,18,0.15)',

              color: '#F39C12',

              border: '1px solid rgba(243,156,18,0.35)',

            }}

            title="Simulate shutdown — show downstream affected tags"

          >

            <span className="material-symbols-outlined text-[14px]">block</span>

            Isolation

          </button>

        )

      )}



      {selectedSegment && onDeleteSegment && (

        <button

          type="button"

          onClick={() => onDeleteSegment(selectedSegment.id)}

          disabled={deletingSegment}

          className={`${btnBase} flex items-center gap-1`}

          style={{

            background: 'rgba(231,76,60,0.12)',

            color: '#E74C3C',

            border: '1px solid rgba(231,76,60,0.3)',

            opacity: deletingSegment ? 0.6 : 1,

          }}

        >

          <span className="material-symbols-outlined text-[14px]">delete</span>

        </button>

      )}



      {onViewRelationships && segmentCount > 0 && (

        <button

          type="button"

          onClick={onViewRelationships}

          className={`${btnBase} flex items-center gap-1`}

          style={{

            background: 'rgba(45,51,224,0.15)',

            color: '#6B72FF',

            border: '1px solid rgba(45,51,224,0.35)',

          }}

        >

          <span className="material-symbols-outlined text-[14px]">account_tree</span>

          Tree

        </button>

      )}



      <span className="text-[9px] text-white/35 hidden lg:inline">

        <kbd className="px-1 rounded bg-white/10">L</kbd> line · <kbd className="px-1 rounded bg-white/10">T</kbd> trace · <kbd className="px-1 rounded bg-white/10">V</kbd> select · Esc undo trace pt · Ctrl+Z undo · Del delete

      </span>

    </div>

  );

}



export function toolColor(categoryId) {

  return CATEGORY_COLORS[categoryId] || CATEGORY_COLORS.general;

}



export function toolCategoryForTool(toolId) {

  if (!toolId) return 'general';

  const fromCatalog = getSymbolCategoryId(toolId);

  if (fromCatalog) return fromCatalog;

  if (toolId === 'diamond') return 'valve';

  if (toolId === 'circle') return 'instrument';

  if (toolId === 'line') return 'piping';

  if (toolId === 'trace') return 'piping';

  return 'general';

}


