import { readFileSync } from 'node:fs';
import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
} from '@playwright/test';
import { SCHEDULE_NOTICES_CI_ENV } from '../../../scripts/schedule-notices-local-config.mjs';
import { SCHEDULES } from '../../../src/config/schedules';
import { scheduleNoticeStateSchema } from '../../../src/config/schedule-notices';
import {
  routes,
  scheduleDetailPath,
  scheduleListPath,
} from '../../../src/config/routes';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import {
  test,
  expect,
  appOrigin,
  blockExternal,
  expectNoExternal,
  localSql,
  uuid,
  setFont,
  setRole,
  setRestricted,
  screenshot,
  assertRenderedScale,
  preparePolicies,
  preferences,
  jobs,
  registerDevice,
  type Identity,
  type World,
  type Scale,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.scheduleNotices;
const main = (page: Page) => page.getByRole('main');
const controls = (page: Page) =>
  main(page).getByTestId('schedule-notice-controls');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const headers = (actor: Identity) => ({
  Origin: appOrigin,
  [SCHEDULES.actorHeader]: actor.id,
});
const statusPath = (id?: string) =>
  id ? `${routes.scheduleNoticeStatus}?id=${id}` : routes.scheduleNoticeStatus;
async function success(
  response: Pick<APIResponse, 'status' | 'headers' | 'json'>,
  actorResponse = true,
) {
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  if (actorResponse)
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const body: { ok: boolean; data: unknown } = await response.json();
  expect(body.ok).toBe(true);
  return body.data;
}
async function failure(
  response: Pick<APIResponse, 'status' | 'headers' | 'json'>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}
async function read(request: APIRequestContext, actor: Identity, id?: string) {
  return scheduleNoticeStateSchema.parse(
    await success(
      await request.get(statusPath(id), { headers: headers(actor) }),
    ),
  );
}
async function preference(
  request: APIRequestContext,
  actor: Identity,
  enabled: boolean,
) {
  return scheduleNoticeStateSchema.parse(
    await success(
      await request.post(routes.scheduleNoticePreference, {
        headers: headers(actor),
        data: { enabled },
      }),
    ),
  );
}
async function eventPreference(
  request: APIRequestContext,
  actor: Identity,
  scheduleId: string,
  enabled: boolean,
) {
  return scheduleNoticeStateSchema.parse(
    await success(
      await request.post(routes.scheduleNoticeEvent, {
        headers: headers(actor),
        data: { scheduleId, enabled },
      }),
    ),
  );
}
async function list(page: Page, world: World) {
  await page.goto(scheduleListPath(world.month));
  await expect(page).toHaveURL(scheduleListPath(world.month));
  await expect(
    main(page).getByRole('heading', {
      name: messages.schedules.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(controls(page)).toBeVisible();
  await expect(
    controls(page).locator('[data-schedule-preference]'),
  ).toHaveCount(1);
}
async function detail(page: Page, world: World, event = world.event) {
  const path = scheduleDetailPath(event.id, world.month);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(
    main(page).getByRole('heading', { name: event.title, exact: true }),
  ).toBeVisible();
  await expect(controls(page)).toBeVisible();
  await expect(
    controls(page).locator('[data-schedule-event-enabled]'),
  ).toHaveCount(1);
}
async function state(
  page: Page,
  scheduleEnabled: boolean,
  eventEnabled?: boolean,
) {
  await expect(
    controls(page).locator('[data-schedule-preference]'),
  ).toHaveAttribute('data-schedule-preference', String(scheduleEnabled));
  if (eventEnabled !== undefined)
    await expect(
      controls(page).locator('[data-schedule-event-enabled]'),
    ).toHaveAttribute('data-schedule-event-enabled', String(eventEnabled));
}
async function captureControl(
  page: Page,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await controls(page).scrollIntoViewIfNeeded();
  await expect(controls(page)).toBeVisible();
  await controls(page).screenshot({ path: info.outputPath(`${name}.png`) });
}
const invoke = (request: APIRequestContext) =>
  request.post(routes.notifySchedulesCron, {
    headers: {
      Authorization: `Bearer ${SCHEDULE_NOTICES_CI_ENV.SCHEDULE_NOTICES_CRON_SECRET}`,
    },
  });

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('actual owner-only preferences preserve independent choices and explicit event replay never blind-toggles', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  expect(await read(context.request, world.fan)).toMatchObject({
    scheduleEnabled: false,
    eventEnabled: null,
    eligible: null,
    webpushEnabled: false,
    configured: true,
    hourKst: 0,
  });
  const actor = await world.fan.actorClient();
  expect(
    (
      await actor.rpc('notification_set_preferences', {
        p_webpush_enabled: false,
        p_new_message: true,
        p_billing: true,
        p_schedule: false,
      })
    ).error,
  ).toBeNull();
  expect(
    (await preference(context.request, world.fan, true)).scheduleEnabled,
  ).toBe(true);
  expect(preferences(world.fan)).toMatchObject({
    webpush_enabled: false,
    new_message: true,
    billing: true,
    schedule: true,
  });
  const initial = await read(context.request, world.fan, world.event.id);
  expect(initial).toMatchObject({
    scheduleEnabled: true,
    eventEnabled: true,
    eligible: true,
  });
  for (let count = 0; count < 3; count++)
    expect(
      (await eventPreference(context.request, world.fan, world.event.id, false))
        .eventEnabled,
    ).toBe(false);
  expect(
    localSql(
      `select count(*) from public.schedule_notification_optouts where user_id='${uuid(world.fan.id)}' and schedule_id='${uuid(world.event.id)}';`,
    ),
  ).toBe('1');
  for (let count = 0; count < 2; count++)
    expect(
      (await eventPreference(context.request, world.fan, world.event.id, true))
        .eventEnabled,
    ).toBe(true);
  expect(
    localSql(
      `select count(*) from public.schedule_notification_optouts where user_id='${uuid(world.fan.id)}' and schedule_id='${uuid(world.event.id)}';`,
    ),
  ).toBe('0');
  expect(
    (await preference(context.request, world.fan, false)).scheduleEnabled,
  ).toBe(false);
  expect(preferences(world.fan)).toMatchObject({
    webpush_enabled: false,
    new_message: true,
    billing: true,
    schedule: false,
  });
  await world.other.signIn(context);
  expect(
    await read(context.request, world.other, world.event.id),
  ).toMatchObject({
    scheduleEnabled: false,
    eventEnabled: true,
    eligible: false,
  });
  expect(JSON.stringify(initial)).not.toMatch(
    /user_id|call_name|email|phone|endpoint|auth_session|subscription_id|provider/,
  );
});

test('protected worker selects tomorrow KST only and queues once without provider, delivery receipt or payment effects', async ({
  world,
  context,
  request,
}) => {
  await registerDevice(world.fan);
  await world.fan.signIn(context);
  await preference(context.request, world.fan, true);
  expect(jobs(world)).toEqual([]); // Publishing does not bypass the notice worker.
  const before = localSql(
    `select json_build_object('payments',(select count(*) from public.payment_events),'attempts',(select count(*) from private.notification_attempts));`,
  );
  await failure(
    await request.post(routes.notifySchedulesCron),
    401,
    'UNAUTHORIZED',
  );
  const first = await success(await invoke(request), false);
  expect(first).toMatchObject({ pushJobsQueued: 2, failed: 0 });
  expect(JSON.stringify(first)).not.toMatch(
    /delivered|displayed|notified|endpoint|허구/,
  );
  const queued = jobs(world);
  expect(queued.map((row) => row.sourceId).sort()).toEqual(
    [world.event.id, world.another.id].sort(),
  );
  expect(queued.every((row) => row.state === 'queued')).toBe(true);
  const replay = await success(await invoke(request), false);
  expect(replay).toMatchObject({ pushJobsQueued: 0, failed: 0 });
  expect(jobs(world)).toEqual(queued);
  expect(
    localSql(
      `select json_build_object('payments',(select count(*) from public.payment_events),'attempts',(select count(*) from private.notification_attempts));`,
    ),
  ).toBe(before);
});

test('current event/global opt-outs cancel queued jobs and re-enabling cannot revive canceled deliveries', async ({
  world,
  context,
  request,
}) => {
  await registerDevice(world.fan);
  await world.fan.signIn(context);
  await preference(context.request, world.fan, true);
  await eventPreference(context.request, world.fan, world.another.id, false);
  await success(await invoke(request), false);
  expect(jobs(world).map((row) => row.sourceId)).toEqual([world.event.id]);
  await eventPreference(context.request, world.fan, world.event.id, false);
  expect(jobs(world)).toEqual([
    expect.objectContaining({
      sourceId: world.event.id,
      state: 'canceled',
      cancellationRequestedAt: expect.any(String),
    }),
  ]);
  await eventPreference(context.request, world.fan, world.event.id, true);
  await success(await invoke(request), false);
  expect(jobs(world)).toHaveLength(1);
  expect(jobs(world)[0]!.state).toBe('canceled');
  await eventPreference(context.request, world.fan, world.another.id, true);
  await success(await invoke(request), false);
  expect(
    jobs(world).find((row) => row.sourceId === world.another.id)?.state,
  ).toBe('queued');
  await preference(context.request, world.fan, false);
  expect(jobs(world).every((row) => row.state === 'canceled')).toBe(true);
  await preference(context.request, world.fan, true);
  await success(await invoke(request), false);
  expect(jobs(world).every((row) => row.state === 'canceled')).toBe(true);
});

test('actor headers, CSRF, malformed bodies and undisclosed events fail closed without another account writes', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  for (const path of [statusPath(), statusPath(world.event.id)])
    await failure(
      await context.request.get(path, { headers: headers(world.other) }),
      403,
      'FORBIDDEN',
    );
  for (const path of [
    routes.scheduleNoticePreference,
    routes.scheduleNoticeEvent,
  ]) {
    const data =
      path === routes.scheduleNoticePreference
        ? { enabled: true }
        : { scheduleId: world.event.id, enabled: false };
    await failure(
      await context.request.post(path, { headers: headers(world.other), data }),
      403,
      'FORBIDDEN',
    );
    await failure(
      await context.request.post(path, {
        headers: { ...headers(world.fan), Origin: 'https://outside.invalid' },
        data,
      }),
      403,
      'FORBIDDEN',
    );
    await failure(
      await context.request.post(path, {
        headers: headers(world.fan),
        data: { ...data, userId: world.other.id },
      }),
      400,
      'INVALID_INPUT',
    );
  }
  for (const query of [
    'id=bad',
    `id=${world.event.id}&id=${world.another.id}`,
    'userId=other',
  ])
    await failure(
      await context.request.get(`${routes.scheduleNoticeStatus}?${query}`, {
        headers: headers(world.fan),
      }),
      400,
      'INVALID_INPUT',
    );
  await failure(
    await context.request.get(statusPath(world.draft.id), {
      headers: headers(world.fan),
    }),
    404,
    'NOT_FOUND',
  );
  await failure(
    await context.request.post(routes.scheduleNoticeEvent, {
      headers: headers(world.fan),
      data: { scheduleId: world.draft.id, enabled: false },
    }),
    404,
    'NOT_FOUND',
  );
  expect(preferences(world.other)).toBeNull();
  await context.clearCookies();
  await failure(
    await context.request.get(statusPath()),
    401,
    'UNAUTHENTICATED',
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: global and per-event controls, offscreen actions, exact navigation and interests-only eligibility`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        if (typeof Notification !== 'undefined')
          Object.defineProperty(Notification, 'requestPermission', {
            configurable: true,
            value: () => {
              throw new Error(
                'This control does not authorize browser permission.',
              );
            },
          });
      });
      await list(page, world);
      await state(page, false);
      await screenshot(page, info, `list-initial-${scale}-${width}`, scale);
      await captureControl(
        page,
        info,
        `list-controls-offscreen-${scale}-${width}`,
        scale,
      );
      await button(controls(page), copy.enablePreference).click();
      await state(page, true);
      await captureControl(page, info, `list-enabled-${scale}-${width}`, scale);
      await detail(page, world);
      await state(page, true, true);
      await screenshot(page, info, `detail-initial-${scale}-${width}`, scale);
      await captureControl(
        page,
        info,
        `detail-controls-offscreen-${scale}-${width}`,
        scale,
      );
      await button(controls(page), copy.disableEvent).click();
      await state(page, true, false);
      await captureControl(
        page,
        info,
        `event-disabled-${scale}-${width}`,
        scale,
      );
      await button(controls(page), copy.enableEvent).click();
      await state(page, true, true);
      await button(controls(page), copy.disablePreference).click();
      await state(page, false, true);
      await captureControl(
        page,
        info,
        `global-disabled-event-kept-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: messages.schedules.backList, exact: true })
        .click();
      await expect(page).toHaveURL(scheduleListPath(world.month));
      await expect(
        main(page).getByRole('heading', {
          name: messages.schedules.title,
          exact: true,
        }),
      ).toBeVisible();
      await state(page, false);
      await page.goBack();
      await expect(page).toHaveURL(
        scheduleDetailPath(world.event.id, world.month),
      );
      await expect(
        main(page).getByRole('heading', {
          name: world.event.title,
          exact: true,
        }),
      ).toBeVisible();
      await state(page, false, true);
      await captureControl(
        page,
        info,
        `back-restored-${scale}-${width}`,
        scale,
      );
      await page.goForward();
      await expect(page).toHaveURL(scheduleListPath(world.month));
      await state(page, false);
      await detail(page, world, world.unrelatedEvent);
      await state(page, false, true);
      expect(
        (await read(context.request, world.fan, world.unrelatedEvent.id))
          .eligible,
      ).toBe(false);
      await captureControl(
        page,
        info,
        `interest-only-${scale}-${width}`,
        scale,
      );
      expect(jobs(world)).toEqual([]);
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  test(`${scale} 360: interrupted status load, scoped error, retry and restoration clear stale state`, async ({
    world,
    context,
    page,
  }, info) => {
    setFont(world.fan, scale);
    await world.fan.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      `**${routes.scheduleNoticeStatus}`,
      async (route) => {
        await gate;
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.goto(scheduleListPath(world.month));
    await expect(controls(page).getByRole('status')).toHaveText(copy.loading);
    await captureControl(page, info, `loading-${scale}-360`, scale);
    release();
    await expect(controls(page).getByRole('alert')).toHaveText(
      copy.errors.UNAVAILABLE,
    );
    await expect(
      controls(page).locator('[data-schedule-preference]'),
    ).toHaveCount(0);
    await captureControl(page, info, `load-error-${scale}-360`, scale);
    await button(controls(page), messages.ui.retry).click();
    await state(page, false);
    await button(controls(page), copy.enablePreference).click();
    await state(page, true);
    await captureControl(page, info, `retry-enabled-${scale}-360`, scale);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true }),
      ),
    );
    await expect(
      controls(page).locator('[data-schedule-preference]'),
    ).toHaveCount(0);
    await preference(context.request, world.fan, false);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    );
    await state(page, false);
    await captureControl(page, info, `restore-revalidated-${scale}-360`, scale);
  });

test('lost mutation response is recoverable by fresh read and repeated clicks issue one explicit state write', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await detail(page, world);
  await state(page, false, true);
  const writes: unknown[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**${routes.scheduleNoticeEvent}`,
    async (route) => {
      writes.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await gate;
      await route.abort('connectionreset');
    },
    { times: 1 },
  );
  await button(controls(page), copy.disableEvent).click();
  await expect(button(controls(page), copy.disableEvent)).toBeDisabled();
  await button(controls(page), copy.disableEvent).evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([{ scheduleId: world.event.id, enabled: false }]);
  release();
  await expect(controls(page).getByRole('alert')).toHaveText(
    copy.errors.UNAVAILABLE,
  );
  await captureControl(page, info, 'lost-response-xlarge-360', 'xlarge');
  await button(controls(page), messages.ui.retry).click();
  await state(page, false, false);
  expect(writes).toHaveLength(1);
  await captureControl(
    page,
    info,
    'lost-response-recovered-xlarge-360',
    'xlarge',
  );
});

test('same-tab account switch rejects the mounted actor and never applies its pending choice to the new account', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  setFont(world.other, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await list(page, world);
  await state(page, false);
  await button(controls(page), copy.enablePreference).click();
  await state(page, true);
  await world.other.signIn(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    controls(page).locator('[data-schedule-preference]'),
  ).toHaveCount(0);
  await expect(button(controls(page), copy.enablePreference)).toHaveCount(0);
  expect(preferences(world.other)).toBeNull();
  await screenshot(
    page,
    info,
    'account-switch-stale-state-cleared-xlarge-360',
    'xlarge',
  );
  await failure(
    await context.request.post(routes.scheduleNoticePreference, {
      headers: headers(world.fan),
      data: { enabled: true },
    }),
    403,
    'FORBIDDEN',
  );
  await page.reload();
  await expect(page).toHaveURL(scheduleListPath(world.month));
  await expect(
    main(page).getByRole('heading', {
      name: messages.schedules.title,
      exact: true,
    }),
  ).toBeVisible();
  await state(page, false);
  await captureControl(
    page,
    info,
    'account-switch-fresh-state-xlarge-360',
    'xlarge',
  );
  expect(preferences(world.fan)?.schedule).toBe(true);
  expect(preferences(world.other)).toBeNull();
});

test('unknown policy is shown honestly, and source withdrawal/session loss removes controls after restore', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  localSql('delete from private.schedule_notice_policy_current;');
  try {
    const unconfigured = await read(context.request, world.fan, world.event.id);
    expect(unconfigured).toMatchObject({ configured: false, hourKst: null });
    await detail(page, world);
    await captureControl(
      page,
      info,
      'policy-unconfigured-xlarge-360',
      'xlarge',
    );
  } finally {
    preparePolicies();
  }
  await page.reload();
  await state(page, false, true);
  localSql(
    `update public.schedules set status='draft' where id='${uuid(world.event.id)}';`,
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  await expect(
    main(page).getByRole('heading', { name: world.event.title, exact: true }),
  ).toHaveCount(0);
  await expect(controls(page)).toHaveCount(0);
  await screenshot(page, info, 'source-withdrawn-xlarge-360', 'xlarge');
  await list(page, world);
  await state(page, false);
  setRestricted(world.fan, true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(controls(page)).toHaveCount(0);
  setRestricted(world.fan, false);
  await page.reload();
  await state(page, false);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(controls(page)).toHaveCount(0);
  await screenshot(page, info, 'session-lost-xlarge-360', 'xlarge');
});

test('accepted but delayed preference result cannot revive the old account after a same-tab switch', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  setFont(world.other, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await list(page, world);
  await state(page, false);
  let entered!: () => void;
  let release!: () => void;
  const accepted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: unknown[] = [];
  await page.route(
    `**${routes.scheduleNoticePreference}`,
    async (route) => {
      expect(
        route.request().headers()[SCHEDULES.actorHeader.toLowerCase()],
      ).toBe(world.fan.id);
      writes.push(route.request().postDataJSON());
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      entered();
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    },
    { times: 1 },
  );
  await button(controls(page), copy.enablePreference).click();
  await accepted;
  await expect(button(controls(page), copy.enablePreference)).toBeDisabled();
  await captureControl(
    page,
    info,
    'pending-account-switch-xlarge-360',
    'xlarge',
  );
  await world.other.signIn(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    main(page).getByText(messages.schedules.errors.FORBIDDEN, { exact: true }),
  ).toBeVisible();
  release();
  await expect(controls(page)).toHaveCount(0);
  expect(writes).toEqual([{ enabled: true }]);
  expect(preferences(world.fan)?.schedule).toBe(true);
  expect(preferences(world.other)).toBeNull();
  await screenshot(
    page,
    info,
    'pending-account-switch-cleared-xlarge-360',
    'xlarge',
  );
  await page.reload();
  await expect(page).toHaveURL(scheduleListPath(world.month));
  await state(page, false);
  await captureControl(
    page,
    info,
    'pending-account-switch-fresh-xlarge-360',
    'xlarge',
  );
  expect(writes).toHaveLength(1);
});

test('late previous-event response cannot replace the newer event eligibility after navigation', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await detail(page, world);
  await state(page, false, true);
  let entered!: () => void;
  let release!: () => void;
  const accepted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**${statusPath(world.event.id)}`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      entered();
      await held;
      await route.fulfill({ response }).catch(() => undefined);
    },
    { times: 1 },
  );
  await button(controls(page), copy.refresh).click();
  await accepted;
  await detail(page, world, world.unrelatedEvent);
  await state(page, false, true);
  await expect(
    controls(page).getByText(copy.notEligible, { exact: true }),
  ).toBeVisible();
  release();
  await expect(page).toHaveURL(
    scheduleDetailPath(world.unrelatedEvent.id, world.month),
  );
  await expect(
    main(page).getByRole('heading', {
      name: world.unrelatedEvent.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: world.event.title, exact: true }),
  ).toHaveCount(0);
  await expect(
    controls(page).getByText(copy.notEligible, { exact: true }),
  ).toBeVisible();
  await captureControl(
    page,
    info,
    'late-event-response-new-navigation-xlarge-360',
    'xlarge',
  );
});

for (const role of ['artist', 'admin'] as const)
  test(`${role}: public list/detail remain viewable without fan controls while forced notice APIs are forbidden`, async ({
    world,
    context,
    page,
  }, info) => {
    setRole(world.other, role);
    setFont(world.other, 'xlarge');
    await world.other.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    const noticeReads: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === routes.scheduleNoticeStatus)
        noticeReads.push(request.url());
    });
    await page.goto(scheduleListPath(world.month));
    await expect(page).toHaveURL(scheduleListPath(world.month));
    await expect(
      main(page).getByRole('heading', {
        name: messages.schedules.title,
        exact: true,
      }),
    ).toBeVisible();
    await expect(main(page).getByTestId('schedule-calendar')).toBeVisible();
    await expect(controls(page)).toHaveCount(0);
    await expect(main(page).getByRole('alert')).toHaveCount(0);
    await screenshot(
      page,
      info,
      `${role}-public-list-no-fan-controls-xlarge-360`,
      'xlarge',
    );
    await page.goto(scheduleDetailPath(world.event.id, world.month));
    await expect(page).toHaveURL(
      scheduleDetailPath(world.event.id, world.month),
    );
    await expect(
      main(page).getByRole('heading', { name: world.event.title, exact: true }),
    ).toBeVisible();
    await expect(controls(page)).toHaveCount(0);
    await expect(main(page).getByRole('alert')).toHaveCount(0);
    await screenshot(
      page,
      info,
      `${role}-public-detail-no-fan-controls-xlarge-360`,
      'xlarge',
    );
    expect(noticeReads).toEqual([]);
    for (const path of [statusPath(), statusPath(world.event.id)])
      await failure(
        await context.request.get(path, { headers: headers(world.other) }),
        403,
        'FORBIDDEN',
      );
    await failure(
      await context.request.post(routes.scheduleNoticePreference, {
        headers: headers(world.other),
        data: { enabled: true },
      }),
      403,
      'FORBIDDEN',
    );
    await failure(
      await context.request.post(routes.scheduleNoticeEvent, {
        headers: headers(world.other),
        data: { scheduleId: world.event.id, enabled: false },
      }),
      403,
      'FORBIDDEN',
    );
    expect(preferences(world.other)).toBeNull();
    expect(
      localSql(
        `select count(*) from public.schedule_notification_optouts where user_id='${uuid(world.other.id)}';`,
      ),
    ).toBe('0');
  });
