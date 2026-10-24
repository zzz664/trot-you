import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  preparePolicies,
  enableReplyPolicy,
  disableReplyPolicy,
  replyQuota,
  replyPoints,
  completeProfile,
  seedMessages,
  subscribe,
  replyRows,
  seedReplies,
  blockReply,
  extraFan,
  otherArtist,
  replyEvents,
  restrict,
  loseProfile,
  cancelMessage,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
} from './fixtures';
import {
  artistPreviewPath,
  fanRepliesPath,
  routes,
} from '../../../src/config/routes';
import type { ReplyPage } from '../../../src/config/replies';
// Keep JSON import assertions out of Playwright's NodeNext runtime loader.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);

async function replyPage(page: Page, slug: string, query = '') {
  const response = await page.request.get(`${fanRepliesPath(slug)}${query}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return (await response.json()).data as ReplyPage;
}
function replyCards(page: Page) {
  return page.locator('[data-reply-id]');
}
const payload = (body = '허구 응원 답장', messageId: string | null = null) => ({
  operationId: randomUUID(),
  body,
  messageId,
});

test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('configured own-feed pages preserve ties, historical text, blocked redaction and actor isolation', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const seeded = seedReplies(world, 35);
  const historical = seedReplies(world, 1, true)[0]!;
  blockReply(world, seeded[3]!.id);
  const stranger = await extraFan(world);
  seedReplies(stranger, 2);
  await world.fan.signIn(context);
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const data = await replyPage(
      page,
      world.artist.slug,
      `?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(data.sendReady).toBe(true);
    expect(data.maxLength).toBe(100);
    for (const row of data.replies) {
      expect(Object.keys(row).sort()).toEqual([
        'blocked',
        'body',
        'createdAt',
        'id',
        'messageId',
        'operationId',
      ]);
      expect(row.body).toBe(
        row.id === seeded[3]!.id
          ? null
          : [...seeded, historical].find((seed) => seed.id === row.id)?.body,
      );
      ids.push(row.id);
    }
    expect(JSON.stringify(data)).not.toMatch(
      /user_id|subscription_id|author_id|forbidden_terms|policy_version/,
    );
    cursor = data.nextCursor;
    pages++;
    expect(pages).toBeLessThanOrEqual(6);
  } while (cursor);
  expect(ids).toEqual([...seeded, historical].map((row) => row.id));
  expect(new Set(ids).size).toBe(36);
  expect(replyEvents(world)).toBe(0);
});

test('real send and replay keep one immutable reply and reject changed operation bindings', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const message = seedMessages(world, 1)[0]!;
  await world.fan.signIn(context);
  const input = payload('허구 한 번의 답장', message.id);
  const endpoint = fanRepliesPath(world.artist.slug);
  const first = await post(page.request, endpoint, input);
  expect(first.status()).toBe(200);
  const receipt = await first.json();
  expect(receipt.data.slug).toBe(world.artist.slug);
  expect(receipt.data.reply).toMatchObject({
    operationId: input.operationId,
    messageId: message.id,
    body: input.body,
    blocked: false,
  });
  const replay = await post(page.request, endpoint, input);
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  for (const changed of [
    { ...input, body: '다른 허구 내용' },
    { ...input, messageId: null },
  ]) {
    const rejected = await post(page.request, endpoint, changed);
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).code).toBe('IDEMPOTENCY_CONFLICT');
  }
  const other = otherArtist(world);
  const cross = await post(page.request, fanRepliesPath(other.artist.slug), {
    ...input,
    messageId: null,
  });
  expect(cross.status()).toBe(409);
  expect(replyRows(world)).toHaveLength(1);
  expect(replyRows(other)).toHaveLength(0);
  expect(replyEvents(world)).toBe(0);
});

test('current message visibility and artist binding are revalidated before creating a reply', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const canceled = seedMessages(world, 1)[0]!;
  cancelMessage(world, canceled.id);
  const other = otherArtist(world);
  const foreign = seedMessages(other, 1)[0]!;
  await world.fan.signIn(context);
  for (const id of [canceled.id, foreign.id, randomUUID()]) {
    const response = await post(
      page.request,
      fanRepliesPath(world.artist.slug),
      payload('허구 답장', id),
    );
    expect(response.status()).toBe(403);
  }
  expect(replyRows(world)).toHaveLength(0);
});

test('invalid body, Unicode length, forbidden terms and personal contact content are rejected without a write', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  const endpoint = fanRepliesPath(world.artist.slug);
  for (const body of [
    '',
    '   ',
    '가'.repeat(101),
    '금칙예시',
    '010-1234-5678',
    'https://example.invalid',
  ]) {
    const response = await post(page.request, endpoint, payload(body));
    expect(response.status()).toBe(400);
  }
  for (const invalid of [
    { ...payload(), actorId: world.author.id },
    { body: '허구 답장', messageId: null },
    { ...payload(), messageId: 'invalid' },
    { ...payload(), operationId: 'invalid' },
  ]) {
    expect((await post(page.request, endpoint, invalid)).status()).toBe(400);
  }
  expect(replyRows(world)).toHaveLength(0);
  const unicode = await post(page.request, endpoint, payload('🎵'.repeat(100)));
  expect(unicode.status()).toBe(200);
  expect(replyRows(world)[0]!.body).toBe('🎵'.repeat(100));
});

test('malformed cursor and extra query fields cannot alter the own feed', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedReplies(world, 35);
  await world.fan.signIn(context);
  const first = await replyPage(page, world.artist.slug);
  expect(first.replies).toHaveLength(30);
  expect(first.nextCursor).not.toBeNull();
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=01',
    '?limit=1.5',
    '?limit=2&limit=3',
    '?cursor=bad!',
    '?cursor=eA',
    '?actorId=anything',
  ]) {
    expect(
      (
        await page.request.get(`${fanRepliesPath(world.artist.slug)}${query}`)
      ).status(),
    ).toBe(400);
  }
  const other = otherArtist(world);
  expect(
    (
      await page.request.get(
        `${fanRepliesPath(other.artist.slug)}?cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).status(),
  ).toBe(400);
});

test('rate quota is per fan across artists and exact retries do not spend it again', async ({
  world,
  page,
  context,
}) => {
  enableReplyPolicy(2);
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const other = otherArtist(world);
  await world.fan.signIn(context);
  const first = payload('첫 허구 답장');
  expect(
    (
      await post(page.request, fanRepliesPath(world.artist.slug), first)
    ).status(),
  ).toBe(200);
  expect(
    (
      await post(page.request, fanRepliesPath(world.artist.slug), first)
    ).status(),
  ).toBe(200);
  expect(replyQuota(world)).toBe(1);
  expect(
    (
      await post(
        page.request,
        fanRepliesPath(other.artist.slug),
        payload('둘째 허구 답장'),
      )
    ).status(),
  ).toBe(200);
  const exhausted = await post(
    page.request,
    fanRepliesPath(world.artist.slug),
    payload('셋째 허구 답장'),
  );
  expect(exhausted.status()).toBe(429);
  expect((await exhausted.json()).code).toBe('RATE_LIMITED');
  expect(replyQuota(world)).toBe(2);
  expect(replyRows(world)).toHaveLength(1);
  expect(replyRows(other)).toHaveLength(1);
  expect(replyPoints(world)).toBe(0);
  expect(replyEvents(world)).toBe(0);
});

test('missing moderation policy retains private history but disables actual sending', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const prior = seedReplies(world, 1)[0]!;
  disableReplyPolicy();
  await world.fan.signIn(context);
  const data = await replyPage(page, world.artist.slug);
  expect(data.sendReady).toBe(false);
  expect(data.replies[0]!.body).toBe(prior.body);
  const response = await post(
    page.request,
    fanRepliesPath(world.artist.slug),
    payload(),
  );
  expect(response.status()).toBe(503);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(
    page.getByText(messages.replies.unavailable, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: messages.replies.label }),
  ).toHaveCount(0);
  await expect(replyCards(page)).toHaveCount(1);
  await screenshot(page, info, 'reply-policy-unavailable');
});

async function openComposer(page: Page) {
  const input = page.getByRole('textbox', {
    name: messages.replies.label,
    exact: true,
  });
  if (
    await page
      .getByRole('button', { name: messages.replies.open, exact: true })
      .count()
  )
    await page
      .getByRole('button', { name: messages.replies.open, exact: true })
      .click();
  await expect(input).toBeVisible();
  return input;
}

test('validation failures and close/reopen preserve draft until a confirmed send', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  const input = await openComposer(page);
  await input.fill('가'.repeat(101));
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.errors.TOO_LONG, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('가'.repeat(101));
  await input.fill('금칙예시');
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.errors.FORBIDDEN_CONTENT, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('금칙예시');
  await screenshot(page, info, 'reply-forbidden-draft');
  await page
    .getByRole('button', { name: messages.replies.close, exact: true })
    .click();
  await expect(input).toHaveCount(0);
  await openComposer(page);
  await expect(input).toHaveValue('금칙예시');
  await input.fill('수정한 허구 응원');
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.sent, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('');
  expect(replyRows(world)).toHaveLength(1);
  expect(replyQuota(world)).toBe(1);
});

test('double tap while a real write response waits creates exactly one reply', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  const input = await openComposer(page);
  await input.fill('한 번만 보내는 허구 답장');
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect.poll(() => writes).toBe(1);
  const pending = page.getByRole('button', {
    name: messages.replies.sending,
    exact: true,
  });
  await expect(pending).toBeDisabled();
  await expect(input).toBeDisabled();
  await pending.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  expect(writes).toBe(1);
  release();
  await expect(replyCards(page)).toHaveCount(1);
  expect(replyRows(world)).toHaveLength(1);
  expect(replyQuota(world)).toBe(1);
});

test('lost acknowledgement locks immutable draft and explicit retry reconciles the same key after close', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  const input = await openComposer(page);
  const text = '응답을 잃어도 한 번인 허구 답장';
  await input.fill(text);
  const writes: unknown[] = [];
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writes.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (writes.length === 1)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
        });
      return route.fulfill({ response });
    },
  );
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.uncertain, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue(text);
  await expect(input).toHaveAttribute('readonly', '');
  const committed = replyRows(world);
  expect(committed).toHaveLength(1);
  expect(replyQuota(world)).toBe(1);
  await screenshot(page, info, 'reply-unknown-result');
  await page
    .getByRole('button', { name: messages.replies.close, exact: true })
    .click();
  await openComposer(page);
  await expect(input).toHaveValue(text);
  await expect(input).toHaveAttribute('readonly', '');
  await page
    .getByRole('button', { name: messages.replies.retrySend, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.sent, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(replyRows(world)).toEqual(committed);
  expect(replyQuota(world)).toBe(1);
  expect(replyPoints(world)).toBe(0);
  expect(replyEvents(world)).toBe(0);
  await page.reload();
  await expect(replyCards(page)).toHaveCount(1);
  expect(replyRows(world)).toEqual(committed);
});

test('rate-limit inline feedback keeps an editable draft and accepted private history', async ({
  world,
  page,
  context,
}, info) => {
  enableReplyPolicy(1);
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  await post(
    page.request,
    fanRepliesPath(world.artist.slug),
    payload('이미 보낸 허구 답장'),
  );
  await page.goto(artistPreviewPath(world.artist.slug));
  const input = await openComposer(page);
  await input.fill('잠시 기다릴 허구 답장');
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.errors.RATE_LIMITED, { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue('잠시 기다릴 허구 답장');
  await expect(input).not.toHaveAttribute('readonly', '');
  await expect(replyCards(page)).toHaveCount(1);
  expect(replyQuota(world)).toBe(1);
  await screenshot(page, info, 'reply-rate-limit');
});

test('pagination failure retains own history and explicit retry appends only once', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedReplies(world, 35);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(replyCards(page)).toHaveCount(30);
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}?*`,
    async (route) => {
      requests++;
      if (requests === 1)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
        });
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  await page
    .getByRole('button', { name: messages.replies.older, exact: true })
    .click();
  await expect(
    page.getByText(messages.replies.errors.UNAVAILABLE, { exact: true }),
  ).toBeVisible();
  await expect(replyCards(page)).toHaveCount(30);
  await screenshot(page, info, 'reply-history-retry');
  await page
    .locator('.reply-panel')
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect.poll(() => requests).toBe(2);
  const pending = page.getByRole('button', {
    name: messages.replies.loadingOlder,
    exact: true,
  });
  await expect(pending).toBeDisabled();
  await pending.evaluate((el) => {
    (el as HTMLButtonElement).click();
    (el as HTMLButtonElement).click();
  });
  expect(requests).toBe(2);
  release();
  await expect(replyCards(page)).toHaveCount(35);
  const ids = await replyCards(page).evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-reply-id')),
  );
  expect(new Set(ids).size).toBe(35);
});

test('initial own-history request clears paid room when access is revoked before its authorization check', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const item = seedMessages(world, 1)[0]!;
  // Isolate this initial reply-read boundary from independent automatic chat
  // readmarks, which also correctly close the room after access loss.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: undefined,
    });
  });
  await world.fan.signIn(context);
  let began = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      began = true;
      await gate;
      await route.continue().catch(() => undefined);
    },
  );
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(page.getByText(item.text, { exact: true })).toBeVisible();
  await expect.poll(() => began).toBe(true);
  subscribe(world, 'expired');
  const rechecked = page.waitForResponse(
    (response) =>
      response.url() === `${appOrigin}${fanRepliesPath(world.artist.slug)}` &&
      response.request().method() === 'GET',
  );
  release();
  expect((await rechecked).status()).toBe(403);
  await expect(
    page.getByRole('heading', { name: messages.chat.errorTitle, exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await expect(replyCards(page)).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(replyRows(world)).toHaveLength(0);
  await screenshot(page, info, 'reply-initial-access-recheck');
});

for (const lost of [
  'session',
  'subscription',
  'restriction',
  'profile',
] as const) {
  test(`${lost} lost during compose clears all private room state and exposes a working recovery`, async ({
    world,
    page,
    context,
  }, info) => {
    await completeProfile(world.fan, world.artist);
    subscribe(world);
    seedReplies(world, 1);
    seedMessages(world, 1);
    await world.fan.signIn(context);
    await page.goto(artistPreviewPath(world.artist.slug));
    const input = await openComposer(page);
    await input.fill('절대 다음 화면에 남지 않을 허구 초안');
    if (lost === 'session') await context.clearCookies();
    else if (lost === 'subscription') subscribe(world, 'expired');
    else if (lost === 'restriction') restrict(world);
    else loseProfile(world);
    await page
      .getByRole('button', { name: messages.replies.send, exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: messages.chat.errorTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(replyCards(page)).toHaveCount(0);
    await expect(page.locator('[data-message-id]')).toHaveCount(0);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await screenshot(page, info, `reply-${lost}-recovery`);
    const link =
      lost === 'session'
        ? page.getByRole('link', { name: messages.chat.signIn, exact: true })
        : lost === 'profile'
          ? page.getByRole('link', { name: messages.chat.profile, exact: true })
          : lost === 'subscription'
            ? page.getByRole('link', {
                name: messages.chat.preview,
                exact: true,
              })
            : page.getByRole('link', {
                name: messages.chat.subscriptions,
                exact: true,
              });
    const target =
      lost === 'session'
        ? routes.start
        : lost === 'profile'
          ? routes.onboarding
          : lost === 'subscription'
            ? artistPreviewPath(world.artist.slug)
            : routes.subscriptions;
    await expect(link).toHaveAttribute('href', target);
    await link.click();
    if (lost === 'profile')
      await expect(page).toHaveURL(new RegExp(`${routes.onboarding}(?:/|$)`));
    else await expect(page).toHaveURL(new URL(target, appOrigin).href);
    if (lost === 'restriction') {
      // Account restrictions stop paid chat, not an owner's ability to inspect
      // and cancel existing billing. Preserve that established contract rather
      // than incorrectly forcing this management recovery to /restricted.
      await expect(
        page.getByRole('heading', {
          name: messages.subscriptions.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: messages.subscriptions.open.replace(
            '{name}',
            world.artist.name,
          ),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', {
          name: messages.chat.open.replace('{name}', world.artist.name),
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(replyCards(page)).toHaveCount(0);
      await expect(page.locator('[data-message-id]')).toHaveCount(0);
      await screenshot(page, info, 'reply-restricted-owner-subscriptions');
    }
    if (lost === 'subscription')
      await expect(
        page.getByRole('heading', {
          name: messages.artists.previewTitle.replace(
            '{name}',
            world.artist.name,
          ),
          exact: true,
        }),
      ).toBeVisible();
    await expect(
      page.getByText('절대 다음 화면에 남지 않을 허구 초안', { exact: true }),
    ).toHaveCount(0);
  });
}

test('superseded older response cannot paint another page and Back/Forward never restores a private draft', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedReplies(world, 35);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  const input = await openComposer(page);
  await input.fill('뒤로가기에 남기지 않는 허구 초안');
  await expect(replyCards(page)).toHaveCount(30);
  let began = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}?*`,
    async (route) => {
      began = true;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    },
  );
  await page
    .getByRole('button', { name: messages.replies.older, exact: true })
    .click();
  await expect.poll(() => began).toBe(true);
  await page
    .getByRole('link', { name: messages.chat.subscriptions, exact: true })
    .click();
  await expect(page).toHaveURL(new URL(routes.subscriptions, appOrigin).href);
  release();
  await expect(replyCards(page)).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: messages.replies.label }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(
    new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
  );
  await expect(await openComposer(page)).toHaveValue('');
  await expect(replyCards(page)).toHaveCount(30);
  await page.goForward();
  await expect(page).toHaveURL(new URL(routes.subscriptions, appOrigin).href);
  await expect(replyCards(page)).toHaveCount(0);
});

test('leaving while a write acknowledgement waits reloads committed history without an automatic duplicate', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await (await openComposer(page)).fill('이동 중에도 한 번만 보낸 허구 답장');
  let writes = 0;
  let committed = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${fanRepliesPath(world.artist.slug)}`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++;
      const response = await route.fetch();
      committed = true;
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    },
  );
  await page
    .getByRole('button', { name: messages.replies.send, exact: true })
    .click();
  await expect.poll(() => committed).toBe(true);
  expect(replyRows(world)).toHaveLength(1);
  await page
    .getByRole('link', { name: messages.chat.subscriptions, exact: true })
    .click();
  await expect(page).toHaveURL(new URL(routes.subscriptions, appOrigin).href);
  release();
  await page.goBack();
  await expect(page).toHaveURL(
    new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
  );
  await expect(replyCards(page)).toHaveCount(1);
  await expect(await openComposer(page)).toHaveValue('');
  expect(writes).toBe(1);
  expect(replyRows(world)).toHaveLength(1);
  expect(replyQuota(world)).toBe(1);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  for (const width of [360, 414, 1024]) {
    test(`actual reply composer, close/reopen and sent history fit ${scale} text at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await completeProfile(world.fan, world.artist, scale);
      subscribe(world);
      seedMessages(world, 1);
      await world.fan.signIn(context);
      await page.goto(artistPreviewPath(world.artist.slug));
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      const input = await openComposer(page);
      const body =
        '허구 응원이에요. <strong>글자 그대로</strong> 🎵 오래오래 좋은 노래 들려주세요.';
      await input.fill(body);
      await expect(
        page.getByText(
          messages.replies.count
            .replace('{count}', String(Array.from(body).length))
            .replace('{max}', '100'),
          { exact: true },
        ),
      ).toBeVisible();
      await screenshot(page, info, `reply-compose-${scale}-${width}`);
      for (const control of await page
        .locator('.reply-panel button,.reply-panel textarea')
        .all()) {
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(48);
        expect(
          await control.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      await page
        .getByRole('button', { name: messages.replies.close, exact: true })
        .click();
      await expect(input).toHaveCount(0);
      await openComposer(page);
      await expect(input).toHaveValue(body);
      await page
        .getByRole('button', { name: messages.replies.send, exact: true })
        .click();
      await expect(
        page.getByText(messages.replies.sent, { exact: true }),
      ).toBeVisible();
      await expect(replyCards(page)).toHaveCount(1);
      await expect(
        replyCards(page).getByText(body, { exact: true }),
      ).toBeVisible();
      await expect(replyCards(page).locator('strong')).toHaveCount(0);
      await expect(input).toHaveValue('');
      await screenshot(page, info, `reply-sent-${scale}-${width}`);
      expect(replyRows(world)).toHaveLength(1);
      expect(replyRows(world)[0]!.messageId).toBeNull();
      expect(replyQuota(world)).toBe(1);
    });
  }
}

test('authenticated operations remain actor-owned and artists or anonymous sessions cannot use fan reply APIs', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const other = await extraFan(world);
  const input = payload('서로 다른 허구 팬의 독립 답장');
  const endpoint = fanRepliesPath(world.artist.slug);
  await world.fan.signIn(context);
  const first = await post(page.request, endpoint, input);
  expect(first.status()).toBe(200);
  const firstId = (await first.json()).data.reply.id;
  await other.fan.signIn(context);
  const second = await post(page.request, endpoint, input);
  expect(second.status()).toBe(200);
  expect((await second.json()).data.reply.id).not.toBe(firstId);
  const feed = await replyPage(page, world.artist.slug);
  expect(feed.replies).toHaveLength(1);
  expect(feed.replies[0]!.id).not.toBe(firstId);
  await world.author.signIn(context);
  expect((await page.request.get(endpoint)).status()).toBe(403);
  expect((await post(page.request, endpoint, payload())).status()).toBe(403);
  await context.clearCookies();
  expect((await page.request.get(endpoint)).status()).toBe(401);
  expect((await post(page.request, endpoint, payload())).status()).toBe(401);
  expect(replyRows(world)).toHaveLength(1);
  expect(replyRows(other)).toHaveLength(1);
});
