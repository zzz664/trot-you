// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createArtistCatalogPort,
  createArtistInterestPort,
  createArtistPreviewPort,
} from '@/server/db/artists';
import { createDiscoveryServiceClient } from '@/server/db/discovery-client';
import type { ActorClient } from '@/server/db/client';
import type { DiscoveryServiceClient } from '@/server/db/discovery-client';

const mocks = vi.hoisted(() => ({ env: vi.fn(), sdk: vi.fn() }));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.sdk }));
const id = 'a1100000-0000-4000-8000-000000000001';
const mediaId = 'a1100000-0000-4000-8000-000000000002';
const message = {
  id,
  type: 'photo',
  body_template: '{이름}의 허구 맛보기',
  sent_at: '2026-10-24T00:00:00+00:00',
  media: [
    {
      id: mediaId,
      kind: 'photo',
      width: 100,
      height: 100,
      duration_ms: null,
      object_id: 'hidden',
      bucket: 'private',
      path: 'hidden/path',
    },
  ],
};
const preview = {
  artist_slug: 'fictional-star',
  artist_name: '허구 가수',
  artist_intro: null,
  call_name: '별님',
  messages: [message],
  contract_id: 'hidden-contract',
};
function rpcClient(result: unknown) {
  const promise = Promise.resolve(result);
  const rpc = vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
  });
  return {
    actor: { rpc } as unknown as ActorClient,
    service: { rpc } as unknown as DiscoveryServiceClient,
    rpc,
  };
}
function catalogClient(result: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { actor: { from } as unknown as ActorClient, from, ...chain };
}

describe('minimal catalog database projection', () => {
  it('selects safe columns from the active public view with deterministic bounded pagination', async () => {
    const fake = catalogClient({
      data: [
        {
          slug: 'fictional-star',
          name: '허구 가수',
          intro: '허구 소개',
          id: 'hidden',
          profile_image_path: 'private/path',
          contract_id: 'hidden',
        },
      ],
      error: null,
    });
    expect(await createArtistCatalogPort(fake.actor).list(12, 13)).toEqual({
      ok: true,
      data: [
        { slug: 'fictional-star', name: '허구 가수', description: '허구 소개' },
      ],
    });
    expect(fake.from).toHaveBeenCalledExactlyOnceWith('artist_catalog');
    expect(fake.select).toHaveBeenCalledExactlyOnceWith('slug,name,intro');
    expect(fake.order).toHaveBeenCalledExactlyOnceWith('slug', {
      ascending: true,
    });
    expect(fake.range).toHaveBeenCalledExactlyOnceWith(12, 24);
  });
  it.each([
    null,
    {},
    [{ slug: 'invalid/slug', name: '허구', intro: null }],
    [{ slug: 'valid', name: '', intro: null }],
    [{ slug: 'valid', name: '허구' }],
  ])('fails closed on malformed catalog DTO %j', async (data) => {
    expect(
      await createArtistCatalogPort(
        catalogClient({ data, error: null }).actor,
      ).list(0, 13),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('does not echo query/provider error details', async () =>
    expect(
      await createArtistCatalogPort(
        catalogClient({ data: null, error: { message: 'secret-query' } }).actor,
      ).list(0, 13),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }));
});

describe('actor-only interest RPC adapter', () => {
  it('reads only the current actor choice without accepting a user id', async () => {
    const fake = rpcClient({
      data: {
        selected_slug: 'fictional-star',
        selected_name: '허구 가수',
        selected_at: '2026-10-24T00:00:00Z',
        user_id: 'hidden',
        subscription_id: 'hidden',
      },
      error: null,
    });
    expect(await createArtistInterestPort(fake.actor).read()).toEqual({
      ok: true,
      data: {
        selectedSlug: 'fictional-star',
        selectedName: '허구 가수',
        selectedAt: '2026-10-24T00:00:00Z',
      },
    });
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith('discovery_get_interest');
  });
  it('passes only the selected slug and does not create or transition a subscription', async () => {
    const fake = rpcClient({ error: null });
    expect(
      await createArtistInterestPort(fake.actor).select('fictional-star'),
    ).toEqual({ ok: true, data: null });
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith(
      'discovery_select_artist',
      { p_artist_slug: 'fictional-star' },
    );
  });
  it('preserves a null choice rather than claiming a completed selection', async () => {
    const fake = rpcClient({
      data: { selected_slug: null, selected_name: null, selected_at: null },
      error: null,
    });
    expect(await createArtistInterestPort(fake.actor).read()).toEqual({
      ok: true,
      data: { selectedSlug: null, selectedName: null, selectedAt: null },
    });
  });
  it('fails closed if no state row is returned', async () =>
    expect(
      await createArtistInterestPort(
        rpcClient({ data: null, error: null }).actor,
      ).read(),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }));
});

describe('privileged preview adapter and sanitization', () => {
  it('binds the server-verified actor and slug, retaining templates only within server data', async () => {
    const fake = rpcClient({ data: preview, error: null });
    const result = await createArtistPreviewPort(fake.service).read(
      id,
      'fictional-star',
    );
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith('discovery_preview', {
      p_actor_id: id,
      p_artist_slug: 'fictional-star',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        artist: {
          slug: 'fictional-star',
          name: '허구 가수',
          description: null,
        },
        callName: '별님',
        messages: [
          {
            id,
            kind: 'photo',
            template: '{이름}의 허구 맛보기',
            sentAt: message.sent_at,
            media: [{ kind: 'photo', availability: 'unavailable' }],
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    for (const value of ['object_id', 'bucket', 'path', 'contract_id', mediaId])
      expect(serialized).not.toContain(value);
  });
  it('returns an empty approved preview without fabricating content', async () =>
    expect(
      await createArtistPreviewPort(
        rpcClient({ data: { ...preview, messages: [] }, error: null }).service,
      ).read(id, 'fictional-star'),
    ).toMatchObject({ ok: true, data: { messages: [] } }));
  it.each([
    null,
    {},
    { ...preview, call_name: '' },
    { ...preview, messages: {} },
    { ...preview, messages: [{ ...message, type: 'html' }] },
    { ...preview, messages: [{ ...message, sent_at: 'yesterday' }] },
    {
      ...preview,
      messages: [{ ...message, media: [{ ...message.media[0], kind: 'url' }] }],
    },
  ])('rejects malformed server DTO %j', async (data) =>
    expect(
      await createArtistPreviewPort(
        rpcClient({ data, error: null }).service,
      ).read(id, 'fictional-star'),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' }),
  );
  it.each([
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['DISCOVERY_NOT_FOUND', 'NOT_FOUND'],
    ['DISCOVERY_INVALID_INPUT', 'INVALID_INPUT'],
    ['MESSAGE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['private SQL plus secret', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])('maps only controlled database error %s', async (message, code) => {
    const fake = rpcClient({
      data: null,
      error: { message, details: 'never expose' },
    });
    expect(await createArtistInterestPort(fake.actor).read()).toEqual({
      ok: false,
      code,
    });
    expect(
      await createArtistInterestPort(fake.actor).select('fictional-star'),
    ).toEqual({ ok: false, code });
    expect(
      await createArtistPreviewPort(fake.service).read(id, 'fictional-star'),
    ).toEqual({ ok: false, code });
  });
});

describe('server-only service capability configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.mockReturnValue({
      ok: true,
      data: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-secret',
      },
    });
    mocks.sdk.mockReturnValue({ fixture: true });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: {} },
    { ok: true, data: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' } },
    { ok: true, data: { SUPABASE_SERVICE_ROLE_KEY: 'fictional' } },
  ])(
    'does not create a fake privileged client on incomplete configuration %j',
    (input) => {
      mocks.env.mockReturnValue(input);
      expect(createDiscoveryServiceClient()).toBeNull();
      expect(mocks.sdk).not.toHaveBeenCalled();
    },
  );
  it('keeps credentials solely in the server SDK call and disables client session storage', () => {
    expect(createDiscoveryServiceClient()).toEqual({ fixture: true });
    expect(mocks.sdk).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'fictional-server-secret',
      expect.objectContaining({
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    );
  });
  it('forces no-store and bounds every service request, including an existing abort signal', async () => {
    createDiscoveryServiceClient();
    const options = mocks.sdk.mock.calls[0]![2] as {
      global: {
        fetch: (input: string, init?: RequestInit) => Promise<Response>;
      };
    };
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await options.global.fetch(
      'http://127.0.0.1:54321/rest/v1/rpc/discovery_preview',
      { cache: 'force-cache' },
    );
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    const abort = new AbortController();
    abort.abort();
    await options.global.fetch(
      'http://127.0.0.1:54321/rest/v1/rpc/discovery_preview',
      { signal: abort.signal },
    );
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
  });
});
