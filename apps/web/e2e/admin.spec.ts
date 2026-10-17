import { expect, test } from '@playwright/test';
import { PASSWORD, registerViaUi, uniqueEmail } from './helpers';

/**
 * Admin panel. The server under test gives the admin role to ADMIN_EMAILS;
 * the e2e setup lists the address below (see README, Tests).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.oversells.uz';

test('admin: statistics, blocking a user, access control', async ({ page, browser }) => {
  // The admin account (registered once; later runs log in).
  await page.goto('/login');
  await page.getByLabel('Elektron pochta').fill(ADMIN_EMAIL);
  await page.getByLabel('Parol').fill(PASSWORD);
  await page.getByRole('button', { name: 'Kirish' }).click();
  const loggedIn = await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 5000 })
    .then(() => true, () => false);
  if (!loggedIn) {
    await page.goto('/register');
    await page.getByLabel('Ism va familiya').fill('Bosh admin');
    await page.getByLabel('Elektron pochta').fill(ADMIN_EMAIL);
    await page.getByLabel('Parol').fill(PASSWORD);
    await page.getByRole('button', { name: 'Roʻyxatdan oʻtish' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
  const me = await (await page.request.get('/api/auth/me')).json();
  test.skip(me.user.role !== 'admin', `The server under test does not list ${ADMIN_EMAIL} in ADMIN_EMAILS`);

  // An ordinary user in a second browser context: no admin link, API refused.
  const userContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const user = await userContext.newPage();
  const userEmail = uniqueEmail('oddiy');
  await registerViaUi(user, userEmail, 'Oddiy Foydalanuvchi');
  await expect(user.getByTestId('admin-link')).toHaveCount(0);
  expect((await user.request.get('/api/admin/users')).status()).toBe(403);
  await user.goto('/admin');
  await expect(user.getByText('Bu sahifa faqat administratorlar uchun')).toBeVisible();

  // The admin opens the panel: statistics and the user list.
  await page.getByTestId('admin-link').click();
  await expect(page.getByRole('heading', { name: 'Boshqaruv paneli' })).toBeVisible();
  await expect(page.getByTestId('admin-stats')).toContainText('Kompilyatsiyalar');
  await page.getByRole('searchbox').fill(userEmail);
  const row = page.locator(`[data-testid="admin-user-row"][data-email="${userEmail}"]`);
  await expect(row).toBeVisible();
  await expect(page.getByTestId('admin-user-row')).toHaveCount(1);

  // Change the user's AI limit.
  await row.getByTestId('ai-limit').click();
  await page.locator('#dialog-input').fill('3');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(row.getByTestId('ai-limit')).toHaveText('0 / 3 *');

  // Block: the user is logged out on the next request and cannot log in again.
  await row.getByRole('button', { name: 'Bloklash' }).click();
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(row).toContainText('Bloklangan');
  await user.reload();
  await expect(user).toHaveURL(/\/login/);
  await user.getByLabel('Elektron pochta').fill(userEmail);
  await user.getByLabel('Parol').fill(PASSWORD);
  await user.getByRole('button', { name: 'Kirish' }).click();
  await expect(user.getByText('Hisobingiz bloklangan')).toBeVisible();

  // Unblock: logging in works again.
  await row.getByRole('button', { name: 'Blokdan chiqarish' }).click();
  await expect(row).not.toContainText('Bloklangan');
  await user.getByRole('button', { name: 'Kirish' }).click();
  // Back to the page the user was on (/admin, still refused for a non-admin).
  await expect(user.getByText('Bu sahifa faqat administratorlar uchun')).toBeVisible();
  await user.goto('/');
  await expect(user.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
  await userContext.close();
});
