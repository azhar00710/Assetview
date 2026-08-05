import { useMemo } from 'react';
import useCanvasStore from '../store/useCanvasStore';

/**
 * Tracing overlay — highlights traced path, dims everything else.
 * Supports depth-based opacity: depth 0 = 100%, depth 1 = 90%, depth 2 = 80%, etc.
 * Gateway nodes on the trace path get a pulsing animation style.
 */
export default function useTracingOverlay() {
  const traceResult = useCanvasStore((s) => s.traceResult);
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

    if (!traceResult?.path?.length) return empty;

    const pathNodeIds = new Set(traceResult.path);
    const boundaryIds = new Set(traceResult.boundary || []);
    const crossSystemIds = new Set(traceResult.crossSystemIds || []);

    // Build depth map for depth-based opacity
    const depthMap = new Map();
    if (traceResult.startNodeId) {
      depthMap.set(traceResult.startNodeId, 0);
    }
    if (traceResult.pathDetails) {
      for (const item of traceResult.pathDetails) {
        depthMap.set(item.entityId, item.depth);
      }
    }

    const highlightedNodeIds = new Set(pathNodeIds);
    const highlightedEdgeIds = new Set();
    const dimmedNodeIds = new Set();
    const nodeStyles = new Map();
    const edgeStyles = new Map();

    for (const node of nodes) {
      if (!pathNodeIds.has(node.id) && !boundaryIds.has(node.id)) {
        dimmedNodeIds.add(node.id);
      }

      // Gateway nodes on the trace path pulse with accent color
      if (node.type === 'gateway' && (pathNodeIds.has(node.id) || crossSystemIds.has(node.id))) {
        highlightedNodeIds.add(node.id);
        dimmedNodeIds.delete(node.id);
        nodeStyles.set(node.id, {
          traceContinuation: true,
          pulseAnimation: true,
          glowColor: '#3BE494',
        });
      }

      // Path nodes get accent green glow with depth-based opacity
      if (pathNodeIds.has(node.id)) {
        const depth = depthMap.get(node.id) ?? 0;
        const depthOpacity = Math.max(0.3, 1 - depth * 0.1);
        nodeStyles.set(node.id, {
          ...(nodeStyles.get(node.id) || {}),
          highlighted: true,
          glowColor: '#3BE494',
          depthOpacity,
        });
      }
    }

    // Highlight edges where both source and target are on the trace path
    for (const edge of edges) {
      if (pathNodeIds.has(edge.source) && pathNodeIds.has(edge.target)) {
        highlightedEdgeIds.add(edge.id);
        edgeStyles.set(edge.id, {
          stroke: '#3BE494',
          strokeWidth: 3,
          opacity: 1,
        });
      }
    }

    return {
      highlightedNodeIds,
      highlightedEdgeIds,
      dimmedNodeIds,
      nodeStyles,
      edgeStyles,
    };
  }, [traceResult, nodes, edges]);
}
