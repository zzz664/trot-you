// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { FONT_SCALE_COOKIE } from '@/config/constants';
import { ONBOARDING_BODY_LIMIT } from '@/config/onboarding';
import { success } from '@/lib/result';
import { onboardingPost } from '@/server/onboarding/http';

const { context, adapter } = vi.hoisted(() => ({
  context: vi.fn(),
  adapter: { read: vi.fn(), save: vi.fn() },
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: context }));
vi.mock('@/server/db/onboarding', () => ({
  createOnboardingPort: () => adapter,
}));
const origin = 'https://app.example';
const profile = {
  id: 'fictional',
  role: 'fan',
  onboarding_completed_at: null,
  is_restricted: false,
  restricted_until: null,
};
const config = () => ({
  configuration: { appOrigin: origin },
  client: {},
  port: {
    verifySubject: vi.fn().mockResolvedValue(success(profile.id)),
    readProfile: vi.fn().mockResolvedValue(success(profile)),
  },
  apply: (response: NextResponse) => {
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      response.headers.set(key, value);
    return response;
  },
});
function request(
  body: unknown = { step: 'font', fontScale: 'xlarge' },
  source: string | null = origin,
  contentType = 'application/json',
) {
  const headers = new Headers({
    'Content-Type': contentType,
    Host: 'evil.example',
    'X-Forwarded-Host': 'evil.example',
  });
  if (source !== null) headers.set('Origin', source);
  return new NextRequest('https://poisoned.example/api/onboarding', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  context.mockReturnValue(config());
  adapter.save.mockResolvedValue({ ok: true, data: null });
});
describe('onboarding HTTP boundary', () => {
  it.each([null, 'null', 'https://evil.example', `${origin}.evil.test`])(
    'rejects missing or foreign browser Origin %s',
    async (source) => {
      const response = await onboardingPost(request(undefined, source));
      expect(response.status).toBe(403);
      expect(adapter.save).not.toHaveBeenCalled();
      expect(response.headers.get('cache-control')).toContain('no-store');
    },
  );
  it('returns setup-not-ready without credentials or fake writes', async () => {
    context.mockReturnValue({
      ...config(),
      configuration: null,
      client: null,
      port: null,
    });
    const response = await onboardingPost(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it.each([
    ['{}', 'text/plain'],
    ['{bad', 'application/json'],
    ['x'.repeat(ONBOARDING_BODY_LIMIT + 1), 'application/json'],
    [{ step: 'font', fontScale: 'large', id: 'victim' }, 'application/json'],
  ])(
    'rejects unsupported, malformed, oversized or authority-bearing body',
    async (body, contentType) => {
      const response = await onboardingPost(request(body, origin, contentType));
      expect(response.status).toBe(400);
      expect(adapter.save).not.toHaveBeenCalled();
    },
  );
  it('uses current verified identity, not cookie claims or caller IDs', async () => {
    const current = config();
    current.port.verifySubject.mockResolvedValue(success(null));
    context.mockReturnValue(current);
    const response = await onboardingPost(request());
    expect(response.status).toBe(401);
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it.each([
    { ...profile, is_restricted: true },
    { ...profile, onboarding_completed_at: '2026-10-24T00:00:00Z' },
  ])('blocks restricted or fully-completed profile', async (actor) => {
    const current = config();
    current.port.readProfile.mockResolvedValue(success(actor));
    context.mockReturnValue(current);
    const response = await onboardingPost(request());
    expect(response.status).toBe(403);
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it('sets a secure first-render preference cookie only after actual font save', async () => {
    const response = await onboardingPost(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: '/onboarding/name',
    });
    expect(response.cookies.get(FONT_SCALE_COOKIE)?.value).toBe('xlarge');
    expect(response.headers.get('set-cookie')).toMatch(
      /Secure.*HttpOnly.*SameSite=lax/i,
    );
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(adapter.save).toHaveBeenCalledWith({
      step: 'font',
      fontScale: 'xlarge',
    });
  });
  it('does not set a preference or redirect on failed persistence', async () => {
    adapter.save.mockResolvedValue({ ok: false, code: 'SETUP_NOT_READY' });
    const response = await onboardingPost(request());
    expect(response.status).toBe(503);
    expect(response.cookies.get(FONT_SCALE_COOKIE)).toBeUndefined();
  });
});
