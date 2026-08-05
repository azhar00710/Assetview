import prisma from '../../db.js';

export default async function hierarchyRoutes(fastify) {
  // ─── FULL HIERARCHY TREE ────────────────────────────────────────────

  fastify.get('/admin/hierarchy', async (request, reply) => {
    const clients = await prisma.client.findMany({
      where: { deleted_at: null },
      include: {
        project: {
          where: { deleted_at: null },
          include: {
            concession: {
              where: { deleted_at: null },
              include: {
                location: {
                  where: { deleted_at: null },
                  include: {
                    complex: {
                      where: { deleted_at: null },
                      include: {
                        platform: {
                          where: { deleted_at: null },
                          orderBy: { name: 'asc' },
                        },
                      },
                      orderBy: { name: 'asc' },
                    },
                  },
                  orderBy: { name: 'asc' },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      hierarchy: clients.map(cl => ({
        id: cl.id,
        name: cl.name,
        code: cl.code,
        projects: cl.project.map(pr => ({
          id: pr.id,
          name: pr.name,
          code: pr.code,
          concessions: pr.concession.map(c => ({
            id: c.id,
            name: c.name,
            code: c.code,
            operator: c.operator,
            region: c.region,
            locations: c.location.map(loc => ({
              id: loc.id,
              name: loc.name,
              code: loc.code,
              location_type: loc.location_type,
              complexes: loc.complex.map(cx => ({
                id: cx.id,
                name: cx.name,
                code: cx.code,
                platforms: cx.platform.map(p => ({
                  id: p.id,
                  name: p.name,
                  code: p.code,
                  platform_type: p.platform_type,
                  status: p.status,
                  latitude: p.latitude,
                  longitude: p.longitude,
                })),
              })),
            })),
          })),
        })),
      })),
    };
  });

  // ─── CLIENTS ───────────────────────────────────────────────────────

  fastify.get('/admin/clients', async (request, reply) => {
    const clients = await prisma.client.findMany({
      where: { deleted_at: null },
      orderBy: { name: 'asc' },
    });
    return { clients };
  });

  fastify.post('/admin/clients', async (request, reply) => {
    const { name, code, description, contact_name, contact_email, metadata } = request.body;

    const client = await prisma.client.create({
      data: {
        name,
        code,
        description: description || null,
        contact_name: contact_name || null,
        contact_email: contact_email || null,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { client };
  });

  fastify.put('/admin/clients/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.client.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Client not found' };
    }

    const { name, code, description, contact_name, contact_email, metadata } = request.body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(description !== undefined && { description }),
        ...(contact_name !== undefined && { contact_name }),
        ...(contact_email !== undefined && { contact_email }),
        ...(metadata !== undefined && { metadata }),
        updated_at: new Date(),
      },
    });

    return { client };
  });

  fastify.delete('/admin/clients/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.client.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Client not found' };
    }

    const client = await prisma.client.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { client };
  });

  // ─── PROJECTS ──────────────────────────────────────────────────────

  fastify.get('/admin/projects', async (request, reply) => {
    const { client_id } = request.query;

    const where = { deleted_at: null };
    if (client_id) where.client_id = client_id;

    const projects = await prisma.project.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { projects };
  });

  fastify.post('/admin/projects', async (request, reply) => {
    const { client_id, name, code, project_type, description, metadata } = request.body;

    // Verify parent exists
    const parent = await prisma.client.findFirst({
      where: { id: client_id, deleted_at: null },
    });
    if (!parent) {
      reply.code(404);
      return { error: 'Client not found' };
    }

    const project = await prisma.project.create({
      data: {
        client_id,
        name,
        code,
        project_type: project_type || null,
        description: description || null,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { project };
  });

  fastify.put('/admin/projects/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.project.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    const { client_id, name, code, project_type, description, metadata } = request.body;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(client_id !== undefined && { client_id }),
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(project_type !== undefined && { project_type }),
        ...(description !== undefined && { description }),
        ...(metadata !== undefined && { metadata }),
        updated_at: new Date(),
      },
    });

    return { project };
  });

  fastify.delete('/admin/projects/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.project.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    const project = await prisma.project.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { project };
  });

  // ─── CONCESSIONS ───────────────────────────────────────────────────

  fastify.get('/admin/concessions', async (request, reply) => {
    const { project_id } = request.query;

    const where = { deleted_at: null };
    if (project_id) where.project_id = project_id;

    const concessions = await prisma.concession.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { concessions };
  });

  fastify.post('/admin/concessions', async (request, reply) => {
    const { project_id, name, code, operator, region, metadata } = request.body;

    // Verify parent exists
    const parent = await prisma.project.findFirst({
      where: { id: project_id, deleted_at: null },
    });
    if (!parent) {
      reply.code(404);
      return { error: 'Project not found' };
    }

    const concession = await prisma.concession.create({
      data: {
        project_id,
        name,
        code,
        operator: operator || null,
        region: region || null,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { concession };
  });

  fastify.put('/admin/concessions/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.concession.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Concession not found' };
    }

    const { project_id, name, code, operator, region, metadata } = request.body;

    const concession = await prisma.concession.update({
      where: { id },
      data: {
        ...(project_id !== undefined && { project_id }),
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(operator !== undefined && { operator }),
        ...(region !== undefined && { region }),
        ...(metadata !== undefined && { metadata }),
        updated_at: new Date(),
      },
    });

    return { concession };
  });

  fastify.delete('/admin/concessions/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.concession.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Concession not found' };
    }

    const concession = await prisma.concession.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { concession };
  });

  // ─── LOCATIONS ─────────────────────────────────────────────────────

  fastify.get('/admin/locations', async (request, reply) => {
    const { concession_id } = request.query;

    const where = { deleted_at: null };
    if (concession_id) where.concession_id = concession_id;

    const locations = await prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { locations };
  });

  fastify.post('/admin/locations', async (request, reply) => {
    const { concession_id, name, code, location_type, metadata } = request.body;

    // Verify parent exists
    const parent = await prisma.concession.findFirst({
      where: { id: concession_id, deleted_at: null },
    });
    if (!parent) {
      reply.code(404);
      return { error: 'Concession not found' };
    }

    const location = await prisma.location.create({
      data: {
        concession_id,
        name,
        code,
        location_type: location_type || null,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { location };
  });

  fastify.put('/admin/locations/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.location.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Location not found' };
    }

    const { concession_id, name, code, location_type, metadata } = request.body;

    const location = await prisma.location.update({
      where: { id },
      data: {
        ...(concession_id !== undefined && { concession_id }),
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(location_type !== undefined && { location_type }),
        ...(metadata !== undefined && { metadata }),
        updated_at: new Date(),
      },
    });

    return { location };
  });

  fastify.delete('/admin/locations/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.location.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Location not found' };
    }

    const location = await prisma.location.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { location };
  });

  // ─── COMPLEXES ──────────────────────────────────────────────────────

  fastify.get('/admin/complexes', async (request, reply) => {
    const { location_id, field_id } = request.query;

    const where = { deleted_at: null };
    if (location_id) where.location_id = location_id;
    if (field_id) where.field_id = field_id;

    const complexes = await prisma.complex.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { complexes };
  });

  fastify.post('/admin/complexes', async (request, reply) => {
    const { location_id, name, code, metadata } = request.body;

    // Verify parent (location) exists
    const parent = await prisma.location.findFirst({
      where: { id: location_id, deleted_at: null },
    });
    if (!parent) {
      reply.code(404);
      return { error: 'Location not found' };
    }

    const complex = await prisma.complex.create({
      data: {
        location_id,
        name,
        code,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { complex };
  });

  fastify.put('/admin/complexes/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.complex.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Complex not found' };
    }

    const { location_id, field_id, name, code, metadata } = request.body;

    const data = {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code }),
      ...(metadata !== undefined && { metadata }),
      updated_at: new Date(),
    };

    // If location_id is provided, update it
    if (location_id !== undefined) {
      data.location_id = location_id;
    }
    // Allow direct field_id update for backward compat (must be a valid field UUID)
    if (field_id !== undefined) {
      data.field_id = field_id;
    }

    const complex = await prisma.complex.update({
      where: { id },
      data,
    });

    return { complex };
  });

  fastify.delete('/admin/complexes/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.complex.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Complex not found' };
    }

    const complex = await prisma.complex.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { complex };
  });

  // ─── PLATFORMS ──────────────────────────────────────────────────────

  fastify.get('/admin/platforms', async (request, reply) => {
    const { complex_id } = request.query;

    const where = { deleted_at: null };
    if (complex_id) where.complex_id = complex_id;

    const platforms = await prisma.platform.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return { platforms };
  });

  fastify.post('/admin/platforms', async (request, reply) => {
    const { complex_id, name, code, platform_type, status, latitude, longitude, metadata } = request.body;

    // Verify parent exists
    const parent = await prisma.complex.findFirst({
      where: { id: complex_id, deleted_at: null },
    });
    if (!parent) {
      reply.code(404);
      return { error: 'Complex not found' };
    }

    const platform = await prisma.platform.create({
      data: {
        complex_id,
        name,
        code,
        platform_type: platform_type || null,
        status: status || 'planned',
        latitude: latitude !== undefined ? latitude : null,
        longitude: longitude !== undefined ? longitude : null,
        metadata: metadata || undefined,
      },
    });

    reply.code(201);
    return { platform };
  });

  fastify.put('/admin/platforms/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.platform.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Platform not found' };
    }

    const { complex_id, name, code, platform_type, status, latitude, longitude, metadata } = request.body;

    const platform = await prisma.platform.update({
      where: { id },
      data: {
        ...(complex_id !== undefined && { complex_id }),
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(platform_type !== undefined && { platform_type }),
        ...(status !== undefined && { status }),
        ...(latitude !== undefined && { latitude }),
        ...(longitude !== undefined && { longitude }),
        ...(metadata !== undefined && { metadata }),
        updated_at: new Date(),
      },
    });

    return { platform };
  });

  fastify.delete('/admin/platforms/:id', async (request, reply) => {
    const { id } = request.params;

    const existing = await prisma.platform.findFirst({
      where: { id, deleted_at: null },
    });
    if (!existing) {
      reply.code(404);
      return { error: 'Platform not found' };
    }

    const platform = await prisma.platform.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

    return { platform };
  });

  // ─── PLATFORM TEMPLATES ────────────────────────────────────────────

  const TEMPLATES = {
    wellhead: [
      { code: 'PV', name: 'Process', sys_type: 'process' },
      { code: 'CD', name: 'Closed Drain', sys_type: 'utility' },
      { code: 'GL', name: 'Gas Lift', sys_type: 'utility' },
      { code: 'ESD', name: 'Emergency Shutdown', sys_type: 'safety' },
      { code: 'FG', name: 'Fire & Gas', sys_type: 'safety' },
      { code: 'IA', name: 'Instrument Air', sys_type: 'utility' },
    ],
    processing: [
      { code: 'PV', name: 'Process', sys_type: 'process' },
      { code: 'PM', name: 'Production Manifold', sys_type: 'process' },
      { code: 'SC', name: 'Sample Connection', sys_type: 'utility' },
      { code: 'CI', name: 'Chemical Injection', sys_type: 'utility' },
      { code: 'CD', name: 'Closed Drain', sys_type: 'utility' },
      { code: 'ESD', name: 'Emergency Shutdown', sys_type: 'safety' },
      { code: 'FG', name: 'Fire & Gas', sys_type: 'safety' },
      { code: 'IA', name: 'Instrument Air', sys_type: 'utility' },
    ],
    utility: [
      { code: 'PG', name: 'Power Generation', sys_type: 'utility' },
      { code: 'SW', name: 'Seawater', sys_type: 'utility' },
      { code: 'FW', name: 'Freshwater', sys_type: 'utility' },
      { code: 'IA', name: 'Instrument Air', sys_type: 'utility' },
      { code: 'HVAC', name: 'HVAC', sys_type: 'utility' },
    ],
  };

  fastify.get('/admin/platform-templates', async (request, reply) => {
    const templates = Object.entries(TEMPLATES).map(([key, systems]) => {
      const descriptions = {
        wellhead: 'Standard wellhead with process, drain, gas lift, ESD, F&G, IA',
        processing: 'Full processing with manifold, sample, chemical injection',
        utility: 'Utility-focused with power, water, air systems',
      };
      const names = {
        wellhead: 'Wellhead Platform',
        processing: 'Processing Platform',
        utility: 'Utility Platform',
      };
      return {
        key,
        name: names[key],
        description: descriptions[key],
        systemCount: systems.length,
      };
    });

    return { templates };
  });

  // ─── APPLY TEMPLATE TO PLATFORM ───────────────────────────────────

  fastify.post('/admin/platforms/:id/apply-template', async (request, reply) => {
    const { id } = request.params;
    const { templateKey } = request.body;

    const template = TEMPLATES[templateKey];
    if (!template) {
      reply.code(400);
      return { error: `Unknown template: ${templateKey}` };
    }

    const platform = await prisma.platform.findFirst({
      where: { id, deleted_at: null },
    });
    if (!platform) {
      reply.code(404);
      return { error: 'Platform not found' };
    }

    // Get existing system codes on this platform
    const existingSystems = await prisma.system.findMany({
      where: { platform_id: id, deleted_at: null },
      select: { code: true },
    });
    const existingCodes = new Set(existingSystems.map(s => s.code));

    // Only create systems that don't already exist
    const toCreate = template.filter(s => !existingCodes.has(s.code));

    if (toCreate.length > 0) {
      await prisma.system.createMany({
        data: toCreate.map(s => ({
          platform_id: id,
          name: s.name,
          code: s.code,
          sys_type: s.sys_type,
        })),
      });
    }

    return { createdCount: toCreate.length };
  });

  // ─── CLONE PLATFORM ───────────────────────────────────────────────

  fastify.post('/admin/platforms/:id/clone', async (request, reply) => {
    const { id } = request.params;
    const { newCode, newName, complexId } = request.body;

    const source = await prisma.platform.findFirst({
      where: { id, deleted_at: null },
      include: {
        system: {
          where: { deleted_at: null },
        },
      },
    });
    if (!source) {
      reply.code(404);
      return { error: 'Source platform not found' };
    }

    const targetComplexId = complexId || source.complex_id;

    // Verify target complex exists
    const complex = await prisma.complex.findFirst({
      where: { id: targetComplexId, deleted_at: null },
    });
    if (!complex) {
      reply.code(404);
      return { error: 'Target complex not found' };
    }

    // Create new platform
    const newPlatform = await prisma.platform.create({
      data: {
        complex_id: targetComplexId,
        name: newName,
        code: newCode,
        platform_type: source.platform_type,
        status: source.status,
      },
    });

    // Copy all systems from source
    if (source.system.length > 0) {
      await prisma.system.createMany({
        data: source.system.map(s => ({
          platform_id: newPlatform.id,
          name: s.name,
          code: s.code,
          sys_type: s.sys_type,
          description: s.description,
          system_number: s.system_number,
        })),
      });
    }

    // Fetch the new platform with its systems
    const result = await prisma.platform.findUnique({
      where: { id: newPlatform.id },
      include: {
        system: {
          where: { deleted_at: null },
          orderBy: { name: 'asc' },
        },
      },
    });

    reply.code(201);
    return { platform: result };
  });

  // ─── AUTO-CODE GENERATION ─────────────────────────────────────────

  fastify.get('/admin/next-code/:level', async (request, reply) => {
    const { level } = request.params;
    const { parent_id } = request.query;

    const prefixes = {
      client: 'CLT',
      project: 'PRJ',
      concession: 'CON',
      location: 'LOC',
      complex: 'CPX',
      platform: 'PLT',
      system: 'SYS',
    };

    const prefix = prefixes[level];
    if (!prefix) {
      reply.code(400);
      return { error: `Unknown level: ${level}` };
    }

    // Count existing siblings to generate the next sequential code
    let count = 0;

    if (level === 'client') {
      count = await prisma.client.count({ where: { deleted_at: null } });
    } else if (level === 'project' && parent_id) {
      count = await prisma.project.count({ where: { client_id: parent_id, deleted_at: null } });
    } else if (level === 'concession' && parent_id) {
      count = await prisma.concession.count({ where: { project_id: parent_id, deleted_at: null } });
    } else if (level === 'location' && parent_id) {
      count = await prisma.location.count({ where: { concession_id: parent_id, deleted_at: null } });
    } else if (level === 'complex' && parent_id) {
      count = await prisma.complex.count({ where: { location_id: parent_id, deleted_at: null } });
    } else if (level === 'platform' && parent_id) {
      count = await prisma.platform.count({ where: { complex_id: parent_id, deleted_at: null } });
    } else if (level === 'system' && parent_id) {
      count = await prisma.system.count({ where: { platform_id: parent_id, deleted_at: null } });
    }

    const nextNumber = String(count + 1).padStart(3, '0');
    return { code: `${prefix}-${nextNumber}` };
  });

  // ─── PLATFORM STATS (summary counts) ───────────────────────────────

  fastify.get('/admin/platforms/:id/stats', async (request, reply) => {
    const { id } = request.params;

    const platform = await prisma.platform.findFirst({
      where: { id, deleted_at: null },
    });
    if (!platform) {
      reply.code(404);
      return { error: 'Platform not found' };
    }

    const [systemCount, lineCount, equipmentCount, instrumentCount] = await Promise.all([
      prisma.system.count({ where: { platform_id: id, deleted_at: null } }),
      prisma.line.count({ where: { system: { platform_id: id, deleted_at: null }, deleted_at: null } }),
      prisma.equipment.count({ where: { system: { platform_id: id, deleted_at: null }, deleted_at: null } }),
      prisma.instrument.count({ where: { system: { platform_id: id, deleted_at: null }, deleted_at: null } }),
    ]);

    // Count P&IDs linked to systems on this platform OR unassigned
    const pnidCount = await prisma.pnid.count({
      where: {
        deleted_at: null,
        OR: [
          { pnid_system: { some: { system: { platform_id: id, deleted_at: null } } } },
          { pnid_system: { none: {} } },
        ],
      },
    });

    // Count transmittals
    const transmittalCount = await prisma.transmittal.count({
      where: { platform_id: id, deleted_at: null },
    });

    return {
      platform: { id: platform.id, code: platform.code, name: platform.name, status: platform.status },
      stats: {
        systems: systemCount,
        pnids: pnidCount,
        lines: lineCount,
        equipment: equipmentCount,
        instruments: instrumentCount,
        transmittals: transmittalCount,
      },
    };
  });

  // ─── BULK HIERARCHY IMPORT ────────────────────────────────────────

  fastify.post('/admin/import/hierarchy', async (request, reply) => {
    const { csv } = request.body;

    if (!csv || typeof csv !== 'string') {
      reply.code(400);
      return { error: 'Request body must include a "csv" string field' };
    }

    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
      reply.code(400);
      return { error: 'CSV must have a header row and at least one data row' };
    }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const expectedColumns = [
      'client_code', 'client_name',
      'project_code', 'project_name',
      'concession_code', 'concession_name',
      'location_code', 'location_name',
      'complex_code', 'complex_name',
      'platform_code', 'platform_name', 'platform_type',
    ];

    for (const col of expectedColumns) {
      if (!header.includes(col)) {
        reply.code(400);
        return { error: `Missing required CSV column: ${col}` };
      }
    }

    const counts = { clients: 0, projects: 0, concessions: 0, locations: 0, complexes: 0, platforms: 0 };

    // Caches to avoid repeated lookups
    const clientCache = new Map();
    const projectCache = new Map();
    const concessionCache = new Map();
    const locationCache = new Map();
    const complexCache = new Map();

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length < header.length) continue;

      const row = {};
      header.forEach((col, idx) => { row[col] = values[idx]; });

      // Client — find or create
      let client;
      if (clientCache.has(row.client_code)) {
        client = clientCache.get(row.client_code);
      } else {
        client = await prisma.client.findFirst({
          where: { code: row.client_code, deleted_at: null },
        });
        if (!client) {
          client = await prisma.client.create({
            data: { code: row.client_code, name: row.client_name },
          });
          counts.clients++;
        }
        clientCache.set(row.client_code, client);
      }

      // Project — find or create
      const projectKey = `${client.id}:${row.project_code}`;
      let project;
      if (projectCache.has(projectKey)) {
        project = projectCache.get(projectKey);
      } else {
        project = await prisma.project.findFirst({
          where: { client_id: client.id, code: row.project_code, deleted_at: null },
        });
        if (!project) {
          project = await prisma.project.create({
            data: { client_id: client.id, code: row.project_code, name: row.project_name },
          });
          counts.projects++;
        }
        projectCache.set(projectKey, project);
      }

      // Concession — find or create
      const concessionKey = `${project.id}:${row.concession_code}`;
      let concession;
      if (concessionCache.has(concessionKey)) {
        concession = concessionCache.get(concessionKey);
      } else {
        concession = await prisma.concession.findFirst({
          where: { project_id: project.id, code: row.concession_code, deleted_at: null },
        });
        if (!concession) {
          concession = await prisma.concession.create({
            data: { project_id: project.id, code: row.concession_code, name: row.concession_name },
          });
          counts.concessions++;
        }
        concessionCache.set(concessionKey, concession);
      }

      // Location — find or create
      const locationKey = `${concession.id}:${row.location_code}`;
      let location;
      if (locationCache.has(locationKey)) {
        location = locationCache.get(locationKey);
      } else {
        location = await prisma.location.findFirst({
          where: { concession_id: concession.id, code: row.location_code, deleted_at: null },
        });
        if (!location) {
          location = await prisma.location.create({
            data: { concession_id: concession.id, code: row.location_code, name: row.location_name },
          });
          counts.locations++;
        }
        locationCache.set(locationKey, location);
      }

      // Complex — find or create (set both field_id and location_id)
      const complexKey = `${location.id}:${row.complex_code}`;
      let complex;
      if (complexCache.has(complexKey)) {
        complex = complexCache.get(complexKey);
      } else {
        complex = await prisma.complex.findFirst({
          where: { location_id: location.id, code: row.complex_code, deleted_at: null },
        });
        if (!complex) {
          complex = await prisma.complex.create({
            data: {
              location_id: location.id,
              code: row.complex_code,
              name: row.complex_name,
            },
          });
          counts.complexes++;
        }
        complexCache.set(complexKey, complex);
      }

      // Platform — find or create
      const existingPlatform = await prisma.platform.findFirst({
        where: { complex_id: complex.id, code: row.platform_code, deleted_at: null },
      });
      if (!existingPlatform) {
        await prisma.platform.create({
          data: {
            complex_id: complex.id,
            code: row.platform_code,
            name: row.platform_name,
            platform_type: row.platform_type || null,
          },
        });
        counts.platforms++;
      }
    }

    reply.code(201);
    return { counts };
  });
}
