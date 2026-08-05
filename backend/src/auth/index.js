import prisma from '../db.js';
import { hashPassword } from './password.js';
import { verifyToken } from './token.js';
import {
  ADMIN_ROLE_NAME,
  DEFAULT_ROLES,
  ALL_PERMISSION_KEYS,
  mergePermissions,
  hasPermission,
} from './permissions.js';
import { resolveUserScope } from './scope.js';

const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@assetview.local';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123';
const DEFAULT_ADMIN_NAME = process.env.DEFAULT_ADMIN_NAME || 'Administrator';

function publicUser(user, roles, permissions, scope) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    isActive: user.is_active,
    roles: (roles || []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
    })),
    permissions: permissions || [],
    isAdmin: (roles || []).some((r) => r.name === ADMIN_ROLE_NAME),
    accessAll: scope?.accessAll !== false,
    projectIds: scope?.projectIds || [],
    locationIds: scope?.locationIds || [],
    platformIds: scope?.accessAll ? null : (scope?.platformIds || []),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

export async function loadUserAuth(userId) {
  const user = await prisma.app_user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: { role: true },
      },
    },
  });
  if (!user || !user.is_active) return null;

  const roles = user.roles.map((ur) => ur.role);
  const permissions = mergePermissions(roles.map((r) => r.permissions));
  const scope = await resolveUserScope(userId, { roles, permissions });
  return { user, roles, permissions, scope };
}

export async function getUserByEmail(email) {
  return prisma.app_user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      roles: { include: { role: true } },
    },
  });
}

export async function toPublicUser(userWithRoles) {
  const roles = (userWithRoles.roles || []).map((ur) => ur.role || ur);
  const permissions = mergePermissions(roles.map((r) => r.permissions));
  const scope = await resolveUserScope(userWithRoles.id, { roles, permissions });
  return publicUser(userWithRoles, roles, permissions, scope);
}

/** Ensure default roles + bootstrap admin exist (idempotent). */
export async function bootstrapAuth() {
  for (const def of DEFAULT_ROLES) {
    const existing = await prisma.app_role.findUnique({ where: { name: def.name } });
    if (!existing) {
      await prisma.app_role.create({
        data: {
          name: def.name,
          description: def.description,
          permissions: def.permissions,
          is_system: def.is_system,
        },
      });
      console.log(`[auth] Created default role: ${def.name}`);
    } else if (def.name === ADMIN_ROLE_NAME) {
      await prisma.app_role.update({
        where: { id: existing.id },
        data: { permissions: ALL_PERMISSION_KEYS },
      });
    } else if (def.is_system) {
      // Merge any newly catalogued default permissions into system roles
      const current = Array.isArray(existing.permissions) ? existing.permissions : [];
      const merged = [...new Set([...current, ...def.permissions])];
      if (merged.length !== current.length) {
        await prisma.app_role.update({
          where: { id: existing.id },
          data: { permissions: merged, description: def.description },
        });
      }
    }
  }

  const userCount = await prisma.app_user.count();
  if (userCount === 0) {
    const adminRole = await prisma.app_role.findUnique({ where: { name: ADMIN_ROLE_NAME } });
    const password_hash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
    const admin = await prisma.app_user.create({
      data: {
        email: DEFAULT_ADMIN_EMAIL.toLowerCase(),
        display_name: DEFAULT_ADMIN_NAME,
        password_hash,
        is_active: true,
        roles: adminRole
          ? { create: [{ role_id: adminRole.id }] }
          : undefined,
      },
    });
    console.log(`[auth] Bootstrap admin created: ${admin.email} (password: ${DEFAULT_ADMIN_PASSWORD})`);
  }
}

export async function authenticateRequest(request) {
  const header = request.headers.authorization || request.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const payload = verifyToken(match[1].trim());
  if (!payload?.sub) return null;
  return loadUserAuth(payload.sub);
}

export function requireAuth() {
  return async function preHandler(req, reply) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    req.user = auth.user;
    req.roles = auth.roles;
    req.permissions = auth.permissions;
    req.scope = auth.scope;
  };
}

/** Fastify preHandler factory — requires login + optional permission(s). */
export function requirePermission(...required) {
  const needed = required.flat().filter(Boolean);
  return async function preHandler(req, reply) {
    const auth = await authenticateRequest(req);
    if (!auth) {
      return reply.code(401).send({ error: 'Authentication required' });
    }
    req.user = auth.user;
    req.roles = auth.roles;
    req.permissions = auth.permissions;
    req.scope = auth.scope;

    if (needed.length > 0 && !needed.some((p) => hasPermission(auth.permissions, p))) {
      return reply.code(403).send({ error: 'Insufficient permissions', required: needed });
    }
  };
}

export { publicUser, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };
