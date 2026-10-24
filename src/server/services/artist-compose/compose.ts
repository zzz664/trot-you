import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  composeCatalogSchema,
  composeDraftSchema,
  composePageInputSchema,
  composePageSchema,
  composePreviewInputSchema,
  composeRemoveSchema,
  composeSaveSchema,
  type ComposeCatalog,
  type ComposeDraft,
  type ComposePageData,
  type ComposePreview,
  type ComposeRemoveInput,
  type ComposeResult,
  type ComposeSaveInput,
} from '@/config/artist-compose';
import { renderMessage } from '@/server/services/message/render';

export type ComposeCursor = { slug: string; updatedAt: string; id: string };
export type RawComposePage = Omit<ComposePageData, 'nextCursor'>;
export type RawComposeCatalog = Omit<ComposeCatalog, 'nextSlug'>;
export type ComposePort = {
  artists(afterSlug: string | null): Promise<ComposeResult<RawComposeCatalog>>;
  context(
    slug: string,
    messageId: string | null,
    before: ComposeCursor | null,
  ): Promise<ComposeResult<RawComposePage>>;
  save(input: ComposeSaveInput): Promise<ComposeResult<ComposeDraft>>;
  remove(input: ComposeRemoveInput): Promise<ComposeResult<ComposeDraft>>;
};
const cursorSchema = z.strictObject({
  slug: artistSlugSchema,
  updatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
function decodeCursor(value: string, slug: string): ComposeCursor | null {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const result = cursorSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return result.success && result.data.slug === slug ? result.data : null;
  } catch {
    return null;
  }
}
function encodeCursor(value: ComposeCursor) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function plainText(value: string) {
  return (
    value.isWellFormed() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  );
}
function validBody(kind: string, body: string | null) {
  return body === null ? kind !== 'text' : !!body.trim() && plainText(body);
}
export async function readComposeArtists(
  port: ComposePort,
  input: unknown = null,
): Promise<ComposeResult<ComposeCatalog>> {
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
    const parsed = composeCatalogSchema.safeParse({
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
export async function readComposeContext(
  port: ComposePort,
  input: unknown,
): Promise<ComposeResult<ComposePageData>> {
  const parsed = composePageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, messageId, cursor } = parsed.data;
  const before = cursor ? decodeCursor(cursor, slug) : null;
  if (cursor && !before) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.context(slug, messageId, before);
    if (!result.ok) return result;
    const page = result.data;
    const last = page.drafts.at(-1);
    if (
      page.artist.slug !== slug ||
      (messageId !== null
        ? page.selectedDraft?.id !== messageId
        : page.selectedDraft !== null) ||
      (page.hasMore && !last) ||
      new Set(page.drafts.map((draft) => draft.id)).size !== page.drafts.length
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const output = composePageSchema.safeParse({
      ...page,
      nextCursor:
        page.hasMore && last
          ? encodeCursor({ slug, updatedAt: last.updatedAt, id: last.id })
          : null,
    });
    return output.success
      ? { ok: true, data: output.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function saveComposeDraft(
  port: ComposePort,
  input: unknown,
): Promise<ComposeResult<ComposeDraft>> {
  const parsed = composeSaveSchema.safeParse(input);
  if (!parsed.success || !validBody(parsed.data.kind, parsed.data.body))
    return { ok: false, code: 'INVALID_INPUT' };
  try {
    // SQL owns current policy, membership, operation binding and revision CAS.
    // Do not pre-read: a lost successful response must replay even if the draft
    // has since moved to a later revision.
    const result = await port.save(parsed.data);
    if (!result.ok) return result;
    const draft = composeDraftSchema.safeParse(result.data);
    return draft.success &&
      draft.data.id === parsed.data.messageId &&
      draft.data.kind === parsed.data.kind &&
      draft.data.body === parsed.data.body &&
      draft.data.revision === parsed.data.expectedRevision + 1
      ? { ok: true, data: draft.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function removeComposeMedia(
  port: ComposePort,
  input: unknown,
): Promise<ComposeResult<ComposeDraft>> {
  const parsed = composeRemoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.remove(parsed.data);
    if (!result.ok) return result;
    const draft = composeDraftSchema.safeParse(result.data);
    return draft.success &&
      draft.data.id === parsed.data.messageId &&
      !draft.data.media.some((media) => media.id === parsed.data.mediaId) &&
      draft.data.revision === parsed.data.expectedRevision + 1
      ? { ok: true, data: draft.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function previewComposeDraft(
  port: ComposePort,
  input: unknown,
): Promise<ComposeResult<ComposePreview>> {
  const parsed = composePreviewInputSchema.safeParse(input);
  if (!parsed.success || !validBody(parsed.data.kind, parsed.data.body))
    return { ok: false, code: 'INVALID_INPUT' };
  const { slug, messageId, body, sampleName } = parsed.data;
  const context = await readComposeContext(port, { slug, messageId });
  if (!context.ok) return context;
  const policy = context.data.policy;
  if (body !== null && Array.from(body).length > policy.maxTextLength)
    return { ok: false, code: 'TOO_LONG' };
  const nameLength = Array.from(sampleName).length;
  if (
    !plainText(sampleName) ||
    sampleName.trim() !== sampleName ||
    /[\r\n\t]/u.test(sampleName) ||
    nameLength < policy.callNameMinLength ||
    nameLength > policy.callNameMaxLength
  )
    return { ok: false, code: 'NAME_INVALID' };
  return {
    ok: true,
    data: { text: renderMessage(body, sampleName), sampleName },
  };
}
