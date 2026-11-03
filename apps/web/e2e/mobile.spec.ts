import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueEmail } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('on a phone: one pane at a time, compile, read and download the PDF, small edits', async ({ page }) => {
  // The page never scrolls sideways.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await registerViaUi(page, uniqueEmail('phone'));
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByTestId('new-project').tap();
  const card = page.locator('[data-template="worksheet"]');
  await expect(card.locator('.template-preview.preview-ok')).toBeVisible();
  await card.getByRole('button', { name: 'Shu shablondan yaratish' }).tap();
  await page.locator('#dialog-input').fill(`Telefon ${Date.now()}`);
  await page.getByRole('button', { name: 'OK' }).tap();
  await expect(page).toHaveURL(/\/project\//);
  expect(await overflow()).toBeLessThanOrEqual(0);

  // The PDF pane is shown first; the file tree and the code are one tap away.
  await expect(page.locator('.output-pane')).toBeVisible();
  await expect(page.locator('.file-tree')).toBeHidden();
  await expect(page.locator('.editor-pane')).toBeHidden();

  await page.getByTestId('mobile-compile').tap();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const firstPage = page.locator('.pdf-page-wrap[data-page="1"] canvas');
  await expect(firstPage).toBeVisible();
  // The rendered page fits the phone's width.
  expect((await firstPage.boundingBox())!.width).toBeLessThanOrEqual(390);
  await expect(page.getByTestId('download-pdf')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('phone-pdf.png') });

  // Open a file from the tree: the code pane takes over.
  await page.getByTestId('mobile-files').tap();
  await expect(page.locator('.file-tree')).toBeVisible();
  await expect(page.locator('.output-pane')).toBeHidden();
  await page.locator('.tree-row', { hasText: 'main.tex' }).tap();
  await expect(page.locator('.editor-pane')).toBeVisible();
  await expect(page.getByTestId('open-file-path')).toHaveText('main.tex');
  await page.locator('.cm-content').tap();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% telefondan tuzatildi');
  await expect(page.locator('.cm-content')).toContainText('telefondan tuzatildi');
  await expect(page.getByTestId('save-state')).toHaveText('Saqlandi');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath('phone-code.png') });

  // Compiling from the code pane brings the PDF back.
  await page.getByTestId('mobile-compile').tap();
  await expect(page.locator('.output-pane')).toBeVisible();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
});
