import 'server-only';
import type { EnrollmentResult, EnrollmentTransport } from './enrollment';
import { enrollmentRequest } from './enrollment-http';
import type { RenewalFailureDisposition } from './renewal';

// Reuse the existing single-request body/network deadline and response bounds.
// Capture only a safe classification, never provider error codes/messages.
export async function renewalRequest(
  transport: EnrollmentTransport,
  url: string,
  input: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
    timeoutMs: number;
    classifyRejection(body: unknown): RenewalFailureDisposition | null;
  },
): Promise<
  | Extract<EnrollmentResult<unknown>, { ok: true }>
  | (Extract<EnrollmentResult<never>, { ok: false }> & {
      failureDisposition?: RenewalFailureDisposition;
    })
> {
  let disposition: RenewalFailureDisposition | null = null;
  const result = await enrollmentRequest(transport, url, {
    method: 'POST',
    headers: input.headers,
    body: input.body,
    timeoutMs: input.timeoutMs,
    recognizedRejection(body) {
      disposition = input.classifyRejection(body);
      return disposition !== null;
    },
  });
  return !result.ok && result.code === 'PROVIDER_REJECTED' && disposition
    ? { ...result, failureDisposition: disposition }
    : result;
}
