import {
  ARTIST_ERROR_STATUS,
  ARTIST_REQUEST_TIMEOUT_MS,
  artistSelectionSchema,
  type ArtistError,
  type ArtistSelectionInput,
  type ArtistSelectionResult,
} from '@/config/artists';
import { routes } from '@/config/routes';

// The browser sends an artist slug only. Actor identity, eligibility and the
// durable interest transaction belong to the server; success never means paid access.
export async function submitArtistSelection(
  input: ArtistSelectionInput,
): Promise<ArtistSelectionResult> {
  const parsed = artistSelectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const response = await fetch(routes.artistSelectionSubmit, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(ARTIST_REQUEST_TIMEOUT_MS),
    });
    const result: unknown = await response.json();
    if (result && typeof result === 'object' && 'ok' in result) {
      if (
        result.ok === true &&
        'next' in result &&
        result.next === routes.onboardingInstall &&
        response.ok
      )
        return { ok: true, next: routes.onboardingInstall };
      if (
        result.ok === false &&
        'code' in result &&
        typeof result.code === 'string' &&
        Object.hasOwn(ARTIST_ERROR_STATUS, result.code)
      )
        return { ok: false, code: result.code as ArtistError };
    }
  } catch {
    // A timeout does not prove that no save occurred. Repeating the same choice
    // is safe because the authoritative mutation is idempotent.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
