# Cancellation and refund isolated CI verification

## What is exercised

The `cancellation-browser` GitHub Actions job starts the actual local Supabase
Auth/Postgres stack and Next.js application. Fictional accounts first complete
onboarding, register through the actual enrollment service/adapters, and acquire
one verified charge in the immutable local money ledger.

The browser then exercises:

- Fan cancellation independently of refund configuration, retaining the exact
  already-paid period; restricted owners can still stop charging.
- Separate refund request, explicit current-admin authorization, and separately
  confirmed provider dispatch; a missing approved policy never becomes approval.
- Toss and Kakao successful full refunds at normal, large and xlarge text sizes.
  Each combination captures canceled paid access, authorized-but-not-executed,
  and confirmed refund screenshots for visual inspection.
- Lost refund responses, exact-action query recovery, partial amounts and bounded
  query exhaustion; unknown operations never authorize another refund dispatch.
- Idempotent duplicate requests, two simultaneous admin executions, revoked
  authorizers, owner isolation, strict request envelopes and same-origin checks.
- Cancellation racing an already-dispatched renewal, grace cancellation,
  dialog dismissal, browser history, and a lost browser cancellation response.
- Explicit rejection without a provider operation or entitlement mutation.

The default keyless browser suite separately checks that management pages and
mutation endpoints fail closed with no fictional policy, success, or controls.

## Isolation boundaries

`CANCELLATION_LOCAL_E2E=true` is a separate capability, not inherited from the
existing enrollment/renewal fixtures. It requires the complete enrollment test
runtime: GitHub Actions, CI, development mode, loopback app/Supabase origins,
public fictional credentials, and absence of deployment indicators.
`PAYMENTS_REFUNDS_ENABLED=true` is supplied only inside that disposable job.
The refund transport allows only the exact documented refund/query endpoints
and methods and maps them to the fixed `127.0.0.1:3200` fixture. It cannot issue a
charge, revoke a mandate, follow a redirect, or use nonfixture authorization.

The ordinary production branch still uses real HTTP adapters. A disabled or
invalid test runtime cannot silently become mock success. Existing enrollment
and renewal CI do not gain refund access by sharing fictional credentials.

The fixture deliberately does **not** deduplicate Kakao cancellation payloads;
a second partial-refund dispatch would produce a second action and fail the
application's expectations. Toss duplicates are bound to the exact immutable
idempotency key and request. Lost responses retain queryable provider state.
Observation endpoints expose counts only, not tokens, actor IDs or request bodies.

A renewal route is explicitly invoked only for the cancellation race test. No
scheduler or deployment is created. All policy approval records are labeled
fictional and exist only in this disposable local database. They are not a
business/legal approval. Retained money rows are never edited or deleted to
reset a test: the whole isolated database is destroyed after the job.

## Commands and evidence

- `npm run test:cancellation-fixture`: pure in-memory Node fixture tests; opens no
  listener and performs no network requests.
- `npx vitest run tests/unit/cancellation-ci.test.ts tests/unit/cancellation-fixture-contract.test.ts`:
  runtime/transport rejection tests and real adapter-to-fixture contract tests,
  also entirely in memory with no sockets.
- `npm run test:e2e:cancellation`: requires the explicitly configured isolated
  GitHub Actions job; it is not a local, sandbox, merchant, or production test.
- `npm run test:db:cancellation-concurrency`: independent database sessions test
  operation/ledger races in the real disposable Supabase database.

`cancellation-browser-results` contains screenshots and the Playwright HTML
report. Trace capture is disabled to avoid copying even disposable session
cookies. CI must pass on the exact final commit and screenshots must be reviewed
before readiness is claimed. Offline fixture success alone is not evidence that
a browser run, merchant sandbox, live refund, or production deployment succeeded.
