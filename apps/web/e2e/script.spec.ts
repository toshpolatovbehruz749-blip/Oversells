import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** The whole textbook goes to Cyrillic and compiles; the button then offers the way back. */
test('change a project between Latin and Cyrillic', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('script'));
  const projectId = await createFromTemplate(page, 'textbook', `Yozuv ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('script-button').click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText(/Yozuv oʻzgartirildi/)).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('\\babelprovide[import=uz-Cyrl, main]{uzbek}');
  await expect(page.getByTestId('script-button')).toContainText('Lotin');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');

  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  const log = await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/output.log`)).text();
  expect(log.split('===== latexmk =====')[0]).not.toMatch(/Missing character/);
});

/** oʻ gʻ sh ch -> Ö Ğ Ş Ç in the whole textbook; it compiles with the letters and the button offers the way back. */
test('change a project to the letters Ö Ğ Ş Ç and back', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('letters'));
  const projectId = await createFromTemplate(page, 'textbook', `Harflar ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('letters-button').click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText(/Yozuv oʻzgartirildi/)).toBeVisible();
  await expect(page.getByTestId('letters-button')).toContainText('Oʻ Gʻ Sh Ch');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  const log = await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/output.log`)).text();
  expect(log.split('===== latexmk =====')[0]).not.toMatch(/Missing character/);

  await page.getByTestId('letters-button').click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('letters-button')).toContainText('Ö Ğ Ş Ç');
});
