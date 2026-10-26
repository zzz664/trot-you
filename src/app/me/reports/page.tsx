import { ModerationNoticesScreen } from '@/components/community-moderation/ModerationNoticesScreen';
import { ModerationErrorScreen } from '@/components/community-moderation/ModerationErrorScreen';
import { getCommunityModerationPage } from '@/server/community-moderation/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getCommunityModerationPage();
  if (!result.ok) return <ModerationErrorScreen code={result.code} />;
  if (Object.keys(await searchParams).length)
    return <ModerationErrorScreen code="INVALID_INPUT" />;
  return <ModerationNoticesScreen actorKey={result.data.key} />;
}
