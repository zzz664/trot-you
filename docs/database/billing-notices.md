# Approved pre-billing notices

Migration `20261025000025_billing_notices.sql` adds a private authenticated inbox
and the `billing_notice` source to the existing Web Push outbox. It neither seeds
an operating policy nor invokes a provider, creates payment attempts, records
delivery evidence, installs a schedule, or enables production traffic.

## Exact approved snapshot and KST scheduling

`private.billing_notice_policies` is keyed to one immutable approved checkout and
renewal policy. Its explicitly approved values are `days_before`, `hour_kst`, and
`mandatory_inapp`. Approval makes the row immutable. Absence, a draft, future
publication, an unaccepted current price version, or an incomplete billing
calendar fails closed. There is no inferred one-day runtime default.

The due time is the Seoul-local billing date minus the approved number of
calendar days, at the approved Seoul-local hour. This is not necessarily a
24-hour interval. The computed due time must be no later than the renewal
policy's minimum notice deadline; a mismatched daily schedule fails closed.
Creation can occur after its due time but never at/after the billing instant.
A late inbox entry is not evidence satisfying that minimum renewal deadline.

Each notice retains immutable subscription, actor, artist, mandate, checkout
version, period, amount, KRW currency, billing instant and due-time snapshots.
`(subscription_id, period_start)` is unique even across policy changes. Rescheduling
or cancellation invalidates the old period's notice and pending jobs; restoring
an old date does not silently revive it or generate another same-period notice.
A changed current policy, revoked mandate, missing encrypted credential,
unresolved billing obligation, restricted actor, rotated legal acceptance or
invalid current name suppresses reads and delivery. No credential value leaves
private storage.

## In-app preference and read semantics

`mandatory_inapp` is an explicit product-policy choice, not an assertion about
legal requirements. Optional inbox items require the owner's billing preference.
Mandatory inbox items remain available when that optional preference is off.
The narrow billing-preference RPC preserves browser-push, message and schedule
preferences. It never requests browser permission or grants push consent.

Web Push always additionally requires billing preference, global opt-in,
current consent, active endpoint and live Auth session. Mandatory in-app does not
bypass any push condition. The worker adds only `billing_notice`; old generic
payment and schedule jobs remain outside its actual delivery allowlist.

An owner-requested `read_at` is a UI marker, not proven human comprehension or
verified delivery. Creation, listing, marking read, queuing, transport ambiguity
and provider acceptance **never insert `renewal_notice_receipts`**. The existing
external-verified renewal prerequisite remains unchanged and fail-closed. A
provider acceptance is not device display, receipt or read.

## Narrow RPC contracts

| RPC                                                           | Caller        | Result                                            |
| ------------------------------------------------------------- | ------------- | ------------------------------------------------- |
| `billing_notice_candidates(limit=20)`                         | service       | At most 20 subscription UUIDs, fair rotating scan |
| `billing_notice_create(subscription)`                         | service       | Zero or one `{notice_id,created,push_jobs}` row   |
| `billing_notice_list(limit=51,before_created_at?,before_id?)` | authenticated | Safe own current inbox; newest first              |
| `billing_notice_mark_read(notice)`                            | authenticated | Idempotent own current read marker                |
| `billing_notice_preferences()`                                | authenticated | Own `billing_enabled` boolean                     |
| `billing_notice_set_preference(enabled)`                      | authenticated | Own persisted `billing_enabled` boolean           |

The inbox cursor must supply both finite timestamp and UUID. Its exclusive
`(created_at,id)` ordering supports a 50-item page plus one lookahead without
hiding older items. Raw tables and private helpers are inaccessible to all
application roles, including service role. Public functions pin an empty search
path and grant only intended callers.

`webpush_prepare_delivery` now returns the safe `source_kind` discriminator in
addition to its existing exclusive endpoint capability. It exposes no price,
artist name, billing date or arbitrary click URL. The application must choose
generic copy and a fixed authenticated destination from that discriminator.

## Concurrency and uncertainty

Authoritative order is profile, current name/legal policy and acceptances,
artist, subscription, mandate/credential/current checkout policy, notice,
preferences, Auth session/device, notification policy, then job. Inbox creation
uses an exclusive subscription lock and commits inbox plus deduplicated channel
jobs atomically. Shared profile locks serialize preference/role changes without
upgrading later. Currentness is recomputed with the post-wait clock.

Cancellation and rescheduling invalidate notices before canceling jobs. Final
preparation and recovery recheck all current eligibility, including exact
billing period and open unknown payment obligations. Prepared ambiguous sends
retain unknown evidence when later suppressed; genuine acceptance after opt-out
remains acceptance. No database lock can recall an HTTP request already sent.
Existing lease fencing, preparation-once, bounded backoff and at-least-once push
recovery semantics remain in force.

## Verification

The two new rollback-only pgTAP suites contain 106 assertions covering schema
privacy, immutable approvals, KST month/year/leap boundaries, insufficient lead,
future/billing boundaries, deduplication, own cursor pagination, current actor
readiness, mandatory/optional choices and real outbox/prepare behavior. The
independent-session script adds 12 races and observes actual backend blocking
PIDs. Both existing notification and Web Push compatibility suites must still
pass. `scripts/billing-notice-fixture.sql` is fictional disposable-test setup,
not an operational seed.

Local JavaScript syntax and formatting checks do not replace actual PostgreSQL
migration/lint/pgTAP/race execution. CI must generate genuine schema types and
verify the exact committed head before merge. No local Docker/browser execution,
live push or payment request is claimed by this document.
