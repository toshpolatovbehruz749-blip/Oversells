import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** "Tuzatish" fixes typing mistakes; completions insert ready code with tab stops. */
test('fix typing mistakes and complete formulas', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('aids'));
  await createFromTemplate(page, 'blank', `Yordam ${Date.now()}`);
  // No auto-compile noise while typing.
  await page.getByTestId('auto-compile').uncheck();

  const editor = page.locator('.cm-content');
  // Write after "Salom, dunyo!" (inside the document body).
  const atBody = async () => {
    await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
    await page.keyboard.press('End');
  };
  await atBody();
  await page.keyboard.insertText("\nO'zbek tilida ma'no , \"so'z\" - gap... $sin x <= 2*y$\n");
  await expect(page.getByTestId('save-state')).toHaveText('Saqlandi');

  await page.getByTestId('fix-button').click();
  const dialog = page.getByTestId('fix-dialog');
  await expect(dialog.locator('[data-rule="okina"]')).toBeVisible();
  await expect(dialog.locator('[data-rule="mathFunction"]')).toBeVisible();
  // Keep the dash as it is.
  await dialog.locator('[data-rule="dash"] input').uncheck();
  await page.getByTestId('fix-apply').click();
  await expect(dialog).toHaveCount(0);
  await expect(editor).toContainText('Oʻzbek tilida maʼno, «soʻz» - gap… $\\sin x \\leq 2\\cdot y$');

  // Opening it again finds nothing but the kept dash.
  await page.getByTestId('fix-button').click();
  await expect(dialog.locator('[data-rule]')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // \kasr -> \frac{num}{den} with tab stops.
  await atBody();
  await page.keyboard.insertText('\n$');
  await page.keyboard.type('\\kasr');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('\\frac');
  // CodeMirror ignores Enter in the first moments after the list appears.
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.keyboard.type('1');
  await page.keyboard.press('Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  // A ready formula by its Uzbek name.
  await page.keyboard.type(' pifagor');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('Pifagor');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.keyboard.type('$');
  await expect(editor).toContainText('$\\frac{1}{2} a^2+b^2=c^2$');
});
