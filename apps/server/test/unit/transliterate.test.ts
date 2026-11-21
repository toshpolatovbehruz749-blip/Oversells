import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('Latin <-> Cyrillic <-> Ö Ğ Ş Ç for a whole project', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('converts every .tex file, the babel setup, spelling and design titles, and keeps a version', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Darslik', template: 'textbook' } })).json().project;
    const text = async (path: string) => {
      const d = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
      const f = d.files.find((x: { path: string }) => x.path === path);
      return (await ctx.api.inject(`/api/projects/${p.id}/files/${f.id}`)).body;
    };
    const before = await text('bolimlar/kirish.tex');

    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'cyrl' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().changed).toBeGreaterThanOrEqual(2);
    const main = await text('main.tex');
    expect(main).toContain('\\babelprovide[import=uz-Cyrl, main]{uzbek}');
    expect(main).toContain('\\section{Квадрат тенглама}');
    expect(await text('dizayn.sty')).toContain('Теорема');
    const project = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    expect(project.spellLanguage).toBe('uz-cyrl');
    const versions = (await ctx.api.inject(`/api/projects/${p.id}/versions`)).json().versions;
    expect(versions.some((v: { name: string | null }) => v.name === 'Kirillga oʻtkazishdan oldin')).toBe(true);

    // And back.
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'latn' } });
    expect(await text('main.tex')).toContain('\\babelprovide[import=uz-Latn, main]{uzbek}');
    expect((await text('bolimlar/kirish.tex')).length).toBeGreaterThan(before.length * 0.9);
    expect((await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'greek' } })).statusCode).toBe(400);
  });

  it('changes oʻ gʻ sh ch to Ö Ğ Ş Ç and back, and the project remembers the letters', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Darslik', template: 'textbook' } })).json().project;
    const text = async (path: string) => {
      const d = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
      const f = d.files.find((x: { path: string }) => x.path === path);
      return (await ctx.api.inject(`/api/projects/${p.id}/files/${f.id}`)).body;
    };
    const before = await text('bolimlar/kirish.tex');
    const res = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'yangi' } });
    expect(res.statusCode).toBe(200);
    const after = await text('bolimlar/kirish.tex');
    expect(after).toContain('\\section{Kiriş}');
    expect(after).toContain('öquvçi, ğalaba, maʼlumot');
    // Comments stay as they were.
    expect(after).toContain('% Kirish boʻlimi');
    expect(await text('main.tex')).toContain('\\babelprovide[import=uz-Latn, main]{uzbek}');
    const project = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
    expect(project.spellLanguage).toBe('uz-yangi');
    const versions = (await ctx.api.inject(`/api/projects/${p.id}/versions`)).json().versions;
    expect(versions.some((v: { name: string | null }) => v.name === 'Ö Ğ Ş Ç harflariga oʻtkazishdan oldin')).toBe(true);

    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'latn' } });
    expect(await text('bolimlar/kirish.tex')).toBe(before);
    expect((await ctx.api.inject(`/api/projects/${p.id}`)).json().project.spellLanguage).toBe('uz-latn');

    // From Cyrillic, the project goes to Latin first.
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'cyrl' } });
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/transliterate`, payload: { to: 'yangi' } });
    expect(await text('bolimlar/kirish.tex')).toContain('\\section{Kiriş}');
  });
});
