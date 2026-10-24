# Artist message dispatch

## Publication is not provider delivery

This feature turns an **owned, saved draft** into a scheduled or published
in-app message. `public.messages` remains the shared chat source; there is no
per-recipient plaintext inbox copy. At read time, the existing fan API still
checks current role, restriction, artist status, subscription/grace and history,
then renders `{이름}` on the server using that fan's current calling name. Existing
logical media associations are reused, not copied or re-uploaded.

Publication and the eligible Web Push outbox are one database transaction.
`sent` means **published in-app**, not pushed to a device. `notification_state`
reports whether eligible notification work was enqueued, never provider
acceptance or receipt. This feature does not implement Web Push/Alimtalk delivery,
call providers, activate Cron, approve notification policy or create consent.
Missing/disabled notification policy permits in-app publication with `not_queued`.

The source contracts are the private architecture §3.3–3.4, database messaging
schema and API §3.5. Their shared message source and publication-time notification
selection are preserved. The unsafe example of deleting queued evidence is
replaced by the existing auditable cancellation lifecycle. Original specifications
are not copied into this repository.

## Owner-bound APIs

Authenticated RPCs derive the artist actor from `auth.uid()`; fan/admin identity
is not artist impersonation. Current role, restriction, membership and ownership
are rechecked under locks. New submit requires an active artist. History and
cancellation permit a paused artist so a pending schedule can be suppressed before
reactivation. Removed membership or restricted author identity grants no access.

- `artist_dispatch_artists(after_slug?)`: up to 50 current-membership artists
  with this owner's submissions, including paused artists, for a reachable history
  and cancellation entry point.
- `artist_dispatch_submit(artist_slug, message_id, operation_id,
expected_revision, scheduled_at?)`: exact saved revision; null timestamp means
  immediate in-app publication; a supplied finite timestamp must be strictly
  after the locked database clock. A past schedule is **not** silently sent now.
  Pending unexpired uploads block confirmation, and completed content/media
  metadata are validated again. The draft revision advances once. Cancellation increments the archival revision
  when representable and saturates at the existing safe-integer ceiling; an
  already published message must remain cancellable at that boundary.
- `artist_dispatch_cancel(artist_slug, message_id, operation_id)`: owner-only
  suppression of a submitted message. Does not edit the content or discard bytes.
- `artist_dispatch_context(artist_slug, message_id?, before_created_at?,
before_id?)`: exact selected receipt plus up to 30 own submissions, newest
  immutable `(created_at, message_id)` first. Both cursor components are required.
  The server clock and current cancellation policy are included.

A receipt contains message ID/type/body/revision/status, submission/schedule/
publication/cancellation timestamps, cancellation deadline and current
`can_cancel`, logical media metadata, enqueue state, and a bounded failure
category. It contains no fan identifiers/counts, endpoint/key, Storage path,
provider evidence or account/agency data. `created_at` is the immutable submission
time, not the changing message update time.

Stable operation UUIDs bind the exact action/resource/revision/schedule.
Timestamps are stored in the request as precise numeric UTC epoch values, so
session timezone changes do not alter an otherwise exact retry. A duplicate
request returns the **current** receipt: an original send retry after cancellation
must not resurrect the message or report stale sent success. Changed requests
with the same key conflict. New keys cannot publish a non-draft again. Old
composer and service mutation APIs cannot bypass this owner/revision boundary;
legacy unmanaged collaborative messages retain their prior behavior.

## Audience selection and bounded work

At publication, opted-in devices for currently eligible fans are selected using
a single server timestamp and materialized once. Paid canceled subscriptions and
unexpired grace qualify; expired, restricted, unonboarded and non-fan accounts do
not. Notification policy, category preference, current device consent/version and
source access apply. Later notification setup, new devices or new subscribers
cannot expand a managed publication's frozen outbox through replay. Existing
notification claims recheck current eligibility under their established locks;
queued work is not a perpetual entitlement. In-app history is intentionally **not**
a frozen audience and retains its existing current-access rules.

Technical safety ceilings are fixed in the migration, not represented as approved
commercial quotas or runtime settings:

- 30 new submissions per actor per rolling minute; exact retries do not consume
  another allowance. Actor locks serialize concurrent decisions.
- 100 outstanding scheduled submissions per artist; artist locks serialize the
  capacity decision. Canceled/completed messages do not occupy this queue.
- 5,000 eligible notification devices per publication. At most 5,001 identities
  are materialized to detect overflow. Overflow rolls back the entire immediate
  publication or leaves a scheduled item blocked; it never silently truncates
  recipients or commits a partial sent source/outbox.

Raising these ceilings needs a reviewed, tested migration and capacity evidence,
not an unapproved operational-setting change. The 1,000-subscriber SQL fixture
checks atomic completeness only; it does not establish a delivery latency SLA.

`message_dispatch_run(limit = 10)` is service-only and accepts 1–20 candidates.
The HTTP adapter supplies its own bounded value, not a browser-controlled limit.
It claims, validates, publishes and enqueues inside a database transaction, with
**no external I/O**. Therefore no durable lease is necessary: worker/connection
failure before commit rolls back both source and outbox, and a later invocation
can safely retry. Two workers cannot both own the same row locks.

The lock order is author profile → artist → membership → message → owned draft →
submission → policy, compatible with authoring and notification boundaries.
Worker locks use NOWAIT and per-candidate subtransactions. Contended candidates
are skipped; a nonblocking private retry note defers them by 60 seconds when the
submission row is available, letting later candidates advance. Known authority,
content, policy or fanout failures roll back that candidate and record only
`author_unavailable`, `content_invalid`, `policy_unavailable` or `backpressure`,
with the same technical backoff. A restored prerequisite can later publish once.
Unknown SQL failures propagate and roll back rather than being called successful.
A concurrent cancellation wins normally and never has its state resurrected by a
retry-note write. `has_more` indicates currently due work, not future retries.

## Cancellation boundary

Scheduled messages remain cancellable before publication. Published messages
are cancellable strictly before `sent_at + current message_policy.
cancel_window_seconds`; equality is too late. The document's five-minute value
is a fixture/default policy proposal, not activated by this migration. The server
checks time **after** waiting for authoritative locks. UI clocks are informative,
never cancellation authorization.

Cancellation hides the source from subsequent fan reads and atomically cancels
queued/retry-wait jobs. Previously leased/unknown notification work retains its
truthful state plus a cancellation request; provider-accepted evidence is not
rewritten. Existing read evidence is retained. Previously displayed content,
already accepted external notifications and already issued short-lived media
URLs cannot be recalled. The existing media API denies new signing after
cancellation; its issued URL expiry boundary remains unchanged.

## Verification boundary

The pgTAP suites use rollback-only fictional profiles, subscriptions, media
metadata and devices. Ordinary accepted media RPCs are exercised; no new media
parser/security probe or retry of the previously blocked independent media
review is included. The concurrency script accepts only the guarded disposable
CLI-managed local Supabase Docker database and resets it afterward. It uses
independent PostgreSQL sessions and `pg_blocking_pids`, not sequential calls
presented as races. No hosted URL, provider key or actual notification is used.

Generated public RPC types must come from actual Supabase CI. Supplemental
PGlite uses synthetic Auth/Storage tables and is only a SQL/pgTAP precheck, not
PostgREST, real Storage, concurrent sessions or browser evidence. Actual PG17
migration/lint/pgTAP/races/type drift and browser results belong to the exact-head
CI verification recorded in the work log.
