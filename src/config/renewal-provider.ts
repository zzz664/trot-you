import messages from '@/messages/ko.json';

export const KAKAOPAY_SUBSCRIPTION_URL =
  'https://open-api.kakaopay.com/online/v1/payment/subscription';
export const RENEWAL_PROVIDER_ITEM_NAME =
  messages.checkout.providerRenewalItemName;

// Source: Toss's card automatic-billing error reference. Only these documented
// insufficient-balance/limit refusals may be retried by the approved policy.
// The adapter itself NEVER retries a request.
export const TOSS_RENEWAL_RETRYABLE_REJECTIONS = [
  'REJECT_CARD_PAYMENT',
  'REJECT_ACCOUNT_PAYMENT',
] as const;

// The recurring API documents -782 as a failed subscription charge. It does
// not publish a complete recoverable/permanent source-error taxonomy. Treat
// it as customer_action rather than guessing from raw provider error text.
export const KAKAOPAY_RENEWAL_DEFINITE_REJECTION = -782;
