# Changed-work-only CI

## Binding development rule

During feature/PR work, execute **only the tests for the changed work and its
identified direct contracts**. A migration, shared module, generated schema,
configuration or workflow change is not permission to run cumulative tests.
Unknown impact is an error requiring an explicit scoped plan, never a full-suite
fallback. Do not run `npm run check:all`, the whole unit/SQL/browser collection,
every race script, or the complete populated-upgrade chain during development.

All historical test sources remain stored. The full collection is dormant until
**one explicitly designated run immediately before deployment**. This workflow
neither schedules nor authorizes that run or a deployment. Pushes, merge queues,
workflow edits and manual defaults must not trigger cumulative validation.

## Exact per-work manifests

`ci/scopes/*.json` contains versioned, reviewable plans. Each declares:

- Its work id and exact PR merge-base commit (`base`). A prior feature's manifest
  does not silently authorize selection for a new work baseline.
- Exact changed paths it covers, including the plan and CI files when edited.
- Explicit unit, fixture/planner, SQL, race, upgrade and browser file inventories.
  Existing browser files may specify anchored named-case expressions.
- Selection reasons and deliberate exclusions. A code plan must select tests.
- Whether dependency-graph typechecking is required. This is compilation, not
  permission to execute cumulative regression tests.

The selector verifies the workflow checkout, PR merge parents and one unambiguous
merge base, then considers the **whole PR diff**, not only its last commit.
Renames/copies contribute both paths; deleted paths remain in the inventory.
Every changed non-documentation path must be covered by a manifest bound to that
merge base. Matching manifests are unioned without expanding to historical
feature groups. `README.md`, `AGENTS.md` and Markdown under `docs/` alone do not
select code regression tests.

Missing/ambiguous history, malformed paths, unknown files, wrong provenance,
empty diffs and oversized output **fail selection**. They never produce an empty
success or a full run. NUL-delimited filenames are treated as data, not shell
commands. Manifest test paths are literal allowlisted files, not globs/options.

The workflow is PR-only and uses read-only permissions. Unsupported event/base
provenance fails closed. There are no automatic push, merge-group or manual
full-suite triggers. No permissions, branch rules, provider integrations, live
policy, user consent or deployment configuration are modified.

## Feature39 selected inventory

The authoritative exact path/case list and per-category reasons are in
[`ci/scopes/analytics-funnel.json`](../../ci/scopes/analytics-funnel.json).
This plan is bound to merge base
`abb259d384e9461e7cc9817d2e1af93b1c7d1ca6`.

| Category             | Selected work                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                 | 24 analytics files and 10 direct changed-entrypoint/type-boundary contract files; 34 explicit files, not a unit directory                                                  |
| Fixture/CI contracts | New analytics fixture guard plus the five edited planner/Git/aggregate/workflow/runner test files                                                                          |
| SQL                  | `analytics_capture`, `analytics_funnel`, `analytics_funnel_isolation`, `analytics_funnel_serializable`, `analytics_lifecycle`, `analytics_security` `.test.sql` files only |
| Races                | `test-analytics-concurrency.mjs` and `test-analytics-funnel-concurrency.mjs` only                                                                                          |
| Populated upgrade    | `test-analytics-funnel-upgrade.mjs` (37→38) only                                                                                                                           |
| New browser          | 19 analytics cases, including all three text scales at 360/1280, plus the separate keyless fail-closed case                                                                |
| Existing browser     | Nine exact named composition cases: three enrollment and one each renewal, reconciliation, cancellation, chat, reply and repeated install completion                       |

The new capture SQL tests already exercise source ownership, chronology, consent,
financial proof and no-backfill. No additional historical source-feature SQL
chains are necessary for these changes. Existing selected browser cases check
that optional analytics preserves the business result; they do not claim their
fixtures actually granted analytics consent or collected observations.

Unchanged scheduling/calendar, community/moderation, attendance/rewards,
media/compose/dispatch, notifications/webpush, settlement and unrelated admin
features are excluded. Provider/font matrices, refunds, retry budgets, Cron auth,
legacy discovery/session/profile/checkout suites and unrelated navigation cases
are not selected merely because they share a dependency.

## Execution and failure semantics

`scripts/ci-run-selected.mjs` validates the plan and file existence before spawning
allowlisted commands with argument arrays. Missing plans and invalid targets fail;
there is no directory/glob/default-to-all execution. Vitest substring collisions
and Playwright filename regexes are explicitly bounded. Named-case filters limit
legacy browser files to the reviewed cases. Empty categories are intentional
no-ops, while a selected command's failure remains a job failure.

- Quality uses selected changed-file lint/format, selected unit/fixture files and
  selected keyless browser cases. It does not invoke `check:all` or default full
  browser discovery. Build/browser installation happens only when that selected
  browser work needs the production server.
- Database setup applies all migrations to construct the current disposable
  schema. This is **setup, not cumulative regression execution**. Only selected
  SQL files run, twice to verify rollback/repeatability. Only selected independent
  session race scripts and selected populated upgrades follow. Actual type
  generation, artifact upload and committed generated-type drift verification
  remain; types must never be hand-edited.
- Browser jobs preserve their isolated fictional Auth/provider setup, guards,
  artifacts and cleanup, but execute only selected files/named cases.
- Local Docker/browser restrictions still apply. Listing tests or inspecting a
  command plan is not actual browser/SQL execution and must not be reported as it.

`ci-required` verifies the exact registered job inventory and workflow SHA,
recomputes scoped evidence, requires success for selected jobs, and requires an
explicit `skipped` result for unselected jobs. Unexpected skip/failure/cancellation
or malformed evidence fails. No selected failure is masked with `continue-on-error`.
The historical baseline file is preserved as evidence, not a requirement to
execute old test commands contrary to the current rule.

## Updating a work plan

Add/update a baseline-bound manifest with exact changed paths, selected test files
or cases and reasons. Test only the edited planner/runner/workflow contracts and
the selected work. Before publication, inspect the generated inventory and
selected browser discovery; prove that unselected cases are not executed. Do not
replace an unknown-map error with broader automatic execution. Report actual
selected results separately from historical results and from setup/discovery.
