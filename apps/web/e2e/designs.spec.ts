import { expect, test, type Page } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';
import { mockRequests } from './mock-anthropic';

async function fileText(page: Page, projectId: string, path: string): Promise<string> {
  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  const file = project.files.find((f: { path: string }) => f.path === path);
  return (await page.request.get(`/api/projects/${projectId}/files/${file.id}`)).text();
}

/**
 * Designs: pick a built-in design from the gallery (previews compiled on the
 * server), apply it with Russian box titles, insert drawings and exercises
 * from the "Chizma va formulalar" menu, make a custom design with a live
 * preview, and (with AI) derive one from pages of a book.
 */
test('designs: gallery, apply, snippets, custom design, design from a book', async ({ page }) => {
  test.setTimeout(400_000);
  await registerViaUi(page, uniqueEmail('dizayn'));
  const projectId = await createFromTemplate(page, 'blank', `Dizayn ${Date.now()}`);

  // Without a design, the snippet menu offers to choose one.
  await page.getByTestId('snippets-button').click();
  await expect(page.getByTestId('snippet-menu')).toContainText('dizayn paketidan foydalanadi');
  await page.getByRole('button', { name: 'Dizayn tanlash' }).click();

  const dialog = page.getByTestId('design-dialog');
  await expect(dialog.locator('.design-card')).toHaveCount(6);
  await expect(dialog.locator('.design-card .preview-ok')).toHaveCount(6, { timeout: 180_000 });

  // Apply "Klassik" with Russian titles: dizayn.sty is written and loaded, and the PDF is rebuilt.
  await page.getByTestId('design-lang').selectOption('ru');
  await dialog.locator('[data-design="klassik"]').getByRole('button', { name: 'Qoʻllash' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });
  await expect(page.locator('.tree-row', { hasText: 'dizayn.sty' })).toBeVisible();
  expect(await fileText(page, projectId, 'main.tex')).toContain('\\usepackage{dizayn}');
  const sty = await fileText(page, projectId, 'dizayn.sty');
  expect(sty).toContain('{7A1F2B}');
  expect(sty).toContain('Определение');

  // Insert a triangle and exercises at the cursor; the document still compiles cleanly.
  await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  for (const id of ['uchburchak', 'grafik', 'mashqlar', 'muhim']) {
    await page.getByTestId('snippets-button').click();
    await page.locator(`[data-snippet="${id}"]`).click();
  }
  await expect.poll(() => fileText(page, projectId, 'main.tex')).toContain('\\uchburchak{A}');
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });
  await expect(page.getByTestId('log-panel')).not.toContainText('Xatolar');

  // A custom design based on "Zamonaviy", with another primary colour and a live preview.
  await page.getByTestId('design-button').click();
  await dialog.locator('[data-design="zamonaviy"]').getByRole('button', { name: 'Asosida yaratish' }).click();
  const editor = page.getByTestId('spec-editor');
  await editor.getByLabel('Asosiy (sarlavha, teorema)').fill('#aa3366');
  await editor.getByLabel('Qutilar').selectOption('card');
  await dialog.getByRole('textbox', { name: 'Nomi', exact: true }).fill('Mening dizaynim');
  await expect(dialog.locator('.design-live img')).toHaveAttribute('src', /previews\/[0-9a-f]{24}\.png/, { timeout: 120_000 });
  await expect(dialog.locator('.design-live .preview-ok')).toBeVisible({ timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Saqlash' }).click();
  const mine = dialog.locator('.design-card', { hasText: 'Mening dizaynim' });
  await expect(mine).toContainText('Meniki');
  await page.getByTestId('design-lang').selectOption('uz-latn');
  await mine.getByRole('button', { name: 'Qoʻllash' }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });
  await expect.poll(() => fileText(page, projectId, 'dizayn.sty')).toContain('{AA3366}');

  // Design from a book (AI, mocked).
  const ai = await (await page.request.get('/api/ai/status')).json();
  if (!ai.status.enabled) return;
  await page.getByTestId('design-button').click();
  await dialog.getByRole('tab', { name: 'Kitobdan (AI)' }).click();
  await dialog.getByLabel('Kitob sahifalari').setInputFiles({
    name: 'kitob.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n'),
  });
  const before = (await mockRequests()).length;
  await dialog.getByRole('button', { name: 'Dizayn yaratish' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Nomi', exact: true })).toHaveValue('Kitobimdagi dizayn');
  await expect(dialog.locator('.ai-explanation')).toContainText('MOCK: yashil sarlavhalar');
  const req = (await mockRequests())[before]!;
  const content = (req.body.messages as Array<{ content: Array<{ type: string }> }>)[0]!.content;
  expect(content[0]!.type).toBe('document');
  await expect(dialog.locator('.design-live .preview-ok')).toBeVisible({ timeout: 120_000 });
});
