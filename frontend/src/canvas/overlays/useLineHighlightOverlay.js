import { useMemo } from 'react';
import useCanvasStore from '../store/useCanvasStore';

// 10-color palette for line color mode
const LINE_COLORS = [
  '#3BE494', '#2D33E0', '#E74C3C', '#F39C12', '#9B59B6',
  '#1ABC9C', '#E67E22', '#3498DB', '#E91E63', '#00BCD4',
];

/**
 * Line highlight overlay — highlights all edges/nodes belonging to hovered or selected line.
 * Also supports line color mode (each line gets a unique color).
 *
 * @returns {{ highlightedNodeIds: Set, highlightedEdgeIds: Set, dimmedNodeIds: Set, nodeStyles: Map, edgeStyles: Map }}
 */
export default function useLineHighlightOverlay() {
  const hoveredLineId = useCanvasStore((s) => s.hoveredLineId);
  const selectedLineId = useCanvasStore((s) => s.selectedLineId);
  const lineColorMode = useCanvasStore((s) => s.lineColorMode);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  return useMemo(() => {
    const empty = {
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      dimmedNodeIds: new Set(),
      nodeStyles: new Map(),
      edgeStyles: new Map(),
    };

    const activeLineId = hoveredLineId || selectedLineId;

    // Line color mode: color all edges by their lineId
    if (lineColorMode && !activeLineId) {
      const edgeStyles = new Map();
      const lineIndexMap = new Map();
      let colorIdx = 0;

      for (const edge of edges) {
        const lid = edge.data?.lineId || edge.lineId;
        if (!lid) continue;
        if (!lineIndexMap.has(lid)) {
          lineIndexMap.set(lid, colorIdx++);
        }
        const color = LINE_COLORS[lineIndexMap.get(lid) % LINE_COLORS.length];
        edgeStyles.set(edge.id, { stroke: color, strokeWidth: 3 });
      }

      return { ...empty, edgeStyles };
    }

    if (!activeLineId) return empty;

    const highlightedNodeIds = new Set();
    const highlightedEdgeIds = new Set();
    const dimmedNodeIds = new Set();
    const nodeStyles = new Map();
    const edgeStyles = new Map();

    // Find all edges belonging to this line
    for (const edge of edges) {
      const lid = edge.data?.lineId || edge.lineId;
      if (lid === activeLineId) {
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
        edgeStyles.set(edge.id, {
          stroke: '#3BE494',
          strokeWidth: 6,
          opacity: 1,
        });
      }
    }

    // Also highlight nodes that belong to this line (by data.lineId)
    for (const node of nodes) {
      if (node.data?.lineId === activeLineId) {
        highlightedNodeIds.add(node.id);
      }
    }

    // Dim all non-highlighted nodes
    for (const node of nodes) {
      if (!highlightedNodeIds.has(node.id)) {
        dimmedNodeIds.add(node.id);
      } else {
        nodeStyles.set(node.id, {
          highlighted: true,
          glowColor: '#3BE494',
        });
      }
    }

    // In line color mode + active line, also color other lines
    if (lineColorMode) {
      const lineIndexMap = new Map();
      let colorIdx = 0;
      for (const edge of edges) {
        const lid = edge.data?.lineId || edge.lineId;
        if (!lid || lid === activeLineId) continue;
        if (!lineIndexMap.has(lid)) lineIndexMap.set(lid, colorIdx++);
        const color = LINE_COLORS[lineIndexMap.get(lid) % LINE_COLORS.length];
        if (!edgeStyles.has(edge.id)) {
          edgeStyles.set(edge.id, { stroke: color, strokeWidth: 2 });
        }
      }
    }

    return {
      highlightedNodeIds,
      highlightedEdgeIds,
      dimmedNodeIds,
      nodeStyles,
      edgeStyles,
    };
  }, [hoveredLineId, selectedLineId, lineColorMode, nodes, edges]);
}
