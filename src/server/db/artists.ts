import 'server-only';
import { z } from 'zod';
import {
  artistSlugSchema,
  type ArtistError,
  type ArtistResult,
} from '@/config/artists';
import type {
  ArtistCatalogPort,
  ArtistInterestPort,
  ArtistPreviewPort,
} from '@/server/services/artists/discovery';
import type { ActorClient } from './client';
import type { DiscoveryServiceClient } from './discovery-client';

function databaseError(message: string): ArtistResult<never> {
  const errors: Record<string, ArtistError> = {
    DISCOVERY_FORBIDDEN: 'FORBIDDEN',
    DISCOVERY_PROFILE_REQUIRED: 'PROFILE_REQUIRED',
    DISCOVERY_SETUP_NOT_READY: 'SETUP_NOT_READY',
    DISCOVERY_NOT_FOUND: 'NOT_FOUND',
    DISCOVERY_INVALID_INPUT: 'INVALID_INPUT',
    MESSAGE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  };
  return {
    ok: false,
    code: Object.hasOwn(errors, message) ? errors[message]! : 'UNAVAILABLE',
  };
}

const summarySchema = z.object({
  slug: artistSlugSchema,
  name: z.string().min(1),
  intro: z.string().nullable(),
});
const mediaSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['photo', 'voice', 'video']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  duration_ms: z.number().int().positive().nullable(),
});
const messageSchema = z.object({
  id: z.uuid(),
  type: z.enum(['text', 'photo', 'voice', 'video']),
  body_template: z.string().nullable(),
  sent_at: z.string().datetime({ offset: true }),
  media: z.array(mediaSchema),
});

export function createArtistCatalogPort(
  client: ActorClient,
): ArtistCatalogPort {
  return {
    async list(offset, count) {
      // Never SELECT * from artists or even the safe view: no image paths,
      // contract/member/internal artist IDs reach service/browser projections.
      const result = await client
        .from('artist_catalog')
        .select('slug,name,intro')
        .order('slug', { ascending: true })
        .range(offset, offset + count - 1);
      if (result.error) return { ok: false, code: 'UNAVAILABLE' };
      const parsed = z.array(summarySchema).safeParse(result.data);
      if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
      return {
        ok: true,
        data: parsed.data.map(({ slug, name, intro }) => ({
          slug,
          name,
          description: intro,
        })),
      };
    },
  };
}

export function createArtistInterestPort(
  client: ActorClient,
): ArtistInterestPort {
  return {
    async read() {
      const { data, error } = await client
        .rpc('discovery_get_interest')
        .single();
      if (error) return databaseError(error.message);
      if (!data) return { ok: false, code: 'UNAVAILABLE' };
      return {
        ok: true,
        data: {
          selectedSlug: data.selected_slug,
          selectedName: data.selected_name,
          selectedAt: data.selected_at,
        },
      };
    },
    async select(slug) {
      const { error } = await client.rpc('discovery_select_artist', {
        p_artist_slug: slug,
      });
      return error ? databaseError(error.message) : { ok: true, data: null };
    },
  };
}

export function createArtistPreviewPort(
  client: DiscoveryServiceClient,
): ArtistPreviewPort {
  return {
    async read(actorId, slug) {
      const { data, error } = await client
        .rpc('discovery_preview', { p_actor_id: actorId, p_artist_slug: slug })
        .single();
      if (error) return databaseError(error.message);
      if (!data) return { ok: false, code: 'UNAVAILABLE' };
      const parsed = z
        .object({
          artist_slug: artistSlugSchema,
          artist_name: z.string().min(1),
          artist_intro: z.string().nullable(),
          call_name: z.string().min(1),
          messages: z.array(messageSchema),
        })
        .safeParse(data);
      if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
      const value = parsed.data;
      return {
        ok: true,
        data: {
          artist: {
            slug: value.artist_slug,
            name: value.artist_name,
            description: value.artist_intro,
          },
          callName: value.call_name,
          messages: value.messages.map((message) => ({
            id: message.id,
            kind: message.type,
            template: message.body_template,
            sentAt: message.sent_at,
            media: message.media.map(({ id, kind }) => ({
              id,
              kind,
              availability: 'available',
            })),
          })),
        },
      };
    },
  };
}
