// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { COMMUNITY_POSTS } from '@/config/community-posts';
import { COMMUNITY_MEDIA } from '@/config/community-media';
import { communityMediaHttp } from '@/server/community-posts/media';
import { communityMediaJson } from '@/server/community-posts/media-security';
const mock = vi.hoisted(() => ({
  context: vi.fn(),
  deps: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  read: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mock.context }));
vi.mock('@/server/community-posts/media-dependencies', () => ({
  createCommunityMediaDependencies: mock.deps,
}));
vi.mock('@/server/services/community-posts/media', () => ({
  beginCommunityImage: mock.begin,
  completeCommunityImage: mock.complete,
  readCommunityImage: mock.read,
  revokeCommunityImage: mock.revoke,
}));
const actor = 'd0340000-0000-4000-8000-000000000001';
const origin = 'https://app.example';
function context() {
  return {
    configuration: { appOrigin: origin },
    client: {},
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: actor }),
      readProfile: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: actor,
          role: 'fan',
          onboarding_completed_at: '2026-10-25T00:00:00Z',
          is_restricted: false,
          restricted_until: null,
        },
      }),
    },
    apply: (response: NextResponse) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      return response;
    },
  };
}
function request(
  overrides: {
    origin?: string;
    actor?: string;
    body?: string;
    type?: string;
    method?: string;
    search?: string;
  } = {},
) {
  return new NextRequest(
    `${origin}/api/board/media/read${overrides.search ?? ''}`,
    {
      method: overrides.method ?? 'POST',
      headers: {
        Origin: overrides.origin ?? origin,
        [COMMUNITY_POSTS.actorHeader]: overrides.actor ?? actor,
        'Content-Type': overrides.type ?? 'application/json',
      },
      ...(overrides.method === 'GET' ? {} : { body: overrides.body ?? '{}' }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.context.mockReturnValue(context());
  mock.deps.mockReturnValue({ fixture: true });
  for (const fn of [mock.begin, mock.complete, mock.read, mock.revoke])
    fn.mockResolvedValue({ ok: true, data: null });
});
describe('community media HTTP boundary', () => {
  it.each(['begin', 'complete', 'revoke', 'read'] as const)(
    'delegates verified actor and private %s operation',
    async (action) => {
      const response = await communityMediaHttp(request(), action);
      expect(response.status).toBe(200);
      expect(mock[action]).toHaveBeenCalledExactlyOnceWith(
        { fixture: true },
        actor,
        {},
      );
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    },
  );
  it.each(['', 'null', 'https://evil.example', `${origin}.evil.example`])(
    'rejects foreign origin %s',
    async (source) => {
      const ctx = context();
      mock.context.mockReturnValue(ctx);
      expect(
        (await communityMediaHttp(request({ origin: source }), 'begin')).status,
      ).toBe(403);
      expect(ctx.port.verifySubject).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'd0340000-0000-4000-8000-000000000002'])(
    'rejects absent/changed mounted actor %s',
    async (mounted) => {
      expect(
        (await communityMediaHttp(request({ actor: mounted }), 'read')).status,
      ).toBe(403);
      expect(mock.deps).not.toHaveBeenCalled();
    },
  );
  it.each([
    { role: 'fan', onboarding_completed_at: null },
    { is_restricted: true, restricted_until: null },
  ])('requires current eligible profile %j', async (change) => {
    const ctx = context();
    const profile = (await ctx.port.readProfile()).data;
    ctx.port.readProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, ...change },
    });
    mock.context.mockReturnValue(ctx);
    expect((await communityMediaHttp(request(), 'read')).status).toBe(403);
    expect(mock.deps).not.toHaveBeenCalled();
  });
  it('rejects stale authenticated profile mismatch', async () => {
    const ctx = context();
    const profile = (await ctx.port.readProfile()).data;
    ctx.port.readProfile.mockResolvedValue({
      ok: true,
      data: { ...profile, id: 'd0340000-0000-4000-8000-000000000002' },
    });
    mock.context.mockReturnValue(ctx);
    expect((await communityMediaHttp(request(), 'begin')).status).toBe(503);
  });
  it('never assumes storage keys are configured', async () => {
    mock.deps.mockReturnValue(null);
    expect((await communityMediaHttp(request(), 'begin')).status).toBe(503);
    expect(mock.begin).not.toHaveBeenCalled();
  });
  it.each([
    { method: 'GET' },
    { search: '?image=private' },
    { type: 'text/plain' },
    { body: '{bad' },
    { body: 'x'.repeat(COMMUNITY_MEDIA.bodyLimit + 1) },
  ])('rejects malformed transport', async (change) => {
    expect((await communityMediaHttp(request(change), 'read')).status).toBe(
      400,
    );
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('maps current DB refusal without exposing exceptions', async () => {
    mock.read.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect((await communityMediaHttp(request(), 'read')).status).toBe(404);
    mock.read.mockRejectedValue(new Error('private-token'));
    const response = await communityMediaHttp(request(), 'read');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-token');
  });
  it('fails closed when configuration/auth adapter is absent', async () => {
    mock.context.mockReturnValue({
      ...context(),
      configuration: null,
      client: null,
      port: null,
    });
    expect((await communityMediaHttp(request(), 'read')).status).toBe(503);
  });
  it('bounds malformed utf8 in the streaming decoder', async () => {
    const req = new Request(origin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array([0xc3, 0x28]),
    });
    await expect(communityMediaJson(req)).rejects.toThrow();
  });
  it('bounds slow request body without arbitrary waiting', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const req = new Request(origin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new ReadableStream({ cancel }),
        duplex: 'half',
      } as RequestInit);
      const pending = expect(communityMediaJson(req)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(COMMUNITY_MEDIA.bodyTimeoutMs);
      await pending;
      expect(cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
