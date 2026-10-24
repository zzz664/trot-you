// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseStorageAdapter } from '@/server/adapters/storage/supabase';
import { STORAGE_MAX_BYTES, STORAGE_TIMEOUT_MS } from '@/config/storage';

const origin = 'https://fictional.supabase.co';
const key = 'fictional-private-storage-key';
const id = 'a1800000-0000-4000-8000-000000000001';
const messageId = 'a1800000-0000-4000-8000-000000000002';
const mediaId = 'a1800000-0000-4000-8000-000000000003';
const objectId = 'a1800000-0000-4000-8000-000000000004';
const path = `${id}/${messageId}/${mediaId}.png`;
const invalid = { ok: false, code: 'INVALID_MEDIA' };
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const body = new Uint8Array([1, 2, 3, 4]);
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function token(payload: Record<string, unknown>) {
  return `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fictionalSignature`;
}
const readToken = (overrides: Record<string, unknown> = {}) =>
  token({
    url: `message-media/${path}`,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  });
const uploadUrl = (suffix = '?token=fictionalUploadToken') =>
  `/object/upload/sign/media-quarantine/${path}${suffix}`;
const readUrl = (signedToken = readToken()) =>
  `/object/sign/message-media/${path}?token=${signedToken}`;
function adapter(
  response:
    | Response
    | ((
        input: RequestInfo | URL,
        init?: RequestInit,
      ) => Response | Promise<Response>),
) {
  const transport = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) =>
      typeof response === 'function' ? response(input, init) : response,
    );
  return {
    port: createSupabaseStorageAdapter({
      url: origin,
      serviceRoleKey: key,
      transport,
    }),
    transport,
  };
}
afterEach(() => vi.restoreAllMocks());

describe('real Supabase SDK signed capability contract', () => {
  it('signs one canonical quarantine upload without upsert or client storage credentials', async () => {
    const fake = adapter(json({ url: uploadUrl() }));
    expect(await fake.port.signUpload(path)).toEqual({
      ok: true,
      data: { signedUrl: `${origin}/storage/v1${uploadUrl()}` },
    });
    const [target, init] = fake.transport.mock.calls[0]!;
    expect(String(target)).toBe(
      `${origin}/storage/v1/object/upload/sign/media-quarantine/${path}`,
    );
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${key}`,
    );
    expect(new Headers(init?.headers).get('x-upsert')).toBeNull();
    expect(
      JSON.stringify(await fake.port.removeQuarantine('../secret')),
    ).not.toContain(key);
  });
  it('returns actual short-lived signed read expiry from provider JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const signed = readToken({ exp, scope: 'download' });
    const fake = adapter(json({ signedURL: readUrl(signed) }));
    expect(await fake.port.signRead(path, 60)).toEqual({
      ok: true,
      data: {
        signedUrl: `${origin}/storage/v1${readUrl(signed)}`,
        expiresAt: new Date(exp * 1000).toISOString(),
      },
    });
    expect(String(fake.transport.mock.calls[0]![0])).toBe(
      `${origin}/storage/v1/object/sign/message-media/${path}`,
    );
    expect(JSON.parse(String(fake.transport.mock.calls[0]![1]?.body))).toEqual({
      expiresIn: 60,
    });
  });
  it.each([0, -1, 61, 3600, Infinity, NaN, 1.1])(
    'rejects invalid or overly long read TTL %s before I/O',
    async (ttl) => {
      const fake = adapter(json({ signedURL: readUrl() }));
      expect(await fake.port.signRead(path, ttl)).toEqual(invalid);
      expect(fake.transport).not.toHaveBeenCalled();
    },
  );
  it.each([
    { exp: 0 },
    { exp: Math.floor(Date.now() / 1000) - 1 },
    { exp: Math.floor(Date.now() / 1000) + 3600 },
    { exp: '99999999999' },
    { exp: Infinity },
    { exp: 1.5 },
    { url: 'message-media/another-object' },
    { scope: 'upload' },
  ])('rejects misleading read token bounds/bindings %j', async (claims) => {
    const fake = adapter(json({ signedURL: readUrl(readToken(claims)) }));
    expect(await fake.port.signRead(path, 60)).toEqual(unavailable);
  });
  it.each(['invalid', 'a.b.c', 'a.@@@.c', 'a.eyJleHAiOjEyM30.c.extra'])(
    'rejects malformed provider token %s without leaking it',
    async (signed) => {
      expect(
        await adapter(json({ signedURL: readUrl(signed) })).port.signRead(
          path,
          60,
        ),
      ).toEqual(unavailable);
    },
  );
  it.each([
    '?token=x&download=unsafe',
    '?token=x&token=y',
    '?token=',
    '?token=x#secret',
  ])('rejects unexpected signed-upload URL fields %s', async (suffix) => {
    expect(
      await adapter(json({ url: uploadUrl(suffix) })).port.signUpload(path),
    ).toEqual(unavailable);
  });
  it('rejects provider path confusion and never follows external provider redirects', async () => {
    expect(
      await adapter(
        json({
          url: '/object/upload/sign/media-quarantine/../../public/secret?token=x',
        }),
      ).port.signUpload(path),
    ).toEqual(unavailable);
    const fake = adapter(
      new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.test/' },
      }),
    );
    expect(await fake.port.signUpload(path)).toEqual(unavailable);
    expect(fake.transport).toHaveBeenCalledTimes(1);
    expect(fake.transport.mock.calls[0]![1]?.redirect).toBe('error');
  });
});
describe('canonical path and object protection', () => {
  it.each([
    '',
    '../secret',
    'https://example.test/secret',
    `${path}?token=x`,
    `${path}#fragment`,
    `${path}/extra`,
    path.replace('.png', '.svg'),
    path.replace('.png', 'xpng'),
    path.replace('/', '%2f'),
    path.replace('/', '\\'),
  ])('rejects path %s before all storage operations', async (bad) => {
    const fake = adapter(json({}));
    expect(await fake.port.signUpload(bad)).toEqual(invalid);
    expect(await fake.port.downloadQuarantine(bad, 100)).toEqual(invalid);
    expect(await fake.port.publish(bad, body, 'image/png')).toEqual(invalid);
    expect(await fake.port.removeQuarantine(bad)).toEqual(invalid);
    expect(await fake.port.signRead(bad, 60)).toEqual(invalid);
    expect(fake.transport).not.toHaveBeenCalled();
  });
  it('uploads immutable final media with verified MIME, exact bytes and no cache retention', async () => {
    const fake = adapter(json({ Id: objectId, Key: `message-media/${path}` }));
    expect(await fake.port.publish(path, body, 'image/png')).toEqual({
      ok: true,
      data: { objectId },
    });
    const [target, init] = fake.transport.mock.calls[0]!;
    expect(String(target)).toBe(
      `${origin}/storage/v1/object/message-media/${path}`,
    );
    expect(init?.body).toBe(body);
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-upsert')).toBe('false');
    expect(headers.get('cache-control')).toBe('max-age=0');
    expect(headers.get('content-type')).toBe('image/png');
  });
  it('does not publish mismatched MIME/extension or empty bytes', async () => {
    const fake = adapter(json({}));
    expect(await fake.port.publish(path, body, 'image/jpeg')).toEqual(invalid);
    expect(
      await fake.port.publish(path, new Uint8Array(), 'image/png'),
    ).toEqual(invalid);
    expect(fake.transport).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'safe lost-response retry compares exact bytes, match=%s',
    async (match) => {
      const fake = adapter((input, init) => {
        if (init?.method === 'POST') return json({ message: 'duplicate' }, 409);
        if (String(input).includes('/object/info/'))
          return json({
            id: objectId,
            name: path,
            bucket_id: 'message-media',
            content_type: 'image/png',
            size: body.length,
          });
        return new Response(match ? body : new Uint8Array([4, 3, 2, 1]));
      });
      expect(await fake.port.publish(path, body, 'image/png')).toEqual(
        match ? { ok: true, data: { objectId } } : unavailable,
      );
      expect(fake.transport).toHaveBeenCalledTimes(3);
      expect(
        fake.transport.mock.calls.some(
          ([, init]) => init?.method === 'PUT' || init?.method === 'DELETE',
        ),
      ).toBe(false);
    },
  );
  it('removes only quarantine and never final media', async () => {
    const fake = adapter(json([]));
    expect(await fake.port.removeQuarantine(path)).toEqual({
      ok: true,
      data: null,
    });
    expect(String(fake.transport.mock.calls[0]![0])).toBe(
      `${origin}/storage/v1/object/media-quarantine`,
    );
    expect(JSON.parse(String(fake.transport.mock.calls[0]![1]?.body))).toEqual({
      prefixes: [path],
    });
  });
});
describe('bounded private downloads', () => {
  it('uses private authenticated exact-path streaming download', async () => {
    const fake = adapter(new Response(body));
    expect(await fake.port.downloadQuarantine(path, body.length)).toEqual({
      ok: true,
      data: body,
    });
    expect(String(fake.transport.mock.calls[0]![0])).toBe(
      `${origin}/storage/v1/object/media-quarantine/${path}`,
    );
  });
  it('cancels oversized stream based on actual bytes, not forged headers', async () => {
    const cancel = vi.fn();
    const fake = adapter(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(5));
          },
          cancel,
        }),
        { headers: { 'content-length': '1' } },
      ),
    );
    expect(await fake.port.downloadQuarantine(path, 4)).toEqual(invalid);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, STORAGE_MAX_BYTES + 1, NaN, Infinity, 1.5])(
    'rejects invalid byte limit %s before I/O',
    async (limit) => {
      const fake = adapter(new Response(body));
      expect(await fake.port.downloadQuarantine(path, limit)).toEqual(invalid);
      expect(fake.transport).not.toHaveBeenCalled();
    },
  );
  it('aborts stalled body consumption and suppresses raw provider exceptions', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const cancel = vi.fn();
    const fake = adapter(new Response(new ReadableStream({ cancel })));
    const pending = fake.port.downloadQuarantine(path, 4);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    expect(await pending).toEqual(unavailable);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(STORAGE_TIMEOUT_MS);
  });
  it('returns no credential, path, upstream content or stack on provider errors', async () => {
    const fake = adapter(() => {
      throw new Error(`${key} ${path} secret-content`);
    });
    expect(await fake.port.signUpload(path)).toEqual(unavailable);
    expect(await fake.port.downloadQuarantine(path, 4)).toEqual(unavailable);
    expect(await fake.port.publish(path, body, 'image/png')).toEqual(
      unavailable,
    );
    expect(await fake.port.removeQuarantine(path)).toEqual(unavailable);
    expect(await fake.port.signRead(path, 60)).toEqual(unavailable);
  });
});
