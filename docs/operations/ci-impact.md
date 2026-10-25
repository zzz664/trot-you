# Change-impact CI

## What always runs

The `CI` workflow starts for every supported pull request; it has no workflow-level
path filters. `impact` runs the dependency-free selector, Git-history, aggregate,
and workflow-contract tests before making a selection. `quality` retains every original gate:
lint/format, typecheck, all unit tests, contrast, production build, all local fixture
checks, and the keyless browser suite still run.

For a code PR targeting `develop`, the complete database job still runs: DB lint,
both consecutive pgTAP passes, all 31 concurrency scripts, all seven populated
upgrades, real generated schema types, typecheck, and committed-type drift checks.
Only a nonempty change set containing `README.md` and/or Markdown files under
`docs/` may intentionally skip the database and all 21 isolated feature browsers.

Feature-browser selection is **enabled**, not permanent shadow mode. It applies to
the entire PR, not merely its newest commit. A localized schedule UI change selects
5 of 21 feature browsers; a leaf admin-settings change selects 3 of 21. These are
job counts, not measured duration or billing savings.

## Selection registry

`scripts/ci-impact-registry.mjs` is the explicit dependency registry. Full rules
win over feature rules, and every matching feature group is unioned. Any unknown
path broadens the whole run to full. A newly introduced feature or shared helper
therefore cannot silently receive no coverage.

| Feature paths                                                                                        | Browser dependency group                                                                      |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Schedules/notices UI, clients, HTTP/services, routes, schedule utilities and tests                   | Auth, schedules, schedule notices, content calendar, community posts                          |
| Web Push/billing-notice UI, clients, HTTP/services, notification services, Web Push worker and tests | Auth, Web Push, billing notices, schedule notices, schedules                                  |
| Checkout/enrollment/renewal/subscription/refund/reconciliation paths and billing-period utility      | Auth, enrollment, renewal, cancellation, reconciliation, billing notices, admin subscriptions |
| Media/chat/replies/speech/compose/dispatch paths and message rendering                               | Auth, media, chat, reply, speech, compose, dispatch, activity, admin artists, community posts |
| Artist reply activity                                                                                | Auth, activity, content calendar                                                              |
| Admin artist/access management                                                                       | Communication group above, plus schedules and content calendar                                |
| Leaf admin settings                                                                                  | Auth, admin settings, community posts                                                         |
| Leaf admin subscriptions                                                                             | Auth, admin subscriptions                                                                     |

The exact anchored patterns in the registry are authoritative. Unit tests,
feature-specific Playwright configuration, E2E fixtures, and local CI helpers
inherit these groups rather than being assumed to affect only their filename.
Examples of deliberate dependency coverage:

- Schedules embed notice controls, which in turn use schedule resource handling.
- Composer embeds dispatch and media UI and shares chat formatting/speech draft
  handling. Media also appears in discovery and admin artist previews.
- Reply fixtures/local configuration are used by speech; speech recognition
  fixtures are used by compose.
- Renewal extends enrollment Playwright configuration. Enrollment, renewal,
  cancellation, and reconciliation fixtures form a dependency chain.
- Content calendar reuses schedule date/navigation helpers, artist activity, and
  admin artist choices. Those groups select the new calendar browser. New
  content-calendar paths themselves deliberately remain full fallback until
  their dependency boundary has separately reviewed evidence.
- Community posts reuse shared media/storage and schedule navigation, and consume
  community policy edited through admin settings. Those groups include the board
  browser. New board paths themselves remain unknown/full fallback.
- Shared session/home entry components are full triggers, even inside an otherwise
  selective feature directory.

### Full fallback

Full runs are mandatory for:

- SQL, Supabase configuration/tests/seeds, all database access modules, generated
  database types, DB race/upgrade infrastructure, and external/shared adapters.
- Auth/session/authorization, shared onboarding/discovery infrastructure,
  application shell, shared UI primitives, and session entry surfaces.
- **All `src/config/` files**, translations/i18n, common infrastructure, and shared
  PWA/service-worker code. Feature configuration is not necessarily isolated:
  `env.server.ts` imports many feature constants/parsers, and runtime schemas
  transitively connect media, admin artists, subscriptions, schedules, and notices.
- Package/lockfile/toolchain/build configuration, workflow and selector changes.
- Unknown paths, file-type changes, empty diffs, missing/ambiguous Git history,
  inconsistent PR merge parents, or an oversized selection plan.
- PRs targeting `main`, `release/**`, or `releases/**`; pushes to those branches;
  manual dispatch and merge-queue events.

There is deliberately **no `develop` push run** duplicating the preceding PR CI.
Manual full runs are supplemental verification, not a substitute for the exact
PR-triggered check required by branch rules.

## Diff and fork safety

`actions/checkout` supplies complete history with credentials not persisted in the
impact job. The selector verifies checkout `HEAD` against the workflow SHA and
validates the PR merge commit's parents against the event's base/head SHAs. It
computes one unambiguous merge base and diffs that base to the PR head across all
PR commits. Base/head/merge-base/test SHAs are recorded in the run summary.

`git diff --name-status -z --find-renames` is parsed as NUL-delimited UTF-8 data.
Renames/copies contribute both paths; deletions retain their original path.
Whitespace, newlines, Unicode, and shell-looking filenames are never executed or
split on whitespace. Invalid status/path/encoding or unavailable history selects
full, not an empty successful result. A checkout SHA mismatch fails the selector.
Large plans become compact full plans instead of silently truncating changed
files; the output cap also leaves room for the aggregate's nested JSON environment.

The workflow retains `pull_request` and `contents: read`; it does not use
`pull_request_target`, the PR files API, write permissions, deployed secrets, or
hosted databases. Fork approval rules continue to apply normally. GitHub warns
against running untrusted PR code in the target-event context. See
[GitHub workflow event guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## Required aggregate and branch rules

`ci-required` has `if: always()` and depends on `impact`, `quality`, `database`, and
every feature browser. It recomputes the plan's path/rule/job evidence and requires:

1. Successful impact selection and matching workflow SHA.
2. Exactly the registered job inventory, with no missing or unexpected job.
3. `success` for every selected/always-on job.
4. Exactly `skipped` for each explicitly unselected job.

Failure, cancellation, an unexpected skip, missing output, malformed evidence, or
an unregistered job fails the aggregate. No job uses `continue-on-error`. Workflow
tests also prevent omission of a job from the registry or aggregate dependencies.

**An administrator must require the stable `ci-required` check in the applicable
branch rules before relying on it as an automatic merge gate.** This change does
not modify repository permissions, branch protection, or rulesets. Until those
rules are deliberately migrated, the operator must inspect the exact-commit
aggregate and all planned jobs before merging; keep existing protections intact.
GitHub's skipped-job semantics are why the explicit aggregate is necessary. See
[GitHub required-check troubleshooting](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## Maintaining coverage

Run `node --test scripts/ci-*.test.mjs` and `npm run check:all` after changing CI.
The impact job runs those dependency-free CI tests before making any skip decision.
`scripts/ci-workflow-baseline.json` records the original 21 job step hashes at
merged develop `4b4a9f55de1fb5c61302dcf0fc28d42eae570f65`. Those setup, test, cleanup,
and artifact steps remain byte-for-byte unchanged after removing only the exact
reviewed feature33 additions recorded in `ci-workflow.test.mjs`. The new
content-calendar concurrency and populated-upgrade gates run before official type
generation, and its fixture checks join the always-on quality job. Tests reject
missing, duplicated, moved or weakened gates. The isolated calendar browser is
registered in both the selector inventory and required aggregate. The
historical baseline is not rewritten to claim these additions existed earlier.
New suites must be added to the registry, workflow, and aggregate; do not falsely attribute a
new job to the historical baseline. Deliberate future test-step changes require
reviewing/updating the baseline contract rather than bypassing its test.

Keep uncertain dependencies full. If a later full run finds a skipped-family
regression, broaden the rule and add a selector regression test before narrowing
again. Do not replace populated upgrade tests with fresh-schema-only checks.

Database selection is intentionally not optimized by SQL filenames. The schedule
notice migration's first checkpoint passed its new tests while breaking existing
message-dispatch tests through a shared notification wrapper. Every migration
therefore retains all DB regressions. All 38 race/upgrade scripts perform whole
local-database resets: running them concurrently against one Supabase instance
would be unsafe. A separate, measured improvement may shard the unchanged suites
onto isolated runners; this PR does not do that. Browser selection reduces work
and queue pressure, but the serial DB job can still determine elapsed CI time.

Feature 34 adds the isolated `community-posts-browser` to the registry, aggregate,
and full fallback inventory. Its synthetic Auth/board/private-storage job runs all
existing setup, reset, build, artifact and cleanup gates. Exact added fixture,
concurrency and populated-upgrade steps remain checked separately from immutable
historical step hashes; no baseline hash was rewritten.

Feature 35 retains those same regression gates and adds community-interaction
concurrency and populated-upgrade verification before official type generation.
The exact two additions are checked without changing historical step hashes.
