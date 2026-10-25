import { AdminArtistDetailScreen } from '@/components/admin-artists/AdminArtistDetailScreen';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
import { getAdminArtistsPage } from '@/server/admin-artists/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const result = await getAdminArtistsPage({
    id: (await params).id,
    page: query.page,
  });
  if (!result.ok) return <AdminArtistsErrorScreen code={result.code} />;
  if (!result.data.id || Object.keys(query).some((key) => key !== 'page'))
    return <AdminArtistsErrorScreen code="INVALID_INPUT" />;
  return (
    <AdminArtistDetailScreen
      key={`${result.data.key}:${result.data.id}:${result.data.page}`}
      id={result.data.id}
      page={result.data.page}
    />
  );
}
