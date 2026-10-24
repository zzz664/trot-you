import { ENROLLMENT_MONTHS_PER_YEAR } from '@/config/enrollment-server';
import {
  BILLING_CALENDAR_OFFSETS_MS,
  type BillingPeriodCalendar,
} from '@/config/billing-policy';

// The immutable approved policy chooses a calendar explicitly. Offset-shifted
// UTC methods model that wall clock without depending on the host timezone.
// This feature supports UTC and modern Asia/Seoul only; neither has DST.
export function initialBillingPeriod(
  now: Date,
  calendar: BillingPeriodCalendar,
) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Object.hasOwn(BILLING_CALENDAR_OFFSETS_MS, calendar)
  )
    throw new Error('INVALID_BILLING_PERIOD');
  const offset = BILLING_CALENDAR_OFFSETS_MS[calendar];
  const local = new Date(now.getTime() + offset);
  const end = new Date(local);
  const month = local.getUTCMonth() + 1;
  end.setUTCDate(1);
  end.setUTCFullYear(
    local.getUTCFullYear() + Math.floor(month / ENROLLMENT_MONTHS_PER_YEAR),
    month % ENROLLMENT_MONTHS_PER_YEAR,
    1,
  );
  const next = new Date(end);
  next.setUTCMonth(next.getUTCMonth() + 1, 0);
  end.setUTCDate(Math.min(local.getUTCDate(), next.getUTCDate()));
  return {
    start: now.toISOString(),
    end: new Date(end.getTime() - offset).toISOString(),
  };
}
