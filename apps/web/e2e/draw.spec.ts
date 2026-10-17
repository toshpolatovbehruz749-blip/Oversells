import { expect, test, type Page } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** Clicks the drawing canvas at a point in drawing units (the default area is x -5..5, y -4..4). */
async function at(page: Page, x: number, y: number) {
  const p = await page.getByTestId('draw-canvas').evaluate(
    (svg: SVGSVGElement, { ux, uy }) => {
      const pt = svg.createSVGPoint();
      pt.x = (ux + 5) * 50;
      pt.y = (4 - uy) * 50;
      const q = pt.matrixTransform(svg.getScreenCTM()!);
      return { x: q.x, y: q.y };
    },
    { ux: x, uy: y },
  );
  await page.mouse.click(p.x, p.y);
}

/** A triangle, a point and a parabola drawn with the mouse become TikZ that compiles, and can be edited again. */
test('draw a figure and a graph with the mouse', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('draw'));
  const projectId = await createFromTemplate(page, 'blank', `Chizma ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  // At the start of the \end{document} line.
  await page.locator('.cm-line', { hasText: '\\end{document}' }).click();
  await page.keyboard.press('Home');
  await page.getByTestId('draw-button').click();
  const dialog = page.getByTestId('draw-dialog');
  await expect(dialog).toBeVisible();

  await page.getByTestId('draw-tool-polygon').click();
  await at(page, 0, 0);
  await at(page, 3, 0);
  await at(page, 1, 2);
  await at(page, 0, 0);
  await page.getByTestId('draw-tool-point').click();
  await at(page, 1, 2);
  await page.getByTestId('draw-fn').fill('x^2/2 - 1');
  await page.getByTestId('draw-fn-add').click();

  await dialog.locator('summary').click();
  const code = page.getByTestId('draw-code');
  await expect(code).toHaveValue(/\(0,0\) -- \(3,0\) -- \(1,2\) -- cycle;/);
  await expect(code).toHaveValue(/\\fill\[blue!70!black\] \(1,2\) circle \(1\.6pt\) node\[above right\] \{\$A\$\};/);
  await expect(code).toHaveValue(/plot \(\\x, \{\\x\^2\/2-1\}\);/);

  await page.getByTestId('draw-insert').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('\\begin{tikzpicture}');
  await expect(page.locator('.cm-content')).toContainText('\\usepackage{tikz}');

  await page.locator('.compile-button').click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });

  // The cursor inside the picture reopens it; a deleted shape disappears from the code.
  await page.locator('.cm-line', { hasText: 'circle (1.6pt)' }).click();
  await page.getByTestId('draw-button').click();
  await expect(page.getByTestId('draw-insert')).toHaveText('Chizmani yangilash');
  await page.getByTestId('draw-tool-select').click();
  await at(page, 1, 2);
  await page.getByTestId('draw-delete').click();
  await page.getByTestId('draw-insert').click();
  await expect(page.locator('.cm-content')).not.toContainText('circle (1.6pt)');
  await expect(page.locator('.cm-content')).toContainText('-- cycle;');
  await expect(page.locator('.cm-content')).toContainText('\\x^2/2-1');
  // One picture, not two.
  expect(((await page.locator('.cm-content').textContent()) ?? '').split('\\begin{tikzpicture}').length).toBe(2);

  const job = (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  expect(job.status).toBe('success');
});
