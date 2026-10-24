# Fan chat viewing

## Available flow

`/artists/[slug]` keeps the established artist route. A current, fully onboarded
fan with paid access receives the first 30 eligible messages from the server;
other eligible fans retain the existing free preview flow. The subscription list
also provides a direct room link when its current summary reports access. Every
room/API request independently rechecks current identity and database eligibility;
a link or stale client flag never grants permission.

The room shows newest messages first and explicitly loads older cursor pages.
This uses a visible, keyboard-accessible button rather than mandatory infinite
scroll: it preserves the documented cursor contract while keeping navigation
predictable at the three text scales. Refresh starts from the latest page. Empty,
loading, retry, expired-session/access, canceled-message, Back/Forward and repeated
click paths have distinct handling. Replies, send controls, live push, realtime
subscriptions and analytics collection are not part of this viewing feature.

## Server boundaries

- `GET /api/artists/[slug]/messages?cursor=&limit=` accepts only the optional
  cursor and integer limit (1–100). Duplicate/unknown query fields fail closed.
- `POST /api/artists/[slug]/messages/[messageId]/read` requires configured
  same-origin, authenticated current fan readiness and a strict empty JSON object.
  The path identifies artist/message; the browser supplies no actor, read time,
  receipt count, role, subscription flag or personalized name.
- Both use private/no-store responses. Service credentials and raw templates
  remain server-only. The canonical `renderMessage` produces plain text; React
  text nodes render markup-like content literally. No client interpolation or
  HTML injection API is used.
- Cursor payloads preserve full PostgreSQL timestamp precision and UUID ties,
  are canonical base64url, and bind to the requested artist slug. They are
  pagination positions, not authority or encrypted secrets. All cursor requests
  repeat authorization and history filtering.
- `SecureMedia` is reused with `preview=false` for paid attachments. Its existing
  resource-authorized short-lived signing flow controls actual byte access;
  listing a media ID never grants access itself. This feature does not re-review
  or change that implementation.

The [DB contract](../database/fan-chat.md) documents role grants, visibility,
current legal/profile policy checks, and personal read count semantics. Existing
paid-period and grace/history policies remain authoritative. No runtime policy
is silently activated, including the still-unimplemented `app_settings` editor.
The default page size 30 is a documented technical request default.

## Read evidence and lifecycle

Server rendering and API page fetches never mark messages read. A visible card
in a visible document requests its idempotent receipt through IntersectionObserver;
an explicit per-card read button remains available as fallback. The UI does not
claim a receipt until the server returns its original authoritative timestamp.
Unknown acknowledgements can retry the same resource, not fabricate success.
Other fans' identities/counts are never shown.

Requests are bounded and abortable. Unmount/newer navigation drops stale results;
terminal auth/access failures remove the retained paid display. The room does not
write chat data to localStorage or service-worker caches. Already viewed text is
not remotely revocable, and this is not a realtime cancellation-notification
service. Refresh/new requests observe current state.

## Configuration and verification

Uses the existing Supabase Auth/public key and server-only service-role key.
Current approved onboarding and message policy records, eligible artists and
actual sent messages must exist through authorized operating workflows. Missing
configuration/policy returns a preparation state, never fixture success.

`npm run test:e2e:chat` is a dedicated disposable-local-Supabase CI suite. Its
configuration rejects normal/local/hosted execution unless all isolated CI guards
are present. The default browser suite excludes its directory. Fixture helpers
create only fictional local identities/content and do not call real payment,
notification, email or deployed services. `npm run test:chat-fixture` validates
those guards without external I/O. Collection is not browser execution.

Full regression, genuine generated types, actual PostgreSQL races and three-scale
browser screenshot review are recorded against the exact application head in the
[work log](../work-log/2026-10-24-fan-chat.md). Local Docker and browser sockets are
unavailable and are not bypassed. The prior media independent re-review remains
incomplete after its recorded runtime block; normal chat testing does not replace
or imply that sign-off. Production operation/deployment remains unverified and
requires separate authorization.
