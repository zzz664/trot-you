// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import {
  ATTENDANCE_POINTS,
  POINTS_ERROR_STATUS,
} from '@/config/attendance-points';
import {
  attendancePointsHttp,
  type AttendancePointsAction,
} from '@/server/attendance-points/http';
import * as f from './attendance-points-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  snapshot: vi.fn(),
  attend: vi.fn(),
  analyticsPort: vi.fn(),
  observe: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/attendance-points', () => ({
  createAttendancePointsPort: mocks.port,
}));
vi.mock('@/server/attendance-points/analytics', () => ({
  getAttendanceAnalyticsPort: mocks.analyticsPort,
}));
vi.mock('@/server/services/attendance-points/analytics', () => ({
  recordAttendanceObservation: mocks.observe,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: f.pointsActor,
      role: 'fan',
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
  action: AttendancePointsAction,
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
  const method = options.method ?? (action === 'snapshot' ? 'GET' : 'POST');
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  return new NextRequest(
    `https://app.example/api/points${options.query ?? ''}`,
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
              [ATTENDANCE_POINTS.actorHeader]: options.actor ?? f.pointsActor,
            }),
      },
    },
  );
}
const cases = [
  ['snapshot', undefined, f.pointSnapshot],
  ['attend', f.attendanceInput, f.attendanceReceipt],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.analyticsPort.mockReturnValue(null);
  mocks.observe.mockResolvedValue({ ok: false, code: 'SETUP_NOT_READY' });
  mocks.context.mockReturnValue(baseContext());
  mocks.session.mockResolvedValue(state());
  mocks.port.mockReturnValue({
    snapshot: mocks.snapshot,
    attend: mocks.attend,
  });
  mocks.snapshot.mockResolvedValue({ ok: true, data: f.pointSnapshot });
  mocks.attend.mockResolvedValue({ ok: true, data: f.attendanceReceipt });
});
afterEach(() => vi.useRealTimers());
it.each(cases)(
  '%s applies current identity, nosniff and private headers',
  async (action, body, data) => {
    const response = await attendancePointsHttp(
      request(action, { body }),
      action,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
    for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
      expect(response.headers.get(key)).toBe(value);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('vary')).toBe(
      `Cookie, ${ATTENDANCE_POINTS.actorHeader}`,
    );
  },
);
for (const [action, body] of cases) {
  it.each([f.pointsOther, 'bad', null])(
    `${action} rejects absent/wrong expected identity %#`,
    async (actor) => {
      expect(
        (await attendancePointsHttp(request(action, { body, actor }), action))
          .status,
      ).toBe(403);
      expect(mocks[action]).not.toHaveBeenCalled();
    },
  );
  it.each([
    { is_restricted: true, restricted_until: null },
    { is_restricted: true, restricted_until: '2099-01-01T00:00:00Z' },
    { is_restricted: true, restricted_until: 'bad' },
    { onboarding_completed_at: null },
  ])(
    `${action} rejects restriction/incomplete onboarding %#`,
    async (extra) => {
      mocks.session.mockResolvedValue(state(extra));
      expect(
        (await attendancePointsHttp(request(action, { body }), action)).status,
      ).toBe(403);
      expect(mocks[action]).not.toHaveBeenCalled();
    },
  );
  it.each(['artist', 'admin'])(
    `${action} permits unrestricted %s without fan onboarding`,
    async (role) => {
      mocks.session.mockResolvedValue(
        state({ role, onboarding_completed_at: null }),
      );
      expect(
        (await attendancePointsHttp(request(action, { body }), action)).status,
      ).toBe(200);
    },
  );
  it(`${action} permits expired restriction`, async () => {
    mocks.session.mockResolvedValue(
      state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
    );
    expect(
      (await attendancePointsHttp(request(action, { body }), action)).status,
    ).toBe(200);
  });
  it.each([
    ['anonymous', 401],
    ['unconfigured', 401],
    ['unavailable', 503],
  ] as const)(`${action} denies %s session`, async (status, expected) => {
    mocks.session.mockResolvedValue({ status });
    expect(
      (await attendancePointsHttp(request(action, { body }), action)).status,
    ).toBe(expected);
    expect(mocks[action]).not.toHaveBeenCalled();
  });
  it.each(['configuration', 'client', 'port'] as const)(
    `${action} fails closed without %s`,
    async (key) => {
      mocks.context.mockReturnValue({ ...baseContext(), [key]: null });
      expect(
        (await attendancePointsHttp(request(action, { body }), action)).status,
      ).toBe(503);
      expect(mocks.session).not.toHaveBeenCalled();
      expect(mocks[action]).not.toHaveBeenCalled();
    },
  );
  it(`${action} rejects unexpected query parameters`, async () => {
    expect(
      (
        await attendancePointsHttp(
          request(action, { body, query: '?user_id=other' }),
          action,
        )
      ).status,
    ).toBe(400);
    expect(mocks[action]).not.toHaveBeenCalled();
  });
  it.each(Object.entries(POINTS_ERROR_STATUS))(
    `${action} translates safe %s status`,
    async (code, status) => {
      mocks[action].mockResolvedValue({ ok: false, code });
      const response = await attendancePointsHttp(
        request(action, { body }),
        action,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
    },
  );
  it(`${action} conceals session failure`, async () => {
    mocks.session.mockRejectedValue(new Error('private session'));
    const response = await attendancePointsHttp(
      request(action, { body }),
      action,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it(`${action} conceals DB failure`, async () => {
    mocks[action].mockRejectedValue(new Error('private SQL'));
    const response = await attendancePointsHttp(
      request(action, { body }),
      action,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
}
it.each([
  null,
  'https://evil.example',
  'https://app.example.evil',
  'http://app.example',
  'https://app.example/path',
  'null',
])('rejects non-exact write origin %s', async (origin) => {
  expect(
    (
      await attendancePointsHttp(
        request('attend', { body: f.attendanceInput, origin }),
        'attend',
      )
    ).status,
  ).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.attend).not.toHaveBeenCalled();
});
it('read origin may be absent because it never mutates points', async () => {
  expect(
    (
      await attendancePointsHttp(
        request('snapshot', { origin: null }),
        'snapshot',
      )
    ).status,
  ).toBe(200);
  expect(mocks.attend).not.toHaveBeenCalled();
});
it.each([
  '?cursor=',
  '?cursor=%7B',
  '?cursor=a&cursor=b',
  '?cursor=%7B%22user_id%22%3A%22other%22%7D',
])('rejects invalid read cursor %s', async (query) => {
  expect(
    (await attendancePointsHttp(request('snapshot', { query }), 'snapshot'))
      .status,
  ).toBe(400);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it('forwards a valid cursor without timestamp truncation', async () => {
  const cursor = {
    id: f.pointEntry.id,
    created_at: '2026-10-26T06:00:00.123457Z',
  };
  expect(
    (
      await attendancePointsHttp(
        request('snapshot', {
          query: `?${new URLSearchParams({ cursor: JSON.stringify(cursor) })}`,
        }),
        'snapshot',
      )
    ).status,
  ).toBe(200);
  expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith(cursor);
});
it('rejects mutation cursor rather than mixing read and write parameters', async () => {
  expect(
    (
      await attendancePointsHttp(
        request('attend', { body: f.attendanceInput, query: '?cursor=null' }),
        'attend',
      )
    ).status,
  ).toBe(400);
  expect(mocks.attend).not.toHaveBeenCalled();
});
it.each([
  {},
  null,
  [],
  { operation_id: 'bad' },
  { ...f.attendanceInput, amount: 999 },
  { ...f.attendanceInput, user_id: f.pointsOther },
  { ...f.attendanceInput, earned_on: '2026-01-01' },
])('rejects invalid mutation body %#', async (body) => {
  expect(
    (await attendancePointsHttp(request('attend', { body }), 'attend')).status,
  ).toBe(400);
  expect(mocks.attend).not.toHaveBeenCalled();
});
it.each([
  { rawBody: '{' },
  { rawBody: new Uint8Array([0xff]) },
  { body: f.attendanceInput, contentType: 'text/plain' },
  { rawBody: ' '.repeat(ATTENDANCE_POINTS.bodyLimit + 1) },
])('rejects malformed transport body %#', async (options) => {
  expect(
    (await attendancePointsHttp(request('attend', options), 'attend')).status,
  ).toBe(400);
  expect(mocks.attend).not.toHaveBeenCalled();
});
it('rejects missing body', async () => {
  expect((await attendancePointsHttp(request('attend'), 'attend')).status).toBe(
    400,
  );
  expect(mocks.attend).not.toHaveBeenCalled();
});
it.each([
  ['snapshot', 'POST'],
  ['attend', 'PUT'],
] as const)('rejects wrong method for %s', async (action, method) => {
  expect(
    (await attendancePointsHttp(request(action, { method }), action)).status,
  ).toBe(400);
  expect(mocks.session).not.toHaveBeenCalled();
});
it('forwards incoming cookies through the auth context only', async () => {
  const req = request('snapshot');
  req.cookies.set('private-session', 'opaque');
  await attendancePointsHttp(req, 'snapshot');
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith([
    { name: 'private-session', value: 'opaque' },
  ]);
});
it('bounds slow request bodies and cancels without starting a mutation', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ cancel });
  const req = request('attend');
  Object.defineProperty(req, 'body', { value: stream });
  const pending = attendancePointsHttp(req, 'attend');
  await vi.advanceTimersByTimeAsync(ATTENDANCE_POINTS.bodyTimeoutMs + 1);
  const response = await pending;
  expect(response.status).toBe(400);
  expect(cancel).toHaveBeenCalledOnce();
  expect(mocks.attend).not.toHaveBeenCalled();
});

it('records optional analytics only after a verified attendance commit', async () => {
  const observer = { record: vi.fn() };
  mocks.analyticsPort.mockReturnValue(observer);
  const response = await attendancePointsHttp(
    request('attend', { body: f.attendanceInput }),
    'attend',
  );
  expect(await response.json()).toEqual({
    ok: true,
    data: f.attendanceReceipt,
  });
  expect(mocks.observe).toHaveBeenCalledExactlyOnceWith(observer, {
    actor_id: f.pointsActor,
    entry_id: f.attendanceReceipt.entry_id,
  });
});
it.each(['SETUP_NOT_READY', 'CONSENT_REQUIRED', 'UNAVAILABLE'])(
  'optional %s observation never replaces the immutable receipt',
  async (code) => {
    mocks.observe.mockResolvedValue({ ok: false, code });
    const response = await attendancePointsHttp(
      request('attend', { body: f.attendanceInput }),
      'attend',
    );
    expect(await response.json()).toEqual({
      ok: true,
      data: f.attendanceReceipt,
    });
  },
);
it('history reads and failed attendance do not trigger analytics', async () => {
  await attendancePointsHttp(request('snapshot'), 'snapshot');
  mocks.attend.mockResolvedValue({ ok: false, code: 'SETUP_NOT_READY' });
  await attendancePointsHttp(
    request('attend', { body: f.attendanceInput }),
    'attend',
  );
  expect(mocks.observe).not.toHaveBeenCalled();
  expect(mocks.analyticsPort).not.toHaveBeenCalled();
});
it('same-day new operations observe the same ledger entry, not another event', async () => {
  await attendancePointsHttp(
    request('attend', { body: f.attendanceInput }),
    'attend',
  );
  const nextInput = { operation_id: f.pointsOther };
  mocks.attend.mockResolvedValue({
    ok: true,
    data: { ...f.attendanceReceipt, ...nextInput },
  });
  await attendancePointsHttp(request('attend', { body: nextInput }), 'attend');
  expect(mocks.observe.mock.calls[0]).toEqual(mocks.observe.mock.calls[1]);
});

it('unexpected observer or bootstrap failure never hides the committed attendance receipt', async () => {
  mocks.observe.mockRejectedValue(new Error('private observer failure'));
  const first = await attendancePointsHttp(
    request('attend', { body: f.attendanceInput }),
    'attend',
  );
  expect(await first.json()).toEqual({ ok: true, data: f.attendanceReceipt });
  mocks.analyticsPort.mockImplementation(() => {
    throw new Error('private bootstrap failure');
  });
  const second = await attendancePointsHttp(
    request('attend', { body: f.attendanceInput }),
    'attend',
  );
  expect(await second.json()).toEqual({ ok: true, data: f.attendanceReceipt });
});
