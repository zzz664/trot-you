# Artist message draft authoring

This feature provides `/artist` assigned-artist navigation and
`/artist/[slug]/compose` for text, photo, voice and video drafts. Saving is **not
sending**: immediate/scheduled dispatch, outbox production, delivery and the
post-send cancellation window belong to the next feature. No scheduler or live
policy is enabled by this change.

## Authority and persistence

Every page and POST independently verifies the server session and artist role.
Actor-bound RPCs use `auth.uid()` and recheck active artist membership,
restriction, original draft ownership and current approved policy. Neither a
request role nor a supplied actor ID grants access. The composer registry scopes
new owner-only drafts without changing the collaborative behavior of older
service-authored drafts.

A caller-generated message UUID survives creation retries; a separate immutable
operation UUID binds the complete action, resource, expected revision and media
set. SQL serializes and checks revisions, and replay returns the original
accepted receipt without overwriting newer work. The UI refreshes the current
projection before a later edit. Media association and removal change revision;
other-resource media IDs, stale edits and kind changes during pending uploads
are rejected. Draft data stays on the server; the client does not place bodies,
filenames, Blob bytes or bearer grants in browser storage.

Current policy supplies text length, photo count, per-kind bytes and duration,
and sample-name length. Document examples (1,000 text characters, 10 photos,
180-second voice and 60-second video) are not silently activated production
settings. Text/caption preview uses the existing server-only `renderMessage`
implementation for `{이름}` and returns plain text, never HTML or fan identities.

## Media authoring

Photos are bounded before browser decode, resized for upload, and encoded without
copying source metadata. The trusted existing media service independently
validates accepted bytes. Voice authoring uses the native `MediaRecorder` /
`getUserMedia` contract only after an explicit disclosure and Start action;
tracks and Blob URLs are released on cancellation, navigation, access loss and
unmount. Capture support, container and codec vary by browser; a labeled file
picker remains available. Text dictation reuses the existing `MicButton` with
its separate browser/provider disclosure and does not submit a draft.

The client uses the existing private upload-intent, completion, revoke and
short-lived read APIs. It never registers a client-selected Storage path or
metadata. Only owned, unexpired pending intent UUIDs are exposed for recovery;
refresh can show already-completed attachments or allow abandoning a pending
upload. Removal only unlinks that exact draft association and revokes its
completed intent. It does **not** delete registered Storage bytes.

The existing [media contract](media.md) and limitations still apply: short-lived
bearer grants are not instant revocation/DRM; audio/video packet inspection is
not every-frame decoding, antivirus or moderation. The previously blocked
independent media-security review was not retried or replaced by this work.

## Verification boundary

Unit tests cover schemas, actor/HTTP boundaries, private DTO projection,
idempotency receipts, server-only preview, capture cleanup and interrupted UI
flows. Dedicated `test:e2e:compose` is isolated from the generic browser suite;
its discovery guard invokes `--list` only. Actual browser CI uses disposable
local Supabase Auth/Postgres/Storage and existing synthetic fixtures. Microphone
and speech are controlled contract stubs, not real user recordings or external
speech providers. CI screenshots cover the three text scales on narrow and
desktop viewports. These checks do not prove native iOS/Android capture or
hosted staging operation.

No real artist invitation, user content, provider request, operational setting,
secret, hosted bucket, deployment, or notification send is performed.
