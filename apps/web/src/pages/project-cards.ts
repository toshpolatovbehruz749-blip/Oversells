/** Helpers of the project cards on the project list (pure, no DOM). */

/** A calm colour per project (from its name), for the letter on its card. */
const CARD_COLOURS = ['#1f6f5c', '#2c6e9b', '#8a5a2b', '#7a3e8e', '#b0533c', '#3d7a3a', '#a2702a', '#4b5f9e'];
export function projectColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CARD_COLOURS[h % CARD_COLOURS.length]!;
}

/** The first letter of the name (ʻ, quotes and spaces skipped), upper case. */
export function projectInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toLocaleUpperCase() : '•';
}

/** Translates a key with a count («{{count}} kun oldin»), as i18next's t does. */
export type Translate = (key: string, opts?: { count: number }) => string;

/** «hozirgina», «5 daqiqa oldin», «kecha», «3 kun oldin»; older than a month: the date. */
export function relativeTime(date: Date, now: Date, t: Translate, fallback: Intl.DateTimeFormat): string {
  const s = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  if (s > 30 * 86400) return fallback.format(date);
  if (s < 60) return t('projects.ago.now');
  if (s < 3600) return t('projects.ago.minutes', { count: Math.round(s / 60) });
  if (s < 86400) return t('projects.ago.hours', { count: Math.round(s / 3600) });
  const days = Math.round(s / 86400);
  return days === 1 ? t('projects.ago.yesterday') : t('projects.ago.days', { count: days });
}
