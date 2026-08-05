import prisma from '../db.js';

// Only select the line columns we actually use (all from base schema.sql)
const lineSelect = {
  id: true,
  line_number: true,
  service: true,
  nominal_size: true,
  pipe_class: true,
  material: true,
  design_pressure: true,
  design_temperature: true,
  operating_pressure: true,
  operating_temperature: true,
  test_pressure: true,
  fluid_code: true,
  insulation_code: true,
  from_equipment_tag: true,
  to_equipment_tag: true,
  isometric_ref: true,
  deleted_at: true,
  system: { select: { id: true, code: true, sys_type: true } },
  pnid_line: { select: { is_continuation: true, pnid_pnid_line_pnid_idTopnid: { select: { drawing_number: true } } } },
  _count: { select: { equipment: { where: { deleted_at: null } }, instrument: { where: { deleted_at: null } } } },
};

export default async function linesRoutes(fastify) {
  // GET /lines — Miller Column 3
  fastify.get('/lines', async (request, reply) => {
    try {
    const { platform_id, system_id, pnid_id, include_xref = 'true', search } = request.query;

    let lines;

    try {
      if (pnid_id) {
        // Lines appearing on this P&ID (via pnid_line junction)
        const pnidLines = await prisma.pnid_line.findMany({
          where: { pnid_id },
          include: {
            line: { select: lineSelect },
          },
        });

        const primarySys = await prisma.pnid_system.findFirst({
          where: { pnid_id, is_primary: true },
          select: { system_id: true },
        });

        lines = pnidLines
          .filter(pl => pl.line.deleted_at === null)
          .filter(pl => !search || pl.line.line_number.toLowerCase().includes(search.toLowerCase()) || (pl.line.service || '').toLowerCase().includes(search.toLowerCase()))
          .map(pl => formatLine(pl.line, pl.is_continuation || false, primarySys ? pl.line.system.id !== primarySys.system_id : false));
      } else if (system_id) {
        const where = { system_id, deleted_at: null };
        if (search) {
          where.OR = [
            { line_number: { contains: search, mode: 'insensitive' } },
            { service: { contains: search, mode: 'insensitive' } },
          ];
        }

        const ownedLines = await prisma.line.findMany({
          where,
          select: lineSelect,
          orderBy: { line_number: 'asc' },
        });

        lines = ownedLines.map(l => formatLine(l, false, false));

        if (include_xref !== 'false') {
          const systemPnids = await prisma.pnid_system.findMany({
            where: { system_id, is_primary: true },
            select: { pnid_id: true },
          });
          const pnidIdsForSystem = systemPnids.map(sp => sp.pnid_id);

          if (pnidIdsForSystem.length > 0) {
            const xrefPnidLines = await prisma.pnid_line.findMany({
              where: {
                pnid_id: { in: pnidIdsForSystem },
                line: { system_id: { not: system_id }, deleted_at: null },
              },
              include: {
                line: { select: lineSelect },
              },
            });

            const seen = new Set(lines.map(l => l.id));
            for (const pl of xrefPnidLines) {
              if (seen.has(pl.line.id)) continue;
              if (search && !pl.line.line_number.toLowerCase().includes(search.toLowerCase()) && !(pl.line.service || '').toLowerCase().includes(search.toLowerCase())) continue;
              seen.add(pl.line.id);
              lines.push(formatLine(pl.line, pl.is_continuation || false, true));
            }
          }
        }
      } else if (platform_id) {
        const allLines = await prisma.line.findMany({
          where: {
            deleted_at: null,
            system: { platform_id, deleted_at: null },
            ...(search ? {
              OR: [
                { line_number: { contains: search, mode: 'insensitive' } },
                { service: { contains: search, mode: 'insensitive' } },
              ],
            } : {}),
          },
          select: lineSelect,
          orderBy: { line_number: 'asc' },
        });
        lines = allLines.map(l => formatLine(l, false, false));
      } else {
        return reply.code(400).send({ error: 'platform_id, system_id, or pnid_id required' });
      }
    } catch (err) {
      request.log.error({ err, query: request.query }, 'Lines query failed');
      return reply.code(500).send({ error: 'Failed to fetch lines', detail: err.message });
    }

    return { lines };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /lines failed');
      return reply.code(500).send({ error: 'Failed to fetch lines', detail: err.message });
    }
  });

  // GET /lines/:lineId — Line detail
  fastify.get('/lines/:lineId', async (request, reply) => {
    const { lineId } = request.params;
    try {
      const l = await prisma.line.findUnique({
        where: { id: lineId },
        select: {
          ...lineSelect,
          system: { select: { id: true, code: true, name: true, sys_type: true } },
          pnid_line: {
            select: {
              is_continuation: true,
              pnid_pnid_line_pnid_idTopnid: { select: { id: true, drawing_number: true, title: true } },
            },
          },
          equipment: {
            where: { deleted_at: null },
            select: { id: true, tag: true, equipment_type: true, description: true, criticality: true },
          },
          instrument: {
            where: { deleted_at: null },
            select: { id: true, tag: true, instrument_type: true, description: true, scada_tag: true },
          },
        },
      });
      if (!l) return reply.code(404).send({ error: 'Line not found' });

      return {
        line: {
          id: l.id, lineNumber: l.line_number, service: l.service,
          nominalSize: l.nominal_size, pipeClass: l.pipe_class, material: l.material,
          designPressure: l.design_pressure, designTemperature: l.design_temperature,
          operatingPressure: l.operating_pressure, operatingTemperature: l.operating_temperature,
          testPressure: l.test_pressure, fluidCode: l.fluid_code,
          insulationCode: l.insulation_code, fromEquipmentTag: l.from_equipment_tag,
          toEquipmentTag: l.to_equipment_tag, isometricRef: l.isometric_ref,
        },
        ownerSystem: { id: l.system.id, code: l.system.code, name: l.system.name, sysType: l.system.sys_type },
        pnids: l.pnid_line.map(pl => ({
          id: pl.pnid_pnid_line_pnid_idTopnid.id,
          drawingNumber: pl.pnid_pnid_line_pnid_idTopnid.drawing_number,
          title: pl.pnid_pnid_line_pnid_idTopnid.title,
          isContinuation: pl.is_continuation || false,
        })),
        equipment: l.equipment.map(e => ({
          id: e.id, tag: e.tag, equipmentType: e.equipment_type,
          description: e.description, criticality: e.criticality,
        })),
        instruments: l.instrument.map(i => ({
          id: i.id, tag: i.tag, instrumentType: i.instrument_type,
          description: i.description, scadaTag: i.scada_tag,
        })),
      };
    } catch (err) {
      request.log.error({ err, lineId }, 'Line detail query failed');
      return reply.code(500).send({ error: 'Failed to fetch line', detail: err.message });
    }
  });
}

function formatLine(l, isContinuation, isCrossReference) {
  return {
    id: l.id,
    lineNumber: l.line_number,
    service: l.service,
    nominalSize: l.nominal_size,
    pipeClass: l.pipe_class,
    material: l.material,
    designPressure: l.design_pressure,
    designTemperature: l.design_temperature,
    operatingPressure: l.operating_pressure,
    operatingTemperature: l.operating_temperature,
    ownerSystemId: l.system.id,
    ownerSystemCode: l.system.code,
    ownerSystemType: l.system.sys_type,
    pnidCount: l.pnid_line.length,
    equipmentCount: l._count.equipment,
    instrumentCount: l._count.instrument,
    pnidNumbers: l.pnid_line.map(pl => pl.pnid_pnid_line_pnid_idTopnid.drawing_number),
    isContinuation,
    isCrossReference,
  };
}
