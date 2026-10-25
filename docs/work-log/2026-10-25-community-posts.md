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

## Application implementation and pre-typegen verification

- Added authenticated board list/detail/create pages, owner delete confirmation,
  administrator notice/pin controls and fan/admin/catalog entry links. Private
  content is fetched through bounded no-store account-bound APIs, not RSC/history.
- Added real private-board storage scope to the existing Supabase SDK adapter with
  unchanged message defaults, existing byte verification/sanitization, immutable
  publish recovery, current-authority rechecks and capped signed reads. Public DTOs
  carry image metadata, never storage object IDs or paths. No live asset was used.
- Added exact unknown-outcome mutation recovery and staged upload completion/revoke
  recovery, with lifecycle invalidation and no automatic duplicate PUT/create.
  Current read denial removes the parent detail and active image source.
- Connected only the existing consent-aware `post_create` analytics RPC after a
  verified create receipt. Observation failure cannot undo successful creation;
  source/actor/operation identity provides existing DB deduplication on replay.
- Added 25 isolated board browser scenarios and seven keyless scenarios, including
  actual synthetic-image adapter flows, three fonts at 360/1280, settled fullpage
  and offscreen controls, current-account denial, policy removal, conflicts,
  navigation/cancel and exact lost-response recovery. Discovery is not execution.
- The board browser is in the CI selector/aggregate inventory and inherits shared
  media, navigation and admin-policy dependencies. New board paths remain unknown
  and force full CI. Historical step hashes are unchanged.
- Pre-typegen local verification passed all 8,262 unit tests in 275 files, all 176
  CI contract tests, all 415 fixture checks, full ESLint/Prettier and contrast.
  `check:all` reached TypeScript and stopped only at ten new RPC names absent from
  the prior genuine generated schema. No generated database type was handwritten.
- Whole-suite testing corrected an existing async fan-home entry mock and a
  millisecond-sensitive expiry unit fixture (clock now fixed for boundary tests).
  Runtime DB/browser and final build/typecheck remain pending hosted type output.

## Explicit composer cancellation recovery

A bounded review found that leaving a successfully uploaded draft through its
Cancel link abandoned reservations, potentially occupying the configured image
capacity until the transport expiry. Explicit Cancel and Back-to-board now stop
file transport, recover an uncertain begin with its same request ID, and revoke
all staged reservations before replacing the composer route. Unknown revocation
retains a frozen cleanup intent and explicit retry; it never claims capacity was
released before the DB confirms it. An unknown create result disables this cleanup
because its images might already belong to a committed post. Hardware Back remains
bounded abandonment rather than a fabricated cleanup acknowledgement.

One additional isolated browser scenario fills the configured three-image capacity,
cancels, verifies actual reservation states and unchanged post count, then proves
another composer can upload. Existing six-way Cancel/Back/Forward scenarios retain
their font/viewport captures and now check the cleaned route replacement.

The cancellation repair passed a fresh whole-suite run: 8,267 unit tests in 275
files, full ESLint/Prettier, all 591 CI/fixture checks (176 + 415), and whitespace
checks. The generated schema remains the untouched prior official artifact until
new hosted generation is available.

## Genuine generated schema and corrected hosted DB gate

Corrected checkpoint run 40228777929 on remote head
`803c742d1878ce7074d080827dfcd4ba73ec3c7a` passed DB lint, 4,367 pgTAP assertions
on each of two consecutive passes across 55 SQL files (+137 assertions per pass),
all 435 race scenarios (433 raw PASS lines plus two retained legacy double-cases;
25 new board scenarios), and all six populated upgrades. Generated-schema
TypeScript also passed; the sole remaining DB-job failure was the expected diff
against the old committed type file. The checkpoint's 690 existing browser tests
passed, but it did not contain the new board application UI.

Official artifact 12613115666 was matched to that exact head and its ZIP size,
SHA-256 and CRC verified by the CI monitor. Its 92,579-byte `database.ts` was copied
byte-for-byte into `src/types/database.ts`; SHA-256:
`e8da87168234e9c90091dfbba88c639b0ab894a8c7195fef561575fa72c34f53`.
No generated schema was handwritten. Final application checks and hosted board
runtime/pixel verification remain separate gates.

## Final local application checkpoint

With the genuine generated schema installed byte-identically, a fresh
`npm run check:all` passed: full ESLint/Prettier, Next/TypeScript, all 8,267 unit
tests in 275 files, contrast, and optimized Next/PWA builds. The final repeat of
all 591 CI/fixture checks passed with no skips. The 25 isolated board browser and
seven keyless additions still require actual hosted execution and pixel review;
local discovery/build success does not substitute for those gates. No local
browser, Docker/socket, or denied independent media-security runtime was retried.
