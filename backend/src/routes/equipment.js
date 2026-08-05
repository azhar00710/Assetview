import prisma from '../db.js';

export default async function equipmentRoutes(fastify) {
  // GET /equipment — Miller Column 4
  fastify.get('/equipment', async (request, reply) => {
    try {
    const { platform_id, system_id, pnid_id, line_id, criticality, equipment_type, search } = request.query;

    const where = { deleted_at: null };

    if (line_id) {
      where.line_id = line_id;
    } else if (pnid_id) {
      const pnidLines = await prisma.pnid_line.findMany({
        where: { pnid_id },
        select: { line_id: true },
      });
      const pnidSystems = await prisma.pnid_system.findMany({
        where: { pnid_id },
        select: { system_id: true },
      });
      const lineIds = pnidLines.map(pl => pl.line_id);
      const sysIds = pnidSystems.map(ps => ps.system_id);

      where.OR = [
        { line_id: { in: lineIds } },
        { system_id: { in: sysIds }, line_id: null },
      ];
    } else if (system_id) {
      where.system_id = system_id;
    } else if (platform_id) {
      where.system = { platform_id, deleted_at: null };
    } else {
      return reply.code(400).send({ error: 'platform_id, system_id, pnid_id, or line_id required' });
    }

    if (criticality) where.criticality = criticality;
    if (equipment_type) where.equipment_type = { contains: equipment_type, mode: 'insensitive' };
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { tag: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { equipment_type: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const equipment = await prisma.equipment.findMany({
      where,
      include: {
        system: { select: { id: true, code: true } },
        line: { select: { id: true, line_number: true } },
      },
      orderBy: { tag: 'asc' },
    });

    return {
      equipment: equipment.map(e => ({
        id: e.id,
        tag: e.tag,
        equipmentType: e.equipment_type,
        description: e.description,
        systemId: e.system.id,
        systemCode: e.system.code,
        criticality: e.criticality,
        silLevel: e.sil_level,
        inspectionGroup: e.inspection_group,
        corrosionLoop: e.corrosion_loop,
        lineId: e.line?.id || null,
        lineNumber: e.line?.line_number || null,
        isStandalone: e.line_id === null,
        vtSceneId: e.vt_scene_id,
        vtHotspotId: e.vt_hotspot_id,
      })),
    };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /equipment failed');
      return reply.code(500).send({ error: 'Failed to fetch equipment', detail: err.message });
    }
  });

  // GET /equipment/:equipmentId — detail
  fastify.get('/equipment/:equipmentId', async (request, reply) => {
    const { equipmentId } = request.params;
    const e = await prisma.equipment.findUnique({
      where: { id: equipmentId },
      include: {
        system: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, line_number: true, service: true } },
        pnid_equipment: {
          include: { pnid: { select: { id: true, drawing_number: true } } },
        },
      },
    });
    if (!e) return reply.code(404).send({ error: 'Equipment not found' });

    let instruments = [];
    if (e.line_id) {
      instruments = await prisma.instrument.findMany({
        where: { line_id: e.line_id, deleted_at: null },
        select: { id: true, tag: true, instrument_type: true },
      });
    }

    return {
      equipment: {
        id: e.id, tag: e.tag, equipmentType: e.equipment_type, description: e.description,
        criticality: e.criticality, silLevel: e.sil_level, inspectionGroup: e.inspection_group,
        corrosionLoop: e.corrosion_loop, manufacturer: e.manufacturer, modelNumber: e.model_number,
        serialNumber: e.serial_number, weightKg: e.weight_kg,
        vtSceneId: e.vt_scene_id, vtHotspotId: e.vt_hotspot_id,
        model3dObjectId: e.model_3d_object_id, cmmsAssetId: e.cmms_asset_id,
      },
      system: { id: e.system.id, code: e.system.code, name: e.system.name },
      line: e.line ? { id: e.line.id, lineNumber: e.line.line_number, service: e.line.service } : null,
      pnids: e.pnid_equipment.map(pe => ({
        id: pe.pnid.id, drawingNumber: pe.pnid.drawing_number,
        annotationPosition: {
          xPct: pe.annotation_x_pct, yPct: pe.annotation_y_pct,
          wPct: pe.annotation_w_pct, hPct: pe.annotation_h_pct,
        },
      })),
      instruments: instruments.map(i => ({ id: i.id, tag: i.tag, instrumentType: i.instrument_type })),
    };
  });
}
