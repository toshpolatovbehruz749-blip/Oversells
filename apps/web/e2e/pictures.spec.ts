import { expect, test, type Page } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';

/** Drops (or pastes) a picture made in the page into the code editor at the start of a line. */
async function putPicture(page: Page, kind: 'drop' | 'paste', name: string, width: number, height: number, onLine: string) {
  const line = page.locator('.cm-line', { hasText: onLine });
  await line.click();
  await page.keyboard.press('Home');
  const box = (await line.boundingBox())!;
  await page.evaluate(
    async ({ kind, name, width, height, x, y }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1f6f5c';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f2a900';
      ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type: 'image/png' }));
      const target = document.querySelector('.cm-content')!;
      const event =
        kind === 'drop'
          ? new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true })
          : new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    },
    { kind, name, width, height, x: box.x + 2, y: box.y + box.height / 2 },
  );
}

test('drop and paste pictures into the text', async ({ page }) => {
  await registerViaUi(page, uniqueEmail('pictures'));
  const projectId = await createFromTemplate(page, 'blank', `Rasmlar ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  // A big photo is scaled down to 3000 px and inserted where it was dropped.
  await putPicture(page, 'drop', 'Katta foto.png', 4000, 1000, 'Salom, dunyo!');
  await expect(page.getByText('Rasm kichraytirildi: 4000 → 3000 px')).toBeVisible();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('\\includegraphics[width=0.8\\linewidth]{rasmlar/katta-foto.png}');
  await expect(editor).toContainText('\\usepackage{graphicx}');

  // A small screenshot: a warning about the print quality.
  await putPicture(page, 'paste', 'image.png', 300, 200, 'Salom, dunyo!');
  await expect(page.getByText(/rasm\.png kichik \(300 px\)/)).toBeVisible();
  await expect(editor).toContainText('{rasmlar/rasm.png}');

  const project = (await (await page.request.get(`/api/projects/${projectId}`)).json()).project;
  expect(project.files.map((f: { path: string }) => f.path).sort()).toEqual(['main.tex', 'rasmlar/katta-foto.png', 'rasmlar/rasm.png']);
  const big = project.files.find((f: { path: string }) => f.path === 'rasmlar/katta-foto.png');
  const png = Buffer.from(await (await page.request.get(`/api/projects/${projectId}/files/${big.id}`)).body());
  expect(png.readUInt32BE(16)).toBe(3000);

  await page.locator('.compile-button').click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli', { timeout: 120_000 });
});
