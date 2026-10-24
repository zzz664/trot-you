import { APP_LOCALE } from '@/config/constants';
import { MANAGEMENT_DISPLAY_TIME_ZONE } from '@/config/subscription-management';

export function managementDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: MANAGEMENT_DISPLAY_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function managementAmount(value: number) {
  return new Intl.NumberFormat(APP_LOCALE).format(value);
}
