# 2026-10-25 — Administrative subscription dashboard database checkpoint

## Scope and decisions

- Added an actor-bound aggregate-only read RPC with one consistent statement
  snapshot after current administrator authorization, bounded inclusive KST
  dates, selected artist, deterministic 20-row pagination and page-independent
  totals. No billing mutation/provider/account/settings/deployment endpoint.
- Explicitly distinguished current billing-state eligibility, first verified
  lifetime pair payments, paid cancellation decisions and recorded-obligation
  renewal conversion. Attempt state is not recognized money; no revenue,
  refund-count, churn-rate or missing funnel definition was fabricated.
- Existing cancellation timestamps are lossy across re-enrollment. Added
  immutable observed history and retained-marker import with an immutable
  complete-from boundary; ranges before that boundary remain visibly incomplete.
  The upgrade fences writes and preserves existing source rows exactly.
- Added pgTAP coverage, independent-session authorization/cancellation/snapshot
  races and a populated pre-00029 upgrade/compatibility check. Financial fixtures
  remain synthetic and are cleaned only through full disposable database reset.

## Verification at checkpoint

- `node --check` passed for the two new CI database scripts.
- Formatting applied to new JavaScript scripts and documentation.
- Actual PostgreSQL, pgTAP, race, upgrade and schema generation checks are pending
  isolated CI; local Docker/browser execution remains blocked and was not
  retried. No handwritten generated database types were introduced.
- App/UI checks are tracked separately while this early database checkpoint
  produces genuine schema output. No live account, policy, provider, payment,
  scheduler or production deployment was exercised.
