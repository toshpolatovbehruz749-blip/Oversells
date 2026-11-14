import { expect, test, type Page } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** A Cyrillic imprint page in a document without fontspec (Latin Modern has no Cyrillic). */
const DOC = [
  '\\documentclass{article}',
  '\\usepackage{lmodern}',
  '\\begin{document}',
  'УЎК 51(075.4)',
  '',
  'КБК 22.1',
  '',
  'Тошматов А. Алгебра. — Тошкент: Iqro-nashr, 2026. — 368 б.',
  '\\end{document}',
  '',
].join('\n');

async function setMain(page: Page, projectId: string, content: string) {
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  const main = project.files.find((f: { path: string }) => f.path === 'main.tex');
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  const res = await page.request.put(`/api/projects/${projectId}/files/${main.id}/content`, {
    headers: { 'x-csrf-token': csrf },
    data: { content },
  });
  expect(res.ok()).toBe(true);
  await expect(page.locator('.cm-content')).toContainText('Iqro-nashr');
}

async function compileAndFix(page: Page, projectId: string) {
  await page.locator('.compile-button').click();
  const banner = page.getByTestId('glyph-banner');
  await expect(banner).toBeVisible({ timeout: 120_000 });
  await expect(banner).toContainText('У');
  await page.getByTestId('glyph-fix').click();
  await expect(banner).toBeHidden({ timeout: 120_000 });
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('.cm-content')).toContainText('\\setmainfont{Noto Serif}');

  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  const log = await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/output.log`)).text();
  expect(log.split('===== latexmk =====')[0]).not.toMatch(/Missing character/);
}

test('letters missing from the font are reported and fixed with one click', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('glyphs'));
  const projectId = await createFromTemplate(page, 'blank', `Shrift ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  await setMain(page, projectId, DOC);
  await compileAndFix(page, projectId);
});

test('a Cyrillic document under pdfLaTeX moves to XeLaTeX', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('glyphs-pdf'));
  const projectId = await createFromTemplate(page, 'blank', `pdfLaTeX ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  await setMain(page, projectId, DOC);
  await page.locator('select').filter({ hasText: 'XeLaTeX' }).first().selectOption('pdflatex');
  await expect.poll(async () => (await (await page.request.get(`/api/projects/${projectId}`)).json()).project.compiler).toBe('pdflatex');
  await compileAndFix(page, projectId);
  expect((await (await page.request.get(`/api/projects/${projectId}`)).json()).project.compiler).toBe('xelatex');
});

/** Books written for pdfLaTeX (Overleaf): the editor offers pdfLaTeX before anything is lost. */
async function switchToPdflatex(page: Page, projectId: string) {
  const hint = page.getByTestId('compiler-hint');
  await expect(hint).toContainText('pdfLaTeX uchun yozilgan');
  await page.getByTestId('compiler-hint-switch').click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });
  await expect(hint).toHaveCount(0);
  await expect(page.getByTestId('glyph-banner')).toHaveCount(0);
  expect((await (await page.request.get(`/api/projects/${projectId}`)).json()).project.compiler).toBe('pdflatex');
  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  expect(job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);
}

test('a Russian pdfLaTeX preamble (T2A) is switched to pdfLaTeX', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('glyphs-t2a'));
  const projectId = await createFromTemplate(page, 'blank', `T2A ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  await setMain(
    page,
    projectId,
    DOC.replace(
      '\\usepackage{lmodern}',
      '\\usepackage[utf8]{inputenc}\n\\usepackage[T2A,T1]{fontenc}\n\\usepackage{lmodern}\n\\usepackage[russian]{babel}\n\\usepackage{sectsty}\n\\sectionfont{\\sffamily}',
    ).replace('КБК 22.1', '\\section{Числа} КБК 22.1'),
  );
  await switchToPdflatex(page, projectId);
});

test('an Uzbek pdfLaTeX book with Palatino keeps its fonts', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('glyphs-pazo'));
  const projectId = await createFromTemplate(page, 'blank', `Palatino ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  await setMain(
    page,
    projectId,
    '\\documentclass{book}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{mathpazo}\n\\usepackage[scaled=.92]{helvet}\n\\begin{document}\nKoʻrsatkichli funksiya, maʼno. Iqro-nashr\n\\end{document}\n',
  );
  await switchToPdflatex(page, projectId);
});
