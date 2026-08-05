import prisma from '../../db.js';
import { hashPassword } from '../../auth/password.js';
import { requirePermission } from '../../auth/index.js';
import {
  ADMIN_ROLE_NAME,
  normalizePermissions,
  PERMISSIONS,
} from '../../auth/permissions.js';

function mapUser(user, scopeExtras = {}) {
  const roles = (user.roles || []).map((ur) => ur.role);
  const projects = scopeExtras.projects || [];
  const locations = scopeExtras.locations || [];
  const projectIds = scopeExtras.projectIds || projects.map((p) => p.id);
  const locationIds = scopeExtras.locationIds || locations.map((l) => l.id);
  const accessAll = projectIds.length === 0 && locationIds.length === 0;

  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    isActive: user.is_active,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: r.is_system,
    })),
    roleIds: roles.map((r) => r.id),
    accessAll,
    projectIds,
    locationIds,
    projects,
    locations,
  };
}

function mapRole(role) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions || [],
    isSystem: role.is_system,
    userCount: role._count?.users ?? role.userCount ?? 0,
    createdAt: role.created_at,
    updatedAt: role.updated_at,
  };
}

const userInclude = {
  roles: { include: { role: true } },
};

async function loadUserScopes(userIds) {
  if (!userIds.length) return { projectsByUser: {}, locationsByUser: {} };
  try {
    const projectRows = [];
    const locationRows = [];
    for (const userId of userIds) {
      const [prows, lrows] = await Promise.all([
        prisma.$queryRaw`
          SELECT up.user_id::text AS user_id, p.id::text AS id, p.code, p.name
          FROM app_user_project up
          JOIN project p ON p.id = up.project_id
          WHERE up.user_id = ${userId}::uuid
            AND p.deleted_at IS NULL
        `,
        prisma.$queryRaw`
          SELECT ul.user_id::text AS user_id,
                 l.id::text AS id, l.code, l.name,
                 c.project_id::text AS project_id,
                 pr.code AS project_code
          FROM app_user_location ul
          JOIN location l ON l.id = ul.location_id
          LEFT JOIN concession c ON c.id = l.concession_id
          LEFT JOIN project pr ON pr.id = c.project_id
          WHERE ul.user_id = ${userId}::uuid
            AND l.deleted_at IS NULL
        `,
      ]);
      projectRows.push(...(prows || []));
      locationRows.push(...(lrows || []));
    }

    const projectsByUser = {};
    const locationsByUser = {};
    for (const row of projectRows) {
      if (!projectsByUser[row.user_id]) projectsByUser[row.user_id] = [];
      projectsByUser[row.user_id].push({ id: row.id, code: row.code, name: row.name });
    }
    for (const row of locationRows) {
      if (!locationsByUser[row.user_id]) locationsByUser[row.user_id] = [];
      locationsByUser[row.user_id].push({
        id: row.id,
        code: row.code,
        name: row.name,
        projectId: row.project_id || null,
        projectCode: row.project_code || null,
      });
    }
    return { projectsByUser, locationsByUser };
  } catch {
    return { projectsByUser: {}, locationsByUser: {} };
  }
}

function scopesForUser(userId, projectsByUser, locationsByUser) {
  const projects = projectsByUser[userId] || [];
  const locations = locationsByUser[userId] || [];
  return {
    projects,
    locations,
    projectIds: projects.map((p) => p.id),
    locationIds: locations.map((l) => l.id),
  };
}

async function validateScopeIds(projectIds, locationIds) {
  if (projectIds?.length) {
    const found = await prisma.project.count({
      where: { id: { in: projectIds }, deleted_at: null },
    });
    if (found !== projectIds.length) {
      return 'One or more projectIds are invalid';
    }
  }
  if (locationIds?.length) {
    const found = await prisma.location.count({
      where: { id: { in: locationIds }, deleted_at: null },
    });
    if (found !== locationIds.length) {
      return 'One or more locationIds are invalid';
    }
  }
  return null;
}

async function syncUserScopes(tx, userId, projectIds, locationIds) {
  if (projectIds !== undefined) {
    await tx.$executeRaw`DELETE FROM app_user_project WHERE user_id = ${userId}::uuid`;
    for (const project_id of projectIds) {
      await tx.$executeRaw`
        INSERT INTO app_user_project (user_id, project_id)
        VALUES (${userId}::uuid, ${project_id}::uuid)
        ON CONFLICT DO NOTHING
      `;
    }
  }
  if (locationIds !== undefined) {
    await tx.$executeRaw`DELETE FROM app_user_location WHERE user_id = ${userId}::uuid`;
    for (const location_id of locationIds) {
      await tx.$executeRaw`
        INSERT INTO app_user_location (user_id, location_id)
        VALUES (${userId}::uuid, ${location_id}::uuid)
        ON CONFLICT DO NOTHING
      `;
    }
  }
}

export default async function adminUsersRoutes(fastify) {
  const guard = { preHandler: [requirePermission('users.manage')] };

  fastify.get('/admin/permissions', guard, async () => ({ permissions: PERMISSIONS }));

  // Flat lists for Access Control pickers
  fastify.get('/admin/access-scopes', guard, async () => {
    const [projects, locations] = await Promise.all([
      prisma.project.findMany({
        where: { deleted_at: null },
        select: { id: true, code: true, name: true, client_id: true },
        orderBy: { code: 'asc' },
      }),
      prisma.location.findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          code: true,
          name: true,
          concession: {
            select: {
              project_id: true,
              project: { select: { id: true, code: true, name: true } },
            },
          },
        },
        orderBy: { code: 'asc' },
      }),
    ]);

    return {
      projects,
      locations: locations.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        projectId: l.concession?.project_id || null,
        projectCode: l.concession?.project?.code || null,
        projectName: l.concession?.project?.name || null,
      })),
    };
  });

  // ─── Roles ────────────────────────────────────────────────────────
  fastify.get('/admin/roles', guard, async () => {
    const roles = await prisma.app_role.findMany({
      orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    return { roles: roles.map(mapRole) };
  });

  fastify.post('/admin/roles', guard, async (request, reply) => {
    const { name, description, permissions } = request.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Role name is required' });
    }
    const trimmed = name.trim();
    if (trimmed.toLowerCase() === ADMIN_ROLE_NAME.toLowerCase()) {
      return reply.code(400).send({ error: 'Cannot create another Admin role' });
    }

    try {
      const role = await prisma.app_role.create({
        data: {
          name: trimmed,
          description: description || null,
          permissions: normalizePermissions(permissions),
          is_system: false,
        },
        include: { _count: { select: { users: true } } },
      });
      return reply.code(201).send({ role: mapRole(role) });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'A role with that name already exists' });
      }
      throw err;
    }
  });

  fastify.put('/admin/roles/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const { name, description, permissions } = request.body || {};

    const existing = await prisma.app_role.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Role not found' });

    const data = {};
    if (description !== undefined) data.description = description;
    if (permissions !== undefined) {
      if (existing.name === ADMIN_ROLE_NAME) {
        data.permissions = normalizePermissions(PERMISSIONS.map((p) => p.key));
      } else {
        data.permissions = normalizePermissions(permissions);
      }
    }
    if (name !== undefined && !existing.is_system) {
      const trimmed = String(name).trim();
      if (!trimmed) return reply.code(400).send({ error: 'Role name is required' });
      data.name = trimmed;
    }

    try {
      const role = await prisma.app_role.update({
        where: { id },
        data,
        include: { _count: { select: { users: true } } },
      });
      return { role: mapRole(role) };
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'A role with that name already exists' });
      }
      throw err;
    }
  });

  fastify.delete('/admin/roles/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const existing = await prisma.app_role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) return reply.code(404).send({ error: 'Role not found' });
    if (existing.is_system) {
      return reply.code(400).send({ error: 'System roles cannot be deleted' });
    }
    if (existing._count.users > 0) {
      return reply.code(400).send({
        error: `Role is assigned to ${existing._count.users} user(s). Reassign them first.`,
      });
    }
    await prisma.app_role.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ─── Users ────────────────────────────────────────────────────────
  fastify.get('/admin/users', guard, async (request) => {
    const { q, active } = request.query || {};
    const where = {};
    if (active === 'true') where.is_active = true;
    if (active === 'false') where.is_active = false;
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { display_name: { contains: q, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.app_user.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: userInclude,
    });
    const { projectsByUser, locationsByUser } = await loadUserScopes(users.map((u) => u.id));
    return {
      users: users.map((u) => mapUser(u, scopesForUser(u.id, projectsByUser, locationsByUser))),
    };
  });

  fastify.post('/admin/users', guard, async (request, reply) => {
    const {
      email,
      password,
      displayName,
      roleIds,
      isActive,
      projectIds,
      locationIds,
    } = request.body || {};
    if (!email || !password || !displayName) {
      return reply.code(400).send({ error: 'email, password, and displayName are required' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'Password must be at least 6 characters' });
    }

    const roles = Array.isArray(roleIds) ? roleIds : [];
    const projects = Array.isArray(projectIds) ? projectIds : [];
    const locations = Array.isArray(locationIds) ? locationIds : [];

    if (roles.length) {
      const found = await prisma.app_role.count({ where: { id: { in: roles } } });
      if (found !== roles.length) {
        return reply.code(400).send({ error: 'One or more roleIds are invalid' });
      }
    }
    const scopeErr = await validateScopeIds(projects, locations);
    if (scopeErr) return reply.code(400).send({ error: scopeErr });

    try {
      const password_hash = await hashPassword(password);
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.app_user.create({
          data: {
            email: String(email).toLowerCase().trim(),
            display_name: String(displayName).trim(),
            password_hash,
            is_active: isActive !== false,
            roles: roles.length
              ? { create: roles.map((role_id) => ({ role_id })) }
              : undefined,
          },
        });
        await syncUserScopes(tx, created.id, projects, locations);
        return tx.app_user.findUnique({ where: { id: created.id }, include: userInclude });
      });
      const { projectsByUser, locationsByUser } = await loadUserScopes([user.id]);
      return reply.code(201).send({
        user: mapUser(user, scopesForUser(user.id, projectsByUser, locationsByUser)),
      });
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'A user with that email already exists' });
      }
      throw err;
    }
  });

  fastify.put('/admin/users/:id', guard, async (request, reply) => {
    const { id } = request.params;
    const {
      email,
      displayName,
      roleIds,
      isActive,
      password,
      projectIds,
      locationIds,
    } = request.body || {};

    const existing = await prisma.app_user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    if (isActive === false && id === request.user.id) {
      return reply.code(400).send({ error: 'You cannot deactivate your own account' });
    }

    const data = {};
    if (email !== undefined) data.email = String(email).toLowerCase().trim();
    if (displayName !== undefined) data.display_name = String(displayName).trim();
    if (isActive !== undefined) data.is_active = !!isActive;
    if (password) {
      if (password.length < 6) {
        return reply.code(400).send({ error: 'Password must be at least 6 characters' });
      }
      data.password_hash = await hashPassword(password);
    }

    if (roleIds !== undefined) {
      if (!Array.isArray(roleIds)) {
        return reply.code(400).send({ error: 'roleIds must be an array' });
      }
      const found = roleIds.length
        ? await prisma.app_role.count({ where: { id: { in: roleIds } } })
        : 0;
      if (found !== roleIds.length) {
        return reply.code(400).send({ error: 'One or more roleIds are invalid' });
      }

      if (id === request.user.id) {
        const adminRole = await prisma.app_role.findUnique({ where: { name: ADMIN_ROLE_NAME } });
        if (adminRole && !roleIds.includes(adminRole.id)) {
          return reply.code(400).send({ error: 'You cannot remove your own Admin role' });
        }
      }
    }

    const nextProjects = projectIds !== undefined
      ? (Array.isArray(projectIds) ? projectIds : [])
      : undefined;
    const nextLocations = locationIds !== undefined
      ? (Array.isArray(locationIds) ? locationIds : [])
      : undefined;
    const scopeErr = await validateScopeIds(nextProjects || [], nextLocations || []);
    if (scopeErr && (nextProjects !== undefined || nextLocations !== undefined)) {
      return reply.code(400).send({ error: scopeErr });
    }

    try {
      const user = await prisma.$transaction(async (tx) => {
        if (roleIds !== undefined) {
          await tx.app_user_role.deleteMany({ where: { user_id: id } });
          if (roleIds.length) {
            await tx.app_user_role.createMany({
              data: roleIds.map((role_id) => ({ user_id: id, role_id })),
            });
          }
        }
        await syncUserScopes(tx, id, nextProjects, nextLocations);
        return tx.app_user.update({
          where: { id },
          data,
          include: userInclude,
        });
      });
      const { projectsByUser, locationsByUser } = await loadUserScopes([user.id]);
      return { user: mapUser(user, scopesForUser(user.id, projectsByUser, locationsByUser)) };
    } catch (err) {
      if (err.code === 'P2002') {
        return reply.code(409).send({ error: 'A user with that email already exists' });
      }
      throw err;
    }
  });

  fastify.delete('/admin/users/:id', guard, async (request, reply) => {
    const { id } = request.params;
    if (id === request.user.id) {
      return reply.code(400).send({ error: 'You cannot delete your own account' });
    }
    const existing = await prisma.app_user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });
    await prisma.app_user.delete({ where: { id } });
    return reply.code(204).send();
  });
}
