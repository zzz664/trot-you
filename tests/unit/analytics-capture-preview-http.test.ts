// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  ANALYTICS_BODY_LIMIT,
  ANALYTICS_PREVIEW_ACTOR_HEADER,
  ANALYTICS_ERROR_STATUS,
} from '@/config/analytics';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { AnalyticsEvent } from '@/config/analytics-events';
import { routes } from '@/config/routes';
import { POST } from '@/app/api/analytics/preview/route';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  capture: vi.fn(),
  port: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/analytics/capture', () => ({
  getAnalyticsCapturePort: mock.port,
}));
vi.mock('@/server/services/analytics/capture', () => ({
  captureServerEvent: mock.capture,
}));
const actor = 'a3900000-0000-4000-8000-000000000001';
const source = 'a3900000-0000-4000-8000-000000000002';
const key = 'a3900000-0000-4000-8000-000000000003';
const origin = 'https://app.example';
const input = { event_key: key, source_id: source };
function context(patch: Record<string, unknown> = {}) {
  return {
    configuration: { appOrigin: origin },
    client: { currentActor: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actor }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role: 'fan',
          is_restricted: false,
          restricted_until: null,
          onboarding_completed_at: '2026-10-26T00:00:00Z',
          ...patch,
        },
      }),
    },
    apply(response: NextResponse) {
      for (const [name, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(name, value);
      return response;
    },
  };
}
function post(
  body: unknown = input,
  sourceOrigin: string | null = origin,
  query = '',
  type = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': type,
    [ANALYTICS_PREVIEW_ACTOR_HEADER]: actor,
    Host: 'forged.invalid',
  });
  if (sourceOrigin !== null) headers.set('Origin', sourceOrigin);
  return new NextRequest(`${origin}${routes.analyticsPreview}${query}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.port.mockReturnValue({ serviceCapture: true });
  mock.capture.mockResolvedValue({ ok: true, data: null });
});
describe('fixed-purpose current-authority preview render observation', () => {
  it('binds current verified fan, fixed event name, minimal source/key and lifecycle signal', async () => {
    const request = post();
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: null });
    expect(mock.capture).toHaveBeenCalledExactlyOnceWith(
      { serviceCapture: true },
      {
        actor_id: actor,
        event: {
          name: AnalyticsEvent.PREVIEW_VIEW,
          event_key: key,
          properties: { source_id: source },
        },
      },
      request.signal,
    );
    for (const [name, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
  it.each([null, 'null', 'https://elsewhere.example', `${origin}/`])(
    'refuses hostile/absent origin %s before session',
    async (value) => {
      const auth = context();
      mock.context.mockReturnValue(auth);
      expect((await POST(post(input, value))).status).toBe(403);
      expect(auth.port.verifySubject).not.toHaveBeenCalled();
      expect(mock.capture).not.toHaveBeenCalled();
    },
  );
  it.each(['?name=preview_view', '?source_id=123', '?actor=123'])(
    'refuses query %s',
    async (query) => {
      expect((await POST(post(input, origin, query))).status).toBe(400);
      expect(mock.capture).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    {},
    [],
    { ...input, event_key: 'invalid' },
    { ...input, source_id: 'invalid' },
    { ...input, name: 'preview_view' },
    { ...input, actor_id: actor },
    { ...input, timestamp: '2026-10-26T00:00:00Z' },
    { ...input, text: 'private' },
    {
      event_key: key,
      name: 'subscribe_complete',
      properties: { source_id: source },
    },
    '{',
  ])('rejects nonminimal or business payload %j', async (value) => {
    expect((await POST(post(value))).status).toBe(400);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
    'rejects body type %s',
    async (type) => {
      expect((await POST(post(input, origin, '', type))).status).toBe(400);
      expect(mock.capture).not.toHaveBeenCalled();
    },
  );
  it('bounds body regardless of claimed content length', async () => {
    const request = post(' '.repeat(ANALYTICS_BODY_LIMIT + 1));
    request.headers.set('Content-Length', '1');
    expect((await POST(request)).status).toBe(400);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it.each([
    { role: 'admin' },
    { role: 'artist' },
    { is_restricted: true, restricted_until: null },
    { is_restricted: true, restricted_until: '2999-01-01T00:00:00Z' },
  ])('rejects nonfan or current restriction %j', async (patch) => {
    mock.context.mockReturnValue(context(patch));
    expect((await POST(post())).status).toBe(403);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it('does not collect before onboarding', async () => {
    mock.context.mockReturnValue(context({ onboarding_completed_at: null }));
    expect((await POST(post())).status).toBe(409);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it.each([null, source, 'invalid'])(
    'refuses stale/missing render actor header %s',
    async (expected) => {
      const request = post();
      if (expected === null)
        request.headers.delete(ANALYTICS_PREVIEW_ACTOR_HEADER);
      else request.headers.set(ANALYTICS_PREVIEW_ACTOR_HEADER, expected);
      expect((await POST(request)).status).toBe(403);
      expect(mock.capture).not.toHaveBeenCalled();
    },
  );
  it('rejects replaced/missing identity', async () => {
    const auth = context();
    auth.port.verifySubject.mockResolvedValue({ ok: true, data: source });
    mock.context.mockReturnValue(auth);
    expect((await POST(post())).status).toBe(503);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated actor', async () => {
    const auth = context();
    auth.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mock.context.mockReturnValue(auth);
    expect((await POST(post())).status).toBe(401);
    expect(mock.capture).not.toHaveBeenCalled();
  });
  it.each(['configuration', 'client', 'port'])(
    'fails closed without %s',
    async (field) => {
      mock.context.mockReturnValue({ ...context(), [field]: null });
      expect((await POST(post())).status).toBe(503);
      expect(mock.capture).not.toHaveBeenCalled();
    },
  );
  it.each(Object.entries(ANALYTICS_ERROR_STATUS))(
    'retains current DB refusal %s without retry',
    async (code, status) => {
      mock.capture.mockResolvedValue({ ok: false, code });
      const response = await POST(post());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
      expect(mock.capture).toHaveBeenCalledOnce();
    },
  );
});
