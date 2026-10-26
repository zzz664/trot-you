# 2026-10-26 — Consent-bound analytics visibility (feature 39)

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
