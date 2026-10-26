import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIResponse,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test';
import {
  moderationContextSchema,
  moderationReportReceiptSchema,
  moderationQueueSchema,
  moderationResolveReceiptSchema,
  moderationRestrictReceiptSchema,
  moderationNoticesSchema,
  type ModerationTarget,
  type ModerationReport,
} from '../../../src/config/community-moderation';
import {
  routes,
  moderationContextPath,
  moderationReportPath,
  moderationQueuePath,
  moderationNoticesPath,
  moderationAdminActionPath,
  communityPostPath,
  communityCommentsPath,
  communityLikePath,
  artistReplyActivityPath,
  artistReplyActivityApiPath,
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
  sourceSnapshot,
  localSql,
  preparePolicy,
  uuid,
  insertPost,
  createIdentity,
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
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const target = (
  world: World,
  kind: ModerationTarget['target_type'],
): ModerationTarget => ({
  target_type: kind,
  target_id:
    kind === 'post'
      ? world.post.id
      : kind === 'comment'
        ? world.ownComment.id
        : world.reply.id,
});
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
function reportInput(
  value: ModerationTarget,
  reason = '격리 CI의 허구 신고 사유입니다.',
) {
  return { operation_id: randomUUID(), ...value, reason };
}
async function report(
  context: BrowserContext,
  actor: Identity,
  value: ModerationTarget,
  input = reportInput(value),
) {
  await actor.signIn(context);
  return moderationReportReceiptSchema.parse(
    await success(
      await post(context.request, moderationReportPath(), actor, input),
    ),
  );
}
async function queue(
  context: BrowserContext,
  world: World,
  cursor?: string | null,
) {
  return moderationQueueSchema.parse(
    await success(
      await get(context.request, moderationQueuePath(cursor), world.admin),
    ),
  );
}
async function findReport(
  context: BrowserContext,
  world: World,
  value: ModerationTarget,
): Promise<ModerationReport> {
  await world.admin.signIn(context);
  let current = await queue(context, world);
  for (;;) {
    const found = current.reports.find(
      (item) =>
        item.target_id === value.target_id &&
        item.target_type === value.target_type,
    );
    if (found) return found;
    expect(current.next_cursor).not.toBeNull();
    current = await queue(context, world, JSON.stringify(current.next_cursor));
  }
}
async function resolve(
  context: BrowserContext,
  world: World,
  row: ModerationReport,
  decision: 'restore' | 'delete',
) {
  const input = {
    operation_id: randomUUID(),
    report_id: row.id,
    expected_revision: row.target.revision,
    decision,
    reason: '격리 CI 검토 결과에 따른 허구 결정',
    confirmed: true as const,
  };
  const receipt = moderationResolveReceiptSchema.parse(
    await success(
      await post(
        context.request,
        moderationAdminActionPath('resolve'),
        world.admin,
        input,
      ),
    ),
  );
  return { input, receipt };
}
function contentState(value: ModerationTarget) {
  const table = { post: 'posts', comment: 'comments', reply: 'replies' }[
    value.target_type
  ];
  const hidden = 'is_hidden';
  return JSON.parse(
    localSql(
      `select jsonb_build_object('hidden',${hidden},'deleted',deleted_at is not null,'count',report_count) from public.${table} where id='${uuid(value.target_id)}';`,
    ),
  ) as { hidden: boolean; deleted: boolean; count: number };
}
async function notices(context: BrowserContext, actor: Identity) {
  await actor.signIn(context);
  return moderationNoticesSchema.parse(
    await success(await get(context.request, moderationNoticesPath(), actor)),
  );
}
// Observe and verify the upstream commit before returning or dropping its real
// response. A dropped response is never replaced with a synthetic success.
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
    (done, fail) => {
      accept = done;
      reject = fail;
    },
  );
  await page.route(
    `**${path}`,
    async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
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
async function captureControl(
  page: Page,
  control: Locator,
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
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await control.screenshot({ path: info.outputPath(`${name}.png`) });
}
// A production worker owns full-document navigation after the initial page.
// page.route cannot intercept that navigation, but authenticated APIs bypass
// the worker. Observe the actual destination queue request instead, validating
// the current actor and payload before forwarding the response to React.
async function captureQueueArrival(page: Page, actor: Identity) {
  let accept!: () => void, reject!: (reason: unknown) => void;
  const result = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    `**${moderationQueuePath()}`,
    async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        expect(request.method()).toBe('GET');
        expect(url.pathname + url.search).toBe(moderationQueuePath());
        expect(request.headers()['x-community-actor']).toBe(actor.id);
        const response = await route.fetch();
        const data = moderationQueueSchema.parse(await success(response));
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
// Wait for the exact real RSC response before forwarding it, not for a prior
// same-URL document or a URL change that can precede the hydrated destination.
async function captureNavigation(page: Page, path: string) {
  let accept!: () => void, reject!: (reason: unknown) => void;
  const result = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) =>
      url.pathname + url.searchParams.toString().replace(/^(.+)$/, '?$1') ===
        path ||
      (url.pathname === path && url.searchParams.has('_rsc')),
    async (route) => {
      try {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
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

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('contexts are current-actor bound and reveal no target text, reporter identity or private policy data', async ({
  world,
  context,
}) => {
  await world.other.signIn(context);
  for (const kind of ['post', 'comment'] as const) {
    const value = target(world, kind);
    const data = moderationContextSchema.parse(
      await success(
        await get(context.request, moderationContextPath(value), world.other),
      ),
    );
    expect(data).toEqual({
      actor_id: world.other.id,
      ...value,
      max_reason_length: 1000,
      existing_report: null,
    });
    expect(JSON.stringify(data)).not.toMatch(
      /body|email|phone|reporter_id|forbidden_terms|object_path/,
    );
  }
  await failure(
    await get(
      context.request,
      moderationContextPath(target(world, 'post')),
      world.author,
    ),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.get(moderationContextPath(target(world, 'post'))),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, moderationQueuePath(), world.other),
    403,
    'FORBIDDEN',
  );
  await world.artistAccount.signIn(context);
  expect(
    moderationContextSchema.parse(
      await success(
        await get(
          context.request,
          moderationContextPath(target(world, 'reply')),
          world.artistAccount,
        ),
      ),
    ).existing_report,
  ).toBeNull();
});

for (const kind of ['post', 'comment', 'reply'] as const)
  test(`${kind}: only distinct authorized reporters reach the approved threshold and exact replay cannot increment it`, async ({
    world,
    context,
  }) => {
    const value = target(world, kind),
      first = kind === 'reply' ? world.artistAccount : world.other,
      second = kind === 'reply' ? world.admin : world.second;
    const before = sourceSnapshot(world),
      input = reportInput(value);
    const receipt = await report(context, first, value, input);
    expect(await report(context, first, value, input)).toEqual(receipt);
    expect(await report(context, first, value)).toEqual(receipt);
    expect(contentState(value)).toEqual({
      hidden: false,
      deleted: false,
      count: 1,
    });
    await report(context, second, value);
    expect(contentState(value)).toEqual({
      hidden: true,
      deleted: false,
      count: 2,
    });
    expect(await report(context, first, value, input)).toEqual(receipt);
    expect(
      localSql(
        `select count(*) from public.reports where target_type='${kind}' and target_id='${uuid(value.target_id)}' and status='hidden';`,
      ),
    ).toBe('2');
    if (kind === 'comment')
      expect(
        localSql(
          `select comment_count from public.posts where id='${uuid(world.post.id)}';`,
        ),
      ).toBe('1');
    if (kind === 'post') {
      await world.other.signIn(context);
      await failure(
        await get(
          context.request,
          communityPostPath(world.artist.slug, world.post.id, true),
          world.other,
        ),
        404,
        'NOT_FOUND',
      );
    }
    if (kind === 'reply') {
      await world.artistAccount.signIn(context);
      const activity = await success(
        await post(
          context.request,
          artistReplyActivityApiPath(world.artist.slug),
          world.artistAccount,
          { messageId: null },
        ),
      );
      expect(activity).toMatchObject({ replies: [] });
    }
    expect(sourceSnapshot(world)).toBe(before);
  });

for (const kind of ['post', 'comment', 'reply'] as const)
  test(`${kind}: restore and terminal deletion synchronize reports and produce exactly one own notice per decision`, async ({
    world,
    context,
  }) => {
    const value = target(world, kind),
      first = kind === 'reply' ? world.artistAccount : world.other,
      second = kind === 'reply' ? world.admin : world.second;
    const firstReport = await report(context, first, value);
    await report(context, second, value);
    let row = await findReport(context, world, value);
    const restored = await resolve(context, world, row, 'restore');
    expect(
      await success(
        await post(
          context.request,
          moderationAdminActionPath('resolve'),
          world.admin,
          restored.input,
        ),
      ),
    ).toEqual(restored.receipt);
    expect(contentState(value)).toEqual({
      hidden: false,
      deleted: false,
      count: 2,
    });
    let own = await notices(context, first);
    expect(
      own.notices
        .filter((notice) => notice.report_id === firstReport.id)
        .map((notice) => notice.decision),
    ).toEqual(['restored']);
    expect(JSON.stringify(own)).not.toMatch(
      /reason|body|email|phone|reporter_id|user_id/,
    );
    expect((await notices(context, world.author)).notices).toEqual([]);
    // A new distinct reporter starts the next review cycle after restoration.
    const third =
      kind === 'reply' ? await createIdentity('artist') : world.admin;
    if (kind === 'reply')
      localSql(
        `insert into public.artist_members(artist_id,user_id) values('${uuid(world.artist.id)}','${uuid(third.id)}');`,
      );
    await report(context, third, value);
    row = await findReport(context, world, value);
    const deleted = await resolve(context, world, row, 'delete');
    expect(
      await success(
        await post(
          context.request,
          moderationAdminActionPath('resolve'),
          world.admin,
          deleted.input,
        ),
      ),
    ).toEqual(deleted.receipt);
    expect(contentState(value)).toEqual({
      hidden: true,
      deleted: true,
      count: 3,
    });
    own = await notices(context, first);
    expect(
      own.notices
        .filter((notice) => notice.report_id === firstReport.id)
        .map((notice) => notice.decision),
    ).toEqual(['deleted', 'restored']);
    expect(
      localSql(
        `select count(*) from public.reports where target_type='${kind}' and target_id='${uuid(value.target_id)}' and status='deleted';`,
      ),
    ).toBe('3');
    if (kind === 'comment')
      expect(
        localSql(
          `select comment_count from public.posts where id='${uuid(world.post.id)}';`,
        ),
      ).toBe('1');
  });

test('missing policy, own or nonexistent targets, invalid reasons and cross-origin mutations fail without reports', async ({
  world,
  context,
}) => {
  await world.author.signIn(context);
  const value = target(world, 'post');
  await failure(
    await post(
      context.request,
      moderationReportPath(),
      world.author,
      reportInput(value),
    ),
    404,
    'NOT_FOUND',
  );
  await world.other.signIn(context);
  await failure(
    await post(
      context.request,
      moderationReportPath(),
      world.other,
      reportInput({ target_type: 'post', target_id: randomUUID() }),
    ),
    404,
    'NOT_FOUND',
  );
  await failure(
    await post(
      context.request,
      moderationReportPath(),
      world.other,
      reportInput(value, ' '),
    ),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await context.request.post(moderationReportPath(), {
      headers: {
        Origin: 'https://example.invalid',
        'X-Community-Actor': world.other.id,
      },
      data: reportInput(value),
    }),
    403,
    'FORBIDDEN',
  );
  localSql('delete from private.community_policy;');
  try {
    await failure(
      await post(
        context.request,
        moderationReportPath(),
        world.other,
        reportInput(value),
      ),
      503,
      'SETUP_NOT_READY',
    );
  } finally {
    preparePolicy();
  }
  expect(
    localSql(
      `select count(*) from public.reports where target_id='${uuid(value.target_id)}';`,
    ),
  ).toBe('0');
});

test('confirmed restrictions are CAS-bound, replay once, block relevant writes and expire consistently', async ({
  world,
  context,
}) => {
  const value = target(world, 'post');
  await report(context, world.other, value);
  let row = await findReport(context, world, value);
  const input = {
    operation_id: randomUUID(),
    user_id: world.author.id,
    expected_updated_at: row.target.owner.updated_at,
    restricted: true,
    until: new Date(Date.now() + 3_600_000).toISOString(),
    reason: '격리 CI의 허구 이용 제한',
    confirmed: true,
  };
  const restricted = moderationRestrictReceiptSchema.parse(
    await success(
      await post(
        context.request,
        moderationAdminActionPath('restrict'),
        world.admin,
        input,
      ),
    ),
  );
  expect(
    await success(
      await post(
        context.request,
        moderationAdminActionPath('restrict'),
        world.admin,
        input,
      ),
    ),
  ).toEqual(restricted);
  await failure(
    await post(
      context.request,
      moderationAdminActionPath('restrict'),
      world.admin,
      { ...input, operation_id: randomUUID(), reason: '다른 최신 수정' },
    ),
    409,
    'CONFLICT',
  );
  await world.author.signIn(context);
  await failure(
    await post(
      context.request,
      communityLikePath(world.artist.slug, world.post.id),
      world.author,
      { operation_id: randomUUID(), post_id: world.post.id, liked: true },
    ),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(
      context.request,
      communityCommentsPath(world.artist.slug, world.post.id),
      world.author,
    ),
    403,
    'FORBIDDEN',
  );
  // Expiry is fictional fixture time setup, never a runtime policy or real-user change.
  localSql(
    `update public.profiles set restricted_until=clock_timestamp()-interval '1 second' where id='${uuid(world.author.id)}';`,
  );
  expect(
    await success(
      await get(
        context.request,
        communityCommentsPath(world.artist.slug, world.post.id),
        world.author,
      ),
    ),
  ).toMatchObject({ actor_id: world.author.id });
  row = await findReport(context, world, value);
  const released = moderationRestrictReceiptSchema.parse(
    await success(
      await post(
        context.request,
        moderationAdminActionPath('restrict'),
        world.admin,
        {
          ...input,
          operation_id: randomUUID(),
          expected_updated_at: row.target.owner.updated_at,
          restricted: false,
          until: null,
        },
      ),
    ),
  );
  expect(released.is_restricted).toBe(false);
  expect(
    localSql(
      `select count(*) from public.community_moderation_log where target_type='user' and target_id='${uuid(world.author.id)}';`,
    ),
  ).toBe('2');
});

test('admin queue and private notices use stable non-overlapping cursors', async ({
  world,
  context,
}) => {
  const reportIds: string[] = [];
  await world.other.signIn(context);
  for (let index = 0; index < 22; index += 1) {
    const item = insertPost(world.artist, world.author, {
      title: `허구 신고 목록 ${index}`,
    });
    const value = { target_type: 'post' as const, target_id: item.id };
    const receipt = moderationReportReceiptSchema.parse(
      await success(
        await post(
          context.request,
          moderationReportPath(),
          world.other,
          reportInput(value),
        ),
      ),
    );
    reportIds.push(receipt.id);
  }
  await world.admin.signIn(context);
  const first = await queue(context, world);
  expect(first.reports).toHaveLength(20);
  expect(first.next_cursor).not.toBeNull();
  const next = await queue(context, world, JSON.stringify(first.next_cursor));
  const all = [...first.reports, ...next.reports].filter((row) =>
    reportIds.includes(row.id),
  );
  expect(new Set(all.map((row) => row.id)).size).toBe(22);
  for (const row of all) await resolve(context, world, row, 'restore');
  const own = await notices(context, world.other);
  expect(own.notices).toHaveLength(20);
  expect(own.next_cursor).not.toBeNull();
  const later = moderationNoticesSchema.parse(
    await success(
      await get(
        context.request,
        moderationNoticesPath(JSON.stringify(own.next_cursor)),
        world.other,
      ),
    ),
  );
  expect(
    new Set([...own.notices, ...later.notices].map((row) => row.id)).size,
  ).toBe(22);
});

async function openPost(page: Page, world: World) {
  const path = communityPostPath(world.artist.slug, world.post.id);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(page.getByTestId('community-post-detail')).toHaveCount(1);
  await expect(page.getByTestId('community-interactions-content')).toHaveCount(
    1,
  );
  await expect(
    page.getByRole('main').locator('[aria-busy="true"]'),
  ).toHaveCount(0);
}
const copy = messages.communityModeration;
const panel = (page: Page) => page.getByTestId('community-report-panel');
async function fillReport(page: Page, trigger: Locator, reason: string) {
  await trigger.click();
  await expect(
    panel(page).getByLabel(copy.reason, { exact: true }),
  ).toBeVisible();
  await panel(page).getByLabel(copy.reason, { exact: true }).fill(reason);
}

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`reports and decisions remain readable and exact at ${scale} / ${width}`, async ({
      world,
      context,
      page,
    }, info) => {
      test.setTimeout(150_000);
      for (const actor of [world.second, world.admin, world.artistAccount])
        setFont(actor, scale);
      await page.setViewportSize({ width, height: 900 });
      const value = target(world, 'post');
      await report(context, world.other, value);
      await world.second.signIn(context);
      await openPost(page, world);
      await fillReport(
        page,
        button(page, copy.reportPost),
        `허구 ${scale} ${width} 신고입니다. <strong>문자 그대로</strong>`,
      );
      await screenshot(
        page,
        info,
        `moderation-report-form-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        panel(page),
        info,
        `moderation-report-controls-${scale}-${width}`,
        scale,
      );
      const lost = await captureMutation(
        page,
        moderationReportPath(),
        world.second,
        true,
      );
      // Two synchronous activations still create one immutable operation.
      await button(panel(page), copy.submitReport).evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
      const committed = await lost.result;
      expect(contentState(value).hidden).toBe(true);
      await expect(page.getByTestId('community-report-recovery')).toBeVisible();
      await expect(button(panel(page), copy.close)).toBeDisabled();
      // The parent snapshot discovers this report's tombstone. Its absence must
      // not discard the exact child operation that still needs a receipt.
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByTestId('community-post-detail')).toHaveCount(0);
      await expect(page.getByTestId('community-report-recovery')).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-report-uncertain-${scale}-${width}`,
        scale,
      );
      const replay = await captureMutation(
        page,
        moderationReportPath(),
        world.second,
      );
      await button(panel(page), copy.retryOperation).click();
      expect(await replay.result).toEqual(committed);
      await expect(
        panel(page).getByText(copy.reportSaved, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-report-recovered-${scale}-${width}`,
        scale,
      );
      await button(panel(page), copy.close).click();
      await expect(panel(page)).toHaveCount(0);

      await world.admin.signIn(context);
      await test.step(
        'Navigate to admin and verify its current-actor queue before forwarding',
        async () => {
          const arrival = await captureQueueArrival(page, world.admin);
          const response = await page.goto(routes.adminModeration);
          expect(response?.status()).toBe(200);
          await arrival.result;
          await expect(
            page.getByTestId('community-moderation-content'),
          ).toBeVisible();
        },
        { timeout: 15_000 },
      );
      await button(
        page.locator(`[data-moderation-target-id="${world.post.id}"]`).first(),
        copy.review,
      ).click();
      await page
        .getByLabel(copy.decisionReason, { exact: true })
        .fill('허구 검토: 원문을 다시 공개해도 되는 것으로 확인했습니다.');
      await screenshot(
        page,
        info,
        `moderation-review-${scale}-${width}`,
        scale,
      );
      await button(page, copy.restore).click();
      let dialog = page.getByRole('dialog', { name: copy.confirmTitle });
      await expect(dialog).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-confirm-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        button(dialog, copy.confirm),
        info,
        `moderation-confirm-control-${scale}-${width}`,
        scale,
      );
      await button(dialog, copy.cancel).click();
      await expect(dialog).toHaveCount(0);
      expect(contentState(value).hidden).toBe(true);
      await button(page, copy.restore).click();
      dialog = page.getByRole('dialog', { name: copy.confirmTitle });
      const resolution = await captureMutation(
        page,
        moderationAdminActionPath('resolve'),
        world.admin,
        true,
      );
      await button(dialog, copy.confirm).click();
      const resolved = await resolution.result;
      await expect(
        page.getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-decision-uncertain-${scale}-${width}`,
        scale,
      );
      const retry = await captureMutation(
        page,
        moderationAdminActionPath('resolve'),
        world.admin,
      );
      await button(page, copy.retryOperation).click();
      expect(await retry.result).toEqual(resolved);
      await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
      expect(contentState(value).hidden).toBe(false);
      await screenshot(
        page,
        info,
        `moderation-restored-${scale}-${width}`,
        scale,
      );

      await page
        .getByLabel(copy.restrictionReason, { exact: true })
        .fill('허구 제한 설정 화면 확인');
      await page
        .getByLabel(copy.restrictionDate, { exact: true })
        .fill('2035-12-01');
      await page
        .getByLabel(copy.restrictionTime, { exact: true })
        .fill('12:30');
      await screenshot(
        page,
        info,
        `moderation-restriction-form-${scale}-${width}`,
        scale,
      );
      await button(page, copy.restrict).click();
      dialog = page.getByRole('dialog', { name: copy.restrictionConfirmTitle });
      await expect(dialog).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-restriction-confirm-${scale}-${width}`,
        scale,
      );
      const restriction = await captureMutation(
        page,
        moderationAdminActionPath('restrict'),
        world.admin,
      );
      await button(dialog, copy.confirm).click();
      expect(
        moderationRestrictReceiptSchema.parse((await restriction.result).data)
          .is_restricted,
      ).toBe(true);
      await expect(
        page.getByText(copy.restrictionSaved, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-restricted-${scale}-${width}`,
        scale,
      );

      await world.second.signIn(context);
      await page.goto(routes.communityReports);
      await expect(page.getByTestId('community-report-notices')).toBeVisible();
      await expect(
        page.getByText(copy.noticeRestored, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-notices-${scale}-${width}`,
        scale,
      );
      expect(await page.getByRole('main').innerText()).not.toContain(
        world.post.body,
      );

      // Restrictions apply to the author, not to unrelated reporting identities.
      await world.admin.signIn(context);
      const row = await findReport(context, world, value);
      await success(
        await post(
          context.request,
          moderationAdminActionPath('restrict'),
          world.admin,
          {
            operation_id: randomUUID(),
            user_id: world.author.id,
            expected_updated_at: row.target.owner.updated_at,
            restricted: false,
            until: null,
            reason: '허구 시나리오의 제한 종료',
            confirmed: true,
          },
        ),
      );
      await world.second.signIn(context);
      await openPost(page, world);
      await fillReport(
        page,
        button(
          page.locator(`[data-community-comment-id="${world.ownComment.id}"]`),
          copy.reportComment,
        ),
        '허구 댓글 신고',
      );
      await screenshot(
        page,
        info,
        `moderation-comment-report-${scale}-${width}`,
        scale,
      );
      const commentReport = await captureMutation(
        page,
        moderationReportPath(),
        world.second,
      );
      await button(panel(page), copy.submitReport).click();
      expect(
        moderationReportReceiptSchema.parse((await commentReport.result).data)
          .target_type,
      ).toBe('comment');
      await expect(
        panel(page).getByText(copy.reportSaved, { exact: true }),
      ).toBeVisible();

      await world.artistAccount.signIn(context);
      await page.goto(artistReplyActivityPath(world.artist.slug));
      const reply = page.locator(
        `[data-activity-reply-id="${world.reply.id}"]`,
      );
      await expect(reply).toBeVisible();
      await fillReport(
        page,
        button(reply, copy.reportReply),
        '허구 받은 답장 신고',
      );
      await screenshot(
        page,
        info,
        `moderation-reply-report-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        panel(page),
        info,
        `moderation-reply-controls-${scale}-${width}`,
        scale,
      );
      const replyReport = await captureMutation(
        page,
        moderationReportPath(),
        world.artistAccount,
      );
      await button(panel(page), copy.submitReport).click();
      expect(
        moderationReportReceiptSchema.parse((await replyReport.result).data)
          .target_type,
      ).toBe('reply');
      await expect(
        panel(page).getByText(copy.reportSaved, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `moderation-reply-reported-${scale}-${width}`,
        scale,
      );
    });

test('closing and changing report targets discards unsent text without a mutation', async ({
  world,
  context,
  page,
}) => {
  await world.other.signIn(context);
  await openPost(page, world);
  let writes = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === moderationReportPath() &&
      request.method() === 'POST'
    )
      writes += 1;
  });
  await fillReport(
    page,
    button(page, copy.reportPost),
    '취소할 허구 신고 초안',
  );
  await button(panel(page), copy.close).click();
  await expect(panel(page)).toHaveCount(0);
  await button(
    page.locator(`[data-community-comment-id="${world.ownComment.id}"]`),
    copy.reportComment,
  ).click();
  await expect(
    panel(page).getByLabel(copy.reason, { exact: true }),
  ).toHaveValue('');
  await button(panel(page), copy.close).click();
  expect(writes).toBe(0);
  expect(
    localSql(
      `select count(*) from public.reports where target_id in('${uuid(world.post.id)}','${uuid(world.ownComment.id)}');`,
    ),
  ).toBe('0');
});

test('account changes clear uncertain report authority and never expose or replay the prior account request', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.second, 'xlarge');
  setFont(world.author, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  await report(context, world.other, target(world, 'post'));
  await world.second.signIn(context);
  await openPost(page, world);
  await fillReport(
    page,
    button(page, copy.reportPost),
    '이전 계정의 허구 신고',
  );
  const lost = await captureMutation(
    page,
    moderationReportPath(),
    world.second,
    true,
  );
  await button(panel(page), copy.submitReport).click();
  await lost.result;
  await expect(page.getByTestId('community-report-recovery')).toBeVisible();
  await world.author.signIn(context);
  let writes = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === moderationReportPath() &&
      request.method() === 'POST'
    )
      writes += 1;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('community-post-detail')).toHaveCount(0);
  await expect(page.getByTestId('community-report-recovery')).toHaveCount(0);
  await expect(button(page, copy.retryOperation)).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
  await screenshot(
    page,
    info,
    'moderation-account-denial-xlarge-360',
    'xlarge',
  );
  expect(writes).toBe(0);
  expect(contentState(target(world, 'post')).count).toBe(2);
});

test('a committed lost delete response survives refresh and recovers the identical decision only once', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  const firstReport = await report(
    context,
    world.other,
    target(world, 'comment'),
  );
  await world.admin.signIn(context);
  await page.goto(routes.adminModeration);
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  await button(
    page.locator(`[data-moderation-report-id="${firstReport.id}"]`),
    copy.review,
  ).click();
  await page
    .getByLabel(copy.decisionReason, { exact: true })
    .fill('허구 댓글 삭제 검토');
  await button(page, copy.delete).click();
  const lost = await captureMutation(
    page,
    moderationAdminActionPath('resolve'),
    world.admin,
    true,
  );
  await button(
    page.getByRole('dialog', { name: copy.confirmTitle }),
    copy.confirm,
  ).click();
  const committed = await lost.result;
  await expect(page.getByTestId('community-moderation-recovery')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  await expect(
    page
      .getByTestId('community-moderation-review')
      .getByText(copy.deletedTarget, { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('community-moderation-recovery')).toBeVisible();
  await screenshot(
    page,
    info,
    'moderation-delete-uncertain-xlarge-360',
    'xlarge',
  );
  const replay = await captureMutation(
    page,
    moderationAdminActionPath('resolve'),
    world.admin,
  );
  await button(page, copy.retryOperation).click();
  expect(await replay.result).toEqual(committed);
  await expect(page.getByTestId('community-moderation-recovery')).toHaveCount(
    0,
  );
  await expect(page.getByText(copy.saved, { exact: true })).toBeVisible();
  await screenshot(
    page,
    info,
    'moderation-delete-recovered-xlarge-360',
    'xlarge',
  );
  expect(
    (await notices(context, world.other)).notices.filter(
      (notice) => notice.report_id === firstReport.id,
    ),
  ).toHaveLength(1);
  expect(
    localSql(
      `select count(*) from public.community_moderation_log where target_type='comment' and target_id='${uuid(world.ownComment.id)}' and action='delete';`,
    ),
  ).toBe('1');
});

test('a lost restriction response replays exactly, while canceled dialogs and Back/Forward create no decision', async ({
  world,
  context,
  page,
}) => {
  const submitted = await report(context, world.other, target(world, 'post'));
  await world.admin.signIn(context);
  await page.goto(routes.adminModeration);
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  await button(
    page.locator(`[data-moderation-report-id="${submitted.id}"]`),
    copy.review,
  ).click();
  await page
    .getByLabel(copy.decisionReason, { exact: true })
    .fill('취소할 허구 결정');
  await button(page, copy.delete).click();
  await expect(
    page.getByRole('dialog', { name: copy.confirmTitle }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new PopStateEvent('popstate')),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  expect(contentState(target(world, 'post')).deleted).toBe(false);
  await test.step(
    'Return to admin through the verified RSC response',
    async () => {
      const navigation = await captureNavigation(page, routes.admin);
      await page
        .getByRole('link', { name: copy.backAdmin, exact: true })
        .click();
      await navigation.result;
      await expect(page).toHaveURL(routes.admin);
    },
    { timeout: 15_000 },
  );
  await page.goBack();
  await expect(page).toHaveURL(routes.adminModeration);
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  await expect(page.getByTestId('community-moderation-review')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(routes.admin);
  await page.goBack();
  await expect(page.getByTestId('community-moderation-content')).toBeVisible();
  await button(
    page.locator(`[data-moderation-report-id="${submitted.id}"]`),
    copy.review,
  ).click();
  await page
    .getByLabel(copy.restrictionReason, { exact: true })
    .fill('허구 제한 응답 유실 확인');
  await page
    .getByLabel(copy.restrictionDate, { exact: true })
    .fill('2035-12-01');
  await page.getByLabel(copy.restrictionTime, { exact: true }).fill('12:30');
  await button(page, copy.restrict).click();
  const lost = await captureMutation(
    page,
    moderationAdminActionPath('restrict'),
    world.admin,
    true,
  );
  await button(
    page.getByRole('dialog', { name: copy.restrictionConfirmTitle }),
    copy.confirm,
  ).click();
  const committed = await lost.result;
  await expect(page.getByTestId('community-moderation-recovery')).toBeVisible();
  await expect(button(page, copy.restrict)).toBeDisabled();
  const replay = await captureMutation(
    page,
    moderationAdminActionPath('restrict'),
    world.admin,
  );
  await button(page, copy.retryOperation).click();
  expect(await replay.result).toEqual(committed);
  await expect(
    page.getByText(copy.restrictionSaved, { exact: true }),
  ).toBeVisible();
  expect(
    localSql(
      `select count(*) from public.community_moderation_log where target_type='user' and target_id='${uuid(world.author.id)}';`,
    ),
  ).toBe('1');
  expect(contentState(target(world, 'post')).deleted).toBe(false);
});
