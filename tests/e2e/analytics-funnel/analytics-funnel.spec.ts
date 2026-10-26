import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import type {
  APIResponse,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test';
import {
  ANALYTICS_FUNNEL,
  analyticsFunnelDashboardSchema,
  type AnalyticsFunnelQuery,
} from '../../../src/config/analytics-funnel';
import {
  AnalyticsEvent,
  type ClientAnalyticsEventInput,
} from '../../../src/config/analytics-events';
import {
  routes,
  analyticsFunnelPath,
  artistPreviewPath,
} from '../../../src/config/routes';
import {
  test,
  expect,
  appOrigin,
  blockExternal,
  expectNoExternal,
  get,
  screenshot,
  assertRenderedScale,
  setFont,
  setRole,
  setRestricted,
  setPolicy,
  removePolicy,
  setConsent,
  analyticsFingerprint,
  unrelatedFingerprint,
  prepareVisiblePreview,
  type Identity,
  type Scale,
  type World,
} from './fixtures';
import {
  ANALYTICS_PREVIEW_ACTOR_HEADER,
  ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE,
  previewAnalyticsSchema,
} from '../../../src/config/analytics';
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.analyticsFunnel;
const main = (page: Page) => page.getByRole('main');
const alert = (page: Page) => main(page).getByRole('alert');
const content = (page: Page) => page.getByTestId('analytics-funnel-content');
const events = (page: Page) => page.locator('[data-analytics-event]');
const days = (page: Page) => page.locator('[data-analytics-day]');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
async function success(
  response: Pick<APIResponse, 'status' | 'headers' | 'json'>,
) {
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const result: { ok: boolean; data: unknown } = await response.json();
  expect(result.ok).toBe(true);
  return result.data;
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
async function snapshot(
  context: BrowserContext,
  actor: Identity,
  query: AnalyticsFunnelQuery,
) {
  return analyticsFunnelDashboardSchema.parse(
    await success(
      await get(context.request, analyticsFunnelPath(query, true), actor),
    ),
  );
}
async function captureArrival(
  page: Page,
  actor: Identity,
  query: AnalyticsFunnelQuery,
) {
  let accept!: () => void, reject!: (error: unknown) => void;
  const result = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) => url.pathname + url.search === analyticsFunnelPath(query, true),
    async (route) => {
      let terminalActionStarted = false;
      try {
        const request = route.request(),
          url = new URL(request.url());
        expect(request.method()).toBe('GET');
        expect(url.pathname + url.search).toBe(
          analyticsFunnelPath(query, true),
        );
        expect(
          request.headers()[ANALYTICS_FUNNEL.actorHeader.toLowerCase()],
        ).toBe(actor.id);
        const response = await route.fetch();
        const data = analyticsFunnelDashboardSchema.parse(
          await success(response),
        );
        expect(data.actor_id).toBe(actor.id);
        expect({ from: data.from, to: data.to }).toEqual(query);
        terminalActionStarted = true;
        await route.fulfill({ response });
        accept();
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Analytics response verification and cleanup failed.',
            );
          }
        }
        reject(failure);
      }
    },
    { times: 1 },
  );
  return { result };
}
async function open(
  page: Page,
  world: World,
  actor: Identity = world.admin,
  query: AnalyticsFunnelQuery = world.range,
) {
  const arrival = await captureArrival(page, actor, query);
  const response = await page.goto(analyticsFunnelPath(query));
  expect(response?.status()).toBe(200);
  await arrival.result;
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(content(page)).toBeVisible();
}
function navigationResponse(page: Page, path: string) {
  return page.waitForResponse((response) => {
    const request = response.request(),
      url = new URL(response.url());
    return (
      url.pathname === path &&
      (request.resourceType() === 'document' || request.headers().rsc === '1')
    );
  });
}
async function refresh(
  page: Page,
  actor: Identity,
  query: AnalyticsFunnelQuery,
) {
  const arrival = await captureArrival(page, actor, query);
  await button(page, copy.refresh).click();
  await arrival.result;
  await expect(content(page)).toBeVisible();
}
async function recordVoice(context: BrowserContext, key = randomUUID()) {
  const data = {
    event_key: key,
    name: AnalyticsEvent.VOICE_INPUT_USED,
    properties: { voice_context: 'reply' },
  } satisfies ClientAnalyticsEventInput;
  return context.request.post(routes.analytics, {
    headers: { Origin: appOrigin },
    data,
  });
}
async function captureControl(
  page: Page,
  target: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await expect(main(page).locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  await target.screenshot({ path: info.outputPath(`${name}.png`) });
}
test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real admin RPC returns only bounded thirteen-event raw aggregates with explicit incomplete coverage and unavailable metrics', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = analyticsFingerprint(world.fan),
    unrelated = unrelatedFingerprint();
  const data = await snapshot(context, world.admin, world.range);
  expect(data.events).toEqual(
    Object.values(AnalyticsEvent).map((name, index) => ({
      name,
      event_count: index + 1,
    })),
  );
  expect(data.daily).toHaveLength(13);
  expect(data.daily.every((row) => row.day_kst === world.range.from)).toBe(
    true,
  );
  expect(data.collection).toEqual({ status: 'enabled', retention_days: 30 });
  expect(data.coverage).toMatchObject({
    history_complete: false,
    mode: 'current_consent_observations',
  });
  expect(data.business_metrics).toEqual({
    configured: false,
    reason: 'definitions_unapproved',
    expected_count: 4,
  });
  expect(Date.parse(data.window_start)).toBe(
    Date.parse(world.range.from) - ANALYTICS_FUNNEL.kstOffsetMs,
  );
  expect(Date.parse(data.window_end)).toBe(
    Date.parse(world.range.to) +
      ANALYTICS_FUNNEL.dayMs -
      ANALYTICS_FUNNEL.kstOffsetMs,
  );
  const encoded = JSON.stringify(data);
  for (const hidden of [
    world.fan.id,
    world.policy,
    'source_id',
    'user_id',
    'event_key',
    'consent_version',
    'email',
    'phone',
    'call_name',
    'body',
    'amount_krw',
    'billing_key',
  ])
    expect(encoded).not.toContain(hidden);
  const empty = await snapshot(context, world.admin, {
    from: world.emptyDate,
    to: world.emptyDate,
  });
  expect(empty.events.every((row) => row.event_count === 0)).toBe(true);
  expect(empty.daily).toEqual([]);
  expect(analyticsFingerprint(world.fan)).toBe(before);
  expect(unrelatedFingerprint()).toBe(unrelated);
});

test('strict query, actor binding, anonymous, restriction and non-admin boundaries fail closed', async ({
  world,
  context,
}) => {
  await failure(
    await get(context.request, routes.analyticsFunnelApi, world.admin),
    401,
    'UNAUTHENTICATED',
  );
  await world.admin.signIn(context);
  await failure(
    await context.request.get(routes.analyticsFunnelApi),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, routes.analyticsFunnelApi, world.other),
    403,
    'FORBIDDEN',
  );
  for (const query of [
    '?unknown=1',
    '?from=2026-01-01',
    '?to=2026-01-01',
    '?from=2026-02-30&to=2026-03-01',
    '?from=1999-12-31&to=2000-01-01',
    '?from=2000-01-01&to=2001-01-01',
    '?from=2099-01-01&to=2099-01-01',
    `?from=${world.range.to}&to=${world.range.from}`,
    `?from=${world.range.from}&from=${world.range.from}&to=${world.range.to}`,
  ])
    await failure(
      await get(
        context.request,
        routes.analyticsFunnelApi + query,
        world.admin,
      ),
      400,
      'INVALID_INPUT',
    );
  for (const method of ['post', 'put', 'delete'] as const)
    expect(
      (
        await context.request[method](routes.analyticsFunnelApi, { data: {} })
      ).status(),
    ).toBe(405);
  await world.fan.signIn(context);
  await failure(
    await get(context.request, routes.analyticsFunnelApi, world.fan),
    403,
    'FORBIDDEN',
  );
  await world.admin.signIn(context);
  setRestricted(world.admin, true);
  await failure(
    await get(context.request, routes.analyticsFunnelApi, world.admin),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.admin, false);
  setRole(world.admin, 'fan');
  await failure(
    await get(context.request, routes.analyticsFunnelApi, world.admin),
    403,
    'FORBIDDEN',
  );
});

test('disabled and missing policies are unavailable rather than false zero measurements', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = analyticsFingerprint(world.fan);
  setPolicy(false);
  const disabled = await snapshot(context, world.admin, world.range);
  expect(disabled.collection).toEqual({
    status: 'disabled',
    retention_days: 30,
  });
  expect(disabled.events.every((row) => row.event_count === null)).toBe(true);
  expect(disabled.daily).toEqual([]);
  setPolicy(true);
  expect(
    (await snapshot(context, world.admin, world.range)).events[0]?.event_count,
  ).toBe(1);
  removePolicy();
  const missing = await snapshot(context, world.admin, world.range);
  expect(missing.collection).toEqual({
    status: 'unconfigured',
    retention_days: null,
  });
  expect(missing.events.every((row) => row.event_count === null)).toBe(true);
  expect(missing.daily).toEqual([]);
  expect(analyticsFingerprint(world.fan)).toBe(before);
});

test('real consent withdrawal excludes retained history and a new grant never resurrects the prior epoch', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = analyticsFingerprint(world.fan);
  setConsent(world.fan, world.policy, false);
  expect(
    (await snapshot(context, world.admin, world.range)).events.every(
      (row) => row.event_count === 0,
    ),
  ).toBe(true);
  expect(analyticsFingerprint(world.fan)).toBe(before);
  await world.fan.signIn(context);
  await failure(await recordVoice(context), 403, 'CONSENT_REQUIRED');
  setConsent(world.fan, world.policy, true);
  await world.admin.signIn(context);
  expect(
    (await snapshot(context, world.admin, world.range)).events.every(
      (row) => row.event_count === 0,
    ),
  ).toBe(true);
  await world.fan.signIn(context);
  const key = randomUUID();
  expect(await success(await recordVoice(context, key))).toBeNull();
  expect(await success(await recordVoice(context, key))).toBeNull();
  await world.admin.signIn(context);
  const current = await snapshot(context, world.admin, world.range);
  expect(
    current.events.find((row) => row.name === AnalyticsEvent.VOICE_INPUT_USED)
      ?.event_count,
  ).toBe(1);
  expect(current.daily).toHaveLength(1);
});

test('client observation schemas reject actor text, server claims, conflicting replay and invisible message or preview sources', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const key = randomUUID();
  expect(await success(await recordVoice(context, key))).toBeNull();
  const voice = {
    event_key: key,
    name: AnalyticsEvent.VOICE_INPUT_USED,
    properties: { voice_context: 'post' },
  } satisfies ClientAnalyticsEventInput;
  await failure(
    await context.request.post(routes.analytics, {
      headers: { Origin: appOrigin },
      data: voice,
    }),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  for (const data of [
    { ...voice, user_id: world.fan.id },
    {
      ...voice,
      properties: {
        voice_context: 'post',
        text: 'fictional text must not enter analytics',
      },
    },
    { ...voice, name: AnalyticsEvent.RENEW },
  ])
    await failure(
      await context.request.post(routes.analytics, {
        headers: { Origin: appOrigin },
        data,
      }),
      400,
      'INVALID_INPUT',
    );
  const invisible = {
    event_key: randomUUID(),
    name: AnalyticsEvent.MESSAGE_OPEN,
    properties: { source_id: randomUUID() },
  } satisfies ClientAnalyticsEventInput;
  await failure(
    await context.request.post(routes.analytics, {
      headers: { Origin: appOrigin },
      data: invisible,
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.post(routes.analyticsPreview, {
      headers: {
        Origin: appOrigin,
        [ANALYTICS_PREVIEW_ACTOR_HEADER]: world.fan.id,
      },
      data: { event_key: randomUUID(), source_id: randomUUID() },
    }),
    403,
    'FORBIDDEN',
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`aggregate, pending metric, range, policy and offscreen daily states ${scale}/${width}`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      await page.setViewportSize({ width, height: 900 });
      await world.admin.signIn(context);
      await open(page, world);
      await expect(events(page)).toHaveCount(13);
      for (const [index, name] of Object.values(AnalyticsEvent).entries()) {
        await expect(
          page.locator(`[data-analytics-event="${name}"]`).getByRole('meter'),
        ).toHaveAttribute('value', String(index + 1));
      }
      await expect(
        page
          .getByTestId('analytics-funnel-metrics')
          .getByText(copy.metricUnavailable, { exact: true }),
      ).toHaveCount(4);
      await expect(
        main(page).getByText(copy.historyIncomplete, { exact: true }),
      ).toBeVisible();
      await expect(
        main(page).getByText(copy.fontUnavailable, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `analytics-counts-${scale}-${width}`, scale);
      await captureControl(
        page,
        page.getByTestId('analytics-funnel-metrics'),
        info,
        `analytics-pending-metrics-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        page.getByTestId('analytics-funnel-daily'),
        info,
        `analytics-daily-${scale}-${width}`,
        scale,
      );
      await world.fan.signIn(context);
      expect(await success(await recordVoice(context))).toBeNull();
      await world.admin.signIn(context);
      await refresh(page, world.admin, world.range);
      await expect(days(page)).toHaveCount(13);
      await captureControl(
        page,
        button(page, copy.next),
        info,
        `analytics-daily-next-${scale}-${width}`,
        scale,
      );
      await button(page, copy.next).click();
      await expect(days(page)).toHaveCount(1);
      await screenshot(
        page,
        info,
        `analytics-daily-last-${scale}-${width}`,
        scale,
      );
      await button(page, copy.previous).click();
      await expect(days(page)).toHaveCount(13);
      const empty = { from: world.emptyDate, to: world.emptyDate };
      await page.getByLabel(copy.from, { exact: true }).fill(empty.from);
      await page.getByLabel(copy.to, { exact: true }).fill(empty.to);
      const emptyArrival = await captureArrival(page, world.admin, empty);
      await button(page, copy.apply).click();
      await emptyArrival.result;
      await expect(page).toHaveURL(analyticsFunnelPath(empty));
      await expect(days(page)).toHaveCount(0);
      await screenshot(page, info, `analytics-empty-${scale}-${width}`, scale);
      setPolicy(false);
      await refresh(page, world.admin, empty);
      await expect(
        page.getByTestId('analytics-funnel-policy-unavailable'),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `analytics-disabled-${scale}-${width}`,
        scale,
      );
      removePolicy();
      await refresh(page, world.admin, empty);
      await screenshot(
        page,
        info,
        `analytics-unconfigured-${scale}-${width}`,
        scale,
      );
    });

test('account replacement, current admin revocation and logout purge the visible aggregate', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  setFont(world.other, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  await world.admin.signIn(context);
  await open(page, world);
  await world.other.signIn(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(content(page)).toHaveCount(0);
  await expect(alert(page)).toHaveText(copy.errors.FORBIDDEN);
  await screenshot(page, info, 'analytics-actor-denied-xlarge-360', 'xlarge');
  await open(page, world, world.other);
  setRole(world.other, 'fan');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(content(page)).toHaveCount(0);
  await expect(alert(page)).toHaveText(copy.errors.FORBIDDEN);
  await screenshot(page, info, 'analytics-admin-revoked-xlarge-360', 'xlarge');
  await world.admin.signIn(context);
  await open(page, world);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(content(page)).toHaveCount(0);
  await expect(alert(page)).toHaveText(copy.errors.UNAUTHENTICATED);
});

test('transport loss clears stale counts and explicit retry reads the unchanged database', async ({
  world,
  context,
  page,
}) => {
  await world.admin.signIn(context);
  await open(page, world);
  const before = analyticsFingerprint(world.fan);
  await page.route(
    (url) => url.pathname === routes.analyticsFunnelApi,
    (route) => route.abort('failed'),
    { times: 1 },
  );
  await button(page, copy.refresh).click();
  await expect(content(page)).toHaveCount(0);
  await expect(alert(page)).toHaveText(copy.errors.UNAVAILABLE);
  const arrival = await captureArrival(page, world.admin, world.range);
  await button(page, messages.ui.retry).click();
  await arrival.result;
  await expect(events(page)).toHaveCount(13);
  expect(analyticsFingerprint(world.fan)).toBe(before);
});

test('HTML, RSC, worker caches and Back navigation never reuse aggregate contents without a current actor read', async ({
  world,
  context,
  page,
}) => {
  await world.admin.signIn(context);
  for (const headers of [{}, { RSC: '1' }]) {
    const response = await context.request.get(
      analyticsFunnelPath(world.range),
      { headers },
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const text = await response.text();
    for (const hidden of [
      world.fan.id,
      world.policy,
      '"event_count":13',
      '"daily":[',
    ])
      expect(text).not.toContain(hidden);
  }
  await open(page, world);
  const navigation = navigationResponse(page, routes.admin);
  await main(page).getByRole('link', { name: copy.back, exact: true }).click();
  expect((await navigation).status()).toBe(200);
  await expect(page).toHaveURL(routes.admin);
  await expect(main(page).getByRole('heading').first()).toBeVisible();
  const arrival = await captureArrival(page, world.admin, world.range);
  await page.goBack();
  await expect(page).toHaveURL(analyticsFunnelPath(world.range));
  await arrival.result;
  await expect(events(page)).toHaveCount(13);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        urls.push(request.url);
    return urls;
  });
  expect(
    cached.some((url) =>
      [routes.analyticsFunnel, routes.analyticsFunnelApi].includes(
        new URL(url).pathname as typeof routes.analyticsFunnel,
      ),
    ),
  ).toBe(false);
});

test('current source eligibility hides retained observations without deleting or recreating their rows', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = analyticsFingerprint(world.fan);
  setRestricted(world.fan, true);
  expect(
    (await snapshot(context, world.admin, world.range)).events.every(
      (row) => row.event_count === 0,
    ),
  ).toBe(true);
  setRestricted(world.fan, false);
  expect(
    (await snapshot(context, world.admin, world.range)).events[0]?.event_count,
  ).toBe(1);
  setRole(world.fan, 'admin');
  expect(
    (await snapshot(context, world.admin, world.range)).events.every(
      (row) => row.event_count === 0,
    ),
  ).toBe(true);
  expect(analyticsFingerprint(world.fan)).toBe(before);
});

test('a late verified response cannot restore an aggregate after navigation', async ({
  world,
  context,
  page,
}) => {
  await world.admin.signIn(context);
  await open(page, world);
  let release!: () => void,
    accepted!: () => void,
    rejected!: (error: unknown) => void,
    settled!: (result: { error?: unknown }) => void;
  const hold = new Promise<void>((done) => {
    release = done;
  });
  const verified = new Promise<void>((done, fail) => {
    accepted = done;
    rejected = fail;
  });
  const completed = new Promise<{ error?: unknown }>((done) => {
    settled = done;
  });
  await page.route(
    (url) => url.pathname === routes.analyticsFunnelApi,
    async (route) => {
      let terminalActionStarted = false;
      try {
        const response = await route.fetch();
        const data = analyticsFunnelDashboardSchema.parse(
          await success(response),
        );
        expect(data.actor_id).toBe(world.admin.id);
        expect(data.events).toHaveLength(13);
        accepted();
        await hold;
        terminalActionStarted = true;
        await route.fulfill({ response });
        settled({});
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Analytics response and cleanup failed.',
            );
          }
        }
        rejected(failure);
        settled({ error: failure });
      }
    },
    { times: 1 },
  );
  await button(page, copy.refresh).click();
  await verified;
  await expect(content(page)).toHaveCount(0);
  const navigation = navigationResponse(page, routes.admin);
  await main(page).getByRole('link', { name: copy.back, exact: true }).click();
  expect((await navigation).status()).toBe(200);
  await expect(page).toHaveURL(routes.admin);
  await expect(main(page).getByRole('heading').first()).toBeVisible();
  release();
  const completion = await completed;
  if ('error' in completion) throw completion.error;
  await expect(content(page)).toHaveCount(0);
});

test('pagehide clears counts and focus requires fresh consent before restoring the dashboard', async ({
  world,
  context,
  page,
}) => {
  await world.admin.signIn(context);
  await open(page, world);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(content(page)).toHaveCount(0);
  setConsent(world.fan, world.policy, false);
  const arrival = await captureArrival(page, world.admin, world.range);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await arrival.result;
  await expect(content(page)).toBeVisible();
  expect(
    (await snapshot(context, world.admin, world.range)).events.every(
      (row) => row.event_count === 0,
    ),
  ).toBe(true);
});

test('HTML and RSC preview fetches never collect, while a mounted visible preview records one actor-bound observation', async ({
  world,
  context,
  page,
}) => {
  const preview = await prepareVisiblePreview(world);
  await world.fan.signIn(context);
  const before = analyticsFingerprint(world.fan);
  for (const headers of [{}, { RSC: '1' }]) {
    const response = await context.request.get(
      artistPreviewPath(preview.artist.slug),
      { headers },
    );
    expect(response.status()).toBe(200);
  }
  expect(analyticsFingerprint(world.fan)).toBe(before);
  let accept!: () => void, reject!: (error: unknown) => void;
  const recorded = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) => url.pathname === routes.analyticsPreview,
    async (route) => {
      let terminalActionStarted = false;
      try {
        expect(
          route.request().headers()[
            ANALYTICS_PREVIEW_ACTOR_HEADER.toLowerCase()
          ],
        ).toBe(world.fan.id);
        const body = previewAnalyticsSchema.parse(
          route.request().postDataJSON(),
        );
        expect(body.source_id).toBe(preview.messageId);
        const response = await route.fetch();
        expect(await success(response)).toBeNull();
        terminalActionStarted = true;
        await route.fulfill({ response });
        accept();
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Preview verification and cleanup failed.',
            );
          }
        }
        reject(failure);
      }
    },
    { times: 1 },
  );
  await page.goto(artistPreviewPath(preview.artist.slug));
  const target = page.locator(
    `[${ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE}="${preview.messageId}"]`,
  );
  await target.scrollIntoViewIfNeeded();
  await recorded;
  const after = analyticsFingerprint(world.fan);
  expect(after).not.toBe(before);
  await page.evaluate(() => window.scrollTo(0, 0));
  await target.scrollIntoViewIfNeeded();
  await world.admin.signIn(context);
  const data = await snapshot(context, world.admin, world.range);
  expect(
    data.events.find((event) => event.name === AnalyticsEvent.PREVIEW_VIEW)
      ?.event_count,
  ).toBe(4);
  expect(analyticsFingerprint(world.fan)).toBe(after);
});

test('a rendered old-actor preview rejects collection after cookie replacement before its first visible intersection', async ({
  world,
  context,
  page,
}) => {
  const preview = await prepareVisiblePreview(world);
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 100 });
  const oldBefore = analyticsFingerprint(world.fan),
    newBefore = analyticsFingerprint(preview.replacement);
  await page.goto(artistPreviewPath(preview.artist.slug));
  const target = page.locator(
    `[${ANALYTICS_PREVIEW_SOURCE_ATTRIBUTE}="${preview.messageId}"]`,
  );
  // An attached node can still be in Next's hidden streamed segment while the
  // chat loading fallback is visible. Wait for real layout without scrolling:
  // the first intersection must still happen only after the actor is replaced.
  await expect(
    main(page).getByRole('heading', {
      name: messages.artists.previewTitle.replace(
        '{name}',
        preview.artist.name,
      ),
      exact: true,
    }),
  ).toBeVisible();
  await expect(target).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  expect(
    await target.evaluate(
      (element) => element.getBoundingClientRect().top >= innerHeight,
    ),
  ).toBe(true);
  expect(analyticsFingerprint(world.fan)).toBe(oldBefore);
  await preview.replacement.signIn(context);
  let accept!: () => void, reject!: (error: unknown) => void;
  const rejected = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) => url.pathname === routes.analyticsPreview,
    async (route) => {
      let terminalActionStarted = false;
      try {
        expect(
          route.request().headers()[
            ANALYTICS_PREVIEW_ACTOR_HEADER.toLowerCase()
          ],
        ).toBe(world.fan.id);
        const body = previewAnalyticsSchema.parse(
          route.request().postDataJSON(),
        );
        expect(body.source_id).toBe(preview.messageId);
        const response = await route.fetch();
        await failure(response, 403, 'FORBIDDEN');
        terminalActionStarted = true;
        await route.fulfill({ response });
        accept();
      } catch (error) {
        let problem = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            problem = new AggregateError(
              [error, abortError],
              'Preview denial and cleanup failed.',
            );
          }
        }
        reject(problem);
      }
    },
    { times: 1 },
  );
  await target.scrollIntoViewIfNeeded();
  await rejected;
  for (const headers of [
    { Origin: appOrigin },
    { Origin: appOrigin, [ANALYTICS_PREVIEW_ACTOR_HEADER]: world.fan.id },
  ]) {
    const body = {
      event_key: randomUUID(),
      source_id: preview.messageId,
    } satisfies z.input<typeof previewAnalyticsSchema>;
    await failure(
      await context.request.post(routes.analyticsPreview, {
        headers,
        data: body,
      }),
      403,
      'FORBIDDEN',
    );
  }
  expect(analyticsFingerprint(world.fan)).toBe(oldBefore);
  expect(analyticsFingerprint(preview.replacement)).toBe(newBefore);
});
