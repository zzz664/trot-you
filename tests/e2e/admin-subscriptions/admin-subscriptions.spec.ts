import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  adminSubscriptionDashboardSchema,
  type AdminSubscriptionQuery,
} from '../../../src/config/admin-subscriptions';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import { adminSubscriptionPath, routes } from '../../../src/config/routes';
import {
  test,
  expect,
  appOrigin,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRole,
  setRestricted,
  billingFingerprint,
  type Scale,
  type World,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.adminSubscriptions;
const main = (page: Page) => page.getByRole('main');
const result = (page: Page) =>
  main(page).locator('[data-admin-subscriptions-result]');
const summary = (page: Page) =>
  main(page).locator('[data-admin-subscriptions-summary]');
const artists = (page: Page) =>
  main(page).locator('[data-admin-subscriptions-artist]');
const pagination = (page: Page) =>
  main(page).locator('[data-admin-subscriptions-pagination]');
const button = (within: Page | Locator, name: string) =>
  within.getByRole('button', { name, exact: true });
const link = (within: Page | Locator, name: string) =>
  within.getByRole('link', { name, exact: true });
const query = (
  world: World,
  artist = world.artist.id,
  page = 1,
): AdminSubscriptionQuery => ({
  ...world.range,
  artist_id: artist || null,
  page,
});
async function snapshot(
  request: APIRequestContext,
  input: AdminSubscriptionQuery,
) {
  const response = await request.get(adminSubscriptionPath(input, true));
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return adminSubscriptionDashboardSchema.parse(body.data);
}
async function failure(
  response: Awaited<ReturnType<APIRequestContext['get']>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}
async function open(page: Page, input: AdminSubscriptionQuery) {
  await page.goto(adminSubscriptionPath(input));
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(result(page)).toBeVisible();
  await expect(pagination(page)).toContainText(
    copy.pageIndicator.replace('{page}', String(input.page)),
  );
}
async function captureElement(
  page: Page,
  target: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await target.screenshot({ path: info.outputPath(`${name}.png`) });
}
async function settle(page: Page, input: AdminSubscriptionQuery) {
  await expect(page).toHaveURL(adminSubscriptionPath(input));
  await expect(result(page)).toBeVisible();
  await expect(pagination(page)).toContainText(
    copy.pageIndicator.replace('{page}', String(input.page)),
  );
}

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real aggregate RPC separates current state, verified cohort history, failed attempts and safe pagination without mutating billing', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = billingFingerprint(world.artist.id);
  const data = await snapshot(context.request, query(world));
  expect(data.summary.current).toEqual({
    total_subscriptions: 8,
    subscribers: 4,
    active_paid: 2,
    grace: 1,
    canceled_paid: 1,
    pending: 1,
    expired: 1,
    out_of_access: 2,
  });
  expect(data.summary.period).toEqual({
    new_subscriptions: 2,
    cancellations: 1,
    renewal_due: 3,
    renewal_paid: 1,
    renewal_rate: 33.33,
  });
  expect(data.selected_artist?.id).toBe(world.artist.id);
  expect(data.artists).toHaveLength(1);
  expect(data.artists[0]?.current).toEqual(data.summary.current);
  expect(data.artists[0]?.period).toEqual(data.summary.period);
  expect(Date.parse(data.window_start)).toBe(
    Date.parse(world.range.from) - 9 * 60 * 60 * 1000,
  );
  expect(Date.parse(data.window_end)).toBe(
    Date.parse(world.range.to) + 15 * 60 * 60 * 1000,
  );
  expect(data.time_zone).toBe('Asia/Seoul');
  const serialized = JSON.stringify(data);
  expect(serialized).not.toMatch(
    /fictional-private|@example[.]invalid|user_id|subscription_id|payment_attempt|amount_krw|billing_key|secure_credential|provider_action|email|phone|call_name/,
  );
  const currentOnly = await snapshot(context.request, {
    ...query(world),
    from: world.range.to,
  });
  expect(currentOnly.summary.current).toEqual(data.summary.current);
  expect(currentOnly.summary.period).toEqual({
    new_subscriptions: 0,
    cancellations: 0,
    renewal_due: 0,
    renewal_paid: 0,
    renewal_rate: null,
  });
  const empty = await snapshot(context.request, query(world, world.empty.id));
  expect(empty.summary.current.total_subscriptions).toBe(0);
  expect(empty.summary.period.renewal_rate).toBeNull();
  const first = await snapshot(context.request, query(world, ''));
  const second = await snapshot(context.request, query(world, '', 2));
  expect(first.artists).toHaveLength(20);
  expect(first.has_more).toBe(true);
  expect(second.artists.length).toBeGreaterThan(0);
  expect(
    second.artists.every(
      (row) => !first.artists.some((earlier) => earlier.id === row.id),
    ),
  ).toBe(true);
  expect(second.summary).toEqual(first.summary);
  const beyond = await snapshot(
    context.request,
    query(world, world.artist.id, 1000),
  );
  expect(beyond.artists).toEqual([]);
  expect(beyond.has_more).toBe(false);
  expect(beyond.summary).toEqual(data.summary);
  expect(billingFingerprint(world.artist.id)).toBe(before);
});

test('strict query and current actor guards reject partial dates, duplicate keys, excessive ranges, role loss and all writes', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = billingFingerprint(world.artist.id);
  for (const invalid of [
    '?unknown=value',
    '?from=2026-01-01',
    '?to=2026-01-01',
    '?page=0',
    '?page=1001',
    '?page=1.5',
    '?page=01',
    '?page=1&page=2',
    '?artist_id=bad',
    '?artist_id=',
    '?from=2026-02-30&to=2026-03-01',
    '?from=1999-12-31&to=2000-01-01',
    '?from=2000-01-01&to=2001-01-01',
    '?from=2099-01-01&to=2099-01-01',
    `?from=${world.range.to}&to=${world.range.from}`,
    `?from=${world.range.from}&from=${world.range.from}&to=${world.range.to}`,
  ])
    await failure(
      await context.request.get(routes.adminSubscriptionsApi + invalid),
      400,
      'INVALID_INPUT',
    );
  await failure(
    await context.request.get(
      adminSubscriptionPath(query(world, randomUUID()), true),
    ),
    404,
    'NOT_FOUND',
  );
  expect(
    (
      await context.request.post(routes.adminSubscriptionsApi, { data: {} })
    ).status(),
  ).toBe(405);
  expect(
    (
      await context.request.put(routes.adminSubscriptionsApi, { data: {} })
    ).status(),
  ).toBe(405);
  await world.fan.signIn(context);
  await failure(
    await context.request.get(routes.adminSubscriptionsApi),
    403,
    'FORBIDDEN',
  );
  await world.admin.signIn(context);
  setRestricted(world.admin, true);
  await failure(
    await context.request.get(routes.adminSubscriptionsApi),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.admin, false);
  setRole(world.admin, 'fan');
  await failure(
    await context.request.get(routes.adminSubscriptionsApi),
    403,
    'FORBIDDEN',
  );
  setRole(world.admin, 'admin');
  await context.clearCookies();
  await failure(
    await context.request.get(routes.adminSubscriptionsApi),
    401,
    'UNAUTHENTICATED',
  );
  expect(billingFingerprint(world.artist.id)).toBe(before);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: settled entry, current and historic metrics, filters, empty state, page controls and all navigation`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.admin);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
      await captureElement(
        page,
        main(page).getByRole('region', { name: copy.title, exact: true }),
        info,
        `subscriptions-admin-entry-card-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.open).click();
      await expect(
        main(page).getByRole('heading', { name: copy.title, exact: true }),
      ).toBeVisible();
      await expect(result(page)).toBeVisible();
      await expect(artists(page)).toHaveCount(20);
      await screenshot(
        page,
        info,
        `subscriptions-entry-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        pagination(page),
        info,
        `subscriptions-first-page-pagination-initial-${scale}-${width}`,
        scale,
      );
      const firstCard = artists(page).first();
      const chosenId = (await firstCard.getAttribute(
        'data-admin-subscriptions-artist',
      ))!;
      await captureElement(
        page,
        firstCard,
        info,
        `subscriptions-artist-initial-${scale}-${width}`,
        scale,
      );
      await link(firstCard, copy.filterArtist).click();
      await expect(result(page)).toBeVisible();
      await expect(artists(page)).toHaveCount(1);
      await expect(artists(page).first()).toHaveAttribute(
        'data-admin-subscriptions-artist',
        chosenId,
      );
      await screenshot(
        page,
        info,
        `subscriptions-artist-filter-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('[data-admin-subscriptions-filters]'),
        info,
        `subscriptions-selected-filters-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.allArtists).click();
      await expect(result(page)).toBeVisible();
      await expect(artists(page)).toHaveCount(20);
      await link(pagination(page), copy.nextPage).click();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '2'),
      );
      await expect(result(page)).toBeVisible();
      await captureElement(
        page,
        pagination(page),
        info,
        `subscriptions-page-two-initial-${scale}-${width}`,
        scale,
      );
      await link(pagination(page), copy.previousPage).click();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '1'),
      );
      await expect(artists(page)).toHaveCount(20);
      await link(pagination(page), copy.nextPage).click();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '2'),
      );
      await link(pagination(page), copy.firstPage).click();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '1'),
      );
      await page.goBack();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '2'),
      );
      await page.goForward();
      await expect(pagination(page)).toContainText(
        copy.pageIndicator.replace('{page}', '1'),
      );
      await open(page, query(world));
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="total_subscriptions"] dd',
        ),
      ).toHaveText('8');
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="renewal_rate"] dd',
        ),
      ).toContainText('33.33');
      await captureElement(
        page,
        summary(page),
        info,
        `subscriptions-summary-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('[data-admin-subscriptions-definitions]'),
        info,
        `subscriptions-definitions-initial-${scale}-${width}`,
        scale,
      );
      await expect(
        main(page).locator('[data-admin-subscriptions-history-warning]'),
      ).toBeVisible();
      await main(page)
        .getByLabel(copy.from, { exact: true })
        .fill(world.range.to);
      await main(page)
        .getByLabel(copy.to, { exact: true })
        .fill(world.range.from);
      await button(main(page), copy.apply).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.formError.replace('{days}', '366'),
      );
      await captureElement(
        page,
        main(page).locator('[data-admin-subscriptions-filters]'),
        info,
        `subscriptions-form-invalid-initial-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByLabel(copy.to, { exact: true })
        .fill(world.range.to);
      await button(main(page), copy.apply).click();
      await settle(page, { ...query(world), from: world.range.to });
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="renewal_rate"] dd',
        ),
      ).toHaveText(copy.renewalNoData);
      await captureElement(
        page,
        summary(page),
        info,
        `subscriptions-range-empty-initial-${scale}-${width}`,
        scale,
      );
      await page.goBack();
      await settle(page, query(world));
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="renewal_rate"] dd',
        ),
      ).toContainText('33.33');
      await page.goForward();
      await settle(page, { ...query(world), from: world.range.to });
      await open(page, query(world, world.empty.id));
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="total_subscriptions"] dd',
        ),
      ).toHaveText('0');
      await captureElement(
        page,
        summary(page),
        info,
        `subscriptions-zero-artist-initial-${scale}-${width}`,
        scale,
      );
      await open(page, query(world, world.artist.id, 1000));
      await expect(
        main(page).getByRole('heading', { name: copy.emptyTitle, exact: true }),
      ).toBeVisible();
      await captureElement(
        page,
        main(page).getByRole('region', { name: copy.emptyTitle, exact: true }),
        info,
        `subscriptions-empty-page-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        pagination(page),
        info,
        `subscriptions-empty-pagination-initial-${scale}-${width}`,
        scale,
      );
      await link(pagination(page), copy.firstPage).click();
      await settle(page, query(world));
      await expect(artists(page)).toHaveCount(1);
      await link(main(page), copy.back).click();
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(routes.admin);
      await screenshot(
        page,
        info,
        `subscriptions-back-admin-settled-${scale}-${width}`,
        scale,
      );
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: real read retry, forbidden/not-found states and session loss clear every old aggregate`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await open(page, query(world));
      const before = billingFingerprint(world.artist.id);
      await page.route(`**${routes.adminSubscriptionsApi}?*`, (route) =>
        route.abort('connectionreset'),
      );
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.UNAVAILABLE,
      );
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-unavailable-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('.ui-inline-error'),
        info,
        `subscriptions-unavailable-error-initial-${scale}-${width}`,
        scale,
      );
      await page.unroute(`**${routes.adminSubscriptionsApi}?*`);
      await button(main(page), messages.ui.retry).click();
      await expect(result(page)).toBeVisible();
      setRole(world.admin, 'fan');
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-role-lost-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('.ui-inline-error'),
        info,
        `subscriptions-role-lost-error-initial-${scale}-${width}`,
        scale,
      );
      setRole(world.admin, 'admin');
      await button(main(page), messages.ui.retry).click();
      await expect(result(page)).toBeVisible();
      setRestricted(world.admin, true);
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(result(page)).toHaveCount(0);
      setRestricted(world.admin, false);
      await button(main(page), messages.ui.retry).click();
      await expect(result(page)).toBeVisible();
      await page.goto(adminSubscriptionPath(query(world, randomUUID())));
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.NOT_FOUND,
      );
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-not-found-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('.ui-inline-error'),
        info,
        `subscriptions-not-found-error-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.allArtists).click();
      await expect(result(page)).toBeVisible();
      await expect(artists(page)).toHaveCount(20);
      await page.goto(`${routes.adminSubscriptions}?page=0`);
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.INVALID_INPUT,
      );
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-invalid-page-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('.ui-inline-error'),
        info,
        `subscriptions-invalid-page-error-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        link(main(page), copy.reset),
        info,
        `subscriptions-reset-link-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.reset).click();
      await expect(result(page)).toBeVisible();
      await expect(artists(page)).toHaveCount(20);
      await screenshot(
        page,
        info,
        `subscriptions-reset-settled-${scale}-${width}`,
        scale,
      );
      await open(page, query(world));
      await context.clearCookies({ name: /^sb-/ });
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.UNAUTHENTICATED,
      );
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-session-lost-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).locator('.ui-inline-error'),
        info,
        `subscriptions-session-lost-error-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        link(main(page), copy.signIn),
        info,
        `subscriptions-sign-in-link-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.signIn).click();
      await expect(
        page.getByRole('heading', {
          name: messages.auth.startTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(routes.start);
      await screenshot(
        page,
        info,
        `subscriptions-sign-in-settled-${scale}-${width}`,
        scale,
      );
      expect(billingFingerprint(world.artist.id)).toBe(before);
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: initial loading and interrupted read never restore a stale dashboard after navigation`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      let release: (() => void) | undefined;
      let entered: (() => void) | undefined;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const delayed = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**${routes.adminSubscriptionsApi}?*`, async (route) => {
        const response = await route.fetch();
        entered?.();
        await delayed;
        await route.fulfill({ response }).catch(() => undefined);
      });
      await page.goto(adminSubscriptionPath(query(world)));
      await waiting;
      await expect(main(page).getByRole('status')).toHaveText(copy.loading);
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-loading-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).getByRole('status'),
        info,
        `subscriptions-loading-status-initial-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.back).click();
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(routes.admin);
      release?.();
      await page.unroute(`**${routes.adminSubscriptionsApi}?*`);
      await expect(result(page)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `subscriptions-interrupted-read-settled-${scale}-${width}`,
        scale,
      );
      await page.goBack();
      await settle(page, query(world));
      await expect(artists(page)).toHaveCount(1);
      await expect(
        summary(page).locator(
          '[data-admin-subscriptions-metric="total_subscriptions"] dd',
        ),
      ).toHaveText('8');
    });
