import { afterEach, describe, expect, it } from 'vitest';
import { DESIGN_LANGUAGES, type DesignSpec } from '@oversells/shared';
import { generateDesignPackage, designSpecSchema, TITLES } from '../../src/designs/generate.js';
import { loadBuiltInDesigns, loadsDesign, withDesignPackage, designLanguageFor } from '../../src/designs/design-service.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner, FAKE_PDF, FAKE_PNG } from '../helpers/fake-runner.js';

const builtIns = loadBuiltInDesigns('designs');
const spec = builtIns.find((d) => d.id === 'zamonaviy')!.spec;

describe('design package generator', () => {
  it('has six valid built-in designs', () => {
    expect(builtIns.map((d) => d.id)).toEqual(['zamonaviy', 'klassik', 'yorqin', 'olimpiada', 'akademik', 'pastel']);
    for (const d of builtIns) expect(designSpecSchema.safeParse(d.spec).success).toBe(true);
  });

  it('turns a spec into a package with its fonts, colours and environments', () => {
    const sty = generateDesignPackage(spec, 'uz-latn', 'Zamonaviy darslik');
    expect(sty).toContain('\\ProvidesPackage{dizayn}');
    expect(sty).toContain('\\definecolor{dzAsosiy}{HTML}{0F6E7A}');
    expect(sty).toContain('\\setmainfont{Noto Serif}');
    expect(sty).toContain('\\newfontfamily\\dz@headfont{Inter}');
    expect(sty).toContain('\\setmathfont{latinmodern-math.otf}');
    expect(sty).toContain('range=it/{latin,Latin}'); // letters from the text font
    for (const env of ['teorema', 'tarif', 'misol', 'eslatma', 'diqqat', 'bilasizmi', 'tarix']) {
      expect(sty).toContain(`\\dz@declare{${env}}`);
    }
    for (const cmd of ['\\NewDocumentCommand\\muhim', '{mashqlar}', '{koordinata}', '\\uchburchak', '\\burchak', '{sonoqi}', '\\kasrdoira', '\\venn']) {
      expect(sty).toContain(cmd);
    }
    expect(sty).toContain('Taʼrif');
    expect(sty).toContain("Ta'rif"); // pdfLaTeX fallback
    expect(sty.trimEnd().endsWith('\\endinput')).toBe(true);
  });

  it('writes box titles in the document language', () => {
    for (const lang of DESIGN_LANGUAGES) {
      expect(generateDesignPackage(spec, lang, 'x')).toContain(TITLES[lang].teorema);
    }
    expect(generateDesignPackage(spec, 'ru', 'x')).toContain('Определение');
    expect(generateDesignPackage(spec, 'uz-cyrl', 'x')).toContain('Таъриф');
  });

  it('varies with the spec choices', () => {
    const variant: DesignSpec = { ...spec, boxes: 'frame', headings: 'circle', page: { margins: 'wide', header: 'none' }, drawings: 'playful', icons: false, titleBanner: false, fonts: { ...spec.fonts, mathLetters: 'math', size: 12 } };
    const sty = generateDesignPackage(variant, 'uz-latn', 'x');
    expect(sty).toContain('\\dz@numbercircle{\\thesection}');
    expect(sty).toContain('marginparwidth=3.6cm');
    expect(sty).toContain('\\marginpar');
    expect(sty).not.toContain('fancyhdr');
    expect(sty).not.toContain('\\renewcommand{\\maketitle}');
    expect(sty).not.toContain('range=it/');
    expect(sty).toContain('random steps');
    expect(sty).toContain('\\@setfontsize\\normalsize{12}{14.5}');
  });

  it('rejects unknown fonts, bad colours and extra keys; keeps names out of TeX', () => {
    expect(designSpecSchema.safeParse({ ...spec, fonts: { ...spec.fonts, body: 'Comic Sans' } }).success).toBe(false);
    expect(designSpecSchema.safeParse({ ...spec, colors: { ...spec.colors, primary: 'red}\\input{/etc/passwd}' } }).success).toBe(false);
    expect(designSpecSchema.safeParse({ ...spec, hack: 1 }).success).toBe(false);
    const sty = generateDesignPackage(spec, 'uz-latn', 'Ism\n\\input{x}%');
    expect(sty.split('\n')[0]).toBe('% dizayn.sty — Oversells design "Isminputx".');
  });

  it('adds \\usepackage{dizayn} before \\begin{document} once', () => {
    const doc = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nx\n\\end{document}\n';
    const once = withDesignPackage(doc)!;
    expect(once).toContain('\\usepackage{dizayn} % Oversells dizayni (dizayn.sty)\n\\begin{document}');
    expect(loadsDesign(once)).toBe(true);
    expect(withDesignPackage(once)).toBeNull();
    expect(loadsDesign('% \\usepackage{dizayn}')).toBe(false);
    expect(withDesignPackage('no document')).toBeNull();
    expect(designLanguageFor('ru')).toBe('ru');
    expect(designLanguageFor('off')).toBe('uz-latn');
  });
});

describe('designs API', () => {
  let ctx: TestContext | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  it('lists built-in designs and renders their previews once (cached)', async () => {
    const runner = new FakeRunner();
    ctx = await createTestContext(runner);
    const list = (await ctx.client().inject('/api/designs')).json().designs;
    expect(list).toHaveLength(6);
    expect(list[0]).toMatchObject({ id: 'zamonaviy', builtIn: true, name: { uz: 'Zamonaviy darslik' } });
    expect(list[0].hash).toMatch(/^[0-9a-f]{24}$/);

    const png = await ctx.client().inject('/api/designs/zamonaviy/preview.png');
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.equals(FAKE_PNG)).toBe(true);
    const pdf = await ctx.client().inject('/api/designs/zamonaviy/showcase.pdf');
    expect(pdf.rawPayload.equals(FAKE_PDF)).toBe(true);
    expect(runner.requests).toHaveLength(1);
    const req = runner.requests[0]!;
    expect(req.preview).toBe(true);
    expect(req.files.map((f) => f.path).sort()).toEqual(['dizayn.sty', 'main.tex']);
    // Render jobs leave no rows and no inputs behind.
    expect(await ctx.prisma.compileJob.count()).toBe(0);
    expect((await ctx.client().inject(`/api/designs/previews/${list[0].hash}.png`)).statusCode).toBe(200);
    expect((await ctx.client().inject('/api/designs/previews/../../x.png')).statusCode).toBe(404);
    expect((await ctx.client().inject('/api/designs/nope/preview.png')).statusCode).toBe(404);
  });

  it('reports a design whose showcase does not compile', async () => {
    const runner = new FakeRunner();
    runner.result = () => ({ status: 'failed', exitCode: 1, log: '! error', console: '', pdf: null, synctex: null, errorMessage: null });
    ctx = await createTestContext(runner);
    const res = await ctx.api.inject({ method: 'POST', url: '/api/designs/preview', payload: { spec } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('design_failed');
  });

  it('lets users create, preview, change and delete their own designs', async () => {
    ctx = await createTestContext(new FakeRunner());
    expect((await ctx.client().inject({ method: 'POST', url: '/api/designs', payload: { name: 'x', spec } })).statusCode).toBe(401);
    const created = await ctx.api.inject({ method: 'POST', url: '/api/designs', payload: { name: 'Mening dizaynim', spec: { ...spec, colors: { ...spec.colors, primary: '#AA0000' } } } });
    expect(created.statusCode).toBe(201);
    const d = created.json().design;
    expect(d).toMatchObject({ builtIn: false, name: { uz: 'Mening dizaynim' } });
    expect((await ctx.api.inject({ method: 'POST', url: '/api/designs', payload: { name: 'x', spec: { ...spec, boxes: 'zigzag' } } })).json().error.code).toBe('invalid_design');

    const list = (await ctx.api.inject('/api/designs')).json().designs;
    expect(list).toHaveLength(7);
    // Other users do not see it.
    const other = ctx.client();
    await other.register('other@test.uz');
    expect((await other.inject('/api/designs')).json().designs).toHaveLength(6);
    expect((await other.inject(`/api/designs/${d.id}/preview.png`)).statusCode).toBe(404);
    expect((await other.inject({ method: 'DELETE', url: `/api/designs/${d.id}` })).statusCode).toBe(404);

    const preview = await ctx.api.inject({ method: 'POST', url: '/api/designs/preview', payload: { spec: d.spec } });
    expect(preview.json().hash).toBe(d.hash);
    const sty = await ctx.api.inject(`/api/designs/${d.id}/dizayn.sty?lang=ru`);
    expect(sty.body).toContain('{AA0000}');
    expect(sty.body).toContain('Определение');

    const renamed = await ctx.api.inject({ method: 'PATCH', url: `/api/designs/${d.id}`, payload: { name: 'Yangi nom' } });
    expect(renamed.json().design.name.uz).toBe('Yangi nom');
    expect((await ctx.api.inject({ method: 'DELETE', url: `/api/designs/${d.id}` })).statusCode).toBe(204);
    expect((await ctx.api.inject('/api/designs')).json().designs).toHaveLength(6);
  });

  it('applies a design to a project: writes dizayn.sty and loads it from the main file', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'D', template: 'blank' } })).json().project;
    expect(p.designId).toBeNull();
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/design`, payload: { designId: 'klassik' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mainChanged: true, file: { path: 'dizayn.sty' }, project: { designId: 'klassik' } });
    const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files as Array<{ id: string; path: string }>;
    const main = files.find((f) => f.path === 'main.tex')!;
    const text = (await ctx.api.inject(`/api/projects/${p.id}/files/${main.id}`)).body;
    expect(text).toContain('\\usepackage{dizayn}');
    const styId = files.find((f) => f.path === 'dizayn.sty')!.id;
    expect((await ctx.api.inject(`/api/projects/${p.id}/files/${styId}`)).body).toContain('{7A1F2B}');

    // Switching the design replaces the file and leaves the main file alone; titles follow the language.
    await ctx.api.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { spellLanguage: 'ru' } });
    const again = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/design`, payload: { designId: 'yorqin' } });
    expect(again.json().mainChanged).toBe(false);
    const sty = (await ctx.api.inject(`/api/projects/${p.id}/files/${styId}`)).body;
    expect(sty).toContain('{6D28D9}');
    expect(sty).toContain('Определение');
    expect((await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files.filter((f: { path: string }) => f.path === 'dizayn.sty')).toHaveLength(1);

    // Viewers and strangers cannot.
    const link = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/share-links`, payload: { role: 'viewer' } })).json().link;
    const viewer = ctx.client(link.token);
    await viewer.register('viewer@test.uz');
    expect((await viewer.inject({ method: 'POST', url: `/api/projects/${p.id}/design`, payload: { designId: 'klassik' } })).statusCode).toBe(403);
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/design`, payload: { designId: 'nope' } })).statusCode).toBe(404);
  });

  it('creates template projects with their design', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'T', template: 'textbook' } })).json().project;
    expect(p.designId).toBe('zamonaviy');
    const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files as Array<{ path: string }>;
    expect(files.map((f) => f.path)).toContain('dizayn.sty');
  });
});
