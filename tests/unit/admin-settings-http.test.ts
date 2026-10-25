// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { adminSettingsHttp } from '@/server/admin-settings/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { ADMIN_SETTINGS_ERROR_STATUS } from '@/config/admin-settings';
import { routes } from '@/config/routes';
import {
  settingsActor,
  settingsList,
  settingsSave,
  displayGroup,
} from './admin-settings-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/admin-settings', () => ({
  createAdminSettingsPort: mocks.port,
}));
vi.mock('@/server/services/admin-settings/manage', () => ({
  listAdminSettings: mocks.list,
  saveAdminSettings: mocks.save,
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
    `https://app.example${routes.adminSettingsApi}${query}`,
    { method, headers, ...(body === undefined ? {} : { body }) },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (response: Response) => {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([key, value]) =>
        response.headers.set(key, value),
      );
      return response;
    },
  });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: settingsActor, role: 'admin', is_restricted: false },
  });
  mocks.port.mockReturnValue({ fixture: true });
  mocks.list.mockResolvedValue({ ok: true, data: settingsList });
  mocks.save.mockResolvedValue({ ok: true, data: displayGroup });
});
it('reads fresh actor-scoped snapshot with no-store response', async () => {
  const r = await adminSettingsHttp(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, data: settingsList });
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ fixture: true });
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(r.headers.get(k)).toBe(v);
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
});
it('parses confirmed same-origin JSON without caller authority', async () => {
  const r = await adminSettingsHttp(
    request('POST', '', JSON.stringify(settingsSave)),
  );
  expect(r.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
    { fixture: true },
    settingsSave,
  );
});
it.each(['?actor=x', '?page=1', '?version=1&version=2'])(
  'rejects unsupported query %s',
  async (query) => {
    expect((await adminSettingsHttp(request('GET', query))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  'null',
  'https://attacker.example',
  'https://app.example.attacker.example',
])('rejects cross-origin write %s', async (origin) => {
  expect(
    (
      await adminSettingsHttp(
        request('POST', '', JSON.stringify(settingsSave), origin),
      )
    ).status,
  ).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each(['fan', 'artist'])('rejects current %s role', async (role) => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role },
  });
  expect((await adminSettingsHttp(request())).status).toBe(403);
  expect(mocks.port).not.toHaveBeenCalled();
});
it('rejects restriction despite admin role', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'admin', is_restricted: true, restricted_until: null },
  });
  expect((await adminSettingsHttp(request())).status).toBe(403);
});
it.each([
  ['anonymous', 401],
  ['unavailable', 503],
  ['unconfigured', 401],
])('sanitizes %s', async (status, http) => {
  mocks.session.mockResolvedValue({ status });
  expect((await adminSettingsHttp(request())).status).toBe(http);
  expect(mocks.list).not.toHaveBeenCalled();
});
it.each([null, { configuration: null, client: null, port: null }])(
  'fails closed on missing setup %#',
  async (value) => {
    mocks.context.mockReturnValue({ ...value, apply: (r: Response) => r });
    expect((await adminSettingsHttp(request())).status).toBe(503);
  },
);
it.each(Object.entries(ADMIN_SETTINGS_ERROR_STATUS))(
  'maps service %s status %s',
  async (code, status) => {
    mocks.list.mockResolvedValue({ ok: false, code });
    expect((await adminSettingsHttp(request())).status).toBe(status);
  },
);
it('sanitizes unknown RPC/session errors', async () => {
  mocks.session.mockRejectedValue(new Error('private credential'));
  const r = await adminSettingsHttp(request());
  expect(await r.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('passes invalid body as invalid input without logging details', async () => {
  mocks.save.mockResolvedValue({ ok: false, code: 'INVALID_INPUT' });
  expect((await adminSettingsHttp(request('POST', '', '{bad'))).status).toBe(
    400,
  );
  expect(mocks.save).toHaveBeenCalledWith({ fixture: true }, null);
});
