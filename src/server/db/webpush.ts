import 'server-only';
import { z } from 'zod';
import { isAuthSessionMissingError } from '@supabase/supabase-js';
import {
  WEBPUSH,
  webPushStatusFieldsSchema,
  type WebPushError,
  type WebPushResult,
} from '@/config/webpush';
import type { WebPushSubscriptionPort } from '@/server/services/notification/subscription';
import type { WebPushQueuePort } from '@/server/services/notification/send-queue';
import type { CheckoutServiceClient } from './checkout-client';
import type { ActorClient } from './client';

const errors: Record<string, WebPushError> = {
  WEBPUSH_SESSION_REQUIRED: 'UNAUTHENTICATED',
  NOTIFICATION_ACTOR_FORBIDDEN: 'FORBIDDEN',
  WEBPUSH_ENDPOINT_INVALID: 'INVALID_INPUT',
  NOTIFICATION_DEVICE_CONFLICT: 'CONFLICT',
  NOTIFICATION_DEVICE_INACTIVE: 'CONFLICT',
  WEBPUSH_DEVICE_LIMIT: 'CONFLICT',
  NOTIFICATION_CONSENT_REQUIRED: 'SETUP_NOT_READY',
};
function failure(message: string): WebPushResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(errors, message) ? errors[message]! : 'UNAVAILABLE',
  };
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): WebPushResult<T> {
  const result = schema.safeParse(value);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
const stateSchema = z
  .object({
    configured: z.unknown(),
    consent_version: z.unknown(),
    webpush_enabled: z.unknown(),
    new_message: z.unknown(),
    device_id: z.unknown(),
    device_active: z.unknown(),
  })
  .transform((row) => ({
    configured: row.configured,
    consentVersion: row.consent_version,
    webpushEnabled: row.webpush_enabled,
    newMessage: row.new_message,
    deviceId: row.device_id,
    deviceActive: row.device_active,
  }))
  .pipe(webPushStatusFieldsSchema.omit({ publicKey: true }));
const leaseSchema = z
  .object({
    job_id: z.uuid(),
    lease_token: z.uuid(),
    lease_expires_at: z.iso.datetime({ offset: true }),
  })
  .transform((row) => ({
    jobId: row.job_id,
    token: row.lease_token,
    expiresAt: row.lease_expires_at,
  }));
const deliverySchema = z
  .object({
    job_id: z.uuid(),
    lease_token: z.uuid(),
    lease_expires_at: z.iso.datetime({ offset: true }),
    endpoint: z.string().max(WEBPUSH.endpointMaxLength),
    p256dh: z.string(),
    auth: z.string(),
  })
  .transform((row) => ({
    jobId: row.job_id,
    token: row.lease_token,
    expiresAt: row.lease_expires_at,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  }));
const jobStateSchema = z.enum([
  'queued',
  'leased',
  'retry_wait',
  'provider_accepted',
  'unknown',
  'canceled',
  'failed',
  'dead_endpoint',
  'skipped',
  'missing',
]);

export function createWebPushSubscriptionPort(
  client: CheckoutServiceClient | null,
  actorClient: ActorClient,
): WebPushSubscriptionPort {
  return {
    async status(actor, endpoint) {
      void actor; // JWT binds the native status RPC; no caller identity argument.
      const { data, error } = await actorClient.rpc('webpush_current_status', {
        ...(endpoint !== null ? { p_endpoint: endpoint } : {}),
      });
      return error
        ? failure(error.message)
        : parsed(
            z
              .array(stateSchema)
              .length(1)
              .transform((rows) => rows[0]!),
            data,
          );
    },
    async register(actor, subscription, consentVersion) {
      if (!client) return { ok: false, code: 'SETUP_NOT_READY' };
      const { data, error } = await client.rpc('webpush_register_device', {
        p_actor_id: actor.actorId,
        p_auth_session_id: actor.sessionId,
        p_endpoint: subscription.endpoint,
        p_p256dh: subscription.keys.p256dh,
        p_auth: subscription.keys.auth,
        p_consent_version: consentVersion,
      });
      return error ? failure(error.message) : parsed(z.uuid(), data);
    },
    async revoke(actor, endpoint) {
      void actor; // Native opt-out survives unavailable/malformed provider config.
      return revokeCurrentWebPushDevice(actorClient, endpoint);
    },
  };
}

export function createWebPushQueuePort(
  client: CheckoutServiceClient,
): WebPushQueuePort {
  return {
    async uncertain(limit) {
      const { data, error } = await client.rpc('webpush_list_uncertain', {
        p_limit: limit,
      });
      return error
        ? failure(error.message)
        : parsed(z.array(leaseSchema).max(WEBPUSH.recoveryLimit), data);
    },
    async recover(lease) {
      const { data, error } = await client.rpc('webpush_recover_expired', {
        p_job_id: lease.jobId,
        p_token: lease.token,
      });
      return error ? failure(error.message) : parsed(jobStateSchema, data);
    },
    async due(limit) {
      const { data, error } = await client.rpc('webpush_list_due', {
        p_limit: limit,
      });
      return error
        ? failure(error.message)
        : parsed(
            z
              .array(z.object({ id: z.uuid() }))
              .max(WEBPUSH.batchSize)
              .transform((rows) => rows.map((row) => row.id)),
            data,
          );
    },
    async claim(jobId) {
      const { data, error } = await client.rpc('notification_claim', {
        p_job_id: jobId,
      });
      // Legacy claim's endpoint fields deliberately never cross this layer;
      // only the current-recipient prepare fence can authorize delivery.
      return error
        ? failure(error.message)
        : parsed(
            z
              .array(leaseSchema)
              .max(1)
              .transform((rows) => rows[0] ?? null),
            data,
          );
    },
    async prepare(lease) {
      const { data, error } = await client.rpc('webpush_prepare_delivery', {
        p_job_id: lease.jobId,
        p_token: lease.token,
      });
      return error
        ? failure(error.message)
        : parsed(
            z
              .array(deliverySchema)
              .max(1)
              .transform((rows) => rows[0] ?? null),
            data,
          );
    },
    async complete(lease, outcome, evidenceRef, retryAfterSeconds) {
      const { data, error } = await client.rpc('webpush_complete', {
        p_job_id: lease.jobId,
        p_token: lease.token,
        p_outcome: outcome,
        p_evidence_ref: evidenceRef,
        ...(retryAfterSeconds !== undefined
          ? { p_retry_after_seconds: retryAfterSeconds }
          : {}),
      });
      return error ? failure(error.message) : parsed(jobStateSchema, data);
    },
  };
}

export async function revokeWebPushSession(
  client: ActorClient | null,
): Promise<boolean> {
  if (!client) return false;
  try {
    const { data, error } = await client.auth.getClaims();
    if (error) return isAuthSessionMissingError(error);
    if (!data?.claims.sub) return true;
    const { error: revokeError } = await client.rpc('webpush_revoke_session');
    return !revokeError;
  } catch {
    return false;
  }
}

export async function revokeCurrentWebPushDevice(
  client: ActorClient,
  endpoint: string,
): Promise<WebPushResult<null>> {
  try {
    const { error } = await client.rpc('webpush_revoke_current_device', {
      p_endpoint: endpoint,
    });
    return error ? failure(error.message) : { ok: true, data: null };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
