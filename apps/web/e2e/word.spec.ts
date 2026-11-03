import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerViaUi, uniqueEmail } from './helpers';

const docx = path.join(path.dirname(fileURLToPath(import.meta.url)), 'darslik.docx');

/** A Word document becomes a project that compiles; the project downloads as Word and EPUB. */
test('import from Word, compile, export to Word and EPUB', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('word'));
  await page.getByTestId('import-word-input').setInputFiles({ name: 'Kvadrat tenglamalar.docx', mimeType: 'application/octet-stream', buffer: (await import('node:fs')).readFileSync(docx) });
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.locator('.project-name')).toHaveText('Kvadrat tenglamalar');
  await expect(page.locator('.tree-row', { hasText: 'media' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('\\documentclass');

  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('[data-testid="pdf-pages"] canvas').first()).toBeVisible();

  for (const id of ['export-docx', 'export-epub']) {
    const download = page.waitForEvent('download');
    await page.getByTestId(id).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Kvadrat tenglamalar\.(docx|epub)$/);
  }
});
