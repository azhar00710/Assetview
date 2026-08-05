/**
 * @deprecated This module is superseded by topologyQueries.js which uses
 * PostgreSQL recursive CTEs via the topology_edges table. This file is
 * retained for backward compatibility with legacy /systems/:systemId/topology
 * endpoints. New code should use topologyQueries.js instead.
 *
 * Graph utilities for building topology graphs and performing BFS traversal.
 * Builds React Flow compatible nodes and edges from equipment/line data.
 */

// Equipment type flow ordering (upstream → downstream in a typical well system)
const FLOW_ORDER = {
  'Safety Valve': 0,    // DHSV - downhole
  'Christmas Tree': 1,  // XT - wellhead
  'Choke Valve': 2,     // CV - flow control
  'Spectacle Blind': 3, // SPB - isolation
  'Header': 4,          // PM/GL-HDR - collection
  'Vessel': 5,          // Tanks/drums
  'Package': 6,         // Utility packages
};

// System type colors matching frontend constants
const SYSTEM_TYPE_COLORS = {
  process: '#4FE2B0',
  utility: '#8AB4FF',
  safety: '#FF897A',
  instrument: '#FFD666',
};

/**
 * Extract well number and optional string suffix from equipment tag.
 * E.g., "PV019-XT" → { well: "019", suffix: null }
 *       "CV-019S"  → { well: "019", suffix: "S" }
 *       "DHSV-019L" → { well: "019", suffix: "L" }
 */
function extractWellInfo(tag) {
  const match = tag.match(/(\d{3,})([SL])?(?:\b|-|$)/);
  if (!match) return null;
  return { well: match[1], suffix: match[2] || null };
}

/**
 * Determine string suffix for equipment without explicit S/L suffix.
 * Uses description to detect "Short String" vs "Long String".
 */
function inferStringSuffix(eq) {
  const info = extractWellInfo(eq.tag);
  if (!info) return null;
  if (info.suffix) return info.suffix;

  // Check description for Short/Long String hints
  const desc = (eq.description || '').toLowerCase();
  if (desc.includes('short string')) return 'S';
  if (desc.includes('long string')) return 'L';
  return null;
}

/**
 * Build adjacency list from equipment within a system.
 * Infers edges from:
 *   1. Well number grouping + equipment type flow ordering
 *   2. String suffix matching (S/L) within well groups
 *   3. Line-based connections for on-line equipment
 */
export function buildGraph(equipment, lines, pnidEquipment) {
  const nodes = new Map(); // id → node data
  const adjForward = new Map();  // id → Set of downstream neighbor ids
  const adjReverse = new Map();  // id → Set of upstream neighbor ids

  // Build node map
  for (const eq of equipment) {
    nodes.set(eq.id, eq);
    adjForward.set(eq.id, new Set());
    adjReverse.set(eq.id, new Set());
  }

  function addEdge(fromId, toId) {
    if (fromId === toId) return;
    if (!nodes.has(fromId) || !nodes.has(toId)) return;
    adjForward.get(fromId).add(toId);
    adjReverse.get(toId).add(fromId);
  }

  // Group equipment by well number
  const byWell = new Map();
  for (const eq of equipment) {
    const info = extractWellInfo(eq.tag);
    if (!info) continue;
    if (!byWell.has(info.well)) byWell.set(info.well, []);
    byWell.get(info.well).push(eq);
  }

  // Within each well group, build string-specific flow paths
  for (const [, wellGroup] of byWell) {
    // Assign each equipment to a string path (S, L, or shared)
    const byString = new Map(); // suffix → equipment[]

    for (const eq of wellGroup) {
      const suffix = inferStringSuffix(eq);
      const key = suffix || '_shared';
      if (!byString.has(key)) byString.set(key, []);
      byString.get(key).push(eq);
    }

    // For each string path, sort by flow order and connect sequentially
    const stringKeys = [...byString.keys()].filter(k => k !== '_shared');
    const shared = byString.get('_shared') || [];

    if (stringKeys.length === 0 && shared.length > 0) {
      // No string-specific equipment, just connect shared by flow order
      connectByFlowOrder(shared, addEdge);
    } else {
      for (const key of stringKeys) {
        const stringEquip = byString.get(key);
        // Merge shared equipment into each string path for connection
        const combined = [...stringEquip, ...shared];
        connectByFlowOrder(combined, addEdge);
      }
    }
  }

  // Connect on-line equipment to standalone equipment via line relationships
  for (const line of lines) {
    const lineEquipment = equipment.filter(eq => eq.line_id === line.id);
    if (lineEquipment.length < 2) continue;

    // Multiple equipment on the same line — connect by flow order
    connectByFlowOrder(lineEquipment, addEdge);
  }

  return { nodes, adjForward, adjReverse };
}

/**
 * Connect equipment sequentially by flow order.
 */
function connectByFlowOrder(equipmentList, addEdge) {
  const sorted = equipmentList
    .filter(eq => FLOW_ORDER[eq.equipment_type] !== undefined)
    .sort((a, b) => (FLOW_ORDER[a.equipment_type] ?? 99) - (FLOW_ORDER[b.equipment_type] ?? 99));

  for (let i = 0; i < sorted.length - 1; i++) {
    addEdge(sorted[i].id, sorted[i + 1].id);
  }
}

/**
 * BFS traversal from a starting node.
 * @param {string} startId - starting equipment ID
 * @param {Map} adjacency - adjacency list (forward or reverse)
 * @param {Map} nodes - node data map
 * @returns {{ paths: object[][], visited: Set<string> }}
 */
export function bfs(startId, adjacency, nodes) {
  if (!adjacency.has(startId)) return { paths: [], visited: new Set() };

  const visited = new Set();
  const queue = [startId];
  const parent = new Map();
  visited.add(startId);

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  // Build paths from start to all reachable nodes
  const paths = [];
  for (const nodeId of visited) {
    if (nodeId === startId) continue;
    const path = [];
    let current = nodeId;
    while (current !== undefined) {
      path.unshift(nodes.get(current));
      current = parent.get(current);
    }
    paths.push(path);
  }

  return { paths, visited };
}

/**
 * Convert graph to React Flow format.
 * @param {Map} nodes - id → equipment data
 * @param {Map} adjForward - forward adjacency (upstream → downstream)
 * @param {string} systemType - system type for coloring
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function toReactFlow(nodes, adjForward, systemType) {
  const color = SYSTEM_TYPE_COLORS[systemType] || SYSTEM_TYPE_COLORS.process;

  // Layout: group by flow order, spread horizontally
  const byOrder = new Map();
  for (const [id, eq] of nodes) {
    const order = FLOW_ORDER[eq.equipment_type] ?? 99;
    if (!byOrder.has(order)) byOrder.set(order, []);
    byOrder.get(order).push({ id, eq });
  }

  const sortedOrders = [...byOrder.keys()].sort((a, b) => a - b);
  const rfNodes = [];
  const xSpacing = 250;
  const ySpacing = 120;

  for (let col = 0; col < sortedOrders.length; col++) {
    const group = byOrder.get(sortedOrders[col]);
    for (let row = 0; row < group.length; row++) {
      const { id, eq } = group[row];
      rfNodes.push({
        id,
        type: 'equipment',
        position: { x: col * xSpacing, y: row * ySpacing },
        data: {
          tag: eq.tag,
          equipmentType: eq.equipment_type,
          description: eq.description,
          criticality: eq.criticality,
          systemId: eq.system_id,
          lineId: eq.line_id,
        },
        style: {
          borderColor: color,
          borderWidth: 2,
        },
      });
    }
  }

  // Edges
  const rfEdges = [];
  let edgeIdx = 0;
  for (const [fromId, neighbors] of adjForward) {
    for (const toId of neighbors) {
      rfEdges.push({
        id: `e-${edgeIdx++}`,
        source: fromId,
        target: toId,
        type: 'smoothstep',
        animated: false,
        style: { stroke: color, strokeWidth: 2 },
      });
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}
