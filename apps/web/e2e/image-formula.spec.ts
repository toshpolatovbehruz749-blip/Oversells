import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';
import { mockRequests } from './mock-anthropic';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** A picture of a formula becomes LaTeX (mocked Messages API) and goes into the document. */
test('formula from a picture', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('image'));
  const status = await (await page.request.get('/api/ai/status')).json();
  test.skip(!status.status.enabled, 'The server under test runs without AI (see README, Tests)');
  await createFromTemplate(page, 'blank', `Rasm ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  await page.getByTestId('image-formula-button').click();
  await page.getByTestId('image-input').setInputFiles({ name: 'formula.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('image-read').click();
  await expect(page.getByTestId('image-latex')).toHaveValue('x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}');
  const sent = (await mockRequests()).at(-1)!;
  expect(JSON.stringify(sent.body)).toContain('"media_type":"image/png"');
  await page.getByTestId('image-insert').click();
  await expect(page.getByTestId('image-formula-dialog')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('x_{1,2}=\\frac{-b\\pm\\sqrt{D}}{2a}');
});
