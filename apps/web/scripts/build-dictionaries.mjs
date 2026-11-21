// Copies the Hunspell dictionaries into public/dict/ and generates the Uzbek
// Latin word list from the Cyrillic one. Runs before `vite dev` / `vite build`.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(root, 'public', 'dict');

function copyNpmDictionaries() {
  for (const [lang, pkg] of [['en', 'dictionary-en'], ['ru', 'dictionary-ru']]) {
    const dir = path.dirname(fileURLToPath(import.meta.resolve(pkg)));
    copyFileSync(path.join(dir, 'index.aff'), path.join(out, `${lang}.aff`));
    copyFileSync(path.join(dir, 'index.dic'), path.join(out, `${lang}.dic`));
    copyFileSync(path.join(dir, 'license'), path.join(out, `${lang}.license.txt`));
  }
}

// --- Uzbek -----------------------------------------------------------------------

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x',
  ч: 'ch', ш: 'sh', щ: 'sh', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'oʻ', қ: 'q',
  ғ: 'gʻ', ҳ: 'h',
};
const VOWELS = new Set([...'аеёиоуэюяўы']);

/** Official Uzbek Cyrillic -> Latin transliteration of one word. */
export function cyrToLat(word) {
  const chars = [...word];
  let res = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const lower = ch.toLowerCase();
    const prev = i > 0 ? chars[i - 1].toLowerCase() : '';
    const next = i + 1 < chars.length ? chars[i + 1].toLowerCase() : '';
    let lat;
    if (lower === 'е') {
      lat = i === 0 || VOWELS.has(prev) || prev === 'ъ' || prev === 'ь' ? 'ye' : 'e';
    } else if (lower === 'ц') {
      lat = i > 0 && VOWELS.has(prev) ? 'ts' : 's';
    } else if (lower === 'ъ') {
      lat = 'еёюя'.includes(next) ? '' : 'ʼ';
    } else {
      lat = MAP[lower] ?? lower;
    }
    if (ch !== lower && lat) lat = lat[0].toUpperCase() + lat.slice(1);
    res += lat;
  }
  return res;
}

function buildUzbek() {
  const cyrillic = readFileSync(path.join(root, 'dictionaries', 'uz-Cyrl.dic'), 'utf8')
    .split('\n')
    .slice(1)
    .map((w) => w.trim())
    .filter(Boolean);
  const latin = [...new Set(cyrillic.map(cyrToLat))].sort();

  const header = (words) => `${words.length}\n${words.join('\n')}\n`;
  writeFileSync(path.join(out, 'uz-cyrl.dic'), header([...new Set(cyrillic)]));
  writeFileSync(
    path.join(out, 'uz-cyrl.aff'),
    'SET UTF-8\nTRY аиоеуўнрлтдкбсмйгқяхзшчпғҳвфжюэёцъьщыАИОЕУЎНРЛТДКБСМЙГҚЯХЗШЧПҒҲВФЖЮЭЁЦ\n',
  );
  writeFileSync(path.join(out, 'uz-latn.dic'), header(latin));
  writeFileSync(
    path.join(out, 'uz-latn.aff'),
    'SET UTF-8\nTRY aiouenrltdkbsmyqgxhzcjpvfwʻʼAIOUENRLTDKBSMYQGXHZCJPVFW\nWORDCHARS ʻʼ\n',
  );
  copyFileSync(path.join(root, 'dictionaries', 'uz-Cyrl.copyright'), path.join(out, 'uz.copyright.txt'));
  console.log(`dictionaries: en, ru, uz-cyrl (${cyrillic.length}), uz-latn (${latin.length}) -> public/dict`);
}

// Run only when executed directly (tests import cyrToLat).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(out, { recursive: true });
  copyNpmDictionaries();
  buildUzbek();
}
