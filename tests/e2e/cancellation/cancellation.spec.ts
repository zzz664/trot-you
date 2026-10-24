import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  appOrigin,
  providerOrigin,
  prepareCancellationPolicies,
  activateCancellationPolicies,
  retirePreviousRenewalFixtures,
  installFakeBrowser,
  expectNoExternal,
  completeOnboarding,
  prepare,
  authorize,
  approve,
  screenshot,
  cancellationSnapshot,
  setActorRole,
  restrictActor,
  removeRefundPolicy,
  refundFixturePolicy,
  advanceRefundRecoveryClock,
  makeRenewalDue,
  invokeRenewals,
  hasPaidAccess,
  type Identity,
} from './fixtures';
import {
  CHECKOUT_PROVIDERS,
  type CheckoutProvider,
} from '../../../src/config/checkout';
import {
  routes,
  subscriptionPath,
  adminRefundPath,
} from '../../../src/config/routes';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const requestReason = '격리 CI 허구 환불 검토 요청입니다.';
const approvalReason = '허구 CI 정책과 결제 내역을 검토한 테스트 승인입니다.';
const amountCopy = (copy: string, amount = 1000) =>
  copy.replace('{amount}', amount.toLocaleString('ko-KR'));
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
  expect(cancellationSnapshot(actor).events).toHaveLength(1);
  return actor;
}
async function admin(
  identity: () => Promise<Identity>,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const actor = await identity();
  await completeOnboarding(actor, scale);
  setActorRole(actor, 'admin');
  return actor;
}
async function openSubscription(page: Page, actor: Identity) {
  await page.goto(
    subscriptionPath(cancellationSnapshot(actor).subscription.id),
  );
  await expect(
    page.getByRole('heading', {
      name: messages.subscriptions.detailTitle.replace(
        '{name}',
        actor.artist.name,
      ),
      exact: true,
    }),
  ).toBeVisible();
}
async function cancelSubscription(page: Page) {
  await page
    .getByRole('button', { name: messages.subscriptions.cancel, exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: messages.subscriptions.cancelConfirmTitle,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', {
      name: messages.subscriptions.cancelConfirm,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(messages.subscriptions.statuses.canceled, { exact: true }),
  ).toBeVisible();
}
async function requestRefund(page: Page, actor: Identity, amount = 1000) {
  await page
    .getByRole('button', {
      name: messages.subscriptions.chooseCharge,
      exact: true,
    })
    .first()
    .click();
  await page
    .getByLabel(messages.subscriptions.amountLabel, { exact: true })
    .fill(String(amount));
  await page
    .getByLabel(messages.subscriptions.reasonLabel, { exact: true })
    .fill(requestReason);
  await page
    .getByRole('button', { name: messages.subscriptions.request, exact: true })
    .click();
  await expect(
    page.getByText(messages.refunds.statuses.requested, { exact: true }),
  ).toBeVisible();
  const row = cancellationSnapshot(actor).requests.at(-1)!;
  expect(row).toMatchObject({ state: 'requested', amount });
  return row.id;
}
async function authorizeRefund(page: Page, requestId: string, amount = 1000) {
  await page.goto(adminRefundPath(requestId));
  const button = page.getByRole('button', {
    name: amountCopy(messages.refunds.authorize, amount),
    exact: true,
  });
  await expect(button).toBeDisabled();
  await page
    .getByLabel(messages.refunds.approvalReasonLabel, { exact: true })
    .fill(approvalReason);
  await page
    .getByRole('checkbox', {
      name: amountCopy(messages.refunds.authorizeConsent, amount),
      exact: true,
    })
    .check();
  await button.click();
  await expect(
    page.getByText(messages.refunds.statuses.authorized, { exact: true }),
  ).toBeVisible();
}
async function executeRefund(page: Page, amount = 1000) {
  await page
    .getByRole('button', {
      name: amountCopy(messages.refunds.execute, amount),
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog', {
    name: messages.refunds.executeConfirmTitle,
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', {
      name: amountCopy(messages.refunds.executeConfirm, amount),
      exact: true,
    })
    .click();
}
async function actorPost(page: Page, path: string, body: unknown) {
  const response = await page.request.post(path, {
    headers: { Origin: appOrigin },
    data: body,
  });
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.text()).not.toMatch(
    /ci_auth_|ci_billing_|ci_sid_|ci_pg_|ci_tid_|ci_cancel_|credential|lease_token|merchant_account|provider_payment_id/,
  );
  return response;
}

test.beforeAll(prepareCancellationPolicies);
test.beforeEach(async ({ context, request }) => {
  retirePreviousRenewalFixtures();
  activateCancellationPolicies();
  expect((await request.post(`${providerOrigin}/__fixture/reset`)).ok()).toBe(
    true,
  );
  await installFakeBrowser(context);
});
test.afterEach(async ({ context, request }) => {
  await request.post(`${providerOrigin}/__fixture/release`);
  expectNoExternal(context);
});

for (const provider of CHECKOUT_PROVIDERS)
  for (const scale of ['normal', 'large', 'xlarge'] as const)
    test(`${provider} cancellation and separately authorized refund at ${scale}`, async ({
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
      const operator = await admin(identity, scale);
      const before = cancellationSnapshot(actor);
      await openSubscription(page, actor);
      await cancelSubscription(page);
      const canceled = cancellationSnapshot(actor);
      expect(canceled.subscription).toMatchObject({
        status: 'canceled',
        periodEnd: before.subscription.periodEnd,
        nextBilling: null,
      });
      expect(canceled.events).toEqual(before.events);
      expect(await hasPaidAccess(actor)).toBe(true);
      expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
      await screenshot(page, info, `canceled-paid-access-${provider}-${scale}`);
      const requestId = await requestRefund(page, actor);
      await operator.signIn(context);
      await authorizeRefund(page, requestId);
      expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
      await screenshot(
        page,
        info,
        `refund-authorized-not-executed-${provider}-${scale}`,
      );
      await executeRefund(page);
      await expect(
        page.getByText(messages.refunds.statuses.succeeded, { exact: true }),
      ).toBeVisible();
      const completed = cancellationSnapshot(actor);
      expect(completed.events).toHaveLength(2);
      expect(completed.events[0]).toEqual(before.events[0]);
      expect(completed.events[1]).toMatchObject({
        kind: 'refund',
        amount: -1000,
        original: before.events[0]!.id,
      });
      expect(completed.subscription).toEqual(canceled.subscription);
      expect(completed.decisions).toBe(1);
      expect(await hasPaidAccess(actor)).toBe(true);
      await screenshot(page, info, `refund-confirmed-${provider}-${scale}`);
      const observed = await calls(request);
      expect(observed.refunds).toEqual({
        toss: provider === 'toss_card_billing' ? 1 : 0,
        kakao: provider === 'kakaopay_subscription' ? 1 : 0,
      });
      // Repeated execute is a harmless state read, never a second refund.
      await actorPost(page, routes.refundExecute, { requestId });
      expect((await calls(request)).refunds).toEqual(observed.refunds);
      expect(cancellationSnapshot(actor).events).toEqual(completed.events);
    });

for (const provider of CHECKOUT_PROVIDERS)
  test(`${provider} lost refund response remains unknown until exact query; no redispatch`, async ({
    page,
    context,
    identity,
    request,
  }) => {
    const actor = await enrolled(page, context, identity, provider);
    const operator = await admin(identity);
    await openSubscription(page, actor);
    const requestId = await requestRefund(page, actor, 400);
    await operator.signIn(context);
    await authorizeRefund(page, requestId, 400);
    await scenario(request, 'refund-response-lost');
    await executeRefund(page, 400);
    await expect(
      page.getByText(messages.refunds.statuses.unknown, { exact: true }),
    ).toBeVisible();
    const uncertain = cancellationSnapshot(actor);
    expect(uncertain.requests[0]!.state).toBe('unknown');
    expect(uncertain.events).toHaveLength(1);
    expect(uncertain.subscription.status).toBe('active');
    await actorPost(page, routes.refundExecute, { requestId });
    const before = await calls(request);
    expect(before.refunds).toEqual({
      toss: provider === 'toss_card_billing' ? 1 : 0,
      kakao: provider === 'kakaopay_subscription' ? 1 : 0,
    });
    advanceRefundRecoveryClock(actor);
    await page
      .getByRole('button', { name: messages.refunds.refresh, exact: true })
      .click();
    await page
      .getByRole('button', { name: messages.refunds.reconcile, exact: true })
      .click();
    await expect(
      page.getByText(messages.refunds.statuses.succeeded, { exact: true }),
    ).toBeVisible();
    const after = cancellationSnapshot(actor);
    expect(after.events).toHaveLength(2);
    expect(after.events[1]).toMatchObject({ kind: 'refund', amount: -400 });
    expect(after.requests[0]!.queries).toBe(1);
    expect(after.subscription).toEqual(uncertain.subscription);
    expect((await calls(request)).refunds).toEqual(before.refunds);
  });

test('missing approved refund policy keeps requests pending without blocking future-renewal cancellation', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const operator = await admin(identity);
  removeRefundPolicy();
  await openSubscription(page, actor);
  await cancelSubscription(page);
  const requestId = await requestRefund(page, actor);
  await operator.signIn(context);
  await page.goto(adminRefundPath(requestId));
  await expect(
    page.getByText(messages.refunds.policyUnavailable, { exact: true }).first(),
  ).toBeVisible();
  const response = await actorPost(page, routes.refundAuthorize, {
    requestId,
    amountKrw: 1000,
    policyVersion: refundFixturePolicy,
    reason: approvalReason,
    accepted: true,
  });
  expect(response.status()).toBe(409);
  expect(cancellationSnapshot(actor).requests[0]!.state).toBe('requested');
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('restricted owner can still stop charging; another fan cannot access or authorize the request', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const stranger = await identity();
  await completeOnboarding(stranger);
  restrictActor(actor);
  await openSubscription(page, actor);
  await cancelSubscription(page);
  const requestId = await requestRefund(page, actor);
  await stranger.signIn(context);
  const cancel = await actorPost(page, routes.subscriptionCancel, {
    subscriptionId: cancellationSnapshot(actor).subscription.id,
  });
  expect(cancel.status()).toBe(403);
  for (const path of [
    routes.refundAuthorize,
    routes.refundExecute,
    routes.refundReconcile,
    routes.refundReject,
  ]) {
    const denied = await actorPost(page, path, {
      requestId,
      amountKrw: 1000,
      policyVersion: refundFixturePolicy,
      reason: approvalReason,
      accepted: true,
    });
    expect(denied.status()).toBe(403);
  }
  await page.goto(
    subscriptionPath(cancellationSnapshot(actor).subscription.id),
  );
  await expect(
    page
      .getByText(messages.subscriptions.errors.FORBIDDEN, { exact: true })
      .first(),
  ).toBeVisible();
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('admin authorization revoked before dispatch cannot be reused by a second valid admin', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const authorizer = await admin(identity);
  const executor = await admin(identity);
  await openSubscription(page, actor);
  const requestId = await requestRefund(page, actor);
  await authorizer.signIn(context);
  await authorizeRefund(page, requestId);
  setActorRole(authorizer, 'fan');
  await executor.signIn(context);
  await actorPost(page, routes.refundExecute, { requestId });
  expect(cancellationSnapshot(actor).requests[0]!.state).toBe('authorized');
  expect(cancellationSnapshot(actor).events).toHaveLength(1);
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('duplicate owner request and parallel admin execute produce one operation and one refund', async ({
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
  const operator = await admin(identity);
  const before = cancellationSnapshot(actor);
  const body = {
    subscriptionId: before.subscription.id,
    originalEventId: before.events[0]!.id,
    amountKrw: 500,
    reason: requestReason,
    idempotencyKey: randomUUID(),
  };
  const requested = await Promise.all([
    actorPost(page, routes.refundRequest, body),
    actorPost(page, routes.refundRequest, body),
  ]);
  expect(requested.map((response) => response.status())).toEqual([200, 200]);
  const saved = cancellationSnapshot(actor);
  expect(saved.requests).toHaveLength(1);
  const requestId = saved.requests[0]!.id;
  await operator.signIn(context);
  await authorizeRefund(page, requestId, 500);
  await scenario(request, 'hold-refund');
  const first = actorPost(page, routes.refundExecute, { requestId });
  await expect.poll(async () => (await calls(request)).refunds.kakao).toBe(1);
  const second = await actorPost(page, routes.refundExecute, { requestId });
  expect(second.status()).toBe(200);
  expect(cancellationSnapshot(actor).requests[0]!.state).toBe('inflight');
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await first).status()).toBe(200);
  expect(cancellationSnapshot(actor).events).toHaveLength(2);
  expect((await calls(request)).refunds.kakao).toBe(1);
});

test('cancellation racing an already-dispatched renewal retains confirmed paid period but never reopens renewals', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'hold-charge');
  const pending = invokeRenewals(request);
  await expect.poll(async () => (await calls(request)).charges.toss).toBe(2);
  await openSubscription(page, actor);
  await expect(
    page.getByText(messages.subscriptions.renewalUncertain, { exact: true }),
  ).toBeVisible();
  await cancelSubscription(page);
  expect(cancellationSnapshot(actor).subscription.nextBilling).toBeNull();
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await pending).status()).toBe(200);
  const state = cancellationSnapshot(actor);
  expect(state.subscription.status).toBe('canceled');
  expect(state.subscription.nextBilling).toBeNull();
  expect(state.events).toHaveLength(2);
  expect(await hasPaidAccess(actor)).toBe(true);
  await invokeRenewals(request);
  expect((await calls(request)).charges.toss).toBe(2);
});

test('dialog dismissal, Back and Forward do not cancel or duplicate refund requests', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const beforeDetail = page.url();
  await openSubscription(page, actor);
  const originalUrl = page.url();
  await page
    .getByRole('button', { name: messages.subscriptions.cancel, exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: messages.subscriptions.cancelKeep,
      exact: true,
    })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  expect(cancellationSnapshot(actor).subscription.status).toBe('active');
  await page
    .getByRole('button', { name: messages.subscriptions.cancel, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await requestRefund(page, actor);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.subscriptions}`);
  // The application Back control deliberately replaces the detail entry.
  await page.goBack();
  await expect(page).toHaveURL(beforeDetail);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(`${appOrigin}${routes.subscriptions}`);
  expect(cancellationSnapshot(actor).requests).toHaveLength(1);
  expect(cancellationSnapshot(actor).subscription.status).toBe('active');
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('same-origin, body bounds and strict mutation envelopes reject before financial effects', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const operator = await admin(identity);
  await openSubscription(page, actor);
  const requestId = await requestRefund(page, actor);
  await operator.signIn(context);
  await authorizeRefund(page, requestId);
  for (const Origin of ['https://untrusted.example', 'null']) {
    const result = await page.request.post(routes.refundExecute, {
      headers: { Origin },
      data: { requestId },
    });
    expect(result.status()).toBe(403);
  }
  for (const body of [
    { requestId, amountKrw: 1 },
    { requestId, reason: 'x'.repeat(5000) },
  ])
    expect((await actorPost(page, routes.refundExecute, body)).status()).toBe(
      400,
    );
  expect((await page.request.get(routes.refundExecute)).status()).toBe(405);
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('grace cancellation does not invent a fresh paid period or retain unpaid grace access', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  makeRenewalDue(actor);
  await scenario(request, 'reject');
  expect((await invokeRenewals(request)).status()).toBe(200);
  const grace = cancellationSnapshot(actor);
  expect(grace.subscription.status).toBe('grace');
  await openSubscription(page, actor);
  await expect(
    page.getByText(messages.subscriptions.graceNotice, { exact: true }),
  ).toBeVisible();
  await cancelSubscription(page);
  const canceled = cancellationSnapshot(actor);
  expect(canceled.subscription).toMatchObject({
    status: 'canceled',
    periodEnd: grace.subscription.periodEnd,
    nextBilling: null,
  });
  expect(canceled.events).toEqual(grace.events);
  expect(await hasPaidAccess(actor)).toBe(false);
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('lost browser cancellation response freezes mutation until explicit read confirms persisted cancellation', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  await openSubscription(page, actor);
  let submissions = 0;
  await page.route(`**${routes.subscriptionCancel}`, async (route) => {
    submissions += 1;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await page
    .getByRole('button', { name: messages.subscriptions.cancel, exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: messages.subscriptions.cancelConfirm,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(messages.subscriptions.unknownNotice, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: messages.subscriptions.cancel,
      exact: true,
    }),
  ).toBeDisabled();
  expect(cancellationSnapshot(actor).subscription.status).toBe('canceled');
  await page
    .getByRole('button', { name: messages.subscriptions.refresh, exact: true })
    .click();
  await expect(
    page.getByText(messages.subscriptions.statuses.canceled, { exact: true }),
  ).toBeVisible();
  expect(submissions).toBe(1);
  expect(cancellationSnapshot(actor).events).toHaveLength(1);
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});

test('bounded unavailable refund queries remain unknown and require manual review without another refund', async ({
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
  const operator = await admin(identity);
  await openSubscription(page, actor);
  const requestId = await requestRefund(page, actor);
  await operator.signIn(context);
  await authorizeRefund(page, requestId);
  await scenario(request, 'refund-response-lost');
  await executeRefund(page);
  await expect(
    page.getByText(messages.refunds.statuses.unknown, { exact: true }),
  ).toBeVisible();
  await scenario(request, 'refund-query-unavailable');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    advanceRefundRecoveryClock(actor);
    await page
      .getByRole('button', { name: messages.refunds.refresh, exact: true })
      .click();
    await page
      .getByRole('button', { name: messages.refunds.reconcile, exact: true })
      .click();
    await expect
      .poll(() => cancellationSnapshot(actor).requests[0]!.queries)
      .toBe(attempt);
    await expect(
      page.getByText(messages.refunds.statuses.unknown, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByText(messages.refunds.manualReview, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: messages.refunds.reconcile, exact: true }),
  ).toBeDisabled();
  await actorPost(page, routes.refundExecute, { requestId });
  expect(cancellationSnapshot(actor).events).toHaveLength(1);
  expect((await calls(request)).refunds.kakao).toBe(1);
});

test('admin rejection records a decision but neither cancels access nor sends a provider refund', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await enrolled(page, context, identity);
  const operator = await admin(identity);
  await openSubscription(page, actor);
  const requestId = await requestRefund(page, actor);
  const before = cancellationSnapshot(actor);
  await operator.signIn(context);
  await page.goto(adminRefundPath(requestId));
  await page
    .getByLabel(messages.refunds.rejectReasonLabel, { exact: true })
    .fill('허구 CI 검토 후 거절 기록입니다.');
  await page
    .getByRole('button', { name: messages.refunds.reject, exact: true })
    .click();
  await page
    .getByRole('dialog', {
      name: messages.refunds.rejectConfirmTitle,
      exact: true,
    })
    .getByRole('button', { name: messages.refunds.rejectConfirm, exact: true })
    .click();
  await expect(
    page.getByText(messages.refunds.statuses.rejected, { exact: true }),
  ).toBeVisible();
  const after = cancellationSnapshot(actor);
  expect(after.decisions).toBe(1);
  expect(after.events).toEqual(before.events);
  expect(after.subscription).toEqual(before.subscription);
  expect((await calls(request)).refunds).toEqual({ toss: 0, kakao: 0 });
});
