// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEBPUSH } from '@/config/webpush';
import type { ActorClient } from '@/server/db/client';
import { verifiedWebPushActor, webPushBody } from '@/server/webpush/security';

const actorId = 'a4000000-0000-4000-8000-000000000001';
const sessionId = 'a4000000-0000-4000-8000-000000000002';
function client(result: unknown) {
  return {
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  } as unknown as ActorClient;
}
function request(
  value: string | ReadableStream<Uint8Array>,
  type = 'application/json',
) {
  return new Request('https://app.example', {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: value,
    duplex: 'half',
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());
describe('verified webpush session identity', () => {
  it('extracts only verified subject and session claim after matching expected actor', async () => {
    const c = client({
      data: {
        claims: {
          sub: actorId,
          session_id: sessionId,
          email: 'private',
          user_metadata: { role: 'admin' },
        },
      },
      error: null,
    });
    expect(await verifiedWebPushActor(c, actorId)).toEqual({
      actorId,
      sessionId,
    });
    expect(c.auth.getClaims).toHaveBeenCalledOnce();
  });
  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: actorId } }, error: null },
    { data: { claims: { sub: actorId, session_id: 'invalid' } }, error: null },
    {
      data: { claims: { sub: sessionId, session_id: sessionId } },
      error: null,
    },
    {
      data: { claims: { sub: actorId, session_id: sessionId } },
      error: { message: 'private' },
    },
    { data: { claims: { sub: actorId, session_id: null } }, error: null },
  ])('fails identity boundary closed %#', async (result) => {
    expect(await verifiedWebPushActor(client(result), actorId)).toBeNull();
  });
  it('never decodes a cookie fallback after verification throws', async () => {
    const c = client(null);
    vi.mocked(c.auth.getClaims).mockRejectedValueOnce(new Error('private'));
    expect(await verifiedWebPushActor(c, actorId)).toBeNull();
  });
});
describe('bounded webpush body parsing', () => {
  it('preserves UTF8 split across byte boundaries', async () => {
    const input = { action: 'status', endpoint: null, label: '안녕하세요 💜' };
    const bytes = new TextEncoder().encode(JSON.stringify(input));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    expect(
      await webPushBody(request(stream, 'application/json; charset=utf-8')),
    ).toEqual(input);
    expect(stream.locked).toBe(false);
  });
  it.each([
    'text/plain',
    'application/x-www-form-urlencoded',
    'Application/JSON',
    '',
  ])('rejects content type %j', async (type) => {
    expect(await webPushBody(request('{}', type))).toBeNull();
  });
  it.each(['', '{', 'undefined', '{"value":NaN}'])(
    'rejects malformed JSON %j',
    async (body) => {
      expect(await webPushBody(request(body))).toBeNull();
    },
  );
  it('does not wait for an absent request stream', async () => {
    expect(
      await webPushBody(
        new Request('https://app.example', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ).toBeNull();
  });
  it('rejects invalid UTF8 instead of replacement decoding', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(Uint8Array.of(255));
        c.close();
      },
    });
    expect(await webPushBody(request(stream))).toBeNull();
  });
  it('allows exactly bounded JSON and cancels oversize byte streams', async () => {
    const text = '"' + 'x'.repeat(WEBPUSH.bodyLimit - 2) + '"';
    expect(await webPushBody(request(text))).toBe(
      'x'.repeat(WEBPUSH.bodyLimit - 2),
    );
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(WEBPUSH.bodyLimit + 1));
      },
      cancel,
    });
    expect(await webPushBody(request(stream))).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it('bounds unfinished stream and releases reader without wall-clock sleeping', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = webPushBody(request(stream));
    await vi.advanceTimersByTimeAsync(WEBPUSH.bodyTimeoutMs);
    expect(await pending).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it('fails throwing stream closed without leaking cause', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('private');
      },
    });
    expect(await webPushBody(request(stream))).toBeNull();
    expect(stream.locked).toBe(false);
  });
});
