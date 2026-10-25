import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
} from '@playwright/test';
import {
  COMMUNITY_POSTS,
  communityListSchema,
  communityDetailSchema,
  communityCreatedSchema,
  communityDeletedSchema,
  communityNoticeReceiptSchema,
  type CommunityCreateInput,
} from '../../../src/config/community-posts';
import {
  communityMediaPath,
  communityBoardPath,
  communityCreatePath,
  communityPostPath,
  communityPostActionPath,
} from '../../../src/config/routes';
import {
  communityImageGrantSchema,
  communityImageCompletionSchema,
  communityImageReadGrantSchema,
} from '../../../src/config/community-media';
import { observeCommunityMutation } from './response-capture';
import {
  test,
  expect,
  get,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRestricted,
  sourceSnapshot,
  localSql,
  preparePolicy,
  uuid,
  literal,
  imageBytes,
  databaseOrigin,
  type World,
  type Identity,
  type Scale,
} from './fixtures';
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.communityPosts;
const main = (page: Page) => page.getByRole('main');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const link = (root: Page | Locator, name: string) =>
  root.getByRole('link', { name, exact: true });
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
async function list(
  request: APIRequestContext,
  world: World,
  actor: Identity,
  cursor?: string | null,
) {
  return communityListSchema.parse(
    await success(
      await get(
        request,
        communityBoardPath(world.artist.slug, cursor, true),
        actor,
      ),
    ),
  );
}
async function detail(
  request: APIRequestContext,
  world: World,
  actor: Identity,
  postId = world.post.id,
) {
  return communityDetailSchema.parse(
    await success(
      await get(
        request,
        communityPostPath(world.artist.slug, postId, true),
        actor,
      ),
    ),
  );
}
function command(
  world: World,
  patch: Partial<CommunityCreateInput> = {},
): CommunityCreateInput {
  return {
    operation_id: randomUUID(),
    post_id: randomUUID(),
    artist_id: world.artist.id,
    title: '허구 새 팬 이야기 <strong>문자 그대로</strong>',
    body: '실제 팬의 자료가 아닌 격리 확인용 새 글입니다.\n노래 이야기를 반갑게 나눠요.',
    upload_ids: [],
    is_notice: false,
    is_pinned: false,
    ...patch,
  };
}
async function create(
  request: APIRequestContext,
  world: World,
  actor: Identity,
  input = command(world),
) {
  return communityCreatedSchema.parse(
    await success(
      await post(
        request,
        communityBoardPath(world.artist.slug, null, true),
        actor,
        input,
      ),
    ),
  );
}
async function openBoard(page: Page, world: World) {
  const path = communityBoardPath(world.artist.slug);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(main(page).getByTestId('community-post-list')).toHaveCount(1);
  await expect(link(main(page), world.post.title)).toBeVisible();
}
async function openDetail(page: Page, world: World, postId = world.post.id) {
  const path = communityPostPath(world.artist.slug, postId);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(main(page).getByTestId('community-post-detail')).toHaveCount(1);
}
async function captureControl(
  page: Page,
  target: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  await target.screenshot({ path: info.outputPath(`${name}.png`) });
}
test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real board reads are free to completed fans, scoped to one active artist and never return hidden/deleted posts or private identity fields', async ({
  world,
  context,
}) => {
  await world.other.signIn(context);
  const result = await list(context.request, world, world.other);
  expect(result.actor_id).toBe(world.other.id);
  expect(result.artist.id).toBe(world.artist.id);
  expect(result.posts.map((row) => row.id)).toEqual([
    world.notice.id,
    world.post.id,
  ]);
  expect(result.can_create_notice).toBe(false);
  expect(result.policy).toMatchObject({ max_images: 3, max_title_length: 120 });
  expect(result.posts.every((row) => !row.is_owner)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /user_id|email|phone|object_path|storage_object|request_id|report_count|forbidden_terms/,
  );
  expect((await detail(context.request, world, world.other)).post.body).toBe(
    world.post.body,
  );
  for (const id of [world.hidden.id, world.deleted.id, randomUUID()])
    await failure(
      await get(
        context.request,
        communityPostPath(world.artist.slug, id, true),
        world.other,
      ),
      404,
      'NOT_FOUND',
    );
  await failure(
    await get(
      context.request,
      communityPostPath(world.unrelated.slug, world.post.id, true),
      world.other,
    ),
    404,
    'NOT_FOUND',
  );
  await failure(
    await get(
      context.request,
      communityBoardPath(world.paused.slug, null, true),
      world.other,
    ),
    404,
    'NOT_FOUND',
  );
  await failure(
    await get(
      context.request,
      communityBoardPath(world.artist.slug, null, true),
      world.author,
    ),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.get(
      communityBoardPath(world.artist.slug, null, true),
    ),
    403,
    'FORBIDDEN',
  );
  await world.author.signIn(context);
  expect(
    (await detail(context.request, world, world.author)).post.is_owner,
  ).toBe(true);
  // Public board reads exclude hidden/deleted rows even for their original owner.
  await failure(
    await get(
      context.request,
      communityPostPath(world.artist.slug, world.hidden.id, true),
      world.author,
    ),
    404,
    'NOT_FOUND',
  );
});

test('pinned-first keyset pagination uses all cursor fields and preserves equal-timestamp rows without duplicates', async ({
  world,
  context,
}) => {
  const ids = Array.from({ length: 24 }, () => randomUUID());
  localSql(
    `insert into public.posts(id,artist_id,user_id,request_id,title,body,created_at) values ${ids.map((id, index) => `('${uuid(id)}','${uuid(world.artist.id)}','${uuid(world.author.id)}','${randomUUID()}',${literal(`허구 같은 시각 글 ${index}`)},'순서 확인용 허구 내용','2035-05-04T09:00:00Z')`).join(',')};`,
  );
  await world.other.signIn(context);
  const first = await list(context.request, world, world.other);
  expect(first.posts).toHaveLength(COMMUNITY_POSTS.pageSize);
  expect(first.posts[0]?.id).toBe(world.notice.id);
  expect(first.next_cursor).not.toBeNull();
  const second = await list(
    context.request,
    world,
    world.other,
    JSON.stringify(first.next_cursor),
  );
  expect(second.next_cursor).toBeNull();
  const observed = [...first.posts, ...second.posts].map((row) => row.id);
  expect(observed).toEqual([
    world.notice.id,
    ...ids.sort().reverse(),
    world.post.id,
  ]);
  expect(new Set(observed).size).toBe(26);
  await failure(
    await get(
      context.request,
      `${communityBoardPath(world.artist.slug, null, true)}?cursor=bad`,
      world.other,
    ),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await get(
      context.request,
      `${communityBoardPath(world.artist.slug, null, true)}?cursor=null&cursor=null`,
      world.other,
    ),
    400,
    'INVALID_INPUT',
  );
});

test('actual create and owner soft-delete use immutable exact retry receipts without delivery or invented rewards', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const before = sourceSnapshot(world);
  const input = command(world);
  const created = await create(context.request, world, world.author, input);
  expect(created).toEqual({
    id: input.post_id,
    artist_id: world.artist.id,
    revision: 1,
  });
  expect(await create(context.request, world, world.author, input)).toEqual(
    created,
  );
  await failure(
    await post(
      context.request,
      communityBoardPath(world.artist.slug, null, true),
      world.author,
      { ...input, title: '재시도는 원래 내용이어야 해요' },
    ),
    409,
    'CONFLICT',
  );
  expect(
    (await detail(context.request, world, world.author, created.id)).post.body,
  ).toBe(input.body);
  await world.other.signIn(context);
  const deletion = {
    operation_id: randomUUID(),
    post_id: created.id,
    expected_revision: 1,
    confirmed: true,
  };
  await failure(
    await post(
      context.request,
      communityPostActionPath(world.artist.slug, created.id, 'delete'),
      world.other,
      deletion,
    ),
    404,
    'NOT_FOUND',
  );
  await world.author.signIn(context);
  const deleted = communityDeletedSchema.parse(
    await success(
      await post(
        context.request,
        communityPostActionPath(world.artist.slug, created.id, 'delete'),
        world.author,
        deletion,
      ),
    ),
  );
  expect(deleted).toEqual({ id: created.id, deleted: true });
  expect(
    await success(
      await post(
        context.request,
        communityPostActionPath(world.artist.slug, created.id, 'delete'),
        world.author,
        deletion,
      ),
    ),
  ).toEqual(deleted);
  await failure(
    await get(
      context.request,
      communityPostPath(world.artist.slug, created.id, true),
      world.author,
    ),
    404,
    'NOT_FOUND',
  );
  expect(
    localSql(
      `select (deleted_at is not null)::text from public.posts where id='${uuid(created.id)}';`,
    ),
  ).toBe('true');
  expect(sourceSnapshot(world)).toBe(before);
});

test('only current admins create pinned notices and revisioned notice changes reject stale or changed retry payloads', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  await failure(
    await post(
      context.request,
      communityBoardPath(world.artist.slug, null, true),
      world.author,
      command(world, { is_notice: true, is_pinned: true }),
    ),
    403,
    'FORBIDDEN',
  );
  await world.admin.signIn(context);
  const input = command(world, {
    is_notice: true,
    is_pinned: true,
    title: '허구 새 상단 공지',
  });
  const created = await create(context.request, world, world.admin, input);
  expect(
    (await list(context.request, world, world.admin)).can_create_notice,
  ).toBe(true);
  const current = await detail(context.request, world, world.admin, created.id);
  expect(current.post).toMatchObject({ is_notice: true, is_pinned: true });
  const change = {
    operation_id: randomUUID(),
    post_id: created.id,
    expected_revision: current.post.revision,
    is_notice: true,
    is_pinned: false,
  };
  const receipt = communityNoticeReceiptSchema.parse(
    await success(
      await post(
        context.request,
        communityPostActionPath(world.artist.slug, created.id, 'notice'),
        world.admin,
        change,
      ),
    ),
  );
  expect(receipt.is_pinned).toBe(false);
  expect(
    await success(
      await post(
        context.request,
        communityPostActionPath(world.artist.slug, created.id, 'notice'),
        world.admin,
        change,
      ),
    ),
  ).toEqual(receipt);
  await failure(
    await post(
      context.request,
      communityPostActionPath(world.artist.slug, created.id, 'notice'),
      world.admin,
      { ...change, is_pinned: true },
    ),
    409,
    'CONFLICT',
  );
  await failure(
    await post(
      context.request,
      communityPostActionPath(world.artist.slug, created.id, 'notice'),
      world.admin,
      { ...change, operation_id: randomUUID(), is_pinned: true },
    ),
    409,
    'CONFLICT',
  );
  await world.author.signIn(context);
  await failure(
    await post(
      context.request,
      communityPostActionPath(world.artist.slug, created.id, 'notice'),
      world.author,
      {
        ...change,
        operation_id: randomUUID(),
        expected_revision: receipt.revision,
      },
    ),
    403,
    'FORBIDDEN',
  );
});

test('missing approved community policy fails closed, content filters run, and current restriction or origin failure creates nothing', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const path = communityBoardPath(world.artist.slug, null, true);
  await failure(
    await post(
      context.request,
      path,
      world.author,
      command(world, { title: '금지허구표현' }),
    ),
    422,
    'CONTENT_BLOCKED',
  );
  const missing = command(world);
  localSql('delete from private.community_policy;');
  try {
    await failure(
      await get(context.request, path, world.author),
      503,
      'SETUP_NOT_READY',
    );
    await failure(
      await post(context.request, path, world.author, missing),
      503,
      'SETUP_NOT_READY',
    );
  } finally {
    preparePolicy();
  }
  await failure(
    await context.request.post(path, {
      headers: {
        Origin: 'https://outside.invalid',
        'X-Community-Actor': world.author.id,
      },
      data: missing,
    }),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.author, true);
  await failure(
    await post(context.request, path, world.author, missing),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, path, world.author),
    403,
    'FORBIDDEN',
  );
  expect(
    localSql(
      `select count(*) from public.posts where id='${uuid(missing.post_id)}';`,
    ),
  ).toBe('0');
});

test('three verified synthetic images publish atomically and their protected read grants stop after owner deletion', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const input = command(world, { title: '허구 사진 세 장이 있는 글' });
  const bytes = await imageBytes();
  const imageIds: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const begin = {
      requestId: randomUUID(),
      artistId: world.artist.id,
      postId: input.post_id,
      mimeType: 'image/png',
      byteSize: bytes.length,
    };
    const ticket = communityImageGrantSchema.parse(
      await success(
        await post(
          context.request,
          communityMediaPath('begin'),
          world.author,
          begin,
        ),
      ),
    );
    expect(new URL(ticket.uploadUrl).origin).toBe(databaseOrigin);
    expect(Date.parse(ticket.expiresAt)).toBeGreaterThan(Date.now());
    const sent = await context.request.put(ticket.uploadUrl, {
      data: bytes,
      headers: {
        'Content-Type': 'image/png',
        'x-upsert': 'false',
        'cache-control': 'max-age=0',
      },
      maxRedirects: 0,
    });
    expect(sent.ok()).toBe(true);
    const completed = communityImageCompletionSchema.parse(
      await success(
        await post(
          context.request,
          communityMediaPath('complete'),
          world.author,
          { uploadId: ticket.uploadId },
        ),
      ),
    );
    expect(
      await success(
        await post(
          context.request,
          communityMediaPath('complete'),
          world.author,
          { uploadId: ticket.uploadId },
        ),
      ),
    ).toEqual(completed);
    input.upload_ids.push(ticket.uploadId);
    imageIds.push(completed.imageId);
  }
  // Verified staging never publishes a partial post or exposes its images.
  expect(
    localSql(
      `select count(*) from public.posts where id='${uuid(input.post_id)}';`,
    ),
  ).toBe('0');
  const unpublished = await post(
    context.request,
    communityMediaPath('read'),
    world.author,
    { postId: input.post_id, imageId: imageIds[0] },
  );
  expect(unpublished.ok()).toBe(false);
  const created = await create(context.request, world, world.author, input);
  const published = await detail(
    context.request,
    world,
    world.author,
    created.id,
  );
  expect(published.post.images.map((item) => item.id)).toEqual(imageIds);
  expect(published.post.image_count).toBe(3);
  for (const image of published.post.images)
    expect(image).toMatchObject({
      mime_type: 'image/png',
      width: 160,
      height: 100,
    });
  const readInput = { postId: created.id, imageId: imageIds[0] };
  await world.other.signIn(context);
  const grant = communityImageReadGrantSchema.parse(
    await success(
      await post(
        context.request,
        communityMediaPath('read'),
        world.other,
        readInput,
      ),
    ),
  );
  expect(new URL(grant.url).origin).toBe(databaseOrigin);
  const downloaded = await context.request.get(grant.url, { maxRedirects: 0 });
  expect(downloaded.ok()).toBe(true);
  expect(downloaded.headers()['content-type']).toContain('image/png');
  expect((await downloaded.body()).length).toBe(
    published.post.images[0]?.byte_size,
  );
  await world.author.signIn(context);
  await success(
    await post(
      context.request,
      communityPostActionPath(world.artist.slug, created.id, 'delete'),
      world.author,
      {
        operation_id: randomUUID(),
        post_id: created.id,
        expected_revision: created.revision,
        confirmed: true,
      },
    ),
  );
  await world.other.signIn(context);
  const deletedRead = await post(
    context.request,
    communityMediaPath('read'),
    world.other,
    readInput,
  );
  expect(deletedRead.ok()).toBe(false);
  expect(await deletedRead.json()).toEqual({
    ok: false,
    code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
  });
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280]) {
    test(`${scale} ${width}: list, literal detail, canceled delete, verified photo create, lost response recovery and owner deletion`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await world.author.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openBoard(page, world);
      await expect(
        main(page).locator('[data-community-post-id]').first(),
      ).toHaveAttribute('data-community-post-id', world.notice.id);
      await screenshot(page, info, `community-list-${scale}-${width}`, scale);
      await link(main(page), world.post.title).click();
      await expect(page).toHaveURL(
        communityPostPath(world.artist.slug, world.post.id),
      );
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        1,
      );
      await expect(
        main(page).getByText(world.post.body, { exact: true }),
      ).toBeVisible();
      await expect(main(page).locator('strong')).toHaveCount(0);
      await expect(
        main(page).getByRole('button', { name: /댓글|좋아요|신고/ }),
      ).toHaveCount(0);
      await screenshot(page, info, `community-detail-${scale}-${width}`, scale);
      await button(main(page), copy.deleteAction).click();
      const dialog = page.getByRole('dialog', { name: copy.deleteDialogTitle });
      await expect(dialog).toBeVisible();
      await screenshot(
        page,
        info,
        `community-delete-dialog-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        button(dialog, copy.deleteDialogCancel),
        info,
        `community-delete-cancel-control-${scale}-${width}`,
        scale,
      );
      await button(dialog, copy.deleteDialogCancel).click();
      await expect(dialog).toHaveCount(0);
      expect((await detail(context.request, world, world.author)).post.id).toBe(
        world.post.id,
      );
      await link(main(page), copy.backBoard).click();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await link(main(page), copy.create).click();
      await expect(page).toHaveURL(communityCreatePath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-form')).toHaveCount(
        1,
      );
      const input = command(world, {
        title: `허구 ${scale} ${width} 사진과 함께 쓰는 글`,
      });
      await page.getByLabel(copy.titleLabel, { exact: true }).fill(input.title);
      await page.getByLabel(copy.bodyLabel, { exact: true }).fill(input.body);
      await page.getByLabel(copy.imageLabel, { exact: true }).setInputFiles({
        name: 'fictional-community.png',
        mimeType: 'image/png',
        buffer: await imageBytes(),
      });
      await button(main(page), copy.upload).click();
      await expect(
        main(page).getByText(copy.uploadVerified, { exact: true }),
      ).toBeVisible();
      await expect(button(main(page), copy.createSave)).toBeEnabled();
      await screenshot(
        page,
        info,
        `community-photo-ready-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        button(main(page), copy.createSave),
        info,
        `community-create-control-${scale}-${width}`,
        scale,
      );
      const path = communityBoardPath(world.artist.slug, null, true);
      const createRequests: unknown[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === path
        )
          createRequests.push(request.postDataJSON());
      });
      let captured: CommunityCreateInput | undefined;
      let receipt: ReturnType<typeof communityCreatedSchema.parse> | undefined;
      await page.route(
        `**${path}`,
        async (route) => {
          if (route.request().method() !== 'POST') return route.fallback();
          expect(
            route.request().headers()[
              COMMUNITY_POSTS.actorHeader.toLowerCase()
            ],
          ).toBe(world.author.id);
          captured = route.request().postDataJSON() as CommunityCreateInput;
          const response = await route.fetch();
          receipt = communityCreatedSchema.parse(await success(response));
          await route.abort('failed');
        },
        { times: 1 },
      );
      await button(main(page), copy.createSave).click();
      await expect(
        main(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(button(main(page), copy.retryOperation)).toBeEnabled();
      await expect(
        page.getByLabel(copy.titleLabel, { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel(copy.bodyLabel, { exact: true }),
      ).toBeDisabled();
      await expect(button(main(page), copy.cancel)).toBeDisabled();
      await expect(button(main(page), copy.backBoard)).toBeDisabled();
      expect(captured?.upload_ids).toHaveLength(1);
      expect(receipt?.id).toBe(captured?.post_id);
      await screenshot(
        page,
        info,
        `community-create-uncertain-${scale}-${width}`,
        scale,
      );
      const retried = await observeCommunityMutation(
        page,
        path,
        async (response) =>
          communityCreatedSchema.parse(await success(response)),
      );
      await button(main(page), copy.retryOperation).click();
      const recovered = await retried.result;
      expect(recovered).toEqual(receipt);
      expect(createRequests).toEqual([captured, captured]);
      await expect(page).toHaveURL(
        communityPostPath(world.artist.slug, recovered.id),
      );
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        1,
      );
      await expect(
        main(page).getByRole('heading', { name: input.title, exact: true }),
      ).toBeVisible();
      expect(
        localSql(
          `select count(*) from public.posts where user_id='${uuid(world.author.id)}' and request_id='${uuid(captured!.operation_id)}';`,
        ),
      ).toBe('1');
      await button(main(page), copy.imageOpen.replace('{number}', '1')).click();
      const image = main(page).getByRole('img', {
        name: copy.imageAlt.replace('{number}', '1'),
        exact: true,
      });
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate(
            (element) =>
              (element as HTMLImageElement).complete &&
              (element as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
      await screenshot(
        page,
        info,
        `community-created-photo-${scale}-${width}`,
        scale,
      );
      await button(main(page), copy.imageClose).click();
      await expect(image).toHaveCount(0);
      await button(main(page), copy.deleteAction).click();
      const confirmed = page.getByRole('dialog', {
        name: copy.deleteDialogTitle,
      });
      const deletePath = communityPostActionPath(
        world.artist.slug,
        recovered.id,
        'delete',
      );
      const deleteRequests: unknown[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === deletePath
        )
          deleteRequests.push(request.postDataJSON());
      });
      let deletedReceipt:
        ReturnType<typeof communityDeletedSchema.parse> | undefined;
      await page.route(
        `**${deletePath}`,
        async (route) => {
          const response = await route.fetch();
          deletedReceipt = communityDeletedSchema.parse(
            await success(response),
          );
          await route.abort('failed');
        },
        { times: 1 },
      );
      await button(confirmed, copy.deleteDialogConfirm).click();
      await expect(
        main(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `community-delete-uncertain-${scale}-${width}`,
        scale,
      );
      const deleted = await observeCommunityMutation(
        page,
        deletePath,
        async (response) =>
          communityDeletedSchema.parse(await success(response)),
      );
      await button(main(page), copy.retryOperation).click();
      expect(await deleted.result).toEqual({ id: recovered.id, deleted: true });
      expect(deletedReceipt).toEqual({ id: recovered.id, deleted: true });
      expect(deleteRequests).toHaveLength(2);
      expect(deleteRequests[1]).toEqual(deleteRequests[0]);
      await expect(page).toHaveURL(
        communityPostPath(world.artist.slug, recovered.id),
      );
      await expect(main(page).getByRole('status')).toHaveText(copy.deleted);
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        0,
      );
      await screenshot(
        page,
        info,
        `community-after-delete-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.backBoard).click();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await expect(link(main(page), input.title)).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(
        communityPostPath(world.artist.slug, recovered.id),
      );
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        0,
      );
      await expect(
        main(page).getByText(input.body, { exact: true }),
      ).toHaveCount(0);
      await failure(
        await get(
          context.request,
          communityPostPath(world.artist.slug, recovered.id, true),
          world.author,
        ),
        404,
        'NOT_FOUND',
      );
      await screenshot(
        page,
        info,
        `community-deleted-history-${scale}-${width}`,
        scale,
      );
    });

    test(`${scale} ${width}: admin notice and pin controls persist real revisioned changes and conflicts require a fresh read`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openDetail(page, world, world.post.id);
      const notice = page.getByLabel(copy.noticeLabel, { exact: true });
      const pinned = page.getByLabel(copy.pinnedLabel, { exact: true });
      await notice.check();
      await pinned.check();
      await screenshot(
        page,
        info,
        `community-notice-editor-${scale}-${width}`,
        scale,
      );
      const noticePath = communityPostActionPath(
        world.artist.slug,
        world.post.id,
        'notice',
      );
      const noticeRequests: unknown[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          new URL(request.url()).pathname === noticePath
        )
          noticeRequests.push(request.postDataJSON());
      });
      let firstReceipt:
        ReturnType<typeof communityNoticeReceiptSchema.parse> | undefined;
      await page.route(
        `**${noticePath}`,
        async (route) => {
          firstReceipt = communityNoticeReceiptSchema.parse(
            await success(await route.fetch()),
          );
          await route.abort('failed');
        },
        { times: 1 },
      );
      await button(main(page), copy.saveNotice).click();
      await expect(
        main(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(notice).toBeDisabled();
      await expect(pinned).toBeDisabled();
      await screenshot(
        page,
        info,
        `community-notice-uncertain-${scale}-${width}`,
        scale,
      );
      const changed = await observeCommunityMutation(
        page,
        noticePath,
        async (response) =>
          communityNoticeReceiptSchema.parse(await success(response)),
      );
      await button(main(page), copy.retryOperation).click();
      expect(await changed.result).toEqual(firstReceipt);
      expect(firstReceipt).toMatchObject({
        id: world.post.id,
        is_notice: true,
        is_pinned: true,
      });
      expect(noticeRequests).toHaveLength(2);
      expect(noticeRequests[1]).toEqual(noticeRequests[0]);
      await expect(
        main(page).getByText(copy.noticeSaved, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `community-notice-saved-${scale}-${width}`,
        scale,
      );
      const current = await detail(context.request, world, world.admin);
      await success(
        await post(
          context.request,
          communityPostActionPath(world.artist.slug, world.post.id, 'notice'),
          world.admin,
          {
            operation_id: randomUUID(),
            post_id: world.post.id,
            expected_revision: current.post.revision,
            is_notice: false,
            is_pinned: false,
          },
        ),
      );
      await pinned.uncheck();
      await button(main(page), copy.saveNotice).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.CONFLICT,
      );
      await screenshot(
        page,
        info,
        `community-notice-conflict-${scale}-${width}`,
        scale,
      );
      await button(main(page), messages.ui.retry).click();
      await expect(notice).not.toBeChecked();
      await expect(pinned).not.toBeChecked();
      await expect(main(page).getByRole('alert')).toHaveCount(0);
      await screenshot(
        page,
        info,
        `community-notice-refreshed-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.backBoard).click();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await screenshot(
        page,
        info,
        `community-notice-board-${scale}-${width}`,
        scale,
      );
    });

    test(`${scale} ${width}: cancel and history never publish drafts; account switch and restriction clear mounted private state`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      setFont(world.other, scale);
      await world.author.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openBoard(page, world);
      localSql('delete from private.community_policy;');
      try {
        await button(main(page), copy.refresh).click();
        await expect(main(page).getByRole('alert')).toHaveText(
          copy.errors.SETUP_NOT_READY,
        );
        await expect(main(page).getByTestId('community-post-list')).toHaveCount(
          0,
        );
        await expect(link(main(page), copy.create)).toHaveCount(0);
        await screenshot(
          page,
          info,
          `community-policy-missing-${scale}-${width}`,
          scale,
        );
      } finally {
        preparePolicy();
      }
      await button(main(page), messages.ui.retry).click();
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      localSql(
        `update public.posts set deleted_at=clock_timestamp() where artist_id='${uuid(world.unrelated.id)}';`,
      );
      await page.goto(communityBoardPath(world.unrelated.slug));
      await expect(
        main(page).getByRole('heading', { name: copy.emptyTitle, exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `community-empty-${scale}-${width}`, scale);
      await openBoard(page, world);
      await link(main(page), copy.create).click();
      await expect(main(page).getByTestId('community-post-form')).toHaveCount(
        1,
      );
      await page
        .getByLabel(copy.titleLabel, { exact: true })
        .fill('취소할 허구 초안');
      await page
        .getByLabel(copy.bodyLabel, { exact: true })
        .fill('뒤로 이동하거나 취소해도 자동 게시되지 않습니다.');
      await screenshot(
        page,
        info,
        `community-cancel-draft-${scale}-${width}`,
        scale,
      );
      await button(main(page), copy.cancel).click();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await page.goBack();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await expect(main(page).getByTestId('community-post-form')).toHaveCount(
        0,
      );
      await page.goForward();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      await expect(main(page).getByTestId('community-post-form')).toHaveCount(
        0,
      );
      await link(main(page), copy.create).click();
      await expect(main(page).getByTestId('community-post-form')).toHaveCount(
        1,
      );
      await expect(
        page.getByLabel(copy.titleLabel, { exact: true }),
      ).toHaveValue('');
      await button(main(page), copy.backBoard).click();
      await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
      await expect(main(page).getByTestId('community-post-list')).toHaveCount(
        1,
      );
      expect(
        localSql(
          `select count(*) from public.posts where user_id='${uuid(world.author.id)}' and title='취소할 허구 초안';`,
        ),
      ).toBe('0');
      await link(main(page), world.post.title).click();
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        1,
      );
      await world.other.signIn(context);
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        0,
      );
      await expect(
        main(page).getByText(world.post.body, { exact: true }),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `community-account-changed-${scale}-${width}`,
        scale,
      );
      await page.reload();
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        1,
      );
      await expect(button(main(page), copy.deleteAction)).toHaveCount(0);
      await expect(
        page.getByLabel(copy.noticeLabel, { exact: true }),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `community-other-fan-${scale}-${width}`,
        scale,
      );
      setRestricted(world.other, true);
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('community-post-detail')).toHaveCount(
        0,
      );
      await screenshot(
        page,
        info,
        `community-restricted-${scale}-${width}`,
        scale,
      );
    });
  }

test('explicit composer cancellation revokes every staged image reservation before navigation and frees the approved capacity for a new draft', async ({
  world,
  page,
  context,
}, info) => {
  const scale = 'xlarge';
  setFont(world.author, scale);
  await world.author.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const policy = (await list(context.request, world, world.author)).policy;
  expect(policy.max_images).toBe(3);
  const beforePosts = localSql(
    `select count(*) from public.posts where user_id='${uuid(world.author.id)}';`,
  );
  await page.goto(communityCreatePath(world.artist.slug));
  await expect(main(page).getByTestId('community-post-form')).toHaveCount(1);
  const bytes = await imageBytes();
  for (let index = 0; index < policy.max_images; index += 1) {
    await page.getByLabel(copy.imageLabel, { exact: true }).setInputFiles({
      name: `fictional-cancel-${index}.png`,
      mimeType: 'image/png',
      buffer: bytes,
    });
    await button(main(page), copy.upload).click();
    await expect(
      main(page).getByText(copy.uploadVerified, { exact: true }),
    ).toHaveCount(index + 1);
  }
  await expect(
    page.getByLabel(copy.imageLabel, { exact: true }),
  ).toBeDisabled();
  expect(
    localSql(
      `select count(*) from private.board_uploads where actor_id='${uuid(world.author.id)}' and state='completed' and attached_at is null;`,
    ),
  ).toBe(String(policy.max_images));
  await screenshot(
    page,
    info,
    'community-cancel-full-capacity-xlarge-360',
    scale,
  );
  await button(main(page), copy.cancel).click();
  await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
  await expect(main(page).getByTestId('community-post-list')).toHaveCount(1);
  expect(
    localSql(
      `select count(*) from private.board_uploads where actor_id='${uuid(world.author.id)}' and state='revoked' and revoked_at is not null and attached_at is null;`,
    ),
  ).toBe(String(policy.max_images));
  expect(
    localSql(
      `select count(*) from private.board_uploads where actor_id='${uuid(world.author.id)}' and state<>'revoked' and attached_at is null;`,
    ),
  ).toBe('0');
  expect(
    localSql(
      `select count(*) from public.posts where user_id='${uuid(world.author.id)}';`,
    ),
  ).toBe(beforePosts);
  await link(main(page), copy.create).click();
  await expect(main(page).getByTestId('community-post-form')).toHaveCount(1);
  await page.getByLabel(copy.imageLabel, { exact: true }).setInputFiles({
    name: 'fictional-new-draft.png',
    mimeType: 'image/png',
    buffer: bytes,
  });
  await button(main(page), copy.upload).click();
  await expect(
    main(page).getByText(copy.uploadVerified, { exact: true }),
  ).toHaveCount(1);
  expect(
    localSql(
      `select count(*) from private.board_uploads where actor_id='${uuid(world.author.id)}' and state='completed' and attached_at is null;`,
    ),
  ).toBe('1');
  await screenshot(
    page,
    info,
    'community-cancel-capacity-reused-xlarge-360',
    scale,
  );
  await button(main(page), copy.backBoard).click();
  await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
  await expect(main(page).getByTestId('community-post-list')).toHaveCount(1);
  expect(
    localSql(
      `select count(*) from private.board_uploads where actor_id='${uuid(world.author.id)}' and state='revoked' and revoked_at is not null and attached_at is null;`,
    ),
  ).toBe(String(policy.max_images + 1));
  expect(
    localSql(
      `select count(*) from public.posts where user_id='${uuid(world.author.id)}';`,
    ),
  ).toBe(beforePosts);
});
