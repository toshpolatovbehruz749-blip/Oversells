import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, multipart, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('files API', () => {
  let ctx: TestContext;
  let pid: string;
  const base = () => `/api/projects/${pid}`;

  beforeEach(async () => {
    ctx = await createTestContext(new FakeRunner(), {
      MAX_UPLOAD_BYTES: '1024',
      MAX_TEXT_FILE_BYTES: '512',
      MAX_FILES_PER_PROJECT: '6',
    });
    pid = (await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'T', template: 'blank' } })).json().project.id;
  });
  afterEach(() => ctx.close());

  const createFile = (path: string, content?: string) =>
    ctx.app.inject({ method: 'POST', url: `${base()}/files`, payload: { path, content } });
  const upload = (files: Parameters<typeof multipart>[0], query = '') =>
    ctx.app.inject({ method: 'POST', url: `${base()}/upload${query}`, ...multipart(files) });

  it('creates, reads, saves, renames and deletes a text file', async () => {
    const created = await createFile('bolimlar/ikkinchi.tex', 'Oʻzbekcha: gʻ ʼ — Ўзбек');
    expect(created.statusCode).toBe(201);
    const file = created.json().file;
    expect(file).toMatchObject({ path: 'bolimlar/ikkinchi.tex', kind: 'text' });

    const save = await ctx.app.inject({
      method: 'PUT',
      url: `${base()}/files/${file.id}/content`,
      payload: { content: 'Yangi matn: oʻquvchi' },
    });
    expect(save.json().file.size).toBe(Buffer.byteLength('Yangi matn: oʻquvchi'));
    expect((await ctx.app.inject({ url: `${base()}/files/${file.id}` })).body).toBe('Yangi matn: oʻquvchi');

    const moved = await ctx.app.inject({ method: 'PATCH', url: `${base()}/files/${file.id}`, payload: { path: 'qism/2.tex' } });
    expect(moved.json().file.path).toBe('qism/2.tex');
    expect((await ctx.app.inject({ url: `${base()}/files/${file.id}` })).body).toBe('Yangi matn: oʻquvchi');

    expect((await ctx.app.inject({ method: 'DELETE', url: `${base()}/files/${file.id}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ url: `${base()}/files/${file.id}` })).statusCode).toBe(404);
  });

  it.each([
    ['../escape.tex', 'invalid_path:traversal'],
    ['/etc/passwd.tex', 'invalid_path:absolute'],
    ['a\\b.tex', 'invalid_path:backslash'],
    ['.latexmkrc', 'invalid_path:reserved'],
    ['run.sh', 'invalid_path:extension'],
    ['pic.png', 'not_text_file'],
  ])('rejects creating %j', async (path, code) => {
    const res = await createFile(path);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it('rejects duplicates and file/folder clashes', async () => {
    expect((await createFile('main.tex')).json().error.code).toBe('file_exists');
    expect((await createFile('main.tex/x.tex')).json().error.code).toBe('path_conflict');
    await createFile('ch/a.tex');
    const other = (await createFile('ch2.tex')).json().file;
    const res = await ctx.app.inject({ method: 'PATCH', url: `${base()}/files/${other.id}`, payload: { path: 'main.tex' } });
    expect(res.statusCode).toBe(409);
  });

  it('enforces the text size limit', async () => {
    const res = await createFile('big.tex', 'x'.repeat(513));
    expect(res.statusCode).toBe(413);
    const file = (await createFile('small.tex', 'x')).json().file;
    const save = await ctx.app.inject({ method: 'PUT', url: `${base()}/files/${file.id}/content`, payload: { content: 'y'.repeat(600) } });
    expect(save.statusCode).toBe(413);
  });

  it('enforces the files-per-project limit', async () => {
    for (let i = 0; i < 5; i++) expect((await createFile(`f${i}.tex`)).statusCode).toBe(201);
    expect((await createFile('f6.tex')).json().error.code).toBe('too_many_files');
  });

  it('uploads with sanitised names into a folder', async () => {
    const res = await upload(
      [
        { name: 'Расм 1.PNG', data: PNG },
        { name: '../../evil/refs.bib', data: '@book{a, title={Ўзбек}}' },
      ],
      '?folder=rasmlar',
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().files.map((f: { path: string; kind: string }) => [f.path, f.kind])).toEqual([
      ['rasmlar/Rasm_1.png', 'binary'],
      ['rasmlar/refs.bib', 'text'],
    ]);
    const png = res.json().files[0];
    const raw = await ctx.app.inject({ url: `${base()}/files/${png.id}` });
    expect(raw.headers['content-type']).toBe('image/png');
    expect(raw.headers['x-content-type-options']).toBe('nosniff');
    expect(raw.headers['content-security-policy']).toContain('sandbox');
    expect(raw.rawPayload.equals(PNG)).toBe(true);
  });

  it('rejects disallowed, oversized, non-UTF-8 and duplicate uploads', async () => {
    expect((await upload([{ name: 'x.svg', data: '<svg/>' }])).json().error.code).toBe('invalid_path:extension');
    expect((await upload([{ name: 'x.exe', data: 'MZ' }])).json().error.code).toBe('invalid_path:extension');
    expect((await upload([{ name: 'big.png', data: Buffer.alloc(2048) }])).statusCode).toBe(413);
    expect((await upload([{ name: 'cp1251.tex', data: Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]) }])).json().error.code).toBe('not_utf8');
    expect((await upload([{ name: 'a.png', data: PNG }], '?folder=../x')).json().error.code).toBe('invalid_path:traversal');

    expect((await upload([{ name: 'main.tex', data: 'new' }])).json().error.code).toBe('file_exists');
    const over = await upload([{ name: 'main.tex', data: '﻿new content' }], '?overwrite=true');
    expect(over.statusCode).toBe(201);
    const main = over.json().files[0];
    expect((await ctx.app.inject({ url: `${base()}/files/${main.id}` })).body).toBe('new content'); // BOM stripped
  });

  it('keeps the main file in sync when it is renamed', async () => {
    const detail = (await ctx.app.inject({ url: base() })).json().project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    await ctx.app.inject({ method: 'PATCH', url: `${base()}/files/${main.id}`, payload: { path: 'src/kitob.tex' } });
    expect((await ctx.app.inject({ url: base() })).json().project.mainFile).toBe('src/kitob.tex');
  });

  it('renames and deletes folders', async () => {
    await createFile('qism/a.tex');
    await createFile('qism/sub/b.tex');
    const main = (await ctx.app.inject({ url: base() })).json().project.files.find((f: { path: string }) => f.path === 'main.tex');
    await ctx.app.inject({ method: 'PATCH', url: `${base()}/files/${main.id}`, payload: { path: 'qism/main.tex' } });

    const renamed = await ctx.app.inject({ method: 'POST', url: `${base()}/folders/rename`, payload: { from: 'qism', to: 'bob/1' } });
    expect(renamed.json()).toEqual({ moved: 3 });
    const project = (await ctx.app.inject({ url: base() })).json().project;
    expect(project.files.map((f: { path: string }) => f.path)).toEqual(['bob/1/a.tex', 'bob/1/main.tex', 'bob/1/sub/b.tex']);
    expect(project.mainFile).toBe('bob/1/main.tex');

    expect((await ctx.app.inject({ method: 'POST', url: `${base()}/folders/rename`, payload: { from: 'bob', to: 'bob/x' } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'POST', url: `${base()}/folders/rename`, payload: { from: '../bob', to: 'x' } })).statusCode).toBe(400);

    const del = await ctx.app.inject({ method: 'DELETE', url: `${base()}/folders?path=bob/1/sub` });
    expect(del.json()).toEqual({ deleted: 1 });
    expect((await ctx.app.inject({ method: 'DELETE', url: `${base()}/folders?path=nothing` })).statusCode).toBe(404);
  });

  it('does not expose files of another project', async () => {
    const other = (await ctx.app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'O', template: 'blank' } })).json().project;
    const otherFile = (await ctx.app.inject({ url: `/api/projects/${other.id}` })).json().project.files[0];
    expect((await ctx.app.inject({ url: `${base()}/files/${otherFile.id}` })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `${base()}/files/${otherFile.id}` })).statusCode).toBe(404);
  });
});
