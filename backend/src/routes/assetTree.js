import prisma from '../db.js';

export default async function assetTreeRoutes(fastify) {
  // ─── FULL ASSET TREE (for visualization) ──────────────────────────────
  // Returns hierarchical data: Platform → Systems → P&IDs → Lines → Equipment/Instruments
  // Formatted for D3 sunburst/tree consumption

  fastify.get('/asset-tree/:platformId', async (request, reply) => {
    const { platformId } = request.params;
    const { depth = 'full' } = request.query; // 'systems', 'pnids', 'lines', 'full'

    // Get platform
    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, name: true, code: true, status: true },
    });

    if (!platform) {
      return reply.code(404).send({ error: 'Platform not found' });
    }

    // Get systems with counts
    const systems = await prisma.system.findMany({
      where: { platform_id: platformId, deleted_at: null },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, code: true, sys_type: true, system_number: true,
      },
    });

    if (depth === 'systems') {
      return {
        name: platform.code,
        fullName: platform.name,
        type: 'platform',
        id: platform.id,
        children: systems.map(s => ({
          name: s.code,
          fullName: s.name,
          type: 'system',
          sysType: s.sys_type,
          id: s.id,
          value: 1,
        })),
      };
    }

    // Get P&IDs with primary system info
    const pnidSystems = await prisma.pnid_system.findMany({
      where: {
        system: { platform_id: platformId, deleted_at: null },
        pnid: { deleted_at: null },
        is_primary: true,
      },
      select: {
        system_id: true,
        pnid: {
          select: { id: true, drawing_number: true, title: true, revision: true, status: true },
        },
      },
    });

    // Group P&IDs by their primary system
    const pnidsBySystem = {};
    for (const ps of pnidSystems) {
      if (!pnidsBySystem[ps.system_id]) pnidsBySystem[ps.system_id] = [];
      pnidsBySystem[ps.system_id].push(ps.pnid);
    }

    if (depth === 'pnids') {
      return {
        name: platform.code,
        fullName: platform.name,
        type: 'platform',
        id: platform.id,
        children: systems.map(s => ({
          name: s.code,
          fullName: s.name,
          type: 'system',
          sysType: s.sys_type,
          id: s.id,
          children: (pnidsBySystem[s.id] || []).map(p => ({
            name: p.drawing_number.split('-').pop(),
            fullName: p.title,
            drawingNumber: p.drawing_number,
            type: 'pnid',
            status: p.status,
            id: p.id,
            value: 1,
          })),
        })),
      };
    }

    // Get lines with their P&ID appearances
    const lines = await prisma.line.findMany({
      where: {
        system: { platform_id: platformId },
        deleted_at: null,
      },
      select: {
        id: true, line_number: true, service: true, nominal_size: true,
        pipe_class: true, system_id: true,
        pnid_line: {
          select: { pnid_id: true, is_continuation: true },
        },
      },
    });

    // Group lines by system
    const linesBySystem = {};
    for (const l of lines) {
      if (!linesBySystem[l.system_id]) linesBySystem[l.system_id] = [];
      linesBySystem[l.system_id].push(l);
    }

    // Get equipment
    const equipment = await prisma.equipment.findMany({
      where: {
        system: { platform_id: platformId },
        deleted_at: null,
      },
      select: {
        id: true, tag: true, equipment_type: true, description: true,
        criticality: true, system_id: true, line_id: true,
      },
    });

    // Get instruments
    const instruments = await prisma.instrument.findMany({
      where: {
        system: { platform_id: platformId },
        deleted_at: null,
      },
      select: {
        id: true, tag: true, instrument_type: true,
        system_id: true, line_id: true,
      },
    });

    // Group equipment/instruments by line and system (standalone)
    const equipByLine = {};
    const standaloneEquip = {};
    for (const e of equipment) {
      if (e.line_id) {
        if (!equipByLine[e.line_id]) equipByLine[e.line_id] = [];
        equipByLine[e.line_id].push(e);
      } else {
        if (!standaloneEquip[e.system_id]) standaloneEquip[e.system_id] = [];
        standaloneEquip[e.system_id].push(e);
      }
    }

    const instByLine = {};
    const standaloneInst = {};
    for (const i of instruments) {
      if (i.line_id) {
        if (!instByLine[i.line_id]) instByLine[i.line_id] = [];
        instByLine[i.line_id].push(i);
      } else {
        if (!standaloneInst[i.system_id]) standaloneInst[i.system_id] = [];
        standaloneInst[i.system_id].push(i);
      }
    }

    // Build full tree
    const tree = {
      name: platform.code,
      fullName: platform.name,
      type: 'platform',
      id: platform.id,
      status: platform.status,
      children: systems.map(s => {
        const sysLines = linesBySystem[s.id] || [];
        const sysStandaloneEquip = standaloneEquip[s.id] || [];
        const sysStandaloneInst = standaloneInst[s.id] || [];

        const lineChildren = sysLines.map(l => {
          const lineEquip = equipByLine[l.id] || [];
          const lineInst = instByLine[l.id] || [];
          const children = [
            ...lineEquip.map(e => ({
              name: e.tag,
              fullName: e.description || e.tag,
              type: 'equipment',
              equipType: e.equipment_type,
              criticality: e.criticality,
              id: e.id,
              value: 1,
            })),
            ...lineInst.map(i => ({
              name: i.tag,
              fullName: i.tag,
              type: 'instrument',
              instType: i.instrument_type,
              id: i.id,
              value: 1,
            })),
          ];

          return {
            name: l.line_number.length > 20 ? l.line_number.substring(0, 20) + '...' : l.line_number,
            fullName: l.line_number,
            type: 'line',
            service: l.service,
            size: l.nominal_size,
            id: l.id,
            pnidCount: l.pnid_line.length,
            children: children.length > 0 ? children : undefined,
            value: children.length === 0 ? 1 : undefined,
          };
        });

        const standaloneChildren = [
          ...sysStandaloneEquip.map(e => ({
            name: e.tag,
            fullName: e.description || e.tag,
            type: 'equipment',
            equipType: e.equipment_type,
            criticality: e.criticality,
            id: e.id,
            value: 1,
          })),
          ...sysStandaloneInst.map(i => ({
            name: i.tag,
            fullName: i.tag,
            type: 'instrument',
            instType: i.instrument_type,
            id: i.id,
            value: 1,
          })),
        ];

        return {
          name: s.code,
          fullName: s.name,
          type: 'system',
          sysType: s.sys_type,
          id: s.id,
          children: [...lineChildren, ...standaloneChildren],
        };
      }),
    };

    return tree;
  });

  // ─── HIERARCHY DATA (flat arrays for HierarchyTree component) ──────────
  // Returns all entities and junction data needed for the tree view
  fastify.get('/asset-tree/:platformId/hierarchy', async (request, reply) => {
    const { platformId } = request.params;

    const platform = await prisma.platform.findUnique({
      where: { id: platformId },
      select: { id: true, name: true, code: true },
    });
    if (!platform) return reply.code(404).send({ error: 'Platform not found' });

    const [systems, lines, equipment, instruments, pnidSystemLinks, pnidLineLinks, pnids] = await Promise.all([
      prisma.system.findMany({
        where: { platform_id: platformId, deleted_at: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, sys_type: true },
      }),
      prisma.line.findMany({
        where: { system: { platform_id: platformId }, deleted_at: null },
        select: {
          id: true, line_number: true, service: true, nominal_size: true,
          pipe_class: true, material: true, design_pressure: true, design_temperature: true,
          from_equipment_tag: true, to_equipment_tag: true,
          system_id: true,
        },
      }),
      prisma.equipment.findMany({
        where: { system: { platform_id: platformId }, deleted_at: null },
        select: {
          id: true, tag: true, equipment_type: true, description: true,
          criticality: true, sil_level: true, inspection_group: true, corrosion_loop: true,
          system_id: true, line_id: true,
        },
      }),
      prisma.instrument.findMany({
        where: { system: { platform_id: platformId }, deleted_at: null },
        select: {
          id: true, tag: true, instrument_type: true, description: true,
          range_min: true, range_max: true, range_unit: true, scada_tag: true,
          system_id: true, line_id: true,
        },
      }),
      prisma.pnid_system.findMany({
        where: { system: { platform_id: platformId, deleted_at: null }, pnid: { deleted_at: null } },
        select: { pnid_id: true, system_id: true, is_primary: true },
      }),
      prisma.pnid_line.findMany({
        where: { pnid_pnid_line_pnid_idTopnid: { deleted_at: null }, line: { system: { platform_id: platformId } } },
        select: { pnid_id: true, line_id: true, is_continuation: true },
      }),
      prisma.pnid.findMany({
        where: {
          deleted_at: null,
          pnid_system: { some: { system: { platform_id: platformId, deleted_at: null } } },
        },
        select: { id: true, drawing_number: true, title: true, revision: true, status: true },
      }),
    ]);

    return {
      platform: { id: platform.id, name: platform.name, code: platform.code },
      systems: systems.map(s => ({ id: s.id, name: s.name, code: s.code, sysType: s.sys_type, platformId })),
      lines: lines.map(l => ({
        id: l.id, name: l.line_number, service: l.service, size: l.nominal_size,
        pipeClass: l.pipe_class, material: l.material, dp: l.design_pressure, dt: l.design_temperature,
        fromTag: l.from_equipment_tag, toTag: l.to_equipment_tag,
        systemId: l.system_id,
      })),
      equipment: equipment.map(e => ({
        id: e.id, tag: e.tag, eqType: e.equipment_type, desc: e.description,
        criticality: e.criticality, sil: e.sil_level, insp: e.inspection_group, cl: e.corrosion_loop,
        systemId: e.system_id, lineId: e.line_id,
      })),
      instruments: instruments.map(i => ({
        id: i.id, tag: i.tag, iType: i.instrument_type, desc: i.description,
        range: [i.range_min, i.range_max].filter(Boolean).join('-') + (i.range_unit ? ` ${i.range_unit}` : ''),
        scada: i.scada_tag, systemId: i.system_id, lineId: i.line_id,
      })),
      pnidSystems: pnidSystemLinks.map(ps => ({ pnidId: ps.pnid_id, systemId: ps.system_id, isPrimary: ps.is_primary })),
      pnidLines: pnidLineLinks.map(pl => ({ pnidId: pl.pnid_id, lineId: pl.line_id, isCont: pl.is_continuation })),
      pnids: pnids.map(p => ({ id: p.id, name: p.drawing_number, title: p.title, rev: p.revision, status: p.status })),
    };
  });

  // ─── CROSS-REFERENCE MAP (for Sankey/chord visualization) ────────────
  // Shows how systems interconnect via shared P&IDs

  fastify.get('/asset-tree/:platformId/xref-map', async (request, reply) => {
    const { platformId } = request.params;

    // Get all pnid_system links for this platform
    const links = await prisma.pnid_system.findMany({
      where: {
        system: { platform_id: platformId, deleted_at: null },
        pnid: { deleted_at: null },
      },
      select: {
        is_primary: true,
        system: { select: { id: true, code: true, name: true, sys_type: true } },
        pnid: { select: { id: true, drawing_number: true, title: true } },
      },
    });

    // Build adjacency: for each P&ID, find primary system and all secondary systems
    const pnidMap = {};
    for (const link of links) {
      const pId = link.pnid.id;
      if (!pnidMap[pId]) {
        pnidMap[pId] = { pnid: link.pnid, primary: null, secondary: [] };
      }
      if (link.is_primary) {
        pnidMap[pId].primary = link.system;
      } else {
        pnidMap[pId].secondary.push(link.system);
      }
    }

    // Build cross-reference edges
    const xrefEdges = [];
    for (const entry of Object.values(pnidMap)) {
      if (entry.primary && entry.secondary.length > 0) {
        for (const sec of entry.secondary) {
          xrefEdges.push({
            source: entry.primary.code,
            target: sec.code,
            pnid: entry.pnid.drawing_number,
            sourceId: entry.primary.id,
            targetId: sec.id,
          });
        }
      }
    }

    // Unique systems as nodes
    const systemSet = new Map();
    for (const link of links) {
      systemSet.set(link.system.id, link.system);
    }

    return {
      nodes: Array.from(systemSet.values()),
      edges: xrefEdges,
    };
  });
}
