import { ArtistCatalog } from '@/components/artists/ArtistCatalog';
import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { getArtistCatalogPage } from '@/server/artists/page';

export default async function OnboardingArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getArtistCatalogPage((await searchParams).page, true);
  if (!result.ok) return <ArtistErrorScreen code={result.code} onboarding />;
  return <ArtistCatalog key={result.data.page} data={result.data} />;
}
