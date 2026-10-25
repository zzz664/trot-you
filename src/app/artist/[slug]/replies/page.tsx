import { ArtistReplyActivityErrorScreen } from '@/components/artist-reply-activity/ArtistReplyActivityErrorScreen';
import { ArtistReplyActivityScreen } from '@/components/artist-reply-activity/ArtistReplyActivityScreen';
import { getArtistReplyActivityPage } from '@/server/artist-reply-activity/page';

export default async function ArtistReplyActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    message?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const { slug } = await params;
  const { message, cursor } = await searchParams;
  const result = await getArtistReplyActivityPage(
    slug,
    message ?? null,
    cursor,
  );
  if (!result.ok) return <ArtistReplyActivityErrorScreen code={result.code} />;
  const messageId = result.data.selectedMessage?.id ?? null;
  const currentCursor = typeof cursor === 'string' ? cursor : null;
  return (
    <ArtistReplyActivityScreen
      key={`${result.data.artist.slug}:${messageId ?? ''}:${currentCursor ?? ''}`}
      slug={result.data.artist.slug}
      name={result.data.artist.name}
      messageId={messageId}
      cursor={currentCursor}
    />
  );
}
