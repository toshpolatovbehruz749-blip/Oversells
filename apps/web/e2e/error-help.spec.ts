import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** Errors are explained in Uzbek, and one click fixes the usual ones until the document compiles. */
test('explain LaTeX errors and fix them with one click', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('help'));
  const projectId = await createFromTemplate(page, 'blank', `Xato ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  const content = [
    '\\documentclass{article}',
    '\\usepackage{fontspec}',
    '\\setmainfont{Noto Serif}',
    '\\begin{document}',
    'Kasr $\\frca{1}{2}$ va $\\tg x$.',
    'Narx 5 & 6 soʻm, \\textcolor{red}{qizil}.',
    '\\end{document}',
    '',
  ].join('\n');
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  const main = project.files.find((f: { path: string }) => f.path === 'main.tex');
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  await page.request.put(`/api/projects/${projectId}/files/${main.id}/content`, { headers: { 'x-csrf-token': csrf }, data: { content } });
  await expect(page.locator('.cm-content')).toContainText('Narx 5 & 6');

  await page.locator('.compile-button').click();
  await expect(page.getByTestId('compile-status')).toHaveText('Xatolar bilan yakunlandi', { timeout: 120_000 });
  const help = page.getByTestId('log-help');
  await expect(help.filter({ hasText: 'Ehtimol \\frac demoqchisiz' })).toHaveCount(1);
  await expect(help.filter({ hasText: '\\textcolor buyrugʻi xcolor paketida' })).toHaveCount(1);
  await expect(help.filter({ hasText: 'Matnda \\& deb yozing' })).toHaveCount(1);

  // Click the first fix until nothing is left to fix.
  for (let round = 0; round < 6; round++) {
    const status = await page.getByTestId('compile-status').textContent();
    if (status === 'Muvaffaqiyatli') break;
    await page.getByTestId('log-quick-fix').first().click();
    await expect(page.getByTestId('compile-status')).not.toHaveText(status ?? '', { timeout: 120_000 }).catch(() => undefined);
    await expect(page.getByTestId('compile-status')).toHaveText(/Muvaffaqiyatli|Xatolar bilan yakunlandi/, { timeout: 120_000 });
  }
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('$\\frac{1}{2}$');
  await expect(editor).toContainText('Narx 5 \\& 6');
  await expect(editor).toContainText('\\usepackage{xcolor}');
  await expect(editor).toContainText('\\providecommand{\\tg}{\\operatorname{tg}}');
});
