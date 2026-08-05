import { memo, useCallback } from 'react';
import useCanvasStore from '../../canvas/store/useCanvasStore';
import { md, alpha } from '../../lib/theme';

const API = import.meta.env.VITE_API_URL || '/api/v1';

function SelectionToolbar() {
  const selectedNodeIds = useCanvasStore((s) => s.selectedNodeIds);
  const deselectAll = useCanvasStore((s) => s.deselectAll);
  const setTraceResult = useCanvasStore((s) => s.setTraceResult);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);
  const setSelectedNode = useCanvasStore((s) => s.setSelectedNode);

  const selectedArr = [...selectedNodeIds];

  const handleTraceSelected = useCallback(async () => {
    if (selectedArr.length < 2) return;
    const startId = selectedArr[0];
    const endId = selectedArr[selectedArr.length - 1];
    try {
      const res = await fetch(`${API}/topology/downstream/${startId}?maxDepth=50`);
      if (!res.ok) return;
      const data = await res.json();
      const pathIds = [startId, ...(data.visitedIds || data.path?.map((p) => p.entityId) || [])];
      setTraceResult({
        startNodeId: startId,
        direction: 'downstream',
        path: pathIds,
        pathDetails: data.path || [],
        boundary: [],
        targetNodeId: endId,
      });
    } catch (err) {
      console.error('Trace selected failed:', err);
    }
  }, [selectedArr, setTraceResult]);

  const handleShowCommonLines = useCallback(() => {
    // Find edges where both source AND target are in selected set
    const commonEdgeIds = edges
      .filter((e) => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target))
      .map((e) => e.id);
    if (commonEdgeIds.length === 0) return;
    // Use trace result to highlight these edges
    setTraceResult({
      startNodeId: selectedArr[0],
      direction: 'common',
      path: selectedArr,
      pathDetails: [],
      boundary: [],
      commonEdges: commonEdgeIds,
    });
  }, [edges, selectedNodeIds, selectedArr, setTraceResult]);

  const handleCompareProperties = useCallback(() => {
    const selectedNodes = nodes.filter((n) => selectedNodeIds.has(n.id));
    if (selectedNodes.length >= 2) {
      setSelectedNode({
        id: 'compare',
        type: 'compare',
        data: { nodes: selectedNodes.slice(0, 4) },
      });
    }
  }, [nodes, selectedNodeIds, setSelectedNode]);

  if (selectedNodeIds.size < 2) return null;

  const btnStyle = {
    fontSize: 11,
    fontWeight: 600,
    padding: '5px 12px',
    borderRadius: 6,
    border: `1px solid ${md.outlineVariant}`,
    background: md.surfaceContainerHigh,
    color: md.onSurface,
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2"
      style={{
        background: md.surfaceContainer,
        border: `1px solid ${md.outlineVariant}`,
        borderRadius: 10,
        padding: '6px 12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      }}
    >
      <span style={{ fontSize: 11, color: md.onSurfaceVariant, fontWeight: 600 }}>
        {selectedNodeIds.size} selected
      </span>
      <div style={{ width: 1, height: 16, background: md.outlineVariant }} />
      <button style={{ ...btnStyle, color: '#3BE494', borderColor: '#3BE494' }} onClick={handleTraceSelected}>
        Trace Selected
      </button>
      <button style={btnStyle} onClick={handleShowCommonLines}>
        Show Common Lines
      </button>
      <button style={btnStyle} onClick={handleCompareProperties}>
        Compare Properties
      </button>
      <button
        style={{ ...btnStyle, color: md.onSurfaceVariant, border: 'none', background: 'transparent' }}
        onClick={deselectAll}
      >
        Clear
      </button>
    </div>
  );
}

export default memo(SelectionToolbar);
