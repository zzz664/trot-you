# Fan chat database boundary

The chat projection adds no operating policy, subscription, payment, reply,
notification, or analytics default. It reuses the approved message/history policy,
current onboarding/name/legal policy, and existing paid-access predicate.

## Capabilities

- `fan_chat_page(actor_id, artist_slug, limit = 30, before_sent_at = null,
before_id = null)` is executable only by `service_role`. The actor must come
  from verified server Auth, never the request. It returns one context row with
  artist metadata, a validated calling name, paid access, a bounded message page,
  visible personal read count, and `has_more`.
- The trusted row contains templates for the existing canonical server renderer.
  Templates, calling-name context and database-only artist identity must not be
  forwarded through application DTOs without deliberate projection. No raw
  template capability is added to `anon` or `authenticated`.
- `fan_chat_mark_read(artist_slug, message_id)` is authenticated self-service.
  `auth.uid()` is the only subject; callers cannot supply timestamps or counts.
  The existing `mark_message_read` primitive owns immutable receipt insertion.

The page default of 30 and maximum of 100 are request pagination bounds, not
policy activation. A runtime `app_settings` table does not yet exist; no value is
silently inserted or treated as approved history policy. Callers may explicitly
supply a validated page size while the DB applies the hard bound.

## Visibility and counting

A paid page requires complete current fan readiness and full onboarding. An
active artist with a valid fan but no current subscription access returns a
context with `has_access = false`, empty messages, zero count, and no next page;
the application may show its separate preview flow. Expired, canceled-after-paid-
end, and expired-grace subscriptions cannot use old read receipts as access.
Canceled-with-paid-time and unexpired grace preserve the existing boundaries.

Messages are current sent messages within the subscription episode history
window; drafts, future messages, canceled messages, and another artist's content
are excluded. Selected preview status does not bypass paid-history limits.
`read_count` means this actor's receipts for currently visible paid messages of
this artist. It is not a public reader count and never enumerates other fans.
Historical receipts remain available to existing refund auditing even after a
message is canceled or leaves the visible window.

The cursor is descending `(sent_at, id)`, retaining PostgreSQL timestamp
precision rather than rounding through JavaScript dates. A `limit + 1` lookahead
establishes continuation; the returned page never exceeds the requested limit.
GET/page projection never writes a read receipt. The UI must mark a message when
it is actually displayed, not merely fetched or prefetched.

## Serialization and verification

Current profile/policy/artist/subscription state is locked before projection or
read evidence. Per-actor write locks serialize concurrent different-message read
counts as well as same-message replays. Existing immutable receipt timestamps
are preserved. Artist binding is checked before the existing paid-read primitive.
Page projection intentionally does not take message-row locks: another fan's
uncommitted receipt must not block this actor's independent page/read-count
snapshot. Artist cancellation still serializes through the shared artist lock.
Explicit sent/time predicates allow the existing partial sent-order index to
support the cursor query; this is not a benchmark or production latency claim.

`supabase/tests/fan_chat.test.sql` exercises capability grants, current readiness,
paid/grace/history gating, stable cursor ties, template-only server input,
personal receipt/count semantics, and historical evidence retention. Existing
RPCs and fixtures are unchanged. `scripts/test-chat-concurrency.mjs` runs thirteen
real multi-session cases against a disposable local Supabase database and resets
its fictional fixtures afterward. It never targets a hosted project.

Local Docker is unavailable in the implementation workspace: migration, pgTAP,
races, lint, and genuine type generation require the existing isolated database
CI gate. Static source checks are not reported as PostgreSQL execution. Existing
media authorization/signing is reused, not changed or independently re-reviewed
by this feature.
