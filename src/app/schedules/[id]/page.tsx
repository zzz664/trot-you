import { z } from 'zod';
import { ScheduleDetailScreen } from '@/components/schedules/ScheduleDetailScreen';
import { ScheduleErrorScreen } from '@/components/schedules/ScheduleErrorScreen';
import { getSchedulePage } from '@/server/schedules/page';
import { scheduleMonthSchema } from '@/config/schedules';
import { scheduleDetailPath } from '@/config/routes';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getSchedulePage();
  if (!identity.ok) return <ScheduleErrorScreen code={identity.code} />;
  const { id } = await params;
  const query = z
    .strictObject({ month: scheduleMonthSchema.optional() })
    .safeParse(await searchParams);
  if (!z.uuid().safeParse(id).success || !query.success)
    return <ScheduleErrorScreen code="INVALID_INPUT" />;
  const path = scheduleDetailPath(id, query.data.month);
  return (
    <ScheduleDetailScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      id={id}
      month={query.data.month ?? null}
      path={path}
    />
  );
}
