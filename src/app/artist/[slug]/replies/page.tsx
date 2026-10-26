import { getCommunityPostsPage } from '@/server/community-posts/page';
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
  const identity = await getCommunityPostsPage();
  if (!identity.ok)
    return (
      <ArtistReplyActivityErrorScreen
        code={
          identity.code === 'UNAUTHENTICATED' ||
          identity.code === 'FORBIDDEN' ||
          identity.code === 'SETUP_NOT_READY'
            ? identity.code
            : 'UNAVAILABLE'
        }
      />
    );
  const messageId = result.data.selectedMessage?.id ?? null;
  const currentCursor = typeof cursor === 'string' ? cursor : null;
  return (
    <ArtistReplyActivityScreen
      key={`${identity.data.key}:${result.data.artist.slug}:${messageId ?? ''}:${currentCursor ?? ''}`}
      actorKey={identity.data.key}
      slug={result.data.artist.slug}
      name={result.data.artist.name}
      messageId={messageId}
      cursor={currentCursor}
    />
  );
}
