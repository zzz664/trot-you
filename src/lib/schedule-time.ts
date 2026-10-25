import { SCHEDULE_VIEW } from '@/config/schedule-view';

// PostgreSQL events retain six fractional digits. Date.parse supplies the
// floor millisecond (also before1970); add its discarded positive fraction.
// BigInt avoids losing microseconds for old/far-future supported years.
export function scheduleInstantMicroseconds(timestamp: string): bigint | null {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '';
  const submillisecond = fraction
    .padEnd(SCHEDULE_VIEW.postgresFractionDigits, '0')
    .slice(
      SCHEDULE_VIEW.millisecondFractionDigits,
      SCHEDULE_VIEW.postgresFractionDigits,
    );
  return (
    BigInt(milliseconds) * BigInt(SCHEDULE_VIEW.microsecondsPerMillisecond) +
    BigInt(submillisecond)
  );
}
