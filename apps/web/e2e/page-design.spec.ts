import { expect, test } from '@playwright/test';
import { createFromTemplate, registerViaUi, uniqueEmail } from './helpers';
import { strToU8, zipSync } from 'fflate';
import { IDML_SAMPLE } from '../../../packages/shared/test/fixtures/idml-sample';

/**
 * «Sahifa dizayni» (behind PAGE_DESIGN_ENABLED): change a style and the running
 * heads, apply a paragraph and a character style to the code, and compile.
 * Skipped when the server under test has the feature off.
 */
test('page design: styles and master pages', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('sahifa'));
  const projectId = await createFromTemplate(page, 'textbook', `Sahifa ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();

  await page.getByTestId('page-design-button').click();
  const dialog = page.getByTestId('page-design-dialog');
  await expect(dialog).toBeVisible();

  // A style: «Iqtibos» gets 13 pt.
  await dialog.getByTestId('pd-style-iqtibos').click();
  await dialog.getByTestId('pd-size').fill('13');
  // A master: page number at the bottom right of odd pages.
  await dialog.getByTestId('pd-tab-masters').click();
  await dialog.getByTestId('pd-master-asosiy').click();
  await dialog.getByTestId('pd-slot-odd-foot-right').selectOption('page');
  // A coloured strip under every page of that master, and an ornament at the end of chapters.
  await dialog.getByTestId('pd-bg-add-rect').click();
  await dialog.getByTestId('pd-bg-0-w').fill('8');
  await dialog.getByTestId('pd-tab-book').click();
  await dialog.getByTestId('pd-book-title').fill('Algebra');
  await dialog.getByTestId('pd-ornament').selectOption('stars');
  await dialog.getByTestId('pd-save').click();
  await expect(dialog.getByTestId('pd-notice')).toHaveText('Saqlandi: sahifa.sty yangilandi');
  const saved = (await (await page.request.get(`/api/projects/${projectId}/page-design`)).json()).design;
  expect(saved.masters.find((m: { id: string }) => m.id === 'asosiy').background).toEqual([
    { kind: 'rect', x: 0, y: 0, w: 8, h: 297, color: 'E8D9B5', mirror: true },
  ]);
  expect(saved.chapterEndOrnament).toBe('stars');
  await expect(page.locator('.cm-content')).toContainText('\\usepackage{sahifa}');
  await expect(page.locator('.tree-row', { hasText: 'sahifa.sty' })).toBeVisible();

  // Apply styles to the code: the paragraph with the cursor, then a selected word.
  // The panel leaves the code usable: find the text with the editor's search, which selects it.
  const find = async (text: string) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+f');
    await page.locator('.cm-search input[name="search"]').pressSequentially(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  };
  await dialog.getByTestId('pd-tab-styles').click();
  await find('Quyida');
  await dialog.getByTestId('pd-apply-iqtibos').click();
  await expect(dialog.getByTestId('pd-notice')).toHaveText('Uslub qoʻyildi');
  await expect(page.locator('.cm-content')).toContainText('\\begin{uslub}{iqtibos}');
  await find('funksiyaning');
  await dialog.getByTestId('pd-apply-urgu').click();
  await expect(page.locator('.cm-content')).toContainText('\\matnuslubi{urgu}{funksiyaning}');

  await dialog.getByRole('button', { name: 'Bekor qilish' }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
});

/** The «Roman» template, the preflight of its PDF in the sandbox, and the page-count fix. */
test('page design: novel template and preflight', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('preflight'));
  await createFromTemplate(page, 'roman', `Roman ${Date.now()}`);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');

  await page.getByTestId('page-design-button').click();
  const dialog = page.getByTestId('page-design-dialog');
  await dialog.getByTestId('pd-tab-preflight').click();
  await dialog.getByTestId('pd-preflight-run').click();
  await expect(dialog.getByTestId('pd-check-fonts')).toHaveAttribute('data-status', 'ok');
  const count = dialog.getByTestId('pd-check-page-count');
  await expect(count).toHaveAttribute('data-status', 'warning');

  await dialog.getByTestId('pd-fix-blank-pages').click();
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await dialog.getByTestId('pd-preflight-run').click();
  await expect(dialog.getByTestId('pd-check-page-count')).toHaveAttribute('data-status', 'ok');
});

/** Visual mode: drag the text block edge (a margin) and a fixed picture over the PDF. */
test('page design: visual mode', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('vizual'));
  const projectId = await createFromTemplate(page, 'roman', `Vizual ${Date.now()}`);
  await page.getByTestId('auto-compile').uncheck();
  // A picture, uploaded the way the file tree does it.
  await page.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#3a9a5a';
    g.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
    const form = new FormData();
    form.append('file', blob, 'yashil.png');
    const csrf = /(?:^|;\s*)oversells_csrf=([^;]*)/.exec(document.cookie)?.[1] ?? '';
    const res = await fetch(`/api/projects/${id}/upload?folder=rasmlar&overwrite=false`, { method: 'POST', headers: { 'x-csrf-token': csrf }, body: form });
    if (!res.ok) throw new Error(await res.text());
  }, projectId);
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();

  // A frame fixed on the page, after the first chapter heading.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+f');
  await page.locator('.cm-search input[name="search"]').pressSequentially('Qishloq tongi');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('End');
  await page.getByTestId('page-design-button').click();
  const dialog = page.getByTestId('page-design-dialog');
  await dialog.getByTestId('pd-tab-frames').click();
  await dialog.getByTestId('pd-frame-mode').selectOption('sahifa');
  await dialog.getByTestId('pd-frame-insert').click();
  await expect(page.locator('.cm-content')).toContainText('\\rasmramka[joy=sahifa,x=20mm,y=20mm]{rasmlar/yashil.png}{}');
  await dialog.getByRole('button', { name: 'Bekor qilish' }).click();

  await page.getByTestId('visual-mode-button').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const frame = page.getByTestId('pd-frame-1');
  await expect(frame).toBeVisible();
  // The baseline grid of the body text, on and off.
  await page.getByTestId('baseline-grid-button').click();
  await expect(page.locator('.pdf-page-wrap[data-page="1"] [data-testid="pd-baseline-grid"]')).toBeVisible();
  await page.getByTestId('baseline-grid-button').click();
  await expect(page.getByTestId('pd-baseline-grid')).toHaveCount(0);

  // Move the picture: x and y in the code change.
  await frame.scrollIntoViewIfNeeded();
  const b = (await frame.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 5 });
  // The move compiles again; its new layout is fetched when that compile is done.
  const relaid = page.waitForResponse((r) => r.url().endsWith(`/api/projects/${projectId}/page-layout`), { timeout: 60_000 });
  await page.mouse.up();
  await expect(page.locator('.cm-content')).not.toContainText('x=20mm,y=20mm');
  await expect(page.locator('.cm-content')).toContainText(/\\rasmramka\[joy=sahifa,x=\d+(\.\d)?mm,y=\d+(\.\d)?mm\]/);

  // Drag the inner edge of the text block on page 1: the inner margin of sahifa.sty changes.
  await relaid;
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  // …and the overlay is drawn again over the new PDF, with the frame where it was dropped.
  await expect.poll(async () => ((await page.getByTestId('pd-frame-1').boundingBox())?.x ?? 0) - b.x, { timeout: 60_000 }).toBeGreaterThan(20);
  // Pages are drawn again one by one as the new PDF renders; a drag on an overlay being replaced is lost, so retry.
  const edge = page.locator('.pdf-page-wrap[data-page="1"] [data-testid="pd-edge-left"]');
  await expect(async () => {
    await edge.scrollIntoViewIfNeeded();
    const e = (await edge.boundingBox())!;
    await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
    await page.mouse.down();
    await page.mouse.move(e.x + e.width / 2 + 30, e.y + e.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByText(/Ichki hoshiya: \d+(\.\d)? mm/).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  const design = (await (await page.request.get(`/api/projects/${projectId}/page-design`)).json()).design;
  expect(design.page.inner).toBeGreaterThan(22);
});

/** The Arabic template: LuaLaTeX, right to left beside the translation, compiles in the sandbox. */
test('page design: Arabic religious template', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('diniy'));
  await createFromTemplate(page, 'diniy', `Suralar ${Date.now()}`);
  await expect(page.locator('.cm-content')).toContainText('\\babelprovide[import, mapdigits]{arabic}');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  await expect(page.locator('.pdf-page-wrap[data-page="1"]')).toBeVisible();
});

/** «Muqova»: the spine from the pages of the last PDF and the paper, and the cover compiled into its own PDF. */
test('page design: cover', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('muqova'));
  const projectId = await createFromTemplate(page, 'roman', `Muqova ${Date.now()}`);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
  const pdfPages = (await (await page.request.get(`/api/projects/${projectId}/cover`)).json()).pages;
  expect(pdfPages).toBeGreaterThan(1);

  await page.getByTestId('page-design-button').click();
  const dialog = page.getByTestId('page-design-dialog');
  await dialog.getByTestId('pd-tab-cover').click();
  // Opened before any cover was saved: the page count is already the PDF's.
  await expect(dialog.getByTestId('pd-cover-pages')).toHaveValue(String(pdfPages));
  await dialog.getByTestId('pd-cover-pages').fill('300');
  await dialog.getByTestId('pd-cover-paper').selectOption('ofset-80');
  // 150 sheets × 0.1 mm + 0.5 mm.
  await expect(dialog.getByTestId('pd-cover-summary')).toContainText('Bel: 15.5 mm');
  await dialog.getByTestId('pd-cover-thickness').fill('0.12');
  await expect(dialog.getByTestId('pd-cover-summary')).toContainText('Bel: 18.5 mm');
  await dialog.getByTestId('pd-cover-binding').selectOption('skoba');
  await expect(dialog.getByTestId('pd-cover-warn-stapleTooThick')).toBeVisible();
  await dialog.getByTestId('pd-cover-binding').selectOption('yelim');
  await dialog.getByTestId('pd-cover-author').fill('Muallif Ismi');
  await dialog.getByTestId('pd-cover-isbn').fill('978-9943-01-234-9');
  await dialog.getByTestId('pd-cover-pdf').click();
  await expect(dialog.getByTestId('pd-cover-download')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.tree-row', { hasText: 'muqova.tex' })).toBeVisible();
  const saved = (await (await page.request.get(`/api/projects/${projectId}/cover`)).json()).cover;
  expect(saved).toMatchObject({ pages: 300, thickness: 0.12, author: 'Muallif Ismi', binding: 'yelim' });
});

/** InDesign: an .idml becomes a project with its styles in sahifa.sty, and it compiles. */
test('page design: InDesign import', async ({ page, request }) => {
  const features = (await (await request.get('/api/features')).json()).features;
  test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');

  await registerViaUi(page, uniqueEmail('idml'));
  const buffer = Buffer.from(zipSync(Object.fromEntries(Object.entries(IDML_SAMPLE).map(([k, v]) => [k, strToU8(v)]))));
  await page.getByTestId('import-idml-input').setInputFiles({ name: 'Ona yurt.idml', mimeType: 'application/octet-stream', buffer });
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.locator('.cm-content')).toContainText('\\section{Birinchi bob}');
  await expect(page.locator('.tree-row', { hasText: 'sahifa.sty' })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
});

/** The book-type templates compile in the sandbox. */
for (const template of ['lugat', 'oshpazlik', 'albom', 'katalog']) {
  test(`page design: template ${template}`, async ({ page, request }) => {
    const features = (await (await request.get('/api/features')).json()).features;
    test.skip(!features?.pageDesign, 'PAGE_DESIGN_ENABLED is off on this server');
    await registerViaUi(page, uniqueEmail(template));
    await createFromTemplate(page, template, `${template} ${Date.now()}`);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('compile-status')).toHaveText('Muvaffaqiyatli');
    await expect(page.locator('.tree-row', { hasText: 'sahifa.sty' })).toBeVisible();
  });
}
