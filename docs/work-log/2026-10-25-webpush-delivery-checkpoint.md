# 2026-10-25 Web Push delivery database checkpoint

## Provenance and scope

Started from merged develop `cba8aa72d211411b6a3912a93c32a1f010335300`
(tree `2a5229cd058dae78230db1e0634c373bbd687148`) on the sole active
`feature/webpush-delivery` branch. The preceding local feature was bundled and
archived, verified tree-identical, and removed before this branch was created.
No direct develop/main push, production deployment or scheduler activation.

This early checkpoint contains the session-bound message delivery migration,
108 pgTAP assertions, 24 independent-session concurrency scenarios and database
contract notes. Application/provider/browser changes are outside this checkpoint
and continue separately on the same feature branch. Original private project
sources are not copied into the repository.

The DB adds verified Auth-session-bound registration, atomic explicit message
opt-in, safe status, native policy-independent endpoint/session opt-out, a
one-time final delivery authorization gate, scoped queue listing and bounded
ambiguous-attempt recovery. Source/recipient/access/preferences/current consent
are rechecked after locks; revoked or missing/expired sessions cannot authorize
fresh sends. Legacy unbound devices retain their historical DB-only ABI but never
enter actual delivery. The new worker selects message jobs only; billing notices,
Alimtalk, admin settings and analytics are not expanded here.

Provider acceptance remains distinct from display/read. Opt-out cannot recall an
already in-flight request, and ambiguous HTTP acceptance can cause duplicates
when an expired attempt is retried. The design is explicitly at least once, not
exactly once. Old token completion is fenced, and no raw endpoint directory is
available to application roles.

## Written verification and local checks

- 108 new pgTAP assertions cover permission grants, session/endpoint ownership,
  current consent and preferences, explicit re-opt-in, native logout and opt-out,
  old-session isolation, lease safety, replay/backoff, ambiguous recovery, dead
  endpoints, current source/recipient checks and legacy compatibility.
- 24 independent PostgreSQL session races cover recipient restriction/role/access,
  artist/source changes, preferences, endpoint/native/session revocation, Auth
  session deletion/expiry, consent changes, duplicate preparation, in-flight
  acceptance, competing recovery, late completion, parallel registration bounds,
  endpoint ownership, session rebinding and concurrent `Retry-After` replay. The harness uses real backend PIDs,
  not potentially truncated application names, to prove lock waits.
- `node --check scripts/test-webpush-concurrency.mjs`, focused ESLint, targeted
  Prettier and `git diff --check` passed. SQL files are excluded by the repository
  formatting configuration; no SQL execution is claimed from those checks.
- Existing notification/outbox fixtures were audited. No prior assertion or
  production privilege was weakened. Existing nullable legacy device rows are
  covered by new explicit no-delivery assertions.

Actual Supabase migration/lint, pgTAP twice, independent-session races and
`db:types` have **not run locally**. Docker is unavailable and the local browser
restriction remains; neither was retried or escalated. Parent-owned actual CI is
the path for fictional database/browser tests and the genuine generated schema
artifact. `src/types/database.ts` is intentionally unchanged pending that output.

No real push service endpoint was contacted, no real user/device permission or
customer content was used, and no live VAPID credential was generated. Ordinary
Web Push ownership/permission checks are in scope. The prior blocked independent
media-security review was not retried, replicated, delegated or probed.

This is not final feature completion. Application `check:all`, exact-head full
CI, three-font narrow/desktop browser and ordinary visual review, and genuine
generated schema import remain required. Simulated browser PushManager contracts
will not establish real-device push delivery; authorized iOS-installed-PWA and
Android delivery checks remain a later live-configuration gate.

## Provider backoff minimum added before first CI

The new completion RPC accepts an optional bounded `retry_after_seconds` without
changing the legacy completion ABI. Its first per-outcome retry deadline is
persisted under the completion locks: the next attempt honors the greater of
exponential backoff, the prior bound and provider `Retry-After`, and ambiguous
retries never start before lease expiry. Ordinary/concurrent replays cannot
move that deadline. Thirteen additional pgTAP assertions and two race cases cover
null/zero/bounds, provider minimums, ambiguous/final outcomes and replay. Actual
execution remains pending CI, as above.
