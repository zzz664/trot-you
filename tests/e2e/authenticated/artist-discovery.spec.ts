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
  hideFictionalCatalog,
  invalidateFictionalCallingName,
  pauseMainArtist,
  prepareFictionalDiscovery,
  removeFictionalMessagePolicy,
} from './discovery-fixtures';
import {
  artistCatalogPath,
  artistPreviewPath,
  routes,
} from '../../../src/config/routes';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const copy = messages.artists;
const main = discoveryFixtures.main;
const selectLabel = (name: string) => copy.selectAction.replace('{name}', name);
const previewLabel = (name: string) =>
  copy.previewAction.replace('{name}', name);

async function finishProfile(
  actor: Identity,
  scale: 'normal' | 'large' | 'xlarge' = 'normal',
  callName = '<b>팬</b>',
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

async function takeScreenshot(page: Page, info: TestInfo, name: string) {
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

async function openSelection(page: Page, name: string = main.name) {
  await page
    .getByRole('button', { name: selectLabel(name), exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: copy.selectionDialogTitle });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function confirmSelection(page: Page, name: string = main.name) {
  const dialog = await openSelection(page, name);
  await dialog
    .getByRole('button', { name: copy.selectionConfirm, exact: true })
    .click();
}

test.beforeAll(() => prepareFictionalDocuments());
test.beforeEach(async ({ context, identity }) => {
  enableFictionalPolicy();
  const author = await identity({ role: 'artist' });
  prepareFictionalDiscovery(author.id);
  // No external provider, analytics, licensed image or unknown image origin.
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === appOrigin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
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
    test(`real discovery, escaped preview and durable interest: ${scale} at ${width}px`, async ({
      page,
      context,
      identity,
    }, info) => {
      const actor = await identity({
        onboarding_completed_at: null,
        call_name: null,
      });
      await finishProfile(actor, scale);
      await actor.signIn(context);
      await page.setViewportSize({ width, height: 896 });
      const catalog = await page.goto(routes.onboardingArtists);
      expect(catalog?.headers()['cache-control']).toContain('no-store');
      await expect(
        page.getByRole('heading', { name: copy.onboardingTitle }),
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(
        page.getByText(copy.interestNotice, { exact: true }),
      ).toBeVisible();
      const preview = page.getByRole('button', {
        name: previewLabel(main.name),
        exact: true,
      });
      const box = await preview.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(48);
      expect(box!.height).toBeGreaterThanOrEqual(48);
      await takeScreenshot(page, info, `discovery-catalog-${scale}-${width}`);
      await preview.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(
        `${appOrigin}${artistPreviewPath(main.slug)}`,
      );
      const rendered = discoveryFixtures.body.replaceAll('{이름}', '<b>팬</b>');
      await expect(page.getByText(rendered, { exact: true })).toBeVisible();
      await expect(
        page.getByText(rendered, { exact: true }).locator('script,b'),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => Object.hasOwn(window, '__previewXss')),
      ).toBe(false);
      const body = await page.getByRole('main').innerText();
      expect(body).not.toContain('{이름}');
      expect(body).not.toContain(discoveryFixtures.privateSentinel);
      expect(body).not.toContain(discoveryFixtures.privatePath);
      expect(body).not.toContain(discoveryFixtures.contract);
      expect(body).not.toContain(actor.id);
      expect(body).not.toContain(actor.email);
      for (const kind of [
        copy.messageKinds.photo,
        copy.messageKinds.voice,
        copy.messageKinds.video,
      ]) {
        await expect(
          page.getByText(copy.mediaUnavailable.replace('{kind}', kind), {
            exact: true,
          }),
        ).toBeVisible();
      }
      await expect(page.locator('main img,main audio,main video')).toHaveCount(
        0,
      );
      await takeScreenshot(page, info, `discovery-preview-${scale}-${width}`);
      const dialog = await openSelection(page);
      await takeScreenshot(page, info, `discovery-confirm-${scale}-${width}`);
      await dialog
        .getByRole('button', { name: copy.selectionConfirm, exact: true })
        .click();
      await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
      await expect(
        page.getByRole('heading', { name: copy.installTitle }),
      ).toBeVisible();
      await expect(
        page.getByText(copy.installPendingDescription, { exact: true }),
      ).toBeVisible();
      const saved = discoveryStoredInterest(actor.id);
      expect(saved).toMatchObject({
        artistId: main.id,
        subscriptions: 0,
        completed: null,
      });
      expect(saved.selectedAt).not.toBeNull();
      const client = await actor.actorClient();
      expect(
        (await client.rpc('has_active_access', { p_artist_id: main.id })).data,
      ).toBe(false);
      await takeScreenshot(
        page,
        info,
        `discovery-install-pending-${scale}-${width}`,
      );
      await page.reload();
      await expect(
        page.getByRole('heading', { name: copy.installTitle }),
      ).toBeVisible();
      expect(discoveryStoredInterest(actor.id)).toEqual(saved);
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

test('public safe catalog paginates without private fields and requires login for personalized preview', async ({
  page,
}) => {
  const first = await page.goto(routes.artists);
  await expect(
    page.getByRole('heading', { name: copy.catalogTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: main.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: selectLabel(main.name), exact: true }),
  ).toHaveCount(0);
  const html = await first!.text();
  for (const forbidden of [
    discoveryFixtures.privatePath,
    discoveryFixtures.contract,
    ...discoveryFixtures.hiddenSlugs,
  ]) {
    expect(html).not.toContain(forbidden);
  }
  await page.getByRole('button', { name: copy.nextPage, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${artistCatalogPath(2)}`);
  await expect(
    page.getByRole('heading', { name: '허구 가수 14', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: copy.previousPage, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.artists}`);
  await page
    .getByRole('button', { name: previewLabel(main.name), exact: true })
    .click();
  await expect(page).toHaveURL(/\/start(?:\?|$)/);
});

test('selection dialog cancel, Close and Back do not save; resume and repeat preserve one choice', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  await page.goto(routes.onboarding);
  await page.goto(routes.onboardingArtists);
  for (const dismissal of [messages.ui.cancel, messages.ui.close]) {
    const dialog = await openSelection(page);
    await dialog.getByRole('button', { name: dismissal, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(discoveryStoredInterest(actor.id).artistId).toBeNull();
    await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  }
  await openSelection(page);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(discoveryStoredInterest(actor.id).artistId).toBeNull();
  await page.goto(routes.onboardingArtists);
  await page.getByRole('button', { name: copy.nextPage, exact: true }).click();
  await expect(page).toHaveURL(`${appOrigin}${artistCatalogPath(2, true)}`);
  await openSelection(page, '허구 가수 14');
  // Browser Back changes only ?page, not pathname. A stale global modal must
  // not survive that navigation or submit a choice from the abandoned page.
  await page.goBack();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(discoveryStoredInterest(actor.id).artistId).toBeNull();
  await confirmSelection(page);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  const first = discoveryStoredInterest(actor.id);
  await page
    .getByRole('button', { name: copy.changeSelection, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await expect(
    page.getByText(copy.selectedSummary.replace('{name}', main.name), {
      exact: true,
    }),
  ).toBeVisible();
  const repeated = await Promise.all(
    [0, 1].map(() =>
      context.request.post(routes.artistSelectionSubmit, {
        headers: { Origin: appOrigin },
        data: { slug: main.slug },
      }),
    ),
  );
  for (const response of repeated) {
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: routes.onboardingInstall,
    });
  }
  expect(discoveryStoredInterest(actor.id)).toEqual(first);
  await page.goto(routes.onboarding);
  await page
    .getByRole('button', { name: messages.onboarding.resume, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  await context.clearCookies();
  await actor.signIn(context);
  await page.goto(routes.onboarding);
  await page
    .getByRole('button', { name: messages.onboarding.resume, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  await page
    .getByRole('button', { name: copy.changeSelection, exact: true })
    .click();
  await confirmSelection(page, discoveryFixtures.empty.name);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  expect(discoveryStoredInterest(actor.id)).toMatchObject({
    artistId: discoveryFixtures.empty.id,
    subscriptions: 0,
    completed: null,
  });
});

test('a committed save with a lost response offers an idempotent real retry', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingArtists);
  await page.route(`**${routes.artistSelectionSubmit}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  await confirmSelection(page);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.selectionUncertain,
  );
  const committed = discoveryStoredInterest(actor.id);
  expect(committed.artistId).toBe(main.id);
  await page.unroute(`**${routes.artistSelectionSubmit}`);
  await page
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  expect(discoveryStoredInterest(actor.id)).toEqual(committed);
});

test('artist paused after display cannot be selected, and a saved inactive interest cannot advance', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingArtists);
  await page.route(`**${routes.artistSelectionSubmit}`, async (route) => {
    pauseMainArtist();
    await route.continue();
  });
  await confirmSelection(page);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.NOT_FOUND,
  );
  expect(discoveryStoredInterest(actor.id).artistId).toBeNull();
  await page.unroute(`**${routes.artistSelectionSubmit}`);
  await page.goto(routes.onboardingInstall);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await expect(
    page.getByRole('heading', { name: main.name, exact: true }),
  ).toHaveCount(0);
  const selected = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: discoveryFixtures.empty.slug },
  });
  expect(selected.status()).toBe(200);
  hideFictionalCatalog();
  await page.goto(routes.onboardingInstall);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await expect(
    page.getByRole('heading', { name: copy.emptyTitle }),
  ).toBeVisible();
  expect(discoveryStoredInterest(actor.id)).toMatchObject({
    subscriptions: 0,
    completed: null,
  });
});

test('empty preview and empty catalog are honest, and hidden or missing artists share a safe state', async ({
  page,
  context,
  identity,
}, info) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  await page.goto(artistPreviewPath(discoveryFixtures.empty.slug));
  await expect(
    page.getByRole('heading', { name: copy.previewEmptyTitle }),
  ).toBeVisible();
  await takeScreenshot(page, info, 'discovery-empty-preview');
  for (const slug of [
    ...discoveryFixtures.hiddenSlugs,
    'ci-discovery-missing',
  ]) {
    await page.goto(artistPreviewPath(slug));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      copy.errors.NOT_FOUND,
    );
    await expect(page.getByText(discoveryFixtures.privateSentinel)).toHaveCount(
      0,
    );
  }
  hideFictionalCatalog();
  await page.goto(routes.onboardingArtists);
  await expect(
    page.getByRole('heading', { name: copy.emptyTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: copy.selectionConfirm }),
  ).toHaveCount(0);
  await takeScreenshot(page, info, 'discovery-empty-catalog');
});

test('profile and current legal policy gates cannot be bypassed through preview, install or selection', async ({
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
    routes.onboardingArtists,
    routes.onboardingInstall,
    artistPreviewPath(main.slug),
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}${routes.onboardingFont}`);
  }
  const early = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: main.slug },
  });
  expect(early.status()).toBe(409);
  await finishProfile(actor);
  await page.goto(routes.onboardingInstall);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  rotateFictionalTerms();
  await page.goto(artistPreviewPath(main.slug));
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingConsent}`);
  const changed = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: main.slug },
  });
  expect(changed.status()).toBe(409);
  expect(discoveryStoredInterest(actor.id)).toMatchObject({
    artistId: null,
    subscriptions: 0,
    completed: null,
  });
});

test('missing preview policy fails closed and restricted accounts cannot read or select', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  removeFictionalMessagePolicy();
  await page.goto(artistPreviewPath(main.slug));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.SETUP_NOT_READY,
  );
  await actor.update({ is_restricted: true, restricted_until: null });
  for (const path of [
    routes.onboardingArtists,
    routes.onboardingInstall,
    artistPreviewPath(main.slug),
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}${routes.restricted}`);
  }
  const forbidden = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: main.slug },
  });
  expect(forbidden.status()).toBe(403);
});

test('actual actor API denies origin and actor injection; raw preview RPC/table cannot expose templates', async ({
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
  await finishProfile(actor);
  await actor.signIn(context);
  for (const origin of [undefined, 'null', 'https://evil.example']) {
    const response = await context.request.post(routes.artistSelectionSubmit, {
      headers: origin ? { Origin: origin } : {},
      data: { slug: main.slug },
    });
    expect(response.status()).toBe(403);
  }
  for (const extra of [
    { actorId: other.id },
    { subscribed: true },
    { onboardingCompleted: true },
  ]) {
    const response = await context.request.post(routes.artistSelectionSubmit, {
      headers: { Origin: appOrigin },
      data: { slug: main.slug, ...extra },
    });
    expect(response.status()).toBe(400);
  }
  const client = await actor.actorClient();
  const raw = await client.from('messages').select('body');
  expect(raw.error).toBeNull();
  expect(raw.data).toEqual([]);
  const denied = await client.rpc('discovery_preview', {
    p_actor_id: actor.id,
    p_artist_slug: main.slug,
  });
  expect(denied.error).not.toBeNull();
  expect(denied.data).toBeNull();
  const own = await client.rpc('discovery_get_interest');
  expect(own.error).toBeNull();
  expect(own.data?.[0]?.selected_slug).toBeNull();
  expect(discoveryStoredInterest(actor.id).artistId).toBeNull();
  expect(discoveryStoredInterest(other.id).artistId).toBeNull();
  await context.clearCookies();
  const anonymous = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: main.slug },
  });
  expect(anonymous.status()).toBe(401);
});

test('real saving state blocks repeat actions until the verified response arrives', async ({
  page,
  context,
  identity,
}, info) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  await page.goto(routes.onboardingArtists);
  let requests = 0;
  let state: 'waiting' | 'received' | 'failed' = 'waiting';
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${routes.artistSelectionSubmit}`, async (route) => {
    requests += 1;
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      state = 'received';
      await paused;
      await route.fulfill({ response });
    } catch {
      state = 'failed';
      await route.abort('failed').catch(() => {});
    }
  });
  try {
    await confirmSelection(page);
    await expect.poll(() => state).toBe('received');
    await expect(page.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      copy.selectionSaving,
    );
    const choose = page.getByRole('button', {
      name: selectLabel(main.name),
      exact: true,
    });
    await expect(choose).toBeDisabled();
    await choose.dispatchEvent('click');
    expect(requests).toBe(1);
    await takeScreenshot(page, info, 'discovery-saving');
  } finally {
    release();
  }
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingInstall}`);
  expect(requests).toBe(1);
  expect(discoveryStoredInterest(actor.id)).toMatchObject({
    artistId: main.id,
    subscriptions: 0,
    completed: null,
  });
});

test('server-rendered, RSC and browser JavaScript carry no service credential or raw private projection', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  const credential = process.env.SUPABASE_SERVICE_ROLE_KEY;
  expect(Boolean(credential)).toBe(true);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== appOrigin)
      externalRequests.push(request.resourceType());
  });
  const document = await page.goto(routes.onboardingArtists);
  const documentBody = await document!.text();
  // A boolean assertion never prints a credential if this regression fails.
  expect(documentBody.includes(credential!)).toBe(false);
  const capture = {
    failed: false,
    responses: [] as { status: number; isRsc: boolean; payload: string }[],
  };
  await page.route(
    (url) =>
      url.origin === appOrigin && url.pathname === artistPreviewPath(main.slug),
    async (route) => {
      if (route.request().headers().rsc !== '1') {
        await route.continue();
        return;
      }
      try {
        // Capture the browser-initiated request's real server response before
        // the router consumes it. Chromium may retire its response-body handle
        // after navigation. No synthetic body, header or cookie is substituted:
        // fulfill the exact fetched response, then prove it renders in the UI.
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
        const bytes = await response.body();
        const captured = {
          status: response.status(),
          isRsc:
            response
              .headers()
              ['content-type']?.startsWith('text/x-component') === true,
          payload: bytes.toString('utf8'),
        };
        await route.fulfill({ response });
        capture.responses.push(captured);
      } catch {
        capture.failed = true;
        await route.abort('failed').catch(() => {});
      }
    },
  );
  await page
    .getByRole('button', { name: previewLabel(main.name), exact: true })
    .click();
  await expect
    .poll(() => capture.failed || capture.responses.length > 0)
    .toBe(true);
  expect(capture.failed).toBe(false);
  expect(capture.responses.length).toBeGreaterThan(0);
  for (const { status, isRsc, payload } of capture.responses) {
    expect(status).toBe(200);
    expect(isRsc).toBe(true);
    expect(payload.length > 0).toBe(true);
    // Keep each assertion boolean so any leaked credential remains out of logs.
    expect(payload.includes(credential!)).toBe(false);
    expect(payload.includes(discoveryFixtures.privatePath)).toBe(false);
    expect(payload.includes(discoveryFixtures.contract)).toBe(false);
    expect(payload.includes('body_template')).toBe(false);
    expect(payload.includes('storage_object_id')).toBe(false);
    expect(payload.includes('object_path')).toBe(false);
    expect(payload.includes(actor.id)).toBe(false);
    expect(payload.includes('{이름}')).toBe(false);
  }
  await expect(
    page.getByText(discoveryFixtures.body.replaceAll('{이름}', '<b>팬</b>'), {
      exact: true,
    }),
  ).toBeVisible();
  expect(capture.failed).toBe(false);
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLScriptElement).src),
    );
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of new Set(scripts)) {
    expect(new URL(src).origin).toBe(appOrigin);
    const script = await context.request.get(src);
    expect(script.ok()).toBe(true);
    expect((await script.text()).includes(credential!)).toBe(false);
  }
  expect(externalRequests).toEqual([]);
});

test('fully onboarded fans keep free preview rights but cannot resubmit the onboarding choice or bypass changed policy', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  // Test-only evidence for the future full-completion stage; this feature never
  // performs this update and grants no paid subscription alongside it.
  await actor.update({ onboarding_completed_at: new Date().toISOString() });
  await actor.signIn(context);
  await page.goto(artistPreviewPath(main.slug));
  await expect(
    page.getByText(discoveryFixtures.body.replaceAll('{이름}', '<b>팬</b>'), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: selectLabel(main.name), exact: true }),
  ).toHaveCount(0);
  const choice = await context.request.post(routes.artistSelectionSubmit, {
    headers: { Origin: appOrigin },
    data: { slug: main.slug },
  });
  expect(choice.status()).toBe(403);
  const client = await actor.actorClient();
  expect(
    (await client.rpc('has_active_access', { p_artist_id: main.id })).data,
  ).toBe(false);
  rotateFictionalTerms();
  await page.reload();
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.PROFILE_REQUIRED,
  );
  await expect(
    page.getByText(discoveryFixtures.body.replaceAll('{이름}', '<b>팬</b>'), {
      exact: true,
    }),
  ).toHaveCount(0);
});

test('changed approved name policy returns to editable saved name before renewed consent', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    onboarding_completed_at: null,
    call_name: null,
  });
  await finishProfile(actor);
  await actor.signIn(context);
  invalidateFictionalCallingName();
  await page.goto(artistPreviewPath(main.slug));
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    copy.errors.PROFILE_REQUIRED,
  );
  await page
    .getByRole('button', { name: messages.onboarding.resume, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboarding}`);
  await page
    .getByRole('button', { name: messages.onboarding.resume, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingName}`);
  const name = page.getByRole('textbox', {
    name: messages.onboarding.nameLabel,
  });
  await expect(name).toHaveValue('<b>팬</b>');
  await name.fill('새허구팬');
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
  await page
    .getByRole('button', { name: messages.onboarding.continue, exact: true })
    .click();
  await expect(page).toHaveURL(`${appOrigin}${routes.onboardingArtists}`);
  await expect(
    page.getByRole('heading', { name: copy.onboardingTitle }),
  ).toBeVisible();
  const client = await actor.actorClient();
  const profile = await client
    .from('profiles')
    .select('call_name,onboarding_completed_at')
    .eq('id', actor.id)
    .single();
  expect(profile.error).toBeNull();
  expect(profile.data).toMatchObject({
    call_name: '새허구팬',
    onboarding_completed_at: null,
  });
  expect(discoveryStoredInterest(actor.id)).toMatchObject({
    artistId: null,
    subscriptions: 0,
    completed: null,
  });
});
