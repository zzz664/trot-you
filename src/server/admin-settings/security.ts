import 'server-only';
import { ADMIN_SETTINGS } from '@/config/admin-settings';

export async function adminSettingsBody(request: Request): Promise<unknown> {
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
    }, ADMIN_SETTINGS.bodyTimeoutMs);
  });
  const parse = async () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '';
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ADMIN_SETTINGS.bodyLimit) {
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
