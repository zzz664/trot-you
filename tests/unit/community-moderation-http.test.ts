// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  COMMUNITY_POSTS,
  COMMUNITY_ERROR_STATUS,
} from '@/config/community-posts';
import {
  communityModerationHttp,
  type ModerationAction,
} from '@/server/community-moderation/http';
import * as f from './community-moderation-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  contextRead: vi.fn(),
  queue: vi.fn(),
  notices: vi.fn(),
  report: vi.fn(),
  resolve: vi.fn(),
  restrict: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/community-moderation', () => ({
  createCommunityModerationPort: mocks.port,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: f.moderationActor,
      role: 'admin',
      is_restricted: false,
      restricted_until: null,
      onboarding_completed_at: '2026-01-01T00:00:00Z',
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
function request(
  action: ModerationAction,
  options: {
    method?: string;
    query?: string;
    origin?: string | null;
    actor?: string | null;
    body?: unknown;
    rawBody?: string | Uint8Array<ArrayBuffer>;
    contentType?: string;
  } = {},
) {
  const read = ['context', 'queue', 'notices'].includes(action);
  const method = options.method ?? (read ? 'GET' : 'POST');
  const query =
    options.query ??
    (action === 'context'
      ? `?target_type=post&target_id=${f.moderationTarget.target_id}`
      : '');
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new NextRequest(
    `https://app.example/api/community/moderation${query}`,
    {
      method,
      ...(body === undefined ? {} : { body }),
      headers: {
        'Content-Type': options.contentType ?? 'application/json',
        ...(options.origin === null
          ? {}
          : { origin: options.origin ?? 'https://app.example' }),
        ...(options.actor === null
          ? {}
          : {
              [COMMUNITY_POSTS.actorHeader]: options.actor ?? f.moderationActor,
            }),
      },
    },
  );
}
const cases = [
  ['context', undefined, f.moderationContext, 'contextRead'],
  ['queue', undefined, f.moderationQueue, 'queue'],
  ['notices', undefined, f.moderationNotices, 'notices'],
  ['report', f.moderationReportInput, f.moderationReported, 'report'],
  ['resolve', f.moderationResolveInput, f.moderationResolved, 'resolve'],
  ['restrict', f.moderationRestrictInput, f.moderationRestricted, 'restrict'],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue(baseContext());
  mocks.session.mockResolvedValue(state());
  mocks.port.mockReturnValue({
    context: mocks.contextRead,
    queue: mocks.queue,
    notices: mocks.notices,
    report: mocks.report,
    resolve: mocks.resolve,
    restrict: mocks.restrict,
  });
  for (const [, , data, key] of cases)
    mocks[key].mockResolvedValue({ ok: true, data });
});
it.each(cases)(
  '%s applies actor identity and private headers',
  async (action, body, data) => {
    const response = await communityModerationHttp(
      request(action, { body }),
      action,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  },
);
for (const [action, body, , key] of cases) {
  it.each([f.moderationOther, 'bad', null])(
    `${action} rejects wrong or absent expected actor %#`,
    async (actor) => {
      const response = await communityModerationHttp(
        request(action, { body, actor }),
        action,
      );
      expect(response.status).toBe(403);
      expect(mocks[key]).not.toHaveBeenCalled();
    },
  );
  it.each([
    { is_restricted: true, restricted_until: null },
    { is_restricted: true, restricted_until: '2099-01-01T00:00:00Z' },
    { is_restricted: true, restricted_until: 'not-a-date' },
    { role: 'fan', onboarding_completed_at: null },
  ])(
    `${action} rejects active restriction or incomplete fan %#`,
    async (extra) => {
      mocks.session.mockResolvedValue(state(extra));
      const response = await communityModerationHttp(
        request(action, { body }),
        action,
      );
      expect(response.status).toBe(403);
      expect(mocks[key]).not.toHaveBeenCalled();
    },
  );
  it(`${action} accepts expired restriction without modifying the profile`, async () => {
    mocks.session.mockResolvedValue(
      state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
    );
    expect(
      (await communityModerationHttp(request(action, { body }), action)).status,
    ).toBe(200);
  });
  it.each([
    ['anonymous', 401],
    ['unconfigured', 401],
    ['unavailable', 503],
  ] as const)(`${action} treats %s session as %i`, async (status, expected) => {
    mocks.session.mockResolvedValue({ status });
    expect(
      (await communityModerationHttp(request(action, { body }), action)).status,
    ).toBe(expected);
    expect(mocks[key]).not.toHaveBeenCalled();
  });
  it(`${action} rejects unknown query before port IO`, async () => {
    expect(
      (
        await communityModerationHttp(
          request(action, { body, query: '?unexpected=1' }),
          action,
        )
      ).status,
    ).toBe(400);
    expect(mocks[key]).not.toHaveBeenCalled();
  });
  it(`${action} rejects wrong method`, async () => {
    const method = ['context', 'queue', 'notices'].includes(action)
      ? 'POST'
      : 'GET';
    expect(
      (await communityModerationHttp(request(action, { method }), action))
        .status,
    ).toBe(400);
    expect(mocks[key]).not.toHaveBeenCalled();
  });
}
it.each(['queue', 'resolve', 'restrict'] as const)(
  '%s requires current admin',
  async (action) => {
    mocks.session.mockResolvedValue(state({ role: 'artist' }));
    expect(
      (
        await communityModerationHttp(
          request(action, {
            body:
              action === 'resolve'
                ? f.moderationResolveInput
                : action === 'restrict'
                  ? f.moderationRestrictInput
                  : undefined,
          }),
          action,
        )
      ).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(['context', 'report', 'notices'] as const)(
  '%s permits onboarded fan and delegates target visibility to DB',
  async (action) => {
    mocks.session.mockResolvedValue(state({ role: 'fan' }));
    expect(
      (
        await communityModerationHttp(
          request(action, {
            body: action === 'report' ? f.moderationReportInput : undefined,
          }),
          action,
        )
      ).status,
    ).toBe(200);
  },
);
for (const action of ['report', 'resolve', 'restrict'] as const) {
  const body =
    action === 'report'
      ? f.moderationReportInput
      : action === 'resolve'
        ? f.moderationResolveInput
        : f.moderationRestrictInput;
  it.each([
    null,
    'null',
    'http://app.example',
    'https://evil.example',
    'https://app.example.evil',
  ])(`${action} rejects nonmatching Origin %#`, async (origin) => {
    expect(
      (await communityModerationHttp(request(action, { body, origin }), action))
        .status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ...body, actor_id: f.moderationOther }])(
    `${action} rejects malformed or actor-overriding body %#`,
    async (value) => {
      expect(
        (
          await communityModerationHttp(
            request(action, { body: value }),
            action,
          )
        ).status,
      ).toBe(400);
      expect(mocks[action]).not.toHaveBeenCalled();
    },
  );
}
it.each(['?cursor=x&cursor=y', '?cursor={', '?cursor=', '?cursor=%7B%7D'])(
  'rejects ambiguous or invalid cursor %s',
  async (query) => {
    expect(
      (await communityModerationHttp(request('queue', { query }), 'queue'))
        .status,
    ).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
  },
);
it.each([
  '',
  '?target_type=post',
  `?target_type=post&target_id=${f.moderationTarget.target_id}&target_type=reply`,
  '?target_type=user&target_id=bad',
])('rejects malformed target %s', async (query) => {
  expect(
    (await communityModerationHttp(request('context', { query }), 'context'))
      .status,
  ).toBe(400);
  expect(mocks.contextRead).not.toHaveBeenCalled();
});
it('passes exact cursor microseconds without client limit injection', async () => {
  const cursor = {
    created_at: '2099-01-01T00:00:00.000001+00:00',
    id: f.moderationReport.id,
  };
  expect(
    (
      await communityModerationHttp(
        request('queue', {
          query: `?${new URLSearchParams({ cursor: JSON.stringify(cursor) })}`,
        }),
        'queue',
      )
    ).status,
  ).toBe(200);
  expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(cursor);
});
it.each([
  { rawBody: '{' },
  { rawBody: ' '.repeat(COMMUNITY_POSTS.bodyLimit + 1) },
  { rawBody: new Uint8Array([0xff]) },
  { body: f.moderationReportInput, contentType: 'text/plain' },
])('bounded body parser rejects malformed stream %#', async (options) => {
  expect(
    (await communityModerationHttp(request('report', options), 'report'))
      .status,
  ).toBe(400);
  expect(mocks.report).not.toHaveBeenCalled();
});
it.each(['configuration', 'client', 'port'])(
  'missing %s fails closed',
  async (key) => {
    mocks.context.mockReturnValue({ ...baseContext(), [key]: null });
    expect(
      (await communityModerationHttp(request('context'), 'context')).status,
    ).toBe(503);
    expect(mocks.session).not.toHaveBeenCalled();
  },
);
it.each(Object.entries(COMMUNITY_ERROR_STATUS))(
  'maps known %s to %i',
  async (code, status) => {
    mocks.contextRead.mockResolvedValue({ ok: false, code });
    const response = await communityModerationHttp(
      request('context'),
      'context',
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, code });
  },
);
it('session transport failure returns sanitized unavailable', async () => {
  mocks.session.mockRejectedValue(new Error('secret token'));
  const response = await communityModerationHttp(request('context'), 'context');
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
