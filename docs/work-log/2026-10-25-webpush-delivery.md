# 2026-10-25 Web Push delivery

## Scope and provenance

Started from merged develop `cba8aa72d211411b6a3912a93c32a1f010335300`,
tree `2a5229cd058dae78230db1e0634c373bbd687148`, on the sole active
`feature/webpush-delivery` branch. The preceding local tip was bundled and
archived, verified tree-identical to develop and removed. The DB-only checkpoint
was published by the parent as `453c34db49a5b68cf87511b10317c8aedbc511fb`,
tree `10da13bd604c7b6ba9df88c6d21eda14f57cfaba`; local history was safely
aligned to that exact tree without replacing in-progress application files.
The fixture-only corrected checkpoint `e3abfd2d4187f7f41f4cd710603e3973c763a324`
was also tree-verified and aligned before the application commit.
No feature code is directly pushed to main/develop.

This is one message Web Push feature: browser opt-in/out, current-session device
ownership, logout/revocation, generic worker notification/click handling,
RFC-compatible VAPID/encrypted provider adapter and bounded leased message-outbox
delivery. Billing notices, schedule delivery, Alimtalk, admin analytics, policy
activation, credentials and production scheduling are not folded into it.
Private source requirements were reviewed but are not published here.

## Important decisions and fixes

- Explicit checkbox/click before permission/subscription; no mount/focus/update
  prompt, silent re-enrollment or forced service-worker activation. Missing or
  unsupported capability, iOS Home Screen requirements, denial/dismissal,
  unconfigured policy/provider, cleanup failure and interrupted flow are separate.
- Native authenticated status/device/session revoke remain available without
  provider/service-key configuration. Registration binds a verified actor and
  live Auth session, never transfers another account's endpoint, and atomically
  enables only message preferences. Logout revokes before Auth sign-out; a
  missing/expired session fails closed at final preparation.
- Account changes safely remove a confirmed foreign native subscription;
  unknown/unconfigured status does not authorize destructive inference.
  VAPID key rotation durably revokes the previous binding and requires explicit
  renewal. The subscribe request binds the current public key, so a stale page
  cannot register against a newly changed configuration without rechecking.
- Completed-user installation guidance is in-page; the old onboarding install
  route redirects completed users and is not misrepresented as a usable guide.
  A narrow MessageChannel public-version handshake detects an old active worker
  or pending update before subscribe. Cache policy and `skipWaiting:false` stay.
- Provider endpoints use documented current Chromium/Mozilla/Apple allowlists,
  canonical HTTPS and valid P-256 material. Production transport denies mixed
  private/public DNS answers, pins a public address, verifies TLS/SNI, uses no
  proxy/redirect override and has a total four-second deadline. Delayed DNS
  callbacks cannot initiate an already-timed-out request.
- Lock-screen payload/copy never contain user/artist identity, source body,
  media URL or contact information. Only version, opaque job ID and a fixed
  authenticated subscription-list route are encrypted. No endpoint/key/payload
  logging and no device-display/read receipt are invented.
- Existing transactional message outbox is reused. Final one-time preparation
  rechecks current source/recipient/subscription/session/preferences/consent under
  ordered locks. Recovery is bounded and explicitly at-least-once: timeout is
  ambiguous, stale completions are fenced, retry budget is finite and dead
  endpoints suppress siblings. Provider Retry-After is a persisted minimum;
  evidence replay cannot move it. Waits beyond one day terminate rather than
  retry before the provider's requested horizon.
- Integration review caught new transformed environment flags breaking existing
  payment adapter revalidation. The payment-only projection now strips these
  unrelated worker flags, preserving its previous behavior; full regressions
  and an explicit new compatibility assertion cover this.
- Worker responses use `acceptedByPushService`, not delivered/read, and
  `recoveryChecked`, not a falsely inferred state-change count. Aggregate outcome
  totals must equal examined jobs. A synthetic 1,001-job bounded backlog drain
  (at most ten 100-row pages, 20 concurrent tasks and 45 seconds of new-work
  scheduling per invocation) and actual DB 1,000-recipient fan-out fixture do not
  claim a measured delivery SLA or real provider/device arrival.

## Verification before application publication

The immutable DB checkpoint includes 108 new pgTAP assertions and 24 independent
real-session race scenarios, with legacy fixtures preserved. A tests-only bulk
follow-on adds 18 assertions (126 new total) without any schema/type change.
Corrected checkpoint CI passed migrations/lint, **3,247 pgTAP assertions twice**
and **297 independent-session race scenarios**, including the new 24. Genuine
`database.ts` was copied unchanged from verified official artifact `12583138546`
(SHA-256 `6c185f93f63d4dc76f2c832978faf9313467af6bcb6dc67b86771ef7ed60a29d`).
No generated types have been handwritten. The 18-assertion bulk follow-on and
final application still require exact-head CI.

After importing the genuine schema, **`npm run check:all` passed in full**:
ESLint/Prettier, generated routes/TypeScript, **5,767 unit tests across 181 files**,
all 10 contrast pairs, and production Next.js/PWA build. Separately,
`node --test scripts/*.test.mjs` passed **181 fixture/configuration guard tests**.
The previous nine missing-RPC type diagnostics are resolved by the genuine
artifact, not hand-maintained declarations. The final code diff has no whitespace
errors. These local passes are not substitutes for exact-head CI/browser results.

Adapter tests use public synthetic RFC fixtures, exact ciphertext vectors,
independent AES-GCM decryption/JWT verification over controlled loopback HTTP,
and simulated production DNS/TLS contracts. There were no real endpoint calls.
Browser coverage is documented in the dedicated CI inventory, including initial,
error/recovery and visible-link screenshots at normal/large/xlarge fonts and
narrow/desktop widths. Planned cases/captures are not reported as executed.

Local Docker is unavailable and local browser execution remains denied. Neither
was retried or escalated. Actual browser CI, screenshot visual review and final
exact-head checks remain required. The previously blocked independent media
review was not retried, replicated, delegated or probed; ordinary Web Push
functional/ownership review is distinct.

No real OS permission, persistent/account key generation, real user data,
customer endpoint, provider push, paid resource, deployment, recurring Cron or
operational policy change occurred. Real iOS/Android device push and hosted HTTPS
must be verified separately after user-provided keys and authorization.
