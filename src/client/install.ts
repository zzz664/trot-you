import {
  INSTALL_ERROR_STATUS,
  INSTALL_REQUEST_TIMEOUT_MS,
  installInputSchema,
  type InstallError,
  type InstallInput,
  type InstallSubmitResult,
} from '@/config/install';
import { routes } from '@/config/routes';

// No optimistic completion. A lost response can follow a committed transaction;
// repeating the same operation is the supported recovery path.
export async function submitInstall(
  input: InstallInput,
): Promise<InstallSubmitResult> {
  const parsed = installInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const response = await fetch(routes.installSubmit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(INSTALL_REQUEST_TIMEOUT_MS),
    });
    const result: unknown = await response.json();
    if (result && typeof result === 'object' && 'ok' in result) {
      const next =
        parsed.data.action === 'complete'
          ? routes.home
          : routes.onboardingInstall;
      if (
        result.ok === true &&
        'next' in result &&
        result.next === next &&
        response.ok
      )
        return { ok: true, next };
      if (
        result.ok === false &&
        'code' in result &&
        typeof result.code === 'string' &&
        Object.hasOwn(INSTALL_ERROR_STATUS, result.code)
      )
        return { ok: false, code: result.code as InstallError };
    }
  } catch {
    // Never log responses, account fields, permission data or credentials.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
