import { readFileSync } from 'node:fs';
import type { APIResponse, BrowserContext, Page } from '@playwright/test';
import {
  SETTLEMENT_REPORTS,
  settlementReportEnvelopeSchema,
  type SettlementReportEnvelope,
} from '../../../src/config/settlement-reports';
import {
  routes,
  settlementReportsPath,
  settlementReportActionPath,
  settlementReportExportPath,
} from '../../../src/config/routes';
import { inspectWorkbook } from './workbook-inspection';
import { captureReportResponse } from './response-capture';
import {
  test,
  expect,
  appOrigin,
  get,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  setFont,
  setRole,
  setRestricted,
  removeMembership,
  withdrawTerms,
  financialFingerprint,
  reportFingerprint,
  localSql,
  uuid,
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
const copy = messages.settlementReports;
const main = (page: Page) => page.getByRole('main');
const content = (page: Page) => page.getByTestId('settlement-report-content');
const button = (page: Page, name: string) =>
  main(page).getByRole('button', { name, exact: true });
const query = (world: World) => ({
  artistId: world.artist.id,
  month: world.month,
});
const path = (world: World, artist = false, api = false) =>
  settlementReportsPath(query(world), artist, api);
async function success(
  response: Pick<APIResponse, 'status' | 'headers' | 'json'>,
) {
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const result = (await response.json()) as { ok: boolean; data: unknown };
  expect(result.ok).toBe(true);
  return settlementReportEnvelopeSchema.parse(result.data);
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
  context: BrowserContext,
  world: World,
  actor: Identity = world.admin,
  artist = false,
) {
  return success(await get(context.request, path(world, artist, true), actor));
}
async function calculate(
  context: BrowserContext,
  world: World,
  expectedRevision: string | null = null,
  actor: Identity = world.admin,
) {
  const data = await success(
    await post(
      context.request,
      settlementReportActionPath('calculate'),
      actor,
      { ...query(world), expectedRevision },
    ),
  );
  expect(data.actorId).toBe(actor.id);
  expect(data.report?.status).toBe('draft');
  expect(data.sources).toBeNull();
  expect(data.report?.grossKrw).toBe('10000');
  expect(data.report?.finalAmountKrw).toBe('2645');
  expect(data.report?.sourceEventCount).toBe('2');
  return data;
}
async function confirm(
  context: BrowserContext,
  world: World,
  data: SettlementReportEnvelope,
) {
  expect(data.report).not.toBeNull();
  return success(
    await post(
      context.request,
      settlementReportActionPath('confirm'),
      world.admin,
      { reportId: data.report!.id, expectedRevision: data.report!.revision },
    ),
  );
}
async function open(
  page: Page,
  context: BrowserContext,
  world: World,
  artist = false,
) {
  const actor = artist ? world.member : world.admin;
  await actor.signIn(context);
  const result = await captureReportResponse(page, {
    url: `${appOrigin}${path(world, artist, true)}`,
    method: 'GET',
    actorId: actor.id,
    status: 200,
  });
  const navigation = await page.goto(path(world, artist));
  expect(navigation?.status()).toBe(200);
  const data = await success(await result.result());
  expect(data.actorId).toBe(actor.id);
  expect(data.artist.id).toBe(world.artist.id);
  expect(data.month).toBe(world.month);
  await expect(main(page).getByRole('heading').first()).toBeVisible();
  await expect(main(page).locator('.ui-loading')).toHaveCount(0);
  return data;
}
async function waitAction(
  page: Page,
  action: 'calculate' | 'confirm',
  actor: Identity,
  body: unknown,
  run: () => Promise<unknown>,
) {
  const response = await captureReportResponse(page, {
    url: `${appOrigin}${settlementReportActionPath(action)}`,
    method: 'POST',
    actorId: actor.id,
    status: 200,
    body,
  });
  await run();
  const data = await success(await response.result());
  expect(data.actorId).toBe(actor.id);
  expect(data.actorRole).toBe('admin');
  return data;
}
function checkWorkbook(
  bytes: Buffer,
  world: World,
  report: NonNullable<SettlementReportEnvelope['report']>,
) {
  const entries = inspectWorkbook(bytes);
  const workbook = entries.get('xl/workbook.xml')!;
  expect([...workbook.matchAll(/<sheet\s/g)]).toHaveLength(2);
  expect(workbook).toContain('name="요약"');
  expect(workbook).toContain('name="결제 이벤트 상세"');
  expect(
    [...entries.keys()].filter((name) =>
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    ),
  ).toHaveLength(2);
  const eventSheet = entries.get('xl/worksheets/sheet2.xml')!;
  expect([...eventSheet.matchAll(/<row\s/g)]).toHaveLength(3);
  for (const sheet of [
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
  ]) {
    const text = entries.get(sheet)!;
    const cells = [...text.matchAll(/<c\s[^>]*>/g)];
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(([cell]) => cell.includes('t="inlineStr"'))).toBe(true);
  }
  const all = [...entries.values()].join('\n');
  expect(all).not.toMatch(
    /<f(?:\s|>)|externalLink|TargetMode="External"|vbaProject|DDE|HYPERLINK/i,
  );
  expect(all).toContain(report.id);
  expect(all).toContain(report.revision);
  expect(all).toContain(world.events.charge);
  expect(all).toContain(world.events.refund);
  expect(all).not.toContain(world.events.unverified);
  expect(all).toContain('11000');
  expect(all).toContain('-1000');
  expect(all).toContain('2645');
  expect(all).toContain('&lt;가수&gt; &amp; 검토');
  expect(all).not.toMatch(
    /Never export this private|fictional-report-merchant|subscription_id|provider_action_id|evidence_ref|@example[.]invalid/,
  );
  expect(all).not.toContain(world.fan.id);
  expect(all).not.toContain(world.member.id);
  expect(all).not.toContain(world.admin.id);
}

test('draft creation, explicit cancel/review/confirm, locked artist view and two-sheet download preserve financial sources', async ({
  page,
  context,
  world,
}) => {
  await blockExternal(context);
  const moneyBefore = financialFingerprint(world);
  expect((await open(page, context, world)).report).toBeNull();
  const draft = await waitAction(
    page,
    'calculate',
    world.admin,
    { ...query(world), expectedRevision: null },
    () => button(page, copy.calculate).click(),
  );
  await expect(content(page)).toContainText(world.artist.name);
  await expect(content(page)).toContainText(copy.draft);
  for (const forbidden of [
    world.events.charge,
    world.events.refund,
    world.events.unverified,
    world.fan.id,
    world.member.id,
  ])
    await expect(content(page)).not.toContainText(forbidden);
  const beforeCanceledReview = reportFingerprint(world);
  await button(page, copy.review).click();
  await expect(button(page, copy.confirm)).toBeDisabled();
  await button(page, copy.cancel).click();
  await expect(button(page, copy.confirm)).toHaveCount(0);
  expect(reportFingerprint(world)).toBe(beforeCanceledReview);
  await button(page, copy.review).click();
  await main(page).getByRole('checkbox', { name: copy.reviewCheck }).check();
  const confirmed = await waitAction(
    page,
    'confirm',
    world.admin,
    { reportId: draft.report!.id, expectedRevision: draft.report!.revision },
    () => button(page, copy.confirm).click(),
  );
  expect(confirmed.report?.id).toBe(draft.report!.id);
  expect(confirmed.report?.revision).toBe(draft.report!.revision);
  expect(confirmed.report?.status).toBe('confirmed');
  await expect(content(page)).toContainText(copy.locked);
  await expect(button(page, copy.recalculate)).toHaveCount(0);
  const confirmedBefore = reportFingerprint(world);
  const repeated = await confirm(context, world, confirmed);
  expect(repeated.report).toEqual(confirmed.report);
  expect(reportFingerprint(world)).toBe(confirmedBefore);
  const response = await captureReportResponse(page, {
    url: `${appOrigin}${settlementReportExportPath(confirmed.report!.id, confirmed.report!.revision)}`,
    method: 'GET',
    actorId: world.admin.id,
    status: 200,
  });
  await button(page, copy.export).click();
  const downloaded = await response.result();
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()['content-type']).toBe(
    SETTLEMENT_REPORTS.workbookContentType,
  );
  expect(downloaded.headers()['cache-control']).toContain('no-store');
  expect(downloaded.headers()['content-disposition']).toBe(
    `attachment; filename="settlement-${confirmed.report!.id}.xlsx"`,
  );
  checkWorkbook(await downloaded.body(), world, confirmed.report!);
  const download = page.waitForEvent('download');
  await main(page)
    .getByRole('link', { name: copy.download, exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  const artistData = await open(page, context, world, true);
  expect(artistData.report).toEqual(confirmed.report);
  expect(artistData.sources).toBeNull();
  await expect(content(page)).toContainText(copy.locked);
  await expect(button(page, copy.calculate)).toHaveCount(0);
  await expect(button(page, copy.export)).toHaveCount(0);
  await failure(
    await get(
      context.request,
      settlementReportExportPath(
        confirmed.report!.id,
        confirmed.report!.revision,
      ),
      world.member,
    ),
    403,
    'FORBIDDEN',
  );
  expect(financialFingerprint(world)).toBe(moneyBefore);
  expectNoExternal(context);
});

test('new and existing draft CAS prevents lost reviews and stale exports across current administrators', async ({
  context,
  world,
}) => {
  await world.admin.signIn(context);
  const first = await calculate(context, world);
  await failure(
    await post(
      context.request,
      settlementReportActionPath('calculate'),
      world.admin,
      { ...query(world), expectedRevision: null },
    ),
    409,
    'REVISION_CONFLICT',
  );
  await world.other.signIn(context);
  const second = await calculate(
    context,
    world,
    first.report!.revision,
    world.other,
  );
  expect(second.report!.revision).not.toBe(first.report!.revision);
  await world.admin.signIn(context);
  await failure(
    await post(
      context.request,
      settlementReportActionPath('confirm'),
      world.admin,
      { reportId: first.report!.id, expectedRevision: first.report!.revision },
    ),
    409,
    'REVISION_CONFLICT',
  );
  await failure(
    await get(
      context.request,
      settlementReportExportPath(first.report!.id, first.report!.revision),
      world.admin,
    ),
    409,
    'REVISION_CONFLICT',
  );
  const saved = await confirm(context, world, second);
  const before = reportFingerprint(world);
  await failure(
    await post(
      context.request,
      settlementReportActionPath('calculate'),
      world.admin,
      { ...query(world), expectedRevision: saved.report!.revision },
    ),
    409,
    'CONFIRMED',
  );
  expect(reportFingerprint(world)).toBe(before);
});

test('new committed sources make a draft stale but never rewrite an already confirmed report', async ({
  context,
  world,
}) => {
  await world.admin.signIn(context);
  const draft = await calculate(context, world);
  localSql(
    `insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values('${uuid(world.artist.id)}','${uuid(world.member.id)}','text','Fictional later source','sent','2026-01-15 00:00+09','2026-01-15 00:00+09');`,
  );
  await failure(
    await post(
      context.request,
      settlementReportActionPath('confirm'),
      world.admin,
      { reportId: draft.report!.id, expectedRevision: draft.report!.revision },
    ),
    409,
    'DRAFT_STALE',
  );
  const replacement = await calculate(context, world, draft.report!.revision);
  const confirmed = await confirm(context, world, replacement);
  const before = reportFingerprint(world);
  localSql(
    `insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values('${uuid(world.artist.id)}','${uuid(world.member.id)}','text','Fictional late confirmed source','sent','2026-01-20 00:00+09','2026-01-20 00:00+09');`,
  );
  expect((await read(context, world)).report).toEqual(confirmed.report);
  expect(reportFingerprint(world)).toBe(before);
});

test('artist draft isolation, fan/foreign-member denial, actor binding and same-origin POST are enforced by actual endpoints', async ({
  context,
  world,
}) => {
  await world.admin.signIn(context);
  const draft = await calculate(context, world);
  await failure(
    await context.request.post(settlementReportActionPath('confirm'), {
      headers: {
        [SETTLEMENT_REPORTS.actorHeader]: world.admin.id,
        Origin: 'https://example.invalid',
      },
      data: {
        reportId: draft.report!.id,
        expectedRevision: draft.report!.revision,
      },
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(context.request, path(world, false, true), world.other),
    403,
    'FORBIDDEN',
  );
  await world.member.signIn(context);
  expect((await read(context, world, world.member, true)).report).toBeNull();
  await failure(
    await post(
      context.request,
      settlementReportActionPath('confirm'),
      world.member,
      { reportId: draft.report!.id, expectedRevision: draft.report!.revision },
    ),
    403,
    'FORBIDDEN',
  );
  await world.fan.signIn(context);
  await failure(
    await get(context.request, path(world, true, true), world.fan),
    403,
    'FORBIDDEN',
  );
  await world.outsider.signIn(context);
  await failure(
    await get(context.request, path(world, true, true), world.outsider),
    403,
    'FORBIDDEN',
  );
  await context.clearCookies();
  await failure(
    await get(context.request, path(world, false, true), world.admin),
    401,
    'UNAUTHENTICATED',
  );
});

for (const revoke of ['membership', 'terms', 'role', 'restriction'] as const)
  test(`current artist ${revoke} revocation clears displayed confirmed data on fresh read`, async ({
    page,
    context,
    world,
  }) => {
    await world.admin.signIn(context);
    await confirm(context, world, await calculate(context, world));
    await open(page, context, world, true);
    await expect(content(page)).toBeVisible();
    if (revoke === 'membership') removeMembership(world);
    if (revoke === 'terms') withdrawTerms(world.member, world);
    if (revoke === 'role') setRole(world.member, 'fan');
    if (revoke === 'restriction') setRestricted(world.member, true);
    const response = await captureReportResponse(page, {
      url: `${appOrigin}${path(world, true, true)}`,
      method: 'GET',
      actorId: world.member.id,
      status: 403,
    });
    await button(page, copy.refresh).click();
    await failure(await response.result(), 403, 'FORBIDDEN');
    await expect(content(page)).toHaveCount(0);
    await expect(main(page).getByRole('alert')).toContainText(
      copy.errors.FORBIDDEN,
    );
  });

test('old-render administrator cannot read or mutate after cookie identity changes', async ({
  page,
  context,
  world,
}) => {
  await open(page, context, world);
  await world.other.signIn(context);
  const response = await captureReportResponse(page, {
    url: `${appOrigin}${settlementReportActionPath('calculate')}`,
    method: 'POST',
    actorId: world.admin.id,
    status: 403,
    body: { ...query(world), expectedRevision: null },
  });
  await button(page, copy.calculate).click();
  await failure(await response.result(), 403, 'FORBIDDEN');
  await expect(content(page)).toHaveCount(0);
  await expect(main(page).getByRole('alert')).toContainText(
    copy.errors.FORBIDDEN,
  );
  expect((await read(context, world, world.other)).report).toBeNull();
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    for (const mode of ['admin', 'artist'] as const)
      test(`${mode} report is readable at ${scale} text and ${width}px`, async ({
        page,
        context,
        world,
      }, info) => {
        await blockExternal(context);
        await world.admin.signIn(context);
        const draft = await calculate(context, world);
        if (mode === 'artist') await confirm(context, world, draft);
        const actor = mode === 'artist' ? world.member : world.admin;
        setFont(actor, scale);
        await page.setViewportSize({ width, height: 900 });
        await open(page, context, world, mode === 'artist');
        await expect(content(page)).toContainText(world.artist.name);
        await expect(content(page)).toContainText('2645');
        await screenshot(
          page,
          info,
          `${mode}-${scale}-${width}`,
          scale as Scale,
        );
        for (const title of [
          copy.summaryTitle,
          copy.activityTitle,
          copy.policyTitle,
        ]) {
          const target = main(page).getByRole('heading', {
            name: title,
            exact: true,
          });
          await target.scrollIntoViewIfNeeded();
          await expect(target).toBeInViewport();
        }
        expectNoExternal(context);
      });

test('repeated calculation activation sends one real mutation while the first verified response is pending', async ({
  page,
  context,
  world,
}) => {
  await open(page, context, world);
  let release!: () => void;
  let arrived!: () => void;
  let settled!: (value: { error?: unknown }) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const completed = new Promise<{ error?: unknown }>((resolve) => {
    settled = resolve;
  });
  let calls = 0;
  await page.route(
    (url) => url.pathname === settlementReportActionPath('calculate'),
    async (route) => {
      let terminalActionStarted = false;
      try {
        calls++;
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({
          ...query(world),
          expectedRevision: null,
        });
        const response = await route.fetch();
        const data = await success(response);
        expect(data.actorId).toBe(world.admin.id);
        expect(data.report?.status).toBe('draft');
        arrived();
        await gate;
        terminalActionStarted = true;
        await route.fulfill({ response });
        settled({});
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Report response verification and cleanup failed.',
            );
          }
        }
        arrived();
        settled({ error: failure });
      }
    },
  );
  await button(page, copy.calculate).evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await received;
  await expect(main(page)).toHaveAttribute('aria-busy', 'true');
  release();
  const completion = await completed;
  if ('error' in completion) throw completion.error;
  await expect(content(page)).toContainText(copy.draft);
  expect(calls).toBe(1);
  expect((await read(context, world)).report?.status).toBe('draft');
});

test('a late verified read is discarded after query navigation, and Back/Forward performs fresh authorized reads', async ({
  page,
  context,
  world,
}) => {
  await world.admin.signIn(context);
  await calculate(context, world);
  await open(page, context, world);
  let release!: () => void, arrived!: () => void;
  let settled!: (value: { error?: unknown }) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const completed = new Promise<{ error?: unknown }>((resolve) => {
    settled = resolve;
  });
  await page.route(
    (url) => url.pathname + url.search === path(world, false, true),
    async (route) => {
      let terminalActionStarted = false;
      try {
        const response = await route.fetch();
        const data = await success(response);
        expect(data.artist.id).toBe(world.artist.id);
        expect(data.actorId).toBe(world.admin.id);
        arrived();
        await gate;
        terminalActionStarted = true;
        await route.fulfill({ response });
        settled({});
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Late report response and cleanup failed.',
            );
          }
        }
        arrived();
        settled({ error: failure });
      }
    },
    { times: 1 },
  );
  await button(page, copy.refresh).click();
  await received;
  const navigation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === routes.admin &&
      response.request().method() === 'GET',
  );
  await main(page).getByRole('link', { name: copy.back, exact: true }).click();
  expect((await navigation).status()).toBe(200);
  await expect(page).toHaveURL(routes.admin);
  await expect(main(page).getByRole('heading').first()).toBeVisible();
  release();
  const completion = await completed;
  if ('error' in completion) throw completion.error;
  await expect(content(page)).toHaveCount(0);
  const backRead = await captureReportResponse(page, {
    url: `${appOrigin}${path(world, false, true)}`,
    method: 'GET',
    actorId: world.admin.id,
    status: 200,
  });
  await page.goBack();
  expect((await success(await backRead.result())).report?.status).toBe('draft');
  await expect(page).toHaveURL(path(world));
  await expect(content(page)).toContainText(world.artist.name);
  await page.goForward();
  await expect(page).toHaveURL(routes.admin);
  await expect(main(page).getByRole('heading').first()).toBeVisible();
  await expect(content(page)).toHaveCount(0);
});

test('pagehide clears the report and pageshow revalidates current administrator restriction', async ({
  page,
  context,
  world,
}) => {
  await world.admin.signIn(context);
  await calculate(context, world);
  await open(page, context, world);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  await expect(content(page)).toHaveCount(0);
  setRestricted(world.admin, true);
  const response = await captureReportResponse(page, {
    url: `${appOrigin}${path(world, false, true)}`,
    method: 'GET',
    actorId: world.admin.id,
    status: 403,
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true }),
    ),
  );
  await failure(await response.result(), 403, 'FORBIDDEN');
  await expect(content(page)).toHaveCount(0);
  await expect(main(page).getByRole('alert')).toContainText(
    copy.errors.FORBIDDEN,
  );
});

test('missing monthly policy remains a visible failure and never manufactures a zero-value draft', async ({
  page,
  context,
  world,
}) => {
  localSql(
    `delete from private.settlement_policies where artist_id='${uuid(world.artist.id)}' and month='2026-01-01';`,
  );
  await open(page, context, world);
  const response = await captureReportResponse(page, {
    url: `${appOrigin}${settlementReportActionPath('calculate')}`,
    method: 'POST',
    actorId: world.admin.id,
    status: 409,
    body: { ...query(world), expectedRevision: null },
  });
  await button(page, copy.calculate).click();
  await failure(await response.result(), 409, 'POLICY_REQUIRED');
  await expect(content(page)).toHaveCount(0);
  await expect(main(page).getByRole('alert')).toContainText(
    copy.errors.POLICY_REQUIRED,
  );
  expect((await read(context, world)).report).toBeNull();
});

test('an interrupted acknowledgement never retries a committed draft and a fresh read reconciles the uncertain result', async ({
  page,
  context,
  world,
}) => {
  await open(page, context, world);
  let calls = 0;
  let saved: SettlementReportEnvelope | undefined;
  let settled!: (value: { error?: unknown }) => void;
  const completed = new Promise<{ error?: unknown }>((resolve) => {
    settled = resolve;
  });
  await page.route(
    (url) => url.pathname === settlementReportActionPath('calculate'),
    async (route) => {
      let terminalActionStarted = false;
      try {
        calls++;
        saved = await success(await route.fetch());
        expect(saved.report?.status).toBe('draft');
        terminalActionStarted = true;
        await route.abort('failed');
        settled({});
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Committed report response and cleanup failed.',
            );
          }
        }
        settled({ error: failure });
      }
    },
  );
  await button(page, copy.calculate).click();
  const completion = await completed;
  if ('error' in completion) throw completion.error;
  await expect(main(page).getByRole('alert')).toContainText(
    copy.errors.UNAVAILABLE,
  );
  await expect(main(page)).toContainText(copy.uncertain);
  await expect(content(page)).toHaveCount(0);
  const before = reportFingerprint(world);
  const refresh = await captureReportResponse(page, {
    url: `${appOrigin}${path(world, false, true)}`,
    method: 'GET',
    actorId: world.admin.id,
    status: 200,
  });
  await button(page, copy.refresh).click();
  expect((await success(await refresh.result())).report).toEqual(saved!.report);
  await expect(content(page)).toContainText(copy.draft);
  expect(reportFingerprint(world)).toBe(before);
  expect(calls).toBe(1);
});

test('a review made stale by another administrator is cleared and must be explicitly reviewed again', async ({
  page,
  context,
  browser,
  world,
}) => {
  await world.admin.signIn(context);
  const first = await calculate(context, world);
  await open(page, context, world);
  await button(page, copy.review).click();
  await main(page).getByRole('checkbox', { name: copy.reviewCheck }).check();
  const otherContext = await browser.newContext({ baseURL: appOrigin });
  try {
    await world.other.signIn(otherContext);
    const replacement = await calculate(
      otherContext,
      world,
      first.report!.revision,
      world.other,
    );
    const response = await captureReportResponse(page, {
      url: `${appOrigin}${settlementReportActionPath('confirm')}`,
      method: 'POST',
      actorId: world.admin.id,
      status: 409,
      body: {
        reportId: first.report!.id,
        expectedRevision: first.report!.revision,
      },
    });
    await button(page, copy.confirm).click();
    await failure(await response.result(), 409, 'REVISION_CONFLICT');
    await expect(content(page)).toHaveCount(0);
    await expect(main(page).getByRole('alert')).toContainText(
      copy.errors.REVISION_CONFLICT,
    );
    const refresh = await captureReportResponse(page, {
      url: `${appOrigin}${path(world, false, true)}`,
      method: 'GET',
      actorId: world.admin.id,
      status: 200,
    });
    await button(page, copy.refresh).click();
    expect((await success(await refresh.result())).report).toEqual(
      replacement.report,
    );
    await expect(button(page, copy.confirm)).toHaveCount(0);
    await button(page, copy.review).click();
    await expect(
      main(page).getByRole('checkbox', { name: copy.reviewCheck }),
    ).not.toBeChecked();
    await expect(button(page, copy.confirm)).toBeDisabled();
  } finally {
    await otherContext.close();
  }
});
