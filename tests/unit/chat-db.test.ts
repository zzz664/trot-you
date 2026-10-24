// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_MAX_PAGE_SIZE } from '@/config/chat';
import { createChatPagePort, createChatReadPort } from '@/server/db/chat';
import {
  createChatServiceClient,
  type ChatServiceClient,
} from '@/server/db/chat-client';
import type { ActorClient } from '@/server/db/client';

const mocks = vi.hoisted(() => ({ env: vi.fn(), sdk: vi.fn() }));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.sdk }));
const actor = 'a1900000-0000-4000-8000-000000000001';
const messageId = 'a1900000-0000-4000-8000-000000000002';
const mediaId = 'a1900000-0000-4000-8000-000000000003';
const slug = 'fictional-star';
const sentAt = '2026-10-24T00:00:00.123456+00:00';
const readAt = '2026-10-24T00:00:01.654321+00:00';
const message = {
  id: messageId,
  type: 'photo',
  body_template: '{이름} 안녕',
  sent_at: sentAt,
  read_at: null,
  media: [
    {
      id: mediaId,
      kind: 'photo',
      width: 100,
      height: 100,
      duration_ms: null,
      object_path: 'private/path',
    },
  ],
};
const page = {
  artist_id: actor,
  artist_slug: slug,
  artist_name: '허구 가수',
  artist_intro: null,
  call_name: '별님',
  has_access: true,
  read_count: 0,
  has_more: false,
  messages: [message],
  contract_id: 'private-contract',
};
function client(result: unknown) {
  const rpc = vi
    .fn()
    .mockReturnValue({ single: vi.fn().mockResolvedValue(result) });
  return {
    actor: { rpc } as unknown as ActorClient,
    service: { rpc } as unknown as ChatServiceClient,
    rpc,
  };
}

describe('fan chat safe database projection', () => {
  it('calls only the trusted service projection with verified actor and full cursor precision', async () => {
    const fake = client({ data: page, error: null });
    const before = { slug, sentAt, id: messageId };
    const result = await createChatPagePort(fake.service).page(
      actor,
      slug,
      30,
      before,
    );
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith('fan_chat_page', {
      p_actor_id: actor,
      p_artist_slug: slug,
      p_limit: 30,
      p_before_sent_at: sentAt,
      p_before_id: messageId,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        artist: { slug, name: '허구 가수', description: null },
        callName: '별님',
        hasAccess: true,
        readCount: 0,
        hasMore: false,
        messages: [
          {
            id: messageId,
            kind: 'photo',
            template: '{이름} 안녕',
            sentAt,
            readAt: null,
            media: [{ id: mediaId, kind: 'photo' }],
          },
        ],
      },
    });
    for (const value of [
      'private/path',
      'private-contract',
      'artist_id',
      'object_path',
    ])
      expect(JSON.stringify(result)).not.toContain(value);
  });
  it('omits both cursor tuple values on the first page', async () => {
    const fake = client({ data: { ...page, messages: [] }, error: null });
    expect(
      await createChatPagePort(fake.service).page(actor, slug, 30, null),
    ).toMatchObject({ ok: true, data: { messages: [], hasMore: false } });
    expect(fake.rpc).toHaveBeenCalledWith('fan_chat_page', {
      p_actor_id: actor,
      p_artist_slug: slug,
      p_limit: 30,
    });
  });
  it('preserves authenticated empty/no-paid-access context without leaking financial history', async () => {
    const fake = client({
      data: { ...page, has_access: false, messages: [] },
      error: null,
    });
    expect(
      await createChatPagePort(fake.service).page(actor, slug, 30, null),
    ).toMatchObject({
      ok: true,
      data: { hasAccess: false, readCount: 0, messages: [], hasMore: false },
    });
  });
  it.each([
    null,
    {},
    { ...page, artist_id: 'invalid' },
    { ...page, artist_slug: 'Bad' },
    { ...page, artist_name: '' },
    { ...page, call_name: '' },
    { ...page, read_count: '1' },
    { ...page, read_count: -1 },
    { ...page, read_count: 1.5 },
    { ...page, read_count: Number.MAX_SAFE_INTEGER + 1 },
    { ...page, has_access: 'true' },
    { ...page, has_more: null },
    {
      ...page,
      messages: Array.from({ length: CHAT_MAX_PAGE_SIZE + 1 }, () => message),
    },
    { ...page, messages: [{ ...message, sent_at: '2026-02-30T00:00:00Z' }] },
    { ...page, messages: [{ ...message, read_at: 'yesterday' }] },
    { ...page, messages: [{ ...message, type: 'html' }] },
    {
      ...page,
      messages: [{ ...message, media: [{ id: mediaId, kind: 'url' }] }],
    },
    { ...page, has_access: false },
    { ...page, has_access: false, messages: [], read_count: 1 },
    { ...page, has_access: false, messages: [], has_more: true },
  ])('fails closed on malformed or contradictory RPC DTO %j', async (data) => {
    expect(
      await createChatPagePort(client({ data, error: null }).service).page(
        actor,
        slug,
        30,
        null,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    ['CHAT_INVALID_INPUT', 'INVALID_INPUT'],
    ['CHAT_NOT_FOUND', 'NOT_FOUND'],
    ['CHAT_FORBIDDEN', 'FORBIDDEN'],
    ['CHAT_SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_REQUIRED'],
    ['CHAT_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['CHAT_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['MESSAGE_NOT_VISIBLE', 'FORBIDDEN'],
    ['MESSAGE_PAGE_INVALID', 'INVALID_INPUT'],
    ['MESSAGE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['private query details', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])(
    'maps controlled RPC error %s consistently without details',
    async (message, code) => {
      const fake = client({
        data: null,
        error: { message, details: 'private-detail' },
      });
      expect(
        await createChatPagePort(fake.service).page(actor, slug, 30, null),
      ).toEqual({ ok: false, code });
      expect(
        await createChatReadPort(fake.actor).mark(slug, messageId),
      ).toEqual({ ok: false, code });
    },
  );
});

describe('read marks use the actor capability and server evidence only', () => {
  it('does not pass caller-selected actor or time/count into the write RPC', async () => {
    const fake = client({
      data: {
        read_at: readAt,
        read_count: 1,
        user_id: actor,
        ignored: 'private-value',
      },
      error: null,
    });
    expect(await createChatReadPort(fake.actor).mark(slug, messageId)).toEqual({
      ok: true,
      data: { readAt, readCount: 1 },
    });
    expect(fake.rpc).toHaveBeenCalledExactlyOnceWith('fan_chat_mark_read', {
      p_artist_slug: slug,
      p_message_id: messageId,
    });
  });
  it.each([
    null,
    {},
    { read_at: null, read_count: 1 },
    { read_at: 'tomorrow', read_count: 1 },
    { read_at: readAt, read_count: '1' },
    { read_at: readAt, read_count: -1 },
    { read_at: readAt, read_count: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed evidence %j', async (data) => {
    expect(
      await createChatReadPort(client({ data, error: null }).actor).mark(
        slug,
        messageId,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});

describe('private chat read client configuration', () => {
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
    { ok: false },
    { ok: true, data: {} },
    { ok: true, data: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' } },
    {
      ok: true,
      data: { SUPABASE_SERVICE_ROLE_KEY: 'fictional-server-secret' },
    },
  ])('requires actual complete configuration %j', (input) => {
    mocks.env.mockReturnValue(input);
    expect(createChatServiceClient()).toBeNull();
    expect(mocks.sdk).not.toHaveBeenCalled();
  });
  it('keeps credentials in the server SDK only with session persistence disabled', () => {
    expect(createChatServiceClient()).toEqual({ fixture: true });
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
  it('forces no-store and finite request cancellation even when a caller provides a signal', async () => {
    createChatServiceClient();
    const options = mocks.sdk.mock.calls[0]![2] as {
      global: {
        fetch: (input: string, init?: RequestInit) => Promise<Response>;
      };
    };
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await options.global.fetch(
      'http://127.0.0.1:54321/rest/v1/rpc/fan_chat_page',
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
      'http://127.0.0.1:54321/rest/v1/rpc/fan_chat_page',
      { signal: abort.signal },
    );
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
  });
});
