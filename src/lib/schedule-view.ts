import { SCHEDULE_VIEW } from '@/config/schedule-view';
import { SCHEDULES } from '@/config/schedules';
import { scheduleInstantMicroseconds as instantMicroseconds } from '@/lib/schedule-time';

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
const formatter = new Intl.DateTimeFormat(SCHEDULE_VIEW.locale, {
  timeZone: SCHEDULES.timeZone,
  era: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function localParts(instant: number): LocalParts | null {
  if (!Number.isFinite(instant)) return null;
  try {
    const fields = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map(({ type, value }) => [type, value]),
    );
    const year = Number(fields.year);
    return {
      year: fields.era === SCHEDULE_VIEW.beforeCommonEra ? 1 - year : year,
      month: Number(fields.month),
      day: Number(fields.day),
      hour: Number(fields.hour),
      minute: Number(fields.minute),
      second: Number(fields.second),
    };
  } catch {
    return null;
  }
}
function naiveInstant(parts: LocalParts) {
  const date = new Date(0);
  // Date.UTC(1,...) means1901; setting full year explicitly is required here.
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}
function utcParts(instant: number): LocalParts {
  const date = new Date(instant);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}
function equalParts(a: LocalParts, b: LocalParts) {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}
function parseLocal(date: string, time: string): LocalParts | null {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) {
    // The database permits one exclusive-end boundary whose local year is
    //10000 but whose serialized UTC instant is still in four-digit year9999.
    const boundary = scheduleToLocalDateTime(SCHEDULES.maxInstant);
    if (date !== boundary.date || time !== boundary.time) return null;
  }
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const parts = {
    year: year!,
    month: month!,
    day: day!,
    hour: hour!,
    minute: minute!,
    second: 0,
  };
  return equalParts(parts, utcParts(naiveInstant(parts))) ? parts : null;
}
function resolveLocal(parts: LocalParts, normalizeGap: boolean): number | null {
  const naive = naiveInstant(parts);
  const candidates = new Set<number>();
  // Offsets on either side of the civil date cover both sides of historical
  // Seoul transitions, including the08:27:52 LMT offset and summer time.
  for (const delta of SCHEDULE_VIEW.offsetProbeDays) {
    const probe = naive + delta * SCHEDULE_VIEW.dayMs;
    const projected = localParts(probe);
    if (projected) candidates.add(naive - (naiveInstant(projected) - probe));
  }
  const matching = [...candidates].filter((instant) => {
    const actual = localParts(instant);
    return actual !== null && equalParts(parts, actual);
  });
  // PostgreSQL AT TIME ZONE uses the later (standard-offset) instant for a
  // repeated wall clock. Nonexistent form times reject rather than normalize.
  if (matching.length) return Math.max(...matching);
  return normalizeGap && candidates.size ? Math.max(...candidates) : null;
}
const pad = (value: number) =>
  String(value).padStart(SCHEDULE_VIEW.monthDigits, '0');
function civilDate(parts: LocalParts) {
  return `${String(parts.year).padStart(SCHEDULE_VIEW.yearLength, '0')}-${pad(parts.month)}-${pad(parts.day)}`;
}
function monthDate(month: string) {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  return new Date(`${month}-01T00:00:00.000Z`);
}
export function scheduleMonthShift(
  month: string,
  delta: number,
): string | null {
  const date = monthDate(month);
  if (!date || !Number.isSafeInteger(delta)) return null;
  date.setUTCMonth(date.getUTCMonth() + delta);
  const year = date.getUTCFullYear();
  return year >= 1 && year <= SCHEDULE_VIEW.yearMax
    ? date.toISOString().slice(0, SCHEDULE_VIEW.monthLength)
    : null;
}
export function scheduleMonthDays(month: string): string[] {
  const date = monthDate(month);
  if (!date) return [];
  const days: string[] = [];
  while (date.toISOString().slice(0, SCHEDULE_VIEW.monthLength) === month) {
    days.push(date.toISOString().slice(0, SCHEDULE_VIEW.dateLength));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}
export function scheduleMonthAt(now: Date): string | null {
  const parts = localParts(now.getTime());
  return parts && parts.year >= 1 && parts.year <= SCHEDULE_VIEW.yearMax
    ? civilDate(parts).slice(0, SCHEDULE_VIEW.monthLength)
    : null;
}
export function scheduleLocalDayStart(day: string): number {
  const parts = parseLocal(day, '00:00');
  return parts ? (resolveLocal(parts, true) ?? NaN) : NaN;
}

export type ScheduleDayInterval = { day: string; start: number; end: number };
export function scheduleMonthIntervals(month: string): ScheduleDayInterval[] {
  const days = scheduleMonthDays(month);
  return days.map((day) => {
    const local = parseLocal(day, '00:00')!;
    const nextDay = utcParts(naiveInstant(local) + SCHEDULE_VIEW.dayMs);
    return {
      day,
      start: resolveLocal(local, true) ?? NaN,
      end: resolveLocal(nextDay, true) ?? NaN,
    };
  });
}
export function scheduleDayKeys(
  event: { starts_at: string; ends_at: string | null },
  month: string,
  intervals = scheduleMonthIntervals(month),
): string[] {
  const start = instantMicroseconds(event.starts_at);
  const end =
    event.ends_at === null
      ? start === null
        ? null
        : start + BigInt(1)
      : instantMicroseconds(event.ends_at);
  if (start === null || end === null || end <= start) return [];
  const factor = BigInt(SCHEDULE_VIEW.microsecondsPerMillisecond);
  return intervals
    .filter(
      (day) =>
        Number.isFinite(day.start) &&
        Number.isFinite(day.end) &&
        start < BigInt(day.end) * factor &&
        end > BigInt(day.start) * factor,
    )
    .map((day) => day.day);
}
export function scheduleToLocalDateTime(timestamp: string) {
  const parts = localParts(Date.parse(timestamp));
  return parts && parts.year >= 1 && parts.year <= SCHEDULE_VIEW.yearMax + 1
    ? {
        date: civilDate(parts),
        time: `${pad(parts.hour)}:${pad(parts.minute)}`,
      }
    : { date: '', time: '' };
}
export function scheduleFromLocalDateTime(
  date: string,
  time: string,
): string | null {
  const parts = parseLocal(date, time);
  if (!parts) return null;
  const value = resolveLocal(parts, false);
  if (value === null) return null;
  const instant = new Date(value);
  // JSON/ISO transport is restricted to four-digit AD years. Internal calendar
  // boundaries can still use UTCyear0000 to correctly place early local0001.
  return instant.getUTCFullYear() >= 1 &&
    instant.getUTCFullYear() <= SCHEDULE_VIEW.yearMax
    ? instant.toISOString()
    : null;
}
// Editing a title must not silently round an existing second/microsecond
// timestamp merely because the date/time controls display minute precision.
export function scheduleEditedDateTime(
  original: string | null,
  date: string,
  time: string,
): string | null {
  if (original !== null && Number.isFinite(Date.parse(original))) {
    const shown = scheduleToLocalDateTime(original);
    if (shown.date === date && shown.time === time) return original;
  }
  return scheduleFromLocalDateTime(date, time);
}
