import type { Page } from '@playwright/test';
import { test, expect, appOrigin } from './fixtures';
import {
  disableLegalPolicy,
  enableLegalPolicy,
  legalFixtures,
  prepareLegalDocuments,
  readLegalConsentEvidence,
} from './legal-document-fixtures';
import { legalDocumentPath, routes } from '../../../src/config/routes';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const copy = messages.legalDocuments;
const terms = legalDocumentPath('terms');
const privacy = legalDocumentPath('privacy');
const exactTerms = legalDocumentPath('terms', legalFixtures.terms);
const link = (page: Page, path: string) =>
  page.locator(`a[href="${path}"]`).first();

async function expectTerms(page: Page) {
  await expect(
    page.getByRole('heading', { name: legalFixtures.termsTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(legalFixtures.newerTitle, { exact: true }),
  ).toHaveCount(0);
}

test.beforeAll(() => prepareLegalDocuments());
test.beforeEach(async ({ context }) => {
  enableLegalPolicy();
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === appOrigin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
});
test.afterEach(() => disableLegalPolicy());

test('anonymous current links follow policy pointers and exact public versions render only escaped text', async ({
  page,
}) => {
  await page.goto(routes.start);
  await link(page, terms).click();
  await expect(page).toHaveURL(`${appOrigin}${terms}`);
  await expectTerms(page);
  await expect(
    page.getByText(legalFixtures.markup, { exact: false }),
  ).toBeVisible();
  await expect(page.locator('img[src="/never-legal-image"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.hasOwn(window, 'legalMarkupExecuted')),
  ).toBe(false);
  await link(page, exactTerms).click();
  await expect(page).toHaveURL(`${appOrigin}${exactTerms}`);
  await expectTerms(page);
  await page.goto(legalDocumentPath('terms', legalFixtures.historicalTerms));
  await expect(
    page.getByRole('heading', {
      name: legalFixtures.historicalTitle,
      exact: true,
    }),
  ).toBeVisible();
  await link(page, terms).click();
  await expectTerms(page);
  await page.goto(routes.start);
  await link(page, privacy).click();
  await expect(
    page.getByRole('heading', {
      name: legalFixtures.privacyTitle,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('missing current setup can retry while unknown wrong-kind draft and future versions remain undisclosed', async ({
  page,
}) => {
  disableLegalPolicy();
  await page.goto(terms);
  await expect(
    page.getByText(copy.notConfigured, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: legalFixtures.termsTitle, exact: true }),
  ).toHaveCount(0);
  enableLegalPolicy();
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expectTerms(page);
  for (const path of [
    legalDocumentPath('terms', legalFixtures.missing),
    legalDocumentPath('terms', 'not-a-version'),
    legalDocumentPath('privacy', legalFixtures.terms),
    legalDocumentPath('terms', legalFixtures.draft),
    legalDocumentPath('terms', legalFixtures.future),
    legalDocumentPath('terms', legalFixtures.analytics),
  ]) {
    const response = await page.goto(path);
    const source = await response!.text();
    await expect(page.getByText(copy.notFound, { exact: true })).toBeVisible();
    for (const secret of [
      legalFixtures.draftSecret,
      legalFixtures.futureSecret,
      legalFixtures.analyticsSecret,
    ]) {
      expect(source).not.toContain(secret);
      await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
    }
    await expect(
      page.getByRole('heading', {
        name: legalFixtures.termsTitle,
        exact: true,
      }),
    ).toHaveCount(0);
  }
});

test('interrupted and repeated document navigation preserves the newer URL through Back Forward and reload', async ({
  page,
}) => {
  await page.goto(routes.start);
  let release!: () => void;
  let arrived!: () => void;
  let settled!: (value: { error?: unknown }) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const completed = new Promise<{ error?: unknown }>((resolve) => {
    settled = resolve;
  });
  await page.route(
    (url) => url.pathname === terms,
    async (route) => {
      let terminalActionStarted = false;
      try {
        // Hold real server bytes, never synthesize a successful legal response.
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
        const body = Buffer.from(await response.body());
        expect(response.status()).toBe(200);
        expect(body.toString('utf8')).toContain(legalFixtures.termsTitle);
        arrived();
        await gate;
        terminalActionStarted = true;
        await route.fulfill({ response, body });
        settled({});
      } catch (error) {
        let failure = error;
        if (!terminalActionStarted) {
          try {
            await route.abort();
          } catch (abortError) {
            failure = new AggregateError(
              [error, abortError],
              'Legal response cleanup failed.',
            );
          }
        }
        arrived();
        settled({ error: failure });
      }
    },
    { times: 1 },
  );
  await link(page, terms).click();
  await received;
  try {
    await link(page, privacy).click();
    await expect(page).toHaveURL(`${appOrigin}${privacy}`);
    await expect(
      page.getByRole('heading', {
        name: legalFixtures.privacyTitle,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    release();
  }
  const outcome = await completed;
  if (outcome.error) throw outcome.error;
  await expect(page).toHaveURL(`${appOrigin}${privacy}`);
  await expect(
    page.getByRole('heading', { name: legalFixtures.termsTitle, exact: true }),
  ).toHaveCount(0);
  await page.goto(terms);
  await link(page, exactTerms).click();
  await expect(page).toHaveURL(`${appOrigin}${exactTerms}`);
  await link(page, terms).click();
  await expect(page).toHaveURL(`${appOrigin}${terms}`);
  await link(page, exactTerms).click();
  await expect(page).toHaveURL(`${appOrigin}${exactTerms}`);
  await page.goBack();
  await expect(page).toHaveURL(`${appOrigin}${terms}`);
  await expectTerms(page);
  await page.goForward();
  await expect(page).toHaveURL(`${appOrigin}${exactTerms}`);
  await expectTerms(page);
  await page.reload();
  await expectTerms(page);
});

test('onboarding exact-version reading returns safely without recording consent and account links remain public readers', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
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
  await page.goto(routes.onboardingConsent);
  const evidence = readLegalConsentEvidence(actor.id);
  expect(evidence).toEqual({
    accepted: 0,
    profileCompleted: null,
    onboardingCompleted: null,
    ageAttested: null,
  });
  const consentTerms = page.getByRole('checkbox', {
    name: messages.onboarding.termsLabel,
    exact: true,
  });
  await consentTerms.check();
  const exactOnboarding = legalDocumentPath(
    'terms',
    legalFixtures.terms,
    'onboarding',
  );
  await link(page, exactOnboarding).click();
  await expect(page).toHaveURL(`${appOrigin}${exactOnboarding}`);
  await expectTerms(page);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  await expect(consentTerms).not.toBeChecked();
  expect(readLegalConsentEvidence(actor.id)).toEqual(evidence);

  const completed = await identity();
  await completed.signIn(context);
  const completedEvidence = readLegalConsentEvidence(completed.id);
  await page.goto(routes.home);
  const accountTerms = legalDocumentPath('terms', undefined, 'account');
  await link(page, accountTerms).click();
  await expect(page).toHaveURL(`${appOrigin}${accountTerms}`);
  await expectTerms(page);
  await page
    .getByRole('button', { name: messages.ui.back, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  expect(readLegalConsentEvidence(completed.id)).toEqual(completedEvidence);
});

for (const scale of ['normal', 'large', 'xlarge'] as const) {
  test(`legal document is readable at ${scale} text and 360px`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      { name: FONT_SCALE_COOKIE, value: scale, url: appOrigin },
    ]);
    await page.setViewportSize({ width: 360, height: 896 });
    await page.goto(terms);
    await expectTerms(page);
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
    await expect(
      page.getByText(legalFixtures.longToken, { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const target of await page.locator('main a, main button').all()) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    }
    await page.screenshot({
      path: info.outputPath(`legal-document-${scale}-360.png`),
      fullPage: true,
    });
  });
}
