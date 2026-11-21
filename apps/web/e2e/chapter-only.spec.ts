import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** "Faqat shu bob": only the chapter with the cursor is compiled; "Butun kitob" brings the whole book back. */
test('compile only the chapter around the cursor', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('chapter'));
  const projectId = await createFromTemplate(page, 'blank', `Bob ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  const chapter = (n: number) => [`\\chapter{Bob ${n}}`, ...Array.from({ length: 4 }, (_, i) => `Bob ${n} paragraf ${i}. \\clearpage`)];
  const content = ['\\documentclass{book}', '\\begin{document}', ...chapter(1), ...chapter(2), ...chapter(3), '\\end{document}', ''].join('\n');
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  const main = project.files.find((f: { path: string }) => f.path === 'main.tex');
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  await page.request.put(`/api/projects/${projectId}/files/${main.id}/content`, { headers: { 'x-csrf-token': csrf }, data: { content } });
  await expect(page.locator('.cm-content')).toContainText('Bob 3 paragraf 3');

  // The cursor in chapter 2, then the switch.
  await page.locator('.cm-line', { hasText: 'Bob 2 paragraf 2.' }).click();
  await page.getByTestId('chapter-only').check();
  await expect(page.getByTestId('chapter-bar')).toContainText('Faqat bob: «Bob 2»', { timeout: 120_000 });
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  const log = await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/output.log`)).text();
  expect(log).toContain('Chapter 2.');
  expect(log).not.toContain('Chapter 1.');

  // The switch is remembered; the whole book on request.
  await page.getByTestId('whole-book').click();
  await expect(page.getByTestId('chapter-bar')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('chapter-only')).toBeChecked();
  const whole = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  expect(whole.preview).toBeNull();
});
