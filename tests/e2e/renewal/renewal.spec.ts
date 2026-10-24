import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import {
  test,
  expect,
  providerOrigin,
  prepareRenewalPolicies,
  activateRenewalPolicies,
  retirePreviousRenewalFixtures,
  installFakeBrowser,
  expectNoExternal,
  completeOnboarding,
  prepare,
  authorize,
  approve,
  screenshot,
  makeRenewalDue,
  renewalSnapshot,
  advanceRetryClock,
  advanceRecoveryClock,
  expireGraceClock,
  expirePaidClock,
  expireDispatchLease,
  useUnconfiguredRenewalPolicy,
  useNoticeRequiredPolicy,
  recordFictionalDeliveredNotice,
  rotatePolicy,
  invokeRenewals,
  type Identity,
} from './fixtures';
import {
  CHECKOUT_PROVIDERS,
  type CheckoutProvider,
} from '../../../src/config/checkout';
import { RENEWAL_CI } from '../../../src/config/enrollment-test-runtime';
import { checkoutPath, routes } from '../../../src/config/routes';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

async function calls(request: APIRequestContext) {
  return (await request.get(`${providerOrigin}/__fixture/calls`)).json();
}
async function scenario(request: APIRequestContext, value: string) {
  expect(
    (
      await request.post(`${providerOrigin}/__fixture/scenario`, {
        data: { scenario: value },
      })
    ).ok(),
  ).toBe(true);
}
async function enrolled(
  page: Page,
  context: BrowserContext,
  identity: () => Promise<Identity>,
  provider: CheckoutProvider = 'toss_card_billing',
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const actor = await identity();
  await completeOnboarding(actor, scale);
  await actor.signIn(context);
  await prepare(page, actor, provider);
  await authorize(page, provider);
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  expect(renewalSnapshot(actor).events).toHaveLength(1);
  return actor;
}
async function expectSafeCron(request: APIRequestContext) {
  const response = await invokeRenewals(request);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.data.dispatched).toBeLessThanOrEqual(1);
  expect(JSON.stringify(body)).not.toMatch(
    /ci_auth_|ci_billing_|ci_sid_|ci_pg_|ci_tid_|ci_aid_|credential|lease_token|merchant_account/,
  );
  return body.data as { dispatched: number; settled: number; unknown: number };
}
async function hasAccess(actor: Identity) {
  const client = await actor.actorClient();
  const result = await client.rpc('has_active_access', {
    p_artist_id: actor.artist.id,
  });
  expect(result.error).toBeNull();
  return result.data;
}

test.beforeAll(prepareRenewalPolicies);
test.beforeEach(async ({ context, request }) => {
  retirePreviousRenewalFixtures();
  activateRenewalPolicies();
  expect((await request.post(`${providerOrigin}/__fixture/reset`)).ok()).toBe(
    true,
  );
  await installFakeBrowser(context);
});
test.afterEach(async ({ context, request }) => {
  // Release an explicit barrier even after an assertion failure; no fixed sleep.
  await request.post(`${providerOrigin}/__fixture/release`);
  expectNoExternal(context);
});

test('Cron rejects missing/wrong credentials and caller-controlled dates before I/O', async ({
  request,
}) => {
  for (const authorization of [
    undefined,
    'Bearer wrong-secret',
    `bearer ${RENEWAL_CI.cronSecret}`,
  ]) {
    const response = await request.post(routes.chargeRenewals, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    expect(response.status()).toBe(401);
  }
  for (const method of ['GET', 'POST'] as const) {
    const response = await request.fetch(
      `${routes.chargeRenewals}?now=2099-01-01`,
      {
        method,
        headers: { Authorization: `Bearer ${RENEWAL_CI.cronSecret}` },
      },
    );
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await request.post(routes.chargeRenewals, {
        headers: { Authorization: `Bearer ${RENEWAL_CI.cronSecret}` },
        data: { now: '2099-01-01' },
      })
    ).status(),
  ).toBe(400);
  expect((await calls(request)).charges).toEqual({ toss: 0, kakao: 0 });
});

for (const provider of CHECKOUT_PROVIDERS)
  for (const scale of ['normal', 'large', 'xlarge'] as const)
    test(`${provider} renewal at ${scale} uses regular price once and preserves paid access`, async ({
      page,
      context,
      identity,
      request,
    }, info) => {
      await page.setViewportSize({
        width: scale === 'normal' ? 1280 : 390,
        height: 844,
      });
      const actor = await enrolled(page, context, identity, provider, scale);
      const initial = renewalSnapshot(actor).events[0]!;
      expect((await expectSafeCron(request)).dispatched).toBe(0);
      const due = makeRenewalDue(actor);
      const result = await expectSafeCron(request);
      expect(result.settled).toBe(1);
      const renewed = renewalSnapshot(actor);
      expect(renewed.events).toHaveLength(2);
      expect(renewed.events[0]).toEqual(initial);
      expect(renewed.events[1]!.amount).toBe(6500);
      expect(renewed.subscription.status).toBe('active');
      expect(renewed.subscription.introUsed).toBe(true);
      expect(renewed.subscription.episode).toBe(due.subscription.episode);
      expect(renewed.subscription.periodStart).toBe(due.subscription.periodEnd);
      expect(renewed.subscription.nextBilling).toBe(
        renewed.subscription.periodEnd,
      );
      expect(renewed.obligations).toHaveLength(1);
      expect(renewed.obligations[0]).toMatchObject({
        amount: 6500,
        intro: false,
        state: 'settled',
        retrySeconds: 86400,
        graceSeconds: 259200,
        maxRetries: 3,
      });
      expect(await hasAccess(actor)).toBe(true);
      await expectSafeCron(request);
      const observed = await calls(request);
      expect(observed.charges).toEqual({
        toss: provider === 'toss_card_billing' ? 2 : 0,
        kakao: provider === 'kakaopay_subscription' ? 2 : 0,
      });
      expect(observed.requests.kakaoSubscription).toBe(
        provider === 'kakaopay_subscription' ? 1 : 0,
      );
      // The browser receives only the ordinary duplicate-subscription error,
      // never a private renewal descriptor or a falsely successful new checkout.
      await page.goto(checkoutPath(actor.artist.slug));
      await page
        .getByRole('checkbox', { name: messages.checkout.consent, exact: true })
        .check();
      await page
        .getByRole('button', { name: messages.checkout.prepare, exact: true })
        .click();
      await expect(
        page.getByText(messages.checkout.errors.SUBSCRIPTION_EXISTS, {
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `renewal-duplicate-guard-${provider}-${scale}`,
      );
    });

test('Toss failure waits 24 hours, makes at most three retries and never resets three-day grace', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'reject');
  await expectSafeCron(request);
  const first = renewalSnapshot(actor);
  expect(first.subscription.status).toBe('grace');
  expect(
    Date.parse(first.subscription.graceEnd!) -
      Date.parse(first.subscription.graceStart!),
  ).toBe(259200000);
  expect(first.obligations[0]!.retrySeconds).toBe(86400);
  expect(
    Date.parse(first.obligations[0]!.nextAttempt) - Date.now(),
  ).toBeGreaterThan(86300000);
  expect(await hasAccess(actor)).toBe(true);
  await expectSafeCron(request);
  expect((await calls(request)).requests.tossCharge).toBe(2);
  for (let retry = 1; retry <= 3; retry += 1) {
    advanceRetryClock(actor);
    await expectSafeCron(request);
    const current = renewalSnapshot(actor);
    expect(current.attempts).toHaveLength(retry + 1);
    expect(current.subscription.graceStart).toBe(first.subscription.graceStart);
    expect(current.subscription.graceEnd).toBe(first.subscription.graceEnd);
    expect(current.events).toHaveLength(1);
  }
  advanceRetryClock(actor);
  await expectSafeCron(request);
  expect((await calls(request)).requests.tossCharge).toBe(5);
  expect(renewalSnapshot(actor).subscription.nextBilling).toBeNull();
  expireGraceClock(actor);
  expect(await hasAccess(actor)).toBe(false);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).subscription.status).toBe('expired');
  expect((await calls(request)).charges.toss).toBe(1);
});

test('Kakao customer-action refusal grants bounded grace but never automatic retry', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(
    page,
    context,
    identity,
    'kakaopay_subscription',
  );
  makeRenewalDue(actor);
  await scenario(request, 'reject');
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).subscription.status).toBe('grace');
  expect(renewalSnapshot(actor).subscription.nextBilling).toBeNull();
  advanceRetryClock(actor);
  await expectSafeCron(request);
  expect((await calls(request)).requests.kakaoSubscription).toBe(1);
  expect(renewalSnapshot(actor).events).toHaveLength(1);
  expireGraceClock(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).subscription.status).toBe('expired');
});

test('lost Toss charge response is recovered only by the same order query', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'charge-response-lost');
  await expectSafeCron(request);
  const unknown = renewalSnapshot(actor);
  expect(unknown.events).toHaveLength(1);
  expect(unknown.attempts[0]!.state).toBe('unknown');
  await expectSafeCron(request);
  expect((await calls(request)).requests.tossQuery).toBe(0);
  advanceRecoveryClock(actor);
  expect((await expectSafeCron(request)).settled).toBe(1);
  const recovered = renewalSnapshot(actor);
  expect(recovered.events).toHaveLength(2);
  expect(recovered.attempts[0]!.id).toBe(unknown.attempts[0]!.id);
  expect(recovered.attempts[0]!.state).toBe('success');
  const observed = await calls(request);
  expect(observed.requests.tossQuery).toBe(1);
  expect(observed.requests.tossCharge).toBe(2);
  expect(observed.charges.toss).toBe(2);
});

test('lost Kakao renewal TID remains unresolved and never queries SID or recharges', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(
    page,
    context,
    identity,
    'kakaopay_subscription',
  );
  makeRenewalDue(actor);
  await scenario(request, 'subscription-response-lost');
  await expectSafeCron(request);
  const unknown = renewalSnapshot(actor);
  expect(unknown.events).toHaveLength(1);
  expect(unknown.attempts[0]!.state).toBe('unknown');
  expect(unknown.recovery[0]!.paymentKnown).toBe(false);
  advanceRetryClock(actor);
  advanceRecoveryClock(actor);
  await expectSafeCron(request);
  await expectSafeCron(request);
  const observed = await calls(request);
  expect(observed.requests.kakaoSubscription).toBe(1);
  expect(observed.requests.kakaoQuery).toBe(0);
  expect(observed.charges.kakao).toBe(2);
  expect(renewalSnapshot(actor).events).toHaveLength(1);
  expireGraceClock(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).subscription.status).toBe('expired');
  expect(renewalSnapshot(actor).attempts[0]!.state).toBe('unknown');
});

test('Toss unknown query has finite three-call budget and no not-found-to-retry inference', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'charge-response-lost');
  await expectSafeCron(request);
  await scenario(request, 'query-unavailable');
  for (let query = 0; query < 3; query += 1) {
    advanceRecoveryClock(actor);
    await expectSafeCron(request);
  }
  advanceRecoveryClock(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).recovery[0]!.queries).toBe(3);
  expect(renewalSnapshot(actor).attempts[0]!.state).toBe('unknown');
  expect(renewalSnapshot(actor).events).toHaveLength(1);
  expect((await calls(request)).requests.tossQuery).toBe(3);
  expect((await calls(request)).requests.tossCharge).toBe(2);
});

test('overlapping Cron invocations share one atomic dispatch while a response is held', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'hold-charge');
  const pending = invokeRenewals(request);
  await expect
    .poll(async () => (await calls(request)).requests.tossCharge)
    .toBe(2);
  expect(renewalSnapshot(actor).attempts[0]!.state).toBe('inflight');
  expect((await expectSafeCron(request)).dispatched).toBe(0);
  expect((await calls(request)).requests.tossCharge).toBe(2);
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await pending).status()).toBe(200);
  expect(renewalSnapshot(actor).events).toHaveLength(2);
  expect(renewalSnapshot(actor).attempts).toHaveLength(1);
});

test('expired dispatch lease becomes unknown without acquiring a second charge', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'hold-charge');
  const pending = invokeRenewals(request);
  await expect
    .poll(async () => (await calls(request)).requests.tossCharge)
    .toBe(2);
  expireDispatchLease(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).attempts[0]!.state).toBe('unknown');
  expect((await calls(request)).requests.tossCharge).toBe(2);
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await pending).status()).toBe(200);
  expect(renewalSnapshot(actor).events).toHaveLength(2);
  expect(renewalSnapshot(actor).attempts).toHaveLength(1);
});

test('cancel after Kakao dispatch records verified money once but never resumes future billing', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(
    page,
    context,
    identity,
    'kakaopay_subscription',
  );
  makeRenewalDue(actor);
  await scenario(request, 'hold-charge');
  const pending = invokeRenewals(request);
  await expect
    .poll(async () => (await calls(request)).requests.kakaoSubscription)
    .toBe(1);
  const client = await actor.actorClient();
  expect(
    (
      await client.rpc('cancel_subscription', {
        p_subscription_id: renewalSnapshot(actor).subscription.id,
      })
    ).error,
  ).toBeNull();
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await pending).status()).toBe(200);
  const canceled = renewalSnapshot(actor);
  expect(canceled.events).toHaveLength(2);
  expect(canceled.subscription.status).toBe('canceled');
  expect(canceled.subscription.nextBilling).toBeNull();
  expect(await hasAccess(actor)).toBe(true);
  await expectSafeCron(request);
  expect((await calls(request)).requests.kakaoSubscription).toBe(1);
});

test('canceled paid access remains until its exclusive boundary and Cron never dispatches', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const client = await actor.actorClient();
  expect(
    (
      await client.rpc('cancel_subscription', {
        p_subscription_id: renewalSnapshot(actor).subscription.id,
      })
    ).error,
  ).toBeNull();
  expect(await hasAccess(actor)).toBe(true);
  await expectSafeCron(request);
  expect((await calls(request)).requests.tossCharge).toBe(1);
  expirePaidClock(actor);
  expect(await hasAccess(actor)).toBe(false);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).subscription.status).toBe('expired');
  expect((await calls(request)).requests.tossCharge).toBe(1);
});

test('missing approved renewal policy does not adopt draft source defaults', async ({
  page,
  context,
  identity,
  request,
}) => {
  useUnconfiguredRenewalPolicy();
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).attempts).toHaveLength(0);
  expect((await calls(request)).requests.tossCharge).toBe(1);
});

test('a changed current accepted-terms version blocks new renewal dispatch', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  rotatePolicy();
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).attempts).toHaveLength(0);
  expect((await calls(request)).requests.tossCharge).toBe(1);
});

test('mandatory advance notice is a verified delivery gate, not a queued-notice assumption', async ({
  page,
  context,
  identity,
  request,
}) => {
  const policy = useNoticeRequiredPolicy();
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await expectSafeCron(request);
  expect(renewalSnapshot(actor).attempts).toHaveLength(0);
  expect((await calls(request)).requests.tossCharge).toBe(1);
  // This is explicitly fictional evidence, not a delivered real notification.
  recordFictionalDeliveredNotice(actor, policy);
  expect((await expectSafeCron(request)).settled).toBe(1);
  expect(renewalSnapshot(actor).events).toHaveLength(2);
});

test('successful retry settles the original unpaid period, not a second future month', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'reject');
  await expectSafeCron(request);
  const failed = renewalSnapshot(actor);
  const obligation = failed.obligations[0]!;
  advanceRetryClock(actor);
  await scenario(request, 'success');
  expect((await expectSafeCron(request)).settled).toBe(1);
  const recovered = renewalSnapshot(actor);
  expect(recovered.events).toHaveLength(2);
  expect(recovered.events[1]).toMatchObject({
    amount: 6500,
    start: obligation.start,
    end: obligation.end,
  });
  expect(recovered.obligations).toHaveLength(1);
  expect(recovered.obligations[0]!.id).toBe(obligation.id);
  expect(recovered.attempts.map((value) => value.state)).toEqual([
    'failed',
    'success',
  ]);
  expect(recovered.subscription.periodStart).toBe(obligation.start);
  expect(recovered.subscription.periodEnd).toBe(obligation.end);
  expect(recovered.subscription.graceEnd).toBeNull();
  expect(recovered.subscription.nextBilling).toBe(obligation.end);
  expect(recovered.subscription.introUsed).toBe(true);
  await expectSafeCron(request);
  expect((await calls(request)).requests.tossCharge).toBe(3);
  expect((await calls(request)).charges.toss).toBe(2);
});
