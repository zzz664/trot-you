import {
  ONBOARDING_ERROR_STATUS,
  ONBOARDING_PATHS,
  ONBOARDING_REQUEST_TIMEOUT_MS,
  type OnboardingError,
  type OnboardingInput,
  type OnboardingSubmitResult,
} from '@/config/onboarding';
import { routes } from '@/config/routes';

// One browser transport boundary. No external URL, PII logging or optimistic
// success: the next step is entered only after the server transaction commits.
export async function submitOnboarding(
  input: OnboardingInput,
): Promise<OnboardingSubmitResult> {
  try {
    const response = await fetch(routes.onboardingSubmit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(ONBOARDING_REQUEST_TIMEOUT_MS),
    });
    const result: unknown = await response.json();
    if (result && typeof result === 'object') {
      if (
        'ok' in result &&
        result.ok === true &&
        'next' in result &&
        typeof result.next === 'string' &&
        ONBOARDING_PATHS.some((path) => path === result.next) &&
        response.ok
      )
        return { ok: true, next: result.next };
      if (
        'ok' in result &&
        result.ok === false &&
        'code' in result &&
        typeof result.code === 'string' &&
        Object.hasOwn(ONBOARDING_ERROR_STATUS, result.code)
      )
        return { ok: false, code: result.code as OnboardingError };
    }
  } catch {
    // Timeout/network failure is uncertain, never a claim that no commit took
    // place. Each mutation is idempotent; Retry reads/rewrites the same stage.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
