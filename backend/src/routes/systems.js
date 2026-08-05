import prisma from '../db.js';

export default async function systemsRoutes(fastify) {
  // GET /platforms/:platformId/systems — Miller Column 1
  fastify.get('/platforms/:platformId/systems', async (request, reply) => {
    const { platformId } = request.params;
    const { search, sys_type } = request.query;

    const where = {
      platform_id: platformId,
      deleted_at: null,
    };
    if (sys_type) where.sys_type = sys_type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const systems = await prisma.system.findMany({
      where,
      include: {
        _count: {
          select: {
            line: { where: { deleted_at: null } },
            equipment: { where: { deleted_at: null } },
            instrument: { where: { deleted_at: null } },
          },
        },
        pnid_system: {
          where: { is_primary: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      systems: systems.map(s => ({
        id: s.id,
        name: s.name,
        code: s.code,
        sysType: s.sys_type,
        primaryPnidCount: s.pnid_system.length,
        lineCount: s._count.line,
        equipmentCount: s._count.equipment,
        instrumentCount: s._count.instrument,
      })),
    };
  });
}
