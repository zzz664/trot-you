// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import fixtures from '../fixtures/schedule-timezone.json';

it('keeps actual PostgreSQL timezone expectations identical to shared JS fixtures', () => {
  const sql = readFileSync(
    new URL('../../supabase/tests/schedule_timezone.test.sql', import.meta.url),
    'utf8',
  );
  const embedded = sql.match(
    /\$schedule_timezone\$\n([\s\S]*?)\$schedule_timezone\$::jsonb/,
  );
  expect(embedded).not.toBeNull();
  expect(JSON.parse(embedded![1]!)).toEqual(fixtures);
});

it('independent Intl formatting agrees with shared valid local-input expectations', () => {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: fixtures.timeZone,
    calendar: 'iso8601',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const row of fixtures.forms) {
    if (!row.utc) continue;
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(row.utc))
        .map(({ type, value }) => [type, value]),
    );
    expect(
      `${parts.year!.padStart(4, '0')}-${parts.month}-${parts.day}`,
      row.label,
    ).toBe(row.date);
    expect(`${parts.hour}:${parts.minute}`, row.label).toBe(row.time);
  }
});

it('shared cases retain historical gap/fold and both technical year boundaries', () => {
  expect(
    fixtures.forms.find((row) => row.label === '1908-gap-midnight')?.utc,
  ).toBeNull();
  expect(
    fixtures.forms.find((row) => row.label === '1988-gap-middle')?.utc,
  ).toBeNull();
  expect(
    fixtures.forms.find((row) => row.label === '1988-fold-later-standard')?.utc,
  ).toBe('1988-10-08T17:30:00.000Z');
  expect(
    fixtures.forms.find((row) => row.label === 'earliest-unrepresentable')?.utc,
  ).toBeNull();
  expect(
    fixtures.forms.find((row) => row.label === 'earliest-representable')?.utc,
  ).toBe('0001-01-01T00:32:08.000Z');
  expect(fixtures.months.at(-1)?.end).toBe('9999-12-31T15:00:00.000Z');
});
