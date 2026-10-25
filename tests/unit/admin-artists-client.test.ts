import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdminArtists,
  fetchAdminArtist,
  fetchArtistAccess,
  saveAdminArtist,
  saveAdminPreviews,
  inviteArtistAccount,
  cancelArtistInvitation,
  unlinkArtistAccount,
  respondArtistInvitation,
} from '@/client/admin-artists';
import {
  ADMIN_ARTISTS,
  ADMIN_ARTIST_ERROR_STATUS,
} from '@/config/admin-artists';
import { adminArtistApiPath, routes } from '@/config/routes';
import {
  artist,
  artistId,
  targetId,
  detail,
  invitation,
  saveInput,
  previewsInput,
  inviteInput,
  cancelInput,
  unlinkInput,
  respondInput,
} from './admin-artists-fixtures';
const fetchMock = vi.fn();
function respond(
  body: unknown,
  status = 200,
  contentType = 'application/json',
) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType },
    }),
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respond({ ok: true, data: { artists: [artist], has_more: false } });
});
afterEach(() => vi.unstubAllGlobals());
describe('admin artist same-origin private transport', () => {
  it('requests bounded list through credentialed no-store GET without actor injection', async () => {
    expect(await fetchAdminArtists(1)).toEqual({
      ok: true,
      data: { artists: [artist], has_more: false },
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${routes.adminArtistsApi}?page=1`,
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body');
  });
  it('gets exact UUID detail with no access token', async () => {
    respond({ ok: true, data: detail });
    expect(await fetchAdminArtist(artistId)).toEqual({
      ok: true,
      data: detail,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `${routes.adminArtistsApi}?id=${artistId}`,
    );
  });
  it('reads only authenticated recipient invitations without supplied target', async () => {
    const data = {
      user_id: targetId,
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    };
    respond({ ok: true, data });
    expect(await fetchArtistAccess()).toEqual({ ok: true, data });
    expect(fetchMock.mock.calls[0]![0]).toBe(routes.artistAccessApi);
    expect(fetchMock.mock.calls[0]![1]).not.toHaveProperty('body');
  });
  it.each([0, -1, 1.5, NaN, Infinity, ADMIN_ARTISTS.maxPage + 1])(
    'rejects invalid page %s locally',
    async (page) => {
      expect(await fetchAdminArtists(page)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'slug', '../artist', '?role=admin'])(
    'rejects malformed ID %s locally',
    async (id) => {
      expect(await fetchAdminArtist(id)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it('does not fetch an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchAdminArtists(1, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(Object.entries(ADMIN_ARTIST_ERROR_STATUS))(
    'accepts typed %s only at matching HTTP status',
    async (code, status) => {
      respond({ ok: false, code }, status);
      expect(await fetchAdminArtists(1)).toEqual({ ok: false, code });
    },
  );
  it.each([200, 400, 500])(
    'rejects FORBIDDEN disguised at status %s',
    async (status) => {
      respond({ ok: false, code: 'FORBIDDEN' }, status);
      expect(await fetchAdminArtists(1)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('rejects a success body under an error status', async () => {
    respond({ ok: true, data: { artists: [artist], has_more: false } }, 403);
    expect(await fetchAdminArtists(1)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(['text/html', 'text/plain', 'application/problem+json'])(
    'rejects %s response type',
    async (type) => {
      respond(
        { ok: true, data: { artists: [artist], has_more: false } },
        200,
        type,
      );
      expect(await fetchAdminArtists(1)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('bounds streamed payload bytes', async () => {
    fetchMock.mockResolvedValue(
      new Response('x'.repeat(ADMIN_ARTISTS.responseMaxBytes + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await fetchAdminArtists(1)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects malformed JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    );
    expect(await fetchAdminArtists(1)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('catches network failure without retrying writes', async () => {
    fetchMock.mockRejectedValue(new Error('fictional disconnect'));
    expect(await saveAdminArtist(saveInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('rejects leaked unknown fields in otherwise valid response', async () => {
    respond({
      ok: true,
      data: {
        artists: [{ ...artist, email: 'must-not-leak@example.invalid' }],
        has_more: false,
      },
    });
    expect(await fetchAdminArtists(1)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  const actions = [
    [
      'save',
      () => saveAdminArtist(saveInput),
      saveInput,
      artist,
      adminArtistApiPath('save'),
    ],
    [
      'previews',
      () => saveAdminPreviews(previewsInput),
      previewsInput,
      artist,
      adminArtistApiPath('previews'),
    ],
    [
      'invite',
      () => inviteArtistAccount(inviteInput),
      inviteInput,
      invitation,
      adminArtistApiPath('invite'),
    ],
    [
      'cancel',
      () => cancelArtistInvitation(cancelInput),
      cancelInput,
      invitation,
      adminArtistApiPath('cancel-invite'),
    ],
    [
      'unlink',
      () => unlinkArtistAccount(unlinkInput),
      unlinkInput,
      artist,
      adminArtistApiPath('unlink'),
    ],
    [
      'respond',
      () => respondArtistInvitation(respondInput),
      respondInput,
      invitation,
      routes.artistAccessApi,
    ],
  ] as const;
  it.each(actions)(
    'sends explicitly versioned %s with caller operation identity unchanged',
    async (_name, call, input, output, path) => {
      respond({ ok: true, data: output });
      expect(await call()).toEqual({ ok: true, data: output });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toBe(path);
      expect(options).toMatchObject({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(JSON.parse(options.body)).toEqual(input);
    },
  );
  it('does not send unconfirmed link request', async () => {
    expect(
      await inviteArtistAccount({
        ...inviteInput,
        confirmed: false as unknown as true,
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not send duplicate preview selection', async () => {
    expect(
      await saveAdminPreviews({
        ...previewsInput,
        message_ids: [artistId, artistId],
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never accepts null instead of a typed persisted mutation result', async () => {
    respond({ ok: true, data: null });
    expect(await saveAdminArtist(saveInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

it('requests later admin detail page with the same exact artist identity', async () => {
  respond({ ok: true, data: detail });
  await fetchAdminArtist(artistId, undefined, 2);
  expect(fetchMock.mock.calls[0]![0]).toBe(
    `${routes.adminArtistsApi}?id=${artistId}&page=2`,
  );
});
it('requests later authenticated recipient page without injecting an account', async () => {
  respond({
    ok: true,
    data: {
      user_id: targetId,
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    },
  });
  await fetchArtistAccess(undefined, 2);
  expect(fetchMock.mock.calls[0]![0]).toBe(`${routes.artistAccessApi}?page=2`);
});
it.each([0, -1, 1.5, NaN, ADMIN_ARTISTS.maxPage + 1])(
  'rejects invalid detail and recipient page %s before request',
  async (page) => {
    expect(await fetchAdminArtist(artistId, undefined, page)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(await fetchArtistAccess(undefined, page)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it('rejects recipient data without its authoritative current authenticated user ID', async () => {
  respond({
    ok: true,
    data: {
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    },
  });
  expect(await fetchArtistAccess()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
