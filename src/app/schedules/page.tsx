import { SchedulesScreen } from '@/components/schedules/SchedulesScreen';
import { ScheduleErrorScreen } from '@/components/schedules/ScheduleErrorScreen';
import { getSchedulePage } from '@/server/schedules/page';
import { resolveScheduleQuery } from '@/server/services/schedules/read';
import { routes } from '@/config/routes';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getSchedulePage();
  if (!identity.ok) return <ScheduleErrorScreen code={identity.code} />;
  const params = await searchParams;
  const query = resolveScheduleQuery(params);
  if (!query.ok) return <ScheduleErrorScreen code={query.code} />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.schedules}${search ? `?${search}` : ''}`;
  return (
    <SchedulesScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      query={query.data}
      path={path}
    />
  );
}
