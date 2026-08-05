import prisma from '../db.js';

export default async function pnidsRoutes(fastify) {
  // GET /pnids — Miller Column 2
  fastify.get('/pnids', async (request, reply) => {
    try {
    const { platform_id, system_id, include_xref = 'true', status, search } = request.query;

    let pnidIds;
    let systemPlatformId = null;

    if (system_id) {
      const junctions = await prisma.pnid_system.findMany({
        where: { system_id },
        select: { pnid_id: true, is_primary: true },
      });

      if (include_xref === 'false') {
        pnidIds = junctions.filter(j => j.is_primary).map(j => j.pnid_id);
      } else {
        pnidIds = junctions.map(j => j.pnid_id);
      }

      // Look up the system's platform so we can also include unassigned P&IDs
      const sys = await prisma.system.findUnique({
        where: { id: system_id },
        select: { platform_id: true },
      });
      if (sys) systemPlatformId = sys.platform_id;
    }

    const where = { deleted_at: null };
    const andClauses = [];

    if (pnidIds && !systemPlatformId) {
      // No platform context — just filter by system's P&IDs
      where.id = { in: pnidIds };
    } else if (pnidIds && systemPlatformId) {
      // System selected: show P&IDs linked to this system OR unassigned P&IDs for the platform
      andClauses.push({
        OR: [
          { id: { in: pnidIds } },
          { pnid_system: { none: {} } },
        ],
      });
    }
    if (status) where.status = status;
    if (search) {
      andClauses.push({
        OR: [
          { drawing_number: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (platform_id && !system_id) {
      // Include P&IDs linked to this platform's systems OR unassigned P&IDs (no system link)
      andClauses.push({
        OR: [
          { pnid_system: { some: { system: { platform_id, deleted_at: null } } } },
          { pnid_system: { none: {} } },
        ],
      });
    }
    if (andClauses.length > 0) where.AND = andClauses;

    const pnids = await prisma.pnid.findMany({
      where,
      include: {
        pnid_system: {
          include: { system: { select: { id: true, code: true, sys_type: true } } },
        },
        pnid_line_pnid_line_pnid_idTopnid: {
          where: { line: { deleted_at: null } },
          select: { id: true },
        },
        pnid_equipment: {
          where: { equipment: { deleted_at: null } },
          select: { id: true },
        },
        pnid_instrument: {
          where: { instrument: { deleted_at: null } },
          select: { id: true },
        },
      },
      orderBy: { drawing_number: 'asc' },
    });

    // Build lookup for isPrimary relative to filtered system
    const systemJunctionMap = system_id
      ? Object.fromEntries(
          (await prisma.pnid_system.findMany({
            where: { system_id },
            select: { pnid_id: true, is_primary: true },
          })).map(j => [j.pnid_id, j.is_primary])
        )
      : {};

    return {
      pnids: pnids.map(p => {
        const primarySys = p.pnid_system.find(ps => ps.is_primary);
        const xrefCount = p.pnid_system.filter(ps => !ps.is_primary).length;
        return {
          id: p.id,
          drawingNumber: p.drawing_number,
          title: p.title,
          revision: p.revision,
          status: p.status,
          hasImage: p.has_image,
          primarySystemId: primarySys?.system?.id || null,
          primarySystemCode: primarySys?.system?.code || null,
          primarySystemType: primarySys?.system?.sys_type || null,
          lineCount: p.pnid_line_pnid_line_pnid_idTopnid.length,
          equipmentCount: p.pnid_equipment.length,
          instrumentCount: p.pnid_instrument.length,
          totalSystemCount: p.pnid_system.length,
          xrefSystemCount: xrefCount,
          isPrimary: system_id ? (systemJunctionMap[p.id] ?? null) : null,
        };
      }),
    };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /pnids failed');
      return reply.code(500).send({ error: 'Failed to fetch P&IDs', detail: err.message });
    }
  });

  // GET /pnids/:pnidId — P&ID detail
  fastify.get('/pnids/:pnidId', async (request, reply) => {
    const { pnidId } = request.params;
    const p = await prisma.pnid.findUnique({
      where: { id: pnidId },
      include: {
        pnid_system: {
          include: { system: { select: { id: true, code: true, name: true, sys_type: true } } },
        },
        pnid_equipment: {
          include: { equipment: { select: { id: true, tag: true } } },
        },
        pnid_instrument: {
          include: { instrument: { select: { id: true, tag: true } } },
        },
      },
    });
    if (!p) return reply.code(404).send({ error: 'P&ID not found' });

    return {
      pnid: {
        id: p.id, drawingNumber: p.drawing_number, title: p.title,
        revision: p.revision, status: p.status, hasImage: p.has_image, imagePath: p.image_path,
      },
      systems: p.pnid_system.map(ps => ({
        id: ps.system.id, code: ps.system.code, name: ps.system.name,
        sysType: ps.system.sys_type, isPrimary: ps.is_primary,
      })),
      annotations: {
        equipment: p.pnid_equipment.map(pe => ({
          equipmentId: pe.equipment.id, tag: pe.equipment.tag,
          xPct: pe.annotation_x_pct, yPct: pe.annotation_y_pct,
          wPct: pe.annotation_w_pct, hPct: pe.annotation_h_pct,
        })),
        instruments: p.pnid_instrument.map(pi => ({
          instrumentId: pi.instrument.id, tag: pi.instrument.tag,
          xPct: pi.annotation_x_pct, yPct: pi.annotation_y_pct,
          wPct: pi.annotation_w_pct, hPct: pi.annotation_h_pct,
        })),
      },
    };
  });

  // GET /pnids/:pnidId/systems
  fastify.get('/pnids/:pnidId/systems', async (request, reply) => {
    const { pnidId } = request.params;
    const junctions = await prisma.pnid_system.findMany({
      where: { pnid_id: pnidId },
      include: { system: { select: { id: true, code: true, name: true, sys_type: true } } },
    });
    return {
      systems: junctions.map(j => ({
        id: j.system.id, code: j.system.code, name: j.system.name,
        sysType: j.system.sys_type, isPrimary: j.is_primary,
      })),
    };
  });
}
