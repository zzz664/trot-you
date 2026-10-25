import 'server-only';
import { COMMUNITY_MEDIA } from '@/config/community-media';

export async function communityMediaJson(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Error('INVALID_INPUT');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('INVALID_INPUT');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => undefined);
      reject(new Error('INVALID_INPUT'));
    }, COMMUNITY_MEDIA.bodyTimeoutMs);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > COMMUNITY_MEDIA.bodyLimit) {
        await reader.cancel();
        throw new Error('INVALID_INPUT');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  };
  try {
    return await Promise.race([parse(), timeout]);
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
