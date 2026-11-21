import { describe, expect, it } from 'vitest';
import { cyrToLat } from './build-dictionaries.mjs';

describe('Uzbek Cyrillic -> Latin transliteration', () => {
  it.each([
    ['Ўзбекистон', 'Oʻzbekiston'],
    ['ғалаба', 'gʻalaba'],
    ['китоб', 'kitob'],
    ['қалам', 'qalam'],
    ['ҳисоб', 'hisob'],
    ['ер', 'yer'],
    ['поезд', 'poyezd'],
    ['шаҳар', 'shahar'],
    ['чой', 'choy'],
    ['маъно', 'maʼno'],
    ['объект', 'obyekt'],
    ['цирк', 'sirk'],
    ['социал', 'sotsial'],
    ['Юлдуз', 'Yulduz'],
  ])('%s -> %s', (cyr, lat) => {
    expect(cyrToLat(cyr)).toBe(lat);
  });
});
