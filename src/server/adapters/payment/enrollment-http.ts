import 'server-only';
import {
  PAYMENT_HTTP_CLIENT_ERROR_MIN,
  PAYMENT_HTTP_OK,
  PAYMENT_HTTP_SERVER_ERROR_MIN,
  PAYMENT_RESPONSE_MAX_BYTES,
  PAYMENT_UNCERTAIN_HTTP_STATUSES,
} from '@/config/payment-preparation';
import { preparationFailure } from './preparation';
import type { EnrollmentResult, EnrollmentTransport } from './enrollment';

// Body consumption shares the request timeout. A server that sends headers and
// then stalls must not leave the worker alive forever with a claimed payment.
async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    response.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Error('INVALID_RESPONSE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_RESPONSE');
  const abortRead = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    abortRead();
    throw new Error('PROVIDER_TIMEOUT');
  }
  signal.addEventListener('abort', abortRead, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > PAYMENT_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new Error('INVALID_RESPONSE');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function enrollmentRequest(
  transport: EnrollmentTransport,
  url: string,
  input: {
    method: 'POST' | 'GET';
    headers: Record<string, string>;
    body?: Record<string, unknown>;
    timeoutMs: number;
    recognizedRejection: (body: unknown) => boolean;
    // A query rejection, including not-found, is not proof a prior dispatch
    // never succeeded. Reconciliation never enables a fresh charge here.
    reconciliation?: boolean;
  },
): Promise<EnrollmentResult<unknown>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('PROVIDER_TIMEOUT'));
      }, input.timeoutMs);
    });
    const request = (async () => {
      response = await transport(url, {
        method: input.method,
        headers: input.headers,
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
      const body = await boundedJson(response, controller.signal);
      if (response.status !== PAYMENT_HTTP_OK) {
        const rejected =
          !input.reconciliation &&
          response.status >= PAYMENT_HTTP_CLIENT_ERROR_MIN &&
          response.status < PAYMENT_HTTP_SERVER_ERROR_MIN &&
          !PAYMENT_UNCERTAIN_HTTP_STATUSES.some(
            (status) => status === response!.status,
          ) &&
          input.recognizedRejection(body);
        return preparationFailure(
          rejected ? 'PROVIDER_REJECTED' : 'OUTCOME_UNKNOWN',
        );
      }
      return { ok: true, data: body } as const;
    })();
    return await Promise.race([request, timeout]);
  } catch {
    // No raw exception, URL, body, header, credential or provider text escapes.
    // One dispatch only. A timeout is never retried or reported as a decline.
    controller.abort();
    return preparationFailure('OUTCOME_UNKNOWN');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
