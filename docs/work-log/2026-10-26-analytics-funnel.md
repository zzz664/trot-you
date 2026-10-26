# 2026-10-26 — Consent-bound analytics visibility (feature 39)

> Current rule (user correction on 2026-10-26): development validation is strictly
> changed-work-only. The cumulative runs recorded below are historical evidence,
> not permission or a recommendation to repeat them. Full tests remain stored
> but dormant until one explicitly designated predeployment run. No such run or
> deployment is authorized by this feature.

## Scope and decisions

- Preserved the complete predecessor Git history in a private verified bundle,
  fetched/pruned origin and verified develop
  `abb259d384e9461e7cc9817d2e1af93b1c7d1ca6`, tree
  `70193c4a060c3adba4ae7cd97ce574c226988a83`. Local develop was
  fast-forwarded without reset; the finished activity branch was archived before
  starting the sole `feature/analytics-funnel` branch. Main is unchanged.
- Keep the exact 13 documented event names and accepted property schemas. Add
  prospective source instrumentation and a private admin raw-count dashboard;
  a raw event count is not a conversion rate, unique-person count, causal funnel,
  complete historical record, or proof that a client observation occurred.
- The original four business metric definitions are missing. Their names,
  numerator/denominator, population, time window, attribution and deduplication
  semantics are not approved. Show explicit unavailable boundaries; do not invent
  formulas, name proposed metrics as approved, or call that part complete.
- No original private specifications, actual user data, provider credentials or
  source payloads are published. No analytics policy is approved/activated, no
  actual user consent is granted, and no role, provider, scheduler or deployment
  is changed. Isolated test fixtures are fictional.
- The new dashboard uses current approved enabled collection policy, current
  consent version/epoch and current eligible actors, and a bounded retention
  window. Disabled/unconfigured collection is unavailable, not a fabricated zero.
  Historical source coverage remains incomplete; no historical backfill is run.

## Verification approach and limits

- Preserve an immutable DB-only checkpoint before app changes. Verify actual
  pgTAP twice, independent-session races, a populated migration37-to-38 upgrade,
  official generated types and the committed schema drift gate in hosted CI.
  Structural tests supplement, never replace, actual PostgreSQL execution.
- Keep every prior database/browser gate and the 35-minute DB budget (last known
  verified baseline 29m40). Add exact reviewed gates without rewriting historical
  workflow step hashes. The new browser is registered in the stable aggregate and
  initially uses full fallback rather than an unproven narrow dependency rule.
- Local Docker/browser execution is unavailable under an already observed socket
  restriction; that denied action is not retried or escalated. Local lint, units,
  typecheck, build, selector and fixture checks are reported separately from
  actual hosted database/browser execution and screenshot inspection.
- The genuine predecessor schema file is 96,304 bytes, SHA-256
  `104d228fe2f07ac3b200c10b52340d9a9d18bfaee0f8bcdc7d771e4e2f03a7d9`.
  New schema output must come unchanged from the official hosted CLI artifact;
  it is never hand-edited or synthetically regenerated.

Exact immutable checkpoints, file manifests and results will be appended after
verification. No complete hosted or product-metric pass is claimed here.

## DB-only checkpoint

- Migration 38 adds the private immutable installation marker, a current-admin
  aggregate RPC, and new explicit prospective capture wrappers. All existing
  migration files and legacy analytics RPC definitions remain unchanged.
  Source rows before the marker are not replay-backfilled. Current approved
  document, source evidence, consent and actor checks remain authoritative.
- Added **119 executable pgTAP assertions**, **16 independent-session race
  scenarios** (including three new capture/withdrawal or disable interleavings),
  and a populated **37→38 upgrade**. The upgrade compares all fields of 26
  predecessor relations, including 17 historical observations covering all 13
  accepted schemas, four consent states, verified finance, three point entries
  and existing operation receipts. New coverage storage is checked separately.
- Complete local DB-only `npm run check:all` passed: lint/format, typecheck,
  **9,875 unit tests in 313 files**, contrast and production/PWA build.
  **204 CI selector/workflow/aggregate contracts** and **550 fixture/discovery
  guards** passed. The 51 new structural tests are not SQL execution.
- No local PostgreSQL, race, upgrade or browser execution was attempted. Hosted
  DB execution must still run every existing gate plus the new ones, produce the
  official generated-type artifact, and detect the expected predecessor-type
  drift. No complete hosted pass is claimed at this checkpoint.
- Font selection remains a specific collection gap: the existing persisted
  `font_selected_at` records the first selection, not the occurrence of the
  current value. The new prospective wrapper returns an explicit unavailable
  result rather than pairing a current font with an older time. The documented
  13-name accepted schema and legacy compatibility stay intact; tests of legacy
  font acceptance are not claims of complete prospective instrumentation.
- New capture does not widen the two-name generic browser allowlist, create
  automatic source triggers, approve a policy, grant real consent, or contact a
  provider. The application phase will adopt the new wrappers explicitly.

## Application phase

DB-only local checkpoint `020c2ab6f576a4d7c675eb438187ea45196f3e2a` was
published by the parent as remote
`6ad460aec2380e02ee06f49fe2e807db06900aab`, with identical tree
`c61ffd87b9f5019c862953c3c6114414fd57de54`. Draft PR 43 targets develop.
The application phase began only after that immutable local checkpoint existed;
publication, PR management and merge remain parent-controlled. Official generated
types and actual hosted results are still pending at this point.

### Hosted DB fixture correction

The first hosted DB run stopped during `analytics_capture.test.sql` after six
successful assertions, before the remainder of that file, the second pgTAP pass,
races, populated upgrade or generated types. The actual error was
`profiles_onboarding_time`: the rollback-only historical fan was backdated via
UPDATE, but the real immutable profile trigger correctly preserved `created_at`.

The correction constructs only that fictional profile with valid historical
INSERT timestamps before any dependent fixture rows. It does not disable a
trigger, weaken a constraint, change a production migration or alter the intended
old-source/no-backfill assertion. An executable chronology assertion and a
structural regression guard were added. Local focused contracts passed 52/52;
real PostgreSQL verification still requires the next hosted run.

### DB-fix verification and application checkpoint before generated types

- Local DB fixture correction `9d71f05c04f9fbc22414baf30dcd18001272ffb4`
  (tree `c45c34ba6883cb78ddee0df930eaf7a65e7eda96`) was parent-published
  as `687e35052490d6e16c9c489409cf3ecbefd7da3c` with the same tree.
- Exact DB-fix snapshot lint, typecheck, **9,876 tests / 313 files** and contrast
  passed. Its first build stopped with **ENOSPC**, not a source/test failure.
  Only the reproducible prior local `.next` output was removed. A private `/tmp`
  detached snapshot with dependencies copied inside its Turbopack root then
  passed the unchanged production/PWA build. Source, Git history and CI evidence
  were preserved; no Docker/browser restriction was retried.
- The new executable chronology assertion makes **120 new pgTAP assertions**.
  The first failed hosted run did execute the 67 dashboard and six isolation
  assertions successfully; the remainder of the capture suite, second pass,
  races, upgrade and official type generation still await the corrected run.
- Application implementation adds `/admin/analytics`, its private actor-bound
  GET endpoint, strict range/count/schema validation, 13 raw event bars, bounded
  13-row daily pages and four definition-pending placeholders. Policy unavailable,
  incomplete historical coverage and unsupported new font capture are explicit.
- Prospective hooks are attached only to committed source results. Preview is a
  visible committed render observation with a fresh-session own-actor assertion;
  prefetch/HTML/RSC alone cannot collect. Message observation uses the same
  authenticated read-request capability, not a second browser request that could
  switch cookies between actors. Optional errors preserve the business result.
- Complete application unit regression passed **10,300 tests / 330 files**.
  Repository lint/format and contrast passed; **218 selector/workflow/aggregate
  contracts** and **588 fixture/discovery guards** passed. The new browser has
  **19 isolated tests plus one keyless test** and plans 50 full/offscreen PNGs at
  360/1280 across all three text scales; actual browser execution remains pending.
- Fresh application typecheck currently fails only on the **four new RPC names**
  absent from genuine predecessor types. No cast workaround or hand-edited type
  file is used. This is not a complete application `check:all` or hosted pass;
  official generated bytes must be imported before final typecheck/build.
- A bounded lock-order concern was closed without edits: the effective role
  mutation implementation in migration 16 already locks actor/target in UUID
  order, matching the dashboard. The obsolete migration-1 definition is not the
  current behavior. No speculative lock rewrite was made.

### Genuine types and complete local application verification

- Corrected DB-only hosted run `40354321188`, exact remote head
  `687e35052490d6e16c9c489409cf3ecbefd7da3c`, executed **5,029 pgTAP
  assertions in 71 files twice**, **35 race scripts with 546 raw PASS lines /
  548 semantic scenarios**, and **11 populated upgrades**. The 16 new analytics
  race cases and populated 37→38 upgrade passed. The DB job took **31m02s** under
  the unchanged 35-minute cap. Its only source-related failure was the expected
  four-RPC generated-type drift; the dependent aggregate therefore failed too.
- That DB-only snapshot also passed all **809 existing browser tests**. This is
  predecessor-application evidence, not execution of the new dashboard UI suite.
- Imported `database.ts` directly from official artifact `12667487525` without
  editing, casting or regenerating it locally: **96,990 bytes**, SHA-256
  `77c17c12c14d75b88d224d3b7083868cf3e3af93486c6c05c2a23b4932dfa8f0`.
  Byte comparison matched the artifact exactly; the diff contains only the four
  expected public RPC definitions.
- App checkpoint `39d854f1a9bdee7f9d6a0f907e671bccdea25390` plus those exact
  generated bytes passed complete `npm run check:all`: lint/format, fresh
  typecheck, **10,300 tests / 330 files**, contrast and production/PWA build.
  Repeated **588 fixture/discovery guards** and **218 CI selector/workflow/
  aggregate contracts** also passed. The final evidence-only log update was
  format-checked separately after recording those results.
- Validation reused the existing detached `/tmp` checkout and its in-root
  dependencies; no second dependency copy, source removal or local Docker/browser
  retry was needed. The build ended with approximately 2.2 GB free in `/tmp` and
  764 MB free on the shared filesystem.
- Actual new-dashboard browser execution, all three text scales and screenshot
  review remain pending the application publication. Four approved business
  metric definitions and prospective font-selection coverage remain explicitly
  unavailable; silence does not supply those definitions or policy approval.

### User-mandated changed-work-only correction

Application publication was held while remote PR 43 remained at DB-fix head
`687e35052490d6e16c9c489409cf3ecbefd7da3c`. The user explicitly prohibited
cumulative development validation, including full fallbacks for SQL/shared/CI
changes. Full tests are permitted only once immediately before deployment under
an explicit designation; no predeployment execution is performed here.

- Updated `AGENTS.md` and the operative CI guide. Historical results above are
  retained accurately but are superseded as a validation policy.
- Replaced broad dependency/full-fallback selection with a versioned exact-path
  work manifest tied to the verified PR merge base. Unknown/malformed/stale scope,
  invalid history or oversized evidence fails selection instead of running all
  tests or silently passing. The stable required aggregate still rejects failed,
  canceled, missing or unexpectedly skipped selected jobs.
- Current reviewed inventory: **34 unit files**, **six fixture/CI-contract files**,
  **six analytics SQL files**, **two analytics race scripts**, **one populated
  37→38 upgrade**, and a planned **29 browser cases** (19 new analytics, one
  keyless and nine named direct-composition cases). Exact paths, named-case
  expressions, reasons and exclusions are in `ci/scopes/analytics-funnel.json`.
  Browser discovery and actual selected execution are reported separately.
- Existing payment/chat/reply/onboarding browsers are limited to named affected
  cases, not entire legacy suites or provider/font/refund/retry/Cron matrices.
  New capture SQL covers the relevant source contracts, so unrelated historical
  source-feature SQL and earlier upgrade chains are not selected.
- The workflow no longer triggers on pushes, merge queues or manual defaults.
  Quality invokes selected files only, not `check:all`; database execution uses
  only selected SQL (twice), races and upgrade. Full migration application still
  constructs the disposable schema and real type generation remains intact;
  neither setup nor compilation is represented as regression execution.
- A fail-closed argument-array runner bounds exact files/cases, including Vitest
  substring collisions and Playwright regex filename filters. Missing plans,
  unsafe/glob/option-like paths and selected command failures cannot fall back
  to an unfiltered command. Historical product tests and baseline evidence are
  preserved rather than deleted or weakened.
- No additional cumulative check, local Docker/browser attempt or remote write
  was made after the rule correction. Only edited planner/Git/aggregate contract
  tests (136), workflow contracts (49) and the runner's own focused contracts have
  run at this point; final selected counts and discovery remain to be recorded.

#### Scoped local results

The final explicit runner passed **1,039 unit tests in exactly 34 selected files**
and **370 fixture/CI-contract tests in exactly six selected files**. Changed-file
ESLint/Prettier passed; no `check:all`, full unit collection or historical browser
suite was invoked. No application/SQL logic changed in this policy correction,
so its earlier compile/artifact evidence is retained without an automatic full
revalidation.

Discovery through the runner's exact file/grep arguments returned **29 cases**:
19 analytics, one keyless, three enrollment, and one each renewal, reconciliation,
cancellation, chat, replies and repeated onboarding completion. All nine
`--list` commands exited 0 with no missing or extra titles; excluded legacy cases
were absent. This was listing only: no tests, browser, server or database ran.
The reviewed manifest SHA-256 is
`408dc32619c6160faa4248c8d0214497c7e62d250621626f63cd2ed7c437cf6b`.

Hosted selected SQL/races/upgrade/browser execution and actual new screenshot
review remain pending the corrected application publication. Four business
metric definitions and prospective font-selection coverage remain unavailable;
the testing-policy correction does not approve or fill either gap.

### First hosted scoped run and streamed-preview test correction

The scoped application was parent-published as
`a0332a5d410b3104ef99dc2a09bb562edce8ec33`, with tree
`3e72a9d9eb5d7bc869c07ccc19b14927b89de60b`, matching local
`a27126f514b8663eb82048e36979e3a1c1a30955`. Run `40370799050` executed
only the manifest: **1,039 units / 34 files**, **370 fixture/CI contracts / six
files**, **318 SQL assertions × 2 / six files**, **two analytics race scripts**
(10 existing races plus rollback visibility, and 16 new cases), **one populated
37→38 upgrade**, and **29 selected browser cases**. Eighteen unrelated jobs were
intentionally skipped. Official types, graph compilation and committed-type drift
checks passed; generated bytes stayed unchanged.

Browser results were **28/29**: 18/19 new analytics cases, the keyless case and all
nine direct-composition cases passed. The remaining case failed before cookie
replacement or any actor-binding assertion: it measured a merely attached
preview node while the visible page was still the streamed chat loading fallback.
The actual error-context and 360×100 failure screenshot confirm that state.

The narrow test correction waits for the actual preview heading and visible
layout, followed by fonts/two animation frames, **without scrolling**. It retains
the original offscreen assertion, unchanged pre-observation fingerprint, old-actor
request header, 403 denial and both actors' unchanged final fingerprints. No
production behavior, assertion outcome or test scope was weakened. The edited
file passed ESLint/format; exact-case discovery listed one test only. No local
browser or database was launched, and no cumulative suite was rerun.

Ordinary static review inspected all **50 successful original analytics PNGs**:
24 desktop (1280), 24 mobile (360), and two access-denial screens. Each width
covers normal/large/xlarge counts, daily/offscreen pages, pagination control,
disabled, empty, pending metrics and unconfigured states. Original pixels and
analysis-only detail crops/contact sheets showed no clipping, overlap, unreadable
controls, visibly unsettled content or footer truncation. Unavailable counts were
distinct from zero; denial screens contained no stale aggregate. The separate
failed-test screenshot was used only to diagnose the loading-fallback timing.
No image originals were altered and no independent media-security probe occurred.
