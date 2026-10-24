import { ArtistComposer } from '@/components/artist-compose/ArtistComposer';
import { ComposeErrorScreen } from '@/components/artist-compose-menu/ComposeErrorScreen';
import { getComposePage } from '@/server/artist-compose/page';
export default async function ComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const { slug } = await params;
  const { draft } = await searchParams;
  const result = await getComposePage(slug, draft ?? null);
  return result.ok ? (
    <ArtistComposer key={`${slug}:${draft ?? ''}`} initial={result.data} />
  ) : (
    <ComposeErrorScreen code={result.code} />
  );
}
