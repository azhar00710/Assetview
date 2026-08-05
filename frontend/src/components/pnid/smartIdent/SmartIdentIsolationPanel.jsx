import { md } from '../../../lib/theme';
import { SMART_IDENT_COLORS } from '../../../hooks/useSmartIdentification';
import { segmentLabel } from './segmentHierarchy';

/**
 * Isolation analysis panel — shows downstream affected tags when simulating shutdown.
 */
export default function SmartIdentIsolationPanel({
  isolationResult,
  onClose,
  onSelectSegment,
  onClear,
}) {
  if (!isolationResult) return null;

  const {
    shutdownSegment,
    affectedSegments = [],
    boundarySegments = [],
    diagnostics = {},
  } = isolationResult;
  const warnings = diagnostics.warnings || [];
  const shutdownLabel = segmentLabel(shutdownSegment);

  return (
    <div
      className="absolute bottom-4 right-4 z-35 w-80 max-h-[420px] flex flex-col rounded-xl overflow-hidden"
      style={{
        background: 'linear-gradient(165deg, #1a2332 0%, #111820 100%)',
        border: '1px solid rgba(231, 76, 60, 0.35)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04) inset',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="shrink-0 px-4 py-3 flex items-start justify-between gap-2"
        style={{
          background: 'linear-gradient(90deg, rgba(231,76,60,0.2) 0%, rgba(243,156,18,0.12) 100%)',
          borderBottom: '1px solid rgba(231,76,60,0.25)',
        }}
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]" style={{ color: '#E74C3C' }}>
              block
            </span>
            <span className="text-sm font-bold text-white">Isolation Analysis</span>
          </div>
          <p className="text-[10px] mt-1 text-white/60">
            Shutdown point: <span className="font-semibold text-white/90">{shutdownLabel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/50 hover:text-white text-lg leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        <section
          className="rounded-lg px-3 py-2"
          style={{ background: 'rgba(59,228,148,0.07)', border: '1px solid rgba(59,228,148,0.16)' }}
        >
          <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wider text-white/45">
            <span>Network coverage</span>
            <span style={{ color: SMART_IDENT_COLORS.line }}>
              {diagnostics.traversedLineCount || 0}/{diagnostics.lineCount || 0} lines traced
            </span>
          </div>
          {diagnostics.inferredAttachmentCount > 0 && (
            <p className="text-[9px] text-white/45 mt-1">
              {diagnostics.inferredAttachmentCount} unlinked tag(s) matched to nearby lines by geometry.
            </p>
          )}
        </section>

        {warnings.length > 0 && (
          <section
            className="rounded-lg px-3 py-2 space-y-1"
            style={{ background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.2)' }}
          >
            {warnings.map((warning) => (
              <p key={warning} className="text-[9px] text-amber-200/75 flex gap-1.5">
                <span aria-hidden="true">!</span>
                <span>{warning}</span>
              </p>
            ))}
          </section>
        )}

        {boundarySegments.length > 0 && (
          <section>
            <h4 className="text-[9px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: '#E74C3C' }}>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Boundary — close / blind
            </h4>
            <div className="space-y-1">
              {boundarySegments.map((seg) => (
                <IsolationRow
                  key={seg.id}
                  segment={seg}
                  kind="boundary"
                  onSelect={onSelectSegment}
                />
              ))}
            </div>
          </section>
        )}

        <section>
          <h4 className="text-[9px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: '#F39C12' }}>
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Downstream affected ({affectedSegments.length})
          </h4>
          {affectedSegments.length === 0 ? (
            <p className="text-[10px] px-2 py-3 rounded-lg text-white/50" style={{ background: 'rgba(255,255,255,0.04)' }}>
              No downstream tags identified from this shutdown point. Assign parent lines and flow direction for richer analysis.
            </p>
          ) : (
            <div className="space-y-1">
              {affectedSegments.map((seg) => (
                <IsolationRow
                  key={seg.id}
                  segment={seg}
                  kind="affected"
                  onSelect={onSelectSegment}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div
        className="shrink-0 px-3 py-2 flex gap-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button
          type="button"
          onClick={onClear}
          className="flex-1 py-2 rounded-lg text-[11px] font-bold transition-opacity hover:opacity-90"
          style={{
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          Clear isolation
        </button>
      </div>
    </div>
  );
}

function IsolationRow({ segment, kind, onSelect }) {
  const color = kind === 'boundary' ? '#E74C3C' : '#F39C12';
  const seq = segment.metadata?.flowSequence;
  const label = segment.metadata?.label || segmentLabel(segment);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(segment)}
      className="w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors hover:brightness-110"
      style={{
        background: `${color}12`,
        border: `1px solid ${color}30`,
      }}
    >
      {seq != null && (
        <span
          className="text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `${SMART_IDENT_COLORS.instrument}25`, color: SMART_IDENT_COLORS.instrument }}
        >
          {seq}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold truncate text-white/90">{label}</div>
        <div className="text-[9px] text-white/45 truncate">
          {segment.linkedEntityType || segment.metadata?.category || segment.segmentType}
        </div>
      </div>
      <span className="material-symbols-outlined text-[14px] text-white/30">chevron_right</span>
    </button>
  );
}
