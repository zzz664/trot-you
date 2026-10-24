import { ArtistCatalog } from '@/components/artists/ArtistCatalog';
import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { getArtistCatalogPage } from '@/server/artists/page';

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getArtistCatalogPage((await searchParams).page);
  if (!result.ok) return <ArtistErrorScreen code={result.code} />;
  return <ArtistCatalog key={result.data.page} data={result.data} />;
}
