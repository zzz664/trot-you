import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ArtistPreviewData } from '@/config/artists';
import type { ChatPage, ChatResult } from '@/config/chat';
import { routes } from '@/config/routes';
import { getArtistPreviewPage } from '@/server/artists/page';
import { createAuthContext } from '@/server/auth/context';
import { createChatPagePort } from '@/server/db/chat';
import { createChatServiceClient } from '@/server/db/chat-client';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readChatPage } from '@/server/services/chat/read';

type Conversation =
  | { kind: 'chat'; chat: ChatPage }
  | { kind: 'preview'; preview: ArtistPreviewData };
export async function getArtistConversationPage(
  slug: unknown,
): Promise<ChatResult<Conversation>> {
  const context = createAuthContext((await cookies()).getAll());
  const session = await readSession(context.port);
  if (session.status === 'anonymous') redirect(routes.start);
  if (session.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code:
        session.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(session.profile)) redirect(routes.restricted);
  if (session.profile.role !== 'fan') redirect(landingPath(session.profile));
  // During onboarding discovery remains reachable before installation finishes.
  // A completed fan's DB projection revalidates current policy/consent/name.
  if (session.profile.onboarding_completed_at) {
    const service = createChatServiceClient();
    if (!service) return { ok: false, code: 'SETUP_NOT_READY' };
    const chat = await readChatPage(
      createChatPagePort(service),
      session.profile.id,
      { slug },
    );
    if (!chat.ok) return chat;
    if (chat.data.hasAccess)
      return { ok: true, data: { kind: 'chat', chat: chat.data } };
  }
  const preview = await getArtistPreviewPage(slug);
  return preview.ok
    ? { ok: true, data: { kind: 'preview', preview: preview.data } }
    : preview;
}
