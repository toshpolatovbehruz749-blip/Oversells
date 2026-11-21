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

  it('is gone when the page design flag is turned off', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'false' });
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

describe('PDF text import', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('reads the text of a PDF in the sandbox into a new project (not with the flag off)', async () => {
    const runner = new FakeRunner();
    ctx = await createTestContext(runner, { PAGE_DESIGN_ENABLED: 'false' });
    const pdf = Buffer.from('%PDF-1.4 fake');
    expect((await ctx.api.inject({ method: 'POST', url: '/api/projects/import-pdf', ...multipart('Kitob.pdf', pdf) })).statusCode).toBe(404);
    await ctx.close();

    ctx = await createTestContext(runner, { PAGE_DESIGN_ENABLED: 'true' });
    const res = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-pdf', ...multipart('Ona yurt.pdf', pdf) });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ project: { name: 'Ona yurt' }, headings: 1, paragraphs: 1 });
    expect(runner.requests.at(-1)!.convert).toBe('pdf-to-text');
    const detail = (await ctx.api.inject(`/api/projects/${res.json().project.id}`)).json().project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const tex = (await ctx.api.inject(`/api/projects/${detail.id}/files/${main.id}`)).body;
    expect(tex).toContain('\\section*{BIRINCHI BOB}');
    expect(tex).toContain('paperwidth=148mm');
    const notPdf = await ctx.api.inject({ method: 'POST', url: '/api/projects/import-pdf', ...multipart('a.pdf', Buffer.from('PK')) });
    expect(notPdf.json().error.code).toBe('not_pdf');
  });
});
