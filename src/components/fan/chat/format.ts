import { APP_LOCALE } from '@/config/constants';
import { CHAT_DISPLAY_TIME_ZONE } from '@/config/chat';

export function chatDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: CHAT_DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
