// Protocol/transport bounds only. These do not approve a merchant or enable
// enrollment; the checkout UI never launches these preparations in this feature.
export const TOSS_BILLING_SDK_URL = 'https://js.tosspayments.com/v2/standard';
export const KAKAOPAY_READY_URL =
  'https://open-api.kakaopay.com/online/v1/payment/ready';
export const PAYMENT_PREPARATION_TIMEOUT_MS = 15_000;
export const PAYMENT_RESPONSE_MAX_BYTES = 16_384;
export const PAYMENT_CALLBACK_MAX_LENGTH = 255;
export const PAYMENT_REDIRECT_MAX_LENGTH = 2048;
export const PAYMENT_STATE_LENGTH = 43;
export const PAYMENT_TID_MAX_LENGTH = 100;
export const PAYMENT_HTTP_OK = 200;
export const PAYMENT_HTTP_CLIENT_ERROR_MIN = 400;
export const PAYMENT_HTTP_SERVER_ERROR_MIN = 500;
export const PAYMENT_UNCERTAIN_HTTP_STATUSES = [408, 409, 425, 429] as const;

// KakaoPay's common guide lists both online-pay and online-payment domains;
// the ready reference additionally uses mockup-pg-web in sandbox examples.
// Exact origins, never suffix matching or arbitrary server-returned redirects.
export const KAKAOPAY_REDIRECT_ORIGINS = {
  test: [
    'https://online-pay.kakao.com',
    'https://online-payment.kakaopay.com',
    'https://mockup-pg-web.kakao.com',
  ],
  live: ['https://online-pay.kakao.com', 'https://online-payment.kakaopay.com'],
} as const;

// Deliberately no first-charge amount here. This adapter supports only the
// documented zero-amount SID-registration preparation, not charged enrollment.
export const KAKAOPAY_REGISTRATION_ITEM_NAME =
  messages.checkout.providerRegistrationItemName;
import messages from '@/messages/ko.json';
