import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ADMIN_SETTINGS,
  ADMIN_SETTINGS_ERROR_STATUS,
  type AdminSettingsResult,
} from '@/config/admin-settings';
import { createAuthContext } from '@/server/auth/context';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { createAdminSettingsPort } from '@/server/db/admin-settings';
import {
  listAdminSettings,
  saveAdminSettings,
} from '@/server/services/admin-settings/manage';
import { adminSettingsBody } from './security';

export async function adminSettingsHttp(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: AdminSettingsResult<unknown>) =>
    context.apply(
      NextResponse.json(result, {
        status: result.ok
          ? ADMIN_SETTINGS.httpOk
          : ADMIN_SETTINGS_ERROR_STATUS[result.code],
        headers: { 'X-Content-Type-Options': 'nosniff' },
      }),
    );
  try {
    if (!context.configuration || !context.client || !context.port)
      return respond({ ok: false, code: 'SETUP_NOT_READY' });
    if (!['GET', 'POST'].includes(request.method) || request.nextUrl.search)
      return respond({ ok: false, code: 'INVALID_INPUT' });
    if (
      request.method === 'POST' &&
      !isSameOriginPost(
        request.headers.get('origin'),
        context.configuration.appOrigin,
      )
    )
      return respond({ ok: false, code: 'FORBIDDEN' });
    const state = await readSession(context.port);
    if (state.status !== 'authenticated')
      return respond({
        ok: false,
        code:
          state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
      });
    if (isRestricted(state.profile) || state.profile.role !== 'admin')
      return respond({ ok: false, code: 'FORBIDDEN' });
    // The actor-bound RPC independently locks and rechecks current authority.
    const port = createAdminSettingsPort(context.client);
    return respond(
      request.method === 'GET'
        ? await listAdminSettings(port)
        : await saveAdminSettings(port, await adminSettingsBody(request)),
    );
  } catch {
    // No policy values, decision references, sessions or raw errors are logged.
    return respond({ ok: false, code: 'UNAVAILABLE' });
  }
}
