import { ArtistInstallPending } from '@/components/artists/ArtistInstallPending';
import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { getArtistInstallPage } from '@/server/artists/page';

export default async function OnboardingInstallPage() {
  const result = await getArtistInstallPage();
  if (!result.ok) return <ArtistErrorScreen code={result.code} onboarding />;
  return <ArtistInstallPending data={result.data} />;
}
