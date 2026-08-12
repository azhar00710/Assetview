import crypto from 'crypto';
import prisma from '../../db.js';

// ─── CSV helpers ──────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(headers, rows) {
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map(row => headers.map(h => escapeCSV(row[h])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

function rowToObj(headers, values) {
  const obj = {};
  headers.forEach((h, i) => {
    const val = values[i] !== undefined ? values[i] : '';
    obj[h] = val === '' ? null : val;
  });
  return obj;
}

function toNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ─── Helper to build system code → id map ─────────────────────────────

async function buildSystemMap(platformId) {
  const systems = await prisma.system.findMany({
    where: { platform_id: platformId, deleted_at: null },
    select: { id: true, code: true },
  });
  const map = {};
  for (const s of systems) {
    map[s.code] = s.id;
  }
  return map;
}

// ─── Helper to build line_number → id map for a platform ──────────────

async function buildLineMap(platformId) {
  const lines = await prisma.line.findMany({
    where: { deleted_at: null, system: { platform_id: platformId, deleted_at: null } },
    select: { id: true, line_number: true, system_id: true },
  });
  const map = {};
  for (const l of lines) {
    map[`${l.system_id}:${l.line_number}`] = l.id;
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════

export default async function adminImportExportRoutes(fastify) {

  // ─── EXPORT SYSTEMS ─────────────────────────────────────────────────

  fastify.get('/admin/export/systems', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const systems = await prisma.system.findMany({
      where: { platform_id, deleted_at: null },
      orderBy: { code: 'asc' },
    });

    const headers = ['code', 'name', 'sys_type', 'description', 'system_number'];
    const rows = systems.map(s => ({
      code: s.code,
      name: s.name,
      sys_type: s.sys_type,
      description: s.description,
      system_number: s.system_number,
    }));

    const csv = toCSV(headers, rows);
    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="systems.csv"')
      .send(csv);
  });

  // ─── IMPORT SYSTEMS ─────────────────────────────────────────────────

  fastify.post('/admin/import/systems', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const body = typeof request.body === 'string' ? request.body : String(request.body);
    const { headers, rows } = parseCSV(body);

    if (!headers.includes('code') || !headers.includes('name') || !headers.includes('sys_type')) {
      return reply.status(400).send({ error: 'CSV must include code, name, and sys_type columns' });
    }

    const validTypes = new Set(['process', 'utility', 'safety', 'instrument']);
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);
      const rowNum = i + 2;

      if (!obj.code) {
        errors.push({ row: rowNum, error: 'Missing code' });
        continue;
      }
      if (!obj.name) {
        errors.push({ row: rowNum, error: 'Missing name' });
        continue;
      }
      if (!obj.sys_type || !validTypes.has(obj.sys_type)) {
        errors.push({ row: rowNum, error: `Invalid sys_type: ${obj.sys_type}. Must be one of: process, utility, safety, instrument` });
        continue;
      }

      const data = {
        name: obj.name,
        sys_type: obj.sys_type,
        description: obj.description || null,
        system_number: obj.system_number || null,
      };

      try {
        const existing = await prisma.system.findFirst({
          where: { platform_id, code: obj.code, deleted_at: null },
        });

        if (existing) {
          await prisma.system.update({
            where: { id: existing.id },
            data: { ...data, updated_at: new Date() },
          });
          updated++;
        } else {
          await prisma.system.create({
            data: { platform_id, code: obj.code, ...data },
          });
          imported++;
        }
      } catch (err) {
        errors.push({ row: rowNum, error: err.message });
      }
    }

    return { imported, updated, errors };
  });

  // ─── EXPORT LINES ──────────────────────────────────────────────────

  fastify.get('/admin/export/lines', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const lines = await prisma.line.findMany({
      where: { deleted_at: null, system: { platform_id, deleted_at: null } },
      include: { system: { select: { code: true } } },
      orderBy: { line_number: 'asc' },
    });

    const headers = [
      'system_code', 'line_number', 'nominal_size', 'fluid_code', 'pipe_class',
      'insulation_code', 'insulation_thickness', 'tracing',
      'from', 'to', 'service', 'flow_medium',
      'liquid_flow_bpd', 'water_flow_bwpd', 'gas_flow_mmscfd',
      'viscosity_cp', 'molecular_weight', 'density_kg_m3',
      'operating_pressure_min', 'operating_pressure_max',
      'operating_temperature_min', 'operating_temperature_max',
      'design_pressure_min', 'design_pressure_max',
      'design_temperature_min', 'design_temperature_max',
      'test_pressure', 'test_medium',
      'design_code', 'schedule_wall_thickness', 'stress_relief', 'nace_mr0175',
      'ndt_rt_pct', 'ndt_dpi_pct', 'ndt_mpi_pct', 'pwht',
      'pnid_references', 'remarks',
    ];

    const rows = lines.map(l => ({
      system_code: l.system.code,
      line_number: l.line_number,
      nominal_size: l.nominal_size,
      fluid_code: l.fluid_code,
      pipe_class: l.pipe_class,
      insulation_code: l.insulation_code,
      insulation_thickness: l.insulation_thickness,
      tracing: l.tracing,
      from: l.from_connection,
      to: l.to_connection,
      service: l.service,
      flow_medium: l.flow_medium,
      liquid_flow_bpd: l.liquid_flow_bpd,
      water_flow_bwpd: l.water_flow_bwpd,
      gas_flow_mmscfd: l.gas_flow_mmscfd,
      viscosity_cp: l.viscosity_cp,
      molecular_weight: l.molecular_weight,
      density_kg_m3: l.density_kg_m3,
      operating_pressure_min: l.operating_pressure_min,
      operating_pressure_max: l.operating_pressure_max,
      operating_temperature_min: l.operating_temperature_min,
      operating_temperature_max: l.operating_temperature_max,
      design_pressure_min: l.design_pressure_min,
      design_pressure_max: l.design_pressure_max,
      design_temperature_min: l.design_temperature_min,
      design_temperature_max: l.design_temperature_max,
      test_pressure: l.test_pressure,
      test_medium: l.test_medium,
      design_code: l.design_code,
      schedule_wall_thickness: l.schedule_wall_thickness,
      stress_relief: l.stress_relief,
      nace_mr0175: l.nace_mr0175,
      ndt_rt_pct: l.ndt_rt_pct,
      ndt_dpi_pct: l.ndt_dpi_pct,
      ndt_mpi_pct: l.ndt_mpi_pct,
      pwht: l.pwht,
      pnid_references: l.pnid_references,
      remarks: l.remarks,
    }));

    const csv = toCSV(headers, rows);
    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="lines.csv"')
      .send(csv);
  });

  // ─── EXPORT EQUIPMENT ─────────────────────────────────────────────

  fastify.get('/admin/export/equipment', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const equipment = await prisma.equipment.findMany({
      where: { deleted_at: null, system: { platform_id, deleted_at: null } },
      include: {
        system: { select: { code: true } },
        line: { select: { line_number: true } },
      },
      orderBy: { tag: 'asc' },
    });

    const headers = [
      'system_code', 'tag', 'equipment_type', 'description', 'criticality',
      'sil_level', 'inspection_group', 'corrosion_loop', 'manufacturer',
      'model_number', 'serial_number', 'weight_kg', 'line_number',
    ];

    const rows = equipment.map(e => ({
      system_code: e.system.code,
      tag: e.tag,
      equipment_type: e.equipment_type,
      description: e.description,
      criticality: e.criticality,
      sil_level: e.sil_level,
      inspection_group: e.inspection_group,
      corrosion_loop: e.corrosion_loop,
      manufacturer: e.manufacturer,
      model_number: e.model_number,
      serial_number: e.serial_number,
      weight_kg: e.weight_kg,
      line_number: e.line ? e.line.line_number : null,
    }));

    const csv = toCSV(headers, rows);
    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="equipment.csv"')
      .send(csv);
  });

  // ─── EXPORT INSTRUMENTS ───────────────────────────────────────────

  fastify.get('/admin/export/instruments', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const instruments = await prisma.instrument.findMany({
      where: { deleted_at: null, system: { platform_id, deleted_at: null } },
      include: {
        system: { select: { code: true } },
        line: { select: { line_number: true } },
      },
      orderBy: { tag: 'asc' },
    });

    const headers = [
      'system_code', 'tag', 'instrument_type', 'description',
      'range_min', 'range_max', 'range_unit', 'set_point',
      'scada_tag', 'io_type', 'signal_type', 'loop_number', 'line_number',
    ];

    const rows = instruments.map(i => ({
      system_code: i.system.code,
      tag: i.tag,
      instrument_type: i.instrument_type,
      description: i.description,
      range_min: i.range_min,
      range_max: i.range_max,
      range_unit: i.range_unit,
      set_point: i.set_point,
      scada_tag: i.scada_tag,
      io_type: i.io_type,
      signal_type: i.signal_type,
      loop_number: i.loop_number,
      line_number: i.line ? i.line.line_number : null,
    }));

    const csv = toCSV(headers, rows);
    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="instruments.csv"')
      .send(csv);
  });

  // ─── IMPORT LINES ────────────────────────────────────────────────

  fastify.post('/admin/import/lines', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const body = typeof request.body === 'string' ? request.body : String(request.body);
    const { headers, rows } = parseCSV(body);

    if (!headers.includes('system_code') || !headers.includes('line_number')) {
      return reply.status(400).send({ error: 'CSV must include system_code and line_number columns' });
    }

    const systemMap = await buildSystemMap(platform_id);
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);
      const rowNum = i + 2; // 1-indexed, skip header

      const systemId = systemMap[obj.system_code];
      if (!systemId) {
        errors.push({ row: rowNum, error: `Unknown system_code: ${obj.system_code}` });
        continue;
      }
      if (!obj.line_number) {
        errors.push({ row: rowNum, error: 'Missing line_number' });
        continue;
      }

      const toDecimal = (v) => v && v !== '' ? parseFloat(v) || null : null;

      const data = {
        service: obj.service || null,
        fluid_code: obj.fluid_code || null,
        nominal_size: obj.nominal_size || null,
        pipe_class: obj.pipe_class || null,
        material: obj.material || null,
        insulation_code: obj.insulation_code || null,
        insulation_thickness: obj.insulation_thickness || null,
        tracing: obj.tracing || null,
        // FROM/TO — accept both old and new column names
        from_connection: obj.from || obj.from_connection || obj.from_equipment_tag || null,
        to_connection: obj.to || obj.to_connection || obj.to_equipment_tag || null,
        // Also populate legacy columns for backward compatibility
        from_equipment_tag: obj.from || obj.from_connection || obj.from_equipment_tag || null,
        to_equipment_tag: obj.to || obj.to_connection || obj.to_equipment_tag || null,
        // Fluid data
        flow_medium: obj.flow_medium || null,
        liquid_flow_bpd: toDecimal(obj.liquid_flow_bpd),
        water_flow_bwpd: toDecimal(obj.water_flow_bwpd),
        gas_flow_mmscfd: toDecimal(obj.gas_flow_mmscfd),
        viscosity_cp: toDecimal(obj.viscosity_cp),
        molecular_weight: toDecimal(obj.molecular_weight),
        density_kg_m3: toDecimal(obj.density_kg_m3),
        // Operating conditions (min/max)
        operating_pressure_min: toDecimal(obj.operating_pressure_min),
        operating_pressure_max: toDecimal(obj.operating_pressure_max),
        operating_temperature_min: toDecimal(obj.operating_temperature_min),
        operating_temperature_max: toDecimal(obj.operating_temperature_max),
        // Design conditions (min/max)
        design_pressure_min: toDecimal(obj.design_pressure_min),
        design_pressure_max: toDecimal(obj.design_pressure_max),
        design_temperature_min: toDecimal(obj.design_temperature_min),
        design_temperature_max: toDecimal(obj.design_temperature_max),
        // Test conditions
        test_pressure: toDecimal(obj.test_pressure),
        test_medium: obj.test_medium || null,
        // Piping design
        design_code: obj.design_code || null,
        schedule_wall_thickness: obj.schedule_wall_thickness || null,
        stress_relief: obj.stress_relief || null,
        nace_mr0175: obj.nace_mr0175 || null,
        // NDT
        ndt_rt_pct: toDecimal(obj.ndt_rt_pct),
        ndt_dpi_pct: toDecimal(obj.ndt_dpi_pct),
        ndt_mpi_pct: toDecimal(obj.ndt_mpi_pct),
        pwht: obj.pwht || null,
        // P&ID references
        pnid_references: obj.pnid_references || null,
        remarks: obj.remarks || null,
        // Legacy single-value fields (populate from max values for backward compat)
        design_pressure: toDecimal(obj.design_pressure_max || obj.design_pressure),
        design_temperature: toDecimal(obj.design_temperature_max || obj.design_temperature),
        operating_pressure: toDecimal(obj.operating_pressure_max || obj.operating_pressure),
        operating_temperature: toDecimal(obj.operating_temperature_max || obj.operating_temperature),
      };

      try {
        const existing = await prisma.line.findFirst({
          where: { system_id: systemId, line_number: obj.line_number, deleted_at: null },
        });

        if (existing) {
          await prisma.line.update({
            where: { id: existing.id },
            data: { ...data, updated_at: new Date() },
          });
          updated++;
        } else {
          await prisma.line.create({
            data: { system_id: systemId, line_number: obj.line_number, ...data },
          });
          imported++;
        }
      } catch (err) {
        errors.push({ row: rowNum, error: err.message });
      }
    }

    return { imported, updated, errors };
  });

  // ─── IMPORT EQUIPMENT ─────────────────────────────────────────────

  fastify.post('/admin/import/equipment', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const body = typeof request.body === 'string' ? request.body : String(request.body);
    const { headers, rows } = parseCSV(body);

    if (!headers.includes('system_code') || !headers.includes('tag')) {
      return reply.status(400).send({ error: 'CSV must include system_code and tag columns' });
    }

    const systemMap = await buildSystemMap(platform_id);
    const lineMap = await buildLineMap(platform_id);
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);
      const rowNum = i + 2;

      const systemId = systemMap[obj.system_code];
      if (!systemId) {
        errors.push({ row: rowNum, error: `Unknown system_code: ${obj.system_code}` });
        continue;
      }
      if (!obj.tag) {
        errors.push({ row: rowNum, error: 'Missing tag' });
        continue;
      }

      // Resolve optional line_number to line_id
      let lineId = null;
      if (obj.line_number) {
        lineId = lineMap[`${systemId}:${obj.line_number}`] || null;
        if (!lineId) {
          errors.push({ row: rowNum, error: `Unknown line_number: ${obj.line_number} for system ${obj.system_code}` });
          continue;
        }
      }

      const data = {
        equipment_type: obj.equipment_type,
        description: obj.description,
        criticality: obj.criticality || null,
        sil_level: obj.sil_level,
        inspection_group: obj.inspection_group,
        corrosion_loop: obj.corrosion_loop,
        manufacturer: obj.manufacturer,
        model_number: obj.model_number,
        serial_number: obj.serial_number,
        weight_kg: toNumber(obj.weight_kg),
        line_id: lineId,
      };

      try {
        const existing = await prisma.equipment.findFirst({
          where: { system_id: systemId, tag: obj.tag, deleted_at: null },
        });

        if (existing) {
          await prisma.equipment.update({
            where: { id: existing.id },
            data: { ...data, updated_at: new Date() },
          });
          updated++;
        } else {
          await prisma.equipment.create({
            data: { system_id: systemId, tag: obj.tag, ...data },
          });
          imported++;
        }
      } catch (err) {
        errors.push({ row: rowNum, error: err.message });
      }
    }

    return { imported, updated, errors };
  });

  // ─── IMPORT INSTRUMENTS ───────────────────────────────────────────

  fastify.post('/admin/import/instruments', async (request, reply) => {
    const { platform_id } = request.query;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const body = typeof request.body === 'string' ? request.body : String(request.body);
    const { headers, rows } = parseCSV(body);

    if (!headers.includes('system_code') || !headers.includes('tag')) {
      return reply.status(400).send({ error: 'CSV must include system_code and tag columns' });
    }

    const systemMap = await buildSystemMap(platform_id);
    const lineMap = await buildLineMap(platform_id);
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);
      const rowNum = i + 2;

      const systemId = systemMap[obj.system_code];
      if (!systemId) {
        errors.push({ row: rowNum, error: `Unknown system_code: ${obj.system_code}` });
        continue;
      }
      if (!obj.tag) {
        errors.push({ row: rowNum, error: 'Missing tag' });
        continue;
      }

      // Resolve optional line_number to line_id
      let lineId = null;
      if (obj.line_number) {
        lineId = lineMap[`${systemId}:${obj.line_number}`] || null;
        if (!lineId) {
          errors.push({ row: rowNum, error: `Unknown line_number: ${obj.line_number} for system ${obj.system_code}` });
          continue;
        }
      }

      const data = {
        instrument_type: obj.instrument_type,
        description: obj.description,
        // These are VarChar columns, not numerics — ranges are often written as
        // "0-100" or "1.5 barg", so keep the text as-is rather than coercing.
        range_min: obj.range_min || null,
        range_max: obj.range_max || null,
        range_unit: obj.range_unit,
        set_point: obj.set_point || null,
        scada_tag: obj.scada_tag,
        io_type: obj.io_type,
        signal_type: obj.signal_type,
        loop_number: obj.loop_number,
        line_id: lineId,
      };

      try {
        const existing = await prisma.instrument.findFirst({
          where: { system_id: systemId, tag: obj.tag, deleted_at: null },
        });

        if (existing) {
          await prisma.instrument.update({
            where: { id: existing.id },
            data: { ...data, updated_at: new Date() },
          });
          updated++;
        } else {
          await prisma.instrument.create({
            data: { system_id: systemId, tag: obj.tag, ...data },
          });
          imported++;
        }
      } catch (err) {
        errors.push({ row: rowNum, error: err.message });
      }
    }

    return { imported, updated, errors };
  });

  // ─── IMPORT LINES PREVIEW (diff without applying) ──────────────────

  fastify.post('/admin/import/lines/preview', async (request, reply) => {
    const { csv, platform_id: bodyPlatformId } = request.body || {};
    const platform_id = request.query.platform_id || bodyPlatformId;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const csvText = csv || (typeof request.body === 'string' ? request.body : '');
    const { headers, rows } = parseCSV(csvText);

    if (!headers.includes('system_code') || !headers.includes('line_number')) {
      return reply.status(400).send({ error: 'CSV must include system_code and line_number columns' });
    }

    const systemMap = await buildSystemMap(platform_id);

    // Build reverse map: system_id → system_code
    const systemCodeMap = {};
    for (const [code, id] of Object.entries(systemMap)) {
      systemCodeMap[id] = code;
    }

    // Fetch all existing lines for this platform
    const existingLines = await prisma.line.findMany({
      where: { deleted_at: null, system: { platform_id, deleted_at: null } },
      include: {
        system: { select: { code: true } },
        _count: {
          select: {
            pnid_line: true,
            equipment: { where: { deleted_at: null } },
            instrument: { where: { deleted_at: null } },
          },
        },
      },
    });

    // Map existing lines by system_code + line_number
    const existingMap = {};
    for (const line of existingLines) {
      const key = `${line.system.code}:${line.line_number}`;
      existingMap[key] = line;
    }

    const added = [];
    const modified = [];
    const unchanged = [];
    const warnings = [];
    const csvKeys = new Set();

    const lineFields = [
      'service', 'fluid_code', 'nominal_size', 'pipe_class', 'material',
      'insulation_code', 'insulation_thickness', 'tracing',
      'from_connection', 'to_connection',
      'flow_medium', 'liquid_flow_bpd', 'water_flow_bwpd', 'gas_flow_mmscfd',
      'viscosity_cp', 'molecular_weight', 'density_kg_m3',
      'operating_pressure_min', 'operating_pressure_max',
      'operating_temperature_min', 'operating_temperature_max',
      'design_pressure_min', 'design_pressure_max',
      'design_temperature_min', 'design_temperature_max',
      'test_pressure', 'test_medium',
      'design_code', 'schedule_wall_thickness', 'stress_relief', 'nace_mr0175',
      'ndt_rt_pct', 'ndt_dpi_pct', 'ndt_mpi_pct', 'pwht',
      'pnid_references', 'remarks',
    ];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);

      if (!obj.system_code || !obj.line_number) continue;
      if (!systemMap[obj.system_code]) continue;

      const key = `${obj.system_code}:${obj.line_number}`;
      csvKeys.add(key);

      const existing = existingMap[key];
      if (!existing) {
        added.push({ lineNumber: obj.line_number, systemCode: obj.system_code, ...obj });
      } else {
        // Compare fields for changes
        const changes = {};
        for (const field of lineFields) {
          const oldVal = existing[field] !== null && existing[field] !== undefined ? String(existing[field]) : null;
          const newVal = obj[field] !== null && obj[field] !== undefined ? String(obj[field]) : null;
          if (oldVal !== newVal) {
            changes[field] = { old: existing[field], new: obj[field] };
          }
        }

        if (Object.keys(changes).length > 0) {
          modified.push({
            id: existing.id,
            lineNumber: existing.line_number,
            systemCode: obj.system_code,
            changes,
          });
        } else {
          unchanged.push({ lineNumber: existing.line_number, systemCode: obj.system_code });
        }
      }
    }

    // Determine removed: lines in DB but not in CSV
    const removed = [];
    for (const line of existingLines) {
      const key = `${line.system.code}:${line.line_number}`;
      if (!csvKeys.has(key)) {
        const pnidCount = line._count.pnid_line;
        const equipmentCount = line._count.equipment;
        const instrumentCount = line._count.instrument;
        const annotationCount = pnidCount + equipmentCount + instrumentCount;
        const hasAnnotations = annotationCount > 0;

        if (hasAnnotations) {
          const parts = [];
          if (pnidCount > 0) parts.push(`${pnidCount} P&ID annotation(s)`);
          if (equipmentCount > 0) parts.push(`${equipmentCount} equipment item(s)`);
          if (instrumentCount > 0) parts.push(`${instrumentCount} instrument(s)`);
          warnings.push(`Line ${line.line_number} has ${parts.join(', ')} that will be orphaned if removed`);
        }

        removed.push({
          id: line.id,
          lineNumber: line.line_number,
          systemCode: line.system.code,
          hasAnnotations,
          annotationCount,
          pnidCount,
        });
      }
    }

    return { added, modified, removed, unchanged, warnings };
  });

  // ─── IMPORT LINES APPLY (apply approved changes) ───────────────────

  fastify.post('/admin/import/lines/apply', async (request, reply) => {
    const platform_id = request.query.platform_id || request.body?.platform_id;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const { added = [], modified = [], removed = [], removeAction = 'soft_delete' } = request.body || {};
    const batchId = crypto.randomUUID();
    const errors = [];
    let addedCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;

    const systemMap = await buildSystemMap(platform_id);

    // Process additions
    for (const item of added) {
      const systemId = systemMap[item.systemCode || item.system_code];
      if (!systemId) {
        errors.push({ lineNumber: item.lineNumber || item.line_number, error: `Unknown system_code: ${item.systemCode || item.system_code}` });
        continue;
      }
      try {
        const toNum = (v) => v && v !== '' ? parseFloat(v) || null : null;
        const created = await prisma.line.create({
          data: {
            system_id: systemId,
            line_number: item.lineNumber || item.line_number,
            service: item.service || null,
            fluid_code: item.fluid_code || null,
            nominal_size: item.nominal_size || item.nominalSize || null,
            pipe_class: item.pipe_class || item.pipeClass || null,
            material: item.material || null,
            insulation_code: item.insulation_code || item.insulationCode || null,
            insulation_thickness: item.insulation_thickness || null,
            tracing: item.tracing || null,
            from_connection: item.from || item.from_connection || item.from_equipment_tag || null,
            to_connection: item.to || item.to_connection || item.to_equipment_tag || null,
            from_equipment_tag: item.from || item.from_connection || item.from_equipment_tag || null,
            to_equipment_tag: item.to || item.to_connection || item.to_equipment_tag || null,
            flow_medium: item.flow_medium || null,
            liquid_flow_bpd: toNum(item.liquid_flow_bpd),
            water_flow_bwpd: toNum(item.water_flow_bwpd),
            gas_flow_mmscfd: toNum(item.gas_flow_mmscfd),
            viscosity_cp: toNum(item.viscosity_cp),
            molecular_weight: toNum(item.molecular_weight),
            density_kg_m3: toNum(item.density_kg_m3),
            operating_pressure_min: toNum(item.operating_pressure_min),
            operating_pressure_max: toNum(item.operating_pressure_max),
            operating_temperature_min: toNum(item.operating_temperature_min),
            operating_temperature_max: toNum(item.operating_temperature_max),
            design_pressure_min: toNum(item.design_pressure_min),
            design_pressure_max: toNum(item.design_pressure_max),
            design_temperature_min: toNum(item.design_temperature_min),
            design_temperature_max: toNum(item.design_temperature_max),
            design_pressure: toNum(item.design_pressure_max || item.design_pressure),
            design_temperature: toNum(item.design_temperature_max || item.design_temperature),
            operating_pressure: toNum(item.operating_pressure_max || item.operating_pressure),
            operating_temperature: toNum(item.operating_temperature_max || item.operating_temperature),
            test_pressure: toNum(item.test_pressure),
            test_medium: item.test_medium || null,
            design_code: item.design_code || null,
            schedule_wall_thickness: item.schedule_wall_thickness || null,
            stress_relief: item.stress_relief || null,
            nace_mr0175: item.nace_mr0175 || null,
            ndt_rt_pct: toNum(item.ndt_rt_pct),
            ndt_dpi_pct: toNum(item.ndt_dpi_pct),
            ndt_mpi_pct: toNum(item.ndt_mpi_pct),
            pwht: item.pwht || null,
            pnid_references: item.pnid_references || null,
            remarks: item.remarks || null,
          },
        });
        await prisma.change_log.create({
          data: {
            entity_type: 'line',
            entity_id: created.id,
            action: 'create',
            changes: item,
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        addedCount++;
      } catch (err) {
        errors.push({ lineNumber: item.lineNumber || item.line_number, error: err.message });
      }
    }

    // Process modifications
    for (const item of modified) {
      if (!item.id || !item.changes) {
        errors.push({ id: item.id, error: 'Missing id or changes' });
        continue;
      }
      try {
        const existing = await prisma.line.findUnique({ where: { id: item.id } });
        if (!existing) {
          errors.push({ id: item.id, error: 'Line not found' });
          continue;
        }

        // Build update data from changes
        const updateData = {};
        const oldValues = {};
        for (const [field, diff] of Object.entries(item.changes)) {
          updateData[field] = diff.new !== undefined ? diff.new : diff;
          oldValues[field] = diff.old !== undefined ? diff.old : existing[field];
        }
        updateData.updated_at = new Date();

        await prisma.line.update({ where: { id: item.id }, data: updateData });
        await prisma.change_log.create({
          data: {
            entity_type: 'line',
            entity_id: item.id,
            action: 'update',
            changes: { old: oldValues, new: updateData },
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        modifiedCount++;
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

    // Process removals
    for (const id of removed) {
      try {
        const entityId = typeof id === 'string' ? id : id.id || id;
        if (removeAction === 'soft_delete') {
          await prisma.line.update({
            where: { id: entityId },
            data: { deleted_at: new Date() },
          });
        } else {
          await prisma.line.delete({ where: { id: entityId } });
        }
        await prisma.change_log.create({
          data: {
            entity_type: 'line',
            entity_id: entityId,
            action: removeAction === 'soft_delete' ? 'soft_delete' : 'delete',
            changes: null,
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        removedCount++;
      } catch (err) {
        errors.push({ id: typeof id === 'string' ? id : id.id, error: err.message });
      }
    }

    return {
      batchId,
      applied: { added: addedCount, modified: modifiedCount, removed: removedCount },
      errors,
    };
  });

  // ─── IMPORT EQUIPMENT PREVIEW (diff without applying) ──────────────

  fastify.post('/admin/import/equipment/preview', async (request, reply) => {
    const { csv, platform_id: bodyPlatformId } = request.body || {};
    const platform_id = request.query.platform_id || bodyPlatformId;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const csvText = csv || (typeof request.body === 'string' ? request.body : '');
    const { headers, rows } = parseCSV(csvText);

    if (!headers.includes('system_code') || !headers.includes('tag')) {
      return reply.status(400).send({ error: 'CSV must include system_code and tag columns' });
    }

    const systemMap = await buildSystemMap(platform_id);

    // Fetch all existing equipment for this platform
    const existingEquipment = await prisma.equipment.findMany({
      where: { deleted_at: null, system: { platform_id, deleted_at: null } },
      include: {
        system: { select: { code: true } },
        line: { select: { line_number: true } },
        _count: {
          select: {
            pnid_equipment: true,
          },
        },
      },
    });

    // Map existing equipment by system_code + tag
    const existingMap = {};
    for (const eq of existingEquipment) {
      const key = `${eq.system.code}:${eq.tag}`;
      existingMap[key] = eq;
    }

    const added = [];
    const modified = [];
    const unchanged = [];
    const warnings = [];
    const csvKeys = new Set();

    const equipFields = [
      'equipment_type', 'description', 'criticality', 'sil_level',
      'inspection_group', 'corrosion_loop', 'manufacturer',
      'model_number', 'serial_number', 'weight_kg', 'line_number',
    ];

    for (let i = 0; i < rows.length; i++) {
      const obj = rowToObj(headers, rows[i]);

      if (!obj.system_code || !obj.tag) continue;
      if (!systemMap[obj.system_code]) continue;

      const key = `${obj.system_code}:${obj.tag}`;
      csvKeys.add(key);

      const existing = existingMap[key];
      if (!existing) {
        added.push({ tag: obj.tag, systemCode: obj.system_code, ...obj });
      } else {
        const changes = {};
        for (const field of equipFields) {
          let oldVal, newVal;
          if (field === 'line_number') {
            oldVal = existing.line ? existing.line.line_number : null;
            newVal = obj.line_number || null;
          } else if (field === 'weight_kg') {
            oldVal = existing.weight_kg !== null ? String(existing.weight_kg) : null;
            newVal = obj.weight_kg !== null && obj.weight_kg !== undefined ? String(obj.weight_kg) : null;
          } else {
            oldVal = existing[field] !== null && existing[field] !== undefined ? String(existing[field]) : null;
            newVal = obj[field] !== null && obj[field] !== undefined ? String(obj[field]) : null;
          }
          if (oldVal !== newVal) {
            changes[field] = { old: existing[field], new: obj[field] };
            if (field === 'line_number') {
              changes[field] = { old: existing.line ? existing.line.line_number : null, new: obj.line_number };
            }
          }
        }

        if (Object.keys(changes).length > 0) {
          modified.push({
            id: existing.id,
            tag: existing.tag,
            systemCode: obj.system_code,
            changes,
          });
        } else {
          unchanged.push({ tag: existing.tag, systemCode: obj.system_code });
        }
      }
    }

    // Determine removed: equipment in DB but not in CSV
    const removed = [];
    for (const eq of existingEquipment) {
      const key = `${eq.system.code}:${eq.tag}`;
      if (!csvKeys.has(key)) {
        const annotationCount = eq._count.pnid_equipment;
        const hasAnnotations = annotationCount > 0;

        if (hasAnnotations) {
          warnings.push(`Equipment ${eq.tag} has ${annotationCount} P&ID annotation(s) that will be orphaned if removed`);
        }

        removed.push({
          id: eq.id,
          tag: eq.tag,
          systemCode: eq.system.code,
          hasAnnotations,
          annotationCount,
          pnidCount: annotationCount,
        });
      }
    }

    return { added, modified, removed, unchanged, warnings };
  });

  // ─── IMPORT EQUIPMENT APPLY (apply approved changes) ───────────────

  fastify.post('/admin/import/equipment/apply', async (request, reply) => {
    const platform_id = request.query.platform_id || request.body?.platform_id;
    if (!platform_id) return reply.status(400).send({ error: 'platform_id is required' });

    const { added = [], modified = [], removed = [], removeAction = 'soft_delete' } = request.body || {};
    const batchId = crypto.randomUUID();
    const errors = [];
    let addedCount = 0;
    let modifiedCount = 0;
    let removedCount = 0;

    const systemMap = await buildSystemMap(platform_id);
    const lineMap = await buildLineMap(platform_id);

    // Process additions
    for (const item of added) {
      const systemId = systemMap[item.systemCode || item.system_code];
      if (!systemId) {
        errors.push({ tag: item.tag, error: `Unknown system_code: ${item.systemCode || item.system_code}` });
        continue;
      }

      let lineId = null;
      const lineNumber = item.line_number || item.lineNumber;
      if (lineNumber) {
        lineId = lineMap[`${systemId}:${lineNumber}`] || null;
      }

      try {
        const created = await prisma.equipment.create({
          data: {
            system_id: systemId,
            tag: item.tag,
            equipment_type: item.equipment_type || item.equipmentType || null,
            description: item.description || null,
            criticality: item.criticality || null,
            sil_level: item.sil_level || item.silLevel || null,
            inspection_group: item.inspection_group || item.inspectionGroup || null,
            corrosion_loop: item.corrosion_loop || item.corrosionLoop || null,
            manufacturer: item.manufacturer || null,
            model_number: item.model_number || item.modelNumber || null,
            serial_number: item.serial_number || item.serialNumber || null,
            weight_kg: toNumber(item.weight_kg || item.weightKg),
            line_id: lineId,
          },
        });
        await prisma.change_log.create({
          data: {
            entity_type: 'equipment',
            entity_id: created.id,
            action: 'create',
            changes: item,
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        addedCount++;
      } catch (err) {
        errors.push({ tag: item.tag, error: err.message });
      }
    }

    // Process modifications
    for (const item of modified) {
      if (!item.id || !item.changes) {
        errors.push({ id: item.id, error: 'Missing id or changes' });
        continue;
      }
      try {
        const existing = await prisma.equipment.findUnique({ where: { id: item.id } });
        if (!existing) {
          errors.push({ id: item.id, error: 'Equipment not found' });
          continue;
        }

        const updateData = {};
        const oldValues = {};
        for (const [field, diff] of Object.entries(item.changes)) {
          if (field === 'line_number') {
            // Resolve line_number to line_id
            const newLineNumber = diff.new !== undefined ? diff.new : diff;
            if (newLineNumber) {
              const lineId = lineMap[`${existing.system_id}:${newLineNumber}`] || null;
              updateData.line_id = lineId;
            } else {
              updateData.line_id = null;
            }
            oldValues[field] = diff.old !== undefined ? diff.old : null;
          } else if (field === 'weight_kg') {
            updateData[field] = toNumber(diff.new !== undefined ? diff.new : diff);
            oldValues[field] = diff.old !== undefined ? diff.old : existing[field];
          } else {
            updateData[field] = diff.new !== undefined ? diff.new : diff;
            oldValues[field] = diff.old !== undefined ? diff.old : existing[field];
          }
        }
        updateData.updated_at = new Date();

        await prisma.equipment.update({ where: { id: item.id }, data: updateData });
        await prisma.change_log.create({
          data: {
            entity_type: 'equipment',
            entity_id: item.id,
            action: 'update',
            changes: { old: oldValues, new: updateData },
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        modifiedCount++;
      } catch (err) {
        errors.push({ id: item.id, error: err.message });
      }
    }

    // Process removals
    for (const id of removed) {
      try {
        const entityId = typeof id === 'string' ? id : id.id || id;
        if (removeAction === 'soft_delete') {
          await prisma.equipment.update({
            where: { id: entityId },
            data: { deleted_at: new Date() },
          });
        } else {
          await prisma.equipment.delete({ where: { id: entityId } });
        }
        await prisma.change_log.create({
          data: {
            entity_type: 'equipment',
            entity_id: entityId,
            action: removeAction === 'soft_delete' ? 'soft_delete' : 'delete',
            changes: null,
            source: 'csv_import',
            batch_id: batchId,
          },
        });
        removedCount++;
      } catch (err) {
        errors.push({ id: typeof id === 'string' ? id : id.id, error: err.message });
      }
    }

    return {
      batchId,
      applied: { added: addedCount, modified: modifiedCount, removed: removedCount },
      errors,
    };
  });

  // ─── IMPACT ANALYSIS ───────────────────────────────────────────────

  fastify.get('/admin/impact/:entityType/:id', async (request, reply) => {
    const { entityType, id } = request.params;

    if (!['line', 'equipment', 'instrument'].includes(entityType)) {
      return reply.status(400).send({ error: 'entityType must be one of: line, equipment, instrument' });
    }

    try {
      if (entityType === 'line') {
        const line = await prisma.line.findUnique({
          where: { id },
          include: {
            system: { select: { code: true, name: true } },
            _count: {
              select: {
                pnid_line: true,
                equipment: { where: { deleted_at: null } },
                instrument: { where: { deleted_at: null } },
              },
            },
          },
        });

        if (!line) return reply.status(404).send({ error: 'Line not found' });

        // Get P&ID details
        const pnidAppearances = await prisma.pnid_line.findMany({
          where: { line_id: id },
          include: { pnid: { select: { id: true, drawing_number: true, title: true } } },
        });

        return {
          entityType: 'line',
          id: line.id,
          identifier: line.line_number,
          system: line.system,
          downstream: {
            pnidAppearances: pnidAppearances.length,
            pnids: pnidAppearances.map(pa => ({
              id: pa.pnid.id,
              drawingNumber: pa.pnid.drawing_number,
              title: pa.pnid.title,
              isContinuation: pa.is_continuation,
            })),
            equipmentCount: line._count.equipment,
            instrumentCount: line._count.instrument,
          },
        };
      }

      if (entityType === 'equipment') {
        const equipment = await prisma.equipment.findUnique({
          where: { id },
          include: {
            system: { select: { code: true, name: true } },
            line: { select: { id: true, line_number: true } },
            _count: {
              select: {
                pnid_equipment: true,
              },
            },
          },
        });

        if (!equipment) return reply.status(404).send({ error: 'Equipment not found' });

        const pnidAppearances = await prisma.pnid_equipment.findMany({
          where: { equipment_id: id },
          include: { pnid: { select: { id: true, drawing_number: true, title: true } } },
        });

        return {
          entityType: 'equipment',
          id: equipment.id,
          identifier: equipment.tag,
          system: equipment.system,
          line: equipment.line,
          downstream: {
            pnidAppearances: pnidAppearances.length,
            pnids: pnidAppearances.map(pa => ({
              id: pa.pnid.id,
              drawingNumber: pa.pnid.drawing_number,
              title: pa.pnid.title,
            })),
            annotationCount: equipment._count.pnid_equipment,
          },
        };
      }

      if (entityType === 'instrument') {
        const instrument = await prisma.instrument.findUnique({
          where: { id },
          include: {
            system: { select: { code: true, name: true } },
            line: { select: { id: true, line_number: true } },
            _count: {
              select: {
                pnid_instrument: true,
              },
            },
          },
        });

        if (!instrument) return reply.status(404).send({ error: 'Instrument not found' });

        const pnidAppearances = await prisma.pnid_instrument.findMany({
          where: { instrument_id: id },
          include: { pnid: { select: { id: true, drawing_number: true, title: true } } },
        });

        return {
          entityType: 'instrument',
          id: instrument.id,
          identifier: instrument.tag,
          system: instrument.system,
          line: instrument.line,
          downstream: {
            pnidAppearances: pnidAppearances.length,
            pnids: pnidAppearances.map(pa => ({
              id: pa.pnid.id,
              drawingNumber: pa.pnid.drawing_number,
              title: pa.pnid.title,
            })),
            annotationCount: instrument._count.pnid_instrument,
          },
        };
      }
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
