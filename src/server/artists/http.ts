import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ARTIST_BODY_LIMIT,
  ARTIST_ERROR_STATUS,
  type ArtistSelectionResult,
} from '@/config/artists';
import { createAuthContext } from '@/server/auth/context';
import { createArtistInterestPort } from '@/server/db/artists';
import { isRestricted, isSameOriginPost } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { selectArtist } from '@/server/services/artists/discovery';
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
      if (length > ARTIST_BODY_LIMIT) {
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

export async function artistSelectionPost(request: NextRequest) {
  const context = createAuthContext(request.cookies.getAll());
  const respond = (result: ArtistSelectionResult) =>
    context.apply(
      NextResponse.json(
        result,
        result.ok ? {} : { status: ARTIST_ERROR_STATUS[result.code] },
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
  if (
    isRestricted(session.profile) ||
    session.profile.role !== 'fan' ||
    session.profile.onboarding_completed_at
  )
    return respond({ ok: false, code: 'FORBIDDEN' });
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return respond({ ok: false, code: 'INVALID_INPUT' });
  }
  return respond(
    await selectArtist(createArtistInterestPort(context.client), input),
  );
}
