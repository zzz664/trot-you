import { CommunityBoard } from '@/components/community-posts/CommunityBoard';
import { CommunityErrorScreen } from '@/components/community-posts/CommunityErrorScreen';
import { communityBoardPath } from '@/config/routes';
import { getCommunityPostsPage } from '@/server/community-posts/page';
import { resolveCommunityListQuery } from '@/server/services/community-posts/read';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getCommunityPostsPage();
  if (!identity.ok) return <CommunityErrorScreen code={identity.code} />;
  const { slug } = await params;
  const raw = await searchParams;
  if (Object.keys(raw).some((key) => key !== 'cursor'))
    return <CommunityErrorScreen code="INVALID_INPUT" />;
  const query = resolveCommunityListQuery({ slug, ...raw });
  if (!query.ok) return <CommunityErrorScreen code={query.code} />;
  const path = communityBoardPath(
    slug,
    typeof raw.cursor === 'string' ? raw.cursor : null,
  );
  return (
    <CommunityBoard
      key={`${identity.data.key}:${path}`}
      query={query.data}
      actorKey={identity.data.key}
      path={path}
    />
  );
}
