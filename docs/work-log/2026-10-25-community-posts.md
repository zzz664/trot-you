# Community posts — 2026-10-25

## Scope and decisions

Feature 34 connects free authenticated fan board listing/detail, post creation,
verified private images, owner soft deletion and administrator-only pinned notices.
Supplied private specification sections: database 3.6, API 3.6/3.8, frontend B-01/B-02,
and the reconciled sequential implementation plan. Source documents are not published.
Comments, likes, moderation and reward screens remain subsequent distinct features;
existing database interactions and approved reward triggers are preserved.

Community policy must already be explicitly configured. This feature neither seeds
nor approves operating values. Readiness errors are honest and fail closed. Upload
reservations are private, image bytes are verified and sanitized by the existing
storage verifier, and all completed reservations attach atomically when publishing
the post. Incomplete uploads cannot create a partially published post. Actor-wide
outstanding reservation capacity derives from the configured image limit to bound
one active composer without inventing an additional operating quota. Two-hour
reservation expiry and sixty-second maximum signed-read lifetime are transport
bounds, not a replacement for operating policy.

Fresh actor, restriction, onboarding and artist checks occur under transaction
locks. Hidden/deleted posts are excluded even for their author in the public board.
Pinned cursor order is deterministic. Exact immutable operation receipts support
explicit retries of uncertain creates/deletes/notice changes without duplicate
posts or audits. Revision checks detect legacy/operator mutations. Existing policy,
rate, point, interaction and moderation contracts are not replaced.

## DB-first immutable checkpoint

- Added migration 33; pgTAP lifecycle/media/current-authorization assertions and
  repeatable-read/serializable rejection cases; 25 real independent-session race
  scenarios; a populated pre-migration upgrade with old posts, private images,
  interactions, rewards, audits, settings, profiles and unrelated notification data.
- Upgrade compares all prior bytes except only the new `posts.revision` and
  `post_images.position`, then independently verifies those additive defaults.
- Both new DB gates run before official type generation. Historical CI step hashes
  remain unchanged; the exact additional blocks are separately checked, including
  mutation-negative tests for missing/moved/weakened gates. The DB timeout remains
  30 minutes and all existing checks remain required.
- Local checks: 29 upgrade-contract unit tests, Node syntax/ESLint/Prettier for both
  new scripts, all 168 CI selector/aggregate/workflow checks, and diff whitespace
  passed. SQL formatting is not passed through an unsupported Prettier parser.
- Actual PostgreSQL, pgTAP, concurrency, populated-upgrade execution and official
  type generation await hosted CI. Local Docker/browser restrictions and the prior
  independent media-security-runtime restriction were not retried or bypassed.
- Application work remains outside this initial checkpoint. Full `check:all`,
  application/browser tests and three-font 360/1280 pixel review are still pending.
  No real posts/private user assets/provider traffic/settings approval/role change,
  deployment or Cron activation was performed.
