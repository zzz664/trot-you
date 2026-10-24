import { randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import {
  test,
  expect,
  appOrigin,
  providerOrigin,
  prepareCancellationPolicies,
  activateCancellationPolicies,
  retirePreviousReconciliationFixtures,
  installFakeBrowser,
  expectNoExternal,
  completeOnboarding,
  prepare,
  authorize,
  approve,
  screenshot,
  snapshot,
  cancellationSnapshot,
  renewalSnapshot,
  reconciliationSnapshot,
  advanceReconciliationClock,
  makeRenewalDue,
  invokeRenewals,
  invokeReconciliation,
  setActorRole,
  restrictActor,
  refundFixturePolicy,
  type Identity,
} from './fixtures';
import {
  CHECKOUT_PROVIDERS,
  type CheckoutProvider,
} from '../../../src/config/checkout';
import { RENEWAL_CI } from '../../../src/config/enrollment-test-runtime';
import { RECONCILIATION_CI } from '../../../src/config/reconciliation-test-runtime';
import { TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER } from '../../../src/config/provider-events';
import { routes } from '../../../src/config/routes';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const hintHeaders = () => ({
  [TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER]: randomUUID(),
});
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
async function startEnrollment(
  page: Page,
  context: BrowserContext,
  identity: () => Promise<Identity>,
  provider: CheckoutProvider,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const actor = await identity();
  await completeOnboarding(actor, scale);
  await actor.signIn(context);
  await prepare(page, actor, provider);
  await authorize(page, provider);
  return actor;
}
async function enrolled(
  page: Page,
  context: BrowserContext,
  identity: () => Promise<Identity>,
  provider: CheckoutProvider = 'toss_card_billing',
) {
  const actor = await startEnrollment(page, context, identity, provider);
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  return actor;
}
async function operator(
  identity: () => Promise<Identity>,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const actor = await identity();
  await completeOnboarding(actor, scale);
  setActorRole(actor, 'admin');
  return actor;
}
async function expectWorker(request: APIRequestContext) {
  const response = await invokeReconciliation(request);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const data = await response.json();
  expect(data.ok).toBe(true);
  expect(data.data.queried).toBeLessThanOrEqual(1);
  expect(JSON.stringify(data)).not.toMatch(
    /ci_auth_|ci_billing_|ci_sid_|ci_pg_|ci_tid_|ci_aid_|credential|lease_token|merchant_account|provider_payment_id/,
  );
  return data.data as {
    queried: number;
    settled: number;
    unknown: number;
    manualReview: number;
  };
}
async function hint(request: APIRequestContext, orderId: string) {
  const response = await request.post(
    `${providerOrigin}/__fixture/toss-event`,
    { data: { orderId } },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}
async function actorPost(page: Page, path: string, data: unknown) {
  return page.request.post(path, { headers: { Origin: appOrigin }, data });
}

test.beforeAll(prepareCancellationPolicies);
test.beforeEach(async ({ context, request }) => {
  retirePreviousReconciliationFixtures();
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

test('query worker rejects missing/wrong/cross-worker credentials and caller input before provider I/O', async ({
  request,
}) => {
  for (const authorization of [
    undefined,
    'Bearer wrong',
    `bearer ${RECONCILIATION_CI.cronSecret}`,
    `Bearer ${RENEWAL_CI.cronSecret}`,
  ]) {
    const response = await request.post(routes.reconcilePayments, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    expect(response.status()).toBe(401);
  }
  for (const method of ['GET', 'POST'] as const) {
    const response = await request.fetch(
      `${routes.reconcilePayments}?case=${randomUUID()}`,
      {
        method,
        headers: { Authorization: `Bearer ${RECONCILIATION_CI.cronSecret}` },
      },
    );
    expect(response.status()).toBe(400);
  }
  expect(
    (
      await request.post(routes.reconcilePayments, {
        headers: { Authorization: `Bearer ${RECONCILIATION_CI.cronSecret}` },
        data: { force: true },
      })
    ).status(),
  ).toBe(400);
  const before = await calls(request);
  expect((await expectWorker(request)).queried).toBe(0);
  expect(await calls(request)).toEqual(before);
});

for (const provider of CHECKOUT_PROVIDERS)
  for (const scale of ['normal', 'large', 'xlarge'] as const)
    test(`${provider} lost initial response query recovery and read-only admin at ${scale}`, async ({
      page,
      context,
      identity,
      request,
    }, info) => {
      await page.setViewportSize({
        width: scale === 'normal' ? 1280 : 390,
        height: 844,
      });
      const actor = await startEnrollment(
        page,
        context,
        identity,
        provider,
        scale,
      );
      await scenario(
        request,
        provider === 'toss_card_billing'
          ? 'charge-response-lost'
          : 'approve-response-lost',
      );
      await approve(page);
      await expect(
        page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
      ).toBeVisible();
      expect(snapshot(actor).payments).toBe(0);
      const before = await calls(request);
      const result = await expectWorker(request);
      expect(result.queried).toBe(1);
      expect(snapshot(actor).payments).toBe(
        provider === 'toss_card_billing' ? 1 : 0,
      );
      const expected =
        provider === 'toss_card_billing' ? 'processed' : 'manual_review';
      expect(reconciliationSnapshot(actor).cases).toEqual([
        expect.objectContaining({
          kind: 'initial',
          state: expected,
          queries: 1,
        }),
      ]);
      if (provider === 'kakaopay_subscription') {
        expect(snapshot(actor).reconciliations).toBe(1);
        expect(reconciliationSnapshot(actor).cases[0]!.reason).toBe(
          'CREDENTIAL_MISSING',
        );
      }
      const admin = await operator(identity, scale);
      await admin.signIn(context);
      const response = await page.goto(routes.adminReconciliation);
      expect(response?.headers()['cache-control']).toContain('no-store');
      await expect(
        page.getByRole('heading', {
          name: messages.reconciliation.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(messages.reconciliation.readOnly, { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByText(messages.reconciliation.statuses[expected], {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      expect(await page.locator('body').innerText()).not.toMatch(
        /ci_auth_|ci_billing_|ci_sid_|ci_pg_|ci_tid_|ci_aid_|ci_payment_|merchant_account|provider_payment_id/,
      );
      await screenshot(
        page,
        info,
        `reconciliation-${provider}-${expected}-${scale}`,
      );
      const afterQuery = await calls(request);
      await page
        .getByRole('button', {
          name: messages.reconciliation.refresh,
          exact: true,
        })
        .click();
      await page.goto(`${routes.adminReconciliation}?page=2`);
      await expect(
        page.getByText(
          messages.reconciliation.pageNumber.replace('{page}', '2'),
          { exact: true },
        ),
      ).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(
        new URL(routes.adminReconciliation, appOrigin).href,
      );
      await expect(
        page.getByText(
          messages.reconciliation.pageNumber.replace('{page}', '1'),
          { exact: true },
        ),
      ).toBeVisible();
      // Back may finish its document event before the App Router has restored
      // the server-rendered page. Assert that restored state before Forward;
      // never mask an aborted navigation or turn it into a test retry.
      await page.goForward();
      await expect(page).toHaveURL(
        new URL(`${routes.adminReconciliation}?page=2`, appOrigin).href,
      );
      await expect(
        page.getByText(
          messages.reconciliation.pageNumber.replace('{page}', '2'),
          { exact: true },
        ),
      ).toBeVisible();
      expect(await calls(request)).toEqual(afterQuery);
      expect(afterQuery.charges).toEqual(before.charges);
      expect(afterQuery.requests.tossCharge).toBe(before.requests.tossCharge);
      expect(afterQuery.requests.kakaoApprove).toBe(
        before.requests.kakaoApprove,
      );
      expect((await expectWorker(request)).queried).toBe(0);
    });

test('duplicate untrusted Toss hints persist once, never grant money, then verified query atomically processes inbox', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await scenario(request, 'charge-response-lost');
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  const event = await hint(request, reconciliationSnapshot(actor).initialOrder);
  const first = await request.post(routes.tossPaymentWebhook, {
    headers: hintHeaders(),
    data: event,
  });
  expect(first.status()).toBe(200);
  expect(first.headers()['cache-control']).toContain('no-store');
  for (let index = 0; index < 3; index++) {
    expect(
      (
        await request.post(routes.tossPaymentWebhook, {
          headers: hintHeaders(),
          data: {
            ...event,
            createdAt: new Date().toISOString(),
            data: {
              ...event.data,
              customerName: `Untrusted PII ${index}`,
              customerEmail: `secret-${index}@example.invalid`,
            },
          },
        })
      ).status(),
    ).toBe(200);
  }
  expect(snapshot(actor).payments).toBe(0);
  const queued = reconciliationSnapshot(actor);
  expect(queued.cases).toHaveLength(1);
  expect(queued.inbox).toEqual([
    expect.objectContaining({ status: 'DONE', state: 'pending' }),
  ]);
  expect(queued.cases[0]!.queries).toBe(0);
  await expectWorker(request);
  expect(snapshot(actor).payments).toBe(1);
  expect(reconciliationSnapshot(actor).inbox).toEqual([
    expect.objectContaining({ status: 'DONE', state: 'processed' }),
  ]);
  const before = await calls(request);
  expect(
    (
      await request.post(routes.tossPaymentWebhook, {
        headers: hintHeaders(),
        data: event,
      })
    ).status(),
  ).toBe(200);
  expect((await expectWorker(request)).queried).toBe(0);
  expect(await calls(request)).toEqual(before);
  expect(snapshot(actor).payments).toBe(1);
});

test('wrong amount, MID, unknown order and unsupported events cannot queue or establish money', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await scenario(request, 'charge-response-lost');
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  const event = await hint(request, reconciliationSnapshot(actor).initialOrder);
  for (const data of [
    { ...event.data, totalAmount: 1001, balanceAmount: 1001 },
    { ...event.data, mId: 'not_the_merchant' },
    { ...event.data, orderId: randomUUID() },
    {
      ...event.data,
      status: 'CANCELED',
      balanceAmount: 0,
      lastTransactionKey: 'untrusted-cancel-no-authorized-refund',
    },
  ]) {
    const response = await request.post(routes.tossPaymentWebhook, {
      headers: hintHeaders(),
      data: { ...event, data },
    });
    expect([200, 400, 422]).toContain(response.status());
  }
  for (const eventType of [
    'BILLING_DELETED',
    'CANCEL_STATUS_CHANGED',
    'KAKAOPAY_PAYMENT',
  ]) {
    const response = await request.post(routes.tossPaymentWebhook, {
      headers: hintHeaders(),
      data: {
        eventType,
        createdAt: event.createdAt,
        data: { billingKey: 'private_key_must_not_persist' },
      },
    });
    expect(response.status()).toBe(422);
  }
  expect(
    (
      await request.post(routes.tossPaymentWebhook, {
        headers: { ...hintHeaders(), 'Content-Type': 'application/json' },
        data: 'x'.repeat(20_000),
      })
    ).status(),
  ).toBe(413);
  expect(snapshot(actor).payments).toBe(0);
  expect(reconciliationSnapshot(actor).cases).toHaveLength(0);
  expect(reconciliationSnapshot(actor).inbox).toHaveLength(0);
  expect((await calls(request)).requests.tossQuery).toBe(0);
});

for (const provider of CHECKOUT_PROVIDERS)
  test(`${provider} renewal uncertainty is query-only; missing Kakao TID cannot be recovered or recharged`, async ({
    page,
    context,
    identity,
    request,
  }) => {
    const actor = await enrolled(page, context, identity, provider);
    makeRenewalDue(actor);
    await scenario(
      request,
      provider === 'toss_card_billing'
        ? 'charge-response-lost'
        : 'subscription-response-lost',
    );
    expect((await invokeRenewals(request)).status()).toBe(200);
    expect(renewalSnapshot(actor).attempts[0]!.state).toBe('unknown');
    advanceReconciliationClock(actor);
    const before = await calls(request);
    const result = await expectWorker(request);
    expect(result.queried).toBe(provider === 'toss_card_billing' ? 1 : 0);
    const cases = reconciliationSnapshot(actor).cases;
    expect(cases).toEqual([
      expect.objectContaining({
        kind: 'renewal',
        state: provider === 'toss_card_billing' ? 'processed' : 'manual_review',
      }),
    ]);
    if (provider === 'kakaopay_subscription')
      expect(cases[0]!.reason).toBe('PAYMENT_ID_MISSING');
    expect(renewalSnapshot(actor).events).toHaveLength(
      provider === 'toss_card_billing' ? 2 : 1,
    );
    const after = await calls(request);
    expect(after.charges).toEqual(before.charges);
    expect(after.requests.kakaoSubscription).toBe(
      before.requests.kakaoSubscription,
    );
    expect(after.requests.kakaoQuery).toBe(before.requests.kakaoQuery);
    await expectWorker(request);
    expect(await calls(request)).toEqual(after);
  });

for (const provider of CHECKOUT_PROVIDERS)
  test(`${provider} authorized unknown refund recovers exact amount through query without redispatch`, async ({
    page,
    context,
    identity,
    request,
  }) => {
    const actor = await enrolled(page, context, identity, provider);
    const original = cancellationSnapshot(actor);
    const requested = await actorPost(page, routes.refundRequest, {
      subscriptionId: original.subscription.id,
      originalEventId: original.events[0]!.id,
      amountKrw: 400,
      reason: '격리 CI 허구 환불 검토 요청',
      idempotencyKey: randomUUID(),
    });
    expect(requested.status()).toBe(200);
    const requestId = cancellationSnapshot(actor).requests[0]!.id;
    const admin = await operator(identity);
    await admin.signIn(context);
    expect(
      (
        await actorPost(page, routes.refundAuthorize, {
          requestId,
          amountKrw: 400,
          policyVersion: refundFixturePolicy,
          reason: '격리 CI 허구 승인',
          accepted: true,
        })
      ).status(),
    ).toBe(200);
    await scenario(request, 'refund-response-lost');
    expect(
      (await actorPost(page, routes.refundExecute, { requestId })).status(),
    ).toBe(200);
    expect(cancellationSnapshot(actor).requests[0]!.state).toBe('unknown');
    expect(cancellationSnapshot(actor).events).toHaveLength(1);
    advanceReconciliationClock(actor);
    const before = await calls(request);
    expect((await expectWorker(request)).settled).toBe(1);
    expect(cancellationSnapshot(actor).events[1]).toMatchObject({
      kind: 'refund',
      amount: -400,
      original: original.events[0]!.id,
    });
    expect(cancellationSnapshot(actor).subscription).toEqual(
      original.subscription,
    );
    expect(reconciliationSnapshot(actor).cases).toEqual([
      expect.objectContaining({
        kind: 'refund',
        state: 'processed',
        queries: 1,
      }),
    ]);
    expect((await calls(request)).refunds).toEqual(before.refunds);
    expect((await expectWorker(request)).queried).toBe(0);
    expect((await calls(request)).refundRequests.tossCancel).toBe(
      before.refundRequests.tossCancel,
    );
    expect((await calls(request)).refundRequests.kakaoCancel).toBe(
      before.refundRequests.kakaoCancel,
    );
  });

test('query failures consume bounded budget, retain unknown money and cannot be reset by duplicate notice', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await scenario(request, 'charge-response-lost');
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  const event = await hint(request, reconciliationSnapshot(actor).initialOrder);
  await scenario(request, 'all-queries-unavailable');
  for (let attempt = 1; attempt <= 3; attempt++) {
    advanceReconciliationClock(actor);
    expect((await expectWorker(request)).unknown).toBe(1);
    expect(reconciliationSnapshot(actor).cases[0]!.queries).toBe(attempt);
    expect(snapshot(actor).payments).toBe(0);
  }
  expect(reconciliationSnapshot(actor).cases[0]).toMatchObject({
    state: 'manual_review',
    reason: 'QUERY_BUDGET_EXHAUSTED',
    queries: 3,
  });
  const before = await calls(request);
  expect(
    (
      await request.post(routes.tossPaymentWebhook, {
        headers: hintHeaders(),
        data: event,
      })
    ).status(),
  ).toBe(200);
  advanceReconciliationClock(actor);
  expect((await expectWorker(request)).queried).toBe(0);
  expect(
    (
      await actorPost(page, routes.enrollmentReconcile, {
        sessionId: reconciliationSnapshot(actor).sessionId,
      })
    ).status(),
  ).toBe(200);
  expect(await calls(request)).toEqual(before);
  expect(snapshot(actor).payments).toBe(0);
});

test('two simultaneous workers hold one durable query lease and never dispatch financial operations', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await scenario(request, 'charge-response-lost');
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  await scenario(request, 'hold-query');
  const first = invokeReconciliation(request);
  await expect
    .poll(async () => (await calls(request)).requests.tossQuery)
    .toBe(1);
  const second = await expectWorker(request);
  expect(second.queried).toBe(0);
  expect(snapshot(actor).payments).toBe(0);
  await request.post(`${providerOrigin}/__fixture/release`);
  expect((await first).status()).toBe(200);
  expect(snapshot(actor).payments).toBe(1);
  expect((await calls(request)).requests.tossQuery).toBe(1);
  expect((await calls(request)).charges.toss).toBe(1);
});

test('admin route and actor RPC enforce fresh authority without provider I/O', async ({
  page,
  context,
  identity,
  request,
}) => {
  await page.goto(routes.adminReconciliation);
  await expect(page).toHaveURL(new RegExp(`${routes.start}$`));
  const fan = await identity();
  await completeOnboarding(fan);
  await fan.signIn(context);
  await page.goto(routes.adminReconciliation);
  await expect(page).not.toHaveURL(
    new RegExp(`${routes.adminReconciliation}$`),
  );
  const fanClient = await fan.actorClient();
  expect(
    (await fanClient.rpc('reconciliation_admin_list', { p_page: 1 })).error
      ?.message,
  ).toBe('FORBIDDEN');
  const admin = await operator(identity);
  await admin.signIn(context);
  await page.goto(routes.adminReconciliation);
  await expect(
    page.getByRole('heading', {
      name: messages.reconciliation.title,
      exact: true,
    }),
  ).toBeVisible();
  const before = await calls(request);
  setActorRole(admin, 'fan');
  await page.reload();
  await expect(page).not.toHaveURL(
    new RegExp(`${routes.adminReconciliation}$`),
  );
  setActorRole(admin, 'admin');
  restrictActor(admin);
  await page.goto(routes.adminReconciliation);
  await expect(page).not.toHaveURL(
    new RegExp(`${routes.adminReconciliation}$`),
  );
  const adminClient = await admin.actorClient();
  expect(
    (await adminClient.rpc('reconciliation_admin_list', { p_page: 1 })).error
      ?.message,
  ).toBe('FORBIDDEN');
  expect(await calls(request)).toEqual(before);
});

test('one invocation queries at most one of two eligible unknown charges', async ({
  page,
  context,
  identity,
  request,
}) => {
  const first = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await scenario(request, 'charge-response-lost');
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  const second = await startEnrollment(
    page,
    context,
    identity,
    'toss_card_billing',
  );
  await approve(page);
  await expect(
    page.getByText(messages.enrollment.statuses.unknown, { exact: true }),
  ).toBeVisible();
  expect(snapshot(first).payments + snapshot(second).payments).toBe(0);
  expect((await expectWorker(request)).queried).toBe(1);
  expect(snapshot(first).payments + snapshot(second).payments).toBe(1);
  expect((await calls(request)).requests.tossQuery).toBe(1);
  expect((await expectWorker(request)).queried).toBe(1);
  expect(snapshot(first).payments + snapshot(second).payments).toBe(2);
  expect((await calls(request)).requests.tossQuery).toBe(2);
  expect((await calls(request)).charges.toss).toBe(2);
});
