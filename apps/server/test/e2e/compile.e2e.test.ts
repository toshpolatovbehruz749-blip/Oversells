/**
 * End-to-end: real HTTP server + PostgreSQL + Docker compile sandbox.
 * Requires Docker and the compiler image (`npm run compiler:build`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerRunner } from '../../src/compile/docker-runner.js';
import { createTestContext, type TestContext } from '../helpers/context.js';

const image = process.env.COMPILE_IMAGE ?? 'oversells-texlive:latest';
const runner = new DockerRunner({
  image,
  timeoutMs: 60_000,
  memoryMb: 1024,
  cpus: 1,
  workdirMb: 512,
  maxOutputBytes: 200 * 1024 * 1024,
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  dockerHost: process.env.DOCKER_HOST,
});
const check = await runner.check();
if (!check.ok) console.warn(`Skipping e2e compile tests: ${check.message}`);

describe.skipIf(!check.ok)('compile end-to-end (Docker sandbox)', () => {
  let ctx: TestContext;
  let base: string;

  beforeAll(async () => {
    ctx = await createTestContext(runner);
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}/api`;
    const reg = await json('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'e2e@test.uz', password: 'e2e-parol-123' }),
    });
    expect(reg.status).toBe(201);
  });
  afterAll(() => ctx?.close());

  /** fetch with a cookie jar and the CSRF header, like the browser client. */
  const jar = new Map<string, string>();
  const http = async (path: string, init: RequestInit = {}) => {
    if (!jar.has('oversells_csrf') && path !== '/auth/me') await http('/auth/me');
    const headers: Record<string, string> = {
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      'x-csrf-token': jar.get('oversells_csrf') ?? '',
    };
    if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { ...init, headers });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      jar.set(k!, v ?? '');
    }
    return res;
  };
  const json = async (path: string, init?: RequestInit) => {
    const res = await http(path, init);
    return { status: res.status, body: await res.json() };
  };

  async function compileAndPoll(projectId: string, request: object = {}) {
    const started = await json(`/projects/${projectId}/compile`, { method: 'POST', body: JSON.stringify(request) });
    expect(started.status).toBe(202);
    let job = started.body.job;
    const deadline = Date.now() + 120_000;
    while (['queued', 'running'].includes(job.status)) {
      if (Date.now() > deadline) throw new Error('compile did not finish');
      await new Promise((r) => setTimeout(r, 500));
      job = (await json(`/projects/${projectId}/compile/${job.id}`)).body.job;
    }
    return job;
  }

  it.each(['xelatex', 'lualatex'] as const)(
    'creates a project, compiles the Uzbek template with %s and returns a PDF',
    async (compiler) => {
      const created = await json('/projects', {
        method: 'POST',
        body: JSON.stringify({ name: `Darslik (${compiler})`, compiler }),
      });
      expect(created.status).toBe(201);
      const project = created.body.project;

      const job = await compileAndPoll(project.id);
      expect(job.status).toBe('success');
      expect(job.hasPdf).toBe(true);
      expect(job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);

      const pdf = await http(`/projects/${project.id}/compile/${job.id}/output.pdf`);
      expect(pdf.status).toBe(200);
      const bytes = Buffer.from(await pdf.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(20_000);

      // No "Missing character" in the log: Uzbek Latin (ʻ ʼ) and Cyrillic glyphs exist in the font.
      const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
      expect(log).toContain('Output written on main.');
      expect(log).not.toMatch(/Missing character/);

      // SyncTeX data is kept and answers both directions.
      expect(job.hasSynctex).toBe(true);
      const fwd = await json(`/projects/${project.id}/compile/${job.id}/synctex/code?file=bolimlar/kirish.tex&line=4`);
      expect(fwd.body.position.page).toBe(1);
      // Back from the middle of that line's box to the source.
      const box = fwd.body.position.boxes[0];
      const rev = await json(
        `/projects/${project.id}/compile/${job.id}/synctex/pdf?page=1&x=${box.x + box.w / 2}&y=${box.y + box.h / 2}`,
      );
      expect(rev.body.source).toMatchObject({ file: 'bolimlar/kirish.tex' });
    },
  );

  it.each(['textbook', 'worksheet', 'exam', 'test', 'olympiad', 'lesson', 'certificate', 'diploma', 'article', 'blank'])(
    'template %s compiles without errors or warnings and renders a preview',
    async (template) => {
      const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: template, template }) })).body
        .project;
      const job = await compileAndPoll(project.id);
      expect(job.status).toBe('success');
      expect(job.entries.filter((e: { level: string }) => e.level !== 'typesetting')).toEqual([]);
      const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
      // Only the final TeX log counts; latexmk's console also shows earlier passes.
      const finalLog = log.split('===== latexmk =====')[0]!;
      expect(finalLog).toMatch(/Output written on [\w-]+\.(pdf|xdv)/);
      expect(finalLog).not.toMatch(/Missing character|Warning:/);

      const preview = await http(`/templates/${template}/preview.png`);
      expect(preview.status).toBe(200);
      const png = Buffer.from(await preview.arrayBuffer());
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.length).toBeGreaterThan(1000);
    },
  );

  it('reports errors with file and line for a broken document', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Xato', template: 'blank' }) })).body.project;
    await json(`/projects/${project.id}/files`, {
      method: 'POST',
      body: JSON.stringify({ path: 'bob/xato.tex', content: 'Matn.\n\\notacommand\n' }),
    });
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    await json(`/projects/${project.id}/files/${main.id}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        content: '\\documentclass{article}\n\\begin{document}\nSalom\n\\input{bob/xato}\n\\end{document}\n',
      }),
    });
    await json(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ compiler: 'pdflatex' }) });

    const job = await compileAndPoll(project.id);
    expect(job.status).toBe('failed');
    expect(job.entries[0]).toMatchObject({
      level: 'error',
      message: 'Undefined control sequence.',
      file: 'bob/xato.tex',
      line: 2,
    });
  });

  it('reuses the auxiliary files of the last compile, so a book needs one LaTeX pass', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Kitob', template: 'blank' }) })).body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const book = (word: string) =>
      [
        '\\documentclass{book}',
        '\\begin{document}',
        '\\tableofcontents',
        ...Array.from({ length: 30 }, (_, i) => `\\chapter{Bob ${i + 1}}\\label{b${i}} ${word} \\pageref{b${(i + 7) % 30}}.`),
        '\\end{document}',
      ].join('\n');
    const save = (content: string) =>
      json(`/projects/${project.id}/files/${main.id}/content`, { method: 'PUT', body: JSON.stringify({ content }) });
    await save(book('Matn'));
    await json(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ compiler: 'pdflatex' }) });
    const passes = async (job: { id: string }) => {
      const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
      return log.match(/Run number \d+ of rule 'pdflatex'/g)?.length ?? 0;
    };

    const first = await compileAndPoll(project.id);
    expect(first.status).toBe('success');
    expect(await passes(first)).toBeGreaterThanOrEqual(2);

    await save(book('Boshqa matn'));
    const second = await compileAndPoll(project.id);
    expect(second.status).toBe('success');
    expect(await passes(second)).toBe(1);
    const log = await (await http(`/projects/${project.id}/compile/${second.id}/output.log`)).text();
    expect(log).not.toMatch(/undefined references|Label\(s\) may have changed/);
  });

  it('compiles only the chapter around the cursor ("Faqat shu bob"), with SyncTeX on the real file', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Bob', template: 'blank' }) })).body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const chapter = (n: number) => [`\\chapter{Bob ${n}}`, ...Array.from({ length: 40 }, (_, i) => `Bob ${n}, paragraf ${i}. ${'Matn '.repeat(60)}`)];
    const lines = ['\\documentclass{book}', '\\begin{document}', '\\tableofcontents', ...chapter(1), ...chapter(2), ...chapter(3), '\\end{document}'];
    await json(`/projects/${project.id}/files/${main.id}/content`, { method: 'PUT', body: JSON.stringify({ content: lines.join('\n') }) });
    const pages = async (job: { id: string }) => {
      const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
      return Number(/Output written on [\w-]+\.(?:pdf|xdv) \((\d+) pages?/.exec(log)?.[1] ?? 0);
    };

    const whole = await compileAndPoll(project.id);
    expect(whole.preview).toBeNull();
    const line = lines.indexOf('Bob 2, paragraf 10. ' + 'Matn '.repeat(60)) + 1;
    const job = await compileAndPoll(project.id, { preview: { file: 'main.tex', line } });
    expect(job.status).toBe('success');
    expect(job.preview).toEqual({ file: 'main.tex', line, label: 'Bob 2' });
    expect(await pages(job)).toBeGreaterThan(0);
    expect(await pages(job)).toBeLessThan((await pages(whole)) / 2);
    const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
    expect(log).toContain('Chapter 2.');
    expect(log).not.toContain('Chapter 1.');

    // Source -> PDF and back use main.tex and its line numbers.
    const fwd = await json(`/projects/${project.id}/compile/${job.id}/synctex/code?file=main.tex&line=${line}`);
    expect(fwd.status).toBe(200);
    const box = fwd.body.position.boxes[0];
    const rev = await json(`/projects/${project.id}/compile/${job.id}/synctex/pdf?page=${fwd.body.position.page}&x=${box.x + box.w / 2}&y=${box.y + box.h / 2}`);
    expect(rev.body.source).toMatchObject({ file: 'main.tex' });
    expect(Math.abs(rev.body.source.line - line)).toBeLessThanOrEqual(1);
  });

  it('typesets the Uzbek ʻ and ʼ with pdfLaTeX (OT1, T1 and a Russian T2A preamble)', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Okina', template: 'blank', compiler: 'pdflatex' }) }))
      .body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const preambles = ['', '\\usepackage[T1]{fontenc}', '\\usepackage[utf8]{inputenc}\n\\usepackage[T2A,T1]{fontenc}\n\\usepackage[russian]{babel}'];
    for (const preamble of preambles) {
      const content = `\\documentclass{article}\n${preamble}\n\\begin{document}\nOʻzbekiston Gʻafur maʼno O\`quv\n\\end{document}\n`;
      await json(`/projects/${project.id}/files/${main.id}/content`, { method: 'PUT', body: JSON.stringify({ content }) });
      const job = await compileAndPoll(project.id);
      expect(job.status, preamble).toBe('success');
      expect(job.entries.filter((e: { level: string }) => e.level === 'error'), preamble).toEqual([]);
    }
  });

  it.each(['xelatex', 'lualatex'] as const)('hyphenates Uzbek (Latin and Cyrillic) by the spelling rules with %s', async (compiler) => {
    const words = readFileSync(new URL('../../../../compiler/hyphenation/test-words.txt', import.meta.url), 'utf8')
      .trim()
      .split('\n')
      .map((l) => l.trim().split(/\s+/) as [string, string]);
    const cyrillic = (w: string) => /[Ѐ-ӿ]/.test(w);
    const show = (w: string) => `\\showhyphens{${w}}`;
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: `Bo'g'in ${compiler}`, template: 'blank', compiler }) })).body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const content = [
      '\\documentclass{article}',
      '\\usepackage{fontspec}',
      '\\setmainfont{Noto Serif}',
      '\\usepackage{babel}',
      '\\babelprovide[import=uz-Latn, main]{uzbek}',
      '\\babelprovide[import=uz-Cyrl]{uzbekcyr}',
      '\\def\\uzbekhyphenmins{22}\\def\\uzbekcyrhyphenmins{22}',
      '\\begin{document}',
      ...words.filter(([w]) => !cyrillic(w)).map(([w]) => show(w)),
      '\\begin{otherlanguage}{uzbekcyr}',
      ...words.filter(([w]) => cyrillic(w)).map(([w]) => show(w)),
      '\\end{otherlanguage}',
      'Salom.',
      '\\end{document}',
    ].join('\n');
    await json(`/projects/${project.id}/files/${main.id}/content`, { method: 'PUT', body: JSON.stringify({ content }) });
    const job = await compileAndPoll(project.id);
    expect(job.status).toBe('success');
    const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
    // Only the final TeX log (latexmk's console repeats every pass).
    const finalLog = log.split('===== latexmk =====')[0]!;
    const got = [...finalLog.matchAll(/^(?:\[\] )?\\TU\/\S+ (.*)$/gm)].map((m) => m[1]!.trim());
    const expected = [...words.filter(([w]) => !cyrillic(w)), ...words.filter(([w]) => cyrillic(w))].map(([, h]) => h);
    expect(got).toEqual(expected);
  });

  it('imports a Word document (formulas, table, picture) and exports Word and EPUB', async () => {
    const docx = readFileSync(new URL('../fixtures/darslik.docx', import.meta.url));
    const form = new FormData();
    form.append('file', new Blob([docx]), 'Kvadrat tenglamalar.docx');
    const res = await http('/projects/import-docx', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const project = ((await res.json()) as { project: { id: string; name: string } }).project;
    expect(project.name).toBe('Kvadrat tenglamalar');
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const paths = detail.files.map((f: { path: string }) => f.path);
    expect(paths).toContain('main.tex');
    expect(paths.some((p: string) => /^media\/.+\.png$/.test(p))).toBe(true);
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const tex = await (await http(`/projects/${project.id}/files/${main.id}`)).text();
    expect(tex).toContain('\\frac{- b \\pm \\sqrt{b^{2} - 4ac}}{2a}');
    expect(tex).toContain('Oʻzbekiston');

    const job = await compileAndPoll(project.id);
    expect(job.status).toBe('success');
    expect(job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);

    for (const format of ['docx', 'epub']) {
      const out = await http(`/projects/${project.id}/export/${format}`);
      expect(out.status).toBe(200);
      const bytes = Buffer.from(await out.arrayBuffer());
      expect(bytes.subarray(0, 2).toString()).toBe('PK');
      expect(bytes.length).toBeGreaterThan(3000);
    }
  });

  it('prints a designed book in a book format with crop marks, CMYK and the publication data page', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Bosma', template: 'textbook' }) })).body.project;
    const set = await json(`/projects/${project.id}/print`, {
      method: 'POST',
      body: JSON.stringify({ format: '60x84-16', marks: true, cmyk: true, isbn: '978-9943-01-234-9' }),
    });
    expect(set.status).toBe(200);
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    const tex = await (await http(`/projects/${project.id}/files/${main.id}`)).text();
    await json(`/projects/${project.id}/files/${main.id}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        content: tex.replace('\\end{document}', '\\newpage\n\\nashrmalumotlari{muallif=A.~Karimov, nomi=Algebra, turi=darslik, uok=512, kbk=22.14, nashriyot=Oʻqituvchi, adadi=5000}\n\\end{document}'),
      }),
    });
    const job = await compileAndPoll(project.id);
    expect(job.status).toBe('success');
    expect(job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);
    const raw = Buffer.from(await (await http(`/projects/${project.id}/compile/${job.id}/output.pdf`)).arrayBuffer());
    // Page objects may sit in compressed object streams: inflate every stream.
    let pdf = raw.toString('latin1');
    for (const m of pdf.matchAll(/stream\r?\n/g)) {
      try {
        pdf += inflateSync(raw.subarray(m.index! + m[0].length)).toString('latin1');
      } catch {
        // not a deflated stream
      }
    }
    // 145 x 200 mm plus 15 mm on each side for the marks: 496.06 x 651.97 pt.
    expect(pdf).toMatch(/\/MediaBox\s*\[\s*0 0 496\.06\d* 651\.97\d*\s*\]/);
    const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
    expect(log.split('===== latexmk =====')[0]).not.toMatch(/Missing character/);
  });

  it('sorts an Uzbek index by the Uzbek alphabet and has Uzbek captions', () => {
    const idx = [
      'zarb', 'abtsissa', 'oʻq', 'shart', 'chiziq', 'gʻoya', 'nuqta', 'ordinata', 'tenglama', 'tenglama!kvadrat', 'ўқ', 'қалам', 'hosila|textbf',
    ]
      .map((e, i) => `\\indexentry{${e}}{${i + 1}}`)
      .join('\n');
    const script = [
      'cd /tmp',
      'cat > main.idx',
      "printf '%s' '\\babelprovide[import=uz-Latn, main]{uzbek}' > main.tex",
      'oversells-index -o /dev/stdout main.idx',
      'grep -E "^(contents|index|figure) =" "$(kpsewhich babel-uz-Latn.ini)" "$(kpsewhich babel-uz-Cyrl.ini)"',
    ].join(' && ');
    const out = execFileSync('docker', ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'sh', image, '-c', script], {
      input: idx,
      encoding: 'utf8',
    });
    const items = [...out.matchAll(/\\item (\S+),/g)].map((m) => m[1]);
    expect(items).toEqual(['abtsissa', 'hosila', 'nuqta', 'ordinata', 'tenglama', 'zarb', 'oʻq', 'gʻoya', 'shart', 'chiziq', 'ўқ', 'қалам']);
    expect(out).toContain('\\subitem kvadrat, 10');
    expect(out).toContain('\\item hosila, \\textbf{13}');
    expect(out).toContain('{\\bfseries\\large Oʻ}');
    expect(out).toContain('contents = Mundarija');
    expect(out).toContain('index = Koʻrsatkich');
    expect(out).toContain('figure = Расм');
  });

  it('keeps the sandbox closed: no shell escape, no reading system files', async () => {
    const project = (await json('/projects', { method: 'POST', body: JSON.stringify({ name: 'Sandbox', template: 'blank' }) })).body.project;
    const detail = (await json(`/projects/${project.id}`)).body.project;
    const main = detail.files.find((f: { path: string }) => f.path === 'main.tex');
    await json(`/projects/${project.id}/files/${main.id}/content`, {
      method: 'PUT',
      body: JSON.stringify({
        content: [
          '\\documentclass{article}',
          '\\begin{document}',
          '\\immediate\\write18{touch /work/pwned.tex}',
          '\\IfFileExists{pwned.tex}{SHELL-ESCAPE-WORKED}{no shell escape}',
          '\\input{/etc/passwd}',
          '\\end{document}',
        ].join('\n'),
      }),
    });
    await json(`/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify({ compiler: 'pdflatex' }) });
    const job = await compileAndPoll(project.id);
    const log = await (await http(`/projects/${project.id}/compile/${job.id}/output.log`)).text();
    expect(log).toContain('runsystem(touch /work/pwned.tex)...disabled');
    expect(log).not.toContain('root:x:0:0');
    expect(job.entries.some((e: { message: string }) => /passwd/.test(e.message))).toBe(true);
  });
});
