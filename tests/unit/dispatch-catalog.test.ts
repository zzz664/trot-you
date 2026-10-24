// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readDispatchArtists } from '@/server/services/message-dispatch/catalog';
import { createDispatchCatalogPort } from '@/server/db/message-dispatch';
import type { ActorClient } from '@/server/db/client';
const artist = {
  id: 'a4000000-0000-4000-8000-000000000001',
  slug: 'fictional-b',
  name: '가상 가수',
};
const port = { artists: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  port.artists.mockResolvedValue({
    ok: true,
    data: { artists: [artist], hasMore: false },
  });
});
describe('own publication artist catalog', () => {
  it('keeps paused membership policy in SQL and returns safe own catalog', async () => {
    expect(await readDispatchArtists(port, null)).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: false, nextSlug: null },
    });
    expect(port.artists).toHaveBeenCalledExactlyOnceWith(null);
  });
  it('sets exclusive next slug only when another page exists', async () => {
    port.artists.mockResolvedValue({
      ok: true,
      data: { artists: [artist], hasMore: true },
    });
    expect(await readDispatchArtists(port, 'fictional-a')).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: true, nextSlug: artist.slug },
    });
  });
  it.each([[], 'bad slug', 42])(
    'rejects malformed cursor %#',
    async (value) => {
      expect(await readDispatchArtists(port, value)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(port.artists).not.toHaveBeenCalled();
    },
  );
  it.each([
    { artists: [], hasMore: true },
    { artists: [artist, artist], hasMore: false },
    { artists: [artist], hasMore: false, private: 'no' },
  ])('rejects malformed catalog %#', async (data) => {
    port.artists.mockResolvedValue({ ok: true, data });
    expect(await readDispatchArtists(port, null)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects nonadvancing pagination and catches failure', async () => {
    expect(await readDispatchArtists(port, artist.slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    port.artists.mockRejectedValue(new Error('private'));
    expect(await readDispatchArtists(port, null)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('preserves explicit permission error', async () => {
    port.artists.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await readDispatchArtists(port, null)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
  it('uses the authenticated bounded RPC without an actor argument', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { artists: [artist], has_more: true, private: 'no' },
      error: null,
    });
    const db = createDispatchCatalogPort({ rpc } as unknown as ActorClient);
    expect(await db.artists(null)).toEqual({
      ok: true,
      data: { artists: [artist], hasMore: true },
    });
    expect(rpc).toHaveBeenLastCalledWith('artist_dispatch_artists', {});
    await db.artists('fictional-a');
    expect(rpc).toHaveBeenLastCalledWith('artist_dispatch_artists', {
      p_after_slug: 'fictional-a',
    });
  });
});
