// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsEvent } from '@/config/analytics-events';
import { track, type AnalyticsPort } from '@/server/services/analytics/track';

const event = {
  event_key: 'a2100000-0000-4000-8000-000000000001',
  name: AnalyticsEvent.VOICE_INPUT_USED,
  properties: { voice_context: 'reply' },
};
function fixture() {
  const record = vi
    .fn<AnalyticsPort['record']>()
    .mockResolvedValue({ ok: true, data: null });
  return { record, port: { record } };
}
describe('actor-bound client analytics service', () => {
  it('passes only validated observation fields and lifecycle signal', async () => {
    const { record, port } = fixture();
    const signal = new AbortController().signal;
    expect(await track(port, event, signal)).toEqual({ ok: true, data: null });
    expect(record).toHaveBeenCalledExactlyOnceWith(event, signal);
  });
  it('keeps the documented generic client observation boundary without emitting it automatically', async () => {
    const { record, port } = fixture();
    const input = {
      ...event,
      name: AnalyticsEvent.MESSAGE_OPEN,
      properties: { source_id: event.event_key },
    };
    expect(await track(port, input)).toEqual({ ok: true, data: null });
    expect(record).toHaveBeenCalledExactlyOnceWith(input, undefined);
  });
  it.each([
    null,
    { ...event, event_key: 'not-a-uuid' },
    { ...event, actor: event.event_key },
    { ...event, occurred_at: '2026-10-24T00:00:00Z' },
    { ...event, name: AnalyticsEvent.REPLY_SENT },
    { ...event, name: AnalyticsEvent.SUBSCRIBE_COMPLETE },
    { ...event, name: AnalyticsEvent.RENEW },
    { ...event, properties: { voice_context: 'artist' } },
    {
      ...event,
      properties: { voice_context: 'reply', transcript: '비공개 문장' },
    },
    { ...event, properties: { voice_context: 'reply', audio: 'base64' } },
    {
      ...event,
      properties: { voice_context: 'reply', user_id: event.event_key },
    },
    { ...event, properties: { voice_context: 'reply', duration: 3 } },
  ])('rejects unapproved input without invoking DB %j', async (input) => {
    const { record, port } = fixture();
    expect(await track(port, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(record).not.toHaveBeenCalled();
  });
  it('skips DB after lifecycle abort', async () => {
    const { record, port } = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await track(port, event, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(record).not.toHaveBeenCalled();
  });
  it.each([
    'CONSENT_REQUIRED',
    'FORBIDDEN',
    'IDEMPOTENCY_CONFLICT',
    'UNAVAILABLE',
  ] as const)(
    'preserves current DB refusal %s and never retries',
    async (code) => {
      const { record, port } = fixture();
      record.mockResolvedValue({ ok: false, code });
      expect(await track(port, event)).toEqual({ ok: false, code });
      expect(record).toHaveBeenCalledOnce();
    },
  );
  it('contains unexpected failures without logging content', async () => {
    const { record, port } = fixture();
    record.mockRejectedValue(new Error('private provider error'));
    expect(await track(port, event)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(record).toHaveBeenCalledOnce();
  });
});
