# Fan text replies

## Available flow

The existing `/artists/[slug]` paid room includes a text composer and this fan's
own sent-reply history. It is not realtime chat and does not promise that an
artist read or answered a reply. Artist reply dashboards and speech input are
separate features. Only the current fan's own text is projected; no other fan's
name, identity or reply appears.

The composer reads the current length bound from the database rather than a
hardcoded product value. Character counts use Unicode code points, matching
PostgreSQL character length rather than UTF-16 units. The database validates the
actual value again at send time. Text is rendered literally, never as HTML or
links. Inline errors preserve the in-memory draft; closing/reopening the composer
also preserves it. Navigation, session/access loss and page hiding clear private
state. Drafts are not written to browser storage or service-worker caches.

Each submission obtains one UUID associated with the exact artist/body/optional
message. Pending clicks are guarded synchronously. An uncertain response freezes
that payload and offers explicit same-key retry, not an automatic new submission.
A successful receipt deduplicates own history and clears the draft. A retry is
not proof of delivery until its authoritative receipt arrives. Refresh/older
paging is paused while the submission outcome is unresolved. Navigating away
never resends a draft; the next visit fetches the authoritative own history.

## HTTP and database boundary

- `GET /api/artists/[slug]/replies?cursor=&limit=` accepts only a canonical
  room-bound cursor and integer limit 1–100. Unknown/duplicate fields fail.
- `POST /api/artists/[slug]/replies` requires configured same-origin and a strict
  JSON object `{ operationId, body, messageId }`. `messageId` may be null for an
  artist-directed reply, which is the current composer behavior. If supplied,
  the database requires the message belong to that artist and be currently
  visible to this fan. Browser-supplied actor/access/count fields are rejected.
- All requests verify the session and use an actor-scoped database client. The
  authenticated SQL wrappers derive ownership from `auth.uid()`; no service key
  is used to impersonate an actor in this feature's write/feed path. Responses
  apply private/no-store headers and refreshed cookies.
- Limits, moderation, eligibility, idempotency and rate reservations are decided
  atomically in the database. Validation failures spend no quota. Accepted replay
  spends no extra quota and does not depend on later moderation/message changes,
  but still requires current fan readiness and subscription access.
- History uses exact database timestamps and UUID tie-breaks. Own replies remain
  retained, including prior subscription episodes; the source does not specify
  their deletion/expiry. Current access is still required to view the feed.
  Blocked rows retain identity/time while redacting their content.

See [the database contract](../database/fan-replies.md) for exact RPCs, grants,
policy fields and supported detectors. No operational `app_settings` editor or
approved production moderation list is silently fabricated.

## Configuration and verification

Existing Supabase/Auth, onboarding/message policy and eligible artist/subscription
configuration are required. A separately approved private reply-policy snapshot
must contain the selected bounded detector identifiers, approved literal terms
and rate window/count before sends are enabled. Missing/invalid policy leaves an
honest unavailable composer; there is no mock success or permissive fallback.
Operator approval of detector coverage and the actual word list remains necessary;
finite pattern detectors are not claimed to identify every disguised contact or
abusive phrase. No operational policy is activated by migrations or application
startup.

`npm run test:e2e:replies` runs only under the isolated disposable Supabase CI
guards. Default browser collection excludes these fixtures; `--list` proves
collection only, not execution. Fixtures are fictional and use local Auth/SQL,
never hosted credentials, outside provider calls or real user messages. The
[work log](../work-log/2026-10-24-fan-replies.md) records checks against exact
commits, genuine schema artifact evidence and remaining verification limits.
The earlier blocked media re-review remains incomplete and is not superseded by
reply functional testing. Production operation and deployment are not verified.
