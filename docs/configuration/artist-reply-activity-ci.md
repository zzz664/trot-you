# Artist reply/activity verification

The `activity-browser` job starts a disposable local Supabase stack and a local
Next.js production build. It creates fictional artist/fan identities, source
messages/replies, memberships and policy fixtures. It neither uploads media nor
calls a notification/payment provider. No scheduler or deployment is enabled.

## Guards and commands

`scripts/activity-local-config.mjs` requires GitHub Actions CI, the existing
local-auth fixture mode, exact loopback application/Supabase origins, matching
local service keys, and no hosted Supabase credential or Docker override. It
emits only `ACTIVITY_LOCAL_E2E=true`; no new production environment variable or
policy fallback is introduced. Fixtures also check the default local Unix-socket
Docker context before SQL and restore/delete their disposable data.

- `npm run test:activity-fixture`: pure local-CI environment/discovery guards.
- `npm run test:e2e:activity`: dedicated guarded browser suite, excluded from
  default keyless Playwright discovery.
- `npm run test:db:activity-concurrency`: independent PostgreSQL sessions against
  the disposable CLI-managed local stack, with reset teardown.
- `supabase/tests/artist_reply_activity*.test.sql`: real source-week, projection,
  cursor, role/membership and legacy-ABI assertions, included in pgTAP twice.

These scripts do not make local Docker/browser execution available. In this
executor those paths remain unavailable/denied, and are not retried. Actual
execution is the authorized CI path; discovery and fixture-unit tests are not
browser passes.

## Functional browser inventory

- Exact calling-name-only response keys; source counters and unchanged financial
  and delivery state.
- Independent reply/message cursor pages, artist scope, selected-message scope,
  expired fan subscriptions retaining eligible already-received text.
- Omitted blocked/deleted/restricted fan replies, canceled source association,
  wrong role/artist, missing onboarding, revoked membership and paused artists.
- Actual artist-home link → assigned-artist menu → received-reply screen;
  menu next/first/back links, empty menus and selected-artist links.
- Expand/collapse message chooser; sent-message links, older/first message
  pages, selected filter/all reset, reply next/first links and Back/Forward.
- Current-week source display, explicit unavailable contract requirements,
  no-reply/no-message/filtered-empty screens.
- Refresh failure/retry, lost access, older delayed response not overwriting a
  newer refresh/navigation, and history revalidation.
- Normal, large and extra-large text at narrow and desktop viewports, with
  explicit screenshot attachments and horizontal-overflow checks.

The default keyless suite separately checks both API reads return real
configuration errors, unsupported GET is rejected, error Retry is clicked and
Back navigation works without fabricated data. Traces are disabled in the
configured suite; screenshots contain only fictional text.

Before completion, inspect actual captures and the exact-head status of every
required CI job. The earlier blocked independent media review remains excluded;
these are normal feature/API functional checks, not replacement media probes.
