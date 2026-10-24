import { randomUUID } from 'node:crypto';
import {
  test,
  expect,
  appOrigin,
  providerOrigin,
  activatePolicies,
  preparePolicies,
  installFakeBrowser,
  expectNoExternal,
  completeOnboarding,
  prepare,
  authorize,
  approve,
  screenshot,
  snapshot,
  rotatePolicy,
  expireCheckout,
} from './fixtures';
import {
  CHECKOUT_NONCE_COOKIE,
  CHECKOUT_PROVIDERS,
} from '../../../src/config/checkout';
import {
  artistPreviewPath,
  enrollmentCompletePath,
  routes,
} from '../../../src/config/routes';
import { checkoutFixtures } from '../authenticated/checkout-fixtures';
import messages from '../../../src/messages/ko.json' with { type: 'json' };
const copy = messages.enrollment;
const confirmInput = (sessionId: string) => ({
  sessionId,
  policyVersion: checkoutFixtures.policy,
  amountKrw: 1000,
  accepted: true,
});

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context, request }) => {
  activatePolicies();
  expect((await request.post(`${providerOrigin}/__fixture/reset`)).ok()).toBe(
    true,
  );
  await installFakeBrowser(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test.describe('mobile browser provider handoff', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  });
  for (const provider of CHECKOUT_PROVIDERS)
    for (const scale of ['normal', 'large', 'xlarge'] as const) {
      test(`${provider} explicit first charge at ${scale} mobile uses real app and database`, async ({
        page,
        context,
        identity,
        request,
      }, info) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const actor = await identity();
        await completeOnboarding(actor, scale);
        await actor.signIn(context);
        const sessionId = await prepare(page, actor, provider);
        let handoffDevice = '';
        page.on('request', (value) => {
          const url = new URL(value.url());
          if (url.origin === 'https://online-pay.kakao.com')
            handoffDevice = url.searchParams.get('device') ?? '';
        });
        await authorize(page, provider);
        if (provider === 'kakaopay_subscription')
          expect(handoffDevice).toBe('mobile');
        await expect(page).toHaveURL(
          `${appOrigin}${enrollmentCompletePath(sessionId)}`,
        );
        expect(snapshot(actor).payments).toBe(0);
        expect(
          (
            await (
              await request.get(`${providerOrigin}/__fixture/calls`)
            ).json()
          ).charges,
        ).toEqual({ toss: 0, kakao: 0 });
        await expect(
          page.getByRole('button', {
            name: copy.confirm.replace('{price}', '1,000'),
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          page.getByText(copy.calendars.utc_monthly_clamped, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(copy.taxBases.taxable_krw, { exact: true }),
        ).toBeVisible();
        await screenshot(page, info, `enrollment-confirm-${provider}-${scale}`);
        await approve(page);
        await expect(
          page.getByText(copy.statuses.succeeded, { exact: true }),
        ).toBeVisible();
        const stored = snapshot(actor);
        expect(stored.payments).toBe(1);
        expect(stored.paidAmount).toBe(1000);
        expect(stored.credentials).toBe(1);
        expect(stored.subscriptions).toEqual([
          { status: 'active', introUsed: true },
        ]);
        const calls = await (
          await request.get(`${providerOrigin}/__fixture/calls`)
        ).json();
        expect(calls.charges).toEqual({
          toss: provider === 'toss_card_billing' ? 1 : 0,
          kakao: provider === 'kakaopay_subscription' ? 1 : 0,
        });
        await page.reload();
        await expect(
          page.getByText(copy.statuses.succeeded, { exact: true }),
        ).toBeVisible();
        expect(snapshot(actor).payments).toBe(1);
        await screenshot(page, info, `enrollment-success-${provider}-${scale}`);
      });
    }
});

test('duplicate callbacks and concurrent confirm POSTs settle one first charge', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  const sessionId = await prepare(page, actor);
  let callback = '';
  page.on('request', (value) => {
    if (new URL(value.url()).pathname === routes.checkoutReturn)
      callback = value.url();
  });
  await authorize(page);
  expect(callback).not.toBe('');
  expect(
    (await context.request.get(callback, { maxRedirects: 0 })).status(),
  ).toBe(303);
  expect(snapshot(actor).payments).toBe(0);
  const results = await Promise.all(
    [1, 2].map(() =>
      context.request.post(routes.enrollmentConfirm, {
        headers: { Origin: appOrigin },
        data: confirmInput(sessionId),
      }),
    ),
  );
  for (const result of results) expect(result.ok()).toBe(true);
  expect(snapshot(actor).payments).toBe(1);
  expect(
    (await context.request.get(callback, { maxRedirects: 0 })).status(),
  ).toBe(303);
  expect(
    (
      await context.request.post(routes.enrollmentConfirm, {
        headers: { Origin: appOrigin },
        data: confirmInput(sessionId),
      })
    ).ok(),
  ).toBe(true);
  const calls = await (
    await request.get(`${providerOrigin}/__fixture/calls`)
  ).json();
  expect(calls.charges.toss).toBe(1);
  expect(calls.requests.tossCharge).toBe(1);
  expect(snapshot(actor).payments).toBe(1);
});

test('wrong user, new login session, bad origin and authority-bearing input fail closed', async ({
  page,
  context,
  browser,
  identity,
  request,
}) => {
  const owner = await identity();
  await completeOnboarding(owner);
  await owner.signIn(context);
  const sessionId = await prepare(page, owner);
  await authorize(page);
  for (const origin of [undefined, 'null', 'https://untrusted.example']) {
    const response = await context.request.post(routes.enrollmentConfirm, {
      headers: origin ? { Origin: origin } : {},
      data: confirmInput(sessionId),
    });
    expect(response.status()).toBe(403);
  }
  for (const data of [
    { ...confirmInput(sessionId), accepted: false },
    { ...confirmInput(sessionId), userId: owner.id },
    { ...confirmInput(sessionId), amountKrw: 1 },
  ]) {
    const response = await context.request.post(routes.enrollmentConfirm, {
      headers: { Origin: appOrigin },
      data,
    });
    expect([400, 409]).toContain(response.status());
  }
  const other = await identity();
  await completeOnboarding(other);
  const otherContext = await browser.newContext({ baseURL: appOrigin });
  await installFakeBrowser(otherContext);
  try {
    await other.signIn(otherContext);
    const nonce = (
      await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)
    ).find((value) => value.name === CHECKOUT_NONCE_COOKIE)!;
    await otherContext.addCookies([nonce]);
    expect(
      (
        await otherContext.request.get(
          `${routes.enrollmentStatus}?session=${sessionId}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherContext.request.post(routes.enrollmentConfirm, {
          headers: { Origin: appOrigin },
          data: confirmInput(sessionId),
        })
      ).status(),
    ).toBe(403);
    expectNoExternal(otherContext);
  } finally {
    await otherContext.close();
  }
  await owner.signIn(context);
  expect(
    (
      await context.request.get(
        `${routes.enrollmentStatus}?session=${sessionId}`,
      )
    ).status(),
  ).toBe(404);
  expect(snapshot(owner).payments).toBe(0);
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .charges,
  ).toEqual({ toss: 0, kakao: 0 });
});

test('rotated policy and expired checkout cannot dispatch a first charge', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  const sessionId = await prepare(page, actor);
  await authorize(page);
  rotatePolicy();
  const changed = await context.request.post(routes.enrollmentConfirm, {
    headers: { Origin: appOrigin },
    data: confirmInput(sessionId),
  });
  expect(changed.status()).toBe(409);
  expect(await changed.json()).toEqual({ ok: false, code: 'POLICY_CHANGED' });
  activatePolicies();
  expireCheckout(actor);
  const expired = await context.request.post(routes.enrollmentConfirm, {
    headers: { Origin: appOrigin },
    data: confirmInput(sessionId),
  });
  expect([200, 409]).toContain(expired.status());
  expect(snapshot(actor).payments).toBe(0);
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .requests.tossCharge,
  ).toBe(0);
});

test('cancel and dismissal stay distinct and cancellation prevents delayed authorization', async ({
  page,
  context,
  identity,
  request,
}, info) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  const sessionId = await prepare(page, actor);
  await authorize(page);
  await page.getByRole('button', { name: copy.dismiss, exact: true }).click();
  await expect(page).toHaveURL(
    `${appOrigin}${artistPreviewPath(actor.artist.slug)}`,
  );
  expect(snapshot(actor).enrollments[0]!.state).toBe('awaiting_confirmation');
  await page.goto(enrollmentCompletePath(sessionId));
  await page.getByRole('button', { name: copy.cancel, exact: true }).click();
  await expect(
    page.getByText(copy.statuses.canceled, { exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'enrollment-canceled-desktop');
  const replay = await context.request.post(routes.enrollmentConfirm, {
    headers: { Origin: appOrigin },
    data: confirmInput(sessionId),
  });
  expect(replay.ok()).toBe(true);
  expect((await replay.json()).data.status).toBe('canceled');
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .charges,
  ).toEqual({ toss: 0, kakao: 0 });
});

for (const scenario of [
  'charge-response-lost',
  'approve-response-lost',
] as const)
  test(`${scenario} stays held and reconciliation never recharges`, async ({
    page,
    context,
    identity,
    request,
  }, info) => {
    const provider =
      scenario === 'charge-response-lost'
        ? 'toss_card_billing'
        : 'kakaopay_subscription';
    const actor = await identity();
    await completeOnboarding(actor, 'xlarge');
    await actor.signIn(context);
    const sessionId = await prepare(page, actor, provider);
    await authorize(page, provider);
    expect(
      (
        await request.post(`${providerOrigin}/__fixture/scenario`, {
          data: { scenario },
        })
      ).ok(),
    ).toBe(true);
    await approve(page);
    await expect(
      page.getByText(copy.statuses.unknown, { exact: true }),
    ).toBeVisible();
    expect(snapshot(actor).payments).toBe(0);
    await screenshot(page, info, `enrollment-${scenario}-unknown`);
    await context.request.post(routes.enrollmentConfirm, {
      headers: { Origin: appOrigin },
      data: confirmInput(sessionId),
    });
    const before = await (
      await request.get(`${providerOrigin}/__fixture/calls`)
    ).json();
    expect(before.charges).toEqual({
      toss: provider === 'toss_card_billing' ? 1 : 0,
      kakao: provider === 'kakaopay_subscription' ? 1 : 0,
    });
    await page
      .getByRole('button', { name: copy.reconcile, exact: true })
      .click();
    const state =
      provider === 'toss_card_billing' ? 'succeeded' : 'manual_review';
    await expect(
      page.getByText(copy.statuses[state], { exact: true }),
    ).toBeVisible();
    await screenshot(page, info, `enrollment-${scenario}-${state}`);
    expect(snapshot(actor).payments).toBe(
      provider === 'toss_card_billing' ? 1 : 0,
    );
    if (provider === 'kakaopay_subscription')
      expect(snapshot(actor).reconciliations).toBe(1);
    const after = await (
      await request.get(`${providerOrigin}/__fixture/calls`)
    ).json();
    expect(after.charges).toEqual(before.charges);
    expect(after.requests.tossCharge).toBe(before.requests.tossCharge);
    expect(after.requests.kakaoApprove).toBe(before.requests.kakaoApprove);
  });

for (const scenario of [
  'ready-response-lost',
  'exchange-response-lost',
] as const)
  test(`${scenario} requires manual review and never dispatches again`, async ({
    page,
    context,
    identity,
    request,
  }) => {
    const provider =
      scenario === 'ready-response-lost'
        ? 'kakaopay_subscription'
        : 'toss_card_billing';
    const actor = await identity();
    await completeOnboarding(actor);
    await actor.signIn(context);
    const sessionId = await prepare(page, actor, provider);
    expect(
      (
        await request.post(`${providerOrigin}/__fixture/scenario`, {
          data: { scenario },
        })
      ).ok(),
    ).toBe(true);
    if (provider === 'toss_card_billing') {
      await authorize(page, provider);
      await approve(page);
    } else {
      await page.getByRole('button', { name: copy.start, exact: true }).click();
      await page
        .getByRole('button', { name: copy.viewStatus, exact: true })
        .click();
    }
    await expect(
      page.getByText(copy.statuses.manual_review, { exact: true }),
    ).toBeVisible();
    const before = await (
      await request.get(`${providerOrigin}/__fixture/calls`)
    ).json();
    await context.request.post(routes.enrollmentStart, {
      headers: { Origin: appOrigin },
      data: { sessionId },
    });
    await context.request.post(routes.enrollmentConfirm, {
      headers: { Origin: appOrigin },
      data: confirmInput(sessionId),
    });
    const after = await (
      await request.get(`${providerOrigin}/__fixture/calls`)
    ).json();
    expect(after).toEqual(before);
    expect(after.charges).toEqual({ toss: 0, kakao: 0 });
    expect(snapshot(actor).payments).toBe(0);
  });

test('lost browser confirmation reply is recovered by status without another provider charge', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  await prepare(page, actor);
  await authorize(page);
  let posts = 0;
  await page.route(`**${routes.enrollmentConfirm}`, async (route) => {
    posts++;
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    expect(response.ok()).toBe(true);
    await route.abort('failed');
  });
  await approve(page);
  await expect(page.getByRole('alert')).toHaveText(
    messages.checkout.errors.UNAVAILABLE,
  );
  expect(snapshot(actor).payments).toBe(1);
  await page.getByRole('button', { name: copy.refresh, exact: true }).click();
  await expect(
    page.getByText(copy.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .requests.tossCharge,
  ).toBe(1);
});

test('invalid completion URLs and token-looking callback queries never leak to rendered HTML', async ({
  page,
  context,
  request,
}) => {
  const response = await context.request.get(
    `${routes.checkoutReturn}?authKey=ci_auth_private&customerKey=${randomUUID()}&state=forged`,
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(303);
  expect(await response.text()).not.toContain('ci_auth_private');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  await page.goto(
    `${enrollmentCompletePath(randomUUID())}&pg_token=ci_pg_private`,
  );
  await expect(page).not.toHaveURL(/pg_token/);
  expect(await page.content()).not.toContain('ci_pg_private');
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .charges,
  ).toEqual({ toss: 0, kakao: 0 });
});

for (const provider of CHECKOUT_PROVIDERS) {
  test(`${provider} definitive decline grants no paid access and is not automatically retried`, async ({
    page,
    context,
    identity,
    request,
  }, info) => {
    const actor = await identity();
    await completeOnboarding(actor);
    await actor.signIn(context);
    const sessionId = await prepare(page, actor, provider);
    await authorize(page, provider);
    expect(
      (
        await request.post(`${providerOrigin}/__fixture/scenario`, {
          data: { scenario: 'reject' },
        })
      ).ok(),
    ).toBe(true);
    await approve(page);
    await expect(
      page.getByText(copy.statuses.failed, { exact: true }),
    ).toBeVisible();
    expect(snapshot(actor).payments).toBe(0);
    expect(
      snapshot(actor).subscriptions.every((value) => value.status !== 'active'),
    ).toBe(true);
    const before = await (
      await request.get(`${providerOrigin}/__fixture/calls`)
    ).json();
    await context.request.post(routes.enrollmentConfirm, {
      headers: { Origin: appOrigin },
      data: confirmInput(sessionId),
    });
    expect(
      await (await request.get(`${providerOrigin}/__fixture/calls`)).json(),
    ).toEqual(before);
    await screenshot(page, info, `enrollment-declined-${provider}`);
    // A definitive decline is terminal, not an uncertain charge. The owner
    // explicitly starts fresh registration and consent; no failed POST replay.
    expect(
      (
        await request.post(`${providerOrigin}/__fixture/scenario`, {
          data: { scenario: 'success' },
        })
      ).ok(),
    ).toBe(true);
    await prepare(page, actor, provider);
    await authorize(page, provider);
    await approve(page);
    await expect(
      page.getByText(copy.statuses.succeeded, { exact: true }),
    ).toBeVisible();
    expect(snapshot(actor).payments).toBe(1);
    expect(snapshot(actor).paidAmount).toBe(1000);
  });
}

test('dismissal wins over a delayed committed payment response without losing owner-visible recovery', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  const sessionId = await prepare(page, actor);
  await authorize(page);
  let committed = false;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${routes.enrollmentConfirm}`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    expect(response.ok()).toBe(true);
    committed = true;
    await barrier;
    await route.fulfill({ response }).catch(() => {});
  });
  await approve(page);
  await expect.poll(() => committed).toBe(true);
  await page.getByRole('button', { name: copy.dismiss, exact: true }).click();
  await expect(page).toHaveURL(
    `${appOrigin}${artistPreviewPath(actor.artist.slug)}`,
  );
  release();
  await expect(page).toHaveURL(
    `${appOrigin}${artistPreviewPath(actor.artist.slug)}`,
  );
  await page.goto(enrollmentCompletePath(sessionId));
  await expect(
    page.getByText(copy.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  expect(snapshot(actor).payments).toBe(1);
  expect(
    (await (await request.get(`${providerOrigin}/__fixture/calls`)).json())
      .requests.tossCharge,
  ).toBe(1);
});

test('Kakao desktop browser uses the validated PC handoff, not mobile URL', async ({
  page,
  context,
  identity,
}, info) => {
  const actor = await identity();
  await completeOnboarding(actor, 'normal');
  await actor.signIn(context);
  await prepare(page, actor, 'kakaopay_subscription');
  let device = '';
  page.on('request', (value) => {
    const url = new URL(value.url());
    if (url.origin === 'https://online-pay.kakao.com')
      device = url.searchParams.get('device') ?? '';
  });
  await authorize(page, 'kakaopay_subscription');
  expect(device).toBe('desktop');
  await screenshot(page, info, 'enrollment-kakao-desktop-confirm');
  await approve(page);
  await expect(
    page.getByText(copy.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  expect(snapshot(actor).payments).toBe(1);
});

test('expired idle enrollment recovers after nonce loss and a new login without reviving its callback', async ({
  page,
  context,
  identity,
  request,
}) => {
  const actor = await identity();
  await completeOnboarding(actor);
  await actor.signIn(context);
  const oldSessionId = await prepare(page, actor);
  const startedResponse = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === routes.enrollmentStart &&
      value.request().method() === 'POST',
  );
  await page.getByRole('button', { name: copy.start, exact: true }).click();
  const started = await startedResponse;
  expect(started.ok()).toBe(true);
  const oldLaunch = (await started.json()).data.launch;
  expect(oldLaunch.kind).toBe('toss_billing_auth');
  // Keep the old provider-required callback only in test memory. It is never
  // opened, rendered, logged or exchanged before this idle operation expires.
  const oldCallback = new URL(oldLaunch.requestBillingAuth.successUrl);
  oldCallback.searchParams.set(
    'authKey',
    `ci_auth_${oldLaunch.payment.customerKey}`,
  );
  oldCallback.searchParams.set('customerKey', oldLaunch.payment.customerKey);
  expect(snapshot(actor).enrollments).toEqual([
    { state: 'awaiting_authorization', stage: null },
  ]);
  expect(snapshot(actor).payments).toBe(0);

  expireCheckout(actor);
  await context.clearCookies({ name: CHECKOUT_NONCE_COOKIE });
  expect(
    (await context.cookies(`${appOrigin}${routes.checkoutSubmit}`)).some(
      (value) => value.name === CHECKOUT_NONCE_COOKIE,
    ),
  ).toBe(false);
  await actor.signIn(context);
  // The fresh preparation invokes the real expired-idle cleanup RPC. It may
  // retire the old uncharged operation, but cannot rebind its prior session.
  const newSessionId = await prepare(page, actor);
  expect(newSessionId).not.toBe(oldSessionId);
  expect(snapshot(actor).enrollments).toEqual([
    { state: 'canceled', stage: null },
  ]);
  expect(snapshot(actor).payments).toBe(0);
  expect(snapshot(actor).credentials).toBe(0);

  const staleCallback = await context.request.get(oldCallback.href, {
    maxRedirects: 0,
  });
  expect(staleCallback.status()).toBe(303);
  expect(staleCallback.headers().location).toBe(
    `${appOrigin}${routes.checkout}`,
  );
  expect(await staleCallback.text()).not.toContain('ci_auth_');
  expect(
    (
      await context.request.get(
        `${routes.enrollmentStatus}?session=${oldSessionId}`,
      )
    ).status(),
  ).toBe(404);
  const noRegistration = await context.request.post(routes.enrollmentConfirm, {
    headers: { Origin: appOrigin },
    data: confirmInput(newSessionId),
  });
  expect(noRegistration.status()).toBe(404);
  const beforeRegistration = await (
    await request.get(`${providerOrigin}/__fixture/calls`)
  ).json();
  expect(beforeRegistration.requests.tossIssue).toBe(0);
  expect(beforeRegistration.charges).toEqual({ toss: 0, kakao: 0 });

  await authorize(page);
  await expect(page).toHaveURL(
    `${appOrigin}${enrollmentCompletePath(newSessionId)}`,
  );
  await expect(
    page.getByRole('checkbox', {
      name: copy.chargeConsent.replace('{price}', '1,000'),
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', {
      name: copy.confirm.replace('{price}', '1,000'),
      exact: true,
    }),
  ).toBeDisabled();
  expect(snapshot(actor).payments).toBe(0);
  await approve(page);
  await expect(
    page.getByText(copy.statuses.succeeded, { exact: true }),
  ).toBeVisible();
  expect(snapshot(actor).payments).toBe(1);
  await context.request.get(oldCallback.href, { maxRedirects: 0 });
  const finalCalls = await (
    await request.get(`${providerOrigin}/__fixture/calls`)
  ).json();
  expect(finalCalls.requests.tossIssue).toBe(1);
  expect(finalCalls.requests.tossCharge).toBe(1);
  expect(finalCalls.charges).toEqual({ toss: 1, kakao: 0 });
  expect(snapshot(actor).payments).toBe(1);
});
