import prisma from '../db.js';

export default async function registersRoutes(fastify) {
  // GET /registers/:type — full table views
  fastify.get('/registers/:type', async (request, reply) => {
    try {
    const { type } = request.params;
    const { platform_id, sort_by, sort_dir = 'asc', page = '1', limit = '100' } = request.query;

    const filters = {};
    for (const [key, value] of Object.entries(request.query)) {
      const match = key.match(/^filter\[(.+)\]$/);
      if (match && value) filters[match[1]] = value;
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    switch (type) {
      case 'pnids': return getPnidRegister(platform_id, filters, sort_by, sort_dir, skip, limitNum, pageNum);
      case 'lines': return getLineRegister(platform_id, filters, sort_by, sort_dir, skip, limitNum, pageNum);
      case 'equipment': return getEquipmentRegister(platform_id, filters, sort_by, sort_dir, skip, limitNum, pageNum);
      case 'instruments': return getInstrumentRegister(platform_id, filters, sort_by, sort_dir, skip, limitNum, pageNum);
      default: return reply.code(400).send({ error: `Unknown register type: ${type}` });
    }
    } catch (err) {
      request.log.error({ err, query: request.query, params: request.params }, 'GET /registers failed');
      return reply.code(500).send({ error: 'Failed to fetch register', detail: err.message });
    }
  });
}

async function getPnidRegister(platformId, filters, sortBy, sortDir, skip, limit, page) {
  const where = { deleted_at: null };
  if (platformId) {
    where.OR = [
      { pnid_system: { some: { system: { platform_id: platformId, deleted_at: null } } } },
      { pnid_system: { none: {} } },
    ];
  }
  if (filters.drawingNumber) where.drawing_number = { contains: filters.drawingNumber, mode: 'insensitive' };
  if (filters.title) where.title = { contains: filters.title, mode: 'insensitive' };
  if (filters.status) where.status = filters.status;

  const orderBy = sortBy ? { [camelToSnake(sortBy)]: sortDir } : { drawing_number: 'asc' };

  const [data, total] = await Promise.all([
    prisma.pnid.findMany({
      where, skip, take: limit, orderBy,
      include: {
        pnid_system: { include: { system: { select: { code: true, name: true, sys_type: true } } } },
      },
    }),
    prisma.pnid.count({ where }),
  ]);

  return {
    data: data.map(p => {
      const primary = p.pnid_system.find(ps => ps.is_primary);
      return {
        drawingNumber: p.drawing_number, title: p.title, revision: p.revision,
        status: p.status, primarySystem: primary?.system?.code || null,
        allSystems: p.pnid_system.map(ps => ps.system.code).join(', '),
        systemCount: p.pnid_system.length,
      };
    }),
    total, page, limit,
  };
}

async function getLineRegister(platformId, filters, sortBy, sortDir, skip, limit, page) {
  const where = { deleted_at: null };
  if (platformId) where.system = { platform_id: platformId, deleted_at: null };
  if (filters.lineNumber) where.line_number = { contains: filters.lineNumber, mode: 'insensitive' };
  if (filters.service) where.service = { contains: filters.service, mode: 'insensitive' };

  const orderBy = sortBy ? { [camelToSnake(sortBy)]: sortDir } : { line_number: 'asc' };

  const [data, total] = await Promise.all([
    prisma.line.findMany({
      where, skip, take: limit, orderBy,
      include: {
        system: { select: { code: true } },
        pnid_line: { include: { pnid_pnid_line_pnid_idTopnid: { select: { drawing_number: true } } } },
      },
    }),
    prisma.line.count({ where }),
  ]);

  return {
    data: data.map(l => ({
      lineNumber: l.line_number, service: l.service, size: l.nominal_size,
      pipeClass: l.pipe_class, material: l.material,
      dp: l.design_pressure, dt: l.design_temperature,
      systemCode: l.system.code,
      pnids: l.pnid_line.map(pl => pl.pnid_pnid_line_pnid_idTopnid.drawing_number).join(', '),
      pnidCount: l.pnid_line.length,
    })),
    total, page, limit,
  };
}

async function getEquipmentRegister(platformId, filters, sortBy, sortDir, skip, limit, page) {
  const where = { deleted_at: null };
  if (platformId) where.system = { platform_id: platformId, deleted_at: null };
  if (filters.tag) where.tag = { contains: filters.tag, mode: 'insensitive' };
  if (filters.type) where.equipment_type = { contains: filters.type, mode: 'insensitive' };
  if (filters.criticality) where.criticality = filters.criticality;

  const orderBy = sortBy === 'tag' ? { tag: sortDir } : sortBy ? { [camelToSnake(sortBy)]: sortDir } : { tag: 'asc' };

  const [data, total] = await Promise.all([
    prisma.equipment.findMany({
      where, skip, take: limit, orderBy,
      include: { system: { select: { code: true } }, line: { select: { line_number: true } } },
    }),
    prisma.equipment.count({ where }),
  ]);

  return {
    data: data.map(e => ({
      tag: e.tag, type: e.equipment_type, description: e.description,
      system: e.system.code, criticality: e.criticality, sil: e.sil_level,
      inspGroup: e.inspection_group, corrLoop: e.corrosion_loop,
      line: e.line?.line_number || null,
    })),
    total, page, limit,
  };
}

async function getInstrumentRegister(platformId, filters, sortBy, sortDir, skip, limit, page) {
  const where = { deleted_at: null };
  if (platformId) where.system = { platform_id: platformId, deleted_at: null };
  if (filters.tag) where.tag = { contains: filters.tag, mode: 'insensitive' };
  if (filters.type) where.instrument_type = filters.type;

  const orderBy = sortBy === 'tag' ? { tag: sortDir } : sortBy ? { [camelToSnake(sortBy)]: sortDir } : { tag: 'asc' };

  const [data, total] = await Promise.all([
    prisma.instrument.findMany({
      where, skip, take: limit, orderBy,
      include: { system: { select: { code: true } }, line: { select: { line_number: true } } },
    }),
    prisma.instrument.count({ where }),
  ]);

  return {
    data: data.map(i => ({
      tag: i.tag, type: i.instrument_type, description: i.description,
      range: [i.range_min, i.range_max].filter(Boolean).join(' - ') + (i.range_unit ? ` ${i.range_unit}` : ''),
      scadaTag: i.scada_tag, system: i.system.code,
      line: i.line?.line_number || null,
    })),
    total, page, limit,
  };
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
