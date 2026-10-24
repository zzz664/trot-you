// Provider protocol bounds and vault format. No commercial price defaults.
export const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
export const TOSS_ISSUE_PATH = '/v1/billing/authorizations/issue';
export const TOSS_CHARGE_PATH = '/v1/billing/';
export const TOSS_ORDER_QUERY_PATH = '/v1/payments/orders/';
export const KAKAOPAY_APPROVE_URL =
  'https://open-api.kakaopay.com/online/v1/payment/approve';
export const KAKAOPAY_ORDER_URL =
  'https://open-api.kakaopay.com/online/v1/payment/order';
export const ENROLLMENT_CHARGE_TIMEOUT_MS = 65_000;
export const ENROLLMENT_QUERY_TIMEOUT_MS = 15_000;
export const ENROLLMENT_PROVIDER_TOKEN_MAX_LENGTH = 300;
export const ENROLLMENT_CREDENTIAL_MAX_LENGTH = 200;
export const ENROLLMENT_TRANSACTION_MAX_LENGTH = 200;
export const ENROLLMENT_MERCHANT_MAX_LENGTH = 100;
export const ENROLLMENT_MAX_AMOUNT_KRW = 2_147_483_647;
export const ENROLLMENT_MAX_QUERY_ACTIONS = 100;
// Kakao's documented offsetless domestic Datetime samples are normalized
// explicitly to Seoul, not to the host process's local timezone.
export const KAKAOPAY_DATETIME_OFFSET = '+09:00';
export const PAYMENT_VAULT_ALGORITHM = 'aes-256-gcm';
export const PAYMENT_VAULT_IV_BYTES = 12;
export const PAYMENT_VAULT_TAG_BYTES = 16;
export const PAYMENT_VAULT_KEY_BYTES = 32;
export const PAYMENT_VAULT_KEY_VERSION_MAX_LENGTH = 64;
export const PAYMENT_VAULT_PLAINTEXT_MAX_BYTES = 8192;
export const PAYMENT_VAULT_ENVELOPE_MAX_LENGTH = 12000;
export const PAYMENT_VAULT_FORMAT_VERSION = 1;
export const PAYMENT_VAULT_AAD_DOMAIN = 'trot-you.payment-vault.v1';
export const PAYMENT_VAULT_KEY_PATTERN =
  /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
export const PAYMENT_VAULT_KEY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const PAYMENT_VAULT_IV_ENCODED_LENGTH = 16;
export const PAYMENT_VAULT_TAG_ENCODED_LENGTH = 22;
export const PAYMENT_VAULT_CIPHERTEXT_MAX_LENGTH = 10923;
export const TOSS_DEFINITE_REJECTION_CODES = [
  'INVALID_STOPPED_CARD',
  'INVALID_REJECT_CARD',
  'INVALID_CARD_LOST_OR_STOLEN',
  'REJECT_CARD_PAYMENT',
  'REJECT_ACCOUNT_PAYMENT',
  'REJECT_CARD_COMPANY',
  'KYC_BLOCKED',
  'EXCEED_MAX_AUTH_COUNT',
  'NOT_SUPPORTED_CARD_TYPE',
  'INVALID_BILL_KEY_REQUEST',
  'INVALID_API_KEY',
  'UNAUTHORIZED_KEY',
  'INCORRECT_BASIC_AUTH_FORMAT',
] as const;
// Documented authentication-incomplete response is not a settled payment.
// Already-approved (-702) and all unrecognized codes remain unknown.
export const KAKAOPAY_DEFINITE_REJECTION_CODES = [-701] as const;
