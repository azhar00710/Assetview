import prisma from '../db.js';

export default async function instrumentsRoutes(fastify) {
  // GET /instruments — Miller Column 5
  fastify.get('/instruments', async (request, reply) => {
    try {
    const { platform_id, system_id, pnid_id, line_id, instrument_type, search } = request.query;

    const where = { deleted_at: null };

    if (line_id) {
      where.line_id = line_id;
    } else if (pnid_id) {
      const pnidLines = await prisma.pnid_line.findMany({
        where: { pnid_id },
        select: { line_id: true },
      });
      where.line_id = { in: pnidLines.map(pl => pl.line_id) };
    } else if (system_id) {
      where.system_id = system_id;
    } else if (platform_id) {
      where.system = { platform_id, deleted_at: null };
    } else {
      return reply.code(400).send({ error: 'platform_id, system_id, pnid_id, or line_id required' });
    }

    if (instrument_type) where.instrument_type = instrument_type;
    if (search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { tag: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { scada_tag: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const instruments = await prisma.instrument.findMany({
      where,
      include: {
        system: { select: { id: true, code: true } },
        line: { select: { id: true, line_number: true } },
      },
      orderBy: { tag: 'asc' },
    });

    return {
      instruments: instruments.map(i => ({
        id: i.id,
        tag: i.tag,
        instrumentType: i.instrument_type,
        description: i.description,
        rangeMin: i.range_min,
        rangeMax: i.range_max,
        rangeUnit: i.range_unit,
        scadaTag: i.scada_tag,
        systemId: i.system.id,
        systemCode: i.system.code,
        lineId: i.line?.id || null,
        lineNumber: i.line?.line_number || null,
      })),
    };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /instruments failed');
      return reply.code(500).send({ error: 'Failed to fetch instruments', detail: err.message });
    }
  });

  // GET /instruments/:instrumentId/detail — enriched detail with P&ID appearances
  fastify.get('/instruments/:instrumentId/detail', async (request, reply) => {
    const { instrumentId } = request.params;
    const i = await prisma.instrument.findUnique({
      where: { id: instrumentId },
      include: {
        system: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, line_number: true, service: true } },
        pnid_instrument: {
          include: { pnid: { select: { id: true, drawing_number: true } } },
        },
      },
    });
    if (!i) return reply.code(404).send({ error: 'Instrument not found' });

    return {
      instrument: {
        id: i.id, tag: i.tag, instrumentType: i.instrument_type, description: i.description,
        rangeMin: i.range_min, rangeMax: i.range_max, rangeUnit: i.range_unit,
        setPoint: i.set_point, calibrationRange: i.calibration_range,
        scadaTag: i.scada_tag, ioType: i.io_type, signalType: i.signal_type,
        loopNumber: i.loop_number, junctionBox: i.junction_box, cableNumber: i.cable_number,
        hookupDrawing: i.hookup_drawing, datasheetRef: i.datasheet_ref,
        vtSceneId: i.vt_scene_id, vtHotspotId: i.vt_hotspot_id,
      },
      system: { id: i.system.id, code: i.system.code, name: i.system.name },
      line: i.line ? { id: i.line.id, lineNumber: i.line.line_number, service: i.line.service } : null,
      pnids: (i.pnid_instrument || []).map(pi => ({
        id: pi.pnid.id, drawingNumber: pi.pnid.drawing_number,
        annotationPosition: {
          xPct: pi.annotation_x_pct, yPct: pi.annotation_y_pct,
          wPct: pi.annotation_w_pct, hPct: pi.annotation_h_pct,
        },
      })),
    };
  });
}
