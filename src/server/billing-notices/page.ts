import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import { type BillingNoticeResult } from '@/config/billing-notices';
import { createAuthContext } from '@/server/auth/context';
import { readSession } from '@/server/services/auth/session';
import { parseBillingNoticeCursor } from '@/server/services/billing-notices/notices';

// No financial snapshot enters the reusable RSC payload. The mounted client
// requests a fresh owner-only, no-store projection, including after restore.
export async function getBillingNoticesPage(
  input?: unknown,
): Promise<BillingNoticeResult<{ key: string; cursor: string | null }>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  const cursor = parseBillingNoticeCursor(input);
  if (!cursor.ok) return cursor;
  return {
    ok: true,
    data: {
      key: state.profile.id,
      cursor: typeof input === 'string' ? input : null,
    },
  };
}
