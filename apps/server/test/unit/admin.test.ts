import { afterEach, describe, expect, it } from 'vitest';
import type { TestClient } from '../helpers/context.js';
import { createTestContext, multipart, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { buildApp } from '../../src/app.js';
import { connectPeer, listen, until } from '../helpers/collab-client.js';

describe('admin panel', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  /** owner@test.uz is the admin (ADMIN_EMAILS); returns a second, ordinary user. */
  async function setup(env: Record<string, string> = {}) {
    ctx = await createTestContext(new FakeRunner(), { ADMIN_EMAILS: 'Owner@Test.uz, boss@test.uz', ...env });
    const user = ctx.client();
    const u = await user.register('user@test.uz', undefined, 'Oddiy');
    return { admin: ctx.api, user, userId: u.id };
  }

  it('gives the admin role to ADMIN_EMAILS on registration and at start-up', async () => {
    const { admin, user } = await setup();
    expect((await admin.inject('/api/auth/me')).json().user.role).toBe('admin');
    expect((await user.inject('/api/auth/me')).json().user.role).toBe('user');

    // An existing account listed later is promoted when the server starts.
    await ctx!.prisma.user.updateMany({ where: { email: 'user@test.uz' }, data: { role: 'user' } });
    const again = await buildApp({
      config: { ...ctx!.config, ADMIN_EMAILS: ['user@test.uz'] },
      prisma: ctx!.prisma,
      runner: new FakeRunner(),
      logger: false,
    });
    await again.app.close();
    expect((await user.inject('/api/auth/me')).json().user.role).toBe('admin');
  });

  it('allows only admins: 401 anonymous, 403 users, 200 admins', async () => {
    const { admin, user, userId } = await setup();
    const anon = ctx!.client();
    const routes: Array<{ method: string; url: string; payload?: unknown }> = [
      { method: 'GET', url: '/api/admin/users' },
      { method: 'GET', url: `/api/admin/users/${userId}` },
      { method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { aiDailyLimit: 5 } },
      { method: 'GET', url: '/api/admin/stats' },
    ];
    for (const r of routes) {
      expect((await anon.inject(r)).statusCode, `${r.method} ${r.url} anonymous`).toBe(401);
      const res = await user.inject(r);
      expect(res.statusCode, `${r.method} ${r.url} user`).toBe(403);
      expect(res.json().error.code).toBe('admin_only');
      expect((await admin.inject(r)).statusCode, `${r.method} ${r.url} admin`).toBe(200);
    }
    // A user cannot make themselves admin through the admin API (403 above) or elsewhere.
    expect((await ctx!.prisma.user.findFirstOrThrow({ where: { id: userId } })).role).toBe('user');
  });

  it('lists and searches users with usage figures', async () => {
    const { admin, user } = await setup();
    const p = (await user.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Darslik' } })).json().project;
    await user.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });

    const all = (await admin.inject('/api/admin/users')).json();
    expect(all.total).toBe(2);
    const found = (await admin.inject('/api/admin/users?q=ODDIY')).json();
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({
      email: 'user@test.uz',
      role: 'user',
      blockedAt: null,
      projectCount: 1,
      compiles7d: 1,
      aiRequestsToday: 0,
      limits: { maxProjects: null, storageQuotaBytes: null, aiDailyLimit: null },
      effective: { maxProjects: 200, aiDailyLimit: 30 },
    });
    expect(found.users[0].storageBytes).toBeGreaterThan(100);
    expect(found.users[0].lastSeenAt).not.toBeNull();
    expect((await admin.inject('/api/admin/users?limit=500')).statusCode).toBe(400);
  });

  it('blocks a user: sessions end, login is refused, projects are frozen; unblock restores', async () => {
    const { admin, user, userId } = await setup();
    const p = (await user.inject({ method: 'POST', url: `/api/projects`, payload: { name: 'Shaxsiy' } })).json().project;
    const link = (await user.inject({ method: 'POST', url: `/api/projects/${p.id}/share-links`, payload: { role: 'viewer' } })).json().link;
    const viewer = ctx!.client(link.token);
    expect((await viewer.inject(`/api/projects/${p.id}`)).statusCode).toBe(200);

    const res = await admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { blocked: true } });
    expect(res.json().user.blockedAt).not.toBeNull();
    expect((await user.inject('/api/auth/me')).json().user).toBeNull();
    expect((await user.inject('/api/projects')).statusCode).toBe(401);
    const login = await user.login('user@test.uz');
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('account_blocked');
    // A wrong password still gets the generic answer (no account probing).
    expect((await user.login('user@test.uz', 'wrong-password-123')).json().error.code).toBe('invalid_credentials');
    expect((await viewer.inject(`/api/projects/${p.id}`)).statusCode).toBe(404);
    expect((await admin.inject('/api/admin/stats')).json().stats.users.blocked).toBe(1);

    await admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { blocked: false } });
    expect((await user.login('user@test.uz')).statusCode).toBe(200);
    expect((await viewer.inject(`/api/projects/${p.id}`)).statusCode).toBe(200);
  });

  it('closes the live editing connections of a blocked user and to their projects', async () => {
    const { admin, user, userId } = await setup();
    const p = (await user.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Jonli' } })).json().project;
    const files = (await user.inject(`/api/projects/${p.id}`)).json().project.files as Array<{ id: string; path: string }>;
    const mainId = files.find((f) => f.path === 'main.tex')!.id;
    const link = (await user.inject({ method: 'POST', url: `/api/projects/${p.id}/share-links`, payload: { role: 'viewer' } })).json().link;
    const base = await listen(ctx!);
    const own = await connectPeer(base, p.id, mainId, user);
    const guest = await connectPeer(base, p.id, mainId, null, { share: link.token });
    const codes: number[] = [];
    for (const peer of [own, guest]) {
      peer.provider.ws?.addEventListener('close', (e) => codes.push((e as CloseEvent).code));
      peer.provider.shouldConnect = false; // do not reconnect after the close
    }
    await admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { blocked: true } });
    await until(() => codes.length === 2, 3000, 'close');
    expect(codes).toEqual([4403, 4403]);
    own.destroy();
    guest.destroy();
  });

  it('does not let an admin block or demote themselves; can promote others', async () => {
    const { admin, user, userId } = await setup();
    const me = (await admin.inject('/api/auth/me')).json().user;
    for (const payload of [{ blocked: true }, { role: 'user' }]) {
      const res = await admin.inject({ method: 'PATCH', url: `/api/admin/users/${me.id}`, payload });
      expect(res.json().error.code).toBe('cannot_change_self');
    }
    await admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { role: 'admin' } });
    expect((await user.inject('/api/admin/stats')).statusCode).toBe(200);
    expect((await admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload: { role: 'root' } })).statusCode).toBe(400);
    expect((await admin.inject({ method: 'PATCH', url: '/api/admin/users/nope', payload: { blocked: true } })).statusCode).toBe(404);
  });

  it('enforces project, storage and AI quotas set per user', async () => {
    const { admin, user, userId } = await setup();
    const patch = (payload: unknown) => admin.inject({ method: 'PATCH', url: `/api/admin/users/${userId}`, payload });
    const create = (c: TestClient) => c.inject({ method: 'POST', url: '/api/projects', payload: { name: 'P' } });

    await patch({ maxProjects: 1 });
    expect((await create(user)).statusCode).toBe(201);
    const second = await create(user);
    expect(second.statusCode).toBe(413);
    expect(second.json().error.code).toBe('project_limit');

    await patch({ maxProjects: null, storageQuotaBytes: 0 + 1 });
    const projectId = (await user.inject('/api/projects')).json().projects[0].id;
    const upload = multipart([{ name: 'rasm.png', data: Buffer.alloc(2048, 1) }]);
    const res = await user.inject({ method: 'POST', url: `/api/projects/${projectId}/upload`, ...upload });
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('storage_quota');
    expect((await create(user)).json().error.code).toBe('storage_quota');

    const updated = (await patch({ storageQuotaBytes: 10_000_000, aiDailyLimit: 7 })).json().user;
    expect(updated.limits).toEqual({ maxProjects: null, storageQuotaBytes: 10_000_000, aiDailyLimit: 7 });
    expect(updated.effective).toMatchObject({ maxProjects: 200, storageQuotaBytes: 10_000_000, aiDailyLimit: 7 });
    expect((await user.inject({ method: 'POST', url: `/api/projects/${projectId}/upload`, ...upload })).statusCode).toBe(201);
  });

  it('reports compile, storage and user statistics', async () => {
    const runner = new FakeRunner();
    ctx = await createTestContext(runner, { ADMIN_EMAILS: 'owner@test.uz' });
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'S' } })).json().project;
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    runner.result = () => ({ status: 'failed', exitCode: 1, log: '', console: '', pdf: null, synctex: null, errorMessage: null });
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });

    const stats = (await ctx.api.inject('/api/admin/stats')).json().stats;
    expect(stats.users).toMatchObject({ total: 1, admins: 1, blocked: 0, new7d: 1, active7d: 1 });
    expect(stats.projects).toEqual({ total: 1, created7d: 1 });
    expect(stats.compiles.last24h).toEqual({ total: 2, success: 1, failed: 1, timeout: 0, error: 0 });
    expect(stats.compiles.avgMs7d).toBeGreaterThanOrEqual(0);
    expect(stats.compiles.p95Ms7d).toBeGreaterThanOrEqual(0);
    expect(stats.compiles.daily).toHaveLength(14);
    expect(stats.compiles.daily.at(-1)).toMatchObject({ total: 2, failed: 1 });
    expect(stats.storage.fileCount).toBeGreaterThan(0);
    expect(stats.storage.fileBytes).toBeGreaterThan(0);
    expect(stats.ai).toMatchObject({ enabled: false, requests24h: 0 });
  });
});
