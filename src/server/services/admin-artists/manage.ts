import 'server-only';
import { z } from 'zod';
import {
  ADMIN_ARTISTS,
  adminArtistSaveSchema,
  adminArtistPreviewsSchema,
  adminArtistInviteSchema,
  adminArtistCancelInviteSchema,
  adminArtistUnlinkSchema,
  artistAccountRespondSchema,
  type AdminArtist,
  type AdminArtistList,
  type AdminArtistDetail,
  type ArtistInvitation,
  type ArtistAccountInvitations,
  type AdminArtistResult,
  type AdminArtistSaveInput,
  type AdminArtistPreviewsInput,
  type AdminArtistInviteInput,
  type AdminArtistCancelInviteInput,
  type AdminArtistUnlinkInput,
  type ArtistAccountRespondInput,
} from '@/config/admin-artists';

export type AdminArtistPort = {
  list(page: number): Promise<AdminArtistResult<AdminArtistList>>;
  detail(
    id: string,
    page: number,
  ): Promise<AdminArtistResult<AdminArtistDetail>>;
  save(input: AdminArtistSaveInput): Promise<AdminArtistResult<AdminArtist>>;
  previews(
    input: AdminArtistPreviewsInput,
  ): Promise<AdminArtistResult<AdminArtist>>;
  invite(
    input: AdminArtistInviteInput,
  ): Promise<AdminArtistResult<ArtistInvitation>>;
  cancelInvite(
    input: AdminArtistCancelInviteInput,
  ): Promise<AdminArtistResult<ArtistInvitation>>;
  unlink(
    input: AdminArtistUnlinkInput,
  ): Promise<AdminArtistResult<AdminArtist>>;
  invitations(
    page: number,
  ): Promise<AdminArtistResult<ArtistAccountInvitations>>;
  respond(
    input: ArtistAccountRespondInput,
  ): Promise<AdminArtistResult<ArtistInvitation>>;
};
export function parseAdminArtistPage(
  input: unknown,
): AdminArtistResult<number> {
  if (input === undefined || input === null) return { ok: true, data: 1 };
  if (typeof input !== 'string' || !/^[1-9][0-9]*$/.test(input))
    return { ok: false, code: 'INVALID_INPUT' };
  const page = Number(input);
  return Number.isSafeInteger(page) && page <= ADMIN_ARTISTS.maxPage
    ? { ok: true, data: page }
    : { ok: false, code: 'INVALID_INPUT' };
}
async function execute<I, O>(
  schema: z.ZodType<I>,
  input: unknown,
  run: (input: I) => Promise<AdminArtistResult<O>>,
): Promise<AdminArtistResult<O>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    return await run(parsed.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function listAdminArtists(
  port: AdminArtistPort,
  input: unknown,
): Promise<AdminArtistResult<AdminArtistList>> {
  const page = parseAdminArtistPage(input);
  if (!page.ok) return page;
  try {
    return await port.list(page.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export function getAdminArtist(
  port: AdminArtistPort,
  id: unknown,
  pageInput?: unknown,
) {
  const page = parseAdminArtistPage(pageInput);
  if (!page.ok) return Promise.resolve(page);
  return execute(z.uuid(), id, (value) => port.detail(value, page.data));
}
export function saveAdminArtist(port: AdminArtistPort, input: unknown) {
  return execute(adminArtistSaveSchema, input, (value) => port.save(value));
}
export function setAdminArtistPreviews(port: AdminArtistPort, input: unknown) {
  return execute(adminArtistPreviewsSchema, input, (value) =>
    port.previews(value),
  );
}
export function inviteArtistAccount(port: AdminArtistPort, input: unknown) {
  return execute(adminArtistInviteSchema, input, (value) => port.invite(value));
}
export function cancelArtistInvitation(port: AdminArtistPort, input: unknown) {
  return execute(adminArtistCancelInviteSchema, input, (value) =>
    port.cancelInvite(value),
  );
}
export function unlinkArtistAccount(port: AdminArtistPort, input: unknown) {
  return execute(adminArtistUnlinkSchema, input, (value) => port.unlink(value));
}
export function respondArtistInvitation(port: AdminArtistPort, input: unknown) {
  return execute(artistAccountRespondSchema, input, (value) =>
    port.respond(value),
  );
}
export async function listArtistInvitations(
  port: AdminArtistPort,
  pageInput?: unknown,
): Promise<AdminArtistResult<ArtistAccountInvitations>> {
  const page = parseAdminArtistPage(pageInput);
  if (!page.ok) return page;
  try {
    return await port.invitations(page.data);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
