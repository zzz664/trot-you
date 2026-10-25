import { ArtistAccessScreen } from '@/components/admin-artists/ArtistAccessScreen';
import { AdminArtistsErrorScreen } from '@/components/admin-artists/AdminArtistsErrorScreen';
import { getArtistAccessPage } from '@/server/admin-artists/page';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const result = await getArtistAccessPage(query.page);
  if (!result.ok) return <AdminArtistsErrorScreen code={result.code} access />;
  if (Object.keys(query).some((key) => key !== 'page'))
    return <AdminArtistsErrorScreen code="INVALID_INPUT" access />;
  return (
    <ArtistAccessScreen
      key={`${result.data.key}:${result.data.page}`}
      identityId={result.data.key}
      page={result.data.page}
    />
  );
}
