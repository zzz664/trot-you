import 'server-only';
import { getEnrollmentTestRuntime } from '@/config/env.server';
import {
  ENROLLMENT_CI,
  ENROLLMENT_CI_KAKAO_PATHS,
  ENROLLMENT_CI_TOSS_PATHS,
  type EnrollmentTestRuntime,
} from '@/config/enrollment-test-runtime';
import type { PaymentPreparationTransport } from './kakaopay';

// The production branch is the original HTTP transport, never a success stub.
// The CI branch injects a real loopback HTTP server into the same adapters.
// It is unavailable to production builds and rejects partially enabled flags.
export function createEnrollmentTransport(
  runtime: EnrollmentTestRuntime = getEnrollmentTestRuntime(),
  transport: PaymentPreparationTransport = fetch,
): PaymentPreparationTransport | null {
  if (runtime.mode === 'invalid') return null;
  if (runtime.mode === 'real') return transport;
  return async (input, init) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const toss =
      url.origin === 'https://api.tosspayments.com' &&
      ENROLLMENT_CI_TOSS_PATHS.some((path) => path.test(url.pathname));
    const kakao =
      url.origin === 'https://open-api.kakaopay.com' &&
      ENROLLMENT_CI_KAKAO_PATHS.some((path) => path.test(url.pathname));
    const expectedAuthorization = toss
      ? `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`
      : `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`;
    if (
      (!toss && !kakao) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      headers.get('Authorization') !== expectedAuthorization ||
      !['GET', 'POST'].includes(init.method ?? '')
    )
      throw new Error('CI_PAYMENT_TRANSPORT_REJECTED');
    const target = new URL(
      `/${toss ? 'toss' : 'kakaopay'}${url.pathname}`,
      ENROLLMENT_CI.providerOrigin,
    );
    return transport(target.href, {
      ...init,
      headers,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
    });
  };
}
