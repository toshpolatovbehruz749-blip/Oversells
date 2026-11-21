import { expect, test } from '@playwright/test';
import { PASSWORD, registerViaUi, uniqueEmail } from './helpers';

/** «⚙ Sozlamalar»: the name, a new password (the other devices are logged out), the devices. */
test('settings: name, password and other devices', async ({ page, browser }) => {
  const email = uniqueEmail('settings');
  await registerViaUi(page, email);

  // A second device logged in with the same account.
  const phone = await browser.newContext();
  const phonePage = await phone.newPage();
  await phonePage.goto('/login');
  await phonePage.getByLabel('Elektron pochta').fill(email);
  await phonePage.getByLabel('Parol', { exact: true }).fill(PASSWORD);
  await phonePage.getByRole('button', { name: 'Kirish' }).click();
  await expect(phonePage).toHaveURL(/\/$/);

  await page.getByTestId('settings-link').click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('settings-email')).toHaveValue(email);
  await expect(page.getByTestId('settings-devices')).toContainText('Yana 1 ta');

  await page.getByTestId('settings-name').fill('Behruz ustoz');
  await page.getByTestId('settings-save-name').click();
  await expect(page.locator('.toast').last()).toContainText('Ism saqlandi');
  await expect(page.getByTestId('user-email')).toHaveText('Behruz ustoz');

  // A wrong current password, then two different new ones, then the right way.
  await page.getByTestId('settings-current').fill('notogri-parol');
  await page.getByTestId('settings-new').fill('yangi-parol-456');
  await page.getByTestId('settings-repeat').fill('yangi-parol-456');
  await page.getByTestId('settings-save-password').click();
  await expect(page.getByTestId('settings-password-error')).toHaveText('Hozirgi parol notoʻgʻri');
  await page.getByTestId('settings-current').fill(PASSWORD);
  await page.getByTestId('settings-repeat').fill('boshqa-parol-789');
  await page.getByTestId('settings-save-password').click();
  await expect(page.getByTestId('settings-password-error')).toHaveText('Ikkala yangi parol bir xil emas');
  await page.getByTestId('settings-repeat').fill('yangi-parol-456');
  await page.getByTestId('settings-save-password').click();
  await expect(page.locator('.toast').last()).toContainText('Parol almashtirildi');
  await expect(page.getByTestId('settings-devices')).toHaveText('Faqat shu qurilmada kirilgan');
  await expect(page.getByTestId('settings-logout-others')).toBeDisabled();

  // This browser stays in; the other one was logged out.
  await page.reload();
  await expect(page.getByTestId('settings-email')).toHaveValue(email);
  await phonePage.reload();
  await expect(phonePage).toHaveURL(/\/login/);
  await phone.close();
});
