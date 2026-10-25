# Content calendar — 2026-10-25

## Scope and decisions

Feature 33 connects private editorial topics and reference examples to an admin
monthly calendar and read-only artist calendar with the existing current-week
activity/approved-requirements comparison. Supplied private specification sections:
database 3.8, API 3.5/3.8, frontend A-03, schedule content-calendar dashboard.
Original supplied documents are not published.

The DB checkpoint adds revision-protected entry create/update/delete, actor-bound
immutable operation receipts for explicit uncertain-result retries, audited no-op
handling, and one authorized month/activity snapshot. Existing legacy RPCs remain
compatible; any legacy/operator update increments the revision. A date slot is
created explicitly rather than silently replacing a topic. Editing cannot move its
artist/date; stale edits and duplicate dates fail closed. No new business activity
thresholds, missions, grades, or settlement policy are invented.

No message/content publishing, provider traffic, operational-setting approval,
role assignment, deployment, or Cron activation is performed by this feature.
Readiness and later real credentials remain distinct from production operation.

## DB-first verification checkpoint

- Added pgTAP lifecycle/authorization/isolation tests, 24 independent-session race
  scenarios, and a populated pre-migration upgrade preserving existing editorial
  bytes, audits, profiles, artists/memberships, schedules, settings, policies and
  notification rows. Legacy/operator revision invalidation is explicitly covered.
- Existing schedule-upgrade equality check excludes only the newly additive
  content revision, just as it already excludes the schedule revision.
- CI inserts both new DB suites before official generated-type production. The
  historical CI step baseline remains immutable; original step bytes are checked
  after removing only exact reviewed insertions. Mutation-negative tests protect
  missing, duplicated, moved or weakened verification steps.
- `node --test scripts/ci-*.test.mjs`: 153 passed at checkpoint preparation.
- New DB scripts: Node syntax checks, ESLint, Prettier passed; diff whitespace clean.
- Actual PostgreSQL/pgTAP/races/populated upgrade and official type generation are
  pending hosted CI. Local Docker/browser are unavailable; no denied socket or
  independent security runtime was retried, escalated or bypassed.
- Application files are deliberately outside the first immutable DB checkpoint.
  Full application checks and browser/pixel verification follow on the same
  feature branch after actual generated types are available.

## Application and test implementation

- Added private admin artist picker/month navigation, date topic/example CRUD,
  explicit delete confirmation, revision/date conflicts, literal reference text,
  and read-only artist month/activity views linked from the existing role menus.
- Added bounded same-origin no-store HTTP transport, exact current-account mount
  headers, strict DTO/resource/receipt binding, service and route tests. Existing
  legacy editorial whitespace is preserved on read; stricter new-write validation
  does not hide existing populated calendars.
- In-flight requests are invalidated on navigation, visibility/focus/restoration
  changes, and authority loss. Private snapshots do not enter RSC/history payloads.
  Interrupted mutation recovery preserves the exact original operation; a pending
  delete cannot silently attach itself to another row. Stale dialogs are canceled.
- Added 28 isolated browser scenarios and seven keyless scenarios. Rendered flows
  cover normal/large/xlarge text and 360/1280 widths, current-week source counts,
  existing approved requirement comparison, month/history navigation, denied and
  changed accounts, conflict/retry/unknown results, no-delivery snapshots, and
  settled full-page plus offscreen-control captures. Test discovery is not runtime
  browser verification.
- Registered the new browser in selection and aggregate inventories, preserving
  all original CI step hashes and protecting the exact reviewed gate additions.
  Schedules/activity/admin-artist dependencies select the calendar suite; new
  unclassified calendar paths continue to force full CI.
- Local evidence before official type import: all 7,598 units passed (255 files),
  all 168 selector/aggregate/workflow tests passed, all 383 fixture tests passed,
  ESLint/Prettier and contrast passed. `npm run check:all` was run and stopped at
  the four new RPC names absent from the old generated type file. Generated schema
  has not been hand-edited; final typecheck/build and rerun await actual CI output.

## Hosted verification findings before final app checkpoint

- The first DB checkpoint passed its migration, both pgTAP passes and all 24 new
  independent-session races. Its populated-upgrade fixture failed on a nonexistent
  settings table before type generation; the separate dated upgrade-fix worklog
  records the narrow harness correction and retained full-preservation gates.
- The second checkpoint exposed an existing schedules-browser observer race:
  the same-name-artist create test read `Response.json()` after real app navigation,
  when Chromium had already discarded its response body. All five remaining
  schedule observers needing bodies now use the existing real `route.fetch()`
  capture-before-forward helper. Status, strict schema, selected artist, mounted
  account header, exact destination and settled-screen assertions are retained
  or strengthened; no test is skipped and no product behavior is changed.
- After the upgrade static regression, all 7,615 local unit tests passed (256
  files). Official generated types and final app runtime/browser verification
  still awaited the complete fixed DB gate at this point.

## Genuine schema and final local verification

The fixed DB checkpoint run 40215445170 (head
`26407a4688e24131a2da1aa99ff5c699bf2f9148`) passed DB lint, all 4,230 pgTAP
assertions on each of two consecutive passes, all race gates including the 24 new
calendar cases, and the populated content-calendar upgrade. Its remaining DB
failure was the expected old committed-type drift. The official generated artifact
was independently verified (ZIP hash/CRC and exact head) and copied byte-for-byte:
`src/types/database.ts`, 90,232 bytes, SHA-256
`8c9083a5b63b517975d5482eb0e46080e217dbb44830c1eda2b947dc36d222c7`.
No generated schema was handwritten.

The new full application CI must still execute the added calendar browser and
verify final generated-type equality, all current regressions and screenshot
pixels before merge. Checkpoint SQL success is not final application/browser or
production validation.

Final local application checkpoint verification on 2026-10-25 passed
`npm run check:all`: ESLint/Prettier, TypeScript with the genuine schema, all 7,615
unit tests in 256 files, contrast and production Next/PWA builds. All 168 CI
selector/aggregate/workflow tests and all 383 fixture-contract tests passed with
zero skips. The isolated calendar suite discovers 28 browser scenarios; discovery
is not execution. Local Docker and browser execution remain unavailable under the
existing environment restriction, so hosted browser execution and full three-font,
360/1280-pixel visual review remain required, not reported as local successes.

## Independent recovery review follow-up

A read-only independent review found that the inline error Retry reloaded the
calendar but could revive a rejected editor's stale revision, unlike the main
Refresh button. The database already rejected stale writes; this was a recovery
UX inconsistency, not a lost-update permission. Both user refresh controls now
share the reset logic, while an unknown-outcome save keeps its exact frozen
operation for explicit replay. Two conflict/date-conflict regression cases failed
against the prior app checkpoint and pass with the repair; a third proves that
read retry does not resend or replace an uncertain save operation. The existing
six font/viewport browser conflict scenarios now exercise the inline Retry path.

The follow-up passed a fresh `npm run check:all` (7,618 unit tests in 256 files,
ESLint/Prettier, genuine-schema TypeScript, contrast and production Next/PWA build),
all 168 CI selector/aggregate/workflow tests and all 383 fixture-contract tests.
Hosted application/browser and pixel verification are still pending for the
resulting head.

## Final application CI and keyless observer correction

Run 40223484899 on exact remote head
`3ee35407a65b9ff4681a6536eb2ea90dee529dff` passed all 28 isolated calendar
browser scenarios. Its verified calendar artifact contained 156 PNGs: 132 complete
full-page states and 24 offscreen control captures, across all three fonts and
360/1280 widths. Review of all images, including full-resolution long-page and
form/dialog/activity detail checks, found no clipping, overlap, missing settled
panels or stale private data in revoked/account-change states.

The quality job did not pass: 77 keyless tests passed, three failed and one was
flaky at the new calendar retry observer. All 11 retained failure traces showed a
real same-route RSC GET returning 200 `text/x-component` and then Chromium marking
the stream `net::ERR_ABORTED`; `Response.body()` was unavailable. There was no
intervening document navigation or redirect, and the observed setup-error UI
remained fail-closed. The trace does not establish the internal abort trigger.
The narrow test-only repair captures the actual upstream body before forwarding,
requires the exact origin/path/query and GET/RSC header, rejects redirects, and
asserts status, RSC content type, no-store and the setup-not-ready response. Exact
URL, heading, retry control and absence of private lists/forms/activity remain
asserted after retry. Eight local observer tests cover ordering, isolation,
once-only capture and propagated assertion failure. Final hosted verification
for the repaired head is still required; the failed run is not called green.

Local verification of this observer-only repair passed `npm run check:all`
(7,626 units in 257 files, lint/format/typecheck/contrast and production Next/PWA
build), all 168 CI selector/aggregate/workflow checks and all 383 fixture checks.
The official generated schema remains byte-identical to the verified artifact.
