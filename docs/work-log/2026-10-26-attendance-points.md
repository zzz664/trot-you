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
