import { AttendancePointsScreen } from '@/components/attendance-points/AttendancePointsScreen';
import { AttendancePointsErrorScreen } from '@/components/attendance-points/AttendancePointsErrorScreen';
import { getAttendancePointsPage } from '@/server/attendance-points/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAttendancePointsPage();
  if (!result.ok) return <AttendancePointsErrorScreen code={result.code} />;
  if (Object.keys(await searchParams).length)
    return <AttendancePointsErrorScreen code="INVALID_INPUT" />;
  return <AttendancePointsScreen actorKey={result.data.key} />;
}
