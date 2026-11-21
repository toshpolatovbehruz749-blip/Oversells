import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-maxfiy-parol';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.oversells.uz`;
}

/** Registers a new account through the UI (starting from the login redirect). */
export async function registerViaUi(page: Page, email: string, name = 'E2E Oʻqituvchi') {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('link', { name: /Roʻyxatdan oʻting/ }).click();
  await page.getByLabel('Ism va familiya').fill(name);
  await page.getByLabel('Elektron pochta').fill(email);
  await page.getByLabel('Parol').fill(PASSWORD);
  await page.getByRole('button', { name: 'Roʻyxatdan oʻtish' }).click();
  await expect(page.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
}

/** Creates a project from a template in the gallery and waits for the editor. */
export async function createFromTemplate(page: Page, template: string, name: string) {
  await page.getByTestId('new-project').click();
  await expect(page.getByRole('heading', { name: 'Shablonni tanlang' })).toBeVisible();
  const card = page.locator(`[data-template="${template}"]`);
  // The preview is rendered by compiling the template on the server.
  await expect(card.locator('.template-preview.preview-ok')).toBeVisible();
  await card.getByRole('button', { name: 'Shu shablondan yaratish' }).click();
  await page.locator('#dialog-input').fill(name);
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.locator('.cm-content')).toBeVisible();
  return page.url().split('/project/')[1]!;
}
