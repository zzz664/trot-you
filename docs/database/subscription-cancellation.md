# Cancellation and refund transaction boundaries

Migration `20261024000016_subscription_cancellation.sql` adds private refund
policy/current-policy, mutable request operations and immutable decision audit.
All new tables use RLS and revoke direct table privileges from anon,
authenticated and service roles. New public RPC grants distinguish actor-token
owner/admin requests from trusted service-only provider orchestration.

## Locks and authorization

Owner cancellation serializes on the existing subscription row with renewal
claims/finalization. It preserves claimed/unknown obligations and cannot restart
future billing. Refund requests lock subscription → original charge; approval
adds a current authenticated admin profile lock before those money locks.
Dispatch locks executing/approving identities in UUID order, then subscription,
original charge and request; it rechecks current authority and immutable policy.
`set_profile_role` now uses the same sorted identity order, preserving its access
contract while removing the actor/target ABBA race.

The owner-safe management RPCs never accept a user ID. They expose bounded pages
(100 subscriptions, 20 charge records) with `page`/`more_available`; admin inbox
uses 50 records, oldest unresolved first. Private payment identities never appear
in these DTOs. Restricted/incomplete/promoted owners retain cancellation access.
Request reasons normalize the ECMAScript trim whitespace set, including NBSP and
BOM, so direct authenticated RPCs cannot create blank/unreadable records.

## Monetary invariants

- Requests and leases are not money. Positive original charges must already have
  private provider verification. One unresolved request per original charge.
- User/idempotency uniqueness binds an exact original charge, requested amount
  and reason. Approval is for that exact integer KRW amount and policy version.
- New dispatch requires unchanged recognized refund capacity. Lost responses and
  expired leases become unknown; unknown only receives bounded query leases.
- `refund_finalize` verifies original provider payment identity, request amount,
  currency and approval-relative timestamp, then calls the existing append-only
  `billing_record_refund`. Unique provider action identities and locked original
  charge capacity prevent duplicate/over-refund recognition.
- Financial recognition can finish after authorization is revoked because money
  may already have moved. It cannot silently terminate paid access or cancel
  renewal. Unknown/unverified money is never recognized as a refund.

## Actual database gates

The pgTAP suite covers role grants, owner isolation, missing policy, restricted
owner cancellation, policy immutability, exact approval, replay conflicts,
unknown/query leases, late recognition, negative ledger, cumulative capacity,
reason normalization and safe manual-review projections. It runs twice in CI.

`scripts/test-cancellation-concurrency.mjs` uses 13 independent psql-session
races for duplicate requests/claims/finalization, authorization and role
revocation, rejection vs dispatch, ledger changes, cancellation/renewal races,
query claims and multi-identity lock ordering. It can target only disposable
local CLI Supabase and resets that database; no hosted credentials are read.

The first CI checkpoint passed the new pgTAP file but exposed an old exhaustive
TRUNCATE test missing the new FK tables. That test was extended without weakening
its immutable-ledger exception. All final migrations/races and committed schema
types must pass on the exact release PR head. `src/types/database.ts` is imported
only from genuine CI Supabase generation, never hand-written.
