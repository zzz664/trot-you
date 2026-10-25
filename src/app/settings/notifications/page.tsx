import { WebPushSettings } from '@/components/webpush/WebPushSettings';
import { WebPushErrorScreen } from '@/components/webpush/WebPushErrorScreen';
import { getWebPushPage } from '@/server/webpush/page';

export default async function NotificationsPage() {
  const result = await getWebPushPage();
  return result.ok ? (
    <WebPushSettings key={result.data.key} initial={result.data.initial} />
  ) : (
    <WebPushErrorScreen code={result.code} />
  );
}
