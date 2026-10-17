// Renders every Oversells icon (macOS app, PWA, favicon) from one design:
// a green rounded tile with the wordmark "overs." and the tagline
// "yoz · bezat · nashr qil" (Poppins, loaded from Google Fonts).
//
//   node desktop/icon/render-icons.mjs        (needs Playwright's Chromium)
//
// Then rebuild desktop/mac/Oversells.icns with desktop/icon/make-icns.py.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pub = path.join(root, 'apps/web/public');

/**
 * size: output pixels; tile: tile size as a share of the canvas; radius: share
 * of the tile; shadow: macOS-style drop shadow; tagline: shown when legible;
 * content: scale of the lettering (maskable icons keep it inside the safe zone).
 */
function html({ size, tile = 1, radius = 0.225, shadow = false, tagline = true, word = 'overs', content = 1 }) {
  const t = size * tile;
  const fontSize = t * (word === 'o' ? 0.62 : 0.28) * content;
  return `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=block" rel="stylesheet">
<style>
html,body{margin:0;background:transparent}
.c{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}
.tile{width:${t}px;height:${t}px;border-radius:${t * radius}px;box-sizing:border-box;
 background:linear-gradient(180deg,#2b8a70 0%,#1f6f5c 55%,#185a4a 100%);
 ${shadow ? `box-shadow:0 ${t * 0.022}px ${t * 0.05}px rgba(0,0,0,.35), inset 0 ${Math.max(1, t * 0.0025)}px 0 rgba(255,255,255,.18);` : ''}
 display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:Poppins}
.w{font-weight:700;font-size:${fontSize}px;letter-spacing:${-fontSize * 0.024}px;line-height:1;margin-top:${tagline ? t * 0.02 : 0}px}
.d{color:#f2b33d}
.t{font-weight:500;font-size:${t * 0.041 * content}px;letter-spacing:${t * 0.0012}px;margin-top:${t * 0.03}px;opacity:.92;white-space:nowrap}
</style></head><body><div class="c"><div class="tile">
<div class="w">${word}<span class="d">.</span></div>${tagline ? '<div class="t">yoz · bezat · nashr qil</div>' : ''}
</div></div></body></html>`;
}

const outputs = [
  // macOS: 824 px tile on a 1024 px canvas with a shadow (Apple's icon grid).
  [path.join(root, 'desktop/mac/Oversells-icon.png'), { size: 1024, tile: 824 / 1024, shadow: true }],
  // PWA "any": the tile fills the image.
  [path.join(pub, 'icon-512.png'), { size: 512 }],
  [path.join(pub, 'icon-192.png'), { size: 192, tagline: false }],
  // PWA "maskable" and Apple touch icon: full-bleed square, the system rounds it.
  [path.join(pub, 'icon-maskable-512.png'), { size: 512, radius: 0, content: 0.72 }],
  [path.join(pub, 'apple-touch-icon.png'), { size: 180, radius: 0, tagline: false }],
  // Browser tab: just "o." so it stays readable at 16-32 px.
  [path.join(pub, 'favicon.png'), { size: 64, radius: 0.24, tagline: false, word: 'o' }],
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
for (const [file, opts] of outputs) {
  mkdirSync(path.dirname(file), { recursive: true });
  const page = await browser.newPage({ viewport: { width: opts.size, height: opts.size } });
  await page.setContent(html(opts), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.c').screenshot({ path: file, omitBackground: true });
  await page.close();
  console.log(path.relative(root, file));
}
await browser.close();
