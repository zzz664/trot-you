import type { Page, TestInfo } from '@playwright/test';
import { test, expect, appOrigin, type Identity } from './fixtures';
import {
  disableFictionalPolicy,
  enableFictionalPolicy,
  onboardingFixtures,
  prepareFictionalDocuments,
  rotateFictionalTerms,
} from './onboarding-fixtures';
import { routes } from '../../../src/config/routes';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const copy = messages.onboarding;
const consentInput = {
  step: 'consent',
  ageConfirmed: true,
  termsAccepted: true,
  privacyAccepted: true,
  termsVersion: onboardingFixtures.terms,
  privacyVersion: onboardingFixtures.privacy,
  analyticsAccepted: false,
  analyticsVersion: onboardingFixtures.analytics,
};

async function ownProfile(actor: Identity) {
  const client = await actor.actorClient();
  const { data, error } = await client
    .from('profiles')
    .select(
      'call_name,font_scale,font_selected_at,age_self_attested_at,profile_completed_at,onboarding_completed_at,role',
    )
    .eq('id', actor.id)
    .single();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return data!;
}

async function saveFontAndName(page: Page, name = '허구팬') {
  await page.goto(routes.onboardingFont);
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
  await page.getByRole('textbox', { name: copy.nameLabel }).fill(name);
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
}

async function acceptRequired(page: Page) {
  for (const label of [copy.ageLabel, copy.termsLabel, copy.privacyLabel]) {
    const checkbox = page.getByRole('checkbox', { name: label, exact: true });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
  }
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
test.beforeEach(async ({ context }) => {
  enableFictionalPolicy();
  // Even a product bug cannot contact a provider or external analytics here.
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === appOrigin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
});
test.afterEach(() => disableFictionalPolicy());

for (const width of [360, 414]) {
  for (const scale of ['normal', 'large', 'xlarge'] as const) {
    test(`profile stages persist ${scale} at ${width}px without completing all onboarding`, async ({
      page,
      context,
      identity,
    }, info) => {
      const actor = await identity({
        onboarding_completed_at: null,
        call_name: null,
      });
      await actor.signIn(context);
      await page.setViewportSize({ width, height: 896 });
      await page.goto(routes.onboarding);
      await expect(page).toHaveURL(`${appOrigin}${routes.onboarding}`);
      await page
        .getByRole('button', { name: copy.resume, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingFont}`);
      const radio = page.getByRole('radio', {
        name: copy.fontOptions[scale],
        exact: true,
      });
      await radio.focus();
      await page.keyboard.press('Space');
      await expect(radio).toBeChecked();
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await screenshot(page, info, `profile-font-${scale}-${width}`);
      const next = page.getByRole('button', {
        name: copy.continue,
        exact: true,
      });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
      const response = await page.reload();
      expect(await response!.text()).toContain(`data-font-scale="${scale}"`);
      expect(
        (await context.cookies()).find(
          (cookie) => cookie.name === FONT_SCALE_COOKIE,
        )?.value,
      ).toBe(scale);
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await page.getByRole('textbox', { name: copy.nameLabel }).fill('허구팬');
      await screenshot(page, info, `profile-name-${scale}-${width}`);
      await page
        .getByRole('button', { name: copy.continue, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
      await expect(
        page.getByRole('checkbox', { name: copy.analyticsLabel }),
      ).not.toBeChecked();
      await expect(
        page.getByText(onboardingFixtures.terms, { exact: false }),
      ).toBeVisible();
      await expect(
        page.getByText('자동화 점검용 허구 이용약관', { exact: true }),
      ).toBeVisible();
      await screenshot(page, info, `profile-consent-${scale}-${width}`);
      await acceptRequired(page);
      await page
        .getByRole('button', { name: copy.continue, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
      await expect(page.getByText(copy.profileSavedDescription)).toBeVisible();
      const completed = await ownProfile(actor);
      expect(completed.call_name).toBe('허구팬');
      expect(completed.font_scale).toBe(scale);
      expect(completed.font_selected_at).not.toBeNull();
      expect(completed.age_self_attested_at).not.toBeNull();
      expect(completed.profile_completed_at).not.toBeNull();
      expect(completed.onboarding_completed_at).toBeNull();
      expect(completed.role).toBe('fan');
      const client = await actor.actorClient();
      const consent = await client.rpc('analytics_get_consent');
      expect(consent.error).toBeNull();
      expect(consent.data?.[0]?.granted).toBe(false);
      // Repeated simultaneous submission must not duplicate acceptance or move
      // the first completion/attestation time. No signup-complete is emitted.
      const repeats = await Promise.all(
        [0, 1].map(() =>
          context.request.post(routes.onboardingSubmit, {
            headers: { Origin: appOrigin },
            data: consentInput,
          }),
        ),
      );
      for (const repeat of repeats) expect(repeat.status()).toBe(200);
      expect((await ownProfile(actor)).profile_completed_at).toBe(
        completed.profile_completed_at,
      );
      expect((await ownProfile(actor)).age_self_attested_at).toBe(
        completed.age_self_attested_at,
      );
      for (const path of [
        routes.home,
        routes.admin,
        routes.artist,
        routes.onboarding,
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(`${appOrigin}${routes.onboarding}`);
        await page
          .getByRole('button', { name: copy.resume, exact: true })
          .click();
        await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
      }
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

test('interrupted steps resume after Back, Forward, cancel and another login', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  for (const path of [
    routes.onboardingName,
    routes.onboardingConsent,
    routes.onboardingArtists,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}${routes.onboardingFont}`);
  }
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboarding}`);
  await page.getByRole('button', { name: copy.resume, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingFont}`);
  await saveFontAndName(page);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
  await expect(page.getByRole('textbox', { name: copy.nameLabel })).toHaveValue(
    '허구팬',
  );
  await page.getByRole('textbox', { name: copy.nameLabel }).fill('저장안함');
  await page.reload();
  await expect(page.getByRole('textbox', { name: copy.nameLabel })).toHaveValue(
    '허구팬',
  );
  await page.goto(routes.onboardingConsent);
  await page.goBack();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
  await page.goForward();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  await page.getByRole('checkbox', { name: copy.ageLabel }).check();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: copy.ageLabel }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: copy.cancel }).click();
  await expect(page).toHaveURL(/\/start\?reason=signed_out$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/start(?:\?|$)/);
  await actor.signIn(context);
  await page.goto(routes.onboarding);
  await page.getByRole('button', { name: copy.resume, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  expect((await ownProfile(actor)).profile_completed_at).toBeNull();
});

test('server validates names and age, keeps failed input and offers a large real retry', async ({
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
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  const name = page.getByRole('textbox', { name: copy.nameLabel });
  for (const [value, error] of [
    ['한', copy.errors.NAME_INVALID],
    ['금칙예시팬', copy.errors.NAME_FORBIDDEN],
    ['열한글자이상의부를이름', copy.errors.NAME_INVALID],
  ]) {
    await name.fill(value!);
    await page
      .getByRole('button', { name: copy.continue, exact: true })
      .click();
    await expect(page.getByRole('alert')).toHaveText(error!);
    await expect(name).toHaveValue(value!);
    expect((await ownProfile(actor)).call_name).toBeNull();
  }
  await name.fill('허구팬');
  await page.route(`**${routes.onboardingSubmit}`, (route) =>
    route.abort('failed'),
  );
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(copy.errors.UNAVAILABLE);
  await expect(name).toHaveValue('허구팬');
  await page.unroute(`**${routes.onboardingSubmit}`);
  const retry = page.getByRole('button', {
    name: messages.ui.retry,
    exact: true,
  });
  const box = await retry.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  expect(box!.width).toBeGreaterThanOrEqual(48);
  await retry.click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(copy.errors.AGE_REQUIRED);
  await page.getByRole('checkbox', { name: copy.ageLabel }).check();
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    copy.errors.CONSENT_REQUIRED,
  );
  expect((await ownProfile(actor)).profile_completed_at).toBeNull();
});

test('missing configuration fails closed and displayed consent cannot accept a new unseen policy version', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  disableFictionalPolicy();
  await page.goto(routes.onboardingFont);
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(copy.setupNotReady);
  await expect(
    page.getByRole('button', { name: copy.continue, exact: true }),
  ).toBeDisabled();
  const unavailable = await context.request.post(routes.onboardingSubmit, {
    headers: { Origin: appOrigin },
    data: { step: 'name', callName: '허구팬' },
  });
  expect(unavailable.status()).toBe(503);
  expect(await unavailable.json()).toMatchObject({
    ok: false,
    code: 'SETUP_NOT_READY',
  });
  enableFictionalPolicy();
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: copy.continue, exact: true }),
  ).toBeEnabled();
  await page.getByRole('textbox', { name: copy.nameLabel }).fill('허구팬');
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  disableFictionalPolicy();
  await page.reload();
  await expect(page.getByRole('alert')).toHaveText(copy.setupNotReady);
  await expect(
    page.getByRole('checkbox', { name: copy.termsLabel }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: copy.continue, exact: true }),
  ).toBeDisabled();
  enableFictionalPolicy();
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await acceptRequired(page);
  rotateFictionalTerms();
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(copy.errors.POLICY_CHANGED);
  expect((await ownProfile(actor)).profile_completed_at).toBeNull();
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(
    page.getByText('자동화 점검용 새 허구 이용약관', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: copy.termsLabel }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: copy.privacyLabel }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: copy.analyticsLabel }),
  ).not.toBeChecked();
});

test('real actor RPC rejects false age, unknown versions, role and completion escalation', async ({
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  const other = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  const client = await actor.actorClient();
  expect(
    (await client.rpc('onboarding_save_font', { p_font_scale: 'large' })).error,
  ).toBeNull();
  expect(
    (await client.rpc('onboarding_save_name', { p_call_name: '허구팬' })).error,
  ).toBeNull();
  const rpcInput = {
    p_age_over_14: true,
    p_terms_accepted: true,
    p_terms_version: onboardingFixtures.terms,
    p_privacy_accepted: true,
    p_privacy_version: onboardingFixtures.privacy,
    p_analytics_granted: false,
    p_analytics_version: onboardingFixtures.analytics,
  };
  expect(
    (
      await client.rpc('onboarding_complete_profile', {
        ...rpcInput,
        p_age_over_14: false,
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await client.rpc('onboarding_complete_profile', {
        ...rpcInput,
        p_terms_version: 'a1100000-0000-4000-8000-000000000099',
      })
    ).error,
  ).not.toBeNull();
  for (const patch of [
    { role: 'admin' as const },
    { onboarding_completed_at: new Date().toISOString() },
    { profile_completed_at: new Date().toISOString() },
    { age_self_attested_at: new Date().toISOString() },
    { call_name: '금칙예시팬' },
  ])
    expect(
      (await client.from('profiles').update(patch).eq('id', actor.id)).error,
    ).not.toBeNull();
  expect(
    (await client.rpc('onboarding_save_name', { p_call_name: '금칙예시팬' }))
      .error,
  ).not.toBeNull();
  for (const origin of [undefined, 'null', 'https://evil.example']) {
    const response = await context.request.post(routes.onboardingSubmit, {
      headers: origin ? { Origin: origin } : {},
      data: consentInput,
    });
    expect(response.status()).toBe(403);
  }
  const injected = await context.request.post(routes.onboardingSubmit, {
    headers: { Origin: appOrigin },
    data: {
      step: 'font',
      fontScale: 'normal',
      userId: other.id,
      role: 'admin',
      onboardingCompleted: true,
    },
  });
  expect(injected.status()).toBe(400);
  expect((await ownProfile(actor)).profile_completed_at).toBeNull();
  expect((await ownProfile(other)).call_name).toBeNull();
  expect((await ownProfile(other)).font_selected_at).toBeNull();
});

test('optional analytics requires its own unchecked choice and exact readable version', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await actor.signIn(context);
  await saveFontAndName(page);
  const optional = page.getByRole('checkbox', {
    name: copy.analyticsLabel,
    exact: true,
  });
  await expect(optional).not.toBeChecked();
  const client = await actor.actorClient();
  expect((await client.rpc('analytics_get_consent')).data?.[0]?.granted).toBe(
    false,
  );
  await acceptRequired(page);
  await optional.focus();
  await page.keyboard.press('Space');
  await expect(optional).toBeChecked();
  await page.getByRole('button', { name: copy.continue, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  const accepted = await client.rpc('analytics_get_consent');
  expect(accepted.error).toBeNull();
  expect(accepted.data?.[0]).toMatchObject({
    granted: true,
    consent_version: onboardingFixtures.analytics,
  });
  expect((await ownProfile(actor)).onboarding_completed_at).toBeNull();
});
