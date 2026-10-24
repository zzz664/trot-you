# Private media upload and read access

## Scope and setup

This feature implements resource-bound **message media** upload/finalization,
read signing and artist-discovery preview rendering. Board media, avatars,
artist-composer screens and the paid chat UI are separate consumers/features;
there is no arbitrary bucket/path upload endpoint.

Use the configured Supabase project URL, public key and server-only
`SUPABASE_SERVICE_ROLE_KEY`. Apply migrations through
`20261024000018_media_access.sql`. Both `message-media` and `media-quarantine`
must remain private; the migration denies direct browser reads, lists, inserts,
updates and deletes, even if a later permissive policy is accidentally added.
Only the server's narrow Storage adapter holds the service credential.

The approved `private.message_policy` snapshot is required. Missing policy fails
closed; this feature does **not** seed or approve operational values. Upload byte
caps, durations, photo count, history and previews use that current snapshot.
Do not paste test-fixture policy SQL into a hosted project as approved settings.
No hosted upload, deployment or production policy activation is performed by a
successful build or local CI run.

The completion route runs in Node.js. `sharp@0.35.5` is a pinned direct runtime
dependency. `mediainfo.js@0.3.8` ships its own local WASM parser and
`mediabunny@1.62.1` supplies bounded full packet traversal; no system FFmpeg,
external probe service or runtime download is required. Next externalizes the
MediaInfo package and traces `dist/MediaInfoModule.wasm` into media route output.
Check that file and the Sharp platform binary are in the actual deployed bundle.
A missing/unloadable WASM module returns unavailable without permanently
rejecting the upload. The package's documented
[WASM loading requirements](https://mediainfo.js.org/docs/getting-started/installation/)
apply to other hosting/bundling setups.

## HTTP and reusable client contract

All four endpoints use same-origin authenticated `POST` with `application/json`;
query-string parameters and additional body fields are rejected. Responses use
`{ok:true,data:...}` or an allowlisted `{ok:false,code}` without provider details.

| Route                   | Body                                    | Successful data                |
| ----------------------- | --------------------------------------- | ------------------------------ |
| `/api/media/upload-url` | `requestId,messageId,mimeType,byteSize` | `uploadId,uploadUrl,expiresAt` |
| `/api/media/complete`   | `uploadId`                              | `mediaId`                      |
| `/api/media/revoke`     | `uploadId`                              | `null`                         |
| `/api/media/signed-url` | `mediaId,preview`                       | `url,expiresAt,kind,mimeType`  |

Only current artist members/admins can manage uploads. Read authorization is
resource-specific; choosing `preview:true` never makes a non-preview public.
Begin retries reuse the same request ID and exact payload. Completion retries
return the already registered media ID; a completed upload cannot be “revoked”
as if registration had been undone. Revoking a pending/expired/revoked intent is
idempotent and does not delete a registered final object.

`src/client/media.ts` exposes separate begin, signed `PUT`, complete, revoke and
read helpers. Keep the upload ID for recovery; no helper automatically retries a
write or finalizes after an uncertain upload result. Use canonical base MIME
values (for example `audio/webm`), not filename extensions or unvalidated codec
parameter strings. The server independently verifies actual bytes and codecs.
Future composer/chat consumers should use these helpers and ID-based grants,
not a new direct Storage client or a URL stored in message content.

## Upload protocol and trust boundaries

1. An authenticated, unrestricted artist member/admin begins an upload for an
   owned draft message. The server validates the requested MIME and declared
   bytes, reserves a slot atomically, and chooses random resource-bound paths.
2. The response contains an upload ID, exact signed quarantine URL and the
   **application intent deadline**. The browser sends bytes directly to Storage;
   it does not send a bucket, actor ID, destination path or storage credential.
3. Completion rechecks the current actor, membership, draft and policy, downloads
   only that quarantined object with a streaming byte bound, checks actual byte
   count against the reservation, probes the bytes, and rechecks authorization.
4. Verified bytes are uploaded with `upsert:false` to a separate final path. The
   database atomically binds that object to the media/message and consumes the
   reservation. Lost-response retries only reuse an existing final object after
   exact byte hash, MIME, path and size comparison; they never overwrite it.
5. Quarantine cleanup is best effort. A revoked, expired, malformed or abandoned
   upload cannot become readable media simply by existing in Storage.

Supabase signed upload capabilities last **two hours**, not ten minutes. The
application's intent expires after ten minutes and finalization then fails, but
it cannot revoke a previously issued Storage upload token. Deleting a
quarantined object also does not revoke its token: a holder may recreate that
same private object while the token is valid. It still cannot promote or read
those bytes. This distinction follows the official
[signed-upload contract](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).

Storage enforces a technical 100 MiB bucket ceiling. Per-kind lower limits and
the exact declared size are enforced before signing **and again after upload**;
a bearer upload URL does not itself bind the uploaded bytes to the declared
length. A dishonest uploader can therefore consume quarantine capacity up to the
bucket ceiling before completion rejects the bytes. Resource slot reservations
prevent simultaneous over-count finalizations, but are not a substitute for
production abuse/rate, storage-cost and cleanup controls.

## Byte validation and supported media

- JPEG, PNG and WebP: correct signature, bounded dimensions/pixels, strict Sharp
  decode, and same-format re-encoding. Images are auto-oriented; EXIF/GPS and
  appended input bytes are not copied. Animated/multipage input is rejected.
  [Sharp's input safety controls](https://sharp.pixelplumbing.com/api-constructor/)
  are applied before full image processing.
- MP3: MPEG Audio track; M4A/MP4 voice: AAC-LC; WebM voice: Opus/Vorbis.
- MP4 video: AVC/H.264 with optional AAC-LC audio; WebM video: VP8/VP9/AV1 with
  optional Opus/Vorbis audio. Native browser codec support still varies.
- Audio/video use actual byte signatures plus a bounded local WASM
  container/track probe, not client duration or filename. There may be one audio
  track and at most one video track as appropriate. Attached images, subtitles,
  menus, unknown tracks and encryption are rejected. MP4 external data
  references/reference movies and malformed box boundaries are rejected; no
  parser callback accepts a network URL or filesystem path from media bytes.
- Every encoded packet is traversed from the private in-memory buffer with a
  packet-count, byte-work and wall-clock bound. The largest presentation end
  timestamp and per-track total packet duration are compared, not a container's
  duration/index hint. Opus frame timing comes from its packet TOC; AAC-LC has a
  sample-count timing floor. Container/source/frame/sample durations can only
  increase that conservative result. Stale MP3 Xing durations, late WebM clusters
  and out-of-order late MP4 presentation timestamps have explicit regressions.
  Completed live-style WebM with no InfoDuration is accepted when actual packet
  timing is measurable. Unsupported MP4 edit lists/rates are rejected instead of
  silently approximated. See the official
  [packet reading API](https://mediabunny.dev/guide/reading-media-files).
- Unknown packet timing and any nested truncation/conformance warning/error fail
  closed. The current policy's duration and byte limits are rechecked. Parser
  logs are disabled to avoid leaking input metadata.

**Audio/video container probing and full packet traversal are not every-frame decoding, transcoding, antivirus
or content moderation.** Some structurally plausible but damaged encoded sample
payloads can pass a probe and packet scan and subsequently fail native playback. The pinned
MediaInfo JS API does not expose native `ParseSpeed`; its `full` option displays
internal tags rather than enabling full decoding. See the official
[factory options](https://mediainfo.js.org/api/interface/MediaInfoFactoryOptions/).
Requiring full decode/transcode or malware/content scanning needs a separately
reviewed bounded processor; do not describe this implementation as providing it.

## Read authorization and expiry

Read requests take a media ID plus preview mode, never a raw Storage path. The
database resolves the exact message/object association and rechecks active
artist state, message state, restrictions, membership or paid access/history.
Only currently selected previews bypass paid subscription access. Actor-specific
signing is checked again after the Storage response.

Read capabilities last at most **60 seconds**, further bounded by paid/grace
access expiry. The server reads the trusted provider token's actual expiry and
rejects a capability extending past current entitlement; decoding that claim is
not used as authentication or signature verification. Supabase verifies its own
signature when the URL is used. The official
[read-signing API](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl)
and [Storage signing implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts)
define this bearer-URL behavior.

Restriction, cancellation, preview removal or membership revocation prevents a
**new** grant, but cannot instantly revoke an already disclosed signed URL. An
existing URL can remain usable until its short expiry. Already delivered bytes
can be saved by the recipient; this is access control, not DRM. The final objects
use `cacheControl:'0'`, API responses are private/no-store, and UI media state is
cleared at expiry/logout/unmount. Storage token expiry and object caching are
separate mechanisms, as described in the official
[Storage CDN guide](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

## Verification and production prerequisites

Unit tests use the real pinned image/WASM parsers and the real Supabase SDK with
an injected HTTP transport. Synthetic tone/solid-color fixtures are documented
under `tests/fixtures/media/README.md`. These are not production content.

The dedicated `test:e2e:media` CI suite builds and starts the actual application
against disposable local Supabase Auth/Postgres/Storage, uploads real bytes,
completes all supported format families, signs and fetches objects, checks direct
RLS denials and malformed content, and exercises preview UI at three text scales.
A mocked HTTP success or a build alone is not proof of this integration.

Before production, separately approve and implement retention/cleanup for expired
quarantine intents, tokens that may recreate private objects for two hours,
failed-promotion orphan final objects, and completed intent records. Never delete
registered final media as an indiscriminate orphan cleanup. Establish abuse
quotas, monitoring, policy approval, bucket configuration, and hosted staging
verification with authorized content. This feature does not silently schedule a
cleanup job or enable a hosted project.
