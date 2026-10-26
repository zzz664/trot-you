import { AdminModerationScreen } from '@/components/community-moderation/AdminModerationScreen';
import { ModerationErrorScreen } from '@/components/community-moderation/ModerationErrorScreen';
import { getCommunityModerationPage } from '@/server/community-moderation/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getCommunityModerationPage(true);
  if (!result.ok) return <ModerationErrorScreen code={result.code} admin />;
  if (Object.keys(await searchParams).length)
    return <ModerationErrorScreen code="INVALID_INPUT" admin />;
  return <AdminModerationScreen actorKey={result.data.key} />;
}
