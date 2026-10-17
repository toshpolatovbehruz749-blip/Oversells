import { expect, test } from '@playwright/test';
import { registerViaUi, uniqueEmail } from './helpers';

const PAGES = 1000;

/** A plain book of PAGES pages, each with a heading and a formula. */
const BOOK = String.raw`\documentclass{article}
\usepackage{amsmath}
\pagestyle{plain}
\newcount\bet
\begin{document}
\bet=0
\loop
  \advance\bet by 1
  \section*{Sahifa \the\bet}
  Kvadrat tenglama: $x_{1,2}=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$.
  \newpage
\ifnum\bet<${PAGES}\repeat
\end{document}
`;

/**
 * A 1000-page book: compiles, the viewer keeps only the pages near the
 * viewport drawn, jumps to a page by number, and stays there after a recompile.
 */
test('a 1000-page book compiles and the viewer stays light', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('book'));
  const csrf = (await page.context().cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  const headers = { 'x-csrf-token': csrf };
  const created = (await (await page.request.post('/api/projects', { headers, data: { name: `Kitob ${Date.now()}` } })).json()).project;
  const project = (await (await page.request.get(`/api/projects/${created.id}`)).json()).project;
  const main = project.files.find((f: { path: string }) => f.path === 'main.tex');
  const saved = await page.request.put(`/api/projects/${project.id}/files/${main.id}/content`, { headers, data: { content: BOOK } });
  expect(saved.status()).toBe(200);

  await page.goto(`/project/${project.id}`);
  await expect(page.locator('.cm-content')).toContainText('\\newcount\\bet');
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 170_000 });
  await expect(page.locator('.page-count')).toContainText(`/ ${PAGES}`);
  await expect(page.locator('.pdf-page-wrap')).toHaveCount(PAGES);
  await expect(page.locator('.pdf-page-wrap[data-page="1"] canvas')).toBeVisible();
  // Only the pages around the viewport have a canvas.
  expect(await page.locator('[data-testid="pdf-pages"] canvas').count()).toBeLessThan(20);

  // Jump to a page by its number.
  const input = page.getByTestId('pdf-page-input');
  await input.fill('750');
  await input.press('Enter');
  const target = page.locator('.pdf-page-wrap[data-page="750"]');
  await expect(target).toBeInViewport();
  await expect(target.locator('canvas')).toBeVisible();
  await expect(page.locator('.pdf-page-wrap[data-page="1"] canvas')).toHaveCount(0);
  expect(await page.locator('[data-testid="pdf-pages"] canvas').count()).toBeLessThan(20);

  // SyncTeX works on late pages too (TeX credits text made by a \loop to its \repeat line).
  const box = (await target.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.16);
  await expect(page.locator('.cm-activeLine')).toContainText('\\repeat');

  // A recompile keeps the reader on the same page.
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 170_000 });
  await expect(input).toHaveValue('750');
  await expect(target.locator('canvas')).toBeVisible();

  await page.request.delete(`/api/projects/${project.id}`, { headers });
});
