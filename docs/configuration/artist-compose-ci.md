# Artist composer integration checks

`npm run test:e2e:compose` is a dedicated CI-only suite. It requires the exact
loopback application and Supabase origins, the guarded Auth fixture setup, and
`COMPOSE_LOCAL_E2E=true`. The fixture helper writes only that flag; it rejects
hosted project credentials, remote Docker contexts and inherited activation.
The ordinary browser suite excludes this directory. The fixture tests run
Playwright `--list` only to verify exclusion and explicit dedicated discovery;
those checks never start a browser, application server or database.

The dedicated job starts disposable local Supabase Auth/Postgres/Storage and the
actual application build. It uses fictional accounts, artists and policy rows,
plus the existing generated tone/solid-color media assets. No hosted projects,
real artists, real user media, provider service, invitation, deploy or production
policy change is involved. Traces are disabled so session cookies, draft text,
local recordings and signed upload/read capabilities do not enter trace files.

Coverage includes artist-menu navigation, ownership versus shared membership,
current access revocation, private draft metadata, server-only name preview,
field validation, draft pagination, refresh/history/discard flows, save replay and
revision conflicts. Normal accepted-format uploads exercise image resizing,
voice/video files, current attachment binding, lost begin/completion responses,
reconciliation/cancel races, count limits and explicit logical removal without
removing an unrelated registered attachment. These are functional checks of the
existing accepted media contract, **not** a replacement or retry of the separately
blocked independent media-security review or a new media parser/payload probe.

Speech recognition and MediaRecorder are controlled browser API-contract stubs.
The recording stub emits the existing synthetic tone and never requests a real
microphone grant or records a person. Successful tests do not establish device,
codec, browser permission UI or real microphone quality. Real-device recording
and hosted staging checks remain separate prerequisites.

The UI matrix covers normal/large/xlarge text scales at 360px and 1280px and
captures name validation, text preview, saved draft, photo preparation, saved photo, recording
disclosure, active/finished recording, video authoring/file preparation and the
actual artist menu reached by navigation.
Additional screenshots cover protected media, the unsaved-change dialog, actual
Next/First links in a 51-assigned-artist menu, and the foreign-owned-draft error
recovery link back to the artist menu (narrow/xlarge).
Screenshots require normal visual inspection after actual CI execution. A passed
`--list`, fixture test, typecheck or build is not a browser/visual pass.

This feature intentionally stops at draft authoring, saving and preview. It does
not implement immediate/scheduled dispatch, an outbox sender or a cancellation
window, and its checks assert that authoring leaves messages as drafts.
