import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import {
  test,
  expect,
  storageOrigin,
  preparePolicies,
  setFont,
  setRole,
  restrict,
  removeMembership,
  addMembership,
  addAssignedArtists,
  pauseArtist,
  inspectDrafts,
  disableMessagePolicy,
  mediaRowCount,
  imageBytes,
  largeImageBytes,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  type World,
} from './fixtures';
import {
  artistComposeApiPath,
  artistComposePath,
  artistComposeMenuPath,
  routes,
} from '../../../src/config/routes';
import type {
  ComposeDraft,
  ComposeKind,
  ComposePageData,
  ComposeSaveInput,
} from '../../../src/config/artist-compose';
import { COMPOSE_PHOTO } from '../../../src/config/compose-capture';
import { installRecording, recordingSnapshot } from './recording';
import { installSpeech, speechResult, speechEnd } from '../speech/recognition';

// NodeNext must not execute application JSON imports in the test loader.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.artistCompose;
const textInput = (page: Page) =>
  page.getByRole('textbox', { name: copy.body, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });
const endpoint = (world: World, action?: 'save' | 'preview' | 'remove') =>
  artistComposeApiPath(world.artist.slug, action);
function saveInput(
  kind: ComposeKind = 'text',
  body: string | null = '허구 {이름} 님, 함께해요.',
): Omit<ComposeSaveInput, 'slug'> {
  return {
    messageId: randomUUID(),
    operationId: randomUUID(),
    expectedRevision: 0,
    kind,
    body,
    mediaIds: [] as string[],
  };
}
async function save(
  request: APIRequestContext,
  world: World,
  input = saveInput(),
) {
  const response = await post(request, endpoint(world, 'save'), input);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as ComposeDraft;
}
async function contextData(
  request: APIRequestContext,
  world: World,
  messageId: string | null = null,
) {
  const response = await post(request, endpoint(world), { messageId });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.data as ComposePageData;
}
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
  await expect(page.getByText(copy.draftOnly, { exact: true })).toBeVisible();
}
async function saveFromUi(page: Page, body = '허구 {이름} 님, 함께해요.') {
  await textInput(page).fill(body);
  await button(page, copy.save).click();
  await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
}
async function createMediaDraft(
  page: Page,
  kind: Exclude<ComposeKind, 'text'>,
) {
  await button(page, copy.kinds[kind]).click();
  await saveFromUi(page, '허구 미디어 안내');
}
async function fileFor(kind: Exclude<ComposeKind, 'text'>) {
  if (kind === 'photo')
    return {
      name: 'private-source-name.png',
      mimeType: 'image/png',
      buffer: await imageBytes(),
    };
  if (kind === 'voice')
    return {
      name: 'private-source-name.webm',
      mimeType: 'audio/webm',
      buffer: readFileSync(
        new URL('../../fixtures/media/tone.webm', import.meta.url),
      ),
    };
  return {
    name: 'private-source-name.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(
      new URL('../../fixtures/media/clip.mp4', import.meta.url),
    ),
  };
}
async function selectFile(page: Page, kind: Exclude<ComposeKind, 'text'>) {
  await page
    .getByLabel(copy.fileLabel[kind], { exact: true })
    .setInputFiles(await fileFor(kind));
  await expect(page.getByText(copy.fileReady, { exact: true })).toBeVisible();
}
async function directUpload(
  request: APIRequestContext,
  draft: ComposeDraft,
  bytes: Buffer,
  mimeType: string,
) {
  const begun = await post(request, routes.mediaUpload, {
    requestId: randomUUID(),
    messageId: draft.id,
    mimeType,
    byteSize: bytes.length,
  });
  expect(begun.status()).toBe(200);
  const ticket = (await begun.json()).data as {
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
  };
  expect(new URL(ticket.uploadUrl).origin).toBe(storageOrigin);
  const sent = await request.put(ticket.uploadUrl, {
    headers: {
      'Content-Type': mimeType,
      'x-upsert': 'false',
      'cache-control': 'max-age=0',
    },
    data: bytes,
    maxRedirects: 0,
  });
  expect(sent.ok()).toBe(true);
  const completed = await post(request, routes.mediaComplete, {
    uploadId: ticket.uploadId,
  });
  expect(completed.status()).toBe(200);
  return { ticket, mediaId: (await completed.json()).data.mediaId as string };
}
async function denied(
  response: Awaited<ReturnType<typeof post>>,
  statuses = [400, 401, 403, 404, 409, 503],
) {
  expect(statuses).toContain(response.status());
  const result = await response.json();
  expect(result.ok).toBe(false);
  expect(Object.keys(result).sort()).toEqual(['code', 'ok']);
  expect(JSON.stringify(result)).not.toMatch(
    /object_path|quarantine_path|bucket_id|author_id|service_role|token|credential/,
  );
  return result.code as string;
}

test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('the actual artist menu link opens a draft-only composer and current bounded policy', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  const data = await contextData(page.request, world);
  expect(data.artist).toEqual(world.artist);
  expect(data.policy).toMatchObject({
    maxTextLength: 1000,
    maxPhotoCount: 2,
    maxVoiceSeconds: 180,
    maxVideoSeconds: 60,
    callNameMinLength: 2,
    callNameMaxLength: 10,
  });
  expect(data.drafts).toEqual([]);
  expect(data.selectedDraft).toBeNull();
  expect(JSON.stringify(data)).not.toMatch(
    /author_id|user_id|object_path|bucket_id|profanity|policy_version/,
  );
  await expect(button(page, '전송')).toHaveCount(0);
  await expect(button(page, '예약 발송')).toHaveCount(0);
});

test('save replay is idempotent, changed request binding conflicts, and stale tabs cannot overwrite a newer revision', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const input = saveInput();
  const first = await save(page.request, world, input);
  expect(await save(page.request, world, input)).toEqual(first);
  expect(
    await denied(
      await post(page.request, endpoint(world, 'save'), {
        ...input,
        body: '다른 허구 본문',
      }),
    ),
  ).toBe('IDEMPOTENCY_CONFLICT');
  const next = await save(page.request, world, {
    ...input,
    operationId: randomUUID(),
    expectedRevision: first.revision,
    body: '두 번째 허구 초안',
  });
  expect(next.revision).toBeGreaterThan(first.revision);
  expect(
    await denied(
      await post(page.request, endpoint(world, 'save'), {
        ...input,
        operationId: randomUUID(),
        expectedRevision: first.revision,
        body: '오래된 화면의 허구 초안',
      }),
    ),
  ).toBe('CONFLICT');
  expect(inspectDrafts(world)).toEqual([
    {
      id: first.id,
      kind: 'text',
      body: '두 번째 허구 초안',
      status: 'draft',
      mediaCount: 0,
    },
  ]);
});

test('artist ownership is distinct from shared membership and no client role or actor field is accepted', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const saved = await save(
    page.request,
    world,
    saveInput('photo', '다른 작성자의 허구 초안'),
  );
  addMembership(world, world.outsider);
  await world.outsider.signIn(context);
  const own = await contextData(page.request, world);
  expect(own.drafts).toEqual([]);
  await denied(
    await post(page.request, endpoint(world), { messageId: saved.id }),
    [403, 404],
  );
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput(),
      messageId: saved.id,
      expectedRevision: saved.revision,
    }),
    [403, 404],
  );
  await denied(
    await post(page.request, routes.mediaUpload, {
      requestId: randomUUID(),
      messageId: saved.id,
      mimeType: 'image/png',
      byteSize: 120,
    }),
    [403],
  );
  for (const extra of [
    { actorId: world.author.id },
    { role: 'artist' },
    { slug: world.artist.slug },
  ])
    await denied(
      await post(page.request, endpoint(world), { messageId: null, ...extra }),
      [400],
    );
  expect(inspectDrafts(world)).toHaveLength(1);
});

test('fan, administrator, outsider, anonymous, restricted and paused-artist requests fail closed', async ({
  world,
  page,
  context,
}) => {
  for (const identity of [world.fan, world.outsider]) {
    await identity.signIn(context);
    await denied(
      await post(page.request, endpoint(world), { messageId: null }),
      [403, 404],
    );
  }
  setRole(world.fan, 'admin');
  await world.fan.signIn(context);
  await denied(
    await post(page.request, endpoint(world), { messageId: null }),
    [403],
  );
  await context.clearCookies();
  await denied(
    await post(page.request, endpoint(world), { messageId: null }),
    [401],
  );
  await world.author.signIn(context);
  pauseArtist(world);
  await denied(
    await post(page.request, endpoint(world), { messageId: null }),
    [403, 404],
  );
  restrict(world.author);
  await denied(
    await post(page.request, endpoint(world, 'save'), saveInput()),
    [403],
  );
  expect(inspectDrafts(world)).toEqual([]);
});

test('field validation and same-origin boundaries reject before a draft is created', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  for (const input of [
    saveInput('text', null),
    saveInput('text', '   '),
    saveInput('text', '가'.repeat(1001)),
    { ...saveInput(), kind: 'html' },
    { ...saveInput(), mediaIds: [randomUUID()] },
    { ...saveInput(), expectedRevision: -1 },
    { ...saveInput(), dispatch: true },
  ])
    await denied(
      await post(page.request, endpoint(world, 'save'), input),
      [400, 403, 409],
    );
  const badOrigin = await page.request.post(endpoint(world, 'save'), {
    data: saveInput(),
    headers: { Origin: 'https://example.invalid' },
  });
  await denied(badOrigin, [403]);
  const query = await post(
    page.request,
    `${endpoint(world)}?actorId=${world.author.id}`,
    { messageId: null },
  );
  await denied(query, [400]);
  expect(inspectDrafts(world)).toEqual([]);
});

test('missing authoritative policy exposes no fallback authoring and leaves existing content unchanged', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world);
  disableMessagePolicy();
  await denied(
    await post(page.request, endpoint(world), { messageId: draft.id }),
    [503],
  );
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput(),
      messageId: draft.id,
      expectedRevision: draft.revision,
    }),
    [503],
  );
  expect(inspectDrafts(world)[0]!.body).toBe(draft.body);
});

test('personalized preview uses server rendering, validates the sample name and never saves or dispatches', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await textInput(page).fill('허구 {이름} 님과 {이름} 님에게 <b>인사</b>');
  await page
    .getByRole('textbox', { name: copy.sampleName, exact: true })
    .fill('김순자');
  await button(page, copy.preview).click();
  await expect(
    page.getByText('허구 김순자 님과 김순자 님에게 <b>인사</b>', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.locator('b').filter({ hasText: '인사' }).count()).toBe(0);
  await expect(textInput(page)).toHaveValue(
    '허구 {이름} 님과 {이름} 님에게 <b>인사</b>',
  );
  for (const sampleName of ['', '가', '가'.repeat(11)])
    await denied(
      await post(page.request, endpoint(world, 'preview'), {
        messageId: null,
        kind: 'text',
        body: '허구 {이름}',
        sampleName,
      }),
      [400],
    );
  expect(inspectDrafts(world)).toEqual([]);
});

test('saved text survives refresh and menu navigation without browser-persistent draft text', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await saveFromUi(page, '다시 열어 확인할 허구 초안');
  const id = inspectDrafts(world)[0]!.id;
  await expect(page).toHaveURL(artistComposePath(world.artist.slug, id));
  await page.reload();
  await expect(textInput(page)).toHaveValue('다시 열어 확인할 허구 초안');
  await button(page, copy.back).click();
  await expect(page).toHaveURL(routes.artist);
  await page
    .locator(`a[href="${artistComposePath(world.artist.slug)}"]`)
    .click();
  await page.locator(`[data-message-id="${id}"]`).getByRole('button').click();
  await expect(textInput(page)).toHaveValue('다시 열어 확인할 허구 초안');
  const persisted = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(persisted).not.toContain('다시 열어 확인할 허구 초안');
  expect(inspectDrafts(world)).toHaveLength(1);
});

test('a lost successful save response retries the identical operation and never duplicates a draft', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  const inputs: unknown[] = [];
  let lost = false;
  await page.route(`**${endpoint(world, 'save')}`, async (route) => {
    inputs.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await textInput(page).fill('분실 응답 뒤 한 번만 저장할 허구 초안');
  await button(page, copy.save).click();
  await expect(button(page, copy.retrySave)).toBeVisible();
  expect(inspectDrafts(world)).toHaveLength(1);
  await button(page, copy.retrySave).click();
  await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
  expect(inspectDrafts(world)).toHaveLength(1);
});

for (const kind of ['photo', 'voice', 'video'] as const)
  test(`${kind} authoring uploads real synthetic bytes and recovers the protected attachment after refresh`, async ({
    world,
    page,
    context,
  }, info) => {
    await openComposer(page, context, world);
    await createMediaDraft(page, kind);
    await selectFile(page, kind);
    await button(page, copy.upload).click();
    await expect(
      page.getByText(copy.uploadComplete, { exact: true }),
    ).toBeVisible();
    const saved = inspectDrafts(world)[0]!;
    expect(saved).toMatchObject({ kind, status: 'draft', mediaCount: 1 });
    await page.reload();
    const data = await contextData(page.request, world, saved.id);
    expect(data.selectedDraft?.media).toHaveLength(1);
    expect(data.selectedDraft?.media[0]!.kind).toBe(kind);
    expect(JSON.stringify(data)).not.toContain('private-source-name');
    expect(JSON.stringify(data)).not.toMatch(
      /object_path|bucket_id|quarantine_path|mime_type/,
    );
    const label = messages.media.open.replace(
      '{kind}',
      messages.artists.messageKinds[kind],
    );
    await button(page, label).click();
    if (kind === 'photo')
      await expect(page.locator('.secure-media img')).toBeVisible();
    else
      await expect(
        page.locator(`.secure-media ${kind === 'voice' ? 'audio' : 'video'}`),
      ).toBeVisible();
    await screenshot(page, info, `${kind}-saved-protected-preview`);
  });

test('upload completion increments the revision and exact current media bindings are mandatory for final draft save', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const first = await save(page.request, world, saveInput('photo', null));
  const { mediaId } = await directUpload(
    page.request,
    first,
    await imageBytes(),
    'image/png',
  );
  const current = (await contextData(page.request, world, first.id))
    .selectedDraft!;
  expect(current.revision).toBeGreaterThan(first.revision);
  expect(current.media.map((item) => item.id)).toEqual([mediaId]);
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput('photo', '허구 캡션'),
      messageId: first.id,
      expectedRevision: first.revision,
    }),
    [409],
  );
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput('photo', '허구 캡션'),
      messageId: first.id,
      expectedRevision: current.revision,
    }),
    [409],
  );
  const second = await save(page.request, world, {
    ...saveInput('photo', '허구 캡션'),
    messageId: first.id,
    expectedRevision: current.revision,
    mediaIds: [mediaId],
  });
  const removal = {
    messageId: first.id,
    mediaId,
    expectedRevision: second.revision,
    operationId: randomUUID(),
  };
  const removed = await post(page.request, endpoint(world, 'remove'), removal);
  expect(removed.status()).toBe(200);
  const receipt = await removed.json();
  expect(receipt.data.media).toEqual([]);
  const replay = await post(page.request, endpoint(world, 'remove'), removal);
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  expect(mediaRowCount(first.id)).toBe(0);
  await denied(
    await post(page.request, routes.mediaRead, { mediaId, preview: false }),
    [403, 404],
  );
});

test('a pending upload is recoverable after refresh and cancellation cannot remove a completed protected attachment', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const draft = await save(page.request, world, saveInput('photo', null));
  const currentMedia = await directUpload(
    page.request,
    draft,
    await imageBytes(),
    'image/png',
  );
  const begun = await post(page.request, routes.mediaUpload, {
    requestId: randomUUID(),
    messageId: draft.id,
    mimeType: 'image/png',
    byteSize: (await imageBytes()).length,
  });
  expect(begun.status()).toBe(200);
  const uploadId = (await begun.json()).data.uploadId;
  const current = (await contextData(page.request, world, draft.id))
    .selectedDraft!;
  expect(current.pendingUploadIds).toContain(uploadId);
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput('video', null),
      messageId: draft.id,
      expectedRevision: current.revision,
      mediaIds: [currentMedia.mediaId],
    }),
    [409],
  );
  await page.goto(artistComposePath(world.artist.slug, draft.id));
  await expect(
    page.getByText(copy.pendingUploads, { exact: true }),
  ).toBeVisible();
  await button(page, copy.clearPending).click();
  await expect(
    page.getByText(copy.pendingUploads, { exact: true }),
  ).toHaveCount(0);
  const resolved = (await contextData(page.request, world, draft.id))
    .selectedDraft!;
  expect(resolved.pendingUploadIds).toEqual([]);
  expect(resolved.media.map((item) => item.id)).toEqual([currentMedia.mediaId]);
  expect(mediaRowCount(draft.id)).toBe(1);
});

test('a lost successful completion response is reconciled using the same upload and does not create a second attachment', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await createMediaDraft(page, 'photo');
  await selectFile(page, 'photo');
  const inputs: unknown[] = [];
  let lost = false;
  await page.route(`**${routes.mediaComplete}`, async (route) => {
    inputs.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await button(page, copy.upload).click();
  await expect(button(page, copy.uploadRetry)).toBeVisible();
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(1);
  await button(page, copy.uploadRetry).click();
  await expect(
    page.getByText(copy.uploadComplete, { exact: true }),
  ).toBeVisible();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(1);
});

test('membership loss closes retained text and prevents preview, save and new upload grants', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await saveFromUi(page, '접근 회수 뒤 지울 허구 초안');
  const draft = inspectDrafts(world)[0]!;
  removeMembership(world);
  await button(page, copy.refresh).click();
  await expect(page.getByText(copy.accessLost, { exact: true })).toBeVisible();
  await expect(textInput(page)).toHaveCount(0);
  await denied(
    await post(page.request, endpoint(world, 'preview'), {
      messageId: draft.id,
      kind: 'text',
      body: draft.body,
      sampleName: '허구팬',
    }),
    [403, 404],
  );
  await denied(
    await post(page.request, routes.mediaUpload, {
      requestId: randomUUID(),
      messageId: draft.id,
      mimeType: 'image/png',
      byteSize: 120,
    }),
    [403],
  );
  expect(inspectDrafts(world)[0]!.body).toBe(draft.body);
});

test('speech text drafting remains opt-in and does not save or send automatically', async ({
  world,
  page,
  context,
}) => {
  await installSpeech(page);
  await openComposer(page, context, world);
  await button(page, messages.speech.open).click();
  await expect(
    page.getByText(messages.speech.privacy, { exact: true }),
  ).toBeVisible();
  await button(page, messages.speech.start).click();
  await speechResult(page, [{ text: '허구 음성 입력 문장', final: true }]);
  await speechEnd(page);
  await expect(textInput(page)).toHaveValue('허구 음성 입력 문장');
  expect(inspectDrafts(world)).toEqual([]);
});

test('voice recording asks twice before the synthetic capture, stops tracks, and uploads only on explicit confirmation', async ({
  world,
  page,
  context,
}) => {
  await installRecording(page);
  await openComposer(page, context, world);
  await createMediaDraft(page, 'voice');
  await button(page, copy.record).click();
  expect((await recordingSnapshot(page)).requests).toBe(0);
  await button(page, copy.recordStart).click();
  await expect(button(page, copy.recordStop)).toBeVisible();
  expect((await recordingSnapshot(page)).constraints).toEqual([
    { audio: true, video: false },
  ]);
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(0);
  await button(page, copy.recordStop).click();
  await expect(button(page, copy.recordUpload)).toBeVisible();
  expect((await recordingSnapshot(page)).tracksStopped).toBeGreaterThan(0);
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(0);
  // Using a local recording selects it; it is not permission to upload yet.
  await button(page, copy.recordUpload).click();
  await expect(page.getByText(copy.fileReady, { exact: true })).toBeVisible();
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(0);
  await button(page, copy.upload).click();
  await expect(
    page.getByText(copy.uploadComplete, { exact: true }),
  ).toBeVisible();
  expect(inspectDrafts(world)[0]!).toMatchObject({
    kind: 'voice',
    mediaCount: 1,
    status: 'draft',
  });
});

for (const permission of ['deny', 'pending'] as const)
  test(`recording ${permission} never creates media and canceled late permission is released`, async ({
    world,
    page,
    context,
  }) => {
    await installRecording(page, { permission });
    await openComposer(page, context, world);
    await createMediaDraft(page, 'voice');
    await button(page, copy.record).click();
    await button(page, copy.recordStart).click();
    if (permission === 'deny')
      await expect(
        page.getByText(copy.errors.permission, { exact: true }),
      ).toBeVisible();
    else {
      await expect(
        page.getByText(copy.recordRequesting, { exact: true }),
      ).toBeVisible();
      await button(page, copy.recordCancel).click();
      await page.evaluate(() => window.__composeRecording.resolvePermission());
      await expect
        .poll(async () => (await recordingSnapshot(page)).tracksStopped)
        .toBeGreaterThan(0);
      expect((await recordingSnapshot(page)).starts).toBe(0);
    }
    expect(inspectDrafts(world)[0]!.mediaCount).toBe(0);
    await expect(button(page, copy.recordUpload)).toHaveCount(0);
  });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`all visible compose flows fit ${scale} at ${width}px and new links are actually clicked`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await installRecording(page);
      await openComposer(page, context, world);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await textInput(page).fill('허구 인사: ');
      await button(page, copy.insertName).click();
      await expect(textInput(page)).toHaveValue('허구 인사: {이름}');
      await button(page, copy.preview).click();
      await expect(
        page.getByText(copy.errors.NAME_INVALID, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `name-validation-${scale}-${width}`);
      await page
        .getByRole('textbox', { name: copy.sampleName, exact: true })
        .fill('김순자');
      await button(page, copy.preview).click();
      await expect(
        page.getByText('허구 인사: 김순자', { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `text-preview-${scale}-${width}`);
      await button(page, copy.save).click();
      await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
      await screenshot(page, info, `saved-text-${scale}-${width}`);
      const saved = inspectDrafts(world)[0]!;
      const savedPath = artistComposePath(world.artist.slug, saved.id);
      expect(saved.body).toBe('허구 인사: {이름}');
      await expect(page).toHaveURL(savedPath);
      await page.goBack();
      await expect(page).toHaveURL(routes.artist);

      // Re-enter the cached route through real history, but make its fresh
      // context read temporarily unavailable. Never synthesize a saved draft.
      const contextRoute = `**${endpoint(world)}`;
      const failedReads: unknown[] = [];
      await page.route(contextRoute, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        failedReads.push(route.request().postDataJSON());
        await route.fulfill({
          status: 503,
          headers: { 'cache-control': 'no-store' },
          json: { ok: false, code: 'UNAVAILABLE' },
        });
      });
      await page.goForward();
      await expect(page).toHaveURL(savedPath);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      // Next's route announcer is also an alert, outside the composer main.
      const composer = page.getByRole('main');
      await expect(composer.getByRole('alert')).toHaveText(
        copy.errors.UNAVAILABLE,
      );
      await expect(textInput(page)).toHaveCount(0);
      await expect(page.locator('[data-message-id]')).toHaveCount(0);
      await expect(button(page, copy.reload)).toBeEnabled();
      expect(failedReads.length).toBeGreaterThan(0);
      for (const read of failedReads)
        expect(read).toEqual({ messageId: saved.id });
      expect(inspectDrafts(world)).toEqual([saved]);
      await screenshot(page, info, `restore-read-error-${scale}-${width}`);

      await page.unroute(contextRoute);
      const reloaded = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === endpoint(world) &&
          response.request().method() === 'POST',
      );
      await button(page, copy.reload).click();
      const restored = await reloaded;
      expect(restored.status()).toBe(200);
      expect(restored.request().postDataJSON()).toEqual({
        messageId: saved.id,
      });
      await expect(page).toHaveURL(savedPath);
      await expect(textInput(page)).toHaveValue(saved.body!);
      await expect(
        page.locator(`[data-message-id="${saved.id}"]`),
      ).toBeVisible();
      await expect(composer.getByRole('alert')).toHaveCount(0);
      await expect(button(page, copy.reload)).toHaveCount(0);
      expect(inspectDrafts(world)).toEqual([saved]);
      await screenshot(page, info, `restore-read-recovered-${scale}-${width}`);
      await button(page, copy.new).click();
      await button(page, copy.kinds.photo).click();
      await saveFromUi(page, '허구 사진 안내');
      await selectFile(page, 'photo');
      await screenshot(page, info, `photo-ready-${scale}-${width}`);
      await button(page, copy.upload).click();
      await expect(
        page.getByText(copy.uploadComplete, { exact: true }),
      ).toBeVisible();
      await button(
        page,
        messages.media.open.replace(
          '{kind}',
          messages.artists.messageKinds.photo,
        ),
      ).click();
      await expect(page.locator('.secure-media img')).toBeVisible();
      await screenshot(page, info, `photo-saved-${scale}-${width}`);
      await button(page, copy.new).click();
      await button(page, copy.kinds.voice).click();
      await saveFromUi(page, '허구 음성 안내');
      await button(page, copy.record).click();
      await expect(button(page, copy.recordStart)).toBeVisible();
      await screenshot(page, info, `record-disclosure-${scale}-${width}`);
      await button(page, copy.recordStart).click();
      await expect(button(page, copy.recordStop)).toBeVisible();
      await screenshot(page, info, `recording-${scale}-${width}`);
      await button(page, copy.recordStop).click();
      await expect(button(page, copy.recordUpload)).toBeVisible();
      await screenshot(page, info, `record-ready-${scale}-${width}`);
      await button(page, copy.recordCancel).click();
      await button(page, copy.new).click();
      await button(page, copy.kinds.video).click();
      await saveFromUi(page, '허구 영상 안내');
      await screenshot(page, info, `video-authoring-${scale}-${width}`);
      await selectFile(page, 'video');
      await screenshot(page, info, `video-ready-${scale}-${width}`);
      await button(page, copy.cancelUpload).click();
      await expect(
        page.getByText(copy.canceledUpload, { exact: true }),
      ).toBeVisible();
      await button(page, copy.back).click();
      await expect(page).toHaveURL(routes.artist);
      await screenshot(page, info, `artist-menu-${scale}-${width}`);
    });

test('canceling a lost begin response resolves only that stable intent and leaves the draft reusable', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await createMediaDraft(page, 'photo');
  await selectFile(page, 'photo');
  const begins: { requestId: string; messageId: string }[] = [];
  let lost = false;
  await page.route(`**${routes.mediaUpload}`, async (route) => {
    begins.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await button(page, copy.upload).click();
  await expect(button(page, copy.uploadRetry)).toBeVisible();
  await button(page, copy.cancelUpload).click();
  await expect(
    page.getByText(copy.canceledUpload, { exact: true }),
  ).toBeVisible();
  expect(begins).toHaveLength(2);
  expect(begins[1]).toEqual(begins[0]);
  const draft = inspectDrafts(world)[0]!;
  expect(draft.mediaCount).toBe(0);
  expect(
    (await contextData(page.request, world, draft.id)).selectedDraft
      ?.pendingUploadIds,
  ).toEqual([]);
  await selectFile(page, 'photo');
  await button(page, copy.upload).click();
  await expect(
    page.getByText(copy.uploadComplete, { exact: true }),
  ).toBeVisible();
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(1);
});

test('cancel after completion won the race retains the already registered attachment', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await createMediaDraft(page, 'photo');
  await selectFile(page, 'photo');
  let lost = false;
  await page.route(`**${routes.mediaComplete}`, async (route) => {
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await button(page, copy.upload).click();
  await expect(button(page, copy.uploadRetry)).toBeVisible();
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(1);
  await button(page, copy.cancelUpload).click();
  await expect(
    page.getByText(copy.canceledUpload, { exact: true }),
  ).toBeVisible();
  const draft = inspectDrafts(world)[0]!;
  expect(draft.mediaCount).toBe(1);
  const current = (await contextData(page.request, world, draft.id))
    .selectedDraft!;
  expect(current.media).toHaveLength(1);
  expect(current.pendingUploadIds).toEqual([]);
});

test('capture cancellation and page navigation suppress late data and release native tracks', async ({
  world,
  page,
  context,
}) => {
  await installRecording(page);
  await openComposer(page, context, world);
  await createMediaDraft(page, 'voice');
  const saved = inspectDrafts(world)[0]!;
  expect(saved.body).toBe('허구 미디어 안내');
  await expect(page).toHaveURL(artistComposePath(world.artist.slug, saved.id));
  await button(page, copy.record).click();
  await button(page, copy.recordStart).click();
  await expect(button(page, copy.recordStop)).toBeVisible();
  await button(page, copy.recordCancel).click();
  await page.evaluate(() => window.__composeRecording.lateData());
  await expect(button(page, copy.recordUpload)).toHaveCount(0);
  expect((await recordingSnapshot(page)).tracksStopped).toBeGreaterThan(0);
  await page.goBack();
  await expect(page).toHaveURL(routes.artist);
  await page.goForward();
  await expect(page).toHaveURL(artistComposePath(world.artist.slug, saved.id));
  await expect(textInput(page)).toHaveValue('허구 미디어 안내');
  await expect(page.locator(`[data-message-id="${saved.id}"]`)).toBeVisible();
  await expect(button(page, copy.recordUpload)).toHaveCount(0);
  expect(inspectDrafts(world)[0]!.mediaCount).toBe(0);
});

test('native recording absence is honest and leaves the ordinary voice file path available', async ({
  world,
  page,
  context,
}) => {
  await installRecording(page, { supported: false });
  await openComposer(page, context, world);
  await createMediaDraft(page, 'voice');
  await expect(
    page.getByText(copy.recordUnavailable, { exact: true }),
  ).toBeVisible();
  await expect(button(page, copy.record)).toHaveCount(0);
  await expect(
    page.getByLabel(copy.fileLabel.voice, { exact: true }),
  ).toBeEnabled();
  expect((await recordingSnapshot(page)).requests).toBe(0);
});

test('ordinary large photos are resized in the real browser before the accepted upload API', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await createMediaDraft(page, 'photo');
  await page.getByLabel(copy.fileLabel.photo, { exact: true }).setInputFiles({
    name: 'private-camera-source.jpg',
    mimeType: 'image/jpeg',
    buffer: await largeImageBytes(),
  });
  await expect(page.getByText(copy.fileReady, { exact: true })).toBeVisible();
  await button(page, copy.upload).click();
  await expect(
    page.getByText(copy.uploadComplete, { exact: true }),
  ).toBeVisible();
  const id = inspectDrafts(world)[0]!.id;
  const attachment = (await contextData(page.request, world, id)).selectedDraft!
    .media[0]!;
  expect(attachment.width).toBe(COMPOSE_PHOTO.outputMaxEdge);
  expect(attachment.height).toBe(1280);
  expect(
    JSON.stringify(await contextData(page.request, world, id)),
  ).not.toContain('private-camera-source');
});

test('draft pagination can open an older owned draft and rejects a cursor rebound to another resource', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const saved: ComposeDraft[] = [];
  for (let index = 0; index < 31; index++)
    saved.push(
      await save(
        page.request,
        world,
        saveInput('text', `페이지 확인용 허구 초안 ${index}`),
      ),
    );
  const first = await contextData(page.request, world);
  expect(first.drafts).toHaveLength(30);
  expect(first.hasMore).toBe(true);
  expect(first.nextCursor).not.toBeNull();
  const response = await post(page.request, endpoint(world), {
    messageId: null,
    cursor: first.nextCursor,
  });
  expect(response.status()).toBe(200);
  const second = (await response.json()).data as ComposePageData;
  expect(second.drafts.map((item) => item.id)).toEqual([saved[0]!.id]);
  expect(second.hasMore).toBe(false);
  await denied(
    await post(page.request, endpoint(world), {
      messageId: null,
      cursor: 'invalid cursor',
    }),
    [400],
  );
  const rebound = Buffer.from(
    JSON.stringify({
      ...JSON.parse(
        Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
      ),
      slug: 'other-fictional-artist',
    }),
  ).toString('base64url');
  await denied(
    await post(page.request, endpoint(world), {
      messageId: null,
      cursor: rebound,
    }),
    [400],
  );
  await page.goto(artistComposePath(world.artist.slug));
  await expect(page.locator('[data-message-id]')).toHaveCount(30);
  await button(page, copy.older).click();
  await expect(page.locator('[data-message-id]')).toHaveCount(31);
  await page
    .locator(`[data-message-id="${saved[0]!.id}"]`)
    .getByRole('button')
    .click();
  await expect(textInput(page)).toHaveValue(saved[0]!.body!);
  await expect(page).toHaveURL(
    artistComposePath(world.artist.slug, saved[0]!.id),
  );
});

test('unsaved changes require a deliberate discard and cancel keeps the local text', async ({
  world,
  page,
  context,
}, info) => {
  await openComposer(page, context, world);
  await saveFromUi(page, '서버에 저장한 허구 원문');
  await textInput(page).fill('아직 저장하지 않은 허구 수정');
  await button(page, copy.new).click();
  await expect(
    page.getByRole('dialog', { name: copy.discardTitle }),
  ).toBeVisible();
  await screenshot(page, info, 'unsaved-discard-confirmation');
  await button(page, copy.stay).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(textInput(page)).toHaveValue('아직 저장하지 않은 허구 수정');
  await button(page, copy.new).click();
  await button(page, copy.discard).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(textInput(page)).toHaveValue('');
  expect(inspectDrafts(world)[0]!.body).toBe('서버에 저장한 허구 원문');
});

test('photo-count limits disable more uploads and explicit removal frees only the selected attachment slot', async ({
  world,
  page,
  context,
}) => {
  await openComposer(page, context, world);
  await createMediaDraft(page, 'photo');
  for (let index = 0; index < 2; index++) {
    await selectFile(page, 'photo');
    await button(page, copy.upload).click();
    await expect(
      page.getByText(copy.uploadComplete, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-media-id]')).toHaveCount(index + 1);
  }
  await expect(
    page.getByLabel(copy.fileLabel.photo, { exact: true }),
  ).toBeDisabled();
  const id = inspectDrafts(world)[0]!.id;
  const before = (await contextData(page.request, world, id)).selectedDraft!;
  const removedId = before.media[0]!.id;
  const keptId = before.media[1]!.id;
  await button(page, copy.remove.replace('{number}', '1')).click();
  await expect(page.locator('[data-media-id]')).toHaveCount(1);
  await expect(
    page.getByLabel(copy.fileLabel.photo, { exact: true }),
  ).toBeEnabled();
  const after = (await contextData(page.request, world, id)).selectedDraft!;
  expect(after.media.map((item) => item.id)).toEqual([keptId]);
  await denied(
    await post(page.request, routes.mediaRead, {
      mediaId: removedId,
      preview: false,
    }),
    [403, 404],
  );
  const retained = await post(page.request, routes.mediaRead, {
    mediaId: keptId,
    preview: false,
  });
  expect(retained.status()).toBe(200);
});

test('valid media belonging to another owned draft cannot be rebound through save or remove', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const first = await save(page.request, world, saveInput('photo', null));
  const second = await save(page.request, world, saveInput('photo', null));
  const media = await directUpload(
    page.request,
    first,
    await imageBytes(),
    'image/png',
  );
  await denied(
    await post(page.request, endpoint(world, 'save'), {
      ...saveInput('photo', '허구 설명'),
      messageId: second.id,
      expectedRevision: second.revision,
      mediaIds: [media.mediaId],
    }),
    [409],
  );
  await denied(
    await post(page.request, endpoint(world, 'remove'), {
      messageId: second.id,
      mediaId: media.mediaId,
      expectedRevision: second.revision,
      operationId: randomUUID(),
    }),
    [409],
  );
  expect(mediaRowCount(first.id)).toBe(1);
  expect(mediaRowCount(second.id)).toBe(0);
});

test('a paginated artist menu actually follows next and first links at narrow xlarge scale', async ({
  world,
  page,
  context,
}, info) => {
  const assigned = [world.artist, ...addAssignedArtists(world, 50)].sort(
    (left, right) =>
      left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0,
  );
  setFont(world.author, 'xlarge');
  await page.setViewportSize({ width: 360, height: 800 });
  await world.author.signIn(context);
  await page.goto(routes.artist);
  await expect(page.locator('html')).toHaveAttribute(
    'data-font-scale',
    'xlarge',
  );
  const composeLinks = page.locator('a[href$="/compose"]');
  await expect(composeLinks).toHaveCount(50);
  const more = page.getByRole('link', {
    name: messages.artistComposeMenu.more,
    exact: true,
  });
  await expect(more).toHaveAttribute(
    'href',
    artistComposeMenuPath(assigned[49]!.slug),
  );
  await more.click();
  await expect(page).toHaveURL(artistComposeMenuPath(assigned[49]!.slug));
  await expect(composeLinks).toHaveCount(1);
  await expect(composeLinks).toHaveAttribute(
    'href',
    artistComposePath(assigned[50]!.slug),
  );
  await expect(more).toHaveCount(0);
  const first = page.getByRole('link', {
    name: messages.artistComposeMenu.first,
    exact: true,
  });
  await expect(first).toBeVisible();
  await screenshot(page, info, 'artist-menu-next-xlarge-360');
  await first.click();
  await expect(page).toHaveURL(routes.artist);
  await expect(composeLinks).toHaveCount(50);
  await expect(first).toHaveCount(0);
  await expect(more).toBeVisible();
  await screenshot(page, info, 'artist-menu-first-xlarge-360');
});

test('a foreign-owned draft error follows the actual recovery link back to the assigned artist menu', async ({
  world,
  page,
  context,
}, info) => {
  await world.author.signIn(context);
  const draft = await save(
    page.request,
    world,
    saveInput('text', '다른 작성자에게 보이지 않을 허구 초안'),
  );
  addMembership(world, world.outsider);
  setFont(world.outsider, 'xlarge');
  await page.setViewportSize({ width: 360, height: 800 });
  await world.outsider.signIn(context);
  await page.goto(artistComposePath(world.artist.slug, draft.id));
  await expect(page.locator('html')).toHaveAttribute(
    'data-font-scale',
    'xlarge',
  );
  await expect(
    page.getByRole('heading', {
      name: messages.artistComposeMenu.errorTitle,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(messages.artistComposeMenu.errors.NOT_FOUND, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(textInput(page)).toHaveCount(0);
  await expect(page.getByText(draft.body!, { exact: true })).toHaveCount(0);
  await button(page, messages.ui.retry).click();
  await expect(
    page.getByText(messages.artistComposeMenu.errors.NOT_FOUND, {
      exact: true,
    }),
  ).toBeVisible();
  const recovery = page.getByRole('link', {
    name: messages.artistComposeMenu.back,
    exact: true,
  });
  await expect(recovery).toHaveAttribute('href', routes.artist);
  await screenshot(page, info, 'owned-draft-error-xlarge-360');
  await recovery.click();
  await expect(page).toHaveURL(routes.artist);
  const compose = page.locator(
    `a[href="${artistComposePath(world.artist.slug)}"]`,
  );
  await expect(compose).toBeVisible();
  await screenshot(page, info, 'owned-draft-recovery-menu-xlarge-360');
  await compose.click();
  await expect(textInput(page)).toHaveValue('');
  await expect(page.getByText(copy.empty, { exact: true })).toBeVisible();
  expect(inspectDrafts(world)).toHaveLength(1);
});
