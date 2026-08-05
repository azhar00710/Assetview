import { useMemo } from 'react';
import useCanvasStore from '../store/useCanvasStore';

// TODO: replace mock with GET /api/v1/corrosion/equipment?system_id=...

const SEVERITY_COLORS = {
  high: '#E74C3C',
  medium: '#F39C12',
  low: '#FFD466',
};

/**
 * Corrosion overlay — color-codes nodes by corrosion severity.
 * When corrosion toggle is ON, generates mock severity from equipment.corrosion_loop field:
 *   - Loops with "H" prefix → high (red)
 *   - Loops with "M" prefix → medium (orange)
 *   - Others → low (yellow)
 */
export default function useCorrosionOverlay() {
  const activeOverlays = useCanvasStore((s) => s.activeOverlays);
  const nodes = useCanvasStore((s) => s.nodes);

  return useMemo(() => {
    const empty = {
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      dimmedNodeIds: new Set(),
      nodeStyles: new Map(),
      edgeStyles: new Map(),
    };

    if (!activeOverlays.has('corrosion')) return empty;

    const highlightedNodeIds = new Set();
    const nodeStyles = new Map();

    for (const node of nodes) {
      const loop = node.data?.corrosionLoop || node.data?.corrosion_loop;
      if (!loop) continue;

      // Severity mapping based on corrosion_loop prefix
      let severity = 'low';
      const prefix = loop.charAt(0).toUpperCase();
      if (prefix === 'H') severity = 'high';
      else if (prefix === 'M') severity = 'medium';

      const color = SEVERITY_COLORS[severity];
      highlightedNodeIds.add(node.id);
      nodeStyles.set(node.id, {
        borderColor: color,
        glowColor: color,
        corrosionSeverity: severity,
      });
    }

    return {
      highlightedNodeIds,
      highlightedEdgeIds: new Set(),
      dimmedNodeIds: new Set(),
      nodeStyles,
      edgeStyles: new Map(),
    };
  }, [activeOverlays, nodes]);
}
