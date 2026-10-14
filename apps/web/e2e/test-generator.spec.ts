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
  await dialog.getByTestId('test-create').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Test tayyor: 10 ta savol')).toBeVisible();

  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  // Two variants, the answer sheet and the key.
  await expect(page.locator('.page-count')).toContainText('/ 4');
});
