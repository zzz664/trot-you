# Community interactions — 2026-10-25

## Scope and decisions

Feature 35 connects comments and likes on available fan board posts: current-account
read/pagination, comment creation/editing/confirmed soft deletion, and desired-state
likes. Private specifications used: database community section, board API contract,
frontend board requirements, and the reconciled sequential feature plan. Private
source documents are not published. Reports/moderation screens, new reward rules,
policy activation and production operations remain outside this feature.

The original feature branch was preserved in a complete verified bundle and local
archive. After fetching, develop was safely fast-forwarded to verified
`c036bcd1d35278f78175b74646aef7485ec3ac1d` with tree
`d48a30e7d4d47f6b4f332fb497f1159488e37a19`; the only active feature branch is
`feature/community-interactions`. No destructive reset or direct develop/main push
was performed.

## DB-first checkpoint

- Migration 34 adds an additive comment revision invalidated by all existing edit,
  report and visibility paths. Five authenticated-only JSON RPCs use fresh current
  identity/artist/parent/policy locks, owner CAS, bounded visible comment pages and
  actual atomic counters. No policy or application content is seeded.
- Existing immutable board receipts bind exact actor/operation requests. Replays
  recheck current authority and return minimal historical receipts without
  reapplying a prior like over a newer unlike. Existing contribution rate, text
  validation, audit and explicitly configured reward triggers are preserved.
- Added 187 functional pgTAP assertions plus five per unsupported isolation level,
  44 real independent-session observed-lock race cases, and a seventh populated
  upgrade preserving prior comments/likes, post revisions/images, board receipts,
  reservations, rewards, settings/audits and unrelated notifications.
- Bounded review caught the earlier pre-board upgrade's all-comment-fields snapshot
  becoming incompatible with additive comment revisions. It now excludes only that
  new field and independently asserts the default; all existing post/image and
  data-equality checks remain. Other populated upgrades do not snapshot comments.
- New race/upgrade gates run before official type generation. Historical CI step
  hashes are unchanged; exact added blocks and mutation-negative tests remain
  required. The complete DB job retains its 30-minute budget and every prior gate.
- Local `check:all` passed lint/format, typecheck, 8,316 tests in 277 files,
  contrast, and optimized Next/PWA builds. Both final affected harness contract
  files and all 176 CI selector/aggregate/workflow checks pass; exact final counts
  are retained in subsequent verification notes if the suite changes.
- Actual PostgreSQL/pgTAP/races/upgrade execution and official type generation await
  hosted CI. The prior genuine 92,579-byte generated type file remains byte-for-byte
  unchanged (SHA-256 `e8da87168234e9c90091dfbba88c639b0ab894a8c7195fef561575fa72c34f53`).
- Local Docker/browser/socket restrictions and the prior independent media-security
  runtime denial were not retried, probed, escalated or bypassed. No real posts,
  comments or likes, private assets, external provider traffic, role changes,
  operating-policy approval, deployment or Cron activation was performed.

Application implementation and real hosted browser/pixel validation are separate
remaining gates, not implied by this DB-first checkpoint.

## Application implementation before generated-schema arrival

- Added strict minimal DTOs, microsecond-safe pagination, no-store bounded client
  transport, current-session/origin/route/body-bound API handlers, service logic,
  and the typed authenticated database adapter. Existing board DTOs stay stable.
- The post detail now provides current counts/liked state, comments with literal
  text, owner revisioned editing/confirmed deletion, and first/next pages. Each
  rendered interaction snapshot is bound to the exact verified parent snapshot;
  stale comments do not reappear during the parent-to-child refresh gap.
- Unknown outcomes retain their frozen original intent, with explicit exact retry
  and account binding across parent refresh. Current access loss removes parent
  body/images. Confirmed interaction writes refresh the parent CAS revision too.
  Cancel, focus, navigation and history dismiss transient editors/dialogs.
- Added 213 backend/client/API unit cases, 45 UI cases, and four additional lint
  boundary cases. Existing isolated board UI tests mock only the new child; new
  interaction tests also exercise the real parent/child integration.
- The initial whole-suite run caught two tests inspecting content before the
  intentionally gated refresh completed. Assertions now await the verified new
  snapshot without weakening suppression checks. A fresh complete run passes all
  8,578 tests in 283 files; contrast checks pass.
- Full ESLint/Prettier passed. `check:all` reaches TypeScript and stops only because
  the five new RPC names are absent from the untouched prior genuine schema; no
  generated schema was handwritten. A full final `check:all` remains required
  after official CI generation is imported.
- All 182 selector/aggregate/workflow checks and all 447 fixture guards/discovery
  checks pass. New interaction paths remain full fallback; the isolated browser is
  included in shared navigation/media/admin-policy groups and the stable aggregate.
  Historical setup/test/artifact/cleanup step hashes remain unchanged.
- Added 27 isolated and one keyless browser scenario. Discovery is verified;
  actual hosted execution and pixel review are still pending. Planned new visual
  evidence is 67 PNGs: 48 full-page and 19 offscreen-control captures, with every
  text scale at 360/1280 widths. Existing board detail captures also wait for the
  new verified interaction view and retain their old feature coverage.

## Genuine hosted database verification and schema import

Checkpoint CI run `40240893992`, exact remote head
`9a9c8bab1f95b536854cebc3b8d3f3e2d2cd2481` / tree
`1df6abdc11e5c9bb1afe84d85c9dbb8fac920990`, passed DB lint, 4,564 pgTAP
assertions in 58 files on each of two consecutive passes, all 31 race scripts
(477 raw PASS lines / 479 scenarios including two retained legacy double cases),
all seven populated upgrades, and generated-schema typecheck. The 44 new
interaction races passed. Database execution took approximately 25m16s within the
unchanged 30-minute budget. Its sole DB failure was expected committed-type drift.
An unrelated reconciliation job failed before testing because local port 54322
was occupied; the final application full run must supersede that checkpoint run.

Official pinned-CLI artifact `12617591087` was matched to that exact head/run and
its ZIP size, SHA-256 and CRC verified. Its 93,967-byte `database.ts` was copied
byte-for-byte and independently compared with the artifact; SHA-256:
`3228ca8b15ccb611019d6c538b3a52f789ed7e7f517403a916b4572e9b0d0159`.
No generated schema was handwritten or inferred from SQL.

With the official generated schema imported, the final local `npm run check:all`
passed full ESLint/Prettier, Next/TypeScript, all 8,578 unit tests in 283 files,
contrast and optimized Next/PWA builds. A final repeat of all 182 CI contracts and
447 fixture/discovery guards also passed with no skips. Hosted execution of the
new application browser scenarios and final pixel review remain separate pending
gates; no local browser or database restriction was retried.

## 2026-10-26: parent receipt recovery interoperability correction

The application run `40286332434` at exact published head
`30015f03a92325562099a7dd321fbabab5ee9871` passed all 27 new interaction browser
scenarios. All 67 new screenshots were inspected with no concrete visual defect,
but that preliminary review does not establish final-head readiness.

The existing board suite exposed a genuine interoperability regression: 19 tests
passed and all six font/viewport owner-delete recovery cases timed out waiting for
the original exact-retry button. A committed post deletion with a lost response
caused the new interaction read to discover its tombstone; its parent-invalidation
callback incorrectly erased the already-authorized immutable recovery intent.
The official failure snapshots and a failing ordinary parent/child integration
unit reproduced the same missing recovery panel.

The narrow correction removes unavailable post/comment/image content but retains
an existing parent delete/notice receipt-recovery intent on target/policy denial.
Current-account denial still erases that intent. Late abandoned responses cannot
recreate erased recovery, and a keyed parent session discards old operation refs
when its mounted account, post or route changes. Four actor/target replacement
regressions also failed before the session-ownership correction. There is no
automatic resend and no change to interaction intent denial rules, SQL, providers
or generated types.

Ten regression cases were added to the real parent/child unit integration. The
focused 88-test UI suite, scoped lint/format, typecheck and whitespace checks pass.
Full local checks and a corrected exact-head hosted run remain required; no test
assertion, screenshot capture or CI gate was weakened to hide the failure.

The corrected tree passed a fresh complete `check:all`: full lint/format,
Next/TypeScript, 8,588 tests in 283 files, contrast and optimized Next/PWA builds.
All 182 CI contracts and 447 fixture/discovery checks passed again with no skips.
Generated types remain byte-identical to the verified 93,967-byte official artifact.
Corrected hosted browser execution and final-head pixel review remain pending.
