import { AdminArtistCreateScreen } from '@/components/admin-artists/AdminArtistCreateScreen';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
import { getAdminArtistsPage } from '@/server/admin-artists/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAdminArtistsPage({ id: 'new' });
  if (!result.ok) return <AdminArtistsErrorScreen code={result.code} />;
  if (Object.keys(await searchParams).length)
    return <AdminArtistsErrorScreen code="INVALID_INPUT" />;
  return <AdminArtistCreateScreen key={result.data.key} />;
}
