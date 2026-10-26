# 2026-10-26 — Activity reward visibility (feature 38)

## Scope and approval boundaries

- Started one `feature/activity-rewards` branch from verified develop
  `a3e3de9f1657a38dd5a0672299ae5fed2aefb455`, tree
  `3c1a3116e397e6adce78422565782a86f48eec2e`. A complete pre-change Git bundle
  was verified before fetching. The finished local attendance branch was archived;
  local develop was fast-forwarded without reset. Main remains unchanged.
- Preserve the existing immutable point ledger and atomic post/comment award
  trigger, including configured KST caps and deterministic source deduplication.
  Add truthful private visibility of contribution awards and new outcome metadata.
- Historical proposal amounts and grade thresholds are **not approved defaults**.
  There is no policy seed, activation, retroactive award, account role change,
  provider invocation, deployment or scheduler. All test data is fictional.
- Share verification, mission definitions and the activity-grade score definition
  remain unapproved. Their typed boundaries explicitly report unavailable; this
  is not an implemented share verifier, mission engine or grade calculation.
  No click is treated as a verified share. User policy decisions remain pending.
- Outstanding decisions include per-action amounts and daily caps (including an
  explicit unlimited choice), deletion/moderation treatment, share evidence and
  replay scope, mission eligibility/completion windows, and grade inputs,
  aggregation window, weights and thresholds. Existing approved-policy snapshots
  support retained historical content awards only; no automatic reversal is added.

## Verification and limits

- Preserve a DB-only immutable checkpoint before application changes. New real
  pgTAP, independent-session races and a populated migration-36-to-37 upgrade
  verify old ledger/policy/attendance-operation bytes separately from new storage.
- Keep both historical pgTAP passes, every race and upgrade, official generated
  schema types, typecheck, and the committed-type drift gate. Do not hand-edit
  `src/types/database.ts` or substitute synthetic schema output.
- The preceding verified DB run reached 28m05 against 30 minutes. The database
  timeout is increased to **35 minutes** for the additional race suite and tenth
  populated upgrade; no test is dropped or weakened. Legacy step hashes remain
  fixed and exact reviewed additions are tested.
- Local Docker/browser execution is unavailable; the prior socket restriction is
  not retried or escalated. Actual database/browser execution and screenshot
  review require isolated hosted CI. Local static/unit/build results will be
  reported separately from hosted results.

Exact checkpoint hashes, file manifests and results will be appended as verified.

## DB-first checkpoint

- Migration 37 preserves every predecessor ledger field and appends precise
  contribution outcomes in a separate immutable table within the existing
  creation/reward transaction. A failed outcome insertion rolls back content,
  ledger, source counters and operation receipts together.
- The read-only activity RPC exposes actor-private paginated post/comment history,
  current configured amounts/caps, all recorded daily creations and positive
  award counts separately. Old outcome evidence remains explicitly unknown;
  source text/IDs and correction notes are not disclosed.
- Added **130 pgTAP assertions** (128 functional and one for each unsupported
  isolation), **18 independent-session race scenarios**, and a populated 36→37
  upgrade preserving **14 complete old ledger rows** plus the already-existing
  attendance operation. New side-table storage is tested separately and begins
  empty. These executable database tests have not run locally.
- Complete DB-only `npm run check:all` passed: lint/format, typecheck,
  **9,579 unit tests in 303 files**, contrast and production/PWA build. The
  **196 CI selector/workflow/aggregate contracts** and **513 fixture/discovery
  guards** also passed. The 54 new structural contracts supplement, not replace,
  real PostgreSQL execution.
- Genuine predecessor `src/types/database.ts` remains unchanged at 96,118 bytes,
  SHA-256 `1a8e95f84df293c5cfb8dcd029eff1de995f51d8a091409c05a1b599cff78a82`.
  Hosted DB bootstrap must generate the new RPC type, upload its official artifact
  and intentionally detect committed-schema drift before an unchanged import.
  No complete hosted pass is claimed at this checkpoint.
