import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  APIResponse,
  BrowserContext,
  Locator,
  Page,
} from '@playwright/test';
import {
  ATTENDANCE_POINTS,
  attendanceInputSchema,
  attendanceReceiptSchema,
  pointSnapshotSchema,
  type AttendanceInput,
  type AttendanceReceipt,
} from '../../../src/config/attendance-points';
import { routes, pointsHistoryPath } from '../../../src/config/routes';
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
  localSql,
  preparePolicy,
  removePolicy,
  seedHistory,
  seedPastOperation,
  ledger,
  operationCount,
  unrelatedSnapshot,
  uuid,
  type Identity,
  type Scale,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.attendancePoints;
const button = (root: Page | Locator, name: string) =>
  root.getByRole('button', { name, exact: true });
const entries = (page: Page) => page.locator('[data-point-entry-id]');
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
async function snapshot(
  context: BrowserContext,
  actor: Identity,
  cursor?: string | null,
) {
  return pointSnapshotSchema.parse(
    await success(await get(context.request, pointsHistoryPath(cursor), actor)),
  );
}
async function attend(
  context: BrowserContext,
  actor: Identity,
  input = { operation_id: randomUUID() },
) {
  return attendanceReceiptSchema.parse(
    await success(
      await post(context.request, routes.pointsAttendanceApi, actor, input),
    ),
  );
}
// APIs bypass the PWA document handler. Verify the current actor and real
// database projection before forwarding the exact response to React.
async function captureArrival(page: Page, actor: Identity) {
  let accept!: () => void, reject!: (error: unknown) => void;
  const result = new Promise<void>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    (url) => url.pathname + url.search === routes.pointsApi,
    async (route) => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        expect(request.method()).toBe('GET');
        expect(url.pathname + url.search).toBe(routes.pointsApi);
        expect(request.headers()[ATTENDANCE_POINTS.actorHeader]).toBe(actor.id);
        const response = await route.fetch();
        const data = pointSnapshotSchema.parse(await success(response));
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
async function openPoints(page: Page, actor: Identity) {
  const arrival = await captureArrival(page, actor);
  const response = await page.goto(routes.points);
  expect(response?.status()).toBe(200);
  await arrival.result;
  await expect(page.getByTestId('attendance-points-content')).toBeVisible();
}
// A worker can own full-document navigation. Observe the actual browser
// response before clicking instead of assuming page.route can intercept it.
function navigationResponse(page: Page, path: string) {
  return page.waitForResponse((response) => {
    const request = response.request(),
      url = new URL(response.url());
    return (
      url.pathname === path &&
      (request.resourceType() === 'document' || request.headers().rsc === '1')
    );
  });
}
async function captureMutation(page: Page, actor: Identity, drop = false) {
  let accept!: (value: {
      input: AttendanceInput;
      receipt: AttendanceReceipt;
    }) => void,
    reject!: (error: unknown) => void;
  const result = new Promise<{
    input: AttendanceInput;
    receipt: AttendanceReceipt;
  }>((done, fail) => {
    accept = done;
    reject = fail;
  });
  await page.route(
    `**${routes.pointsAttendanceApi}`,
    async (route) => {
      try {
        const request = route.request();
        expect(request.method()).toBe('POST');
        expect(request.headers()[ATTENDANCE_POINTS.actorHeader]).toBe(actor.id);
        const input = attendanceInputSchema.parse(request.postDataJSON());
        const response = await route.fetch();
        const receipt = attendanceReceiptSchema.parse(await success(response));
        expect(receipt.actor_id).toBe(actor.id);
        expect(receipt.operation_id).toBe(input.operation_id);
        if (drop) await route.abort('failed');
        else await route.fulfill({ response });
        accept({ input, receipt });
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

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('empty private snapshot uses the database KST date and explicit policy without side effects', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const before = unrelatedSnapshot();
  const firstDate = localSql(
    'select private.point_kst_date(clock_timestamp());',
  );
  const value = await snapshot(context, world.fan);
  const lastDate = localSql(
    'select private.point_kst_date(clock_timestamp());',
  );
  expect([firstDate, lastDate]).toContain(value.kst_date);
  expect(value).toMatchObject({
    actor_id: world.fan.id,
    attendance_entry_id: null,
    attendance_amount: 10,
    balance: 0,
    entries: [],
    next_cursor: null,
  });
  expect(ledger(world.fan)).toEqual([]);
  expect(operationCount(world.fan)).toBe(0);
  expect(unrelatedSnapshot()).toBe(before);
});

test('same operation, distinct operation and legacy RPC reuse one KST attendance ledger entry', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const before = unrelatedSnapshot(),
    input = { operation_id: randomUUID() };
  const first = await attend(context, world.fan, input);
  expect(await attend(context, world.fan, input)).toEqual(first);
  const second = await attend(context, world.fan);
  expect(second.entry_id).toBe(first.entry_id);
  const legacy = localSql(
    `begin;set local role authenticated;set local "request.jwt.claim.sub"='${uuid(world.fan.id)}';select public.point_check_attendance();commit;`,
  );
  expect(legacy).toBe(first.entry_id);
  const current = await snapshot(context, world.fan);
  expect(current).toMatchObject({
    attendance_entry_id: first.entry_id,
    balance: 10,
  });
  expect(current.entries).toHaveLength(1);
  expect(current.entries[0]).toMatchObject({
    id: first.entry_id,
    amount: 10,
    earned_on: first.earned_on,
    reason: 'attendance',
  });
  expect(ledger(world.fan)).toHaveLength(1);
  expect(operationCount(world.fan)).toBe(2);
  expect(unrelatedSnapshot()).toBe(before);
});

test('missing policy fails closed while existing private history and immutable receipt remain readable', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  const input = { operation_id: randomUUID() },
    receipt = await attend(context, world.fan, input);
  removePolicy();
  expect(await snapshot(context, world.fan)).toMatchObject({
    attendance_amount: null,
    attendance_entry_id: receipt.entry_id,
    balance: 10,
  });
  expect(await attend(context, world.fan, input)).toEqual(receipt);
  expect((await attend(context, world.fan)).entry_id).toBe(receipt.entry_id);
  await world.other.signIn(context);
  expect(await snapshot(context, world.other)).toMatchObject({
    attendance_amount: null,
    attendance_entry_id: null,
    balance: 0,
  });
  await failure(
    await post(context.request, routes.pointsAttendanceApi, world.other, {
      operation_id: randomUUID(),
    }),
    503,
    'SETUP_NOT_READY',
  );
  expect(ledger(world.other)).toEqual([]);
  expect(operationCount(world.other)).toBe(0);
});

test('explicit zero policy records one attendance with zero balance instead of inventing a reward', async ({
  world,
  context,
}) => {
  preparePolicy(0);
  await world.fan.signIn(context);
  const receipt = await attend(context, world.fan);
  expect(receipt.amount).toBe(0);
  expect(await snapshot(context, world.fan)).toMatchObject({
    attendance_amount: 0,
    attendance_entry_id: receipt.entry_id,
    balance: 0,
  });
  expect((await attend(context, world.fan)).entry_id).toBe(receipt.entry_id);
  expect(ledger(world.fan)).toHaveLength(1);
});

test('history has deterministic tied-timestamp pagination and never exposes another account or private policy fields', async ({
  world,
  context,
}) => {
  const own = seedHistory(world.fan),
    other = seedHistory(world.other);
  await world.fan.signIn(context);
  const first = await snapshot(context, world.fan);
  expect(first.entries.map((row) => row.id)).toEqual(own.slice(0, 20));
  expect(first.next_cursor).toEqual({
    created_at: first.entries.at(-1)!.created_at,
    id: first.entries.at(-1)!.id,
  });
  const next = await snapshot(
    context,
    world.fan,
    JSON.stringify(first.next_cursor),
  );
  expect(next.entries.map((row) => row.id)).toEqual(own.slice(20));
  expect(next.next_cursor).toBeNull();
  expect(
    new Set([...first.entries, ...next.entries].map((row) => row.id)).size,
  ).toBe(25);
  expect(first.balance).toBe(63);
  const encoded = JSON.stringify(first);
  for (const value of [
    ...other,
    'policy_snapshot',
    'policy_version',
    'ref_id',
    'adjustment_note',
    'actor_email',
  ])
    expect(encoded).not.toContain(value);
  await world.other.signIn(context);
  expect(
    (await snapshot(context, world.other)).entries.map((row) => row.id),
  ).toEqual(other.slice(0, 20));
  await failure(
    await get(
      context.request,
      pointsHistoryPath(
        JSON.stringify({ created_at: 'infinity', id: randomUUID() }),
      ),
      world.other,
    ),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await get(
      context.request,
      `${routes.pointsApi}?cursor={}&cursor={}`,
      world.other,
    ),
    400,
    'INVALID_INPUT',
  );
});

test('actor, origin, query and body validation reject forged attendance without a ledger or receipt', async ({
  world,
  context,
}) => {
  await world.fan.signIn(context);
  await failure(await context.request.get(routes.pointsApi), 403, 'FORBIDDEN');
  await failure(
    await get(context.request, routes.pointsApi, world.other),
    403,
    'FORBIDDEN',
  );
  await failure(
    await get(
      context.request,
      `${routes.pointsApi}?user_id=${world.other.id}`,
      world.fan,
    ),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await context.request.post(routes.pointsAttendanceApi, {
      headers: {
        Origin: 'https://example.invalid',
        [ATTENDANCE_POINTS.actorHeader]: world.fan.id,
      },
      data: { operation_id: randomUUID() },
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await post(context.request, routes.pointsAttendanceApi, world.fan, {
      operation_id: randomUUID(),
      amount: 999,
    }),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await post(context.request, routes.pointsAttendanceApi, world.fan, {
      operation_id: 'invalid',
    }),
    400,
    'INVALID_INPUT',
  );
  await failure(
    await post(
      context.request,
      `${routes.pointsAttendanceApi}?amount=999`,
      world.fan,
      { operation_id: randomUUID() },
    ),
    400,
    'INVALID_INPUT',
  );
  expect(ledger(world.fan)).toEqual([]);
  expect(operationCount(world.fan)).toBe(0);
});

test('anonymous, restricted and incomplete profiles cannot read or award attendance', async ({
  world,
  context,
}) => {
  await failure(
    await get(context.request, routes.pointsApi, world.fan),
    401,
    'UNAUTHENTICATED',
  );
  await world.fan.signIn(context);
  setRestricted(world.fan, true);
  await failure(
    await get(context.request, routes.pointsApi, world.fan),
    403,
    'FORBIDDEN',
  );
  await failure(
    await post(context.request, routes.pointsAttendanceApi, world.fan, {
      operation_id: randomUUID(),
    }),
    403,
    'FORBIDDEN',
  );
  setRestricted(world.fan, false);
  localSql(
    `update public.profiles set onboarding_completed_at=null where id='${uuid(world.fan.id)}';`,
  );
  await failure(
    await get(context.request, routes.pointsApi, world.fan),
    403,
    'FORBIDDEN',
  );
  expect(ledger(world.fan)).toEqual([]);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`attendance, recovery and private history stay readable at ${scale} / ${width}`, async ({
      world,
      context,
      page,
    }, info) => {
      test.setTimeout(150_000);
      setFont(world.fan, scale);
      setFont(world.other, scale);
      await page.setViewportSize({ width, height: 900 });
      await world.fan.signIn(context);
      const home = await page.goto(routes.home);
      expect(home?.status()).toBe(200);
      await expect(
        page.getByRole('link', { name: copy.entryOpen, exact: true }),
      ).toBeVisible();
      await captureControl(
        page,
        page.getByRole('link', { name: copy.entryOpen, exact: true }),
        info,
        `attendance-home-control-${scale}-${width}`,
        scale,
      );
      await page.screenshot({
        path: info.outputPath(`attendance-home-${scale}-${width}.png`),
        fullPage: true,
      });
      const arrival = await captureArrival(page, world.fan);
      const navigation = navigationResponse(page, routes.points);
      await page
        .getByRole('link', { name: copy.entryOpen, exact: true })
        .click();
      expect((await navigation).status()).toBe(200);
      await arrival.result;
      await expect(
        page.getByText(copy.emptyHistory, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `attendance-empty-${scale}-${width}`, scale);
      const lost = await captureMutation(page, world.fan, true);
      await button(page, copy.checkAttendance).evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });
      const committed = await lost.result;
      await expect(
        page.getByTestId('attendance-points-recovery'),
      ).toBeVisible();
      expect(ledger(world.fan)).toHaveLength(1);
      const refreshed = await captureArrival(page, world.fan);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await refreshed.result;
      await expect(
        page.getByTestId('attendance-points-recovery'),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `attendance-uncertain-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        page.getByTestId('attendance-points-recovery'),
        info,
        `attendance-recovery-control-${scale}-${width}`,
        scale,
      );
      const replay = await captureMutation(page, world.fan);
      await button(page, copy.recoverAttendance).click();
      expect(await replay.result).toEqual(committed);
      await expect(page.getByTestId('attendance-points-recovery')).toHaveCount(
        0,
      );
      await expect(page.getByTestId('attendance-points-receipt')).toBeVisible();
      await expect(
        page.getByText(copy.checkedAttendance, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `attendance-saved-${scale}-${width}`, scale);
      expect(ledger(world.fan)).toHaveLength(1);
      expect(operationCount(world.fan)).toBe(1);
      seedHistory(world.fan);
      const history = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await history.result;
      await expect(entries(page)).toHaveCount(20);
      await screenshot(
        page,
        info,
        `attendance-history-${scale}-${width}`,
        scale,
      );
      await captureControl(
        page,
        button(page, copy.loadMore),
        info,
        `attendance-history-more-control-${scale}-${width}`,
        scale,
      );
      await button(page, copy.loadMore).click();
      await expect(entries(page)).toHaveCount(26);
      await expect(button(page, copy.loadMore)).toHaveCount(0);
      await screenshot(
        page,
        info,
        `attendance-history-complete-${scale}-${width}`,
        scale,
      );
      removePolicy();
      const disabled = await captureArrival(page, world.fan);
      await button(page, copy.refresh).click();
      await disabled.result;
      await expect(
        page.getByText(copy.policyUnavailable, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `attendance-policy-missing-${scale}-${width}`,
        scale,
      );
      await world.other.signIn(context);
      await openPoints(page, world.other);
      await expect(button(page, copy.checkAttendance)).toBeDisabled();
      await expect(
        page.getByText(copy.emptyHistory, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `attendance-policy-disabled-${scale}-${width}`,
        scale,
      );
      preparePolicy(0);
      const zeroPolicy = await captureArrival(page, world.other);
      await button(page, copy.refresh).click();
      await zeroPolicy.result;
      await expect(button(page, copy.checkAttendance)).toBeEnabled();
      const zero = await captureMutation(page, world.other);
      await button(page, copy.checkAttendance).click();
      expect((await zero.result).receipt.amount).toBe(0);
      await expect(
        page.getByText(copy.checkedAttendance, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `attendance-zero-${scale}-${width}`, scale);
      expect(ledger(world.other)).toHaveLength(1);
    });

test('uncommitted transport loss retains the exact operation through temporary snapshot failure', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  let initial: AttendanceInput | undefined;
  await page.route(
    `**${routes.pointsAttendanceApi}`,
    async (route) => {
      initial = attendanceInputSchema.parse(route.request().postDataJSON());
      await route.abort('failed');
    },
    { times: 1 },
  );
  await button(page, copy.checkAttendance).click();
  await expect(page.getByTestId('attendance-points-recovery')).toBeVisible();
  expect(initial).toBeDefined();
  expect(ledger(world.fan)).toHaveLength(0);
  await page.route(
    (url) => url.pathname === routes.pointsApi,
    (route) => route.abort('failed'),
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByTestId('attendance-points-recovery')).toBeVisible();
  await screenshot(
    page,
    info,
    'attendance-precommit-unavailable-xlarge-360',
    'xlarge',
  );
  const replay = await captureMutation(page, world.fan);
  await button(page, copy.recoverAttendance).click();
  expect((await replay.result).input).toEqual(initial);
  await expect(page.getByTestId('attendance-points-receipt')).toBeVisible();
  expect(ledger(world.fan)).toHaveLength(1);
  expect(operationCount(world.fan)).toBe(1);
});

test('account switch clears a pending operation and private history without replaying it', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  setFont(world.other, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  const lost = await captureMutation(page, world.fan, true);
  await button(page, copy.checkAttendance).click();
  await lost.result;
  await expect(page.getByTestId('attendance-points-recovery')).toBeVisible();
  await world.other.signIn(context);
  let writes = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === routes.pointsAttendanceApi &&
      request.method() === 'POST'
    )
      writes++;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('attendance-points-content')).toHaveCount(0);
  await expect(page.getByTestId('attendance-points-recovery')).toHaveCount(0);
  await expect(page.getByTestId('attendance-points-receipt')).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
  await screenshot(
    page,
    info,
    'attendance-account-denial-xlarge-360',
    'xlarge',
  );
  expect(writes).toBe(0);
  expect(ledger(world.other)).toEqual([]);
  await openPoints(page, world.other);
  await expect(
    page.getByText(copy.emptyHistory, { exact: true }),
  ).toBeVisible();
  expect(ledger(world.fan)).toHaveLength(1);
});

test('a revoked session clears private state and a new sign-in does not replay an old pending operation', async ({
  world,
  context,
  page,
}) => {
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  const lost = await captureMutation(page, world.fan, true);
  await button(page, copy.checkAttendance).click();
  await lost.result;
  await expect(page.getByTestId('attendance-points-recovery')).toBeVisible();
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('attendance-points-content')).toHaveCount(0);
  await expect(page.getByTestId('attendance-points-recovery')).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  await expect(
    page.getByText(copy.checkedAttendance, { exact: true }),
  ).toBeVisible();
  expect(ledger(world.fan)).toHaveLength(1);
  expect(operationCount(world.fan)).toBe(1);
});

test('a receipt from the previous KST day is recovered without claiming attendance for today', async ({
  world,
  context,
  page,
}) => {
  const past = seedPastOperation(world.fan);
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  await expect(button(page, copy.checkAttendance)).toBeEnabled();
  await page.evaluate((operationId) => {
    const original = crypto.randomUUID.bind(crypto);
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: original,
        });
        return operationId;
      },
    });
  }, past.operationId);
  const replay = await captureMutation(page, world.fan);
  await button(page, copy.checkAttendance).click();
  expect((await replay.result).receipt.entry_id).toBe(past.entryId);
  await expect(page.getByTestId('attendance-points-receipt')).toBeVisible();
  await expect(button(page, copy.checkAttendance)).toBeEnabled();
  await expect(
    page.getByText(copy.checkedAttendance, { exact: true }),
  ).toHaveCount(0);
  expect(ledger(world.fan)).toHaveLength(1);
  const today = await captureMutation(page, world.fan);
  await button(page, copy.checkAttendance).click();
  expect((await today.result).receipt.entry_id).not.toBe(past.entryId);
  await expect(
    page.getByText(copy.checkedAttendance, { exact: true }),
  ).toBeVisible();
  expect(ledger(world.fan)).toHaveLength(2);
});

test('HTML, RSC and service-worker caches exclude private ledger payloads and navigation never awards points', async ({
  world,
  context,
  page,
}) => {
  const ids = seedHistory(world.fan);
  await world.fan.signIn(context);
  for (const headers of [{}, { RSC: '1' }]) {
    const response = await context.request.get(routes.points, { headers });
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const text = await response.text();
    for (const id of ids) expect(text).not.toContain(id);
    expect(text).not.toContain('synthetic-attendance-history-v1');
  }
  await openPoints(page, world.fan);
  const before = ledger(world.fan);
  const home = navigationResponse(page, routes.home);
  await page.getByRole('link', { name: copy.backHome, exact: true }).click();
  expect((await home).status()).toBe(200);
  await expect(page).toHaveURL(routes.home);
  await page.goBack();
  await expect(page).toHaveURL(routes.points);
  await expect(page.getByTestId('attendance-points-content')).toBeVisible();
  expect(ledger(world.fan)).toEqual(before);
  expect(operationCount(world.fan)).toBe(0);
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys())
      for (const request of await (await caches.open(key)).keys())
        urls.push(request.url);
    return urls;
  });
  expect(
    cached.some(
      (url) =>
        new URL(url).pathname.startsWith(routes.pointsApi) ||
        new URL(url).pathname === routes.points,
    ),
  ).toBe(false);
});

test('optional attendance analytics requires prior consent and deduplicates by the immutable ledger entry', async ({
  world,
  context,
}) => {
  const version = randomUUID();
  localSql(`insert into private.analytics_policy(singleton,consent_version,enabled,retention_days) values(true,'${uuid(version)}',true,30);
    insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at) values('${uuid(world.fan.id)}','${uuid(version)}',true,clock_timestamp(),clock_timestamp());`);
  await world.fan.signIn(context);
  const input = { operation_id: randomUUID() },
    first = await attend(context, world.fan, input);
  expect(await attend(context, world.fan, input)).toEqual(first);
  expect((await attend(context, world.fan)).entry_id).toBe(first.entry_id);
  const observations = JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('event_key',event_key,'source_id',source_id,'name',name,'origin',origin)),'[]'::jsonb) from private.analytics_events where user_id='${uuid(world.fan.id)}';`,
    ),
  );
  expect(observations).toEqual([
    {
      event_key: first.entry_id,
      source_id: first.entry_id,
      name: 'attendance',
      origin: 'server',
    },
  ]);
  await world.other.signIn(context);
  const declined = await attend(context, world.other);
  expect(declined.amount).toBe(10);
  expect(
    localSql(
      `select count(*) from private.analytics_events where user_id='${uuid(world.other.id)}';`,
    ),
  ).toBe('0');
  expect(ledger(world.other)).toHaveLength(1);
});

test('a newly applied restriction clears a pending receipt and private history without mutating the ledger', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.fan, 'xlarge');
  await page.setViewportSize({ width: 360, height: 900 });
  await world.fan.signIn(context);
  await openPoints(page, world.fan);
  const lost = await captureMutation(page, world.fan, true);
  await button(page, copy.checkAttendance).click();
  await lost.result;
  await expect(page.getByTestId('attendance-points-recovery')).toBeVisible();
  const before = ledger(world.fan);
  setRestricted(world.fan, true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('attendance-points-content')).toHaveCount(0);
  await expect(page.getByTestId('attendance-points-recovery')).toHaveCount(0);
  await expect(page.getByTestId('attendance-points-receipt')).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
  await screenshot(
    page,
    info,
    'attendance-restriction-denial-xlarge-360',
    'xlarge',
  );
  expect(ledger(world.fan)).toEqual(before);
  expect(operationCount(world.fan)).toBe(1);
});
