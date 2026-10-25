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
