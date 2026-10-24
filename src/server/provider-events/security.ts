import 'server-only';
import {
  PROVIDER_EVENT_BODY_LIMIT_BYTES,
  PROVIDER_EVENT_BODY_TIMEOUT_MS,
  PROVIDER_EVENT_MAX_CHUNKS,
  TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER,
} from '@/config/provider-events';
import {
  parseTossProviderEvent,
  providerEventTransmissionIdSchema,
  type ProviderEventResult,
} from '@/server/adapters/payment/provider-events';

const tooLarge = Symbol('PAYLOAD_TOO_LARGE');
const invalid = Symbol('INVALID_INPUT');

// Read at most one small UTF-8 JSON body within one second. This deadline leaves
// room for durable receipt + HTTP 200 inside Toss's documented ten-second SLA.
// No provider query, log, signature claim or monetary effect occurs here.
export async function readTossProviderEvent(
  request: Request,
): Promise<ProviderEventResult> {
  const transmissionId = request.headers.get(
    TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER,
  );
  if (
    request.method !== 'POST' ||
    request.signal.aborted ||
    !providerEventTransmissionIdSchema.safeParse(transmissionId).success ||
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
      'application/json' ||
    (request.headers.has('content-encoding') &&
      request.headers.get('content-encoding') !== 'identity')
  )
    return { ok: false, code: 'INVALID_INPUT' };
  const lengthHeader = request.headers.get('content-length');
  if (
    lengthHeader !== null &&
    (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader)))
  )
    return { ok: false, code: 'INVALID_INPUT' };
  const expectedLength = lengthHeader === null ? null : Number(lengthHeader);
  if (
    expectedLength !== null &&
    expectedLength > PROVIDER_EVENT_BODY_LIMIT_BYTES
  )
    return { ok: false, code: 'PAYLOAD_TOO_LARGE' };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!request.body) return { ok: false, code: 'INVALID_INPUT' };
    reader = request.body.getReader();
  } catch {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  try {
    const consume = async () => {
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (stopped || request.signal.aborted) throw invalid;
        if (done) break;
        // Empty immediate chunks consume no byte budget and can otherwise grow
        // memory indefinitely while starving the timer's macrotask. Bound read
        // complexity independently of both elapsed time and received bytes.
        if (chunks.length >= PROVIDER_EVENT_MAX_CHUNKS) throw invalid;
        length += value.byteLength;
        if (length > PROVIDER_EVENT_BODY_LIMIT_BYTES) throw tooLarge;
        chunks.push(value);
      }
      if (expectedLength !== null && expectedLength !== length) throw invalid;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return parseTossProviderEvent(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        transmissionId,
      );
    };
    return await Promise.race([
      consume(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(invalid);
        }, PROVIDER_EVENT_BODY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    return {
      ok: false,
      code: error === tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_INPUT',
    };
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
