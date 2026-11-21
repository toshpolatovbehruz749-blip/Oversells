import { expect, test, type Page } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';
import { mockRequests } from './mock-anthropic';

/** Text of the editor (without remote-cursor labels). */
function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate((el) =>
    [...el.querySelectorAll('.cm-line')].map((l) => (l.textContent ?? '').replace(/⁠/g, '')).join('\n'),
  );
}


/**
 * AI assistance against a mocked Messages API: explain a compile error,
 * accept a suggested fix shown as a diff, generate exercises and a TikZ
 * picture (with the missing \usepackage added to the preamble).
 */
test('AI: explain an error, accept a fix, generate exercises and TikZ', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('ai'));
  const status = await (await page.request.get('/api/ai/status')).json();
  test.skip(!status.status.enabled, 'The server under test runs without AI (see README, Tests)');

  await createFromTemplate(page, 'blank', `AI ${Date.now()}`);
  await expect(page.getByTestId('ai-button')).toBeVisible();

  // Break the document and compile.
  await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' \\badcommand');
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Xatolar bilan yakunlandi');

  // Explain.
  const before = (await mockRequests()).length;
  await page.getByRole('button', { name: /Tushuntirish/ }).first().click();
  await expect(page.getByTestId('ai-explanation')).toContainText('MOCK: «Undefined control sequence');
  const explainReq = (await mockRequests())[before]!;
  expect(explainReq.system).toContain('oʻzbek tilida');
  expect(explainReq.prompt).toContain('\\badcommand');
  expect(explainReq.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
  expect(String(explainReq.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');

  // Suggest a fix: a diff the user accepts.
  await page.getByRole('button', { name: /Tuzatishni taklif qilish/ }).first().click();
  const dialog = page.getByTestId('ai-fix-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.diff-del')).toContainText('Salom, dunyo! \\badcommand');
  await expect(dialog.locator('.diff-add')).toHaveText(/Salom, dunyo!\s*$/);
  await dialog.getByRole('button', { name: 'Qabul qilish' }).click();
  await expect.poll(() => editorText(page)).not.toContain('badcommand');
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');

  // Generate exercises at the cursor.
  await page.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.getByTestId('ai-button').click();
  const ai = page.getByTestId('ai-dialog');
  await ai.getByLabel('Mavzu').fill('Kasrlarni qoʻshish');
  await ai.getByRole('button', { name: 'Yaratish' }).click();
  await expect(ai.getByTestId('ai-result')).toContainText('\\begin{enumerate}');
  await ai.getByRole('button', { name: 'Kursor joyiga qoʻyish' }).click();
  await expect.poll(() => editorText(page)).toContain('\\item Kasrlarni qoʻshish');

  // TikZ from a description; the blank template has no tikz, so it is added to the preamble.
  await page.getByTestId('ai-button').click();
  await ai.getByRole('tab', { name: 'TikZ rasm' }).click();
  await ai.getByLabel('Rasm tavsifi').fill('Katetlari 3 va 4 boʻlgan toʻgʻri burchakli uchburchak');
  await ai.getByRole('button', { name: 'Yaratish' }).click();
  await expect(ai.getByTestId('ai-result')).toContainText('\\begin{tikzpicture}');
  await expect(ai.getByText('\\usepackage{tikz}, \\usetikzlibrary{arrows.meta}')).toBeVisible();
  await ai.getByRole('button', { name: 'Kursor joyiga qoʻyish' }).click();
  await expect.poll(() => editorText(page)).toContain('\\end{tikzpicture}');
  const text = await editorText(page);
  expect(text.indexOf('\\usepackage{tikz}')).toBeGreaterThan(-1);
  expect(text.indexOf('\\usepackage{tikz}')).toBeLessThan(text.indexOf('\\begin{document}'));

  // The result compiles.
  await page.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('.pdf-page-wrap[data-page="1"] canvas')).toBeVisible();
});
