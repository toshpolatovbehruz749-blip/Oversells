import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth/http.js';
import { parse } from '../validation.js';
import type { AdminService } from './admin-service.js';

const listQuery = z.object({
  q: z.string().trim().max(200).default(''),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const limit = (max: number) => z.number().int().nonnegative().max(max).nullable().optional();
const patchBody = z
  .object({
    blocked: z.boolean().optional(),
    role: z.enum(['user', 'admin']).optional(),
    maxProjects: limit(100_000),
    storageQuotaBytes: limit(Number.MAX_SAFE_INTEGER),
    aiDailyLimit: limit(10_000),
  })
  .strict();

/** Admin API: every route requires a logged-in user with the admin role (else 401/403). */
export async function registerAdminRoutes(app: FastifyInstance, admin: AdminService): Promise<void> {
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req.user);
    const q = parse(listQuery, req.query);
    return admin.listUsers(q.q, q.offset, q.limit);
  });

  app.get('/api/admin/users/:userId', async (req) => {
    requireAdmin(req.user);
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), req.params);
    return { user: await admin.getUser(userId) };
  });

  app.patch('/api/admin/users/:userId', async (req) => {
    const me = requireAdmin(req.user);
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), req.params);
    const body = parse(patchBody, req.body ?? {});
    return { user: await admin.updateUser(me, userId, body) };
  });

  app.get('/api/admin/stats', async (req) => {
    requireAdmin(req.user);
    return { stats: await admin.stats() };
  });
}
