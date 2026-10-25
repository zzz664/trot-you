# 2026-10-25 — Billing notice database checkpoint

## Scope and decisions

- Added explicitly approved immutable KST notice scheduling bound to the accepted
  checkout/renewal version; no runtime default or live policy is seeded.
- Added actual private in-app inbox, exact immutable price/date snapshots,
  per-period deduplication, bounded owner cursor reads and explicit read markers.
- Added narrow optional billing preference. Approved mandatory in-app behavior
  never bypasses Web Push consent, preference, endpoint or Auth-session checks.
- Extended existing outbox and actual worker only for `billing_notice`, retaining
  legacy message/payment/schedule ABIs and explicit typed source constraints.
- Kept the existing verified-delivery renewal prerequisite unchanged. Inbox
  creation/read and push acceptance do not create renewal evidence or charges.
- Current name/legal acceptance, credential existence, exact policy/calendar,
  cancellation/rescheduling and unresolved money are checked again at delivery.
- Preserved ambiguous prepared-attempt history; accepted is not displayed/read.

## Verification recorded at this checkpoint

- Authored two rollback-only pgTAP suites: 106 assertions.
- Authored 12 independent-session PostgreSQL race scenarios using actual backend
  PIDs and `pg_blocking_pids`, with disposable-local setup/reset tripwires.
- `node --check scripts/test-billing-notice-concurrency.mjs`: passed.
- Focused JavaScript lint/format: run before checkpoint handoff.
- PostgreSQL migration, lint, pgTAP, compatibility suites and races: not run
  locally; required next in isolated CI. No Docker access retry was attempted.
- Genuine database type generation: pending that CI checkpoint; no hand-written
  database types were substituted.
- App/UI checks and browser/visual validation: separate ongoing feature work,
  not claimed by this database checkpoint.

## Operational limits

No provider push, charge, key generation, permission grant, deployment or Cron
activation occurred. A runtime notice policy and its mandatory/optional choice
need explicit approval. The original private specifications remain unpublished.
The previously blocked unrelated independent media review remains blocked and
was not replicated, retried or delegated; this checkpoint's normal new-feature
functional review is separate.

## First isolated CI checkpoint and corrections

CI run `40155360396` at checkpoint `5e80b6b` applied the migration and passed
actual database function lint. Its first pgTAP pass executed 3,371 assertions:
3 failed, all fixture-contract mistakes (not a runtime migration failure).

- The new raw-access assertion accidentally named nonexistent
  `public.billing_notices`; corrected it to the actual private table so it tests
  privilege denial rather than relation absence.
- Existing billing security tests treated all `billing_*` functions as
  service-only. They now distinguish four exact owner-safe notice signatures,
  with four independent positive authenticated / negative anonymous and service
  grant assertions. Every other billing RPC and future overload retains the
  original service-only protections; no broad prefix exclusion was introduced.

The corrected suite adds four compatibility assertions. Subsequent pgTAP repeat,
races and genuine type generation remain pending a new exact-head CI run.
No local database invocation or provider request was made to diagnose these
reported CI failures.
