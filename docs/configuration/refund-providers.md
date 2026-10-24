# Refund provider contracts

Reviewed against official public documentation on 2026-10-24. These adapters
perform no eligibility decision: a separately approved/published refund policy,
current admin authorization, immutable original verified charge and atomic DB
claim must precede dispatch. No policy is approved by adding credentials. User
cancellation stops future local renewal; it does not call these APIs, revoke a
shared mandate, refund money or terminate paid access.

## Shared contract and recovery

`RefundPaymentAdapter.refund` receives only a server-created attempt UUID, the
original order/customer/payment/action identities, original amount, prior
recognized refunds, requested amount, KRW and `taxable_krw`. The DB reserves this
exact capacity and allows one dispatch. Unknown/inflight work cannot create a
fresh attempt or rotate its UUID. Adapter calls have one bounded request and
body-read deadline; neither timeout nor any HTTP error becomes presumed failure.

Successful results contain only verified money/action facts, never provider
payloads, secrets, card data or arbitrary user-supplied reason text. Amount,
merchant, currency where returned, original identity, cumulative refunds,
remaining balance, timestamps and exact operation marker must match. Queries
must find a unique cancellation action for that marker; cumulative change or an
unrelated refund of the same amount is insufficient. Ambiguity remains unknown
for manual reconciliation. A later/out-of-band refund or missing provider history
can therefore block automatic recognition rather than be silently attributed.

## Toss card billing

Cancellation uses `POST /v1/payments/{paymentKey}/cancel`, Basic server-key
authentication and the persisted attempt UUID as `Idempotency-Key`. It sends the
explicit cancellation amount, KRW, zero tax-free amount, and a privacy-safe
`cancelReason` marker (`trot-you.refund.v1:<attempt UUID>`). The documented but
deprecated `refundableAmount` provides an additional expected-balance check; it
is not a replacement for idempotency. The response must be a matching BILLING
card payment, with DONE cancellation action, tax-free/exempt values zero, exact
balance and internally consistent cancellation totals. The matched
`cancels[].transactionKey`, not an arbitrary last-action field, identifies money.
[Official core API reference](https://docs.tosspayments.com/reference).

Recovery calls `GET /v1/payments/{paymentKey}` only. The adapter never repeats the
POST automatically, even though Toss supports POST idempotency; its documented
key retention is finite (15 days). Keys must remain stable and server-only.
[Official authentication and idempotency reference](https://docs.tosspayments.com/reference/using-api/authorization).

## KakaoPay recurring transactions

Cancellation uses `POST /online/v1/payment/cancel` with server-side `SECRET_KEY`
authentication, CID, original TID, explicit amount, zero tax-free amount and
expected available amount. The opaque operation marker is sent as `payload`.
The original enrollment/renewal adapters omit VAT so the provider computes it;
refunds correspondingly omit `cancel_vat_amount` rather than inventing a tax
allocation. The response must match the marker, cancellation AID, original
merchant/order/customer/TID, amount, cumulative cancellation and balance.
Some merchant categories cannot partially cancel; configuration alone does not
establish that capability. No idempotency header is invented.
[Official cancellation API](https://developers.kakaopay.com/docs/payment/online/cancellation).

Recovery calls `POST /online/v1/payment/order` with CID and known original TID,
not the cancellation endpoint. `payment_action_details` supplies the original
PAYMENT action and the CANCEL action's AID, time, amount and `payload`. Both
identities and exact marker are checked. Absent/duplicate markers, truncated
history, mismatched amounts or missing original action remain unknown. The
marker is correlation evidence, **not** a provider deduplication guarantee.
[Official order query API](https://developers.kakaopay.com/docs/payment/online/payment-detail).

The Kakao documentation pages' public content payloads were inspected through
unauthenticated documentation GETs; no payment endpoint was called.

## Verification boundary

`tests/unit/refund-providers.test.ts` uses fictional injected transports with
real parsers and no external fetch. It exercises full/partial cancellation,
exact query correlation, identity/tax/balance mismatches, duplicate actions,
invalid inputs, configuration failure, response size limits, timeouts, stalled
bodies and privacy. Controlled browser fixtures are separate CI evidence, not
merchant sandbox/live certification. Production still requires approved policy,
merchant permissions, operating procedures and separately authorized provider
verification. These adapters do not revoke mandates or schedule work.
