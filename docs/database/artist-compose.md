# Artist-owned draft authoring

> Follow-on message publication is implemented separately in
> [message dispatch](../configuration/message-dispatch.md). Saving or uploading
> a draft alone still never publishes it; the current composer has a separate
> explicit-confirm publication flow.

This feature implements **drafts only**. It does not schedule, send, dispatch,
create a notification outbox job, or expose a cancellation window. Those remain
a separate delivery feature. No operational policy or real artist content is
seeded by this migration.

## Authoritative access and safe projections

The authenticated RPCs derive the actor only from `auth.uid()`. Every call
requires the current, unrestricted **artist** role. Administrator and fan roles
are not artist impersonation capabilities. Active artist state and current
membership are checked under locks at the resource boundary.

- `artist_compose_artists(after_slug?)` returns at most 50 assigned active artists,
  ordered by slug, with `has_more`. Each artist has only `id`, `slug`, and `name`.
- `artist_compose_context(artist_slug, message_id?, before_updated_at?, before_id?)`
  returns an artist, current policy limits, at most 30 own drafts, `has_more`, and
  an exact optional `selected_draft` independently of the paged list. Both cursor
  components are required together; timestamps retain their full DB precision.
- Drafts expose `id`, `kind`, raw author-owned `body`, `revision`, `updated_at`,
  `media`, and `pending_upload_ids`. Media expose only logical ID, kind,
  dimensions and duration. Pending upload IDs belong to this owner/draft and are
  unexpired; they permit recovery through the existing authorized API, not direct
  object access. No filename, Storage path, object ID, key, token, owner profile,
  agency data, or fan identity is projected.

The raw draft template is appropriate only for the verified author editor.
Recipient previews still use the canonical **server-side** `{이름}` renderer;
the browser does not perform personalized substitution.

## Policy and validation

Current `private.message_policy` values supply text length, photo count,
audio/video duration and kind-specific byte limits. Current approved profile
name policy supplies sample-name length bounds. Missing or unapproved policy
fails closed rather than activating document defaults. The policy JSON does not
expose the private forbidden-word list. Message length is measured in Unicode
scalar characters in PostgreSQL, matching application validation. Nonempty
content is required for text; media drafts may have null captions. Whitespace is
preserved, but whitespace-only bodies and C0 controls except tab/LF/CR, plus DEL,
are rejected. Upload byte/duration validation remains the existing media API's
responsibility, not a client declaration.

## Ownership, revisions, retries and media

A private registry marks only drafts created by this composer as individually
owned. Pre-existing collaborative draft APIs retain their previous behavior.
New owned drafts cannot be edited through the legacy save API, and non-owner
artist members cannot read their raw rows, sign their draft media, or upload into
them. The existing administrator read/moderation authority is unchanged; no
administrator compose UI is added.

`artist_compose_save` takes a stable client-created message UUID, stable operation
UUID, expected revision, kind, exact body, and the exact set of current media
IDs. A SQL caller may omit a null body or the empty media set; nonempty existing
media still require the exact current IDs. Revision zero means create. Subsequent writes compare-and-swap the current
revision; successful saves advance it once. Media association and removal also
advance it, so an in-flight upload cannot silently change the resource beneath a
stale save. A type change requires no linked media and no current pending upload.

The private operation registry binds each actor/operation UUID to its complete
request, including resource, revision and media set. Exact retries return the
**accepted response snapshot** without reapplying it. A reused key with a changed
request is rejected. Current role, restriction, membership, draft ownership,
status and policy are checked even for replay. The UI must refresh current
context after a replay or an uncertain response before another mutation; the
accepted historical snapshot is not a license to overwrite a newer revision.

`artist_compose_remove_media` performs an explicit revision-checked logical
unlink. A completed upload intent is revoked in the same transaction, preventing
later completion retry from resurrecting the association. The Storage object is
**not deleted**. Current-object retention and orphan cleanup require separately
approved policy; this feature never removes registered final bytes as a generic
cleanup.

Lock order is actor profile, artist, membership, message/owned-draft registry,
policies, then operation/upload state. Authoring locks the actor for update so
operation keys are serialized across their different assigned artists. Existing
media API author checks use the compatible prefix. Independent PostgreSQL
sessions cover both winners of save/upload/type/removal ordering and access loss.

## Verification boundary

`supabase/tests/artist_compose.test.sql` uses rollback-only fictional identities,
policy snapshots and Storage metadata. `scripts/test-compose-concurrency.mjs`
uses independent sessions against the explicitly guarded disposable local
Supabase database, then resets it. It never accepts a hosted URL or loads
application/provider credentials.

These tests exercise the **existing accepted media API contract**, not a new
media parser/security review. The previously blocked independent media review
has not been retried or replaced. No actual media payload probing, real-user
recording, hosted policy activation, dispatch, invitation, provider call or
production deployment is performed here.
