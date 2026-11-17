import { afterEach, describe, expect, it } from 'vitest';
import { defaultCover, defaultPageDesign } from '@oversells/shared';
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

  it('is on by default and says so', async () => {
    ctx = await createTestContext(new FakeRunner());
    expect((await ctx.api.inject('/api/features')).json().features).toEqual({ pageDesign: true, indesign: null, coreldraw: null });
    const on = await project();
    expect((await ctx.api.inject(`/api/projects/${on.id}/page-design`)).statusCode).toBe(200);
    // Only reading the design writes nothing: a project without sahifa.sty stays as it was.
    expect(await text(on.id, 'sahifa.sty')).toBeNull();
    expect(await text(on.id, 'main.tex')).not.toContain('sahifa');
  });

  it('is off with PAGE_DESIGN_ENABLED=false, and says so', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'false' });
    expect((await ctx.api.inject('/api/features')).json().features).toEqual({ pageDesign: false, indesign: null, coreldraw: null });
    const p = await project();
    expect((await ctx.api.inject(`/api/projects/${p.id}/page-design`)).statusCode).toBe(404);
    expect(await text(p.id, 'sahifa.sty')).toBeNull();
  });

  it('offers a default, writes sahifa.sty, loads it in the main file and reads it back', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    expect((await ctx.api.inject('/api/features')).json().features).toEqual({ pageDesign: true, indesign: null, coreldraw: null });
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

  it('refuses a save over a sahifa.sty that changed since it was read', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project();
    const put = (design: unknown, version?: string) =>
      ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design, version } });
    const first = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json();
    expect(first.version).toBe('');
    // The dialog read the design; meanwhile a margin is dragged in visual mode.
    const dragged = await put({ ...first.design, page: { ...first.design.page, inner: 25 } }, first.version);
    expect(dragged.statusCode).toBe(200);
    const stale = await put({ ...first.design, title: 'Eski oyna' }, first.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('page_design_changed');
    // With the version of the newer file it saves; without one (overwrite asked for) too.
    expect((await put({ ...first.design, title: 'Yangi' }, dragged.json().version)).statusCode).toBe(200);
    expect((await put({ ...first.design, title: 'Ustidan' })).statusCode).toBe(200);
    expect((await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json().design.title).toBe('Ustidan');
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

  it('preflight checks the latest PDF and adds blank pages to a printing sheet', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const p = await project();
    const before = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight`, payload: {} });
    expect(before.statusCode).toBe(400);
    expect(before.json().error.code).toBe('no_pdf');

    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight`, payload: { multiple: 16 } });
    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.pages).toBe(6);
    const check = (id: string) => report.checks.find((c: { id: string }) => c.id === id);
    expect(check('fonts').status).toBe('ok');
    expect(check('image-dpi')).toMatchObject({ status: 'error', items: [{ page: 2, text: '300×200 px, 72 dpi' }] });
    expect(check('empty-pages').items).toEqual([{ page: 3, text: '' }]);
    expect(check('page-count').fix).toEqual({ kind: 'blankPages', count: 10 });

    const fix = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight/blank-pages`, payload: { count: 10 } });
    expect(fix.statusCode).toBe(200);
    const main = (await text(p.id, 'main.tex'))!;
    expect(main.match(/\\bosbet/g)).toHaveLength(10);
    expect(main.indexOf('\\bosbet')).toBeLessThan(main.indexOf('\\end{document}'));
  });

  it('preflight says when the cover was made for another page count, and fits it', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project();
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    // No cover: no cover check.
    let report = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight`, payload: {} })).json().report;
    expect(report.checks.some((c: { id: string }) => c.id === 'cover-spine')).toBe(false);
    // A cover for 300 pages; the book has 6.
    const put = await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/cover`, payload: { cover: { ...defaultCover('Roman'), pages: 300 } } });
    expect(put.statusCode).toBe(200);
    report = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight`, payload: {} })).json().report;
    const check = report.checks.find((c: { id: string }) => c.id === 'cover-spine');
    expect(check).toMatchObject({ status: 'error', fix: { kind: 'coverPages', pages: 6 } });
    expect(check.items[0].text).toMatch(/^300 → 6 \(/);
    const fixed = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight/cover-pages`, payload: { pages: 6 } });
    expect(fixed.statusCode).toBe(200);
    expect((await ctx.api.inject(`/api/projects/${p.id}/cover`)).json().cover.pages).toBe(6);
    report = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/preflight`, payload: {} })).json().report;
    expect(report.checks.find((c: { id: string }) => c.id === 'cover-spine').status).toBe('ok');
  });

  it('shows the page design templates only with the flag, and they come with sahifa.sty', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'false' });
    const names = async () => (await ctx.api.inject('/api/templates')).json().templates.map((t: { name: string }) => t.name);
    expect(await names()).not.toContain('roman');
    await ctx.close();

    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    expect(await names()).toEqual(expect.arrayContaining(['roman', 'sheriyat', 'bolalar', 'ishdaftari', 'diniy', 'lugat', 'oshpazlik', 'albom', 'katalog']));
    // The Arabic template is set to LuaLaTeX (bidi=basic).
    const diniy = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Suralar', template: 'diniy' } })).json().project;
    expect(diniy.compiler).toBe('lualatex');
    expect(await text(diniy.id, 'sahifa.sty')).toContain('Tanlangan suralar');
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Qissa', template: 'roman' } })).json().project;
    const sty = await text(p.id, 'sahifa.sty');
    expect(sty).toContain('% oversells-sahifa:');
    expect(await text(p.id, 'sahifa.json')).toBeNull();
    const design = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json();
    expect(design).toMatchObject({ exists: true, readable: true });
    expect(design.design.paragraphStyles.map((s: { id: string }) => s.id)).toContain('boshi');
  });

  it('visual editor: reads the layout from the log and moves a frame in its file', async () => {
    const log = 'OVS-G1:412.56496pt;569.05511pt;307.28978pt;449.55356pt\nOVS-G2:62.59pt;42.67pt;56.9pt;1\nOVS-FL:1;5;./main-bob.tex\nOVS-FP:1;2;85.35826pt;113.81102pt;113.81102pt;75.87532pt\n';
    const runner = new FakeRunner();
    runner.result = () => ({ status: 'success', exitCode: 0, log, console: '', pdf: Buffer.from('%PDF-1.4 fake'), synctex: null, errorMessage: null });
    ctx = await createTestContext(runner, { PAGE_DESIGN_ENABLED: 'true' });
    const p = await project();
    expect((await ctx.api.inject(`/api/projects/${p.id}/page-layout`)).json().layout).toBeNull();
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } });
    const { layout } = (await ctx.api.inject(`/api/projects/${p.id}/page-layout`)).json();
    expect(layout.twoside).toBe(true);
    expect(layout.frames).toEqual([expect.objectContaining({ file: 'main.tex', line: 5, page: 2 })]);

    // A frame in main.tex: the line of the command.
    const d = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    const main = d.files.find((f: { path: string }) => f.path === 'main.tex');
    const original = (await ctx.api.inject(`/api/projects/${p.id}/files/${main.id}`)).body;
    const lines = original.split('\n');
    lines.splice(4, 0, '\\rasmramka[joy=sahifa,x=30mm,y=40mm,en=40mm]{rasmlar/a.png}{}');
    await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/files/${main.id}/content`, payload: { content: lines.join('\n') } });
    const moved = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/page-design/frame`, payload: { file: 'main.tex', line: 5, x: 35.04, y: 41, w: 52 } });
    expect(moved.statusCode).toBe(200);
    expect(await text(p.id, 'main.tex')).toContain('\\rasmramka[joy=sahifa,x=35mm,y=41mm,en=52mm]{rasmlar/a.png}{}');
    const none = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/page-design/frame`, payload: { file: 'main.tex', line: 1, x: 1 } });
    expect(none.json().error.code).toBe('frame_not_found');
  });
});

describe('merging styles', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('changes the uses in every .tex file and removes the style', async () => {
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'true' });
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Word', template: 'textbook' } })).json().project;
    const design = defaultPageDesign('Word');
    design.paragraphStyles.push({ id: 'quote', name: 'Quote', italic: true });
    expect((await ctx.api.inject({ method: 'PUT', url: `/api/projects/${p.id}/page-design`, payload: { design } })).statusCode).toBe(200);
    const target = design.paragraphStyles.find((s) => !s.heading && s.id !== 'quote')!.id;
    const detail = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const text = (await ctx.api.inject(`/api/projects/${p.id}/files/${main.id}`)).body;
    await ctx.services.docs.setText(main.id, text.replace('\\end{document}', '\\begin{uslub}{quote}Iqtibos\\end{uslub}\n\\end{document}'));

    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/page-design/merge`, payload: { kind: 'paragraph', from: 'quote', to: target } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ uses: 1, files: 1 });
    expect(await ctx.services.docs.getText(main.id)).toContain(`\\begin{uslub}{${target}}Iqtibos`);
    const after = (await ctx.api.inject(`/api/projects/${p.id}/page-design`)).json().design;
    expect(after.paragraphStyles.some((s: { id: string }) => s.id === 'quote')).toBe(false);
    const bad = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/page-design/merge`, payload: { kind: 'paragraph', from: 'quote', to: target } });
    expect(bad.json().error.code).toBe('invalid_page_design');
  });
});
