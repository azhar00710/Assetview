import { memo } from 'react';
import useCanvasStore from '../../canvas/store/useCanvasStore';
import OverlayManager from '../../canvas/overlays/OverlayManager';
import { md, alpha } from '../../lib/theme';

const TB = {
  fontWeight: 700,
  letterSpacing: '0.03em',
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s, border-color 0.15s',
};

function TBtn({ active, onClick, title, children, color }) {
  const c = color || md.secondary;
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-1 rounded text-xs flex items-center gap-1"
      style={{
        ...TB,
        background: active ? alpha(c, 0.25) : 'transparent',
        color: active ? c : md.onSurfaceVariant,
        border: `1px solid ${active ? c : md.outlineVariant}`,
      }}
    >
      {children}
    </button>
  );
}

function CanvasToolbar({
  systemLabel,
  systemColor: sysColor,
  zoomLevel,
  onBack,
  onOverview,
  hasSystem,
  xrefEnabled,
  onToggleXref,
  sheetsOpen,
  onToggleSheets,
  lineColorMode,
  onToggleLineColor,
  draftMode,
  onToggleDraft,
  generateOpen,
  onToggleGenerate,
  onSaveLayout,
  onResetLayout,
  onExportPng,
  onExportSvg,
  children,
}) {
  const traceResult = useCanvasStore((s) => s.traceResult);
  const clearTrace = useCanvasStore((s) => s.clearTrace);
  const isolationResult = useCanvasStore((s) => s.isolationResult);
  const clearIsolation = useCanvasStore((s) => s.clearIsolation);

  const ZOOM_LABELS = { OVERVIEW: 'Overview', SYSTEM: 'System', DETAIL: 'Detail' };

  return (
    <div
      className="flex items-center px-3 py-2 gap-2 shrink-0 flex-wrap"
      style={{
        background: md.surfaceContainer,
        borderBottom: `1px solid ${md.outlineVariant}`,
      }}
    >
      {onBack && (
        <>
          <button
            onClick={onBack}
            title="Go back"
            className="text-sm hover:opacity-80"
            style={{ color: md.onSurfaceVariant }}
          >
            &larr; Back
          </button>
          <div style={{ width: 1, height: 16, background: md.outlineVariant }} />
        </>
      )}

      {/* System label */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {sysColor && (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sysColor }} />
        )}
        <span
          style={{ fontSize: 13, fontWeight: 600, color: sysColor || md.onSurface }}
          className="truncate"
        >
          {systemLabel}
        </span>
      </div>

      {/* Clear Trace */}
      {traceResult?.path?.length > 0 && (
        <button
          onClick={clearTrace}
          title="Clear trace (Escape)"
          className="px-2 py-1 rounded text-xs flex items-center gap-1"
          style={{ ...TB, background: alpha('#3BE494', 0.2), color: '#3BE494', border: '1px solid #3BE494' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          Clear Trace
        </button>
      )}

      {/* Clear Isolation */}
      {isolationResult && (
        <button
          onClick={clearIsolation}
          title="Clear isolation (Escape)"
          className="px-2 py-1 rounded text-xs flex items-center gap-1"
          style={{ ...TB, background: alpha('#E74C3C', 0.2), color: '#E74C3C', border: '1px solid #E74C3C' }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          Clear Isolation
        </button>
      )}

      {/* Toggle buttons */}
      {hasSystem && onToggleXref && (
        <TBtn active={xrefEnabled} onClick={onToggleXref} title="Toggle cross-references (X)">
          X-Ref
        </TBtn>
      )}

      {hasSystem && onToggleSheets && (
        <TBtn active={sheetsOpen} onClick={onToggleSheets} title="Toggle sheets panel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Sheets
        </TBtn>
      )}

      {hasSystem && onToggleLineColor && (
        <TBtn active={lineColorMode} onClick={onToggleLineColor} title="Toggle line colors">
          Lines
        </TBtn>
      )}

      {hasSystem && onToggleDraft && (
        <TBtn active={draftMode} onClick={onToggleDraft} title="Toggle drafting mode (D)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Draft
        </TBtn>
      )}

      {hasSystem && onToggleGenerate && (
        <TBtn active={generateOpen} onClick={onToggleGenerate} title="Generate canvas from P&ID annotations" color="#F39C12">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          Generate
        </TBtn>
      )}

      {/* Layout persistence */}
      {hasSystem && onSaveLayout && (
        <TBtn onClick={onSaveLayout} title="Save current layout positions">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          Save
        </TBtn>
      )}
      {hasSystem && onResetLayout && (
        <TBtn onClick={onResetLayout} title="Reset layout to auto-computed positions">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          Reset
        </TBtn>
      )}

      <div style={{ width: 1, height: 16, background: md.outlineVariant }} />

      {/* Export buttons */}
      {onExportPng && (
        <TBtn onClick={onExportPng} title="Export canvas as PNG image">
          PNG
        </TBtn>
      )}
      {onExportSvg && (
        <TBtn onClick={onExportSvg} title="Export canvas as SVG vector">
          SVG
        </TBtn>
      )}

      {/* Canvas search (injected via children) */}
      {children}

      {/* Overlay toggles */}
      <OverlayManager />

      {/* Zoom level indicator */}
      <div
        className="flex items-center gap-1 px-2 py-1 rounded"
        style={{ background: alpha(md.primary, 0.1) }}
      >
        <span style={{ fontSize: 10, color: md.primary, fontWeight: 600 }}>
          {ZOOM_LABELS[zoomLevel] || 'System'}
        </span>
        <span style={{ fontSize: 9, color: md.onSurfaceVariant }}>zoom</span>
      </div>

      {/* Back to overview */}
      {hasSystem && onOverview && (
        <button
          onClick={onOverview}
          title="Return to platform overview (F to fit view)"
          className="px-2 py-1 rounded text-xs hover:opacity-80"
          style={{
            background: alpha(md.secondary, 0.15),
            color: md.secondary,
            fontWeight: 600,
          }}
        >
          Overview
        </button>
      )}
    </div>
  );
}

export default memo(CanvasToolbar);
