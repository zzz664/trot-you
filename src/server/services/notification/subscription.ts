import 'server-only';
import {
  webPushRevokeSchema,
  webPushStatusInputSchema,
  webPushStatusSchema,
  webPushSubscribeSchema,
  type WebPushResult,
  type WebPushStatus,
  type WebPushSubscription,
} from '@/config/webpush';

export type WebPushActor = { actorId: string; sessionId: string };
export type WebPushDeviceState = Omit<WebPushStatus, 'publicKey'>;
export type WebPushSubscriptionPort = {
  status(
    actor: WebPushActor,
    endpoint: string | null,
  ): Promise<WebPushResult<WebPushDeviceState>>;
  register(
    actor: WebPushActor,
    subscription: WebPushSubscription,
    consentVersion: string,
  ): Promise<WebPushResult<string>>;
  revoke(actor: WebPushActor, endpoint: string): Promise<WebPushResult<null>>;
};
export type WebPushSubscriptionDependencies = {
  port: WebPushSubscriptionPort;
  publicKey: string | null;
  validateSubscription(subscription: WebPushSubscription): boolean;
};

export async function readWebPushStatus(
  deps: WebPushSubscriptionDependencies,
  actor: WebPushActor,
  input: unknown,
): Promise<WebPushResult<WebPushStatus>> {
  const parsed = webPushStatusInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await deps.port.status(actor, parsed.data.endpoint);
    if (!result.ok) return result;
    const status = webPushStatusSchema.safeParse({
      ...result.data,
      configured: result.data.configured && deps.publicKey !== null,
      publicKey: deps.publicKey,
    });
    return status.success
      ? { ok: true, data: status.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function subscribeWebPush(
  deps: WebPushSubscriptionDependencies,
  actor: WebPushActor,
  input: unknown,
): Promise<WebPushResult<WebPushStatus>> {
  const parsed = webPushSubscribeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!deps.publicKey) return { ok: false, code: 'SETUP_NOT_READY' };
  if (parsed.data.applicationServerKey !== deps.publicKey)
    return { ok: false, code: 'CONFLICT' };
  try {
    if (!deps.validateSubscription(parsed.data.subscription))
      return { ok: false, code: 'INVALID_INPUT' };
    const registered = await deps.port.register(
      actor,
      parsed.data.subscription,
      parsed.data.consentVersion,
    );
    if (!registered.ok) return registered;
    // A lost status response is not rolled back or blindly registered again;
    // the browser resolves it through its current endpoint status.
    return readWebPushStatus(deps, actor, {
      action: 'status',
      endpoint: parsed.data.subscription.endpoint,
    });
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

export async function revokeWebPush(
  deps: WebPushSubscriptionDependencies,
  actor: WebPushActor,
  input: unknown,
): Promise<WebPushResult<WebPushStatus>> {
  const parsed = webPushRevokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const result = await deps.port.revoke(actor, parsed.data.endpoint);
    if (!result.ok) return result;
    // Revocation does not need provider readiness or current consent.
    return readWebPushStatus(deps, actor, {
      action: 'status',
      endpoint: parsed.data.endpoint,
    });
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
