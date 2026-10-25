import { DispatchHistoryScreen } from '@/components/artist-dispatch/DispatchHistoryScreen';
import { DispatchErrorScreen } from '@/components/artist-dispatch/DispatchErrorScreen';
import { getDispatchHistoryPage } from '@/server/message-dispatch/history-page';
export default async function DispatchHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getDispatchHistoryPage(slug);
  return result.ok ? (
    <DispatchHistoryScreen
      slug={result.data.artist.slug}
      name={result.data.artist.name}
    />
  ) : (
    <DispatchErrorScreen code={result.code} />
  );
}
