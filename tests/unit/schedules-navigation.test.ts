import { expect, it } from 'vitest';
import { scheduleRouteMatches } from '@/lib/schedule-navigation';
it.each([
  ['/schedules?month=2026-10', 'https://app.example/schedules?month=2026%2D10'],
  [
    '/schedules/3b0d4317-b739-4670-a0ce-02173f1e8101?month=2026-10',
    'https://app.example/schedules/3b0d4317%2Db739%2d4670-a0ce-02173f1e8101?month=2026%2D10',
  ],
  [
    '/admin/schedules?month=2026-10&page=1',
    'https://app.example/admin/schedules?page=%31&month=2026%2D10',
  ],
  [
    '/schedules?month=2026-10',
    'https://app.example/schedules?%6donth=2026-10#calendar',
  ],
])('matches equivalent safe route spelling %s', (expected, current) =>
  expect(scheduleRouteMatches(expected, current)).toBe(true),
);
it.each([
  [
    '/schedules?month=2026-10',
    'https://app.example/schedules?month=2026-10&month=2026-10',
  ],
  [
    '/schedules?month=2026-10',
    'https://app.example/schedules?month=2026-10&unknown=1',
  ],
  ['/schedules?month=2026-10', 'https://app.example/schedules?month=2026-11'],
  ['/schedules/item', 'https://app.example/schedules/other'],
  ['/schedules/item', 'https://app.example/schedules%2Fitem'],
  ['/schedules/item', 'https://app.example/schedules%5Citem'],
  ['/schedules/item', 'https://app.example/schedules/%2Fitem'],
  ['/schedules/item', 'https://app.example/schedules/%5Citem'],
  ['/schedules/item', 'https://app.example/schedules/%FF'],
  ['/schedules/item', 'https://app.example/schedules/%zz'],
  ['/schedules?month=2026-10', 'https://app.example/schedules?month=2026%FF10'],
  ['https://foreign.example/schedules', 'https://app.example/schedules'],
  ['/schedules', 'invalid URL'],
])(
  'fails closed for different or malformed route %s vs%s',
  (expected, current) =>
    expect(scheduleRouteMatches(expected, current)).toBe(false),
);
