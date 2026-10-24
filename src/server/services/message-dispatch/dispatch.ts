import 'server-only';
import { z } from 'zod';
import { artistSlugSchema } from '@/config/artists';
import {
  dispatchPageInputSchema,
  dispatchPageSchema,
  dispatchMessageSchema,
  dispatchSubmitSchema,
  dispatchCancelSchema,
  type DispatchPageData,
  type DispatchMessage,
  type DispatchSubmitInput,
  type DispatchCancelInput,
  type DispatchResult,
} from '@/config/message-dispatch';

export type DispatchCursor = { slug: string; createdAt: string; id: string };
export type RawDispatchPage = Omit<DispatchPageData, 'nextCursor'>;
export type DispatchPort = {
  context(
    slug: string,
    messageId: string | null,
    before: DispatchCursor | null,
  ): Promise<DispatchResult<RawDispatchPage>>;
  submit(input: DispatchSubmitInput): Promise<DispatchResult<DispatchMessage>>;
  cancel(input: DispatchCancelInput): Promise<DispatchResult<DispatchMessage>>;
};
const cursorSchema = z.strictObject({
  slug: artistSlugSchema,
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
function decodeCursor(value: string, slug: string): DispatchCursor | null {
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const parsed = cursorSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    return parsed.success && parsed.data.slug === slug ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function readDispatchContext(
  port: DispatchPort,
  input: unknown,
): Promise<DispatchResult<DispatchPageData>> {
  const parsed = dispatchPageInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const { slug, messageId, cursor } = parsed.data;
  const before = cursor ? decodeCursor(cursor, slug) : null;
  if (cursor && !before) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.context(slug, messageId, before);
    if (!result.ok) return result;
    const page = result.data;
    const last = page.messages.at(-1);
    if (
      page.artist.slug !== slug ||
      (messageId === null
        ? page.selectedMessage !== null
        : page.selectedMessage?.id !== messageId) ||
      (page.hasMore && !last) ||
      new Set(page.messages.map((item) => item.id)).size !==
        page.messages.length
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const output = dispatchPageSchema.safeParse({
      ...page,
      nextCursor:
        page.hasMore && last
          ? Buffer.from(
              JSON.stringify({ slug, createdAt: last.createdAt, id: last.id }),
              'utf8',
            ).toString('base64url')
          : null,
    });
    if (
      !output.success ||
      (cursor !== undefined && output.data.nextCursor === cursor)
    )
      return { ok: false, code: 'UNAVAILABLE' };
    return { ok: true, data: output.data };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function submitDispatch(
  port: DispatchPort,
  input: unknown,
): Promise<DispatchResult<DispatchMessage>> {
  const parsed = dispatchSubmitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    // No pre-read or application-clock schedule rejection: an exact retry can
    // arrive after the scheduled instant or after cancellation. SQL binds the
    // original confirmed intent and returns the current authoritative receipt.
    const result = await port.submit(parsed.data);
    if (!result.ok) return result;
    const item = dispatchMessageSchema.safeParse(result.data);
    return item.success && item.data.id === parsed.data.messageId
      ? { ok: true, data: item.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function cancelDispatch(
  port: DispatchPort,
  input: unknown,
): Promise<DispatchResult<DispatchMessage>> {
  const parsed = dispatchCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await port.cancel(parsed.data);
    if (!result.ok) return result;
    const item = dispatchMessageSchema.safeParse(result.data);
    return item.success &&
      item.data.id === parsed.data.messageId &&
      item.data.status === 'canceled'
      ? { ok: true, data: item.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
