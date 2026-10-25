# 2026-10-24 Message dispatch database checkpoint

## Scope

The feature starts from merged `develop` commit
`acc788cc8010368ac805a56d01918e5f5478d5d6` on the single
`feature/message-dispatch` branch. The preceding local authoring branch was
preserved in a bundle, verified tree-identical to merged develop, then deleted.
No direct develop/main push, external provider notification, operational policy
activation, deployment or Cron schedule activation is part of this checkpoint.

The checkpoint adds owner/revision-bound immediate or scheduled in-app
publication, exact retry identity, current safe history receipts, cancellation,
and bounded transaction-only due processing. Existing source/outbox transactions
and fan access/media behavior are reused rather than replaced with per-recipient
plaintext copies. Notification enqueue success never becomes fabricated provider
delivery. Details and explicit technical safety ceilings are in
`docs/database/message-dispatch.md`.

## Important decisions and fixes

- Freeze notification devices at actual publication, not draft-save or schedule
  creation; future subscriptions/devices cannot add jobs through replay. Fan
  history remains current-access/current-name rendering.
- Return current truth for accepted operation retries, including cancellation
  after a lost send response. The request stores precise numeric epoch schedule
  identity so timezone formatting cannot cause a false operation conflict.
- The worker has no external I/O: transaction locks are its claim, and crash
  rollback restores scheduled work and removes partial outbox effects. Known
  failures/contention back off without blocking unrelated candidates. No
  notification provider lease is claimed by this dispatcher.
- Paused artists cannot publish, but their current authorized owners can still
  inspect/cancel pending history before reactivation. This preserves the original
  cancellation contract rather than trapping an unwanted schedule.
- Source publication plus all eligible outbox jobs is atomic. Capacity overflow
  is an explicit blocker, not recipient truncation. A 1,000-distinct-fictional-
  subscriber test checks completeness, not network delivery latency.
- Existing managed-draft compatibility restrictions now cover legacy schedule,
  dispatch and cancel. Internal legacy implementations are private/non-executable
  by API roles; unmanaged legacy sources keep their previous behavior.

## Verification status at preparation

Supplemental SQL verification is in progress while this checkpoint is prepared;
final results will be appended before handing off. The existing source/private
specifications were read and remain private. The migration seeds no content,
settings, consent or keys. Existing pgTAP/race assertions remain intact.

Local Docker is unavailable, and the previously denied local browser path is not
retried. Actual Supabase PG17 reset/lint/pgTAP twice, independent-session races and
genuine generated-type artifact require the authorized CI path. Do not describe
supplemental PGlite or static script validation as those checks passing. The
previously blocked independent media review remains blocked/not retried; only
ordinary accepted media API metadata behavior is tested here.

This is an early immutable database/type-generation checkpoint, not feature
completion. Application/server/UI/fixture work continues independently. No
hand-authored database type substitutes are accepted; final merge requires the
correct generated types and exact-head full CI plus normal visual QA.

## Database checkpoint preflight results

- The supplemental PGlite PostgreSQL 18.6 harness applied every migration and
  fictional seed, then ran **3,065 pgTAP assertions twice** without failure.
  This preserves all 2,960 existing assertions and adds 105 dispatch assertions:
  ownership, replay/timezone identity, rate/backpressure, strict future scheduling,
  fan/grace/current-access selection, 1,000-subscriber atomic fanout, rollback
  recovery, content/author retries, media reuse/pending-upload rejection,
  cancellation boundary, paused history/cancellation, and revision ceiling.
- `scripts/test-dispatch-concurrency.mjs` contains **16 independent-session
  scenarios** for actual CI: double confirmation, changed operation, edit versus
  confirmation both orders, duplicate cancel, cancel versus worker both orders,
  overlapping workers, worker rollback/recovery, restriction/membership loss,
  expiry during cancellation wait, notification claim versus cancellation both
  orders, submit rollback/replay and the last rolling-minute rate slot. Node
  syntax, ESLint and Prettier checks passed. These races are **written, not locally
  executed**; no Docker retry was attempted.
- `git diff --check` passed. Existing financial TRUNCATE fixtures need no new
  dependency entries: new dispatch tables reference composer/messages, not the
  immutable financial ledger. The unchanged ledger assertions passed in both
  full supplemental runs; no existing assertion was removed or weakened.
- Independent read-only review found and resolved timezone-dependent schedule
  retry identity, paused-artist cancellation reachability, terminal revision
  overflow and missing partial due-index predicates. Cancellation now retires
  pending rows from the due index and remains valid at the numeric revision cap.
  The reviewer performed no browser/Docker/provider/media-probe work.

The checkpoint is ready for actual Supabase CI migration/lint, these sixteen
races and genuine public RPC type generation. Generated types are deliberately
unchanged until that artifact exists. Aggregate application quality checks and
browser/visual verification remain the full feature owner's later gate.

## Actual Supabase CI and genuine generated types

[Checkpoint run 40141550767](https://github.com/zzz664/trot-you/actions/runs/40141550767)
completed for remote head `af2ad95b1cebcb8cf2175d8f9385ad76b92bc579`.
The observed PR checkout merge `339b52bbfe5327fe75267ba920b646d778576143`
has the same tree `df09237490534d89d8f34ddf1997b2ff95d72082`; source logs
and official artifacts were checked against that provenance.

- Actual local Supabase PG17 reset/lint, **3,065 pgTAP assertions twice** and
  **260 independent-session races** (244 existing plus 16 dispatch) passed.
- Genuine type generation and typecheck passed. All other 11 jobs passed,
  preserving 4,680 unit, 114 fixture and 369 browser checks at this database-only
  checkpoint. Ordinary baseline review found no visible layout blocker across
  the 385 existing captures.
- The database job failed only its expected committed-type-drift gate. This run
  is **not** an overall CI pass and does not verify the later application tree.
- Official `database-types` artifact `12579408279` ZIP SHA-256 was verified as
  `b5766a989c78967325636bc091e25a635cb7289808c21af774df56b8a83a4545`.
  Its `database.ts` is 80,115 bytes with SHA-256
  `9fbb3fee509b45df2ae910985c67a50c300f549d64c15791582247da3e84731c`.
  It was copied byte-identically into `src/types/database.ts`; `cmp` and the
  digest were checked. No database type was hand-written.

The local checkpoint was bundled, then its tree-equivalent remote head was
adopted without discarding application work. The application candidate requires
its own final full check and exact-head CI, including the new dispatch browser
job and normal visual inspection, before merge.
