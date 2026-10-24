import 'server-only';
import { artistSlugSchema } from '@/config/artists';
import {
  dispatchCatalogSchema,
  type DispatchCatalog,
  type DispatchResult,
} from '@/config/message-dispatch';
export type RawDispatchCatalog = Omit<DispatchCatalog, 'nextSlug'>;
export type DispatchCatalogPort = {
  artists(
    afterSlug: string | null,
  ): Promise<DispatchResult<RawDispatchCatalog>>;
};
export async function readDispatchArtists(
  port: DispatchCatalogPort,
  input: unknown,
): Promise<DispatchResult<DispatchCatalog>> {
  const after = artistSlugSchema.nullable().safeParse(input);
  if (!after.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.artists(after.data);
    if (!result.ok) return result;
    const last = result.data.artists.at(-1);
    if (
      (result.data.hasMore && !last) ||
      new Set(result.data.artists.map((artist) => artist.slug)).size !==
        result.data.artists.length ||
      result.data.artists.some(
        (artist) => after.data !== null && artist.slug <= after.data,
      )
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const parsed = dispatchCatalogSchema.safeParse({
      ...result.data,
      nextSlug: result.data.hasMore && last ? last.slug : null,
    });
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
