# Schedule notices

## What is implemented

The authenticated schedule list and detail expose a schedule-category
preference and explicit per-event allow/opt-out state. Turning a category on
is not browser notification permission, Web Push registration or proof of
receipt. The existing notification settings page owns device consent and
installation guidance.

`GET` or empty `POST /api/cron/notify-schedules` queues next-day reminders only.
It never sends a push, calls a payment provider or installs a scheduler. The
existing separately enabled `send-notifications` worker owns actual Web Push
transport and its database preparation fence.

## Required separate operator approval

| Setting                                                       | Meaning                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `SCHEDULE_NOTICES_ENABLED`                                    | Defaults false; enables only the bounded queue route.                            |
| `SCHEDULE_NOTICES_CRON_SECRET`                                | Dedicated 32–256 URL-safe bearer secret, distinct from all other worker secrets. |
| `private.schedule_notice_policies` and current pointer        | Explicit approved/published immutable KST-hour policy. No policy is seeded.      |
| Existing notification policy, Web Push credentials and worker | Independent consent/device/transport capabilities; not automatically enabled.    |

The supplied design suggests 10:00 KST. It does not approve or install that
schedule. A separately authorized scheduler would invoke the protected route
at the approved hour and drain remaining batches; a daily single invocation
cannot promise an unbounded backlog will finish. The route limits candidates,
pages and elapsed work and returns aggregate `hasMore`/failure counts without
user or event data. Invalid credentials, parameters and bodies are rejected
before capability construction. Responses are private and no-store.

Alimtalk remains unavailable until a provider contract, recipient consent,
approved templates and credentials exist. There is no invented universal
Alimtalk API or fallback claiming a guaranteed arrival.

## Time, recipients and replay

Next day is a KST calendar-date comparison, not start-minus-24-hours. Event
midnight boundaries, month/year rollover and leap dates obey the same rule.
Creation begins at the approved hour and stops at that local day's end.
Current published events and active artists only; current subscription access
matches the existing my-artists filter, including its existing paid-period and
grace-access semantics.

The queue requires opted-in schedule and Web Push categories, no event opt-out,
valid device consent and active authentication session. Preparation rechecks
profile, artist, entitlement, event, opt-out, preference, device and policy
before external I/O. Logout, account replacement, suspension, unpublished or
deleted events and policy changes cannot authorize stale prepared content.
A request already outside the database transaction cannot be recalled.

One source/channel/user/device identity is durable across replay. Event time
changes cancel old work; re-enabling a preference or event does not resurrect
terminal/uncertain jobs or invent a repeat-reminder policy. Global disable cancels
its captured committed active jobs; a concurrent enqueue can still see the prior
committed preference. Such late work must pass the current preference again at
claim/preparation. Explicitly re-enabling before that check can authorize a job
that was never canceled; that is not resurrection or proof of recall. Per-event
opt-out serializes with event queue creation. Fresh sessions and devices remain
subject to the same bounded current-window rules.

## Privacy and delivery semantics

Encrypted provider payload contains only protocol version, opaque notification
job ID, `schedule_notice` kind and fixed `/schedules` path. It never contains
fan/artist identity, event title/time/location, coordinates or financial detail.
The service worker uses bundled generic Korean copy and an allowlisted local
destination that resolves the currently signed-in account. No personalized
schedule data is cached by the public-asset service worker.

Queue creation, provider acceptance, browser display and human receipt are
separate facts. Existing retry/unknown/dead-endpoint semantics are retained.
Neither a queue record nor a 201/202 acceptance creates delivery/read evidence.

Source review also repaired the existing real adapter payload allowlist, which
previously rejected the already-supported billing-notice envelope. Existing
billing UI/queue tests had not established actual adapter compatibility. New
synthetic encryption/decryption contract tests cover both notice categories
without contacting a provider; they do not establish live device delivery.
