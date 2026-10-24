import 'server-only';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { ComposePageData, ComposeResult } from '@/config/artist-compose';
import { getComposePage } from '@/server/artist-compose/page';
import { createAuthContext } from '@/server/auth/context';
import { createDispatchPort } from '@/server/db/message-dispatch';
import { isRestricted } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readDispatchContext } from '@/server/services/message-dispatch/dispatch';

type ComposeScreen = { initial: ComposePageData; initialDispatchedId?: string };
export async function getComposeDispatchPage(
  slug: unknown,
  messageId: unknown,
): Promise<ComposeResult<ComposeScreen>> {
  const compose = await getComposePage(slug, messageId);
  if (compose.ok) return { ok: true, data: { initial: compose.data } };
  if (
    !['NOT_FOUND', 'CONFLICT'].includes(compose.code) ||
    !z.uuid().safeParse(messageId).success
  )
    return compose;
  // A published draft no longer belongs in the editable draft RPC. On reload
  // of its old URL, recover only an exact currently owned dispatch receipt;
  // never turn another artist's missing resource into an apparent success.
  const context = createAuthContext((await cookies()).getAll());
  const session = await readSession(context.port);
  if (
    !context.client ||
    session.status !== 'authenticated' ||
    session.profile.role !== 'artist' ||
    isRestricted(session.profile)
  )
    return compose;
  const recovered = await readDispatchContext(
    createDispatchPort(context.client),
    { slug, messageId },
  );
  if (!recovered.ok)
    return recovered.code === 'NOT_FOUND'
      ? compose
      : { ok: false, code: 'UNAVAILABLE' };
  if (!recovered.data.selectedMessage) return compose;
  const clean = await getComposePage(slug, null);
  return clean.ok
    ? {
        ok: true,
        data: {
          initial: clean.data,
          initialDispatchedId: recovered.data.selectedMessage.id,
        },
      }
    : clean;
}
