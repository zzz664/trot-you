// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { scheduleNoticeHttp } from '@/server/schedule-notices/http';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { SCHEDULES, SCHEDULE_ERROR_STATUS } from '@/config/schedules';
import {
  scheduleNoticeState,
  scheduleNoticeEventState,
  scheduleNoticeActor,
  scheduleNoticeEvent,
} from './schedule-notices-preferences-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  preferences: vi.fn(),
  setPreference: vi.fn(),
  setEvent: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/schedule-notice-preferences', () => ({
  createScheduleNoticePreferencePort: mocks.port,
}));
function request(
  query = '',
  method = 'GET',
  body?: unknown,
  origin: string | null = 'https://app.example',
  actor = scheduleNoticeActor,
) {
  return new NextRequest(`https://app.example/api/schedule-notices${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      [SCHEDULES.actorHeader]: actor,
      ...(origin ? { origin } : {}),
    },
  });
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
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: {
      id: scheduleNoticeActor,
      role: 'fan',
      is_restricted: false,
      onboarding_completed_at: '2026-01-01',
    },
  });
  mocks.port.mockReturnValue(mocks);
  mocks.preferences.mockResolvedValue({ ok: true, data: scheduleNoticeState });
  mocks.setPreference.mockResolvedValue({
    ok: true,
    data: scheduleNoticeState,
  });
  mocks.setEvent.mockResolvedValue({
    ok: true,
    data: scheduleNoticeEventState,
  });
});
it('returns owner-only current preference with private no-store headers', async () => {
  const r = await scheduleNoticeHttp(request(), 'read');
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, data: scheduleNoticeState });
  expect(mocks.preferences).toHaveBeenCalledExactlyOnceWith(null);
  for (const [k, v] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(r.headers.get(k)).toBe(v);
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
});
it('returns requested event preference without actor input', async () => {
  mocks.preferences.mockResolvedValue({
    ok: true,
    data: scheduleNoticeEventState,
  });
  expect(
    (await scheduleNoticeHttp(request(`?id=${scheduleNoticeEvent}`), 'read'))
      .status,
  ).toBe(200);
  expect(mocks.preferences).toHaveBeenCalledExactlyOnceWith(
    scheduleNoticeEvent,
  );
});
it.each([true, false])(
  'saves explicit desired global and event %s',
  async (enabled) => {
    mocks.setPreference.mockResolvedValue({
      ok: true,
      data: { ...scheduleNoticeState, scheduleEnabled: enabled },
    });
    mocks.setEvent.mockResolvedValue({
      ok: true,
      data: { ...scheduleNoticeEventState, eventEnabled: enabled },
    });
    expect(
      (await scheduleNoticeHttp(request('', 'POST', { enabled }), 'preference'))
        .status,
    ).toBe(200);
    expect(mocks.setPreference).toHaveBeenCalledExactlyOnceWith(enabled);
    expect(
      (
        await scheduleNoticeHttp(
          request('', 'POST', { scheduleId: scheduleNoticeEvent, enabled }),
          'event',
        )
      ).status,
    ).toBe(200);
    expect(mocks.setEvent).toHaveBeenCalledExactlyOnceWith(
      scheduleNoticeEvent,
      enabled,
    );
  },
);
it.each(['?id=bad', '?id=', '?id=x&id=y', '?actorId=other', '?month=2026-10'])(
  'rejects malformed query %s',
  async (query) => {
    expect((await scheduleNoticeHttp(request(query), 'read')).status).toBe(400);
    expect(mocks.preferences).not.toHaveBeenCalled();
  },
);
it.each(['preference', 'event'] as const)(
  'rejects missing/cross-origin %s writes',
  async (action) => {
    for (const origin of [
      null,
      'https://evil.example',
      'null',
      'https://app.example.evil',
    ])
      expect(
        (
          await scheduleNoticeHttp(
            request('', 'POST', { enabled: true }, origin),
            action,
          )
        ).status,
      ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(['preference', 'event'] as const)(
  'rejects query and nonPOST %s writes',
  async (action) => {
    expect(
      (
        await scheduleNoticeHttp(
          request('?x=1', 'POST', { enabled: true }),
          action,
        )
      ).status,
    ).toBe(400);
    expect((await scheduleNoticeHttp(request(), action)).status).toBe(400);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it('rejects unknown mutation fields, nulls and malformed event identifiers', async () => {
  for (const body of [
    { enabled: true, actorId: 'other' },
    { enabled: 'true' },
    {},
  ])
    expect(
      (await scheduleNoticeHttp(request('', 'POST', body), 'preference'))
        .status,
    ).toBe(400);
  for (const body of [
    { scheduleId: 'bad', enabled: true },
    { scheduleId: scheduleNoticeEvent, enabled: null },
    { scheduleId: scheduleNoticeEvent, enabled: true, other: 1 },
  ])
    expect(
      (await scheduleNoticeHttp(request('', 'POST', body), 'event')).status,
    ).toBe(400);
  expect(mocks.setPreference).not.toHaveBeenCalled();
  expect(mocks.setEvent).not.toHaveBeenCalled();
});
it.each(['read', 'preference', 'event'] as const)(
  'rejects mounted account switch for %s before database mutation',
  async (action) => {
    const r = await scheduleNoticeHttp(
      request(
        '',
        action === 'read' ? 'GET' : 'POST',
        action === 'read' ? undefined : { enabled: true },
        'https://app.example',
        scheduleNoticeEvent,
      ),
      action,
    );
    expect(r.status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(['anonymous', 'unavailable', 'unconfigured'])(
  'handles %s session without preference access',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect((await scheduleNoticeHttp(request(), 'read')).status).toBe(
      status === 'unavailable' ? 503 : 401,
    );
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each([{ is_restricted: true }, { onboarding_completed_at: null }])(
  'rejects restricted/incomplete fan %#',
  async (override) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: {
        id: scheduleNoticeActor,
        role: 'fan',
        is_restricted: false,
        onboarding_completed_at: '2026-01-01',
        ...override,
      },
    });
    expect((await scheduleNoticeHttp(request(), 'read')).status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each(Object.entries(SCHEDULE_ERROR_STATUS))(
  'maps %s safe service error',
  async (code, status) => {
    mocks.preferences.mockResolvedValue({ ok: false, code });
    const r = await scheduleNoticeHttp(request(), 'read');
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ ok: false, code });
  },
);
it('fails absent setup and exceptions without private details', async () => {
  mocks.context.mockReturnValue({ apply: (r: Response) => r });
  expect((await scheduleNoticeHttp(request(), 'read')).status).toBe(503);
  mocks.context.mockReturnValue({
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => r,
  });
  mocks.session.mockRejectedValue(new Error('private'));
  const r = await scheduleNoticeHttp(request(), 'read');
  expect(await r.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});

it.each(['admin', 'artist'])(
  'rejects non-fan %s before preference access',
  async (role) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: {
        id: scheduleNoticeActor,
        role,
        is_restricted: false,
        onboarding_completed_at: '2026-01-01',
      },
    });
    expect((await scheduleNoticeHttp(request(), 'read')).status).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
