import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

function multipart(name: string, data: Buffer | Uint8Array) {
  const boundary = '----oversells-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/zip\r\n\r\n`),
    Buffer.from(data),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('backups', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('downloads all own projects with a manifest and restores them as new projects', async () => {
    ctx = await createTestContext(new FakeRunner());
    const make = async (name: string, template: string) =>
      (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name, template } })).json().project;
    await make('Algebra', 'textbook');
    await make('Test', 'test');

    const res = await ctx.api.inject('/api/backups/mine.zip');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/oversells-zaxira-\d{4}-\d{2}-\d{2}\.zip/);
    const zip = unzipSync(new Uint8Array(res.rawPayload));
    const manifest = JSON.parse(Buffer.from(zip['manifest.json']!).toString());
    expect(manifest.projects.map((p: { name: string }) => p.name)).toEqual(['Algebra', 'Test']);
    expect(Object.keys(zip)).toContain('Algebra/bolimlar/kirish.tex');
    expect(Object.keys(zip)).toContain('Test/savollar.tex');

    const restored = await ctx.api.inject({ method: 'POST', url: '/api/backups/restore', ...multipart('zaxira.zip', res.rawPayload) });
    expect(restored.statusCode).toBe(201);
    const [algebra, test] = restored.json().projects;
    expect(algebra).toMatchObject({ name: 'Algebra', designId: 'zamonaviy', mainFile: 'main.tex' });
    expect(test).toMatchObject({ name: 'Test', mainFile: 'test.tex' });
    const detail = (await ctx.api.inject(`/api/projects/${algebra.id}`)).json().project;
    expect(detail.files.map((f: { path: string }) => f.path).sort()).toEqual(['bolimlar/kirish.tex', 'dizayn.sty', 'main.tex']);
    expect((await ctx.api.inject('/api/projects')).json().projects).toHaveLength(4);
  });

  it('restores a plain project ZIP, skips unsafe paths and refuses other files', async () => {
    ctx = await createTestContext(new FakeRunner());
    const zip = zipSync({
      'kitob/main.tex': strToU8('\\documentclass{article}\\begin{document}Salom\\end{document}'),
      'kitob/rasmlar/a.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'kitob/../../etc/passwd.tex': strToU8('x'),
      'kitob/.hidden.tex': strToU8('x'),
    });
    const res = await ctx.api.inject({ method: 'POST', url: '/api/backups/restore', ...multipart('Mening kitobim.zip', zip) });
    expect(res.statusCode).toBe(201);
    const p = res.json().projects[0];
    expect(p.name).toBe('Mening kitobim');
    const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files.map((f: { path: string }) => f.path).sort();
    expect(files).toEqual(['main.tex', 'rasmlar/a.png']);

    const notZip = await ctx.api.inject({ method: 'POST', url: '/api/backups/restore', ...multipart('a.zip', Buffer.from('salom')) });
    expect(notZip.json().error.code).toBe('invalid_backup');
    expect((await ctx.client().inject('/api/backups/mine.zip')).statusCode).toBe(401);
  });

  it('writes one backup a day into BACKUP_DIR and keeps BACKUP_KEEP_DAYS days', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'oversells-backup-'));
    ctx = await createTestContext(new FakeRunner(), { BACKUP_DIR: dir, BACKUP_KEEP_DAYS: '3' });
    await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kitob' } });
    await writeFile(path.join(dir, 'oversells-2026-10-01.zip'), 'old');
    await writeFile(path.join(dir, 'boshqa.txt'), 'not ours');

    const backups = ctx.services.backups;
    const day = new Date('2026-10-14T03:00:00Z');
    expect(await backups.runDaily(day)).toBe(path.join(dir, 'oversells-2026-10-14.zip'));
    expect(await backups.runDaily(day)).toBeNull(); // already there
    expect((await readdir(dir)).sort()).toEqual(['boshqa.txt', 'oversells-2026-10-14.zip']);
    // A file whose content went missing does not stop the next backup; the manifest names it.
    const file = await ctx.prisma.projectFile.findFirstOrThrow({ where: { path: 'main.tex' } });
    await ctx.services.storage.delete(file.storageKey);
    const next = await backups.runDaily(new Date('2026-10-15T03:00:00Z'));
    const zip = unzipSync(new Uint8Array(await readFile(next!)));
    expect(JSON.parse(Buffer.from(zip['manifest.json']!).toString()).missing).toEqual(['owner@test.uz/Kitob/main.tex']);
    expect((await readdir(dir)).filter((n) => n.endsWith('.part'))).toEqual([]);
    const status = (await ctx.api.inject('/api/backups/status')).json();
    expect(status).toMatchObject({ auto: true, last: { date: '2026-10-15' }, count: 2 });
  });
});
