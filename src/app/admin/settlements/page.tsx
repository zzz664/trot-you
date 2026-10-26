import { SettlementReportsScreen } from '@/components/settlement-reports/SettlementReportsScreen';
import { SettlementReportsErrorScreen } from '@/components/settlement-reports/SettlementReportsErrorScreen';
import { getSettlementReportsPage } from '@/server/settlement-reports/page';
import { resolveSettlementReportQuery } from '@/server/services/settlement-reports/manage';
import { routes } from '@/config/routes';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getSettlementReportsPage('admin');
  if (!identity.ok)
    return <SettlementReportsErrorScreen code={identity.code} mode="admin" />;
  const params = await searchParams;
  const query = resolveSettlementReportQuery(params);
  if (!query.ok)
    return <SettlementReportsErrorScreen code={query.code} mode="admin" />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.adminSettlements}${search ? `?${search}` : ''}`;
  return (
    <SettlementReportsScreen
      actorKey={identity.data.key}
      mode="admin"
      {...query.data}
      path={path}
    />
  );
}
