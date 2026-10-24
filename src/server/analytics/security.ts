import 'server-only';
import {
  ANALYTICS_BODY_LIMIT,
  ANALYTICS_BODY_TIMEOUT_MS,
  voiceInputEventSchema,
} from '@/config/analytics';

export async function analyticsBody(request: Request) {
  if (
    request.signal.aborted ||
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
  )
    return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const cancelled = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancelled, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('INVALID_INPUT'));
    }, ANALYTICS_BODY_TIMEOUT_MS);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (request.signal.aborted) return null;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ANALYTICS_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = voiceInputEventSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  };
  try {
    return await Promise.race([parse(), timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancelled);
    reader.releaseLock();
  }
}
