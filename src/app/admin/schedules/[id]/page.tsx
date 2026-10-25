import { z } from 'zod';
import { AdminScheduleCreateScreen } from '@/components/schedules/AdminScheduleCreateScreen';
import { AdminScheduleDetailScreen } from '@/components/schedules/AdminScheduleDetailScreen';
import { ScheduleErrorScreen } from '@/components/schedules/ScheduleErrorScreen';
import { getSchedulePage } from '@/server/schedules/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getSchedulePage(true);
  if (!identity.ok) return <ScheduleErrorScreen admin code={identity.code} />;
  const { id } = await params;
  if (
    Object.keys(await searchParams).length ||
    (id !== 'new' && !z.uuid().safeParse(id).success)
  )
    return <ScheduleErrorScreen admin code="INVALID_INPUT" />;
  return id === 'new' ? (
    <AdminScheduleCreateScreen
      actorKey={identity.data.key}
      key={`${identity.data.key}:${id}`}
    />
  ) : (
    <AdminScheduleDetailScreen
      actorKey={identity.data.key}
      key={`${identity.data.key}:${id}`}
      id={id}
    />
  );
}
