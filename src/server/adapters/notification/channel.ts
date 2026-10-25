import 'server-only';
import { z } from 'zod';
import {
  WEBPUSH_PROTOCOL as P,
  WEBPUSH_HTTP_DATE_PATTERNS,
} from '@/config/webpush-protocol';
import { routes } from '@/config/routes';
import {
  createVapidSigningKey,
  encryptWebPushPayload,
  vapidAuthorization,
} from './crypto';
import {
  validateWebPushConfiguration,
  validateWebPushSubscription,
} from './validation';
import type {
  NotificationChannel,
  WebPushConfiguration,
  WebPushResult,
  WebPushTransport,
} from './types';

const payloadSchema = z.strictObject({
  version: z.literal(1),
  notificationId: z.uuid(),
  url: z.literal(routes.subscriptions),
});

function retryDelay(value: string | undefined, now: number) {
  if (!value) return undefined;
  let delay: number;
  if (/^\d+$/.test(value)) delay = Number(value);
  else if (WEBPUSH_HTTP_DATE_PATTERNS.some((pattern) => pattern.test(value))) {
    const currentYear = new Date(now).getUTCFullYear();
    // RFC850's two-digit year is relative to the current century, with dates
    // over 50 years ahead interpreted in the preceding century (RFC9110).
    const normalizedYear = value.replace(
      /-(\d{2}) /,
      (_match, shortYear: string) => {
        let year =
          Math.floor(currentYear / P.yearsPerCentury) * P.yearsPerCentury +
          Number(shortYear);
        if (year > currentYear + P.obsoleteDateFutureYears)
          year -= P.yearsPerCentury;
        return `-${year} `;
      },
    );
    // The obsolete asctime form has no zone marker but still means GMT.
    const date = normalizedYear.endsWith(' GMT')
      ? normalizedYear
      : `${normalizedYear} GMT`;
    delay = Math.max(
      0,
      Math.ceil((Date.parse(date) - now) / P.millisecondsPerSecond),
    );
  } else return undefined;
  // Retry-After is a minimum. Never clamp a longer provider delay downward;
  // bounded unsupported delays terminate rather than retrying too early.
  if (delay > P.retryAfterMaxSeconds) return null;
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

export function classifyWebPushResponse(
  status: number,
  retryAfter?: string,
  now = Date.now(),
): WebPushResult {
  if (P.acceptedStatuses.some((accepted) => accepted === status))
    return { outcome: 'provider_accepted' };
  if (P.deadStatuses.some((dead) => dead === status))
    return { outcome: 'dead_endpoint' };
  if (P.retryableStatuses.some((retryable) => retryable === status)) {
    const retryAfterSeconds = retryDelay(retryAfter, now);
    if (retryAfterSeconds === null) return { outcome: 'permanent_failure' };
    return {
      outcome: 'not_sent',
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (P.ambiguousStatuses.some((ambiguous) => ambiguous === status))
    return { outcome: 'unknown' };
  if (
    (status >= P.clientErrorMin && status <= P.clientErrorMax) ||
    (status >= P.redirectMin && status <= P.redirectMax)
  )
    return { outcome: 'permanent_failure' };
  // An unexpected response is not proof of rejection or device receipt.
  return { outcome: 'unknown' };
}

/** Internal DI seam. Production uses only the pinned HTTPS transport. */
export function buildWebPushChannel(
  configuration: WebPushConfiguration,
  transport: WebPushTransport,
  now: () => number,
): NotificationChannel | null {
  if (!validateWebPushConfiguration(configuration)) return null;
  const signingKey = createVapidSigningKey(configuration);
  const snapshot = { ...configuration };
  return {
    async send(input) {
      let body: Buffer;
      let authorization: string;
      try {
        if (
          !validateWebPushSubscription(input) ||
          typeof input.payload !== 'string' ||
          Buffer.byteLength(input.payload) > P.payloadMaxBytes ||
          !/^[A-Za-z0-9_-]+$/.test(input.topic) ||
          input.topic.length > P.topicMaxLength
        )
          return { outcome: 'permanent_failure' };
        const payload = payloadSchema.safeParse(JSON.parse(input.payload));
        if (!payload.success) return { outcome: 'permanent_failure' };
        // Re-encode the parsed allowlist: duplicate JSON members or whitespace
        // cannot smuggle discarded private data into the encrypted wire body.
        body = encryptWebPushPayload(
          input,
          Buffer.from(JSON.stringify(payload.data)),
        );
        authorization = vapidAuthorization(
          snapshot,
          signingKey,
          input.endpoint,
          now(),
        );
      } catch {
        return { outcome: 'permanent_failure' };
      }
      try {
        const response = await transport({
          endpoint: input.endpoint,
          headers: {
            authorization,
            'content-type': 'application/octet-stream',
            'content-encoding': 'aes128gcm',
            'content-length': String(body.length),
            ttl: String(P.ttlSeconds),
            urgency: 'normal',
            topic: input.topic,
          },
          body,
          timeoutMs: snapshot.timeoutMs ?? P.timeoutMs,
        });
        return response.kind === 'response'
          ? classifyWebPushResponse(response.status, response.retryAfter, now())
          : { outcome: response.kind };
      } catch {
        // A thrown transport error may follow acceptance. Never assert recall
        // or exactly-once delivery; the bounded worker owns retry policy.
        return { outcome: 'unknown' };
      }
    },
  };
}
