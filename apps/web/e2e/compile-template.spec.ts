import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/**
 * Full user flow in a real browser: create a project from the Uzbek template,
 * compile it in the Docker sandbox, see the PDF, break the document, and jump
 * from the error list to the offending line.
 */
test('register, create from the textbook template, compile, see PDF, jump to error', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('textbook'));
  const projectId = await createFromTemplate(page, 'textbook', `E2E darslik ${Date.now()}`);

  // Editor opens with the main file of the template.
  await expect(page.locator('.cm-content')).toContainText('\\babelprovide[import=uz-Latn, main]{uzbek}');
  await expect(page.locator('.tree-row.selected')).toContainText('main.tex');

  // Compile and wait for the rendered PDF pages.
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('[data-testid="pdf-pages"] canvas').first()).toBeVisible();
  expect(await page.locator('[data-testid="pdf-pages"] canvas').count()).toBeGreaterThanOrEqual(2);

  // The same PDF is downloadable through the API.
  const latest = await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json();
  const pdf = await page.request.get(`/api/projects/${projectId}/compile/${latest.job.id}/output.pdf?download=1`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  expect(latest.job.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);

  // Break the included chapter file; auto-save kicks in.
  await page.locator('.tree-row', { hasText: 'kirish.tex' }).click();
  await expect(page.getByTestId('open-file-path')).toHaveText('bolimlar/kirish.tex');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('\\notacommand\n');
  await expect(page.getByTestId('save-state')).toHaveText('Saqlandi');

  // Switch back to main.tex, compile with the keyboard shortcut.
  await page.locator('.tree-row', { hasText: 'main.tex' }).click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Xatolar bilan yakunlandi');

  // Clicking the error opens the file and puts the cursor on the line.
  const entry = page.locator('.level-error .log-entry').first();
  await expect(entry).toContainText('bolimlar/kirish.tex, 1-qator');
  await expect(entry).toContainText('Undefined control sequence');
  await entry.click();
  await expect(page.getByTestId('open-file-path')).toHaveText('bolimlar/kirish.tex');
  await expect(page.locator('.cm-activeLine')).toContainText('\\notacommand');

  // Switching the UI language works.
  await page.getByLabel('Til').selectOption('en');
  await expect(page.getByRole('button', { name: /Compile/ })).toBeVisible();
  await page.getByLabel('Language').selectOption('uz');

  // Clean up through the UI's session (the API needs the CSRF header).
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  const del = await page.request.delete(`/api/projects/${projectId}`, { headers: { 'x-csrf-token': csrf } });
  expect(del.status()).toBe(204);
});
