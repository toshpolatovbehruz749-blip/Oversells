import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** All projects download as one backup ZIP and come back from it. */
test('download a backup of all projects and restore it', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('backup'));
  await createFromTemplate(page, 'textbook', 'Zaxira darsligi');
  await page.goto('/');

  const download = page.waitForEvent('download');
  await page.getByTestId('backup-download').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^oversells-zaxira-\d{4}-\d{2}-\d{2}\.zip$/);
  const zip = readFileSync((await file.path())!);

  await page.getByTestId('backup-input').setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/zip', buffer: zip });
  await expect(page.getByText('1 ta loyiha tiklandi')).toBeVisible();
  await expect(page.locator('.project-link', { hasText: 'Zaxira darsligi' })).toHaveCount(2);
});
