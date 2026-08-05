import prisma from '../../db.js';
import { buildGraph, bfs, toReactFlow } from './graphUtils.js';
import * as topologyQueries from './topologyQueries.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Find equipment by UUID or tag within a system. */
async function findEquipment(systemId, nodeId) {
  if (UUID_RE.test(nodeId)) {
    const eq = await prisma.equipment.findFirst({
      where: { id: nodeId, system_id: systemId, deleted_at: null },
    });
    if (eq) return eq;
  }
  return prisma.equipment.findFirst({
    where: { tag: nodeId, system_id: systemId, deleted_at: null },
  });
}

/** Load equipment + lines + P&ID annotations and build graph for a system. */
async function buildSystemGraph(systemId) {
  const [equipment, lines] = await Promise.all([
    prisma.equipment.findMany({
      where: { system_id: systemId, deleted_at: null },
    }),
    prisma.line.findMany({
      where: { system_id: systemId, deleted_at: null },
      include: { equipment: { where: { deleted_at: null } } },
    }),
  ]);

  const equipmentIds = equipment.map(e => e.id);
  const pnidEquipment = equipmentIds.length > 0
    ? await prisma.pnid_equipment.findMany({
        where: { equipment_id: { in: equipmentIds } },
      })
    : [];

  return buildGraph(equipment, lines, pnidEquipment);
}

function formatBrief(eq) {
  return { id: eq.id, tag: eq.tag, equipmentType: eq.equipment_type };
}

function formatFull(eq) {
  return { id: eq.id, tag: eq.tag, equipmentType: eq.equipment_type, description: eq.description };
}

/**
 * GET /systems/:systemId/topology — React Flow nodes + edges.
 * Uses legacy JS-side graph builder (graphUtils.js).
 */
export async function getSystemTopologyLegacy(systemId) {
  const system = await prisma.system.findUnique({ where: { id: systemId } });
  if (!system) return null;

  const { nodes, adjForward } = await buildSystemGraph(systemId);
  const reactFlow = toReactFlow(nodes, adjForward, system.sys_type);

  return {
    systemId: system.id,
    systemCode: system.code,
    systemName: system.name,
    systemType: system.sys_type,
    ...reactFlow,
  };
}

/**
 * GET /api/v1/topology/system/:systemId — Full topology via topology_edges table.
 */
export async function getSystemTopology(systemId) {
  const system = await prisma.system.findUnique({ where: { id: systemId } });
  if (!system) return null;

  const result = await topologyQueries.getSystemTopology(systemId);
  return {
    systemId: system.id,
    systemCode: system.code,
    systemName: system.name,
    systemType: system.sys_type,
    ...result,
  };
}

/**
 * GET /api/v1/topology/upstream/:entityId — Recursive CTE upstream trace.
 */
export async function getUpstream(entityId, maxDepth) {
  return topologyQueries.traceUpstream(entityId, maxDepth);
}

/**
 * GET /api/v1/topology/downstream/:entityId — Recursive CTE downstream trace.
 */
export async function getDownstream(entityId, maxDepth) {
  return topologyQueries.traceDownstream(entityId, maxDepth);
}

/**
 * POST /api/v1/topology/isolation — Find isolation boundary for equipment.
 */
export async function getIsolationBoundary(equipmentId) {
  return topologyQueries.findIsolationBoundary(equipmentId);
}

/**
 * GET /api/v1/topology/boundaries?platform_id=... — Boundary edges for overview.
 */
export async function getBoundaries(platformId) {
  return topologyQueries.getBoundaries(platformId);
}

/**
 * GET /api/v1/topology/layout/:systemId — Get persisted layout positions.
 */
export async function getLayout(systemId) {
  return topologyQueries.getLayout(systemId);
}

/**
 * PUT /api/v1/topology/layout/:systemId — Save layout positions.
 */
export async function saveLayout(systemId, positions) {
  return topologyQueries.saveLayout(systemId, positions);
}

/** Legacy BFS traversal helper for upstream/downstream (kept for backward compat). */
async function traverseBfsLegacy(systemId, nodeId, direction) {
  const system = await prisma.system.findUnique({ where: { id: systemId } });
  if (!system) return null;

  const target = await findEquipment(systemId, nodeId);
  if (!target) return null;

  const { nodes, adjForward, adjReverse } = await buildSystemGraph(systemId);
  const adjacency = direction === 'upstream' ? adjReverse : adjForward;
  const { paths, visited } = bfs(target.id, adjacency, nodes);

  return {
    startNode: formatBrief(target),
    direction,
    reachable: [...visited]
      .filter(id => id !== target.id)
      .map(id => formatFull(nodes.get(id))),
    paths: paths.map(p => p.map(eq => formatBrief(eq))),
  };
}

export async function getUpstreamLegacy(systemId, nodeId) {
  return traverseBfsLegacy(systemId, nodeId, 'upstream');
}

export async function getDownstreamLegacy(systemId, nodeId) {
  return traverseBfsLegacy(systemId, nodeId, 'downstream');
}
