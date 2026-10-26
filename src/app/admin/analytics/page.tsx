import { AnalyticsFunnelScreen } from '@/components/analytics-funnel/AnalyticsFunnelScreen';
import { AnalyticsFunnelErrorScreen } from '@/components/analytics-funnel/AnalyticsFunnelErrorScreen';
import { getAnalyticsFunnelPage } from '@/server/analytics-funnel/page';
import { resolveAnalyticsFunnelQuery } from '@/server/services/analytics-funnel/read';
import { routes } from '@/config/routes';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getAnalyticsFunnelPage();
  if (!identity.ok) return <AnalyticsFunnelErrorScreen code={identity.code} />;
  const params = await searchParams;
  const query = resolveAnalyticsFunnelQuery(params);
  if (!query.ok) return <AnalyticsFunnelErrorScreen code={query.code} />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.analyticsFunnel}${search ? `?${search}` : ''}`;
  return (
    <AnalyticsFunnelScreen
      key={`${identity.data.key}:${path}`}
      actorKey={identity.data.key}
      query={query.data}
      path={path}
    />
  );
}
