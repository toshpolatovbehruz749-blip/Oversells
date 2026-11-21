import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { buildApp, type BuiltApp } from '../../src/app.js';
import { LocalDiskStorage } from '../../src/storage/local-disk-storage.js';
import { createTestContext, TestClient, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { connectPeer, listen, until, type CollabPeer } from '../helpers/collab-client.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';

async function redisAvailable(): Promise<boolean> {
  const r = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1000, retryStrategy: () => null });
  try {
    await r.connect();
    await r.ping();
    return true;
  } catch {
    return false;
  } finally {
    r.disconnect();
  }
}

/**
 * Two app instances on one database, one storage and one Redis: people
 * connected to different instances edit the same document live.
 */
describe.skipIf(!(await redisAvailable()))('several app instances through Redis', () => {
  let ctx: TestContext | undefined;
  let second: BuiltApp | undefined;
  const peers: CollabPeer[] = [];
  afterEach(async () => {
    for (const p of peers.splice(0)) p.destroy();
    await second?.app.close();
    second = undefined;
    await ctx?.close();
    ctx = undefined;
  });

  async function setup(runner = new FakeRunner(), extra: Record<string, string> = {}) {
    const env = {
      REDIS_URL,
      REDIS_PREFIX: `oversells-test-${randomBytes(4).toString('hex')}:`,
      COLLAB_PERSIST_DEBOUNCE_MS: '20',
      COLLAB_STORAGE_DEBOUNCE_MS: '50',
      COLLAB_UNLOAD_AFTER_MS: '60000',
      ...extra,
    };
    ctx = await createTestContext(runner, env);
    // The second instance shares the database, the storage directory and Redis.
    second = await buildApp({
      config: ctx.config,
      prisma: ctx.prisma,
      storage: new LocalDiskStorage(ctx.dataDir),
      runner,
      logger: false,
    });
    await second.app.ready();
    const baseA = await listen(ctx);
    await second.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = second.app.server.address() as { port: number };
    const baseB = `ws://127.0.0.1:${addr.port}`;

    const pid = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Klaster', template: 'blank' } })).json().project.id;
    const files = (await ctx.api.inject(`/api/projects/${pid}`)).json().project.files as Array<{ id: string; path: string }>;
    const mainId = files.find((f) => f.path === 'main.tex')!.id;
    // The same logged-in user's cookies work on both instances (sessions live in the database).
    const onB = new TestClient(second.app);
    for (const [k, v] of ctx.api.cookies) onB.cookies.set(k, v);
    return { baseA, baseB, pid, mainId, onB };
  }

  async function peer(base: string, pid: string, fileId: string, client: TestClient | null, share?: string) {
    const p = await connectPeer(base, pid, fileId, client, { share });
    peers.push(p);
    return p;
  }

  it('edits on two instances converge, are persisted once, and survive a reload', async () => {
    const { baseA, baseB, pid, mainId } = await setup();
    const a = await peer(baseA, pid, mainId, ctx!.api);
    const b = await peer(baseB, pid, mainId, ctx!.api);
    expect(b.text.toString()).toBe(a.text.toString());

    a.text.insert(0, '% A tomondan\n');
    b.text.insert(b.text.length, '\n% B tomondan');
    await until(() => a.text.toString() === b.text.toString() && a.text.toString().includes('% B tomondan') && b.text.toString().includes('% A tomondan'), 5000, 'convergence');

    // Concurrent typing at the same spot from both sides.
    a.doc.transact(() => a.text.insert(0, 'X'));
    b.doc.transact(() => b.text.insert(0, 'Y'));
    await until(() => a.text.toString() === b.text.toString() && /^(XY|YX)/.test(a.text.toString()), 5000, 'concurrent');
    const final = a.text.toString();

    // The database holds the text exactly once (each instance persisted only its own changes).
    await until(async () => (await ctx!.services.docs.getText(mainId)) === final, 5000, 'instance A text');
    const stored = await ctx!.api.inject(`/api/projects/${pid}/files/${mainId}`);
    await until(async () => (await ctx!.api.inject(`/api/projects/${pid}/files/${mainId}`)).body === final, 5000, 'storage');
    expect(stored.statusCode).toBe(200);

    for (const p of peers.splice(0)) p.destroy();
    await second!.app.close();
    second = undefined;
    await ctx!.services.docs.shutdown();
    const rows = await ctx!.prisma.docUpdate.findMany({ where: { fileId: mainId }, orderBy: { id: 'asc' } });
    const Y = await import('yjs');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.mergeUpdates(rows.map((r) => new Uint8Array(r.data))));
    expect(doc.getText('content').toString()).toBe(final);
  });

  it('shows presence across instances', async () => {
    const { baseA, baseB, pid, mainId } = await setup();
    const a = await peer(baseA, pid, mainId, ctx!.api);
    const b = await peer(baseB, pid, mainId, ctx!.api);
    a.provider.awareness.setLocalStateField('user', { name: 'Ustoz A' });
    await until(
      () => [...b.provider.awareness.getStates().values()].some((s) => (s as { user?: { name?: string } }).user?.name === 'Ustoz A'),
      5000,
      'awareness on B',
    );
  });

  it('compiling on one instance includes keystrokes made on the other', async () => {
    const runner = new FakeRunner();
    // Long debounces: only the cluster-wide flush can make the stored text current.
    const { baseB, pid, mainId } = await setup(runner, { COLLAB_PERSIST_DEBOUNCE_MS: '60000', COLLAB_STORAGE_DEBOUNCE_MS: '60000' });
    const b = await peer(baseB, pid, mainId, ctx!.api);
    b.text.insert(b.text.length, '\n% kompilyatsiyadan oldin yozildi');
    await new Promise((r) => setTimeout(r, 200)); // the keystroke reaches instance B
    const res = await ctx!.api.inject({ method: 'POST', url: `/api/projects/${pid}/compile`, payload: { wait: true } });
    expect(res.json().job.status).toBe('success');
    const main = runner.requests[0]!.files.find((f) => f.path === 'main.tex')!;
    expect(main.data.toString('utf8')).toContain('% kompilyatsiyadan oldin yozildi');
  });

  it('a REST save on one instance reaches an editor on the other', async () => {
    const { baseB, pid, mainId } = await setup();
    const b = await peer(baseB, pid, mainId, ctx!.api);
    const res = await ctx!.api.inject({
      method: 'PUT',
      url: `/api/projects/${pid}/files/${mainId}/content`,
      payload: { content: 'Yangi matn\n' },
    });
    expect(res.statusCode).toBe(200);
    await until(() => b.text.toString() === 'Yangi matn\n', 5000, 'live update on B');
  });

  it('revoking a share link on one instance closes connections on the other', async () => {
    const { baseB, pid, mainId } = await setup();
    const link = (await ctx!.api.inject({ method: 'POST', url: `/api/projects/${pid}/share-links`, payload: { role: 'viewer' } })).json().link;
    const viewer = await peer(baseB, pid, mainId, null, link.token);
    let code = 0;
    viewer.provider.ws?.addEventListener('close', (e) => (code = (e as CloseEvent).code));
    viewer.provider.shouldConnect = false;
    await ctx!.api.inject({ method: 'DELETE', url: `/api/projects/${pid}/share-links/${link.id}` });
    await until(() => code !== 0, 5000, 'close');
    expect(code).toBe(4403);
  });

  it('shares rate limits between instances', async () => {
    const env = { REDIS_URL, REDIS_PREFIX: `oversells-test-${randomBytes(4).toString('hex')}:`, AUTH_RATE_LIMIT_MAX: '3' };
    ctx = await createTestContext(new FakeRunner(), env);
    second = await buildApp({ config: ctx.config, prisma: ctx.prisma, runner: new FakeRunner(), logger: false });
    await second.app.ready();
    const clients = [ctx.client(), new TestClient(second.app)];
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await clients[i % 2]!.login('nobody@test.uz', 'wrong-password-123');
      statuses.push(res.statusCode);
    }
    // The first registration in createTestContext used one attempt of this window.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(3);
  });
});
