import 'server-only';
import { z } from 'zod';
import { WEBPUSH } from '@/config/webpush';
import type { ActorClient } from '@/server/db/client';
import type { WebPushActor } from '@/server/services/notification/subscription';

export async function verifiedWebPushActor(
  client: ActorClient,
  expectedActorId: string,
): Promise<WebPushActor | null> {
  try {
    // getClaims verifies the signed token, never decode an unverified cookie.
    // HTTP/page boundary additionally used getUser + authoritative profile.
    const { data, error } = await client.auth.getClaims();
    const parsed = z
      .object({ sub: z.uuid(), session_id: z.uuid() })
      .safeParse(data?.claims);
    if (error || !parsed.success || parsed.data.sub !== expectedActorId)
      return null;
    return { actorId: parsed.data.sub, sessionId: parsed.data.session_id };
  } catch {
    return null;
  }
}

export async function webPushBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('INVALID_INPUT'));
    }, WEBPUSH.bodyTimeoutMs);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > WEBPUSH.bodyLimit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    return parsed;
  };
  try {
    return await Promise.race([parse(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
