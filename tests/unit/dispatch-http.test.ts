// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { DISPATCH_ERROR_STATUS } from '@/config/message-dispatch';
import { artistDispatchApiPath } from '@/config/routes';
import { dispatchPost } from '@/server/message-dispatch/http';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/message-dispatch', () => ({
  createDispatchPort: mock.port,
}));
vi.mock('@/server/services/message-dispatch/dispatch', () => ({
  readDispatchContext: mock.read,
  submitDispatch: mock.submit,
  cancelDispatch: mock.cancel,
}));
const id = 'a3000000-0000-4000-8000-000000000001';
const slug = 'fictional-star';
const origin = 'https://app.example';
function context(role = 'artist') {
  return {
    configuration: { appOrigin: origin },
    client: { actor: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: id }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id,
          role,
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply(response: NextResponse) {
      Object.entries(AUTH_PRIVATE_HEADERS).forEach(([k, v]) =>
        response.headers.set(k, v),
      );
      return response;
    },
  };
}
function request(
  body: unknown = { messageId: null },
  source: string | null = origin,
  type = 'application/json',
  search = '',
) {
  const headers = new Headers({
    'Content-Type': type,
    Host: 'untrusted.example',
    'X-Forwarded-Host': 'untrusted.example',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest(
    `https://untrusted.example${artistDispatchApiPath(slug)}${search}`,
    {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.port.mockReturnValue({ actorDispatchPort: true });
  for (const fn of [mock.read, mock.submit, mock.cancel])
    fn.mockResolvedValue({ ok: true, data: { safe: true } });
});
describe('artist dispatch HTTP authority boundary', () => {
  it.each(['context', 'submit', 'cancel'] as const)(
    'uses authenticated artist capability for %s',
    async (action) => {
      const response = await dispatchPost(request(), slug, action);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, data: { safe: true } });
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        expect(response.headers.get(key)).toBe(value);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(mock.port).toHaveBeenCalledExactlyOnceWith({ actor: true });
      const op = {
        context: mock.read,
        submit: mock.submit,
        cancel: mock.cancel,
      }[action];
      expect(op).toHaveBeenCalledExactlyOnceWith(
        { actorDispatchPort: true },
        { slug, messageId: null },
      );
    },
  );
  it.each([
    null,
    'null',
    'https://untrusted.example',
    'https://app.example.evil',
    'http://app.example',
  ])('rejects origin %s before operation', async (origin) => {
    expect(
      (await dispatchPost(request({}, origin), slug, 'submit')).status,
    ).toBe(403);
    expect(mock.port).not.toHaveBeenCalled();
  });
  it.each(['fan', 'admin'])('does not trust %s as artist', async (role) => {
    mock.context.mockReturnValue(context(role));
    expect(
      (await dispatchPost(request({ role: 'artist' }), slug, 'submit')).status,
    ).toBe(403);
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it('denies current restriction even for a real artist', async () => {
    const c = context();
    c.port.readProfile.mockResolvedValue({
      ok: true,
      data: { id, role: 'artist', is_restricted: true, restricted_until: null },
    });
    mock.context.mockReturnValue(c);
    expect((await dispatchPost(request(), slug, 'context')).status).toBe(403);
  });
  it.each(['?actorId=x', '?messageId=x', '?uploadId=x'])(
    'rejects metadata in query %s',
    async (search) => {
      expect(
        (
          await dispatchPost(
            request({}, origin, 'application/json', search),
            slug,
            'context',
          )
        ).status,
      ).toBe(400);
      expect(mock.port).not.toHaveBeenCalled();
    },
  );
  it.each(['[]', 'null', 'true', '3', '"text"', '{broken', ''])(
    'rejects nonobject body %s',
    async (body) => {
      expect((await dispatchPost(request(body), slug, 'submit')).status).toBe(
        400,
      );
      expect(mock.submit).not.toHaveBeenCalled();
    },
  );
  it('rejects slug supplied in body instead of silently overwriting it', async () => {
    expect(
      (await dispatchPost(request({ slug: 'other' }), slug, 'submit')).status,
    ).toBe(400);
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it('rejects non JSON body', async () => {
    expect(
      (await dispatchPost(request({}, origin, 'text/plain'), slug, 'submit'))
        .status,
    ).toBe(400);
  });
  it('fails unconfigured and anonymous state closed', async () => {
    mock.context.mockReturnValue({ ...context(), client: null });
    expect((await dispatchPost(request(), slug, 'submit')).status).toBe(503);
    const c = context();
    c.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(c);
    expect((await dispatchPost(request(), slug, 'submit')).status).toBe(401);
  });
  it.each(Object.entries(DISPATCH_ERROR_STATUS))(
    'maps %s privately to %s',
    async (code, status) => {
      mock.submit.mockResolvedValue({ ok: false, code });
      const response = await dispatchPost(request(), slug, 'submit');
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(response.headers.get('cache-control')).toContain('no-store');
    },
  );
});
