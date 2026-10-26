// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordAttendanceObservation } from '@/server/services/attendance-points/analytics';
import { createAttendanceAnalyticsPort } from '@/server/db/attendance-points-analytics';
import { getAttendanceAnalyticsPort } from '@/server/attendance-points/analytics';
import { ANALYTICS_REQUEST_TIMEOUT_MS } from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { MediaServiceClient } from '@/server/db/media-client';
import {
  pointsActor,
  pointsOther,
  pointEntry,
} from './attendance-points-fixtures';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/server/db/media-client', () => ({
  createMediaServiceClient: mocks.client,
}));
const input = {
  actor_id: pointsActor,
  entry_id: pointEntry.id,
};
function dbFixture(
  data: unknown = pointsOther,
  error: { message: string } | null = null,
) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  const client = { rpc } as unknown as MediaServiceClient;
  return {
    rpc,
    abortSignal,
    client,
    port: createAttendanceAnalyticsPort(client),
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
it('records only a verified attendance source with the ledger-entry event key and trusted actor', async () => {
  const f = dbFixture();
  expect(await recordAttendanceObservation(f.port, input)).toEqual({
    ok: true,
    data: null,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('analytics_record_server', {
    p_actor_id: pointsActor,
    p_event_key: pointEntry.id,
    p_name: AnalyticsEvent.ATTENDANCE,
    p_source_id: pointEntry.id,
  });
  expect(f.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it('bounds optional analytics by existing timeout without changing receipt identity on replay', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const f = dbFixture();
  await recordAttendanceObservation(f.port, input);
  await recordAttendanceObservation(f.port, input);
  expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1]);
  expect(timeout).toHaveBeenCalledWith(ANALYTICS_REQUEST_TIMEOUT_MS);
});
it.each([
  null,
  {},
  { ...input, actor_id: 'bad' },
  { ...input, event_key: 'bad' },
  { ...input, entry_id: 'bad' },
  { ...input, body: 'private content' },
  { ...input, occurred_at: '2026-10-25' },
  { ...input, name: 'subscribe_complete' },
])('rejects arbitrary observation input %#', async (value) => {
  const f = dbFixture();
  expect(await recordAttendanceObservation(f.port, value)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
it('missing capability is setup-not-ready rather than fabricated analytics success', async () =>
  expect(await recordAttendanceObservation(null, input)).toEqual({
    ok: false,
    code: 'SETUP_NOT_READY',
  }));
it.each([
  ['ANALYTICS_ACTOR_FORBIDDEN', 'FORBIDDEN'],
  ['ANALYTICS_SOURCE_FORBIDDEN', 'FORBIDDEN'],
  ['ANALYTICS_CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
  ['ANALYTICS_EVENT_REQUIRED', 'INVALID_INPUT'],
  ['ANALYTICS_EVENT_TIME_INVALID', 'INVALID_INPUT'],
  ['ANALYTICS_EVENT_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
  ['private SQL diagnostic', 'UNAVAILABLE'],
  ['toString', 'UNAVAILABLE'],
])(
  'normalizes %s while preserving the optional observer result',
  async (message, code) =>
    expect(
      await recordAttendanceObservation(
        dbFixture(null, { message }).port,
        input,
      ),
    ).toEqual({ ok: false, code }),
);
it.each([null, {}, false, 'bad', { id: pointsOther }])(
  'does not claim successful observation on bad RPC receipt %#',
  async (data) =>
    expect(
      await recordAttendanceObservation(dbFixture(data).port, input),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }),
);
it('contains thrown observer failure without private diagnostics', async () => {
  const record = vi.fn().mockRejectedValue(new Error('private analytics key'));
  expect(await recordAttendanceObservation({ record }, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects non-null alleged successful observer payload', async () => {
  const record = vi.fn().mockResolvedValue({ ok: true, data: 'internal-id' });
  expect(await recordAttendanceObservation({ record }, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('composition never exposes service capability credentials as output data', () => {
  const f = dbFixture();
  mocks.client.mockReturnValue(f.client);
  const port = getAttendanceAnalyticsPort();
  expect(port).not.toBeNull();
  expect(Object.keys(port!)).toEqual(['record']);
  expect(JSON.stringify(port)).toBe('{}');
  expect(f.rpc).not.toHaveBeenCalled();
});
it('unconfigured and throwing factory both disable optional observation', () => {
  mocks.client.mockReturnValue(null);
  expect(getAttendanceAnalyticsPort()).toBeNull();
  mocks.client.mockImplementation(() => {
    throw new Error('private config');
  });
  expect(getAttendanceAnalyticsPort()).toBeNull();
});
