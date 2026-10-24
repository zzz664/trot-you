import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { FONT_SCALE_COOKIE } from '@/config/constants';
import {
  FONT_COOKIE_MAX_AGE_SECONDS,
  ONBOARDING_BODY_LIMIT,
  ONBOARDING_ERROR_STATUS,
  onboardingInputSchema,
  type OnboardingSubmitResult,
} from '@/config/onboarding';
import { createAuthContext } from '@/server/auth/context';
import { createOnboardingPort } from '@/server/db/onboarding';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { saveOnboarding } from '@/server/services/onboarding/profile';

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
      if (length > ONBOARDING_BODY_LIMIT) {
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

export async function onboardingPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: OnboardingSubmitResult) =>
    context.apply(
      NextResponse.json(
        result,
        result.ok ? {} : { status: ONBOARDING_ERROR_STATUS[result.code] },
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
  const state = await readSession(context.port);
  if (state.status !== 'authenticated')
    return respond({
      ok: false,
      code: state.status === 'unavailable' ? 'UNAVAILABLE' : 'UNAUTHENTICATED',
    });
  if (isRestricted(state.profile) || state.profile.onboarding_completed_at)
    return respond({ ok: false, code: 'FORBIDDEN' });
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  const parsed = onboardingInputSchema.safeParse(input);
  if (!parsed.success) return respond({ ok: false, code: 'INVALID_INPUT' });
  const result = await saveOnboarding(
    createOnboardingPort(context.client),
    parsed.data,
  );
  const response = respond(result);
  if (result.ok && parsed.data.step === 'font') {
    response.cookies.set(FONT_SCALE_COOKIE, parsed.data.fontScale, {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      secure: new URL(context.configuration.appOrigin).protocol === 'https:',
      maxAge: FONT_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return response;
}
