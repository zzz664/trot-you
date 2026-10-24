# 2026-10-24 — Artist message authoring

## Scope and decisions

- Implemented original document sections `03 §3.5`, `05` artist compose route and
  accessible UI rules, and `07` artist-authoring scope. Private originals remain
  outside the repository.
- Added current-role artist menu, owned draft creation/edit/recovery, text/photo/
  voice/video kinds, policy-based field limits and server-only `{이름}` preview.
- Reused the approved secure media APIs for bounded photo re-encoding, upload,
  completion, retry, revocation, logical attachment removal and protected views.
  No Storage path, original filename or bearer grant is persisted in client
  storage. Draft bodies remain server-side except current in-memory editing.
- Added explicit native MediaRecorder capture disclosure/start/stop/cancel,
  resource/track cleanup and file fallback, plus the existing disclosure-based
  MicButton for text dictation. Artist dictation does not masquerade as a fan
  reply analytics event.
- Kept one feature branch and a draft PR to develop. Early immutable DB
  checkpoints include rollback tests, independent-session races, compatibility
  documentation and CI type generation. Generated schema types are never
  handwritten.
- This feature deliberately ends at **save/preview**. Immediate/scheduled
  dispatch, notification outbox production, delivery and the post-send cancel
  window are the next separate feature. There is no enabled fake send control.

## Reliability and review

- Immutable operation keys and exact resource/revision/media binding prevent
  repeated or stale writes from silently changing a newer draft. Replay is
  reconciled against current context before editing resumes.
- Upload cancellation and completion may race. Cancellation never deletes
  registered current media; the refreshed draft tells the user what actually
  completed. Lost upload responses retain the same intent, not a new upload.
- Refresh recovers saved drafts and owned pending upload IDs without retaining
  browser Blob bytes, filenames, credentials or raw bodies in browser storage.
- Current role, membership, restriction, artist state, policy and original owner
  are rechecked at authoritative boundaries. Access loss clears the editor and
  protected media. Legacy `/artist` session redirect behavior is preserved.
- A focused read-only composer contract review found no remaining confirmed
  blocker. It identified a stale expiry display during lock waits; the new
  projection uses a wall-clock check and an independent-session regression.
  This review was not the previously blocked independent media-security review.

## Verification status

- Local focused service/DB-adapter/HTTP/body/page/capture and UI tests pass.
- The latest full unit snapshot passed **4,656 tests in 142 files**. This is a
  local unit result, not a database/browser/staging result.
- Full local `npm run check:all` passes after genuine type integration: ESLint,
  Prettier, strict types, all unit tests, 10 contrast pairs and the production
  Next/PWA build. An earlier pre-artifact run stopped honestly at the four new
  RPC names and did not claim later aggregate stages passed.
- Genuine `database.ts` came from CI run `40133772292`, artifact `12576536684`,
  exact head `819888eacda5990c67ea86f41b9e9506bd00dd0c`, tree
  `19915e67ed5fdc8a929fca4a02edf20e168690f2`. The unchanged file SHA-256 is
  `4398134217fbfd4d651f2605697e132ba4cbff9b8eb32285915161fa56df4dba`.
  The artifact ZIP digest and single-member CRC were also verified before import.
- **17** fixture/discovery guards pass. Generic Playwright discovery lists
  **27** tests and excludes the **37** dedicated compose tests. Discovery uses
  `--list` only and launches no browser/server/database.
- Checkpoint CI passed `db:lint`, **2,960 pgTAP assertions in 31 files twice**,
  and **244 independent-session checks** (225 prior + 19 composer). This includes
  all 83 new rollback-only compose assertions. Genuine generated-type typecheck
  passed; only the intentionally stale committed-type diff failed at bootstrap.
  All ten other checkpoint jobs passed (4,366 units, 97 fixtures, 331 browsers).
  These establish compatibility of the DB checkpoint, not the new UI browser
  integration. Local Docker remains unavailable.
- Authored browser checks cover current Auth/Postgres/Storage, synthetic normal
  uploads, validation, replay/conflict, refresh, interrupted/canceled flows and
  three text scales at 360px/1280px. **74** screenshots are planned for actual CI
  and normal visual inspection; they have not yet been captured/reviewed.
- Local browser execution was previously denied and was not retried/escalated.
  Actual browser CI and screenshot review remain required before completion.

## Boundaries retained

No real artist/account invitation, user media, microphone capture, provider
request, secret edit, hosted project, deployment, operational policy activation,
notification send or money movement occurred. Synthetic MediaRecorder/speech
contract stubs do not prove device/browser codec support. Existing secure-media
limitations and the blocked independent media review remain explicitly retained
in [the media contract](../configuration/media.md). Hosted staging, native-device
capture and approved production policy/cleanup controls remain separate gates.
