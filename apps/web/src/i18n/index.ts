import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import uz from './uz';
import ru from './ru';
import en from './en';
import { ApiError } from '../api/client';

export const LANGUAGES = [
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
  return 'uz';
}

void i18n.use(initReactI18next).init({
  resources: { uz: { translation: uz }, ru: { translation: ru }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'uz',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore
  }
});
document.documentElement.lang = i18n.language;

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
