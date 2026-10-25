// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recordCommunityPostCreation } from '@/server/services/community-posts/analytics';
import { createCommunityPostAnalyticsPort } from '@/server/db/community-post-analytics';
import { getCommunityPostAnalyticsPort } from '@/server/community-posts/analytics';
import { ANALYTICS_REQUEST_TIMEOUT_MS } from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { MediaServiceClient } from '@/server/db/media-client';
import {
  boardActorId,
  boardPostId,
  boardOperationId,
  boardOtherId,
} from './community-posts-fixtures';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/server/db/media-client', () => ({
  createMediaServiceClient: mocks.client,
}));
const input = {
  actor_id: boardActorId,
  event_key: boardOperationId,
  post_id: boardPostId,
};
function dbFixture(
  data: unknown = boardOtherId,
  error: { message: string } | null = null,
) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  const client = { rpc } as unknown as MediaServiceClient;
  return {
    rpc,
    abortSignal,
    client,
    port: createCommunityPostAnalyticsPort(client),
  };
}
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
it('records only a verified post source with original event key and trusted actor', async () => {
  const f = dbFixture();
  expect(await recordCommunityPostCreation(f.port, input)).toEqual({
    ok: true,
    data: null,
  });
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith('analytics_record_server', {
    p_actor_id: boardActorId,
    p_event_key: boardOperationId,
    p_name: AnalyticsEvent.POST_CREATE,
    p_source_id: boardPostId,
  });
  expect(f.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it('bounds optional analytics by existing timeout without changing receipt identity on replay', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const f = dbFixture();
  await recordCommunityPostCreation(f.port, input);
  await recordCommunityPostCreation(f.port, input);
  expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1]);
  expect(timeout).toHaveBeenCalledWith(ANALYTICS_REQUEST_TIMEOUT_MS);
});
it.each([
  null,
  {},
  { ...input, actor_id: 'bad' },
  { ...input, event_key: 'bad' },
  { ...input, post_id: 'bad' },
  { ...input, body: 'private content' },
  { ...input, occurred_at: '2026-10-25' },
  { ...input, name: 'subscribe_complete' },
])('rejects arbitrary observation input %#', async (value) => {
  const f = dbFixture();
  expect(await recordCommunityPostCreation(f.port, value)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
it('missing capability is setup-not-ready rather than fabricated analytics success', async () =>
  expect(await recordCommunityPostCreation(null, input)).toEqual({
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
      await recordCommunityPostCreation(
        dbFixture(null, { message }).port,
        input,
      ),
    ).toEqual({ ok: false, code }),
);
it.each([null, {}, false, 'bad', { id: boardOtherId }])(
  'does not claim successful observation on bad RPC receipt %#',
  async (data) =>
    expect(
      await recordCommunityPostCreation(dbFixture(data).port, input),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }),
);
it('contains thrown observer failure without private diagnostics', async () => {
  const record = vi.fn().mockRejectedValue(new Error('private analytics key'));
  expect(await recordCommunityPostCreation({ record }, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects non-null alleged successful observer payload', async () => {
  const record = vi.fn().mockResolvedValue({ ok: true, data: 'internal-id' });
  expect(await recordCommunityPostCreation({ record }, input)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('composition never exposes service capability credentials as output data', () => {
  const f = dbFixture();
  mocks.client.mockReturnValue(f.client);
  const port = getCommunityPostAnalyticsPort();
  expect(port).not.toBeNull();
  expect(Object.keys(port!)).toEqual(['record']);
  expect(JSON.stringify(port)).toBe('{}');
  expect(f.rpc).not.toHaveBeenCalled();
});
it('unconfigured and throwing factory both disable optional observation', () => {
  mocks.client.mockReturnValue(null);
  expect(getCommunityPostAnalyticsPort()).toBeNull();
  mocks.client.mockImplementation(() => {
    throw new Error('private config');
  });
  expect(getCommunityPostAnalyticsPort()).toBeNull();
});
