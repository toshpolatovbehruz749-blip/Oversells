import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** Text of the editor without the remote-cursor name labels. */
function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo').forEach((n) => n.remove());
    return [...copy.querySelectorAll('.cm-line')].map((l) => (l.textContent ?? '').replace(/⁠/g, '')).join('\n');
  });
}

/** Selects one whole line of the editor that contains `text`. */
async function selectLine(page: Page, text: string) {
  await page.locator('.cm-line', { hasText: text }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
}

/**
 * Phase 3 in two browser contexts: owner and a colleague (edit link) type in
 * the same file at the same time and converge; a comment stays on its text
 * while the colleague edits around it; a named version is restored from the
 * history and both editors show the restored text.
 */
test('two people edit together, a comment survives edits, history restore', async ({ page: owner, browser }) => {
  await registerViaUi(owner, uniqueEmail('owner'), 'Ustoz');
  const projectId = await createFromTemplate(owner, 'blank', `Hamkorlik ${Date.now()}`);
  await expect(owner.locator('.cm-content')).toContainText('Salom, dunyo!');

  // Share an edit link with a colleague in a second browser context.
  await owner.getByTestId('share-button').click();
  await owner.getByRole('button', { name: '+ Tahrirlash havolasi' }).click();
  const editUrl = await owner.locator('.share-link[data-role="editor"] input').inputValue();
  await owner.getByRole('button', { name: 'Yopish' }).click();

  const colleagueContext = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const colleague = await colleagueContext.newPage();
  await colleague.goto('/register');
  await colleague.getByLabel('Ism va familiya').fill('Hamkasb');
  await colleague.getByLabel('Elektron pochta').fill(uniqueEmail('colleague'));
  await colleague.getByLabel('Parol').fill(PASSWORD);
  await colleague.getByRole('button', { name: 'Roʻyxatdan oʻtish' }).click();
  await expect(colleague.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
  await colleague.goto(editUrl);
  await expect(colleague.locator('.cm-content')).toContainText('Salom, dunyo!');
  await expect(colleague.getByTestId('save-state')).toHaveText('Saqlandi');

  // Each sees the other one in the file.
  await expect(owner.getByTestId('presence')).toContainText('Hamkasb');
  await expect(colleague.getByTestId('presence')).toContainText('Ustoz');
  // The file tree shows who has the file open (not oneself).
  const ownerDot = owner.locator('.tree-row[data-path="main.tex"] [data-testid="tree-presence"]');
  await expect(ownerDot).toHaveAttribute('title', 'Hozir ochiq: Hamkasb', { timeout: 15_000 });
  await expect(colleague.locator('.tree-row[data-path="main.tex"] [data-testid="tree-presence"]')).toHaveAttribute('title', 'Hozir ochiq: Ustoz', {
    timeout: 15_000,
  });

  // --- concurrent editing -----------------------------------------------------------
  await owner.locator('.cm-content').click();
  await owner.keyboard.press('Control+Home');
  await colleague.locator('.cm-content').click();
  await colleague.keyboard.press('Control+End');
  await Promise.all([
    owner.keyboard.type('% Ustozning izohi\n', { delay: 15 }),
    colleague.keyboard.type('\n% Hamkasbning qatori', { delay: 15 }),
  ]);
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([editorText(owner), editorText(colleague)]);
      return a === b && a.startsWith('% Ustozning izohi\n') && a.endsWith('% Hamkasbning qatori');
    })
    .toBe(true);
  // The server holds the same text (it is what compile and ZIP use).
  const mainId = (await (await owner.request.get(`/api/projects/${projectId}`)).json()).project.files[0].id;
  await expect
    .poll(async () => (await owner.request.get(`/api/projects/${projectId}/files/${mainId}`)).text())
    .toBe(await editorText(owner));

  // --- a comment that survives edits around it --------------------------------------
  await selectLine(owner, 'Salom, dunyo!');
  await owner.getByTestId('add-comment').click();
  await owner.locator('#dialog-input').fill('Bu jumlani kengaytiring');
  await owner.getByRole('button', { name: 'OK' }).click();
  await expect(owner.getByTestId('comment-thread')).toContainText('Bu jumlani kengaytiring');
  await expect(owner.locator('.cm-comment')).toHaveText('Salom, dunyo!');

  // The colleague edits above the commented line and right before it on the same line.
  await colleague.locator('.cm-line', { hasText: 'begin{document}' }).click();
  await colleague.keyboard.press('End');
  await colleague.keyboard.type('\n\\section{Kirish}\n');
  await colleague.locator('.cm-line', { hasText: 'Salom, dunyo!' }).click();
  await colleague.keyboard.press('Home');
  await colleague.keyboard.type('Hammaga: ');

  // The colleague's panel picks up the comment (refreshed every few seconds), still on the same text.
  await colleague.getByTestId('comments-tab').click();
  await expect(colleague.getByTestId('comment-thread')).toContainText('Bu jumlani kengaytiring', { timeout: 15_000 });
  await expect(colleague.locator('.cm-comment')).toHaveText('Salom, dunyo!');
  await expect.poll(() => editorText(owner)).toContain('Hammaga: Salom, dunyo!');
  await expect(owner.locator('.cm-comment')).toHaveText('Salom, dunyo!');

  // Replies are visible to both.
  await colleague.getByRole('textbox', { name: 'Javob berish' }).fill('Xoʻp, kengaytiraman');
  await colleague.getByRole('button', { name: 'Javob berish' }).click();
  await owner.getByTestId('comments-tab').click();
  await expect(owner.getByTestId('comment-thread')).toContainText('Xoʻp, kengaytiraman', { timeout: 15_000 });

  // --- history: save a named version, change things, restore it -----------------------
  const named = await editorText(owner);
  await owner.getByTestId('history-button').click();
  await owner.getByRole('button', { name: 'Versiyani saqlash' }).click();
  await owner.locator('#dialog-input').fill('Hamkorlikdan keyin');
  await owner.getByRole('button', { name: 'OK' }).click();
  await expect(owner.getByTestId('version-list')).toContainText('Hamkorlikdan keyin');
  await owner.getByRole('button', { name: 'Yopish' }).click();

  // The colleague replaces a line.
  await selectLine(colleague, 'Ustozning izohi');
  await colleague.keyboard.type('% butunlay boshqa qator');
  await expect.poll(() => editorText(owner)).toContain('% butunlay boshqa qator');

  await owner.getByTestId('history-button').click();
  await owner.locator('.version-item', { hasText: 'Hamkorlikdan keyin' }).click();
  // The diff against the current state shows the change.
  await expect(owner.getByTestId('file-diff')).toContainText('% Ustozning izohi');
  await expect(owner.getByTestId('file-diff')).toContainText('% butunlay boshqa qator');
  await owner.getByRole('button', { name: 'Shu versiyani tiklash' }).click();
  await owner.getByRole('button', { name: 'OK' }).click();
  await expect(owner.getByTestId('version-list')).toContainText('Tiklandi: Hamkorlikdan keyin');
  await owner.getByRole('button', { name: 'Yopish' }).click();

  // Both editors show the restored text live; the comment is still in place.
  await expect.poll(() => editorText(owner)).toBe(named);
  await expect.poll(() => editorText(colleague)).toBe(named);
  await expect(owner.locator('.cm-comment')).toHaveText('Salom, dunyo!');

  // The project is listed under "shared with me" for the colleague.
  await colleague.goto('/');
  await expect(colleague.getByTestId('shared-projects')).toContainText('Hamkorlik');

  await colleagueContext.close();
});
