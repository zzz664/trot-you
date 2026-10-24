import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  test,
  expect,
  appOrigin,
  storageOrigin,
  preparePolicies,
  completeProfile,
  imageBytes,
  publish,
  subscribe,
  restrict,
  removeMembership,
  unpreview,
  cancelMessage,
  inspectMedia,
  inspectUpload,
  expireUpload,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  type World,
} from './fixtures';
import { artistPreviewPath, routes } from '../../../src/config/routes';
// Type-only shape; Node's Playwright loader must not execute app JSON imports.
const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);

const uploadPath = routes.mediaUpload;
const completePath = routes.mediaComplete;
const readPath = routes.mediaRead;
const revokePath = routes.mediaRevoke;
type Ticket = { uploadId: string; uploadUrl: string; expiresAt: string };
async function begin(
  request: APIRequestContext,
  messageId: string,
  bytes: Buffer,
  mimeType = 'image/png',
  requestId = randomUUID(),
) {
  const response = await post(request, uploadPath, {
    requestId,
    messageId,
    mimeType,
    byteSize: bytes.length,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result.ok).toBe(true);
  expect(Object.keys(result.data).sort()).toEqual([
    'expiresAt',
    'uploadId',
    'uploadUrl',
  ]);
  expect(new URL(result.data.uploadUrl).origin).toBe(storageOrigin);
  expect(new URL(result.data.uploadUrl).pathname).toContain(
    '/media-quarantine/',
  );
  expect(Date.parse(result.data.expiresAt)).toBeGreaterThan(Date.now());
  return result.data as Ticket;
}
async function sendBytes(
  request: APIRequestContext,
  ticket: Ticket,
  bytes: Buffer,
  mime = 'image/png',
) {
  const response = await request.put(ticket.uploadUrl, {
    headers: {
      'Content-Type': mime,
      'x-upsert': 'false',
      'cache-control': 'max-age=0',
    },
    data: bytes,
    maxRedirects: 0,
  });
  expect(response.ok()).toBe(true);
}
async function complete(request: APIRequestContext, ticket: Ticket) {
  const response = await post(request, completePath, {
    uploadId: ticket.uploadId,
  });
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result).toEqual({ ok: true, data: { mediaId: expect.any(String) } });
  return result.data.mediaId as string;
}
async function upload(
  request: APIRequestContext,
  world: World,
  bytes?: Buffer,
  mime = 'image/png',
  kind: 'photo' | 'voice' | 'video' = 'photo',
) {
  const messageId = world.draft(kind);
  const buffer = bytes ?? (await imageBytes());
  const ticket = await begin(request, messageId, buffer, mime);
  await sendBytes(request, ticket, buffer, mime);
  return {
    messageId,
    ticket,
    mediaId: await complete(request, ticket),
    bytes: buffer,
  };
}
async function read(
  request: APIRequestContext,
  mediaId: string,
  preview: boolean,
) {
  const response = await post(request, readPath, { mediaId, preview });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const result = await response.json();
  expect(result).toEqual({
    ok: true,
    data: {
      url: expect.any(String),
      expiresAt: expect.any(String),
      kind: expect.any(String),
      mimeType: expect.any(String),
    },
  });
  expect(new URL(result.data.url).origin).toBe(storageOrigin);
  expect(Date.parse(result.data.expiresAt)).toBeLessThanOrEqual(
    Date.now() + 60_000,
  );
  expect(Date.parse(result.data.expiresAt)).toBeGreaterThan(Date.now());
  return result.data as {
    url: string;
    expiresAt: string;
    kind: string;
    mimeType: string;
  };
}
async function denied(response: Awaited<ReturnType<typeof post>>) {
  expect(response.ok()).toBe(false);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(Object.keys(body).sort()).toEqual(['code', 'ok']);
  expect(JSON.stringify(body)).not.toMatch(
    /token|path|bucket|service_role|storage|http|credential/,
  );
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => blockExternal(context));
test.afterEach(async ({ context }) => expectNoExternal(context));

test('signed quarantine upload, sanitization, immutable promotion and idempotent completion use real local Storage', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const uploaded = await upload(page.request, world);
  expect(await complete(page.request, uploaded.ticket)).toBe(uploaded.mediaId);
  const stored = inspectMedia(uploaded.mediaId);
  expect(stored).toMatchObject({
    bucket: 'message-media',
    mime: 'image/png',
    width: 160,
    height: 100,
    duration: null,
  });
  expect(stored.path).toMatch(
    new RegExp(
      `^${world.artist.id}/${uploaded.messageId}/${uploaded.mediaId}\\.png$`,
    ),
  );
  const signed = await read(page.request, uploaded.mediaId, false);
  const download = await page.request.get(signed.url, { maxRedirects: 0 });
  expect(download.ok()).toBe(true);
  expect(download.headers()['content-type']).toContain('image/png');
  expect((await download.body()).length).toBe(stored.bytes);
  expect(inspectUpload(uploaded.ticket.uploadId).state).toBe('completed');
  const overwrite = await page.request.put(uploaded.ticket.uploadUrl, {
    headers: { 'Content-Type': 'image/png', 'x-upsert': 'true' },
    data: await imageBytes(),
  });
  // Quarantine may be deleted after finalize; the old upload capability can
  // recreate quarantine bytes, but never alter the immutable registered object.
  expect([200, 201, 400, 403, 409]).toContain(overwrite.status());
  expect(inspectMedia(uploaded.mediaId)).toEqual(stored);
  expect(await complete(page.request, uploaded.ticket)).toBe(uploaded.mediaId);
});

test('direct anonymous and authenticated bucket/list/sign/upload/read access stay denied', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  const messageId = world.draft();
  const ticket = await begin(page.request, messageId, bytes);
  await sendBytes(page.request, ticket, bytes);
  const pending = inspectUpload(ticket.uploadId);
  const clients = [
    createClient(storageOrigin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    }),
    await world.author.actorClient(),
    await world.fan.actorClient(),
  ];
  for (const client of clients) {
    const bucket = client.storage.from('media-quarantine');
    expect(
      (await bucket.download(pending.quarantinePath)).error,
    ).not.toBeNull();
    expect(
      (await bucket.createSignedUrl(pending.quarantinePath, 60)).error,
    ).not.toBeNull();
    expect(
      (
        await bucket.upload(
          `${world.artist.id}/${messageId}/${randomUUID()}.png`,
          bytes,
          { contentType: 'image/png' },
        )
      ).error,
    ).not.toBeNull();
    const listed = await bucket.list(`${world.artist.id}/${messageId}`);
    expect(listed.data ?? []).toHaveLength(0);
  }
  const mediaId = await complete(page.request, ticket);
  const stored = inspectMedia(mediaId);
  for (const client of clients) {
    expect(
      (await client.storage.from('message-media').download(stored.path)).error,
    ).not.toBeNull();
    expect(
      (
        await client.storage
          .from('message-media')
          .createSignedUrl(stored.path, 60)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await client.storage.from('message-media').upload(stored.path, bytes, {
          contentType: 'image/png',
          upsert: true,
        })
      ).error,
    ).not.toBeNull();
  }
});

test('cross-user, cross-resource and caller-controlled bucket/path fields cannot acquire capabilities', async ({
  world,
  page,
  context,
}) => {
  const bytes = await imageBytes();
  const messageId = world.draft();
  await world.author.signIn(context);
  const ticket = await begin(page.request, messageId, bytes);
  for (const additional of [
    { actorId: world.author.id },
    { path: '../secrets' },
    { bucket: 'avatars' },
    { artistId: world.artist.id },
    { url: 'http://169.254.169.254/' },
  ]) {
    await denied(
      await post(page.request, uploadPath, {
        requestId: randomUUID(),
        messageId,
        mimeType: 'image/png',
        byteSize: bytes.length,
        ...additional,
      }),
    );
  }
  await world.outsider.signIn(context);
  await denied(
    await post(page.request, uploadPath, {
      requestId: randomUUID(),
      messageId,
      mimeType: 'image/png',
      byteSize: bytes.length,
    }),
  );
  await denied(
    await post(page.request, completePath, { uploadId: ticket.uploadId }),
  );
  await denied(
    await post(page.request, revokePath, { uploadId: ticket.uploadId }),
  );
  await world.fan.signIn(context);
  await denied(
    await post(page.request, uploadPath, {
      requestId: randomUUID(),
      messageId,
      mimeType: 'image/png',
      byteSize: bytes.length,
    }),
  );
});

test('same-origin, current session, bounded JSON and strict content type guard every media route', async ({
  world,
  page,
  context,
  request,
}) => {
  const body = { mediaId: randomUUID(), preview: true };
  for (const path of [uploadPath, completePath, readPath, revokePath]) {
    await denied(await post(request, path, body));
  }
  await world.author.signIn(context);
  for (const path of [uploadPath, completePath, readPath, revokePath]) {
    expect((await page.request.post(path, { data: body })).status()).toBe(403);
    expect(
      (
        await page.request.post(path, {
          headers: { Origin: 'https://evil.invalid' },
          data: body,
        })
      ).status(),
    ).toBe(403);
    await denied(await post(page.request, `${path}?path=secret`, body));
    await denied(
      await page.request.post(path, {
        headers: { Origin: appOrigin, 'Content-Type': 'text/plain' },
        data: JSON.stringify(body),
      }),
    );
    await denied(
      await page.request.post(path, {
        headers: { Origin: appOrigin, 'Content-Type': 'application/json' },
        data: 'x'.repeat(100_000),
      }),
    );
  }
});

test('duplicate initiation shares its reservation; file-count quota includes simultaneous pending uploads', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  const messageId = world.draft();
  const requestId = randomUUID();
  const payload = {
    requestId,
    messageId,
    mimeType: 'image/png',
    byteSize: bytes.length,
  };
  const duplicate = await Promise.all([
    post(page.request, uploadPath, payload),
    post(page.request, uploadPath, payload),
  ]);
  const tickets = await Promise.all(
    duplicate.map(async (response) => {
      expect(response.status()).toBe(200);
      return (await response.json()).data as Ticket;
    }),
  );
  expect(tickets[0]!.uploadId).toBe(tickets[1]!.uploadId);
  const parallel = await Promise.all(
    [1, 2].map(() =>
      post(page.request, uploadPath, { ...payload, requestId: randomUUID() }),
    ),
  );
  expect(parallel.filter((response) => response.ok())).toHaveLength(1);
  expect(parallel.filter((response) => !response.ok())).toHaveLength(1);
  await denied(
    await post(page.request, uploadPath, {
      ...payload,
      byteSize: bytes.length + 1,
    }),
  );
  expect(
    (
      await post(page.request, revokePath, { uploadId: tickets[0]!.uploadId })
    ).ok(),
  ).toBe(true);
  await begin(page.request, messageId, bytes);
});

test('revoked and expired intents cannot finalize or sign again even while old quarantine token still exists', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  for (const state of ['revoked', 'expired'] as const) {
    const messageId = world.draft();
    const requestId = randomUUID();
    const ticket = await begin(
      page.request,
      messageId,
      bytes,
      'image/png',
      requestId,
    );
    if (state === 'revoked')
      expect(
        (
          await post(page.request, revokePath, { uploadId: ticket.uploadId })
        ).ok(),
      ).toBe(true);
    else expireUpload(ticket.uploadId);
    await sendBytes(page.request, ticket, bytes);
    await denied(
      await post(page.request, completePath, { uploadId: ticket.uploadId }),
    );
    await denied(
      await post(page.request, uploadPath, {
        requestId,
        messageId,
        mimeType: 'image/png',
        byteSize: bytes.length,
      }),
    );
    const leaked = await post(page.request, readPath, {
      mediaId: inspectUpload(ticket.uploadId).mediaId,
      preview: true,
    });
    await denied(leaked);
  }
});

test('fresh membership and restrictions are rechecked before promotion', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  const ticket = await begin(page.request, world.draft(), bytes);
  await sendBytes(page.request, ticket, bytes);
  removeMembership(world);
  await denied(
    await post(page.request, completePath, { uploadId: ticket.uploadId }),
  );
  await denied(
    await post(page.request, revokePath, { uploadId: ticket.uploadId }),
  );
  restrict(world.author);
  await denied(
    await post(page.request, uploadPath, {
      requestId: randomUUID(),
      messageId: world.draft(),
      mimeType: 'image/png',
      byteSize: bytes.length,
    }),
  );
});

for (const [name, contents] of [
  [
    'SVG active document',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  ],
  ['HTML active document', '<html><script>alert(1)</script></html>'],
  ['fake PNG header', '\x89PNG\r\n\x1a\nnot a decoded image'],
  ['remote URL text', 'http://169.254.169.254/latest/meta-data/'],
] as const)
  test(`${name} uploaded as image/png never becomes registered media`, async ({
    world,
    page,
    context,
  }) => {
    await world.author.signIn(context);
    const bytes = Buffer.from(contents, 'binary');
    const ticket = await begin(page.request, world.draft(), bytes);
    await sendBytes(page.request, ticket, bytes);
    await denied(
      await post(page.request, completePath, { uploadId: ticket.uploadId }),
    );
    await denied(
      await post(page.request, readPath, {
        mediaId: inspectUpload(ticket.uploadId).mediaId,
        preview: false,
      }),
    );
  });

test('declared MIME, original byte size, and message-kind constraints are not trusted', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  for (const mimeType of [
    'image/svg+xml',
    'text/html',
    'application/octet-stream',
    'image/PNG',
  ])
    await denied(
      await post(page.request, uploadPath, {
        requestId: randomUUID(),
        messageId: world.draft(),
        mimeType,
        byteSize: bytes.length,
      }),
    );
  for (const byteSize of [0, -1, 1.5, 1048577, Number.MAX_SAFE_INTEGER])
    await denied(
      await post(page.request, uploadPath, {
        requestId: randomUUID(),
        messageId: world.draft(),
        mimeType: 'image/png',
        byteSize,
      }),
    );
  await denied(
    await post(page.request, uploadPath, {
      requestId: randomUUID(),
      messageId: world.draft('voice'),
      mimeType: 'image/png',
      byteSize: bytes.length,
    }),
  );
  const wrongSize = await begin(
    page.request,
    world.draft(),
    Buffer.concat([bytes, Buffer.from('extra')]),
  );
  await sendBytes(page.request, wrongSize, bytes);
  await denied(
    await post(page.request, completePath, { uploadId: wrongSize.uploadId }),
  );
  const wrongMime = await begin(
    page.request,
    world.draft(),
    bytes,
    'image/jpeg',
  );
  await sendBytes(page.request, wrongMime, bytes, 'image/jpeg');
  await denied(
    await post(page.request, completePath, { uploadId: wrongMime.uploadId }),
  );
});

for (const [file, kind, mime] of [
  ['tone.mp3', 'voice', 'audio/mpeg'],
  ['tone.m4a', 'voice', 'audio/mp4'],
  ['tone.webm', 'voice', 'audio/webm'],
  ['clip.mp4', 'video', 'video/mp4'],
  ['clip.webm', 'video', 'video/webm'],
] as const)
  test(`generated ${mime} bytes are probed and readable through real Storage`, async ({
    world,
    page,
    context,
  }) => {
    await world.author.signIn(context);
    const bytes = readFileSync(`tests/fixtures/media/${file}`);
    const uploaded = await upload(page.request, world, bytes, mime, kind);
    const metadata = inspectMedia(uploaded.mediaId);
    expect(metadata.mime).toBe(mime);
    expect(metadata.duration).toBeGreaterThan(0);
    expect(metadata.duration).toBeLessThan(1000);
    expect(metadata.width).toBe(kind === 'video' ? 32 : null);
    const signed = await read(page.request, uploaded.mediaId, false);
    expect(signed.kind).toBe(kind);
    expect((await page.request.get(signed.url)).ok()).toBe(true);
  });

test('onboarding-ready preview is the only unpaid exception and is rechecked after removal/cancellation', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const uploaded = await upload(page.request, world);
  publish(uploaded.messageId, true);
  await completeProfile(world.fan, world.artist, 'large', false);
  await world.fan.signIn(context);
  const signed = await read(page.request, uploaded.mediaId, true);
  expect((await page.request.get(signed.url)).ok()).toBe(true);
  await denied(
    await post(page.request, readPath, {
      mediaId: uploaded.mediaId,
      preview: false,
    }),
  );
  unpreview(uploaded.messageId);
  await denied(
    await post(page.request, readPath, {
      mediaId: uploaded.mediaId,
      preview: true,
    }),
  );
  cancelMessage(uploaded.messageId);
  await denied(
    await post(page.request, readPath, {
      mediaId: uploaded.mediaId,
      preview: true,
    }),
  );
});

test('paid active/canceled/grace access respects history and fails closed after expiry or restriction', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const current = await upload(page.request, world);
  const historical = await upload(page.request, world);
  publish(current.messageId);
  publish(historical.messageId, false, true);
  await completeProfile(world.fan, world.artist);
  await world.fan.signIn(context);
  await denied(
    await post(page.request, readPath, {
      mediaId: current.mediaId,
      preview: false,
    }),
  );
  for (const status of ['active', 'canceled', 'grace'] as const) {
    subscribe(world.fan, world.artist, status);
    await read(page.request, current.mediaId, false);
    await denied(
      await post(page.request, readPath, {
        mediaId: historical.mediaId,
        preview: false,
      }),
    );
    await denied(
      await post(page.request, readPath, {
        mediaId: current.mediaId,
        preview: true,
      }),
    );
  }
  subscribe(world.fan, world.artist, 'expired', -1);
  await denied(
    await post(page.request, readPath, {
      mediaId: current.mediaId,
      preview: false,
    }),
  );
  subscribe(world.fan, world.artist);
  restrict(world.fan);
  await denied(
    await post(page.request, readPath, {
      mediaId: current.mediaId,
      preview: false,
    }),
  );
});

test('signed read lifetime is clamped to entitlement and actually expires at Storage', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const uploaded = await upload(page.request, world);
  publish(uploaded.messageId);
  await completeProfile(world.fan, world.artist);
  await world.fan.signIn(context);
  subscribe(world.fan, world.artist, 'active', 4);
  const signed = await read(page.request, uploaded.mediaId, false);
  expect(Date.parse(signed.expiresAt)).toBeLessThanOrEqual(Date.now() + 4000);
  expect((await page.request.get(signed.url)).ok()).toBe(true);
  await expect
    .poll(async () => (await page.request.get(signed.url)).ok(), {
      timeout: 15_000,
      intervals: [1000],
    })
    .toBe(false);
  await denied(
    await post(page.request, readPath, {
      mediaId: uploaded.mediaId,
      preview: false,
    }),
  );
});

// UI scenarios below use actual promoted photo bytes, never intercepted success.
async function openPhoto(page: Page) {
  await page
    .getByRole('button', {
      name: new RegExp(
        `^${messages.artists.messageKinds.photo} (?:열기|다시 불러오기)$`,
      ),
    })
    .click();
  const image = page.getByRole('img', {
    name: messages.media.photoAlt,
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(160);
  return image;
}
for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [390, 1280])
    test(`actual private preview photo and safe Back/Forward at ${scale}/${width}`, async ({
      world,
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await world.author.signIn(context);
      const uploaded = await upload(page.request, world);
      publish(uploaded.messageId, true);
      await completeProfile(world.fan, world.artist, scale);
      await world.fan.signIn(context);
      await page.goto(routes.artists);
      await page.goto(artistPreviewPath(world.artist.slug));
      await expect(
        page.getByRole('heading', {
          name: messages.artists.previewTitle.replace(
            '{name}',
            world.artist.name,
          ),
        }),
      ).toBeVisible();
      expect(await page.content()).not.toContain('token=');
      expect(await page.content()).not.toContain(
        inspectMedia(uploaded.mediaId).path,
      );
      await screenshot(page, info, `media-private-ready-${scale}-${width}`);
      await openPhoto(page);
      await screenshot(page, info, `media-private-photo-${scale}-${width}`);
      await page.goBack();
      await expect(page).toHaveURL(new URL(routes.artists, appOrigin).href);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.goForward();
      await expect(page).toHaveURL(
        new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
      );
      await expect(
        page.getByRole('heading', {
          name: messages.artists.previewTitle.replace(
            '{name}',
            world.artist.name,
          ),
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('img', { name: messages.media.photoAlt, exact: true }),
      ).toHaveCount(0);
      await openPhoto(page);
    });

test('signed capabilities are bound to exact paths and cannot be retargeted to another object', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  const ticket = await begin(page.request, world.draft(), bytes);
  const altered = new URL(ticket.uploadUrl);
  altered.pathname = altered.pathname.replace(
    /[^/]+\.png$/,
    `${randomUUID()}.png`,
  );
  expect(
    (
      await page.request.put(altered.href, {
        headers: { 'Content-Type': 'image/png' },
        data: bytes,
      })
    ).ok(),
  ).toBe(false);
  await sendBytes(page.request, ticket, bytes);
  const mediaId = await complete(page.request, ticket);
  const signed = await read(page.request, mediaId, false);
  const changed = new URL(signed.url);
  changed.pathname = changed.pathname.replace(
    /[^/]+\.png$/,
    `${randomUUID()}.png`,
  );
  expect((await page.request.get(changed.href)).ok()).toBe(false);
  await world.outsider.signIn(context);
  await denied(await post(page.request, readPath, { mediaId, preview: false }));
});

test('actual bytes larger than the reserved size are bounded and never promoted', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const bytes = await imageBytes();
  const ticket = await begin(
    page.request,
    world.draft(),
    bytes.subarray(0, 16),
  );
  await sendBytes(page.request, ticket, bytes);
  await denied(
    await post(page.request, completePath, { uploadId: ticket.uploadId }),
  );
  expect(inspectUpload(ticket.uploadId).state).toBe('revoked');
});

test('valid image decoding re-encodes and removes appended active metadata before publication', async ({
  world,
  page,
  context,
}) => {
  await world.author.signIn(context);
  const marker = '<script>UNTRUSTED_APPENDED_CONTENT</script>';
  const bytes = Buffer.concat([await imageBytes(), Buffer.from(marker)]);
  const uploaded = await upload(page.request, world, bytes);
  const signed = await read(page.request, uploaded.mediaId, false);
  const stored = await page.request.get(signed.url);
  expect(stored.ok()).toBe(true);
  expect((await stored.body()).includes(Buffer.from(marker))).toBe(false);
});

test('client expiration removes the bearer source and a retry rechecks preview permission', async ({
  world,
  page,
  context,
}, info) => {
  await world.author.signIn(context);
  const uploaded = await upload(page.request, world);
  publish(uploaded.messageId, true);
  await completeProfile(world.fan, world.artist);
  await world.fan.signIn(context);
  await page.clock.install();
  await page.goto(artistPreviewPath(world.artist.slug));
  await openPhoto(page);
  unpreview(uploaded.messageId);
  await page.clock.fastForward(61_000);
  await expect(
    page.getByRole('img', { name: messages.media.photoAlt, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(messages.media.expired, { exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain('token=');
  await page
    .getByRole('button', {
      name: messages.media.retry.replace(
        '{kind}',
        messages.artists.messageKinds.photo,
      ),
      exact: true,
    })
    .click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('img', { name: messages.media.photoAlt, exact: true }),
  ).toHaveCount(0);
  await screenshot(page, info, 'media-expired-permission-rechecked');
});

test('a delayed read finishing after navigation cannot restore media on the new screen', async ({
  world,
  page,
  context,
}, info) => {
  await world.author.signIn(context);
  const uploaded = await upload(page.request, world);
  publish(uploaded.messageId, true);
  await completeProfile(world.fan, world.artist);
  await world.fan.signIn(context);
  await page.goto(routes.artists);
  await page.goto(artistPreviewPath(world.artist.slug));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const requested = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(`**${readPath}`, async (route) => {
    const actual = await route.fetch();
    arrived();
    await held;
    // This response came from the real signing endpoint; no success is faked.
    await route.fulfill({ response: actual }).catch(() => undefined);
  });
  await page
    .getByRole('button', {
      name: messages.media.open.replace(
        '{kind}',
        messages.artists.messageKinds.photo,
      ),
      exact: true,
    })
    .click();
  await requested;
  await page.goBack();
  await expect(page).toHaveURL(new URL(routes.artists, appOrigin).href);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  release();
  await expect(
    page.getByRole('img', { name: messages.media.photoAlt, exact: true }),
  ).toHaveCount(0);
  expect(await page.content()).not.toContain('token=');
  await screenshot(page, info, 'media-interrupted-navigation');
  await page.goForward();
  await expect(page).toHaveURL(
    new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
  );
  await expect(
    page.getByRole('heading', {
      name: messages.artists.previewTitle.replace('{name}', world.artist.name),
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: messages.media.photoAlt, exact: true }),
  ).toHaveCount(0);
});

test('real voice and video previews load only on demand with accessible native controls', async ({
  world,
  page,
  context,
}, info) => {
  await world.author.signIn(context);
  const voice = await upload(
    page.request,
    world,
    readFileSync('tests/fixtures/media/tone.mp3'),
    'audio/mpeg',
    'voice',
  );
  const video = await upload(
    page.request,
    world,
    readFileSync('tests/fixtures/media/clip.mp4'),
    'video/mp4',
    'video',
  );
  publish(voice.messageId, true, false, 1);
  publish(video.messageId, true, false, 2);
  await completeProfile(world.fan, world.artist, 'xlarge');
  await world.fan.signIn(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(page.locator('audio, video')).toHaveCount(0);
  for (const kind of ['voice', 'video'] as const) {
    await page
      .getByRole('button', {
        name: messages.media.open.replace(
          '{kind}',
          messages.artists.messageKinds[kind],
        ),
        exact: true,
      })
      .click();
    const media = page.getByLabel(
      kind === 'voice' ? messages.media.voiceLabel : messages.media.videoLabel,
      { exact: true },
    );
    await expect(media).toBeVisible();
    await expect(media).toHaveAttribute('controls', '');
    await expect(media).toHaveAttribute('preload', 'none');
    await media.evaluate((element) => (element as HTMLMediaElement).load());
    await expect
      .poll(() =>
        media.evaluate((element) => (element as HTMLMediaElement).readyState),
      )
      .toBeGreaterThanOrEqual(1);
  }
  await screenshot(page, info, 'media-voice-video-xlarge-mobile');
});

for (const [file, mime] of [
  ['tone.mp3', 'audio/mpeg'],
  ['tone.webm', 'audio/webm'],
] as const)
  test(`appended active content in ${mime} is rejected before registration`, async ({
    world,
    page,
    context,
  }) => {
    await world.author.signIn(context);
    const bytes = Buffer.concat([
      readFileSync(`tests/fixtures/media/${file}`),
      Buffer.from('<html><script>UNTRUSTED_TRAILER</script></html>'),
    ]);
    const ticket = await begin(page.request, world.draft('voice'), bytes, mime);
    await sendBytes(page.request, ticket, bytes, mime);
    await denied(
      await post(page.request, completePath, { uploadId: ticket.uploadId }),
    );
    expect(inspectUpload(ticket.uploadId).state).toBe('revoked');
  });

// Only known defensive regression bytes already retained in the verifier unit
// suite are reused here. No network input or external document is inspected.
const knownDurationRegressions = [
  {
    name: 'stale MP3 Xing/Info duration',
    kind: 'voice',
    mime: 'audio/mpeg',
    bytes() {
      const source = readFileSync('tests/fixtures/media/tone.mp3');
      return Buffer.concat([
        source,
        ...Array.from({ length: 999 }, () => source.subarray(226)),
      ]);
    },
  },
  {
    name: 'stale WebM Info duration',
    kind: 'video',
    mime: 'video/webm',
    bytes() {
      const source = readFileSync('tests/fixtures/media/clip.webm');
      const chunks = [source];
      for (let i = 1; i < 1000; i++) {
        const header = Buffer.from([
          0x1f, 0x43, 0xb6, 0x75, 0xdd, 0xe7, 0x84, 0, 0, 0, 0,
        ]);
        header.writeUInt32BE(i * 300, 7);
        chunks.push(header, source.subarray(480, 567));
      }
      const bytes = Buffer.concat(chunks);
      bytes.writeBigUInt64BE(
        BigInt(bytes.length - 48) | 0x0100000000000000n,
        40,
      );
      return bytes;
    },
  },
  {
    name: 'late MP4 presentation timestamps',
    kind: 'video',
    mime: 'video/mp4',
    bytes() {
      const bytes = Buffer.from(readFileSync('tests/fixtures/media/clip.mp4'));
      bytes.writeUInt32BE(3_072_000, bytes.indexOf('ctts') + 32);
      return bytes;
    },
  },
] as const;
for (const vector of knownDurationRegressions)
  test(`known ${vector.name} regression is rejected through real upload completion`, async ({
    world,
    page,
    context,
  }) => {
    await world.author.signIn(context);
    const bytes = vector.bytes();
    const ticket = await begin(
      page.request,
      world.draft(vector.kind),
      bytes,
      vector.mime,
    );
    await sendBytes(page.request, ticket, bytes, vector.mime);
    await denied(
      await post(page.request, completePath, { uploadId: ticket.uploadId }),
    );
    expect(inspectUpload(ticket.uploadId).state).toBe('revoked');
  });

async function loadLongVoice(
  world: World,
  page: Page,
  context: import('@playwright/test').BrowserContext,
) {
  await world.author.signIn(context);
  const uploaded = await upload(
    page.request,
    world,
    readFileSync('tests/fixtures/media/long-tone.mp3'),
    'audio/mpeg',
    'voice',
  );
  expect(inspectMedia(uploaded.mediaId).duration).toBeGreaterThan(89_000);
  expect(inspectMedia(uploaded.mediaId).duration).toBeLessThan(91_000);
  publish(uploaded.messageId, true);
  await completeProfile(world.fan, world.artist, 'xlarge');
  await world.fan.signIn(context);
  // Install before application scripts establish timers. Date and server clock
  // remain real-current when signing; only UI timeout waiting is accelerated.
  await page.clock.install();
  await page.goto(routes.artists);
  await page.goto(artistPreviewPath(world.artist.slug));
  await page
    .getByRole('button', {
      name: messages.media.open.replace(
        '{kind}',
        messages.artists.messageKinds.voice,
      ),
      exact: true,
    })
    .click();
  const player = page.getByLabel(messages.media.voiceLabel, { exact: true });
  await expect(player).toBeVisible();
  await player.evaluate((element) => (element as HTMLMediaElement).load());
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLMediaElement).duration),
    )
    .toBeGreaterThan(89);
  // A real native seek/play, not mocked duration/currentTime. Muting the
  // generated sine tone avoids noise; the element still decodes and plays.
  await player.evaluate(async (element) => {
    const audio = element as HTMLMediaElement;
    audio.muted = true;
    audio.currentTime = 60;
    await audio.play();
  });
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLMediaElement).currentTime),
    )
    .toBeGreaterThan(61);
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLMediaElement).paused),
    )
    .toBe(false);
  return { uploaded, player };
}
async function advanceRenewalTimer(page: Page) {
  // setSystemTime changes Date without firing timers; fastForward then reaches
  // the original real date while firing the already scheduled expiry timeout.
  // Storage and application authorization clocks are never modified or mocked.
  // Official semantics: https://playwright.dev/docs/api/class-clock
  await page.clock.setSystemTime(Date.now() - 61_000);
  await page.clock.fastForward(61_000);
}

test('native long voice resumes past 60 seconds after fresh authorization and stops on denied renewal', async ({
  world,
  page,
  context,
}, info) => {
  const { uploaded, player } = await loadLongVoice(world, page, context);
  const original = await player.elementHandle();
  expect(original).not.toBeNull();
  const position = await player.evaluate(
    (element) => (element as HTMLMediaElement).currentTime,
  );
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === readPath &&
      response.request().method() === 'POST',
  );
  await advanceRenewalTimer(page);
  expect((await refreshed).status()).toBe(200);
  await expect
    .poll(() => original!.evaluate((element) => element.isConnected))
    .toBe(false);
  expect(
    await original!.evaluate((element) => ({
      source: element.getAttribute('src'),
      paused: (element as HTMLMediaElement).paused,
    })),
  ).toEqual({ source: null, paused: true });
  await expect(player).toBeVisible();
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLMediaElement).currentTime),
    )
    .toBeGreaterThan(position + 0.25);
  await expect
    .poll(() =>
      player.evaluate((element) => (element as HTMLMediaElement).paused),
    )
    .toBe(false);
  await screenshot(page, info, 'media-long-voice-resumed-past-sixty');
  const renewed = await player.elementHandle();
  unpreview(uploaded.messageId);
  const rejected = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === readPath &&
      response.request().method() === 'POST',
  );
  await advanceRenewalTimer(page);
  expect((await rejected).ok()).toBe(false);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(player).toHaveCount(0);
  expect(
    await renewed!.evaluate((element) => ({
      source: element.getAttribute('src'),
      paused: (element as HTMLMediaElement).paused,
    })),
  ).toEqual({ source: null, paused: true });
  expect(await page.content()).not.toContain('token=');
  await screenshot(page, info, 'media-long-voice-renewal-denied');
});

test('navigation during native long-voice renewal aborts continuation and cannot revive detached playback', async ({
  world,
  page,
  context,
}, info) => {
  const { player } = await loadLongVoice(world, page, context);
  const original = await player.elementHandle();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const requested = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(`**${readPath}`, async (route) => {
    const actual = await route.fetch();
    expect(actual.ok()).toBe(true);
    arrived();
    await held;
    await route.fulfill({ response: actual }).catch(() => undefined);
  });
  await advanceRenewalTimer(page);
  await requested;
  await expect(
    page.getByText(messages.media.loading, { exact: true }),
  ).toBeVisible();
  await expect(player).toHaveCount(0);
  expect(
    await original!.evaluate((element) => ({
      source: element.getAttribute('src'),
      paused: (element as HTMLMediaElement).paused,
    })),
  ).toEqual({ source: null, paused: true });
  await page.goBack();
  await expect(page).toHaveURL(new URL(routes.artists, appOrigin).href);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  release();
  await expect(page.locator('audio,video')).toHaveCount(0);
  expect(await page.content()).not.toContain('token=');
  await screenshot(page, info, 'media-long-voice-renewal-navigation');
  await page.goForward();
  await expect(page).toHaveURL(
    new URL(artistPreviewPath(world.artist.slug), appOrigin).href,
  );
  await expect(
    page.getByRole('heading', {
      name: messages.artists.previewTitle.replace('{name}', world.artist.name),
    }),
  ).toBeVisible();
  await expect(page.locator('audio,video')).toHaveCount(0);
});
