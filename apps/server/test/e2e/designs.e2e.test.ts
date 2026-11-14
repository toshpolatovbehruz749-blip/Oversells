/**
 * Every built-in design compiles in the real sandbox without errors or
 * warnings: the showcase (all environments and drawing helpers) and every
 * snippet of the editor's "Chizma va formulalar" menu, with XeLaTeX and
 * LuaLaTeX, and with box titles in Cyrillic and Russian.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DesignLanguage } from '@oversells/shared';
import { DockerRunner } from '../../src/compile/docker-runner.js';
import { generateDesignPackage } from '../../src/designs/generate.js';
import { loadBuiltInDesigns } from '../../src/designs/design-service.js';
import { SNIPPETS } from '../../../web/src/designs/snippets.js';

const runner = new DockerRunner({
  image: process.env.COMPILE_IMAGE ?? 'oversells-texlive:latest',
  timeoutMs: 90_000,
  memoryMb: 1024,
  cpus: 1,
  workdirMb: 512,
  maxOutputBytes: 200 * 1024 * 1024,
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
  dockerHost: process.env.DOCKER_HOST,
});
const check = await runner.check();
const designs = loadBuiltInDesigns('designs');
const showcase = readFileSync('designs/showcase/main.tex', 'utf8');

const snippetsDoc = String.raw`\documentclass[a4paper]{article}
\usepackage{fontspec}
\setmainfont{Noto Serif}
\usepackage{babel}
\babelprovide[import=uz-Latn, main]{uzbek}
\usepackage{amsmath, amssymb}
\usepackage{dizayn}
\begin{document}
\section{Andozalar}
${SNIPPETS.map((s) => `% ${s.id}\n${s.code}`).join('\n')}
\end{document}
`;

async function compile(main: string, sty: string, compiler: 'xelatex' | 'lualatex') {
  const res = await runner.run({
    jobId: `design-e2e-${Math.random().toString(36).slice(2)}`,
    compiler,
    mainFile: 'main.tex',
    files: [
      { path: 'main.tex', data: Buffer.from(main) },
      { path: 'dizayn.sty', data: Buffer.from(sty) },
    ],
  });
  return { ...res, log: res.log ?? '' };
}

function expectClean(r: { status: string; log: string; pdf: Buffer | null }) {
  const problems = r.log.split('\n').filter((l) => /^!|Warning:|Missing character|Overfull \\hbox/.test(l));
  expect(problems).toEqual([]);
  expect(r.status, (r as { errorMessage?: string | null }).errorMessage ?? "").toBe("success");
  expect(r.pdf?.subarray(0, 5).toString()).toBe('%PDF-');
}

describe.skipIf(!check.ok)('built-in designs in the sandbox', () => {
  it.each(designs.map((d) => d.id))('%s: showcase and snippets with XeLaTeX', async (id) => {
    const d = designs.find((x) => x.id === id)!;
    const sty = generateDesignPackage(d.spec, 'uz-latn', d.name.uz);
    expectClean(await compile(showcase, sty, 'xelatex'));
    expectClean(await compile(snippetsDoc, sty, 'xelatex'));
  });

  it.each(designs.map((d) => d.id))('%s: showcase with LuaLaTeX', async (id) => {
    const d = designs.find((x) => x.id === id)!;
    expectClean(await compile(showcase, generateDesignPackage(d.spec, 'uz-latn', d.name.uz), 'lualatex'));
  });

  it.each([
    ['zamonaviy', 'ru'],
    ['yorqin', 'uz-cyrl'],
    ['akademik', 'en'],
  ] as Array<[string, DesignLanguage]>)('%s with %s box titles', async (id, lang) => {
    const d = designs.find((x) => x.id === id)!;
    const r = await compile(showcase, generateDesignPackage(d.spec, lang, d.name.uz), 'xelatex');
    expectClean(r);
  });
});
