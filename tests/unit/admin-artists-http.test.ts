// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { adminArtistHttp } from '@/server/admin-artists/http';
import { ADMIN_ARTIST_ERROR_STATUS } from '@/config/admin-artists';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { routes } from '@/config/routes';
import { artistId, saveInput } from './admin-artists-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  previews: vi.fn(),
  invite: vi.fn(),
  cancel: vi.fn(),
  unlink: vi.fn(),
  invitations: vi.fn(),
  respond: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/admin-artists', () => ({
  createAdminArtistPort: mocks.port,
}));
vi.mock('@/server/services/admin-artists/manage', () => ({
  listAdminArtists: mocks.list,
  getAdminArtist: mocks.detail,
  saveAdminArtist: mocks.save,
  setAdminArtistPreviews: mocks.previews,
  inviteArtistAccount: mocks.invite,
  cancelArtistInvitation: mocks.cancel,
  unlinkArtistAccount: mocks.unlink,
  listArtistInvitations: mocks.invitations,
  respondArtistInvitation: mocks.respond,
}));
function request(
  method = 'GET',
  query = '',
  body?: string,
  origin: string | null = 'https://app.example',
) {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(
    `https://app.example${routes.adminArtistsApi}${query}`,
    { method, headers, ...(body === undefined ? {} : { body }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([k, v]) =>
        r.headers.set(k, v),
      );
      return r;
    },
  });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: artistId, role: 'admin', is_restricted: false },
  });
  mocks.port.mockReturnValue({ fixture: true });
  for (const key of [
    'list',
    'detail',
    'save',
    'previews',
    'invite',
    'cancel',
    'unlink',
    'invitations',
    'respond',
  ] as const)
    mocks[key].mockResolvedValue({ ok: true, data: null });
});
it('uses actor RPC and private no-store responses', async () => {
  const response = await adminArtistHttp(request(), 'list');
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith({ fixture: true }, null);
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(key)).toBe(value);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it('loads detail by validated service and not list', async () => {
  await adminArtistHttp(request('GET', `?id=${artistId}`), 'list');
  expect(mocks.detail).toHaveBeenCalledWith({ fixture: true }, artistId, null);
  expect(mocks.list).not.toHaveBeenCalled();
});
it.each(['?actor=other', '?page=1&page=2', '?id=a&id=b', '?id=a&extra=1'])(
  'rejects ambiguous/authority query %s',
  async (query) => {
    expect((await adminArtistHttp(request('GET', query), 'list')).status).toBe(
      400,
    );
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each([null, 'https://evil.example', 'null'])(
  'rejects cross-origin mutation %s',
  async (origin) => {
    expect(
      (
        await adminArtistHttp(
          request('POST', '', JSON.stringify(saveInput), origin),
          'save',
        )
      ).status,
    ).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
it.each(['fan', 'artist'])(
  'rejects non-admin %s at current session boundary',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { id: artistId, role },
    });
    expect((await adminArtistHttp(request(), 'list')).status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('rejects restricted admin', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: {
      id: artistId,
      role: 'admin',
      is_restricted: true,
      restricted_until: null,
    },
  });
  expect((await adminArtistHttp(request(), 'list')).status).toBe(403);
});
it.each(['anonymous', 'unavailable'])(
  'fails %s session closed',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect((await adminArtistHttp(request(), 'list')).status).toBe(
      status === 'anonymous' ? 401 : 503,
    );
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('keeps recipient self flow accessible without admin role', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: artistId, role: 'fan' },
  });
  expect((await adminArtistHttp(request(), 'invitations')).status).toBe(200);
  expect(mocks.invitations).toHaveBeenCalledWith({ fixture: true }, null);
});
it.each([
  ['save', 'save'],
  ['previews', 'previews'],
  ['invite', 'invite'],
  ['cancel-invite', 'cancel'],
  ['unlink', 'unlink'],
  ['respond', 'respond'],
] as const)(
  'dispatches explicit %s mutation through service',
  async (action, key) => {
    expect(
      (
        await adminArtistHttp(
          request('POST', '', JSON.stringify(saveInput)),
          action,
        )
      ).status,
    ).toBe(200);
    expect(mocks[key]).toHaveBeenCalledWith({ fixture: true }, saveInput);
  },
);
it.each(Object.entries(ADMIN_ARTIST_ERROR_STATUS))(
  'maps sanitized error %s',
  async (code, status) => {
    mocks.save.mockResolvedValue({ ok: false, code });
    expect(
      (await adminArtistHttp(request('POST', '', '{}'), 'save')).status,
    ).toBe(status);
  },
);
it('requires exact HTTP methods and no mutation query', async () => {
  expect((await adminArtistHttp(request('POST'), 'list')).status).toBe(400);
  expect((await adminArtistHttp(request(), 'save')).status).toBe(400);
  expect(
    (await adminArtistHttp(request('POST', '?id=a', '{}'), 'save')).status,
  ).toBe(400);
});
it('fails absent configuration closed', async () => {
  mocks.context.mockReturnValue({
    configuration: null,
    client: null,
    port: null,
    apply: (r: Response) => r,
  });
  expect((await adminArtistHttp(request(), 'list')).status).toBe(503);
  expect(mocks.session).not.toHaveBeenCalled();
});
it('does not expose unexpected exception detail', async () => {
  mocks.list.mockRejectedValue(new Error('private identity'));
  const response = await adminArtistHttp(request(), 'list');
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

it('paginates detail and recipient only with one bounded page parameter', async () => {
  await adminArtistHttp(request('GET', `?id=${artistId}&page=2`), 'list');
  expect(mocks.detail).toHaveBeenCalledWith({ fixture: true }, artistId, '2');
  await adminArtistHttp(request('GET', '?page=3'), 'invitations');
  expect(mocks.invitations).toHaveBeenCalledWith({ fixture: true }, '3');
  expect(
    (await adminArtistHttp(request('GET', '?page=1&page=2'), 'invitations'))
      .status,
  ).toBe(400);
  expect(
    (await adminArtistHttp(request('GET', '?actor=x'), 'invitations')).status,
  ).toBe(400);
});
