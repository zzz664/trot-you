// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsEvent } from '@/config/analytics-events';
import { createAnalyticsCapturePort } from '@/server/db/analytics-capture';
import type { MediaServiceClient } from '@/server/db/media-client';
const id = 'a3900000-0000-4000-8000-000000000001';
const source = 'a3900000-0000-4000-8000-000000000002';
function fixture(data: unknown, error: { message: string } | null = null) {
  const abortSignal = vi.fn().mockResolvedValue({ data, error });
  const rpc = vi.fn().mockReturnValue({ abortSignal });
  return {
    port: createAnalyticsCapturePort({ rpc } as unknown as MediaServiceClient),
    rpc,
    abortSignal,
  };
}
describe('prospective analytics trusted DB adapter', () => {
  it.each([
    AnalyticsEvent.SIGNUP_COMPLETE,
    AnalyticsEvent.FONT_SIZE_SELECTED,
    AnalyticsEvent.PREVIEW_VIEW,
    AnalyticsEvent.SUBSCRIBE_START,
    AnalyticsEvent.SUBSCRIBE_FAIL,
    AnalyticsEvent.REPLY_SENT,
    AnalyticsEvent.CANCEL,
    AnalyticsEvent.POST_CREATE,
    AnalyticsEvent.ATTENDANCE,
  ])('uses narrow capture RPC for %s', async (name) => {
    const { port, rpc } = fixture(source);
    const event =
      name === AnalyticsEvent.SIGNUP_COMPLETE
        ? { name, event_key: source, properties: {} }
        : name === AnalyticsEvent.FONT_SIZE_SELECTED
          ? {
              name,
              event_key: source,
              properties: { font_scale: 'large' as const },
            }
          : { name, event_key: source, properties: { source_id: source } };
    expect(await port.server({ actor_id: id, event })).toEqual({
      ok: true,
      data: null,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('analytics_capture_server', {
      p_actor_id: id,
      p_event_key: source,
      p_name: name,
      ...(name === AnalyticsEvent.SIGNUP_COMPLETE
        ? {}
        : name === AnalyticsEvent.FONT_SIZE_SELECTED
          ? { p_font_scale: 'large' }
          : { p_source_id: source }),
    });
  });
  it('does not let charge caller classify or supply source properties', async () => {
    const { port, rpc } = fixture(source);
    expect(await port.charge(source)).toEqual({ ok: true, data: null });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('analytics_capture_charge', {
      p_event_id: source,
    });
  });
  it('uses current cancellation epoch lookup, not a synthetic retry key', async () => {
    const { port, rpc } = fixture(source);
    await port.cancellation({ actor_id: id, subscription_id: source });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'analytics_record_cancellation',
      { p_actor_id: id, p_subscription_id: source },
    );
  });
  it('applies both lifecycle and bounded transport signal', async () => {
    const { port, abortSignal } = fixture(source);
    const controller = new AbortController();
    await port.charge(source, controller.signal);
    const signal = abortSignal.mock.calls[0]![0] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
  it.each([
    ['ANALYTICS_CAPTURE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['ANALYTICS_CAPTURE_SOURCE_BEFORE_START', 'FORBIDDEN'],
    ['ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE', 'UNAVAILABLE'],
    ['ANALYTICS_CAPTURE_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
    ['ANALYTICS_CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
    ['ANALYTICS_EVENT_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['ANALYTICS_SOURCE_FORBIDDEN', 'FORBIDDEN'],
    ['private sql text', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
  ])('maps %s without exposing internal details', async (message, code) => {
    const { port } = fixture(null, { message });
    expect(await port.charge(source)).toEqual({ ok: false, code });
  });
  it.each([null, undefined, 'invalid', [], {}, true, { id: source }])(
    'rejects malformed source receipt %j',
    async (value) => {
      const { port } = fixture(value);
      expect(await port.charge(source)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
});
