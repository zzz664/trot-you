# 2026-10-25 — Schedule notice application

## Scope and publication

The sole feature branch remains `feature/schedule-notices`. Database checkpoint
local `fe2ecf75fc66b14162c0408aee5c2bc4b1682480` was published by the parent as
remote `ac1cfcfbf811ce44769bab16c87eefbd68e14b0d` in draft PR #35; their tree
`51e258178bdc6df11d72cc1854ad88d4bee21ed8` was verified identical. Preserved
bundles retain old local ancestry, and the feature branch was safely aligned to
the remote checkpoint without losing unstaged application changes. No direct
main/develop write, branch overlap or deployment occurred.

The application adds explicit global schedule opt-in and per-event allowed/
opt-out state to existing schedule list/detail views. The current owner is
bound by authenticated RPC and request actor checks. Late responses, account
changes, navigation, hidden/restored documents, repeated clicks and uncertain
writes clear stale data and require fresh server state. Errors and retry remain
inline; controls use existing accessible primitives and scale-aware layout.

A dedicated default-disabled protected route queues bounded current next-day
KST work only. It reuses the existing real Web Push worker, not a fake sender or
new generalized provider abstraction. Private policy approval, active runtime
configuration, browser permission, device registration and delivery remain
separate. The current approved hour is shown only when DB prerequisites exist;
source-document 10:00 KST is not automatically approved. No Alimtalk contract or
phone consent is invented.

## Review repairs and dependency evidence

- Source review identified a pre-existing integration gap: the real encryption
  adapter accepted only the original message envelope although the billing
  service and browser worker already generated/handled billing notices. The
  strict adapter allowlist now supports exact billing and schedule kind/route
  pairs. Synthetic real encryption/decryption tests prove payload compatibility
  without network/provider traffic. Prior billing browser/queue tests did not
  prove this adapter contract; no live delivery was established then or now.
- Schedule payload contains only version, opaque job ID, supported kind and
  fixed `/schedules` URL. It contains no event ID/title/time/place/coordinates,
  fan/artist identity or financial details. The worker displays bundled generic
  copy and accepts only fixed local current-account destinations.
- DB review fixed pre-claim session locking/current expiry checks, a captured
  opt-out job-lock set and qualified output-column references. Session loss is
  checked at both claim and final preparation, not just after keys are returned.
- Existing admin policy instructions now describe the implemented immutable
  schedule policy and next-day consumer instead of the retired rolling-hour
  path. This changes guidance only, not settings or policy approval.
- Two additional independent-session races document existing current-state
  global-consent semantics: disable cancels its captured committed active set;
  concurrently inserted work must still pass current consent. Explicit re-enable
  before claim can permit never-canceled late work; a canceled job is never
  resurrected. Per-event opt-out serializes source creation. Total new race
  scenarios are now 25, preserving all prior races.

## Local evidence at pre-type-artifact stage

- Whole repository lint and Prettier: passed.
- Full unit suite: **7,236 tests across 242 files passed**.
- All fixture/guard/discovery commands: **351 tests passed**, including 30 new
  guarded schedule-notice checks. Discovery does not launch a browser/server/DB.
- All ten existing token contrast pairs: passed.
- Type generation and strict checking report only the five newly added RPC
  names absent from the committed generated schema. No hand-written types,
  cast around the RPC contract or relaxed check suppresses that requirement.
- `check:all` was invoked but cannot pass its type stage until the genuine
  official CI schema artifact is imported. Full build, final aggregate pass,
  actual DB migration/lint/pgTAP twice/races/upgrades and browser/visual QA are
  still pending; unit/source checks are not substitutes for those gates.

The authored browser suite contains 20 isolated cases plus one keyless case,
with 81 planned screenshots covering all three body scales at 360/1280,
offscreen controls, interrupted saves/loads, account changes and exact settled
heading/URL assertions. These are authored checks, not claimed runtime passes.

No local Docker/browser retry or escalation was attempted. No real push/email/
Alimtalk, charge/refund, policy or role approval, deployment, recurring schedule
activation or user location disclosure occurred. The prior blocked independent
media review was not retried, replicated or probed. Private originals remain
outside the repository. See [operator boundaries](../configuration/schedule-notices.md).

## Corrected checkpoint and final application checks

Corrected DB commit local `d559f9a76b2a3fcce25f5a54501fa39bc9f2256b` was
published as remote `19a164e4ae8037e1885b72d60a58645287148a71`, matching tree
`018702fbb4812c0de60732909928ccb0c8b57c2a`. Safe local alignment again preserved
all application changes. Actual run `40185486300` passed migration/lint, both
pgTAP passes, all checkpoint races and four populated upgrades. The genuine
89,430-byte schema artifact is imported unchanged; see
[provenance](2026-10-25-schedule-notices-types-ci.md).

That checkpoint had 18 passing jobs and two failures: expected generated-type
drift and one schedule-browser harness race. The latter read Chromium's page
response body after the save triggered navigation, producing
`Network.getResponseBody: No data found`. The corrected test captures the real
`route.fetch()` response body before forwarding it unchanged to the browser;
it retains API status/schema, actual mutation and exact settled URL/heading/
form assertions. Two unit regression cases cover capture-before-forward ordering
and assertion failure propagation. There is no production authorization or
navigation change and no blind retry or weakened assertion.

A separate presentation review found that existing public schedule browsing
allows artist/admin accounts while notice preferences are fan-only. List/detail
now receive a safe fan-only presentation hint, defaulting to hidden; actual
request and SQL checks remain authoritative. Both nonfan roles have explicit
browser cases proving public schedule availability, absent notice controls,
forced API rejection and unchanged preferences. Generic push copy no longer
states “tomorrow” at device display time, since deferred device display is not
synchronously guaranteed by queue timing.

After importing the official artifact, full local `npm run check:all` passed:
lint/format, Next route generation, strict TypeScript, **7,248 unit tests across
244 files**, ten contrast pairs, optimized production build and static-only PWA
build. The complete fixture suite had 351 passing tests; the final 30-case
schedule-notice guard/discovery suite passed again after the role/browser fixes.
The committed schema still matches its official SHA-256 exactly. Actual final
application CI, all browser cases and ordinary pixel review remain pending.

## Full-page evidence settling correction

Application CI `40204274820` at remote
`3c63fd8818807781240628c46bfbe5e66e971622` passed all 655 browser cases,
including 20 new schedule-notice cases and the earlier admin-save response
capture repair. Ordinary pixel review found eight existing schedule full-page
PNGs whose captured height ended before the final notice/calendar content.
Native original-image bottoms confirm an evidence race: the event/month
assertions settled before the independently loaded notice preference panel
expanded. This is not evidence of an application clipping defect. All 81 new
notice captures already waited for preference state and were complete; the
88 admin-settings captures also had no concrete visual defect.

The legacy full-page helper now waits for an existing notice panel's rendered
preference state and loading-status removal before Chromium measures page
height. Admin, intentional loading and revoked-state pages without a notice
panel retain their explicit assertions. No arbitrary delay, retry, fabricated
response or relaxed behavior assertion is added. Three unit regressions prove
capture ordering, no-panel handling and failure rather than partial evidence.
Actual corrected-head browser capture and renewed pixel review remain required.
No application/DB/schema/workflow source changed for this correction.

Correction verification: full local `npm run check:all` passed again with
7,251 unit tests across 245 files, strict types, lint/format, contrast and
production/PWA builds. The existing schedules fixture/discovery suite also
passed all 28 checks. The official generated schema remains byte-identical.
Browser runtime was not attempted locally; corrected CI/pixel evidence is pending.
