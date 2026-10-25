# 2026-10-25 Artist replies/activity database checkpoint

## Scope and provenance

Started from merged develop `b369d7879a7c98d683127b32daa49e0b3d4d8e6a`
(tree `2d199ff98ea8439b04d6d76f2b0756509848ad95`) on the sole active
`feature/artist-reply-activity` branch. The preceding local feature tip was
bundled and archived, verified tree-identical to develop, and then removed.
No direct develop/main push or production change is included.

Three authenticated, assigned-artist read RPCs provide artist pagination,
calling-name-only received reply pages with optional sent-message filtering,
and independently paginated sent-message choices. The response also reports
current KST-week source message/photo counts. Private arbitrary-time helpers
are not client-executable. Legacy service reply reads retain their ABI and now
share the same hidden/restricted/incomplete-fan visibility rule.

Reply text and its content ID remain; fan UUIDs, contact/account details,
subscription/payment identifiers and private financial policy fields are never
projected. Blocked/ineligible fan replies are omitted. Canceled message links
are cleared while otherwise-visible received text remains. No DM or outbound
notification is introduced.

The activity window starts Monday midnight KST and ends the next Monday,
exclusive. Only sent rows no later than database as-of time count; photo count
is photo-message count, not attachment count. Contract minima appear only when
existing enabled policies consistently cover the entire week, including
cross-month boundaries. Missing/disabled/partial/conflicting policies mean
unavailable requirements, never invented zero or draft-default requirements.
No financial ledger, settlement report, operational policy or scheduler changes.

## Written verification and local results

- 74 new pgTAP assertions: 51 feed/auth/projection/pagination/legacy assertions
  and 23 source-week, timezone, month and requirement boundary assertions.
- 13 independent-session concurrency scenarios are ready for the actual local
  Supabase CI database: actor restriction and role loss, membership removal,
  artist pausing, reads blocking revocation, blocked/restricted/deleted replies,
  canceled linked messages, source updates and rollback consistency.
- Legacy fixture audit found the existing messaging lifecycle fixture already
  supplies valid onboarding and calling names. No historical assertion is
  removed/weakened; new tests cover safe legacy visibility explicitly.
- Node syntax, focused ESLint, targeted Prettier and `git diff --check` passed.
- Application work is intentionally outside this early immutable checkpoint.
  Its current 5,229 unit tests passed locally during development; that is not a
  claim that this DB migration has executed or that the final feature is ready.

Actual PostgreSQL/Supabase migration, lint, pgTAP twice, independent-session
races and generated database types have **not yet run** for this checkpoint.
Local Docker is unavailable; no retry or escalation was attempted. Local browser
execution remains denied and is not retried. Parent-owned actual CI is the path
for fictional database/browser validation and genuine generated type output.
`src/types/database.ts` is deliberately unchanged pending that artifact.

The earlier blocked independent media-security review remains unperformed;
this feature neither retries nor replicates it. No real users/content, hosted
resources, provider delivery, keys, deployment or recurring scheduler is used.

This checkpoint is not feature completion. Final application check:all,
exact-head CI, all new visible-link interactions, three-font responsive browser
coverage and normal visual review remain required before merge.

## First actual CI and observer repair

[Run 40145771206](https://github.com/zzz664/trot-you/actions/runs/40145771206)
validated remote head `c192595db51619c7a1d799ada3cfae21a4041a4f` and
checkout merge `d6f55e57` against tree `6e35532557ca2ed019f1444c8b0fe4dbcab7b05d`.
Both actual pgTAP passes succeeded with **3,139 assertions each**, and all twelve
non-database jobs passed, including all 414 existing browser cases. The database
job reached the new concurrency script after all prior race scripts passed.

The first new race observer failed to detect a wait because its `application_name`
lookup used a 64-byte waiting label, which PostgreSQL truncates to 63 bytes. This
was a test-observation defect, not proof the underlying race had passed or failed.
The harness now captures each real `pg_backend_pid()` and observes that PID's
`pg_blocking_pids`, independent of display-label truncation. Pure regression
tests validate PID input/query wiring and the exact 64-byte failure case. Actual
rerun of all thirteen scenarios remains required; no race assertion was removed.
Types/upload/typecheck were skipped after this failure, so no genuine generated
artifact existed yet and the application type import remains pending.
