import prisma from '../../db.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Flatten metadata JSONB into the record so the frontend can access extra fields directly */
function flattenRecord(record) {
  if (!record) return record;
  const { metadata, ...rest } = record;
  return { ...rest, ...(metadata && typeof metadata === 'object' ? metadata : {}) };
}

/** Split request body into known DB fields and extras for metadata storage */
function splitFields(body, knownFields) {
  const known = {};
  const extras = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (knownFields.has(k)) {
      known[k] = v;
    } else if (k !== 'id' && k !== 'metadata' && k !== 'created_at' && k !== 'updated_at' && k !== 'deleted_at') {
      extras[k] = v;
    }
  }
  // Merge extras into metadata
  const existingMeta = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const mergedMeta = { ...existingMeta, ...extras };
  if (Object.keys(mergedMeta).length > 0) {
    known.metadata = mergedMeta;
  }
  return known;
}

/**
 * Resolve a system UUID from a human-entered system code, scoped to a platform.
 * The admin tables expose `system_code` (not the UUID), so inline "+ Add" sends
 * the code — mirror what the CSV importer does instead of rejecting the row.
 * Returns null when the code is unknown or the platform is not supplied.
 */
async function findSystemIdByCode(code, platformId) {
  if (!code || !platformId) return null;
  const system = await prisma.system.findFirst({
    where: { code: String(code).trim(), platform_id: platformId, deleted_at: null },
    select: { id: true },
  });
  return system?.id || null;
}

/**
 * HTML inputs always produce strings, and a cleared field produces ''. Prisma
 * rejects both for Int/Decimal/Date columns ("Expected Int, provided String"),
 * so normalise them before writing.
 */
function coerceTypes(data, { ints = [], decimals = [], dates = [] }) {
  const blank = (v) => v === '' || v === null || v === undefined;
  for (const key of ints) {
    if (!(key in data)) continue;
    if (blank(data[key])) { data[key] = null; continue; }
    const n = Number(data[key]);
    data[key] = Number.isFinite(n) ? Math.trunc(n) : null;
  }
  for (const key of decimals) {
    if (!(key in data)) continue;
    if (blank(data[key])) { data[key] = null; continue; }
    const n = Number(data[key]);
    data[key] = Number.isFinite(n) ? n : null;
  }
  for (const key of dates) {
    if (!(key in data)) continue;
    if (blank(data[key])) { data[key] = null; continue; }
    const d = new Date(data[key]);
    data[key] = Number.isNaN(d.getTime()) ? null : d;
  }
  return data;
}

const PNID_NUMERIC = { ints: ['sheet_number', 'total_sheets', 'page_count'] };
const LINE_NUMERIC = { decimals: ['design_pressure', 'design_temperature', 'operating_pressure', 'operating_temperature', 'test_pressure'] };
const EQUIPMENT_NUMERIC = { decimals: ['weight_kg'], dates: ['commissioning_date', 'last_inspection', 'next_inspection'] };

/** Drop transport-only keys that splitFields would otherwise bury in metadata. */
function stripMetaKeys(data, keys) {
  if (!data.metadata || typeof data.metadata !== 'object') return data;
  for (const key of keys) delete data.metadata[key];
  if (Object.keys(data.metadata).length === 0) delete data.metadata;
  return data;
}

const SYSTEM_FIELDS = new Set(['platform_id', 'name', 'code', 'sys_type', 'description', 'system_number', 'metadata']);
const LINE_FIELDS = new Set(['system_id', 'line_number', 'service', 'fluid_code', 'nominal_size', 'pipe_class', 'material', 'insulation_code', 'design_pressure', 'design_temperature', 'operating_pressure', 'operating_temperature', 'test_pressure', 'from_equipment_tag', 'to_equipment_tag', 'line_class_spec', 'isometric_ref', 'stress_analysis_ref', 'metadata']);
const EQUIPMENT_FIELDS = new Set(['system_id', 'line_id', 'tag', 'equipment_type', 'description', 'criticality', 'sil_level', 'inspection_group', 'corrosion_loop', 'manufacturer', 'model_number', 'serial_number', 'weight_kg', 'commissioning_date', 'last_inspection', 'next_inspection', 'metadata']);
const INSTRUMENT_FIELDS = new Set(['system_id', 'line_id', 'tag', 'instrument_type', 'description', 'range_min', 'range_max', 'range_unit', 'set_point', 'calibration_range', 'scada_tag', 'io_type', 'signal_type', 'loop_number', 'junction_box', 'cable_number', 'hookup_drawing', 'datasheet_ref', 'metadata']);
const PNID_FIELDS = new Set(['drawing_number', 'title', 'revision', 'status', 'document_type', 'sheet_number', 'total_sheets', 'contractor', 'has_image', 'image_path', 'metadata', 'primary_system_id']);

export default async function adminEntitiesRoutes(fastify) {
  // ═══════════════════════════════════════════════════════════════════
  // SYSTEMS
  // ═══════════════════════════════════════════════════════════════════

  // GET /admin/systems?platform_id=
  fastify.get('/admin/systems', async (request, reply) => {
    const { platform_id } = request.query;
    const where = { deleted_at: null };
    if (platform_id) where.platform_id = platform_id;

    const systems = await prisma.system.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { systems: systems.map(flattenRecord) };
  });

  // POST /admin/systems
  fastify.post('/admin/systems', async (request, reply) => {
    const data = splitFields(request.body, SYSTEM_FIELDS);

    if (!data.platform_id || !data.name || !data.code || !data.sys_type) {
      return reply.status(400).send({ error: 'platform_id, name, code, and sys_type are required' });
    }

    try {
      const system = await prisma.system.create({ data });
      return reply.status(201).send({ system: flattenRecord(system) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A system with this platform_id and code already exists' });
      }
      throw err;
    }
  });

  // PUT /admin/systems/:id
  fastify.put('/admin/systems/:id', async (request, reply) => {
    const { id } = request.params;
    // Get existing record to merge metadata
    const existing = await prisma.system.findUnique({ where: { id } });
    const body = { ...request.body };
    if (existing?.metadata) {
      body.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) };
    }
    const data = splitFields(body, SYSTEM_FIELDS);
    data.updated_at = new Date();

    try {
      const system = await prisma.system.update({
        where: { id, deleted_at: null },
        data,
      });
      return { system: flattenRecord(system) };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'System not found' });
      }
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A system with this platform_id and code already exists' });
      }
      throw err;
    }
  });

  // DELETE /admin/systems/:id (soft delete)
  fastify.delete('/admin/systems/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.system.update({
        where: { id, deleted_at: null },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'System not found' });
      }
      throw err;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // P&IDs
  // ═══════════════════════════════════════════════════════════════════

  // GET /admin/pnids?platform_id=
  fastify.get('/admin/pnids', async (request, reply) => {
    const { platform_id } = request.query;

    const where = { deleted_at: null };
    if (platform_id) {
      // Include P&IDs linked to this platform's systems OR unassigned P&IDs (no system link)
      where.OR = [
        { pnid_system: { some: { system: { platform_id, deleted_at: null } } } },
        { pnid_system: { none: {} } },
      ];
    }

    const pnids = await prisma.pnid.findMany({
      where,
      include: {
        pnid_system: {
          include: { system: { select: { id: true, name: true, code: true } } },
        },
      },
      orderBy: { drawing_number: 'asc' },
    });

    return {
      pnids: pnids.map(p => {
        const flat = flattenRecord(p);
        // Extract primary system code
        const primarySys = p.pnid_system?.find(ps => ps.is_primary);
        flat.primary_system_code = primarySys?.system?.code || '';
        // Flatten systems list for the expanded view
        flat.systems = p.pnid_system?.map(ps => ({
          id: ps.system?.id,
          code: ps.system?.code,
          name: ps.system?.name,
          isPrimary: ps.is_primary,
        })) || [];
        return flat;
      }),
    };
  });

  // POST /admin/pnids
  fastify.post('/admin/pnids', async (request, reply) => {
    const data = splitFields(request.body, PNID_FIELDS);
    const platformId = request.body.platformId || request.body.platform_id;

    // The P&ID table exposes `primary_system_code`, so accept either form.
    const primary_system_id = request.body.primary_system_id
      || await findSystemIdByCode(request.body.primary_system_code, platformId);
    stripMetaKeys(data, ['primary_system_code', 'primary_system_id', 'platformId', 'platform_id']);
    delete data.primary_system_id; // linked via pnid_system, not a column on pnid
    coerceTypes(data, PNID_NUMERIC);

    if (!data.drawing_number) {
      return reply.status(400).send({ error: 'drawing_number is required' });
    }
    if (!primary_system_id) {
      return reply.status(400).send({
        error: request.body.primary_system_code
          ? `Unknown system code "${request.body.primary_system_code}" for this platform. Create the system first, or pick an existing one.`
          : 'A primary system is required — provide primary_system_code (or primary_system_id).',
      });
    }

    try {
      const pnid = await prisma.pnid.create({
        data: {
          ...data,
          pnid_system: {
            create: { system_id: primary_system_id, is_primary: true },
          },
        },
        include: {
          pnid_system: {
            include: { system: { select: { id: true, name: true, code: true } } },
          },
        },
      });
      return reply.status(201).send({ pnid: flattenRecord(pnid) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A P&ID with this drawing_number already exists' });
      }
      throw err;
    }
  });

  // PUT /admin/pnids/:id
  fastify.put('/admin/pnids/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.pnid.findUnique({ where: { id } });
    const body = { ...request.body };
    if (existing?.metadata) {
      body.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) };
    }
    const data = splitFields(body, PNID_FIELDS);
    coerceTypes(data, PNID_NUMERIC);
    // Remove primary_system_id from data — it's handled separately
    delete data.primary_system_id;
    data.updated_at = new Date();

    try {
      const pnid = await prisma.pnid.update({
        where: { id, deleted_at: null },
        data,
      });
      return { pnid: flattenRecord(pnid) };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'P&ID not found' });
      }
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A P&ID with this drawing_number already exists' });
      }
      throw err;
    }
  });

  // DELETE /admin/pnids/:id (soft delete)
  fastify.delete('/admin/pnids/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.pnid.update({
        where: { id, deleted_at: null },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'P&ID not found' });
      }
      throw err;
    }
  });

  // POST /admin/pnids/:id/systems — add system to P&ID
  fastify.post('/admin/pnids/:id/systems', async (request, reply) => {
    const { id } = request.params;
    const { system_id, is_primary } = request.body;

    if (!system_id) {
      return reply.status(400).send({ error: 'system_id is required' });
    }

    // If setting as primary, unset any existing primary
    if (is_primary) {
      await prisma.pnid_system.updateMany({
        where: { pnid_id: id, is_primary: true },
        data: { is_primary: false },
      });
    }

    try {
      const link = await prisma.pnid_system.create({
        data: {
          pnid_id: id,
          system_id,
          is_primary: is_primary || false,
        },
      });
      return reply.status(201).send({ pnid_system: link });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'This system is already linked to this P&ID' });
      }
      throw err;
    }
  });

  // DELETE /admin/pnids/:pnidId/systems/:systemId — remove system from P&ID
  fastify.delete('/admin/pnids/:pnidId/systems/:systemId', async (request, reply) => {
    const { pnidId, systemId } = request.params;

    try {
      await prisma.pnid_system.delete({
        where: {
          pnid_id_system_id: { pnid_id: pnidId, system_id: systemId },
        },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'P&ID-system link not found' });
      }
      throw err;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // LINES
  // ═══════════════════════════════════════════════════════════════════

  // GET /admin/lines?system_id=&platform_id=
  fastify.get('/admin/lines', async (request, reply) => {
    try {
      const { system_id, platform_id } = request.query;
      const where = { deleted_at: null };

      if (system_id) {
        where.system_id = system_id;
      } else if (platform_id) {
        where.system = { platform_id, deleted_at: null };
      }

      const lines = await prisma.line.findMany({
        where,
        include: {
          system: { select: { id: true, name: true, code: true } },
        },
        orderBy: { line_number: 'asc' },
      });

      return {
        lines: lines.map(l => ({
          ...flattenRecord(l),
          system_code: l.system?.code || '',
          system_name: l.system?.name || '',
        })),
      };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /admin/lines failed');
      return reply.code(500).send({ error: 'Failed to fetch admin lines', detail: err.message });
    }
  });

  // POST /admin/lines
  fastify.post('/admin/lines', async (request, reply) => {
    const data = splitFields(request.body, LINE_FIELDS);
    const platformId = request.body.platformId || request.body.platform_id;

    if (!data.system_id) {
      data.system_id = await findSystemIdByCode(request.body.system_code, platformId);
    }
    stripMetaKeys(data, ['system_code', 'platformId', 'platform_id']);
    coerceTypes(data, LINE_NUMERIC);

    if (!data.system_id) {
      return reply.status(400).send({
        error: request.body.system_code
          ? `Unknown system code "${request.body.system_code}" for this platform. Create the system first, or pick an existing one.`
          : 'A system is required — provide system_code (or system_id).',
      });
    }
    if (!data.line_number) {
      return reply.status(400).send({ error: 'line_number is required' });
    }

    try {
      const line = await prisma.line.create({ data });
      return reply.status(201).send({ line: flattenRecord(line) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A line with this system_id and line_number already exists' });
      }
      throw err;
    }
  });

  // PUT /admin/lines/:id
  fastify.put('/admin/lines/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.line.findUnique({ where: { id } });
    const body = { ...request.body };
    if (existing?.metadata) {
      body.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) };
    }
    const data = splitFields(body, LINE_FIELDS);
    coerceTypes(data, LINE_NUMERIC);
    data.updated_at = new Date();

    try {
      const line = await prisma.line.update({
        where: { id, deleted_at: null },
        data,
      });
      return { line: flattenRecord(line) };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Line not found' });
      }
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'A line with this system_id and line_number already exists' });
      }
      throw err;
    }
  });

  // DELETE /admin/lines/:id (soft delete)
  fastify.delete('/admin/lines/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.line.update({
        where: { id, deleted_at: null },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Line not found' });
      }
      throw err;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // EQUIPMENT
  // ═══════════════════════════════════════════════════════════════════

  // GET /admin/equipment?system_id=&platform_id=&line_id=
  fastify.get('/admin/equipment', async (request, reply) => {
    try {
      const { system_id, platform_id, line_id } = request.query;
      const where = { deleted_at: null };

      if (line_id) {
        where.line_id = line_id;
      } else if (system_id) {
        where.system_id = system_id;
      } else if (platform_id) {
        where.system = { platform_id, deleted_at: null };
      }

      const equipment = await prisma.equipment.findMany({
        where,
        include: {
          system: { select: { id: true, name: true, code: true } },
          line: { select: { id: true, line_number: true } },
        },
        orderBy: { tag: 'asc' },
      });

      return {
        equipment: equipment.map(e => ({
          ...flattenRecord(e),
          system_code: e.system?.code || '',
          system_name: e.system?.name || '',
          line_number: e.line?.line_number || '',
        })),
      };
    } catch (err) {
      request.log.error({ err, query: request.query }, 'GET /admin/equipment failed');
      return reply.code(500).send({ error: 'Failed to fetch admin equipment', detail: err.message });
    }
  });

  // POST /admin/equipment
  fastify.post('/admin/equipment', async (request, reply) => {
    const data = splitFields(request.body, EQUIPMENT_FIELDS);
    const platformId = request.body.platformId || request.body.platform_id;

    if (!data.system_id) {
      data.system_id = await findSystemIdByCode(request.body.system_code, platformId);
    }
    stripMetaKeys(data, ['system_code', 'platformId', 'platform_id']);
    coerceTypes(data, EQUIPMENT_NUMERIC);

    if (!data.system_id) {
      return reply.status(400).send({
        error: request.body.system_code
          ? `Unknown system code "${request.body.system_code}" for this platform. Create the system first, or pick an existing one.`
          : 'A system is required — provide system_code (or system_id).',
      });
    }
    if (!data.tag || !data.equipment_type) {
      return reply.status(400).send({ error: 'tag and equipment_type are required' });
    }

    try {
      const equipment = await prisma.equipment.create({ data });
      return reply.status(201).send({ equipment: flattenRecord(equipment) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Equipment with this tag already exists' });
      }
      throw err;
    }
  });

  // PUT /admin/equipment/:id
  fastify.put('/admin/equipment/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.equipment.findUnique({ where: { id } });
    const body = { ...request.body };
    if (existing?.metadata) {
      body.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) };
    }
    const data = splitFields(body, EQUIPMENT_FIELDS);
    coerceTypes(data, EQUIPMENT_NUMERIC);
    data.updated_at = new Date();

    try {
      const equipment = await prisma.equipment.update({
        where: { id, deleted_at: null },
        data,
      });
      return { equipment: flattenRecord(equipment) };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Equipment not found' });
      }
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Equipment with this tag already exists' });
      }
      throw err;
    }
  });

  // DELETE /admin/equipment/:id (soft delete)
  fastify.delete('/admin/equipment/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.equipment.update({
        where: { id, deleted_at: null },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Equipment not found' });
      }
      throw err;
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // INSTRUMENTS
  // ═══════════════════════════════════════════════════════════════════

  // GET /admin/instruments?system_id=&platform_id=&line_id=
  fastify.get('/admin/instruments', async (request, reply) => {
    const { system_id, platform_id, line_id } = request.query;
    const where = { deleted_at: null };

    if (line_id) {
      where.line_id = line_id;
    } else if (system_id) {
      where.system_id = system_id;
    } else if (platform_id) {
      where.system = { platform_id, deleted_at: null };
    }

    const instruments = await prisma.instrument.findMany({
      where,
      include: {
        system: { select: { id: true, name: true, code: true } },
        line: { select: { id: true, line_number: true } },
      },
      orderBy: { tag: 'asc' },
    });

    return {
      instruments: instruments.map(i => ({
        ...flattenRecord(i),
        system_code: i.system?.code || '',
        system_name: i.system?.name || '',
        line_number: i.line?.line_number || '',
      })),
    };
  });

  // POST /admin/instruments
  fastify.post('/admin/instruments', async (request, reply) => {
    const data = splitFields(request.body, INSTRUMENT_FIELDS);
    const platformId = request.body.platformId || request.body.platform_id;

    if (!data.system_id) {
      data.system_id = await findSystemIdByCode(request.body.system_code, platformId);
    }
    stripMetaKeys(data, ['system_code', 'platformId', 'platform_id']);

    if (!data.system_id) {
      return reply.status(400).send({
        error: request.body.system_code
          ? `Unknown system code "${request.body.system_code}" for this platform. Create the system first, or pick an existing one.`
          : 'A system is required — provide system_code (or system_id).',
      });
    }
    if (!data.tag || !data.instrument_type) {
      return reply.status(400).send({ error: 'tag and instrument_type are required' });
    }

    try {
      const instrument = await prisma.instrument.create({ data });
      return reply.status(201).send({ instrument: flattenRecord(instrument) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Instrument with this tag already exists' });
      }
      throw err;
    }
  });

  // PUT /admin/instruments/:id
  fastify.put('/admin/instruments/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.instrument.findUnique({ where: { id } });
    const body = { ...request.body };
    if (existing?.metadata) {
      body.metadata = { ...(existing.metadata || {}), ...(body.metadata || {}) };
    }
    const data = splitFields(body, INSTRUMENT_FIELDS);
    data.updated_at = new Date();

    try {
      const instrument = await prisma.instrument.update({
        where: { id, deleted_at: null },
        data,
      });
      return { instrument: flattenRecord(instrument) };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Instrument not found' });
      }
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Instrument with this tag already exists' });
      }
      throw err;
    }
  });

  // DELETE /admin/instruments/:id (soft delete)
  fastify.delete('/admin/instruments/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      await prisma.instrument.update({
        where: { id, deleted_at: null },
        data: { deleted_at: new Date(), updated_at: new Date() },
      });
      return { success: true };
    } catch (err) {
      if (err.code === 'P2025') {
        return reply.status(404).send({ error: 'Instrument not found' });
      }
      throw err;
    }
  });
}
