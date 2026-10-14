import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** "Bosmaxona" writes bosma.sty, loads it, compiles; it can be taken out again. */
test('print settings: book format, crop marks, ISBN', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('print'));
  await createFromTemplate(page, 'textbook', `Bosma ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('print-button').click();
  const dialog = page.getByTestId('print-dialog');
  await dialog.getByTestId('print-isbn').fill('978-9943-01-234-0');
  await expect(dialog.getByTestId('print-apply')).toBeDisabled();
  await dialog.getByTestId('print-isbn').fill('978-9943-01-234-9');
  await dialog.getByTestId('print-apply').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.tree-row', { hasText: 'bosma.sty' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('\\usepackage{bosma}');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');

  // The page is the book format plus the crop-mark margin (175 x 230 mm), not A4.
  const box = (await page.locator('.pdf-page-wrap[data-page="1"]').boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(175 / 230, 2);

  await page.getByTestId('print-button').click();
  await page.getByTestId('print-remove').click();
  await expect(page.locator('.cm-content')).not.toContainText('\\usepackage{bosma}');
});
