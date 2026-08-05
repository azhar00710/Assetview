import prisma from '../../db.js';

export default async function linkageRoutes(fastify) {
  // GET /admin/linkage?platform_id=:id — Linkage status for lines, equipment, instruments
  fastify.get('/admin/linkage', async (request, reply) => {
    const { platform_id } = request.query;

    if (!platform_id) {
      return reply.code(400).send({ error: 'platform_id is required' });
    }

    const systemFilter = { platform_id, deleted_at: null };

    // Fetch all lines for this platform with their pnid_line links
    const lines = await prisma.line.findMany({
      where: {
        deleted_at: null,
        system: systemFilter,
      },
      include: {
        system: { select: { code: true, name: true } },
        pnid_line: {
          include: {
            pnid_pnid_line_pnid_idTopnid: { select: { drawing_number: true } },
          },
        },
      },
      orderBy: { line_number: 'asc' },
    });

    // Fetch all equipment for this platform with their pnid_equipment links
    const equipment = await prisma.equipment.findMany({
      where: {
        deleted_at: null,
        system: systemFilter,
      },
      include: {
        system: { select: { code: true, name: true } },
        pnid_equipment: {
          include: {
            pnid: { select: { drawing_number: true } },
          },
        },
      },
      orderBy: { tag: 'asc' },
    });

    // Fetch all instruments for this platform with their pnid_instrument links
    const instruments = await prisma.instrument.findMany({
      where: {
        deleted_at: null,
        system: systemFilter,
      },
      include: {
        system: { select: { code: true, name: true } },
        pnid_instrument: {
          include: {
            pnid: { select: { drawing_number: true } },
          },
        },
      },
      orderBy: { tag: 'asc' },
    });

    // Partition lines into linked/unlinked
    const linkedLines = [];
    const unlinkedLines = [];
    for (const l of lines) {
      if (l.pnid_line.length > 0) {
        linkedLines.push({
          id: l.id,
          line_number: l.line_number,
          system_code: l.system.code,
          pnids: l.pnid_line.map(pl => pl.pnid_pnid_line_pnid_idTopnid.drawing_number),
        });
      } else {
        unlinkedLines.push({
          id: l.id,
          line_number: l.line_number,
          system_code: l.system.code,
          system_name: l.system.name,
        });
      }
    }

    // Partition equipment into linked/unlinked
    const linkedEquipment = [];
    const unlinkedEquipment = [];
    for (const e of equipment) {
      if (e.pnid_equipment.length > 0) {
        linkedEquipment.push({
          id: e.id,
          tag: e.tag,
          system_code: e.system.code,
          pnids: e.pnid_equipment.map(pe => pe.pnid.drawing_number),
        });
      } else {
        unlinkedEquipment.push({
          id: e.id,
          tag: e.tag,
          equipment_type: e.equipment_type,
          system_code: e.system.code,
          system_name: e.system.name,
        });
      }
    }

    // Partition instruments into linked/unlinked
    const linkedInstruments = [];
    const unlinkedInstruments = [];
    for (const i of instruments) {
      if (i.pnid_instrument.length > 0) {
        linkedInstruments.push({
          id: i.id,
          tag: i.tag,
          system_code: i.system.code,
          pnids: i.pnid_instrument.map(pi => pi.pnid.drawing_number),
        });
      } else {
        unlinkedInstruments.push({
          id: i.id,
          tag: i.tag,
          instrument_type: i.instrument_type,
          system_code: i.system.code,
          system_name: i.system.name,
        });
      }
    }

    // Fetch verification counts for equipment and instruments on this platform
    const equipmentVerification = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT pe.equipment_id) as total,
        COUNT(DISTINCT pe.equipment_id) FILTER (WHERE pe.position_verified = true) as verified,
        COUNT(DISTINCT pe.equipment_id) FILTER (WHERE pe.position_verified = false) as unverified
      FROM pnid_equipment pe
      JOIN equipment e ON e.id = pe.equipment_id
      JOIN system s ON s.id = e.system_id
      WHERE s.platform_id = ${platform_id}::uuid AND s.deleted_at IS NULL AND e.deleted_at IS NULL
    `;

    const instrumentVerification = await prisma.$queryRaw`
      SELECT
        COUNT(DISTINCT pi.instrument_id) as total,
        COUNT(DISTINCT pi.instrument_id) FILTER (WHERE pi.position_verified = true) as verified,
        COUNT(DISTINCT pi.instrument_id) FILTER (WHERE pi.position_verified = false) as unverified
      FROM pnid_instrument pi
      JOIN instrument i ON i.id = pi.instrument_id
      JOIN system s ON s.id = i.system_id
      WHERE s.platform_id = ${platform_id}::uuid AND s.deleted_at IS NULL AND i.deleted_at IS NULL
    `;

    const eqV = equipmentVerification[0] || { total: 0, verified: 0, unverified: 0 };
    const instV = instrumentVerification[0] || { total: 0, verified: 0, unverified: 0 };

    return {
      summary: {
        lines: {
          total: lines.length,
          linked: linkedLines.length,
          unlinked: unlinkedLines.length,
        },
        equipment: {
          total: equipment.length,
          linked: linkedEquipment.length,
          unlinked: unlinkedEquipment.length,
        },
        instruments: {
          total: instruments.length,
          linked: linkedInstruments.length,
          unlinked: unlinkedInstruments.length,
        },
      },
      verification: {
        equipment: {
          total: Number(eqV.total),
          verified: Number(eqV.verified),
          unverified: Number(eqV.unverified),
        },
        instruments: {
          total: Number(instV.total),
          verified: Number(instV.verified),
          unverified: Number(instV.unverified),
        },
      },
      unlinked: {
        lines: unlinkedLines,
        equipment: unlinkedEquipment,
        instruments: unlinkedInstruments,
      },
      linked: {
        lines: linkedLines,
        equipment: linkedEquipment,
        instruments: linkedInstruments,
      },
    };
  });
}
