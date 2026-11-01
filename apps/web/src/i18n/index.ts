import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { latinToYangiText, type Localized } from '@oversells/shared';
import { uiText } from './letters';
import uz from './uz';
import ru from './ru';
import en from './en';
import { ApiError } from '../api/client';

export const LANGUAGES = [
  { code: 'oz', label: 'Özbekça' },
  { code: 'uz', label: 'Oʻzbekcha' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
] as const;

const STORAGE_KEY = 'oversells.lang';

function initialLanguage(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.code === saved)) return saved;
  } catch {
    // storage unavailable
  }
  return 'oz';
}

/** Keys that name the letters themselves (oʻ → ö, «Oʻzbekcha (lotin)», o' → oʻ fixes) stay as written. */
const KEEP_LETTERS = new Set(['spell.lang', 'script.yangiHint', 'script.fromYangiHint', 'script.confirmYangi', 'fix.rule.okinaMissing', 'fix.rule.okina', 'fix.rule.tutuq']);

type Messages = { [key: string]: string | Messages };

/** «Özbekça»: the Uzbek interface in the new letters Ö Ğ Ş Ç, made from the Uzbek one. */
function inNewLetters(messages: Messages, path = ''): Messages {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => {
      const at = path ? `${path}.${key}` : key;
      if (KEEP_LETTERS.has(at)) return [key, value];
      return [key, typeof value === 'string' ? latinToYangiText(value) : inNewLetters(value, at)];
    }),
  );
}

void i18n.use(initReactI18next).init({
  resources: {
    oz: { translation: inNewLetters(uz as unknown as Messages) },
    uz: { translation: uz },
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: initialLanguage(),
  fallbackLng: 'uz',
  interpolation: { escapeValue: false },
});

/** The language for the server and the browser: «Özbekça» is Uzbek. */
export function baseLanguage(lng = i18n.language): 'uz' | 'ru' | 'en' {
  return lng === 'ru' || lng === 'en' ? lng : 'uz';
}

export { uiText };

/** A name or description the server gives in uz/ru/en, in the interface language. */
export function localized(value: Localized): string {
  return uiText(value[baseLanguage()]);
}

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = baseLanguage(lng);
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore
  }
});
document.documentElement.lang = baseLanguage();

/** Turns any error into a translated, user facing message. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.code.startsWith('invalid_path:')
      ? err.code === 'invalid_path:extension'
        ? 'invalid_path_extension'
        : 'invalid_path'
      : err.code;
    const key = `errors.${code}`;
    return i18n.exists(key) ? i18n.t(key) : err.message;
  }
  if (err instanceof TypeError) return i18n.t('errors.network');
  return err instanceof Error ? err.message : String(err);
}

export default i18n;
