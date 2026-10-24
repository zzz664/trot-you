import 'server-only';
import { z } from 'zod';
import { CHAT_BODY_LIMIT, CHAT_BODY_TIMEOUT_MS } from '@/config/chat';

// Read receipts have no client-controlled actor, timestamp, count or access flag.
export async function chatReadBody(request: Request): Promise<boolean> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    return false;
  const reader = request.body?.getReader();
  if (!reader) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('INVALID_INPUT'));
    }, CHAT_BODY_TIMEOUT_MS);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let body = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CHAT_BODY_LIMIT) {
        await reader.cancel();
        return false;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return z.strictObject({}).safeParse(JSON.parse(body)).success;
  };
  try {
    return await Promise.race([parse(), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
