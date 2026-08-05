/**
 * layoutPersistence — Save and load node positions to/from the backend API.
 *
 * Endpoints:
 *   GET  /api/v1/topology/layout/:systemId → [{ entityId, x, y, pinned }]
 *   PUT  /api/v1/topology/layout/:systemId → save positions
 */

const API = import.meta.env.VITE_API_URL || '/api/v1';

/**
 * Load persisted layout positions for a system.
 * @param {string} systemId
 * @returns {Promise<Array<{ entityId: string, x: number, y: number, pinned: boolean }>>}
 */
export async function loadLayout(systemId) {
  const res = await fetch(`${API}/topology/layout/${systemId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.positions || data || [];
}

/**
 * Save layout positions for a system.
 * @param {string} systemId
 * @param {Array<{ entityId: string, x: number, y: number, pinned?: boolean }>} positions
 */
export async function saveLayout(systemId, positions) {
  await fetch(`${API}/topology/layout/${systemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions }),
  });
}

/**
 * Merge persisted positions onto raw nodes. Nodes without a saved position
 * keep their original (or zero) position.
 * @param {object[]} nodes - React Flow nodes
 * @param {Array<{ entityId: string, x: number, y: number }>} savedPositions
 * @returns {object[]} Nodes with saved x,y applied where available
 */
export function mergePersistedPositions(nodes, savedPositions) {
  const posMap = new Map(savedPositions.map((p) => [p.entityId, p]));
  return nodes.map((node) => {
    const saved = posMap.get(node.id);
    if (!saved) return node;
    return { ...node, position: { x: saved.x, y: saved.y } };
  });
}
