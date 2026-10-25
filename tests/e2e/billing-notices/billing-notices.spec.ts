import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { BILLING_NOTICES_CI_ENV } from '../../../scripts/billing-notices-local-fixtures.mjs';
import {
  BILLING_NOTICE,
  type BillingNoticeList,
} from '../../../src/config/billing-notices';
import {
  billingNoticePath,
  routes,
  subscriptionPath,
} from '../../../src/config/routes';
import {
  test,
  expect,
  preparePolicies,
  completeProfile,
  seedSources,
  createNotices,
  noticeSnapshot,
  cancelNoticeSource,
  rescheduleNoticeSource,
  rotateNoticePolicy,
  makeNoticeUnknown,
  setFont,
  restrict,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  appOrigin,
  type World,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.billingNotices;
const main = (page: Page) => page.getByRole('main');
const rows = (page: Page) => main(page).locator('[data-billing-notice-id]');
// Callers pass context.request after sign-in; Playwright's standalone request
// fixture has a separate cookie jar and is reserved below for anonymous cron.
async function list(
  request: APIRequestContext,
  cursor?: string,
): Promise<BillingNoticeList> {
  const response = await request.get(
    cursor
      ? `${routes.billingNoticeStatus}?${new URLSearchParams({ cursor })}`
      : routes.billingNoticeStatus,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body.data;
}
async function seed(world: World, count = 1, mandatory = true) {
  await completeProfile(world.fan, world.artist);
  const sources = seedSources(world, count, mandatory);
  createNotices(sources);
  return sources;
}
async function expectFailure(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}
async function open(page: Page) {
  await page.goto(routes.billingNotices);
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(main(page).locator('[data-billing-preference]')).toBeVisible();
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('protected local worker creates a real deduplicated inbox without delivery receipts or charges', async ({
  world,
  context,
  request,
}) => {
  await completeProfile(world.fan, world.artist);
  const sources = seedSources(world, 2);
  const before = noticeSnapshot(sources);
  expect(before.notices).toHaveLength(0);
  await expectFailure(
    await request.post(routes.createBillingNotices),
    401,
    'UNAUTHORIZED',
  );
  const invoke = () =>
    request.post(routes.createBillingNotices, {
      headers: {
        Authorization: `Bearer ${BILLING_NOTICES_CI_ENV.BILLING_NOTICES_CRON_SECRET}`,
      },
    });
  const first = await invoke();
  expect(first.status()).toBe(200);
  const summary = await first.json();
  expect(summary).toMatchObject({
    ok: true,
    data: { created: 2, pushJobsQueued: 0, failed: 0 },
  });
  expect(JSON.stringify(summary)).not.toMatch(
    /delivered|notified|displayed|7200|billing_at/,
  );
  expect((await invoke()).status()).toBe(200);
  const after = noticeSnapshot(sources);
  expect(after.notices).toHaveLength(2);
  expect(after.receipts).toBe(0);
  expect(after.payments).toBe(before.payments);
  expect(after.attempts).toBe(0);
  expect(after.pushJobs).toBe(0);
  await world.fan.signIn(context);
  const inbox = await list(context.request);
  expect(inbox.notices).toHaveLength(2);
  expect(
    inbox.notices.every(
      (row) => row.currency === 'KRW' && row.amountKrw === 7200,
    ),
  ).toBe(true);
});

test('owner-only list/read and same-origin writes expose no provider or another account details', async ({
  world,
  context,
}) => {
  const sources = await seed(world);
  await world.fan.signIn(context);
  const owner = await list(context.request);
  const notice = owner.notices[0]!;
  expect(Object.keys(notice).sort()).toEqual(
    [
      'id',
      'subscriptionId',
      'artistName',
      'amountKrw',
      'currency',
      'billingAt',
      'createdAt',
      'readAt',
      'mandatory',
    ].sort(),
  );
  const read = await post(context.request, routes.billingNoticeRead, {
    noticeId: notice.id,
  });
  expect(await read.json()).toEqual({ ok: true, data: null });
  const marked = (await list(context.request)).notices[0]!;
  expect(marked.readAt).not.toBeNull();
  expect(
    (
      await post(context.request, routes.billingNoticeRead, {
        noticeId: notice.id,
      })
    ).status(),
  ).toBe(200);
  expect((await list(context.request)).notices[0]!.readAt).toBe(marked.readAt);
  expect(noticeSnapshot(sources).receipts).toBe(0);
  await expectFailure(
    await context.request.post(routes.billingNoticeRead, {
      headers: { Origin: 'https://outside.invalid' },
      data: { noticeId: notice.id },
    }),
    403,
    'FORBIDDEN',
  );
  await completeProfile(world.other, world.artist);
  await world.other.signIn(context);
  expect((await list(context.request)).notices).toEqual([]);
  await expectFailure(
    await post(context.request, routes.billingNoticeRead, {
      noticeId: notice.id,
    }),
    404,
    'NOT_FOUND',
  );
  await context.clearCookies();
  await expectFailure(
    await context.request.get(routes.billingNoticeStatus),
    401,
    'UNAUTHENTICATED',
  );
});

test('optional billing preference preserves unrelated choices, suppresses opt-out, and never requests browser permission', async ({
  world,
  context,
  page,
}) => {
  await completeProfile(world.fan, world.artist);
  const sources = seedSources(world, 1, false);
  expect(createNotices(sources).notices).toHaveLength(0);
  const actor = await world.fan.actorClient();
  expect(
    (
      await actor.rpc('notification_set_preferences', {
        p_webpush_enabled: false,
        p_new_message: true,
        p_billing: false,
        p_schedule: true,
      })
    ).error,
  ).toBeNull();
  await world.fan.signIn(context);
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'requestPermission', {
      configurable: true,
      value: () => {
        throw new Error('No permission request is authorized.');
      },
    });
  });
  await open(page);
  await expect(main(page).getByText(copy.emptyTitle)).toBeVisible();
  await main(page).getByRole('button', { name: copy.enablePreference }).click();
  await expect(main(page).getByText(copy.preferenceOn)).toBeVisible();
  expect((await actor.rpc('notification_get_preferences')).data).toEqual([
    {
      webpush_enabled: false,
      new_message: true,
      billing: true,
      schedule: true,
    },
  ]);
  expect(createNotices(sources).notices).toHaveLength(1);
  await main(page).getByRole('button', { name: copy.refresh }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(
    main(page).getByText(copy.optional, { exact: true }),
  ).toBeVisible();
  await main(page)
    .getByRole('button', { name: copy.disablePreference })
    .click();
  await expect(main(page).getByText(copy.preferenceOff)).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
  expect((await list(context.request)).notices).toEqual([]);
  expect(noticeSnapshot(sources).receipts).toBe(0);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  for (const width of [360, 1280])
    test(`${scale} ${width}: current amount, KST date, all entry and management links`, async ({
      world,
      context,
      page,
    }, info) => {
      const sources = await seed(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.home);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(
        main(page).getByRole('link', { name: copy.entryOpen }),
      ).toBeVisible();
      await screenshot(page, info, 'home-entry');
      await main(page).getByRole('link', { name: copy.entryOpen }).click();
      await expect(rows(page)).toHaveCount(1);
      await expect(main(page).getByText('7,200원 (KRW)')).toBeVisible();
      await expect(main(page).getByText(copy.timeZone)).toBeVisible();
      await expect(
        main(page).getByText(copy.mandatory, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, 'notice-initial');
      await main(page)
        .getByRole('link', { name: `${world.artist.name} 구독 관리` })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${subscriptionPath(sources[0]!.subscriptionId)}`,
      );
      await expect(
        main(page).getByRole('heading', {
          name: messages.subscriptions.detailTitle.replace(
            '{name}',
            world.artist.name,
          ),
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(page, info, 'subscription-management-destination');
      await page.goBack();
      await expect(rows(page)).toHaveCount(1);
      await main(page)
        .getByRole('link', { name: copy.back, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.subscriptions}`);
      await expect(
        main(page).getByRole('link', { name: copy.entryOpen }),
      ).toBeVisible();
      await screenshot(page, info, 'subscriptions-entry');
      await main(page).getByRole('link', { name: copy.entryOpen }).click();
      await expect(rows(page)).toHaveCount(1);
    });

  test(`${scale} 360: read marker, optional toggle, account-specific empty state and Back`, async ({
    world,
    context,
    page,
  }, info) => {
    const sources = await seed(world);
    setFont(world.fan, scale);
    await world.fan.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    await open(page);
    await expect(rows(page)).toHaveCount(1);
    await main(page).getByRole('button', { name: copy.markRead }).click();
    await expect(
      main(page).getByRole('button', { name: copy.markRead }),
    ).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
    await screenshot(page, info, 'marked-read');
    await main(page)
      .getByRole('button', { name: copy.enablePreference })
      .click();
    await expect(main(page).getByText(copy.preferenceOn)).toBeVisible();
    await screenshot(page, info, 'optional-on');
    await main(page)
      .getByRole('button', { name: copy.disablePreference })
      .click();
    await expect(main(page).getByText(copy.preferenceOff)).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await screenshot(page, info, 'optional-off-mandatory-stays');
    expect(noticeSnapshot(sources).receipts).toBe(0);
    await completeProfile(world.other, world.artist, scale);
    setFont(world.other, scale);
    await world.other.signIn(context);
    await open(page);
    await expect(rows(page)).toHaveCount(0);
    await expect(main(page).getByText(copy.emptyDescription)).toBeVisible();
    await screenshot(page, info, 'other-account-empty');
    await main(page)
      .getByRole('link', { name: copy.manageSubscriptions })
      .click();
    await expect(page).toHaveURL(`${appOrigin}${routes.subscriptions}`);
    await expect(
      main(page).getByRole('heading', {
        name: messages.subscriptions.emptyTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      main(page).getByText(messages.subscriptions.emptyDescription, {
        exact: true,
      }),
    ).toBeVisible();
    await screenshot(page, info, 'empty-subscriptions-destination');
  });

  test(`${scale} 360: interrupted load, main-scoped error, retry and current access loss`, async ({
    world,
    context,
    page,
  }, info) => {
    await seed(world);
    setFont(world.fan, scale);
    await world.fan.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const matcher = `**${routes.billingNoticeStatus}`;
    await page.route(
      matcher,
      async (route) => {
        await gate;
        await route.abort('failed');
      },
      { times: 1 },
    );
    await page.goto(routes.billingNotices);
    await expect(main(page).getByRole('status')).toHaveText(copy.loading);
    await screenshot(page, info, 'loading');
    release();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.UNAVAILABLE,
    );
    await expect(rows(page)).toHaveCount(0);
    await screenshot(page, info, 'load-error');
    await main(page)
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(rows(page)).toHaveCount(1);
    await screenshot(page, info, 'retry-restored');
    restrict(world.fan);
    await main(page).getByRole('button', { name: copy.refresh }).click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.FORBIDDEN,
    );
    await expect(rows(page)).toHaveCount(0);
    await screenshot(page, info, 'access-lost');
    restrict(world.fan, false);
    await main(page)
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(rows(page)).toHaveCount(1);
    await context.clearCookies();
    await main(page).getByRole('button', { name: copy.refresh }).click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.UNAUTHENTICATED,
    );
    await expect(rows(page)).toHaveCount(0);
    await screenshot(page, info, 'session-lost');
    await main(page).getByRole('link', { name: copy.signIn }).click();
    await expect(page).toHaveURL(`${appOrigin}${routes.start}`);
  });
}

for (const [name, mutate] of [
  ['cancellation', cancelNoticeSource],
  ['reschedule', rescheduleNoticeSource],
  ['unknown operation', makeNoticeUnknown],
] as const)
  test(`${name} suppresses a previously visible amount on refresh and rejects stale mark-read`, async ({
    world,
    context,
    page,
  }) => {
    const sources = await seed(world);
    await world.fan.signIn(context);
    await open(page);
    await expect(rows(page)).toHaveCount(1);
    const id = (await list(context.request)).notices[0]!.id;
    mutate(sources[0]!);
    await main(page).getByRole('button', { name: copy.refresh }).click();
    await expect(rows(page)).toHaveCount(0);
    await expect(main(page).getByText(copy.emptyTitle)).toBeVisible();
    await expectFailure(
      await post(context.request, routes.billingNoticeRead, { noticeId: id }),
      404,
      'NOT_FOUND',
    );
    expect(noticeSnapshot(sources).receipts).toBe(0);
  });

test('unaccepted changed checkout price suppresses old notice instead of fabricating a new amount', async ({
  world,
  context,
  page,
}) => {
  const sources = await seed(world);
  await world.fan.signIn(context);
  await open(page);
  await expect(rows(page)).toHaveCount(1);
  rotateNoticePolicy();
  await main(page).getByRole('button', { name: copy.refresh }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(main(page).getByText(copy.emptyTitle)).toBeVisible();
  expect(noticeSnapshot(sources).receipts).toBe(0);
});

test('xlarge 360: deterministic bounded pagination, first link and Back/Forward revalidation', async ({
  world,
  context,
  page,
}, info) => {
  await seed(world, BILLING_NOTICE.pageSize + 1);
  setFont(world.fan, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const first = await list(context.request);
  expect(first.notices).toHaveLength(BILLING_NOTICE.pageSize);
  expect(first.hasMore).toBe(true);
  const second = await list(context.request, first.nextCursor!);
  expect(second.notices).toHaveLength(1);
  expect(second.hasMore).toBe(false);
  expect(
    new Set([...first.notices, ...second.notices].map((row) => row.id)).size,
  ).toBe(BILLING_NOTICE.pageSize + 1);
  await open(page);
  await expect(rows(page)).toHaveCount(BILLING_NOTICE.pageSize);
  await main(page)
    .getByRole('link', { name: copy.next })
    .scrollIntoViewIfNeeded();
  await screenshot(page, info, 'pagination-next', false);
  await main(page).getByRole('link', { name: copy.next }).click();
  await expect(page).toHaveURL(
    `${appOrigin}${billingNoticePath(first.nextCursor)}`,
  );
  await expect(rows(page)).toHaveCount(1);
  await screenshot(page, info, 'pagination-second');
  await main(page).getByRole('link', { name: copy.first }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.billingNotices}`);
  await expect(rows(page)).toHaveCount(BILLING_NOTICE.pageSize);
  await page.goBack();
  await expect(rows(page)).toHaveCount(1);
  await page.goForward();
  await expect(rows(page)).toHaveCount(BILLING_NOTICE.pageSize);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  test(`${scale} 360: malformed route cursor, standalone retry and Back`, async ({
    world,
    context,
    page,
  }, info) => {
    await seed(world);
    setFont(world.fan, scale);
    await world.fan.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto(`${routes.billingNotices}?cursor=invalid`);
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.INVALID_INPUT,
    );
    await screenshot(page, info, 'invalid-cursor-initial');
    await main(page)
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.INVALID_INPUT,
    );
    await main(page)
      .getByRole('link', { name: copy.first, exact: true })
      .click();
    await expect(page).toHaveURL(`${appOrigin}${routes.billingNotices}`);
    await expect(rows(page)).toHaveCount(1);
    await main(page)
      .getByRole('link', { name: copy.back, exact: true })
      .click();
    await expect(page).toHaveURL(`${appOrigin}${routes.subscriptions}`);
    await expectFailure(
      await context.request.get(`${routes.billingNoticeStatus}?cursor=invalid`),
      400,
      'INVALID_INPUT',
    );
    await expectFailure(
      await context.request.get(
        `${routes.billingNoticeStatus}?cursor=a&cursor=b`,
      ),
      400,
      'INVALID_INPUT',
    );
    await expectFailure(
      await post(context.request, routes.billingNoticePreference, {
        enabled: true,
        userId: world.other.id,
      }),
      400,
      'INVALID_INPUT',
    );
  });
