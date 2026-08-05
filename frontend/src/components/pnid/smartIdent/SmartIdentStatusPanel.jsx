import { md } from '../../../lib/theme';

import { SMART_IDENT_COLORS } from '../../../hooks/useSmartIdentification';



export default function SmartIdentStatusPanel({

  session,

  segments = [],

  snapEnabled,

  saveError,

  saving = false,

  onToggleSnap,

  onDismiss,

  onViewRelationships,

  loadGuideLines = false,
  selectedSegment = null,
  activeTool = 'line',
  onDeleteSelected,
}) {

  const assigned = segments.filter((s) => s.linkedEntityId).length;

  const snapped = segments.filter((s) => s.metadata?.snapped).length;

  const withFlow = segments.filter((s) => s.metadata?.flowSequence).length;

  const lines = segments.filter((s) => s.segmentType === 'line').length;

  const total = segments.length;

  const pct = total ? Math.round((assigned / total) * 100) : 0;



  return (

    <div

      className="absolute bottom-4 left-4 z-30 w-[300px] rounded-xl overflow-hidden"

      style={{

        background: 'linear-gradient(165deg, #1e2a24 0%, #152018 100%)',

        border: `1px solid ${SMART_IDENT_COLORS.boundary}30`,

        boxShadow: '0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,228,148,0.06) inset',

      }}

    >

      <div

        className="flex items-center justify-between px-4 py-3"

        style={{

          background: 'linear-gradient(90deg, rgba(59,228,148,0.18) 0%, rgba(45,51,224,0.1) 100%)',

          borderBottom: `1px solid ${SMART_IDENT_COLORS.boundary}20`,

        }}

      >

        <div className="flex items-center gap-2">

          <div

            className="w-8 h-8 rounded-lg flex items-center justify-center"

            style={{ background: `${SMART_IDENT_COLORS.boundary}20`, border: `1px solid ${SMART_IDENT_COLORS.boundary}35` }}

          >

            <span className="material-symbols-outlined text-[18px]" style={{ color: SMART_IDENT_COLORS.boundary }}>

              auto_awesome

            </span>

          </div>

          <div>

            <div className="text-xs font-bold text-white">Smart Identification</div>

            <div className="text-[9px] text-white/45">Flow-aware tagging · Isolation</div>

          </div>

        </div>

        {onDismiss && (

          <button onClick={onDismiss} className="text-white/40 hover:text-white p-1">

            <span className="material-symbols-outlined text-[18px]">expand_more</span>

          </button>

        )}

      </div>



      <div className="px-4 py-3 space-y-3 text-[10px]">

        <div

          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg"

          style={{

            background: saveError ? 'rgba(231,76,60,0.12)' : 'rgba(59,228,148,0.1)',

            border: `1px solid ${saveError ? 'rgba(231,76,60,0.3)' : 'rgba(59,228,148,0.25)'}`,

          }}

        >

          <span

            className={`material-symbols-outlined text-[16px] ${saving ? 'animate-spin' : ''}`}

            style={{ color: saveError ? SMART_IDENT_COLORS.valve : SMART_IDENT_COLORS.boundary }}

          >

            {saveError ? 'error' : saving ? 'sync' : 'cloud_done'}

          </span>

          <div className="text-white/80">

            <div className="font-semibold text-white text-[11px]">

              {saveError ? 'Save failed' : saving ? 'Saving…' : 'Synced to database'}

            </div>

            <div className="text-white/45 mt-0.5">

              {saveError || (session?.id ? `${total} shapes · ${lines} lines` : 'Preparing…')}

            </div>

          </div>

        </div>

        {selectedSegment && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: `${SMART_IDENT_COLORS.selected}12`,
              border: `1px solid ${SMART_IDENT_COLORS.selected}35`,
            }}
          >
            <span className="material-symbols-outlined text-[16px]" style={{ color: SMART_IDENT_COLORS.selected }}>
              {activeTool === 'select' ? 'label' : 'touch_app'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-white truncate">
                {selectedSegment.metadata?.label || selectedSegment.segmentType}
              </div>
              <div className="text-[9px] text-white/45">
                {activeTool === 'select' ? 'Assign tag or Del to remove' : 'Del to delete · Esc to deselect'}
              </div>
            </div>
            {onDeleteSelected && (
              <button
                type="button"
                onClick={onDeleteSelected}
                className="shrink-0 p-1.5 rounded-lg hover:bg-white/10"
                style={{ color: SMART_IDENT_COLORS.valve }}
                title="Delete (Del)"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            )}
          </div>
        )}

        {total > 0 && (

          <>

            <div>

              <div className="flex justify-between mb-1.5 text-white/50">

                <span>Assignment progress</span>

                <span className="font-bold text-white">{assigned}/{total}</span>

              </div>

              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>

                <div

                  className="h-full rounded-full transition-all duration-500"

                  style={{

                    width: `${pct}%`,

                    background: `linear-gradient(90deg, ${SMART_IDENT_COLORS.boundary}, ${SMART_IDENT_COLORS.line})`,

                  }}

                />

              </div>

            </div>



            <div className="grid grid-cols-3 gap-2">

              {[

                { label: 'Lines', value: lines, color: SMART_IDENT_COLORS.line },

                { label: 'Flow #', value: withFlow, color: SMART_IDENT_COLORS.instrument },

                { label: 'Snapped', value: snapped, color: SMART_IDENT_COLORS.boundary },

              ].map((stat) => (

                <div

                  key={stat.label}

                  className="text-center py-2 rounded-lg"

                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}

                >

                  <div className="text-sm font-bold" style={{ color: stat.color }}>{stat.value}</div>

                  <div className="text-[8px] uppercase tracking-wide text-white/35 mt-0.5">{stat.label}</div>

                </div>

              ))}

            </div>

          </>

        )}



        {total > 0 && onViewRelationships && (

          <button

            type="button"

            onClick={onViewRelationships}

            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[11px] font-bold transition-all hover:brightness-110"

            style={{

              background: `${SMART_IDENT_COLORS.line}18`,

              color: SMART_IDENT_COLORS.line,

              border: `1px solid ${SMART_IDENT_COLORS.line}35`,

            }}

          >

            <span className="material-symbols-outlined text-[16px]">account_tree</span>

            View flow hierarchy

          </button>

        )}



        <label className="flex items-center gap-2 cursor-pointer text-white/60 hover:text-white/80">

          <input

            type="checkbox"

            checked={snapEnabled}

            onChange={(e) => onToggleSnap?.(e.target.checked)}

            className="rounded accent-emerald-400"

          />

          <span>Snap to pipe lines &amp; tags</span>

        </label>



        {snapEnabled && !loadGuideLines && (

          <p className="text-[9px] text-white/35 pl-6">Snap guides load in background</p>

        )}



        <details className="group">

          <summary className="cursor-pointer font-semibold text-white/70 text-[10px] flex items-center gap-1">

            <span className="material-symbols-outlined text-[14px] group-open:rotate-90 transition-transform">chevron_right</span>

            How flow &amp; isolation work

          </summary>

          <ol className="mt-2 space-y-1.5 list-none text-white/45 leading-relaxed pl-1">

            <li className="flex gap-2"><span style={{ color: SMART_IDENT_COLORS.line }}>1.</span> Draw lines — dot marks flow origin, arrow shows direction</li>

            <li className="flex gap-2"><span style={{ color: SMART_IDENT_COLORS.instrument }}>2.</span> Assign child tags — auto-ranked #1, #2… by downstream position</li>

            <li className="flex gap-2"><span style={{ color: '#F39C12' }}>3.</span> Run Isolation on any tag to see shutdown impact downstream</li>

          </ol>

        </details>

      </div>

    </div>

  );

}


