import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';

export default function ArtistPage() {
  return <SessionPage path={routes.artist} />;
}
