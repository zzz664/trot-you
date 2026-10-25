// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { CONTENT_CALENDAR } from '@/config/content-calendar';
import { contentCalendarHttp } from '@/server/content-calendar/http';
import {
  artistCalendar,
  adminCalendar,
  calendarArtistId,
  calendarActorId,
  calendarEntry,
  calendarEntryId,
  calendarOperationId,
  calendarOtherId,
  calendarSave,
} from './content-calendar-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  artists: vi.fn(),
  artist: vi.fn(),
  admin: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/content-calendar', () => ({
  createContentCalendarPort: mocks.port,
}));
vi.mock('@/server/db/admin-artists', () => ({
  createAdminArtistPort: () => ({ list: mocks.artists }),
}));
function request(
  query = `?artist_id=${calendarArtistId}&month=2026-10`,
  method = 'GET',
  body?: unknown,
  origin: string | null = 'https://app.example',
  actor: string | null = calendarActorId,
) {
  return new NextRequest(
    `https://app.example/api/admin/content-calendar${query}`,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        'content-type': 'application/json',
        ...(origin === null ? {} : { origin }),
        ...(actor === null ? {} : { [CONTENT_CALENDAR.actorHeader]: actor }),
      },
    },
  );
}
function session(role = 'admin', extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: calendarActorId,
      role,
      is_restricted: false,
      onboarding_completed_at: '2026-01-01',
      ...extra,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
        r.headers.set(k, v);
      return r;
    },
  });
  mocks.session.mockResolvedValue(session());
  mocks.port.mockReturnValue(mocks);
  mocks.artists.mockResolvedValue({
    ok: true,
    data: { artists: [], has_more: false },
  });
  mocks.artist.mockResolvedValue({ ok: true, data: artistCalendar });
  mocks.admin.mockResolvedValue({ ok: true, data: adminCalendar });
  mocks.save.mockResolvedValue({ ok: true, data: calendarEntry });
  mocks.delete.mockResolvedValue({
    ok: true,
    data: { id: calendarEntryId, deleted: true },
  });
});
it('admin calendar returns private no-store JSON bound to validated artist/month', async () => {
  const response = await contentCalendarHttp(request(), 'admin');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: adminCalendar });
  expect(mocks.admin).toHaveBeenCalledExactlyOnceWith({
    artist_id: calendarArtistId,
    month: '2026-10',
  });
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(k)).toBe(v);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it('artist route resolves only its path slug, not query identities or actor-controlled UUIDs', async () => {
  mocks.session.mockResolvedValue(session('artist'));
  const response = await contentCalendarHttp(
    request('?month=2026-10'),
    'artist',
    artistCalendar.artist.slug,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: artistCalendar });
  expect(mocks.artist).toHaveBeenCalledExactlyOnceWith({
    slug: artistCalendar.artist.slug,
    month: '2026-10',
  });
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('artist selector reuses safe paginated admin catalog and never content query', async () => {
  expect(
    (await contentCalendarHttp(request('?artists=1&page=2'), 'admin')).status,
  ).toBe(200);
  expect(mocks.artists).toHaveBeenCalledExactlyOnceWith(2);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it.each([
  '?artists=0',
  '?artists=1&month=2026-10',
  '?artists=1&page=0',
  '?artists=1&page=1001',
  '?artists=1&page=1&page=2',
  '?artists=1&artist_id=x',
])('rejects malformed admin choice query %s', async (query) =>
  expect((await contentCalendarHttp(request(query), 'admin')).status).toBe(400),
);
it.each([
  '?month=bad',
  '?month=2026-10&month=2026-11',
  '?artist_id=x&month=2026-10',
  '?month=2026-10&actor_id=x',
  '?month=2026-10&cursor=x',
  '?month=2026-10&slug=other',
  '?month=2026-10&artists=1',
])('rejects extra/invalid artist query %s', async (query) => {
  mocks.session.mockResolvedValue(session('artist'));
  expect(
    (
      await contentCalendarHttp(
        request(query),
        'artist',
        artistCalendar.artist.slug,
      )
    ).status,
  ).toBe(400);
  expect(mocks.artist).not.toHaveBeenCalled();
});
it.each([
  '?month=2026-10',
  '?artist_id=bad&month=2026-10',
  `?artist_id=${calendarArtistId}&month=2026-13`,
  `?artist_id=${calendarArtistId}&month=2026-10&page=1`,
  `?artist_id=${calendarArtistId}&artist_id=${calendarOtherId}&month=2026-10`,
])('rejects invalid admin month identity %s', async (query) => {
  expect((await contentCalendarHttp(request(query), 'admin')).status).toBe(400);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it('saves and deletes with exact parsed intents, operation keys and confirmation', async () => {
  expect(
    (await contentCalendarHttp(request('', 'POST', calendarSave), 'save'))
      .status,
  ).toBe(200);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(calendarSave);
  const deletion = {
    operation_id: calendarOperationId,
    entry_id: calendarEntryId,
    expected_revision: 1,
    confirmed: true,
  };
  expect(
    (await contentCalendarHttp(request('', 'POST', deletion), 'delete')).status,
  ).toBe(200);
  expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(deletion);
});
it.each([
  null,
  'https://evil.example',
  'https://app.example.evil.example',
  'https://app.example/',
  'null',
])('blocks cross-origin mutation before session/DB for %j', async (origin) => {
  expect(
    (
      await contentCalendarHttp(
        request('', 'POST', calendarSave, origin),
        'save',
      )
    ).status,
  ).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each(['artist', 'admin', 'save', 'delete'] as const)(
  'rejects mismatched mounted account on %s without revealing data or applying retry',
  async (action) => {
    mocks.session.mockResolvedValue(
      session(action === 'artist' ? 'artist' : 'admin'),
    );
    const read = action === 'artist' || action === 'admin';
    const response = await contentCalendarHttp(
      request(
        read ? '?month=2026-10' : '',
        read ? 'GET' : 'POST',
        read ? undefined : calendarSave,
        'https://app.example',
        calendarOtherId,
      ),
      action,
      artistCalendar.artist.slug,
    );
    expect(response.status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
    expect(mocks.artists).not.toHaveBeenCalled();
  },
);
it.each(['fan', 'artist'])(
  'non-admin %s cannot reach admin list, picker or writes',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    for (const action of ['admin', 'save', 'delete'] as const)
      expect(
        (
          await contentCalendarHttp(
            request(
              action === 'admin' ? '' : '',
              action === 'admin' ? 'GET' : 'POST',
              action === 'admin' ? undefined : calendarSave,
            ),
            action,
          )
        ).status,
      ).toBe(403);
    expect(
      (await contentCalendarHttp(request('?artists=1'), 'admin')).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
    expect(mocks.artists).not.toHaveBeenCalled();
  },
);
it.each(['fan', 'admin'])(
  'non-artist %s cannot enter private artist calendar',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    expect(
      (
        await contentCalendarHttp(
          request('?month=2026-10'),
          'artist',
          artistCalendar.artist.slug,
        )
      ).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('onboarding is required for artist read but does not silently fabricate admin completion', async () => {
  mocks.session.mockResolvedValue(
    session('artist', { onboarding_completed_at: null }),
  );
  expect(
    (
      await contentCalendarHttp(
        request('?month=2026-10'),
        'artist',
        artistCalendar.artist.slug,
      )
    ).status,
  ).toBe(403);
  mocks.session.mockResolvedValue(
    session('admin', { onboarding_completed_at: null }),
  );
  expect((await contentCalendarHttp(request(), 'admin')).status).toBe(200);
});
it.each(['admin', 'artist'])(
  'restricted %s loses all calendar access',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { is_restricted: true, restricted_until: null }),
    );
    expect(
      (
        await contentCalendarHttp(
          request(role === 'artist' ? '?month=2026-10' : undefined),
          role === 'artist' ? 'artist' : 'admin',
          artistCalendar.artist.slug,
        )
      ).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each([
  ['anonymous', 401],
  ['unavailable', 503],
  ['unconfigured', 401],
])('reports session %s honestly', async (status, expected) => {
  mocks.session.mockResolvedValue({ status });
  expect((await contentCalendarHttp(request(), 'admin')).status).toBe(expected);
  expect(mocks.port).not.toHaveBeenCalled();
});
it.each(['configuration', 'client', 'port'])(
  'missing %s blocks data with setup-not-ready',
  async (key) => {
    const context = mocks.context();
    mocks.context.mockReturnValue({ ...context, [key]: null });
    const response = await contentCalendarHttp(request(), 'admin');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it('handles wrong methods, mutation query smuggling and malformed/unconfirmed input', async () => {
  expect(
    (await contentCalendarHttp(request('', 'POST', {}), 'admin')).status,
  ).toBe(400);
  expect((await contentCalendarHttp(request('', 'GET'), 'save')).status).toBe(
    400,
  );
  expect(
    (
      await contentCalendarHttp(
        request('?actor_id=x', 'POST', calendarSave),
        'save',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await contentCalendarHttp(
        request('', 'POST', { ...calendarSave, actor_id: calendarOtherId }),
        'save',
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await contentCalendarHttp(
        request('', 'POST', {
          operation_id: calendarOperationId,
          entry_id: calendarEntryId,
          expected_revision: 1,
          confirmed: false,
        }),
        'delete',
      )
    ).status,
  ).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
});
it.each([
  ['FORBIDDEN', 403],
  ['NOT_FOUND', 404],
  ['CONFLICT', 409],
  ['DATE_CONFLICT', 409],
  ['ARTIST_UNAVAILABLE', 409],
  ['UNAVAILABLE', 503],
])(
  'preserves error status %s without changing write intent',
  async (code, status) => {
    mocks.save.mockResolvedValue({ ok: false, code });
    const response = await contentCalendarHttp(
      request('', 'POST', calendarSave),
      'save',
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
  },
);
it('maps unsupported catalog errors and thrown failures to private unavailable responses', async () => {
  mocks.artists.mockResolvedValue({ ok: false, code: 'INVITATION_EXPIRED' });
  expect(
    await (await contentCalendarHttp(request('?artists=1'), 'admin')).json(),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  mocks.session.mockRejectedValue(new Error('private data'));
  const response = await contentCalendarHttp(request(), 'admin');
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
