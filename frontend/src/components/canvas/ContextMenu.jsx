import { memo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import useCanvasStore from '../../canvas/store/useCanvasStore';
import { md, alpha } from '../../lib/theme';

const API = import.meta.env.VITE_API_URL || '/api/v1';

const MENU_CONFIGS = {
  equipment: [
    { key: 'upstream', label: 'Trace Upstream', icon: '↑' },
    { key: 'downstream', label: 'Trace Downstream', icon: '↓' },
    { key: 'isolation', label: 'Find Isolation', icon: '⚠', color: '#E74C3C' },
    { key: 'showOnPnid', label: 'Show on P&ID', icon: '📄' },
    { key: 'highlightLine', label: 'Highlight Line', icon: '━' },
    { key: 'pin', label: 'Pin Node', icon: '📌' },
    { key: 'properties', label: 'Properties', icon: 'ℹ' },
  ],
  instrument: [
    { key: 'showLoop', label: 'Show Loop', icon: '↻' },
    { key: 'showOnPnid', label: 'Show on P&ID', icon: '📄' },
    { key: 'pin', label: 'Pin Node', icon: '📌' },
    { key: 'properties', label: 'Properties', icon: 'ℹ' },
  ],
  gateway: [
    { key: 'navigateToSystem', label: 'Navigate to System', icon: '→' },
    { key: 'traceAcross', label: 'Trace Across Boundary', icon: '⇥' },
    { key: 'pin', label: 'Pin Node', icon: '📌' },
  ],
  collapsedGroup: [
    { key: 'expandSystem', label: 'Expand System', icon: '⊞' },
    { key: 'showSystemPnids', label: 'Show System P&IDs', icon: '📄' },
    { key: 'compareWith', label: 'Compare With...', icon: '⇔' },
    { key: 'pin', label: 'Pin Node', icon: '📌' },
  ],
};

function ContextMenu({ onNavigate, onTraceAcross }) {
  const contextMenu = useCanvasStore((s) => s.contextMenu);
  const clearContextMenu = useCanvasStore((s) => s.clearContextMenu);
  const setTraceResult = useCanvasStore((s) => s.setTraceResult);
  const setIsolationResult = useCanvasStore((s) => s.setIsolationResult);
  const setVisibleCrossSystems = useCanvasStore((s) => s.setVisibleCrossSystems);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);
  const selectLine = useCanvasStore((s) => s.selectLine);
  const pinnedNodeIds = useCanvasStore((s) => s.pinnedNodeIds);
  const togglePinNode = useCanvasStore((s) => s.togglePinNode);

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

  const { x, y, nodeId, nodeData, nodeType } = contextMenu;
  const isPinned = pinnedNodeIds?.has?.(nodeId);

  // Get menu items for this node type
  let menuItems = MENU_CONFIGS[nodeType] || MENU_CONFIGS.equipment;
  // Swap pin label if already pinned
  menuItems = menuItems.map((item) =>
    item.key === 'pin'
      ? { ...item, label: isPinned ? 'Unpin Node' : 'Pin Node', icon: isPinned ? '📍' : '📌' }
      : item
  );

  const handleAction = async (action) => {
    clearContextMenu();

    switch (action) {
      case 'upstream':
      case 'downstream': {
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
        break;
      }
      case 'isolation': {
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
        break;
      }
      case 'properties':
        setSelectedNode({ id: nodeId, type: nodeType, data: nodeData });
        break;
      case 'highlightLine':
        if (nodeData?.lineId) selectLine(nodeData.lineId);
        break;
      case 'showOnPnid':
        // Open detail panel with P&ID view hint
        setSelectedNode({ id: nodeId, type: nodeType, data: { ...nodeData, showPnid: true } });
        break;
      case 'showLoop':
        // Trace signal connections for instrument loop
        try {
          const res = await fetch(`${API}/topology/downstream/${nodeId}?maxDepth=10`);
          if (!res.ok) return;
          const data = await res.json();
          const loopIds = [nodeId, ...(data.visitedIds || [])];
          setTraceResult({ startNodeId: nodeId, direction: 'loop', path: loopIds, pathDetails: data.path || [], boundary: [] });
        } catch (err) {
          console.error('Show loop failed:', err);
        }
        break;
      case 'navigateToSystem':
        if (nodeData?.targetSystemId) onNavigate?.(nodeData.targetSystemId);
        break;
      case 'traceAcross':
        if (nodeData?.targetSystemId) onTraceAcross?.(nodeData.targetSystemId, nodeId);
        break;
      case 'expandSystem':
        if (nodeData?.systemId) onNavigate?.(nodeData.systemId);
        break;
      case 'showSystemPnids':
        setSelectedNode({ id: nodeId, type: 'collapsedGroup', data: { ...nodeData, showPnids: true } });
        break;
      case 'compareWith':
        setSelectedNode({ id: nodeId, type: 'compare', data: { ...nodeData, compareMode: true } });
        break;
      case 'pin':
        togglePinNode(nodeId);
        break;
      default:
        break;
    }
  };

  const menu = (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        background: md.surfaceContainerHigh,
        border: `1px solid ${md.outlineVariant}`,
        borderRadius: 8,
        padding: 4,
        minWidth: 180,
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ padding: '4px 8px', fontSize: 10, color: md.onSurfaceVariant, fontFamily: 'monospace', borderBottom: `1px solid ${md.outlineVariant}`, marginBottom: 2 }}>
        {nodeData?.tag || nodeType || 'Node'}
      </div>
      {menuItems.map(({ key, label, icon, color }) => (
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
            color: color || md.onSurface,
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

  return createPortal(menu, document.body);
}

export default memo(ContextMenu);
