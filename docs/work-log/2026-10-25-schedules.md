# 2026-10-25 — 공식 일정 (feature31)

## Scope and boundaries

Implements private-spec feature31: fan KST month/list/detail schedules, browser-state my-artists filter, public-coordinate map links, and administrative schedule CRUD. Existing event/catalog/audit semantics are retained. Schedule notices, opt-out UI, content-calendar UI, scheduler activation, live providers, deployments, roles and commercial policy changes are not part of this feature.

“My artists” means artists with current subscription access under the existing access function, including eligible grace and paid-through cancellation. The onboarding interest pick alone is not a paid subscription. This definition is explicitly shown in UI; it does not change billing access policy.

## Database-first checkpoint

- Add monotonically advancing schedule revisions; older authorized mutation RPCs remain compatible and invalidate open UI revisions.
- Add current-actor administrative safe projections, bounded month pages, own current-access artist identifiers, optimistic revision mutation, and immutable actor-scoped idempotent operation receipts.
- Existing safe public catalog remains author-free. No credentials, profile contact fields or stored map URLs enter the event projection.
- Add pgTAP authorization/validation/audit/replay coverage, independent-session concurrency races, and a populated version29→30 upgrade preservation check.
- Official CLI-generated schema types must come from the actual CI database artifact, unchanged byte-for-byte. They are not hand-written.

## Verification and limits

Database syntax/fixture/static checks are recorded at each immutable checkpoint. Actual PostgreSQL/pgTAP, race and upgrade execution requires the CI-managed disposable local Supabase instance; Docker is unavailable in the editing executor. The already-established local browser socket restriction is not retried or escalated. CI browser evidence and all three font scales at360/1280 remain required before completion.

No real account, recipient, payment, private location, provider request, policy approval, deployment or scheduler is exercised. Test source rows are fictional local fixtures. Private source documents are not copied into this repository.

## Application integration and review

- Added server-only validation/services/database adapters and bounded same-origin JSON transport. No missing configuration is converted into fake data/success.
- Added accessible fan month/list/detail views, cursor continuation and explicit partial-calendar notice, current-access filter, and public-coordinate map links. Added admin month paging, create/edit/delete, optimistic conflict preservation, and exact-payload retry after uncertain writes.
- Interruption review found that a child editor's operation ref would be lost on tab revalidation. Pending operations now live in the mounted screen, survive same-actor interruptions, and clear on authority loss. All screen requests bind the original mount actor to fresh authentication via a same-origin header; a different signed-in administrator cannot replay an old actor's pending create as a new operation. The header never grants authority.
- Historical calendar review found fixed+09 arithmetic disagreed with the inherited `Asia/Seoul` SQL contract. Replaced it with IANA conversion; shared fixtures cover local mean time, the1908 midnight gap,1988 DST gaps/folds, modern/leap dates and extreme serialization boundaries in both JS and actual pgTAP. No arbitrary business-era cutoff was added. Nonexistent form times reject; ambiguous times choose the later instant consistently with PostgreSQL.
- The first real DB checkpoint CI failed on a fictional completed-profile fixture without its required calling name. Corrected all new pgTAP/race/upgrade identity fixtures, preserving production constraints. Browser fixture subscription creation timestamps were also placed before the first/current periods. The initial failed run did not reach schema generation and is not reported as a DB pass.
- The shared admin introduction's old prototype wording was left unchanged; schedule entry copy is feature-specific.

Further exact-head check results, generated schema hash and actual browser/pixel evidence are recorded after CI, not inferred from the local source review.

## Verified application checkpoint

- Imported the official `database-types` artifact12594082199 from CI run40179057847, exact remote head3c2c7ad6fb347bb6d976ede8984d6ef87e93e4e5. The88,154-byte file is byte-identical (SHA256 `28c47de1bec69e70ba3d130da79a49a8b56b43406dda2f95aa47a47d7339f9ee`). No generated declaration was handwritten.
- That DB-first checkpoint passed3890 pgTAP assertions twice,361 race/rollback scenarios and3 populated upgrades. Its new schedule portion was95 pgTAP,14 races and1 upgrade. All18 other jobs passed; only the intentional committed-generated-schema drift gate failed. This does **not** claim coverage of the later timezone/microsecond assertions.
- Full local `npm run check:all` passed: lint/Prettier, actual generated-schema typecheck,7027 unit tests,10 contrast pairs, optimized Next build and PWA generation. All321 local fixture guard tests passed separately.
- New browser coverage is22 isolated schedules tests plus7 keyless tests, including both3-font×360/1280 matrices, offscreen target captures, actual settled URLs/headings, repeat/interrupted operations, authority changes and account-switch retry protection. These tests await the next exact-head CI run; no local browser/socket retry was attempted.
- Precise overlap comparison retains PostgreSQL microseconds rather than collapsing sub-millisecond events; API/SQL reject more than6 fractional digits instead of silently rounding them. Original timestamp strings remain unchanged for cursor and non-time edits.

## First application CI findings and correction

- Run40180763743 at remote head`a18e618b89246d56970f5eeb6c0391e9cd5ad41b` passed the quality job (7027 units,321 fixture guards,73 keyless/general browser cases). All36 new keyless schedule PNGs were inspected at normal/large/xlarge and360/1280; setup errors and recovery controls were legible without clipping or overlap.
- The isolated schedules suite passed14/22. Its eight failures exposed three test-harness mistakes: an unconfirmed **draft** was incorrectly expected to fail (only publishing requires confirmation); six CRUD matrices required visibility of an intentionally empty zero-height list rather than the visible empty-state message; a restarted Playwright worker reused fixture months, making previous fictional artists collide. The corrections preserve server contracts, assert the real empty state and zero rows, and reserve disjoint worker fixture months. The initial interrupted CRUD matrices are not claimed as complete visual verification.
- Additional read-only application review found and fixed valid percent-encoded route spellings suppressing reads, a page-two selected artist label disappearing during an uncertain-create refresh, and ambiguous same-name artist options. Route matching now normalizes equivalent path segments/query encodings while rejecting duplicate queries, malformed path escapes and encoded separators. Pending selection display stays actor-bound with the exact operation and clears on authority loss. Artist labels visibly include their unique slug.
- Three additional isolated browser regressions cover encoded month/UUID routes, same-name artist selection, and retained page-two selection through accepted-but-lost-response recovery. The dedicated suite now discovers25 cases, with7 keyless cases in the quality suite. Runtime and final pixel results for these corrections require a new exact-head CI run.
- The old application head subsequently finished all20 jobs:19 passed, with only the isolated schedules browser job failing as described above. Actual PostgreSQL passed3983 pgTAP assertions twice across48 files (including93 timezone/microsecond assertions),361 race/rollback scenarios and3 populated upgrades. Its regenerated88,154-byte schema remained byte-identical to the committed official artifact, so schema drift/typecheck passed.
- After the corrections, local `npm run check:all` passed again:7048 unit tests across232 files, lint/format, typecheck,10 contrast pairs, production build and PWA generation. All321 fixture guards passed. These local results do not substitute for the corrected-head browser/DB CI and complete authenticated pixel matrix still pending publication.
