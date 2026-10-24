import 'server-only';
import { z } from 'zod';
import {
  ARTIST_MAX_PAGE,
  ARTIST_PAGE_SIZE,
  artistSelectionSchema,
  artistSlugSchema,
  type ArtistCatalogData,
  type ArtistInterest,
  type ArtistPreviewData,
  type ArtistResult,
  type ArtistSelectionResult,
  type ArtistSummary,
  type PreviewMedia,
} from '@/config/artists';
import { routes } from '@/config/routes';
import { renderMessage } from '@/server/services/message/render';

export type RawArtistPreview = {
  artist: ArtistSummary;
  callName: string;
  messages: {
    id: string;
    kind: 'text' | 'photo' | 'voice' | 'video';
    template: string | null;
    sentAt: string;
    media: PreviewMedia[];
  }[];
};
export type ArtistCatalogPort = {
  list(offset: number, count: number): Promise<ArtistResult<ArtistSummary[]>>;
};
export type ArtistInterestPort = {
  read(): Promise<ArtistResult<ArtistInterest>>;
  select(slug: string): Promise<ArtistResult<null>>;
};
export type ArtistPreviewPort = {
  read(actorId: string, slug: string): Promise<ArtistResult<RawArtistPreview>>;
};

export function artistPageNumber(input: unknown): number | null {
  if (input === undefined) return 1;
  if (typeof input !== 'string' || !/^[1-9][0-9]*$/.test(input)) return null;
  const page = Number(input);
  return Number.isSafeInteger(page) && page <= ARTIST_MAX_PAGE ? page : null;
}

export async function listArtists(
  port: ArtistCatalogPort,
  input: unknown,
): Promise<ArtistResult<ArtistCatalogData>> {
  const page = artistPageNumber(input);
  if (page === null) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.list(
      (page - 1) * ARTIST_PAGE_SIZE,
      ARTIST_PAGE_SIZE + 1,
    );
    if (!result.ok) return result;
    return {
      ok: true,
      data: {
        artists: result.data.slice(0, ARTIST_PAGE_SIZE),
        page,
        hasNext: result.data.length > ARTIST_PAGE_SIZE,
        selectedSlug: null,
        selectedName: null,
        onboarding: false,
      },
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function readArtistInterest(
  port: ArtistInterestPort,
): Promise<ArtistResult<ArtistInterest>> {
  try {
    return await port.read();
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function selectArtist(
  port: ArtistInterestPort,
  input: unknown,
): Promise<ArtistSelectionResult> {
  const parsed = artistSelectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.select(parsed.data.slug);
    return result.ok ? { ok: true, next: routes.onboardingInstall } : result;
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function readArtistPreview(
  port: ArtistPreviewPort,
  actorId: string,
  slug: unknown,
): Promise<ArtistResult<ArtistPreviewData>> {
  const parsed = artistSlugSchema.safeParse(slug);
  if (!parsed.success) return { ok: false, code: 'NOT_FOUND' };
  if (!z.uuid().safeParse(actorId).success)
    return { ok: false, code: 'FORBIDDEN' };
  try {
    const result = await port.read(actorId, parsed.data);
    if (!result.ok) return result;
    const { artist, callName, messages } = result.data;
    // Whitelisted projections only: never serialize the raw result/calling
    // name, author/member/contract IDs, templates or private storage paths.
    return {
      ok: true,
      data: {
        artist: {
          slug: artist.slug,
          name: artist.name,
          description: artist.description,
        },
        messages: messages.map((message) => ({
          id: message.id,
          kind: message.kind,
          text: renderMessage(message.template, callName),
          sentAt: message.sentAt,
          media: message.media.map(({ kind }) => ({
            kind,
            availability: 'unavailable',
          })),
        })),
        selectedSlug: null,
        onboarding: false,
      },
    };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
