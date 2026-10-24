// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsEvent } from '@/config/analytics-events';
import { createAnalyticsPort } from '@/server/db/analytics';
import type { ActorClient } from '@/server/db/client';

const id = 'a2100000-0000-4000-8000-000000000001';
const input = {
  event_key: id,
  name: AnalyticsEvent.VOICE_INPUT_USED,
  properties: { voice_context: 'reply' as const },
};
function fixture(result: unknown) {
  const abortSignal = vi.fn().mockResolvedValue(result);
  const rpc = vi
    .fn()
    .mockReturnValue(Object.assign(Promise.resolve(result), { abortSignal }));
  return {
    port: createAnalyticsPort({ rpc } as unknown as ActorClient),
    rpc,
    abortSignal,
  };
}
describe('consent-gated actor analytics RPC adapter', () => {
  it('passes only typed context, session key and event name, not actor or transcript', async () => {
    const { port, rpc } = fixture({ data: id, error: null });
    expect(await port.record(input)).toEqual({ ok: true, data: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('analytics_record_client', {
      p_event_key: id,
      p_name: AnalyticsEvent.VOICE_INPUT_USED,
      p_voice_context: 'reply',
    });
  });
  it('passes a lifecycle AbortSignal to the actual request', async () => {
    const { port, abortSignal } = fixture({ data: id, error: null });
    const signal = new AbortController().signal;
    expect(await port.record(input, signal)).toEqual({ ok: true, data: null });
    expect(abortSignal).toHaveBeenCalledExactlyOnceWith(signal);
  });
  it('uses only source handle for the existing generic message observation', async () => {
    const { port, rpc } = fixture({ data: id, error: null });
    await port.record({
      event_key: id,
      name: AnalyticsEvent.MESSAGE_OPEN,
      properties: { source_id: id },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('analytics_record_client', {
      p_event_key: id,
      p_name: AnalyticsEvent.MESSAGE_OPEN,
      p_source_id: id,
    });
  });
  it.each([
    ['ANALYTICS_ACTOR_FORBIDDEN', 'FORBIDDEN'],
    ['ANALYTICS_CLIENT_EVENT_FORBIDDEN', 'FORBIDDEN'],
    ['ANALYTICS_SOURCE_FORBIDDEN', 'FORBIDDEN'],
    ['ANALYTICS_CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
    ['ANALYTICS_EVENT_REQUIRED', 'INVALID_INPUT'],
    ['ANALYTICS_EVENT_TIME_INVALID', 'INVALID_INPUT'],
    ['ANALYTICS_EVENT_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['unknown details including private data', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
  ])('maps refusal %s without exposing DB details', async (message, code) => {
    const { port } = fixture({ data: null, error: { message } });
    expect(await port.record(input)).toEqual({ ok: false, code });
  });
  it.each([null, undefined, '', 'invalid', [], {}, { id }, true])(
    'does not treat malformed RPC success %j as recorded',
    async (data) => {
      const { port } = fixture({ data, error: null });
      expect(await port.record(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
});
