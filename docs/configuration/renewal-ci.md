# Isolated renewal integration verification

The `renewal-browser` CI job exercises the actual Next.js protected route,
Supabase Auth, private RPCs, encrypted credential vault and verified-money ledger.
All provider responses are deliberately fictional loopback HTTP fixtures. It
neither enables a deployed scheduler nor uses provider-issued keys or performs a
merchant sandbox/live charge, cancellation, refund or notification delivery.

## Guards

The job requires every enrollment CI prerequisite plus
`RENEWAL_LOCAL_E2E=true`, explicit renewal enablement and the exact public fixture
Cron token. A production or partially configured runtime rejects that token;
missing test flags never promote it to a usable real Cron credential. The test
provider binds only to IPv4 loopback, validates Host/Origin and fixture auth,
bounds bodies and makes no outbound requests. The real adapters can be rewritten
only to the fixed loopback endpoint and narrowly allowlisted API paths. SID
status, revocation, refunds and arbitrary hosts/paths remain rejected.

Browser SDK and Kakao handoff responses are intercepted; other external browser
traffic is blocked and counted. No tracing captures provider tokens. The app
process receives only the disposable local service key, not the fixture-admin
variable. All test artifacts must be reviewed before describing browser/visual
verification as passed.

## Deterministic scheduling and concurrency

The fixture first performs the actual initial enrollment through the browser.
Only then, local-owner SQL rebases that explicitly fictional subscription's
scheduling/episode dates to create a due renewal. This is **synthetic chronology**,
not a claim that a calendar month elapsed after the just-recorded first charge.
Immutable payment events and verification records are never rewritten, deleted,
or protected by disabled triggers. All fictional rows remain until the dedicated
Supabase stack is destroyed.

Retry, recovery, grace and lease clocks are moved through guarded local-owner
fixture SQL. No production RPC accepts an arbitrary clock, and no application
clock override or sleep is used. Tests assert explicit 86,400-second retries,
259,200-second grace and three permitted retries after the first attempt; these
are fictional approved fixture policy values, not runtime defaults or actual
business approval. A successful retry settles the same unpaid period.

The HTTP fixture offers an explicit response barrier, released by a separate
loopback-only control request. This establishes concurrent Cron/cancellation and
lease-expiry observations without a timing guess. Kakao deliberately creates a
distinct TID/AID for every duplicate dispatch, so fake idempotency cannot conceal
an application double-charge. Lost Kakao TIDs remain unavailable; no SID-status
result is fabricated. Toss queries can be made unavailable to prove the finite
three-query recovery budget without authorizing another charge.

Prior tests' retained uncertain operations are canceled locally where permitted
and their fixture recovery clocks moved beyond the observation horizon; they are
not misclassified as failed or deleted. Every fixture SQL operation is restricted
to the fixed disposable local Docker stack and recognizable fictional identities.

## Coverage and evidence boundary

Twenty browser scenarios cover both providers, three font scales, regular-price
renewal, no introductory reapplication, duplicate-subscription UI denial,
24-hour retry/grace/max-retry bounds, same-period retry success, customer-action
refusal, unknown outcomes, Toss recovery/query budgets, missing Kakao TID,
overlapping Cron, expired leases, cancellation order, exclusive paid/grace
access boundaries, current terms, missing approval and mandatory notice evidence.
Screenshots show the existing owner-facing duplicate guard, never private renewal
identifiers or a new checkout success.

The original default, authenticated and enrollment browser jobs remain separate
regressions. The database job adds actual pgTAP and independent-session renewal
concurrency checks and still generates official schema types. Offline fixture
and unit checks are not substitutes for those CI results or later authorized
merchant sandbox/live acceptance. Local browser execution was not retried after
the previously established execution denial; CI owns that pending verification.
