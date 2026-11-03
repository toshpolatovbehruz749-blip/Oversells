import { expect, test } from '@playwright/test';
import { PASSWORD, createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/**
 * Sharing flow with two browser contexts: the owner creates a project from the
 * exam template and shares view/edit links; an anonymous visitor opens the
 * view link read-only (can compile and see the PDF, cannot edit), the owner
 * revokes it, and an edit link only allows editing after logging in.
 */
test('share a project: viewer link read-only, revocation, editor link needs login', async ({ page, browser }) => {
  await registerViaUi(page, uniqueEmail('owner'), 'Ustoz Karimova');
  const projectId = await createFromTemplate(page, 'exam', `Nazorat ishi ${Date.now()}`);
  await expect(page.locator('.cm-content')).toContainText('\\documentclass[12pt,a4paper,addpoints]{exam}');

  // Owner creates a view link.
  await page.getByTestId('share-button').click();
  await expect(page.getByRole('heading', { name: 'Loyihani ulashish' })).toBeVisible();
  await page.getByRole('button', { name: '+ Koʻrish havolasi' }).click();
  const viewerInput = page.locator('.share-link[data-role="viewer"] input');
  await expect(viewerInput).toHaveValue(/\/s\/[A-Za-z0-9_-]{32}$/);
  const viewerUrl = await viewerInput.inputValue();
  await page.getByRole('button', { name: '+ Tahrirlash havolasi' }).click();
  const editorUrl = await page.locator('.share-link[data-role="editor"] input').inputValue();
  await page.getByRole('button', { name: 'Yopish' }).click();

  // --- second, anonymous browser context opens the view link ---------------------
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(viewerUrl);
  await expect(visitor.getByTestId('read-only-badge')).toHaveText('Faqat koʻrish');
  await expect(visitor.locator('.cm-content')).toContainText('Kvadrat tenglamalar');
  // No file operations and a non-editable editor.
  await expect(visitor.getByRole('button', { name: 'Yangi fayl' })).toHaveCount(0);
  await expect(visitor.getByTestId('share-button')).toHaveCount(0);
  await expect(visitor.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(visitor.getByRole('combobox').first()).toBeDisabled();

  // Viewers may compile and see the PDF.
  await visitor.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(visitor.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(visitor.locator('[data-testid="pdf-pages"] canvas').first()).toBeVisible();

  // The download links carry the share token, so they work without a session.
  const zipHref = await visitor.getByRole('link', { name: /ZIP/ }).getAttribute('href');
  expect(zipHref).toContain('share=');
  const zip = await visitor.request.get(zipHref!);
  expect(zip.status()).toBe(200);

  // Writes are refused by the API even if attempted directly.
  const csrf = (await visitorContext.cookies()).find((c) => c.name === 'oversells_csrf')!.value;
  const token = viewerUrl.split('/s/')[1]!;
  const write = await visitor.request.post(`/api/projects/${projectId}/files`, {
    headers: { 'x-csrf-token': csrf, 'x-share-token': token },
    data: { path: 'hack.tex', content: 'x' },
  });
  expect(write.status()).toBe(403);
  // Without the link the project does not exist for the visitor.
  expect((await visitor.request.get(`/api/projects/${projectId}`)).status()).toBe(404);

  // --- owner revokes the view link ------------------------------------------------
  await page.getByTestId('share-button').click();
  await page.locator('.share-link[data-role="viewer"]').getByRole('button', { name: 'Bekor qilish' }).click();
  await expect(page.locator('.share-link[data-role="viewer"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Yopish' }).click();

  await visitor.goto(viewerUrl);
  await expect(visitor.getByText('Havola notoʻgʻri yoki bekor qilingan')).toBeVisible();

  // --- edit link: read-only until the visitor logs in --------------------------------
  await visitor.goto(editorUrl);
  await expect(visitor.getByTestId('read-only-badge')).toBeVisible();
  await visitor.getByRole('link', { name: 'Tahrirlash uchun tizimga kiring' }).click();
  await visitor.getByRole('link', { name: /Roʻyxatdan oʻting/ }).click();
  await visitor.getByLabel('Ism va familiya').fill('Hamkasb');
  await visitor.getByLabel('Elektron pochta').fill(uniqueEmail('colleague'));
  await visitor.getByLabel('Parol').fill(PASSWORD);
  await visitor.getByRole('button', { name: 'Roʻyxatdan oʻtish' }).click();

  // Back on the shared project, now with edit rights.
  await expect(visitor).toHaveURL(/\/s\//);
  await expect(visitor.getByTestId('save-state')).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Yangi fayl' })).toBeVisible();
  await expect(visitor.getByTestId('share-button')).toHaveCount(0); // only the owner shares
  await visitor.locator('.cm-content').click();
  await visitor.keyboard.press('Control+Home');
  await visitor.keyboard.type('% Hamkasb tahriri\n');
  await expect(visitor.getByTestId('save-state')).toHaveText('Saqlandi');

  // The owner sees the colleague's edit.
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('% Hamkasb tahriri');

  await visitorContext.close();
});
