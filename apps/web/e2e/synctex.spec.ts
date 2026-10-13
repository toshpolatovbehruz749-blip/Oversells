import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** A4 width in PDF points: converts PDF coordinates to CSS pixels of the rendered page. */
const A4_WIDTH_PT = 595.276;

test('SyncTeX: double-click in the PDF opens the source line, and back', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('synctex'));
  await createFromTemplate(page, 'textbook', `SyncTeX ${Date.now()}`);
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const firstPage = page.locator('.pdf-page-wrap[data-page="1"] canvas');
  await expect(firstPage).toBeVisible();

  // PDF -> source: the introduction paragraph (comes from bolimlar/kirish.tex).
  const box = (await firstPage.boundingBox())!;
  const scale = box.width / A4_WIDTH_PT;
  await page.mouse.dblclick(box.x + 200 * scale, box.y + 300 * scale);
  await expect(page.getByTestId('open-file-path')).toHaveText('bolimlar/kirish.tex');
  await expect(page.locator('.cm-activeLine')).toContainText('sahifasi. Oʻzbek lotin yozuvidagi');

  // Source -> PDF: put the cursor on a section title in main.tex and show it in the PDF.
  await page.locator('.tree-row', { hasText: 'main.tex' }).click();
  await page.locator('.cm-line', { hasText: '\\section{Kvadrat tenglama}' }).click();
  await page.getByTestId('show-in-pdf').click();
  const mark = page.getByTestId('synctex-highlight').first();
  await expect(mark).toBeVisible();
  // The highlight is on page 1, where "2 Kvadrat tenglama" is printed.
  await expect(page.locator('.pdf-page-wrap[data-page="1"] [data-testid="synctex-highlight"]')).toHaveCount(1);
  const markBox = (await mark.boundingBox())!;
  expect(markBox.width).toBeGreaterThan(50);

  // A line on page 2 (the integral section) scrolls to page 2.
  await page.locator('.cm-line', { hasText: '\\section{Integral}' }).click();
  await page.getByTestId('show-in-pdf').click();
  await expect(page.locator('.pdf-page-wrap[data-page="2"] [data-testid="synctex-highlight"]')).toHaveCount(1);
  await expect(page.locator('.pdf-page-wrap[data-page="2"] [data-testid="synctex-highlight"]')).toBeInViewport();
});
