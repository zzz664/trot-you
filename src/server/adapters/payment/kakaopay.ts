import 'server-only';
import { z } from 'zod';
import type { ServerEnv } from '@/config/env.server';
import {
  KAKAOPAY_READY_URL,
  KAKAOPAY_REDIRECT_ORIGINS,
  KAKAOPAY_REGISTRATION_ITEM_NAME,
  PAYMENT_HTTP_CLIENT_ERROR_MIN,
  PAYMENT_HTTP_OK,
  PAYMENT_HTTP_SERVER_ERROR_MIN,
  PAYMENT_PREPARATION_TIMEOUT_MS,
  PAYMENT_REDIRECT_MAX_LENGTH,
  PAYMENT_RESPONSE_MAX_BYTES,
  PAYMENT_TID_MAX_LENGTH,
  PAYMENT_UNCERTAIN_HTTP_STATUSES,
} from '@/config/payment-preparation';
import { requireIntegrationConfiguration } from '@/server/configuration';
import {
  preparationCallbacks,
  parsePreparationEnvironment,
  preparationFailure,
  preparationIdentitySchema,
  type PreparationIdentity,
  type PreparationResult,
} from './preparation';

export type PaymentPreparationTransport = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
export type KakaoPayReadyPreparation = {
  kind: 'kakaopay_registration_ready';
  // Server-only. Persist this reference before any future user handoff. The
  // caller must never serialize the whole adapter result to the browser/logs.
  tid: string;
  redirects: { mobile: string; desktop: string };
  registrationAmountKrw: 0;
  launchAvailable: false;
};
const responseSchema = z.object({
  tid: z
    .string()
    .min(1)
    .max(PAYMENT_TID_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/),
  next_redirect_mobile_url: z.string().max(PAYMENT_REDIRECT_MAX_LENGTH),
  next_redirect_pc_url: z.string().max(PAYMENT_REDIRECT_MAX_LENGTH),
});
const rejectionSchema = z.object({ error_code: z.number().int() });

function safeRedirect(input: string, mode: 'test' | 'live') {
  try {
    const url = new URL(input);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      KAKAOPAY_REDIRECT_ORIGINS[mode].some((origin) => origin === url.origin)
    );
  } catch {
    return false;
  }
}

async function boundedResponse(response: Response): Promise<unknown> {
  if (
    response.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Error('INVALID_RESPONSE');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_RESPONSE');
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

// Real ready-only adapter, with a transport seam for offline contract tests.
// There is no mock mode or fake success selected by environment variables.
// No route calls this yet: durable dispatch/result recording, safe callback
// finalization and encrypted credential storage must land before activation.
export function createKakaoPayPreparationAdapter(
  env: ServerEnv,
  transport: PaymentPreparationTransport = fetch,
) {
  const configuration = requireIntegrationConfiguration(
    'kakaopay_subscription',
    parsePreparationEnvironment(env),
  );
  return {
    async ready(
      input: PreparationIdentity,
    ): Promise<PreparationResult<KakaoPayReadyPreparation>> {
      if (!configuration.ok)
        return preparationFailure(configuration.error.code);
      const identity = preparationIdentitySchema.safeParse(input);
      if (!identity.success) return preparationFailure('INVALID_INPUT');
      const { mode, appOrigin, credentials } = configuration.data;
      if (mode === 'disabled')
        return preparationFailure('INTEGRATION_UNAVAILABLE');
      const callbacks = preparationCallbacks(appOrigin, identity.data);
      if (!callbacks) return preparationFailure('CONFIGURATION_INVALID');
      try {
        // KakaoPay documents no ready idempotency header. The future caller
        // must claim a durable single dispatch before invoking this method.
        // Do not retry, even after timeout: a new TID may already exist.
        const response = await transport(KAKAOPAY_READY_URL, {
          method: 'POST',
          headers: {
            Authorization: `SECRET_KEY ${credentials.KAKAOPAY_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          signal: AbortSignal.timeout(PAYMENT_PREPARATION_TIMEOUT_MS),
          body: JSON.stringify({
            cid: credentials.KAKAOPAY_RECURRING_CID,
            ...(credentials.KAKAOPAY_CID_SECRET
              ? { cid_secret: credentials.KAKAOPAY_CID_SECRET }
              : {}),
            partner_order_id: identity.data.orderId,
            partner_user_id: identity.data.customerRef,
            item_name: KAKAOPAY_REGISTRATION_ITEM_NAME,
            quantity: 1,
            total_amount: 0,
            tax_free_amount: 0,
            vat_amount: 0,
            approval_url: callbacks.successUrl,
            cancel_url: callbacks.cancelUrl,
            fail_url: callbacks.failUrl,
          }),
        });
        const body = await boundedResponse(response);
        if (response.status !== PAYMENT_HTTP_OK) {
          const rejected =
            response.status >= PAYMENT_HTTP_CLIENT_ERROR_MIN &&
            response.status < PAYMENT_HTTP_SERVER_ERROR_MIN &&
            !PAYMENT_UNCERTAIN_HTTP_STATUSES.some(
              (status) => status === response.status,
            ) &&
            rejectionSchema.safeParse(body).success;
          return preparationFailure(
            rejected ? 'PROVIDER_REJECTED' : 'OUTCOME_UNKNOWN',
          );
        }
        const parsed = responseSchema.safeParse(body);
        if (
          !parsed.success ||
          !safeRedirect(parsed.data.next_redirect_mobile_url, mode) ||
          !safeRedirect(parsed.data.next_redirect_pc_url, mode)
        )
          return preparationFailure('OUTCOME_UNKNOWN');
        return {
          ok: true,
          data: {
            kind: 'kakaopay_registration_ready',
            tid: parsed.data.tid,
            redirects: {
              mobile: parsed.data.next_redirect_mobile_url,
              desktop: parsed.data.next_redirect_pc_url,
            },
            registrationAmountKrw: 0,
            launchAvailable: false,
          },
        };
      } catch {
        // Never propagate provider text, headers, token-bearing URLs or a
        // transport exception into a response/log. Unknown is not a decline.
        return preparationFailure('OUTCOME_UNKNOWN');
      }
    },
  };
}
