import { SessionPage } from '@/components/auth/SessionPage';
import { routes } from '@/config/routes';

export default function AdminPage() {
  return <SessionPage path={routes.admin} />;
}
