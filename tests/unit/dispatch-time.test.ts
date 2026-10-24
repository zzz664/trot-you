import { describe, expect, it } from 'vitest';
import {
  dispatchDate,
  dispatchScheduledInstant,
} from '@/components/artist-dispatch/time';

describe('explicit KST dispatch time', () => {
  it('binds the wall-clock input to Korea rather than browser local time', () => {
    expect(dispatchScheduledInstant('2026-10-25T00:30')).toBe(
      '2026-10-24T15:30:00.000Z',
    );
    expect(dispatchScheduledInstant('2028-02-29T23:59')).toBe(
      '2028-02-29T14:59:00.000Z',
    );
    expect(dispatchDate('2026-10-24T15:30:00Z')).toContain('2026년 10월 25일');
    expect(dispatchDate('2026-10-24T15:30:00Z')).toContain('00:30:00');
  });
  it.each([
    '',
    '2026-02-29T12:00',
    '2026-04-31T00:00',
    '2026-10-25T24:00',
    '2026-13-01T12:00',
    '2026-10-25T12:60',
    '2026-10-25T12:00Z',
    '2026-10-25T12:00+09:00',
    '2026-10-25T12:00:01',
    '2026-10-25',
    '2026-10-25T1:00',
    ' 2026-10-25T12:00',
    '0000-01-01T00:00',
    '2026-10-00T12:00',
  ])('rejects invalid or ambiguous wall time %s', (value) => {
    expect(dispatchScheduledInstant(value)).toBeNull();
  });
});
