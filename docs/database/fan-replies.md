# Fan reply database boundary

This feature implements a fan's own plain-text replies, not realtime messaging,
an artist inbox, speech input, rewards, message reads, or notifications. No live
policy values or profanity dataset are activated by its migration.

## Capabilities and exact submission identity

`fan_reply_send(artist_slug, operation_id, body, message_id = null)` is executable
only by `authenticated`; `auth.uid()` supplies the subject. It returns one reply
with `id`, `operation_id`, nullable `message_id`, nullable `body`, `created_at`,
and `is_blocked`. Current fan/name/legal/onboarding readiness, active artist and
paid/canceled-through-paid-end/grace access are checked in the database.

The browser retains one UUID for an unresolved submission. Actor + operation UUID
is unique across artists. The accepted artist, exact raw body and optional target
are immutable: reuse with changed input is `REPLY_OPERATION_CONFLICT`. Exact
replay returns the original identity and timestamp without a new row or quota.
A later moderation block returns a null body, not the rejected content. Current
actor and subscription authorization still apply to a replay. A newly changed
send policy or canceled target cannot turn an already accepted operation into a
second send: its accepted result can still be reconciled.

A message target is optional because the supplied reply action is artist-based.
When present it must belong to the requested artist and currently be a visible
sent paid message, including the existing episode history window. Draft, future,
canceled, cross-artist and out-of-history targets are denied. No target text or
raw artist template is copied into the reply DTO.

## Approved moderation and quota

`private.reply_policy` is a trusted configuration snapshot with explicit version,
approval time, positive rate count/window, nonempty bounded literal profanity
terms and supported forbidden pattern identifiers. `service_role` may read,
insert and update this policy for the later approved settings integration;
browser roles have no access. There is no seed or document-default fallback.
Absent, future-approved or malformed policy disables new sends. Existing message
policy supplies `max_reply_length`; missing message policy still fails closed.

Bodies retain their exact original bytes and are counted in Unicode codepoints.
The moderation comparison uses NFKC/case normalization, rejects whitespace-only
including compatibility whitespace, disallows invisible/control characters, and
matches literal forbidden terms. Newline/tab are allowed as plain text. Supported
pattern identifiers are `phone`, `account`, and `url`; their bounded built-in
checks cover common local/international Korean phone layouts, long account-like
digit sequences, schemes, `www` and generic bare ASCII/punycode domain names. Bare Unicode
domains without a scheme/`www` are not exhaustively recognized: normal Korean
sentence punctuation must not be mistaken for a domain. Arbitrary operator
regular expressions are never executed. This is a configurable baseline filter,
not a claim that every possible human obfuscation is detected. Actual business
moderation terms and enabled categories still require approval.

Quota is a fixed window per user, shared across artists and both write wrappers.
An actor write lock and private counter update make reservation + reply insertion
one transaction. Rejected input and exact accepted replays spend no extra quota.
The window/count are approved policy values, not hardcoded operating defaults.

The old service-only `messaging_create_reply(actor_id, artist_id, body)` ABI is
retained for fixture/internal compatibility but now delegates to the same full
readiness, moderation and quota primitive. Its signature has no caller operation
key, so it cannot promise retry idempotence and must not be used for browser or
retryable submissions. The application uses only `fan_reply_send`. Original
negative error semantics remain; legacy fixtures now explicitly provide current
fictional readiness and moderation rather than weakening those checks.

## Own feed and retention

`fan_reply_page(artist_slug, limit = 30, before_created_at = null, before_id = null)`
is also authenticated self-only. It returns `artist_slug`, `replies`,
`max_length`, `send_ready`, and `has_more`. Each reply has the same safe fields as
the send result, with nullable operation keys for pre-feature retained rows.
Pagination is descending `(created_at, id)`, with full PostgreSQL microseconds,
strict tuple continuation and `limit + 1` lookahead. Bounds are 1–100.

Own text remains retained across subscription episodes. The source defines a
history cutoff for artist messages, not an expiry/deletion policy for a fan's own
replies, so this feature does not invent one. Current room access/readiness is
still required to use the feed. Blocked rows retain identity/time/status but
project `body = null`. Missing reply policy preserves history with
`send_ready = false`; missing message policy does not manufacture a length limit.

Authenticated raw `replies` SELECT is revoked to prevent bypass of current feed
authorization or blocked-body redaction. Service-only artist projections continue
to use their existing calling-name-only contract; no artist dashboard is added.
Historical records are not deleted by access loss, source cancellation or quota.

## Serialization and verification

The write lock order is actor, current name/legal policy, artist, subscription,
message policy, reply policy, then optional target. This serializes restrictions,
readiness changes, subscription/access, policy changes and target cancellation.
Unrelated fans do not share a counter lock. Page reads use current authorization
without manufacturing read receipts, points, analytics events or delivery.

`supabase/tests/fan_replies.test.sql` covers policy absence/approval, capabilities,
immutable retries, target binding, actor isolation, length/moderation, quota,
current authorization, redaction, retention and cursor ties. Existing lifecycle
and raw-read assertions are adapted without deleting their original invariants.
`scripts/test-reply-concurrency.mjs` adds fifteen independent real PostgreSQL
multi-session scenarios with lock-wait evidence; its fictional local fixtures are
reset afterward. It has no hosted connection argument or provider calls.

Local Docker is unavailable: migration reset/lint, pgTAP, multi-session execution
and genuine generated types require isolated CI. Syntax/lint/source inspection
are not reported as database execution. No generated type is handwritten. This
ordinary reply correctness work does not retry the prior blocked media security
review or imply that its incomplete final sign-off has been completed.
