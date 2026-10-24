# Initial subscription enrollment and first charge

This feature wires the real provider protocols to the existing private checkout,
subscription, verified-money ledger and transactional notification outbox. It is
**configuration-ready code, not evidence of a working merchant account or a
sandbox/live payment**. Nothing is enabled by default and no real provider call,
credential provisioning, merchant registration, charge, refund or deployment was
performed during implementation.

## Configuration and activation

Use the validated variables in `.env.example`: actor-scoped Supabase connection,
server-only service-role key, canonical app origin, deliberate test/live mode,
provider enablement and matching merchant credentials, plus a dedicated
`PAYMENTS_VAULT_KEY` (canonical base64, 32 bytes) and
`PAYMENTS_VAULT_KEY_VERSION`. Do not reuse a provider key as an encryption key.
Missing or inconsistent configuration fails closed, never to fake success.

The checkout requires a current, explicitly approved immutable policy with exact
positive initial and regular prices, an explicit `billing_period_calendar`
(`utc_monthly_clamped` or `seoul_monthly_clamped`) and `payment_tax_basis=taxable_krw`,
an active artist and a fully onboarded,
unrestricted fan with current legal/profile acceptance. No real policy, price
approval or personal data is seeded. Zero introductory prices are unsupported
by this paid-first-charge path and fail closed rather than inventing revenue.
The tax choice explicitly means the displayed total is taxable, VAT-inclusive KRW.
Existing approved policies with either choice unset remain unavailable for enrollment;
there is no inferred UTC/Seoul or tax default. A new approved immutable policy version
is required to select them. Confirm merchant tax treatment before activation. Renewal/refund/export scheduling is not part of this feature.

The original preparation-only path remains available when provider configuration
exists but the vault is unavailable; it cannot authorize a payment. The launch UI
appears only when the full configuration is valid. Test/live is shown explicitly.
[Provider contracts and verification limits](initial-enrollment-providers.md)
describe the exact APIs and [isolated CI](enrollment-ci.md) explains fixture-only
transport injection. A production process rejects that injection.

## Customer sequence

1. `POST /api/checkout` creates the existing owner-bound immutable intent after
   the displayed terms are accepted. A new explicit preparation first retires
   only expired idle enrollment with no financial attempt, allowing recovery
   after an old nonce cookie or login session is lost. Unknown financial work
   cannot be cleared or bypassed by this cleanup.
2. `POST /api/checkout/enrollment/start` binds the verified Auth `session_id`
   digest, original nonce and provider merchant. Toss returns the actual SDK
   descriptor. Kakao claims and persists one charged-ready response before any
   redirect; mobile and desktop use their separately allowlisted provider URLs.
3. The provider-required top-level callback GET validates account, original
   session, nonce-derived state, provider and customer binding, then stores only
   an AES-256-GCM envelope valid for at most five minutes and the checkout TTL.
   It makes **no provider call**. Every query value is scrubbed with a fixed
   canonical 303 before any application HTML/RSC document renders.
4. `/checkout/complete?session=...` reads only safe current status. The customer
   explicitly checks the exact first-price consent and submits a same-origin
   POST containing session, policy version and amount. Toss exchanges its auth
   key, persists the encrypted billing key, then claims the initial charge.
   Kakao approve both issues SID and performs that same first charge; there is
   no second `/subscription` request.
5. Verified payment facts, encrypted SID (Kakao), immutable ledger event, paid
   subscription period and notification outbox commit atomically. The lifetime
   introductory benefit is redeemed once per user and artist. Monthly periods
   use the explicitly approved UTC or Asia/Seoul wall-clock anniversary and
   end-of-month clamping; no host timezone or automatic default is consulted.

The client never receives a billing key, SID, auth key, pg_token, TID, vault
reference, ciphertext, provider body or service key. The browser-usable Toss
client/customer descriptor and the provider's required handoff URL are the only
provider navigation data returned by launch. Status and mutation responses are
strict allowlisted projections with no-store/no-referrer headers.

## Claims, uncertainty and recovery

Each ready/exchange/charge/approve stage obtains one durable 120-second lease.
The service dispatches only from a fresh claim. A second worker, callback replay,
new request key or expired lease cannot acquire a new dispatch. Toss carries the
same persisted operation UUID in its documented idempotency header; Kakao is
never assumed to deduplicate merchant order IDs.

Provider requests have a 65-second maximum and no automatic retries. The route
requests a 300-second execution budget, covering the two sequential Toss calls,
Auth/DB deadlines and persistence margin; the browser timeout is 285 seconds.
The deployment must actually support this budget before activation. A shorter
host termination is still held as unknown, never assumed declined.

A lost first-charge result remains held. Explicit owner/session/nonce-bound
reconciliation only queries the existing order/TID and may finalize the same
verified result; it never calls ready, exchange, approve or charge. Restrictions
or changed policy after dispatch do not prevent recording already-verified
money. If a known response encounters a lost database reply, the service first
observes durable state and may replay the **same idempotent database finalization
once**, preserving the same evidence and encrypted SID. It never repeats provider
I/O. Read failure or a second persistence failure is reported as unavailable.

Toss can reconcile a charge by the immutable order ID. Unknown ready/exchange
outcomes are manual review. Kakao order query requires a known TID and does not
document SID recovery. A query-proved payment with missing SID is recorded as
bounded private reconciliation evidence and remains manual review; the app does
not fabricate a mandate, paid ledger finalization or another approval.

Idle cancellation is explicit and owner/session/nonce-bound. Dismiss/Back changes
only navigation, not an already-dispatched payment. Expired idle cleanup cannot
touch processing, unknown or manual-review states. Definitive declines close the
uncharged episode and require fresh registration/consent for another attempt.
Physical retention, encryption-key rotation/migration, operator reconciliation,
provider-side credential revocation and unattended renewals still require their
separate reviewed operational workflows. Local cancellation disables local use;
it does not claim to revoke the provider credential.

## Logging and verification

Next request/fetch/server-function logging and browser-to-terminal forwarding are
disabled to avoid callback-query, provider-path or argument leakage. Before real
activation, upstream hosting/access/error tracing must also redact or exclude
these paths; application code cannot retroactively scrub a proxy's access log.

Offline unit and HTTP-contract tests prove only local behavior. The mandatory CI
runs actual disposable Supabase PG17, pgTAP twice, independent-session contention,
genuine CLI-generated schema types, full quality/default/auth regressions, and
browser tests against the actual app/DB with an explicitly guarded loopback
provider. Mobile/desktop handoff and all three font scales are captured for review.
Actual sandbox/live provider behavior, merchant eligibility, tax/timestamp and chosen billing-calendar
interpretation, PWA handoff and production operation are separate verification
gates requiring the user's later credentials and authorization.
