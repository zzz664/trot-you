// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchModerationContext,
  fetchModerationQueue,
  fetchModerationNotices,
  reportCommunityTarget,
  resolveModerationReport,
  restrictModerationUser,
} from '@/client/community-moderation';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import { COMMUNITY_MODERATION } from '@/config/community-moderation';
import {
  moderationContextPath,
  moderationReportPath,
  moderationQueuePath,
  moderationNoticesPath,
  moderationAdminActionPath,
} from '@/config/routes';
import * as f from './community-moderation-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => vi.unstubAllGlobals());
const reads = [
  [
    () =>
      fetchModerationContext(f.moderationTarget, undefined, f.moderationActor),
    f.moderationContext,
    moderationContextPath(f.moderationTarget),
  ],
  [
    () => fetchModerationQueue(null, undefined, f.moderationActor),
    f.moderationQueue,
    moderationQueuePath(),
  ],
  [
    () => fetchModerationNotices(null, undefined, f.moderationActor),
    f.moderationNotices,
    moderationNoticesPath(),
  ],
] as const;
const writes = [
  [
    () =>
      reportCommunityTarget(
        f.moderationReportInput,
        undefined,
        f.moderationActor,
      ),
    f.moderationReportInput,
    f.moderationReported,
    moderationReportPath(),
  ],
  [
    () =>
      resolveModerationReport(
        f.moderationResolveInput,
        undefined,
        f.moderationActor,
      ),
    f.moderationResolveInput,
    f.moderationResolved,
    moderationAdminActionPath('resolve'),
  ],
  [
    () =>
      restrictModerationUser(
        f.moderationRestrictInput,
        undefined,
        f.moderationActor,
      ),
    f.moderationRestrictInput,
    f.moderationRestricted,
    moderationAdminActionPath('restrict'),
  ],
] as const;
it.each(reads)(
  'read %# uses actor-bound noncacheable same-origin transport',
  async (call, data, path) => {
    const fetcher = vi.fn().mockResolvedValue(response(ok(data)));
    vi.stubGlobal('fetch', fetcher);
    expect(await call()).toEqual(ok(data));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      path,
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { [COMMUNITY_POSTS.actorHeader]: f.moderationActor },
      }),
    );
  },
);
it.each(writes)(
  'write %# preserves exact operation intent for replay',
  async (call, input, data, path) => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(response(ok(data)));
    vi.stubGlobal('fetch', fetcher);
    expect(await call()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(await call()).toEqual(ok(data));
    expect(fetcher.mock.calls.map(([url, init]) => [url, init.body])).toEqual([
      [path, JSON.stringify(input)],
      [path, JSON.stringify(input)],
    ]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        [COMMUNITY_POSTS.actorHeader]: f.moderationActor,
      },
    });
  },
);
it.each(reads)('read %# rejects another actor snapshot', async (call, data) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response(ok({ ...data, actor_id: f.moderationOther })),
      ),
  );
  expect(await call()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('context rejects another target response', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response(ok({ ...f.moderationContext, target_id: f.moderationOther })),
      ),
  );
  expect(await reads[0][0]()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each([
  [writes[0][0], { ...f.moderationReported, target_id: f.moderationOther }],
  [writes[0][0], { ...f.moderationReported, target_type: 'reply' }],
  [writes[1][0], { ...f.moderationResolved, report_id: f.moderationOther }],
  [writes[1][0], { ...f.moderationResolved, decision: 'delete' }],
  [writes[1][0], { ...f.moderationResolved, revision: 10 }],
  [writes[2][0], { ...f.moderationRestricted, user_id: f.moderationActor }],
  [
    writes[2][0],
    {
      ...f.moderationRestricted,
      restricted_until: '2099-10-31T15:00:00.000001Z',
    },
  ],
])('rejects mismatched mutation receipt %#', async (call, data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(data))));
  expect(await call()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'accepts exact public failure %s and status %i',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, code }, status)),
    );
    expect(await reads[0][0]()).toEqual({ ok: false, code });
  },
);
it.each([
  () => response(ok(f.moderationContext), 201),
  () => response({ ok: false, code: 'FORBIDDEN' }, 200),
  () => response({ ok: false, code: 'INTERNAL_SQL' }, 500),
  () => response({ ok: false, code: '__proto__' }, 500),
  () => response({ ok: true, data: f.moderationContext, private: true }),
  () => response({ ok: true, data: {} }),
  () =>
    new Response('<html>login</html>', {
      headers: { 'content-type': 'text/html' },
    }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(' '.repeat(COMMUNITY_MODERATION.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])(
  'malformed transport response %# is uncertain, never success',
  async (make) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
    expect(await reads[0][0]()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('no actor key forbids transport before any request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchModerationContext(f.moderationTarget)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it('already aborted call does not start a request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  controller.abort();
  expect(
    await reportCommunityTarget(
      f.moderationReportInput,
      controller.signal,
      f.moderationActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  () =>
    fetchModerationContext(
      { ...f.moderationTarget, target_id: 'bad' },
      undefined,
      f.moderationActor,
    ),
  () =>
    fetchModerationQueue(
      { created_at: 'bad', id: f.moderationActor },
      undefined,
      f.moderationActor,
    ),
  () =>
    fetchModerationNotices(
      { created_at: 'bad', id: f.moderationActor },
      undefined,
      f.moderationActor,
    ),
  () =>
    reportCommunityTarget(
      { ...f.moderationReportInput, reason: '' },
      undefined,
      f.moderationActor,
    ),
  () =>
    resolveModerationReport(
      { ...f.moderationResolveInput, expected_revision: 0 },
      undefined,
      f.moderationActor,
    ),
  () =>
    restrictModerationUser(
      { ...f.moderationRestrictInput, restricted: false },
      undefined,
      f.moderationActor,
    ),
])('invalid input %# is rejected without transport', async (call) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await call()).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['queue', 'notices'])(
  '%s rejects result not below exact cursor',
  async (kind) => {
    const cursor = { created_at: f.moderationTime, id: f.moderationActor },
      call = kind === 'queue' ? fetchModerationQueue : fetchModerationNotices;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response(
            ok(kind === 'queue' ? f.moderationQueue : f.moderationNotices),
          ),
        ),
    );
    expect(await call(cursor, undefined, f.moderationActor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
