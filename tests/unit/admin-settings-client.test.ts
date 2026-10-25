// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fetchAdminSettings, saveAdminSettings } from '@/client/admin-settings';
import {
  ADMIN_SETTINGS_ERROR_STATUS,
  ADMIN_SETTINGS,
} from '@/config/admin-settings';
import { routes } from '@/config/routes';
import {
  settingsList,
  displayGroup,
  settingsSave,
} from './admin-settings-fixtures';
afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
it('loads bounded fresh private snapshot and rejects redirects', async () => {
  const f = vi.fn().mockResolvedValue(reply({ ok: true, data: settingsList }));
  vi.stubGlobal('fetch', f);
  expect(await fetchAdminSettings()).toEqual({ ok: true, data: settingsList });
  expect(f).toHaveBeenCalledWith(
    routes.adminSettingsApi,
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    }),
  );
});
it('sends exact validated mutation once without retry on uncertain outcome', async () => {
  const f = vi.fn().mockResolvedValue(reply({ ok: true, data: displayGroup }));
  vi.stubGlobal('fetch', f);
  expect(await saveAdminSettings(settingsSave)).toEqual({
    ok: true,
    data: displayGroup,
  });
  expect(f).toHaveBeenCalledExactlyOnceWith(
    routes.adminSettingsApi,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(settingsSave),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  f.mockRejectedValue(new Error('private transport'));
  expect(await saveAdminSettings(settingsSave)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(f).toHaveBeenCalledTimes(2);
});
it('rejects invalid input without transport', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  expect(
    await saveAdminSettings({ ...settingsSave, values: { page_size: 0 } }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(f).not.toHaveBeenCalled();
});
it.each(Object.entries(ADMIN_SETTINGS_ERROR_STATUS))(
  'recognizes only matching safe %s envelope',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ ok: false, code }, status)),
    );
    expect(await fetchAdminSettings()).toEqual({ ok: false, code });
  },
);
it.each([
  () => reply({ ok: true, data: settingsList }, 503),
  () => reply({ ok: false, code: 'FORBIDDEN' }, 200),
  () => reply({ ok: false, code: 'PRIVATE_DETAIL' }, 400),
  () => reply({ ok: true, data: { ...settingsList, secret: 'private' } }),
  () =>
    new Response('private markup', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
  () =>
    new Response('{broken', {
      headers: { 'content-type': 'application/json' },
    }),
  () =>
    new Response('x'.repeat(ADMIN_SETTINGS.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed response %#', async (response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  expect(await fetchAdminSettings()).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('honors an already aborted signal without a network call', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  expect(await fetchAdminSettings(AbortSignal.abort())).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(f).not.toHaveBeenCalled();
});
