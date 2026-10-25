import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIResponse, Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  preparePolicies,
  completeProfile,
  deviceSummary,
  restrict,
  setFont,
  notificationPolicy,
  rotateNotificationConsent,
  blockExternal,
  expectNoExternal,
  screenshot,
  type World,
} from './fixtures';
import {
  installPushManager,
  pushSnapshot,
  setPermission,
  waitForPushWorker,
} from './push-manager';
import {
  WEBPUSH_CI_ENV,
  WEBPUSH_CI_SUBSCRIPTION,
} from '../../../scripts/webpush-local-fixtures.mjs';
import { routes } from '../../../src/config/routes';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const settingsPath = routes.notifications;
const subscribePath = routes.pushSubscription;
const main = (page: Page) => page.getByRole('main');
const subscription = () => ({
  endpoint: `${WEBPUSH_CI_SUBSCRIPTION.endpoint}-${randomUUID()}`,
  keys: WEBPUSH_CI_SUBSCRIPTION.keys,
});
async function prepare(world: World) {
  await completeProfile(world.fan, world.artist);
  await completeProfile(world.other, world.artist);
}
async function register(page: Page, input = subscription()) {
  return page.request.post(subscribePath, {
    headers: { Origin: appOrigin },
    data: {
      action: 'subscribe',
      applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
      subscription: input,
      consentVersion: 'fictional-webpush-consent-v1',
      confirmed: true,
    },
  });
}
async function status(page: Page, endpoint: string | null = null) {
  return page.request.post(subscribePath, {
    headers: { Origin: appOrigin },
    data: { action: 'status', endpoint },
  });
}
async function failure(
  response: APIResponse,
  httpStatus: number,
  code: string,
) {
  expect(response.status()).toBe(httpStatus);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('real HTTP and Auth RPC registration is current-session owned, idempotent and has no delivery side effects', async ({
  world,
  page,
  context,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  const firstStatus = await page.request.get(subscribePath);
  expect(firstStatus.status()).toBe(200);
  expect(firstStatus.headers()['cache-control']).toContain('no-store');
  expect(await firstStatus.json()).toMatchObject({
    ok: true,
    data: {
      configured: true,
      publicKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
      consentVersion: 'fictional-webpush-consent-v1',
      deviceId: null,
      deviceActive: false,
      webpushEnabled: false,
      newMessage: false,
    },
  });
  const input = subscription();
  const first = await register(page, input);
  expect(first.status()).toBe(200);
  const result = await first.json();
  expect(result).toMatchObject({
    ok: true,
    data: { deviceActive: true, webpushEnabled: true, newMessage: true },
  });
  expect(result.data.deviceId).toMatch(/^[0-9a-f-]{36}$/);
  const second = await register(page, input);
  expect(second.status()).toBe(200);
  expect((await second.json()).data.deviceId).toBe(result.data.deviceId);
  const current = await status(page, input.endpoint);
  expect(current.status()).toBe(200);
  expect((await current.json()).data.deviceId).toBe(result.data.deviceId);
  expect(deviceSummary(world.fan)).toMatchObject({ active: 1, jobs: 0 });
  expect(JSON.stringify(result)).not.toContain(input.endpoint);
  expect(JSON.stringify(result)).not.toContain(input.keys.auth);
  expect(JSON.stringify(result)).not.toContain(world.fan.id);
  expect(JSON.stringify(result)).not.toContain(
    WEBPUSH_CI_ENV.VAPID_PRIVATE_KEY,
  );
});

test('registration requires explicit current consent and same origin, and refuses another account endpoint ownership', async ({
  world,
  page,
  context,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  const input = subscription();
  await failure(
    await page.request.post(subscribePath, {
      headers: { Origin: 'https://foreign.example.invalid' },
      data: {
        action: 'subscribe',
        applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
        subscription: input,
        consentVersion: 'fictional-webpush-consent-v1',
        confirmed: true,
      },
    }),
    403,
    'FORBIDDEN',
  );
  await failure(
    await page.request.post(subscribePath, {
      headers: { Origin: appOrigin },
      data: {
        action: 'subscribe',
        applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
        subscription: input,
        consentVersion: 'fictional-webpush-consent-v1',
        confirmed: false,
      },
    }),
    400,
    'INVALID_INPUT',
  );
  expect(deviceSummary(world.fan).active).toBe(0);
  expect((await register(page, input)).status()).toBe(200);
  await world.other.signIn(context);
  await failure(await register(page, input), 409, 'CONFLICT');
  expect(deviceSummary(world.other).active).toBe(0);
  expect(deviceSummary(world.fan).active).toBe(1);
});

test('stale public VAPID binding is rejected before durable endpoint registration', async ({
  world,
  page,
  context,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await failure(
    await page.request.post(subscribePath, {
      headers: { Origin: appOrigin },
      data: {
        action: 'subscribe',
        applicationServerKey: WEBPUSH_CI_SUBSCRIPTION.keys.p256dh,
        subscription: subscription(),
        consentVersion: 'fictional-webpush-consent-v1',
        confirmed: true,
      },
    }),
    409,
    'CONFLICT',
  );
  expect(deviceSummary(world.fan)).toMatchObject({ active: 0, jobs: 0 });
});

test('server revocation remains available after account restriction and never runs the delivery worker', async ({
  world,
  page,
  context,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  const input = subscription();
  expect((await register(page, input)).status()).toBe(200);
  restrict(world.fan);
  const revoked = await page.request.delete(subscribePath, {
    headers: { Origin: appOrigin },
    data: { endpoint: input.endpoint },
  });
  expect(revoked.status()).toBe(200);
  expect(deviceSummary(world.fan)).toMatchObject({
    active: 0,
    revoked: 1,
    jobs: 0,
  });
});

const copy = messages.notifications;
const consent = (page: Page) =>
  main(page).getByRole('checkbox', { name: copy.consent, exact: true });
const enable = (page: Page) =>
  main(page).getByRole('button', { name: copy.enable, exact: true });
const disable = (page: Page) =>
  main(page).getByRole('button', { name: copy.disable, exact: true });
const refresh = (page: Page) =>
  main(page).getByRole('button', { name: copy.refresh, exact: true });
async function inactive(page: Page) {
  await expect(
    main(page).getByText(copy.inactive, { exact: true }),
  ).toBeVisible();
  await expect(refresh(page)).toBeEnabled();
}
async function turnOn(page: Page) {
  await waitForPushWorker(page);
  await expect(consent(page)).toBeEnabled();
  await consent(page).check();
  await enable(page).click();
  await expect(
    main(page).getByText(copy.active, { exact: true }),
  ).toBeVisible();
  await expect(disable(page)).toBeEnabled();
}

test('mount and refresh never prompt; explicit checked opt-in registers and disable/re-enable uses durable state', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page);
  await page.goto(settingsPath);
  await inactive(page);
  await expect(enable(page)).toBeDisabled();
  await refresh(page).click();
  await inactive(page);
  expect(await pushSnapshot(page)).toMatchObject({
    permissionRequests: 0,
    subscriptions: 0,
    active: false,
  });
  expect(deviceSummary(world.fan)).toMatchObject({
    active: 0,
    jobs: 0,
    webpushEnabled: false,
  });
  await turnOn(page);
  const enabled = await pushSnapshot(page);
  expect(enabled).toMatchObject({
    permissionRequests: 1,
    subscriptions: 1,
    active: true,
    userVisibleOnly: true,
    applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
  });
  expect(deviceSummary(world.fan)).toMatchObject({
    active: 1,
    jobs: 0,
    webpushEnabled: true,
    newMessage: true,
  });
  await page.reload();
  await expect(
    main(page).getByText(copy.active, { exact: true }),
  ).toBeVisible();
  expect((await pushSnapshot(page)).permissionRequests).toBe(1);
  await disable(page).click();
  await inactive(page);
  expect(deviceSummary(world.fan)).toMatchObject({
    active: 0,
    revoked: 1,
    jobs: 0,
  });
  expect(await pushSnapshot(page)).toMatchObject({
    active: false,
    unsubscriptions: 1,
  });
  await turnOn(page);
  expect(await pushSnapshot(page)).toMatchObject({
    permissionRequests: 1,
    subscriptions: 2,
    active: true,
  });
  expect((await pushSnapshot(page)).endpoint).not.toBe(enabled.endpoint);
  expect(deviceSummary(world.fan)).toMatchObject({
    active: 1,
    revoked: 1,
    jobs: 0,
  });
});

for (const answer of ['denied', 'default'] as const)
  test(`a synthetic ${answer} permission answer never registers, and repeated clicks do not create extra prompts`, async ({
    world,
    context,
    page,
  }) => {
    await prepare(world);
    await world.fan.signIn(context);
    await installPushManager(page, { answer, deferPermission: true });
    await page.goto(settingsPath);
    await inactive(page);
    await consent(page).check();
    await enable(page).click();
    await expect(
      main(page).getByRole('button', { name: copy.enabling, exact: true }),
    ).toBeDisabled();
    await page.evaluate(
      (value) => window.__webpushFixture.answerPermission(value),
      answer,
    );
    await expect(main(page).getByRole('alert')).toHaveText(
      answer === 'denied'
        ? copy.errors.PERMISSION_DENIED
        : copy.errors.PERMISSION_DISMISSED,
    );
    expect((await pushSnapshot(page)).permissionRequests).toBe(1);
    expect((await pushSnapshot(page)).subscriptions).toBe(0);
    expect(deviceSummary(world.fan).active).toBe(0);
  });

test('browser permission revocation stops the durable endpoint on recheck without asking for permission again', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page);
  await page.goto(settingsPath);
  await inactive(page);
  await turnOn(page);
  await setPermission(page, 'denied');
  await refresh(page).click();
  await inactive(page);
  await expect(
    main(page).getByText(copy.denied, { exact: true }),
  ).toBeVisible();
  await expect(consent(page)).toBeDisabled();
  expect(deviceSummary(world.fan)).toMatchObject({ active: 0, revoked: 1 });
  expect(await pushSnapshot(page)).toMatchObject({
    permissionRequests: 1,
    active: false,
    unsubscriptions: 1,
  });
});

test('server revoke succeeds before browser cleanup, whose failure remains actionable and retryable', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page);
  await page.goto(settingsPath);
  await inactive(page);
  await turnOn(page);
  await page.evaluate(() => window.__webpushFixture.failUnsubscribe(true));
  await disable(page).click();
  await expect(main(page).getByRole('alert')).toHaveText(
    copy.errors.BROWSER_CLEANUP_REQUIRED,
  );
  await expect(
    main(page).getByText(copy.cleanupNotice, { exact: true }),
  ).toBeVisible();
  expect(deviceSummary(world.fan)).toMatchObject({ active: 0, revoked: 1 });
  expect((await pushSnapshot(page)).active).toBe(true);
  await page.evaluate(() => window.__webpushFixture.failUnsubscribe(false));
  await main(page)
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await inactive(page);
  await expect(main(page).getByRole('alert')).toHaveCount(0);
  expect((await pushSnapshot(page)).active).toBe(false);
});

test('a lost registration response is recovered by endpoint status rather than an extra prompt or duplicate subscription', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page);
  await page.goto(settingsPath);
  await inactive(page);
  let lost = false;
  await page.route(`**${subscribePath}`, async (route) => {
    const request = route.request();
    if (
      !lost &&
      request.method() === 'POST' &&
      request.postDataJSON()?.action === 'subscribe'
    ) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      return route.abort('failed');
    }
    return route.continue();
  });
  await waitForPushWorker(page);
  await consent(page).check();
  await enable(page).click();
  await expect(main(page).getByRole('alert')).toHaveText(
    copy.errors.UNAVAILABLE,
  );
  expect(deviceSummary(world.fan).active).toBe(1);
  await main(page)
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(
    main(page).getByText(copy.active, { exact: true }),
  ).toBeVisible();
  expect(await pushSnapshot(page)).toMatchObject({
    permissionRequests: 1,
    subscriptions: 1,
  });
});

test('leaving while permission is pending does not subscribe after dismissal or Back navigation', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page, { deferPermission: true });
  await page.goto(settingsPath);
  await inactive(page);
  await waitForPushWorker(page);
  await consent(page).check();
  await enable(page).click();
  await main(page)
    .getByRole('link', { name: copy.subscriptions, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${routes.subscriptions}$`));
  await page.evaluate(() =>
    window.__webpushFixture.answerPermission('granted'),
  );
  expect((await pushSnapshot(page)).subscriptions).toBe(0);
  expect(deviceSummary(world.fan).active).toBe(0);
  await page.goBack();
  await inactive(page);
  await expect(consent(page)).not.toBeChecked();
  expect((await pushSnapshot(page)).permissionRequests).toBe(1);
});

for (const workerMode of ['installing', 'stale'] as const)
  test(`synthetic ${workerMode} worker cannot enroll despite its same-origin script URL`, async ({
    world,
    context,
    page,
  }) => {
    await prepare(world);
    await world.fan.signIn(context);
    await installPushManager(page, { permission: 'granted' });
    await page.goto(settingsPath);
    await inactive(page);
    await waitForPushWorker(page);
    await page.evaluate(
      (mode) => window.__webpushFixture.worker(mode),
      workerMode,
    );
    await consent(page).check();
    await enable(page).click();
    await expect(main(page).getByRole('alert')).toHaveText(
      copy.errors.WORKER_UPDATE_REQUIRED,
    );
    expect(await pushSnapshot(page)).toMatchObject({
      subscriptions: 0,
      permissionRequests: 0,
      unsafeWorkerMessages: 0,
    });
    expect(deviceSummary(world.fan).active).toBe(0);
    await page.evaluate(() => window.__webpushFixture.worker('native'));
    await main(page)
      .getByRole('button', { name: messages.ui.retry, exact: true })
      .click();
    await inactive(page);
    await turnOn(page);
    expect((await pushSnapshot(page)).capabilityRequests).toBeGreaterThan(0);
  });

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280]) {
    test(`${scale} ${width}: initial, enabled, permission-revoked and retry settings`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page);
      await page.goto(routes.home);
      await expect(
        main(page).getByRole('link', { name: copy.title, exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `webpush-home-entry-${scale}-${width}`);
      await main(page)
        .getByRole('link', { name: copy.title, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${settingsPath}`);
      await inactive(page);
      await screenshot(page, info, `webpush-initial-${scale}-${width}`);
      await turnOn(page);
      await screenshot(page, info, `webpush-enabled-${scale}-${width}`);
      await setPermission(page, 'denied');
      await refresh(page).click();
      await inactive(page);
      await screenshot(page, info, `webpush-denied-${scale}-${width}`);
      let failOnce = true;
      await page.route(`**${subscribePath}`, async (route) => {
        if (failOnce && route.request().method() === 'POST') {
          failOnce = false;
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, code: 'UNAVAILABLE' }),
          });
        }
        return route.continue();
      });
      await refresh(page).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.UNAVAILABLE,
      );
      await screenshot(page, info, `webpush-retry-${scale}-${width}`);
      await main(page)
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await inactive(page);
      await expect(main(page).getByRole('alert')).toHaveCount(0);
    });
    test(`${scale} ${width}: dismissed permission, browser failure and cleanup recovery remain readable`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page, { answer: 'default' });
      await page.goto(settingsPath);
      await inactive(page);
      await waitForPushWorker(page);
      await consent(page).check();
      await enable(page).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.PERMISSION_DISMISSED,
      );
      await screenshot(page, info, `webpush-dismissed-${scale}-${width}`);
      await setPermission(page, 'granted');
      await page.evaluate(() => window.__webpushFixture.failSubscribe(true));
      await main(page)
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await inactive(page);
      await waitForPushWorker(page);
      await consent(page).check();
      await enable(page).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.BROWSER_UNAVAILABLE,
      );
      await screenshot(page, info, `webpush-browser-error-${scale}-${width}`);
      await page.evaluate(() => window.__webpushFixture.failSubscribe(false));
      await main(page)
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await inactive(page);
      await turnOn(page);
      await page.evaluate(() => window.__webpushFixture.failUnsubscribe(true));
      await disable(page).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.BROWSER_CLEANUP_REQUIRED,
      );
      await screenshot(page, info, `webpush-cleanup-error-${scale}-${width}`);
      await page.evaluate(() => window.__webpushFixture.failUnsubscribe(false));
      await main(page)
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await inactive(page);
      await expect(main(page).getByRole('alert')).toHaveCount(0);
    });
    test(`${scale} ${width}: waiting-worker error and obsolete browser VAPID-key renewal`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page);
      await page.goto(settingsPath);
      await inactive(page);
      await waitForPushWorker(page);
      await page.evaluate(() => window.__webpushFixture.worker('waiting'));
      await consent(page).check();
      await enable(page).click();
      await expect(main(page).getByRole('alert')).toHaveText(
        copy.errors.WORKER_UPDATE_REQUIRED,
      );
      await screenshot(page, info, `webpush-worker-update-${scale}-${width}`);
      expect(await pushSnapshot(page)).toMatchObject({
        subscriptions: 0,
        unsafeWorkerMessages: 0,
      });
      await page.evaluate(() => window.__webpushFixture.worker('native'));
      await main(page)
        .getByRole('button', { name: messages.ui.retry, exact: true })
        .click();
      await inactive(page);
      await turnOn(page);
      const oldEndpoint = (await pushSnapshot(page)).endpoint;
      await page.evaluate(
        (key) => window.__webpushFixture.applicationServerKey(key),
        WEBPUSH_CI_SUBSCRIPTION.keys.p256dh,
      );
      await refresh(page).click();
      await inactive(page);
      await expect(
        main(page).getByText(copy.renewalNotice, { exact: true }),
      ).toBeVisible();
      expect(deviceSummary(world.fan)).toMatchObject({ active: 0, revoked: 1 });
      expect(await pushSnapshot(page)).toMatchObject({
        active: false,
        subscriptions: 1,
        permissionRequests: 1,
        unsubscriptions: 1,
      });
      await screenshot(page, info, `webpush-key-renewal-${scale}-${width}`);
      await expect(consent(page)).not.toBeChecked();
      await turnOn(page);
      const renewed = await pushSnapshot(page);
      expect(renewed).toMatchObject({
        active: true,
        subscriptions: 2,
        permissionRequests: 1,
        applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY,
        unsafeWorkerMessages: 0,
      });
      expect(renewed.endpoint).not.toBe(oldEndpoint);
      expect(deviceSummary(world.fan)).toMatchObject({ active: 1, revoked: 1 });
    });
    test(`${scale} ${width}: unsupported browser retains every navigation option`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page, { unsupported: true });
      await page.goto(settingsPath);
      await inactive(page);
      await expect(
        main(page).getByText(copy.unsupported, { exact: true }),
      ).toBeVisible();
      await expect(enable(page)).toBeDisabled();
      await screenshot(page, info, `webpush-unsupported-${scale}-${width}`);
      await main(page)
        .getByRole('link', { name: copy.subscriptions, exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`${routes.subscriptions}$`));
      await page.goBack();
      await inactive(page);
      await main(page)
        .getByRole('link', { name: copy.installGuide, exact: true })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${routes.notificationInstallGuide}`,
      );
      await expect(
        main(page).getByRole('heading', { name: copy.guideTitle, exact: true }),
      ).toBeFocused();
      await screenshot(page, info, `webpush-guide-${scale}-${width}`);
      await page.goBack();
      await inactive(page);
      await main(page)
        .getByRole('button', { name: copy.back, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
      expect((await pushSnapshot(page)).permissionRequests).toBe(0);
    });
    test(`${scale} ${width}: iOS browser install guidance and installed-PWA contract`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page, { ios: true, installed: false });
      await page.goto(settingsPath);
      await inactive(page);
      await expect(
        main(page).getByText(copy.iosInstall, { exact: true }),
      ).toBeVisible();
      await expect(enable(page)).toBeDisabled();
      await screenshot(page, info, `webpush-ios-install-${scale}-${width}`);
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'standalone', {
          configurable: true,
          value: true,
        }),
      );
      await refresh(page).click();
      await inactive(page);
      await expect(consent(page)).toBeEnabled();
      await screenshot(page, info, `webpush-ios-installed-${scale}-${width}`);
      expect((await pushSnapshot(page)).permissionRequests).toBe(0);
    });
    test(`${scale} ${width}: policy unavailable and switched-account settings use the actual profile scale`, async ({
      world,
      context,
      page,
    }, info) => {
      await prepare(world);
      setFont(world.fan, scale);
      setFont(world.other, scale);
      await world.fan.signIn(context);
      await page.setViewportSize({ width, height: 900 });
      await installPushManager(page);
      notificationPolicy(false);
      await page.goto(settingsPath);
      await inactive(page);
      await expect(
        main(page).getByText(copy.unconfigured, { exact: true }),
      ).toBeVisible();
      await expect(enable(page)).toBeDisabled();
      await screenshot(page, info, `webpush-unconfigured-${scale}-${width}`);
      notificationPolicy(true);
      await refresh(page).click();
      await turnOn(page);
      const previousEndpoint = (await pushSnapshot(page)).endpoint;
      await world.other.signIn(context);
      await page.goto(settingsPath);
      await inactive(page);
      expect(await pushSnapshot(page)).toMatchObject({
        active: false,
        unsubscriptions: 1,
        permissionRequests: 1,
      });
      await screenshot(page, info, `webpush-account-switch-${scale}-${width}`);
      await turnOn(page);
      expect((await pushSnapshot(page)).endpoint).not.toBe(previousEndpoint);
      expect(deviceSummary(world.other)).toMatchObject({ active: 1, jobs: 0 });
      // Account switching stops the prior native subscription, without falsely
      // claiming that another still-valid remote session was signed out.
      // Logout explicitly closes the current session's durable registrations.
      const logout = await page.request.post(routes.authLogout, {
        headers: { Origin: appOrigin },
        maxRedirects: 0,
      });
      expect(logout.status()).toBe(303);
      expect(deviceSummary(world.other).active).toBe(0);
      await page.goto(settingsPath);
      await expect(page).toHaveURL(/\/start(?:\?|$)/);
    });
  }

test('stale displayed consent never silently opts into a newly revised notice', async ({
  world,
  context,
  page,
}) => {
  await prepare(world);
  await world.fan.signIn(context);
  await installPushManager(page);
  await page.goto(settingsPath);
  await inactive(page);
  rotateNotificationConsent();
  await waitForPushWorker(page);
  await consent(page).check();
  await enable(page).click();
  await expect(main(page).getByRole('alert')).toHaveText(
    copy.errors.SETUP_NOT_READY,
  );
  expect(deviceSummary(world.fan).active).toBe(0);
  await main(page)
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await inactive(page);
  await expect(consent(page)).not.toBeChecked();
  await turnOn(page);
  expect(deviceSummary(world.fan).active).toBe(1);
});
