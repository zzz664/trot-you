import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';

export default async function HomePage() {
  return <SessionPage path={routes.home} />;
}
