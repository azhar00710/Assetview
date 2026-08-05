import prisma from '../../db.js';

export default async function adminAuditLogRoutes(fastify) {
  // ─── QUERY AUDIT LOG ──────────────────────────────────────────────

  fastify.get('/admin/audit-log', async (request, reply) => {
    const {
      entity_type,
      entity_id,
      action,
      source,
      from,
      to,
      page = '1',
      limit = '50',
    } = request.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (entity_id) where.entity_id = entity_id;
    if (action) where.action = action;
    if (source) where.source = source;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = new Date(from);
      if (to) where.created_at.lte = new Date(to);
    }

    const [entries, total] = await Promise.all([
      prisma.change_log.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.change_log.count({ where }),
    ]);

    return {
      entries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  });

  // ─── EXPORT AUDIT LOG AS CSV ──────────────────────────────────────

  fastify.get('/admin/audit-log/export', async (request, reply) => {
    const { entity_type, from, to } = request.query;

    const where = {};
    if (entity_type) where.entity_type = entity_type;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = new Date(from);
      if (to) where.created_at.lte = new Date(to);
    }

    const entries = await prisma.change_log.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    // Build CSV
    const header = 'id,entity_type,entity_id,action,changes,source,batch_id,created_at,created_by';
    const rows = entries.map(e => {
      const changes = e.changes ? JSON.stringify(e.changes).replace(/"/g, '""') : '';
      return [
        e.id,
        e.entity_type,
        e.entity_id,
        e.action,
        `"${changes}"`,
        e.source || '',
        e.batch_id || '',
        e.created_at ? e.created_at.toISOString() : '',
        e.created_by || '',
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', 'attachment; filename="audit-log.csv"')
      .send(csv);
  });
}
