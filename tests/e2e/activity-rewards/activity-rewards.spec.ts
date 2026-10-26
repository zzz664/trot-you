import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIResponse,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test';
import {
  ACTIVITY_REWARDS,
  activitySnapshotSchema,
} from '../../../src/config/activity-rewards';
import { COMMUNITY_POSTS } from '../../../src/config/community-posts';
import type { CommunityCommentCreateInput } from '../../../src/config/community-interactions';
import {
  routes,
  activityRewardsHistoryPath,
  communityBoardPath,
  communityCommentsPath,
} from '../../../src/config/routes';
import {
  test,
  expect,
  get,
  appOrigin,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRestricted,
  localSql,
  preparePolicy,
  removePolicy,
  createPost,
  createComment,
  seedHistory,
  seedLegacy,
  ledger,
  unrelatedSnapshot,
  uuid,
  type Identity,
  type Scale,
} from './fixtures';
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.activityRewards;
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const entries = (page: Page) => page.locator('[data-activity-entry-id]');
// Next's route announcer also has role=alert outside the application main.
const activityAlert = (page: Page) => page.getByRole('main').getByRole('alert');
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
  cursor?: string | null,
) {
  return activitySnapshotSchema.parse(
    await success(
      await get(context.request, activityRewardsHistoryPath(cursor), actor),
    ),
  );
}
// Verify the real current-actor API response before forwarding it to React.
async function captureArrival(page: Page, actor: Identity) {
  let accept!: () => void, reject!: (error: unknown) => void;
  const result = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) => url.pathname + url.search === routes.activityRewardsApi,
    async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        expect(request.method()).toBe('GET');
        expect(url.pathname + url.search).toBe(routes.activityRewardsApi);
        expect(request.headers()[ACTIVITY_REWARDS.actorHeader]).toBe(actor.id);
        const response = await route.fetch();
        const data = activitySnapshotSchema.parse(await success(response));
        expect(data.actor_id).toBe(actor.id);
        await route.fulfill({ response });
        accept();
      } catch (error) {
        reject(error);
        await route.abort().catch(() => undefined);
      }
    },
    { times: 1 },
  );
  return { result };
}
async function openActivity(page: Page, actor: Identity) {
  const arrival = await captureArrival(page, actor);
  const response = await page.goto(routes.activityRewards);
  expect(response?.status()).toBe(200);
  await arrival.result;
  await expect(page.getByTestId('activity-rewards-content')).toBeVisible();
}
// Full documents can be worker-owned. Start listening before navigation, and
// accept only the actual document/RSC response for the expected destination.
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
async function captureControl(
  page: Page,
  control: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await expect(page.getByRole('main')).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await control.screenshot({ path: info.outputPath(`${name}.png`) });
}
test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('private activity snapshot uses current KST date and never grants points or configures pending features', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const before = unrelatedSnapshot();
  const firstDate = localSql(
    'select private.point_kst_date(clock_timestamp());',
  );
  const data = await snapshot(context, world.fan);
  const lastDate = localSql(
    'select private.point_kst_date(clock_timestamp());',
  );
  expect([firstDate, lastDate]).toContain(data.kst_date);
  expect(data).toMatchObject({
    actor_id: world.fan.id,
    contribution_policy: {
      post: { amount: 7, daily_cap: 2, used: 0, awarded: 0, remaining: 2 },
      comment: { amount: 3, daily_cap: 1, used: 0, awarded: 0, remaining: 1 },
      deleted_content_treatment: 'retain',
    },
    share: { configured: false },
    missions: { configured: false },
    grade: { configured: false },
    entries: [],
    next_cursor: null,
  });
  expect(unrelatedSnapshot()).toBe(before);
});

test('real post/comment creation APIs award atomically and replay without duplicate activity receipts', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const headers = {
    Origin: appOrigin,
    [COMMUNITY_POSTS.actorHeader]: world.fan.id,
  };
  const post = {
    operation_id: randomUUID(),
    post_id: randomUUID(),
    artist_id: world.artist.id,
    title: '격리 CI 활동 작성',
    body: '격리 CI의 허구 활동 생성입니다.',
    upload_ids: [],
    is_notice: false,
    is_pinned: false,
  };
  const first = await success(
    await context.request.post(
      communityBoardPath(world.artist.slug, null, true),
      { headers, data: post },
    ),
  );
  expect(
    await success(
      await context.request.post(
        communityBoardPath(world.artist.slug, null, true),
        { headers, data: post },
      ),
    ),
  ).toEqual(first);
  const comment = {
    operation_id: randomUUID(),
    comment_id: randomUUID(),
    post_id: post.post_id,
    body: '격리 CI의 허구 댓글입니다.',
  } satisfies CommunityCommentCreateInput;
  const created = await success(
    await context.request.post(
      communityCommentsPath(world.artist.slug, post.post_id),
      { headers, data: comment },
    ),
  );
  expect(
    await success(
      await context.request.post(
        communityCommentsPath(world.artist.slug, post.post_id),
        { headers, data: comment },
      ),
    ),
  ).toEqual(created);
  const data = await snapshot(context, world.fan);
  expect(data.entries).toHaveLength(2);
  expect(
    data.entries.map((row) => [row.reason, row.amount, row.outcome]),
  ).toEqual([
    ['comment', 3, 'awarded'],
    ['post', 7, 'awarded'],
  ]);
  expect(ledger(world.fan)).toHaveLength(2);
});

test('zero, cap-exhausted and legacy outcomes remain distinct and survive content hiding/deletion', async ({
  world,
  context,
}) => {
  preparePolicy(0, 3, 2, 1);
  const zero = createPost(world.fan, world.artist);
  preparePolicy();
  const awarded = createPost(world.fan, world.artist);
  createPost(world.fan, world.artist);
  createComment(world.fan, world.artist, awarded);
  createComment(world.fan, world.artist, awarded);
  const legacy = seedLegacy(world.fan, world.artist);
  localSql(
    `update public.posts set is_hidden=true,deleted_at=clock_timestamp() where id in ('${uuid(zero)}','${uuid(awarded)}');`,
  );
  await world.fan.signIn(context);
  const data = await snapshot(context, world.fan);
  expect(data.entries.map((row) => row.outcome)).toEqual([
    'daily_cap',
    'awarded',
    'daily_cap',
    'awarded',
    'zero_amount',
    'legacy',
  ]);
  expect(data.entries.at(-1)?.id).toBe(legacy);
  expect(data.contribution_policy).toMatchObject({
    post: { used: 3, awarded: 1, remaining: 0 },
    comment: { used: 2, awarded: 1, remaining: 0 },
  });
  const encoded = JSON.stringify(data);
  for (const hidden of [
    zero,
    awarded,
    'post_id',
    'comment_id',
    'policy_snapshot',
    'adjustment_note',
    '허구 활동 확인 글',
  ])
    expect(encoded).not.toContain(hidden);
  expect(ledger(world.fan)).toHaveLength(6);
});

test('keyset pagination is owner-only and policy removal does not erase private history', async ({
  world,
  context,
}) => {
  const own = seedHistory(world.fan, world.artist),
    other = seedHistory(world.other, world.artist, 3);
  removePolicy();
  await world.fan.signIn(context);
  const first = await snapshot(context, world.fan);
  expect(first.contribution_policy).toBeNull();
  expect(first.entries.map((row) => row.id)).toEqual(own.slice(0, 20));
  const next = await snapshot(
    context,
    world.fan,
    JSON.stringify(first.next_cursor),
  );
  expect(next.entries.map((row) => row.id)).toEqual(own.slice(20));
  expect(next.next_cursor).toBeNull();
  for (const id of other) expect(JSON.stringify(first)).not.toContain(id);
  await world.other.signIn(context);
  expect(
    (await snapshot(context, world.other)).entries.map((row) => row.id),
  ).toEqual(other);
});

test('actor, query, anonymous, restricted and incomplete-profile boundaries fail closed', async ({
  world,
  context,
}) => {
  await failure(
    await get(context.request, routes.activityRewardsApi, world.fan),
    401,
    'UNAUTHENTICATED',
  );
  await world.fan.signIn(context);
  await failure(
    await context.request.get(routes.activityRewardsApi),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, routes.activityRewardsApi, world.other),
    403,
    'FORBIDDEN',
  );
  for (const query of [
    `user_id=${world.other.id}`,
    'cursor={}&cursor={}',
    'cursor={}',
    `cursor=${encodeURIComponent(JSON.stringify({ id: randomUUID(), created_at: 'infinity' }))}`,
  ])
    await failure(
      await get(
        context.request,
        `${routes.activityRewardsApi}?${query}`,
        world.fan,
      ),
      400,
      'INVALID_INPUT',
    );
  setRestricted(world.fan, true);
  await failure(
    await get(context.request, routes.activityRewardsApi, world.fan),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.fan, false);
  localSql(
    `update public.profiles set onboarding_completed_at=null where id='${uuid(world.fan.id)}';`,
  );
  await failure(
    await get(context.request, routes.activityRewardsApi, world.fan),
    403,
    'FORBIDDEN',
  );
  expect(ledger(world.fan)).toHaveLength(0);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`read-only activity states and offscreen history controls ${scale}/${width}`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.fan, scale);
      await page.setViewportSize({ width, height: 900 });
      await world.fan.signIn(context);
      removePolicy();
      await page.goto(routes.points);
      await expect(page.getByTestId('attendance-points-content')).toBeVisible();
      const arrival = await captureArrival(page, world.fan);
      const navigation = navigationResponse(page, routes.activityRewards);
      await page
        .getByRole('link', { name: copy.entryOpen, exact: true })
        .click();
      expect((await navigation).status()).toBe(200);
      await arrival.result;
      await expect(page).toHaveURL(routes.activityRewards);
      await expect(
        page.getByText(copy.policyUnavailable, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `activity-unconfigured-${scale}-${width}`,
        scale,
      );
      expect(await page.getByRole('main').getByRole('button').count()).toBe(1);
      expect(ledger(world.fan)).toHaveLength(0);
      preparePolicy(0, 0, null, null);
      createPost(world.fan, world.artist);
      const zero = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await zero.result;
      await expect(
        page.getByText(copy.outcomes.zero_amount, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `activity-zero-unlimited-${scale}-${width}`,
        scale,
      );
      preparePolicy();
      const post = createPost(world.fan, world.artist);
      createPost(world.fan, world.artist);
      createComment(world.fan, world.artist, post);
      createComment(world.fan, world.artist, post);
      seedLegacy(world.fan, world.artist);
      const outcomes = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await outcomes.result;
      await expect(entries(page)).toHaveCount(6);
      await screenshot(
        page,
        info,
        `activity-outcomes-${scale}-${width}`,
        scale,
      );
      seedHistory(world.fan, world.artist);
      const history = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await history.result;
      await expect(entries(page)).toHaveCount(20);
      await screenshot(page, info, `activity-history-${scale}-${width}`, scale);
      await captureControl(
        page,
        button(page, copy.loadMore),
        info,
        `activity-more-control-${scale}-${width}`,
        scale,
      );
      await button(page, copy.loadMore).click();
      await expect(entries(page)).toHaveCount(31);
      await expect(button(page, copy.loadMore)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `activity-history-complete-${scale}-${width}`,
        scale,
      );
      removePolicy();
      const removed = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await removed.result;
      await expect(
        page.getByText(copy.policyUnavailable, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `activity-retained-history-${scale}-${width}`,
        scale,
      );
      const before = ledger(world.fan);
      const back = navigationResponse(page, routes.points);
      await page
        .getByRole('link', { name: copy.backPoints, exact: true })
        .click();
      expect((await back).status()).toBe(200);
      await expect(page).toHaveURL(routes.points);
      expect(ledger(world.fan)).toEqual(before);
    });

test('account switch and newly applied restriction purge private rows after fresh authority checks', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  setFont(world.other, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  createPost(world.fan, world.artist);
  await world.fan.signIn(context);
  await openActivity(page, world.fan);
  await world.other.signIn(context);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  await expect(activityAlert(page)).toHaveText(copy.errors.FORBIDDEN);
  await screenshot(page, info, 'activity-account-denial-xlarge-360', 'xlarge');
  await openActivity(page, world.other);
  await expect(
    page.getByText(copy.emptyHistory, { exact: true }),
  ).toBeVisible();
  setRestricted(world.other, true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  await expect(activityAlert(page)).toHaveText(copy.errors.FORBIDDEN);
  await screenshot(
    page,
    info,
    'activity-restriction-denial-xlarge-360',
    'xlarge',
  );
  expect(ledger(world.fan)).toHaveLength(1);
  expect(ledger(world.other)).toHaveLength(0);
});

test('transport loss clears private history and a retry verifies the actual unchanged database', async ({
  world,
  context,
  page,
}) => {
  createPost(world.fan, world.artist);
  await world.fan.signIn(context);
  await openActivity(page, world.fan);
  const before = unrelatedSnapshot();
  await page.route(
    (url) => url.pathname === routes.activityRewardsApi,
    (route) => route.abort('failed'),
    { times: 1 },
  );
  await button(page, copy.refresh).click();
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  await expect(activityAlert(page)).toHaveText(copy.errors.UNAVAILABLE);
  const retry = await captureArrival(page, world.fan);
  await button(page, messages.ui.retry).click();
  await retry.result;
  await expect(entries(page)).toHaveCount(1);
  expect(unrelatedSnapshot()).toBe(before);
});

test('a late verified response cannot repopulate a navigated-away page', async ({
  world,
  context,
  page,
}) => {
  createPost(world.fan, world.artist);
  await world.fan.signIn(context);
  await openActivity(page, world.fan);
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
    (url) => url.pathname === routes.activityRewardsApi,
    async (route) => {
      let terminalActionStarted = false;
      try {
        const response = await route.fetch();
        const data = activitySnapshotSchema.parse(await success(response));
        expect(data.actor_id).toBe(world.fan.id);
        expect(data.entries).toHaveLength(1);
        accepted();
        await hold;
        terminalActionStarted = true;
        await route.fulfill({ response });
        settled({});
      } catch (error) {
        // A fulfill attempt owns the route even when its request was canceled.
        // Never issue a second terminal action or hide the original failure.
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Activity verification and route cleanup both failed.',
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
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  const navigation = navigationResponse(page, routes.points);
  await page.getByRole('link', { name: copy.backPoints, exact: true }).click();
  expect((await navigation).status()).toBe(200);
  await expect(page).toHaveURL(routes.points);
  release();
  const completion = await completed;
  if ('error' in completion) throw completion.error;
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  expect(ledger(world.fan)).toHaveLength(1);
});

test('HTML, RSC, worker caches and back navigation never disclose private activity or grant points', async ({
  world,
  context,
  page,
}) => {
  const ids = seedHistory(world.fan, world.artist, 3);
  await world.fan.signIn(context);
  for (const headers of [{}, { RSC: '1' }]) {
    const response = await context.request.get(routes.activityRewards, {
      headers,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const text = await response.text();
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toContain('synthetic-activity-browser-v1');
  }
  await openActivity(page, world.fan);
  const before = unrelatedSnapshot();
  const navigation = navigationResponse(page, routes.points);
  await page.getByRole('link', { name: copy.backPoints, exact: true }).click();
  expect((await navigation).status()).toBe(200);
  // Receiving RSC bytes precedes Next's history commit. Back before this
  // destination is rendered can otherwise leave the initial about:blank page.
  await expect(page).toHaveURL(routes.points);
  await expect(
    page.getByRole('heading', {
      name: messages.attendancePoints.title,
      exact: true,
    }),
  ).toBeVisible();
  const arrival = await captureArrival(page, world.fan);
  await page.goBack();
  await expect(page).toHaveURL(routes.activityRewards);
  await arrival.result;
  await expect(entries(page)).toHaveCount(3);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        urls.push(request.url);
    return urls;
  });
  expect(
    cached.some(
      (url) =>
        new URL(url).pathname.startsWith(routes.activityRewardsApi) ||
        new URL(url).pathname === routes.activityRewards,
    ),
  ).toBe(false);
  expect(unrelatedSnapshot()).toBe(before);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('activity-rewards-content')).toHaveCount(0);
  await expect(activityAlert(page)).toHaveText(copy.errors.UNAUTHENTICATED);
});
