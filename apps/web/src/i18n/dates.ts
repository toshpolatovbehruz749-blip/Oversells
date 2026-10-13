/**
 * Date/time formatter for the UI language. Browsers' Uzbek month names are
 * patchy (e.g. "2026 M10 13"), so Uzbek uses a numeric day.month.year form.
 */
export function dateTimeFormat(lang: string, compact = false): Intl.DateTimeFormat {
  if (lang === 'uz') {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: compact ? '2-digit' : 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return new Intl.DateTimeFormat(lang, { dateStyle: compact ? 'short' : 'medium', timeStyle: 'short' });
}
