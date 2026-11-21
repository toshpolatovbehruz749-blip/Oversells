import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('spell checking settings', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner());
  });
  afterEach(() => ctx.close());

  it('keeps a personal dictionary per user', async () => {
    expect((await ctx.api.inject('/api/me/dictionary')).json()).toEqual({ words: [] });
    for (const word of ['Oversells', 'oʻquvchilarimiz', 'Oversells']) {
      expect((await ctx.api.inject({ method: 'POST', url: '/api/me/dictionary', payload: { word } })).statusCode).toBe(201);
    }
    expect((await ctx.api.inject('/api/me/dictionary')).json().words).toEqual(['Oversells', 'oʻquvchilarimiz']);

    const other = ctx.client();
    await other.register('boshqa@test.uz');
    expect((await other.inject('/api/me/dictionary')).json().words).toEqual([]);

    await ctx.api.inject({ method: 'DELETE', url: `/api/me/dictionary/${encodeURIComponent('Oversells')}` });
    expect((await ctx.api.inject('/api/me/dictionary')).json().words).toEqual(['oʻquvchilarimiz']);

    for (const word of ['', 'two words', 'a<script>', 'x'.repeat(101)]) {
      expect((await ctx.api.inject({ method: 'POST', url: '/api/me/dictionary', payload: { word } })).statusCode).toBe(400);
    }
    expect((await ctx.client().inject('/api/me/dictionary')).statusCode).toBe(401);
  });

  it('stores the spell-check language of a project (editors may change it)', async () => {
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'S' } })).json().project;
    expect(p.spellLanguage).toBe('uz-latn');
    const res = await ctx.api.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { spellLanguage: 'ru' } });
    expect(res.json().project.spellLanguage).toBe('ru');
    expect((await ctx.api.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { spellLanguage: 'de' } })).statusCode).toBe(400);

    const token = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/share-links`, payload: { role: 'viewer' } })).json().link.token;
    const viewer = ctx.client(token);
    expect((await viewer.inject({ method: 'PATCH', url: `/api/projects/${p.id}`, payload: { spellLanguage: 'en' } })).statusCode).toBe(403);
  });
});
