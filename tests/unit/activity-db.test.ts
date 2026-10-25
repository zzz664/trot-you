// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_PAGE_SIZE,
  ACTIVITY_MAX_CALL_NAME_LENGTH,
  ACTIVITY_MAX_REPLY_LENGTH,
} from '@/config/artist-reply-activity';
import { COMPOSE_ARTIST_PAGE_SIZE } from '@/config/artist-compose';
import {
  createArtistReplyActivityCatalogPort,
  createArtistReplyActivityPort,
} from '@/server/db/artist-reply-activity';
import type { ActorClient } from '@/server/db/client';
import {
  activityIds,
  activityMessages,
  activityPage,
  activitySlug,
  activityStamp,
} from './activity-domain-fixtures';

function rawMessage() {
  const message = activityMessages().messages[0]!;
  return { id: message.id, kind: message.kind, sent_at: message.sentAt };
}
function rawReply() {
  const reply = activityPage().replies[0]!;
  return {
    id: reply.id,
    call_name: reply.callName,
    body: reply.body,
    created_at: reply.createdAt,
    message_id: reply.messageId,
  };
}
function rawActivity() {
  const activity = activityPage().activity;
  return {
    week_start: activity.weekStart,
    week_end: activity.weekEnd,
    message_count: activity.messageCount,
    photo_count: activity.photoCount,
    weekly_message_min: activity.weeklyMessageMin,
    weekly_photo_min: activity.weeklyPhotoMin,
    requirements_ready: activity.requirementsReady,
  };
}
function rawPage() {
  const page = activityPage();
  return {
    artist: page.artist,
    server_now: page.serverNow,
    activity: rawActivity(),
    replies: [rawReply()],
    selected_message: null,
    has_more: page.hasMore,
  };
}
function rawMessages() {
  return {
    artist: activityMessages().artist,
    messages: [rawMessage()],
    has_more: false,
  };
}
function rawCatalog() {
  return { artists: [activityPage().artist], has_more: false };
}
function db(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const client = { rpc } as unknown as ActorClient;
  return {
    rpc,
    port: createArtistReplyActivityPort(client),
    catalog: createArtistReplyActivityCatalogPort(client),
  };
}
function without(value: Record<string, unknown>, key: string) {
  const result = { ...value };
  delete result[key];
  return result;
}
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const privateFields = {
  user_id: 'fictional-fan-identity-must-not-be-returned',
  email: 'fictional-private@example.invalid',
  phone: 'fictional-private-phone',
  subscription_id: 'fictional-private-subscription',
  gross_krw: 123456789,
  bank_account: 'fictional-private-account',
  billing_key: 'fictional-private-billing-key',
};

describe('artist reply activity actor-bound database adapter', () => {
  it('omits nullable context filters without inventing an actor argument', async () => {
    const { port, rpc } = db(rawPage());
    const result = await port.context(activitySlug, null, null);
    const { nextCursor, ...expected } = activityPage();
    expect(nextCursor).toBeNull();
    expect(result).toEqual({ ok: true, data: expected });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'artist_reply_activity_context',
      { p_artist_slug: activitySlug },
    );
  });
  it('preserves selected-message and exact timestamp/UUID reply cursor arguments', async () => {
    const { port, rpc } = db({ ...rawPage(), selected_message: rawMessage() });
    const before = {
      kind: 'replies' as const,
      slug: activitySlug,
      messageId: activityIds.message,
      createdAt: activityStamp,
      id: activityIds.reply,
    };
    const result = await port.context(
      activitySlug,
      activityIds.message,
      before,
    );
    expect(result.ok && result.data.selectedMessage).toEqual(
      activityMessages().messages[0],
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'artist_reply_activity_context',
      {
        p_artist_slug: activitySlug,
        p_message_id: activityIds.message,
        p_before_created_at: activityStamp,
        p_before_id: activityIds.reply,
      },
    );
  });
  it('projects only calling-name reply data and documented source activity', async () => {
    const { port } = db({
      ...rawPage(),
      ...privateFields,
      replies: [{ ...rawReply(), ...privateFields }],
      selected_message: {
        ...rawMessage(),
        ...privateFields,
        body: 'fictional unused source body',
        author_id: 'fictional-private-author',
      },
      activity: { ...rawActivity(), ...privateFields, ranking: 1 },
    });
    const result = await port.context(activitySlug, activityIds.message, null);
    expect(result).toEqual({
      ok: true,
      data: {
        artist: activityPage().artist,
        serverNow: activityStamp,
        activity: activityPage().activity,
        replies: activityPage().replies,
        selectedMessage: activityMessages().messages[0],
        hasMore: false,
      },
    });
    for (const [key, value] of Object.entries(privateFields)) {
      expect(JSON.stringify(result)).not.toContain(key);
      expect(JSON.stringify(result)).not.toContain(String(value));
    }
    expect(JSON.stringify(result)).not.toContain('ranking');
    expect(JSON.stringify(result)).not.toContain(
      'fictional unused source body',
    );
  });
  it('keeps unavailable requirements null rather than using documented draft defaults', async () => {
    const { port } = db({
      ...rawPage(),
      activity: {
        ...rawActivity(),
        weekly_message_min: null,
        weekly_photo_min: null,
        requirements_ready: false,
      },
    });
    const result = await port.context(activitySlug, null, null);
    expect(result.ok && result.data.activity).toEqual({
      ...activityPage().activity,
      weeklyMessageMin: null,
      weeklyPhotoMin: null,
      requirementsReady: false,
    });
  });
  it('supports retained replies with no message link and a genuinely empty page', async () => {
    const retained = db({
      ...rawPage(),
      replies: [{ ...rawReply(), message_id: null }],
    });
    const result = await retained.port.context(activitySlug, null, null);
    expect(result.ok && result.data.replies[0]?.messageId).toBeNull();
    const empty = db({ ...rawPage(), replies: [] });
    const emptyResult = await empty.port.context(activitySlug, null, null);
    expect(emptyResult.ok && emptyResult.data.replies).toEqual([]);
  });
  it.each(Object.keys(rawPage()))('requires context key %s', async (key) => {
    expect(
      await db(without(rawPage(), key)).port.context(activitySlug, null, null),
    ).toEqual(unavailable);
  });
  it.each(Object.keys(rawReply()))('requires reply key %s', async (key) => {
    expect(
      await db({
        ...rawPage(),
        replies: [without(rawReply(), key)],
      }).port.context(activitySlug, null, null),
    ).toEqual(unavailable);
  });
  it.each(Object.keys(rawActivity()))(
    'requires source activity key %s',
    async (key) => {
      expect(
        await db({
          ...rawPage(),
          activity: without(rawActivity(), key),
        }).port.context(activitySlug, null, null),
      ).toEqual(unavailable);
    },
  );
  it.each([
    null,
    [],
    {},
    { ...rawPage(), server_now: 'not-an-instant' },
    { ...rawPage(), has_more: 'false' },
    { ...rawPage(), artist: { ...activityPage().artist, ...privateFields } },
    {
      ...rawPage(),
      replies: Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, rawReply),
    },
    { ...rawPage(), replies: [{ ...rawReply(), call_name: null }] },
    {
      ...rawPage(),
      replies: [
        {
          ...rawReply(),
          call_name: '가'.repeat(ACTIVITY_MAX_CALL_NAME_LENGTH + 1),
        },
      ],
    },
    {
      ...rawPage(),
      replies: [{ ...rawReply(), body: null, is_blocked: true }],
    },
    {
      ...rawPage(),
      replies: [
        { ...rawReply(), body: '가'.repeat(ACTIVITY_MAX_REPLY_LENGTH + 1) },
      ],
    },
    {
      ...rawPage(),
      replies: [{ ...rawReply(), created_at: 'not-an-instant' }],
    },
    { ...rawPage(), replies: [{ ...rawReply(), message_id: 'not-an-id' }] },
    { ...rawPage(), selected_message: { ...rawMessage(), kind: 'unknown' } },
    { ...rawPage(), activity: { ...rawActivity(), photo_count: 5 } },
    { ...rawPage(), activity: { ...rawActivity(), message_count: -1 } },
    { ...rawPage(), activity: { ...rawActivity(), message_count: 1.5 } },
    {
      ...rawPage(),
      activity: {
        ...rawActivity(),
        message_count: Number.MAX_SAFE_INTEGER + 1,
      },
    },
    { ...rawPage(), activity: { ...rawActivity(), requirements_ready: false } },
    { ...rawPage(), activity: { ...rawActivity(), weekly_message_min: null } },
    { ...rawPage(), activity: { ...rawActivity(), weekly_photo_min: 0 } },
    { ...rawPage(), activity: { ...rawActivity(), week_end: '2026-10-19' } },
  ])('fails malformed or oversize context %# closed', async (value) => {
    expect(await db(value).port.context(activitySlug, null, null)).toEqual(
      unavailable,
    );
  });
});

describe('independent owned-message filter database pages', () => {
  it('omits absent cursor arguments and projects safe messages', async () => {
    const { port, rpc } = db(rawMessages());
    const { nextCursor, ...expected } = activityMessages();
    expect(nextCursor).toBeNull();
    expect(await port.messages(activitySlug, null)).toEqual({
      ok: true,
      data: expected,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'artist_reply_activity_messages',
      {
        p_artist_slug: activitySlug,
      },
    );
  });
  it('passes only sent timestamp/UUID cursor fields preserving microseconds', async () => {
    const { port, rpc } = db(rawMessages());
    await port.messages(activitySlug, {
      kind: 'messages',
      slug: activitySlug,
      sentAt: activityStamp,
      id: activityIds.message,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'artist_reply_activity_messages',
      {
        p_artist_slug: activitySlug,
        p_before_sent_at: activityStamp,
        p_before_id: activityIds.message,
      },
    );
  });
  it('drops extra source payloads and private identifiers from filter options', async () => {
    const { port } = db({
      ...rawMessages(),
      ...privateFields,
      messages: [{ ...rawMessage(), ...privateFields, body: 'not-needed' }],
    });
    const result = await port.messages(activitySlug, null);
    expect(result.ok && result.data.messages).toEqual(
      activityMessages().messages,
    );
    expect(JSON.stringify(result)).not.toContain('fictional-private');
    expect(JSON.stringify(result)).not.toContain('not-needed');
  });
  it.each(Object.keys(rawMessages()))(
    'requires message-page key %s',
    async (key) => {
      expect(
        await db(without(rawMessages(), key)).port.messages(activitySlug, null),
      ).toEqual(unavailable);
    },
  );
  it.each(Object.keys(rawMessage()))('requires message key %s', async (key) => {
    expect(
      await db({
        ...rawMessages(),
        messages: [without(rawMessage(), key)],
      }).port.messages(activitySlug, null),
    ).toEqual(unavailable);
  });
  it('rejects oversized options pages', async () => {
    const { port } = db({
      ...rawMessages(),
      messages: Array.from({ length: ACTIVITY_PAGE_SIZE + 1 }, rawMessage),
    });
    expect(await port.messages(activitySlug, null)).toEqual(unavailable);
  });
});

describe('owned artist reply activity catalog database pages', () => {
  it.each([null, activitySlug])(
    'maps cursor %s without caller identity',
    async (after) => {
      const { catalog, rpc } = db(rawCatalog());
      expect(await catalog.artists(after)).toEqual({
        ok: true,
        data: { artists: [activityPage().artist], hasMore: false },
      });
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        'artist_reply_activity_artists',
        after === null ? {} : { p_after_slug: after },
      );
    },
  );
  it('drops catalog-level private fields but rejects unrecognized artist fields', async () => {
    const safe = await db({
      ...rawCatalog(),
      ...privateFields,
    }).catalog.artists(null);
    expect(safe).toEqual({
      ok: true,
      data: { artists: [activityPage().artist], hasMore: false },
    });
    const invalid = await db({
      ...rawCatalog(),
      artists: [{ ...activityPage().artist, ...privateFields }],
    }).catalog.artists(null);
    expect(invalid).toEqual(unavailable);
  });
  it.each([
    null,
    {},
    { artists: [], has_more: 'false' },
    { has_more: false },
    { artists: [activityPage().artist] },
    {
      artists: Array.from(
        { length: COMPOSE_ARTIST_PAGE_SIZE + 1 },
        () => activityPage().artist,
      ),
      has_more: true,
    },
    {
      artists: [{ id: activityIds.artist, slug: activitySlug }],
      has_more: false,
    },
  ])('fails malformed catalog %# closed', async (value) => {
    expect(await db(value).catalog.artists(null)).toEqual(unavailable);
  });
});

describe('reply activity RPC error mapping', () => {
  it.each([
    ['ARTIST_REPLY_FORBIDDEN', 'FORBIDDEN'],
    ['ARTIST_REPLY_NOT_FOUND', 'NOT_FOUND'],
    ['ARTIST_REPLY_INVALID_INPUT', 'INVALID_INPUT'],
    ['ARTIST_REPLY_FORBIDDEN with private detail', 'UNAVAILABLE'],
    ['private SQL failure', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])(
    'maps exact %s for all reads without returning database detail',
    async (message, code) => {
      const { port, catalog } = db(rawPage(), { message });
      expect(await port.context(activitySlug, null, null)).toEqual({
        ok: false,
        code,
      });
      expect(await port.messages(activitySlug, null)).toEqual({
        ok: false,
        code,
      });
      expect(await catalog.artists(null)).toEqual({ ok: false, code });
    },
  );
});
