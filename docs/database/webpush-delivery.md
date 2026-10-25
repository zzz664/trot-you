# Session-bound Web Push delivery

Migration `20261025000024_webpush_delivery.sql` extends the existing transactional
message outbox. It does not activate an operational policy, recurring schedule,
provider account or production environment.

## Browser identity and consent

`private.push_subscriptions.auth_session_id` binds newly opted-in endpoints to a
verified Supabase Auth session. A session UUID alone is not authentication: the
HTTP layer must obtain it from verified claims, never request JSON. SQL checks
that the matching `auth.sessions` row belongs to the actor and has not reached
`not_after`. The Auth session is checked again under a row lock before sending.
Missing or expired sessions fail closed. No session FK is used because logout
removes Auth rows while delivery audit identities must remain.

The status and native opt-out functions derive their actor/session from the
signed JWT. Status returns only readiness, consent version, preferences, and the
matching owner's device identity/state; no endpoint, encryption key, fan name,
message body, phone, or another account identity is projected. Restricted or
role-changed accounts retain their own off status and opt-out path. Native
opt-out needs neither provider configuration nor service-role credentials.

Registration requires an eligible onboarded fan, a live session and an explicit
current consent version. It atomically enables global Web Push and new-message
preferences while preserving billing/schedule choices. An endpoint never changes
account owner or cryptographic material. Same-owner explicit consent can reactivate
a revoked endpoint or bind it to a new session, canceling old pending work. A dead
endpoint needs a new browser subscription. A structural ceiling of ten active
devices per actor is serialized on the profile row; this is an abuse/storage
ceiling, not an approved subscription product limit.

No endpoint existence/ownership proof is claimed from its syntax. The server
adapter must independently enforce its documented provider-origin allowlist,
cryptographic key validation, DNS/address restrictions, redirect policy and
bounded transport. SQL never fetches an endpoint. Existing legacy registration
remains a DB-only ABI; null-session legacy rows are excluded from the new worker
and cannot pass the final delivery gate.

## RPC contract

| RPC                                                                        | Caller               | Result                                                    |
| -------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------- |
| `webpush_current_status(endpoint?)`                                        | authenticated JWT    | One six-field safe status row                             |
| `webpush_revoke_current_device(endpoint)`                                  | authenticated JWT    | Idempotent own-endpoint revocation                        |
| `webpush_revoke_session()`                                                 | authenticated JWT    | Count revoked in the JWT session                          |
| `webpush_device_status(actor, session, endpoint?)`                         | service only         | Same safe status projection                               |
| `webpush_register_device(actor, session, endpoint, p256dh, auth, consent)` | service only         | Device UUID                                               |
| `webpush_revoke_device(actor, session, endpoint)`                          | service only         | Idempotent own-endpoint revocation                        |
| `webpush_list_due(limit)`                                                  | service only         | Up to 100 message-job UUIDs                               |
| `webpush_list_uncertain(limit)`                                            | service only         | Up to 100 due expired lease handles; no endpoint material |
| `notification_claim(job)`                                                  | existing service ABI | Exclusive attempt/lease                                   |
| `webpush_prepare_delivery(job, token)`                                     | service only         | At most one endpoint/key row per fresh lease              |
| `webpush_complete(job, token, outcome, evidence, retry_after_seconds?)`    | service only         | Durable state with backoff                                |
| `webpush_recover_expired(job, token)`                                      | service only         | Token-fenced expired-attempt state                        |

The new worker lists only session-bound **message** jobs. Existing payment and
schedule outbox rows remain separate future delivery work. All private helpers
and raw sensitive tables remain unavailable to application roles. Every public
privilege boundary has an empty pinned `search_path`.

## Final authorization and concurrent mutations

The preparation boundary locks profile, artist, subscription, source,
preferences, Auth session, device, policy, message policy, then job, matching the
existing outbox's source-before-job order. Current recipient access, restriction,
artist/source state, preference, consent and session eligibility are rechecked
after waits. Preparation is consumed once per attempt via
`notification_attempts.delivery_prepared_at`; a repeated call returns no endpoint.

Real transport requires a lease of at least ten seconds and more than five
seconds remaining at preparation, with an application HTTP timeout of at most
four seconds. The service must independently check the deadline just before I/O.
These are safety ceilings, not an assertion that a stalled process can never
resume later. No database transaction or browser unsubscribe can recall an
HTTP request that already left the application. A real acceptance after opt-out
is retained honestly. An already prepared ambiguous attempt is never relabeled
as a proven non-send merely because its recipient was subsequently revoked.

## Retry and evidence semantics

The existing source/channel/user/device identity deduplicates outbox insertion.
A definite provider rejection can use `not_sent`; timeout, crash or transport
ambiguity uses `unknown`. Retry delay is `min(86400, base * 2^(attempt-1))` seconds
and the original job's maximum-attempt snapshot bounds retries. A bounded provider `Retry-After` minimum (0–86400 seconds) can only extend that
exponential floor. The first retry decision is persisted on the attempt; ordinary
and concurrent evidence replay cannot shorten or extend its deadline.

The new explicit recovery path waits for the lease plus backoff, rechecks current
eligibility and either cancels, fails at the attempt ceiling, or permits a fresh
attempt token. A stale token cannot prepare or complete a newer attempt. Recovery
of an ambiguous prior send is intentionally **at least once**: the push service
might already have accepted it, so duplicates remain possible. Stable notification
tags/topics can reduce duplicates but cannot establish exactly-once delivery.
`provider_accepted` means only an HTTP push-service acceptance, not display,
device receipt or user read. No such receipt/read column is fabricated.

## Verification and limits

Three rollback-only pgTAP suites add 108 assertions. The disposable-local-only
independent-session script adds 24 race scenarios, observes actual backend PIDs
with `pg_blocking_pids`, and resets fictional fixtures on exit. Existing outbox
fixture contracts remain unchanged, with explicit new compatibility assertions
for legacy null-session rows. Actual CI migration/lint/tests/races and genuine
schema generation are required; local syntax/lint checks do not replace them.

The Auth session check follows the official
[Supabase session/JWT documentation](https://supabase.com/docs/guides/auth/sessions)
and [sign-out scopes](https://supabase.com/docs/guides/auth/signout), consulted
2026-10-25. Session timeout/inactivity policy can be applied by Auth on refresh;
this feature does not invent a stricter inactivity setting. It does check missing
rows and the stored explicit `not_after` bound.
