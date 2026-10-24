import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';

export default function RestrictedPage() {
  return <SessionPage path={routes.restricted} />;
}
