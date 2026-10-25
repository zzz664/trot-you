import { observeScheduleSave } from './response-capture';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIResponse, Locator, Page } from '@playwright/test';
import {
  SCHEDULES,
  adminScheduleSchema,
  adminScheduleSaveSchema,
  adminScheduleListSchema,
  scheduleEventSchema,
  scheduleListSchema,
  type AdminScheduleInput,
  type AdminScheduleSaveInput,
} from '../../../src/config/schedules';
import {
  adminScheduleApiPath,
  adminScheduleListPath,
  adminSchedulePath,
  scheduleDetailPath,
  scheduleListPath,
  routes,
} from '../../../src/config/routes';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import { adminArtistListSchema } from '../../../src/config/admin-artists';
import {
  test,
  expect,
  post,
  localSql,
  uuid,
  appOrigin,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRole,
  setRestricted,
  addPaginationEvents,
  type World,
  type Artist,
  type Scale,
} from './fixtures';
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const main = (page: Page) => page.getByRole('main');
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const link = (root: Page | Locator, name: string) =>
  root.getByRole('link', { name, exact: true });
function artistOption(artist: Artist) {
  return messages.schedules.artistOption
    .replace('{name}', artist.name)
    .replace('{slug}', artist.slug)
    .replace('{status}', messages.schedules.artistStatuses.active);
}
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
function input(
  world: World,
  overrides: Partial<AdminScheduleInput> = {},
): AdminScheduleInput {
  return {
    artist_id: world.artist.id,
    type: 'concert',
    status: 'draft',
    title: '허구 새 일정',
    description: '격리 CI의 허구 상세 설명',
    starts_at: `${world.month}-24T19:00:00+09:00`,
    ends_at: `${world.month}-24T21:00:00+09:00`,
    place_name: '허구 공연장',
    address: '공개 행사 주소',
    lat: 37.5665,
    lng: 126.978,
    ...overrides,
  };
}
function command(
  world: World,
  overrides: Partial<AdminScheduleSaveInput> = {},
): AdminScheduleSaveInput {
  return {
    operation_id: randomUUID(),
    schedule_id: null,
    expected_revision: null,
    input: input(world),
    confirmed: true,
    ...overrides,
  };
}
async function current(request: Parameters<typeof post>[0], id: string) {
  return adminScheduleSchema.parse(
    await success(await request.get(`${routes.adminSchedulesApi}?id=${id}`)),
  );
}
async function save(
  request: Parameters<typeof post>[0],
  value: AdminScheduleSaveInput,
) {
  return adminScheduleSchema.parse(
    await success(await post(request, adminScheduleApiPath('save'), value)),
  );
}
async function captureElement(
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
async function fanList(page: Page, month: string) {
  await page.goto(scheduleListPath(month));
  await expect(page).toHaveURL(scheduleListPath(month));
  await expect(
    main(page).getByRole('heading', { name: '공식 일정', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('schedule-calendar')).toBeVisible();
}
async function expectAdminEmpty(page: Page) {
  await expect(
    main(page).getByText(messages.schedules.adminEmpty, { exact: true }),
  ).toBeVisible();
  const list = main(page).getByTestId('admin-schedule-list');
  // An empty list has no visual box. Assert the loaded semantic empty state,
  // attached result container and zero rows instead of visibility of that box.
  await expect(list).toHaveCount(1);
  await expect(list.locator(':scope > li')).toHaveCount(0);
  await expect(main(page).getByRole('alert')).toHaveCount(0);
}
async function adminList(page: Page, month: string) {
  await page.goto(adminScheduleListPath(month));
  await expect(page).toHaveURL(adminScheduleListPath(month));
  await expect(
    main(page).getByRole('heading', { name: '공식 일정 관리', exact: true }),
  ).toBeVisible();
}
async function editPage(page: Page, id: string) {
  await page.goto(adminSchedulePath(id));
  await expect(page).toHaveURL(adminSchedulePath(id));
  await expect(
    main(page).getByRole('heading', { name: '일정 수정', exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('admin-schedule-form')).toBeVisible();
}

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('actual fan RPC projects only published active-artist events, KST overlaps and current own subscription access', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const data = scheduleListSchema.parse(
    await success(
      await context.request.get(scheduleListPath(world.month, null, true)),
    ),
  );
  expect(data.month).toBe(world.month);
  const ids = data.items.map((row) => row.id);
  for (const event of [
    world.event,
    world.overlap,
    world.noMap,
    world.graceEvent,
    world.canceledEvent,
    world.unrelatedEvent,
  ])
    expect(ids).toContain(event.id);
  for (const event of [world.draft, world.hidden, world.outside, world.ended])
    expect(ids).not.toContain(event.id);
  expect(data.myArtistIds.sort()).toEqual(
    [world.artist.id, world.grace.id, world.canceled.id].sort(),
  );
  expect(JSON.stringify(data)).not.toMatch(
    /created_by|actor_id|user_id|call_name|email|phone|subscription_id|payment|revision|artist_status/,
  );
  const detail = scheduleEventSchema.parse(
    await success(
      await context.request.get(`${routes.schedulesApi}?id=${world.event.id}`),
    ),
  );
  expect(detail.lat).toBe(37.5665);
  expect(detail.lng).toBe(126.978);
  expect(detail.title).toBe(world.event.title);
  for (const event of [world.draft, world.hidden])
    await failure(
      await context.request.get(`${routes.schedulesApi}?id=${event.id}`),
      404,
      'NOT_FOUND',
    );
  await world.emptyFan.signIn(context);
  const empty = scheduleListSchema.parse(
    await success(
      await context.request.get(scheduleListPath(world.month, null, true)),
    ),
  );
  expect(empty.myArtistIds).toEqual([]);
  expect(empty.items.map((row) => row.id)).toContain(world.event.id);
});

test('fan cursor and administrator pagination enumerate all events without duplicate or silent truncation', async ({
  world,
  context,
}) => {
  addPaginationEvents(world);
  await world.fan.signIn(context);
  const first = scheduleListSchema.parse(
    await success(
      await context.request.get(scheduleListPath(world.month, null, true)),
    ),
  );
  expect(first.items).toHaveLength(100);
  expect(first.nextCursor).not.toBeNull();
  const second = scheduleListSchema.parse(
    await success(
      await context.request.get(
        scheduleListPath(world.month, first.nextCursor, true),
      ),
    ),
  );
  expect(second.items.length).toBeGreaterThan(0);
  expect(second.nextCursor).toBeNull();
  expect(
    second.items.every(
      (item) => !first.items.some((row) => row.id === item.id),
    ),
  ).toBe(true);
  expect(
    [...first.items, ...second.items].filter(
      (row) =>
        row.artist_id === world.artist.id &&
        row.title.startsWith('허구 페이지 일정 '),
    ),
  ).toHaveLength(105);
  await failure(
    await context.request.get(
      scheduleListPath(world.nextMonth, first.nextCursor, true),
    ),
    400,
    'INVALID_INPUT',
  );
  await world.admin.signIn(context);
  const page1 = adminScheduleListSchema.parse(
    await success(
      await context.request.get(adminScheduleListPath(world.month, 1, true)),
    ),
  );
  const page2 = adminScheduleListSchema.parse(
    await success(
      await context.request.get(adminScheduleListPath(world.month, 2, true)),
    ),
  );
  expect(page1.items).toHaveLength(30);
  expect(page1.has_more).toBe(true);
  expect(page2.items).toHaveLength(30);
  expect(
    page2.items.every((item) => !page1.items.some((row) => row.id === item.id)),
  ).toBe(true);
  expect(JSON.stringify(page1)).not.toMatch(
    /created_by|actor_id|call_name|email|phone/,
  );
});

test('administrator create/update/delete are actual audited CAS operations with exact replay and public visibility transitions', async ({
  world,
  context,
  browser,
}) => {
  await world.admin.signIn(context);
  const create = command(world);
  const draft = await save(context.request, create);
  expect(draft.status).toBe('draft');
  expect(draft.revision).toBe(1);
  const replay = await save(context.request, create);
  expect(replay.id).toBe(draft.id);
  expect(replay.revision).toBe(1);
  await failure(
    await post(context.request, adminScheduleApiPath('save'), {
      ...create,
      input: input(world, { title: '허구 다른 요청' }),
    }),
    409,
    'CONFLICT',
  );
  const fan = await browser.newContext({ baseURL: appOrigin });
  try {
    await blockExternal(fan);
    await world.fan.signIn(fan);
    await failure(
      await fan.request.get(`${routes.schedulesApi}?id=${draft.id}`),
      404,
      'NOT_FOUND',
    );
    const update = command(world, {
      schedule_id: draft.id,
      expected_revision: draft.revision,
      input: input(world, { status: 'published' }),
    });
    const published = await save(context.request, update);
    expect(published.revision).toBe(draft.revision + 1);
    expect(
      scheduleEventSchema.parse(
        await success(
          await fan.request.get(`${routes.schedulesApi}?id=${draft.id}`),
        ),
      ).id,
    ).toBe(draft.id);
    await failure(
      await post(context.request, adminScheduleApiPath('save'), {
        ...update,
        operation_id: randomUUID(),
        input: input(world, { title: '허구 오래된 변경' }),
      }),
      409,
      'CONFLICT',
    );
    await failure(
      await post(context.request, adminScheduleApiPath('delete'), {
        operation_id: randomUUID(),
        schedule_id: draft.id,
        expected_revision: draft.revision,
        confirmed: true,
      }),
      409,
      'CONFLICT',
    );
    const remove = {
      operation_id: randomUUID(),
      schedule_id: draft.id,
      expected_revision: published.revision,
      confirmed: true,
    };
    expect(
      await success(
        await post(context.request, adminScheduleApiPath('delete'), remove),
      ),
    ).toEqual({ id: draft.id, deleted: true });
    expect(
      await success(
        await post(context.request, adminScheduleApiPath('delete'), remove),
      ),
    ).toEqual({ id: draft.id, deleted: true });
    await failure(
      await fan.request.get(`${routes.schedulesApi}?id=${draft.id}`),
      404,
      'NOT_FOUND',
    );
    expect(
      localSql(
        `select string_agg(action,',' order by created_at,id) from public.calendar_audit_log where target_id='${uuid(draft.id)}';`,
      ),
    ).toBe('create,update,delete');
    expectNoExternal(fan);
  } finally {
    await fan.close();
  }
});

test('strict routes reject invalid months, cursors, duplicate query keys, unsafe bodies and non-admin or revoked authority', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  for (const query of [
    '?month=0000-01',
    '?month=2026-13',
    '?month=2026-1',
    '?month=2026-01&month=2026-02',
    '?unknown=x',
    '?id=bad',
    '?cursor=bad',
    '?id=' + world.event.id + '&month=' + world.month,
  ])
    await failure(
      await context.request.get(routes.schedulesApi + query),
      400,
      'INVALID_INPUT',
    );
  for (const query of [
    '?page=0',
    '?page=1001',
    '?page=01',
    '?page=1&page=2',
    '?month=2026-00',
    '?unknown=x',
  ])
    await failure(
      await context.request.get(routes.adminSchedulesApi + query),
      400,
      'INVALID_INPUT',
    );
  const create = command(world);
  for (const value of [
    { ...create, unknown: 'value' },
    { ...create, schedule_id: world.event.id },
    { ...create, input: input(world, { lat: null }) },
    { ...create, input: input(world, { title: '   ' }) },
    {
      ...create,
      input: input(world, { ends_at: `${world.month}-24T18:00:00+09:00` }),
    },
  ])
    await failure(
      await post(context.request, adminScheduleApiPath('save'), value),
      400,
      'INVALID_INPUT',
    );
  const unconfirmedPublished = command(world, {
    input: input(world, { status: 'published' }),
    confirmed: false,
  });
  await failure(
    await post(
      context.request,
      adminScheduleApiPath('save'),
      unconfirmedPublished,
    ),
    400,
    'CONFIRMATION_REQUIRED',
  );
  // Confirmation is a publish boundary, not a restriction on private drafts.
  const unconfirmedDraft = await save(
    context.request,
    command(world, { confirmed: false }),
  );
  expect(unconfirmedDraft.status).toBe('draft');
  await failure(
    await context.request.post(adminScheduleApiPath('save'), {
      headers: { Origin: 'https://example.invalid' },
      data: create,
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.post(adminScheduleApiPath('save'), { data: create }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await context.request.post(adminScheduleApiPath('save'), {
      headers: { Origin: appOrigin, 'Content-Type': 'application/json' },
      data: '{broken',
    }),
    400,
    'INVALID_INPUT',
  );
  expect(
    (
      await context.request.put(adminScheduleApiPath('save'), { data: create })
    ).status(),
  ).toBe(405);
  await world.fan.signIn(context);
  await failure(
    await context.request.get(adminScheduleListPath(world.month, 1, true)),
    403,
    'FORBIDDEN',
  );
  await failure(
    await post(context.request, adminScheduleApiPath('save'), create),
    403,
    'FORBIDDEN',
  );
  await world.admin.signIn(context);
  setRole(world.admin, 'fan');
  await failure(
    await post(context.request, adminScheduleApiPath('save'), create),
    403,
    'FORBIDDEN',
  );
  setRole(world.admin, 'admin');
  setRestricted(world.admin, true);
  await failure(
    await context.request.get(adminScheduleListPath(world.month, 1, true)),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.admin, false);
  await context.clearCookies();
  await failure(
    await context.request.get(routes.schedulesApi),
    401,
    'UNAUTHENTICATED',
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: fan calendar, list, own artists, detail/map controls, empty month and settled history`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.home);
      await expect(page).toHaveURL(routes.home);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.fanTitle,
          exact: true,
        }),
      ).toBeVisible();
      await captureElement(
        page,
        main(page).getByRole('region', {
          name: messages.schedules.title,
          exact: true,
        }),
        info,
        `fan-home-entry-offscreen-${scale}-${width}`,
        scale,
      );
      await link(main(page), messages.schedules.entryOpen).click();
      await expect(page).toHaveURL(routes.schedules);
      await expect(
        main(page).getByRole('heading', {
          name: messages.schedules.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(main(page).getByTestId('schedule-calendar')).toBeVisible();
      await fanList(page, world.month);
      const calendar = main(page).getByTestId('schedule-calendar');
      await expect(calendar).toContainText(world.event.title);
      await expect(calendar).toContainText(world.overlap.title);
      await expect(calendar).not.toContainText(world.draft.title);
      await screenshot(
        page,
        info,
        `fan-calendar-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        calendar,
        info,
        `fan-calendar-grid-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('radio', { name: '일정 목록', exact: true })
        .check();
      const list = main(page).getByTestId('schedule-list');
      await expect(list).toBeVisible();
      await expect(list).toContainText(world.unrelatedEvent.title);
      await screenshot(page, info, `fan-list-initial-${scale}-${width}`, scale);
      await main(page)
        .getByRole('checkbox', { name: '내 가수 일정만 보기', exact: true })
        .check();
      await expect(list).toContainText(world.event.title);
      await expect(list).toContainText(world.graceEvent.title);
      await expect(list).toContainText(world.canceledEvent.title);
      await expect(list).not.toContainText(world.unrelatedEvent.title);
      await captureElement(
        page,
        list,
        info,
        `fan-my-artists-list-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('radio', { name: '월 달력', exact: true })
        .check();
      await expect(calendar).toContainText(world.event.title);
      await expect(calendar).not.toContainText(world.unrelatedEvent.title);
      await captureElement(
        page,
        calendar,
        info,
        `fan-my-artists-calendar-${scale}-${width}`,
        scale,
      );
      await link(calendar, `${world.event.title} 자세히 보기`).click();
      await expect(page).toHaveURL(
        scheduleDetailPath(world.event.id, world.month),
      );
      await expect(
        main(page).getByRole('heading', { name: '일정 상세', exact: true }),
      ).toBeVisible();
      await expect(
        main(page).getByRole('heading', {
          name: world.event.title,
          exact: true,
        }),
      ).toBeVisible();
      const maps = main(page).getByTestId('schedule-map-links');
      await expect(maps).toBeVisible();
      const naver = link(maps, '네이버 지도 앱 열기');
      const kakao = link(maps, '카카오맵에서 장소 보기');
      const naverUrl = new URL((await naver.getAttribute('href'))!);
      expect(naverUrl.protocol).toBe('nmap:');
      expect(naverUrl.host).toBe('map');
      expect([...naverUrl.searchParams.keys()].sort()).toEqual([
        'appname',
        'lat',
        'lng',
      ]);
      expect(naverUrl.searchParams.get('lat')).toBe('37.5665');
      expect(naverUrl.searchParams.get('lng')).toBe('126.978');
      expect(naverUrl.searchParams.get('appname')).toBe(appOrigin);
      expect(await kakao.getAttribute('href')).toBe(
        'https://map.kakao.com/link/map/37.5665,126.978',
      );
      for (const anchor of [naver, kakao]) {
        await expect(anchor).toHaveAttribute('target', '_blank');
        await expect(anchor).toHaveAttribute('rel', /noopener/);
        await expect(anchor).toHaveAttribute('rel', /noreferrer/);
        await expect(anchor).toHaveAttribute('referrerpolicy', 'no-referrer');
      }
      await screenshot(
        page,
        info,
        `fan-detail-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        maps,
        info,
        `fan-map-controls-offscreen-${scale}-${width}`,
        scale,
      );
      expectNoExternal(context);
      await page.goBack();
      await expect(page).toHaveURL(scheduleListPath(world.month));
      await expect(
        main(page).getByRole('heading', { name: '공식 일정', exact: true }),
      ).toBeVisible();
      await expect(main(page).getByTestId('schedule-calendar')).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(
        scheduleDetailPath(world.event.id, world.month),
      );
      await expect(
        main(page).getByRole('heading', {
          name: world.event.title,
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `fan-detail-history-settled-${scale}-${width}`,
        scale,
      );
      await page.goto(scheduleDetailPath(world.noMap.id, world.month));
      await expect(page).toHaveURL(
        scheduleDetailPath(world.noMap.id, world.month),
      );
      await expect(
        main(page).getByRole('heading', {
          name: world.noMap.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(link(main(page), '네이버 지도 앱 열기')).toHaveCount(0);
      await expect(link(main(page), '카카오맵에서 장소 보기')).toHaveCount(0);
      await screenshot(
        page,
        info,
        `fan-no-coordinates-${scale}-${width}`,
        scale,
      );
      await fanList(page, world.month);
      await link(main(page), '다음 달').click();
      await expect(page).toHaveURL(scheduleListPath(world.nextMonth));
      await expect(main(page).getByTestId('schedule-calendar')).toContainText(
        world.outside.title,
      );
      await screenshot(
        page,
        info,
        `fan-next-month-settled-${scale}-${width}`,
        scale,
      );
      await link(main(page), '다음 달').click();
      const emptyMonth = new Date(
        Date.parse(`${world.nextMonth}-01T00:00:00Z`),
      );
      emptyMonth.setUTCMonth(emptyMonth.getUTCMonth() + 1);
      await expect(page).toHaveURL(
        scheduleListPath(emptyMonth.toISOString().slice(0, 7)),
      );
      await expect(main(page).getByTestId('schedule-calendar')).toBeVisible();
      await screenshot(page, info, `fan-empty-month-${scale}-${width}`, scale);
      await link(main(page), '이전 달').click();
      await expect(page).toHaveURL(scheduleListPath(world.nextMonth));
      await expect(main(page).getByTestId('schedule-calendar')).toContainText(
        world.outside.title,
      );
      await link(main(page), '이전 달').click();
      await expect(page).toHaveURL(scheduleListPath(world.month));
      await expect(main(page).getByTestId('schedule-calendar')).toContainText(
        world.event.title,
      );
      await screenshot(
        page,
        info,
        `fan-month-return-settled-${scale}-${width}`,
        scale,
      );
      setFont(world.emptyFan, scale);
      await world.emptyFan.signIn(context);
      await fanList(page, world.month);
      await main(page)
        .getByRole('checkbox', {
          name: messages.schedules.mineOnly,
          exact: true,
        })
        .check();
      await expect(
        main(page).getByText(messages.schedules.mineEmpty, { exact: true }),
      ).toBeVisible();
      await expect(
        main(page).getByTestId('schedule-calendar'),
      ).not.toContainText(world.event.title);
      await screenshot(
        page,
        info,
        `fan-my-artists-empty-${scale}-${width}`,
        scale,
      );
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: admin entry, complete create/edit form, publish cancellation, saved updates and confirmed delete`, async ({
      world,
      context,
      page,
    }, info) => {
      const copy = messages.schedules;
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await context.addCookies([
        {
          name: FONT_SCALE_COOKIE,
          value: scale,
          url: appOrigin,
          sameSite: 'Lax',
        },
      ]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.admin);
      await expect(page).toHaveURL(routes.admin);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-home-initial-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).getByRole('region', { name: copy.adminTitle, exact: true }),
        info,
        `admin-schedules-entry-offscreen-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.adminEntryOpen).click();
      await expect(page).toHaveURL(routes.adminSchedules);
      await expect(
        main(page).getByRole('heading', { name: copy.adminTitle, exact: true }),
      ).toBeVisible();
      await expectAdminEmpty(page);
      await screenshot(
        page,
        info,
        `admin-default-month-settled-${scale}-${width}`,
        scale,
      );
      await adminList(page, world.month);
      await expect(main(page).getByTestId('admin-schedule-list')).toContainText(
        world.draft.title,
      );
      await screenshot(page, info, `admin-month-list-${scale}-${width}`, scale);
      await captureElement(
        page,
        main(page).getByTestId('admin-schedule-list'),
        info,
        `admin-month-events-offscreen-${scale}-${width}`,
        scale,
      );
      await link(main(page), copy.new).click();
      await expect(page).toHaveURL(adminSchedulePath('new'));
      await expect(
        main(page).getByRole('heading', {
          name: copy.createTitle,
          exact: true,
        }),
      ).toBeVisible();
      const form = main(page).getByTestId('admin-schedule-form');
      await expect(form).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-create-initial-${scale}-${width}`,
        scale,
      );
      await form
        .getByRole('radio', {
          name: artistOption(world.artist),
          exact: true,
        })
        .check();
      const title = `허구 새 공식 일정 ${world.month}`;
      await form.getByLabel(copy.titleLabel, { exact: true }).fill(title);
      await form
        .getByRole('radio', { name: copy.types.concert, exact: true })
        .check();
      await form
        .getByRole('radio', { name: copy.statuses.published, exact: true })
        .check();
      await form
        .getByLabel(copy.startDate, { exact: true })
        .fill(`${world.month}-25`);
      await form.getByLabel(copy.startTime, { exact: true }).fill('18:30');
      await form
        .getByLabel(copy.endDate, { exact: true })
        .fill(`${world.month}-25`);
      await form.getByLabel(copy.endTime, { exact: true }).fill('21:00');
      await form
        .getByLabel(copy.placeName, { exact: true })
        .fill('허구 시민 공연장');
      await form
        .getByLabel(copy.address, { exact: true })
        .fill('공개 행사 주소 예시');
      await form.getByLabel(copy.latitude, { exact: true }).fill('37.5665');
      await form.getByLabel(copy.longitude, { exact: true }).fill('126.978');
      await form
        .getByLabel(copy.descriptionLabel, { exact: true })
        .fill(
          '격리 CI의 허구 공연입니다.\n긴 설명과 큰 글자에서 저장 및 삭제 버튼까지 확인합니다.',
        );
      await expect(button(form, copy.createSave)).toBeDisabled();
      await form
        .getByRole('checkbox', { name: copy.confirm, exact: true })
        .check();
      await captureElement(
        page,
        form,
        info,
        `admin-create-form-filled-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        button(form, copy.createSave),
        info,
        `admin-create-save-offscreen-${scale}-${width}`,
        scale,
      );
      await button(form, copy.createSave).click();
      const publish = page.getByRole('dialog', {
        name: copy.publishTitle,
        exact: true,
      });
      await expect(publish).toBeVisible();
      await captureElement(
        page,
        publish,
        info,
        `admin-publish-review-${scale}-${width}`,
        scale,
      );
      await button(publish, copy.publishCancel).click();
      await expect(publish).toHaveCount(0);
      await expect(page).toHaveURL(adminSchedulePath('new'));
      await expect(
        form.getByLabel(copy.titleLabel, { exact: true }),
      ).toHaveValue(title);
      await button(form, copy.createSave).click();
      await expect(publish).toBeVisible();
      await button(publish, messages.ui.close).click();
      await expect(publish).toHaveCount(0);
      await expect(page).toHaveURL(adminSchedulePath('new'));
      await button(form, copy.createSave).click();
      const saved = await observeScheduleSave(
        page,
        adminScheduleApiPath('save'),
        async (response) => adminScheduleSchema.parse(await success(response)),
      );
      const [, created] = await Promise.all([
        button(publish, copy.publishConfirm).click(),
        saved.result,
      ]);
      await expect(page).toHaveURL(adminSchedulePath(created.id));
      await expect(
        main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
      ).toBeVisible();
      await expect(
        main(page).getByRole('heading', { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        form.getByLabel(copy.titleLabel, { exact: true }),
      ).toHaveValue(title);
      await screenshot(
        page,
        info,
        `admin-create-saved-settled-${scale}-${width}`,
        scale,
      );
      await captureElement(
        page,
        main(page).getByTestId('admin-schedule-delete'),
        info,
        `admin-delete-control-initial-offscreen-${scale}-${width}`,
        scale,
      );
      const updatedTitle = `허구 수정한 공식 일정 ${world.month}`;
      await form
        .getByLabel(copy.titleLabel, { exact: true })
        .fill(updatedTitle);
      await form
        .getByRole('checkbox', { name: copy.confirm, exact: true })
        .check();
      await button(form, copy.save).click();
      await expect(publish).toBeVisible();
      await button(publish, copy.publishConfirm).click();
      await expect(
        main(page).getByRole('heading', { name: updatedTitle, exact: true }),
      ).toBeVisible();
      await expect(main(page).getByRole('status')).toHaveText(copy.saved);
      await screenshot(
        page,
        info,
        `admin-update-saved-${scale}-${width}`,
        scale,
      );
      await form
        .getByLabel(copy.titleLabel, { exact: true })
        .fill('허구 취소할 수정');
      await button(form, copy.cancel).click();
      await expect(
        form.getByLabel(copy.titleLabel, { exact: true }),
      ).toHaveValue(updatedTitle);
      await expect(
        main(page).getByRole('heading', { name: updatedTitle, exact: true }),
      ).toBeVisible();
      await captureElement(
        page,
        form,
        info,
        `admin-edit-cancel-settled-${scale}-${width}`,
        scale,
      );
      const deletion = main(page).getByTestId('admin-schedule-delete');
      await expect(button(deletion, copy.deleteAction)).toBeDisabled();
      await deletion
        .getByRole('checkbox', { name: copy.deleteConfirm, exact: true })
        .check();
      await button(deletion, copy.deleteAction).click();
      const confirm = page.getByRole('dialog', {
        name: copy.deleteDialogTitle,
        exact: true,
      });
      await expect(confirm).toBeVisible();
      await captureElement(
        page,
        confirm,
        info,
        `admin-delete-review-${scale}-${width}`,
        scale,
      );
      await button(confirm, copy.deleteDialogCancel).click();
      await expect(confirm).toHaveCount(0);
      await expect(page).toHaveURL(adminSchedulePath(created.id));
      expect((await current(context.request, created.id)).title).toBe(
        updatedTitle,
      );
      await button(deletion, copy.deleteAction).click();
      await expect(confirm).toBeVisible();
      await button(confirm, copy.deleteDialogConfirm).click();
      await expect(page).toHaveURL(routes.adminSchedules);
      await expect(
        main(page).getByRole('heading', { name: copy.adminTitle, exact: true }),
      ).toBeVisible();
      await expectAdminEmpty(page);
      await screenshot(
        page,
        info,
        `admin-delete-return-settled-${scale}-${width}`,
        scale,
      );
      await page.goBack();
      await expect(page).toHaveURL(adminSchedulePath(created.id));
      await expect(
        main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
      ).toBeVisible();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.NOT_FOUND,
      );
      await expect(form).toHaveCount(0);
      await screenshot(
        page,
        info,
        `admin-deleted-history-no-stale-form-${scale}-${width}`,
        scale,
      );
    });

test('uncertain accepted update reuses one exact operation while duplicate clicks cannot create duplicate audit records', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await editPage(page, world.draft.id);
  const before = await current(context.request, world.draft.id);
  const form = main(page).getByTestId('admin-schedule-form');
  const title = '허구 응답 유실 뒤 확인하는 일정';
  await form.getByLabel(copy.titleLabel, { exact: true }).fill(title);
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  const bodies: string[] = [];
  await page.route(`**${adminScheduleApiPath('save')}`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (bodies.length === 1) await route.abort('connectionreset');
    else await route.fulfill({ response });
  });
  await button(form, copy.save).evaluate((element) => {
    const control = element as HTMLButtonElement;
    control.click();
    control.click();
  });
  await expect(
    main(page).getByText(copy.uncertain, { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByLabel(copy.titleLabel, { exact: true }),
  ).toBeDisabled();
  expect((await current(context.request, world.draft.id)).revision).toBe(
    before.revision + 1,
  );
  await screenshot(
    page,
    info,
    'admin-uncertain-accepted-update-xlarge-360',
    'xlarge',
  );
  await captureElement(
    page,
    button(form, copy.retryOperation),
    info,
    'admin-uncertain-retry-offscreen-xlarge-360',
    'xlarge',
  );
  await button(form, copy.retryOperation).click();
  await expect(
    main(page).getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByRole('status')).toHaveText(copy.saved);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  const after = await current(context.request, world.draft.id);
  expect(after.revision).toBe(before.revision + 1);
  expect(
    localSql(
      `select count(*) from public.calendar_audit_log where target_id='${uuid(world.draft.id)}' and action='update';`,
    ),
  ).toBe('1');
  await screenshot(
    page,
    info,
    'admin-uncertain-resolved-without-duplicate-xlarge-360',
    'xlarge',
  );
});

test('stale administrator edits preserve unsaved input and require explicit latest-state refresh', async ({
  world,
  context,
  page,
  browser,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await editPage(page, world.draft.id);
  const before = await current(context.request, world.draft.id);
  const form = main(page).getByTestId('admin-schedule-form');
  await form
    .getByLabel(copy.titleLabel, { exact: true })
    .fill('허구 아직 저장하지 않은 내 수정');
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  const other = await browser.newContext({ baseURL: appOrigin });
  try {
    await blockExternal(other);
    await world.other.signIn(other);
    await save(
      other.request,
      command(world, {
        schedule_id: before.id,
        expected_revision: before.revision,
        input: input(world, { title: '허구 다른 운영자의 최신 수정' }),
      }),
    );
    await button(form, copy.save).click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.CONFLICT,
    );
    await expect(form.getByLabel(copy.titleLabel, { exact: true })).toHaveValue(
      '허구 아직 저장하지 않은 내 수정',
    );
    await expect(button(form, copy.save)).toBeDisabled();
    await captureElement(
      page,
      form,
      info,
      'admin-conflict-preserved-edit-xlarge-360',
      'xlarge',
    );
    await button(main(page), copy.refresh).click();
    await expect(form.getByLabel(copy.titleLabel, { exact: true })).toHaveValue(
      '허구 다른 운영자의 최신 수정',
    );
    await expect(main(page).getByRole('alert')).toHaveCount(0);
    await screenshot(
      page,
      info,
      'admin-conflict-explicit-refresh-xlarge-360',
      'xlarge',
    );
    expectNoExternal(other);
  } finally {
    await other.close();
  }
});

test('revoked current authority and restricted fan restoration clear old private fields and map links', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await editPage(page, world.draft.id);
  setRole(world.admin, 'fan');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.FORBIDDEN);
  await expect(main(page).getByTestId('admin-schedule-form')).toHaveCount(0);
  await expect(main(page).getByTestId('admin-schedule-delete')).toHaveCount(0);
  await screenshot(
    page,
    info,
    'admin-role-revoked-no-stale-form-xlarge-360',
    'xlarge',
  );
  await world.fan.signIn(context);
  setFont(world.fan, 'xlarge');
  await page.goto(scheduleDetailPath(world.event.id, world.month));
  await expect(
    main(page).getByRole('heading', { name: world.event.title, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('schedule-map-links')).toBeVisible();
  setRestricted(world.fan, true);
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.FORBIDDEN);
  await expect(main(page).getByTestId('schedule-map-links')).toHaveCount(0);
  await expect(
    main(page).getByRole('heading', { name: world.event.title, exact: true }),
  ).toHaveCount(0);
  await screenshot(
    page,
    info,
    'fan-restricted-restoration-no-stale-maps-xlarge-360',
    'xlarge',
  );
});

test('late result after a newer navigation cannot revive the prior schedule or restore canceled confirmation', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await editPage(page, world.event.id);
  const form = main(page).getByTestId('admin-schedule-form');
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  await button(form, copy.save).click();
  await expect(
    page.getByRole('dialog', { name: copy.publishTitle, exact: true }),
  ).toBeVisible();
  await page.goto(adminScheduleListPath(world.month));
  await expect(page).toHaveURL(adminScheduleListPath(world.month));
  await expect(main(page).getByTestId('admin-schedule-list')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let entered: (() => void) | undefined;
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${routes.adminSchedulesApi}?*`, async (route) => {
    // The create picker shares this actor-bound endpoint. Delay only the old
    // month's list request, never the newer page's artist-picker request.
    if (
      route.request().method() !== 'GET' ||
      !new URL(route.request().url()).searchParams.has('month')
    )
      return route.continue();
    const response = await route.fetch();
    entered?.();
    await delayed;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await button(main(page), copy.refresh).click();
  await waiting;
  await link(main(page), copy.new).click();
  await expect(page).toHaveURL(adminSchedulePath('new'));
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('admin-schedule-form')).toBeVisible();
  release?.();
  await page.unroute(`**${routes.adminSchedulesApi}?*`);
  await expect(main(page).getByTestId('admin-schedule-list')).toHaveCount(0);
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  await expect(
    main(page)
      .getByTestId('admin-schedule-form')
      .getByLabel(copy.titleLabel, { exact: true }),
  ).toHaveValue('');
  await screenshot(
    page,
    info,
    'admin-late-response-new-navigation-xlarge-360',
    'xlarge',
  );
});

test('mounted-actor headers match the current session on every read, artist picker, create, update and delete', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const correct = { [SCHEDULES.actorHeader]: world.admin.id };
  const wrong = { [SCHEDULES.actorHeader]: world.other.id };
  const readPaths = [
    scheduleListPath(world.month, null, true),
    `${routes.schedulesApi}?id=${world.event.id}`,
    adminScheduleListPath(world.month, 1, true),
    `${routes.adminSchedulesApi}?id=${world.draft.id}`,
    `${routes.adminSchedulesApi}?artists=1&page=1`,
  ];
  for (const path of readPaths) {
    await failure(
      await context.request.get(path, { headers: wrong }),
      403,
      'FORBIDDEN',
    );
    await success(await context.request.get(path, { headers: correct }));
  }
  const picker = adminArtistListSchema.parse(
    await success(
      await context.request.get(readPaths.at(-1)!, { headers: correct }),
    ),
  );
  expect(picker.artists.map((artist) => artist.id)).toContain(world.artist.id);
  const create = command(world, {
    input: input(world, { title: '허구 세션 일치 확인 일정' }),
  });
  const write = async (
    path: string,
    data: unknown,
    headers: Record<string, string>,
  ) =>
    context.request.post(path, {
      headers: { Origin: appOrigin, ...headers },
      data,
    });
  await failure(
    await write(adminScheduleApiPath('save'), create, wrong),
    403,
    'FORBIDDEN',
  );
  expect(
    localSql(
      `select count(*) from public.schedules where artist_id='${uuid(world.artist.id)}' and title='허구 세션 일치 확인 일정';`,
    ),
  ).toBe('0');
  const created = adminScheduleSchema.parse(
    await success(await write(adminScheduleApiPath('save'), create, correct)),
  );
  const update = command(world, {
    schedule_id: created.id,
    expected_revision: created.revision,
    input: input(world, { title: '허구 세션 일치 수정 일정' }),
  });
  await failure(
    await write(adminScheduleApiPath('save'), update, wrong),
    403,
    'FORBIDDEN',
  );
  const updated = adminScheduleSchema.parse(
    await success(await write(adminScheduleApiPath('save'), update, correct)),
  );
  expect(updated.revision).toBe(created.revision + 1);
  const remove = {
    operation_id: randomUUID(),
    schedule_id: updated.id,
    expected_revision: updated.revision,
    confirmed: true,
  };
  await failure(
    await write(adminScheduleApiPath('delete'), remove, wrong),
    403,
    'FORBIDDEN',
  );
  expect((await current(context.request, created.id)).revision).toBe(
    updated.revision,
  );
  expect(
    await success(await write(adminScheduleApiPath('delete'), remove, correct)),
  ).toEqual({ id: created.id, deleted: true });
  await world.fan.signIn(context);
  for (const path of readPaths.slice(0, 2)) {
    await failure(
      await context.request.get(path, { headers: correct }),
      403,
      'FORBIDDEN',
    );
    await success(
      await context.request.get(path, {
        headers: { [SCHEDULES.actorHeader]: world.fan.id },
      }),
    );
  }
});

test('accepted create with lost response cannot replay an old administrator operation after a same-tab account switch', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  setFont(world.other, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(adminSchedulePath('new'));
  await expect(page).toHaveURL(adminSchedulePath('new'));
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  const form = main(page).getByTestId('admin-schedule-form');
  await expect(form).toBeVisible();
  await form
    .getByRole('radio', {
      name: artistOption(world.artist),
      exact: true,
    })
    .check();
  await form
    .getByLabel(copy.titleLabel, { exact: true })
    .fill('허구 계정 전환 전 등록한 일정');
  await form
    .getByLabel(copy.startDate, { exact: true })
    .fill(`${world.month}-26`);
  await form.getByLabel(copy.startTime, { exact: true }).fill('18:00');
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  const writes: AdminScheduleSaveInput[] = [];
  const acceptedIds: string[] = [];
  await page.route(`**${adminScheduleApiPath('save')}`, async (route) => {
    expect(route.request().headers()[SCHEDULES.actorHeader.toLowerCase()]).toBe(
      world.admin.id,
    );
    writes.push(adminScheduleSaveSchema.parse(route.request().postDataJSON()));
    const response = await route.fetch();
    acceptedIds.push(adminScheduleSchema.parse(await success(response)).id);
    await route.abort('connectionreset');
  });
  await button(form, copy.createSave).click();
  await expect(
    main(page).getByText(copy.uncertain, { exact: true }),
  ).toBeVisible();
  await expect(button(form, copy.retryOperation)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(acceptedIds).toHaveLength(1);
  const acceptedId = acceptedIds[0]!;
  expect(
    localSql(
      `select count(*) from public.schedules where id='${uuid(acceptedId)}' and created_by='${uuid(world.admin.id)}';`,
    ),
  ).toBe('1');
  await screenshot(
    page,
    info,
    'admin-account-switch-pending-create-xlarge-360',
    'xlarge',
  );
  // Change only this fictional local session's cookies. The mounted page keeps
  // actor A's key; actor B must not inherit or replay A's pending operation.
  await world.other.signIn(context);
  const pickerPath = `${routes.adminSchedulesApi}?artists=1&page=1`;
  const denied = await observeScheduleSave(page, pickerPath, (response) =>
    failure(response, 403, 'FORBIDDEN'),
  );
  const deniedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname === routes.adminSchedulesApi &&
      url.searchParams.get('artists') === '1' &&
      url.searchParams.get('page') === '1'
    );
  });
  const [, , denial] = await Promise.all([
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
    denied.result,
    deniedRequest,
  ]);
  expect(denial.headers()[SCHEDULES.actorHeader.toLowerCase()]).toBe(
    world.admin.id,
  );
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.FORBIDDEN);
  await expect(form).toHaveCount(0);
  await expect(button(main(page), copy.retryOperation)).toHaveCount(0);
  await screenshot(
    page,
    info,
    'admin-account-switch-forbidden-no-old-retry-xlarge-360',
    'xlarge',
  );
  const restored = await observeScheduleSave(page, pickerPath, (response) =>
    failure(response, 403, 'FORBIDDEN'),
  );
  await Promise.all([
    page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    ),
    restored.result,
  ]);
  await expect(form).toHaveCount(0);
  await failure(
    await context.request.post(adminScheduleApiPath('save'), {
      headers: { Origin: appOrigin, [SCHEDULES.actorHeader]: world.admin.id },
      data: writes[0],
    }),
    403,
    'FORBIDDEN',
  );
  expect(writes).toHaveLength(1);
  await page.unroute(`**${adminScheduleApiPath('save')}`);
  const fresh = await observeScheduleSave(page, pickerPath, async (response) =>
    adminArtistListSchema.parse(await success(response)),
  );
  const freshRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === 'GET' &&
      url.pathname === routes.adminSchedulesApi &&
      url.searchParams.get('artists') === '1' &&
      url.searchParams.get('page') === '1'
    );
  });
  const [, , picker] = await Promise.all([
    page.reload(),
    fresh.result,
    freshRequest,
  ]);
  expect(picker.headers()[SCHEDULES.actorHeader.toLowerCase()]).toBe(
    world.other.id,
  );
  await expect(page).toHaveURL(adminSchedulePath('new'));
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  await expect(form.getByLabel(copy.titleLabel, { exact: true })).toHaveValue(
    '',
  );
  await expect(button(form, copy.retryOperation)).toHaveCount(0);
  await expect(button(form, copy.createSave)).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(
    localSql(
      `select count(*) from public.schedules where artist_id='${uuid(world.artist.id)}' and title='허구 계정 전환 전 등록한 일정';`,
    ),
  ).toBe('1');
  expect(
    localSql(
      `select count(*) from public.calendar_audit_log where target_id='${uuid(acceptedId)}' and action='create' and actor_id='${uuid(world.admin.id)}';`,
    ),
  ).toBe('1');
  await screenshot(
    page,
    info,
    'admin-account-switch-fresh-blank-create-xlarge-360',
    'xlarge',
  );
});

test('same-name artists remain distinct by visible slug and selecting one saves only that artist', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const name = `허구 동명이인 가수 ${world.month}`;
  const one = {
    id: randomUUID(),
    slug: `ci-schedules-0000-duplicate-${randomUUID()}`,
    name,
  };
  const two = {
    id: randomUUID(),
    slug: `ci-schedules-0000-duplicate-${randomUUID()}`,
    name,
  };
  for (const artist of [one, two])
    localSql(
      `insert into public.artists(id,slug,name,grade,status) values('${uuid(artist.id)}','${artist.slug}','${name}','B','active');`,
    );
  await page.goto(adminSchedulePath('new'));
  await expect(page).toHaveURL(adminSchedulePath('new'));
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  const form = main(page).getByTestId('admin-schedule-form');
  const options = form.getByRole('group', {
    name: copy.artistSelect,
    exact: true,
  });
  const firstArtist = form.getByRole('radio', {
    name: artistOption(one),
    exact: true,
  });
  const secondArtist = form.getByRole('radio', {
    name: artistOption(two),
    exact: true,
  });
  await expect(firstArtist).toHaveCount(1);
  await expect(secondArtist).toHaveCount(1);
  await expect(options).toContainText(one.slug);
  await expect(options).toContainText(two.slug);
  await secondArtist.check();
  await expect(secondArtist).toBeChecked();
  await expect(firstArtist).not.toBeChecked();
  await captureElement(
    page,
    options,
    info,
    'admin-duplicate-names-visible-slugs-xlarge-360',
    'xlarge',
  );
  await form
    .getByLabel(copy.titleLabel, { exact: true })
    .fill('허구 동명이인 가수 선택 확인');
  await form
    .getByLabel(copy.startDate, { exact: true })
    .fill(`${world.month}-27`);
  await form.getByLabel(copy.startTime, { exact: true }).fill('16:00');
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  const saved = await observeScheduleSave(
    page,
    adminScheduleApiPath('save'),
    async (response) => adminScheduleSchema.parse(await success(response)),
  );
  const [, created] = await Promise.all([
    button(form, copy.createSave).click(),
    saved.result,
  ]);
  expect(created.artist_id).toBe(two.id);
  expect(created.artist_slug).toBe(two.slug);
  await expect(page).toHaveURL(adminSchedulePath(created.id));
  await expect(
    main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
  ).toBeVisible();
  await expect(form.getByLabel(copy.titleLabel, { exact: true })).toHaveValue(
    '허구 동명이인 가수 선택 확인',
  );
  expect(
    localSql(
      `select count(*) from public.schedules where artist_id='${uuid(one.id)}';`,
    ),
  ).toBe('0');
  await screenshot(
    page,
    info,
    'admin-duplicate-name-correct-artist-saved-xlarge-360',
    'xlarge',
  );
});

test('valid percent-encoded month and UUID routes settle to the requested fan/admin content rather than a blank loading page', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.fan, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const encodedList = scheduleListPath(world.month).replaceAll('-', '%2D');
  await page.goto(encodedList);
  await expect(page).toHaveURL(encodedList);
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('schedule-calendar')).toContainText(
    world.event.title,
  );
  await screenshot(
    page,
    info,
    'fan-encoded-month-settled-xlarge-360',
    'xlarge',
  );
  const encodedDetail = scheduleDetailPath(
    world.event.id,
    world.month,
  ).replaceAll('-', '%2D');
  await page.goto(encodedDetail);
  await expect(page).toHaveURL(encodedDetail);
  await expect(
    main(page).getByRole('heading', { name: copy.detailTitle, exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', { name: world.event.title, exact: true }),
  ).toBeVisible();
  await captureElement(
    page,
    main(page).getByTestId('schedule-map-links'),
    info,
    'fan-encoded-uuid-maps-settled-xlarge-360',
    'xlarge',
  );
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  const encodedAdmin = `${adminScheduleListPath(world.month).replaceAll('-', '%2D')}&page=%31`;
  await page.goto(encodedAdmin);
  await expect(page).toHaveURL(encodedAdmin);
  await expect(
    main(page).getByRole('heading', { name: copy.adminTitle, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByTestId('admin-schedule-list')).toContainText(
    world.draft.title,
  );
  await screenshot(
    page,
    info,
    'admin-encoded-query-settled-xlarge-360',
    'xlarge',
  );
  const encodedEdit = adminSchedulePath(world.draft.id).replaceAll('-', '%2D');
  await page.goto(encodedEdit);
  await expect(page).toHaveURL(encodedEdit);
  await expect(
    main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
  ).toBeVisible();
  await expect(
    main(page)
      .getByTestId('admin-schedule-form')
      .getByLabel(copy.titleLabel, { exact: true }),
  ).toHaveValue(world.draft.title);
  await captureElement(
    page,
    main(page).getByTestId('admin-schedule-form'),
    info,
    'admin-encoded-uuid-form-settled-xlarge-360',
    'xlarge',
  );
});

test('page-two artist selection survives uncertain create and actor revalidation with its visible identity and exact operation intact', async ({
  world,
  context,
  page,
}, info) => {
  const copy = messages.schedules;
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  const ordering = world.artist.slug.match(/^ci-schedules-([0-9]+)-/)![1]!;
  const root = `ci-schedules-0000-${ordering}-${randomUUID()}`;
  const artists = Array.from({ length: 25 }, (_, index) => ({
    id: randomUUID(),
    slug: `${root}-${String(index).padStart(2, '0')}`,
    name: `허구 선택 목록 가수 ${index} ${world.month}`,
  }));
  for (const artist of artists)
    localSql(
      `insert into public.artists(id,slug,name,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','B','active');`,
    );
  const chosen = artists[20]!;
  const picker2 = adminArtistListSchema.parse(
    await success(
      await context.request.get(
        `${routes.adminSchedulesApi}?artists=1&page=2`,
        { headers: { [SCHEDULES.actorHeader]: world.admin.id } },
      ),
    ),
  );
  expect(picker2.artists.map((artist) => artist.id)).toContain(chosen.id);
  await page.goto(adminSchedulePath('new'));
  await expect(page).toHaveURL(adminSchedulePath('new'));
  await expect(
    main(page).getByRole('heading', { name: copy.createTitle, exact: true }),
  ).toBeVisible();
  const form = main(page).getByTestId('admin-schedule-form');
  await expect(form).toBeVisible();
  await expect(
    form.getByRole('radio', { name: artistOption(chosen), exact: true }),
  ).toHaveCount(0);
  await button(form, copy.artistNext).click();
  const selected = form.getByRole('radio', {
    name: artistOption(chosen),
    exact: true,
  });
  await expect(selected).toBeVisible();
  await selected.check();
  await captureElement(
    page,
    form.getByRole('group', { name: copy.artistSelect, exact: true }),
    info,
    'admin-page-two-artist-selected-xlarge-360',
    'xlarge',
  );
  await form
    .getByLabel(copy.titleLabel, { exact: true })
    .fill('허구 두 번째 목록 가수 일정');
  await form
    .getByLabel(copy.startDate, { exact: true })
    .fill(`${world.month}-28`);
  await form.getByLabel(copy.startTime, { exact: true }).fill('17:00');
  await form.getByRole('checkbox', { name: copy.confirm, exact: true }).check();
  const bodies: string[] = [];
  const acceptedIds: string[] = [];
  await page.route(`**${adminScheduleApiPath('save')}`, async (route) => {
    bodies.push(route.request().postData()!);
    const response = await route.fetch();
    const accepted = adminScheduleSchema.parse(await success(response));
    expect(accepted.artist_id).toBe(chosen.id);
    acceptedIds.push(accepted.id);
    if (bodies.length === 1) await route.abort('connectionreset');
    else await route.fulfill({ response });
  });
  await button(form, copy.createSave).click();
  await expect(
    main(page).getByText(copy.uncertain, { exact: true }),
  ).toBeVisible();
  const restored = await observeScheduleSave(
    page,
    `${routes.adminSchedulesApi}?artists=1&page=1`,
    async (response) => adminArtistListSchema.parse(await success(response)),
  );
  await Promise.all([
    page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true }),
      ),
    ),
    restored.result,
  ]);
  await expect(selected).toBeChecked();
  await expect(selected).toBeDisabled();
  await expect(form.getByLabel(copy.titleLabel, { exact: true })).toHaveValue(
    '허구 두 번째 목록 가수 일정',
  );
  await expect(
    main(page).getByText(copy.uncertain, { exact: true }),
  ).toBeVisible();
  await captureElement(
    page,
    form.getByRole('group', { name: copy.artistSelect, exact: true }),
    info,
    'admin-page-two-artist-retained-after-restore-xlarge-360',
    'xlarge',
  );
  await captureElement(
    page,
    button(form, copy.retryOperation),
    info,
    'admin-page-two-exact-retry-offscreen-xlarge-360',
    'xlarge',
  );
  await button(form, copy.retryOperation).click();
  await expect(page).toHaveURL(adminSchedulePath(acceptedIds[0]!));
  await expect(
    main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByRole('heading', {
      name: '허구 두 번째 목록 가수 일정',
      exact: true,
    }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(acceptedIds[1]).toBe(acceptedIds[0]);
  expect(
    localSql(
      `select count(*) from public.schedules where artist_id='${uuid(chosen.id)}' and title='허구 두 번째 목록 가수 일정';`,
    ),
  ).toBe('1');
  await screenshot(
    page,
    info,
    'admin-page-two-retained-selection-saved-xlarge-360',
    'xlarge',
  );
});
