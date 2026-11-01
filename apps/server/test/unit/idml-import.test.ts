import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';
import { IDML_SAMPLE } from '../../../../packages/shared/test/fixtures/idml-sample.js';

function multipart(name: string, data: Buffer) {
  const boundary = '----oversells-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
const idml = () => Buffer.from(zipSync(Object.fromEntries(Object.entries(IDML_SAMPLE).map(([k, v]) => [k, strToU8(v)]))));

describe('InDesign (IDML) import', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('is there only with the page design flag', async () => {
    ctx = await createTestContext(new FakeRunner());
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-idml', ...multipart('Kitob.idml', idml()) });
    expect(res.statusCode).toBe(404);
  });

  it('makes a project with main.tex and sahifa.sty, and lists what is missing', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-idml', ...multipart('Ona yurt.idml', idml()) });
    expect(res.statusCode).toBe(201);
    const { project, warnings } = res.json();
    expect(project.name).toBe('Ona yurt');
    expect(warnings).toEqual(expect.arrayContaining([{ kind: 'font', name: 'Minion Pro' }, { kind: 'picture', name: 'tog‘.jpg' }]));
    const detail = (await ctx.api.inject(`/api/projects/${project.id}`)).json().project;
    expect(detail.files.map((f: { path: string }) => f.path).sort()).toEqual(['main.tex', 'sahifa.sty']);
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    expect((await ctx.api.inject(`/api/projects/${project.id}/files/${main.id}`)).body).toContain('\\section{Birinchi bob}');
    const design = (await ctx.api.inject(`/api/projects/${project.id}/page-design`)).json();
    expect(design).toMatchObject({ exists: true, readable: true });
    expect(design.design.paragraphStyles.map((s: { name: string }) => s.name)).toContain('Iqtibos');
  });

  it('refuses other files', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const notZip = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-idml', ...multipart('a.idml', Buffer.from('%PDF')) });
    expect(notZip.json().error.code).toBe('not_idml');
    const word = Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document/>') }));
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-idml', ...multipart('a.idml', word) });
    expect(res.json().error.code).toBe('not_idml');
    expect((await ctx.api.inject('/api/projects')).json().projects).toHaveLength(0);
  });
});
