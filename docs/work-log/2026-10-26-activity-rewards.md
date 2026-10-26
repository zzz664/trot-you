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

## Application checkpoint awaiting official schema output

DB-only local commit `cd0c34fca6a539cce9dd9e73b8f6f0f89bc2ffbb` was published as
remote `2d0c378324b8d633bc60f891452cb1e6bf52df2e`, with identical tree
`968d2537b3a5905d4433a477ac93515ca22ead9b`. Draft PR 42 targets develop;
publication/merge remain parent-controlled. Hosted DB run `40329167805` is still
pending at this application checkpoint.

- Added `/points/activity`, its private GET API, strict contribution/outcome
  schemas, actor-bound service/database/client layers, identity-only RSC shell
  and a stable entry on the existing attendance screen. The UI has no reward
  claim or completion controls. Legacy outcome evidence is never inferred from
  its amount, and current cap availability is not a future award promise.
- Reads purge prior visible data before a fresh authority check. Navigation,
  actor replacement, hidden-document/pagehide and stale responses cannot restore
  private history. Immutable paginated rows reappear only after the next bounded,
  actor-bound read succeeds.
- Complete local unit regression passed: **9,820 tests in 311 files**. Repository
  lint/format and contrast passed. **204 CI selector/workflow/aggregate tests**
  and **546 fixture/discovery checks** passed. An initial formatting-only failure
  in a new client test was corrected before the successful repeat.
- Typecheck reports exactly the one new RPC absent from the unchanged genuine
  predecessor schema: `point_ui_activity` in the database adapter. No manual
  schema edit or type bypass is used. Full application `check:all` and build await
  the official hosted schema artifact; they are not claimed as passed yet.
- The new isolated browser suite contains **15 real local Auth/RPC scenarios**
  (including all six font/viewport combinations), plus **one keyless case** in
  the default suite. It plans **44 screenshots**: 42 matrix/full-history/offscreen
  captures and two authority-state captures. Actual browser execution and pixel
  inspection remain hosted final-head gates, not local results.
- The 25th isolated browser is included in the stable aggregate. Attendance
  dependencies include the new activity browser; the shared route-invalidation
  helper explicitly retains full fallback. Every historical setup/test/artifact/
  cleanup step remains protected by fixed legacy step hashes.

## Official database execution and generated schema

Hosted checkpoint run `40329167805` completed both real pgTAP executions:
**4,909 assertions in 67 files per pass**. Its 34 independent-session scripts
produced **530 raw PASS lines**, plus the two unchanged legacy combined cases,
for **532 semantic concurrency scenarios**; all **ten populated upgrades**
passed. New activity coverage contributes the 130 assertions, 18 races and one
upgrade described above. The DB log spans 13:16:50.767–13:46:31.002 UTC,
**29m40.235s**, within the explicitly increased 35-minute budget.

The genuine `database-types` artifact `12656195579` contains **96,304 bytes** at
SHA-256 `104d228fe2f07ac3b200c10b52340d9a9d18bfaee0f8bcdc7d771e4e2f03a7d9`.
Its ZIP is 9,427 bytes, SHA-256
`2eef6982ed0f0d300373eb15bc7ab02f5bba7e62282942576add29a05a4bc35d`; CRC was
verified before extraction. Local byte comparison confirms an unchanged import.
The complete generated-type diff is exactly the eight-line `point_ui_activity`
RPC definition; no private-table type placeholder or manual edit was made.

The DB job passed generated-schema typecheck and failed only the expected
committed-type drift gate. The checkpoint run is **not green**: its existing
attendance browser job failed before tests because Mailpit could not bind local
port 54324, and the required aggregate failed accordingly. This is neither an
attendance application assertion failure nor a waived gate. The final app head
must run the complete required suite, including attendance and the new activity
browser, before merge. No local browser or PostgreSQL execution is claimed.

After the genuine schema import, the complete application `npm run check:all`
passed: repository lint/format, typecheck, **9,820 unit tests in 311 files**,
contrast and production/PWA build. Final **204 CI contracts** and **546 fixture/
discovery checks** also passed. The generated file remains byte-identical to the
verified artifact. Hosted final-head browsers and actual pixel review remain
pending; these local successes do not replace those gates or approve policy.
