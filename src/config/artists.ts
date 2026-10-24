import { z } from 'zod';

// Technical pagination/request bounds, not artist eligibility/business policy.
export const ARTIST_PAGE_SIZE = 12;
export const ARTIST_MAX_PAGE = 1000;
export const ARTIST_BODY_LIMIT = 1024;
export const ARTIST_REQUEST_TIMEOUT_MS = 15_000;
export const ARTIST_SLUG_MAX_LENGTH = 128;
export const MESSAGE_NAME_TOKEN = '{이름}';
export const artistSlugSchema = z
  .string()
  .min(1)
  .max(ARTIST_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const artistSelectionSchema = z.strictObject({ slug: artistSlugSchema });
export type ArtistSelectionInput = z.output<typeof artistSelectionSchema>;
export const ARTIST_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  PROFILE_REQUIRED: 409,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503,
} as const;
export type ArtistError = keyof typeof ARTIST_ERROR_STATUS;
export type ArtistResult<T> =
  { ok: true; data: T } | { ok: false; code: ArtistError };
export type ArtistSelectionResult =
  { ok: true; next: string } | { ok: false; code: ArtistError };
export type ArtistSummary = {
  slug: string;
  name: string;
  description: string | null;
};
export type ArtistInterest = {
  selectedSlug: string | null;
  selectedName: string | null;
  selectedAt: string | null;
};
export type ArtistCatalogData = {
  artists: ArtistSummary[];
  page: number;
  hasNext: boolean;
  selectedSlug: string | null;
  selectedName: string | null;
  onboarding: boolean;
};
export type PreviewMedia =
  | { kind: 'photo' | 'voice' | 'video'; availability: 'unavailable' }
  | {
      id: string;
      kind: 'photo' | 'voice' | 'video';
      availability: 'available';
    };
export type ArtistPreviewMessage = {
  id: string;
  kind: 'text' | 'photo' | 'voice' | 'video';
  text: string | null;
  sentAt: string;
  media: PreviewMedia[];
};
export type ArtistPreviewData = {
  artist: ArtistSummary;
  messages: ArtistPreviewMessage[];
  selectedSlug: string | null;
  onboarding: boolean;
};
