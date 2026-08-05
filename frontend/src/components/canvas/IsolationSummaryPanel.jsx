import { memo } from 'react';
import useCanvasStore from '../../canvas/store/useCanvasStore';
import { md, alpha } from '../../lib/theme';

/**
 * IsolationSummaryPanel — appears below NodeDetailPanel when isolation is active.
 * Shows valve lineup list, affected equipment count, affected lines, and clear button.
 */
function IsolationSummaryPanel() {
  const isolationResult = useCanvasStore((s) => s.isolationResult);
  const clearIsolation = useCanvasStore((s) => s.clearIsolation);

  if (!isolationResult) return null;

  const { boundaryValves = [], affectedEquipment = [], affectedLines = [] } = isolationResult;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        width: 280,
        background: alpha('#111D14', 0.95),
        borderRadius: 8,
        border: `1px solid ${md.outlineVariant}`,
        zIndex: 52,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: `1px solid ${md.outlineVariant}`,
          background: alpha('#E74C3C', 0.1),
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#E74C3C', letterSpacing: '0.05em' }}>
          ISOLATION BOUNDARY
        </span>
        <button
          onClick={clearIsolation}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 4,
            border: `1px solid ${md.outlineVariant}`,
            background: md.surfaceContainerHigh,
            color: md.onSurface,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
        {/* Valve lineup */}
        {boundaryValves.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Valve Lineup ({boundaryValves.length})
            </span>
            {boundaryValves.map((v) => (
              <div
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '3px 6px',
                  borderRadius: 4,
                  background: alpha('#E74C3C', 0.08),
                }}
              >
                <span style={{ fontSize: 10, color: md.onSurface, fontFamily: 'monospace' }}>
                  {v.tag}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#E74C3C',
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: alpha('#E74C3C', 0.15),
                  }}
                >
                  {v.action || 'CLOSE'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Affected counts */}
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#F39C12' }}>
              {affectedEquipment.length}
            </span>
            <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>Equipment</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: md.primary }}>
              {affectedLines.length}
            </span>
            <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>Lines</span>
          </div>
        </div>

        {/* Affected lines list */}
        {affectedLines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: md.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Affected Lines
            </span>
            {affectedLines.map((l) => (
              <span key={l.id} style={{ fontSize: 10, color: md.secondary, fontFamily: 'monospace' }}>
                {l.lineNumber} — {l.service}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(IsolationSummaryPanel);
