// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getComposeDispatchPage } from '@/server/message-dispatch/page';
const mock = vi.hoisted(() => ({
  compose: vi.fn(),
  cookies: vi.fn(),
  auth: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mock.cookies }));
vi.mock('@/server/artist-compose/page', () => ({
  getComposePage: mock.compose,
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.auth }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mock.session,
}));
vi.mock('@/server/db/message-dispatch', () => ({
  createDispatchPort: mock.port,
}));
vi.mock('@/server/services/message-dispatch/dispatch', () => ({
  readDispatchContext: mock.read,
}));
const id = 'a4000000-0000-4000-8000-000000000001';
const slug = 'fictional-dispatch';
const initial = { safe: 'draft-editor' };
beforeEach(() => {
  vi.resetAllMocks();
  mock.compose.mockResolvedValue({ ok: true, data: initial });
  mock.cookies.mockResolvedValue({ getAll: () => [] });
  mock.auth.mockReturnValue({
    client: { actor: true },
    port: { authenticated: true },
  });
  mock.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'artist', is_restricted: false },
  });
  mock.port.mockReturnValue({ dispatch: true });
  mock.read.mockResolvedValue({ ok: true, data: { selectedMessage: { id } } });
});
describe('reload/back recovery for an already-published draft URL', () => {
  it('preserves normal composer without extra dispatch read', async () => {
    expect(await getComposeDispatchPage(slug, id)).toEqual({
      ok: true,
      data: { initial },
    });
    expect(mock.read).not.toHaveBeenCalled();
  });
  it.each(['CONFLICT', 'NOT_FOUND'])(
    'recovers %s only through exact current actor receipt',
    async (code) => {
      mock.compose.mockResolvedValueOnce({ ok: false, code });
      expect(await getComposeDispatchPage(slug, id)).toEqual({
        ok: true,
        data: { initial, initialDispatchedId: id },
      });
      expect(mock.read).toHaveBeenCalledExactlyOnceWith(
        { dispatch: true },
        { slug, messageId: id },
      );
      expect(mock.compose).toHaveBeenLastCalledWith(slug, null);
    },
  );
  it.each(['INVALID_INPUT', 'FORBIDDEN', 'UNAVAILABLE', 'SETUP_NOT_READY'])(
    'does not hide initial %s failure',
    async (code) => {
      mock.compose.mockResolvedValue({ ok: false, code });
      expect(await getComposeDispatchPage(slug, id)).toEqual({
        ok: false,
        code,
      });
      expect(mock.read).not.toHaveBeenCalled();
    },
  );
  it.each([null, [], 'bad-id'])(
    'does not recover malformed draft %#',
    async (messageId) => {
      mock.compose.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
      expect((await getComposeDispatchPage(slug, messageId)).ok).toBe(false);
      expect(mock.read).not.toHaveBeenCalled();
    },
  );
  it.each([
    { status: 'anonymous' },
    { status: 'unavailable' },
    { status: 'authenticated', profile: { role: 'fan' } },
    { status: 'authenticated', profile: { role: 'admin' } },
    {
      status: 'authenticated',
      profile: { role: 'artist', is_restricted: true, restricted_until: null },
    },
  ])('rechecks authority before recovery %#', async (session) => {
    mock.compose.mockResolvedValue({ ok: false, code: 'CONFLICT' });
    mock.session.mockResolvedValue(session);
    expect(await getComposeDispatchPage(slug, id)).toEqual({
      ok: false,
      code: 'CONFLICT',
    });
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('preserves missing-resource and fails uncertain receipt closed', async () => {
    mock.compose.mockResolvedValue({ ok: false, code: 'CONFLICT' });
    mock.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect(await getComposeDispatchPage(slug, id)).toEqual({
      ok: false,
      code: 'CONFLICT',
    });
    mock.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await getComposeDispatchPage(slug, id)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('fails safe when clean composer cannot be loaded after valid receipt', async () => {
    mock.compose
      .mockResolvedValueOnce({ ok: false, code: 'CONFLICT' })
      .mockResolvedValueOnce({ ok: false, code: 'FORBIDDEN' });
    expect(await getComposeDispatchPage(slug, id)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});
