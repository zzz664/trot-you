# Subscription renewal worker

This is configuration-ready code, not a deployment, enabled Cron, merchant
approval, sandbox/live payment or completed notice-delivery integration. It does
not install a schedule. No real credentials or transactions were used.

## Activation gates

`PAYMENTS_RENEWALS_ENABLED` defaults to false. The worker additionally requires a
server-only `RENEWAL_CRON_SECRET` (32–256 URL-safe characters), separate from the
general `CRON_SECRET`, and the existing Supabase/provider/vault configuration.
The public isolated-CI token is rejected outside its complete guarded loopback
runtime. Never reuse fixture values for deployment. Missing or mismatched
provider mode/MID/CID and unavailable/tampered vault credentials prevent dispatch.

The accepted immutable checkout policy supplies the regular KRW price, tax basis
and explicitly selected UTC or Seoul monthly calendar. A separately approved and
published immutable `private.renewal_policies` row for that exact checkout version
must state grace seconds, retry seconds, maximum retries and whether verified
advance notice is required (and its lead time). This migration approves or seeds
none of these. The source's KRW 6,500, 24 hours, three retries and three-day grace
are draft proposals, **not implicit runtime defaults or approved legal terms**.
Only controlled fictional tests adopt those values.

New dispatch revalidates the current checkout version, recorded mandate consent,
current legal/profile acceptance, user restrictions and active artist. Changing
terms does not silently authorize new-price renewal under an old mandate. The
notice gate requires an immutable receipt for this exact subscription, period,
policy and amount with verified delivery early enough. An outbox enqueue or
provider acceptance is not delivery. The narrow service-only notice RPC records
trusted verified evidence; this feature adds no notice sender or operator UI.
A missing required notice blocks charging; infrastructure absence never waives it.

The merchant must separately approve unattended renewal/recovery procedures,
particularly Kakao's lost-TID manual review, before live operation. No refund,
provider cancellation, payout, automatic fallback or provider switching is added.

## Protected entry point and finite work

`GET` or bodyless `POST /api/cron/charge-renewals` accepts only the exact dedicated
Bearer token. Cookies, general Cron tokens and URL tokens do not authenticate it.
Request bodies, query parameters, caller clocks and batch overrides are rejected.
The response is a no-store allowlisted aggregate: examined, dispatched, settled,
declined, unknown, manual-review, expired and skipped counts. A completed worker
run is not a claim that every payment succeeded. No user/mandate/order IDs, vault
material or provider bodies are returned or logged.

The route declares a **300-second** execution budget. The host must actually
support it before activation; exporting the value does not configure a scheduler.
The old ten-second draft Cron example cannot accommodate Toss's documented
minimum sixty-second charge timeout. One invocation examines at most four bounded
candidates and makes at most **one** external charge or reconciliation query.
Provider charge deadlines are 65 seconds, queries 15 seconds; DB calls have their
existing 15-second deadline. Fresh dispatch leases last 180 seconds. No loop drains
the queue and no transport automatically retries. Candidate selection rotates
fairly so unchanged configuration or vault failures cannot starve later rows.

## Financial invariants

- A monthly period is anchored to the original successful episode's wall-clock
  anniversary: January 31 → February 28/29 → March 31. It is not calculated by
  repeatedly adding one month to the last clamped date. Service and SQL both
  verify the interval. Introductory pricing is never used for renewal.
- One immutable obligation owns each subscription/period. A successful atomic
  claim is the only dispatch permission. Its persisted attempt UUID is the order
  and Toss idempotency identity. A new attempt is possible only after a verified
  definitive decline, approved interval and retry bound—not after uncertainty.
- `max_retries` counts additional attempts after the first. The grace window is
  anchored once to the unpaid period start and never reset by retry. A retry
  advances the same obligation, not another monthly period or duplicate due item.
- Retry scheduling is provider-aware. Only documented temporary Toss refusals
  qualify for automatic retries. Kakao's generic documented refusal is held for
  customer action rather than inventing an undocumented transient-error taxonomy.
- Unknown outcomes and lease expiry never grant another charge. Expired leases
  become unknown through local maintenance even with missing provider/vault
  configuration. Toss recovery queries the original order; Kakao without its
  returned TID stays manual review. SID availability/last approval is not proof
  of this payment. Recovery has at most three query leases with one-hour backoff,
  then manual review; these are technical safety limits, not a charge retry policy.
- Verified settlement atomically inserts one immutable ledger event, updates the
  paid interval and uses the existing successful-payment notification outbox.
  If the DB response is lost, the service first observes durable attempt state and
  may replay that exact finalization once with the same evidence—never the
  provider charge. A second failure stays unavailable.
- Cancellation and claim serialize on the subscription. Cancellation-first
  prevents new dispatch; a request already claimed cannot be unsent. A verified
  late result is recorded once while canceled status and disabled future billing
  remain intact. Paid canceled access ends at the paid boundary. Grace cancellation
  removes unpaid access; expiry is time-based even if the worker is delayed.
- A missed whole period is held for review rather than inventing catch-up billing.
  Unresolved money remains recoverable after local expiry and blocks reopening.

Failure/expiry notification delivery remains the separate billing-notices feature:
the existing outbox currently models recognized payment events, not these new
subscription-state sources. This implementation does not falsely report those
notices delivered. Required advance notices still fail closed until independently
verified evidence exists. Physical retention, credential rotation/revocation,
operator review UI and commercial/legal approval are separate launch gates.

## Verification

See [provider contracts](renewal-providers.md) for the exact real endpoints,
verification rules and reference sources, and [isolated renewal CI](renewal-ci.md) for
fixture limits. Unit tests cover deterministic calendars, service/HTTP/DB
boundaries, credential binding, concurrency refusal and lost-response handling.
The required database CI applies the migration to disposable Supabase PG17,
runs all pgTAP suites twice, independent-session races and genuine generated types.
The schema artifact must be imported without manual edits before the final drift
and typecheck gates can pass. Supplemental PGlite is not that evidence.

Isolated browser tests invoke the protected worker against actual local Auth/DB
and guarded loopback HTTP fixtures; they never install a scheduler or contact a
real provider. Test-only chronology is rebased in disposable fictional fixtures,
not through an application clock override. No deployment or live verification is
implied by any local or CI test.
