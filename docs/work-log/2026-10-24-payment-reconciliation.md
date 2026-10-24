# Query-only payment reconciliation — 2026-10-24

## Delivered scope

- Durable private recovery cases for unknown/expired initial, renewal and already-authorized/dispatched refund operations. A bounded fair scan prevents an unconfigured merchant prefix from starving later cases.
- `/api/cron/reconcile-payments`: dedicated bearer authorization, empty bounded request, four candidate inspections and at most one authenticated provider query per invocation. Neither the dependency port nor its runtime object exposes charge/refund/approve/exchange operations or decrypted credentials.
- `/api/webhooks/payment/toss`: narrow actual `PAYMENT_STATUS_CHANGED` / `BILLING` / card / KRW parsing, 16-KiB / 256-chunk / one-second body limits, six-second receipt DB deadline. Exact machine routes bypass cookie Auth proxy work, retain private headers, and cannot bypass their own authorization/configuration checks.
- Toss notices are explicitly **unverified advisory hints**. A transmission header is not authentication. Only known local order/merchant/environment/amount matches can create a bounded case receipt. Neither provider payment IDs from the notice nor raw customer/card/cancel payloads are adopted or stored. Semantic case/status dedupe cannot be bypassed with arbitrary transmission IDs, action IDs or timestamps.
- Settlement uses the existing exact initial/renewal/refund finalizers and marks case/inbox together in one transaction. Lost persistence responses allow one exact database-only replay with the original lease; no extra provider call is made.
- Owner-initiated initial recovery now shares the same durable query budget/lease with the worker. Three inconclusive attempts with one-hour backoff lead to visible manual review rather than an endlessly active “check” button. Renewal/refund legacy queries share their original counters and leases.
- `/admin/reconciliation`: current unrestricted admin authorization, bounded read-only pagination, localized states/reasons and no provider/customer/credential IDs in the client projection. It does not authorize more attempts or provide a money-editing override.

## Provider-specific limits, not simulated success

- Toss automatic-billing approvals do not normally emit `PAYMENT_STATUS_CHANGED`; authenticated order queries remain the recovery mechanism. This receiver must not be advertised as a billing-success webhook guarantee. Supported cancellation hints only reference an already-dispatched local refund; unsolicited merchant-console refunds are not fabricated into approved application operations.
- `BILLING_DELETED` is rejected: its billing key is secret-bearing and a safe documented read-only verification path has not been established here. No unsigned notice silently revokes a mandate or entitlement. Foreign-payment asynchronous `CANCEL_STATUS_CHANGED` and unsupported products are rejected.
- Kakao has no implemented payment webhook. A renewal with lost TID remains manual review: SID status and merchant order IDs do not establish a safe query/retry. Known-TID initial approval recovery without the lost SID records verified evidence for review, not a fabricated credential or automatic entitlement.
- Unknown, lookup-not-found and malformed/mismatched provider responses never become definitive failure, presumed revenue, cross-provider fallback or permission to charge/refund again.
- No production scheduler, provider registration, live/test merchant request, key change, external charge/refund, policy approval or deployment was performed. Feature flags default disabled. Private planning originals were not copied into the repository.

## Operations and launch gates

1. Complete the existing provider/environment/merchant configuration and approval prerequisites. Use an independent 32–256 character URL-safe `RECONCILIATION_CRON_SECRET`; reusing either general or renewal Cron tokens is rejected.
2. `PAYMENTS_RECONCILIATION_ENABLED=true` permits the protected query worker and Toss advisory receiver. This setting does not register a webhook or activate a schedule. Owner-initiated initial recovery retains its pre-existing explicit flow but now uses the same durable case budget.
3. A separately authorized operator/scheduler may issue empty GET/POST requests to the protected worker. Never pass operation IDs, limits, merchant overrides, tokens in query strings or request-controlled timestamps. The host must honor the declared 300-second execution budget and leave margin for DB writes.
4. A valid supported but unmatched Toss hint returns the same minimal HTTP200 as a duplicate to avoid an order-existence oracle. No row or money is created for that unmatched hint. Malformed/unsupported input is rejected; a durable receipt failure returns503 so provider delivery can retry.
5. Inspect manual-review cases through the admin page. Missing-TID, missing-credential, exhausted-query and unsolicited-provider-change handling still needs an approved merchant/manual procedure. There is no force-success or unbounded-retry button. Enabling this code does not establish merchant eligibility or resolve these launch gates.

## Official primary references checked 2026-10-24

- [Toss event semantics and limited signature scope](https://docs.tosspayments.com/reference/using-api/webhook-events)
- [Toss delivery policy and ten-second acknowledgement](https://docs.tosspayments.com/guides/v2/webhook)
- [Toss authenticated payment verification guidance](https://docs.tosspayments.com/reference/using-api/security-checklist)
- [Toss payment/order/cancellation API](https://docs.tosspayments.com/reference)
- [Kakao payment detail query requiring TID](https://developers.kakaopay.com/docs/payment/online/payment-detail)
- [Kakao official no-separate-webhook answer, 2026-04-27](https://developers.kakaopay.com/forum/t/webhook/1394) — directly readable during this review.

## Validation status

- `npm run check:all` passed: ESLint/Prettier, genuine-schema TypeScript, all 3,105 unit tests, contrast checks and production Next.js/PWA build. Unit suites cover parser/body limits, strict worker/DB/receipt boundaries, scoped initial recovery, dependency isolation, HTTP/token/configuration gates, read-only admin access and exact proxy exclusions. All contrast checks and 40 offline provider fixture tests pass (14 enrollment + 7 renewal + 13 cancellation + 6 reconciliation).
- Actual Supabase checkpoint [CI 40112639829](https://github.com/zzz664/trot-you/actions/runs/40112639829), exact head `98bc02581c3b421efe7685a6ebfa262c13e6e7c2`: 2,604 pgTAP assertions passed twice, including 111 new assertions; all prior concurrency suites plus 12 new independent-session races passed. Existing immutable-ledger TRUNCATE test includes the new FK-linked tables, so the trigger—not an unrelated FK error—remains the asserted guard.
- New controlled CI-only browser job: 17 scenarios including six text-scale screenshots, real local Supabase/Auth/RPC/ledger and the same real adapters against a guarded loopback fixture. Existing enrollment/renewal/cancellation browser suites remain required regressions.
- Imported genuine Supabase-generated `database.ts` from artifact `12567019556` after exact-head/artifact/ZIP validation and local byte hash recheck: SHA-256 `af71f8afab3e1043ef348c74b3b45360ca93d2b90209d3ac87c16fde6118abf0`. No generated type was hand-authored. The checkpoint database job's only remaining failure was the expected pre-import committed-type drift gate.
- The first application CI exposed a missing default Playwright exclusion: the keyless job collected the 17 isolated reconciliation scenarios without fixture flags. Added the exclusion and six suite-isolation unit guards; list-only discovery now confirms exactly the original 24 keyless tests. No local browser was launched.
- The existing expired-idle enrollment browser scenario exposed a response-handle/navigation race. Its real start response is now captured and schema-checked before the same response reaches the browser, with one `route.fetch` and `maxRetries: 0`; no provider or application command is replayed.
- Dedicated reconciliation CI passed the monetary/auth/inbox/lease assertions but exposed immediate Back→Forward test navigation races in both large-scale scenarios. The test now asserts restored URL and rendered page number after Back, then asserts Forward URL/page state; history coverage remains enabled, with no swallowed navigation error or arbitrary sleep.
- The enrollment harness capture initially imported an application schema with a transitive bundler-only JSON dependency. Replaced that runtime import with independent test-local validation of the exact session/status/provider/environment and complete Toss launch identity/callback origins. Native Playwright list-only discovery now loads all 21 enrollment cases successfully without starting a browser or server.
- Exact-head complete DB/type-drift/browser/screenshot verification of the application commit is still required before merge readiness. Local unit fixtures are not merchant sandbox or live validation.
