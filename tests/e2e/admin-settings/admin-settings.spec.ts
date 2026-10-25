import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  adminSettingsGroupSchema,
  adminSettingsListSchema,
  type AdminSettingsGroup,
  type AdminSettingsGroupKey,
  type AdminSettingsSaveInput,
} from '../../../src/config/admin-settings';
import { routes } from '../../../src/config/routes';
import {
  test,
  expect,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  assertRenderedScale,
  setFont,
  setRole,
  removeMessagePolicy,
  storedMessageLimit,
  moderationUnchanged,
  createSentPreview,
  initialMessage,
  type Scale,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.adminSettings;
const main = (page: Page) => page.getByRole('main');
const group = (page: Page, key: AdminSettingsGroupKey) =>
  main(page).locator(`[data-admin-settings-group="${key}"]`);
const editor = (page: Page, key: AdminSettingsGroupKey) =>
  main(page).locator(`[data-admin-settings-editor="${key}"]`);
const review = (page: Page, key: AdminSettingsGroupKey) =>
  main(page).locator(`[data-admin-settings-review="${key}"]`);
const button = (within: Page | Locator, name: string) =>
  within.getByRole('button', { name, exact: true });
const field = (within: Locator, key: string) =>
  within.locator(`input[name="${key}"]`);
async function snapshot(request: APIRequestContext) {
  const response = await request.get(routes.adminSettingsApi);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return adminSettingsListSchema.parse(body.data);
}
async function current(request: APIRequestContext, key: AdminSettingsGroupKey) {
  return (await snapshot(request)).groups.find((row) => row.key === key)!;
}
function input(
  row: AdminSettingsGroup,
  patch: Record<string, number>,
): AdminSettingsSaveInput {
  return {
    group: row.key,
    operation_id: randomUUID(),
    expected_revision: row.revision,
    values: { ...row.values, ...patch },
    confirmed: true,
    // Fictional test-only reference; never a real operator approval.
    decision_reference: randomUUID(),
  };
}
async function save(
  request: APIRequestContext,
  row: AdminSettingsGroup,
  patch: Record<string, number>,
) {
  const change = input(row, patch);
  const response = await post(request, routes.adminSettingsApi, change);
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  return { change, group: adminSettingsGroupSchema.parse(body.data) };
}
async function failure(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}
async function open(page: Page) {
  await page.goto(routes.adminSettings);
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(group(page, 'message')).toBeVisible();
  await expect(group(page, 'display')).toBeVisible();
}
async function edit(page: Page, key: AdminSettingsGroupKey) {
  await button(group(page, key), copy.edit).click();
  await expect(editor(page, key)).toBeVisible();
  return editor(page, key);
}
async function prepareReview(
  page: Page,
  key: AdminSettingsGroupKey,
  name: string,
  value: number,
) {
  const form = await edit(page, key);
  await field(form, name).fill(String(value));
  await field(form, 'decision_reference').fill(randomUUID());
  await button(form, copy.review).click();
  await expect(review(page, key)).toBeVisible();
  return review(page, key);
}
async function captureElement(
  page: Page,
  target: Locator,
  info: Parameters<typeof screenshot>[1],
  name: string,
  scale: Scale,
) {
  // Check the actual live font and layout before capturing the complete section.
  // Avoid enormous full-document images of the retained 30-entry audit history.
  await assertRenderedScale(page, scale);
  await target.screenshot({ path: info.outputPath(`${name}.png`) });
}

test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real settings RPC persists only typed operational values with exact actor audit, replay and stale CAS', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = await current(context.request, 'message');
  expect(before.values).toEqual(initialMessage);
  const changed = await save(context.request, before, {
    max_text_length: 1234,
  });
  expect(changed.group.revision).toBeGreaterThan(before.revision);
  expect(storedMessageLimit()).toBe(1234);
  const replay = await post(
    context.request,
    routes.adminSettingsApi,
    changed.change,
  );
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data).toEqual(changed.group);
  const after = await snapshot(context.request);
  const audit = after.audit.filter(
    (entry) => entry.operation_id === changed.change.operation_id,
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    group_key: 'message',
    actor_id: world.admin.id,
    source: 'admin',
    decision_reference: changed.change.decision_reference,
    before_value: initialMessage,
    after_value: changed.group.values,
  });
  expect(Date.parse(audit[0]!.created_at)).not.toBeNaN();
  await failure(
    await post(
      context.request,
      routes.adminSettingsApi,
      input(before, { max_text_length: 1111 }),
    ),
    409,
    'CONFLICT',
  );
  expect(storedMessageLimit()).toBe(1234);
  const community = await current(context.request, 'community');
  await save(context.request, community, { max_title_length: 120 });
  expect(moderationUnchanged()).toBe(true);
  const serialized = JSON.stringify(await snapshot(context.request));
  expect(serialized).not.toMatch(
    /fictional-sentinel|forbidden_terms|forbidden_patterns|billing_key|password|SUPABASE_SERVICE_ROLE_KEY/,
  );
});

test('request validation and current actor guards reject unknown keys, policy activation, stale confirmation and unauthenticated reads', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const before = await current(context.request, 'display');
  const valid = input(before, { page_size: 31 });
  for (const invalid of [
    { ...valid, values: { page_size: 0 } },
    { ...valid, values: { page_size: 101 } },
    { ...valid, values: { page_size: 1.5 } },
    { ...valid, values: { page_size: '30' } },
    { ...valid, values: { page_size: 30, webpush_enabled: 1 } },
    { ...valid, group: 'checkout' },
    { ...valid, decision_reference: 'not-an-approval' },
    { ...valid, enabled: true },
    { ...valid, actor_id: world.other.id },
  ])
    await failure(
      await post(context.request, routes.adminSettingsApi, invalid),
      400,
      'INVALID_INPUT',
    );
  await failure(
    await post(context.request, routes.adminSettingsApi, {
      ...valid,
      confirmed: false,
    }),
    400,
    'INVALID_INPUT',
  );
  const crossOrigin = await context.request.post(routes.adminSettingsApi, {
    headers: { Origin: 'https://example.invalid' },
    data: valid,
  });
  await failure(crossOrigin, 403, 'FORBIDDEN');
  expect((await current(context.request, 'display')).revision).toBe(
    before.revision,
  );
  await world.fan.signIn(context);
  await failure(
    await context.request.get(routes.adminSettingsApi),
    403,
    'FORBIDDEN',
  );
  await failure(
    await post(context.request, routes.adminSettingsApi, valid),
    403,
    'FORBIDDEN',
  );
  await context.clearCookies();
  await failure(
    await context.request.get(routes.adminSettingsApi),
    401,
    'UNAUTHENTICATED',
  );
});

test('existing preview count blocks a lower limit and missing policy stays absent rather than receiving defaults', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  createSentPreview(world);
  const before = await current(context.request, 'message');
  await failure(
    await post(
      context.request,
      routes.adminSettingsApi,
      input(before, { preview_max_count: 0 }),
    ),
    409,
    'PREVIEW_LIMIT_CONFLICT',
  );
  expect((await current(context.request, 'message')).revision).toBe(
    before.revision,
  );
  removeMessagePolicy();
  const missing = await current(context.request, 'message');
  expect(missing.configured).toBe(false);
  expect(missing.values).toBeNull();
  await failure(
    await post(context.request, routes.adminSettingsApi, {
      ...input(missing, {}),
      values: initialMessage,
    }),
    503,
    'SETUP_NOT_READY',
  );
  expect((await current(context.request, 'message')).configured).toBe(false);
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: settled entry, numeric form, validation, review, cancel, reset, save and policy navigation`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.admin);
      await main(page)
        .getByRole('link', { name: copy.entryOpen, exact: true })
        .click();
      await expect(
        main(page).getByRole('heading', { name: copy.title, exact: true }),
      ).toBeVisible();
      await expect(group(page, 'display')).toBeVisible();
      await screenshot(page, info, `settings-initial-${scale}-${width}`, scale);
      for (const key of ['message', 'community'] as const) {
        const numericForm = await edit(page, key);
        await captureElement(
          page,
          numericForm,
          info,
          `settings-${key}-editor-${scale}-${width}`,
          scale,
        );
        await button(numericForm, copy.cancel).click();
        await expect(numericForm).toHaveCount(0);
      }
      const form = await edit(page, 'display');
      await expect(field(form, 'page_size')).toHaveValue('30');
      await expect(field(form, 'decision_reference')).toHaveValue('');
      await field(form, 'page_size').fill('101');
      await button(form, copy.review).click();
      await expect(field(form, 'page_size')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await expect(field(form, 'decision_reference')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      await captureElement(
        page,
        form,
        info,
        `settings-invalid-${scale}-${width}`,
        scale,
      );
      await button(form, copy.reset).click();
      await expect(field(form, 'page_size')).toHaveValue('30');
      await expect(form.getByRole('alert')).toHaveCount(0);
      await field(form, 'decision_reference').fill(randomUUID());
      await button(form, copy.review).click();
      await expect(form.getByRole('alert')).toHaveText(copy.noChanges);
      expect(
        (await current(context.request, 'display')).values?.page_size,
      ).toBe(30);
      await field(form, 'page_size').fill('35');
      await field(form, 'decision_reference').fill(randomUUID());
      await button(form, copy.review).click();
      const confirmation = review(page, 'display');
      await expect(confirmation).toBeVisible();
      await expect(
        confirmation.getByLabel(copy.confirm, { exact: true }),
      ).not.toBeChecked();
      await button(confirmation, copy.save).click();
      await expect(confirmation.getByRole('alert')).toHaveText(
        copy.confirmationMissing,
      );
      await captureElement(
        page,
        confirmation,
        info,
        `settings-confirmation-${scale}-${width}`,
        scale,
      );
      expect(
        (await current(context.request, 'display')).values?.page_size,
      ).toBe(30);
      await button(confirmation, copy.backToEdit).click();
      await expect(field(form, 'page_size')).toHaveValue('35');
      await button(form, copy.cancel).click();
      await expect(form).toHaveCount(0);
      expect(
        (await current(context.request, 'display')).values?.page_size,
      ).toBe(30);
      const reviewed = await prepareReview(page, 'display', 'page_size', 36);
      await reviewed.getByLabel(copy.confirm, { exact: true }).check();
      await button(reviewed, copy.save).dblclick();
      await expect(
        main(page).getByRole('status').filter({ hasText: copy.saved }),
      ).toBeVisible();
      await expect(editor(page, 'display')).toHaveCount(0);
      expect(
        (await current(context.request, 'display')).values?.page_size,
      ).toBe(36);
      await captureElement(
        page,
        group(page, 'display'),
        info,
        `settings-saved-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.policiesOpen, exact: true })
        .click();
      await expect(page).toHaveURL(routes.adminSettingsPolicies);
      await expect(
        main(page).locator('[data-admin-settings-catalog]'),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `settings-policies-initial-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.backSettings, exact: true })
        .first()
        .click();
      await expect(group(page, 'display')).toBeVisible();
      await page.goBack();
      await expect(
        main(page).locator('[data-admin-settings-catalog]'),
      ).toBeVisible();
      await page.goForward();
      await expect(group(page, 'display')).toBeVisible();
      expect(
        (await current(context.request, 'display')).values?.page_size,
      ).toBe(36);
      await main(page)
        .getByRole('link', { name: copy.back, exact: true })
        .click();
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
    });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: stale conflict, read-only retry, role loss and expired session clear prior values`, async ({
      world,
      context,
      page,
      browser,
    }, info) => {
      setFont(world.admin, scale);
      await world.admin.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      const confirmation = await prepareReview(
        page,
        'message',
        'max_text_length',
        1400,
      );
      const other = await browser.newContext({
        baseURL: 'http://127.0.0.1:3100',
      });
      try {
        await world.other.signIn(other);
        await save(other.request, await current(other.request, 'message'), {
          max_text_length: 1500,
        });
      } finally {
        await other.close();
      }
      await confirmation.getByLabel(copy.confirm, { exact: true }).check();
      await button(confirmation, copy.save).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.CONFLICT,
      );
      await expect(
        main(page).locator('[data-admin-settings-group]'),
      ).toHaveCount(0);
      await expect(
        main(page).locator('[data-admin-settings-audit]'),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `settings-conflict-initial-${scale}-${width}`,
        scale,
      );
      expect(storedMessageLimit()).toBe(1500);
      await button(main(page), messages.ui.retry).click();
      await expect(group(page, 'message')).toBeVisible();
      const latest = await edit(page, 'message');
      await expect(field(latest, 'max_text_length')).toHaveValue('1500');
      await expect(field(latest, 'decision_reference')).toHaveValue('');
      await button(latest, copy.cancel).click();
      setRole(world.admin, 'fan');
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.FORBIDDEN,
      );
      await expect(
        main(page).locator('[data-admin-settings-group]'),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `settings-role-lost-initial-${scale}-${width}`,
        scale,
      );
      setRole(world.admin, 'admin');
      await button(main(page), messages.ui.retry).click();
      await expect(group(page, 'message')).toBeVisible();
      await context.clearCookies();
      await button(main(page), copy.refresh).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.UNAUTHENTICATED,
      );
      await expect(
        main(page).locator('[data-admin-settings-group]'),
      ).toHaveCount(0);
      await expect(
        main(page).locator('[data-admin-settings-audit]'),
      ).toHaveCount(0);
      await screenshot(
        page,
        info,
        `settings-session-lost-initial-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.signIn, exact: true })
        .click();
      await expect(
        page.getByRole('heading', {
          name: messages.auth.startTitle,
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(routes.start);
    });

test('accepted write with lost response refreshes without replay and canceled navigation ignores a late response', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await open(page);
  let writes = 0;
  await page.route(`**${routes.adminSettingsApi}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    writes += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    // The real write succeeded; only its response is deliberately lost.
    await route.abort('connectionreset');
  });
  const confirmation = await prepareReview(page, 'display', 'page_size', 41);
  await confirmation.getByLabel(copy.confirm, { exact: true }).check();
  await button(confirmation, copy.save).click();
  await expect(main(page).getByRole('alert')).toHaveText(
    copy.errors.UNAVAILABLE,
  );
  await expect(main(page).locator('[data-admin-settings-group]')).toHaveCount(
    0,
  );
  await screenshot(
    page,
    info,
    'settings-uncertain-write-initial-xlarge-360',
    'xlarge',
  );
  expect((await current(context.request, 'display')).values?.page_size).toBe(
    41,
  );
  expect(writes).toBe(1);
  await page.unroute(`**${routes.adminSettingsApi}`);
  await button(main(page), messages.ui.retry).click();
  await expect(group(page, 'display')).toBeVisible();
  const latest = await edit(page, 'display');
  await expect(field(latest, 'page_size')).toHaveValue('41');
  await expect(field(latest, 'decision_reference')).toHaveValue('');
  await button(latest, copy.cancel).click();
  expect(writes).toBe(1);
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${routes.adminSettingsApi}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    entered?.();
    await delayed;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await button(main(page), copy.refresh).click();
  await waiting;
  await main(page)
    .getByRole('link', { name: copy.policiesOpen, exact: true })
    .click();
  await expect(
    main(page).locator('[data-admin-settings-catalog]'),
  ).toBeVisible();
  release?.();
  await page.unroute(`**${routes.adminSettingsApi}`);
  await expect(main(page).locator('[data-admin-settings-group]')).toHaveCount(
    0,
  );
  await expect(
    main(page).locator('[data-admin-settings-catalog]'),
  ).toBeVisible();
  await screenshot(
    page,
    info,
    'settings-navigation-late-response-xlarge-360',
    'xlarge',
  );
});

test('missing policy has a real runbook link and every policy section link reaches a settled target', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  await world.admin.signIn(context);
  removeMessagePolicy();
  await page.setViewportSize({ width: 360, height: 900 });
  await open(page);
  await expect(
    group(page, 'message').getByText(copy.unconfigured, { exact: true }),
  ).toBeVisible();
  await expect(button(group(page, 'message'), copy.edit)).toHaveCount(0);
  await captureElement(
    page,
    group(page, 'message'),
    info,
    'settings-unconfigured-initial-xlarge-360',
    'xlarge',
  );
  await group(page, 'message')
    .getByRole('link', { name: copy.groupPolicy, exact: true })
    .click();
  await expect(
    main(page).locator('[data-admin-settings-catalog]'),
  ).toBeVisible();
  await expect(page.locator('#message-policy')).toBeVisible();
  await screenshot(page, info, 'settings-message-runbook-xlarge-360', 'xlarge');
  // Check actual link targets from the catalog; no hardcoded guessed set of
  // policy names and no acceptance of a transient navigation URL as success.
  const hrefs = await main(page)
    .locator('[data-admin-settings-catalog] a[href*="#"]')
    .evaluateAll((links) => [
      ...new Set(
        links
          .map((link) => link.getAttribute('href'))
          .filter((href): href is string => href !== null),
      ),
    ]);
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    const link = main(page).locator(`[href="${href}"]`).first();
    await link.click();
    const id = decodeURIComponent(new URL(href, page.url()).hash.slice(1));
    await expect(page.locator(`[id="${id}"]`)).toBeVisible();
    await expect(
      main(page).locator('[data-admin-settings-catalog]'),
    ).toBeVisible();
    await captureElement(
      page,
      page.locator(`[id="${id}"]`),
      info,
      `settings-runbook-${id}-xlarge-360`,
      'xlarge',
    );
  }
  // The bottom return link and each group-specific policy link are real routes,
  // not decorative controls. Wait for fresh settings data on every return.
  await main(page)
    .getByRole('link', { name: copy.backSettings, exact: true })
    .last()
    .click();
  await expect(group(page, 'display')).toBeVisible();
  for (const key of ['message', 'community', 'display'] as const) {
    await group(page, key)
      .getByRole('link', { name: copy.groupPolicy, exact: true })
      .click();
    await expect(page.locator(`[id="${key}-policy"]`)).toBeVisible();
    await main(page)
      .getByRole('link', { name: copy.backSettings, exact: true })
      .first()
      .click();
    await expect(group(page, 'display')).toBeVisible();
  }
});
