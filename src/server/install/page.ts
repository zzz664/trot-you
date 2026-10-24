import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { InstallData, InstallResult } from '@/config/install';
import { routes } from '@/config/routes';
import { createAuthContext } from '@/server/auth/context';
import { getArtistInstallPage } from '@/server/artists/page';
import { createInstallPort } from '@/server/db/install';
import { readInstallState } from '@/server/services/onboarding/install';

export async function getInstallPage(): Promise<InstallResult<InstallData>> {
  const interest = await getArtistInstallPage();
  if (!interest.ok) {
    if (interest.code === 'PROFILE_REQUIRED') redirect(routes.onboarding);
    return {
      ok: false,
      code: interest.code === 'NOT_FOUND' ? 'INTEREST_REQUIRED' : interest.code,
    };
  }
  const context = createAuthContext((await cookies()).getAll());
  if (!context.client) return { ok: false, code: 'SETUP_NOT_READY' };
  const result = await readInstallState(createInstallPort(context.client));
  if (!result.ok) return result;
  if (result.data.completedAt) redirect(routes.home);
  return {
    ok: true,
    data: {
      ...result.data,
      selectedName: interest.data.selectedName,
    },
  };
}

export async function getInstallStatus() {
  const context = createAuthContext((await cookies()).getAll());
  if (!context.client) return { ok: false, code: 'SETUP_NOT_READY' } as const;
  return readInstallState(createInstallPort(context.client));
}
