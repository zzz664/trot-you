// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginMediaUpload,
  completeMediaUpload,
  mediaExpiryDelay,
  readMediaUrl,
  revokeMediaUpload,
  uploadMediaBytes,
} from '@/client/media';
import {
  MEDIA_MAX_BYTES,
  MEDIA_RESPONSE_MAX_BYTES,
  type MediaReadGrant,
  type MediaUploadGrant,
} from '@/config/media';
import { routes } from '@/config/routes';
import {
  STORAGE_READ_URL_PREFIX,
  STORAGE_UPLOAD_URL_PREFIX,
} from '@/config/storage';

const origin = 'https://media-fixture.supabase.co';
vi.mock('@/config/env', () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://media-fixture.supabase.co',
  }),
}));
const artistId = '10000000-0000-4000-8000-000000000001';
const messageId = '10000000-0000-4000-8000-000000000002';
const mediaId = '10000000-0000-4000-8000-000000000003';
const uploadId = '10000000-0000-4000-8000-000000000004';
const requestId = '10000000-0000-4000-8000-000000000005';
const token = '?token=public-fixture-not-a-real-signed-token';
const readInput = { mediaId, preview: true };
const beginInput = {
  requestId,
  messageId,
  mimeType: 'image/png' as const,
  byteSize: 3,
};
function readGrant(overrides: Partial<MediaReadGrant> = {}): MediaReadGrant {
  return {
    url: `${origin}${STORAGE_READ_URL_PREFIX}${artistId}/${messageId}/${mediaId}.png${token}`,
    expiresAt: new Date(Date.now() + 50_000).toISOString(),
    kind: 'photo',
    mimeType: 'image/png',
    ...overrides,
  };
}
function uploadGrant(
  overrides: Partial<MediaUploadGrant> = {},
): MediaUploadGrant {
  return {
    uploadId,
    uploadUrl: `${origin}${STORAGE_UPLOAD_URL_PREFIX}${artistId}/${messageId}/${uploadId}.png${token}`,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('media read client', () => {
  it('posts only resource identity and scope with no-store and caller cancellation', async () => {
    const data = readGrant();
    fetchMock.mockResolvedValue(response({ ok: true, data }));
    const controller = new AbortController();
    expect(await readMediaUrl(readInput, controller.signal)).toEqual({
      ok: true,
      data,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      routes.mediaRead,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify(readInput),
        signal: expect.any(AbortSignal),
      }),
    );
    controller.abort();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it.each([
    { mediaId: '../private', preview: true },
    { mediaId, preview: 'true' },
    { ...readInput, path: 'other/path.png' },
    { ...readInput, actorId: artistId },
    { ...readInput, subscribed: true },
  ])(
    'rejects malformed or extra authorization input before fetch',
    async (input) => {
      expect(await readMediaUrl(input as typeof readInput)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    'https://evil.example/storage/v1/object/sign/message-media/',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    `${origin}/storage/v1/object/public/message-media/`,
    `${origin}${STORAGE_UPLOAD_URL_PREFIX}`,
  ])('rejects wrong endpoint or origin %s', async (prefix) => {
    fetchMock.mockResolvedValue(
      response({
        ok: true,
        data: readGrant({
          url: `${prefix}${artistId}/${messageId}/${mediaId}.png${token}`,
        }),
      }),
    );
    expect(await readMediaUrl(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it.each([
    (url: string) => url.replace('https://', 'https://user:password@'),
    (url: string) => `${url}#fragment`,
    (url: string) => `${url}&download=private`,
    (url: string) => `${url}&token=second`,
    (url: string) => url.replace(token, '?token='),
    (url: string) => url.replace(`/${mediaId}.png`, `/${uploadId}.png`),
    (url: string) => url.replace(`/${mediaId}.png`, `/%2F${mediaId}.png`),
    (url: string) => url.replace(`/${messageId}/`, '/not-a-resource/'),
    (url: string) => url.replace('.png?', '.svg?'),
  ])(
    'rejects credential, path, query and resource substitution',
    async (transform) => {
      const data = readGrant();
      data.url = transform(data.url);
      fetchMock.mockResolvedValue(response({ ok: true, data }));
      expect(await readMediaUrl(readInput)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );

  it.each([-1, 0, 65_000, 3_600_000])(
    'rejects stale or excessive lifetime %s',
    async (offset) => {
      fetchMock.mockResolvedValue(
        response({
          ok: true,
          data: readGrant({
            expiresAt: new Date(Date.now() + offset).toISOString(),
          }),
        }),
      );
      expect(await readMediaUrl(readInput)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );

  it.each([
    { mimeType: 'image/svg+xml' },
    { mimeType: 'audio/mp4', kind: 'photo' },
    { mimeType: 'image/png', kind: 'video' },
    { mimeType: 'video/mp4', kind: 'voice' },
    { duration: 1 },
    { expiresAt: 'tomorrow' },
  ])('rejects inconsistent or unexpected successful data', async (override) => {
    fetchMock.mockResolvedValue(
      response({ ok: true, data: { ...readGrant(), ...override } }),
    );
    expect(await readMediaUrl(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it.each(['FORBIDDEN', 'NOT_FOUND', 'EXPIRED', 'UNAUTHENTICATED'])(
    'keeps controlled %s without a URL',
    async (code) => {
      fetchMock.mockResolvedValue(response({ ok: false, code }, 403));
      expect(await readMediaUrl(readInput)).toEqual({ ok: false, code });
    },
  );

  it.each([
    { ok: false, code: 'PRIVATE_SQL_ERROR' },
    { ok: false, code: 'FORBIDDEN', message: 'private path/secret' },
    null,
    { ok: true, data: null },
  ])('never leaks raw or malformed response details', async (data) => {
    fetchMock.mockResolvedValue(response(data));
    expect(await readMediaUrl(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it('does not accept a success body from failed HTTP', async () => {
    fetchMock.mockResolvedValue(response({ ok: true, data: readGrant() }, 403));
    expect(await readMediaUrl(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it.each([
    () =>
      new Response('not json', {
        headers: { 'Content-Type': 'application/json' },
      }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    () =>
      new Response('x'.repeat(MEDIA_RESPONSE_MAX_BYTES + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    () =>
      new Response(null, { headers: { 'Content-Type': 'application/json' } }),
  ])(
    'rejects invalid encoding, oversized or non-JSON content',
    async (make) => {
      fetchMock.mockResolvedValue(make());
      expect(await readMediaUrl(readInput)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );

  it('returns a controlled abort result without retry', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('private provider url', 'AbortError'),
    );
    expect(await readMediaUrl(readInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds the local display timer without granting authority', () => {
    const now = Date.now();
    expect(mediaExpiryDelay(new Date(now + 10_000).toISOString(), now)).toBe(
      10_000,
    );
    expect(mediaExpiryDelay(new Date(now + 120_000).toISOString(), now)).toBe(
      60_000,
    );
    expect(mediaExpiryDelay(new Date(now - 1).toISOString(), now)).toBe(0);
    expect(mediaExpiryDelay('bad', now)).toBe(0);
  });
});

describe('composable quarantine upload client', () => {
  it('obtains a bound intent without uploading or completing automatically', async () => {
    const data = uploadGrant();
    fetchMock.mockResolvedValue(response({ ok: true, data }));
    expect(await beginMediaUpload(beginInput)).toEqual({ ok: true, data });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      routes.mediaUpload,
      expect.objectContaining({ body: JSON.stringify(beginInput) }),
    );
  });

  it.each([
    { ...beginInput, byteSize: 0 },
    { ...beginInput, mimeType: 'image/svg+xml' },
    { ...beginInput, filename: 'private.txt' },
    { ...beginInput, requestId: '' },
  ])('rejects invalid begin input without transport', async (input) => {
    expect(await beginMediaUpload(input as typeof beginInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a signed upload bound to another upload ID', async () => {
    fetchMock.mockResolvedValue(
      response({ ok: true, data: uploadGrant({ uploadId: mediaId }) }),
    );
    expect(await beginMediaUpload(beginInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it('PUTs bytes without application cookies, upsert, referrer or automatic completion', async () => {
    const data = uploadGrant();
    const file = new Blob(['abc'], { type: 'image/png' });
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    expect(await uploadMediaBytes(data, file)).toEqual({
      ok: true,
      data: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      data.uploadUrl,
      expect.objectContaining({
        method: 'PUT',
        body: file,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'max-age=0',
          'x-upsert': 'false',
        },
      }),
    );
  });

  it.each([
    { expiresAt: new Date(0).toISOString() },
    { uploadUrl: 'https://evil.example/file.png' },
    { uploadId: mediaId },
    { token: 'must-not-accept-extra' },
  ])(
    'will not send bytes with an invalid or expired grant',
    async (override) => {
      expect(
        await uploadMediaBytes(
          { ...uploadGrant(), ...override },
          new Blob(['abc'], { type: 'image/png' }),
        ),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects empty, oversized and unsupported browser MIME before transfer', async () => {
    const grant = uploadGrant();
    expect(
      await uploadMediaBytes(grant, new Blob([], { type: 'image/png' })),
    ).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(
      await uploadMediaBytes(grant, {
        size: MEDIA_MAX_BYTES + 1,
        type: 'image/png',
      } as Blob),
    ).toEqual({ ok: false, code: 'LIMIT_EXCEEDED' });
    expect(
      await uploadMediaBytes(
        grant,
        new Blob(['<svg/>'], { type: 'image/svg+xml' }),
      ),
    ).toEqual({ ok: false, code: 'INVALID_CONTENT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'failed-http'])(
    'does not repeat or complete an uncertain PUT: %s',
    async (failure) => {
      if (failure === 'timeout')
        fetchMock.mockRejectedValue(new Error('lost response'));
      else
        fetchMock.mockResolvedValue(
          new Response('private storage details', { status: 500 }),
        );
      expect(
        await uploadMediaBytes(
          uploadGrant(),
          new Blob(['abc'], { type: 'image/png' }),
        ),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('completes and revokes by upload ID only through same-origin routes', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ok: true, data: { mediaId } }))
      .mockResolvedValueOnce(response({ ok: true, data: null }));
    expect(await completeMediaUpload({ uploadId })).toEqual({
      ok: true,
      data: { mediaId },
    });
    expect(await revokeMediaUpload({ uploadId })).toEqual({
      ok: true,
      data: null,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      routes.mediaComplete,
      expect.objectContaining({
        body: JSON.stringify({ uploadId }),
        credentials: 'same-origin',
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      routes.mediaRevoke,
      expect.objectContaining({
        body: JSON.stringify({ uploadId }),
        credentials: 'same-origin',
      }),
    );
  });

  it('rejects extra client verification claims at complete and revoke', async () => {
    const input = { uploadId, verified: true, path: 'arbitrary' };
    expect(await completeMediaUpload(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await revokeMediaUpload(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
