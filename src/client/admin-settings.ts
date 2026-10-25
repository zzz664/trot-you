import { z } from 'zod';
import {
  ADMIN_SETTINGS,
  ADMIN_SETTINGS_ERROR_STATUS,
  adminSettingsListSchema,
  adminSettingsGroupSchema,
  adminSettingsSaveSchema,
  type AdminSettingsError,
  type AdminSettingsResult,
  type AdminSettingsSaveInput,
} from '@/config/admin-settings';
import { routes } from '@/config/routes';

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<AdminSettingsResult<T>> {
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ADMIN_SETTINGS.requestTimeoutMs);
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > ADMIN_SETTINGS.responseMaxBytes) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!parsed.success) return { ok: false, code: 'UNAVAILABLE' };
    if (parsed.data.ok)
      return response.status === ADMIN_SETTINGS.httpOk
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(ADMIN_SETTINGS_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as AdminSettingsError;
      if (response.status === ADMIN_SETTINGS_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    // Settings values, identifiers and session data are never logged.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

export function fetchAdminSettings(signal?: AbortSignal) {
  return request(
    routes.adminSettingsApi,
    adminSettingsListSchema,
    undefined,
    signal,
  );
}
export function saveAdminSettings(
  input: AdminSettingsSaveInput,
  signal?: AbortSignal,
) {
  const parsed = adminSettingsSaveSchema.safeParse(input);
  return parsed.success
    ? request(
        routes.adminSettingsApi,
        adminSettingsGroupSchema,
        parsed.data,
        signal,
      )
    : Promise.resolve({ ok: false as const, code: 'INVALID_INPUT' as const });
}
