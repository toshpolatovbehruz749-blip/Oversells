import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/**
 * Two app instances behind one database and Redis (E2E_BASE_URL and
 * E2E_BASE_URL_2): the owner works on the first, a colleague on the second,
 * and they edit the same document live.
 */
const SECOND = process.env.E2E_BASE_URL_2;

function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo').forEach((n) => n.remove());
    return [...copy.querySelectorAll('.cm-line')].map((l) => (l.textContent ?? '').replace(/⁠/g, '')).join('\n');
  });
}

test('two app instances: live editing through Redis', async ({ page: owner, browser }) => {
  test.skip(!SECOND, 'Set E2E_BASE_URL_2 to a second app instance');
  await registerViaUi(owner, uniqueEmail('cluster-owner'), 'Birinchi');
  const projectId = await createFromTemplate(owner, 'blank', `Klaster ${Date.now()}`);
  await owner.getByTestId('share-button').click();
  await owner.getByRole('button', { name: '+ Tahrirlash havolasi' }).click();
  const editUrl = new URL(await owner.locator('.share-link[data-role="editor"] input').inputValue());
  await owner.getByRole('button', { name: 'Yopish' }).click();

  // The colleague uses the other instance.
  const context = await browser.newContext({ baseURL: SECOND, viewport: { width: 1500, height: 900 } });
  const colleague = await context.newPage();
  await colleague.goto('/register');
  await colleague.getByLabel('Ism va familiya').fill('Ikkinchi');
  await colleague.getByLabel('Elektron pochta').fill(uniqueEmail('cluster-colleague'));
  await colleague.getByLabel('Parol').fill(PASSWORD);
  await colleague.getByRole('button', { name: 'Roʻyxatdan oʻtish' }).click();
  await expect(colleague.getByRole('heading', { name: 'Loyihalar' })).toBeVisible();
  await colleague.goto(editUrl.pathname);
  await expect(colleague.locator('.cm-content')).toContainText('Salom, dunyo!');
  expect(new URL(colleague.url()).port).toBe(new URL(SECOND!).port);

  // Presence crosses instances.
  await expect(owner.getByTestId('presence')).toContainText('Ikkinchi');
  await expect(colleague.getByTestId('presence')).toContainText('Birinchi');

  await owner.locator('.cm-content').click();
  await owner.keyboard.press('Control+Home');
  await colleague.locator('.cm-content').click();
  await colleague.keyboard.press('Control+End');
  await Promise.all([
    owner.keyboard.type('% birinchi nusxadan\n', { delay: 15 }),
    colleague.keyboard.type('\n% ikkinchi nusxadan', { delay: 15 }),
  ]);
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([editorText(owner), editorText(colleague)]);
      return a === b && a.startsWith('% birinchi nusxadan\n') && a.endsWith('% ikkinchi nusxadan');
    })
    .toBe(true);

  // Compiling on the first instance includes the colleague's last keystrokes.
  await owner.getByRole('button', { name: /Kompilyatsiya/ }).click();
  await expect(owner.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const mainId = (await (await owner.request.get(`/api/projects/${projectId}`)).json()).project.files[0].id;
  await expect
    .poll(async () => (await owner.request.get(`/api/projects/${projectId}/files/${mainId}`)).text())
    .toContain('% ikkinchi nusxadan');
  await context.close();
});
