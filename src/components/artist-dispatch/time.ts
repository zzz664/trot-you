import { APP_LOCALE } from '@/config/constants';
import {
  DISPATCH_KST_OFFSET,
  DISPATCH_TIME_ZONE,
} from '@/config/message-dispatch';

export function dispatchDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: DISPATCH_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

// Native date/time fields have no timezone. Bind their joined wall time to KST,
// never to the browser's current timezone, and reject normalized invalid dates.
export function dispatchScheduledInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00${DISPATCH_KST_OFFSET}`);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPATCH_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const at = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value;
  const normalized = `${at('year')}-${at('month')}-${at('day')}T${at('hour')}:${at('minute')}`;
  return normalized === value ? date.toISOString() : null;
}
