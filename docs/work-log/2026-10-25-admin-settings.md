# 2026-10-25 — Administrative operational settings application

## Scope and policy boundary

This feature implements the private specification's operational settings editor,
using the actual runtime policy tables rather than the earlier draft-only
registry. There is no preexisting `app_settings` or `system_settings` table. The
UI edits 11 message and 11 community numeric fields only when that source policy
already exists; it does not create an absent business policy or populate source
draft defaults. A separately persisted display group controls chat's real default
page size. Missing display configuration retains the prior technical size of 30;
explicit bounded API page limits preserve the existing contract.

All 37 documented keys and six operational domain families have an exact catalog
entry, either a real typed editor or a concrete policy runbook. The latter names
tables/columns, required owner decisions, version/pointer and verification steps,
and explicit unimplemented dependencies. Financial policies remain immutable
version workflows. No commercial or legal terms were invented or approved, and
no past money, consent or accepted price snapshot is rewritten. Credentials,
provider activation, security-critical infrastructure and executable SQL/regex
are excluded from the UI. Public copy, grade/share/schedule semantics without an
implemented consumer are honestly identified, not shown as working save controls.

## Implementation

- `/admin/settings` and `/api/admin/settings` use verified current administrator
  sessions, same-origin writes, bounded strict JSON, fresh actor-scoped RPCs and
  private no-store responses. Pages serialize identity only, never reusable RSC
  snapshots of private settings or audit evidence.
- Every form validates the complete typed numeric group with actual database
  bounds, requires an opaque UUID decision reference, displays changed values and
  requires a separate confirmation before saving. Reset restores the values that
  were actually loaded; cancel performs no write. The reference records the
  operator's decision, not a fabricated approval by the application.
- The browser clears values during mutation and on role/session loss,
  navigation, history restoration and hidden-tab revalidation. A conflict or
  uncertain response offers read-only refresh, never an automatic write replay.
  A fresh summary is shown before a new edit. Successful edits require a fresh
  read before success is displayed.
- Audit renders actor UUID, database time, numeric before/after and the opaque
  decision reference, not names, contact information, version labels, terms,
  policy bodies or credentials. Privileged changes are labeled operator with no
  guessed identity; excluded-field changes can have equal numeric snapshots.
- The runtime chat adapter reads `chat_settings` for each page. A malformed or
  unavailable settings response fails closed, rather than silently applying a
  client fallback. Settings are not cached across actors or changed values.
- Existing UI primitives, shared messages/routes/tokens and all three text
  scales are used. The admin entry and every policy anchor/return link are real
  routes, with missing-policy guidance instead of inactive controls.

## Verification status at application preparation

The immutable database checkpoint was committed locally as `d685afc` and
published by the parent as `d32b8de` with the same tree. The application was then
aligned to that exact remote parent without losing working changes. Genuine
public database types must come from the checkpoint's real CI artifact; none are
handwritten.

A full local unit pass before the final UI coverage additions passed 6,505 tests.
Focused validation covers exact numeric/revision boundaries, complete response
shapes, no unknown key or policy-activation input, HTTP/role/origin checks,
stream/body bounds, client failure handling, catalog coverage and chat consumer
behavior. Final aggregate evidence will be recorded after generated types and
all application changes are present; this intermediate result is not a completed
`check:all` pass.

The new isolated browser suite contains 17 cases and the unconfigured suite adds
seven cases. Fixtures use a disposable local Auth/Postgres stack with fictional
numeric policies and identities; delivery and payment remain disabled. The 28
pure fixture guard/discovery tests passed without launching a browser, database
or server. Actual browser execution, screenshots, visual review, database lint,
pgTAP, independent-session races and upgrade checks await CI. No locally blocked
Docker/browser operation was retried. The earlier CLI help startup limitation is
recorded separately in the database checkpoint log.

## Not performed

No real setting change, business approval, credential, account, role grant,
provider request, financial operation, production deployment or recurring
scheduler was performed. The subscription dashboard and settlement calculation
UI remain separate later features.

## Baseline browser race found by checkpoint CI

Checkpoint run `40169144480` exposed one enrollment-browser test failure after
its intentionally delayed start request returned HTTP 200. The test had already
navigated to the completion page to exercise early status recovery; Chromium no
longer retained the old document's response body. This was a test-evidence read
failure, not a failed payment/state assertion. The test now verifies the exact
committed session through the current-cookie read-only status endpoint before
clicking the normal refresh control. It does not repeat provider start, weaken
the expected manual-review state, or remove the no-extra-charge assertions.
Production logic is unchanged. The correction's actual browser verification
remains pending fresh CI; no blind rerun was requested.

## Database checkpoint and final local aggregate evidence

Checkpoint CI run `40169144480` applied all 28 migrations, passed database lint,
and passed 3,722 pgTAP assertions across 45 files **twice** (199 new assertions).
All 25 independent-session concurrency suites passed: 338 scenarios, including
13 new settings races. The populated pre-00028 upgrade-preservation test also
passed. Genuine type generation and post-generation typecheck succeeded; the
only database-job failure was the expected committed-type drift before import.

Artifact `12589823875`, `database-types`, was verified against checkpoint head
`d32b8de090d43e99de08b0a12b891263d7942a15` and tree
`246e0ed0381d7ebd2d56a862bd7e6fd1fd5d5345`. Its generated `database.ts` SHA-256 is
`791aa786eb3ab743263a332d7522536e1396a333697ab0e51f31f057228d6688`.
The file was copied unchanged; the 13-line diff contains the three actual RPCs.
No database types were handwritten.

With those genuine types and the complete application changes, local
`npm run check:all` passed: repository ESLint/Prettier, Next route type generation
and TypeScript, **6,567 unit tests in 211 files**, all 10 contrast checks, and the
production Next/PWA build. The new 28 pure fixture/discovery checks also pass.
The checkpoint's existing browser suites had 550 passing cases and the one
known enrollment test-evidence failure described above. Those runs did not
contain this application. A new exact application commit still needs all CI
jobs and actual screenshot/visual review before merge readiness.

## Application CI and visual evidence

Application candidate `290872cc4714868b6125016297baa71c9c9978e5` passed all
**18 jobs** in CI run `40170506459`: 6,567 unit tests, 265 fixture checks,
3,722 pgTAP assertions twice, 338 independent-session race scenarios, the
populated upgrade-preservation check, and **575 browser cases**. Database type
generation, post-generation typecheck and the committed-type drift gate all
passed. The corrected enrollment suite passed all 21 cases; the dedicated
settings suite passed all 17 cases. These results belong to this exact candidate,
not automatically to later commits.

Official screenshot artifacts were checked against the run/head and archive
digests before normal visual QA. All 992 baseline images were accounted for:
441 identical and 551 changed, including nine dimension changes, with no missing
images. Changed-region review found no material defect. All **94 new settings
PNGs** were covered: 30 editor/validation/review/saved images, 27 policy/runbook
images, and 37 initial/error/keyless images. Six keyless images were byte-identical
to separately viewed counterparts and are explicitly recorded that way, rather
than claimed as separate image views. Full-height component captures include
the complete tall forms and their bottom actions; viewport captures establish
only their captured area. No material clipping, overlap or readability defect
was found across the three text scales and narrow/desktop widths.

The final test-only evidence addition captures the newest sanitized audit entry
after the already-tested save at all six font/width combinations and verifies
the current synthetic administrator UUID before capture. This closes a visual
coverage gap without changing application behavior, database policies, or test
case counts. A fresh local `npm run check:all` again passed (6,567 unit tests,
lint/format, type generation/typecheck, contrast and production/PWA build), as
did all 28 settings fixture checks. The final audit-capture commit still requires
its own exact-head full CI and review of the six newly produced audit images
before merge. No local browser or Docker operation was attempted.
