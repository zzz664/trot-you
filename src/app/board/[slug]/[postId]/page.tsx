import { CommunityPostDetail } from '@/components/community-posts/CommunityPostDetail';
import { CommunityErrorScreen } from '@/components/community-posts/CommunityErrorScreen';
import { communityPostPath } from '@/config/routes';
import { communityDetailQuerySchema } from '@/config/community-posts';
import { getCommunityPostsPage } from '@/server/community-posts/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; postId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getCommunityPostsPage();
  if (!identity.ok) return <CommunityErrorScreen code={identity.code} />;
  const { slug, postId } = await params;
  if (
    !communityDetailQuerySchema.safeParse({ slug, post_id: postId }).success ||
    Object.keys(await searchParams).length > 0
  )
    return <CommunityErrorScreen code="INVALID_INPUT" />;
  const path = communityPostPath(slug, postId);
  return (
    <CommunityPostDetail
      key={`${identity.data.key}:${path}`}
      slug={slug}
      postId={postId}
      actorKey={identity.data.key}
      path={path}
    />
  );
}
