import { AdminSchedulesScreen } from '@/components/schedules/AdminSchedulesScreen';
import { ScheduleErrorScreen } from '@/components/schedules/ScheduleErrorScreen';
import { getSchedulePage } from '@/server/schedules/page';
import { resolveAdminScheduleQuery } from '@/server/services/schedules/read';
import { routes } from '@/config/routes';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getSchedulePage(true);
  if (!identity.ok) return <ScheduleErrorScreen admin code={identity.code} />;
  const params = await searchParams;
  const query = resolveAdminScheduleQuery(params);
  if (!query.ok) return <ScheduleErrorScreen admin code={query.code} />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.adminSchedules}${search ? `?${search}` : ''}`;
  return (
    <AdminSchedulesScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      query={query.data}
      path={path}
    />
  );
}
