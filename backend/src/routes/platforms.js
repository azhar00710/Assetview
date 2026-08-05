import prisma from '../db.js';
import { resolveUserScope, platformScopeWhere, canAccessPlatform } from '../auth/scope.js';

async function scopeForRequest(request) {
  if (request.scope) return request.scope;
  if (!request.user) {
    return { accessAll: true, projectIds: [], locationIds: [], platformIds: null };
  }
  return resolveUserScope(request.user.id, {
    roles: request.roles || [],
    permissions: request.permissions || [],
  });
}

export default async function platformsRoutes(fastify) {
  // GET /platforms — list platforms (filtered by user project/location scope)
  fastify.get('/platforms', async (request, reply) => {
    const scope = await scopeForRequest(request);
    const scopeWhere = platformScopeWhere(scope);

    const platforms = await prisma.platform.findMany({
      where: {
        deleted_at: null,
        ...(scopeWhere || {}),
      },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { name: 'asc' },
    });
    return { platforms };
  });

  // GET /platforms/:platformId — platform detail with counts
  fastify.get('/platforms/:platformId', async (request, reply) => {
    const { platformId } = request.params;
    const scope = await scopeForRequest(request);
    if (!canAccessPlatform(scope, platformId)) {
      return reply.code(403).send({ error: 'No access to this platform' });
    }

    const p = await prisma.platform.findUnique({
      where: { id: platformId },
      include: {
        _count: {
          select: {
            system: { where: { deleted_at: null } },
          },
        },
      },
    });
    if (!p) return reply.code(404).send({ error: 'Platform not found' });

    const [pnidCount, equipmentCount, instrumentCount] = await Promise.all([
      prisma.pnid.count({
        where: {
          deleted_at: null,
          pnid_system: { some: { system: { platform_id: platformId, deleted_at: null } } },
        },
      }),
      prisma.equipment.count({
        where: { deleted_at: null, system: { platform_id: platformId, deleted_at: null } },
      }),
      prisma.instrument.count({
        where: { deleted_at: null, system: { platform_id: platformId, deleted_at: null } },
      }),
    ]);

    return {
      platform: {
        id: p.id, name: p.name, code: p.code, status: p.status,
        systemCount: p._count.system,
        pnidCount,
        equipmentCount,
        instrumentCount,
      },
    };
  });
}
