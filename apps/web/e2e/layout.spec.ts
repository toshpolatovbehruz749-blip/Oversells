import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** The editor's panes are resized by dragging, the file tree and the tools fold away; all of it is kept. */
test('resize the panes, fold the files and the tools', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('panel'));
  await createFromTemplate(page, 'textbook', `Panellar ${Date.now()}`);
  const code = page.locator('.editor-pane');
  const before = (await code.boundingBox())!.width;

  // Drag the border between code and PDF 200 px to the left: the code pane gets narrower.
  const split = (await page.getByTestId('resize-split').boundingBox())!;
  await page.mouse.move(split.x + split.width / 2, split.y + split.height / 2);
  await page.mouse.down();
  await page.mouse.move(split.x + split.width / 2 - 200, split.y + split.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await code.boundingBox())!.width).toBeLessThan(before - 150);

  // The tools fold into one button, and open again.
  await expect(page.getByTestId('design-button')).toBeVisible();
  await page.getByTestId('tools-toggle').click();
  await expect(page.getByTestId('design-button')).toBeHidden();

  // The file tree folds away: the code pane gets its share of the 250 px (about a third here).
  const narrow = (await code.boundingBox())!.width;
  await page.getByTestId('toggle-tree').click();
  await expect.poll(async () => (await code.boundingBox())!.width).toBeGreaterThan(narrow + 50);

  // All of it is kept after a reload.
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('design-button')).toBeHidden();
  await expect(page.locator('.editor-layout')).toHaveClass(/tree-hidden/);
  await page.getByTestId('tools-toggle').click();
  await expect(page.getByTestId('design-button')).toBeVisible();
  await page.getByTestId('toggle-tree').click();
  await expect(page.locator('.editor-layout')).not.toHaveClass(/tree-hidden/);
});
