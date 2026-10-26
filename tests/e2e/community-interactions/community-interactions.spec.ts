import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
} from '@playwright/test';
import {
  communityInteractionsSchema,
  communityCommentReceiptSchema,
  communityCommentDeletedSchema,
  communityLikeReceiptSchema,
} from '../../../src/config/community-interactions';
import {
  communityBoardPath,
  communityPostPath,
  communityCommentsPath,
  communityCommentActionPath,
  communityLikePath,
} from '../../../src/config/routes';
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
  insertComment,
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
const copy = messages.communityInteractions;
const boardCopy = messages.communityPosts;
const section = (page: Page) => page.getByTestId('community-interactions');
const content = (page: Page) =>
  page.getByTestId('community-interactions-content');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const comment = (page: Page, id: string) =>
  page.locator(`[data-community-comment-id="${id}"]`);
const readPath = (world: World, cursor?: string | null) =>
  communityCommentsPath(world.artist.slug, world.post.id, cursor);
const commentPath = (world: World, id: string, action: 'edit' | 'delete') =>
  communityCommentActionPath(world.artist.slug, world.post.id, id, action);
const likePath = (world: World) =>
  communityLikePath(world.artist.slug, world.post.id);

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
async function read(
  request: APIRequestContext,
  world: World,
  actor: Identity,
  cursor?: string | null,
) {
  return communityInteractionsSchema.parse(
    await success(await get(request, readPath(world, cursor), actor)),
  );
}
function createInput(
  world: World,
  body = '새로 쓴 허구 댓글입니다. <b>이 글자는 그대로</b>',
) {
  return {
    operation_id: randomUUID(),
    post_id: world.post.id,
    comment_id: randomUUID(),
    body,
  };
}
async function create(
  request: APIRequestContext,
  world: World,
  actor: Identity,
  input = createInput(world),
) {
  return communityCommentReceiptSchema.parse(
    await success(await post(request, readPath(world), actor, input)),
  );
}
async function openDetail(page: Page, world: World) {
  const path = communityPostPath(world.artist.slug, world.post.id);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(page.getByTestId('community-post-detail')).toHaveCount(1);
  await expect(content(page)).toHaveCount(1);
  await expect(section(page).locator('[aria-busy="true"]')).toHaveCount(0);
}
async function captureControl(
  page: Page,
  target: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await expect(
    page.getByRole('main').locator('[aria-busy="true"]'),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  await target.screenshot({ path: info.outputPath(`${name}.png`) });
}
// Observe the exact method, canonical route/query and body before returning the
// real upstream result to Chromium. No synthetic successful response is used.
async function captureMutation(
  page: Page,
  path: string,
  actor: Identity,
  abort = false,
) {
  let accept!: (value: {
    input: Record<string, unknown>;
    data: unknown;
  }) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<{ input: Record<string, unknown>; data: unknown }>(
    (resolve, fail) => {
      accept = resolve;
      reject = fail;
    },
  );
  await page.route(
    `**${path}`,
    async (route) => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        expect(request.method()).toBe('POST');
        expect(url.pathname + url.search).toBe(path);
        expect(request.headers()['x-community-actor']).toBe(actor.id);
        const input = request.postDataJSON() as Record<string, unknown>;
        const response = await route.fetch();
        const data = await success(response);
        if (abort) await route.abort('failed');
        else await route.fulfill({ response });
        accept({ input, data });
      } catch (error) {
        reject(error);
        await route.abort().catch(() => undefined);
      }
    },
    { times: 1 },
  );
  return { result };
}

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('current free fans read only visible comments, accurate counters and their own like state without private identities', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const result = await read(context.request, world, world.author);
  expect(result).toMatchObject({
    actor_id: world.author.id,
    post_id: world.post.id,
    policy: { max_comment_length: 100 },
    comment_count: 2,
    like_count: 1,
    liked: false,
    next_cursor: null,
  });
  expect(result.comments.map((row) => row.id)).toEqual([
    world.ownComment.id,
    world.otherComment.id,
  ]);
  expect(result.comments.map((row) => row.is_owner)).toEqual([true, false]);
  expect(JSON.stringify(result)).not.toMatch(
    /user_id|email|phone|request_id|report_count|forbidden_terms|object_path|storage_object/,
  );
  expect(JSON.stringify(result)).not.toContain(world.hiddenComment.body);
  expect(JSON.stringify(result)).not.toContain(world.deletedComment.body);
  await world.other.signIn(context);
  expect((await read(context.request, world, world.other)).liked).toBe(true);
  await failure(
    await get(context.request, readPath(world), world.author),
    403,
    'FORBIDDEN',
  );
  await failure(await context.request.get(readPath(world)), 403, 'FORBIDDEN');
  for (const target of [world.hidden, world.deleted, { id: randomUUID() }])
    await failure(
      await get(
        context.request,
        communityCommentsPath(world.artist.slug, target.id),
        world.other,
      ),
      404,
      'NOT_FOUND',
    );
  await failure(
    await get(
      context.request,
      communityCommentsPath(world.unrelated.slug, world.post.id),
      world.other,
    ),
    404,
    'NOT_FOUND',
  );
});

test('oldest-first comment pagination is stable for tied timestamps and excludes hidden and deleted rows', async ({
  world,
  context,
}) => {
  for (let index = 0; index < 24; index += 1)
    insertComment(world.post, world.other, {
      body: `같은 시각의 허구 댓글 ${index}`,
      createdAt: '2035-05-04T00:00:00Z',
    });
  await world.author.signIn(context);
  const first = await read(context.request, world, world.author);
  expect(first.comments).toHaveLength(20);
  expect(first.next_cursor).not.toBeNull();
  const second = await read(
    context.request,
    world,
    world.author,
    JSON.stringify(first.next_cursor),
  );
  expect(second.comments).toHaveLength(6);
  expect(second.next_cursor).toBeNull();
  const all = [...first.comments, ...second.comments];
  expect(new Set(all.map((row) => row.id)).size).toBe(26);
  expect(all.map((row) => row.id)).toEqual(
    JSON.parse(
      localSql(
        `select jsonb_agg(id order by created_at,id) from public.comments where post_id='${uuid(world.post.id)}' and not is_hidden and deleted_at is null;`,
      ),
    ),
  );
  expect(first.comment_count).toBe(26);
});

test('create, edit and confirmed soft deletion replay exact receipts once and preserve counter/source invariants', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const before = sourceSnapshot(world);
  const input = createInput(world);
  const created = await create(context.request, world, world.author, input);
  expect(created).toMatchObject({
    id: input.comment_id,
    post_id: world.post.id,
    revision: 1,
  });
  expect(await create(context.request, world, world.author, input)).toEqual(
    created,
  );
  await failure(
    await post(context.request, readPath(world), world.author, {
      ...input,
      body: '변경된 재시도',
    }),
    409,
    'CONFLICT',
  );
  expect((await read(context.request, world, world.author)).comment_count).toBe(
    3,
  );
  const edit = {
    operation_id: randomUUID(),
    post_id: world.post.id,
    comment_id: created.id,
    expected_revision: created.revision,
    body: '수정한 허구 댓글입니다.',
  };
  const edited = communityCommentReceiptSchema.parse(
    await success(
      await post(
        context.request,
        commentPath(world, created.id, 'edit'),
        world.author,
        edit,
      ),
    ),
  );
  expect(edited.revision).toBe(2);
  expect(
    await success(
      await post(
        context.request,
        commentPath(world, created.id, 'edit'),
        world.author,
        edit,
      ),
    ),
  ).toEqual(edited);
  await failure(
    await post(
      context.request,
      commentPath(world, created.id, 'edit'),
      world.author,
      { ...edit, operation_id: randomUUID(), body: '오래된 리비전의 수정' },
    ),
    409,
    'CONFLICT',
  );
  const deletion = {
    operation_id: randomUUID(),
    post_id: world.post.id,
    comment_id: created.id,
    expected_revision: edited.revision,
    confirmed: true,
  };
  await failure(
    await post(
      context.request,
      commentPath(world, created.id, 'delete'),
      world.author,
      { ...deletion, confirmed: false },
    ),
    400,
    'INVALID_INPUT',
  );
  const deleted = communityCommentDeletedSchema.parse(
    await success(
      await post(
        context.request,
        commentPath(world, created.id, 'delete'),
        world.author,
        deletion,
      ),
    ),
  );
  expect(
    await success(
      await post(
        context.request,
        commentPath(world, created.id, 'delete'),
        world.author,
        deletion,
      ),
    ),
  ).toEqual(deleted);
  expect((await read(context.request, world, world.author)).comment_count).toBe(
    2,
  );
  expect(
    localSql(
      `select (deleted_at is not null)::text from public.comments where id='${uuid(created.id)}';`,
    ),
  ).toBe('true');
  expect(sourceSnapshot(world)).toBe(before);
});

test('desired likes are idempotent and replaying an older receipt cannot undo a newer unlike', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const like = {
    operation_id: randomUUID(),
    post_id: world.post.id,
    liked: true,
  };
  const receipt = communityLikeReceiptSchema.parse(
    await success(
      await post(context.request, likePath(world), world.author, like),
    ),
  );
  expect(
    await success(
      await post(context.request, likePath(world), world.author, like),
    ),
  ).toEqual(receipt);
  expect(await read(context.request, world, world.author)).toMatchObject({
    liked: true,
    like_count: 2,
  });
  const unlike = { ...like, operation_id: randomUUID(), liked: false };
  await success(
    await post(context.request, likePath(world), world.author, unlike),
  );
  expect(
    await success(
      await post(context.request, likePath(world), world.author, like),
    ),
  ).toEqual(receipt);
  expect(await read(context.request, world, world.author)).toMatchObject({
    liked: false,
    like_count: 1,
  });
  await failure(
    await post(context.request, likePath(world), world.author, {
      ...like,
      liked: false,
    }),
    409,
    'CONFLICT',
  );
  expect(
    localSql(
      `select count(*) from public.post_likes where post_id='${uuid(world.post.id)}' and user_id='${uuid(world.author.id)}';`,
    ),
  ).toBe('0');
});

test('comment validation, origin, ownership, current restrictions and policy readiness fail without writes', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const before = localSql(
    `select count(*) from public.comments where post_id='${uuid(world.post.id)}';`,
  );
  for (const body of ['', '   ', 'x'.repeat(101), '\u0000']) {
    const response = await post(
      context.request,
      readPath(world),
      world.author,
      createInput(world, body),
    );
    expect(response.ok()).toBe(false);
    expect((await response.json()).code).toBe('INVALID_INPUT');
  }
  await failure(
    await post(
      context.request,
      readPath(world),
      world.author,
      createInput(world, '금지허구표현'),
    ),
    422,
    'CONTENT_BLOCKED',
  );
  await failure(
    await context.request.post(readPath(world), {
      headers: {
        Origin: 'https://outside.invalid',
        'X-Community-Actor': world.author.id,
      },
      data: createInput(world),
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await post(
      context.request,
      commentPath(world, world.otherComment.id, 'edit'),
      world.author,
      {
        operation_id: randomUUID(),
        post_id: world.post.id,
        comment_id: world.otherComment.id,
        expected_revision: 1,
        body: '다른 사람의 글 수정 시도',
      },
    ),
    404,
    'NOT_FOUND',
  );
  await failure(
    await get(
      context.request,
      `${readPath(world)}?cursor=invalid`,
      world.author,
    ),
    400,
    'INVALID_INPUT',
  );
  setRestricted(world.author, true);
  await failure(
    await post(context.request, likePath(world), world.author, {
      operation_id: randomUUID(),
      post_id: world.post.id,
      liked: true,
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, readPath(world), world.author),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.author, false);
  localSql('delete from private.community_policy;');
  try {
    await failure(
      await get(context.request, readPath(world), world.author),
      503,
      'SETUP_NOT_READY',
    );
    await failure(
      await post(
        context.request,
        readPath(world),
        world.author,
        createInput(world),
      ),
      503,
      'SETUP_NOT_READY',
    );
  } finally {
    preparePolicy();
  }
  expect(
    localSql(
      `select count(*) from public.comments where post_id='${uuid(world.post.id)}';`,
    ),
  ).toBe(before);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: literal comments, desired likes, uncertain create recovery, cancel/edit and confirmed deletion remain usable`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.author, scale);
      await world.author.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openDetail(page, world);
      await expect(
        comment(page, world.ownComment.id).getByText(world.ownComment.body, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        comment(page, world.ownComment.id).locator('strong'),
      ).toHaveCount(0);
      await expect(
        button(comment(page, world.otherComment.id), copy.edit),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `interactions-detail-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        page.getByTestId('community-comment-create'),
        info,
        `interactions-create-control-${scale}-${width}`,
        scale,
      );
      const liked = await captureMutation(page, likePath(world), world.author);
      await button(section(page), copy.like).click();
      expect(
        communityLikeReceiptSchema.parse((await liked.result).data).liked,
      ).toBe(true);
      await expect(button(section(page), copy.unlike)).toBeEnabled();
      expect(await read(context.request, world, world.author)).toMatchObject({
        liked: true,
        like_count: 2,
      });
      const unliked = await captureMutation(
        page,
        likePath(world),
        world.author,
      );
      await button(section(page), copy.unlike).click();
      expect(
        communityLikeReceiptSchema.parse((await unliked.result).data).liked,
      ).toBe(false);
      await expect(button(section(page), copy.like)).toBeEnabled();
      const body = `허구 ${scale} ${width} 새 댓글입니다. <b>문자 그대로</b>`;
      await page.getByLabel(copy.bodyLabel, { exact: true }).fill(body);
      const lost = await captureMutation(
        page,
        readPath(world),
        world.author,
        true,
      );
      await button(section(page), copy.create).click();
      const committed = await lost.result;
      const receipt = communityCommentReceiptSchema.parse(committed.data);
      await expect(
        section(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel(copy.bodyLabel, { exact: true }),
      ).toBeDisabled();
      await expect(button(section(page), copy.like)).toBeDisabled();
      await expect(button(section(page), copy.create)).toBeDisabled();
      await screenshot(
        page,
        info,
        `interactions-create-uncertain-${scale}-${width}`,
        scale,
      );
      const retried = await captureMutation(
        page,
        readPath(world),
        world.author,
      );
      await button(section(page), copy.retryOperation).click();
      const recovered = await retried.result;
      expect(recovered.input).toEqual(committed.input);
      expect(recovered.data).toEqual(committed.data);
      await expect(
        comment(page, receipt.id).getByText(body, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel(copy.bodyLabel, { exact: true }),
      ).toHaveValue('');
      expect(
        (await read(context.request, world, world.author)).comment_count,
      ).toBe(3);
      expect(
        localSql(
          `select count(*) from public.comments where id='${uuid(receipt.id)}';`,
        ),
      ).toBe('1');
      await button(comment(page, receipt.id), copy.edit).click();
      await page
        .getByLabel(copy.editBodyLabel, { exact: true })
        .fill('취소할 허구 수정');
      await screenshot(
        page,
        info,
        `interactions-edit-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        page.getByTestId('community-comment-editor'),
        info,
        `interactions-edit-controls-${scale}-${width}`,
        scale,
      );
      await button(section(page), copy.cancelEdit).click();
      await expect(page.getByTestId('community-comment-editor')).toHaveCount(0);
      await expect(
        comment(page, receipt.id).getByText(body, { exact: true }),
      ).toBeVisible();
      await button(comment(page, receipt.id), copy.edit).click();
      const editedBody = `수정된 허구 ${scale} ${width} 댓글입니다.`;
      await page
        .getByLabel(copy.editBodyLabel, { exact: true })
        .fill(editedBody);
      const edited = await captureMutation(
        page,
        commentPath(world, receipt.id, 'edit'),
        world.author,
      );
      await button(section(page), copy.save).click();
      expect(
        communityCommentReceiptSchema.parse((await edited.result).data)
          .revision,
      ).toBe(2);
      await expect(
        comment(page, receipt.id).getByText(editedBody, { exact: true }),
      ).toBeVisible();
      await button(comment(page, receipt.id), copy.delete).click();
      let dialog = page.getByRole('dialog', { name: copy.deleteDialogTitle });
      await expect(dialog).toBeVisible();
      await screenshot(
        page,
        info,
        `interactions-delete-confirm-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        button(dialog, copy.deleteDialogConfirm),
        info,
        `interactions-delete-confirm-control-${scale}-${width}`,
        scale,
      );
      await button(dialog, copy.deleteDialogCancel).click();
      await expect(dialog).toHaveCount(0);
      expect(
        (await read(context.request, world, world.author)).comment_count,
      ).toBe(3);
      await button(comment(page, receipt.id), copy.delete).click();
      dialog = page.getByRole('dialog', { name: copy.deleteDialogTitle });
      const deleted = await captureMutation(
        page,
        commentPath(world, receipt.id, 'delete'),
        world.author,
      );
      await button(dialog, copy.deleteDialogConfirm).click();
      expect(
        communityCommentDeletedSchema.parse((await deleted.result).data)
          .deleted,
      ).toBe(true);
      await expect(comment(page, receipt.id)).toHaveCount(0);
      await expect(content(page)).toHaveCount(1);
      expect(
        (await read(context.request, world, world.author)).comment_count,
      ).toBe(2);
      await screenshot(
        page,
        info,
        `interactions-deleted-${scale}-${width}`,
        scale,
      );
    });

for (const kind of ['edit', 'delete', 'like'] as const)
  test(`${kind}: an actual committed lost response recovers only the identical operation`, async ({
    world,
    context,
    page,
  }, info) => {
    const scale = 'xlarge';
    setFont(world.author, scale);
    await world.author.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    await openDetail(page, world);
    const path =
      kind === 'like'
        ? likePath(world)
        : commentPath(world, world.ownComment.id, kind);
    if (kind === 'edit') {
      await button(comment(page, world.ownComment.id), copy.edit).click();
      await page
        .getByLabel(copy.editBodyLabel, { exact: true })
        .fill('응답 유실 이후에도 한 번만 수정한 허구 댓글');
    }
    if (kind === 'delete')
      await button(comment(page, world.ownComment.id), copy.delete).click();
    const lost = await captureMutation(page, path, world.author, true);
    if (kind === 'delete')
      await button(
        page.getByRole('dialog', { name: copy.deleteDialogTitle }),
        copy.deleteDialogConfirm,
      ).click();
    else
      await button(
        section(page),
        kind === 'edit' ? copy.save : copy.like,
      ).click();
    const committed = await lost.result;
    await expect(
      section(page).getByText(copy.uncertain, { exact: true }),
    ).toBeVisible();
    await expect(button(section(page), copy.create)).toBeDisabled();
    await screenshot(
      page,
      info,
      `interactions-${kind}-uncertain-xlarge-360`,
      scale,
    );
    const replay = await captureMutation(page, path, world.author);
    await button(section(page), copy.retryOperation).click();
    expect(await replay.result).toEqual(committed);
    await expect(
      page.getByTestId('community-interactions-recovery'),
    ).toHaveCount(0);
    await expect(content(page)).toHaveCount(1);
    const current = await read(context.request, world, world.author);
    if (kind === 'like')
      expect(current).toMatchObject({ liked: true, like_count: 2 });
    if (kind === 'edit')
      expect(
        current.comments.find((row) => row.id === world.ownComment.id),
      ).toMatchObject({
        body: '응답 유실 이후에도 한 번만 수정한 허구 댓글',
        revision: 2,
      });
    if (kind === 'delete') expect(current).toMatchObject({ comment_count: 1 });
    await screenshot(
      page,
      info,
      `interactions-${kind}-recovered-xlarge-360`,
      scale,
    );
  });

test('rapid duplicate clicks submit one immutable desired-like operation and one counter increment', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  await openDetail(page, world);
  const requests: unknown[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      request.method() === 'POST' &&
      url.pathname + url.search === likePath(world)
    )
      requests.push(request.postDataJSON());
  });
  const mutation = await captureMutation(page, likePath(world), world.author);
  await button(section(page), copy.like).evaluate(
    (element: HTMLButtonElement) => {
      element.click();
      element.click();
      element.click();
    },
  );
  await mutation.result;
  await expect(button(section(page), copy.unlike)).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(await read(context.request, world, world.author)).toMatchObject({
    liked: true,
    like_count: 2,
  });
});

test('uncertain recovery is bound to the original account and never replays through a replacement session', async ({
  world,
  page,
  context,
}, info) => {
  for (const actor of [world.author, world.other]) setFont(actor, 'xlarge');
  await world.author.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  const lost = await captureMutation(page, likePath(world), world.author, true);
  await button(section(page), copy.like).click();
  const first = await lost.result;
  await expect(page.getByTestId('community-interactions-recovery')).toHaveCount(
    1,
  );
  await world.other.signIn(context);
  let accept!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const denied = new Promise<unknown>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  await page.route(
    `**${likePath(world)}`,
    async (route) => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        expect(request.method()).toBe('POST');
        expect(url.pathname + url.search).toBe(likePath(world));
        expect(request.headers()['x-community-actor']).toBe(world.author.id);
        const input = request.postDataJSON();
        const response = await route.fetch();
        await failure(response, 403, 'FORBIDDEN');
        await route.fulfill({ response });
        accept(input);
      } catch (error) {
        reject(error);
        await route.abort().catch(() => undefined);
      }
    },
    { times: 1 },
  );
  await button(section(page), copy.retryOperation).click();
  const retriedBody = await denied;
  expect(retriedBody).toEqual(first.input);
  await expect(page.getByTestId('community-post-detail')).toHaveCount(0);
  await expect(content(page)).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    boardCopy.errors.FORBIDDEN,
  );
  await screenshot(
    page,
    info,
    'interactions-account-recovery-denied-xlarge-360',
    'xlarge',
  );
  expect(
    localSql(
      `select count(*) from private.board_operations where actor_id='${uuid(world.other.id)}';`,
    ),
  ).toBe('0');
  await page.reload();
  await expect(content(page)).toHaveCount(1);
  await expect(
    button(comment(page, world.ownComment.id), copy.edit),
  ).toHaveCount(0);
  expect(await read(context.request, world, world.other)).toMatchObject({
    liked: true,
    like_count: 2,
  });
  await screenshot(
    page,
    info,
    'interactions-account-reloaded-xlarge-360',
    'xlarge',
  );
});

for (const change of [
  'hidden',
  'deleted',
  'paused',
  'restricted',
  'onboarding',
  'policy',
] as const)
  test(`${change}: a current interaction read removes stale parent body, comments and mutation controls`, async ({
    world,
    page,
    context,
  }, info) => {
    setFont(world.author, 'xlarge');
    await world.author.signIn(context);
    await page.setViewportSize({ width: 360, height: 900 });
    await openDetail(page, world);
    if (change === 'hidden')
      localSql(
        `update public.posts set is_hidden=true where id='${uuid(world.post.id)}';`,
      );
    if (change === 'deleted')
      localSql(
        `update public.posts set deleted_at=clock_timestamp() where id='${uuid(world.post.id)}';`,
      );
    if (change === 'paused')
      localSql(
        `update public.artists set status='paused' where id='${uuid(world.artist.id)}';`,
      );
    if (change === 'restricted') setRestricted(world.author, true);
    if (change === 'onboarding')
      localSql(
        `update public.profiles set onboarding_completed_at=null where id='${uuid(world.author.id)}';`,
      );
    if (change === 'policy') localSql('delete from private.community_policy;');
    try {
      await button(section(page), copy.refresh).click();
      const code =
        change === 'policy'
          ? 'SETUP_NOT_READY'
          : change === 'restricted' || change === 'onboarding'
            ? 'FORBIDDEN'
            : 'NOT_FOUND';
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(
        boardCopy.errors[code],
      );
      await expect(page.getByTestId('community-post-detail')).toHaveCount(0);
      await expect(content(page)).toHaveCount(0);
      await expect(
        page.getByRole('main').getByText(world.post.body, { exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole('main')
          .getByText(world.ownComment.body, { exact: true }),
      ).toHaveCount(0);
      await expect(button(section(page), copy.create)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `interactions-${change}-removed-xlarge-360`,
        'xlarge',
      );
    } finally {
      if (change === 'policy') preparePolicy();
    }
  });

for (const change of ['hidden', 'deleted'] as const)
  test(`${change} comment: a stale editor cannot resurrect content and parent retry reads only the still-visible post`, async ({
    world,
    page,
    context,
  }) => {
    await world.author.signIn(context);
    await openDetail(page, world);
    await button(comment(page, world.ownComment.id), copy.edit).click();
    await page
      .getByLabel(copy.editBodyLabel, { exact: true })
      .fill('사라진 댓글을 되살릴 수 없는 수정');
    localSql(
      `update public.comments set ${change === 'hidden' ? 'is_hidden=true' : 'deleted_at=clock_timestamp()'} where id='${uuid(world.ownComment.id)}'; update public.posts set comment_count=1 where id='${uuid(world.post.id)}';`,
    );
    await button(section(page), copy.save).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      boardCopy.errors.NOT_FOUND,
    );
    await expect(page.getByTestId('community-post-detail')).toHaveCount(0);
    expect(
      localSql(
        `select body from public.comments where id='${uuid(world.ownComment.id)}';`,
      ),
    ).toBe(world.ownComment.body);
    await button(page.getByRole('main'), messages.ui.retry).click();
    await expect(page.getByTestId('community-post-detail')).toHaveCount(1);
    await expect(content(page)).toHaveCount(1);
    await expect(comment(page, world.ownComment.id)).toHaveCount(0);
    expect(
      (await read(context.request, world, world.author)).comment_count,
    ).toBe(1);
  });

test('a stale revision conflict requires a current read and cannot overwrite another committed edit', async ({
  world,
  page,
  context,
}, info) => {
  setFont(world.author, 'xlarge');
  await world.author.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  await button(comment(page, world.ownComment.id), copy.edit).click();
  await page
    .getByLabel(copy.editBodyLabel, { exact: true })
    .fill('오래된 화면의 변경');
  localSql(
    `update public.comments set body=${literal('이미 저장된 다른 허구 수정')} where id='${uuid(world.ownComment.id)}';`,
  );
  await button(section(page), copy.save).click();
  await expect(section(page).getByRole('alert')).toHaveText(
    boardCopy.errors.CONFLICT,
  );
  await expect(page.getByTestId('community-comment-editor')).toHaveCount(0);
  await expect(content(page)).toHaveCount(0);
  await screenshot(
    page,
    info,
    'interactions-revision-conflict-xlarge-360',
    'xlarge',
  );
  await button(section(page), copy.refresh).click();
  await expect(
    comment(page, world.ownComment.id).getByText('이미 저장된 다른 허구 수정', {
      exact: true,
    }),
  ).toBeVisible();
  await screenshot(
    page,
    info,
    'interactions-revision-refreshed-xlarge-360',
    'xlarge',
  );
});

test('next and first comment pages are independently current reads with usable offscreen navigation', async ({
  world,
  page,
  context,
}, info) => {
  for (let index = 0; index < 24; index += 1)
    insertComment(world.post, world.other, {
      body: `페이지 이동 허구 댓글 ${index}`,
      createdAt: '2035-05-04T00:00:00Z',
    });
  setFont(world.author, 'xlarge');
  await world.author.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  await expect(
    section(page).locator('[data-community-comment-id]'),
  ).toHaveCount(20);
  await captureControl(
    page,
    button(section(page), copy.nextPage),
    info,
    'interactions-next-page-control-xlarge-360',
    'xlarge',
  );
  await button(section(page), copy.nextPage).click();
  await expect(
    section(page).locator('[data-community-comment-id]'),
  ).toHaveCount(6);
  await expect(button(section(page), copy.firstPage)).toBeEnabled();
  await screenshot(page, info, 'interactions-next-page-xlarge-360', 'xlarge');
  await button(section(page), copy.firstPage).click();
  await expect(comment(page, world.ownComment.id)).toHaveCount(1);
  await expect(
    section(page).locator('[data-community-comment-id]'),
  ).toHaveCount(20);
  await expect(button(section(page), copy.firstPage)).toHaveCount(0);
});

test('Cancel, Back and Forward dismiss comment editors and deletion dialogs without submitting or restoring drafts', async ({
  world,
  page,
  context,
}, info) => {
  setFont(world.author, 'xlarge');
  await world.author.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const before = localSql(
    `select count(*) from private.board_operations where actor_id='${uuid(world.author.id)}';`,
  );
  await page.goto(communityBoardPath(world.artist.slug));
  await page.getByRole('link', { name: world.post.title, exact: true }).click();
  await expect(content(page)).toHaveCount(1);
  await button(comment(page, world.ownComment.id), copy.edit).click();
  await page
    .getByLabel(copy.editBodyLabel, { exact: true })
    .fill('뒤로 가면 사라질 허구 수정 초안');
  await button(section(page), copy.cancelEdit).click();
  await expect(page.getByTestId('community-comment-editor')).toHaveCount(0);
  await button(comment(page, world.ownComment.id), copy.delete).click();
  await expect(
    page.getByRole('dialog', { name: copy.deleteDialogTitle }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(communityBoardPath(world.artist.slug));
  await expect(page.getByTestId('community-post-list')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(
    communityPostPath(world.artist.slug, world.post.id),
  );
  await expect(content(page)).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('community-comment-editor')).toHaveCount(0);
  await expect(
    comment(page, world.ownComment.id).getByText(world.ownComment.body, {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    localSql(
      `select count(*) from private.board_operations where actor_id='${uuid(world.author.id)}';`,
    ),
  ).toBe(before);
  await screenshot(
    page,
    info,
    'interactions-navigation-restored-xlarge-360',
    'xlarge',
  );
});
