import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  callName,
  preparePolicies,
  completeProfile,
  subscribe,
  seedMessages,
  seedExcludedMessages,
  seedReplies,
  blockReply,
  deleteReply,
  cancelLinkedMessage,
  setFont,
  restrict,
  setRole,
  removeMembership,
  addMembership,
  setArtistActive,
  addArtists,
  enableActivityRequirements,
  disableActivityRequirements,
  sourceSnapshot,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  type World,
} from './fixtures';
import {
  artistReplyActivityApiPath,
  artistReplyActivityPath,
  routes,
} from '../../../src/config/routes';
import type {
  ArtistReplyActivityPage,
  ArtistReplyActivityMessages,
} from '../../../src/config/artist-reply-activity';

// Node reads localized fixture copy without importing runtime application JSON.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.artistReplyActivity;
const replyRows = (page: Page) => page.locator('[data-activity-reply-id]');
const messageRows = (page: Page) => page.locator('[data-activity-message-id]');
const main = (page: Page) => page.getByRole('main');
async function contextData(
  request: APIRequestContext,
  world: World,
  messageId: string | null = null,
  cursor?: string,
) {
  const response = await post(
    request,
    artistReplyActivityApiPath(world.artist.slug),
    { messageId, ...(cursor ? { cursor } : {}) },
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body.data as ArtistReplyActivityPage;
}
async function pickerData(
  request: APIRequestContext,
  world: World,
  cursor?: string,
) {
  const response = await post(
    request,
    artistReplyActivityApiPath(world.artist.slug, 'messages'),
    cursor ? { cursor } : {},
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body.data as ArtistReplyActivityMessages;
}
async function seed(world: World, count = 35, messageCount = 35) {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  enableActivityRequirements(world);
  const sent = seedMessages(world, messageCount);
  const replies = seedReplies(world, count, sent[0]!.id);
  return { sent, replies };
}
async function fail(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('calling-name-only feed and current KST week use source data without financial or delivery mutations', async ({
  world,
  context,
  page,
}) => {
  const { sent, replies } = await seed(world, 4, 2);
  seedExcludedMessages(world);
  await world.author.signIn(context);
  const before = sourceSnapshot(world);
  const result = await contextData(page.request, world);
  expect(result.artist.id).toBe(world.artist.id);
  expect(result.activity).toMatchObject({
    messageCount: 2,
    photoCount: 1,
    weeklyMessageMin: 3,
    weeklyPhotoMin: 2,
    requirementsReady: true,
  });
  const weekStart = Date.parse(`${result.activity.weekStart}T00:00:00+09:00`);
  const weekEnd = Date.parse(`${result.activity.weekEnd}T00:00:00+09:00`);
  expect(weekEnd - weekStart).toBe(7 * 24 * 60 * 60 * 1000);
  expect(new Date(`${result.activity.weekStart}T00:00:00Z`).getUTCDay()).toBe(
    1,
  );
  expect(Date.parse(result.serverNow)).toBeGreaterThanOrEqual(weekStart);
  expect(Date.parse(result.serverNow)).toBeLessThan(weekEnd);
  expect(result.replies.map((reply) => reply.id)).toEqual(
    replies.map((reply) => reply.id),
  );
  for (const reply of result.replies) {
    expect(Object.keys(reply).sort()).toEqual([
      'body',
      'callName',
      'createdAt',
      'id',
      'messageId',
    ]);
    expect(reply.callName).toBe(callName);
    expect(reply.messageId).toBe(sent[0]!.id);
  }
  expect(JSON.stringify(result)).not.toContain(world.fan.id);
  expect(JSON.stringify(result)).not.toContain('@example.invalid');
  expect(JSON.stringify(result)).not.toMatch(
    /"(?:userId|user_id|email|phone|subscriptionId|subscription_id|operationId|operation_id)"/,
  );
  expect(sourceSnapshot(world)).toBe(before);
  disableActivityRequirements(world);
  expect((await contextData(page.request, world)).activity).toMatchObject({
    messageCount: 2,
    photoCount: 1,
    weeklyMessageMin: null,
    weeklyPhotoMin: null,
    requirementsReady: false,
  });
});

test('reply and sent-message cursor pages are stable, filtered and scoped to the selected artist', async ({
  world,
  context,
  page,
}) => {
  const { sent, replies } = await seed(world);
  const general = seedReplies(world, 2);
  await world.author.signIn(context);
  const first = await contextData(page.request, world, sent[0]!.id);
  expect(first.replies).toHaveLength(30);
  expect(first.hasMore).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  const second = await contextData(
    page.request,
    world,
    sent[0]!.id,
    first.nextCursor!,
  );
  expect(second.replies).toHaveLength(5);
  expect(second.nextCursor).toBeNull();
  expect([...first.replies, ...second.replies].map((row) => row.id)).toEqual(
    replies.map((row) => row.id),
  );
  expect((await contextData(page.request, world, sent[1]!.id)).replies).toEqual(
    [],
  );
  const all = await contextData(page.request, world);
  expect(
    all.replies.some((row) => general.some((other) => other.id === row.id)),
  ).toBe(true);
  const pickerFirst = await pickerData(page.request, world);
  const pickerSecond = await pickerData(
    page.request,
    world,
    pickerFirst.nextCursor!,
  );
  expect(
    [...pickerFirst.messages, ...pickerSecond.messages].map((row) => row.id),
  ).toEqual(sent.map((row) => row.id));
  expect(pickerSecond.nextCursor).toBeNull();
  for (const row of pickerFirst.messages)
    expect(Object.keys(row).sort()).toEqual(['id', 'kind', 'sentAt']);
  const [otherArtist] = addArtists(world, 1);
  await fail(
    await post(page.request, artistReplyActivityApiPath(otherArtist!.slug), {
      messageId: null,
      cursor: first.nextCursor,
    }),
    400,
    'INVALID_INPUT',
  );
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: sent[1]!.id,
      cursor: first.nextCursor,
    }),
    400,
    'INVALID_INPUT',
  );
});

test('hidden, deleted and currently restricted fan replies disappear; canceled links reveal no canceled message', async ({
  world,
  page,
  context,
}) => {
  const { sent, replies } = await seed(world, 4, 1);
  blockReply(world, replies[0]!.id);
  deleteReply(world, replies[1]!.id);
  await world.author.signIn(context);
  const visible = await contextData(page.request, world);
  expect(visible.replies.map((row) => row.id)).toEqual(
    replies.slice(2).map((row) => row.id),
  );
  restrict(world.fan);
  expect((await contextData(page.request, world)).replies).toEqual([]);
  restrict(world.fan, false);
  cancelLinkedMessage(world, sent[0]!.id);
  const afterCancel = await contextData(page.request, world);
  expect(afterCancel.replies).toHaveLength(2);
  expect(afterCancel.replies.every((row) => row.messageId === null)).toBe(true);
  expect(afterCancel.activity.messageCount).toBe(0);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: sent[0]!.id,
    }),
    404,
    'NOT_FOUND',
  );
});

test('current actor role, membership and active artist are rechecked on ordinary reads', async ({
  world,
  context,
  page,
}) => {
  await seed(world, 1, 1);
  await world.outsider.signIn(context);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    403,
    'FORBIDDEN',
  );
  await world.fan.signIn(context);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    403,
    'FORBIDDEN',
  );
  await world.author.signIn(context);
  expect((await contextData(page.request, world)).replies).toHaveLength(1);
  removeMembership(world);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    403,
    'FORBIDDEN',
  );
  addMembership(world);
  setArtistActive(world, false);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    404,
    'NOT_FOUND',
  );
  setArtistActive(world, true);
  restrict(world.author);
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    403,
    'FORBIDDEN',
  );
  restrict(world.author, false);
  setRole(world.author, 'admin');
  await fail(
    await post(page.request, artistReplyActivityApiPath(world.artist.slug), {
      messageId: null,
    }),
    403,
    'FORBIDDEN',
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  for (const width of [360, 1280]) {
    test(`${scale} ${width}: menu, feed, filters, pagination and browser history are readable actual navigation`, async ({
      world,
      page,
      context,
    }, info) => {
      const { sent } = await seed(world);
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: 900 });
      await world.author.signIn(context);
      await page.goto(routes.artist);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await screenshot(page, info, 'artist-menu-entry');
      await page
        .getByRole('link', { name: copy.menuTitle, exact: true })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${routes.artistReplyActivityMenu}`,
      );
      await screenshot(page, info, 'own-artist-menu');
      await page
        .getByRole('link', {
          name: copy.menuOpen.replace('{name}', world.artist.name),
          exact: true,
        })
        .click();
      await expect(replyRows(page)).toHaveCount(30);
      await expect(
        page.locator('[data-activity-metric="message"]'),
      ).toContainText('35');
      await expect(
        page.locator('[data-activity-metric="photo"]'),
      ).toContainText('1');
      await expect(
        main(page)
          .getByText('<strong>문자 그대로</strong>', { exact: false })
          .first(),
      ).toBeVisible();
      await expect(replyRows(page).locator('strong')).toHaveCount(0);
      await screenshot(page, info, 'activity-and-reply-feed');
      await expect(messageRows(page)).toHaveCount(0);
      await page
        .getByRole('button', { name: copy.openMessages, exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: copy.closeMessages, exact: true }),
      ).toHaveAttribute('aria-expanded', 'true');
      await screenshot(page, info, 'open-message-picker');
      await page
        .locator(`[data-activity-message-id="${sent[0]!.id}"]`)
        .getByRole('link')
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${artistReplyActivityPath(world.artist.slug, sent[0]!.id)}`,
      );
      await expect(
        main(page).getByText(copy.messageSelected, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, 'message-filter');
      await page
        .getByRole('link', { name: copy.moreReplies, exact: true })
        .click();
      await expect(replyRows(page)).toHaveCount(5);
      await expect(page).toHaveURL(/[?&]cursor=/);
      await screenshot(page, info, 'older-replies');
      await page.goBack();
      await expect(replyRows(page)).toHaveCount(30);
      await expect(page).not.toHaveURL(/[?&]cursor=/);
      await page.goForward();
      await expect(replyRows(page)).toHaveCount(5);
      await page
        .getByRole('link', { name: copy.firstReplies, exact: true })
        .click();
      await expect(replyRows(page)).toHaveCount(30);
      await page
        .getByRole('link', { name: copy.allReplies, exact: true })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${artistReplyActivityPath(world.artist.slug)}`,
      );
      await expect(
        main(page).getByText(copy.allSelected, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: copy.openMessages, exact: true })
        .click();
      await page
        .getByRole('button', { name: copy.olderMessages, exact: true })
        .click();
      await expect(messageRows(page)).toHaveCount(5);
      await screenshot(page, info, 'older-message-picker');
      await page
        .getByRole('button', { name: copy.closeMessages, exact: true })
        .click();
      await expect(messageRows(page)).toHaveCount(0);
      await page
        .getByRole('button', { name: copy.openMessages, exact: true })
        .click();
      await expect(messageRows(page)).toHaveCount(5);
      await page
        .getByRole('button', { name: copy.firstMessages, exact: true })
        .click();
      await expect(messageRows(page)).toHaveCount(30);
      await page
        .getByRole('button', { name: copy.refresh, exact: true })
        .click();
      await expect(replyRows(page)).toHaveCount(30);
      await page
        .getByRole('link', { name: copy.backToArtists, exact: true })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${routes.artistReplyActivityMenu}`,
      );
      await page.getByRole('link', { name: copy.back, exact: true }).click();
      await expect(page).toHaveURL(`${appOrigin}${routes.artist}`);
    });
  }
}

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  test(`${scale}: artist menu pagination and empty states retain working navigation`, async ({
    world,
    page,
    context,
  }, info) => {
    setFont(world.author, scale);
    await page.setViewportSize({ width: 360, height: 900 });
    await world.author.signIn(context);
    await page.goto(artistReplyActivityPath(world.artist.slug));
    await expect(
      main(page).getByText(copy.repliesEmpty, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: copy.openMessages, exact: true })
      .click();
    await expect(
      main(page).getByText(copy.noMessages, { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, 'empty-feed-and-message-picker');
    const [emptyMessage] = seedMessages(world, 1);
    await page.getByRole('button', { name: copy.refresh, exact: true }).click();
    await page
      .locator(`[data-activity-message-id="${emptyMessage!.id}"]`)
      .getByRole('link')
      .click();
    await expect(
      main(page).getByText(copy.filteredEmpty, { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, 'empty-message-filter');
    await page
      .getByRole('link', { name: copy.allReplies, exact: true })
      .click();
    await expect(page).toHaveURL(
      `${appOrigin}${artistReplyActivityPath(world.artist.slug)}`,
    );
    await expect(
      main(page).getByText(copy.allSelected, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: copy.backToArtists, exact: true })
      .click();
    // A link click can return before the client route settles. Reloading now
    // must refresh the menu, not interrupt navigation and reload the old feed.
    await expect(page).toHaveURL(
      `${appOrigin}${routes.artistReplyActivityMenu}`,
    );
    await expect(
      main(page).getByRole('heading', { name: copy.menuTitle, exact: true }),
    ).toBeVisible();
    addArtists(world, 51);
    await page.reload();
    await page.getByRole('link', { name: copy.menuMore, exact: true }).click();
    await expect(page).toHaveURL(/[?&]after=/);
    await screenshot(page, info, 'next-artist-menu-page');
    const secondPageArtist = main(page)
      .getByRole('link')
      .filter({ hasText: '답장과 활동 보기' })
      .first();
    await secondPageArtist.click();
    await expect(
      main(page).getByText(copy.repliesEmpty, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: copy.backToArtists, exact: true })
      .click();
    await page.getByRole('link', { name: copy.menuMore, exact: true }).click();
    await page.getByRole('link', { name: copy.menuFirst, exact: true }).click();
    await expect(page).toHaveURL(
      `${appOrigin}${routes.artistReplyActivityMenu}`,
    );
    await screenshot(page, info, 'first-artist-menu-page');
    setFont(world.outsider, scale);
    await world.outsider.signIn(context);
    await page.goto(routes.artistReplyActivityMenu);
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
    await expect(
      main(page).getByText(copy.menuEmpty, { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, 'empty-artist-menu');
    await page.getByRole('link', { name: copy.back, exact: true }).click();
    await expect(page).toHaveURL(`${appOrigin}${routes.artist}`);
  });

  test(`${scale}: refresh clears revoked content and Retry recovers only after current membership returns`, async ({
    world,
    page,
    context,
  }, info) => {
    await seed(world, 2, 1);
    setFont(world.author, scale);
    await page.setViewportSize({ width: 360, height: 900 });
    await world.author.signIn(context);
    await page.goto(artistReplyActivityPath(world.artist.slug));
    await expect(replyRows(page)).toHaveCount(2);
    removeMembership(world);
    await page.getByRole('button', { name: copy.refresh, exact: true }).click();
    await expect(main(page).getByRole('alert')).toHaveText(copy.accessLost);
    await expect(replyRows(page)).toHaveCount(0);
    await expect(messageRows(page)).toHaveCount(0);
    await expect(page.locator('[data-activity-metric]')).toHaveCount(0);
    await screenshot(page, info, 'access-lost-cleared');
    addMembership(world);
    await page
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(replyRows(page)).toHaveCount(2);
    await screenshot(page, info, 'access-restored-current-read');
  });

  test(`${scale}: temporary read failure closes stale content and retry is an actual new read`, async ({
    world,
    page,
    context,
  }, info) => {
    await seed(world, 2, 1);
    setFont(world.author, scale);
    await page.setViewportSize({ width: 1280, height: 900 });
    await world.author.signIn(context);
    await page.goto(artistReplyActivityPath(world.artist.slug));
    await expect(replyRows(page)).toHaveCount(2);
    const endpoint = artistReplyActivityApiPath(world.artist.slug);
    // Deliberate transport-renderer seam only; actual RPC success and access
    // revocation are covered independently, not claimed from this response.
    await page.route(`**${endpoint}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
      }),
    );
    await page.getByRole('button', { name: copy.refresh, exact: true }).click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.UNAVAILABLE,
    );
    await expect(replyRows(page)).toHaveCount(0);
    await screenshot(page, info, 'transport-error-cleared');
    await page.unroute(`**${endpoint}`);
    await page
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(replyRows(page)).toHaveCount(2);
    await screenshot(page, info, 'transport-retry-restored');
  });
}

test('an older successful refresh cannot restore a reply hidden before a newer refresh', async ({
  world,
  page,
  context,
}, info) => {
  const { replies } = await seed(world, 1, 1);
  await world.author.signIn(context);
  await page.goto(artistReplyActivityPath(world.artist.slug));
  await expect(replyRows(page)).toHaveCount(1);
  const endpoint = artistReplyActivityApiPath(world.artist.slug);
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let calls = 0;
  await page.route(`**${endpoint}`, async (route) => {
    calls += 1;
    if (calls !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    captured();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await ready;
  await expect(replyRows(page)).toHaveCount(0);
  blockReply(world, replies[0]!.id);
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await expect(
    main(page).getByText(copy.repliesEmpty, { exact: true }),
  ).toBeVisible();
  release();
  await page.unroute(`**${endpoint}`);
  await expect(replyRows(page)).toHaveCount(0);
  await screenshot(page, info, 'newer-refresh-wins');
});

test('Back during a delayed filtered refresh does not restore the superseded filter', async ({
  world,
  page,
  context,
}, info) => {
  const { sent } = await seed(world, 2, 2);
  await world.author.signIn(context);
  await page.goto(artistReplyActivityPath(world.artist.slug));
  await expect(replyRows(page)).toHaveCount(2);
  await page
    .getByRole('button', { name: copy.openMessages, exact: true })
    .click();
  await page
    .locator(`[data-activity-message-id="${sent[0]!.id}"]`)
    .getByRole('link')
    .click();
  await expect(
    main(page).getByText(copy.messageSelected, { exact: true }),
  ).toBeVisible();
  const endpoint = artistReplyActivityApiPath(world.artist.slug);
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  let intercepted = false;
  await page.route(`**${endpoint}`, async (route) => {
    const input = route.request().postDataJSON();
    if (intercepted || input.messageId !== sent[0]!.id) return route.continue();
    intercepted = true;
    const response = await route.fetch();
    captured();
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await ready;
  await page.goBack();
  await expect(page).toHaveURL(
    `${appOrigin}${artistReplyActivityPath(world.artist.slug)}`,
  );
  await expect(
    main(page).getByText(copy.allSelected, { exact: true }),
  ).toBeVisible();
  release();
  await page.unroute(`**${endpoint}`);
  await expect(
    main(page).getByText(copy.messageSelected, { exact: true }),
  ).toHaveCount(0);
  await screenshot(page, info, 'back-during-filter-refresh');
  await page.goForward();
  await expect(
    main(page).getByText(copy.messageSelected, { exact: true }),
  ).toBeVisible();
  await expect(replyRows(page)).toHaveCount(2);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  test(`${scale}: standalone route errors retain Retry and Back without an old feed`, async ({
    world,
    page,
    context,
  }, info) => {
    setFont(world.author, scale);
    await page.setViewportSize({ width: 360, height: 900 });
    await world.author.signIn(context);
    await page.goto(artistReplyActivityPath(world.artist.slug, randomUUID()));
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
    await expect(
      main(page).getByRole('heading', { name: copy.errorTitle, exact: true }),
    ).toBeVisible();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.NOT_FOUND,
    );
    await expect(replyRows(page)).toHaveCount(0);
    await screenshot(page, info, 'unknown-message-error');
    await page
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.NOT_FOUND,
    );
    await page.getByRole('link', { name: copy.back, exact: true }).click();
    await expect(page).toHaveURL(`${appOrigin}${routes.artist}`);
    await page.goto(
      `${artistReplyActivityPath(world.artist.slug)}?message=invalid`,
    );
    await expect(
      main(page).getByRole('heading', { name: copy.errorTitle, exact: true }),
    ).toBeVisible();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.INVALID_INPUT,
    );
    await expect(replyRows(page)).toHaveCount(0);
    await screenshot(page, info, 'invalid-filter-error');
    await page
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.INVALID_INPUT,
    );
    await page.getByRole('link', { name: copy.back, exact: true }).click();
    await expect(page).toHaveURL(`${appOrigin}${routes.artist}`);
  });
}
