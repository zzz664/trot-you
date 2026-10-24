# Checkout preparation sessions

This is a **local pending-intent foundation**, not working payment registration or a subscription. It makes no provider request, collects no payment credential, creates no subscription/mandate/charge/obligation/ledger event, and grants no paid access. Provider approval, billing-key exchange, encrypted credential storage and first charge are deliberately later work.

## Policy and private data

- `private.checkout_policies`: complete title/body, exact regular and introductory integer KRW prices, version, approval and publication times. Approved rows are immutable; approval and publication are recorded together when ready. A new version is required to change text or prices. Owner-controlled policy activation is separate from this migration; **no terms, prices or approvals are seeded**.
- `private.checkout_policy_current`: the current exact version. Missing, draft or future-published policy fails closed. Prices are part of the immutable approved commercial snapshot, not fallback values from the documentary defaults or unrelated mutable settings. The eventual admin policy workflow must publish a coherent reviewed version.
- `private.checkout_sessions`: actor/artist/provider/environment, immutable-at-creation policy and price snapshot, opaque customer/order UUIDs, actor-scoped idempotency UUID, SHA-256 nonce digest, expiry and local state. No raw nonce, provider key, SID, auth token, email, name, phone, raw response or redirect URL is stored. `private` is not exposed by PostgREST; RLS is enabled and all direct application-role table grants are revoked.

Sessions last 15 minutes, with a structural maximum of 30 minutes. `pending_intent`, `canceled`, and `expired` describe only local preparation. Read-only expiry is projected without a database write. An explicit subsequent preparation expires an old pending row before creating a new one. Retention/deletion of these private records requires a later reviewed cleanup policy; deleting an account must not silently bypass that decision.

## RPC boundary

| RPC                                                                                                                               | Authorization and result                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout_get_offer(artist_slug)`                                                                                                 | Authenticated actor only; safe artist, full approved terms, exact prices and lifetime introductory eligibility. No user/price override input.                                                                                |
| `checkout_prepare_session(user, artist_slug, provider, environment, idempotency_key, nonce_hash, policy_version, terms_accepted)` | Actual `service_role` only; trusted HTTP service must derive actor from verified Auth. Requires explicit acceptance of the current exact version. Returns a safe snapshot plus `nonce_matches`; never a provider credential. |
| `checkout_read_session(user, session)`                                                                                            | Actual `service_role` only, with owner and current profile/legal eligibility checks. Returns historical approved snapshot and computed expiry; `nonce_matches=false`.                                                        |
| `checkout_cancel_session(user, session, nonce_hash)`                                                                              | Actual `service_role`, exact owner and original nonce digest; one transition from unexpired pending intent to canceled. Restricted/incomplete actors may abandon their own intent without acquiring any new capability.      |

All boundaries pin an empty `search_path`; private helpers are not callable by application roles. Every offer and preparation requires the current unrestricted fan role, validated current calling-name policy, current exact approved profile terms/privacy acceptance, age self-attestation and completed onboarding. Preparation additionally locks the active artist, commercial policy, existing subscription and pending-session state. Existing paid/pending subscriptions and unresolved obligations prevent a competing new preparation.

The profile lock serializes same-actor double clicks and distinct-key/provider races. A matching request key returns the original session/status/expiry and preserves the original nonce digest without exposing it. A different nonce never replaces the first digest; `nonce_matches=false` lets the HTTP layer refuse to overwrite an existing nonce cookie after an uncertain response. The same key with changed artist/provider/environment/version conflicts. A rotated current policy fails even for a repeated key. A different key cannot fork an unexpired pending intent for the same actor/artist. Cancellation replay and expiry are explicit errors; neither performs provider work.

### Controlled error names

HTTP/database adapters must map exact known names, never return arbitrary SQL errors or provider payloads:

- `CHECKOUT_INVALID_INPUT`, `CHECKOUT_CONSENT_REQUIRED`
- `CHECKOUT_SETUP_NOT_READY`, `CHECKOUT_POLICY_CHANGED`
- `CHECKOUT_ONBOARDING_REQUIRED`, `CHECKOUT_PROFILE_REQUIRED`
- `CHECKOUT_NOT_FOUND`, `CHECKOUT_NONCE_INVALID`
- `CHECKOUT_SESSION_EXISTS`, `CHECKOUT_IDEMPOTENCY_CONFLICT`
- `CHECKOUT_SESSION_REPLAY`, `CHECKOUT_SESSION_EXPIRED`
- `CHECKOUT_SUBSCRIPTION_EXISTS`
- Reused readiness gates: `DISCOVERY_FORBIDDEN`, `DISCOVERY_PROFILE_REQUIRED`, `DISCOVERY_SETUP_NOT_READY`; trusted-role guard: `BILLING_SERVICE_REQUIRED`.

## Verification boundary

`supabase/tests/checkout_sessions.test.sql` contains 76 rollback-only pgTAP assertions for privileges, policy immutability/currentness, profile and artist revalidation, price snapshots, nonce ownership/replay/expiry, idempotency, provider changes, and absence of financial side effects. All identities, prices and documents in fixtures are fictional and not operational approval.

`npm run test:db:checkout-concurrency` uses independent PostgreSQL sessions in the disposable local Supabase Docker container only. Eleven cases prove duplicate/distinct-key serialization, nonce preservation, cancellation ordering, policy/artist/restriction/consent changes during waits, expiry during a wait, and a competing subscription. Every race observes actual `pg_blocking_pids` before release. It accepts no remote URL or provider credentials, checks an empty fictional fixture database, and resets after committed fixtures. It cannot run without local Docker; synthetic sequential execution is not concurrency proof.

The supplemental local PGlite harness is PostgreSQL 18 WASM with synthetic Auth/Storage fixtures. It can establish SQL/ACL behavior but is **not** Supabase PG17, real JWT/PostgREST, browser behavior, multi-session contention, sandbox provider verification or live merchant approval. Actual Supabase reset/lint/pgTAP, concurrent sessions and official generated schema types remain exact-head CI gates. Generated `src/types/database.ts` must come from the genuine CLI artifact, never hand edits.

## Remaining activation requirements

Intent records are pseudonymous and linked to account IDs; they are not anonymous or exempt from privacy/retention review. Expiration changes usability, not physical retention. An approved retention/deletion workflow remains a launch prerequisite.

The preparation terms record is not authorization to charge. Both displayed prices belong to the immutable policy; the response additionally projects the exact authoritative initial/regular price and introductory eligibility. If eligibility changes after the page was read, the UI displays the prepared snapshot. Future enrollment/first-charge approval must re-confirm the current amount and valid customer authorization rather than reusing preparation consent as charge authorization.

The current provider callback GET discards all query data and redirects to a fixed unavailable page. It does not accept authorization tokens or verify/consume provider callback state. The current one-time nonce protects only local cancellation; callback verification, durable provider dispatch, secure credential storage, first-charge reconciliation and owner-visible recovery remain explicit later MVP work before provider launch.
