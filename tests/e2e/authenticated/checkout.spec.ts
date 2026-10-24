import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect, appOrigin, type Identity } from './fixtures';
import {
  disableFictionalPolicy,
  enableFictionalPolicy,
  onboardingFixtures,
  prepareFictionalDocuments,
} from './onboarding-fixtures';
import {
  checkoutFixtures,
  clearFictionalCheckout,
  disableFictionalCheckoutPolicy,
  enableFictionalCheckout,
  expireFictionalCheckout,
  prepareFictionalCheckoutPolicies,
  rotateFictionalCheckoutPolicy,
  storedFictionalCheckout,
} from './checkout-fixtures';
import {
  CHECKOUT_NONCE_COOKIE,
  CHECKOUT_PROVIDERS,
  type CheckoutProvider,
} from '../../../src/config/checkout';
import {
  artistPreviewPath,
  checkoutPath,
  routes,
} from '../../../src/config/routes';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const copy = messages.checkout;
const artist = checkoutFixtures.artist;
const externalRequests = new WeakMap<BrowserContext, number>();

async function blockExternal(context: BrowserContext) {
  externalRequests.set(context, 0);
  await context.route(/^https?:\/\//, (route) => {
    if (new URL(route.request().url()).origin === appOrigin)
      return route.continue();
    externalRequests.set(context, (externalRequests.get(context) ?? 0) + 1);
    return route.abort('blockedbyclient');
  });
}

async function completeOnboarding(
  actor: Identity,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const client = await actor.actorClient();
  expect(
    (await client.rpc('onboarding_save_font', { p_font_scale: scale })).error,
  ).toBeNull();
  expect(
    (await client.rpc('onboarding_save_name', { p_call_name: '허구팬' })).error,
  ).toBeNull();
  expect(
    (
      await client.rpc('onboarding_complete_profile', {
        p_age_over_14: true,
        p_terms_accepted: true,
        p_terms_version: onboardingFixtures.terms,
        p_privacy_accepted: true,
        p_privacy_version: onboardingFixtures.privacy,
        p_analytics_granted: false,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await client.rpc('discovery_select_artist', {
        p_artist_slug: artist.slug,
      })
    ).error,
  ).toBeNull();
  expect(
    (
      await client.rpc('onboarding_acknowledge_install', {
        p_choice: 'skipped',
      })
    ).error,
  ).toBeNull();
  expect((await client.rpc('onboarding_complete')).error).toBeNull();
}

function input(provider: CheckoutProvider = 'toss_card_billing') {
  return {
    artistSlug: artist.slug,
    provider,
    policyVersion: checkoutFixtures.policy,
    accepted: true,
    idempotencyKey: randomUUID(),
  };
}

async function choose(
  page: Page,
  provider: CheckoutProvider = 'toss_card_billing',
) {
  await page
    .getByRole('radio', { name: new RegExp(copy.providers[provider]) })
    .check();
  await page.getByRole('checkbox', { name: copy.consent, exact: true }).check();
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}

function noMoney(actor: Identity) {
  const stored = storedFictionalCheckout(actor.id);
  expect(stored.subscriptions).toBe(0);
  expect(stored.payments).toBe(0);
  return stored;
}

test.beforeAll(() => {
  prepareFictionalDocuments();
  prepareFictionalCheckoutPolicies();
});
test.beforeEach(async ({ context }) => {
  enableFictionalPolicy();
  enableFictionalCheckout();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => {
  try {
    clearFictionalCheckout();
  } finally {
    disableFictionalPolicy();
  }
  expect(externalRequests.get(context)).toBe(0);
});

for (const provider of CHECKOUT_PROVIDERS) {
  for (const scale of ['normal', 'large', 'xlarge'] as const) {
    test(`real local ${provider} pending intent and cancel at ${scale} (no provider call)`, async ({
      page,
      context,
      identity,
    }, info) => {
      const actor = await identity({
        onboarding_completed_at: null,
        call_name: null,
      });
      await completeOnboarding(actor, scale);
      await actor.signIn(context);
      await page.setViewportSize({ width: 360, height: 896 });
      await page.goto(checkoutPath(artist.slug));
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(
        page.getByRole('heading', {
          name: copy.title.replace('{name}', artist.name),
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          name: checkoutFixtures.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText('매월 구독료 6,500원', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/첫 구독 적용 가격 1,000원/)).toBeVisible();
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      await expect(
        page.getByRole('button', { name: copy.prepare, exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', {
          name: copy.completionUnavailable,
          exact: true,
        }),
      ).toBeDisabled();
      expect(noMoney(actor).sessions).toHaveLength(0);
      await screenshot(page, info, `checkout-terms-${provider}-${scale}`);
      await choose(page, provider);
      const prepare = page.getByRole('button', {
        name: copy.prepare,
        exact: true,
      });
      const box = await prepare.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      await prepare.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('main').getByRole('status')).toHaveText(
        copy.intentStatuses.pending_intent,
      );
      await expect(
        page.getByText(copy.intentNotPayment, { exact: true }),
      ).toBeVisible();
      const pending = noMoney(actor);
      expect(pending.sessions).toHaveLength(1);
      expect(pending.sessions[0]!.status).toBe('pending_intent');
      const cookie = (
        await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)
      ).find((value) => value.name === CHECKOUT_NONCE_COOKIE);
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: 'Strict',
        path: routes.checkoutSubmit,
      });
      expect(await page.evaluate(() => document.cookie)).not.toContain(
        CHECKOUT_NONCE_COOKIE,
      );
      expect(await page.locator('body').innerText()).not.toContain(
        'test_sk_checkout_ci_fixture',
      );
      await screenshot(page, info, `checkout-pending-${provider}-${scale}`);
      await page
        .getByRole('button', { name: copy.cancelIntent, exact: true })
        .click();
      await expect(page.getByRole('main').getByRole('status')).toHaveText(
        copy.intentStatuses.canceled,
      );
      expect(noMoney(actor).sessions[0]!.status).toBe('canceled');
      expect(
        (await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)).some(
          (value) => value.name === CHECKOUT_NONCE_COOKIE,
        ),
      ).toBe(false);
      await screenshot(page, info, `checkout-canceled-${provider}-${scale}`);
      const client = await actor.actorClient();
      expect(
        (await client.rpc('has_active_access', { p_artist_id: artist.id }))
          .data,
      ).toBe(false);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}

test('absent approved price/terms fails closed without a fallback consent form', async ({
  page,
  context,
  identity,
}, info) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor, 'xlarge');
  await actor.signIn(context);
  disableFictionalCheckoutPolicy();
  await page.setViewportSize({ width: 360, height: 896 });
  await page.goto(checkoutPath(artist.slug));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.SETUP_NOT_READY,
  );
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText(/6,500원/)).toHaveCount(0);
  const result = await context.request.post(routes.checkoutSubmit, {
    headers: { Origin: appOrigin },
    data: input(),
  });
  expect(result.status()).toBe(503);
  expect(await result.json()).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
  expect(noMoney(actor).sessions).toHaveLength(0);
  await screenshot(page, info, 'checkout-missing-policy-xlarge');
});

test('stale displayed terms cannot create intent after policy rotation', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor);
  await actor.signIn(context);
  await page.goto(checkoutPath(artist.slug));
  await choose(page);
  rotateFictionalCheckoutPolicy();
  await page.getByRole('button', { name: copy.prepare, exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.POLICY_CHANGED,
  );
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: copy.prepare, exact: true }),
  ).toBeDisabled();
  expect(noMoney(actor).sessions).toHaveLength(0);
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(
    page.getByText('매월 구독료 7,000원', { exact: true }),
  ).toBeVisible();
  expect(noMoney(actor).sessions).toHaveLength(0);
});

test('parallel first requests create one intent and original-cookie replay preserves its identity', async ({
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor);
  await actor.signIn(context);
  const body = input();
  const responses = await Promise.all(
    [0, 1, 2].map(() =>
      context.request.post(routes.checkoutSubmit, {
        headers: { Origin: appOrigin },
        data: body,
      }),
    ),
  );
  // The shared API transport may install the winning Set-Cookie before a
  // queued request is dispatched. Such a request is a valid same-nonce replay,
  // not another session. The dedicated PostgreSQL suite proves lock contention.
  expect(responses.every((value) => [200, 409].includes(value.status()))).toBe(
    true,
  );
  const successful = responses.filter((value) => value.status() === 200);
  expect(successful.length).toBeGreaterThanOrEqual(1);
  const first = successful[0]!;
  const saved = await first.json();
  for (const response of successful)
    expect(await response.json()).toEqual(saved);
  for (const response of responses.filter((value) => value.status() === 409))
    expect(await response.json()).toEqual({
      ok: false,
      code: 'CHECKOUT_EXISTS',
    });
  expect(Object.keys(saved.data).sort()).toEqual([
    'expiresAt',
    'id',
    'initialPriceKrw',
    'introEligible',
    'provider',
    'regularPriceKrw',
    'status',
  ]);
  expect(first.headers()['cache-control']).toContain('no-store');
  expect(first.headers()['referrer-policy']).toBe('no-referrer');
  expect(noMoney(actor).sessions).toHaveLength(1);
  const winnerNonce = (
    await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)
  ).find((value) => value.name === CHECKOUT_NONCE_COOKIE);
  expect(winnerNonce).toBeDefined();
  expect(JSON.parse(decodeURIComponent(winnerNonce!.value)).sessionId).toBe(
    saved.data.id,
  );
  await context.addCookies([winnerNonce!]);
  const replay = await context.request.post(routes.checkoutSubmit, {
    headers: { Origin: appOrigin },
    data: body,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(saved);
  expect(noMoney(actor).sessions).toHaveLength(1);
});

test('cross-origin, anonymous and authority-bearing input cannot create intents', async ({
  context,
  request,
  identity,
}) => {
  const body = input();
  const anonymous = await request.post(routes.checkoutSubmit, {
    headers: { Origin: appOrigin },
    data: body,
  });
  expect(anonymous.status()).toBe(401);
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor);
  await actor.signIn(context);
  for (const origin of [undefined, 'null', 'https://untrusted.example']) {
    const result = await context.request.post(routes.checkoutSubmit, {
      headers: origin ? { Origin: origin } : {},
      data: body,
    });
    expect(result.status()).toBe(403);
  }
  for (const invalid of [
    { ...body, userId: actor.id },
    { ...body, amount: 1 },
    { ...body, returnUrl: 'https://untrusted.example' },
    { ...body, accepted: false },
  ]) {
    const result = await context.request.post(routes.checkoutSubmit, {
      headers: { Origin: appOrigin },
      data: invalid,
    });
    expect(result.status()).toBe(400);
  }
  for (const path of [routes.checkoutSubmit, routes.checkoutCancel])
    expect((await context.request.get(path)).status()).toBe(405);
  expect(noMoney(actor).sessions).toHaveLength(0);
});

test('wrong user, nonce tampering, expiry and replay cannot consume another pending intent', async ({
  context,
  browser,
  identity,
}) => {
  const owner = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  const other = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(owner);
  await completeOnboarding(other);
  await owner.signIn(context);
  const prepared = await context.request.post(routes.checkoutSubmit, {
    headers: { Origin: appOrigin },
    data: input(),
  });
  expect(prepared.status()).toBe(200);
  const saved = await prepared.json();
  const nonce = (
    await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)
  ).find((value) => value.name === CHECKOUT_NONCE_COOKIE)!;
  const otherContext = await browser.newContext({ baseURL: appOrigin });
  await blockExternal(otherContext);
  try {
    await other.signIn(otherContext);
    // Possessing a copied opaque cookie still cannot change the verified actor.
    await otherContext.addCookies([nonce]);
    const forbidden = await otherContext.request.post(routes.checkoutCancel, {
      headers: { Origin: appOrigin },
      data: { sessionId: saved.data.id },
    });
    expect(forbidden.status()).toBe(403);
    // A forged cookie actor field also cannot substitute for SQL ownership.
    await otherContext.addCookies([
      {
        ...nonce,
        value: encodeURIComponent(
          JSON.stringify({
            ...JSON.parse(decodeURIComponent(nonce.value)),
            actorId: other.id,
          }),
        ),
      },
    ]);
    const forgedActor = await otherContext.request.post(routes.checkoutCancel, {
      headers: { Origin: appOrigin },
      data: { sessionId: saved.data.id },
    });
    expect(forgedActor.status()).toBe(404);
    expect(await forgedActor.json()).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(noMoney(owner).sessions[0]!.status).toBe('pending_intent');
  } finally {
    expect(externalRequests.get(otherContext)).toBe(0);
    await otherContext.close();
  }
  // Browser cookie APIs return the percent-encoded HTTP wire value.
  expect(nonce.value.startsWith('%7B')).toBe(true);
  const value = JSON.parse(decodeURIComponent(nonce.value));
  await context.addCookies([
    {
      ...nonce,
      value: encodeURIComponent(
        JSON.stringify({ ...value, nonce: 'A'.repeat(43) }),
      ),
    },
  ]);
  const tampered = await context.request.post(routes.checkoutCancel, {
    headers: { Origin: appOrigin },
    data: { sessionId: saved.data.id },
  });
  expect(tampered.status()).toBe(403);
  await context.addCookies([nonce]);
  const canceled = await context.request.post(routes.checkoutCancel, {
    headers: { Origin: appOrigin },
    data: { sessionId: saved.data.id },
  });
  expect(canceled.status()).toBe(200);
  await context.addCookies([nonce]);
  const replay = await context.request.post(routes.checkoutCancel, {
    headers: { Origin: appOrigin },
    data: { sessionId: saved.data.id },
  });
  expect(replay.status()).toBe(409);
  expect(await replay.json()).toEqual({ ok: false, code: 'SESSION_CONSUMED' });
  const next = await context.request.post(routes.checkoutSubmit, {
    headers: { Origin: appOrigin },
    data: input(),
  });
  expect(next.status()).toBe(200);
  expireFictionalCheckout(owner.id);
  const nextBody = await next.json();
  const expired = await context.request.post(routes.checkoutCancel, {
    headers: { Origin: appOrigin },
    data: { sessionId: nextBody.data.id },
  });
  expect(expired.status()).toBe(409);
  expect(await expired.json()).toEqual({ ok: false, code: 'SESSION_EXPIRED' });
  expect(noMoney(owner).sessions).toHaveLength(2);
});

test('lost committed response remains uncertain and refresh does not dispatch another write', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor);
  await actor.signIn(context);
  await page.goto(checkoutPath(artist.slug));
  let writes = 0;
  await page.route(`**${routes.checkoutSubmit}`, async (route) => {
    writes += 1;
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await choose(page);
  await page.getByRole('button', { name: copy.prepare, exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.UNAVAILABLE,
  );
  await expect(
    page.getByRole('button', { name: copy.prepare, exact: true }),
  ).toBeDisabled();
  expect(noMoney(actor).sessions).toHaveLength(1);
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  expect(writes).toBe(1);
  expect(noMoney(actor).sessions).toHaveLength(1);
});

test('Back wins over a delayed committed response and callbacks only strip query values', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await completeOnboarding(actor);
  await actor.signIn(context);
  await page.goto(checkoutPath(artist.slug));
  let release: () => void = () => {};
  let committed = false;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${routes.checkoutSubmit}`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    expect(response.status()).toBe(200);
    committed = true;
    await barrier;
    await route.fulfill({ response }).catch(() => {});
  });
  await choose(page);
  await page.getByRole('button', { name: copy.prepare, exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${artistPreviewPath(artist.slug)}`);
  release();
  await expect(page).toHaveURL(`${appOrigin}${artistPreviewPath(artist.slug)}`);
  expect(noMoney(actor).sessions).toHaveLength(1);
  const before = noMoney(actor);
  for (const query of [
    '?authKey=fictional_private_token&customerKey=fictional_customer&next=https://untrusted.example',
    '?pg_token=fictional_private_token&state=forged',
    '?error=fictional_provider_message',
  ]) {
    const response = await context.request.get(
      `${routes.checkoutReturn}${query}`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(`${appOrigin}${routes.checkout}`);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    expect(await response.text()).not.toContain('fictional_private_token');
  }
  expect(noMoney(actor)).toEqual(before);
});
