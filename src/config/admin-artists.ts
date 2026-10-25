import { z } from 'zod';
import { artistSlugSchema } from './artists';
import { mediaKindSchema } from './media';

// Transport bounds, not financial or artist onboarding policy. Link approval
// lives in an explicitly provisioned private policy with no production seed.
export const ADMIN_ARTISTS = {
  pageSize: 20,
  maxPage: 1000,
  detailLimit: 50,
  nameLength: 200,
  introLength: 5000,
  agencyLength: 200,
  bodyLimit: 32_768,
  bodyTimeoutMs: 5000,
  requestTimeoutMs: 15_000,
  responseMaxBytes: 512 * 1024,
  maxPreviewCount: 100,
  maxDisplayOrder: 2147483647,
} as const;
export const ADMIN_ARTIST_TIME_ZONE = 'Asia/Seoul';
export const ADMIN_ARTIST_HTTP_OK = 200;
export const ADMIN_ARTIST_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVITATION_EXPIRED: 410,
  INVITATION_CLOSED: 409,
  ACCOUNT_UNAVAILABLE: 409,
  PREVIEWS_INVALID: 409,
  SLUG_CONFLICT: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type AdminArtistError = keyof typeof ADMIN_ARTIST_ERROR_STATUS;
export type AdminArtistResult<T> =
  { ok: true; data: T } | { ok: false; code: AdminArtistError };
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
export const adminArtistStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'retired',
]);
export const adminArtistGradeSchema = z.enum(['B', 'C']);
export const adminArtistInputSchema = z
  .strictObject({
    slug: artistSlugSchema,
    name: text(ADMIN_ARTISTS.nameLength),
    intro: z
      .string()
      .max(ADMIN_ARTISTS.introLength)
      .refine(
        (value) =>
          !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      )
      .nullable(),
    status: adminArtistStatusSchema,
    grade: adminArtistGradeSchema,
    agency_name: text(ADMIN_ARTISTS.agencyLength).nullable(),
    contract_started_at: z.iso.date().nullable(),
    contract_ended_at: z.iso.date().nullable(),
    display_order: z.number().int().min(0).max(ADMIN_ARTISTS.maxDisplayOrder),
  })
  .refine(
    (value) =>
      value.contract_ended_at === null ||
      (value.contract_started_at !== null &&
        value.contract_started_at <= value.contract_ended_at),
  );
export type AdminArtistInput = z.output<typeof adminArtistInputSchema>;
export const adminArtistSchema = adminArtistInputSchema.safeExtend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  updated_at: timestamp,
});
export type AdminArtist = z.output<typeof adminArtistSchema>;
export const adminArtistMessageSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['text', 'photo', 'voice', 'video']),
  body: z.string().nullable(),
  sent_at: timestamp,
  is_preview: z.boolean(),
  preview_order: z.number().int().positive().nullable(),
  media: z
    .array(
      z.strictObject({
        id: z.uuid(),
        kind: mediaKindSchema,
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
        duration_ms: z.number().int().nonnegative().nullable(),
      }),
    )
    .max(ADMIN_ARTISTS.maxPreviewCount),
});
export type AdminArtistMessage = z.output<typeof adminArtistMessageSchema>;
export const artistInvitationSchema = z.strictObject({
  id: z.uuid(),
  artist_id: z.uuid(),
  artist_name: z.string().min(1),
  target_user_id: z.uuid(),
  is_manager: z.boolean(),
  state: z.enum(['pending', 'accepted', 'canceled', 'declined', 'expired']),
  revision: z.number().int().positive(),
  expires_at: timestamp,
});
export type ArtistInvitation = z.output<typeof artistInvitationSchema>;
export const adminArtistListSchema = z.strictObject({
  artists: z.array(adminArtistSchema).max(ADMIN_ARTISTS.pageSize),
  has_more: z.boolean(),
});
export type AdminArtistList = z.output<typeof adminArtistListSchema>;
export const adminArtistDetailSchema = z.strictObject({
  artist: adminArtistSchema,
  previews: z
    .array(adminArtistMessageSchema)
    .max(ADMIN_ARTISTS.maxPreviewCount),
  messages: z.array(adminArtistMessageSchema).max(ADMIN_ARTISTS.detailLimit),
  members: z
    .array(z.strictObject({ user_id: z.uuid(), is_manager: z.boolean() }))
    .max(ADMIN_ARTISTS.detailLimit),
  invitations: z.array(artistInvitationSchema).max(ADMIN_ARTISTS.detailLimit),
  account_link_ready: z.boolean(),
  preview_max_count: z
    .number()
    .int()
    .nonnegative()
    .max(ADMIN_ARTISTS.maxPreviewCount),
  messages_has_more: z.boolean(),
  members_has_more: z.boolean(),
  invitations_has_more: z.boolean(),
});
export type AdminArtistDetail = z.output<typeof adminArtistDetailSchema>;
export const artistAccountInvitationsSchema = z
  .strictObject({
    user_id: z.uuid(),
    invitations: z.array(artistInvitationSchema).max(ADMIN_ARTISTS.detailLimit),
    account_link_ready: z.boolean(),
    has_more: z.boolean(),
  })
  .refine((value) =>
    value.invitations.every(
      (invitation) => invitation.target_user_id === value.user_id,
    ),
  );
export type ArtistAccountInvitations = z.output<
  typeof artistAccountInvitationsSchema
>;
const operation = {
  operation_id: z.uuid(),
  expected_revision: z.number().int().nonnegative(),
};
export const adminArtistSaveSchema = z.strictObject({
  artist_id: z.uuid(),
  ...operation,
  input: adminArtistInputSchema,
});
export const adminArtistPreviewsSchema = z
  .strictObject({
    artist_id: z.uuid(),
    ...operation,
    message_ids: z.array(z.uuid()).max(ADMIN_ARTISTS.maxPreviewCount),
  })
  .refine(
    (value) => new Set(value.message_ids).size === value.message_ids.length,
  );
export const adminArtistInviteSchema = z.strictObject({
  artist_id: z.uuid(),
  target_user_id: z.uuid(),
  is_manager: z.boolean(),
  ...operation,
  confirmed: z.literal(true),
});
export const adminArtistCancelInviteSchema = z.strictObject({
  invitation_id: z.uuid(),
  ...operation,
  confirmed: z.literal(true),
});
export const adminArtistUnlinkSchema = z.strictObject({
  artist_id: z.uuid(),
  target_user_id: z.uuid(),
  ...operation,
  confirmed: z.literal(true),
});
export const artistAccountRespondSchema = z.strictObject({
  invitation_id: z.uuid(),
  ...operation,
  accept: z.boolean(),
  confirmed: z.literal(true),
});
export type AdminArtistSaveInput = z.output<typeof adminArtistSaveSchema>;
export type AdminArtistPreviewsInput = z.output<
  typeof adminArtistPreviewsSchema
>;
export type AdminArtistInviteInput = z.output<typeof adminArtistInviteSchema>;
export type AdminArtistCancelInviteInput = z.output<
  typeof adminArtistCancelInviteSchema
>;
export type AdminArtistUnlinkInput = z.output<typeof adminArtistUnlinkSchema>;
export type ArtistAccountRespondInput = z.output<
  typeof artistAccountRespondSchema
>;
export type AdminArtistAction =
  'save' | 'previews' | 'invite' | 'cancel-invite' | 'unlink';
