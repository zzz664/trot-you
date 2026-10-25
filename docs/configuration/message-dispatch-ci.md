# Message dispatch: isolated browser evidence

This suite verifies the configured application against the **disposable local
Supabase stack in GitHub Actions**. It is not a hosted-project, live-provider,
Cron-activation, or production verification. No customer identities, real
notifications, VAPID material, Alimtalk templates, or provider credentials are
used. The protected worker publishes messages in-app and creates eligible
outbox rows; it never claims provider acceptance or device receipt.

## Isolation and entry points

The `dispatch-browser` job prepares local Auth, starts/resets Supabase, runs
`node scripts/dispatch-local-ci.mjs environment`, builds the application, and
runs `npm run test:e2e:dispatch`. It uploads the HTML report and test output,
then destroys the local stack even after failure.

- `playwright.dispatch.config.ts` requires exact CI/GitHub/local-Auth/dispatch
  opt-ins, loopback app `127.0.0.1:3100`, and loopback Supabase
  `127.0.0.1:54321`. It uses one worker, no retries, no traces, and a fresh app
  process. The app process does not receive `AUTH_TEST_SERVICE_KEY`.
- The pure setup guard rejects hosted addresses, remote Docker configuration,
  hosted Supabase tokens/passwords, inherited dispatch activation, missing or
  mismatched local fixture keys, and malformed/reused worker secrets. The
  executable generates and masks a fresh dedicated secret before writing the
  temporary GitHub environment. It does not edit the checked-in configuration
  or create a scheduler.
- Every SQL fixture invocation rechecks the exact local-CI environment, default
  Docker context, and Unix-socket daemon. Auth users use unique
  `dispatch-e2e-<uuid>@example.invalid` addresses. A completed artist receives a
  valid non-null calling name in the same guarded profile update. Fans complete
  the actual onboarding RPC flow; fixture creation does not invent fan consent.
- Notification fixtures use explicit fictional preference/consent rows and
  `.invalid` device endpoints. Those endpoints are never contacted. Browser
  routing rejects and records any origin outside the two loopback services.
- The default Playwright configuration ignores `**/dispatch/**`. Discovery
  guards assert exclusion from the default suite, failure without dedicated
  opt-in, and inclusion only in the dedicated suite. `--list` checks do not
  start a server, Supabase, or browser.

Run `npm run test:dispatch-fixture` for the 27 pure setup/discovery checks.
`tests/unit/dispatch-ci-fixtures.test.ts` has 17 pure initializer/source guards,
including both-clock due-time fixture updates and stable cancellation-time
fixtures. These checks are **not** evidence that database or browser scenarios
ran.

## Browser inventory

The dedicated suite currently discovers **43 tests**. The default, keyless
suite adds **2 tests** for unavailable dispatch mutations/worker routes and the
history catalog/detail error pages.

| Dedicated group                                                                                                        |  Tests | Planned successful-run captures |
| ---------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------: |
| Real API/domain loops, normal photo reuse, worker authentication, recipient timing, and paging                         |      9 |                               0 |
| Composer publication/cancellation, KST confirmation, bookmark recovery, and personalized fan view: 3 scales × 2 widths |      6 |                              90 |
| Recoverable transport errors, uncertainty, history recovery, and access loss: 3 × 2                                    |      6 |                              90 |
| Lost committed responses, identical-intent replay/status recovery, editor refresh, deferred-error rendering: 3 × 2     |      6 |                              60 |
| Back/Forward confirmation dismissal and fresh published-state restoration: 3 × 2                                       |      6 |                              12 |
| Expired/grace recipients, actual worker prerequisite recovery, and rapid duplicate confirmation                        |      3 |                               0 |
| Paused-artist catalog/history-only cancellation and membership-loss error: 3 × 2                                       |      6 |                              42 |
| Real 51-artist history-catalog paging and same-artist non-owner isolation                                              |      1 |                               2 |
| **Total**                                                                                                              | **43** |                         **296** |

The text scales are normal, large and xlarge; widths are 360 and 1280 pixels.
Captures check horizontal overflow and absence of internal identifiers/secret
labels before saving full-page images. The separate catalog pagination captures
use xlarge at 360 pixels. Each fan-publication case scrolls the personalized
body into view, awaits the real read acknowledgement and settled fonts/layout,
then saves both a full-page image and a full-card image (six additional card
captures). Scheduling uses separately labeled KST date and time controls at
every scale/width; the submitted UTC instant remains asserted. Capture counts describe the authored successful path,
not files observed from a completed run. Failure screenshots can add files.
Actual artifact/head verification and visual inspection must still be recorded
before reporting a browser or visual pass.

## What the scenarios establish

- Explicit `confirmed: true`, saved-revision CAS, strict future scheduling,
  ownership/current membership, current-state idempotent replay, and safe DTOs.
- In-app visibility with canonical server-side name rendering; current
  subscription/history enforcement; canceled paid access and grace eligibility;
  exclusion of expired recipients at execution, rather than at scheduling time. The
  paid-feed HTTP endpoint rejects expired access with `403 SUBSCRIPTION_REQUIRED`
  and no content DTO; it does not return a successful empty feed or preview.
- Scheduled work stays unpublished until due; repeated/concurrent protected
  worker invocations do not duplicate publication/outbox rows. Missing
  notification policy does not fabricate delivery or prevent in-app publication.
- Cancellation before publication, after publication within the exclusive
  window, and rejection after the window; preservation of prior read evidence
  and suppression of future reads. Queued notification rows never gain a
  provider-accepted timestamp merely because publication succeeded.
- A normal generated PNG follows the existing accepted upload/complete/read
  contract. The published message reuses its logical media ID and association.
  Cancellation denies new signing; the suite does not claim that previously
  issued capabilities are retroactively revoked.
- Route interception can let the real server transaction commit and then drop
  its response. UI retries preserve the exact operation; status recovery does
  not create another message. Double confirmation creates one intent.
- Frozen editor recovery, loading/empty/error states, KST wall-clock entry,
  canceled dialogs, bookmarked former drafts, fresh Back/Forward state, paused
  artist cancellation, cursor paging, and same-artist owner isolation.

## Fixture and evidence boundaries

Time-travel helpers are explicit fictional metadata setup, never production
clock controls. `makeScheduledDue` changes **both** `messages.scheduled_at` and
`artist_dispatch_submissions.next_attempt_at` in one transaction for the exact
fictional message/artist. Publication still goes through the protected worker.
Rate-window aging is limited to the fictional author and only permits catalog
and history pagination setup; it does not disable the real limiter.

Transport-error screenshots deliberately stub safe error envelopes. Four
`dispatch_error` screenshots use labeled renderer-state fixtures; they do not
prove the worker reached those conditions. Actual author/policy-unavailable
worker recovery has separate real-DB browser scenarios. Atomic rollback,
independent worker/cancel races and process-crash semantics are covered by the
feature's database suites, not inferred from screenshots or repeated sequential
HTTP calls.

Local Docker and browser execution are unavailable in this task. The existing
local browser denial was not retried or escalated. The blocked independent
media/security review was not retried, replicated, delegated, or replaced with
parser probes. These tests use only the existing media API's ordinary functional
contract; actual microphone/device permissions and universal video playback are
not established. No local-browser, actual-device, staging, or production pass is
claimed here.
