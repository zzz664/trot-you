// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import { communityPostsHttp } from '@/server/community-posts/http';
import {
  boardActorId,
  boardArtist,
  boardPostId,
  boardOtherId,
  boardSummary,
  boardList,
  boardDetail,
  boardCreate,
  boardDelete,
  boardNotice,
  boardCreated,
  boardDeleted,
  boardNoticeReceipt,
} from './community-posts-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  notice: vi.fn(),
  analytics: vi.fn(),
  observation: vi.fn(),
}));
vi.mock('@/server/community-posts/analytics', () => ({
  getCommunityPostAnalyticsPort: mocks.analytics,
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/community-posts', () => ({
  createCommunityPostsPort: mocks.port,
}));
function request(
  query = '',
  method = 'GET',
  body?: unknown,
  origin: string | null = 'https://app.example',
  actor: string | null = boardActorId,
) {
  return new NextRequest(
    `https://app.example/api/board/${boardArtist.slug}${query}`,
    {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        'Content-Type': 'application/json',
        ...(origin === null ? {} : { origin }),
        ...(actor === null ? {} : { [COMMUNITY_POSTS.actorHeader]: actor }),
      },
    },
  );
}
function session(role = 'fan', extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: boardActorId,
      role,
      is_restricted: false,
      onboarding_completed_at: '2026-01-01',
      ...extra,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
        r.headers.set(k, v);
      return r;
    },
  });
  mocks.session.mockResolvedValue(session());
  mocks.port.mockReturnValue(mocks);
  mocks.analytics.mockReturnValue({ record: mocks.observation });
  mocks.observation.mockResolvedValue({ ok: true, data: null });
  mocks.list.mockResolvedValue({ ok: true, data: boardList });
  mocks.detail.mockResolvedValue({ ok: true, data: boardDetail });
  mocks.create.mockResolvedValue({ ok: true, data: boardCreated });
  mocks.delete.mockResolvedValue({ ok: true, data: boardDeleted });
  mocks.notice.mockResolvedValue({ ok: true, data: boardNoticeReceipt });
});
it('reads fresh account-bound board with private no-store headers', async () => {
  const response = await communityPostsHttp(
    request(),
    'list',
    boardArtist.slug,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: boardList });
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
    slug: boardArtist.slug,
    cursor: null,
  });
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(response.headers.get(k)).toBe(v);
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
});
it('supports anonymous-free GET with no Origin while requiring mounted actor', async () =>
  expect(
    (
      await communityPostsHttp(
        request('', 'GET', undefined, null),
        'list',
        boardArtist.slug,
      )
    ).status,
  ).toBe(200));
it('passes pinned cursor and exact detail IDs to service', async () => {
  const cursor = {
    is_pinned: true,
    created_at: boardSummary.created_at,
    id: boardPostId,
  };
  const response = await communityPostsHttp(
    request(`?cursor=${encodeURIComponent(JSON.stringify(cursor))}`),
    'list',
    boardArtist.slug,
  );
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
    slug: boardArtist.slug,
    cursor,
  });
  expect(
    (
      await communityPostsHttp(
        request(),
        'detail',
        boardArtist.slug,
        boardPostId,
      )
    ).status,
  ).toBe(200);
  expect(mocks.detail).toHaveBeenCalledExactlyOnceWith({
    slug: boardArtist.slug,
    post_id: boardPostId,
  });
});
it('creates owner content without replacing current account by client UUID', async () => {
  const response = await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: boardCreated });
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardCreate,
  );
});
it('owner soft delete is confirmed and path bound', async () => {
  const response = await communityPostsHttp(
    request('', 'POST', boardDelete),
    'delete',
    boardArtist.slug,
    boardPostId,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: boardDeleted });
  expect(mocks.delete).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardDelete,
  );
});
it('admin alone can create a pinned notice and change desired pin state', async () => {
  mocks.session.mockResolvedValue(session('admin'));
  const notice = { ...boardCreate, is_notice: true, is_pinned: true };
  expect(
    (
      await communityPostsHttp(
        request('', 'POST', notice),
        'create',
        boardArtist.slug,
      )
    ).status,
  ).toBe(200);
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    notice,
  );
  expect(
    (
      await communityPostsHttp(
        request('', 'POST', boardNotice),
        'notice',
        boardArtist.slug,
        boardPostId,
      )
    ).status,
  ).toBe(200);
  expect(mocks.notice).toHaveBeenCalledExactlyOnceWith(
    boardArtist.slug,
    boardNotice,
  );
});
it.each(['fan', 'artist'])(
  'rejects %s notice escalation before DB',
  async (role) => {
    mocks.session.mockResolvedValue(session(role));
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', { ...boardCreate, is_notice: true }),
          'create',
          boardArtist.slug,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', boardNotice),
          'notice',
          boardArtist.slug,
          boardPostId,
        )
      ).status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.notice).not.toHaveBeenCalled();
  },
);
it.each([
  '?cursor=',
  '?cursor={',
  '?cursor={}&cursor={}',
  '?page=1',
  '?artist_id=x',
  '?slug=other',
  '?actor_id=x',
  '?cursor=%7B%22id%22%3A%22x%22%7D',
])('rejects ambiguous or unsupported list query %s', async (query) => {
  expect(
    (await communityPostsHttp(request(query), 'list', boardArtist.slug)).status,
  ).toBe(400);
  expect(mocks.list).not.toHaveBeenCalled();
});
it.each(['detail', 'create', 'delete', 'notice'] as const)(
  'rejects any query in %s',
  async (action) => {
    mocks.session.mockResolvedValue(session('admin'));
    const method = action === 'detail' ? 'GET' : 'POST';
    expect(
      (
        await communityPostsHttp(
          request(
            '?extra=1',
            method,
            method === 'GET' ? undefined : boardDelete,
          ),
          action,
          boardArtist.slug,
          boardPostId,
        )
      ).status,
    ).toBe(400);
  },
);
it.each(['list', 'detail', 'create', 'delete', 'notice'] as const)(
  'enforces HTTP verb for %s',
  async (action) => {
    const method = action === 'list' || action === 'detail' ? 'POST' : 'GET';
    expect(
      (
        await communityPostsHttp(
          request('', method),
          action,
          boardArtist.slug,
          boardPostId,
        )
      ).status,
    ).toBe(400);
  },
);
it.each([null, '', 'https://other.example', 'null', 'https://app.example/'])(
  'rejects mutation origin %s',
  async (origin) => {
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', boardCreate, origin),
          'create',
          boardArtist.slug,
        )
      ).status,
    ).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  },
);
it.each([null, '', boardOtherId, `${boardActorId},${boardOtherId}`])(
  'rejects absent or mismatched mounted account header %s',
  async (actor) => {
    for (const [action, method, body] of [
      ['list', 'GET', undefined],
      ['detail', 'GET', undefined],
      ['create', 'POST', boardCreate],
      ['delete', 'POST', boardDelete],
    ] as const)
      expect(
        (
          await communityPostsHttp(
            request('', method, body, 'https://app.example', actor),
            action,
            boardArtist.slug,
            boardPostId,
          )
        ).status,
      ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(['anonymous', 'unavailable', 'unconfigured'])(
  'fails fresh session %s without data calls',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    const response = await communityPostsHttp(
      request(),
      'list',
      boardArtist.slug,
    );
    expect(response.status).toBe(status === 'unavailable' ? 503 : 401);
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it.each(['fan', 'artist', 'admin'])(
  'restricted %s cannot read or mutate',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { is_restricted: true, restricted_until: null }),
    );
    expect(
      (await communityPostsHttp(request(), 'list', boardArtist.slug)).status,
    ).toBe(403);
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', boardCreate),
          'create',
          boardArtist.slug,
        )
      ).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('incomplete fan cannot bypass onboarding through direct API', async () => {
  mocks.session.mockResolvedValue(
    session('fan', { onboarding_completed_at: null }),
  );
  expect(
    (await communityPostsHttp(request(), 'list', boardArtist.slug)).status,
  ).toBe(403);
});
it.each(['artist', 'admin'])(
  'preserves established %s actor semantics without extra onboarding role policy',
  async (role) => {
    mocks.session.mockResolvedValue(
      session(role, { onboarding_completed_at: null }),
    );
    expect(
      (await communityPostsHttp(request(), 'list', boardArtist.slug)).status,
    ).toBe(200);
  },
);
it.each(['configuration', 'client', 'port'])(
  'missing %s is setup not ready, not mock success',
  async (key) => {
    const context = mocks.context();
    mocks.context.mockReturnValue({ ...context, [key]: null });
    const response = await communityPostsHttp(
      request(),
      'list',
      boardArtist.slug,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it.each([undefined, null, '', 123, '../private', 'UPPER'])(
  'rejects invalid path slug %j',
  async (slug) => {
    expect((await communityPostsHttp(request(), 'list', slug)).status).toBe(
      400,
    );
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it.each([undefined, null, '', 'not-uuid'])(
  'rejects invalid detail postId %j',
  async (postId) => {
    expect(
      (await communityPostsHttp(request(), 'detail', boardArtist.slug, postId))
        .status,
    ).toBe(400);
    expect(mocks.detail).not.toHaveBeenCalled();
  },
);
it.each(['delete', 'notice'] as const)(
  'refuses %s payload targeting another path resource',
  async (action) => {
    mocks.session.mockResolvedValue(session('admin'));
    const input = action === 'delete' ? boardDelete : boardNotice;
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', input),
          action,
          boardArtist.slug,
          boardOtherId,
        )
      ).status,
    ).toBe(400);
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it.each([
  null,
  {},
  { ...boardCreate, actor_id: boardOtherId },
  { ...boardCreate, title: '' },
  { ...boardCreate, upload_ids: ['bad'] },
])('rejects invalid create body %#', async (body) => {
  expect(
    (
      await communityPostsHttp(
        request('', 'POST', body),
        'create',
        boardArtist.slug,
      )
    ).status,
  ).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(['delete', 'notice'] as const)(
  'rejects invalid %s JSON',
  async (action) => {
    mocks.session.mockResolvedValue(session('admin'));
    expect(
      (
        await communityPostsHttp(
          request('', 'POST', {}),
          action,
          boardArtist.slug,
          boardPostId,
        )
      ).status,
    ).toBe(400);
    expect(mocks[action]).not.toHaveBeenCalled();
  },
);
it('rejects unsupported content type', async () => {
  const req = request('', 'POST', boardCreate);
  req.headers.set('content-type', 'text/plain');
  expect(
    (await communityPostsHttp(req, 'create', boardArtist.slug)).status,
  ).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'maps %s to HTTP %d without exposing diagnostics',
  async (code, status) => {
    mocks.list.mockResolvedValue({ ok: false, code });
    const response = await communityPostsHttp(
      request(),
      'list',
      boardArtist.slug,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
    for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(k)).toBe(v);
  },
);
it('contains unexpected session exceptions', async () => {
  mocks.session.mockRejectedValue(new Error('private token'));
  const response = await communityPostsHttp(
    request(),
    'list',
    boardArtist.slug,
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('cross-account DTO is denied even after matching request header', async () => {
  mocks.list.mockResolvedValue({
    ok: true,
    data: { ...boardList, actor_id: boardOtherId },
  });
  expect(
    (await communityPostsHttp(request(), 'list', boardArtist.slug)).status,
  ).toBe(503);
});

it('observes post_create only after a verified committed receipt and reuses the same event key on retry', async () => {
  await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  expect(mocks.observation).toHaveBeenCalledTimes(2);
  expect(mocks.observation).toHaveBeenNthCalledWith(1, {
    actor_id: boardActorId,
    event_key: boardCreate.operation_id,
    post_id: boardPostId,
  });
  expect(mocks.observation.mock.calls[0]).toEqual(
    mocks.observation.mock.calls[1],
  );
  expect(mocks.create.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.observation.mock.invocationCallOrder[0]!,
  );
});
it.each([
  'CONSENT_REQUIRED',
  'SETUP_NOT_READY',
  'UNAVAILABLE',
  'FORBIDDEN',
  'IDEMPOTENCY_CONFLICT',
])(
  'preserves committed creation when optional analytics is %s',
  async (code) => {
    mocks.observation.mockResolvedValue({ ok: false, code });
    const response = await communityPostsHttp(
      request('', 'POST', boardCreate),
      'create',
      boardArtist.slug,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: boardCreated });
  },
);
it('preserves committed creation when analytics factory is unconfigured or record throws', async () => {
  mocks.analytics.mockReturnValue(null);
  expect(
    (
      await communityPostsHttp(
        request('', 'POST', boardCreate),
        'create',
        boardArtist.slug,
      )
    ).status,
  ).toBe(200);
  mocks.analytics.mockReturnValue({ record: mocks.observation });
  mocks.observation.mockRejectedValue(new Error('private key'));
  const response = await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, data: boardCreated });
});
it('does not observe rejected or mismatched create receipts or other board actions', async () => {
  mocks.create.mockResolvedValue({ ok: false, code: 'CONTENT_BLOCKED' });
  await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  mocks.create.mockResolvedValue({
    ok: true,
    data: { ...boardCreated, id: boardOtherId },
  });
  await communityPostsHttp(
    request('', 'POST', boardCreate),
    'create',
    boardArtist.slug,
  );
  await communityPostsHttp(request(), 'list', boardArtist.slug);
  await communityPostsHttp(request(), 'detail', boardArtist.slug, boardPostId);
  await communityPostsHttp(
    request('', 'POST', boardDelete),
    'delete',
    boardArtist.slug,
    boardPostId,
  );
  mocks.session.mockResolvedValue(session('admin'));
  await communityPostsHttp(
    request('', 'POST', boardNotice),
    'notice',
    boardArtist.slug,
    boardPostId,
  );
  expect(mocks.observation).not.toHaveBeenCalled();
  expect(mocks.analytics).not.toHaveBeenCalled();
});
