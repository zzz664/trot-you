import { CommunityComposer } from '@/components/community-posts/CommunityComposer';
import { CommunityErrorScreen } from '@/components/community-posts/CommunityErrorScreen';
import { communityCreatePath } from '@/config/routes';
import { artistSlugSchema } from '@/config/artists';
import { getCommunityPostsPage } from '@/server/community-posts/page';
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
  if (
    !artistSlugSchema.safeParse(slug).success ||
    Object.keys(await searchParams).length > 0
  )
    return <CommunityErrorScreen code="INVALID_INPUT" />;
  const path = communityCreatePath(slug);
  return (
    <CommunityComposer
      key={`${identity.data.key}:${path}`}
      slug={slug}
      actorKey={identity.data.key}
      path={path}
    />
  );
}
