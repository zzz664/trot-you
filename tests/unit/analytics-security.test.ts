// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsBody } from '@/server/analytics/security';
import { ANALYTICS_BODY_TIMEOUT_MS } from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';

const input = {
  event_key: 'a2100000-0000-4000-8000-000000000001',
  name: AnalyticsEvent.VOICE_INPUT_USED,
  properties: { voice_context: 'reply' },
};
afterEach(() => vi.useRealTimers());
describe('bounded optional analytics body reader', () => {
  it('accepts UTF-8 JSON with a charset and no extra fields', async () => {
    const request = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(input),
    });
    expect(await analyticsBody(request)).toEqual(input);
  });
  it('rejects an absent body', async () => {
    expect(
      await analyticsBody(
        new Request('https://app.example', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ).toBeNull();
  });
  it('rejects an already aborted body', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await analyticsBody(
        new Request('https://app.example', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        }),
      ),
    ).toBeNull();
  });
  it('cancels an in-flight reader immediately when its request is aborted', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit);
    const result = analyticsBody(request);
    controller.abort();
    expect(await result).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it('cancels a stalled reader rather than leaving unbounded ingestion work', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request('https://app.example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const result = analyticsBody(request);
    await vi.advanceTimersByTimeAsync(ANALYTICS_BODY_TIMEOUT_MS);
    expect(await result).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
});
