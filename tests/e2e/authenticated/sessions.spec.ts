import { test, expect, appOrigin } from './fixtures';
import { routes } from '../../../src/config/routes';
import { FONT_SCALE_COOKIE } from '../../../src/config/constants';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

const pathname = (url: string) => new URL(url).pathname;

test.beforeEach(async ({ context }) => {
  // A bug in the application must not turn this suite into a real OAuth login.
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).origin === appOrigin
      ? route.continue()
      : route.abort('blockedbyclient'),
  );
});

for (const width of [360, 414]) {
  for (const scale of ['normal', 'large', 'xlarge'] as const) {
    test(`verified session: ${scale} at ${width}px`, async ({
      page,
      context,
      identity,
    }, testInfo) => {
      const actor = await identity({ font_scale: scale });
      await actor.signIn(context);
      await page.setViewportSize({ width, height: 896 });
      await context.addCookies([
        // The authenticated database preference must beat a stale cookie.
        {
          name: FONT_SCALE_COOKIE,
          value: scale === 'normal' ? 'xlarge' : 'normal',
          url: appOrigin,
        },
      ]);
      const response = await page.goto(routes.home);
      await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
      expect(await response!.text()).toContain(`data-font-scale="${scale}"`);
      expect(response?.headers()['cache-control']).toContain('no-store');
      expect(response?.headers()['referrer-policy']).toBe('same-origin');
      await expect(page.locator('html')).toHaveAttribute(
        'data-font-scale',
        scale,
      );
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const logout = page
        .locator(`form[action="${routes.authLogout}"]`)
        .getByRole('button');
      await expect(logout).toBeVisible();
      const size = await logout.boundingBox();
      expect(size!.height).toBeGreaterThanOrEqual(48);
      expect(size!.width).toBeGreaterThanOrEqual(48);
      const body = await page.locator('body').innerText();
      expect(body.includes(actor.email) || body.includes(actor.id)).toBe(false);
      expect(await page.evaluate(() => document.cookie.includes('sb-'))).toBe(
        false,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`session-${scale}-${width}.png`),
        fullPage: true,
      });
      await page.reload();
      await expect(logout).toBeVisible();
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

test('real local email PKCE exchanges once; unsafe return paths cannot grant a role', async ({
  page,
  context,
  request,
  identity,
}) => {
  const actor = await identity();
  const callback = await actor.pkce(context, request);
  const verifierCookies = (await context.cookies()).filter((cookie) =>
    cookie.name.includes('code-verifier'),
  );
  expect(verifierCookies.length > 0).toBe(true);
  callback.searchParams.set('next', routes.admin);
  await page.goto(callback.href);
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  const cookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith('sb-'),
  );
  expect(cookies.length > 0).toBe(true);
  expect(
    cookies.every(
      (cookie) =>
        cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/',
    ),
  ).toBe(true);
  expect(cookies.some((cookie) => cookie.name.includes('code-verifier'))).toBe(
    false,
  );
  await context.clearCookies();
  // Restore the matching verifier so this tests GoTrue's single-use code,
  // rather than only the separate missing-verifier rejection case.
  await context.addCookies(verifierCookies);
  await page.goto(callback.href);
  await expect(page).toHaveURL(/\/start\?reason=callback_failed$/);
  expect(new URL(page.url()).searchParams.has('code')).toBe(false);
  expect(
    (await context.cookies()).some((cookie) =>
      cookie.name.includes('code-verifier'),
    ),
  ).toBe(false);
});

test('a real authorization code without its verifier is rejected', async ({
  page,
  context,
  request,
  identity,
}) => {
  const actor = await identity();
  const callback = await actor.pkce(context, request);
  await context.clearCookies();
  await page.goto(callback.href);
  await expect(page).toHaveURL(/\/start\?reason=callback_failed$/);
  await page.goto(routes.admin);
  await expect(page).toHaveURL(/\/start\?/);
});

test('actor-scoped reads and current database role beat editable metadata and return path', async ({
  page,
  context,
  identity,
}) => {
  const first = await identity();
  const second = await identity();
  expect(await first.ownProfileIds()).toEqual([first.id]);
  expect(await second.ownProfileIds()).toEqual([second.id]);
  await first.signIn(context);
  for (const path of [
    routes.admin,
    routes.artist,
    `${routes.start}?next=${routes.admin}`,
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
  }
});

test('onboarding and restrictions win over roles, then live demotion takes effect', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({
    role: 'admin',
    onboarding_completed_at: null,
  });
  await actor.signIn(context);
  await page.goto(routes.admin);
  await expect(page).toHaveURL(`${appOrigin}${routes.onboarding}`);
  await actor.update({ onboarding_completed_at: new Date().toISOString() });
  await page.goto(routes.start);
  await expect(page).toHaveURL(`${appOrigin}${routes.admin}`);
  await actor.update({ is_restricted: true, restricted_until: null });
  await page.reload();
  await expect(page).toHaveURL(`${appOrigin}${routes.restricted}`);
  await actor.update({ restricted_until: '2020-01-01T00:00:00Z' });
  await page.reload();
  await expect(page).toHaveURL(`${appOrigin}${routes.admin}`);
  await actor.update({ role: 'fan' });
  await page.reload();
  await expect(page).toHaveURL(`${appOrigin}${routes.home}`);
});

test('artist landing does not loop through start or allow admin entry', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity({ role: 'artist' });
  await actor.signIn(context);
  for (const path of [routes.start, routes.admin, routes.home]) {
    await page.goto(path);
    await expect(page).toHaveURL(`${appOrigin}${routes.artist}`);
  }
});

test('tampered signed claims and invalid refresh token never create a session', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity();
  await actor.signIn(context, { forged: true });
  await page.goto(routes.admin);
  await expect(page).toHaveURL(/\/start\?/);
  await expect(page.getByText(messages.auth.sessionTitle)).toHaveCount(0);
});

test('a server-revoked session cannot keep using an unexpired signed JWT', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity();
  await actor.signIn(context);
  await page.goto(routes.home);
  await expect(page.getByText(messages.auth.sessionTitle)).toBeVisible();
  await actor.revokeAll();
  await page.reload();
  await expect(page).toHaveURL(/\/start\?/);
  await expect(page.getByText(messages.auth.sessionTitle)).toHaveCount(0);
});

test('configured malformed callbacks never reflect a supplied host or redirect', async ({
  request,
}) => {
  for (const query of [
    '?code=one&code=two&next=//evil.example',
    '?code=bad%20code&next=%2F%5Cevil.example',
    '?error=access_denied&error_description=PRIVATE_PROVIDER_MESSAGE&next=/admin',
    `?code=${'x'.repeat(2049)}&next=https://evil.example`,
  ]) {
    const response = await request.get(`${routes.authCallback}${query}`, {
      headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(
      `${appOrigin}${routes.start}?reason=callback_failed`,
    );
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
  }
});

test('refresh cookies survive both content responses and start redirects', async ({
  context,
  identity,
}) => {
  const actor = await identity();
  for (const path of [routes.home, routes.start]) {
    await context.clearCookies();
    await actor.signIn(context, { refresh: true });
    const before = JSON.stringify(await context.cookies());
    const response = await context.request.get(path, { maxRedirects: 0 });
    expect([200, 303, 307]).toContain(response.status());
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(Boolean(response.headers()['set-cookie'])).toBe(true);
    expect(JSON.stringify(await context.cookies()) === before).toBe(false);
    if (path === routes.start) {
      expect(
        pathname(new URL(response.headers().location!, appOrigin).href),
      ).toBe(routes.home);
    }
    const verified = await context.request.get(routes.home);
    expect(verified.status()).toBe(200);
    expect(pathname(verified.url())).toBe(routes.home);
  }
});

test('logout is POST-only, same-origin, idempotent and safe after Back/Forward', async ({
  page,
  context,
  identity,
}) => {
  const actor = await identity();
  await actor.signIn(context);
  await page.goto(routes.home);
  const logout = page
    .locator(`form[action="${routes.authLogout}"]`)
    .getByRole('button');
  await expect(logout).toBeVisible();
  const get = await context.request.get(routes.authLogout, { maxRedirects: 0 });
  expect(get.status()).toBe(405);
  for (const origin of [
    undefined,
    'null',
    'https://evil.example',
    `${appOrigin}.evil.example`,
  ]) {
    const response = await context.request.post(routes.authLogout, {
      headers: origin === undefined ? {} : { Origin: origin },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  }
  await page.reload();
  await expect(logout).toBeVisible();
  // Observe the actual network response without routing/fetching it ourselves.
  // A worker-controlled redirect target can make Chromium's frame response
  // describe the final 200 document instead of the original logout 303.
  // CDP ExtraInfo is the wire status; it may arrive before requestWillBeSent.
  const protocol = await context.newCDPSession(page);
  const logoutRequestIds = new Set<string>();
  const serverResponses: {
    requestId: string;
    status: number;
    noReferrer: boolean;
    noStore: boolean;
    signedOut: boolean;
  }[] = [];
  protocol.on('Network.requestWillBeSent', (event) => {
    if (
      event.request.url === `${appOrigin}${routes.authLogout}` &&
      event.request.method === 'POST'
    )
      logoutRequestIds.add(event.requestId);
  });
  protocol.on('Network.responseReceivedExtraInfo', (event) => {
    // Keep only booleans for known public header values: never retain session
    // cookies, request bodies or the raw response headers in test artifacts.
    const header = (name: string) =>
      Object.entries(event.headers).find(
        ([key]) => key.toLowerCase() === name,
      )?.[1];
    serverResponses.push({
      requestId: event.requestId,
      status: event.statusCode,
      noReferrer: header('referrer-policy') === 'no-referrer',
      noStore: String(header('cache-control')).includes('no-store'),
      signedOut:
        header('location') === `${appOrigin}${routes.start}?reason=signed_out`,
    });
  });
  try {
    await protocol.send('Network.enable');
    const [logoutRequest] = await Promise.all([
      page.waitForRequest(
        (request) =>
          request.url() === `${appOrigin}${routes.authLogout}` &&
          request.method() === 'POST',
      ),
      logout.click(),
    ]);
    expect(await logoutRequest.headerValue('origin')).toBe(appOrigin);
    // Redirects reuse an ID: inspect the first wire response for the native
    // POST, never a later redirect that might happen to return the expected code.
    const serverRedirect = () =>
      serverResponses.find((response) =>
        logoutRequestIds.has(response.requestId),
      );
    await expect.poll(() => Boolean(serverRedirect())).toBe(true);
    expect(serverRedirect()).toMatchObject({
      status: 303,
      noReferrer: true,
      noStore: true,
      signedOut: true,
    });
  } finally {
    await protocol.detach();
  }
  await expect(page).toHaveURL(/\/start\?reason=signed_out$/);
  expect(
    (await context.cookies()).some((cookie) => cookie.name.startsWith('sb-')),
  ).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/\/start(?:\?|$)/);
  await expect(logout).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/\/start(?:\?|$)/);
  await expect(logout).toHaveCount(0);
  const repeated = await Promise.all(
    [0, 1].map(() =>
      context.request.post(routes.authLogout, {
        headers: { Origin: appOrigin },
        maxRedirects: 0,
      }),
    ),
  );
  for (const response of repeated) {
    expect(response.status()).toBe(303);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(new URL(response.headers().location!).pathname).toBe(routes.start);
  }
  await page.goto(routes.home);
  await expect(page).toHaveURL(/\/start\?/);
});

test('Kakao initiation uses PKCE and configured hosts, never follows the provider', async ({
  request,
}) => {
  for (const origin of [undefined, 'null', 'https://evil.example']) {
    const forbidden = await request.post(routes.authLogin, {
      headers: origin === undefined ? {} : { Origin: origin },
      maxRedirects: 0,
    });
    expect(forbidden.status()).toBe(403);
  }
  const response = await request.post(
    `${routes.authLogin}?next=https://evil.example`,
    {
      headers: {
        Origin: appOrigin,
        Host: 'evil.example',
        'X-Forwarded-Host': 'evil.example',
      },
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBe(303);
  const destination = new URL(response.headers().location!);
  expect(destination.origin).toBe('http://127.0.0.1:54321');
  expect(destination.pathname).toBe('/auth/v1/authorize');
  expect(destination.searchParams.get('provider')).toBe('kakao');
  expect(destination.searchParams.get('code_challenge_method')).toBe('s256');
  expect(Boolean(destination.searchParams.get('code_challenge'))).toBe(true);
  const callback = new URL(destination.searchParams.get('redirect_to')!);
  expect(callback.origin).toBe(appOrigin);
  expect(callback.pathname).toBe(routes.authCallback);
  expect(callback.search).toBe('');
  expect(response.headers()['set-cookie']).toContain('HttpOnly');
  expect(response.headers()['cache-control']).toContain('no-store');
});

test('native Kakao button preserves Origin without contacting the OAuth provider', async ({
  page,
}) => {
  const document = await page.goto(routes.start);
  expect(document?.headers()['referrer-policy']).toBe('same-origin');
  const requestPromise = page.waitForRequest(
    (request) =>
      request.url().startsWith(`${appOrigin}${routes.authLogin}?`) &&
      request.method() === 'POST',
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().startsWith(`${appOrigin}${routes.authLogin}?`) &&
      response.request().method() === 'POST',
  );
  // beforeEach blocks every non-app browser request, including the local
  // authorize URL. We observe only this application's real form POST/redirect.
  await page
    .getByRole('button', { name: messages.auth.login })
    .click({ noWaitAfter: true });
  expect(await (await requestPromise).headerValue('origin')).toBe(appOrigin);
  const response = await responsePromise;
  expect(response.status()).toBe(303);
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  expect(new URL(response.headers().location!).origin).toBe(
    'http://127.0.0.1:54321',
  );
});
