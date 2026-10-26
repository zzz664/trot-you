# Community comments and likes

Feature 35 adds authenticated comments and desired-state likes to an available fan
board post. It does not add report/moderation screens, approve operational policy,
activate rewards, send notifications, or make provider/deployment changes.

## Database boundary

All interaction RPCs use the existing current-account, onboarding, restriction,
artist availability and explicitly configured community-policy checks. Reads and
writes require READ COMMITTED. Actor, artist and parent-post locks serialize with
existing community writes and visibility changes before fresh authorization is
used. Hidden/deleted posts do not return interaction data; hidden/deleted comments
are omitted. Public data contains author calling names, not profile identifiers or
like-member lists.

Visible comments are paginated oldest first by `(created_at, id)`, preserving
PostgreSQL microseconds and a deterministic tie-breaker. Current aggregate counters
and the requesting account's liked state are read with the page, not synthesized
from client state. Existing counter, rate, text validation and approved reward
mechanisms remain authoritative; this feature does not introduce policy defaults.

Comment revisions are additive, increase for legacy as well as new updates, and
protect owner edits/deletions from overwriting an intervening change. Mutation
receipts reuse private immutable board operations and bind the complete original
request to its actor and operation ID. A like request sets a desired boolean; it is
not a toggle. Retrying an old successful receipt never replays a state transition
or overwrites a newer opposite like choice. Fresh reads determine current counts.

## Runtime verification

Use the isolated local/CI fixture scripts only with the disposable local Supabase
stack. Do not point race, upgrade or browser fixtures at a hosted project. Both
pgTAP passes, all existing independent-session races and populated upgrades remain
required alongside the added feature gates. The pre-feature upgrade includes
existing posts, comments, likes, images, immutable receipts/reservations, reward
and operational data; no previous data may be rewritten except the explicit
additive comment revision default.

Generated schema types must come from the official pinned CLI against the actual
migrated Supabase database. A passing static contract or browser test discovery is
not database/browser execution. Missing API keys or operational policy must be
reported as setup unavailable, never as mock success.

## Application behavior

The existing post detail embeds a separate actor-bound interaction view. Each
successful interaction read is tied to the exact freshly authorized parent
snapshot. Revalidation hides stale comments before a new snapshot is accepted;
current access denial also removes the parent post and protected image view.
Comment pages replace rather than append old snapshots, and explicit first/next
controls use the server cursor.

All mutations send their immutable operation ID and exact original content or
desired like state. The UI does not optimistically invent counts. A timeout,
aborted response or unknown outcome freezes the original intent and exposes an
explicit same-request recovery action, including after parent refresh. Switching
the mounted account/target destroys the old private draft; a server-session swap
cannot replay it under another identity because the original actor header must
still match current authentication. No private drafts or receipts are persisted in
RSC payloads, URLs, browser history or client storage.

Comment deletion requires confirmation. Cancel, focus/navigation revalidation and
Back/Forward dismiss transient editors/dialogs without an automatic write. After a
confirmed mutation the parent detail refreshes too, because atomic counter updates
also advance its revision. Existing post deletion/notice controls are blocked
while an interaction intent is pending, preventing conflicting local actions.

The new isolated browser suite uses fictional accounts, comments and likes only.
It covers all three text scales at 360/1280 widths, full-page and offscreen controls,
actual lost-response recovery, owner conflicts, authority/visibility changes,
pagination and navigation. Real upstream mutation bodies are captured before
forwarding; no synthetic successful response substitutes for integration.
