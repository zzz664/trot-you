import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIRequestContext,
  APIResponse,
  Locator,
  Page,
} from '@playwright/test';
import {
  CONTENT_CALENDAR,
  adminContentCalendarSchema,
  artistContentCalendarSchema,
  contentCalendarEntrySchema,
  type ContentCalendarEntry,
  type ContentCalendarSaveInput,
} from '../../../src/config/content-calendar';
import {
  adminContentCalendarPath,
  adminContentCalendarApiPath,
  artistContentCalendarPath,
  routes,
} from '../../../src/config/routes';
import { observeCalendarMutation } from './response-capture';
import {
  test,
  expect,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRestricted,
  setRole,
  removeMembership,
  sourceSnapshot,
  enableActivityRequirements,
  type World,
  type Scale,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.contentCalendar;
const main = (page: Page) => page.getByRole('main');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const link = (root: Page | Locator, name: string) =>
  root.getByRole('link', { name, exact: true });
const row = (page: Page, id: string) =>
  main(page).locator(`[data-calendar-entry-id="${id}"]`);
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
async function current(request: APIRequestContext, world: World) {
  return adminContentCalendarSchema.parse(
    await success(
      await request.get(
        adminContentCalendarPath(world.month, world.artist.id, 1, true),
      ),
    ),
  );
}
function command(
  world: World,
  entry: ContentCalendarEntry | null = null,
  patch: Partial<ContentCalendarSaveInput['input']> = {},
): ContentCalendarSaveInput {
  return {
    operation_id: randomUUID(),
    entry_id: entry?.id ?? null,
    expected_revision: entry?.revision ?? null,
    input: {
      artist_id: world.artist.id,
      date: entry?.date ?? `${world.month}-23`,
      topic: entry?.topic ?? '허구 새 콘텐츠 주제',
      example_text:
        entry?.example_text ??
        '안녕하세요 {이름} 님. 저장만 하는 허구 참고 예문입니다.',
      ...patch,
    },
  };
}
async function save(
  request: APIRequestContext,
  input: ContentCalendarSaveInput,
) {
  return contentCalendarEntrySchema.parse(
    await success(
      await post(request, adminContentCalendarApiPath('save'), input),
    ),
  );
}
async function openAdmin(page: Page, world: World, month = world.month) {
  const path = adminContentCalendarPath(month, world.artist.id);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(
    main(page).getByRole('heading', { name: copy.adminTitle, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(1);
  await expect(
    main(page).getByTestId('content-calendar-activity'),
  ).toBeVisible();
}
async function openArtist(page: Page, world: World, month = world.month) {
  const path = artistContentCalendarPath(world.artist.slug, month);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(
    main(page).getByRole('heading', {
      name: copy.artistTitle.replace('{name}', world.artist.name),
      exact: true,
    }),
  ).toBeVisible();
  await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(1);
  await expect(
    main(page).getByTestId('content-calendar-activity'),
  ).toBeVisible();
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

test('actual month reads project private topics only to admins and affiliated active artists, with current-week activity independent of month', async ({
  world,
  context,
}) => {
  const before = sourceSnapshot(world);
  await world.admin.signIn(context);
  const admin = await current(context.request, world);
  expect(admin.entries.map((item) => item.id)).toEqual([
    world.entry.id,
    world.second.id,
  ]);
  expect(admin.activity).toMatchObject({
    messageCount: 2,
    photoCount: 1,
    requirementsReady: false,
  });
  expect(JSON.stringify(admin)).not.toMatch(
    /created_by|author_id|user_id|@example[.]invalid/,
  );
  expect(JSON.stringify(admin)).not.toContain(world.admin.id);
  const paused = adminContentCalendarSchema.parse(
    await success(
      await context.request.get(
        adminContentCalendarPath(world.month, world.paused.id, 1, true),
      ),
    ),
  );
  expect(paused.artist.status).toBe('paused');
  expect(paused.entries).toHaveLength(1);
  await world.member.signIn(context);
  const artist = artistContentCalendarSchema.parse(
    await success(
      await context.request.get(
        artistContentCalendarPath(world.artist.slug, world.month, true),
      ),
    ),
  );
  expect(artist.entries).toEqual(admin.entries);
  expect(artist.activity).toEqual(admin.activity);
  const next = artistContentCalendarSchema.parse(
    await success(
      await context.request.get(
        artistContentCalendarPath(world.artist.slug, world.nextMonth, true),
      ),
    ),
  );
  expect(next.entries.map((item) => item.id)).toEqual([world.outside.id]);
  expect(next.activity).toEqual(artist.activity);
  await failure(
    await context.request.get(
      artistContentCalendarPath(world.unrelated.slug, world.month, true),
    ),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.get(
      artistContentCalendarPath(world.paused.slug, world.month, true),
    ),
    404,
    'NOT_FOUND',
  );
  expect(sourceSnapshot(world)).toBe(before);
});

test('actual create/update/delete retries preserve one effect, stale revisions and occupied dates fail closed, and editorial writes cause no delivery', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = sourceSnapshot(world);
  const first = command(world);
  const created = await save(context.request, first);
  expect(created.revision).toBe(1);
  expect(await save(context.request, first)).toEqual(created);
  const update = command(world, created, { topic: '허구 변경된 콘텐츠 주제' });
  const updated = await save(context.request, update);
  expect(updated.revision).toBe(2);
  expect(await save(context.request, update)).toEqual(updated);
  await failure(
    await post(
      context.request,
      adminContentCalendarApiPath('save'),
      command(world, created, { topic: '이전 화면의 덮어쓰기 금지' }),
    ),
    409,
    'CONFLICT',
  );
  await failure(
    await post(
      context.request,
      adminContentCalendarApiPath('save'),
      command(world),
    ),
    409,
    'DATE_CONFLICT',
  );
  await failure(
    await post(context.request, adminContentCalendarApiPath('save'), {
      ...update,
      input: { ...update.input, topic: '같은 작업 식별자의 다른 내용 금지' },
    }),
    409,
    'CONFLICT',
  );
  const remove = {
    operation_id: randomUUID(),
    entry_id: updated.id,
    expected_revision: updated.revision,
    confirmed: true,
  };
  await failure(
    await post(context.request, adminContentCalendarApiPath('delete'), {
      ...remove,
      expected_revision: created.revision,
    }),
    409,
    'CONFLICT',
  );
  expect(
    await success(
      await post(
        context.request,
        adminContentCalendarApiPath('delete'),
        remove,
      ),
    ),
  ).toEqual({ id: updated.id, deleted: true });
  expect(
    await success(
      await post(
        context.request,
        adminContentCalendarApiPath('delete'),
        remove,
      ),
    ),
  ).toEqual({ id: updated.id, deleted: true });
  expect(
    (await current(context.request, world)).entries.map((entry) => entry.id),
  ).not.toContain(updated.id);
  expect(sourceSnapshot(world)).toBe(before);
});

test('actual auth, role, restriction, membership, mounted-account and same-origin boundaries cover every endpoint', async ({
  world,
  context,
}) => {
  const adminPath = adminContentCalendarPath(
    world.month,
    world.artist.id,
    1,
    true,
  );
  const artistPath = artistContentCalendarPath(
    world.artist.slug,
    world.month,
    true,
  );
  await failure(await context.request.get(adminPath), 401, 'UNAUTHENTICATED');
  await failure(await context.request.get(artistPath), 401, 'UNAUTHENTICATED');
  for (const actor of [world.fan, world.member, world.outsider]) {
    await actor.signIn(context);
    await failure(await context.request.get(adminPath), 403, 'FORBIDDEN');
    await failure(
      await post(
        context.request,
        adminContentCalendarApiPath('save'),
        command(world),
      ),
      403,
      'FORBIDDEN',
    );
    await failure(
      await post(context.request, adminContentCalendarApiPath('delete'), {
        operation_id: randomUUID(),
        entry_id: world.entry.id,
        expected_revision: 1,
        confirmed: true,
      }),
      403,
      'FORBIDDEN',
    );
  }
  await world.outsider.signIn(context);
  await failure(await context.request.get(artistPath), 403, 'FORBIDDEN');
  await world.admin.signIn(context);
  await failure(
    await context.request.get(adminPath, {
      headers: { [CONTENT_CALENDAR.actorHeader]: world.other.id },
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.post(adminContentCalendarApiPath('save'), {
      headers: { Origin: 'https://outside.invalid' },
      data: command(world),
    }),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.admin, true);
  await failure(await context.request.get(adminPath), 403, 'FORBIDDEN');
  await failure(
    await post(
      context.request,
      adminContentCalendarApiPath('save'),
      command(world),
    ),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.admin, false);
  setRole(world.admin, 'fan');
  await failure(await context.request.get(adminPath), 403, 'FORBIDDEN');
  await world.member.signIn(context);
  removeMembership(world);
  await failure(await context.request.get(artistPath), 403, 'FORBIDDEN');
});

test('actual input validation rejects malformed month, duplicate query keys, controls, foreign dates and unconfirmed deletes without changing records', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = await current(context.request, world);
  for (const query of [
    `artist_id=${world.artist.id}&month=2036-13`,
    `artist_id=${world.artist.id}&month=${world.month}&month=${world.nextMonth}`,
    `artist_id=${world.artist.id}&month=${world.month}&unknown=1`,
    `artist_id=not-a-uuid&month=${world.month}`,
  ])
    await failure(
      await context.request.get(`${routes.adminContentCalendarApi}?${query}`),
      400,
      'INVALID_INPUT',
    );
  for (const patch of [
    { topic: ' ' },
    { topic: '금지\u0000문자' },
    { date: '2036-02-31' },
    { example_text: '금지\u0000문자' },
  ])
    await failure(
      await post(
        context.request,
        adminContentCalendarApiPath('save'),
        command(world, null, patch),
      ),
      400,
      'INVALID_INPUT',
    );
  await failure(
    await post(context.request, adminContentCalendarApiPath('delete'), {
      operation_id: randomUUID(),
      entry_id: world.entry.id,
      expected_revision: 1,
      confirmed: false,
    }),
    400,
    'INVALID_INPUT',
  );
  const original = before.entries[0]!;
  await failure(
    await post(
      context.request,
      adminContentCalendarApiPath('save'),
      command(world, original, { date: `${world.month}-06` }),
    ),
    400,
    'INVALID_INPUT',
  );
  expect((await current(context.request, world)).entries).toEqual(
    before.entries,
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280]) {
    test(`${scale} ${width}: admin create/edit/delete and month history, then read-only artist calendar and activity`, async ({
      world,
      page,
      context,
    }, info) => {
      for (const actor of [world.admin, world.member]) setFont(actor, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      const pickerPath = adminContentCalendarPath(world.month);
      await page.goto(pickerPath);
      await expect(page).toHaveURL(pickerPath);
      await expect(
        main(page).getByRole('heading', {
          name: copy.artistChoice,
          exact: true,
        }),
      ).toBeVisible();
      const artistChoice = copy.artistOption
        .replace('{name}', world.artist.name)
        .replace('{slug}', world.artist.slug)
        .replace('{status}', copy.artistStatuses.active);
      await expect(link(main(page), artistChoice)).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-artist-picker-${scale}-${width}`,
        scale,
      );
      await link(main(page), artistChoice).click();
      await expect(page).toHaveURL(
        adminContentCalendarPath(world.month, world.artist.id),
      );
      await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(
        1,
      );
      await expect(row(page, world.entry.id)).toContainText(world.entry.topic);
      await expect(row(page, world.entry.id).locator('strong')).toHaveCount(0);
      await screenshot(page, info, `admin-initial-${scale}-${width}`, scale);
      await button(main(page), copy.new).click();
      const form = main(page).getByTestId('content-calendar-form');
      await expect(form).toBeVisible();
      await form
        .getByLabel(copy.date, { exact: true })
        .fill(`${world.month}-23`);
      await form
        .getByLabel(copy.topic, { exact: true })
        .fill('허구 화면에서 추가한 주제');
      await form
        .getByLabel(copy.exampleLabel, { exact: true })
        .fill(
          '안녕하세요 {이름} 님. 이 예문은 팬에게 전송되지 않습니다.\n두 번째 줄도 그대로 저장합니다.',
        );
      await screenshot(
        page,
        info,
        `admin-create-form-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        form,
        info,
        `admin-create-controls-${scale}-${width}`,
        scale,
      );
      const createdCapture = await observeCalendarMutation(
        page,
        adminContentCalendarApiPath('save'),
        async (response) =>
          contentCalendarEntrySchema.parse(await success(response)),
      );
      await button(form, copy.createSave).click();
      const created = await createdCapture.result;
      await expect(main(page).getByTestId('content-calendar-form')).toHaveCount(
        0,
      );
      await expect(row(page, created.id)).toContainText(created.topic);
      await screenshot(page, info, `admin-created-${scale}-${width}`, scale);
      await button(row(page, created.id), copy.edit).click();
      await expect(form.getByLabel(copy.date, { exact: true })).toHaveAttribute(
        'readonly',
        '',
      );
      await form
        .getByLabel(copy.topic, { exact: true })
        .fill('허구 수정한 편집 주제');
      const changedCapture = await observeCalendarMutation(
        page,
        adminContentCalendarApiPath('save'),
        async (response) =>
          contentCalendarEntrySchema.parse(await success(response)),
      );
      await button(form, copy.save).click();
      const changed = await changedCapture.result;
      await expect(row(page, changed.id)).toContainText(changed.topic);
      await screenshot(page, info, `admin-updated-${scale}-${width}`, scale);
      await button(row(page, changed.id), copy.deleteAction).click();
      const dialog = page.getByRole('dialog', {
        name: copy.deleteDialogTitle,
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-delete-dialog-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        dialog,
        info,
        `admin-delete-controls-${scale}-${width}`,
        scale,
      );
      await button(dialog, copy.deleteDialogCancel).click();
      await expect(dialog).toHaveCount(0);
      await expect(row(page, changed.id)).toBeVisible();
      await button(row(page, changed.id), copy.deleteAction).click();
      const removedCapture = await observeCalendarMutation(
        page,
        adminContentCalendarApiPath('delete'),
        success,
      );
      await button(dialog, copy.deleteDialogConfirm).click();
      await removedCapture.result;
      await expect(dialog).toHaveCount(0);
      await expect(row(page, changed.id)).toHaveCount(0);
      await screenshot(page, info, `admin-deleted-${scale}-${width}`, scale);
      await link(main(page), copy.previousMonth).click();
      await expect(page).toHaveURL(
        adminContentCalendarPath(world.previousMonth, world.artist.id),
      );
      await expect(
        main(page).getByText(copy.empty, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `admin-empty-${scale}-${width}`, scale);
      await page.goBack();
      await expect(page).toHaveURL(
        adminContentCalendarPath(world.month, world.artist.id),
      );
      await expect(row(page, world.entry.id)).toBeVisible();
      await world.member.signIn(context);
      await openArtist(page, world);
      await expect(button(main(page), copy.new)).toHaveCount(0);
      await expect(button(main(page), copy.edit)).toHaveCount(0);
      await expect(button(main(page), copy.deleteAction)).toHaveCount(0);
      await expect(
        main(page).getByTestId('content-calendar-activity'),
      ).toContainText(copy.currentWeekNotice);
      await screenshot(page, info, `artist-readonly-${scale}-${width}`, scale);
      enableActivityRequirements(world);
      await button(main(page), copy.refresh).click();
      const activity = main(page).getByTestId('content-calendar-activity');
      await expect(
        activity.locator('[data-activity-metric="message"]'),
      ).toContainText(
        messages.artistReplyActivity.metricProgress
          .replace('{count}', '2')
          .replace('{minimum}', '3'),
      );
      await expect(
        activity.locator('[data-activity-metric="photo"]'),
      ).toContainText(
        messages.artistReplyActivity.metricProgress
          .replace('{count}', '1')
          .replace('{minimum}', '2'),
      );
      await expect(
        activity.getByText(
          messages.artistReplyActivity.requirementsUnavailable,
          { exact: true },
        ),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `artist-contract-comparison-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        main(page).getByTestId('content-calendar-activity'),
        info,
        `artist-activity-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.nextMonth).click();
      await expect(page).toHaveURL(
        artistContentCalendarPath(world.artist.slug, world.nextMonth),
      );
      await expect(row(page, world.outside.id)).toBeVisible();
      await expect(row(page, world.entry.id)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `artist-next-month-${scale}-${width}`,
        scale,
      );
    });

    test(`${scale} ${width}: stale edits require reload, canceled input stays unsaved, network retry and mounted-account changes clear private state`, async ({
      world,
      page,
      context,
    }, info) => {
      for (const actor of [world.admin, world.other]) setFont(actor, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openAdmin(page, world);
      const original = (await current(context.request, world)).entries.find(
        (entry) => entry.id === world.entry.id,
      )!;
      await button(row(page, original.id), copy.edit).click();
      const form = main(page).getByTestId('content-calendar-form');
      await form
        .getByLabel(copy.topic, { exact: true })
        .fill('허구 오래된 화면의 변경');
      await save(
        context.request,
        command(world, original, {
          topic: '허구 다른 작업이 저장한 최신 주제',
        }),
      );
      await button(form, copy.save).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.CONFLICT,
      );
      await screenshot(page, info, `admin-conflict-${scale}-${width}`, scale);
      await button(main(page), messages.ui.retry).click();
      await expect(row(page, original.id)).toContainText(
        '허구 다른 작업이 저장한 최신 주제',
      );
      await expect(form).toHaveCount(0);
      await button(row(page, original.id), copy.edit).click();
      await form
        .getByLabel(copy.topic, { exact: true })
        .fill('허구 저장하지 않을 내용');
      await button(form, copy.cancel).click();
      await expect(form).toHaveCount(0);
      await expect(row(page, original.id)).not.toContainText(
        '허구 저장하지 않을 내용',
      );
      const apiPath = adminContentCalendarPath(
        world.month,
        world.artist.id,
        1,
        true,
      );
      await page.route(`**${apiPath}`, (route) => route.abort('failed'), {
        times: 1,
      });
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.UNAVAILABLE,
      );
      await screenshot(page, info, `admin-read-error-${scale}-${width}`, scale);
      await button(main(page), messages.ui.retry).click();
      await expect(row(page, original.id)).toContainText(
        '허구 다른 작업이 저장한 최신 주제',
      );
      await screenshot(
        page,
        info,
        `admin-read-recovered-${scale}-${width}`,
        scale,
      );
      await world.other.signIn(context);
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(
        0,
      );
      await expect(main(page).getByTestId('content-calendar-form')).toHaveCount(
        0,
      );
      await screenshot(
        page,
        info,
        `admin-account-changed-${scale}-${width}`,
        scale,
      );
      await button(main(page), messages.ui.retry).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(
        0,
      );
      await openAdmin(page, world);
      await expect(row(page, original.id)).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-account-reloaded-${scale}-${width}`,
        scale,
      );
    });
  }

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280]) {
    test(`${scale} ${width}: lost save response retries one immutable request and never publishes a message`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await openAdmin(page, world);
      const before = sourceSnapshot(world);
      await button(main(page), copy.new).click();
      const form = main(page).getByTestId('content-calendar-form');
      await form
        .getByLabel(copy.date, { exact: true })
        .fill(`${world.month}-24`);
      await form
        .getByLabel(copy.topic, { exact: true })
        .fill('허구 응답 유실 뒤 복구한 주제');
      let firstInput: unknown;
      let firstResult: ContentCalendarEntry | undefined;
      await page.route(
        `**${adminContentCalendarApiPath('save')}`,
        async (route) => {
          firstInput = route.request().postDataJSON();
          const response = await route.fetch();
          firstResult = contentCalendarEntrySchema.parse(
            await success(response),
          );
          await route.abort('failed');
        },
        { times: 1 },
      );
      await button(form, copy.createSave).click();
      await expect(
        main(page).getByText(copy.uncertain, { exact: true }),
      ).toBeVisible();
      await expect(button(main(page), copy.retryOperation)).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-uncertain-save-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        form,
        info,
        `admin-uncertain-controls-${scale}-${width}`,
        scale,
      );
      let replayInput: unknown;
      await page.route(
        `**${adminContentCalendarApiPath('save')}`,
        async (route) => {
          replayInput = route.request().postDataJSON();
          const response = await route.fetch();
          expect(
            contentCalendarEntrySchema.parse(await success(response)),
          ).toEqual(firstResult);
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await button(main(page), copy.retryOperation).click();
      await expect(row(page, firstResult!.id)).toContainText(
        '허구 응답 유실 뒤 복구한 주제',
      );
      await expect(form).toHaveCount(0);
      expect(replayInput).toEqual(firstInput);
      expect(
        (await current(context.request, world)).entries.filter(
          (entry) => entry.date === `${world.month}-24`,
        ),
      ).toHaveLength(1);
      expect(sourceSnapshot(world)).toBe(before);
      await screenshot(
        page,
        info,
        `admin-uncertain-recovered-${scale}-${width}`,
        scale,
      );
    });

    test(`${scale} ${width}: delayed old-month read cannot overwrite newer navigation and membership loss clears artist topics and activity`, async ({
      world,
      page,
      context,
    }, info) => {
      setFont(world.member, scale);
      await world.member.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      let release!: () => void;
      let captured!: () => void;
      let failedCapture!: (error: unknown) => void;
      let finished!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const arrived = new Promise<void>((resolve, reject) => {
        captured = resolve;
        failedCapture = reject;
      });
      const done = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const currentApi = artistContentCalendarPath(
        world.artist.slug,
        world.month,
        true,
      );
      await page.route(
        `**${currentApi}`,
        async (route) => {
          try {
            const response = await route.fetch();
            artistContentCalendarSchema.parse(await success(response));
            captured();
            await pending;
            await route.fulfill({ response }).catch(() => undefined);
          } catch (error) {
            failedCapture(error);
            await route.abort().catch(() => undefined);
          } finally {
            finished();
          }
        },
        { times: 1 },
      );
      await page.goto(
        artistContentCalendarPath(world.artist.slug, world.month),
      );
      await arrived;
      await expect(
        main(page).getByText(copy.loading, { exact: true }),
      ).toBeVisible();
      await assertRenderedScale(page, scale);
      await page.screenshot({
        path: info.outputPath(`artist-loading-${scale}-${width}.png`),
        fullPage: true,
      });
      await openArtist(page, world, world.nextMonth);
      await expect(row(page, world.outside.id)).toBeVisible();
      release();
      await done;
      await expect(page).toHaveURL(
        artistContentCalendarPath(world.artist.slug, world.nextMonth),
      );
      await expect(row(page, world.entry.id)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `artist-newer-month-${scale}-${width}`,
        scale,
      );
      removeMembership(world);
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(
        0,
      );
      await expect(
        main(page).getByTestId('content-calendar-activity'),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `artist-membership-revoked-${scale}-${width}`,
        scale,
      );
      await button(main(page), messages.ui.retry).click();
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.FORBIDDEN,
      );
      await page.goBack();
      await expect(page).toHaveURL(
        artistContentCalendarPath(world.artist.slug, world.month),
      );
      await expect(main(page).getByRole('alert')).toContainText(
        copy.errors.FORBIDDEN,
      );
      await expect(main(page).getByTestId('content-calendar-list')).toHaveCount(
        0,
      );
      await screenshot(
        page,
        info,
        `artist-revoked-history-${scale}-${width}`,
        scale,
      );
    });
  }
