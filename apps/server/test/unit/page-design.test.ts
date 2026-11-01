import { afterEach, describe, expect, it } from 'vitest';
import { defaultPageDesign } from '@oversells/shared';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('Sahifa dizayni (page design) routes', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  const project = async () =>
    (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Roman', template: 'textbook' } })).json().project;
  const text = async (projectId: string, path: string) => {
    const d = (await ctx.api.inject(`/api/projects/${projectId}`)).json().project;
    const f = d.files.find((x: { path: string }) => x.path === path);
    return f ? (await ctx.api.inject(`/api/projects/${projectId}/files/${f.id}`)).body : null;
  };

  it('is off unless PAGE_DESIGN_ENABLED, and says so', async () => {
    ctx = await createTestContext(new FakeRunner());
    expect((await ctx.api.inject('/api/features')).json().features).toEqual({ pageDesign: false });
    const p = await project();
    expect((await ctx.api.inject(`/api/projects/${p.id}/page-design`)).statusCode).toBe(404);
    expect(await text(p.id, 'sahifa.sty')).toBeNull();
  });

  it('offers a default, writes sahifa.sty, loads it in the main file and reads it back', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    expect((await ctx.api.inject('/api/features')).json().features).toEqual({ pageDesign: true });
    const p = await project();
    const first = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json();
    expect(first.exists).toBe(false);
    expect(first.design.title).toBe('Roman');

    const design = defaultPageDesign('Roman');
    design.paragraphStyles.push({ id: 'maqol', name: 'Maqol', italic: true, align: 'center' });
    const res = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design } });
    expect(res.statusCode).toBe(200);
    expect(res.json().mainChanged).toBe(true);
    expect(await text(p.id, 'sahifa.sty')).toContain('\\@namedef{sahifa@p@maqol}');
    expect(await text(p.id, 'main.tex')).toContain('\\usepackage{sahifa}');

    const again = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json();
    expect(again.exists).toBe(true);
    expect(again.design.paragraphStyles.map((s: { id: string }) => s.id)).toContain('maqol');
    // The second save does not load the package twice.
    const second = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design } });
    expect(second.json().mainChanged).toBe(false);
  });

  it('rejects a bad design and does not overwrite a hand-written sahifa.sty', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const p = await project();
    const bad = { ...defaultPageDesign(), defaultMaster: 'yoq' };
    const res = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design: bad } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_page_design');

    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/files`, payload: { path: 'sahifa.sty', content: '% qoʻlda\n' } });
    const read = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json();
    expect(read).toMatchObject({ exists: true, readable: false });
    const put = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design: defaultPageDesign() } });
    expect(put.statusCode).toBe(400);
    expect(await text(p.id, 'sahifa.sty')).toBe('% qoʻlda\n');
    const replaced = await ctx.api.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}/page-design`,
      payload: { design: defaultPageDesign(), replaceUnreadable: true },
    });
    expect(replaced.statusCode).toBe(200);
  });

  it('needs write access to save', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const p = await project();
    const token = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/share-links`, payload: { role: 'viewer' } })).json()
      .link.token;
    const viewer = ctx.client(token);
    expect((await viewer.inject(`/api/projects/${p.id}/page-design`)).statusCode).toBe(200);
    const put = await viewer.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design: defaultPageDesign() } });
    expect([401, 403]).toContain(put.statusCode);
  });
});
