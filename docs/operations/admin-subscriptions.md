# Administrative subscription dashboard

## Scope and authority

`/admin/subscriptions` is a read-only operational aggregate. It shows the current
billing-state population separately from selected-period first payments,
cancellation decisions and recorded renewal-obligation conversion. It does not
cancel, refund, retry a charge, grant roles, approve policy, create accounts,
activate a provider, install a scheduler, export customer lists, or deploy.
There are no revenue, refund-count, settlement, churn-rate or funnel claims.
The four separately planned funnel metrics are not defined by this dashboard.

Only an authenticated, currently unrestricted administrator may call
`admin_subscription_dashboard`. An actor-profile share lock serializes reads
with role/restriction changes. The function rejects non-READ-COMMITTED isolation
rather than using an old authorization snapshot. After the actor lock, one SQL
statement obtains every metric, the selected artist, total and page from the
same database snapshot. The returned `as_of` is captured in that statement;
subsequent refreshes/pages are new snapshots, not a pinned historical report.

The RPC returns only artist public identity/status and aggregate counts. It does
not return fan names, UUIDs, email, phone, billing/customer identifiers, payment
amounts, provider payloads, evidence keys, credentials or individual events. It
uses the actor-bound database connection, not service credentials. The feature
adds no direct table grants. Read operations create no audit rows and change no
subscription/billing state. Cancellation evidence is recorded transactionally
by an additive database trigger when an already-authorized billing path changes
a cancellation marker; that is not a new cancellation API.

## Calendar and bounds

Inputs `from` and `to` are **inclusive KST calendar dates**. The precise interval
is `[from 00:00 Asia/Seoul, (to + 1 day) 00:00 Asia/Seoul)`. UTC is not used to
truncate user dates. The default is the current KST day and its preceding 29
days. Accepted ranges span 1–366 inclusive days, start no earlier than
2000-01-01 and end no later than the current KST date. Events/cohort boundaries
later than `as_of` are excluded even on the current partial day. The database
checks the current day itself; a browser clock does not authorize a future
range. The output preserves both date labels and exact half-open timestamps.

All artist statuses are included, including draft, paused and retired artists;
zero-subscription artists remain visible. A selected artist scopes both summary
and page. An unknown UUID yields NOT_FOUND, not a fabricated zero population.
Pages contain 20 artists ordered by name using PostgreSQL `C` collation, then
UUID, and accept page numbers 1–1000. Summary totals cover the complete selected
scope, never only the current page. A past-final page is explicitly empty with
`has_more=false`. Offset pagination is not an immutable export: concurrent
changes can shift later pages, so refresh to obtain a new current view.

## Current population (not a historical state reconstruction)

`current` ignores the selected historical period and classifies stored current
subscription rows at `as_of`. A row represents one persistent fan/artist pair;
returning episodes reuse that row.

| Field                 | Definition                                                                             |
| --------------------- | -------------------------------------------------------------------------------------- |
| `total_subscriptions` | All persistent fan/artist rows in scope, including pending and expired rows.           |
| `subscribers`         | Distinct fans with at least one row in active-paid, grace or canceled-paid categories. |
| `active_paid`         | Status active and `current_period_start <= as_of < current_period_end`.                |
| `grace`               | Status grace and `grace_started_at <= as_of < grace_ends_at`.                          |
| `canceled_paid`       | Status canceled and `current_period_start <= as_of < current_period_end`.              |
| `pending`             | Status pending, regardless of any retained previous-episode period.                    |
| `expired`             | Status expired.                                                                        |
| `out_of_access`       | Other active/grace/canceled rows whose relevant period has not begun or has ended.     |

The six row categories partition `total_subscriptions`. `subscribers` is a
separate deduplicated person count; artist-level subscriber counts cannot be
summed to infer a global unique-person count. These categories describe
**billing-state eligibility**, not actual content authorization or proof of
fresh money. Artist publication status, user restrictions and message access
rules still apply elsewhere. The state labels trust the established billing
state machine; they are not a ledger-verification join. A late expiry worker
cannot turn an ended period into an eligible period in this view.

## Selected-period facts and exact rate

- **`new_subscriptions`:** Count persistent fan/artist pairs whose earliest
  verified positive charge's `occurred_at` lies in the selected interval.
  Verification must exist, and charge occurrence/recording must be no later
  than `as_of`. Pending attempts and raw unverified rows are not new paid
  subscriptions. A returning episode is not new if that pair has an older
  verified charge. Refunds do not erase the first-payment fact. The earliest
  known verified history, rather than a mutable current `first_started_at`, is
  authoritative; late recording can legitimately revise a later report.
- **`cancellations`:** Count immutable paid-cancellation decisions whose original
  `canceled_at` lies in the interval, not fans whose current state happens to be
  canceled. An observed paid cancellation transitioned from active or grace and had a
  verified positive charge with both occurrence and recording at or before
  cancellation. Pending reactivation aborts remain unpaid even when the row
  retains an older paid episode. Unpaid signup aborts are
  retained internally but excluded. A late recovered charge does not
  retroactively label an unpaid abort paid. Repeated cancellation of the same
  marker counts once; a later cancellation after re-enrollment is another
  decision. Cancellation is not a refund, immediate access loss or churn rate.
- **`renewal_due`:** Count **recorded noninitial billing obligations** whose
  `period_start` lies in the interval and is no later than `as_of`. Open,
  settled and void obligations all remain in this known cohort. Initial and
  returning-episode initial obligations are excluded. This is not every
  theoretically due subscriber: a scheduler that never created an obligation
  leaves that potential obligation outside the denominator.
- **`renewal_paid`:** Of that same cohort, count obligations with at least one
  verification-linked positive charge by `as_of`. The charge must reference the
  same subscription and a payment attempt belonging to the obligation. A
  successful retry counts once per obligation. Its approval can fall after the
  selected interval, provided it is known at `as_of`. A refund does not undo a
  successful collection fact. Failed, created, inflight and unknown attempts
  without verified charge never count as payment success or money.
- **`renewal_rate`:** `round(100 × renewal_paid / renewal_due, 2)` percent; JSON
  `null` when the denominator is zero. It is a recorded-obligation conversion
  observation, not retention, calendar-period revenue or an approved funnel
  metric. Current-period results may change while recovery continues.

No money is summed and no attempt count is misrepresented as a financial event.
A failed attempt is neither an expired subscriber nor a recognized refund.

## Cancellation history coverage and upgrade

Before migration 00029, `subscriptions.canceled_at` retained only the latest
marker and was cleared on re-enrollment. Lost earlier events cannot be recovered
from current state. The migration preserves all existing billing and identity
rows unchanged, imports only nonnull retained markers as `retained_marker`, and
records an immutable `cancellation_history_complete_from` boundary. Earlier
ranges **must display an incomplete-history warning**, even when the reported
count is zero. Retained markers (and directly inserted canceled rows with no
observable prior state) count as paid only when cancellation lies within the
retained paid/grace window and a verified charge matches that retained paid
period. This conservative inference can omit earlier paid cancellations after
an elapsed window; it avoids counting an aborted pending reactivation based
only on lifetime money. A retained marker is evidence of that timestamp, not
a claim of complete earlier history. No erased timestamps are synthesized.

The migration fences subscription writes while it imports markers and installs
the trigger; no cancellation can fall into an unlocked cutover gap. Future
marker transitions append `observed` evidence transactionally, protected by a
unique `(subscription_id, canceled_at)` constraint and immutable update/delete/
truncate guards. Re-enrollment cannot erase old evidence. No API role has direct
read/write permission for history or coverage. An upgrade test compares exact
pre/post source rows and verifies retained-versus-missing history; committed
fictional test data is removed only by a full disposable-database reset, never
by disabling immutable triggers.

## Verification boundaries

The isolated test suite covers KST midnight inclusivity/exclusivity, 366-day
bounds, partial current-day semantics, first-payment versus reactivation,
failed/unknown attempts, late renewal approval, refund separation, duplicate
cancellation, retained coverage, pagination and zero denominators. Independent
PostgreSQL sessions exercise role/restriction loss in both orders, concurrent
same-subscription cancellation, uncommitted billing visibility and the snapshot
after an authorization wait. Fixtures use only synthetic local accounts/data,
not real accounts, external providers or approved commercial policy.

Actual database and browser execution occurs in isolated CI. These fixtures and
a successful build are not evidence of hosted configuration, live charging,
provider delivery or production operation. Export remains a separate feature;
no customer-level export is required by this dashboard contract.
