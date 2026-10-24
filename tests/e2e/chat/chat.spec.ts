import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  callName,
  preparePolicies,
  completeProfile,
  seedMessages,
  seedExcludedMessages,
  addPreview,
  subscribe,
  readRows,
  restrict,
  cancelMessage,
  post,
  preparePhoto,
  blockExternal,
  expectNoExternal,
  screenshot,
} from './fixtures';
import {
  artistPreviewPath,
  chatMessagesPath,
  chatReadPath,
  routes,
} from '../../../src/config/routes';
import type { ChatPage } from '../../../src/config/chat';
// Playwright's Node loader must not execute application runtime JSON imports.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);

function messageCards(page: Page) {
  return page.locator('[data-message-id]');
}
async function disableAutomaticReads(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: undefined,
    });
  });
}
async function chatResponse(page: Page, slug: string, query = '') {
  const response = await page.request.get(`${chatMessagesPath(slug)}${query}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as ChatPage;
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real personalized cursor pages preserve tied timestamps, order, history and safe DTOs', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const seeded = seedMessages(world, 35);
  seedExcludedMessages(world);
  await world.fan.signIn(context);
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const data = await chatResponse(
      page,
      world.artist.slug,
      `?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(data.artist.slug).toBe(world.artist.slug);
    expect(data.hasAccess).toBe(true);
    expect(data.readCount).toBe(0);
    expect(data.messages.length).toBeLessThanOrEqual(7);
    for (const item of data.messages) {
      expect(Object.keys(item).sort()).toEqual([
        'id',
        'kind',
        'media',
        'readAt',
        'sentAt',
        'text',
      ]);
      expect(item.text).toContain(callName);
      expect(item.text).not.toContain('{이름}');
      expect(item.readAt).toBeNull();
      expect(item.text).not.toContain('비공개');
      ids.push(item.id);
    }
    expect(JSON.stringify(data)).not.toMatch(
      /body_template|call_name|author_id|object_path|storage_object_id/,
    );
    cursor = data.nextCursor;
    pages += 1;
    expect(pages).toBeLessThanOrEqual(5);
  } while (cursor);
  expect(pages).toBe(5);
  expect(ids).toEqual(seeded.map(({ id }) => id));
  expect(new Set(ids).size).toBe(35);
  expect(readRows(world)).toEqual([]);
});

test('default first page has thirty rows and malformed cursor or limit requests fail without reads', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedMessages(world, 35);
  await world.fan.signIn(context);
  const first = await chatResponse(page, world.artist.slug);
  expect(first.messages).toHaveLength(30);
  expect(first.nextCursor).not.toBeNull();
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?limit=1.5',
    '?limit=01',
    '?limit=2&limit=3',
    '?cursor=bad!',
    '?cursor=eA',
    '?actorId=not-an-actor',
  ]) {
    const response = await page.request.get(
      `${chatMessagesPath(world.artist.slug)}${query}`,
    );
    expect(response.status()).toBe(400);
    expect((await response.json()).ok).toBe(false);
  }
  expect(readRows(world)).toEqual([]);
});

test('unsubscribed fan sees only the original preview and no paid read evidence', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  const paid = seedMessages(world, 1)[0]!;
  addPreview(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(
    page.getByRole('heading', {
      name: messages.artists.previewTitle.replace('{name}', world.artist.name),
    }),
  ).toBeVisible();
  await expect(
    page.getByText(`${callName} 님, 무료 허구 맛보기입니다.`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(paid.text, { exact: true })).toHaveCount(0);
  await expect(messageCards(page)).toHaveCount(0);
  expect(readRows(world)).toEqual([]);
});

for (const status of ['active', 'grace', 'canceled'] as const) {
  test(`${status} subscription with current access opens the real chat`, async ({
    world,
    page,
    context,
  }) => {
    await completeProfile(world.fan, world.artist);
    subscribe(world, status);
    const item = seedMessages(world, 1)[0]!;
    await world.fan.signIn(context);
    await page.goto(artistPreviewPath(world.artist.slug));
    await expect(
      page.getByRole('heading', {
        name: messages.chat.title.replace('{name}', world.artist.name),
      }),
    ).toBeVisible();
    await expect(page.getByText(item.text, { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /보내기|답장 보내기/ }),
    ).toHaveCount(0);
  });
}

test('expired subscription falls back to preview without exposing paid history', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world, 'expired');
  const item = seedMessages(world, 1)[0]!;
  addPreview(world);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(
    page.getByRole('heading', {
      name: messages.artists.previewTitle.replace('{name}', world.artist.name),
    }),
  ).toBeVisible();
  await expect(page.getByText(item.text, { exact: true })).toHaveCount(0);
  expect(readRows(world)).toEqual([]);
});

test('SSR text stays literal and no IntersectionObserver means no inferred read', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const item = seedMessages(world, 1)[0]!;
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(messageCards(page)).toHaveCount(1);
  await expect(page.getByText(item.text, { exact: true })).toBeVisible();
  await expect(messageCards(page).locator('strong')).toHaveCount(0);
  expect(readRows(world)).toEqual([]);
  await messageCards(page)
    .getByRole('button', { name: messages.chat.markRead, exact: true })
    .click();
  await expect.poll(() => readRows(world).length).toBe(1);
  await expect(
    messageCards(page).getByText(messages.chat.read, { exact: true }),
  ).toBeVisible();
});

test('only intersecting messages are auto-read, not the full server page or older unseen pages', async ({
  world,
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const seeded = seedMessages(world, 35);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(messageCards(page)).toHaveCount(30);
  await messageCards(page).first().scrollIntoViewIfNeeded();
  await expect.poll(() => readRows(world).length).toBeGreaterThan(0);
  const before = readRows(world);
  expect(before.length).toBeLessThan(30);
  expect(before.map((row) => row.messageId)).not.toContain(seeded[29]!.id);
  expect(before.map((row) => row.messageId)).not.toContain(seeded[30]!.id);
  await page
    .locator(`[data-message-id="${seeded[29]!.id}"]`)
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() => readRows(world).map((row) => row.messageId))
    .toContain(seeded[29]!.id);
  expect(readRows(world).map((row) => row.messageId)).not.toContain(
    seeded[30]!.id,
  );
});

test('read replay is idempotent and count comes from authenticated database rows', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const [first, second] = seedMessages(world, 2);
  await world.fan.signIn(context);
  const endpoint = chatReadPath(world.artist.slug, first!.id);
  const original = await post(page.request, endpoint);
  expect(original.status()).toBe(200);
  const originalBody = await original.json();
  expect(originalBody.data).toMatchObject({
    messageId: first!.id,
    readCount: 1,
  });
  const replay = await post(page.request, endpoint);
  expect(await replay.json()).toEqual(originalBody);
  const next = await post(
    page.request,
    chatReadPath(world.artist.slug, second!.id),
  );
  expect((await next.json()).data.readCount).toBe(2);
  const invalid = await post(page.request, endpoint, {
    actorId: world.author.id,
    readCount: 100,
  });
  expect(invalid.status()).toBe(400);
  expect(readRows(world)).toHaveLength(2);
  const data = await chatResponse(page, world.artist.slug);
  expect(data.readCount).toBe(2);
  expect(data.messages.every((item) => item.readAt !== null)).toBe(true);
});

test('repeated older-page clicks issue one request and append without duplicate messages', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedMessages(world, 35);
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  let requests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${chatMessagesPath(world.artist.slug)}?*`,
    async (route) => {
      requests += 1;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
    },
  );
  const older = page.getByRole('button', {
    name: messages.chat.older,
    exact: true,
  });
  await older.click();
  await expect.poll(() => requests).toBe(1);
  const loading = page.getByRole('button', {
    name: messages.chat.loadingOlder,
    exact: true,
  });
  await expect(loading).toBeDisabled();
  await loading.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  expect(requests).toBe(1);
  release();
  await expect(messageCards(page)).toHaveCount(35);
  const ids = await messageCards(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-message-id')),
  );
  expect(new Set(ids).size).toBe(35);
  await expect(
    page.getByText(messages.chat.end, { exact: true }),
  ).toBeVisible();
});

test('temporary pagination failure keeps the page and supports explicit retry', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  seedMessages(world, 35);
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  let failures = 0;
  await page.route(
    `${appOrigin}${chatMessagesPath(world.artist.slug)}?*`,
    async (route) => {
      if (failures++ === 0)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
        });
      return route.continue();
    },
  );
  await page
    .getByRole('button', { name: messages.chat.older, exact: true })
    .click();
  await expect(
    page.getByText(messages.chat.errors.UNAVAILABLE, { exact: true }),
  ).toBeVisible();
  await expect(messageCards(page)).toHaveCount(30);
  await screenshot(page, info, 'pagination-retry');
  await page
    .getByRole('button', { name: messages.chat.older, exact: true })
    .click();
  await expect(messageCards(page)).toHaveCount(35);
});

test('lost read acknowledgement retries the same committed receipt without double counting', async ({
  world,
  page,
  context,
}, info) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const item = seedMessages(world, 1)[0]!;
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  let attempts = 0;
  await page.route(
    `${appOrigin}${chatReadPath(world.artist.slug, item.id)}`,
    async (route) => {
      attempts += 1;
      const response = await route.fetch();
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
        });
      return route.fulfill({ response });
    },
  );
  await messageCards(page)
    .getByRole('button', { name: messages.chat.markRead, exact: true })
    .click();
  await expect(
    page.getByText(messages.chat.readFailed, { exact: true }),
  ).toBeVisible();
  const committed = readRows(world);
  expect(committed).toHaveLength(1);
  await screenshot(page, info, 'read-acknowledgement-retry');
  await messageCards(page)
    .getByRole('button', { name: messages.chat.retryRead, exact: true })
    .click();
  await expect(
    messageCards(page).getByText(messages.chat.read, { exact: true }),
  ).toBeVisible();
  expect(readRows(world)).toEqual(committed);
  expect(attempts).toBe(2);
  await expect(
    page.getByText(messages.chat.readCount.replace('{count}', '1'), {
      exact: true,
    }),
  ).toBeVisible();
});

test('latest refresh removes canceled messages instead of retaining prior page state', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const seeded = seedMessages(world, 2);
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(messageCards(page)).toHaveCount(2);
  cancelMessage(world, seeded[0]!.id);
  await page
    .getByRole('button', { name: messages.chat.refresh, exact: true })
    .click();
  await expect(messageCards(page)).toHaveCount(1);
  await expect(page.getByText(seeded[0]!.text, { exact: true })).toHaveCount(0);
});

for (const lost of ['subscription', 'session', 'restriction'] as const) {
  test(`${lost} lost after loading clears the paid screen on recheck`, async ({
    world,
    page,
    context,
  }, info) => {
    await completeProfile(world.fan, world.artist);
    subscribe(world);
    const item = seedMessages(world, 1)[0]!;
    await disableAutomaticReads(page);
    await world.fan.signIn(context);
    await page.goto(artistPreviewPath(world.artist.slug));
    await expect(page.getByText(item.text, { exact: true })).toBeVisible();
    // The room now also loads the actor's own replies. Finish that initial
    // authorization request before revoking access so this case specifically
    // exercises the explicit chat refresh, not a detached-control race with
    // the independently fail-closed reply load.
    await expect(
      page.getByRole('heading', {
        name: messages.replies.history,
        exact: true,
      }),
    ).toBeVisible();
    if (lost === 'subscription') subscribe(world, 'expired');
    else if (lost === 'session') await context.clearCookies();
    else restrict(world);
    await page
      .getByRole('button', { name: messages.chat.refresh, exact: true })
      .click();
    await expect(messageCards(page)).toHaveCount(0);
    await expect(page.getByText(item.text, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    expect(readRows(world)).toEqual([]);
    await screenshot(page, info, `${lost}-lost`);
  });
}

test('navigation while an older request is pending cannot paint it into the next screen', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  const seeded = seedMessages(world, 35);
  await disableAutomaticReads(page);
  await world.fan.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  let began = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${appOrigin}${chatMessagesPath(world.artist.slug)}?*`,
    async (route) => {
      began = true;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => undefined);
    },
  );
  await page
    .getByRole('button', { name: messages.chat.older, exact: true })
    .click();
  await expect.poll(() => began).toBe(true);
  await page.goto(routes.artists);
  release();
  await expect(page).toHaveURL(new RegExp(`${routes.artists}$`));
  await expect(messageCards(page)).toHaveCount(0);
  await expect(page.getByText(seeded[34]!.text, { exact: true })).toHaveCount(
    0,
  );
  await page.goBack();
  await expect(page).toHaveURL(
    new RegExp(artistPreviewPath(world.artist.slug)),
  );
  await expect(
    page.getByRole('heading', {
      name: messages.chat.title.replace('{name}', world.artist.name),
    }),
  ).toBeVisible();
  await expect(messageCards(page)).toHaveCount(30);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  for (const width of [360, 414, 1024]) {
    test(`chat text, accepted media viewer and empty state fit ${scale} text at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await completeProfile(world.fan, world.artist, scale);
      subscribe(world);
      const seeded = seedMessages(world, 3);
      const photo = await preparePhoto(world, context, page.request);
      await world.fan.signIn(context);
      await page.goto(artistPreviewPath(world.artist.slug));
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(messageCards(page)).toHaveCount(4);
      await page
        .getByRole('button', {
          name: messages.media.open.replace(
            '{kind}',
            messages.artists.messageKinds.photo,
          ),
          exact: true,
        })
        .click();
      const image = page.getByRole('img', { name: messages.media.photoAlt });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) => (element as HTMLImageElement).naturalWidth,
          ),
        )
        .toBe(320);
      await screenshot(page, info, `chat-${scale}-${width}`);
      for (const item of [...seeded, photo]) cancelMessage(world, item.id);
      await page
        .getByRole('button', { name: messages.chat.refresh, exact: true })
        .click();
      await expect(
        page.getByText(messages.chat.emptyTitle, { exact: true }),
      ).toBeVisible();
      await expect(messageCards(page)).toHaveCount(0);
      await screenshot(page, info, `empty-${scale}-${width}`);
    });
  }
}

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  test(`subscription list room link fits ${scale} text at 360px and opens the matching chat`, async ({
    world,
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 360, height: 900 });
    await completeProfile(world.fan, world.artist, scale);
    subscribe(world);
    const item = seedMessages(world, 1)[0]!;
    await world.fan.signIn(context);
    await page.goto(routes.subscriptions);
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
    await expect(
      page.getByRole('heading', {
        name: messages.subscriptions.title,
        exact: true,
      }),
    ).toBeVisible();
    const roomLink = page.getByRole('link', {
      name: messages.chat.open.replace('{name}', world.artist.name),
      exact: true,
    });
    await expect(roomLink).toBeVisible();
    await expect(roomLink).toHaveAttribute(
      'href',
      artistPreviewPath(world.artist.slug),
    );
    expect(
      await roomLink.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await screenshot(page, info, `subscriptions-chat-link-${scale}-360`);
    await roomLink.click();
    await expect(page).toHaveURL(
      new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
    );
    await expect(
      page.getByRole('heading', {
        name: messages.chat.title.replace('{name}', world.artist.name),
        exact: true,
      }),
    ).toBeVisible();
    await expect(messageCards(page)).toHaveCount(1);
    await expect(page.getByText(item.text, { exact: true })).toBeVisible();
  });
}
