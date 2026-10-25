# 2026-10-25 — Admin artist management database checkpoint

## Scope and decisions

- Added authenticated, current-admin artist list/detail/save, ordered previews, exact-user account-link invitations, explicit recipient confirmation, cancellation and unlink RPCs. Artist edits use revisions and actor-scoped operation IDs; replay never re-applies a completed privilege grant.
- Artist deactivation is a status update, not physical deletion. Existing subscriptions, messages, payment records, accepted profile assets and approved financial policies are not rewritten by management actions. No price/payment-policy fields are accepted.
- Existing authenticated direct artist/member writes are revoked. The pre-existing admin role-management RPC remains a separate capability and is not used by these features. Legacy trusted-service preview curation now also updates revision and append-only audit.
- Account links target an exact existing Auth UUID with a nonempty verified email or phone, completed onboarding and no current restriction, ban or deletion. No email matching/guessing, credentials, token, Auth-user creation, external invitation or provider call exists. Issuing intent grants no access; the intended current user must confirm. The issuing admin must retain admin authority when acceptance occurs.
- The exact business onboarding method is not approved. Missing/disabled private policy fails closed for issue/accept; cancel/unlink remains possible. The migration seeds no policy, account, invitation, membership or administrator. A separately reviewed manual initial-admin bootstrap records append-only audit and is never run by migrations.
- Profile image editing remains outside this DTO until a separately approved, ownership-bound public profile asset workflow exists; raw Storage paths are never accepted. Preview media reuse existing accepted resource IDs and protected media access.
- Pausing or retiring through management cancels pending link intent. Expiry is enforced at confirmation after locks. Invitation acceptance replay after unlink does not restore access. Pending recipient invitations are prioritized before bounded historical rows.

## Verification authored

- pgTAP covers ACLs/RLS, current roles, strict input, create/CAS/idempotency, audit immutability, preview ownership/order/cancellation, verified exact recipient, configuration/confirmation gates, accept/replay/unlink/cancel/expiry/deactivation, and preservation of a fictional verified financial ledger lifecycle.
- Independent-session race script proves real PostgreSQL blocking before releasing the first transaction: competing edits/creates, duplicate save/invite/accept, role loss, deactivation, cancel-versus-accept, policy withdrawal, restriction, expiry, unlink-versus-replay and preview cancellation.
- Identity foundation compatibility assertions now expect RPC-only artist/member writes while preserving constraint and role-revocation fixture coverage. Public catalog appends only safe display order.
- Local static JavaScript syntax/format checks are available. Database, generated types and browser validation are CI-only in this environment; they are not claimed passed at this checkpoint. No local Docker/browser execution was attempted. Types must come from the real CI Supabase generator, never hand edits.

## Completion boundary

This is configuration-ready implementation, not operational artist onboarding or production authorization. No actual user data, role, secret, credential, provider configuration, invitation, deployment or financial policy was changed.
