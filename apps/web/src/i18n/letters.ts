import i18n from 'i18next';
import { latinToYangiText } from '@oversells/shared';

/** Text from the server or the AI in the interface's letters («Özbekça»: Ö Ğ Ş Ç). */
export function uiText(text: string): string {
  return i18n.language === 'oz' ? latinToYangiText(text) : text;
}
