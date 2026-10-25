// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchAdminContentCalendar,
  fetchArtistContentCalendar,
  fetchContentCalendarArtists,
  saveContentCalendar,
  deleteContentCalendar,
} from '@/client/content-calendar';
import {
  CONTENT_CALENDAR,
  CONTENT_CALENDAR_ERROR_STATUS,
} from '@/config/content-calendar';
import {
  adminContentCalendarPath,
  artistContentCalendarPath,
  adminContentCalendarApiPath,
} from '@/config/routes';
import {
  adminCalendar,
  artistCalendar,
  calendarActorId,
  calendarEntry,
  calendarSave,
  calendarOtherId,
} from './content-calendar-fixtures';
const adminQuery = {
  artist_id: adminCalendar.artist.id,
  month: adminCalendar.month,
};
const artistQuery = {
  slug: artistCalendar.artist.slug,
  month: artistCalendar.month,
};
const deletion = {
  operation_id: calendarSave.operation_id,
  entry_id: calendarEntry.id,
  expected_revision: 1,
  confirmed: true as const,
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const ok = (data: unknown) => ({ ok: true, data });
afterEach(() => vi.unstubAllGlobals());
it('binds admin and artist reads to no-store same-origin exact actor requests', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(ok(adminCalendar)))
    .mockResolvedValueOnce(reply(ok(artistCalendar)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchAdminContentCalendar(adminQuery, undefined, calendarActorId),
  ).toEqual(ok(adminCalendar));
  expect(
    await fetchArtistContentCalendar(artistQuery, undefined, calendarActorId),
  ).toEqual(ok(artistCalendar));
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    adminContentCalendarPath(adminQuery.month, adminQuery.artist_id, 1, true),
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [CONTENT_CALENDAR.actorHeader]: calendarActorId },
    }),
  );
  expect(fetcher.mock.calls[1]?.[0]).toBe(
    artistContentCalendarPath(artistQuery.slug, artistQuery.month, true),
  );
});
it('sends exact optimistic write payloads and never automatically retries an uncertain write', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(ok(calendarEntry)))
    .mockResolvedValueOnce(reply(ok({ id: calendarEntry.id, deleted: true })))
    .mockRejectedValueOnce(new Error('private'));
  vi.stubGlobal('fetch', fetcher);
  expect((await saveContentCalendar(calendarSave)).ok).toBe(true);
  expect((await deleteContentCalendar(deletion)).ok).toBe(true);
  expect(await saveContentCalendar(calendarSave)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    adminContentCalendarApiPath('save'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(calendarSave),
    }),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    adminContentCalendarApiPath('delete'),
    expect.objectContaining({ body: JSON.stringify(deletion) }),
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each(Object.entries(CONTENT_CALENDAR_ERROR_STATUS))(
  'returns safe status-matched %s',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ ok: false, code }, status)),
    );
    expect(await fetchAdminContentCalendar(adminQuery)).toEqual({
      ok: false,
      code,
    });
  },
);
it.each([
  () => reply(ok({ ...adminCalendar, month: '2026-11' })),
  () =>
    reply(
      ok({
        ...adminCalendar,
        artist: { ...adminCalendar.artist, id: calendarOtherId },
      }),
    ),
  () => reply(ok({ ...adminCalendar, private: 'hidden' })),
  () => reply(ok(adminCalendar), 503),
  () => reply({ ok: false, code: 'FORBIDDEN' }, 200),
  () => reply({ ok: false, code: 'PRIVATE_SQL' }, 403),
  () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([255]), {
      headers: { 'content-type': 'application/json' },
    }),
])(
  'fails closed for malformed or mismatched envelopes %#',
  async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
    expect(await fetchAdminContentCalendar(adminQuery)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('rejects cross-resource save/delete/artist responses', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      reply(ok({ ...calendarEntry, artist_id: calendarOtherId })),
    )
    .mockResolvedValueOnce(reply(ok({ id: calendarOtherId, deleted: true })))
    .mockResolvedValueOnce(
      reply(
        ok({
          ...artistCalendar,
          artist: { ...artistCalendar.artist, slug: 'different' },
        }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  expect((await saveContentCalendar(calendarSave)).ok).toBe(false);
  expect((await deleteContentCalendar(deletion)).ok).toBe(false);
  expect((await fetchArtistContentCalendar(artistQuery)).ok).toBe(false);
});
it('rejects malformed inputs, account keys and aborted requests without traffic', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await fetchAdminContentCalendar({ ...adminQuery, artist_id: 'bad' })).ok,
  ).toBe(false);
  expect(
    (await fetchArtistContentCalendar({ ...artistQuery, month: '0000-01' })).ok,
  ).toBe(false);
  expect(
    (await saveContentCalendar({ ...calendarSave, expected_revision: 1 })).ok,
  ).toBe(false);
  expect(
    (await deleteContentCalendar({ ...deletion, operation_id: 'bad' })).ok,
  ).toBe(false);
  expect((await fetchContentCalendarArtists(0)).ok).toBe(false);
  expect(
    (await fetchAdminContentCalendar(adminQuery, undefined, 'bad')).ok,
  ).toBe(false);
  expect(
    (await fetchArtistContentCalendar(artistQuery, AbortSignal.abort())).ok,
  ).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});
it('bounds even streaming responses and releases oversized readers', async () => {
  const cancel = vi.fn();
  const bytes = new Uint8Array(CONTENT_CALENDAR.responseMaxBytes + 1);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
          },
          cancel,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
  expect(await fetchAdminContentCalendar(adminQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(cancel).toHaveBeenCalledOnce();
});
it('central path builders encode slugs and preserve month/artist/page', () => {
  expect(artistContentCalendarPath('가수', '2026-10')).toContain(
    encodeURIComponent('가수'),
  );
  expect(
    new URL(
      adminContentCalendarPath('2026-10', null, 2),
      'https://example.test',
    ).searchParams.get('page'),
  ).toBe('2');
});
it.each([
  { ...calendarEntry, topic: 'different intent' },
  { ...calendarEntry, example_text: null },
  { ...calendarEntry, revision: 2 },
])(
  'rejects successful save with a mismatched authored intent/revision %#',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(ok(data))));
    expect(await saveContentCalendar(calendarSave)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('preserves literal migrated text including locale-dependent whitespace in browser DTOs', async () => {
  const legacy = {
    ...calendarEntry,
    topic: '  Preserved\nlegacy topic  ',
    example_text: 'Legacy\u0001example',
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(reply(ok({ ...artistCalendar, entries: [legacy] }))),
  );
  const result = await fetchArtistContentCalendar(artistQuery);
  expect(result.ok && result.data.entries[0]).toEqual(legacy);
});
it.each([
  { ...calendarEntry, artist_id: calendarOtherId },
  { ...calendarEntry, date: '2026-11-01' },
])(
  'rejects browser calendar entries bound to a different resource %#',
  async (entry) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(reply(ok({ ...artistCalendar, entries: [entry] }))),
    );
    expect(await fetchArtistContentCalendar(artistQuery)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
