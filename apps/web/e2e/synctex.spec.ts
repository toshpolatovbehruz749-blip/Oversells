import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** A4 width in PDF points: converts PDF coordinates to CSS pixels of the rendered page. */
const A4_WIDTH_PT = 595.276;

test('SyncTeX: double-click in the PDF opens the source line, and back', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('synctex'));
  const projectId = await createFromTemplate(page, 'textbook', `SyncTeX ${Date.now()}`);
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const firstPage = page.locator('.pdf-page-wrap[data-page="1"] canvas');
  await expect(firstPage).toBeVisible();

  // PDF -> source: the introduction paragraph (comes from bolimlar/kirish.tex); its position
  // depends on the design, so ask the server where line 4 of kirish.tex is.
  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  const target = (
    await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/synctex/code?file=bolimlar/kirish.tex&line=4`)).json()
  ).position.boxes[0];
  const box = (await firstPage.boundingBox())!;
  const scale = box.width / A4_WIDTH_PT;
  await page.mouse.dblclick(box.x + (target.x + target.w / 2) * scale, box.y + (target.y + target.h / 2) * scale);
  await expect(page.getByTestId('open-file-path')).toHaveText('bolimlar/kirish.tex');
  await expect(page.locator('.cm-activeLine')).toContainText(/platformasida yaratilgan|sahifasi\. Oʻzbek lotin yozuvidagi/);

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

  // A section on a later page (the Cyrillic one, at the end) scrolls to that page.
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  const mainId = project.files.find((f: { path: string }) => f.path === 'main.tex').id;
  const lines = (await (await page.request.get(`/api/projects/${projectId}/files/${mainId}`)).text()).split('\n');
  const line = lines.findIndex((l) => l.startsWith('\\section{Кирилл')) + 1;
  const pos = (await (await page.request.get(`/api/projects/${projectId}/compile/${job.id}/synctex/code?file=main.tex&line=${line}`)).json()).position;
  expect(pos.page).toBeGreaterThan(1);
  // The editor renders only visible lines: scroll to the end of the file first.
  await page.locator('.cm-scroller').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await page.locator('.cm-line', { hasText: '\\section{Кирилл' }).click();
  await page.getByTestId('show-in-pdf').click();
  const later = page.locator(`.pdf-page-wrap[data-page="${pos.page}"] [data-testid="synctex-highlight"]`);
  await expect(later).toHaveCount(1);
  await expect(later).toBeInViewport();
});
