# 2026-10-25 Artist received replies and current-week activity

## Scope

One feature on `feature/artist-reply-activity`, based on merged develop
`b369d7879a7c98d683127b32daa49e0b3d4d8e6a`. The early immutable DB checkpoint
was published by the parent as `c192595db51619c7a1d799ada3cfae21a4041a4f`,
exactly tree-identical to local checkpoint `b4de17343207e7849ea38a31f0954d83282d7eb8`
(tree `6e35532557ca2ed019f1444c8b0fe4dbcab7b05d`). The local branch was safely
aligned after fetch/tree verification; application work was preserved.

The artist menu now opens a paginated assigned-artist selector and a read-only
received-reply/current-week screen. Reply DTOs include only the fan calling name,
reply text/time/content ID and optional eligible source-message ID. Separate
cursor domains bind artist, selected source message and feed kind. Every source
message remains selectable through its own paginated chooser, rather than
silently limiting filters to the newest page.

No DM, provider notification, subscription/ranking analytics, settlement UI,
financial mutation, hosted configuration or scheduler activation is added.
Private source documents were consulted but not copied into the repository.

## Important decisions

- Current KST-week source rows, not telemetry or historical report snapshots,
  drive message/photo counts. Photo means a photo message, not attachment count.
- Only enabled, activity-enabled existing contract policies that consistently
  cover the full week supply minima. Missing/ambiguous policies show unavailable
  requirements without hiding factual counts. No draft default is auto-approved.
- Current artist role/onboarding/restriction/membership and source visibility are
  rechecked by the session and actor-bound RPC. Blocked/ineligible-fan replies are
  absent; canceled source messages no longer appear as selectable associations.
- Expired subscription access does not retroactively erase an already received,
  otherwise-visible reply. No new deletion/retention policy is invented.
- Reply bodies are not serialized into reusable client initial props. The RSC
  validates authorization and routing, then the client fetches current paired
  feed/picker data. Refresh/navigation clears prior private content, aborts old
  work and ignores late responses. Back/Forward and BFCache restore revalidate.
- A collapsed accessible message chooser keeps the main reply feed reachable
  without scrolling past thirty filter links. The shared Button gains only
  `ariaExpanded`/`ariaControls` forwarding, covered by primitive tests.
- Read-only functional review found a real valid-data bug: thirty maximum-length
  Unicode replies can exceed a 1 MiB transport ceiling. The response ceiling was
  raised to 4 MiB and a full maximum-Unicode-page acceptance regression added.

## Verification prepared and local results

- Migration: 74 new pgTAP assertions and 13 real independent-session races.
  Exact source semantics, legacy ABI and existing compatibility fixtures were
  reviewed; no old assertion was removed or weakened.
- New configured browser suite: 24 cases; default keyless suite: two extra cases.
  Seventy-seven planned explicit captures cover normal/large/extra-large text,
  360/1280 widths, actual new links, message chooser/disclosure, menu/feed/picker
  pagination, all/selected/empty filters, unavailable requirements, retry/error,
  access loss and refresh/history races. Planned captures are not executed QA.
- Pure fixture/discovery guards: 17 passed. Discovery never launches a browser,
  server or database. Fixture initializer unit coverage: 15 passed.
- Focused new application/UI/primitive suites: 246 passed. Full-project lint,
  contrast and whitespace checks passed during preparation.
- Before importing genuine DB output, TypeScript reported exactly the three new
  missing RPC signatures, as expected. No generated types were hand-authored.

Actual DB/browser CI, genuine generated types, final `npm run check:all`, and
normal visual inspection are pending at preparation. They will be recorded
separately with exact source-head evidence before completion. Local Docker is
unavailable; local browser execution remains denied and is not retried. The
previously blocked independent media-security review remains unperformed and is
not replicated by this feature. All tests use fictional local data only; none
prove production readiness, real-provider delivery, or real-user operation.

## Actual DB checkpoint and type import

Corrected checkpoint [run 40146777750](https://github.com/zzz664/trot-you/actions/runs/40146777750)
passed migration/lint, 3,139 pgTAP assertions twice and 273 independent-session
race scenarios including the thirteen new cases. All 414 existing browser cases
passed at that checkpoint. The sole expected failing gate was schema drift before
import. Exact head/tree/artifact provenance and the earlier observer repair are
recorded in the checkpoint work log.

The genuine `database.ts` artifact was imported unchanged after SHA-256
verification (`dec7dd0803ce2cb23134aaba2ed9b047abcf154a7e70b8761396efc7f4e0b4c6`).
The diff consists of only the three RPC signatures (21 generated lines).

## Final local application gate before publication

`npm run check:all` passed with 5,247 unit tests across 168 files, complete lint
and TypeScript checks, contrast checks, Next.js production build and PWA asset
build. The generated schema checksum remained identical after the build.
The 17 pure CI guard/discovery tests also passed. These results are local checks,
not new UI browser execution. The initial application commit includes every new
visible-link interaction and the 24-case configured/2-case keyless browser
coverage, including three-font standalone route errors, so screenshots can be
reviewed against that exact application head in CI.

Remaining completion gates: actual full application CI (including unchanged
schema drift), all new browser cases, and normal visual review of their captures.
No local browser retry/escalation or live-provider/deployment operation occurred.

## Actual application CI and visual coverage correction

[Run 40147924853](https://github.com/zzz664/trot-you/actions/runs/40147924853)
checked remote head `19cff1f035f7497e52a82b4d5c032923bfd3ca05`, tree
`4459e55f5c1599a0767cf9b54961cb019699bddf`. Two disposable runner startup
port collisions prevented chat/activity tests on attempt 1. The same-head
failed-job rerun recovered both without source changes; all fourteen jobs then
passed. Results: 5,247 units, 440 browser cases, 3,139 pgTAP assertions twice,
273 races and zero generated-schema drift. The artifacts contained 758 captures,
including all 77 new activity captures.

Normal visual review then found a **coverage defect**, not a runtime layout bug:
the empty-artist-menu case switched to the outsider account without setting that
account's font. All three labeled captures therefore used its default large font.
The test now sets the outsider's requested scale and asserts the actual HTML
`data-font-scale` after navigation. The capture helper additionally checks the
actual document scale before every scale-labeled screenshot, including narrow
and desktop title formats. Seven new fixture regressions cover extraction and
wiring. No visual case, UI action or screenshot is removed; the suite remains
24 configured cases and 77 new captures. The corrected captures require a new
exact-head CI run and normal visual review before completion.

After the coverage correction, full local `npm run check:all` passed again:
5,254 unit tests across 168 files, lint, typecheck, contrast, production build and
PWA build. The 17 fixture/discovery guards passed, and the genuine generated
schema checksum remained unchanged. This is not a substitute for the corrected
actual CI captures; those remain the final visual acceptance gate.
