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
