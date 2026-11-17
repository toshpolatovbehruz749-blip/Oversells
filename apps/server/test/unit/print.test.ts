import { afterEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

describe('print settings', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('writes bosma.sty, loads it after \\documentclass, and takes it out again', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Kitob' } })).json().project;
    const mainText = async () => {
      const d = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project;
      const main = d.files.find((f: { path: string }) => f.path === 'main.tex');
      return { files: d.files, text: (await ctx.api.inject(`/api/projects/${p.id}/files/${main.id}`)).body };
    };
    const set = (payload: object) => ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/print`, payload });

    const res = await set({ format: '60x84-16', marks: true, cmyk: true, isbn: '978-9943-01-234-9' });
    expect(res.statusCode).toBe(200);
    expect(res.json().mainChanged).toBe(true);
    let { files, text } = await mainText();
    expect(files.map((f: { path: string }) => f.path)).toContain('bosma.sty');
    expect(text).toMatch(/\\documentclass(\[[^\]]*\])?\{article\}\n\\usepackage\{bosma\}/);

    // Again (another format): the file changes, the line is not doubled.
    expect((await set({ format: 'a5', marks: false, cmyk: false })).json().mainChanged).toBe(false);
    ({ text } = await mainText());
    expect(text.match(/\{bosma\}/g)).toHaveLength(1);

    expect((await set({ format: 'a5', marks: false, cmyk: false, isbn: '978-9943-01-234-0' })).json().error.code).toBe('invalid_isbn');
    expect((await set({ format: 'letter', marks: false, cmyk: false })).statusCode).toBe(400);

    const off = await ctx.api.inject({ method: 'DELETE', url: `/api/projects/${p.id}/print` });
    expect(off.json().mainChanged).toBe(true);
    ({ text } = await mainText());
    expect(text).not.toContain('{bosma}');
  });
});
