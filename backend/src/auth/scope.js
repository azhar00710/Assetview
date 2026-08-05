import prisma from '../db.js';
import { ADMIN_ROLE_NAME, hasPermission } from './permissions.js';

/**
 * Resolve a user's project/location scope.
 * - Admin / admin.access → unrestricted
 * - No project or location assignments → unrestricted (all access)
 * - Otherwise → restricted to platforms under assigned projects ∪ locations
 */
export async function resolveUserScope(userId, { roles = [], permissions = [] } = {}) {
  const isAdmin =
    roles.some((r) => r.name === ADMIN_ROLE_NAME) ||
    hasPermission(permissions, 'admin.access');

  if (isAdmin) {
    return {
      accessAll: true,
      projectIds: [],
      locationIds: [],
      platformIds: null,
    };
  }

  let projectIds = [];
  let locationIds = [];

  try {
    const [projectRows, locationRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT project_id::text AS project_id
        FROM app_user_project
        WHERE user_id = ${userId}::uuid
      `,
      prisma.$queryRaw`
        SELECT location_id::text AS location_id
        FROM app_user_location
        WHERE user_id = ${userId}::uuid
      `,
    ]);
    projectIds = (projectRows || []).map((r) => r.project_id);
    locationIds = (locationRows || []).map((r) => r.location_id);
  } catch {
    // Tables may not exist yet before migration — treat as unrestricted
    return {
      accessAll: true,
      projectIds: [],
      locationIds: [],
      platformIds: null,
    };
  }

  if (!projectIds.length && !locationIds.length) {
    return {
      accessAll: true,
      projectIds: [],
      locationIds: [],
      platformIds: null,
    };
  }

  const orClauses = [];
  if (projectIds.length) {
    orClauses.push({
      complex: {
        location: {
          concession: { project_id: { in: projectIds } },
        },
      },
    });
  }
  if (locationIds.length) {
    orClauses.push({
      complex: { location_id: { in: locationIds } },
    });
  }

  const platforms = await prisma.platform.findMany({
    where: {
      deleted_at: null,
      OR: orClauses,
    },
    select: { id: true },
  });

  return {
    accessAll: false,
    projectIds,
    locationIds,
    platformIds: platforms.map((p) => p.id),
  };
}

/** Prisma where fragment for platform queries, or null if unrestricted. */
export function platformScopeWhere(scope) {
  if (!scope || scope.accessAll) return null;
  if (!scope.platformIds?.length) {
    return { id: { in: [] } };
  }
  return { id: { in: scope.platformIds } };
}

export function canAccessPlatform(scope, platformId) {
  if (!scope || scope.accessAll) return true;
  if (!platformId) return false;
  return (scope.platformIds || []).includes(platformId);
}
