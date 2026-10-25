import { z } from 'zod';
import { routes } from '@/config/routes';
import { ADMIN_ARTISTS } from '@/config/admin-artists';
import { getContentCalendarPage } from '@/server/content-calendar/page';
import { resolveContentCalendarMonth } from '@/server/services/content-calendar/read';
import { AdminContentCalendarScreen } from '@/components/content-calendar/AdminContentCalendarScreen';
import { ContentCalendarArtistPicker } from '@/components/content-calendar/ContentCalendarArtistPicker';
import { ContentCalendarErrorScreen } from '@/components/content-calendar/ContentCalendarErrorScreen';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getContentCalendarPage(true);
  if (!identity.ok)
    return <ContentCalendarErrorScreen admin code={identity.code} />;
  const params = await searchParams;
  const parsed = z
    .strictObject({
      month: z.string().optional(),
      artist_id: z.uuid().optional(),
      page: z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(ADMIN_ARTISTS.maxPage))
        .optional(),
    })
    .safeParse(params);
  if (!parsed.success || (parsed.data.artist_id && parsed.data.page))
    return <ContentCalendarErrorScreen admin code="INVALID_INPUT" />;
  const month = resolveContentCalendarMonth(
    parsed.data.month === undefined ? {} : { month: parsed.data.month },
  );
  if (!month.ok) return <ContentCalendarErrorScreen admin code={month.code} />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.adminContentCalendar}${search ? `?${search}` : ''}`;
  return parsed.data.artist_id ? (
    <AdminContentCalendarScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      artistId={parsed.data.artist_id}
      month={month.data}
      path={path}
    />
  ) : (
    <ContentCalendarArtistPicker
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      month={month.data}
      page={parsed.data.page ?? 1}
      path={path}
    />
  );
}
