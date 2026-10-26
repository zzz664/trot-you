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
