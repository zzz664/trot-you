import 'server-only';
import { getCancellationTestRuntime } from '@/config/env.server';
import { ENROLLMENT_CI } from '@/config/enrollment-test-runtime';
import {
  CANCELLATION_CI_KAKAO_PATHS,
  CANCELLATION_CI_TOSS_CANCEL,
  CANCELLATION_CI_TOSS_QUERY,
  type CancellationTestRuntime,
} from '@/config/cancellation-test-runtime';
import type { PaymentPreparationTransport } from './kakaopay';

// Production still calls the real adapter's HTTP transport. Only the complete
// isolated CI runtime can substitute a fixed loopback HTTP provider fixture.
export function createRefundTransport(
  runtime: CancellationTestRuntime = getCancellationTestRuntime(),
  transport: PaymentPreparationTransport = fetch,
): PaymentPreparationTransport | null {
  if (runtime.mode === 'invalid' || runtime.mode === 'unavailable') return null;
  if (runtime.mode === 'real') return transport;
  return async (input, init) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const toss =
      url.origin === 'https://api.tosspayments.com' &&
      ((init.method === 'POST' &&
        CANCELLATION_CI_TOSS_CANCEL.test(url.pathname)) ||
        (init.method === 'GET' &&
          CANCELLATION_CI_TOSS_QUERY.test(url.pathname)));
    const kakao =
      url.origin === 'https://open-api.kakaopay.com' &&
      init.method === 'POST' &&
      CANCELLATION_CI_KAKAO_PATHS.test(url.pathname);
    const authorization = toss
      ? `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`
      : `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`;
    if (
      (!toss && !kakao) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      headers.get('Authorization') !== authorization
    )
      throw new Error('CI_REFUND_TRANSPORT_REJECTED');
    return transport(
      new URL(
        `/${toss ? 'toss' : 'kakaopay'}${url.pathname}`,
        ENROLLMENT_CI.providerOrigin,
      ).href,
      {
        ...init,
        headers,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
      },
    );
  };
}
