// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordVoiceInput } from '@/client/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { VoiceInputContext } from '@/config/analytics';
import { routes } from '@/config/routes';

const eventKey = 'a2100000-0000-4000-8000-000000000001';
const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

describe('optional voice observation transport', () => {
  it.each(['reply', 'post', 'comment'] as const)(
    'sends only the approved %s context and caller session key',
    async (context) => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      fetcher.mockResolvedValue({ body: { cancel } });
      const controller = new AbortController();
      await expect(
        recordVoiceInput(context, eventKey, controller.signal),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(routes.analytics, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_key: eventKey,
          name: AnalyticsEvent.VOICE_INPUT_USED,
          properties: { voice_context: context },
        }),
        signal: expect.any(AbortSignal),
      });
      expect(cancel).toHaveBeenCalledOnce();
      const options = fetcher.mock.calls[0]![1];
      expect(options).not.toHaveProperty('keepalive');
      controller.abort();
      expect(options.signal.aborted).toBe(true);
    },
  );
  it.each(['artist', 'reply transcript', '', null, { transcript: '음성' }])(
    'ignores invalid context without I/O: %j',
    async (context) => {
      await recordVoiceInput(context as VoiceInputContext, eventKey);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(['', '123', 'private-transcript'])(
    'ignores invalid key %s',
    async (key) => {
      await recordVoiceInput('reply', key);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('does not send after lifecycle cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await recordVoiceInput('reply', eventKey, controller.signal);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 429, 500, 503])(
    'does not retry or surface HTTP %i to the draft',
    async (status) => {
      fetcher.mockResolvedValue(new Response('ignored', { status }));
      await expect(
        recordVoiceInput('reply', eventKey),
      ).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it('swallows transport and response disposal failure without retry', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await expect(recordVoiceInput('reply', eventKey)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockResolvedValueOnce({
      body: { cancel: vi.fn().mockRejectedValue(new Error('cancel failed')) },
    });
    await expect(recordVoiceInput('reply', eventKey)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not inspect or decode an absent response body', async () => {
    fetcher.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(recordVoiceInput('reply', eventKey)).resolves.toBeUndefined();
  });
});
