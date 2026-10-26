# 2026-10-26 — Attendance and private points (feature 37)

## Scope and boundaries

- One `feature/attendance-points` branch from verified develop `0d10ddf2b82b0fc7b1c1f20c3906e5a0751cf256`, tree `bc5e54e078341fe147d56f372ddc802d484b69fc`. The completed local moderation branch was archived after a full pre-change bundle; local develop was fast-forwarded without reset. Remote publication and merge remain parent-controlled.
- Expose one-per-KST-day attendance, the user's private ledger balance, and bounded history. Reuse existing immutable ledger, approved point policy and attendance writer. No post/comment reward redesign, share missions, activity grades, monetary redemption or policy activation is included.
- Missing approved policy disables new attendance rather than introducing active reward defaults. Existing entries remain private and readable.
- Actor-bound immutable operation receipts preserve an uncertain attendance result across retries, including a change of KST day. Multiple operations on the same day still reference one ledger entry.

## Verification plan and limits

- Preserve an immutable DB-first checkpoint before application changes. Add actual pgTAP, independent-session lock races and a populated previous-schema upgrade test before the official schema-type generator. Never hand-edit generated `src/types/database.ts`.
- Keep every historical CI setup/test/artifact/cleanup gate. New fixture/browser jobs will be registered in the impact inventory and required aggregate; migration and shared-layer changes retain full fallback.
- The previous hosted database stage was approximately 26m34 against the existing 30-minute limit. Additional gates make runtime headroom a known risk; no test is removed or timeout silently changed.
- Local Docker/browser execution is unavailable and its socket restriction is not retried or escalated. Actual SQL/races/upgrades/browser pixels require isolated hosted CI; local static/unit/build checks are reported separately.
- No real user points or policy settings are changed. No provider, deployment, role grant or recurring scheduler is activated. Private original specifications are not copied into the repository.

Exact checkpoint hashes, local results and hosted results will be recorded as they become available.

## DB-first implementation

- Migration 36 adds only the private immutable actor/operation-to-ledger receipt
  table and two actor-bound UI RPCs. Existing point policies, raw attendance,
  ledger immutability and contribution triggers are unchanged.
- New executable verification includes 89 pgTAP assertions (85 functional and
  two for each unsupported isolation level), 17 actual independent-session lock
  races, and a populated migration-35-to-36 upgrade. The upgrade compares all
  predecessor fields, including moderation reply fields, 12 legacy ledger rows,
  policy snapshots/adjustment notes, moderation notices and the outbox; new
  receipt storage is checked separately and starts empty.
- The 55 focused upgrade/race contract tests, script syntax, targeted ESLint,
  189 CI selector/workflow/aggregate contracts and 480 fixture/discovery checks
  passed locally. These are not a substitute for PostgreSQL execution.
- Full DB-only `npm run check:all` passed: repository lint/format, typecheck,
  9,152 unit tests in 293 files, contrast, and production/PWA build. Generated
  schema remains the unchanged genuine predecessor artifact until hosted CI
  generates the two new RPC names. Actual pgTAP/races/upgrades remain pending CI.

## Application checkpoint before official schema artifact

- Implemented strict private snapshot/receipt schemas, actor-bound client and
  HTTP/service/database boundaries, explicit attendance, private balance/history,
  a fan-home entry, and optional consent-gated analytics keyed by ledger entry.
- Unknown write recovery survives transient snapshot loss and subsequent setup
  or other non-authority retry errors. Recovery retains the same operation until
  a bound receipt or definitive account/authority reset establishes the outcome.
  Known receipts display their actual earned date, including prior-day recovery.
- Complete local unit regression passed: **9,517 tests in 302 files**. Repository
  lint/format, **196 CI selector/workflow/aggregate contracts**, and **513 fixture/
  discovery checks** passed. The final focused recovery regression adds four
  cases beyond the first 9,513-test run.
- Typecheck currently reports exactly the two new RPC names missing from the
  unchanged predecessor-generated `database.ts`; its SHA-256 remains
  `0c3fc6f3b6bada63e9c6ecbc571e11be364f6e31f0ae66f632635d92e4358bf8`.
  No type placeholder/cast or manually generated schema edit is introduced.
  Full application `check:all`/build await the official hosted artifact.
- Isolated browser coverage contains 20 real local Auth/RPC scenarios and one
  keyless scenario, with 75 planned screenshots at 360/1280 and all three font
  sizes. It covers policy missing/zero, replay, prior-day receipt, private tied
  timestamp pagination, uncertain outcomes, account/auth changes, RSC/cache
  privacy and consent analytics. These scenarios/screenshots have not run locally;
  hosted execution and pixel review remain mandatory.

## Official schema generation

DB checkpoint local `ade75395323f68ee5e285d6ff5422d6e18ad24be` was published
as remote `51fc3a30c3fe467c2f192eaa0bdb093ff658cb9f` with the identical tree
`45f518c55717178e98121f28c50ab3909675fca0`. Hosted run `40314437903` passed
all functional database gates, including the new attendance races/populated
upgrade and generated-schema typecheck. The expected committed-schema drift gate
failed before import; this bootstrap is not represented as a fully green run.

Official artifact `12647935444` supplies the genuine `database.ts`: **96,118 bytes**,
SHA-256 `1a8e95f84df293c5cfb8dcd029eff1de995f51d8a091409c05a1b599cff78a82`.
Its verified ZIP is 9,420 bytes with SHA-256
`964d36e22a89ee4d1939eb2f5c2b898b4c49009a6e8fddec366889a0a8f99409` and valid
CRC. The type file was imported unchanged; its diff contains exactly the two new
JSON-returning attendance RPC definitions.

The actual hosted DB logs record **4,779 pgTAP assertions in 64 files on each of
two passes**, **514 semantic concurrency scenarios across 33 scripts** (512 raw
PASS lines plus the two unchanged legacy combined cases), and **nine populated
upgrades**. Attendance contributes 17 races. The DB stage spans
11:21:33.841–11:47:28.077 UTC, **25m54.236s**; the existing 30-minute timeout
remains intact with no regression gate removed.

After importing the genuine schema, the complete application `npm run check:all`
passed: repository lint/format, typecheck, **9,517 units in 302 files**, contrast,
and production/PWA build. The final 196 CI contracts and 513 fixture/discovery
checks also passed. The new attendance browser, all existing browsers, and final
pixel review remain hosted final-head gates; no local browser success is claimed.
