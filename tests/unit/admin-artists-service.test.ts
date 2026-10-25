// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import {
  listAdminArtists,
  getAdminArtist,
  parseAdminArtistPage,
  saveAdminArtist,
  setAdminArtistPreviews,
  inviteArtistAccount,
  cancelArtistInvitation,
  unlinkArtistAccount,
  respondArtistInvitation,
  listArtistInvitations,
  type AdminArtistPort,
} from '@/server/services/admin-artists/manage';
import { ADMIN_ARTISTS, adminArtistInputSchema } from '@/config/admin-artists';
import {
  artist,
  artistInput,
  artistId,
  targetId,
  detail,
  invitation,
  saveInput,
  previewsInput,
  inviteInput,
  cancelInput,
  unlinkInput,
  respondInput,
} from './admin-artists-fixtures';
const port = {
  list: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  previews: vi.fn(),
  invite: vi.fn(),
  cancelInvite: vi.fn(),
  unlink: vi.fn(),
  invitations: vi.fn(),
  respond: vi.fn(),
} satisfies AdminArtistPort;
beforeEach(() => {
  vi.resetAllMocks();
  Object.values(port).forEach((mock) =>
    mock.mockResolvedValue({ ok: true, data: artist }),
  );
});
it.each([undefined, null, '1', '2', '1000'])(
  'accepts bounded page %s',
  (value) => {
    expect(parseAdminArtistPage(value)).toEqual({
      ok: true,
      data: value ? Number(value) : 1,
    });
  },
);
it.each([
  '',
  '0',
  '-1',
  '01',
  '1.2',
  '1e2',
  ' 1',
  '1001',
  [],
  1,
  {},
  '9007199254740993',
])('rejects ambiguous page %#', (value) => {
  expect(parseAdminArtistPage(value)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('lists bounded page and never accepts caller actor identity', async () => {
  port.list.mockResolvedValue({
    ok: true,
    data: { artists: [artist], has_more: false },
  });
  expect((await listAdminArtists(port, '2')).ok).toBe(true);
  expect(port.list).toHaveBeenCalledExactlyOnceWith(2);
});
it('rejects invalid list page before DB', async () => {
  expect(await listAdminArtists(port, ['1'])).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.list).not.toHaveBeenCalled();
});
it('gets validated UUID detail', async () => {
  port.detail.mockResolvedValue({ ok: true, data: detail });
  expect(await getAdminArtist(port, artistId)).toEqual({
    ok: true,
    data: detail,
  });
  expect(port.detail).toHaveBeenCalledWith(artistId, 1);
});
it('rejects invalid resource ID', async () => {
  expect(await getAdminArtist(port, '../other')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.detail).not.toHaveBeenCalled();
});
const cases = [
  ['save', saveAdminArtist, saveInput],
  ['previews', setAdminArtistPreviews, previewsInput],
  ['invite', inviteArtistAccount, inviteInput],
  ['cancelInvite', cancelArtistInvitation, cancelInput],
  ['unlink', unlinkArtistAccount, unlinkInput],
  ['respond', respondArtistInvitation, respondInput],
] as const;
it.each(cases)(
  'validates and forwards %s exactly',
  async (name, run, input) => {
    await run(port, input);
    expect(port[name]).toHaveBeenCalledExactlyOnceWith(input);
  },
);
it.each(cases)(
  'rejects extra actor/provider authority on %s',
  async (name, run, input) => {
    expect(await run(port, { ...input, actor_id: artistId })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port[name]).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  'preserves database CAS/current-role outcome on %s',
  async (name, run, input) => {
    port[name].mockResolvedValue({ ok: false, code: 'CONFLICT' });
    expect(await run(port, input)).toEqual({ ok: false, code: 'CONFLICT' });
  },
);
it.each(cases)('redacts unexpected %s errors', async (name, run, input) => {
  port[name].mockRejectedValue(new Error('private token'));
  expect(await run(port, input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each(
  [
    inviteInput,
    { ...inviteInput, confirmed: false },
    { ...inviteInput, confirmed: undefined },
  ].slice(1),
)('requires explicit admin confirmation %#', async (input) => {
  expect(await inviteArtistAccount(port, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.invite).not.toHaveBeenCalled();
});
it('does not guess email addresses or create Auth accounts', async () => {
  expect(
    await inviteArtistAccount(port, {
      ...inviteInput,
      target_user_id: 'person@example.invalid',
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(port.invite).not.toHaveBeenCalled();
});
it('requires unique preview IDs and preserves supplied order', async () => {
  expect(
    await setAdminArtistPreviews(port, {
      ...previewsInput,
      message_ids: [artistId, artistId],
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(port.previews).not.toHaveBeenCalled();
});
it('rejects price and profile path fields rather than bypassing billing/asset policy', async () => {
  expect(
    await saveAdminArtist(port, {
      ...saveInput,
      input: { ...artistInput, price: 1, profile_image_path: 'other/file' },
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(port.save).not.toHaveBeenCalled();
});
it.each([
  { name: '' },
  { name: 'a\nname' },
  { slug: 'INVALID' },
  { intro: 'x'.repeat(ADMIN_ARTISTS.introLength + 1) },
  { intro: 'bad\u0000text' },
  { display_order: -1 },
  { grade: 'A' },
  { status: 'deleted' },
  { contract_ended_at: '2026-10-25' },
  { contract_started_at: '2026-10-25', contract_ended_at: '2026-10-24' },
  { contract_started_at: '2026-02-31' },
])('rejects invalid artist field combination %#', (input) => {
  expect(
    adminArtistInputSchema.safeParse({ ...artistInput, ...input }).success,
  ).toBe(false);
});
it('lists only actor-scoped invitations with failclosed configuration status', async () => {
  const value = {
    user_id: targetId,
    invitations: [invitation],
    account_link_ready: false,
    has_more: false,
  };
  port.invitations.mockResolvedValue({ ok: true, data: value });
  expect(await listArtistInvitations(port)).toEqual({ ok: true, data: value });
  expect(port.invitations).toHaveBeenCalledExactlyOnceWith(1);
});
it('redacts list/detail/invitation read failures', async () => {
  port.list.mockRejectedValue(new Error('private'));
  port.detail.mockRejectedValue(new Error('private'));
  port.invitations.mockRejectedValue(new Error('private'));
  expect(await listAdminArtists(port, null)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(await getAdminArtist(port, artistId)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(await listArtistInvitations(port)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});

it('paginates detail and recipient reads without silently losing older records', async () => {
  await getAdminArtist(port, artistId, '2');
  expect(port.detail).toHaveBeenCalledWith(artistId, 2);
  await listArtistInvitations(port, '3');
  expect(port.invitations).toHaveBeenCalledWith(3);
});
it('rejects invalid detail or recipient pagination before database access', async () => {
  expect(await getAdminArtist(port, artistId, '0')).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(await listArtistInvitations(port, ['2'])).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.detail).not.toHaveBeenCalled();
  expect(port.invitations).not.toHaveBeenCalled();
});
