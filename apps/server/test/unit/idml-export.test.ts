import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { deflateSync } from 'node:zlib';
import { idmlToLatex } from '@oversells/shared';
import { createTestContext, multipart, type TestContext } from '../helpers/context.js';
import { FakeRunner } from '../helpers/fake-runner.js';

/** A real (tiny) PNG of w × h pixels at 300 ppi. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const phys = Buffer.alloc(9);
  phys.writeUInt32BE(11811, 0);
  phys.writeUInt32BE(11811, 4);
  phys[8] = 1;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('pHYs', phys), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('InDesign (IDML) export', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  const project = async (template: string, name = 'Ona yurt') =>
    (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name, template } })).json().project as { id: string; mainFile: string };

  it('gives a project without pictures as one .idml that the import reads back', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project('roman');
    const res = await ctx.api.inject(`/api/projects/${p.id}/idml`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.adobe.indesign-idml-package');
    expect(res.headers['content-disposition']).toContain('Ona%20yurt.idml');
    // mimetype is the first entry, stored.
    expect(res.rawPayload.subarray(30, 38).toString('latin1')).toBe('mimetype');
    expect(res.rawPayload.readUInt16LE(8)).toBe(0);
    const parts = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(res.rawPayload))).map(([k, v]) => [k, strFromU8(v)]));
    const back = idmlToLatex(parts, 'Ona yurt');
    expect(back.mainTex).toContain('Qishloq tongi');
    // The design's styles go over with their names.
    expect(back.design.paragraphStyles.length).toBeGreaterThan(3);
    expect(JSON.parse(decodeURIComponent(res.headers['x-oversells-warnings'] as string))).toEqual([]);
  });

  it('packs pictures into Links/ next to the .idml, sized from the file', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project('blank', 'Rasmli');
    const up = await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/upload?folder=rasmlar`, ...multipart([{ name: 'daryo.png', data: png(600, 400) }]) });
    expect(up.statusCode).toBe(201);
    const files = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files as { id: string; path: string }[];
    const main = files.find((f) => f.path === p.mainFile)!;
    await ctx.api.inject({
      method: 'PUT',
      url: `/api/projects/${p.id}/files/${main.id}/content`,
      payload: { content: '\\documentclass{article}\n\\begin{document}\nMatn.\n\\includegraphics[width=0.5\\linewidth]{rasmlar/daryo}\n$x^2$ va \\includegraphics{yoq.png}\n\\end{document}\n' },
    });
    const res = await ctx.api.inject(`/api/projects/${p.id}/idml`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('(InDesign).zip');
    const pkg = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(pkg).sort()).toEqual(['Links/daryo.png', 'Rasmli.idml']);
    const idml = Object.fromEntries(Object.entries(unzipSync(pkg['Rasmli.idml']!)).map(([k, v]) => [k, strFromU8(v)]));
    const story = Object.entries(idml).find(([k, v]) => k.startsWith('Stories/') && v.includes('<Rectangle'))![1];
    expect(story).toContain('LinkResourceURI="file:Links/daryo.png"');
    // 600 px at 300 ppi is 144 pt.
    expect(story).toContain('Right="144" Bottom="96"');
    const warnings = JSON.parse(decodeURIComponent(res.headers['x-oversells-warnings'] as string));
    expect(warnings).toEqual(expect.arrayContaining([{ kind: 'formulas', count: 1 }, { kind: 'missingPicture', name: 'yoq.png' }]));
  });

  it('takes the page size from the print settings', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project('blank', 'Format');
    await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/files`, payload: { path: 'bosma.sty', content: '\\PassOptionsToPackage{paperwidth=145mm,paperheight=200mm}{geometry}\n' } });
    const res = await ctx.api.inject(`/api/projects/${p.id}/idml`);
    const prefs = strFromU8(unzipSync(new Uint8Array(res.rawPayload))['Resources/Preferences.xml']!);
    expect(prefs).toContain('PageWidth="411.024"');
    expect(prefs).toContain('PageHeight="566.929"');
  });

  it('is for people who can read the project, and gone with the page design flag off', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project('blank');
    expect((await ctx.client().inject(`/api/projects/${p.id}/idml`)).statusCode).toBeGreaterThanOrEqual(401);
    await ctx.close();
    ctx = await createTestContext(new FakeRunner(), { PAGE_DESIGN_ENABLED: 'false' });
    const q = await project('blank');
    expect((await ctx.api.inject(`/api/projects/${q.id}/idml`)).statusCode).toBe(404);
  });

  it('says which InDesign the desktop app found, and nothing elsewhere', async () => {
    ctx = await createTestContext(new FakeRunner());
    expect((await ctx.api.inject('/api/features')).json().features.indesign).toBeNull();
    await ctx.close();
    const dir = await mkdtemp(path.join(tmpdir(), 'oversells-desktop-'));
    await writeFile(path.join(dir, 'indesign'), 'Adobe InDesign 2026\n');
    ctx = await createTestContext(new FakeRunner(), { DESKTOP_STATE_DIR: dir });
    expect((await ctx.api.inject('/api/features')).json().features.indesign).toBe('Adobe InDesign 2026');
    await writeFile(path.join(dir, 'indesign'), '"; rm -rf ~');
    expect((await ctx.api.inject('/api/features')).json().features.indesign).toBeNull();
  });

  it('gives the Mac helper the package once for a ticket, without a login', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = await project('roman', 'Ona yurt');
    // Nobody else's project.
    expect((await ctx.client().inject({ method: 'POST', url: `/api/projects/${p.id}/idml/ticket` })).statusCode).toBeGreaterThanOrEqual(401);
    const t = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/idml/ticket` })).json();
    expect(t.url).toBe(`oversells-indesign://open?ticket=${t.ticket}`);
    // The helper has no cookie.
    const res = await ctx.client().inject(`/api/idml-ticket/${t.ticket}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(Object.keys(unzipSync(new Uint8Array(res.rawPayload)))).toEqual(['Ona yurt.idml']);
    // Once only; and a made-up ticket is nothing.
    expect((await ctx.client().inject(`/api/idml-ticket/${t.ticket}`)).statusCode).toBe(404);
    expect((await ctx.client().inject(`/api/idml-ticket/${'x'.repeat(32)}`)).statusCode).toBe(404);
  });
});
