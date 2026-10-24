# Subscription cancellation and safe refund flow — 2026-10-24

## Delivered scope

- Fan `/me/subscriptions` and paginated charge detail: future-renewal cancellation, truthful paid-access status, separate exact-amount refund review request, durable uncertainty/read-only recovery.
- Admin request inbox/detail: current-policy acknowledgment, exact amount/reason authorization, independent execute confirmation, pre-dispatch rejection/withdrawal and query-only unknown recovery.
- Actual documented Toss/Kakao refund/query adapters, original merchant/environment/payment identity binding, opaque exact-operation correlation, stable attempts and immutable negative money recognition.
- Owner cancellation remains usable with account restrictions, incomplete onboarding or role changes, and is decoupled from unrelated provider configuration errors. Invalid Auth origins/public keys remain blocked.
- Approved/published refund policy and dispatch are absent/disabled by default. No draft legal eligibility is inferred. Only preserve-paid-access/taxable-KRW policy mechanics are supported.

## Safety and review corrections

- Cancel/renewal races preserve already-dispatched unknown work and never restore renewal intent after cancellation.
- Admin role revocation and policy/ledger changes are checked at atomic claim. Sorted identity locks remove a role-change/claim ABBA race.
- Provider errors/lost replies cannot become fabricated refund success or authorization for a second dispatch. Exact result-write recovery never repeats provider I/O.
- Direct-RPC reasons normalize the full ECMAScript whitespace set; a missing identity, revoked approver, changed balance or exhausted query budget is visible as review-required.
- Strict same-origin POST/body/query boundaries, fresh actor/admin checks and no-store responses cover all endpoints. Provider identifiers and credentials stay out of client DTOs.
- Historical charge pages remain visible after a mutation through read-only refresh; duplicate clicks and stale confirmation/Back/Forward/unmount completions cannot repeat a command or overwrite a newer screen.
- Execute/reconcile host budgets exceed provider timeouts with auth/DB margin. No scheduler, deployment, external charge/refund or mandate revocation was performed.

## Validation

- `npm run check:all` passed: repository ESLint/Prettier, generated route TypeScript, 2,590 unit tests, all contrast pairs and production Next.js/PWA build.
- Pure in-memory Node provider fixtures passed: 14 enrollment, 7 renewal and 13 cancellation (34 total), with no listener or external requests.
- Actual Supabase checkpoint CI [40109483202](https://github.com/zzz664/trot-you/actions/runs/40109483202), head `644d0984ffdf8a014fb33d143c0f1ab346a01bd5`, passed 2,493 pgTAP assertions twice, all prior races plus 13 new cancellation races, and genuine schema type generation/typecheck. Its only database failure was the expected committed-type drift gate before importing the artifact.
- Imported genuine `database.ts` artifact SHA-256 `4ba51e8145ff48c9cd273ff753cc61e7f59cf6451a69d7836f9ebdc0638eac11`, after the parent monitor verified artifact/head/ZIP integrity. No generated type was hand-edited.
- Independent static review found no remaining P0/P1/P2. Review fixes include the enum/DTO/manual-review and lock-order issues above, provider deadline margin, and synchronous UI uncertainty gating even for callbacks retained across same-tick history navigation.
- Controlled browser coverage is CI-only: 19 cancellation/refund scenarios plus one keyless scenario, with 18 provider/text-scale screenshots for review. No local browser/socket retry or Docker was attempted.

The complete application commit still needs its exact-head CI database/type-drift,
browser and screenshot review before merge readiness. Local mocks/builds are not
merchant sandbox/live validation. Production still needs approved policy,
merchant permissions, host runtime budget and an approved reconciliation
procedure; original private specifications were not copied into this repository.
