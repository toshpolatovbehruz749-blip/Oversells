import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** The "Test" button turns the question bank into variants, an answer sheet and the key. */
test('make test variants from the question bank', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('test'));
  await createFromTemplate(page, 'test', `Nazorat ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('test-button').click();
  const dialog = page.getByTestId('test-dialog');
  await expect(dialog.getByTestId('test-bank')).toHaveValue('savollar.tex');
  await dialog.getByTestId('test-name').fill('Algebra. 8-sinf');
  await dialog.getByTestId('test-variants').selectOption('2');
  await dialog.getByTestId('test-space').selectOption('small');
  await dialog.getByTestId('test-qr').fill('https://t.me/kanal/12?a=1&b=2');
  await dialog.getByTestId('test-create').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Test tayyor: 10 ta savol')).toBeVisible();

  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  // Two variants of two pages each (with space for the working), the answer sheet and the key.
  await expect(page.locator('.page-count')).toContainText('/ 6');
  // Answers laid out by testlar.sty, space for the working, a QR code on the answer sheet.
  await expect(page.locator('.cm-content')).toContainText('\\setlength\\testyechim{1.5cm}');
  await expect(page.locator('.cm-content')).toContainText('}{0}{%');
  const projectId = page.url().split('/project/')[1]!;
  const files = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project.files;
  const test = files.find((f: { path: string }) => f.path === 'test.tex');
  const tex = await (await page.request.get(`/api/projects/${projectId}/files/${test.id}`)).text();
  expect(tex).toContain('\\testqr{https://t.me/kanal/12?a=1\\&b=2}');
});
