import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  return (
    <select
      aria-label={t('lang.label')}
      className="lang-switcher"
      value={i18n.language}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
