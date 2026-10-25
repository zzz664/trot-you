// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginCommunityImage,
  completeCommunityImage,
  readCommunityImage,
  revokeCommunityImage,
  uploadCommunityImage,
  communityImageExpiryDelay,
} from '@/client/community-media';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import { COMMUNITY_MEDIA } from '@/config/community-media';
import { routes } from '@/config/routes';
vi.mock('@/config/env', () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: 'https://board-fixture.supabase.co',
  }),
}));
const actor = 'd0340000-0000-4000-8000-000000000001';
const artist = 'd0340000-0000-4000-8000-000000000002';
const post = 'd0340000-0000-4000-8000-000000000003';
const upload = 'd0340000-0000-4000-8000-000000000004';
const image = 'd0340000-0000-4000-8000-000000000005';
const other = 'd0340000-0000-4000-8000-000000000006';
const begin = {
  requestId: other,
  artistId: artist,
  postId: post,
  mimeType: 'image/png' as const,
  byteSize: 3,
};
const token = '?token=synthetic-fixture';
const uploadUrl = `https://board-fixture.supabase.co/storage/v1/object/upload/sign/board-quarantine/${artist}/${post}/${upload}.png${token}`;
const readUrl = `https://board-fixture.supabase.co/storage/v1/object/sign/board-media/${artist}/${post}/${image}.png${token}`;
const uploadGrant = () => ({
  uploadId: upload,
  uploadUrl,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});
const readGrant = () => ({
  url: readUrl,
  expiresAt: new Date(Date.now() + 50000).toISOString(),
  mimeType: 'image/png' as const,
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('community media client transport', () => {
  it('binds staged upload to artist/draft and exact mounted account', async () => {
    const data = uploadGrant();
    fetchMock.mockResolvedValue(response({ ok: true, data }));
    expect(await beginCommunityImage(begin, undefined, actor)).toEqual({
      ok: true,
      data,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      routes.communityImageBegin,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          [COMMUNITY_POSTS.actorHeader]: actor,
        },
        body: JSON.stringify(begin),
      }),
    );
  });
  it.each(['artistId', 'postId', 'requestId'] as const)(
    'rejects invalid %s before request',
    async (key) => {
      expect(
        await beginCommunityImage({ ...begin, [key]: 'bad' }, undefined, actor),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('requires mounted account before API requests', async () => {
    expect(await beginCommunityImage(begin, undefined, '')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    (url: string) => url.replace(artist, other),
    (url: string) => url.replace(post, other),
    (url: string) => url.replace(upload, other),
    (url: string) => url.replace('board-quarantine', 'media-quarantine'),
    (url: string) => url.replace('.png', '.jpg'),
    (url: string) => url.replace('board-fixture.supabase.co', 'evil.example'),
    (url: string) => `${url}&token=second`,
    (url: string) => `${url}#fragment`,
    (url: string) => url.replace('https://', 'https://user:pass@'),
  ])('rejects foreign resource grant without upload', async (change) => {
    fetchMock.mockResolvedValue(
      response({
        ok: true,
        data: { ...uploadGrant(), uploadUrl: change(uploadUrl) },
      }),
    );
    expect(await beginCommunityImage(begin, undefined, actor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('uploads private quarantine once, omitting browser cookies and referrer', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await uploadCommunityImage(uploadGrant(), file)).toEqual({
      ok: true,
      data: null,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      uploadUrl,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'max-age=0',
          'x-upsert': 'false',
        },
        body: file,
      }),
    );
  });
  it('does not automatically retry a lost upload or create a post', async () => {
    fetchMock.mockRejectedValue(new Error('lost'));
    expect(
      await uploadCommunityImage(
        uploadGrant(),
        new Blob(['abc'], { type: 'image/png' }),
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(['image/svg+xml', 'video/mp4', 'text/plain', 'image/jpeg'])(
    'rejects wrong upload MIME %s before I/O',
    async (type) => {
      expect(
        await uploadCommunityImage(uploadGrant(), new Blob(['abc'], { type })),
      ).toEqual({ ok: false, code: 'INVALID_CONTENT' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('allows explicit completion and revocation using only the same upload ID', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ ok: true, data: { imageId: image } }))
      .mockResolvedValueOnce(response({ ok: true, data: null }));
    expect(
      await completeCommunityImage({ uploadId: upload }, undefined, actor),
    ).toEqual({ ok: true, data: { imageId: image } });
    expect(
      await revokeCommunityImage({ uploadId: upload }, undefined, actor),
    ).toEqual({ ok: true, data: null });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      routes.communityImageComplete,
      routes.communityImageRevoke,
    ]);
  });
  it('binds protected read grant to both post and image', async () => {
    const data = readGrant();
    fetchMock.mockResolvedValue(response({ ok: true, data }));
    expect(
      await readCommunityImage(
        { imageId: image, postId: post },
        undefined,
        actor,
      ),
    ).toEqual({ ok: true, data });
  });
  it.each([
    (url: string) => url.replace(post, other),
    (url: string) => url.replace(image, other),
    (url: string) => url.replace('board-media', 'message-media'),
    (url: string) => url.replace('/sign/', '/public/'),
    (url: string) => `${url}&download=file`,
  ])('rejects unbound protected image URL', async (change) => {
    fetchMock.mockResolvedValue(
      response({ ok: true, data: { ...readGrant(), url: change(readUrl) } }),
    );
    expect(
      await readCommunityImage(
        { imageId: image, postId: post },
        undefined,
        actor,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
    'maps only matched status for %s',
    async (code, status) => {
      fetchMock
        .mockResolvedValueOnce(response({ ok: false, code }, status))
        .mockResolvedValueOnce(response({ ok: false, code }, 200));
      expect(
        await completeCommunityImage({ uploadId: upload }, undefined, actor),
      ).toEqual({ ok: false, code });
      expect(
        await completeCommunityImage({ uploadId: upload }, undefined, actor),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it('caps body before JSON decode', async () => {
    fetchMock.mockResolvedValue(
      new Response('x'.repeat(COMMUNITY_MEDIA.responseMaxBytes + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(
      await completeCommunityImage({ uploadId: upload }, undefined, actor),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('honors abort even if transport delivers a successful stale response', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockResolvedValue(
      response({ ok: true, data: { imageId: image } }),
    );
    expect(
      await completeCommunityImage(
        { uploadId: upload },
        controller.signal,
        actor,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([0, -1, 60001])('rejects read grant lifetime %s', async (ms) => {
    vi.spyOn(Date, 'now').mockReturnValue(1792922400000);
    fetchMock.mockResolvedValue(
      response({
        ok: true,
        data: {
          ...readGrant(),
          expiresAt: new Date(Date.now() + ms).toISOString(),
        },
      }),
    );
    expect(
      await readCommunityImage(
        { imageId: image, postId: post },
        undefined,
        actor,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('clamps UI expiry to technical read grant bound', () => {
    expect(communityImageExpiryDelay('bad')).toBe(0);
    expect(communityImageExpiryDelay('2026-10-25T00:00:00Z', 0)).toBe(60000);
    expect(
      communityImageExpiryDelay(
        '2026-10-25T00:00:00Z',
        Date.parse('2026-10-26T00:00:00Z'),
      ),
    ).toBe(0);
  });
});
