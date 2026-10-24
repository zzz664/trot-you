# Provider registration preparation — not payments

> Historical foundation contract from the preparation-only feature. The current
> [initial-subscription flow](../configuration/initial-subscription.md) extends this
> boundary with authenticated encrypted callback capture, explicit POST consent,
> real provider adapters and atomic verified first-charge finalization. Statements
> below that completion is unavailable describe the earlier checkpoint, not the
> currently configurable flow. The checkout nonce is now SameSite=Lax for provider
> top-level return; all mutations still require exact same-origin POST.

This feature prepares a private checkout intent and implements **unused,
server-only provider protocol adapters**. The UI does not load the Toss SDK,
call KakaoPay, or send the user to a provider. Credentials alone do not enable
registration or charging. There is no billing-key exchange, approval endpoint,
credential vault, first charge, renewal, refund, or live verification here.

## Toss card registration

`prepareTossBillingAuth(env, identity)` returns the real v2 SDK descriptor:
`TossPayments(clientKey).payment({ customerKey }).requestBillingAuth(...)`,
with `method: 'CARD'` and canonical success/failure callbacks. It does not call
the SDK or invent a hosted registration REST endpoint. Only the browser-usable
client key enters this descriptor; the secret key and MID do not. Toss requires
a later server exchange of the returned authorization before billing can be
performed. [Official SDK reference](https://docs.tosspayments.com/sdk/v2/js/payment),
[billing integration guide](https://docs.tosspayments.com/guides/v2/billing/integration).

## Direct KakaoPay registration

`createKakaoPayPreparationAdapter(env, transport).ready(identity)` models
`POST https://open-api.kakaopay.com/online/v1/payment/ready` with JSON and the
server-only `SECRET_KEY` authorization scheme. It uses the recurring CID,
optional issued `cid_secret`, and random customer/order references, not personal
data. The ready response's TID is server-only; ready is **not** SID issuance,
approval, or a settled payment. [Official ready reference](https://developers.kakaopay.com/docs/payment/online/single-payment).

This adapter deliberately accepts no price input: its amount, tax-free amount,
and VAT are zero. KakaoPay documents zero-amount registration for issuing only
SID, but completion still requires a separate authorization/approval flow. The
future first-charge feature must explicitly choose this zero-registration path
or charged enrollment, never charge both. No business price, tax, promotional,
or refund policy is inferred by this protocol adapter. [Official recurring guide](https://developers.kakaopay.com/docs/payment/online/subscription).

Redirects must use exact HTTPS origins from the official common guide
(`online-pay.kakao.com`, `online-payment.kakaopay.com`), with the documented
`mockup-pg-web.kakao.com` sample host additionally allowed in test mode only.
Credentials, fragments, nonstandard ports, subdomain lookalikes, and arbitrary
hosts are rejected. This is an application allowlist, not a claim that all
future provider domains are supported. [Official domain/flow guide](https://developers.kakaopay.com/docs/payment/online/common),
[sandbox response example](https://developers.kakaopay.com/docs/payment/online/single-payment).

## Failure and activation boundaries

- Adapters revalidate the existing server environment, provider enablement,
  matching test/live configuration, and fixed canonical callback origin. Missing
  configuration fails before I/O; it never selects a mock adapter.
- Callback descriptors contain only random session/state correlation and a
  fixed outcome, never a user-supplied return URL. The current callback handler
  discards provider query data and performs no registration/charge mutation.
- Ready transport has a 15-second timeout, no redirect following, omitted
  cookies, no-store, a 16 KiB response bound, and one dispatch per method call.
  Recognized JSON client errors are classified as rejected; malformed responses,
  timeouts, network failures, HTTP 408/409/425/429 and server errors are unknown.
  Neither category automatically retries. No provider text escapes in errors.
- There is no invented Kakao idempotency header. Before wiring this adapter,
  the next feature must durably claim dispatch, persist TID/result before user
  handoff, preserve unknown outcomes, verify actor/state replay protection,
  securely store credentials, and complete first-charge reconciliation.
- `launchAvailable: false` is intentional, not an environment flag. All tests
  use injected in-memory HTTP responses and block global fetch. These prove
  request/response contracts only, not sandbox operation, merchant eligibility,
  a live credential, or a completed payment.
