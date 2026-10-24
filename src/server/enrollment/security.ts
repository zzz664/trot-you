import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { CHECKOUT_BODY_LIMIT, CHECKOUT_NONCE_COOKIE } from '@/config/checkout';
import { ENROLLMENT_CALLBACK_STATE_DOMAIN } from '@/config/enrollment-server';
import type { ActorClient } from '@/server/db/client';

const nonceCookieSchema = z.strictObject({
  actorId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export function readEnrollmentNonce(request: NextRequest) {
  try {
    const raw = request.cookies.get(CHECKOUT_NONCE_COOKIE)?.value;
    if (!raw || raw.length > CHECKOUT_BODY_LIMIT) return null;
    const parsed = nonceCookieSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function enrollmentHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function enrollmentCallbackState(nonce: string) {
  return createHash('sha256')
    .update(ENROLLMENT_CALLBACK_STATE_DOMAIN)
    .update(nonce)
    .digest('base64url');
}
// getClaims verifies the signed token; getUser in readSession additionally
// verifies the account. Never decode an unverified cookie/JWT as authority.
export async function verifiedAuthSessionHash(
  client: ActorClient,
  actorId: string,
) {
  try {
    const { data, error } = await client.auth.getClaims();
    if (
      error ||
      data?.claims.sub !== actorId ||
      !z.uuid().safeParse(data.claims.session_id).success
    )
      return null;
    return enrollmentHash(data.claims.session_id as string);
  } catch {
    return null;
  }
}
export async function enrollmentJson(request: NextRequest): Promise<unknown> {
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
      if (length > CHECKOUT_BODY_LIMIT) {
        await reader.cancel();
        throw new Error('INVALID_INPUT');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
