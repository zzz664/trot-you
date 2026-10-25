# Billing prenotices: configuration and operating boundary

This feature creates an actual authenticated in-app notice and optional Web Push
outbox jobs for an upcoming renewal. It does not charge money, contact a payment
provider, approve policy, send real pushes during development, or activate a
recurring schedule.

## Approved policy, not a hidden default

An immutable `private.billing_notice_policies` row must explicitly approve the
KST calendar-day offset, KST hour and mandatory-in-app choice for the exact
accepted checkout/renewal policy. The source planning value is not seeded as a
runtime approval. Existing checkout approval, renewal approval, current policy,
accepted current legal documents, mandate, credential reference and original
monthly anniversary must all still match.

The candidate date is computed in `Asia/Seoul`, independent of the database host
time zone. Its configured schedule must be early enough for the renewal policy's
minimum lead. A delayed invocation may create an informational catch-up notice
before the billing time; this does **not** establish timely delivery. Cancellation,
rescheduling, policy/price/mandate changes, a non-active subscription, a current
restriction or an open financial obligation suppress stale notices. An unknown
payment outcome never authorizes another charge or a fresh upcoming-price claim.
One immutable notice identity per subscription/upcoming period prevents duplicate
publication by concurrent workers. A changed snapshot is hidden, not silently
rewritten into a different approved price.

`mandatory_inapp` describes only an explicitly approved product delivery choice.
It is not a declaration about Korean law, legal notice requirements, or compliance.

## In-app view and preference

`/me/billing-notices` is reachable from the fan home and own subscriptions. The
server component verifies the session but does not put financial snapshots into
the reusable RSC payload. The mounted view requests an authenticated `no-store`
projection, displays only current exact KRW amount and KST date, and links directly
to the corresponding owner-only subscription-management page.

The page has deterministic timestamp/UUID pagination, explicit refresh, loading,
empty, unavailable and access-lost states. Leaving, hiding or restoring the page
clears detail and requires a fresh projection. Stale responses are fenced; no
financial details are persisted to browser storage or the service-worker cache.
A response can still become outdated after it is authorized; the application
cannot retract information a person has already seen.

The narrow billing-preference control preserves every unrelated preference.
Optional in-app notices require this preference. Mandatory in-app notices do not.
Push always additionally requires current device/session/global opt-in and
consent; a mandatory in-app policy never overrides push choice. This control does
not request browser permission or register a device. The separate notification
settings screen owns that explicit browser/device flow.

`읽음으로 표시` stores an owner-requested read marker, not proof of comprehension,
verified delivery, charge approval or legal receipt. Reading/listing/creating a
notice and push-service acceptance **never insert `renewal_notice_receipts`**.
Required renewals therefore remain blocked until the existing external verified
evidence requirement is legitimately satisfied. This feature does not weaken or
invent an alternative to that requirement.

## Protected bounded worker

| Variable                      | Meaning                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `BILLING_NOTICES_ENABLED`     | Defaults to `false`; enables only the publication worker code path.                                      |
| `BILLING_NOTICES_CRON_SECRET` | Dedicated 32–256 character non-whitespace URL-safe bearer secret; may not equal another worker's secret. |
| `SUPABASE_SERVICE_ROLE_KEY`   | Existing server-only capability for the narrowly granted worker RPCs.                                    |

The route is `GET` or empty `POST /api/cron/billing-notices`, with exact bearer
authorization, no query parameters and no request body. Authentication precedes
DB dependency construction. It examines at most 100 candidates in bounded pages
within a finite invocation budget. Output counts `created`, `skipped`, `failed`
and `pushJobsQueued`; none of these are a “notified” or “delivered” count. A lost
commit response is uncertain to the caller, while the database identity prevents
a duplicate notice on a later invocation.

No `vercel.json` schedule, hosting plan change or cron activation is included.
An authorized operator must separately supply approved policy and configuration
and choose/validate an invocation cadence. Enabling publication does not enable
Web Push transport or payments.

## Existing Web Push worker extension

The existing final-preparation gate now supports exactly `message` and
`billing_notice`. Payment-event and schedule jobs remain excluded. A billing
notice is revalidated under current eligibility locks immediately before the
one-use endpoint/key projection. Cancellation and opt-out cannot recall an HTTP
request already issued. Its genuine accepted or unknown result remains honest.

Payloads contain only protocol version, opaque outbox identity, the fixed
`billing_notice` discriminator and fixed authenticated inbox path. No amount,
billing date, subscription ID, artist, name, credential or remote body is sent.
The service worker chooses generic local copy and allows only the two fixed
internal destinations. It never acknowledges delivery/read in the database.
Existing retry, unknown recovery, dead-endpoint cleanup and token fences apply;
push is at least once, and acceptance is not device display.

## Verification scope

The normal source review, unit tests, rollback-only pgTAP, independent-session
races and dedicated real-browser CI use fictional data. Browser CI invokes only
the notice publication worker with a public fixture secret; payment and actual
push workers stay disabled. No real permission is granted, key generated,
provider contacted, policy approved, deployed user modified or scheduler started.
See the dated work log for exact executed results and pending checks. Local
Docker/browser restrictions are not bypassed. The prior blocked independent
media review is not retried or represented as completed by this feature.
