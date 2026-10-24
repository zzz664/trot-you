import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { pageRedirect } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createAuthContext } from './context';

// Invoke at each page/data boundary, not only in a persistent layout. Proxy
// refreshes and forwards cookies; this independently verifies authentication.
export async function guardPage(pathname: string) {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  const target = pageRedirect(state, pathname);
  if (target) redirect(target);
  return state;
}
