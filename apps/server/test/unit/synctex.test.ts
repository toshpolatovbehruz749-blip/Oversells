import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncTex, projectPathOf } from '../../src/synctex/synctex.js';
import { createTestContext, type TestContext } from '../helpers/context.js';
import { FAKE_PDF, FakeRunner } from '../helpers/fake-runner.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const gz = readFileSync(path.join(fixtures, 'textbook.synctex.gz'));
const sync = SyncTex.fromGzip(gz);

/** `synctex edit` results of the real CLI on a grid of points ("page x y file line"). */
const cliGrid = readFileSync(path.join(fixtures, 'textbook.synctex-cli.txt'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => l.trim().split(/\s+/))
  .filter((p) => p.length >= 5)
  .map(([page, x, y, file, line]) => ({ page: +page!, x: +x!, y: +y!, file: projectPathOf(file!), line: +line! }));

describe('SyncTeX parser (textbook template compiled with XeLaTeX)', () => {
  it('reads project inputs and pages, ignoring system and generated files', () => {
    expect([...new Set(sync.inputs.values())].sort()).toEqual(['bolimlar/kirish.tex', 'main.tex']);
    expect(sync.pageCount).toBe(2);
    expect(projectPathOf('/work/./chapters/a.tex')).toBe('chapters/a.tex');
    expect(projectPathOf('/usr/share/texlive/x.sty')).toBeNull();
    expect(projectPathOf('/work/main.aux')).toBeNull();
  });

  // Expected boxes from `synctex view` (h, v - H, W, H).
  it.each([
    ['main.tex', 44, 1, { x: 70.86615, y: 136.597244 - 20.662506, w: 453.543304, h: 20.662506 }],
    ['bolimlar/kirish.tex', 4, 1, { x: 70.86615, y: 286.088745 - 12.074715, w: 453.543304, h: 12.074715 }],
  ])('forward search %s:%i matches the synctex tool', (file, line, page, box) => {
    const r = sync.forward(file, line)!;
    expect(r.page).toBe(page);
    const b = r.boxes[0]!;
    expect(b.x).toBeCloseTo(box.x, 1);
    expect(b.y).toBeCloseTo(box.y, 1);
    expect(b.w).toBeCloseTo(box.w, 1);
    expect(b.h).toBeCloseTo(box.h, 1);
  });

  it('forward search falls back to the next line with output and finds later pages', () => {
    expect(sync.forward('main.tex', 45)!.page).toBe(1); // blank line before \\input
    expect(sync.forward('main.tex', 77)!.page).toBe(2); // the pgfplots figure
    expect(sync.forward('nope.tex', 1)).toBeNull();
  });

  it('reverse search agrees with the synctex tool on every point that lies on a text line', () => {
    const onText = cliGrid.filter(({ page, x, y }) =>
      sync.records.some(
        (r, i) =>
          r.page === page &&
          r.type === '(' &&
          r.w > 0 &&
          x >= r.x &&
          x <= r.x + r.w &&
          y >= r.y - r.h &&
          y <= r.y + r.d &&
          !sync.records.some((c) => c.parent === i && c.type === '(' && c.w > 0),
      ),
    );
    expect(onText.length).toBeGreaterThan(30);
    for (const p of onText) expect(sync.reverse(p.page, p.x, p.y), `${p.page} ${p.x} ${p.y}`).toEqual({ file: p.file, line: p.line });
  });

  it('reverse search is close to the synctex tool everywhere else (gaps, margins, figures)', () => {
    const close = cliGrid.filter((p) => {
      const r = sync.reverse(p.page, p.x, p.y);
      return r && r.file === p.file && Math.abs(r.line - p.line) <= 12;
    });
    expect(close.length / cliGrid.length).toBeGreaterThan(0.85);
  });
});

describe('SyncTeX API', () => {
  let ctx: TestContext;
  afterEach(() => ctx?.close());

  it('stores the SyncTeX file of a compile and answers both directions', async () => {
    const runner = new FakeRunner();
    runner.result = () => ({ status: 'success', exitCode: 0, log: '', console: '', pdf: FAKE_PDF, synctex: gz, errorMessage: null });
    ctx = await createTestContext(runner);
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'S' } })).json().project;
    const job = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } })).json().job;
    expect(job.hasSynctex).toBe(true);

    const fwd = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/synctex/code?file=bolimlar/kirish.tex&line=4`);
    expect(fwd.json().position).toMatchObject({ page: 1 });
    expect(fwd.json().position.boxes[0].y).toBeCloseTo(274.01, 1);

    const rev = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/synctex/pdf?page=1&x=200&y=300`);
    const kirish = (await ctx.api.inject(`/api/projects/${p.id}`)).json().project.files.find(
      (f: { path: string }) => f.path === 'bolimlar/kirish.tex',
    );
    expect(rev.json().source).toEqual({ file: 'bolimlar/kirish.tex', line: 5, fileId: kirish.id });

    expect((await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/synctex/pdf?page=1&x=a&y=1`)).statusCode).toBe(400);
    expect((await ctx.client().inject(`/api/projects/${p.id}/compile/${job.id}/synctex/code?file=main.tex&line=1`)).statusCode).toBe(404);
  });

  it('reports a compile without SyncTeX data', async () => {
    ctx = await createTestContext(new FakeRunner());
    const p = (await ctx.api.inject({ method: 'POST', url: '/api/projects', payload: { name: 'S' } })).json().project;
    const job = (await ctx.api.inject({ method: 'POST', url: `/api/projects/${p.id}/compile`, payload: { wait: true } })).json().job;
    expect(job.hasSynctex).toBe(false);
    const res = await ctx.api.inject(`/api/projects/${p.id}/compile/${job.id}/synctex/code?file=main.tex&line=1`);
    expect(res.json().error.code).toBe('no_synctex');
  });
});
