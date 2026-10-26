# 2026-10-26 — Community moderation (feature 36)

## Scope and decisions

- One `feature/community-moderation` branch from verified develop `8de59a6497a54e0fab8f46aed92ff1b0d86f7d1c` (tree `ed1cdc05ee64af82a173d09703417384e17efe2c`). The preceding local feature was archived, not reset; a pre-change bundle was preserved outside the repository.
- Implement distinct reports, existing approved-policy automatic hiding, administrator restoration/deletion, reply moderation, temporary user restrictions and reporter decision notices. Rewards and points are outside this feature.
- Reuse the effective community, identity and notification boundaries rather than reintroducing older foundation functions. No operational threshold, moderation vocabulary or active policy is invented or seeded.
- Decision notices are private in-app transactional records. There is no approved moderation push/Alimtalk category or provider consent contract, so this feature does not activate external delivery or alter the notification worker wrapper chain.
- Unknown write outcomes require replaying the identical operation and request. Target disappearance must not silently discard a pending result; identity or authorization changes must discard the previous account's private state.

## Verification stages

- DB-first checkpoint includes migration, pgTAP, concurrency and populated-upgrade fixtures before the official CI schema-type generation. Generated `src/types/database.ts` is never handwritten.
- Original CI steps and the fixed historical hashes stay intact. Added DB gates run before official type generation; the feature browser will join the complete registry and required aggregate. Migration/shared-layer changes retain full fallback.
- Dependency-free CI selector/workflow/aggregate tests: 182 passed after adding the new DB gates.
- Local Docker/browser execution is unavailable and the socket restriction must not be retried or escalated. Actual database and browser results require the isolated hosted CI runner; this is not a production or staging verification claim.
- Final counts, immutable checkpoints and hosted evidence will be appended after those stages run.

## Authorization boundaries

No real users/posts/replies are moderated, no roles or policy settings are activated,
no scheduler/provider messages are sent, and nothing is deployed. Private source
specifications are read locally and are not copied into the repository.

## DB-first checkpoint

- Migration adds separate reply moderation fields (hidden/deleted/count/revision),
  six actor-bound RPCs, immutable operation receipts and recipient-only notices.
  Original send-policy blocks remain independent. No notification delivery wrapper
  or production policy is activated.
- Dedicated pgTAP: 110 functional assertions plus 6 repeatable-read and 6
  serializable boundary assertions. Four additional existing fan-reply assertions
  exercise actual hidden/deleted masking. The former unsupported-reply test now
  tests missing-target rejection rather than removing coverage.
- Eighteen actual independent-session race scenarios and a populated pre-migration
  upgrade fixture are included. The existing schema fields remain compared, and
  four additive reply defaults are checked separately.
- Local static verification: 118 combined upgrade contract tests passed; both
  new DB scripts parsed; targeted lint and diff-whitespace checks passed. Actual
  SQL and races have not run locally because the authorized hosted CI is required.

## Application and isolated browser implementation

- Strict schemas and actor-bound report/context/queue/resolve/restrict/notice
  services, bounded no-store HTTP/client transport, administrator review and
  reporter inbox are implemented. New reports can originate from posts/comments
  or assigned-artist reply views. The report host survives parent disappearance.
- Review displays text/reason; no protected-media review path or independent media
  security probing is added. Current provider workers remain untouched.
- Dedicated browser harness contains 20 real Auth/RPC scenarios plus one keyless
  default scenario. Six text-scale/viewport combinations cover settled report,
  recovery, review/dialog, restriction and notice screens, including offscreen
  controls. Hosted execution and pixel review are still pending.
- Local script verification: 189 selector/workflow/aggregate tests and 479
  fixture/discovery tests (668 total) passed. Full application typecheck is waiting
  only for official generation of the six new RPC names; no type placeholder is
  introduced.

## Exact DB checkpoint validation

Local `5812eab9f3c37a9cda759c4df3064742485fde25`, published by the parent as
`9c01808e61bcb6445bf74f5f7c55756229c1dfa9`, has identical tree
`f86c63a71cff9e279054b912083cf36fc9745aab`. An isolated exact-commit export passed
`npm run check:all`: lint, typecheck, 8,643 unit tests, contrast and production/PWA
build. An initial temporary dependency symlink was incompatible with Turbopack's
root resolution; replacing that export-only link with local package files fixed
the validation environment without source changes. Hosted SQL, races, upgrades
and genuine schema generation remain a separate pending gate.

## Local application checkpoint

- Full working-tree unit regression: **9,097 tests in 292 files passed**.
- The new async menu entry exposed three old test-renderer mock omissions. The
  fixtures now mock that RSC entry explicitly, preserve the previous assertions
  and add eligibility cases; the full rerun is green.
- Known write receipts stay successful even if subsequent refresh fails. Unknown
  results retain the exact immutable request; current-account denial clears
  private drafts/content. Expired restrictions are labelled separately from active
  restrictions. These cases have focused regression coverage.
- Full repository lint/format checks and all 668 script tests passed. The schema
  artifact is still pending official CI; its six RPC names are the only outstanding
  typecheck errors. Actual browser execution and visual review remain pending.

## Official DB/type verification

Hosted run `40294446752` checked remote DB head
`9c01808e61bcb6445bf74f5f7c55756229c1dfa9`. It passed **4,690 pgTAP assertions
on each of two passes**, **497 semantic concurrency scenarios** (495 raw PASS
lines plus two unchanged legacy combined cases), and **eight populated upgrades**.
The new moderation suite contributed 18 actual races. The serial database stage
took **25m31.727s**, so its existing 30-minute timeout remains unchanged.

The official generated `database.ts` is 95,823 bytes, SHA-256
`0c3fc6f3b6bada63e9c6ecbc571e11be364f6e31f0ae66f632635d92e4358bf8`.
It was imported byte-for-byte from verified artifact `12639490146`; no generated
type was handwritten. Generated-schema typecheck passed on the hosted runner.
Only the expected bootstrap committed-type drift gate and dependent aggregate
failed before this artifact import; all preceding SQL/race/upgrade checks passed.

After the official type import, the complete application `npm run check:all`
passed: repository lint/format, typecheck, **9,097 unit tests in 292 files**,
contrast and production/PWA build. All **189 CI contract tests plus 479 fixture
checks** also passed. The new moderation browser and final-head pixel review are
not claimed as run locally; the hosted final-head gates remain required before
merge.
