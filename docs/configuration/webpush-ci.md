# Web Push browser verification

The `webpush-browser` job uses a disposable, CLI-managed local Supabase stack
and a local Next.js production build. Fictional fan identities complete the real
onboarding RPCs before using notification settings. A separate completed artist
fixture includes a valid calling name in the same update as its role change.
No real user, customer content, provider account, delivery worker, deployment or
recurring scheduler is activated.

## Explicitly synthetic browser contract

The browser suite replaces `Notification.permission`,
`Notification.requestPermission` and `ServiceWorkerRegistration.pushManager`.
Native service-worker registration, script identity and the actual MessageChannel capability reply remain in use. Synthetic failure-only cases override waiting/installing lifecycle observations or reply with an obsolete worker version; they never fake a successful reply, activate a replacement worker or call skipWaiting. The fake
PushManager exposes the same subscription, key and unsubscribe interfaces;
permission prompts and provider registrations never happen. Its public RFC 8291
example keys and fictional endpoint paths are test fixtures, **not operational
VAPID credentials**. No generated or persistent account keys are used.

The app's actual GET/POST/DELETE handlers, verified Auth sessions, cookie behavior,
private RPCs, ownership and consent checks execute against real local Supabase.
Delivery adapter protocol tests are separate controlled-I/O tests; neither suite
proves device display, delivery latency, provider interoperability or a user's
actual system-permission flow. Real iOS installed Safari PWA and Android device
verification remains a separately authorized launch check.

## Safety gates

`scripts/webpush-local-config.mjs` requires GitHub Actions CI, prior local-auth
setup, exact loopback application and Supabase origins, matching disposable
service keys and no Docker override or hosted-project credentials. Inherited
Web Push/VAPID settings are rejected. The helper writes static synthetic VAPID
fixtures plus `WEBPUSH_ENABLED=true` for registration and
`WEBPUSH_WORKER_ENABLED=false`. It does not provide a Cron secret.

Fictional SQL also verifies the default local Unix-socket Docker context. The
browser rejects external requests. Traces are off; screenshots contain only
fictional settings UI. The CI job destroys the whole disposable stack after
execution. No table trigger, authorization constraint or policy gate is disabled.

- `npm run test:webpush-fixture`: pure environment and test-discovery guards.
- `npm run test:e2e:webpush`: configured, isolated browser suite.
- The default keyless suite verifies configuration failure without fabricated
  success.

Local Docker/browser execution in the implementation executor remains
unavailable/denied and is not retried. Test discovery, TypeScript checks and
fixture-unit tests are not browser passes. Completion requires exact-head CI and
visual inspection of actual screenshots at normal, large and extra-large scales
on narrow and desktop layouts, including initial and error states. Account-switch
captures assert the actual rendered scale, not merely the screenshot filename.

## Browser inventory

- GET status and explicit confirmed registration through real verified-session
  handlers; duplicate registration keeps one device and creates no delivery job.
- Same-origin and consent rejection; another account cannot adopt an endpoint.
  Restricted users can still revoke their own browser endpoint.
- Browser subscription options retain the applicationServerKey actually supplied to subscribe. The POST binds that public key to current server configuration; stale keys fail before registration. Changed native key material causes durable revocation and native cleanup, then requires fresh explicit consent.
- Waiting, installing and obsolete-capability workers cannot enroll. Normal flows await actual activation and receive the real worker capability reply before subscription.
- No permission request on mount, refresh, unsupported guidance or iOS browser
  guidance. Explicit checked opt-in is the only synthetic request entry point.
- Dismissed/denied prompts, deferred prompts during navigation, subscription
  failure, lost server response, permission withdrawal and failed browser cleanup
  remain distinct; retries consult durable state before claiming success.
- Automatic native unsubscribe after confirmed foreign-account status, and explicit subscription replacement after account switch; explicit logout revokes
  the authenticated session's devices. A still-valid session on another login is
  not falsely described as remotely logged out merely because cookies changed.
- Fan-home entry plus new subscriptions/in-page install-guide/Back navigation, browser Back and re-entry;
  unsupported and unconfigured users can continue using messages without push.
- Normal, large and extra-large scales at 360px and 1280px; each initial, active,
  revoked, retry, unsupported, iOS install/installed, unconfigured/account-switch,
  dismissed, browser-failure and cleanup-error capture asserts actual font scale
  and no horizontal overflow.
- The keyless error screen separately covers all six viewport/scale combinations
  and clicks Retry and Back without fabricated opt-in success.

There are currently 50 configured and 7 keyless browser cases with 102 explicit
planned captures. These counts describe written coverage, not an execution
result; authoritative exact-head CI results and reviewed captures are recorded in
the feature work log after execution.
