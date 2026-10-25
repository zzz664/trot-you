# Browser Web Push delivery

This feature connects explicit browser opt-in to the existing message outbox.
It does not activate a deployment, recurring Cron, notification policy or live
provider account. Billing notices, schedule reminders and Alimtalk are separate
features: this worker selects **message jobs only**.

## User flow and privacy

Completed fans reach `/settings/notifications` from the home screen. The page
shows browser permission, provider readiness and the current browser device
state separately. A checkbox and explicit enable click precede the permission
request and `PushManager.subscribe`. Rendering, focus, retry, navigation and
service-worker updates never request permission or enroll silently. Permission
denial/dismissal, insecure/unsupported browsers, iOS browser versus installed
PWA, unavailable policy/configuration and failed browser cleanup have durable
inline guidance. The in-page installation guide works for completed users;
it does not send them back into onboarding.

iOS/iPadOS Web Push requires a supported Home Screen web app and a direct user
interaction. Capability detection, not a claim that every browser supports
push, determines the available controls.
[WebKit platform guidance](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[PushManager subscription contract](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)

Browser status comes from its actual PushManager subscription; no endpoint,
credential or device identity is persisted in localStorage. Status POST bodies
avoid endpoint URLs in query/access logs. Server RPCs bind registration to the
verified JWT actor and live `auth.sessions` identity, and reject transfer to
another account. Explicit registration atomically enables global/new-message
preferences while preserving unrelated billing/schedule preferences. Other
devices are not disabled by one browser's opt-out.

Native authenticated status/revocation RPCs do not require VAPID or service
credentials. Logout revokes the current Auth session's endpoints before Auth
sign-out; incomplete revocation is not reported as complete. A removed or
expired Auth session also fails the final send gate. A successful foreign-device
status observation performs local unsubscribe only, preventing a browser that
changed accounts without logout from retaining the prior account's endpoint.
An uncertain/unconfigured status is never interpreted as proof of foreign
ownership. There is no automatic endpoint transfer or background re-enrollment.

Only fixed generic notification text is displayed. The encrypted payload has
exactly `{version, notificationId, url}`; `url` is the subscription-list route.
It contains no fan identity, artist/source identity, message body, preview,
contact detail or media URL. Clicking always goes through current authenticated
application navigation. Old accepted notifications can remain on a device, but
cannot reveal the previous account's content. Same-origin safe clients may be
focused; arbitrary payload URLs, fragments and external destinations are ignored.

The existing service worker still caches public static assets only. A narrow
public capability handshake confirms push support before subscription; an old
active worker or waiting/installing update requires closing/reopening app
windows. No `skipWaiting`, private cache route or arbitrary worker command was
added. Subscription-change events do not silently grant new consent.

## Configuration and activation gates

Provide existing application credentials only through server environment:

| Variable                 | Meaning                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`       | Canonical base64url uncompressed P-256 public key. Returned to authenticated browser settings, never the private key. |
| `VAPID_PRIVATE_KEY`      | Matching canonical base64url private scalar, server only.                                                             |
| `VAPID_SUBJECT`          | Reviewed `mailto:` or HTTPS operator contact URI.                                                                     |
| `WEBPUSH_ENABLED`        | Default false. Allows configured registration when DB policy and user consent also permit it.                         |
| `WEBPUSH_WORKER_ENABLED` | Independent default-false delivery switch.                                                                            |
| `WEBPUSH_CRON_SECRET`    | Separate 32–256 URL-safe bearer token, not shared with other workers.                                                 |

No key-generation command, live credential, customer endpoint or production
policy is included. `SUPABASE_SERVICE_ROLE_KEY` is needed for trusted register
and worker RPCs, never supplied by browser input. An approved private notification
policy (including consent version and lease at least 10 seconds) is also required.
Missing/invalid configuration fails closed rather than substituting mock success.
Synthetic public RFC examples exist only in guarded isolated CI fixtures.

The protected Node route `/api/cron/send-notifications` accepts an empty GET/POST
with its dedicated bearer secret. It rejects query controls, body data and other
secrets before creating service dependencies. Its finite route budget is not a
scheduled job. No Vercel Cron configuration or production activation is added.

See [protocol and egress boundary](webpush-protocol.md) for precise currently
supported provider hosts, encrypted wire format, DNS pinning, TLS and status
classification. This is a deliberately limited allowlist, not universal push
provider support. A verified future endpoint format requires code review/tests.

## Queue and delivery meaning

The existing transactional message dispatch already creates unique
source/channel/user/device outbox rows. The new worker scans at most 100 recovery
handles, then up to ten 100-row pages (at most 1,000 distinct due jobs) per
invocation, with at most 20 concurrent tasks and a 45-second scheduling budget.
It stops on a depleted page, repeated/no-progress page, deadline or page ceiling;
it does not loop indefinitely until empty. Unstarted backlog remains for the
next authorized invocation. The 90-second route ceiling leaves room for bounded
in-flight I/O to settle after the scheduling budget ends.

Before network I/O, a one-time preparation RPC rechecks source visibility,
current recipient access, restrictions, artist state, preferences, consent,
device state, live session and lease under ordered database locks. Fewer than
five lease seconds never authorize a fresh provider request. The adapter has a
four-second total DNS/connect/TLS/header deadline, rejects redirects and pins
only approved global DNS addresses. Raw endpoint, keys, provider responses and
notification content are never logged.

Transient responses use bounded exponential backoff plus a provider
`Retry-After` minimum. Per-attempt replay cannot shorten or extend the first
recorded bound. Waits beyond the supported one-day horizon terminate that
attempt rather than retrying earlier than requested. Dead endpoints (404/410)
are revoked and pending sibling jobs suppressed. Attempts stop at the policy
maximum. Timeouts/lost responses are ambiguous, not proof of non-delivery;
recovery waits until the lease and backoff expire and fences old completions.

This is **at-least-once**, not exactly-once delivery. HTTP 201/202 means
**accepted by the push service**, not displayed, delivered to a device or read.
A stable opaque Topic and notification tag reduce pending duplicates where
supported but cannot guarantee deduplication. Revocation/source cancellation
before the final gate prevents a request; no database transaction can recall an
already issued/accepted request. Worker output reports only bounded aggregate
checks/outcomes, never endpoint or recipient material.

No 1,000-recipient/one-minute device-delivery SLA is claimed. Database fan-out
and synthetic bounded-worker backlog tests are distinct from measured provider
throughput or actual device arrival. Authorized staging/device measurement is
still required after real keys and policy are supplied.

## Verification boundaries

See [database contract](../database/webpush-delivery.md) and
[isolated browser CI](webpush-ci.md). Unit protocol tests include the public
RFC 8291 vector and independent decryption/JWT verification over a controlled
loopback HTTP transport. Production DNS/TLS behaviors are separately simulated.
These tests do not contact a real push endpoint.

Browser CI uses actual local Supabase/Auth/RPC and the built service worker,
but simulates PushManager and OS permission results. All three text scales and
narrow/desktop layouts have initial/error/link-state captures for ordinary
visual review. Actual iOS/Android device permission, push arrival, display,
click, browser-specific key rotation and hosted HTTPS behavior remain untested.
Local Docker/browser restrictions were respected; no denied retry/escalation,
live push, credential generation, deployment or recurring job was performed.
