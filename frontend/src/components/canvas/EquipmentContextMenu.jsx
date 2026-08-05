import { memo, useEffect, useCallback } from 'react';
import useCanvasStore from '../../canvas/store/useCanvasStore';
import { md, alpha } from '../../lib/theme';

const API = import.meta.env.VITE_API_URL || '/api/v1';

const MENU_ITEMS = [
  { key: 'upstream', label: 'Trace Upstream', icon: '\u2191' },
  { key: 'downstream', label: 'Trace Downstream', icon: '\u2193' },
  { key: 'isolation', label: 'Find Isolation', icon: '\u26A0' },
];

/**
 * EquipmentContextMenu — right-click context menu for equipment/instrument nodes.
 * ~60 lines, absolute-positioned div.
 */
function EquipmentContextMenu() {
  const contextMenu = useCanvasStore((s) => s.contextMenu);
  const clearContextMenu = useCanvasStore((s) => s.clearContextMenu);
  const setTraceResult = useCanvasStore((s) => s.setTraceResult);
  const setIsolationResult = useCanvasStore((s) => s.setIsolationResult);
  const setVisibleCrossSystems = useCanvasStore((s) => s.setVisibleCrossSystems);

  // Close on click outside or Escape
  const handleClose = useCallback(() => clearContextMenu(), [clearContextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    const onClick = () => handleClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [contextMenu, handleClose]);

  if (!contextMenu) return null;

  const { x, y, nodeId, nodeData } = contextMenu;

  const handleAction = async (action) => {
    clearContextMenu();
    if (action === 'upstream' || action === 'downstream') {
      try {
        const res = await fetch(`${API}/topology/${action}/${nodeId}?maxDepth=50`);
        if (!res.ok) return;
        const data = await res.json();
        const pathIds = [nodeId, ...(data.visitedIds || data.path?.map((p) => p.entityId) || [])];
        const pathDetails = data.path || [];
        const crossSystemIds = [];
        for (const item of pathDetails) {
          if (item.metadata?.target_system_id && item.metadata.target_system_id !== nodeData?.systemId) {
            crossSystemIds.push(item.metadata.target_system_id);
          }
        }
        if (crossSystemIds.length > 0) setVisibleCrossSystems([...new Set(crossSystemIds)]);
        setTraceResult({ startNodeId: nodeId, direction: action, path: pathIds, pathDetails, boundary: [], crossSystemIds });
      } catch (err) {
        console.error(`Context menu trace ${action} failed:`, err);
      }
    } else if (action === 'isolation') {
      try {
        const res = await fetch(`${API}/topology/isolation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ equipmentId: nodeId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        setIsolationResult(data);
      } catch (err) {
        console.error('Context menu isolation failed:', err);
      }
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        zIndex: 100,
        background: md.surfaceContainerHigh,
        border: `1px solid ${md.outlineVariant}`,
        borderRadius: 8,
        padding: 4,
        minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: '4px 8px', fontSize: 10, color: md.onSurfaceVariant, fontFamily: 'monospace', borderBottom: `1px solid ${md.outlineVariant}`, marginBottom: 2 }}>
        {nodeData?.tag || 'Equipment'}
      </div>
      {MENU_ITEMS.map(({ key, label, icon }) => (
        <button
          key={key}
          onClick={() => handleAction(key)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '6px 8px',
            fontSize: 11,
            color: key === 'isolation' ? '#E74C3C' : md.onSurface,
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = alpha(md.primary, 0.12))}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: 12, width: 16, textAlign: 'center' }}>{icon}</span>
          {label}
        </button>
      ))}
    </div>
  );
}

export default memo(EquipmentContextMenu);
