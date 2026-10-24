import { ArtistPreview } from '@/components/artists/ArtistPreview';
import { ArtistErrorScreen } from '@/components/artists/ArtistErrorScreen';
import { getArtistPreviewPage } from '@/server/artists/page';

export default async function ArtistPreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const result = await getArtistPreviewPage((await params).slug);
  if (!result.ok) return <ArtistErrorScreen code={result.code} />;
  return <ArtistPreview key={result.data.artist.slug} data={result.data} />;
}
