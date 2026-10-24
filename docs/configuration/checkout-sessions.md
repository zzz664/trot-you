# Checkout intent preparation

> Historical foundation contract from the preparation-only feature. The current
> [initial-subscription flow](../configuration/initial-subscription.md) extends this
> boundary with authenticated encrypted callback capture, explicit POST consent,
> real provider adapters and atomic verified first-charge finalization. Statements
> below that completion is unavailable describe the earlier checkpoint, not the
> currently configurable flow. The checkout nonce is now SameSite=Lax for provider
> top-level return; all mutations still require exact same-origin POST.

## What is available

After full onboarding, the artist preview links to `/checkout/[slug]`. The page
requires a verified unrestricted fan, an active artist, current required profile
consents and an explicitly approved/published checkout policy. It displays the
complete policy text and exact regular/eligible introductory KRW prices; there
is no fallback policy, default price or pre-checked consent.

The user chooses Toss card billing or direct KakaoPay. Configuration readiness
is separate from merchant approval and operational availability. With missing
provider configuration, the form cannot prepare an intent. With configured
keys, preparing still creates only a short-lived private `pending_intent`—no
subscription, provider registration, payment credential, charge or access.
The final registration/payment action remains visibly unavailable.

| Interface                   | Behavior                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/checkout`        | Same-origin authenticated JSON; exact artist/provider/policy/consent/request key; atomic actor/policy/price revalidation       |
| `POST /api/checkout/cancel` | Same-origin authenticated JSON; owner session ID plus matching HttpOnly nonce; one-time local abandonment only                 |
| `GET /api/checkout/return`  | Discards **all** query data and redirects to fixed canonical `/checkout`; no auth-token exchange or database/provider mutation |
| `/checkout`                 | Explicit finalization-unavailable screen, never a payment success page                                                         |

Write endpoints do not accept GET. Caller-supplied user IDs, prices, return URLs,
provider tokens and extra fields are rejected. The service client is server-only
and only receives the subject obtained from verified actor authentication.

## Configuration

Use `.env.example` and the existing validated provider configuration:

- Supabase URL, actor public key and server-only service-role key.
- Canonical `NEXT_PUBLIC_APP_URL`; never derive callbacks from forwarded Host.
- Deliberate `PAYMENTS_MODE=test|live`, separate provider enablement, matching
  Toss client/server billing keys and MID, or KakaoPay Secret key/recurring CID.
- Optional KakaoPay `cid_secret` only if issued. Kakao Login keys are unrelated.
- Approved immutable policy/current pointer managed through reviewed owner-only
  database operations. No production policy is seeded or implicitly approved.

No environment switch can activate checkout completion. No production mock
adapter or test-success fallback exists. The isolated GitHub auth-browser job
uses explicit unusable configuration placeholders only to exercise local
intent creation; it never invokes the unused provider protocol adapters.

## Request safety and recovery boundary

The server generates a cryptographically random 256-bit nonce, stores only its
SHA-256 digest privately, and places the raw nonce in an actor/request/session
bound HttpOnly, SameSite=Strict cookie scoped to the checkout API. HTTPS uses
Secure cookies. The response contains only the opaque session ID, state, expiry,
provider ID and exact prepared price/eligibility snapshot.

The session lifetime is 15 minutes. A matching request key returns the original
session and never extends its expiry or changes its nonce. A missing original
nonce after a lost response cannot be replaced through retry. Multiple request
keys/providers cannot fork an active intent for the same fan/artist. Different
fans cannot read/cancel each other's sessions, even with a copied cookie.

Client/server transport errors are not proof a write failed. The UI disables
further writes after an uncertain outcome. Refresh rereads current terms, **not**
the durable intent; there is no hidden claim of recovery. The user may reopen
after expiry. The local expiry display is only a UI projection; SQL enforces the
authoritative boundary. Back/unmount/newer navigation invalidates late client
responses without claiming that an already-committed intent was canceled.

Responses are private/no-store and never echo database/provider error text.
No raw provider key, SID, authKey, pg_token or response is stored or sent to the
browser by these routes. Before enabling future provider callbacks, deployment
access-log/query redaction must also be verified: the application cannot erase
an upstream access log of an incoming token-bearing URL.

## Still required before actual enrollment/payment

The [protocol adapters](payment-provider-protocols.md) are tested with offline
HTTP responses only. Durable single-dispatch state, provider callback replay
verification, safe owner-visible recovery, encrypted credential storage,
first-charge authorization/reconciliation, retention policy, merchant approval
and real sandbox/live verification remain later MVP work. Preparation consent
must not be reused as authorization for a different/current charge amount.
