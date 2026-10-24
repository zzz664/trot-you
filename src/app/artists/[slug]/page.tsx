import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { ArtistPreview } from '@/components/artists/ArtistPreview';
import { FanChat } from '@/components/fan/chat/FanChat';
import { ChatErrorScreen } from '@/components/fan/chat/ChatErrorScreen';
import { getArtistConversationPage } from '@/server/chat/page';

export default async function ArtistConversationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getArtistConversationPage(slug);
  if (!result.ok)
    return result.code === 'SUBSCRIPTION_REQUIRED' ? (
      <ChatErrorScreen code={result.code} slug={slug} />
    ) : (
      <ArtistErrorScreen code={result.code} />
    );
  return result.data.kind === 'chat' ? (
    <FanChat key={slug} data={result.data.chat} />
  ) : (
    <ArtistPreview key={slug} data={result.data.preview} />
  );
}
