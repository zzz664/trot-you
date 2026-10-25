import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import type {
  AdminArtist,
  AdminArtistDetail,
  AdminArtistInput,
  ArtistInvitation,
  ArtistAccountInvitations,
} from '../../../src/config/admin-artists';
import {
  adminArtistApiPath,
  adminArtistPath,
  artistPreviewPath,
  artistAccessPath,
  routes,
} from '../../../src/config/routes';
import {
  test,
  expect,
  preparePolicies,
  post,
  blockExternal,
  expectNoExternal,
  screenshot,
  setFont,
  setRole,
  disableLinkPolicy,
  expireInvitation,
  membership,
  createSentMessages,
  seedHistory,
  retainedHistory,
  addArtists,
  seedOlderManagementRows,
  type World,
} from './fixtures';

const messages: typeof import('../../../src/messages/ko.json') = JSON.parse(
  readFileSync(
    new URL('../../../src/messages/ko.json', import.meta.url),
    'utf8',
  ),
);
const copy = messages.adminArtists;
const main = (page: Page) => page.getByRole('main');
const button = (page: Page, name: string) =>
  main(page).getByRole('button', { name, exact: true });
async function failure(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  code: string,
) {
  expect(response.status()).toBe(status);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ ok: false, code });
}
async function detail(
  request: APIRequestContext,
  id: string,
): Promise<AdminArtistDetail> {
  const response = await request.get(
    `${routes.adminArtistsApi}?${new URLSearchParams({ id })}`,
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const body = await response.json();
  expect(body.ok).toBe(true);
  return body.data;
}
function artistInput(artist?: AdminArtist): AdminArtistInput {
  return {
    slug: artist?.slug ?? `fictional-created-${randomUUID()}`,
    name: artist?.name ?? '허구 새 운영 가수',
    intro: artist?.intro ?? '격리 CI에서만 사용하는 허구 가수 소개입니다.',
    grade: artist?.grade ?? 'B',
    status: artist?.status ?? 'draft',
    agency_name: artist?.agency_name ?? null,
    contract_started_at: artist?.contract_started_at ?? null,
    contract_ended_at: artist?.contract_ended_at ?? null,
    display_order: artist?.display_order ?? 0,
  };
}
async function save(
  request: APIRequestContext,
  artist: AdminArtist,
  patch: Partial<AdminArtistInput>,
) {
  const response = await post(request, adminArtistApiPath('save'), {
    artist_id: artist.id,
    operation_id: randomUUID(),
    expected_revision: artist.revision,
    input: { ...artistInput(artist), ...patch },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as AdminArtist;
}
async function offer(
  request: APIRequestContext,
  world: World,
  target = world.recipient.id,
) {
  const artist = (await detail(request, world.artist.id)).artist;
  const input = {
    artist_id: artist.id,
    target_user_id: target,
    operation_id: randomUUID(),
    expected_revision: artist.revision,
    is_manager: false,
    confirmed: true,
  };
  const response = await post(request, adminArtistApiPath('invite'), input);
  expect(response.status()).toBe(200);
  return {
    input,
    invitation: (await response.json()).data as ArtistInvitation,
  };
}
async function invitations(
  request: APIRequestContext,
): Promise<ArtistAccountInvitations> {
  const response = await request.get(routes.artistAccessApi);
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
function responseInput(invitation: ArtistInvitation, accept = true) {
  return {
    invitation_id: invitation.id,
    operation_id: randomUUID(),
    expected_revision: invitation.revision,
    accept,
    confirmed: true,
  };
}
async function openDetail(page: Page, world: World) {
  await page.goto(adminArtistPath(world.artist.id));
  await expect(
    main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByLabel(copy.name, { exact: true })).toHaveValue(
    world.artist.name,
  );
}

test.beforeAll(preparePolicies);
test.beforeEach(async ({ context }) => {
  preparePolicies();
  await blockExternal(context);
});
test.afterEach(async ({ context }) => expectNoExternal(context));

test('artist creation replay, CAS edits and retirement preserve historical subscriptions and ledger', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const input = {
    artist_id: randomUUID(),
    operation_id: randomUUID(),
    expected_revision: 0,
    input: artistInput(),
  };
  const created = await post(
    context.request,
    adminArtistApiPath('save'),
    input,
  );
  expect(created.status()).toBe(200);
  const first = (await created.json()).data as AdminArtist;
  expect(first).toMatchObject({
    id: input.artist_id,
    revision: 1,
    status: 'draft',
  });
  const replay = await post(context.request, adminArtistApiPath('save'), input);
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data).toEqual(first);
  const changed = await save(context.request, first, {
    name: '허구 수정 가수',
    display_order: 7,
    status: 'active',
  });
  expect(changed.revision).toBeGreaterThan(first.revision);
  await failure(
    await post(context.request, adminArtistApiPath('save'), {
      ...input,
      operation_id: randomUUID(),
      expected_revision: first.revision,
      input: { ...input.input, name: '저장되면 안 되는 이전 변경' },
    }),
    409,
    'CONFLICT',
  );
  expect((await detail(context.request, first.id)).artist.name).toBe(
    '허구 수정 가수',
  );
  const history = seedHistory(world);
  const before = retainedHistory(history);
  const current = (await detail(context.request, world.artist.id)).artist;
  const retired = await save(context.request, current, { status: 'retired' });
  expect(retired.status).toBe('retired');
  expect(retainedHistory(history)).toBe(before);
  expect(
    (await detail(context.request, world.artist.id)).members,
  ).toContainEqual({ user_id: world.author.id, is_manager: false });
});

test('exact existing-user invitation requires that recipient consent and replays without additional grants', async ({
  world,
  context,
  page,
}) => {
  await world.admin.signIn(context);
  const { input, invitation } = await offer(context.request, world);
  expect(invitation.state).toBe('pending');
  expect(membership(world)).toEqual({ role: 'fan', member: false });
  const replay = await post(
    context.request,
    adminArtistApiPath('invite'),
    input,
  );
  expect(replay.status()).toBe(200);
  expect((await replay.json()).data.id).toBe(invitation.id);
  await world.other.signIn(context);
  const otherInbox = await invitations(context.request);
  expect(otherInbox.user_id).toBe(world.other.id);
  expect(otherInbox.invitations).toEqual([]);
  await page.goto(routes.artistAccess);
  await expect(
    main(page).getByText(world.other.id, { exact: true }),
  ).toBeVisible();
  await failure(
    await post(
      context.request,
      routes.artistAccessApi,
      responseInput(invitation),
    ),
    404,
    'NOT_FOUND',
  );
  await world.recipient.signIn(context);
  const recipientInbox = await invitations(context.request);
  expect(recipientInbox.user_id).toBe(world.recipient.id);
  expect(recipientInbox.invitations.map((row) => row.id)).toEqual([
    invitation.id,
  ]);
  // Keep the mounted page from the previous account: displayed identity must
  // come from the fresh owner response, never the earlier RSC navigation key.
  await button(page, copy.refresh).click();
  await expect(
    main(page).getByText(world.recipient.id, { exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByText(world.other.id, { exact: true }),
  ).toHaveCount(0);
  const consent = responseInput(invitation);
  await failure(
    await post(context.request, routes.artistAccessApi, {
      ...consent,
      confirmed: false,
    }),
    400,
    'INVALID_INPUT',
  );
  expect(membership(world).member).toBe(false);
  const accepted = await post(context.request, routes.artistAccessApi, consent);
  expect(accepted.status()).toBe(200);
  expect((await accepted.json()).data.state).toBe('accepted');
  expect(membership(world)).toEqual({ role: 'artist', member: true });
  const acceptedReplay = await post(
    context.request,
    routes.artistAccessApi,
    consent,
  );
  expect(acceptedReplay.status()).toBe(200);
  expect((await acceptedReplay.json()).data.state).toBe('accepted');
});

test('cancel, expiry and withdrawn link configuration do not create access, while existing access can still be removed', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const canceled = (await offer(context.request, world)).invitation;
  const cancelInput = {
    invitation_id: canceled.id,
    operation_id: randomUUID(),
    expected_revision: canceled.revision,
    confirmed: true,
  };
  const cancelResult = await post(
    context.request,
    adminArtistApiPath('cancel-invite'),
    cancelInput,
  );
  expect(cancelResult.status()).toBe(200);
  const canceledCurrent = (await cancelResult.json()).data as ArtistInvitation;
  await world.recipient.signIn(context);
  await failure(
    await post(
      context.request,
      routes.artistAccessApi,
      responseInput(canceledCurrent),
    ),
    409,
    'INVITATION_CLOSED',
  );
  expect(membership(world).member).toBe(false);
  await world.admin.signIn(context);
  const expired = (await offer(context.request, world)).invitation;
  expireInvitation(expired.id);
  await world.recipient.signIn(context);
  expect(
    (await invitations(context.request)).invitations.find(
      (row) => row.id === expired.id,
    )?.state,
  ).toBe('expired');
  await failure(
    await post(context.request, routes.artistAccessApi, responseInput(expired)),
    410,
    'INVITATION_EXPIRED',
  );
  await world.admin.signIn(context);
  const accepted = (await offer(context.request, world)).invitation;
  await world.recipient.signIn(context);
  expect(
    (
      await post(
        context.request,
        routes.artistAccessApi,
        responseInput(accepted),
      )
    ).status(),
  ).toBe(200);
  disableLinkPolicy();
  await world.admin.signIn(context);
  const current = await detail(context.request, world.artist.id);
  expect(current.account_link_ready).toBe(false);
  await failure(
    await post(context.request, adminArtistApiPath('invite'), {
      artist_id: world.artist.id,
      target_user_id: world.other.id,
      operation_id: randomUUID(),
      expected_revision: current.artist.revision,
      is_manager: false,
      confirmed: true,
    }),
    503,
    'SETUP_NOT_READY',
  );
  const unlinked = await post(context.request, adminArtistApiPath('unlink'), {
    artist_id: world.artist.id,
    target_user_id: world.recipient.id,
    operation_id: randomUUID(),
    expected_revision: current.artist.revision,
    confirmed: true,
  });
  expect(unlinked.status()).toBe(200);
  expect(membership(world).member).toBe(false);
});

test('preview selection uses sent text and accepted photo media, preserving chosen order and public preview ownership', async ({
  world,
  context,
  page,
}) => {
  const sent = await createSentMessages(context, world, true);
  const current = (await detail(context.request, world.artist.id)).artist;
  const selected = await post(context.request, adminArtistApiPath('previews'), {
    artist_id: world.artist.id,
    operation_id: randomUUID(),
    expected_revision: current.revision,
    message_ids: [sent[1]!.id, sent[0]!.id],
  });
  expect(selected.status()).toBe(200);
  const loaded = await detail(context.request, world.artist.id);
  expect(loaded.previews.map((row) => row.id)).toEqual([
    sent[1]!.id,
    sent[0]!.id,
  ]);
  expect(loaded.previews[0]!.media[0]!.id).toBe(sent[1]!.mediaId);
  const media = await post(context.request, routes.mediaRead, {
    mediaId: sent[1]!.mediaId,
    preview: false,
  });
  expect(media.status()).toBe(200);
  await world.recipient.signIn(context);
  await page.goto(artistPreviewPath(world.artist.slug));
  await expect(
    main(page).getByText('허구 사진 맛보기입니다.', { exact: true }),
  ).toBeVisible();
  const publicMedia = await post(page.request, routes.mediaRead, {
    mediaId: sent[1]!.mediaId,
    preview: true,
  });
  expect(publicMedia.status()).toBe(200);
  expect(new URL((await publicMedia.json()).data.url).origin).toBe(
    'http://127.0.0.1:54321',
  );
});

test('current admin role and same-origin checks reject stale edits without changing artist information', async ({
  world,
  context,
}) => {
  await world.admin.signIn(context);
  const current = (await detail(context.request, world.artist.id)).artist;
  const payload = {
    artist_id: current.id,
    operation_id: randomUUID(),
    expected_revision: current.revision,
    input: { ...artistInput(current), name: '저장되지 않는 이름' },
  };
  await failure(
    await context.request.post(adminArtistApiPath('save'), {
      headers: { Origin: 'https://outside.invalid' },
      data: payload,
    }),
    403,
    'FORBIDDEN',
  );
  setRole(world.admin, 'fan');
  await failure(
    await post(context.request, adminArtistApiPath('save'), payload),
    403,
    'FORBIDDEN',
  );
  setRole(world.admin, 'admin');
  expect((await detail(context.request, current.id)).artist.name).toBe(
    current.name,
  );
  await context.clearCookies();
  await failure(
    await context.request.get(routes.adminArtistsApi),
    401,
    'UNAUTHENTICATED',
  );
});

for (const scale of ['normal', 'large', 'xlarge'] as const)
  for (const width of [360, 1280])
    test(`${scale} ${width}: initial list, create, detail and recipient access screens with real entry and Back links`, async ({
      world,
      context,
      page,
    }, info) => {
      setFont(world.admin, scale);
      setFont(world.recipient, scale);
      const sent = await createSentMessages(context, world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(routes.admin);
      await main(page)
        .getByRole('link', { name: copy.entryOpen, exact: true })
        .click();
      await expect(page).toHaveURL(routes.adminArtists);
      await expect(
        main(page).locator(`[data-admin-artist-id="${world.artist.id}"]`),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-artists-list-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.create, exact: true })
        .click();
      await expect(page).toHaveURL(adminArtistPath('new'));
      await expect(
        main(page).getByLabel(copy.name, { exact: true }),
      ).toHaveValue('');
      await screenshot(
        page,
        info,
        `admin-artists-create-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByLabel(copy.name, { exact: true })
        .fill('취소할 허구 입력');
      await button(page, copy.cancel).click();
      await expect(page).toHaveURL(routes.adminArtists);
      const row = main(page).locator(
        `[data-admin-artist-id="${world.artist.id}"]`,
      );
      await expect(row).toBeVisible();
      await row.getByRole('link', { name: copy.edit, exact: true }).click();
      await expect(page).toHaveURL(adminArtistPath(world.artist.id));
      await expect(
        main(page).getByLabel(copy.name, { exact: true }),
      ).toHaveValue(world.artist.name);
      await expect(
        main(page).locator(`[data-admin-preview-id="${sent[0]!.id}"]`),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `admin-artists-detail-${scale}-${width}`,
        scale,
      );
      const editor = main(page).locator('[data-admin-artist-form]');
      await editor
        .getByLabel(copy.name, { exact: true })
        .fill('저장하지 않는 변경');
      await editor
        .getByRole('button', { name: copy.cancel, exact: true })
        .click();
      await expect(editor.getByLabel(copy.name, { exact: true })).toHaveValue(
        world.artist.name,
      );
      await main(page)
        .getByLabel(copy.targetUserId, { exact: true })
        .fill(world.recipient.id);
      await expect(button(page, copy.linkRequest)).toBeDisabled();
      await main(page).getByLabel(copy.linkConfirm, { exact: true }).check();
      await button(page, copy.linkRequest).click();
      await expect(
        main(page).locator('[data-admin-invitation-id]'),
      ).toHaveCount(1);
      expect(membership(world).member).toBe(false);
      await main(page)
        .getByRole('link', { name: copy.backList, exact: true })
        .click();
      await expect(page).toHaveURL(routes.adminArtists);
      await expect(
        main(page).getByRole('heading', { name: copy.title, exact: true }),
      ).toBeVisible();
      await main(page)
        .getByRole('link', { name: copy.back, exact: true })
        .click();
      await expect(page).toHaveURL(routes.admin);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.adminTitle,
          exact: true,
        }),
      ).toBeVisible();
      await world.recipient.signIn(context);
      await page.goto(routes.home);
      await main(page)
        .getByRole('link', { name: copy.accessEntry, exact: true })
        .click();
      await expect(page).toHaveURL(routes.artistAccess);
      await expect(main(page).locator('[data-artist-access-id]')).toHaveCount(
        1,
      );
      await expect(
        main(page).getByText(world.recipient.id, { exact: true }),
      ).toBeVisible();
      await screenshot(
        page,
        info,
        `artist-access-pending-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.backHome, exact: true })
        .click();
      await expect(page).toHaveURL(routes.home);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.fanTitle,
          exact: true,
        }),
      ).toBeVisible();
      await main(page)
        .getByRole('link', { name: copy.accessEntry, exact: true })
        .click();
      await expect(
        main(page).getByRole('heading', {
          name: copy.accessTitle,
          exact: true,
        }),
      ).toBeVisible();
      await main(page).getByLabel(copy.accessConfirm, { exact: true }).check();
      await button(page, copy.accept).click();
      await expect(
        main(page).getByText(copy.linkState.accepted, { exact: true }),
      ).toBeVisible();
      expect(membership(world)).toEqual({ role: 'artist', member: true });
      await screenshot(
        page,
        info,
        `artist-access-accepted-${scale}-${width}`,
        scale,
      );
      await main(page)
        .getByRole('link', { name: copy.backHome, exact: true })
        .click();
      await expect(page).toHaveURL(routes.artist);
      await expect(
        main(page).getByRole('heading', {
          name: messages.auth.artistTitle,
          exact: true,
        }),
      ).toBeVisible();
    });

test('UI creates and saves an artist, then a concurrent edit produces a scoped recoverable conflict without overwriting', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'large');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(adminArtistPath('new'));
  const name = `허구 화면 등록 ${randomUUID().slice(0, 6)}`;
  const slug = `ci-ui-created-${randomUUID()}`;
  await main(page).getByLabel(copy.name, { exact: true }).fill(name);
  await main(page).getByLabel(copy.slug, { exact: true }).fill(slug);
  await main(page)
    .getByLabel(copy.intro, { exact: true })
    .fill('허구 화면 등록 소개');
  await main(page).getByLabel(copy.changeConfirm, { exact: true }).check();
  await button(page, copy.createSave).click();
  await expect(page).toHaveURL(/\/admin\/artists\/[0-9a-f-]{36}$/);
  await expect(
    main(page).getByRole('heading', { name: copy.editTitle, exact: true }),
  ).toBeVisible();
  await expect(main(page).getByLabel(copy.name, { exact: true })).toHaveValue(
    name,
  );
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  const current = (await detail(page.request, id)).artist;
  await save(page.request, current, { name: '먼저 저장된 허구 이름' });
  const editor = main(page).locator('[data-admin-artist-form]');
  await editor.getByLabel(copy.name, { exact: true }).fill('충돌한 이전 입력');
  await editor.getByLabel(copy.changeConfirm, { exact: true }).check();
  await editor.getByRole('button', { name: copy.save, exact: true }).click();
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.CONFLICT);
  await expect(editor).toHaveCount(0);
  await screenshot(page, info, 'admin-artists-conflict-initial', 'large');
  expect((await detail(page.request, id)).artist.name).toBe(
    '먼저 저장된 허구 이름',
  );
  await main(page)
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(main(page).getByLabel(copy.name, { exact: true })).toHaveValue(
    '먼저 저장된 허구 이름',
  );
});

test('UI preview reorder and cancel, invitation cancellation and unlink use explicit confirmation', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'large');
  const sent = await createSentMessages(context, world, true);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  const photo = main(page).locator(`[data-admin-preview-id="${sent[1]!.id}"]`);
  await photo
    .getByRole('button', {
      name: messages.media.open.replace(
        '{kind}',
        messages.artists.messageKinds.photo,
      ),
      exact: true,
    })
    .click();
  const image = photo.getByRole('img', {
    name: messages.media.photoAlt,
    exact: true,
  });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await screenshot(page, info, 'admin-artists-accepted-photo-open', 'large');
  for (const row of sent)
    await main(page)
      .locator(`[data-admin-preview-id="${row.id}"]`)
      .getByLabel(copy.previewCheck, { exact: true })
      .check();
  const second = main(page).locator(
    `[data-admin-selected-preview-id="${sent[1]!.id}"]`,
  );
  await second
    .getByRole('button', { name: copy.previewUp, exact: true })
    .click();
  await button(page, copy.previewSave).click();
  await expect(
    main(page).locator('[data-admin-selected-preview-id]').first(),
  ).toHaveAttribute('data-admin-selected-preview-id', sent[1]!.id);
  expect(
    (await detail(page.request, world.artist.id)).previews.map((row) => row.id),
  ).toEqual([sent[1]!.id, sent[0]!.id]);
  await main(page)
    .locator(`[data-admin-selected-preview-id="${sent[0]!.id}"]`)
    .getByRole('button', { name: copy.previewRemove, exact: true })
    .click();
  await main(page)
    .getByRole('region', { name: copy.previewTitle, exact: true })
    .getByRole('button', { name: copy.cancel, exact: true })
    .click();
  await expect(
    main(page).locator('[data-admin-selected-preview-id]'),
  ).toHaveCount(2);
  expect((await detail(page.request, world.artist.id)).previews).toHaveLength(
    2,
  );
  const request = await offer(page.request, world);
  await button(page, copy.refresh).click();
  const invitation = main(page).locator(
    `[data-admin-invitation-id="${request.invitation.id}"]`,
  );
  await expect(
    invitation.getByRole('button', { name: copy.linkCancel, exact: true }),
  ).toBeDisabled();
  await invitation
    .getByLabel(copy.cancelInviteConfirm, { exact: true })
    .check();
  await invitation
    .getByRole('button', { name: copy.linkCancel, exact: true })
    .click();
  await expect(
    invitation.getByText(copy.linkState.canceled, { exact: true }),
  ).toBeVisible();
  const member = main(page).locator(
    `[data-admin-member-id="${world.author.id}"]`,
  );
  await expect(
    member.getByRole('button', { name: copy.unlink, exact: true }),
  ).toBeDisabled();
  await member.getByLabel(copy.unlinkConfirm, { exact: true }).check();
  await member.getByRole('button', { name: copy.unlink, exact: true }).click();
  await expect(member).toHaveCount(0);
  expect((await detail(page.request, world.artist.id)).previews).toHaveLength(
    2,
  );
});

test('private detail disappears when a current admin loses role and only read-only retry is offered', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'large');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  setRole(world.admin, 'fan');
  await button(page, copy.refresh).click();
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.FORBIDDEN);
  await expect(main(page).locator('[data-admin-artist-form]')).toHaveCount(0);
  await expect(main(page).locator('[data-admin-member-id]')).toHaveCount(0);
  await screenshot(page, info, 'admin-artists-role-lost-initial', 'large');
  setRole(world.admin, 'admin');
  await main(page)
    .getByRole('button', { name: messages.ui.retry, exact: true })
    .click();
  await expect(main(page).getByLabel(copy.name, { exact: true })).toHaveValue(
    world.artist.name,
  );
});

test('xlarge 360: paged management links and expired-session sign-in clear private information', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  addArtists(21);
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(routes.adminArtists);
  await expect(main(page).locator('[data-admin-artist-id]')).toHaveCount(20);
  await screenshot(page, info, 'admin-artists-paging-first', 'xlarge');
  await main(page).getByRole('link', { name: copy.next, exact: true }).click();
  await expect(page).toHaveURL(`${routes.adminArtists}?page=2`);
  await expect(
    main(page).locator('[data-admin-artist-id]').first(),
  ).toBeVisible();
  await screenshot(page, info, 'admin-artists-paging-next', 'xlarge');
  await main(page).getByRole('link', { name: copy.first, exact: true }).click();
  await expect(page).toHaveURL(routes.adminArtists);
  await expect(main(page).locator('[data-admin-artist-id]')).toHaveCount(20);
  await context.clearCookies();
  await button(page, copy.refresh).click();
  await expect(main(page).getByRole('alert')).toHaveText(
    copy.errors.UNAUTHENTICATED,
  );
  await expect(main(page).locator('[data-admin-artist-id]')).toHaveCount(0);
  await screenshot(
    page,
    info,
    'admin-artists-expired-session-initial',
    'xlarge',
  );
  await main(page)
    .getByRole('link', { name: copy.signIn, exact: true })
    .click();
  await expect(page).toHaveURL(routes.start);
  await expect(
    page.getByRole('heading', { name: messages.auth.startTitle, exact: true }),
  ).toBeVisible();
});

test('xlarge 360: missing artist and unapproved account-link policy show initial honest states with no grant controls', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  setFont(world.recipient, 'xlarge');
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(adminArtistPath(randomUUID()));
  await expect(main(page).getByRole('alert')).toHaveText(copy.errors.NOT_FOUND);
  await expect(main(page).locator('[data-admin-artist-form]')).toHaveCount(0);
  await screenshot(page, info, 'admin-artists-not-found-initial', 'xlarge');
  await main(page)
    .getByRole('link', { name: copy.backList, exact: true })
    .click();
  await expect(page).toHaveURL(routes.adminArtists);
  await expect(
    main(page).getByRole('heading', { name: copy.title, exact: true }),
  ).toBeVisible();
  disableLinkPolicy();
  await openDetail(page, world);
  await expect(
    main(page).getByText(copy.linkDisabled, { exact: true }),
  ).toBeVisible();
  await expect(button(page, copy.linkRequest)).toHaveCount(0);
  await screenshot(
    page,
    info,
    'admin-artists-link-unconfigured-initial',
    'xlarge',
  );
  await world.recipient.signIn(context);
  await page.goto(routes.artistAccess);
  await expect(
    main(page).getByText(copy.linkDisabled, { exact: true }),
  ).toBeVisible();
  await expect(
    main(page).getByText(copy.accessEmpty, { exact: true }),
  ).toBeVisible();
  await screenshot(
    page,
    info,
    'artist-access-empty-unconfigured-initial',
    'xlarge',
  );
});

test('xlarge 360: older management content can be selected on page two and recipient history is reachable', async ({
  world,
  context,
  page,
}, info) => {
  setFont(world.admin, 'xlarge');
  setFont(world.recipient, 'xlarge');
  const oldest = seedOlderManagementRows(world);
  await world.admin.signIn(context);
  await page.setViewportSize({ width: 360, height: 900 });
  await openDetail(page, world);
  await expect(main(page).locator('[data-admin-preview-id]')).toHaveCount(50);
  await expect(
    main(page).locator(`[data-admin-preview-id="${oldest.messageId}"]`),
  ).toHaveCount(0);
  const navigation = main(page).getByRole('navigation', {
    name: copy.detailPagination,
    exact: true,
  });
  await navigation
    .getByRole('link', { name: copy.nextPage, exact: true })
    .scrollIntoViewIfNeeded();
  // Keep this long historical page's capture focused on its new controls,
  // rather than an unreviewable tens-of-thousands-pixel full-page bitmap.
  await screenshot(
    page,
    info,
    'admin-artist-detail-page-one-navigation',
    'xlarge',
    false,
  );
  await navigation
    .getByRole('link', { name: copy.nextPage, exact: true })
    .click();
  await expect(page).toHaveURL(adminArtistPath(world.artist.id, 2));
  const olderMessage = main(page).locator(
    `[data-admin-preview-id="${oldest.messageId}"]`,
  );
  await expect(olderMessage).toBeVisible();
  await expect(main(page).locator('[data-admin-preview-id]')).toHaveCount(1);
  await expect(
    main(page).locator(`[data-admin-invitation-id="${oldest.invitationId}"]`),
  ).toBeVisible();
  await screenshot(
    page,
    info,
    'admin-artist-detail-page-two-initial',
    'xlarge',
  );
  await olderMessage.getByLabel(copy.previewCheck, { exact: true }).check();
  await button(page, copy.previewSave).click();
  await expect(
    main(page).locator(
      `[data-admin-selected-preview-id="${oldest.messageId}"]`,
    ),
  ).toBeVisible();
  expect(
    (await detail(page.request, world.artist.id)).previews.map((row) => row.id),
  ).toEqual([oldest.messageId]);
  await screenshot(
    page,
    info,
    'admin-artist-detail-page-two-saved-preview',
    'xlarge',
  );
  await navigation
    .getByRole('link', { name: copy.previousPage, exact: true })
    .click();
  await expect(page).toHaveURL(adminArtistPath(world.artist.id));
  await expect(
    main(page).locator(
      `[data-admin-selected-preview-id="${oldest.messageId}"]`,
    ),
  ).toBeVisible();
  await expect(main(page).locator('[data-admin-preview-id]')).toHaveCount(51);
  await world.recipient.signIn(context);
  await page.goto(routes.artistAccess);
  await expect(main(page).locator('[data-artist-access-id]')).toHaveCount(50);
  await navigation
    .getByRole('link', { name: copy.nextPage, exact: true })
    .click();
  await expect(page).toHaveURL(artistAccessPath(2));
  await expect(main(page).locator('[data-artist-access-id]')).toHaveCount(1);
  const olderInvitation = main(page).locator(
    `[data-artist-access-id="${oldest.invitationId}"]`,
  );
  await expect(
    olderInvitation.getByText(copy.linkState.canceled, { exact: true }),
  ).toBeVisible();
  await expect(button(page, copy.accept)).toHaveCount(0);
  await screenshot(page, info, 'artist-access-page-two-initial', 'xlarge');
  await navigation
    .getByRole('link', { name: copy.previousPage, exact: true })
    .click();
  await expect(page).toHaveURL(artistAccessPath(1));
  await expect(main(page).locator('[data-artist-access-id]')).toHaveCount(50);
  expect(membership(world)).toEqual({ role: 'fan', member: false });
});
