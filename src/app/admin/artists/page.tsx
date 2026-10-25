import { AdminArtistsScreen } from '@/components/admin-artists/AdminArtistsScreen';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
import { getAdminArtistsPage } from '@/server/admin-artists/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const result = await getAdminArtistsPage({ page: query.page });
  if (!result.ok) return <AdminArtistsErrorScreen code={result.code} />;
  if (Object.keys(query).some((key) => key !== 'page'))
    return <AdminArtistsErrorScreen code="INVALID_INPUT" />;
  return (
    <AdminArtistsScreen
      key={`${result.data.key}:${result.data.page}`}
      page={result.data.page}
    />
  );
}
