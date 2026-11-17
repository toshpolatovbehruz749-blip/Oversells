import { afterEach, describe, expect, it } from 'vitest';
import { versionsToPrune, applyVersionRetention } from '../../src/versions/retention.js';
import { Maintenance } from '../../src/maintenance.js';
import { redactUrl } from '../../src/logging.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const silent = { info() {}, warn() {} };

describe('version retention policy', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const v = (id: string, ageMs: number, kind: 'auto' | 'named' | 'restore' = 'auto') => ({
    id,
    kind,
    createdAt: new Date(now.getTime() - ageMs),
  });

  it('keeps everything from the last day, one per day for 30 days, then one per week', () => {
    const versions = [
      v('recent1', 1 * HOUR),
      v('recent2', 5 * HOUR),
      v('recent3', 23 * HOUR),
      // 2026-10-11: three versions, the newest is kept
      v('d2-new', 2 * DAY - 0 * HOUR),
      v('d2-mid', 2 * DAY + 2 * HOUR),
      v('d2-old', 2 * DAY + 4 * HOUR),
      v('d10', 10 * DAY),
      // older than 30 days: one per week (2026-08-24 .. 2026-08-30 is one week)
      v('w-new', 45 * DAY), // Fri 2026-08-29
      v('w-old', 48 * DAY), // Tue 2026-08-26
      v('w-other', 52 * DAY), // Sat 2026-08-22 (previous week)
      v('named-old', 100 * DAY, 'named'),
      v('restore-old', 100 * DAY, 'restore'),
    ];
    expect(versionsToPrune(versions, now).sort()).toEqual(['d2-mid', 'd2-old', 'w-old']);
  });

  it('deletes pruned versions and their content', async () => {
    const ctx = await createTestContext(new FakeRunner());
    try {
      const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'R' } })).json().project;
      // Noon today (UTC), so "3 days" and "3 days + 2 hours" ago are the same calendar day.
      const base = new Date();
      base.setUTCHours(12, 0, 0, 0);
      let n = 0;
      const snap = async (kind: 'auto' | 'named', ageMs: number) => {
        const contentKey = `projects/${p.id}/versions/test-${++n}.json`;
        await ctx.services.storage.put(contentKey, Buffer.from('{"files":[]}'));
        return ctx.prisma.version.create({
          data: { projectId: p.id, kind, contentKey, contentHash: String(n), fileCount: 0, createdAt: new Date(base.getTime() - ageMs) },
        });
      };
      const keep = await snap('auto', 3 * DAY);
      const drop = await snap('auto', 3 * DAY + HOUR);
      const named = await snap('named', 3 * DAY + 2 * HOUR);
      expect(await applyVersionRetention(ctx.prisma, ctx.services.storage, base)).toBe(1);
      const left = (await ctx.prisma.version.findMany({ where: { projectId: p.id } })).map((x) => x.id).sort();
      expect(left).toEqual([keep.id, named.id].sort());
      expect(await ctx.services.storage.exists(drop.contentKey)).toBe(false);
      expect(await ctx.services.storage.exists(keep.contentKey)).toBe(true);

      // Maintenance also removes expired sessions; a second concurrent run is skipped by the lock.
      await ctx.prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const m = new Maintenance(ctx.prisma, ctx.services.storage, silent, 3_600_000);
      const [r1, r2] = await Promise.all([m.runOnce(), m.runOnce()]);
      const ran = [r1, r2].filter(Boolean);
      expect(ran).toHaveLength(1);
      expect(ran[0]!.sessions).toBeGreaterThanOrEqual(1);
    } finally {
      await ctx.close();
    }
  });
});

describe('operations endpoints', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('readiness reports the dependencies', async () => {
    ctx = await createTestContext(new FakeRunner());
    const res = await ctx.api.inject('/api/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', checks: { database: { ok: true } }, compiler: { ok: true } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('metrics need the token and expose app metrics', async () => {
    ctx = await createTestContext(new FakeRunner());
    expect((await ctx.api.inject('/metrics')).statusCode).toBe(404); // disabled without METRICS_TOKEN
    await ctx.close();

    ctx = await createTestContext(new FakeRunner(), { METRICS_TOKEN: 'metrics-token-0123456789' });
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'M' } })).json().project;
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    expect((await ctx.api.inject('/metrics')).statusCode).toBe(401);
    const res = await ctx.api.inject({ url: '/metrics', headers: { authorization: 'Bearer metrics-token-0123456789' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('oversells_http_request_duration_seconds_bucket');
    expect(res.body).toMatch(/oversells_compile_jobs_total\{status="success"\} [1-9]/);
    expect(res.body).toContain('oversells_compile_queue_jobs{status="queued"} 0');
    expect(res.body).toContain('oversells_collab_connections');
    expect(res.body).toContain('oversells_process_cpu_seconds_total');
  });

  it('redacts capability tokens in logged URLs', () => {
    expect(redactUrl('/api/projects/x/output.pdf?share=abc123&download=1')).toBe('/api/projects/x/output.pdf?share=[redacted]&download=1');
    expect(redactUrl('/reset-password?token=secret')).toBe('/reset-password?token=[redacted]');
    expect(redactUrl('/api/projects')).toBe('/api/projects');
  });
});
