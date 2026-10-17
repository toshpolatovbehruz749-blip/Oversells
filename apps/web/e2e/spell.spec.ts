import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

test('spell checking: underline, suggestions, personal dictionary', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('spell'));
  await createFromTemplate(page, 'blank', `Imlo ${Date.now()}`);
  await expect(page.getByTestId('spell-language')).toHaveValue('uz-latn');

  // Type an Uzbek sentence with a typo into the document body.
  await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Bu kitobb juda qiziqarli, Oversellsda yozilgan.');

  const typo = page.locator('.cm-spell-error', { hasText: 'kitobb' });
  await expect(typo).toBeVisible({ timeout: 20_000 });
  // Correct Uzbek words, LaTeX commands and package names are not underlined.
  await expect(page.locator('.cm-spell-error', { hasText: /^(Salom|dunyo|juda|yozilgan)$/ })).toHaveCount(0);
  await expect(page.locator('.cm-spell-error', { hasText: /documentclass|fontspec|babel/ })).toHaveCount(0);

  // Right-click shows suggestions; choosing one fixes the word.
  await typo.click({ button: 'right' });
  const menu = page.getByTestId('spell-menu');
  await expect(menu.getByRole('menuitem', { name: 'kitob', exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'kitob', exact: true }).click();
  await expect(page.locator('.cm-line', { hasText: 'Bu kitob juda qiziqarli' })).toBeVisible();
  await expect(page.locator('.cm-spell-error', { hasText: 'kitobb' })).toHaveCount(0);

  // An unknown name goes into the personal dictionary and stays accepted after a reload.
  const name = page.locator('.cm-spell-error', { hasText: 'Oversellsda' });
  await expect(name).toBeVisible();
  await name.click({ button: 'right' });
  await page.getByTestId('spell-menu').getByRole('menuitem', { name: 'Lugʻatimga qoʻshish' }).click();
  await expect(page.locator('.cm-spell-error', { hasText: 'Oversellsda' })).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.cm-line', { hasText: 'Oversellsda' })).toBeVisible();
  await page.waitForTimeout(1500); // give the checker time to run
  await expect(page.locator('.cm-spell-error', { hasText: 'Oversellsda' })).toHaveCount(0);

  // Switching the project to English underlines Uzbek words instead.
  await page.getByTestId('spell-language').selectOption('en');
  await expect(page.locator('.cm-spell-error', { hasText: 'juda' })).toBeVisible({ timeout: 20_000 });
});
