import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  INSTALL_BODY_LIMIT,
  INSTALL_ERROR_STATUS,
  installInputSchema,
  type InstallSubmitResult,
} from '@/config/install';
import { AnalyticsEvent } from '@/config/analytics-events';
import { captureServerEvent } from '@/server/services/analytics/capture';
import { getAnalyticsCapturePort } from '@/server/analytics/capture';
import { createAuthContext } from '@/server/auth/context';
import { createInstallPort } from '@/server/db/install';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { submitInstall } from '@/server/services/onboarding/install';

async function boundedJson(request: NextRequest): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Error('INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > INSTALL_BODY_LIMIT) {
        await reader.cancel();
        throw new Error('INVALID_INPUT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

export async function installPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: InstallSubmitResult) =>
    context.apply(
      NextResponse.json(
        result,
        result.ok
          ? {}
          : {
              status: INSTALL_ERROR_STATUS[result.code],
            },
      ),
    );
  if (!context.configuration || !context.client || !context.port)
    return respond({ ok: false, code: 'SETUP_NOT_READY' });
  if (
    !isSameOriginPost(
      request.headers.get('origin'),
      context.configuration.appOrigin,
    )
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  const session = await readSession(context.port);
  if (session.status !== 'authenticated')
    return respond({
      ok: false,
      code:
        session.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (isRestricted(session.profile) || session.profile.role !== 'fan')
    return respond({ ok: false, code: 'FORBIDDEN' });
  // Do not reject completed actors here: lost-response retries must reach the
  // idempotent transaction, which rechecks current policy and active interest.
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const result = await submitInstall(createInstallPort(context.client), input);
  const parsed = installInputSchema.safeParse(input);
  if (result.ok && parsed.success && parsed.data.action === 'complete')
    await captureServerEvent(
      getAnalyticsCapturePort(),
      {
        actor_id: session.profile.id,
        event: {
          name: AnalyticsEvent.SIGNUP_COMPLETE,
          event_key: session.profile.id,
          properties: {},
        },
      },
      request.signal,
    );
  return respond(result);
}
