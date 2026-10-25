import { artistSlugSchema } from '@/config/artists';
import { artistContentCalendarPath } from '@/config/routes';
import { getContentCalendarPage } from '@/server/content-calendar/page';
import { resolveContentCalendarMonth } from '@/server/services/content-calendar/read';
import { ArtistContentCalendarScreen } from '@/components/content-calendar/ArtistContentCalendarScreen';
import { ContentCalendarErrorScreen } from '@/components/content-calendar/ContentCalendarErrorScreen';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getContentCalendarPage();
  if (!identity.ok) return <ContentCalendarErrorScreen code={identity.code} />;
  const { slug } = await params;
  const parsed = artistSlugSchema.safeParse(slug);
  const query = await searchParams;
  const month = resolveContentCalendarMonth(query);
  if (!parsed.success || !month.ok)
    return <ContentCalendarErrorScreen code="INVALID_INPUT" />;
  const path = artistContentCalendarPath(
    parsed.data,
    typeof query.month === 'string' ? query.month : undefined,
  );
  return (
    <ArtistContentCalendarScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      slug={parsed.data}
      month={month.data}
      path={path}
    />
  );
}
