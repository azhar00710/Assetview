import { useMemo } from 'react';
import useCanvasStore from '../store/useCanvasStore';

/**
 * Isolation overlay — highlights isolation boundary.
 * Reads isolationResult from canvas store (set by NodeDetailPanel API call).
 *
 * - Boundary valves: RED highlight + "CLOSE" label overlay
 * - Affected equipment: ORANGE highlight
 * - Non-isolation-zone nodes: 20% opacity
 */
export default function useIsolationOverlay() {
  const isolationResult = useCanvasStore((s) => s.isolationResult);
  const nodes = useCanvasStore((s) => s.nodes);

  return useMemo(() => {
    const empty = {
      highlightedNodeIds: new Set(),
      highlightedEdgeIds: new Set(),
      dimmedNodeIds: new Set(),
      nodeStyles: new Map(),
      edgeStyles: new Map(),
    };

    if (!isolationResult) return empty;

    const boundaryValveIds = new Set(
      (isolationResult.boundaryValves || []).map((v) => v.id)
    );
    const affectedIds = new Set(
      (isolationResult.affectedEquipment || []).map((e) => e.id)
    );
    const isolationZone = new Set(isolationResult.isolationZone || []);

    // Build action map for boundary valves (CLOSE / BLIND)
    const valveActionMap = new Map();
    for (const v of isolationResult.boundaryValves || []) {
      valveActionMap.set(v.id, v.action || 'CLOSE');
    }

    const highlightedNodeIds = new Set([...boundaryValveIds, ...affectedIds]);
    const dimmedNodeIds = new Set();
    const nodeStyles = new Map();

    for (const node of nodes) {
      if (boundaryValveIds.has(node.id)) {
        nodeStyles.set(node.id, {
          highlighted: true,
          borderColor: '#E74C3C',
          glowColor: '#E74C3C',
          isolationLabel: valveActionMap.get(node.id) || 'CLOSE',
        });
      } else if (affectedIds.has(node.id)) {
        nodeStyles.set(node.id, {
          highlighted: true,
          borderColor: '#F39C12',
          glowColor: '#F39C12',
        });
      } else if (!isolationZone.has(node.id)) {
        dimmedNodeIds.add(node.id);
      }
    }

    return {
      highlightedNodeIds,
      highlightedEdgeIds: new Set(),
      dimmedNodeIds,
      nodeStyles,
      edgeStyles: new Map(),
    };
  }, [isolationResult, nodes]);
}
