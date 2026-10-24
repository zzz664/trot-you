import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIRequestContext,
  BrowserContext,
  Dialog,
  Page,
} from '@playwright/test';
import {
  test,
  expect,
  storageOrigin,
  callName,
  preparePolicies,
  completeProfile,
  createIdentity,
  subscribe,
  setFont,
  restrict,
  removeMembership,
  pauseArtist,
  inspectDrafts,
  disableMessagePolicy,
  mediaRowCount,
  imageBytes,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  readRows,
  notificationRows,
  enableFictionalNotifications,
  invokeDispatch,
  makeScheduledDue,
  closeCancelWindow,
  ageDispatchRateWindow,
  disableNotifications,
  showDispatchError,
  clearRestriction,
  resumeArtist,
  addHistoryArtists,
  addMembership,
  type World,
} from './fixtures';
import {
  artistComposeApiPath,
  artistComposePath,
  artistDispatchApiPath,
  artistDispatchPath,
  artistPreviewPath,
  chatMessagesPath,
  chatReadPath,
  routes,
} from '../../../src/config/routes';
import type {
  ComposeDraft,
  ComposeKind,
} from '../../../src/config/artist-compose';
import type {
  DispatchMessage,
  DispatchPageData,
  DispatchSubmitInput,
} from '../../../src/config/message-dispatch';
import type { ChatPage } from '../../../src/config/chat';

// Playwright's Node loader must not execute application JSON runtime imports.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const composeCopy = messages.artistCompose;
function endpoint(world: World, action?: 'submit' | 'cancel') {
  return artistDispatchApiPath(world.artist.slug, action);
}
async function save(
  request: APIRequestContext,
  world: World,
  body: string | null = '허구 {이름} 님, 함께해요.',
  kind: ComposeKind = 'text',
) {
  const response = await post(
    request,
    artistComposeApiPath(world.artist.slug, 'save'),
    {
      messageId: randomUUID(),
      operationId: randomUUID(),
      expectedRevision: 0,
      kind,
      body,
      mediaIds: [],
    },
  );
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as ComposeDraft;
}
function submitInput(
  draft: ComposeDraft,
  scheduledAt: string | null = null,
): Omit<DispatchSubmitInput, 'slug'> {
  return {
    messageId: draft.id,
    operationId: randomUUID(),
    expectedRevision: draft.revision,
    scheduledAt,
    confirmed: true,
  };
}
async function submit(
  request: APIRequestContext,
  world: World,
  input: Omit<DispatchSubmitInput, 'slug'>,
) {
  const response = await post(request, endpoint(world, 'submit'), input);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as DispatchMessage;
}
async function history(
  request: APIRequestContext,
  world: World,
  messageId: string | null = null,
  cursor?: string,
) {
  const response = await post(request, endpoint(world), {
    messageId,
    ...(cursor ? { cursor } : {}),
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as DispatchPageData;
}
async function cancel(
  request: APIRequestContext,
  world: World,
  messageId: string,
  operationId = randomUUID(),
) {
  const response = await post(request, endpoint(world, 'cancel'), {
    messageId,
    operationId,
    confirmed: true,
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as DispatchMessage;
}
async function fanMessages(request: APIRequestContext, world: World) {
  const response = await request.get(chatMessagesPath(world.artist.slug));
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as ChatPage;
}
async function expectExpiredFanDenied(
  request: APIRequestContext,
  world: World,
) {
  const response = await request.get(chatMessagesPath(world.artist.slug));
  // The paid-feed HTTP contract intentionally rejects lost access rather than
  // returning a successful empty page or silently switching to preview data.
  expect(response.status()).toBe(403);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({
    ok: false,
    code: 'SUBSCRIPTION_REQUIRED',
  });
}
async function expectFailure(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(await response.json()).toEqual({ ok: false, code });
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('saved draft publication requires explicit confirmation and preserves current-state idempotency', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await enableFictionalNotifications(world.fan);
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  const intent = submitInput(draft);
  const unconfirmed = {
    messageId: intent.messageId,
    operationId: intent.operationId,
    expectedRevision: intent.expectedRevision,
    scheduledAt: intent.scheduledAt,
  };
  await expectFailure(
    await post(page.request, endpoint(world, 'submit'), unconfirmed),
    400,
    'INVALID_INPUT',
  );
  expect(inspectDrafts(world)[0]?.status).toBe('draft');
  const result = await submit(page.request, world, intent);
  expect(result.status).toBe('sent');
  expect(result.notificationState).toBe('queued');
  expect(result.canCancel).toBe(true);
  expect(result.sentAt).not.toBeNull();
  expect(await submit(page.request, world, intent)).toEqual(result);
  expect(notificationRows(draft.id)).toEqual([
    {
      id: expect.any(String),
      userId: world.fan.id,
      state: 'queued',
      attemptCount: 0,
      acceptedAt: null,
    },
  ]);
  await expectFailure(
    await post(page.request, endpoint(world, 'submit'), {
      ...intent,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const visible = await history(page.request, world, draft.id);
  expect(visible.selectedMessage).toEqual(result);
  expect(JSON.stringify(visible)).not.toMatch(
    /device_id|user_id|endpoint|service_role|object_path|bucket|body_template|p256dh/,
  );
  await world.fan.signIn(context);
  const chat = await fanMessages(page.request, world);
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0]).toMatchObject({
    id: draft.id,
    text: `허구 ${callName} 님, 함께해요.`,
  });
  expect(JSON.stringify(chat)).not.toContain('{이름}');
  const fanPost = await post(page.request, endpoint(world, 'submit'), intent);
  await expectFailure(fanPost, 403, 'FORBIDDEN');
});

test('scheduled message selects recipients when published and protected worker replay does not duplicate jobs', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  await enableFictionalNotifications(world.fan);
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const intent = submitInput(draft, future);
  expect((await submit(page.request, world, intent)).status).toBe('scheduled');
  expect(notificationRows(draft.id)).toEqual([]);
  await invokeDispatch(page.request);
  expect(
    (await history(page.request, world, draft.id)).selectedMessage?.status,
  ).toBe('scheduled');
  subscribe(world, 'canceled'); // Paid canceled access remains eligible at execution.
  makeScheduledDue(world, draft.id);
  await Promise.all([
    invokeDispatch(page.request),
    invokeDispatch(page.request),
  ]);
  const sent = (await history(page.request, world, draft.id)).selectedMessage!;
  expect(sent.status).toBe('sent');
  expect(notificationRows(draft.id)).toHaveLength(1);
  await invokeDispatch(page.request);
  expect(
    (await history(page.request, world, draft.id)).selectedMessage?.sentAt,
  ).toBe(sent.sentAt);
  expect(notificationRows(draft.id)[0]).toMatchObject({
    state: 'queued',
    attemptCount: 0,
    acceptedAt: null,
  });
  await world.fan.signIn(context);
  expect(
    (await fanMessages(page.request, world)).messages.map((item) => item.id),
  ).toEqual([draft.id]);
});

test('cancellation hides a published message, retains read evidence and cancels only queued notifications', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await enableFictionalNotifications(world.fan);
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  const intent = submitInput(draft);
  await submit(page.request, world, intent);
  await world.fan.signIn(context);
  const read = await post(
    page.request,
    chatReadPath(world.artist.slug, draft.id),
    {},
  );
  expect(read.status()).toBe(200);
  const before = readRows(world);
  expect(before).toHaveLength(1);
  await world.author.signIn(context);
  const operationId = randomUUID();
  const canceled = await cancel(page.request, world, draft.id, operationId);
  expect(canceled.status).toBe('canceled');
  expect(canceled.canCancel).toBe(false);
  expect(await cancel(page.request, world, draft.id, operationId)).toEqual(
    canceled,
  );
  expect((await submit(page.request, world, intent)).status).toBe('canceled');
  expect(notificationRows(draft.id)[0]).toMatchObject({
    state: 'canceled',
    attemptCount: 0,
    acceptedAt: null,
  });
  expect(readRows(world)).toEqual(before);
  await world.fan.signIn(context);
  expect((await fanMessages(page.request, world)).messages).toEqual([]);
  expect(
    (
      await post(page.request, chatReadPath(world.artist.slug, draft.id), {})
    ).ok(),
  ).toBe(false);
});

test('cancel-before-publication and exclusive expired window preserve the correct lifecycle', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  await submit(
    page.request,
    world,
    submitInput(draft, new Date(Date.now() + 86_400_000).toISOString()),
  );
  await cancel(page.request, world, draft.id);
  makeScheduledDue(world, draft.id);
  await invokeDispatch(page.request);
  const canceled = (await history(page.request, world, draft.id))
    .selectedMessage!;
  expect(canceled.status).toBe('canceled');
  expect(canceled.sentAt).toBeNull();
  expect(notificationRows(draft.id)).toEqual([]);
  const sent = await save(page.request, world, '취소 기한 확인용 허구 본문');
  await submit(page.request, world, submitInput(sent));
  closeCancelWindow(world, sent.id);
  expect(
    (await history(page.request, world, sent.id)).selectedMessage?.canCancel,
  ).toBe(false);
  await expectFailure(
    await post(page.request, endpoint(world, 'cancel'), {
      messageId: sent.id,
      operationId: randomUUID(),
      confirmed: true,
    }),
    409,
    'CANCEL_WINDOW_PASSED',
  );
  expect(
    (await history(page.request, world, sent.id)).selectedMessage?.status,
  ).toBe('sent');
});

test('current revision, ownership, membership and future-time checks fail before publication', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  const stale = submitInput(draft);
  const saved = await post(
    page.request,
    artistComposeApiPath(world.artist.slug, 'save'),
    {
      messageId: draft.id,
      operationId: randomUUID(),
      expectedRevision: draft.revision,
      kind: draft.kind,
      body: '수정한 허구 {이름} 인사',
      mediaIds: [],
    },
  );
  expect(saved.status()).toBe(200);
  await expectFailure(
    await post(page.request, endpoint(world, 'submit'), stale),
    409,
    'CONFLICT',
  );
  const fresh = (await saved.json()).data as ComposeDraft;
  await expectFailure(
    await post(
      page.request,
      endpoint(world, 'submit'),
      submitInput(fresh, new Date(Date.now() - 60_000).toISOString()),
    ),
    400,
    'INVALID_INPUT',
  );
  await world.outsider.signIn(context);
  expect(
    (
      await post(page.request, endpoint(world, 'submit'), submitInput(fresh))
    ).ok(),
  ).toBe(false);
  await world.author.signIn(context);
  removeMembership(world);
  expect(
    (
      await post(page.request, endpoint(world, 'submit'), submitInput(fresh))
    ).ok(),
  ).toBe(false);
  expect(inspectDrafts(world)[0]?.status).toBe('draft');
  expect(notificationRows(draft.id)).toEqual([]);
});

test('worker authentication rejects caller-controlled query, body and unrelated bearer before DB work', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  await submit(
    page.request,
    world,
    submitInput(draft, new Date(Date.now() + 86_400_000).toISOString()),
  );
  makeScheduledDue(world, draft.id);
  for (const headers of [
    {},
    { Authorization: 'Bearer wrong-dispatch-worker-credential' },
  ])
    expect(
      (await page.request.post(routes.dispatchMessages, { headers })).status(),
    ).toBe(401);
  const headers = {
    Authorization: `Bearer ${process.env.MESSAGE_DISPATCH_CRON_SECRET}`,
  };
  expect(
    (
      await page.request.post(`${routes.dispatchMessages}?limit=10000`, {
        headers,
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post(routes.dispatchMessages, {
        headers,
        data: { actorId: world.author.id },
      })
    ).status(),
  ).toBe(400);
  expect(
    (await history(page.request, world, draft.id)).selectedMessage?.status,
  ).toBe('scheduled');
  await invokeDispatch(page.request);
  expect(
    (await history(page.request, world, draft.id)).selectedMessage?.status,
  ).toBe('sent');
});

test('notification configuration missing still publishes in-app without pretending a provider accepted anything', async ({
  world,
  page,
  context,
}) => {
  disableNotifications();
  await completeProfile(world.fan, world.artist);
  subscribe(world, 'grace');
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  const published = await submit(page.request, world, submitInput(draft));
  expect(published.status).toBe('sent');
  expect(published.notificationState).toBe('not_queued');
  expect(notificationRows(draft.id)).toEqual([]);
  await world.fan.signIn(context);
  expect(
    (await fanMessages(page.request, world)).messages.map((row) => row.id),
  ).toEqual([draft.id]);
  subscribe(world, 'expired');
  await expectExpiredFanDenied(page.request, world);
  // Later opt-in cannot retroactively enqueue a previously completed snapshot.
  subscribe(world);
  await enableFictionalNotifications(world.fan);
  await world.author.signIn(context);
  await invokeDispatch(page.request);
  expect(notificationRows(draft.id)).toEqual([]);
});

test('history keyset pagination retains all owned records and exact older selection outside the first page', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const ids: string[] = [];
  const future = new Date(Date.now() + 86_400_000).toISOString();
  for (let index = 0; index < 32; index += 1) {
    if (index > 0 && index % 15 === 0) ageDispatchRateWindow(world);
    const draft = await save(
      page.request,
      world,
      `허구 예약 목록 ${String(index + 1).padStart(2, '0')}`,
    );
    ids.push(draft.id);
    await submit(page.request, world, submitInput(draft, future));
  }
  const first = await history(page.request, world, ids[0]);
  expect(first.messages).toHaveLength(30);
  expect(first.hasMore).toBe(true);
  expect(first.selectedMessage?.id).toBe(ids[0]);
  expect(first.messages.map((row) => row.id)).not.toContain(ids[0]);
  const second = await history(page.request, world, null, first.nextCursor!);
  expect(second.messages).toHaveLength(2);
  expect(second.hasMore).toBe(false);
  expect(second.nextCursor).toBeNull();
  expect(
    new Set([...first.messages, ...second.messages].map((row) => row.id)),
  ).toEqual(new Set(ids));
  await expectFailure(
    await post(page.request, endpoint(world), {
      messageId: null,
      cursor: 'invalid-cursor',
    }),
    400,
    'INVALID_INPUT',
  );
});

test('ordinary photo upload is reused by published personalized fan content without another object or provider send', async ({
  world,
  page,
  context,
}) => {
  await completeProfile(world.fan, world.artist);
  subscribe(world);
  await world.author.signIn(context);
  const draft = await save(
    page.request,
    world,
    '{이름} 님, 허구 사진 인사입니다.',
    'photo',
  );
  const bytes = await imageBytes();
  const begun = await post(page.request, routes.mediaUpload, {
    requestId: randomUUID(),
    messageId: draft.id,
    mimeType: 'image/png',
    byteSize: bytes.length,
  });
  expect(begun.status()).toBe(200);
  const ticket = (await begun.json()).data as {
    uploadId: string;
    uploadUrl: string;
  };
  expect(new URL(ticket.uploadUrl).origin).toBe(storageOrigin);
  expect(
    (
      await page.request.put(ticket.uploadUrl, {
        headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' },
        data: bytes,
        maxRedirects: 0,
      })
    ).ok(),
  ).toBe(true);
  const completed = await post(page.request, routes.mediaComplete, {
    uploadId: ticket.uploadId,
  });
  expect(completed.status()).toBe(200);
  const mediaId = (await completed.json()).data.mediaId as string;
  const draftResponse = await post(
    page.request,
    artistComposeApiPath(world.artist.slug),
    { messageId: draft.id },
  );
  expect(draftResponse.status()).toBe(200);
  const currentDraft = (await draftResponse.json()).data
    .selectedDraft as ComposeDraft;
  const published = await submit(
    page.request,
    world,
    submitInput(currentDraft),
  );
  expect(published.media.map((media) => media.id)).toEqual([mediaId]);
  expect(mediaRowCount(draft.id)).toBe(1);
  await world.fan.signIn(context);
  const chat = await fanMessages(page.request, world);
  expect(chat.messages[0]).toMatchObject({
    id: draft.id,
    text: `${callName} 님, 허구 사진 인사입니다.`,
    media: [{ id: mediaId, kind: 'photo', availability: 'available' }],
  });
  const signed = await post(page.request, routes.mediaRead, {
    mediaId,
    preview: false,
  });
  expect(signed.status()).toBe(200);
  const grant = (await signed.json()).data;
  expect(new URL(grant.url).origin).toBe(storageOrigin);
  expect((await page.request.get(grant.url, { maxRedirects: 0 })).ok()).toBe(
    true,
  );
  expect(mediaRowCount(draft.id)).toBe(1);
  await world.author.signIn(context);
  await cancel(page.request, world, draft.id);
  await world.fan.signIn(context);
  expect((await fanMessages(page.request, world)).messages).toEqual([]);
  expect(
    (
      await post(page.request, routes.mediaRead, { mediaId, preview: false })
    ).ok(),
  ).toBe(false);
  // Existing signed capability is not asserted revoked; normal expiry remains.
});

const copy = messages.artistDispatch;
const panel = (page: Page) =>
  page.getByRole('region', { name: copy.title, exact: true });
const historyPanel = (page: Page) =>
  panel(page).getByRole('region', { name: copy.history, exact: true });
const receiptPanel = (page: Page) =>
  panel(page).getByRole('region', { name: copy.receipt, exact: true });
const textInput = (page: Page) =>
  page.getByRole('textbox', { name: composeCopy.body, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
async function openComposer(page: Page, context: BrowserContext, world: World) {
  await world.author.signIn(context);
  await page.goto(routes.artist);
  const link = page.locator(
    `a[href="${artistComposePath(world.artist.slug)}"]`,
  );
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(artistComposePath(world.artist.slug));
  await expect(textInput(page)).toBeVisible();
  await expect(panel(page)).toBeVisible();
}
async function saveFromUi(page: Page, body = '허구 {이름} 님, 함께해요.') {
  await textInput(page).fill(body);
  await button(page, composeCopy.save).click();
  await expect(
    page.getByText(composeCopy.saved, { exact: true }),
  ).toBeVisible();
  await expect(button(page, copy.submit)).toBeEnabled();
}
async function submitFromUi(page: Page) {
  await button(page, copy.submit).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: copy.confirmSubmit, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
async function reloadUncertain(page: Page) {
  const acceptReload = async (dialog: Dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  };
  page.on('dialog', acceptReload);
  try {
    await page.reload();
  } finally {
    page.off('dialog', acceptReload);
  }
}
function nextKstMinute() {
  return new Date(Date.now() + 86_400_000 + 9 * 3_600_000)
    .toISOString()
    .slice(0, 16);
}

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`dispatch lifecycle, confirmations, KST, history and fan view fit ${scale} at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await completeProfile(world.fan, world.artist, scale);
      subscribe(world);
      await enableFictionalNotifications(world.fan);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const contextRoute = `**${endpoint(world)}`;
      await page.route(contextRoute, async (route) => {
        await gate;
        await route.continue();
      });
      await openComposer(page, context, world);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(
        panel(page).getByText(copy.loading, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `loading-${scale}-${width}`);
      release();
      await expect(
        panel(page).getByText(copy.empty, { exact: true }),
      ).toBeVisible();
      await page.unroute(contextRoute);
      await expect(button(page, copy.submit)).toBeDisabled();
      await screenshot(page, info, `empty-${scale}-${width}`);
      await textInput(page).fill('저장 전 허구 초안');
      await expect(button(page, copy.submit)).toBeDisabled();
      await screenshot(page, info, `dirty-disabled-${scale}-${width}`);
      await saveFromUi(page);
      const first = inspectDrafts(world)[0]!;
      const savedPath = artistComposePath(world.artist.slug, first.id);
      await expect(page).toHaveURL(savedPath);
      await screenshot(page, info, `saved-ready-${scale}-${width}`);
      await button(page, copy.submit).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(
        page.getByRole('dialog').getByRole('heading', {
          name: copy.confirmImmediateTitle,
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(page, info, `immediate-confirmation-${scale}-${width}`);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.stay, exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(inspectDrafts(world)[0]?.status).toBe('draft');
      await expect(button(page, copy.submit)).toBeFocused();
      await submitFromUi(page);
      await expect(
        receiptPanel(page).getByRole('heading', {
          name: copy.statuses.sent,
          exact: true,
        }),
      ).toBeVisible();
      await expect(textInput(page)).toHaveValue('');
      await expect(button(page, copy.submit)).toBeDisabled();
      await expect(
        receiptPanel(page).getByText(copy.notifications.queued, {
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(page, info, `published-${scale}-${width}`);
      expect(notificationRows(first.id)[0]).toMatchObject({
        state: 'queued',
        attemptCount: 0,
        acceptedAt: null,
      });

      // Real fan route renders server-personalized text at the same scale.
      await world.fan.signIn(context);
      await page.goto(artistPreviewPath(world.artist.slug));
      const fanCard = page.locator(`[data-message-id="${first.id}"]`);
      const personalizedBody = fanCard.getByText(
        `허구 ${callName} 님, 함께해요.`,
        { exact: true },
      );
      await expect(fanCard).toContainText(`허구 ${callName} 님, 함께해요.`);
      // A DOM text match alone can precede hydration/read-ack layout changes.
      // Bring the actual body into view and settle the real read operation
      // before recording both the page and an independently bounded full card.
      await personalizedBody.scrollIntoViewIfNeeded();
      await expect(personalizedBody).toBeVisible();
      await expect(personalizedBody).toBeInViewport();
      await expect(fanCard.locator('.chat-read-status')).toHaveText(
        messages.chat.read,
      );
      await expect(
        fanCard.getByRole('button', {
          name: messages.chat.markRead,
          exact: true,
        }),
      ).toHaveCount(0);
      expect(readRows(world)).toEqual([
        { messageId: first.id, readAt: expect.any(String) },
      ]);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
      await screenshot(page, info, `fan-published-${scale}-${width}`);
      await fanCard.screenshot({
        path: info.outputPath(`fan-published-card-${scale}-${width}.png`),
      });
      await world.author.signIn(context);
      // A bookmarked former draft recovers exact dispatch state, not an editor
      // containing an immutable message or an accidental new draft copy.
      await page.goto(savedPath);
      await expect(textInput(page)).toHaveValue('');
      await expect(
        receiptPanel(page).locator(`[data-dispatch-id="${first.id}"]`),
      ).toHaveAttribute('data-dispatch-status', 'sent');
      await screenshot(page, info, `submitted-bookmark-${scale}-${width}`);
      const item = historyPanel(page).locator(
        `[data-dispatch-id="${first.id}"]`,
      );
      await item
        .getByRole('button', { name: copy.cancelMessage, exact: true })
        .click();
      await expect(
        page
          .getByRole('dialog')
          .getByRole('heading', { name: copy.cancelTitle, exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `cancel-confirmation-${scale}-${width}`);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.stay, exact: true })
        .click();
      expect(
        (await history(page.request, world, first.id)).selectedMessage?.status,
      ).toBe('sent');
      await item
        .getByRole('button', { name: copy.cancelMessage, exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.confirmCancel, exact: true })
        .click();
      await expect(item).toHaveAttribute('data-dispatch-status', 'canceled');
      await screenshot(page, info, `canceled-${scale}-${width}`);

      await saveFromUi(page, '예약하는 허구 {이름} 인사');
      const scheduled = inspectDrafts(world).find(
        (row) => row.status === 'draft',
      )!;
      await button(page, copy.scheduled).click();
      await expect(
        page.getByLabel(copy.scheduleDateLabel, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel(copy.scheduleTimeLabel, { exact: true }),
      ).toBeVisible();
      await button(page, copy.submit).click();
      await expect(panel(page).getByRole('alert')).toHaveText(
        copy.invalidSchedule,
      );
      await screenshot(page, info, `schedule-invalid-${scale}-${width}`);
      const local = nextKstMinute();
      const [date, time] = local.split('T');
      await page
        .getByLabel(copy.scheduleDateLabel, { exact: true })
        .fill(date!);
      await page
        .getByLabel(copy.scheduleTimeLabel, { exact: true })
        .fill(time!);
      await expect(
        page.getByLabel(copy.scheduleDateLabel, { exact: true }),
      ).toHaveValue(date!);
      await expect(
        page.getByLabel(copy.scheduleTimeLabel, { exact: true }),
      ).toHaveValue(time!);
      await button(page, copy.submit).click();
      await expect(
        page.getByRole('dialog').getByRole('heading', {
          name: copy.confirmScheduleTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText('KST');
      await screenshot(page, info, `schedule-confirmation-${scale}-${width}`);
      const submitted = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === endpoint(world, 'submit') &&
          response.request().method() === 'POST',
      );
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.confirmSubmit, exact: true })
        .click();
      const accepted = await submitted;
      expect(accepted.request().postDataJSON().scheduledAt).toBe(
        new Date(`${local}:00+09:00`).toISOString(),
      );
      await expect(
        receiptPanel(page).getByRole('heading', {
          name: copy.statuses.scheduled,
          exact: true,
        }),
      ).toBeVisible();
      await expect(textInput(page)).toHaveValue('');
      await screenshot(page, info, `scheduled-${scale}-${width}`);
      makeScheduledDue(world, scheduled.id);
      await invokeDispatch(page.request);
      await button(page, copy.refresh).click();
      await expect(
        historyPanel(page).locator(`[data-dispatch-id="${scheduled.id}"]`),
      ).toHaveAttribute('data-dispatch-status', 'sent');
      closeCancelWindow(world, scheduled.id);
      await button(page, copy.refresh).click();
      const closed = historyPanel(page).locator(
        `[data-dispatch-id="${scheduled.id}"]`,
      );
      await expect(
        closed.getByRole('button', { name: copy.cancelMessage, exact: true }),
      ).toHaveCount(0);
      await expect(closed).toContainText('현재 취소할 수 없어요.');
      await screenshot(page, info, `cancel-window-ended-${scale}-${width}`);
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`dispatch recoverable errors and uncertain states fit ${scale} at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await openComposer(page, context, world);
      await expect(
        panel(page).getByText(copy.empty, { exact: true }),
      ).toBeVisible();
      await saveFromUi(page);
      const draftId = inspectDrafts(world)[0]!.id;
      const submitRoute = `**${endpoint(world, 'submit')}`;
      for (const [code, status] of [
        ['INVALID_INPUT', 400],
        ['NOT_FOUND', 404],
        ['CONFLICT', 409],
        ['MEDIA_PENDING', 409],
        ['CANCEL_WINDOW_PASSED', 409],
        ['RATE_LIMITED', 429],
        ['BACKPRESSURE', 503],
        ['SETUP_NOT_READY', 503],
      ] as const) {
        await page.route(submitRoute, (route) =>
          route.fulfill({
            status,
            headers: { 'cache-control': 'no-store' },
            json: { ok: false, code },
          }),
        );
        await submitFromUi(page);
        await expect(panel(page).getByRole('alert')).toHaveText(
          copy.errors[code],
        );
        await expect(button(page, copy.submit)).toBeEnabled();
        expect(
          inspectDrafts(world).find((row) => row.id === draftId)?.status,
        ).toBe('draft');
        await screenshot(
          page,
          info,
          `error-${code.toLowerCase()}-${scale}-${width}`,
        );
        await page.unroute(submitRoute);
      }
      // These are explicit transport-failure fixtures, not backend success.
      for (const code of ['IDEMPOTENCY_CONFLICT', 'UNAVAILABLE'] as const) {
        await page.route(submitRoute, (route) =>
          route.fulfill({
            status: code === 'UNAVAILABLE' ? 503 : 409,
            headers: { 'cache-control': 'no-store' },
            json: { ok: false, code },
          }),
        );
        await submitFromUi(page);
        await expect(panel(page).getByRole('alert')).toHaveText(
          copy.errors[code],
        );
        await expect(
          panel(page).getByText(copy.uncertain, { exact: true }),
        ).toBeVisible();
        await expect(button(page, copy.submit)).toBeDisabled();
        await expect(textInput(page)).toBeDisabled();
        await screenshot(
          page,
          info,
          `uncertain-${code.toLowerCase()}-${scale}-${width}`,
        );
        await page.unroute(submitRoute);
        await reloadUncertain(page);
        await expect(textInput(page)).toHaveValue('허구 {이름} 님, 함께해요.');
        await expect(button(page, copy.submit)).toBeEnabled();
      }
      const contextRoute = `**${endpoint(world)}`;
      for (const code of ['UNAVAILABLE', 'SETUP_NOT_READY'] as const) {
        await page.route(contextRoute, (route) =>
          route.fulfill({
            status: 503,
            headers: { 'cache-control': 'no-store' },
            json: { ok: false, code },
          }),
        );
        await button(page, copy.refresh).click();
        await expect(panel(page).getByRole('alert')).toHaveText(
          copy.errors[code],
        );
        await screenshot(
          page,
          info,
          `history-error-${code.toLowerCase()}-${scale}-${width}`,
        );
        await page.unroute(contextRoute);
        await button(page, copy.refresh).click();
        await expect(panel(page).getByRole('alert')).toHaveCount(0);
      }
      await screenshot(page, info, `history-recovered-${scale}-${width}`);
      for (const code of ['FORBIDDEN', 'UNAUTHENTICATED'] as const) {
        await page.route(submitRoute, (route) =>
          route.fulfill({
            status: code === 'FORBIDDEN' ? 403 : 401,
            headers: { 'cache-control': 'no-store' },
            json: { ok: false, code },
          }),
        );
        await submitFromUi(page);
        await expect(page.getByRole('main').getByRole('alert')).toHaveText(
          composeCopy.accessLost,
        );
        await expect(textInput(page)).toHaveCount(0);
        await expect(page.locator('[data-dispatch-id]')).toHaveCount(0);
        await screenshot(
          page,
          info,
          `access-lost-${code.toLowerCase()}-${scale}-${width}`,
        );
        await page.unroute(submitRoute);
        await page.reload();
        await expect(textInput(page)).toHaveValue('허구 {이름} 님, 함께해요.');
        await expect(button(page, copy.submit)).toBeEnabled();
      }
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`lost responses, editor refresh and deferred worker errors fit ${scale} at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await openComposer(page, context, world);
      await expect(
        panel(page).getByText(copy.empty, { exact: true }),
      ).toBeVisible();
      await saveFromUi(page);
      const first = inspectDrafts(world)[0]!;
      const submitRoute = `**${endpoint(world, 'submit')}`;
      const submittedBodies: unknown[] = [];
      let lost = false;
      await page.route(submitRoute, async (route) => {
        submittedBodies.push(route.request().postDataJSON());
        if (lost) return route.continue();
        lost = true;
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort('failed');
      });
      await submitFromUi(page);
      await expect(
        panel(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(button(page, copy.submit)).toBeDisabled();
      expect(inspectDrafts(world)[0]?.status).toBe('sent');
      await screenshot(page, info, `lost-submit-response-${scale}-${width}`);
      await button(page, copy.retrySame).click();
      await expect(
        receiptPanel(page).getByRole('heading', {
          name: copy.statuses.sent,
          exact: true,
        }),
      ).toBeVisible();
      await expect(textInput(page)).toHaveValue('');
      expect(submittedBodies).toHaveLength(2);
      expect(submittedBodies[1]).toEqual(submittedBodies[0]);
      expect(inspectDrafts(world)).toHaveLength(1);
      await page.unroute(submitRoute);
      await screenshot(page, info, `lost-submit-recovered-${scale}-${width}`);
      const cancelRoute = `**${endpoint(world, 'cancel')}`;
      let canceledRequest: unknown;
      await page.route(cancelRoute, async (route) => {
        canceledRequest = route.request().postDataJSON();
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort('failed');
      });
      await historyPanel(page)
        .locator(`[data-dispatch-id="${first.id}"]`)
        .getByRole('button', { name: copy.cancelMessage, exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.confirmCancel, exact: true })
        .click();
      await expect(
        panel(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      expect(canceledRequest).toMatchObject({
        messageId: first.id,
        confirmed: true,
      });
      expect(inspectDrafts(world)[0]?.status).toBe('canceled');
      await screenshot(page, info, `lost-cancel-response-${scale}-${width}`);
      await page.unroute(cancelRoute);
      await button(page, copy.checkStatus).click();
      await expect(
        receiptPanel(page).getByRole('heading', {
          name: copy.statuses.canceled,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        panel(page).getByText(copy.uncertain, { exact: true }),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `lost-cancel-status-recovered-${scale}-${width}`,
      );

      await saveFromUi(page, '작성 화면 재확인용 허구 본문');
      const composeRoute = `**${artistComposeApiPath(world.artist.slug)}`;
      await page.route(composeRoute, async (route) => {
        if (
          route.request().method() !== 'POST' ||
          route.request().postDataJSON().messageId !== null
        )
          return route.continue();
        await route.fulfill({
          status: 503,
          headers: { 'cache-control': 'no-store' },
          json: { ok: false, code: 'UNAVAILABLE' },
        });
      });
      await submitFromUi(page);
      await expect(
        panel(page).getByText(copy.refreshRequired, { exact: true }),
      ).toBeVisible();
      await expect(textInput(page)).toBeDisabled();
      await expect(button(page, copy.submit)).toBeDisabled();
      await screenshot(page, info, `editor-refresh-required-${scale}-${width}`);
      await page.unroute(composeRoute);
      await button(page, copy.refreshEditor).click();
      await expect(textInput(page)).toHaveValue('');
      await expect(
        panel(page).getByText(copy.refreshRequired, { exact: true }),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `editor-refresh-recovered-${scale}-${width}`,
      );

      const scheduled = await save(
        page.request,
        world,
        '보류 상태 화면용 허구 예약',
      );
      await submit(
        page.request,
        world,
        submitInput(scheduled, new Date(Date.now() + 86_400_000).toISOString()),
      );
      for (const code of [
        'author_unavailable',
        'content_invalid',
        'policy_unavailable',
        'backpressure',
      ] as const) {
        showDispatchError(world, scheduled.id, code);
        await button(page, copy.refresh).click();
        const item = historyPanel(page).locator(
          `[data-dispatch-id="${scheduled.id}"]`,
        );
        await expect(item).toHaveAttribute('data-dispatch-status', 'scheduled');
        await expect(item.getByRole('alert')).toHaveText(
          copy.dispatchErrors[code],
        );
        await screenshot(page, info, `deferred-${code}-${scale}-${width}`);
      }
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`Back Forward dismisses dispatch confirmation and restores fresh state at ${scale} ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await openComposer(page, context, world);
      await expect(
        panel(page).getByText(copy.empty, { exact: true }),
      ).toBeVisible();
      await saveFromUi(page);
      const draft = inspectDrafts(world)[0]!;
      const savedPath = artistComposePath(world.artist.slug, draft.id);
      await button(page, copy.submit).click();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await page.goBack();
      await expect(page).toHaveURL(routes.artist);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(inspectDrafts(world)[0]?.status).toBe('draft');
      const restored = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            artistComposeApiPath(world.artist.slug) &&
          response.request().method() === 'POST',
      );
      await page.goForward();
      await expect(page).toHaveURL(savedPath);
      expect((await restored).status()).toBe(200);
      await expect(textInput(page)).toHaveValue(draft.body!);
      await expect(button(page, copy.submit)).toBeEnabled();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await screenshot(
        page,
        info,
        `back-forward-canceled-confirmation-${scale}-${width}`,
      );
      await submitFromUi(page);
      await expect(textInput(page)).toHaveValue('');
      await expect(page).toHaveURL(artistComposePath(world.artist.slug));
      await expect(
        historyPanel(page).locator(`[data-dispatch-id="${draft.id}"]`),
      ).toHaveAttribute('data-dispatch-status', 'sent');
      await page.goBack();
      await expect(page).toHaveURL(routes.artist);
      const freshHistory = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === endpoint(world) &&
          response.request().method() === 'POST',
      );
      await page.goForward();
      await expect(page).toHaveURL(artistComposePath(world.artist.slug));
      expect((await freshHistory).status()).toBe(200);
      await expect(textInput(page)).toHaveValue('');
      await expect(button(page, copy.submit)).toBeDisabled();
      await expect(
        historyPanel(page).locator(`[data-dispatch-id="${draft.id}"]`),
      ).toHaveAttribute('data-dispatch-status', 'sent');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await screenshot(page, info, `back-forward-published-${scale}-${width}`);
    });

test('expired recipients are excluded at execution while grace recipients remain eligible', async ({
  world,
  page,
  context,
}) => {
  const grace = await createIdentity('fan');
  const expired = await createIdentity('fan');
  for (const [actor, name] of [
    [world.fan, '첫허구팬'],
    [grace, '유예허구팬'],
    [expired, '만료허구팬'],
  ] as const) {
    await completeProfile(actor, world.artist, 'large', true, name);
    subscribe({ ...world, fan: actor });
    await enableFictionalNotifications(actor);
  }
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  await submit(
    page.request,
    world,
    submitInput(draft, new Date(Date.now() + 86_400_000).toISOString()),
  );
  subscribe({ ...world, fan: grace }, 'grace');
  subscribe({ ...world, fan: expired }, 'expired');
  makeScheduledDue(world, draft.id);
  await invokeDispatch(page.request);
  expect(new Set(notificationRows(draft.id).map((row) => row.userId))).toEqual(
    new Set([world.fan.id, grace.id]),
  );
  for (const row of notificationRows(draft.id))
    expect(row).toMatchObject({
      state: 'queued',
      attemptCount: 0,
      acceptedAt: null,
    });
  await grace.signIn(context);
  expect((await fanMessages(page.request, world)).messages[0]?.text).toBe(
    '허구 유예허구팬 님, 함께해요.',
  );
  await expired.signIn(context);
  await expectExpiredFanDenied(page.request, world);
});

test('actual worker prerequisite failures remain scheduled and recover after current policy and access return', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  await submit(
    page.request,
    world,
    submitInput(draft, new Date(Date.now() + 86_400_000).toISOString()),
  );
  makeScheduledDue(world, draft.id);
  restrict(world.author);
  expect((await invokeDispatch(page.request)).blocked).toBeGreaterThanOrEqual(
    1,
  );
  expect(inspectDrafts(world)[0]?.status).toBe('scheduled');
  clearRestriction(world.author);
  expect(
    (await history(page.request, world, draft.id)).selectedMessage
      ?.dispatchError,
  ).toBe('author_unavailable');
  makeScheduledDue(world, draft.id);
  pauseArtist(world);
  expect((await invokeDispatch(page.request)).blocked).toBeGreaterThanOrEqual(
    1,
  );
  resumeArtist(world);
  makeScheduledDue(world, draft.id);
  disableMessagePolicy();
  expect((await invokeDispatch(page.request)).blocked).toBeGreaterThanOrEqual(
    1,
  );
  preparePolicies();
  expect(
    (await history(page.request, world, draft.id)).selectedMessage
      ?.dispatchError,
  ).toBe('policy_unavailable');
  makeScheduledDue(world, draft.id);
  expect((await invokeDispatch(page.request)).published).toBeGreaterThanOrEqual(
    1,
  );
  const current = (await history(page.request, world, draft.id))
    .selectedMessage!;
  expect(current.status).toBe('sent');
  expect(current.dispatchError).toBeNull();
});

test('a rapid double confirmation click creates exactly one dispatch intent and publication', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await expect(
    panel(page).getByText(copy.empty, { exact: true }),
  ).toBeVisible();
  await saveFromUi(page);
  const ids: string[] = [];
  await page.route(`**${endpoint(world, 'submit')}`, async (route) => {
    ids.push(route.request().postDataJSON().operationId);
    await route.continue();
  });
  await button(page, copy.submit).evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: copy.confirmSubmit, exact: true })
    .evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
  await expect(textInput(page)).toHaveValue('');
  await expect(
    receiptPanel(page).getByRole('heading', {
      name: copy.statuses.sent,
      exact: true,
    }),
  ).toBeVisible();
  expect(ids).toHaveLength(1);
  expect(inspectDrafts(world)).toHaveLength(1);
  expect(inspectDrafts(world)[0]?.status).toBe('sent');
});

const onlyPanel = (page: Page) =>
  page.getByRole('region', { name: copy.historyPanel, exact: true });
for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`paused-artist history catalog and cancellation fit ${scale} at ${width}px`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await world.author.signIn(context);
      await page.goto(routes.artist);
      await page.locator(`a[href="${routes.artistDispatchHistory}"]`).click();
      await expect(page).toHaveURL(routes.artistDispatchHistory);
      await expect(
        page.getByRole('main').getByText(copy.menuEmpty, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `history-catalog-empty-${scale}-${width}`);
      await page.getByRole('link', { name: copy.back, exact: true }).click();
      await expect(page).toHaveURL(routes.artist);
      const draft = await save(
        page.request,
        world,
        '일시 중지 뒤 취소할 허구 예약',
      );
      await submit(
        page.request,
        world,
        submitInput(draft, new Date(Date.now() + 86_400_000).toISOString()),
      );
      pauseArtist(world);
      await page.reload();
      await expect(
        page.locator(`a[href="${artistComposePath(world.artist.slug)}"]`),
      ).toHaveCount(0);
      await page.locator(`a[href="${routes.artistDispatchHistory}"]`).click();
      await expect(page).toHaveURL(routes.artistDispatchHistory);
      const link = page.locator(
        `a[href="${artistDispatchPath(world.artist.slug)}"]`,
      );
      await expect(link).toBeVisible();
      await screenshot(page, info, `history-catalog-paused-${scale}-${width}`);
      await link.click();
      await expect(page).toHaveURL(artistDispatchPath(world.artist.slug));
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(textInput(page)).toHaveCount(0);
      await expect(button(page, copy.submit)).toHaveCount(0);
      const history = onlyPanel(page).getByRole('region', {
        name: copy.history,
        exact: true,
      });
      const item = history.locator(`[data-dispatch-id="${draft.id}"]`);
      await expect(item).toHaveAttribute('data-dispatch-status', 'scheduled');
      await expect(
        item.getByRole('button', { name: copy.cancelMessage, exact: true }),
      ).toBeEnabled();
      await screenshot(page, info, `paused-history-${scale}-${width}`);
      const contextRoute = `**${endpoint(world)}`;
      await page.route(contextRoute, (route) =>
        route.fulfill({
          status: 503,
          headers: { 'cache-control': 'no-store' },
          json: { ok: false, code: 'UNAVAILABLE' },
        }),
      );
      await button(page, copy.refresh).click();
      await expect(onlyPanel(page).getByRole('alert')).toHaveText(
        copy.errors.UNAVAILABLE,
      );
      await screenshot(
        page,
        info,
        `paused-history-read-error-${scale}-${width}`,
      );
      await page.unroute(contextRoute);
      await button(page, copy.refresh).click();
      await expect(onlyPanel(page).getByRole('alert')).toHaveCount(0);
      await item
        .getByRole('button', { name: copy.cancelMessage, exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await screenshot(
        page,
        info,
        `paused-cancel-confirmation-${scale}-${width}`,
      );
      await page
        .getByRole('dialog')
        .getByRole('button', { name: copy.confirmCancel, exact: true })
        .click();
      await expect(item).toHaveAttribute('data-dispatch-status', 'canceled');
      await screenshot(page, info, `paused-canceled-${scale}-${width}`);
      makeScheduledDue(world, draft.id);
      await invokeDispatch(page.request);
      expect(inspectDrafts(world)[0]?.status).toBe('canceled');
      await button(page, copy.backToHistoryArtists).click();
      await expect(page).toHaveURL(routes.artistDispatchHistory);
      await expect(
        page.locator(`a[href="${artistDispatchPath(world.artist.slug)}"]`),
      ).toBeVisible();
      removeMembership(world);
      await page.reload();
      await expect(
        page.getByRole('main').getByText(copy.menuEmpty, { exact: true }),
      ).toBeVisible();
      await page.goto(artistDispatchPath(world.artist.slug));
      await expect(
        page
          .getByRole('main')
          .getByRole('heading', { name: copy.errorTitle, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(page.locator('[data-dispatch-id]')).toHaveCount(0);
      await screenshot(page, info, `history-membership-lost-${scale}-${width}`);
    });

test('history artist catalog has stable next/first navigation and never leaks another author history', async ({
  world,
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  setFont(world.author, 'xlarge');
  await page.setViewportSize({ width: 360, height: 800 });
  await world.author.signIn(context);
  const artists = [world.artist, ...addHistoryArtists(world, 50)];
  const future = new Date(Date.now() + 86_400_000).toISOString();
  let firstMessageId = '';
  for (const [index, artist] of artists.entries()) {
    if (index > 0 && index % 15 === 0) ageDispatchRateWindow(world);
    const current = { ...world, artist };
    const draft = await save(
      page.request,
      current,
      '가수별 내역 목록용 허구 예약',
    );
    if (index === 0) firstMessageId = draft.id;
    await submit(page.request, current, submitInput(draft, future));
  }
  await page.goto(routes.artistDispatchHistory);
  const links = () => page.locator('main a[href$="/dispatch"]');
  await expect(links()).toHaveCount(50);
  const firstPage = await links().evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );
  const more = page.getByRole('link', { name: copy.menuMore, exact: true });
  await expect(more).toBeVisible();
  await screenshot(page, info, 'history-catalog-first-page-xlarge-360');
  await more.click();
  await expect(links()).toHaveCount(1);
  const secondPage = await links().evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  );
  expect(new Set([...firstPage, ...secondPage])).toEqual(
    new Set(artists.map((artist) => artistDispatchPath(artist.slug))),
  );
  await screenshot(page, info, 'history-catalog-next-page-xlarge-360');
  await page.getByRole('link', { name: copy.menuFirst, exact: true }).click();
  await expect(page).toHaveURL(routes.artistDispatchHistory);
  await expect(links()).toHaveCount(50);
  addMembership(world, world.outsider);
  await world.outsider.signIn(context);
  await page.goto(routes.artistDispatchHistory);
  await expect(
    page.getByRole('main').getByText(copy.menuEmpty, { exact: true }),
  ).toBeVisible();
  await page.goto(artistDispatchPath(world.artist.slug));
  await expect(
    onlyPanel(page).getByText(copy.empty, { exact: true }),
  ).toBeVisible();
  await expectFailure(
    await post(page.request, endpoint(world), { messageId: firstMessageId }),
    404,
    'NOT_FOUND',
  );
  await expectFailure(
    await post(page.request, endpoint(world, 'cancel'), {
      messageId: firstMessageId,
      operationId: randomUUID(),
      confirmed: true,
    }),
    404,
    'NOT_FOUND',
  );
});
