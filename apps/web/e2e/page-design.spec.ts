import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/**
 * «Sahifa dizayni» (behind PAGE_DESIGN_ENABLED): change a style and the running
 * heads, apply a paragraph and a character style to the code, and compile.
 * Skipped when the server under test has the feature off.
 */
test('page design: styles and master pages', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('sahifa'));
  await createFromTemplate(page, 'textbook', `Sahifa ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('page-design-button').click();
  const dialog = page.getByTestId('page-design-dialog');
  await expect(dialog).toBeVisible();

  // A style: «Iqtibos» gets 13 pt.
  await dialog.getByTestId('pd-style-iqtibos').click();
  await dialog.getByTestId('pd-size').fill('13');
  // A master: page number at the bottom right of odd pages.
  await dialog.getByTestId('pd-tab-masters').click();
  await dialog.getByTestId('pd-master-asosiy').click();
  await dialog.getByTestId('pd-slot-odd-foot-right').selectOption('page');
  await dialog.getByTestId('pd-tab-book').click();
  await dialog.getByTestId('pd-book-title').fill('Algebra');
  await dialog.getByTestId('pd-save').click();
  await expect(dialog.getByTestId('pd-notice')).toHaveText('Saqlandi: sahifa.sty yangilandi');
  await expect(page.locator('.cm-content')).toContainText('\\usepackage{sahifa}');
  await expect(page.locator('.tree-row', { hasText: 'sahifa.sty' })).toBeVisible();

  // Apply styles to the code: the paragraph with the cursor, then a selected word.
  // The panel leaves the code usable: find the text with the editor's search, which selects it.
  const find = async (text: string) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+f');
    await page.locator('.cm-search input[name="search"]').pressSequentially(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  };
  await dialog.getByTestId('pd-tab-styles').click();
  await find('Quyida');
  await dialog.getByTestId('pd-apply-iqtibos').click();
  await expect(dialog.getByTestId('pd-notice')).toHaveText('Uslub qoʻyildi');
  await expect(page.locator('.cm-content')).toContainText('\\begin{uslub}{iqtibos}');
  await find('funksiyaning');
  await dialog.getByTestId('pd-apply-urgu').click();
  await expect(page.locator('.cm-content')).toContainText('\\matnuslubi{urgu}{funksiyaning}');

  await dialog.getByRole('button', { name: 'Bekor qilish' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
});
