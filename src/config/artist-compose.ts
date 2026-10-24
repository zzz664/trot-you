import { z } from 'zod';
import { artistSlugSchema } from './artists';
import { MEDIA_MAX_BYTES, mediaKindSchema } from './media';

// Technical transport ceilings. Effective limits come from approved DB policy.
export const COMPOSE_BODY_LIMIT = 700_000;
export const COMPOSE_BODY_TIMEOUT_MS = 5000;
export const COMPOSE_REQUEST_TIMEOUT_MS = 30_000;
export const COMPOSE_RESPONSE_MAX_BYTES = 16_777_216;
export const COMPOSE_MAX_TEXT_LENGTH = 100_000;
export const COMPOSE_MAX_MEDIA_COUNT = 100;
export const COMPOSE_PAGE_SIZE = 30;
export const COMPOSE_ARTIST_PAGE_SIZE = 50;
export const COMPOSE_CURSOR_MAX_LENGTH = 1024;
export const COMPOSE_HTTP_OK = 200;
export const COMPOSE_MAX_DURATION_SECONDS = 86_400;
export const COMPOSE_MAX_CALL_NAME_LENGTH = 100;
export const COMPOSE_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  TOO_LONG: 400,
  NAME_INVALID: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  MEDIA_PENDING: 409,
  LIMIT_EXCEEDED: 409,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503,
} as const;
export type ComposeError = keyof typeof COMPOSE_ERROR_STATUS;
export type ComposeResult<T> =
  { ok: true; data: T } | { ok: false; code: ComposeError };
export const composeKindSchema = z.enum(['text', 'photo', 'voice', 'video']);
export type ComposeKind = z.output<typeof composeKindSchema>;
export const composeMediaSchema = z
  .strictObject({
    id: z.uuid(),
    kind: mediaKindSchema,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    durationMs: z.number().int().positive().nullable(),
  })
  .refine((media) =>
    media.kind === 'photo'
      ? media.width !== null &&
        media.height !== null &&
        media.durationMs === null
      : media.kind === 'voice'
        ? media.width === null &&
          media.height === null &&
          media.durationMs !== null
        : media.width !== null &&
          media.height !== null &&
          media.durationMs !== null,
  );
export type ComposeMedia = z.output<typeof composeMediaSchema>;
export const composeDraftSchema = z
  .strictObject({
    id: z.uuid(),
    kind: composeKindSchema,
    body: z
      .string()
      .max(COMPOSE_MAX_TEXT_LENGTH * 2)
      .nullable(),
    revision: z.number().int().positive().safe(),
    updatedAt: z.iso.datetime({ offset: true }),
    media: z.array(composeMediaSchema).max(COMPOSE_MAX_MEDIA_COUNT),
    pendingUploadIds: z.array(z.uuid()).max(COMPOSE_MAX_MEDIA_COUNT),
  })
  .refine(
    (draft) =>
      new Set(draft.media.map((item) => item.id)).size === draft.media.length &&
      new Set(draft.pendingUploadIds).size === draft.pendingUploadIds.length &&
      (draft.kind !== 'text' || draft.body !== null) &&
      (draft.kind === 'photo' || draft.media.length <= 1) &&
      draft.media.every((item) => item.kind === draft.kind),
  );
export type ComposeDraft = z.output<typeof composeDraftSchema>;
export const composeArtistSchema = z.strictObject({
  id: z.uuid(),
  slug: artistSlugSchema,
  name: z.string().min(1),
});
export const composePolicySchema = z
  .strictObject({
    maxTextLength: z.number().int().positive().max(COMPOSE_MAX_TEXT_LENGTH),
    maxPhotoCount: z.number().int().positive().max(COMPOSE_MAX_MEDIA_COUNT),
    maxVoiceSeconds: z
      .number()
      .int()
      .positive()
      .max(COMPOSE_MAX_DURATION_SECONDS),
    maxVideoSeconds: z
      .number()
      .int()
      .positive()
      .max(COMPOSE_MAX_DURATION_SECONDS),
    photoMaxBytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
    voiceMaxBytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
    videoMaxBytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
    callNameMinLength: z
      .number()
      .int()
      .positive()
      .max(COMPOSE_MAX_CALL_NAME_LENGTH),
    callNameMaxLength: z
      .number()
      .int()
      .positive()
      .max(COMPOSE_MAX_CALL_NAME_LENGTH),
  })
  .refine((policy) => policy.callNameMaxLength >= policy.callNameMinLength);
export type ComposePolicy = z.output<typeof composePolicySchema>;
export const composePageSchema = z.strictObject({
  artist: composeArtistSchema,
  policy: composePolicySchema,
  drafts: z.array(composeDraftSchema).max(COMPOSE_PAGE_SIZE),
  selectedDraft: composeDraftSchema.nullable(),
  hasMore: z.boolean(),
  nextCursor: z.string().max(COMPOSE_CURSOR_MAX_LENGTH).nullable(),
});
export type ComposePageData = z.output<typeof composePageSchema>;
export const composeCatalogSchema = z.strictObject({
  artists: z.array(composeArtistSchema).max(COMPOSE_ARTIST_PAGE_SIZE),
  hasMore: z.boolean(),
  nextSlug: artistSlugSchema.nullable(),
});
export type ComposeCatalog = z.output<typeof composeCatalogSchema>;
const body = z
  .string()
  .max(COMPOSE_MAX_TEXT_LENGTH * 2)
  .nullable();
export const composePageInputSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid().nullable(),
  cursor: z.string().min(1).max(COMPOSE_CURSOR_MAX_LENGTH).optional(),
});
export type ComposePageInput = z.output<typeof composePageInputSchema>;
export const composeSaveSchema = z
  .strictObject({
    slug: artistSlugSchema,
    messageId: z.uuid(),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().safe(),
    kind: composeKindSchema,
    body,
    mediaIds: z.array(z.uuid()).max(COMPOSE_MAX_MEDIA_COUNT),
  })
  .refine((input) => new Set(input.mediaIds).size === input.mediaIds.length);
export type ComposeSaveInput = z.output<typeof composeSaveSchema>;
export const composeRemoveSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid(),
  mediaId: z.uuid(),
  operationId: z.uuid(),
  expectedRevision: z.number().int().positive().safe(),
});
export type ComposeRemoveInput = z.output<typeof composeRemoveSchema>;
export const composePreviewInputSchema = z.strictObject({
  slug: artistSlugSchema,
  messageId: z.uuid().nullable(),
  kind: composeKindSchema,
  body,
  sampleName: z
    .string()
    .min(1)
    .max(COMPOSE_MAX_CALL_NAME_LENGTH * 2),
});
export type ComposePreviewInput = z.output<typeof composePreviewInputSchema>;
export const composePreviewSchema = z.strictObject({
  text: z.string().nullable(),
  sampleName: z.string(),
});
export type ComposePreview = z.output<typeof composePreviewSchema>;
