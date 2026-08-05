import { useState, useEffect, useCallback, memo } from 'react';
import { md, alpha } from '../../lib/theme';
import useCanvasStore from '../../canvas/store/useCanvasStore';

const API = import.meta.env.VITE_API_URL || '/api/v1';

const STATUS_COLORS = {
  as_built: '#3BE494',
  approved: '#2D33E0',
  draft: '#E67E22',
};

function StatusBadge({ status }) {
  if (!status) return null;
  const color = STATUS_COLORS[status?.toLowerCase()?.replace(/[\s-]/g, '_')] || md.onSurfaceVariant;
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 9999,
        background: alpha(color, 0.2),
        color,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {status}
    </span>
  );
}

function SheetRow({ pnid, isActive, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onClick(pnid)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        background: isActive
          ? alpha(md.primary, 0.15)
          : hovered
            ? alpha(md.surfaceBright, 0.5)
            : 'transparent',
        borderLeft: isActive ? `3px solid ${md.primary}` : '3px solid transparent',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: md.onSurface,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {pnid.drawingNumber || pnid.drawing_number}
        </span>
        <span
          style={{
            fontSize: 10,
            color: md.onSurfaceVariant,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 200,
          }}
        >
          {pnid.title}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {pnid.revision && (
          <span style={{ fontSize: 9, color: md.onSurfaceVariant, fontFamily: 'monospace' }}>
            Rev {pnid.revision}
          </span>
        )}
        <StatusBadge status={pnid.status} />
      </div>
    </div>
  );
}

/**
 * SheetPanel — Bottom drawer listing P&IDs for the current system.
 * Toggle via "Sheets" button in CanvasToolbar.
 * Clicking a P&ID row opens the PnidViewer (emits via onOpenPnid).
 */
function SheetPanel({ systemId, onOpenPnid, onClose }) {
  const [pnids, setPnids] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activePnidId, setActivePnidId] = useState(null);
  const nodes = useCanvasStore((s) => s.nodes);

  useEffect(() => {
    if (!systemId) {
      setPnids([]);
      return;
    }
    setLoading(true);
    let cancelled = false;

    fetch(`${API}/pnids?system_id=${systemId}&include_xref=true`)
      .then((res) => res.ok ? res.json() : { pnids: [] })
      .then((data) => {
        if (!cancelled) setPnids(data.pnids || data || []);
      })
      .catch(() => {
        if (!cancelled) setPnids([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [systemId]);

  const handlePnidClick = useCallback(
    (pnid) => {
      setActivePnidId(pnid.id);
      onOpenPnid?.(pnid);
    },
    [onOpenPnid]
  );

  if (!systemId) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 200,
        background: md.surfaceContainer,
        borderTop: `1px solid ${md.outlineVariant}`,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideUpSheet 0.2s ease-out',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: `1px solid ${md.outlineVariant}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={md.onSurfaceVariant} strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span style={{ fontSize: 11, fontWeight: 700, color: md.onSurface }}>
            P&ID Sheets
          </span>
          <span style={{ fontSize: 10, color: md.onSurfaceVariant }}>
            ({pnids.length})
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: md.onSurfaceVariant,
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 4px',
        }}
      >
        {loading && (
          <div style={{ padding: 12, fontSize: 11, color: md.onSurfaceVariant }}>
            Loading sheets...
          </div>
        )}
        {!loading && pnids.length === 0 && (
          <div style={{ padding: 12, fontSize: 11, color: md.onSurfaceVariant }}>
            No P&ID sheets found for this system.
          </div>
        )}
        {pnids.map((pnid) => (
          <SheetRow
            key={pnid.id}
            pnid={pnid}
            isActive={pnid.id === activePnidId}
            onClick={handlePnidClick}
          />
        ))}
      </div>

      <style>{`
        @keyframes slideUpSheet {
          from { transform: translateY(200px); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default memo(SheetPanel);
