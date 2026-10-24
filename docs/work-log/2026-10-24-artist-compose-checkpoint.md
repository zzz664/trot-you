# 2026-10-24 — Artist compose database checkpoint

## Scope

- Added authenticated artist-only catalog, bounded/cursor-paged owned drafts,
  exact selected-draft recovery, policy limits and safe media/pending-intent IDs.
- Added stable-create/operation idempotency, exact media-resource binding,
  compare-and-swap revisions and explicitly revisioned logical media removal.
- Scoped new ownership checks to composer-managed drafts so earlier collaborative
  messaging APIs remain compatible for their original legacy records.
- Preserved existing media processing APIs; protected registered final objects
  from deletion and revoked removed completed upload intents transactionally.
- No immediate/scheduled send, dispatch, cancellation window, notification
  delivery, operational setting seed, real content or hosted changes.

## Evidence and limits

- Added rollback-only pgTAP authorization, input, policy, paging, ownership,
  replay, revision and ordinary media integration contracts.
- Added 19 independent-session PostgreSQL races covering duplicate creates,
  edit conflict, operation/resource binding, role/restriction/membership/state
  loss, policy changes, type/reservation/revoke, save/finalize, remove/finalize and expiry during an authorization-lock wait.
- `node --check scripts/test-compose-concurrency.mjs` passed locally. Targeted ESLint and Prettier checks also passed locally.
- Local Docker is unavailable; migrations, pgTAP, race execution and genuine
  generated types must be established by the actual CI database job. They are
  **not** represented as passed locally. Generated schema types are not edited by
  hand. This immutable checkpoint exists to enable the real type-generation
  artifact before application integration completes.
- The previously blocked independent media-security review remains a caveat and
  was not retried, replicated or delegated. The new tests only reuse accepted
  media RPCs with fictional metadata; no payload probing/parser work is added.
