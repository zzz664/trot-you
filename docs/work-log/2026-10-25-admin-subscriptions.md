# 2026-10-25 — Administrative subscription dashboard

## Scope

Implemented the planned administrator subscription-status view with current
subscription categories, distinct currently eligible fans, first lifetime paid
fan/artist pairs, recorded paid-cancellation decisions and a precisely defined
recorded-renewal-obligation conversion. One feature branch follows the merged
operational-settings work; private source documents are not published.

- `/admin/subscriptions` and a GET-only actor-bound aggregate API. A caller cannot
  choose an actor, grant a role, approve policy or execute a billing operation.
- Inclusive KST date inputs, a 30-calendar-day default through today, 1–366-day
  bounds, an optional artist scope, deterministic 20-artist pages and global
  totals independent of the displayed page. All values have a database snapshot
  timestamp; the current-day window is partial as of that timestamp.
- Current stored billing-state eligibility is separate from historic events.
  Restricted fans and paused artists still pass through their independent
  actual content-authorization gates. Failed/pending attempts are not money.
- First paid pair counts exclude returning episodes. Cancellation is not churn,
  expiry or refund. Renewal rate counts known noninitial obligations, not every
  theoretically due user; zero denominator is unavailable, never a false 0%.
- Additive immutable cancellation evidence is collected by existing authorized
  transitions. Previously erased timestamps stay unknown, and older periods
  display a prominent completeness warning. Pending reactivation aborts with
  old paid history do not become paid cancellations.
- Explicit aggregate-only DTOs exclude fan identifiers, name, phone, email,
  payment/provider credentials, raw ledger and amounts. Export is not required
  for this view and is not added. The separately planned funnel definitions are
  not invented here.

## Application and privacy behavior

Server page payloads include only a validated query and identity-keyed mount,
not reusable private aggregates. The mounted client reads a fresh no-store API;
page hide, navigation, BFCache restoration, visibility changes, session loss
and current role/restriction loss clear results and invalidate late responses.
Strict schemas reject unknown projection fields, mismatched scope, inconsistent
partitions, rate denominators, duplicate artist rows and invalid KST boundaries.
Transport limits, error codes, paths and Korean copy are centralized.

The screen uses accessible shared controls, normal/large/xlarge text tokens,
wrapping layout, compact artist cards and a full 13-metric summary. It provides
explicit loading, unavailable/forbidden/not-found/input/setup states, retry,
empty pages, null-denominator text, artist reset, previous/next/first page,
date-range validation and labeled navigation. All new flows are included in
CI screenshot cases with computed body-font and settled-destination checks.

## Verification status

- DB checkpoint: `4b2b212c9a6aa2ea3c569eeabf0d6678efef6709`; see its separate
  database work-log for pgTAP, race and populated-upgrade coverage.
- Local full unit rerun including compact cards, scope checks and exact
  PostgreSQL-compatible rational rounding: **219 files / 6,720 tests passed**.
  After importing the genuine CI schema output, final local `npm run check:all`
  passed: full ESLint/Prettier, Next/TypeScript typecheck, all 6,720 unit tests,
  contrast checks and production/PWA build. The typed RPC adapter omits an absent
  optional artist argument rather than supplying explicit `undefined`.
- The existing exact-head database CI baseline took 16m34s. Its timeout is raised
  from 20 to 25 minutes to retain every existing repeat/race gate while adding
  populated upgrade verification and full disposable resets; no gate is skipped.
- Isolated fixture guard/discovery tests: **28 passed**. Dedicated browser suite
  contains 20 tests; the keyless suite contains 7 tests. Discovery and guarded
  configuration checks do not execute PostgreSQL or a browser.
- Local Docker/browser execution was previously blocked and was not retried,
  replicated, delegated or bypassed. Actual database, race, upgrade, generated
  type, authenticated browser and screenshot review evidence is pending CI.
- No handwritten generated database types, live accounts, provider requests,
  commercial policy approvals, deployed environment changes or scheduler
  installation were introduced.

### Genuine database schema checkpoint

CI run `40173783226`, remote head
`26448e68b661e00079b3f397ac81a7afc55df7c6` (same tree as local DB checkpoint),
passed actual DB lint, pgTAP twice, all existing/new concurrency checks,
populated upgrade verification and postgeneration typecheck. The expected
committed-type drift gate remained red until the actual output was imported.
Official artifact `12591069213` supplied `database.ts` (87,287 bytes), SHA-256
`5464deba0afc7013fdef51b21eee3d0802df7e092a8939c4982e352c5e50e600`.
The imported output adds only the generated dashboard RPC definition.

The separate checkpoint reply-browser job did not execute tests: its disposable
runner could not bind host port 54322 during `db:start`. This is not a browser
pass and is not evidence of an application failure. The app-head CI must run
that regression suite and all new browser cases successfully. Three subsequent
DB test-fixture hardening files also require execution on the final app head.

### Final local app validation

The complete local aggregate finished successfully with the genuine schema file
unchanged byte-for-byte. New isolated guard/discovery tests passed 28/28 and all
new browser cases are included in the first app CI head. An initial static
review added targeted captures so below-fold errors, loading, filters, entry and
pagination links cannot be omitted from narrow/large-text visual evidence.
Actual app-head authenticated browser, final DB hardening and screenshot review
remain pending remote CI; no runtime result is inferred from static discovery.
