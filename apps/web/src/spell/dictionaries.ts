import type { Dictionary, SpellLanguage } from '@oversells/shared';
import type { Script } from './tokenize';

/**
 * Which dictionary checks a word: Uzbek projects check Latin words in Uzbek
 * Latin and Cyrillic words in Uzbek Cyrillic; Russian and English projects
 * check the other script in English/Russian respectively. Words in the new
 * letters (Ö Ğ Ş Ç) are looked up in the Uzbek Latin list.
 */
export function dictionaryFor(language: SpellLanguage, script: Script): Dictionary | null {
  if (language === 'off' || script === 'other') return null;
  if (language === 'uz-latn' || language === 'uz-yangi' || language === 'uz-cyrl') return script === 'latin' ? 'uz-latn' : 'uz-cyrl';
  if (language === 'ru') return script === 'cyrillic' ? 'ru' : 'en';
  return script === 'latin' ? 'en' : 'ru';
}
