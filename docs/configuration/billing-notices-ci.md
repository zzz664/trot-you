# Billing-notice browser verification

This feature's dedicated browser suite is restricted to the disposable local
Supabase stack inside its GitHub Actions job. It is not a deployment recipe or a
production policy seed. Local browser/Docker execution has not been performed.

## Isolated setup

The job runs the existing local Auth initializer, resets the actual migrations,
then runs `node scripts/billing-notices-local-ci.mjs environment`. The pure guard
requires GitHub Actions, exact loopback app/Supabase origins and matching local
service keys. It rejects remote Docker context/host, hosted Supabase credentials,
unknown payment secrets, VAPID material and inherited worker configuration.

The preceding Auth helper's exact public unusable checkout placeholders are the
only accepted payment input. The billing-notice initializer clears those values
and sets `PAYMENTS_MODE=disabled`, with payment renewal/refund/reconciliation and
Web Push switches disabled. Only the notice-creation route is explicitly invoked
with a public fictional CI secret; no recurring schedule is created or enabled.
No browser permission prompt, push-service transport, PG registration, charge,
refund, key generation, hosted database or production user is involved.

The default Playwright config excludes `tests/e2e/billing-notices/`. Its seven
keyless cases remain in the default suite. The dedicated config includes only
23 billing-notice cases, uses one worker and no retry, and records no trace.
Pure fixture/discovery tests use `--list` only; discovery is not browser execution.

## Fictional data and actual behavior

- Accounts come from real local GoTrue and complete the real onboarding RPCs.
- Test-only historical subscription, mandate, encrypted-placeholder credential,
  checkout and initial-ledger source rows are explicit fixtures, not evidence of
  actual provider enrollment or money. Bound immutable source rows remain only
  until the disposable stack is torn down; no immutability trigger is disabled.
- The approved fictional monthly calendar is Seoul-local. A 25-day-old anchor
  places its monthly anniversary three to six days ahead, including month ends.
  The seven-calendar-day KST notice policy is explicitly test-only, never a
  default runtime business rule.
- Actual `billing_notice_create` or the protected local HTTP worker creates each
  inbox row. Tests do not insert fake inbox rows or renewal notice receipts.
- Reads, explicit read marks and optional billing preference changes use the
  authenticated application HTTP endpoints. Cross-owner reads, stale marks and
  cross-origin mutations fail closed. Other preference fields are preserved.
- Cancellation, rescheduling, changed/unaccepted checkout price and an existing
  unresolved fictional operation suppress the old amount. Read marks never
  satisfy the existing verified-delivery renewal precondition.

## Planned browser and capture inventory

The configured suite has 23 cases and 59 explicit captures. Six keyless visual
cases add six captures (65 total); the seventh keyless case checks the APIs.
This inventory is prepared coverage, not a claim that CI has passed.

| Surface/state                                                                                                                    | Capture coverage                              |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Home entry, initial inbox, own subscription destination, subscription-list entry                                                 | Three font scales at 360 and 1280 pixels (24) |
| Explicit read mark, optional on/off with mandatory notice retained, switched-account empty state, empty subscription destination | Three scales at 360 pixels (15)               |
| Interrupted load, main-scoped load error, retry recovery, restriction, lost session                                              | Three scales at 360 pixels (15)               |
| Next/second-page controls and history revalidation                                                                               | Extra-large at 360 pixels (2)                 |
| Malformed cursor, real Retry and first-page recovery                                                                             | Three scales at 360 pixels (3)                |
| Keyless setup error before interacting, Retry and Back                                                                           | Three scales at both widths (6)               |

Every labeled configured capture verifies both the HTML scale and the computed
body font size (18/21/25 px), including after account switches. Keyless captures
verify the same computed sizes. Every capture checks horizontal overflow; alert
assertions are scoped to the page's `main`. Pagination's long first page uses a
viewport capture at its next control rather than a redundant enormous image.

Client unit tests additionally cover stale response fencing, request aborts,
visibility/pagehide clearing, BFCache/history restoration, repeated mutations,
strict bounded JSON/UTF-8 transport, and current no-store revalidation. Actual
browser results and visual review must be recorded for the exact final CI head.
