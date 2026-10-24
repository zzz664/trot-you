import { z } from 'zod';
import { CHECKOUT_ERROR_STATUS, type CheckoutError } from '@/config/checkout';
import {
  ENROLLMENT_CALLBACK_FIELD_COUNT,
  ENROLLMENT_MOBILE_BROWSER_PATTERN,
  ENROLLMENT_REQUEST_TIMEOUT_MS,
  ENROLLMENT_RESPONSE_MAX_BYTES,
  enrollmentConfirmSchema,
  enrollmentLaunchSchema,
  enrollmentSessionSchema,
  enrollmentStartSchema,
  enrollmentStatusSchema,
  type EnrollmentConfirmInput,
  type EnrollmentLaunch,
  type EnrollmentResult,
  type EnrollmentSessionInput,
  type EnrollmentStart,
  type EnrollmentStatus,
} from '@/config/enrollment';
import { KAKAOPAY_REDIRECT_ORIGINS } from '@/config/payment-preparation';
import { routes } from '@/config/routes';

async function request<T>(
  path: string,
  input: EnrollmentSessionInput | EnrollmentConfirmInput,
  schema: z.ZodType<T>,
  readOnly = false,
): Promise<EnrollmentResult<T>> {
  try {
    const response = await fetch(
      readOnly
        ? `${path}?session=${encodeURIComponent(input.sessionId)}`
        : path,
      {
        method: readOnly ? 'GET' : 'POST',
        ...(!readOnly && {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(ENROLLMENT_REQUEST_TIMEOUT_MS),
      },
    );
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    let text = '';
    let size = 0;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > ENROLLMENT_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const result = z
      .union([
        z.strictObject({ ok: z.literal(true), data: schema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!result.success) return { ok: false, code: 'UNAVAILABLE' };
    if (result.data.ok)
      return response.ok ? result.data : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(CHECKOUT_ERROR_STATUS, result.data.code))
      return { ok: false, code: result.data.code as CheckoutError };
  } catch {
    // A lost reply is not a decline. No replay, provider text or token logging.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

function safeCallback(value: string, sessionId: string, outcome: string) {
  try {
    const url = new URL(value);
    return (
      url.origin === window.location.origin &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname === routes.checkoutReturn &&
      [...url.searchParams.keys()].length === ENROLLMENT_CALLBACK_FIELD_COUNT &&
      url.searchParams.get('session') === sessionId &&
      url.searchParams.get('outcome') === outcome &&
      /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('state') ?? '')
    );
  } catch {
    return false;
  }
}

export function isSafeEnrollmentLaunch(
  launch: EnrollmentLaunch,
  status: EnrollmentStatus,
) {
  if (
    !enrollmentLaunchSchema.safeParse(launch).success ||
    status.status !== 'awaiting_authorization'
  )
    return false;
  if (launch.kind === 'toss_billing_auth')
    return (
      status.provider === 'toss_card_billing' &&
      launch.clientKey.startsWith(`${status.environment}_ck_`) &&
      safeCallback(
        launch.requestBillingAuth.successUrl,
        status.sessionId,
        'success',
      ) &&
      safeCallback(
        launch.requestBillingAuth.failUrl,
        status.sessionId,
        'failure',
      )
    );
  return (
    status.provider === 'kakaopay_subscription' &&
    [launch.redirectUrl, launch.desktopRedirectUrl].every((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.hash &&
          KAKAOPAY_REDIRECT_ORIGINS[status.environment].some(
            (origin) => origin === url.origin,
          )
        );
      } catch {
        return false;
      }
    })
  );
}

export function chooseKakaoEnrollmentRedirect(
  launch: Extract<EnrollmentLaunch, { kind: 'kakaopay_redirect' }>,
  status: EnrollmentStatus,
  userAgent: string,
): string | null {
  if (!isSafeEnrollmentLaunch(launch, status)) return null;
  return ENROLLMENT_MOBILE_BROWSER_PATTERN.test(userAgent)
    ? launch.redirectUrl
    : launch.desktopRedirectUrl;
}

export async function startEnrollment(
  input: EnrollmentSessionInput,
): Promise<EnrollmentResult<EnrollmentStart>> {
  const parsed = enrollmentSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    routes.enrollmentStart,
    parsed.data,
    enrollmentStartSchema,
  );
  if (!result.ok) return result;
  if (
    result.data.status.sessionId !== input.sessionId ||
    (result.data.launch &&
      !isSafeEnrollmentLaunch(result.data.launch, result.data.status))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}

async function statusAction(
  path: string,
  input: EnrollmentSessionInput | EnrollmentConfirmInput,
  readOnly = false,
): Promise<EnrollmentResult<EnrollmentStatus>> {
  const parsed = (
    path === routes.enrollmentConfirm
      ? enrollmentConfirmSchema
      : enrollmentSessionSchema
  ).safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  const result = await request(
    path,
    parsed.data,
    enrollmentStatusSchema,
    readOnly,
  );
  if (
    result.ok &&
    (result.data.sessionId !== input.sessionId ||
      ('policyVersion' in input &&
        (result.data.policy.version !== input.policyVersion ||
          result.data.amountKrw !== input.amountKrw)))
  )
    return { ok: false, code: 'UNAVAILABLE' };
  return result;
}
export const readEnrollment = (input: EnrollmentSessionInput) =>
  statusAction(routes.enrollmentStatus, input, true);
export const confirmEnrollment = (input: EnrollmentConfirmInput) =>
  statusAction(routes.enrollmentConfirm, input);
export const cancelEnrollment = (input: EnrollmentSessionInput) =>
  statusAction(routes.enrollmentCancel, input);
export const reconcileEnrollment = (input: EnrollmentSessionInput) =>
  statusAction(routes.enrollmentReconcile, input);

type TossSdk = (clientKey: string) => {
  payment(input: { customerKey: string }): {
    requestBillingAuth(
      input: Extract<
        EnrollmentLaunch,
        { kind: 'toss_billing_auth' }
      >['requestBillingAuth'],
    ): Promise<void>;
  };
};
export async function openTossEnrollment(
  launch: Extract<EnrollmentLaunch, { kind: 'toss_billing_auth' }>,
  status: EnrollmentStatus,
): Promise<boolean> {
  if (!isSafeEnrollmentLaunch(launch, status)) return false;
  const sdk = (window as Window & { TossPayments?: TossSdk }).TossPayments;
  if (typeof sdk !== 'function') return false;
  try {
    await sdk(launch.clientKey)
      .payment(launch.payment)
      .requestBillingAuth(launch.requestBillingAuth);
    return true;
  } catch {
    return false;
  }
}
