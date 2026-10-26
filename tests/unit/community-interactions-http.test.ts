// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import { communityInteractionsHttp } from '@/server/community-interactions/http';
import {
  interactionsActorId,
  interactionsPostId,
  interactionsOtherId,
  interactionsSlug,
  interactionsQuery,
  interactionsComment,
  interactionsPage,
  interactionsCreate,
  interactionsUpdate,
  interactionsDelete,
  interactionsLike,
  interactionsCreated,
  interactionsUpdated,
  interactionsDeleted,
  interactionsLiked,
} from './community-interactions-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  like: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/community-interactions', () => ({
  createCommunityInteractionsPort: mocks.port,
}));
const cases = [
  ['list', undefined, interactionsPage],
  ['create', interactionsCreate, interactionsCreated],
  ['update', interactionsUpdate, interactionsUpdated],
  ['delete', interactionsDelete, interactionsDeleted],
  ['like', interactionsLike, interactionsLiked],
] as const;
type Action = (typeof cases)[number][0];
function request({
  query = '',
  method = 'GET',
  body,
  origin = 'https://app.example',
  actor = interactionsActorId,
  contentType = 'application/json',
}: {
  query?: string;
  method?: string;
  body?: unknown;
  origin?: string | null;
  actor?: string | null;
  contentType?: string;
} = {}) {
  return new NextRequest(
    `https://app.example/api/board/${interactionsSlug}/${interactionsPostId}/comments${query}`,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        'Content-Type': contentType,
        ...(origin === null ? {} : { origin }),
        ...(actor === null ? {} : { [COMMUNITY_POSTS.actorHeader]: actor }),
      },
    },
  );
}
function call(
  action: Action,
  req: NextRequest,
  slug: unknown = interactionsSlug,
  postId: unknown = interactionsPostId,
  commentId: unknown = interactionsComment.id,
) {
  return communityInteractionsHttp(req, action, slug, postId, commentId);
}
function session(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: interactionsActorId,
      role: 'fan',
      is_restricted: false,
      onboarding_completed_at: '2026-01-01',
      ...extra,
    },
  };
}
function baseContext() {
  return {
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        r.headers.set(key, value);
      return r;
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue(baseContext());
  mocks.session.mockResolvedValue(session());
  mocks.port.mockReturnValue(mocks);
  for (const [action, , data] of cases)
    mocks[action].mockResolvedValue({ ok: true, data });
});
it.each(cases)(
  '%s has current account binding and private no-store headers',
  async (action, body, data) => {
    const response = await call(
      action,
      request({ method: action === 'list' ? 'GET' : 'POST', body }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    if (action === 'list')
      expect(mocks.list).toHaveBeenCalledExactlyOnceWith(interactionsQuery);
    else
      expect(mocks[action]).toHaveBeenCalledExactlyOnceWith(
        interactionsSlug,
        body,
      );
  },
);
it('GET allows absent Origin but requires mounted actor and bounded cursor', async () => {
  const cursor = {
    id: interactionsComment.id,
    created_at: interactionsComment.created_at,
  };
  mocks.list.mockResolvedValue({
    ok: true,
    data: { ...interactionsPage, comments: [] },
  });
  const response = await call(
    'list',
    request({
      origin: null,
      query: `?cursor=${encodeURIComponent(JSON.stringify(cursor))}`,
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
    ...interactionsQuery,
    cursor,
  });
});
it.each(cases)(
  '%s fails honestly when app key/config/client/port readiness is absent',
  async (action, body) => {
    for (const missing of ['configuration', 'client', 'port']) {
      mocks.context.mockReturnValue({ ...baseContext(), [missing]: null });
      const response = await call(
        action,
        request({ method: action === 'list' ? 'GET' : 'POST', body }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        ok: false,
        code: 'SETUP_NOT_READY',
      });
    }
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  '%s rejects invalid path and unknown/repeated query before session IO',
  async (action, body) => {
    const method = action === 'list' ? 'GET' : 'POST';
    for (const [slug, post] of [
      ['bad/path', interactionsPostId],
      [interactionsSlug, 'bad'],
      [null, interactionsPostId],
    ]) {
      expect(
        (await call(action, request({ method, body }), slug, post)).status,
      ).toBe(400);
    }
    for (const query of [
      '?unexpected=1',
      '?cursor=one&cursor=two',
      ...(action === 'list' ? [] : ['?cursor=one']),
    ]) {
      expect(
        (await call(action, request({ method, body, query }))).status,
      ).toBe(400);
    }
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  '%s rejects wrong request method before session IO',
  async (action) => {
    expect(
      (
        await call(
          action,
          request({ method: action === 'list' ? 'POST' : 'GET' }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it.each(cases.filter(([action]) => action !== 'list'))(
  '%s blocks cross-origin/missing/null-origin writes before auth IO',
  async (action, body) => {
    for (const origin of [
      null,
      'null',
      'https://evil.example',
      'https://app.example.evil',
      'http://app.example',
    ]) {
      expect(
        (await call(action, request({ method: 'POST', body, origin }))).status,
      ).toBe(403);
    }
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  '%s handles no session, unreadable session and profile restrictions before domain IO',
  async (action, body) => {
    for (const [state, status] of [
      [{ status: 'unauthenticated' }, 401],
      [{ status: 'unavailable' }, 503],
      [session({ is_restricted: true, restricted_until: null }), 403],
      [session({ onboarding_completed_at: null }), 403],
    ]) {
      mocks.session.mockResolvedValue(state);
      expect(
        (
          await call(
            action,
            request({ method: action === 'list' ? 'GET' : 'POST', body }),
          )
        ).status,
      ).toBe(status);
    }
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  '%s requires exact mounted account after current session lookup',
  async (action, body) => {
    for (const actor of [null, '', 'invalid', interactionsOtherId]) {
      const response = await call(
        action,
        request({ method: action === 'list' ? 'GET' : 'POST', body, actor }),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, code: 'FORBIDDEN' });
    }
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it('expired restrictions and current artist/admin profiles use the same fresh DB boundary', async () => {
  for (const profile of [
    { is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' },
    { role: 'artist', onboarding_completed_at: null },
    { role: 'admin', onboarding_completed_at: null },
  ]) {
    mocks.session.mockResolvedValue(session(profile));
    expect((await call('list', request())).status).toBe(200);
  }
});
it.each(cases.filter(([action]) => action !== 'list'))(
  '%s rejects malformed JSON DTO, excess/actor fields and body/path mismatch',
  async (action, body) => {
    for (const input of [
      null,
      [],
      {},
      { ...body, actor_id: interactionsActorId },
      { ...body, operation_id: 'bad' },
      { ...body, post_id: interactionsOtherId },
    ]) {
      expect(
        (await call(action, request({ method: 'POST', body: input }))).status,
      ).toBe(400);
    }
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it.each(['update', 'delete'] as const)(
  '%s binds exact comment path and rejects invalid path UUID',
  async (action) => {
    const body = action === 'update' ? interactionsUpdate : interactionsDelete;
    expect(
      (
        await call(
          action,
          request({ method: 'POST', body }),
          interactionsSlug,
          interactionsPostId,
          interactionsOtherId,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          action,
          request({ method: 'POST', body }),
          interactionsSlug,
          interactionsPostId,
          'bad',
        )
      ).status,
    ).toBe(400);
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it.each(['text/plain', 'application/x-www-form-urlencoded', ''])(
  'requires JSON content type %s',
  async (contentType) => {
    expect(
      (
        await call(
          'create',
          request({ method: 'POST', body: interactionsCreate, contentType }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it('rejects malformed UTF8/JSON and over-limit byte streams without domain writes', async () => {
  for (const body of [
    '{',
    new Uint8Array([0xff]),
    JSON.stringify({
      ...interactionsCreate,
      body: 'x'.repeat(COMMUNITY_POSTS.bodyLimit),
    }),
  ]) {
    const req = new NextRequest('https://app.example', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://app.example',
        [COMMUNITY_POSTS.actorHeader]: interactionsActorId,
      },
    });
    expect((await call('create', req)).status).toBe(400);
  }
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'maps sanitized domain %s to %d',
  async (code, status) => {
    for (const [action, body] of cases) {
      mocks[action].mockResolvedValue({ ok: false, code });
      const response = await call(
        action,
        request({ method: action === 'list' ? 'GET' : 'POST', body }),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
    }
  },
);
it.each(cases)('%s sanitizes thrown domain errors', async (action, body) => {
  mocks[action].mockRejectedValue(new Error('private database diagnostic'));
  const response = await call(
    action,
    request({ method: action === 'list' ? 'GET' : 'POST', body }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('sanitizes session/port construction exceptions with private headers', async () => {
  mocks.session.mockRejectedValueOnce(new Error('session diagnostic'));
  expect((await call('list', request())).status).toBe(503);
  mocks.port.mockImplementationOnce(() => {
    throw new Error('adapter diagnostic');
  });
  const response = await call('list', request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(response.headers.get('cache-control')).toBe(
    AUTH_PRIVATE_HEADERS['Cache-Control'],
  );
});
it('requires explicit confirmation and boolean desired state', async () => {
  expect(
    (
      await call(
        'delete',
        request({
          method: 'POST',
          body: { ...interactionsDelete, confirmed: false },
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        'like',
        request({ method: 'POST', body: { ...interactionsLike, liked: null } }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.delete).not.toHaveBeenCalled();
  expect(mocks.like).not.toHaveBeenCalled();
});
it('preserves cookie application for readiness and validation failure', async () => {
  const context = baseContext();
  const apply = vi.fn(context.apply);
  mocks.context.mockReturnValue({ ...context, apply });
  await call('list', request({ query: '?unknown=true' }));
  expect(apply).toHaveBeenCalledOnce();
});
