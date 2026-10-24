// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  ANALYTICS_BODY_LIMIT,
  ANALYTICS_ERROR_STATUS,
} from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import { routes } from '@/config/routes';
import { analyticsPost } from '@/server/analytics/http';
import { POST } from '@/app/api/analytics/route';

const mock = vi.hoisted(() => ({
  context: vi.fn(),
  port: vi.fn(),
  track: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/db/analytics', () => ({ createAnalyticsPort: mock.port }));
vi.mock('@/server/services/analytics/track', () => ({ track: mock.track }));
const actor = 'a2100000-0000-4000-8000-000000000001';
const origin = 'https://app.example';
const body = {
  event_key: actor,
  name: AnalyticsEvent.VOICE_INPUT_USED,
  properties: { voice_context: 'reply' },
};
function context(role = 'fan') {
  return {
    configuration: { appOrigin: origin },
    client: { actorCapability: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actor }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role,
          onboarding_completed_at: '2026-10-24T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply(response: NextResponse) {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      response.headers.set('x-cookie-applied', 'yes');
      return response;
    },
  };
}
function post(
  value: unknown = body,
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
    `https://untrusted.example${routes.analytics}${search}`,
    {
      method: 'POST',
      headers,
      body: typeof value === 'string' ? value : JSON.stringify(value),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.port.mockReturnValue({ actorAnalyticsPort: true });
  mock.track.mockResolvedValue({ ok: true, data: null });
});
describe('voice-only analytics POST', () => {
  it('routes parsed fields through authenticated DB capability with private response headers', async () => {
    const request = post();
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: null });
    expect(mock.port).toHaveBeenCalledExactlyOnceWith({
      actorCapability: true,
    });
    expect(mock.track).toHaveBeenCalledExactlyOnceWith(
      { actorAnalyticsPort: true },
      body,
      request.signal,
    );
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-cookie-applied')).toBe('yes');
  });
  it.each([
    null,
    'null',
    'https://other.example',
    `${origin}/`,
    'http://app.example',
  ])('refuses untrusted Origin %s before session read', async (source) => {
    const auth = context();
    mock.context.mockReturnValue(auth);
    const response = await analyticsPost(post(body, source));
    expect(response.status).toBe(403);
    expect(auth.port.verifySubject).not.toHaveBeenCalled();
    expect(mock.port).not.toHaveBeenCalled();
    expect(mock.track).not.toHaveBeenCalled();
  });
  it.each(['?x=1', '?event_key=123', '?actor=123'])(
    'rejects query %s',
    async (search) => {
      const response = await analyticsPost(
        post(body, origin, 'application/json', search),
      );
      expect(response.status).toBe(400);
      expect(mock.track).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    [],
    {},
    '',
    '{',
    { ...body, event_key: 'invalid' },
    {
      ...body,
      name: AnalyticsEvent.MESSAGE_OPEN,
      properties: { source_id: actor },
    },
    { ...body, name: AnalyticsEvent.SUBSCRIBE_COMPLETE },
    { ...body, user_id: actor },
    { ...body, timestamp: '2026-10-24T00:00:00Z' },
    { ...body, properties: { voice_context: 'artist' } },
    { ...body, properties: { voice_context: 'reply', transcript: '내용' } },
    { ...body, properties: { voice_context: 'reply', audio: 'bytes' } },
    { ...body, properties: { voice_context: 'reply', duration: 1 } },
  ])(
    'rejects non-voice or nonminimal body without collection %j',
    async (value) => {
      const response = await analyticsPost(post(value));
      expect(response.status).toBe(400);
      expect(mock.track).not.toHaveBeenCalled();
    },
  );
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
    'rejects unsupported Content-Type %s',
    async (type) => {
      const response = await analyticsPost(post(body, origin, type));
      expect(response.status).toBe(400);
      expect(mock.track).not.toHaveBeenCalled();
    },
  );
  it('bounds the body independently of a claimed content length', async () => {
    const request = post(' '.repeat(ANALYTICS_BODY_LIMIT + 1));
    request.headers.set('Content-Length', '1');
    const response = await analyticsPost(request);
    expect(response.status).toBe(400);
    expect(mock.track).not.toHaveBeenCalled();
  });
  it.each(['configuration', 'client', 'port'] as const)(
    'fails closed without %s',
    async (missing) => {
      mock.context.mockReturnValue({ ...context(), [missing]: null });
      const response = await analyticsPost(post());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'SETUP_NOT_READY',
      });
      expect(mock.track).not.toHaveBeenCalled();
    },
  );
  it.each(['artist', 'admin'])(
    'does not treat %s role as optional fan consent',
    async (role) => {
      mock.context.mockReturnValue(context(role));
      expect((await analyticsPost(post())).status).toBe(403);
      expect(mock.track).not.toHaveBeenCalled();
    },
  );
  it.each([
    { is_restricted: true, restricted_until: null },
    { is_restricted: true, restricted_until: '2999-01-01T00:00:00Z' },
    { is_restricted: true, restricted_until: 'invalid' },
  ])('rejects restricted profile %j', async (restriction) => {
    const auth = context();
    const profile = await auth.port.readProfile();
    auth.port.readProfile.mockResolvedValue({
      ...profile,
      data: { ...profile.data, ...restriction },
    });
    mock.context.mockReturnValue(auth);
    expect((await analyticsPost(post())).status).toBe(403);
    expect(mock.track).not.toHaveBeenCalled();
  });
  it('requires completed onboarding', async () => {
    const auth = context();
    const profile = await auth.port.readProfile();
    auth.port.readProfile.mockResolvedValue({
      ...profile,
      data: { ...profile.data, onboarding_completed_at: null },
    });
    mock.context.mockReturnValue(auth);
    expect((await analyticsPost(post())).status).toBe(409);
    expect(mock.track).not.toHaveBeenCalled();
  });
  it('rejects anonymous session without ingesting', async () => {
    const auth = context();
    auth.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(auth);
    expect((await analyticsPost(post())).status).toBe(401);
    expect(mock.track).not.toHaveBeenCalled();
  });
  it('fails closed on session verification or identity mismatch', async () => {
    const auth = context();
    auth.port.verifySubject.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    mock.context.mockReturnValue(auth);
    expect((await analyticsPost(post())).status).toBe(503);
    auth.port.verifySubject.mockResolvedValue({
      ok: true,
      data: 'a2100000-0000-4000-8000-000000000002',
    });
    expect((await analyticsPost(post())).status).toBe(503);
    expect(mock.track).not.toHaveBeenCalled();
  });
  it.each(Object.entries(ANALYTICS_ERROR_STATUS))(
    'returns %s refusal accurately without retry',
    async (code, status) => {
      mock.track.mockResolvedValue({ ok: false, code });
      const response = await analyticsPost(post());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(mock.track).toHaveBeenCalledOnce();
    },
  );
});
