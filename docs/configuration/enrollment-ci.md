# Initial enrollment integration fixtures

The `enrollment-browser` CI job runs the actual Next.js application, local
Supabase Auth, private RPCs and billing ledger. Provider HTTP and browser SDK
responses are **fictional local fixtures**, not merchant sandbox verification.
The normal quality build and preparation-only authenticated browser regression
remain separate jobs.

## No external payment requests

- Production uses the real adapters with their ordinary HTTP transport. It
  never selects a successful mock result by provider mode or missing keys.
- Test injection requires every explicit CI flag, `NODE_ENV=development`, the
  exact loopback app/Supabase origins, test mode, and fixed fictional provider
  and vault fixture values. Deployment-platform indicators reject injection.
- The injected transport accepts only the known provider endpoint paths and
  fixture authorization values, then rewrites them to `127.0.0.1:3200`. No
  arbitrary URL, custom host, redirects, refund path or external request is
  supported. Partial activation fails closed. Fixture credentials with a
  missing injection flag cannot accidentally reach a real provider.
- The fixture server listens only on IPv4 loopback, validates Host and Origin,
  bounds request bodies, and has no outbound HTTP implementation.
- Browser tests intercept the official Toss SDK and Kakao handoff URLs. Other
  external browser traffic must be blocked and counted by the test harness.

The vault key in these fixtures is a public all-zero test vector. No real key is
generated, configured or stored by this workflow. The fixture server keeps its
fictional credentials and outcomes in process memory only.

## Failure coverage and observations

The provider fixture supports explicit decline, lost ready/issuance/charge/
approval responses and slow charge scenarios. Toss applies request-bound
idempotency in the fixture. Kakao deliberately **does not** deduplicate merchant
order IDs, so application races cannot be hidden by a fictional guarantee.
Kakao order query exposes a verified payment but not SID, matching the official
recovery limitation. `/__fixture/calls` returns aggregate counters only.

`npm run test:enrollment-fixture` exercises the local fixture contract without
opening a listener or making provider calls. `tests/unit/enrollment-ci.test.ts`
tests runtime gates and transport routing. Full browser/database evidence is
produced only by the isolated CI job; running these focused tests is not a
substitute for that evidence or for later provider sandbox/mobile verification.

## Logging and launch operations

Next development request/fetch/argument/browser forwarding is disabled with
`logging: false`: truncating a provider URL is not adequate redaction because
billing keys may occur in its path. Application callback handlers scrub query
tokens before rendering. Before enabling a hosted merchant integration, the
operator must also configure ingress/CDN/platform log redaction or exclusion
for payment callbacks and provider requests. The application cannot erase a
query already recorded by an upstream proxy.

No merchant registration, production credentials, payment, refund or deployment
is performed by these tests. Actual provider sandbox/live acceptance remains a
separate authorized validation step.
