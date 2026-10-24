import type { Page, TestInfo } from '@playwright/test';
import { test, expect, appOrigin, type Identity } from './fixtures';
import {
  disableFictionalPolicy,
  enableFictionalPolicy,
  onboardingFixtures,
  prepareFictionalDocuments,
  rotateFictionalTerms,
} from './onboarding-fixtures';
import {
  clearFictionalDiscovery,
  discoveryFixtures,
  discoveryStoredInterest,
  invalidateFictionalCallingName,
  pauseMainArtist,
  prepareFictionalDiscovery,
} from './discovery-fixtures';
import { artistPreviewPath, routes } from '../../../src/config/routes';
import { PWA } from '../../../src/config/pwa';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const copy = messages.install;
const main = discoveryFixtures.main;
const choices = ['acknowledged', 'skipped', 'installed_self_reported'] as const;

async function prepareProfile(
  actor: Identity,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
  callName = '허구팬',
) {
  const client = await actor.actorClient();
  expect(
    (await client.rpc('onboarding_save_font', { p_font_scale: scale })).error,
  ).toBeNull();
  expect(
    (await client.rpc('onboarding_save_name', { p_call_name: callName })).error,
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
}

async function selectInterest(actor: Identity) {
  const client = await actor.actorClient();
  expect(
    (await client.rpc('discovery_select_artist', { p_artist_slug: main.slug }))
      .error,
  ).toBeNull();
}

async function installState(actor: Identity) {
  const client = await actor.actorClient();
  const result = await client.rpc('onboarding_get_install_state').single();
  expect(result.error).toBeNull();
  expect(result.data).not.toBeNull();
  return result.data!;
}

async function saveChoice(
  page: Page,
  choice: (typeof choices)[number] = 'acknowledged',
) {
  const radio = page.getByRole('radio', {
    name: copy.choices[choice],
    exact: true,
  });
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await page
    .getByRole('button', { name: copy.saveChoice, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: copy.complete, exact: true }),
  ).toBeEnabled();
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

test.beforeAll(() => prepareFictionalDocuments());
test.beforeEach(async ({ context, identity }) => {
  enableFictionalPolicy();
  const author = await identity({ role: 'artist' });
  prepareFictionalDiscovery(author.id);
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === appOrigin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
  // This is instrumentation, not an OS grant. A regression can never show a
  // real permission dialog, subscribe a real endpoint or deliver a notification.
  await context.addInitScript(() => {
    Object.assign(window, { __permissionRequests: 0, __pushSubscriptions: 0 });
    if ('Notification' in window) {
      Object.defineProperty(Notification, 'requestPermission', {
        configurable: true,
        value: async () => {
          const state = window as typeof window & {
            __permissionRequests: number;
          };
          state.__permissionRequests += 1;
          Object.defineProperty(Notification, 'permission', {
            configurable: true,
            get: () => 'denied',
          });
          return 'denied';
        },
      });
    }
    if ('PushManager' in window) {
      Object.defineProperty(PushManager.prototype, 'subscribe', {
        configurable: true,
        value: async () => {
          const state = window as typeof window & {
            __pushSubscriptions: number;
          };
          state.__pushSubscriptions += 1;
          throw new Error('No real push subscriptions in this fixture');
        },
      });
    }
  });
});
test.afterEach(async () => {
  try {
    await clearFictionalDiscovery();
  } finally {
    disableFictionalPolicy();
  }
});

for (const width of [360, 414]) {
  for (const scale of ['normal', 'large', 'xlarge'] as const) {
    test(`real install guidance and complete onboarding: ${scale} at ${width}px`, async ({
      page,
      context,
      identity,
    }, info) => {
      const actor = await identity({
        onboarding_completed_at: null,
        call_name: null,
      });
      await prepareProfile(actor, scale);
      await actor.signIn(context);
      await page.setViewportSize({ width, height: 896 });
      await page.goto(routes.onboardingArtists);
      await page
        .getByRole('button', {
          name: messages.artists.selectAction.replace('{name}', main.name),
          exact: true,
        })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', {
          name: messages.artists.selectionConfirm,
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
      await expect(
        page.getByRole('heading', { name: copy.title, exact: true }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(
        page.getByText(copy.notificationNotEnabled, { exact: true }),
      ).toBeVisible();
      for (const choice of choices)
        await expect(
          page.getByRole('radio', { name: copy.choices[choice], exact: true }),
        ).not.toBeChecked();
      await expect(
        page.getByRole('button', { name: copy.complete, exact: true }),
      ).toBeDisabled();
      const before = await installState(actor);
      expect(before.choice).toBeNull();
      expect(before.onboarding_completed_at).toBeNull();
      await screenshot(page, info, `install-guidance-${scale}-${width}`);
      await saveChoice(page);
      const saved = await installState(actor);
      expect(saved.choice).toBe('acknowledged');
      expect(saved.acknowledged_at).not.toBeNull();
      expect(saved.installation_self_reported_at).toBeNull();
      expect(saved.onboarding_completed_at).toBeNull();
      await screenshot(page, info, `install-saved-${scale}-${width}`);
      const complete = page.getByRole('button', {
        name: copy.complete,
        exact: true,
      });
      const box = await complete.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
      await complete.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
      const done = await installState(actor);
      expect(done.onboarding_completed_at).not.toBeNull();
      expect(done.installation_self_reported_at).toBeNull();
      const client = await actor.actorClient();
      expect(
        (await client.rpc('has_active_access', { p_artist_id: main.id })).data,
      ).toBe(false);
      expect(discoveryStoredInterest(actor.id).subscriptions).toBe(0);
      await expect(
        page.getByText(messages.auth.featurePending, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: copy.homeTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(copy.guidanceLabels.acknowledged, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(copy.homeDescription, { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `install-completed-home-${scale}-${width}`);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __permissionRequests: number })
              .__permissionRequests,
        ),
      ).toBe(0);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __pushSubscriptions: number })
              .__pushSubscriptions,
        ),
      ).toBe(0);
      await page.goto(routes.onboardingInstall);
      await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
      expect((await installState(actor)).onboarding_completed_at).toBe(
        done.onboarding_completed_at,
      );
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

test('explicit skip is durable through Back, Forward, reload, logout and resume, without claiming installation', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor);
  await selectInterest(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingArtists);
  await page.goto(routes.onboardingInstall);
  await saveChoice(page, 'skipped');
  const saved = await installState(actor);
  expect(saved.choice).toBe('skipped');
  expect(saved.installation_self_reported_at).toBeNull();
  await page.reload();
  await expect(
    page.getByRole('radio', { name: copy.choices.skipped, exact: true }),
  ).toBeChecked();
  await page.goBack();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await page.goForward();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  await expect(
    page.getByRole('radio', { name: copy.choices.skipped, exact: true }),
  ).toBeChecked();
  await page
    .getByRole('button', { name: messages.onboarding.cancel, exact: true })
    .click();
  await expect(page).toHaveURL(/\/start\?reason=signed_out$/);
  await actor.signIn(context);
  await page.goto(routes.onboarding);
  await page
    .getByRole('button', { name: messages.onboarding.resume, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  expect(await installState(actor)).toEqual(saved);
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect((await installState(actor)).installation_self_reported_at).toBeNull();
});

test('self-reported install is recorded separately and remains only a user statement', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor);
  await selectInterest(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingInstall);
  await saveChoice(page, 'installed_self_reported');
  const state = await installState(actor);
  expect(state.choice).toBe('installed_self_reported');
  expect(state.installation_self_reported_at).not.toBeNull();
  expect(state.onboarding_completed_at).toBeNull();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests: number })
          .__permissionRequests,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect((await installState(actor)).installation_self_reported_at).toBe(
    state.installation_self_reported_at,
  );
});

test('a lost completion response is safely retried against the already-committed server result', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor);
  await selectInterest(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingInstall);
  await saveChoice(page);
  let outcome: 'pending' | 'committed' | 'failed' = 'pending';
  let intercepted = false;
  await page.route(`**${routes.installSubmit}`, async (route) => {
    if (route.request().postDataJSON()?.action !== 'complete' || intercepted)
      return route.continue();
    intercepted = true;
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
      if (response.status() !== 200) throw new Error('Real completion failed');
      const result = await response.json();
      if (result.ok !== true) throw new Error('Real completion failed');
      await route.abort('failed');
      outcome = 'committed';
    } catch {
      outcome = 'failed';
      await route.abort('failed').catch(() => {});
    }
  });
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect.poll(() => outcome).toBe('committed');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.UNAVAILABLE,
  );
  const committed = await installState(actor);
  expect(committed.onboarding_completed_at).not.toBeNull();
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect((await installState(actor)).onboarding_completed_at).toBe(
    committed.onboarding_completed_at,
  );
});

test('parallel repeated completion preserves the original timestamp and cannot create paid access', async ({
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor);
  await selectInterest(actor);
  await actor.signIn(context);
  const client = await actor.actorClient();
  expect(
    (
      await client.rpc('onboarding_acknowledge_install', {
        p_choice: 'acknowledged',
      })
    ).error,
  ).toBeNull();
  const responses = await Promise.all(
    [0, 1, 2].map(() =>
      context.request.post(routes.installSubmit, {
        headers: { Origin: appOrigin },
        data: { action: 'complete' },
      }),
    ),
  );
  for (const response of responses) {
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: routes.home });
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  const completed = (await installState(actor)).onboarding_completed_at;
  expect(completed).not.toBeNull();
  const repeat = await client.rpc('onboarding_complete');
  expect(repeat.error).toBeNull();
  expect(repeat.data).toBe(completed);
  expect(discoveryStoredInterest(actor.id).subscriptions).toBe(0);
});

for (const revoked of ['terms', 'artist', 'name'] as const) {
  test(`stale open install cannot complete after current ${revoked} is revoked`, async ({
    page,
    context,
    identity,
  }) => {
    const actor = await identity({
      onboarding_completed_at: null,
      call_name: null,
    });
    await prepareProfile(actor, 'large', '<b>팬</b>');
    await selectInterest(actor);
    await actor.signIn(context);
    await page.goto(routes.onboardingInstall);
    await saveChoice(page);
    if (revoked === 'terms') rotateFictionalTerms();
    else if (revoked === 'artist') pauseMainArtist();
    else invalidateFictionalCallingName();
    const failed = await context.request.post(routes.installSubmit, {
      headers: { Origin: appOrigin },
      data: { action: 'complete' },
    });
    expect(failed.status()).toBe(409);
    expect(await failed.json()).toEqual({
      ok: false,
      code: revoked === 'artist' ? 'INTEREST_REQUIRED' : 'PROFILE_REQUIRED',
    });
    expect(discoveryStoredInterest(actor.id).completed).toBeNull();
    await page
      .getByRole('button', { name: copy.complete, exact: true })
      .click();
    await expect(page).toHaveURL(
      `${appOrigin}${revoked === 'artist' ? routes.onboardingArtists : routes.onboarding}`,
    );
    if (revoked !== 'artist') {
      await page
        .getByRole('button', { name: messages.onboarding.resume, exact: true })
        .click();
      await expect(page).toHaveURL(
        `${appOrigin}${revoked === 'name' ? routes.onboardingName : routes.onboardingConsent}`,
      );
    }
    expect(discoveryStoredInterest(actor.id).completed).toBeNull();
  });
}

test('direct RPC, foreign origin and authority-bearing inputs cannot bypass prerequisite guidance', async ({
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  const client = await actor.actorClient();
  expect((await client.rpc('onboarding_complete')).error).not.toBeNull();
  await prepareProfile(actor);
  expect((await client.rpc('onboarding_complete')).error).not.toBeNull();
  await selectInterest(actor);
  expect((await client.rpc('onboarding_complete')).error).not.toBeNull();
  expect(
    (
      await client
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('id', actor.id)
    ).error,
  ).not.toBeNull();
  for (const origin of [undefined, 'null', 'https://evil.example']) {
    const response = await context.request.post(routes.installSubmit, {
      headers: origin ? { Origin: origin } : {},
      data: { action: 'complete' },
    });
    expect(response.status()).toBe(403);
  }
  for (const body of [
    { action: 'complete', actorId: actor.id },
    { action: 'complete', role: 'admin' },
    { action: 'acknowledge', choice: 'installed' },
    {
      action: 'acknowledge',
      choice: 'acknowledged',
      notificationGranted: true,
    },
    { action: 'complete', completedAt: new Date().toISOString() },
  ]) {
    const response = await context.request.post(routes.installSubmit, {
      headers: { Origin: appOrigin },
      data: body,
    });
    expect(response.status()).toBe(400);
  }
  expect((await installState(actor)).choice).toBeNull();
  expect(discoveryStoredInterest(actor.id).completed).toBeNull();
});

test('iOS manual guidance without a permission request remains optional (simulated browser capability, not a device install)', async ({
  page,
  context,
  identity,
}, info) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () =>
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    });
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      get: () => false,
    });
  });
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor, 'xlarge');
  await selectInterest(actor);
  await actor.signIn(context);
  await page.setViewportSize({ width: 360, height: 896 });
  await page.goto(routes.onboardingInstall);
  await expect(
    page.getByText(copy.notificationAfterInstall, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: copy.notificationAction, exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests: number })
          .__permissionRequests,
    ),
  ).toBe(0);
  await screenshot(page, info, 'install-ios-guidance-simulated-xlarge-360');
  await saveChoice(page, 'skipped');
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect((await installState(actor)).installation_self_reported_at).toBeNull();
});

test('only an explicit permission click calls the denied test stub; it never enables push or blocks completion', async ({
  page,
  context,
  identity,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(Notification, 'permission', {
      configurable: true,
      get: () => 'default',
    });
  });
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await prepareProfile(actor);
  await selectInterest(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingInstall);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests: number })
          .__permissionRequests,
    ),
  ).toBe(0);
  await page
    .getByRole('button', { name: copy.notificationAction, exact: true })
    .click();
  await expect(
    page.getByText(copy.notificationStates.denied, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests: number })
          .__permissionRequests,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __pushSubscriptions: number })
          .__pushSubscriptions,
    ),
  ).toBe(0);
  await expect(
    page.getByText(copy.notificationNotEnabled, { exact: true }),
  ).toBeVisible();
  await saveChoice(page, 'acknowledged');
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect((await installState(actor)).onboarding_completed_at).not.toBeNull();
});

test('one uninterrupted browser journey completes profile, consent, interest and guidance without installation or permission', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  await page.goto(routes.onboardingFont);
  await page
    .getByRole('button', { name: messages.onboarding.continue, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
  await page
    .getByRole('textbox', { name: messages.onboarding.nameLabel, exact: true })
    .fill('허구팬');
  await page
    .getByRole('button', { name: messages.onboarding.continue, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  for (const label of [
    messages.onboarding.ageLabel,
    messages.onboarding.termsLabel,
    messages.onboarding.privacyLabel,
  ]) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
  }
  await expect(
    page.getByRole('checkbox', {
      name: messages.onboarding.analyticsLabel,
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByRole('button', { name: messages.onboarding.continue, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await page
    .getByRole('button', {
      name: messages.artists.selectAction.replace('{name}', main.name),
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', {
      name: messages.artists.selectionConfirm,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  await saveChoice(page, 'skipped');
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  const state = await installState(actor);
  expect(state.choice).toBe('skipped');
  expect(state.onboarding_completed_at).not.toBeNull();
  expect(state.installation_self_reported_at).toBeNull();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __permissionRequests: number })
          .__permissionRequests,
    ),
  ).toBe(0);
  const client = await actor.actorClient();
  expect((await client.rpc('analytics_get_consent')).data?.[0]?.granted).toBe(
    false,
  );
  expect(discoveryStoredInterest(actor.id).subscriptions).toBe(0);
});

test('real authenticated HTML, completion API and personalized RSC never enter the public worker cache', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  const callName = '비공개허구팬';
  await prepareProfile(actor, 'large', callName);
  await selectInterest(actor);
  await actor.signIn(context);
  const installResponse = await page.goto(routes.onboardingInstall);
  expect(installResponse?.headers()['cache-control']).toContain('no-store');
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === 'activated',
  );
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      scope: registration.scope,
      script: registration.active?.scriptURL,
    };
  });
  expect(worker).toEqual({
    scope: `${appOrigin}/`,
    script: `${appOrigin}${PWA.workerUrl}`,
  });
  await saveChoice(page);
  await page.getByRole('button', { name: copy.complete, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  await expect(
    page.getByText(copy.guidanceLabels.acknowledged, { exact: true }),
  ).toBeVisible();
  const home = await page.reload();
  expect(home?.headers()['cache-control']).toContain('no-store');
  const previewPath = artistPreviewPath(main.slug);
  const preview = await page.goto(previewPath);
  expect(preview?.headers()['cache-control']).toContain('no-store');
  const personalText = discoveryFixtures.body.replaceAll('{이름}', callName);
  await expect(page.getByText(personalText, { exact: true })).toBeVisible();
  await page.goto(routes.artists);
  const rscPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === previewPath &&
      response.request().headers().rsc === '1',
  );
  await page
    .getByRole('button', {
      name: messages.artists.previewAction.replace('{name}', main.name),
      exact: true,
    })
    .click();
  const rsc = await rscPromise;
  expect(rsc.status()).toBe(200);
  expect(rsc.headers()['content-type']).toContain('text/x-component');
  expect(rsc.headers()['cache-control']).toContain('no-store');
  // Read while this response's document is still active, before any further
  // navigation. This is a real browser RSC response, not a fulfilled fixture.
  expect((await rsc.text()).includes(callName)).toBe(true);
  await expect(page.getByText(personalText, { exact: true })).toBeVisible();
  const cached = await page.evaluate(
    async ({ cacheName, sentinels }) => {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      let privateContent = false;
      for (const request of requests) {
        const response = await cache.match(request);
        const body = (await response?.text()) ?? '';
        privateContent ||= sentinels.some((sentinel) =>
          body.includes(sentinel),
        );
      }
      return {
        urls: requests.map((request) => request.url).sort(),
        privateContent,
      };
    },
    {
      cacheName: PWA.cacheName,
      sentinels: [
        actor.id,
        actor.email,
        callName,
        main.name,
        personalText,
        discoveryFixtures.privatePath,
      ],
    },
  );
  expect(cached.urls.length).toBeGreaterThan(1);
  expect(cached.privateContent).toBe(false);
  for (const value of cached.urls) {
    const url = new URL(value);
    expect(url.origin).toBe(appOrigin);
    if (url.pathname === PWA.offlineUrl)
      expect([...url.searchParams.keys()]).toEqual(['__WB_REVISION__']);
    else {
      expect(PWA.staticAssetPattern.test(url.pathname)).toBe(true);
      expect(url.search).toBe('');
    }
  }
  const asset = cached.urls.find((url) => url.endsWith('.js'))!;
  await context.setOffline(true);
  try {
    // Probe before navigating: the intentionally strict static fallback CSP
    // disallows all connect-src, so probing there would mask worker behavior.
    const outcomes = await page.evaluate(
      async ({ api, preview, assetUrl }) => {
        const get = async (url: string, headers?: Record<string, string>) => {
          try {
            const response = await fetch(url, {
              cache: 'no-store',
              ...(headers ? { headers } : {}),
            });
            return { resolved: true, status: response.status };
          } catch {
            return { resolved: false };
          }
        };
        return {
          asset: await get(assetUrl),
          api: await get(api),
          rsc: await get(`${preview}?_rsc=private-cache-probe`, { RSC: '1' }),
          headerRsc: await get(assetUrl, { RSC: '1' }),
        };
      },
      { api: routes.installSubmit, preview: previewPath, assetUrl: asset },
    );
    expect(outcomes.asset).toEqual({ resolved: true, status: 200 });
    for (const [name, outcome] of Object.entries(outcomes))
      if (name !== 'asset') expect(outcome, name).toEqual({ resolved: false });
    const navigation = await page.goto(routes.home);
    expect(navigation?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages.pwaOffline.title,
    );
    await expect(
      page.getByText(messages.pwaOffline.privacy, { exact: true }),
    ).toBeVisible();
    const fallback = await page.locator('body').innerText();
    for (const sentinel of [
      callName,
      main.name,
      actor.email,
      actor.id,
      personalText,
      copy.homeTitle,
    ])
      expect(fallback.includes(sentinel)).toBe(false);
    const after = await page.evaluate(
      async (cacheName) =>
        (await (await caches.open(cacheName)).keys())
          .map((request) => request.url)
          .sort(),
      PWA.cacheName,
    );
    expect(after).toEqual(cached.urls);
  } finally {
    await context.setOffline(false);
  }
});
