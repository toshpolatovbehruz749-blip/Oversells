import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** Typing and pausing compiles by itself; the switch turns it off (and is remembered). */
test('auto-compile after a pause in typing', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('auto'));
  const projectId = await createFromTemplate(page, 'blank', `Avto ${Date.now()}`);
  const latest = async () => (await (await page.request.get(`/api/projects/${projectId}/compile/latest`)).json()).job;
  await expect(page.getByTestId('auto-compile')).toBeChecked();

  // An edit, no click: a compile runs and its PDF is shown.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% avto');
  await expect.poll(async () => (await latest())?.status, { timeout: 60_000 }).toBe('success');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('[data-testid="pdf-pages"] canvas').first()).toBeVisible();
  const first = (await latest()).id;

  // Switched off: edits do not compile; the choice survives a reload.
  await page.getByTestId('auto-compile').uncheck();
  await page.reload();
  await expect(page.getByTestId('auto-compile')).not.toBeChecked();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% qoʻlda');
  await expect(page.getByTestId('save-state')).toHaveText('Saqlandi');
  await page.waitForTimeout(3000);
  expect((await latest()).id).toBe(first);
});
