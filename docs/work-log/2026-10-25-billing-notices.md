# 2026-10-25 — Billing prenotice application

## Scope and decisions

The sole feature branch is `feature/billing-notices`, based on merged develop
`6b12efd0e46eda8b145cb5a9f56ac8f414a0dd2f` (tree
`5201ae70937b5b42ac0ae275c4f3419770da8d42`). The early DB checkpoint was
published separately in draft PR #30. Its remote commit
`1087da215a99897a8eaa6d868699263ae33e06c7` exactly matches local checkpoint tree
`b5d1ad19a270e4e4d4f00f271ed4b5dbcf2aa958`; local ancestry was safely aligned
while preserving unstaged application work. No direct develop/main publication.

The application adds a dedicated default-disabled protected publication route,
real authenticated in-app notice list, explicit read marker and narrow optional
billing preference. Its safe current price/date projection links directly to
owner subscription management. It does not add unrelated notification categories,
full admin settings or a scheduler. All runtime notice timing/mandatory choices
require immutable approval, with no automatic source-document default.

The existing Web Push worker is extended only to the `billing_notice` source,
with exact current eligibility at preparation and a generic local push message.
Financial detail stays in the authenticated no-store view. Queue creation,
provider acceptance, display and user read remain distinct. Neither publication
nor reading writes a renewal notice receipt; required renewal delivery evidence
stays fail-closed on the existing external-verified path.

The notice page excludes financial detail from reusable RSC props, clears old
results on navigation/visibility/history restoration, fences late responses and
refetches current owner data. Three text scales, KST dates, KRW amounts, explicit
retry/empty/loading/access-lost states, Back and direct management links use the
existing accessible primitives and centralized copy/routes.

## Source review findings fixed

- New notice current eligibility originally used only general notification
  readiness. It now mirrors current name/legal document acceptance readiness and
  credential availability, with corresponding final-gate locks and fresh time.
- A response bound incorrectly inferred a historical ten-device invariant from
  the newer registration ceiling. It now accepts the actual bounded SQL count,
  including legacy accounts with more than ten active registered devices.
- The cron test's tuple callback was corrected so it tests the intended method,
  query and body separately, rather than destructuring the method string.
- Checkpoint CI revealed an existing keyless Web Push Back test matching the
  transient `/` URL instead of the final guarded login landing. Its assertion
  now waits for the real login heading and exact redirected URL; no production
  authentication behavior was changed. The first checkpoint had one
  retry-recovered flaky case; corrected checkpoint `40155816185` reproduced
  the same old assertion as one failed and one flaky case. Neither checkpoint
  is reported as zero-flake. Exact final-app CI must verify the repair.
- Browser fixtures explicitly disable actual payment and push capabilities and
  reject inherited live settings; no fictitious `PAYMENTS_ENABLED` flag is used.

Normal new-feature DB/application source review found no remaining source-level
blocker. That is not execution evidence. The prior blocked independent media
review remains blocked and was not retried, replicated, delegated or probed.

## Local checks and pending evidence

- Full local lint/format: passed.
- Full unit suite: 5,945 tests across 191 files passed.
- New fixture guard/discovery tests: 28 passed. Discovery does not launch a
  browser, server or database.
- Contrast: all ten existing token pairs passed.
- Typecheck currently reports only the six newly added RPC names absent from
  the committed generated schema. Genuine CI type generation is pending; no
  hand-written schema extension or assertion is used to hide this requirement.
- `check:all`, build, actual database migration/lint/pgTAP twice/races and real
  browser/visual verification remain pending exact-head CI/type artifact.
- Authored browser plan: 23 configured and 7 keyless cases, 65 explicit captures,
  including three actual computed body font sizes on narrow/desktop initial
  views and account changes. This is a plan, not a claimed browser pass.

No local Docker or browser execution was attempted. No real push, payment/PG
request, VAPID generation, device permission, deployment, policy approval or
recurring schedule activation occurred. Original private project sources remain
unpublished. See [configuration](../configuration/billing-notices.md) and
[CI inventory](../configuration/billing-notices-ci.md) for operating boundaries.

## Corrected checkpoint progress

Remote test-only correction `35886f3cead99c71bf2956a750bb9d9545608bfb` has
tree `7c2a47e6625ce9f03e0918860f0c660f54fb8d31`; local ancestry was verified
and safely aligned. Actual run `40155816185` passed migration, DB lint and both
pgTAP passes before entering independent-session races. Generated schema output
and final database status are still pending at this point; the separate existing
keyless navigation assertion described above prevents claiming full CI success.

## Application ready for exact-head CI

The genuine schema artifact is imported unchanged; see
[artifact provenance](2026-10-25-billing-notices-types-ci.md). After correcting a
format-only mismatch in the legacy Back test, `npm run check:all` passed:
lint/format, Next route generation, strict TypeScript, all 5,945 unit tests across
191 files, all ten contrast pairs, optimized production build and static-only
PWA generation. The dedicated fixture/guard suite separately passed 28 tests.
The protected notice page/API/worker routes build as dynamic routes; no keys were
needed and no actual provider or browser was invoked by this validation.

The configured and keyless browser cases, final database zero-drift check and
ordinary visual review still require the final application head in CI. These
pending checks are not implied by local build/unit success. No local browser or
Docker restriction was retried.

## Final home-entry scope correction

Before application publication, the new home entry was moved into the existing
fan-home block, rather than appearing beside the all-role financial-history
entry on artist/admin/restricted/onboarding pages. Five focused role/path tests
cover that boundary. Full `npm run check:all` passed again with **5,950 tests
across 192 files**, strict types, lint/format, contrast and production/PWA build.
The immutable earlier application commit is preserved; this correction changes
no database contract, authenticated owner projection or provider behavior.

## Exact-head browser harness correction

Application run `40157151807` on remote
`aaf02e3bfb8a444ee0e0b1060f085698e83e750c` passed the quality job, including
the repaired keyless Back assertion. The new configured billing-notice browser
job reported 13 passed and 10 failed: signed-in API checks incorrectly used
Playwright's separate anonymous `request` fixture instead of the browser
context's cookie jar. The server correctly returned 401. Those checks now use
`context.request`; owner isolation, cross-origin rejection, malformed-input and
post-logout 401 expectations remain unchanged. A focused fixture regression
prevents the same cookie-jar mismatch. No production authorization was weakened.

The same run's Web Push browser job failed before migrations/build/tests because
the CI database port was already in use. This is not reported as a feature pass,
and no local Docker or browser retry was attempted. A fresh exact-head CI run
must still close all browser, database and ordinary visual gates.

After the narrow harness correction, full `npm run check:all` passed with
**5,951 unit tests across 192 files**, lint/format, strict types, all ten contrast
pairs and optimized production/PWA build. The new browser execution and final
65-capture visual verification remain pending; prior failure captures are not
substitutes for successful final-head evidence.
