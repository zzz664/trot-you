// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsEvent } from '@/config/analytics-events';
import {
  ANALYTICS_ERROR_STATUS,
  type AnalyticsResult,
} from '@/config/analytics';
import {
  captureServerEvent,
  captureChargeEvent,
  captureCancellation,
  type AnalyticsCapturePort,
} from '@/server/services/analytics/capture';
const id = 'a3900000-0000-4000-8000-000000000001';
const source = 'a3900000-0000-4000-8000-000000000002';
const observation = {
  actor_id: id,
  event: {
    event_key: source,
    name: AnalyticsEvent.REPLY_SENT,
    properties: { source_id: source },
  },
};
function fixture() {
  return {
    server: vi.fn().mockResolvedValue({ ok: true, data: null }),
    charge: vi.fn().mockResolvedValue({ ok: true, data: null }),
    cancellation: vi.fn().mockResolvedValue({ ok: true, data: null }),
  } satisfies AnalyticsCapturePort;
}
describe('prospective optional source observation services', () => {
  it('passes only whitelisted source metadata and the lifecycle signal', async () => {
    const port = fixture();
    const signal = new AbortController().signal;
    expect(await captureServerEvent(port, observation, signal)).toEqual({
      ok: true,
      data: null,
    });
    expect(port.server).toHaveBeenCalledExactlyOnceWith(observation, signal);
  });
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
  ])(
    'validates documented server vocabulary %s without claiming DB eligibility',
    async (name) => {
      const port = fixture();
      const properties =
        name === AnalyticsEvent.SIGNUP_COMPLETE
          ? {}
          : name === AnalyticsEvent.FONT_SIZE_SELECTED
            ? { font_scale: 'large' }
            : { source_id: source };
      expect(
        await captureServerEvent(port, {
          actor_id: id,
          event: { event_key: source, name, properties },
        }),
      ).toEqual({ ok: true, data: null });
      expect(port.server).toHaveBeenCalledOnce();
    },
  );
  it.each([
    null,
    {},
    [],
    { ...observation, actor_id: 'invalid' },
    { ...observation, timestamp: '2026-10-26T00:00:00Z' },
    {
      ...observation,
      event: {
        ...observation.event,
        properties: { source_id: source, text: 'private' },
      },
    },
    ...[
      AnalyticsEvent.MESSAGE_OPEN,
      AnalyticsEvent.VOICE_INPUT_USED,
      AnalyticsEvent.SUBSCRIBE_COMPLETE,
      AnalyticsEvent.RENEW,
    ].map((name) => ({
      ...observation,
      event: { ...observation.event, name },
    })),
  ])(
    'rejects forged/minimally invalid payload %j before I/O',
    async (input) => {
      const port = fixture();
      expect(await captureServerEvent(port, input)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(port.server).not.toHaveBeenCalled();
    },
  );
  it('does not expose actor or classification parameters for verified charges', async () => {
    const port = fixture();
    expect(await captureChargeEvent(port, source)).toEqual({
      ok: true,
      data: null,
    });
    expect(port.charge).toHaveBeenCalledExactlyOnceWith(source, undefined);
    expect(
      await captureChargeEvent(port, {
        event_id: source,
        name: 'renew',
        actor_id: id,
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(port.charge).toHaveBeenCalledOnce();
  });
  it('lets the database derive cancellation epoch rather than accepting a browser key', async () => {
    const port = fixture();
    const input = { actor_id: id, subscription_id: source };
    expect(await captureCancellation(port, input)).toEqual({
      ok: true,
      data: null,
    });
    expect(port.cancellation).toHaveBeenCalledExactlyOnceWith(input, undefined);
    expect(
      await captureCancellation(port, { ...input, event_key: id }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it.each(['server', 'charge', 'cancellation'] as const)(
    'does not send %s after cancellation or without configuration',
    async (kind) => {
      const port = fixture();
      const controller = new AbortController();
      controller.abort();
      const run = (value: AnalyticsCapturePort | null, signal?: AbortSignal) =>
        kind === 'server'
          ? captureServerEvent(value, observation, signal)
          : kind === 'charge'
            ? captureChargeEvent(value, source, signal)
            : captureCancellation(
                value,
                { actor_id: id, subscription_id: source },
                signal,
              );
      expect(await run(port, controller.signal)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
      expect(port[kind]).not.toHaveBeenCalled();
      expect(await run(null)).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
    },
  );
  it.each(Object.keys(ANALYTICS_ERROR_STATUS))(
    'retains controlled %s refusal with no retry',
    async (code) => {
      const port = fixture();
      port.server.mockResolvedValue({ ok: false, code });
      expect(await captureServerEvent(port, observation)).toEqual({
        ok: false,
        code,
      });
      expect(port.server).toHaveBeenCalledOnce();
    },
  );
  it.each([
    undefined,
    null,
    {},
    { ok: true, data: source },
    { ok: false, code: 'private sql error' },
  ])('does not accept malformed optional success %j', async (result) => {
    const port = fixture();
    port.server.mockResolvedValue(result as AnalyticsResult<null>);
    expect(await captureServerEvent(port, observation)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('isolates thrown adapters', async () => {
    const port = fixture();
    port.charge.mockRejectedValue(new Error('private detail'));
    expect(await captureChargeEvent(port, source)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(port.charge).toHaveBeenCalledOnce();
  });
});
