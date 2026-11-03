import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './helpers';

// A new visitor gets the interface in «Özbekça» (Ö Ğ Ş Ç); Oʻzbekcha stays one choice away.
test.use({ storageState: { cookies: [], origins: [] } });

test('the interface in the new letters Ö Ğ Ş Ç by default', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('.lang-switcher')).toHaveValue('oz');
  await expect(page.locator('html')).toHaveAttribute('lang', 'uz');
  await expect(page.getByText('Hisobingiz yöqmi? Röyxatdan öting')).toBeVisible();

  await page.locator('.lang-switcher').selectOption('uz');
  await expect(page.getByText('Hisobingiz yoʻqmi? Roʻyxatdan oʻting')).toBeVisible();
  await page.locator('.lang-switcher').selectOption('oz');

  await page.getByRole('link', { name: /Röyxatdan öting/ }).click();
  await page.getByLabel('Ism va familiya').fill('Öqituvçi');
  await page.getByLabel('Elektron poçta').fill(uniqueEmail('harflar'));
  await page.getByLabel('Parol').fill(PASSWORD);
  await page.getByRole('button', { name: 'Röyxatdan ötiş' }).click();
  await expect(page.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
  await page.getByTestId('new-project').click();
  await expect(page.getByRole('heading', { name: 'Şablonni tanlang' })).toBeVisible();
});
