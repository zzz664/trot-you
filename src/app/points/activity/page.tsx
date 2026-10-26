import { ActivityRewardsScreen } from '@/components/activity-rewards/ActivityRewardsScreen';
import { ActivityRewardsErrorScreen } from '@/components/activity-rewards/ActivityRewardsErrorScreen';
import { getActivityRewardsPage } from '@/server/activity-rewards/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getActivityRewardsPage();
  if (!result.ok) return <ActivityRewardsErrorScreen code={result.code} />;
  if (Object.keys(await searchParams).length)
    return <ActivityRewardsErrorScreen code="INVALID_INPUT" />;
  return <ActivityRewardsScreen actorKey={result.data.key} />;
}
