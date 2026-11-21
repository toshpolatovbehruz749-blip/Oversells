import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** «PDF» is in the download menu before any compile: the whole book is compiled, then saved. */
test('download the PDF before compiling', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('pdf'));
  const name = `PDF ${Date.now()}`;
  await createFromTemplate(page, 'blank', name);
  await page.getByTestId('auto-compile').uncheck();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('% yangi qator');

  const download = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByTestId('download-menu').click();
  await page.getByTestId('download-pdf').click();
  await expect(page.getByTestId('download-menu')).toContainText('PDF tayyorlanmoqda');
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${name}.pdf`);
  const bytes = await (await import('node:fs/promises')).readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('.toast').last()).toContainText(`Yuklab olindi: ${name}.pdf`);
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
});
