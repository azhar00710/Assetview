import prisma from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/token.js';
import {
  getUserByEmail,
  toPublicUser,
  requireAuth,
  publicUser,
} from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';

export default async function authRoutes(fastify) {
  fastify.get('/auth/permissions', async () => ({ permissions: PERMISSIONS }));

  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }

    const user = await getUserByEmail(email);
    if (!user || !user.is_active) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    await prisma.app_user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const token = signToken({ sub: user.id, email: user.email });
    return {
      token,
      user: await toPublicUser(user),
    };
  });

  fastify.get('/auth/me', { preHandler: [requireAuth()] }, async (request) => {
    return {
      user: publicUser(
        request.user,
        request.roles,
        request.permissions,
        request.scope,
      ),
    };
  });

  fastify.post('/auth/change-password', { preHandler: [requireAuth()] }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return reply.code(400).send({ error: 'New password must be at least 6 characters' });
    }

    const user = await prisma.app_user.findUnique({ where: { id: request.user.id } });
    const ok = await verifyPassword(currentPassword, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    const password_hash = await hashPassword(newPassword);
    await prisma.app_user.update({
      where: { id: user.id },
      data: { password_hash },
    });

    return { ok: true };
  });
}
