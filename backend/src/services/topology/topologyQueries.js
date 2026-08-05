/**
 * Topology queries using PostgreSQL recursive CTEs via Prisma.$queryRaw.
 * Replaces JS-side BFS (graphUtils.js) with database-level graph traversal.
 */

import prisma from '../../db.js';

/**
 * Get full system topology: all nodes (equipment + instruments) and edges.
 * Returns data shaped for React Flow consumption.
 */
export async function getSystemTopology(systemId) {
  const [equipment, instruments, edges] = await Promise.all([
    prisma.equipment.findMany({
      where: { system_id: systemId, deleted_at: null },
      select: {
        id: true, tag: true, equipment_type: true, description: true,
        criticality: true, system_id: true, line_id: true, corrosion_loop: true,
      },
    }),
    prisma.instrument.findMany({
      where: { system_id: systemId, deleted_at: null },
      select: {
        id: true, tag: true, instrument_type: true, description: true,
        system_id: true, line_id: true, scada_tag: true,
      },
    }),
    prisma.$queryRaw`
      SELECT id, from_entity_id, from_entity_type, to_entity_id, to_entity_type,
             edge_type, system_id, line_id, metadata
      FROM topology_edges
      WHERE system_id = ${systemId}::uuid
    `,
  ]);

  const nodes = [
    ...equipment.map(e => ({
      id: e.id,
      type: 'equipment',
      data: {
        tag: e.tag,
        equipmentType: e.equipment_type,
        description: e.description,
        criticality: e.criticality,
        systemId: e.system_id,
        lineId: e.line_id,
        corrosionLoop: e.corrosion_loop,
      },
    })),
    ...instruments.map(i => ({
      id: i.id,
      type: 'instrument',
      data: {
        tag: i.tag,
        instrumentType: i.instrument_type,
        description: i.description,
        systemId: i.system_id,
        lineId: i.line_id,
        scadaTag: i.scada_tag,
      },
    })),
  ];

  const formattedEdges = edges.map(e => ({
    id: e.id,
    source: e.from_entity_id,
    target: e.to_entity_id,
    sourceType: e.from_entity_type,
    targetType: e.to_entity_type,
    type: e.edge_type,
    lineId: e.line_id,
    metadata: e.metadata,
  }));

  // Identify cross-system gateway edges
  const gateways = formattedEdges
    .filter(e => e.type === 'boundary')
    .map(e => ({
      id: `gw-${e.id}`,
      edgeId: e.id,
      targetEntityId: e.target,
      metadata: e.metadata,
    }));

  return { nodes, edges: formattedEdges, gateways };
}

/**
 * Trace upstream from an entity using recursive CTE.
 * Follows edges in reverse direction (to_entity_id → from_entity_id).
 */
export async function traceUpstream(entityId, maxDepth = 50) {
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE upstream AS (
      -- Base case: edges pointing TO the start entity
      SELECT
        te.from_entity_id AS entity_id,
        te.from_entity_type AS entity_type,
        te.id AS edge_id,
        te.edge_type,
        te.line_id,
        te.metadata,
        1 AS depth,
        ARRAY[te.from_entity_id] AS path
      FROM topology_edges te
      WHERE te.to_entity_id = ${entityId}::uuid

      UNION ALL

      -- Recursive step
      SELECT
        te.from_entity_id,
        te.from_entity_type,
        te.id,
        te.edge_type,
        te.line_id,
        te.metadata,
        u.depth + 1,
        u.path || te.from_entity_id
      FROM topology_edges te
      JOIN upstream u ON te.to_entity_id = u.entity_id
      WHERE u.depth < ${maxDepth}
        AND NOT (te.from_entity_id = ANY(u.path))  -- cycle detection
    )
    SELECT DISTINCT ON (entity_id)
      entity_id, entity_type, edge_id, edge_type, line_id, metadata, depth
    FROM upstream
    ORDER BY entity_id, depth ASC
  `;

  return {
    startEntityId: entityId,
    direction: 'upstream',
    path: rows.map(r => ({
      entityId: r.entity_id,
      entityType: r.entity_type,
      edgeId: r.edge_id,
      edgeType: r.edge_type,
      lineId: r.line_id,
      metadata: r.metadata,
      depth: r.depth,
    })),
    visitedIds: rows.map(r => r.entity_id),
  };
}

/**
 * Trace downstream from an entity using recursive CTE.
 * Follows edges in forward direction (from_entity_id → to_entity_id).
 */
export async function traceDownstream(entityId, maxDepth = 50) {
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE downstream AS (
      -- Base case: edges FROM the start entity
      SELECT
        te.to_entity_id AS entity_id,
        te.to_entity_type AS entity_type,
        te.id AS edge_id,
        te.edge_type,
        te.line_id,
        te.metadata,
        1 AS depth,
        ARRAY[te.to_entity_id] AS path
      FROM topology_edges te
      WHERE te.from_entity_id = ${entityId}::uuid

      UNION ALL

      -- Recursive step
      SELECT
        te.to_entity_id,
        te.to_entity_type,
        te.id,
        te.edge_type,
        te.line_id,
        te.metadata,
        d.depth + 1,
        d.path || te.to_entity_id
      FROM topology_edges te
      JOIN downstream d ON te.from_entity_id = d.entity_id
      WHERE d.depth < ${maxDepth}
        AND NOT (te.to_entity_id = ANY(d.path))  -- cycle detection
    )
    SELECT DISTINCT ON (entity_id)
      entity_id, entity_type, edge_id, edge_type, line_id, metadata, depth
    FROM downstream
    ORDER BY entity_id, depth ASC
  `;

  return {
    startEntityId: entityId,
    direction: 'downstream',
    path: rows.map(r => ({
      entityId: r.entity_id,
      entityType: r.entity_type,
      edgeId: r.edge_id,
      edgeType: r.edge_type,
      lineId: r.line_id,
      metadata: r.metadata,
      depth: r.depth,
    })),
    visitedIds: rows.map(r => r.entity_id),
  };
}

/**
 * Find isolation boundary for a piece of equipment.
 * Logic: BFS in both directions from the target, stopping at valves.
 * Boundary valves = valve-type equipment on the edge of the reachable set.
 * Affected equipment = everything reachable before hitting boundary valves.
 */
export async function findIsolationBoundary(equipmentId) {
  // Get all reachable entities in both directions, stopping at valve-type equipment
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE reachable AS (
      -- Base: the target equipment itself
      SELECT
        ${equipmentId}::uuid AS entity_id,
        'equipment'::text AS entity_type,
        0 AS depth,
        false AS is_valve,
        ARRAY[${equipmentId}::uuid] AS path

      UNION ALL

      -- Forward traversal
      SELECT
        te.to_entity_id,
        te.to_entity_type::text,
        r.depth + 1,
        EXISTS (
          SELECT 1 FROM equipment eq
          WHERE eq.id = te.to_entity_id
            AND eq.equipment_type IN ('Choke Valve', 'Safety Valve', 'Spectacle Blind')
        ),
        r.path || te.to_entity_id
      FROM topology_edges te
      JOIN reachable r ON te.from_entity_id = r.entity_id
      WHERE r.depth < 50
        AND NOT r.is_valve  -- stop expanding past valves
        AND r.depth > 0 OR NOT EXISTS (  -- allow first step from valves
          SELECT 1 FROM equipment eq
          WHERE eq.id = r.entity_id
            AND eq.equipment_type IN ('Choke Valve', 'Safety Valve', 'Spectacle Blind')
        )
        AND NOT (te.to_entity_id = ANY(r.path))
        AND te.edge_type IN ('process', 'utility')  -- only process/utility edges

      UNION ALL

      -- Reverse traversal
      SELECT
        te.from_entity_id,
        te.from_entity_type::text,
        r.depth + 1,
        EXISTS (
          SELECT 1 FROM equipment eq
          WHERE eq.id = te.from_entity_id
            AND eq.equipment_type IN ('Choke Valve', 'Safety Valve', 'Spectacle Blind')
        ),
        r.path || te.from_entity_id
      FROM topology_edges te
      JOIN reachable r ON te.to_entity_id = r.entity_id
      WHERE r.depth < 50
        AND NOT r.is_valve
        AND r.depth > 0 OR NOT EXISTS (
          SELECT 1 FROM equipment eq
          WHERE eq.id = r.entity_id
            AND eq.equipment_type IN ('Choke Valve', 'Safety Valve', 'Spectacle Blind')
        )
        AND NOT (te.from_entity_id = ANY(r.path))
        AND te.edge_type IN ('process', 'utility')
    )
    SELECT DISTINCT ON (entity_id)
      entity_id, entity_type, depth, is_valve
    FROM reachable
    ORDER BY entity_id, depth ASC
  `;

  const boundaryValveIds = rows
    .filter(r => r.is_valve)
    .map(r => r.entity_id);

  const affectedIds = rows
    .filter(r => !r.is_valve && r.entity_type === 'equipment')
    .map(r => r.entity_id);

  // Fetch full details for boundary valves
  const boundaryValves = boundaryValveIds.length > 0
    ? await prisma.equipment.findMany({
        where: { id: { in: boundaryValveIds }, deleted_at: null },
        select: { id: true, tag: true, equipment_type: true, description: true },
      })
    : [];

  // Fetch full details for affected equipment
  const affectedEquipment = affectedIds.length > 0
    ? await prisma.equipment.findMany({
        where: { id: { in: affectedIds }, deleted_at: null },
        select: { id: true, tag: true, equipment_type: true, description: true },
      })
    : [];

  // Get affected lines
  const affectedLineIds = rows
    .filter(r => !r.is_valve)
    .map(r => r.entity_id);
  const affectedLines = affectedLineIds.length > 0
    ? await prisma.line.findMany({
        where: {
          deleted_at: null,
          equipment: { some: { id: { in: affectedLineIds } } },
        },
        select: { id: true, line_number: true, service: true },
      })
    : [];

  return {
    targetEquipmentId: equipmentId,
    boundaryValves: boundaryValves.map(v => ({
      id: v.id,
      tag: v.tag,
      equipmentType: v.equipment_type,
      action: v.equipment_type === 'Spectacle Blind' ? 'BLIND' : 'CLOSE',
    })),
    affectedEquipment: affectedEquipment.map(e => ({
      id: e.id,
      tag: e.tag,
      equipmentType: e.equipment_type,
    })),
    affectedLines: affectedLines.map(l => ({
      id: l.id,
      lineNumber: l.line_number,
      service: l.service,
    })),
    isolationZone: [...affectedIds, ...boundaryValveIds],
  };
}

/**
 * Get boundary edges for a platform — edges that cross between systems.
 * Groups by (from_system, to_system) to produce unique system-pair summaries.
 * Used for overview mode to draw BoundaryEdges between CollapsedGroupNodes.
 */
export async function getBoundaries(platformId) {
  const rows = await prisma.$queryRaw`
    SELECT
      te.system_id AS from_system_id,
      s_from.code AS from_system_code,
      s_from.name AS from_system_name,
      s_from.sys_type AS from_system_type,
      COALESCE(te.metadata->>'target_system_id', te.to_entity_id::text) AS to_system_id_raw,
      COUNT(*)::int AS edge_count,
      json_agg(json_build_object(
        'fromTag', eq_from.tag,
        'toTag', eq_to.tag,
        'edgeType', te.edge_type
      )) AS connections
    FROM topology_edges te
    JOIN system s_from ON s_from.id = te.system_id
    JOIN equipment eq_from ON eq_from.id = te.from_entity_id
    LEFT JOIN equipment eq_to ON eq_to.id = te.to_entity_id
    WHERE te.edge_type = 'boundary'
      AND s_from.platform_id = ${platformId}::uuid
    GROUP BY te.system_id, s_from.code, s_from.name, s_from.sys_type,
             COALESCE(te.metadata->>'target_system_id', te.to_entity_id::text)
  `;

  // Resolve target system info
  const results = [];
  for (const row of rows) {
    let toSystemId = row.to_system_id_raw;
    // Try to get actual system info for the target
    let toSystem = null;
    try {
      toSystem = await prisma.system.findFirst({
        where: { id: toSystemId },
        select: { id: true, code: true, name: true, sys_type: true },
      });
    } catch {
      // target may not be a valid UUID — look up via equipment's system
      const targetEq = await prisma.equipment.findFirst({
        where: { id: row.to_system_id_raw },
        select: { system_id: true },
      });
      if (targetEq) {
        toSystem = await prisma.system.findFirst({
          where: { id: targetEq.system_id },
          select: { id: true, code: true, name: true, sys_type: true },
        });
        toSystemId = targetEq.system_id;
      }
    }

    results.push({
      fromSystemId: row.from_system_id,
      fromSystemCode: row.from_system_code,
      fromSystemType: row.from_system_type,
      toSystemId: toSystem?.id || toSystemId,
      toSystemCode: toSystem?.code || 'EXT',
      toSystemType: toSystem?.sys_type || 'process',
      edgeCount: row.edge_count,
      connections: row.connections || [],
      edgeType: 'boundary',
    });
  }

  return results;
}

/**
 * Get persisted canvas layout positions for a system.
 */
export async function getLayout(systemId) {
  const positions = await prisma.$queryRaw`
    SELECT entity_id, entity_type, x, y, pinned, updated_at
    FROM canvas_layout
    WHERE system_id = ${systemId}::uuid
    ORDER BY entity_type, entity_id
  `;

  return {
    systemId,
    positions: positions.map(p => ({
      entityId: p.entity_id,
      entityType: p.entity_type,
      x: Number(p.x),
      y: Number(p.y),
      pinned: p.pinned,
      updatedAt: p.updated_at,
    })),
  };
}

/**
 * Save (upsert) canvas layout positions for a system.
 * @param {string} systemId
 * @param {{ entityId: string, entityType: string, x: number, y: number, pinned?: boolean }[]} positions
 */
export async function saveLayout(systemId, positions) {
  if (!positions || positions.length === 0) {
    return { systemId, saved: 0 };
  }

  // Build upsert values for batch insert
  const values = positions.map(p =>
    `(gen_random_uuid(), '${systemId}'::uuid, '${p.entityId}'::uuid, '${p.entityType}', ${p.x}, ${p.y}, ${p.pinned ?? false}, NOW())`
  ).join(',\n');

  await prisma.$executeRawUnsafe(`
    INSERT INTO canvas_layout (id, system_id, entity_id, entity_type, x, y, pinned, updated_at)
    VALUES ${values}
    ON CONFLICT (system_id, entity_id) DO UPDATE SET
      x = EXCLUDED.x,
      y = EXCLUDED.y,
      pinned = EXCLUDED.pinned,
      updated_at = NOW()
  `);

  return { systemId, saved: positions.length };
}
