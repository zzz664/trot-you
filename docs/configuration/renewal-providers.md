# Renewal provider contracts

The adapters execute only after a trusted worker obtains a durable renewal
dispatch claim. They do not schedule work, choose a price, approve a policy,
refresh a credential or select a fallback provider. No merchant account,
provider-issued credentials or real/test provider transaction was used to
implement or test this feature.

## Charge and recovery

- **Toss card billing:** `POST /v1/billing/{billingKey}` sends the immutable
  customer/order/amount and persisted attempt UUID as `Idempotency-Key`.
  A result must be `BILLING`, `DONE`, CARD, KRW, the expected MID/order, the
  exact original and remaining amount, and zero tax-free/exempt amount.
  Recovery uses `GET /v1/payments/orders/{orderId}`; an already known payment
  ID must also match. A query never initiates another charge.
  [Billing API](https://docs.tosspayments.com/reference) and
  [idempotency contract](https://docs.tosspayments.com/reference/using-api/authorization).
- **KakaoPay recurring billing:** `POST /online/v1/payment/subscription` sends
  the stored SID, original opaque customer, immutable order and positive
  taxable amount. Approval must bind CID, SID, order, customer, TID, AID and
  amount. No unsupported idempotency header is sent. Only a known TID can be
  queried through `POST /online/v1/payment/order`; a successful query requires
  matching identities, `SUCCESS_PAYMENT`, no cancellation and exactly one
  corresponding payment action. SID availability or its last-approval time
  never establishes this order's payment.
  [Recurring API](https://developers.kakaopay.com/docs/payment/online/subscription)
  and [order query](https://developers.kakaopay.com/docs/payment/online/payment-detail).

Kakao's offsetless approval timestamps are explicitly interpreted as Seoul
time; offset-bearing timestamps retain their stated instant. Requests support
the existing approved `taxable_krw` policy, not inferred mixed-tax pricing.
The response's opaque payment/action IDs are private verification evidence,
not public UI fields. Card details, raw messages, keys and response bodies are
discarded.

## Definite rejection is not automatic retry permission

Every invocation makes at most one request. The adapter's `retryAllowed` is
always false. Only the database and the approved renewal policy can authorize a
later, distinct attempt after a definite failure.

Toss's documented `REJECT_CARD_PAYMENT` and `REJECT_ACCOUNT_PAYMENT` refusals
describe insufficient balance or limits and receive the safe classification
`retryable`. Other narrowly recognized definitive refusals receive
`customer_action`, including stopped/lost cards and authorization failures.
Processing, duplicates, unknown error codes, malformed responses and server
errors remain `OUTCOME_UNKNOWN`.
[Toss error reference](https://docs.tosspayments.com/reference/error-codes).

Kakao documents `-782` as a failed subscription charge, but does not provide a
complete recoverable/permanent source-error classification. It is therefore
`customer_action`, not an automatic retry. The source code in its documented
example is not treated as a universal recoverable code. A merchant-reviewed
taxonomy would be needed to broaden unattended Kakao retries. This conservative
choice does not silently reduce the configured retry maximum for eligible Toss
failures. It prevents guessing from free-text error messages.

An uncertain Kakao renewal with no TID stays held for manual review; there is
no invented merchant-order search or SID-status shortcut. All query errors,
including not-found, retain uncertainty rather than proving no payment.

## Finite budgets and test boundary

Charge requests use one 65-second deadline across request and response-body
consumption. Queries have a 15-second deadline. Bodies are bounded, redirects
are rejected, cookies are omitted and caching is disabled. Host and lease
budgets must leave time to persist the result. Termination does not authorize
another dispatch.

`tests/unit/renewal-providers.test.ts` injects fictional HTTP responses and blocks
global provider fetch. It covers identity/tax/status checks, input rejection,
body/time bounds with a fake clock, result sanitization, isolated concurrent
classifications, documented failures and no-TID recovery. The existing
enrollment adapter suite remains a separate regression. These tests prove local
contracts, not provider availability, merchant acceptance or live operation.
