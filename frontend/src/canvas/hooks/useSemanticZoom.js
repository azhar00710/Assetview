/**
 * useSemanticZoom — Filters nodes/edges by the current zoom level.
 *
 * Zoom thresholds:
 *   OVERVIEW (<0.45x): only collapsedGroup nodes + cross-system edges
 *   SYSTEM (0.45x–1.2x): equipment + pipe edges (ISA symbols WITHOUT instrument detail text)
 *   DETAIL (>1.2x): everything visible with ALL labels, ranges, SCADA tags
 *
 * Reads viewport zoom from useCanvasStore.
 * Injects `zoomLevel` into node data so nodes can conditionally render detail.
 */
import { useMemo } from 'react';
import useCanvasStore from '../store/useCanvasStore';

/** Zoom level thresholds */
export const ZOOM_THRESHOLDS = {
  OVERVIEW_MAX: 0.45,
  DETAIL_MIN: 1.2,
};

/**
 * Determine the semantic zoom level from a numeric zoom value.
 * @param {number} zoom
 * @returns {'OVERVIEW'|'SYSTEM'|'DETAIL'}
 */
export function getZoomLevel(zoom) {
  if (zoom < ZOOM_THRESHOLDS.OVERVIEW_MAX) return 'OVERVIEW';
  if (zoom < ZOOM_THRESHOLDS.DETAIL_MIN) return 'SYSTEM';
  return 'DETAIL';
}

/**
 * @param {object[]} nodes - All positioned nodes
 * @param {object[]} edges - All positioned edges
 * @returns {{ visibleNodes: object[], visibleEdges: object[], zoomLevel: string }}
 */
export default function useSemanticZoom(nodes, edges) {
  const viewport = useCanvasStore((s) => s.viewport);
  const zoomLevel = getZoomLevel(viewport.zoom);

  const visibleNodes = useMemo(() => {
    let filtered;
    if (zoomLevel === 'OVERVIEW') {
      filtered = nodes.filter((n) => n.type === 'collapsedGroup');
    } else if (zoomLevel === 'SYSTEM') {
      // Show equipment, tee, gateway — hide instruments at SYSTEM level
      filtered = nodes.filter((n) => n.type !== 'instrument');
    } else {
      filtered = nodes;
    }

    // Inject zoomLevel into every visible node's data so components
    // can conditionally render detail (e.g., InstrumentNode shows range only at DETAIL)
    return filtered.map((n) => ({
      ...n,
      data: { ...n.data, zoomLevel },
    }));
  }, [nodes, zoomLevel]);

  const visibleEdges = useMemo(() => {
    if (zoomLevel === 'OVERVIEW') {
      return edges.filter((e) => e.type === 'boundary');
    }
    if (zoomLevel === 'SYSTEM') {
      return edges.filter((e) => e.type !== 'signal');
    }
    return edges;
  }, [edges, zoomLevel]);

  return { visibleNodes, visibleEdges, zoomLevel };
}
