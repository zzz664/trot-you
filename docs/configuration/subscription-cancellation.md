# Subscription cancellation and manually authorized refunds

## Separate actions and truthful access

`/me/subscriptions` and its subscription detail show only the verified actor's
subscriptions and recognized charge/refund history. Lists and older charge
history are paginated; there is no invented refund eligibility cutoff. A person
can inspect and cancel their own existing subscription even when onboarding is
incomplete, their role changes, or their account is restricted. Restrictions can
still prevent content access: the paid-period date is not a promise to bypass an
account restriction.

Cancellation uses the existing atomic `cancel_subscription` RPC. It sets
`canceled`, records cancellation time and removes `next_billing_at`; it does not
refund money, terminate a still-paid period or revoke provider credentials. A
grace period is not a new paid period. Once canceled, paid access ends at the
stored exclusive period boundary even if an expiry worker has not run. An
already-claimed/unknown renewal may have reached the provider: cancellation
preserves that operation for reconciliation. A subsequently verified charge
adds its paid period but never silently restores renewal intent.

There is no automatic provider-mandate revocation or cross-provider fallback.
This avoids disabling another artist's mandate accidentally. Future credential
retention/revocation operations need their own approved lifecycle.

Cancellation/history need actor-scoped Supabase configuration only—not a service
key, refund flag or payment credentials. Auth configuration and document-origin
metadata are isolated from unrelated payment configuration failures; unsafe
Auth origins/public keys still fail closed.

## Refund request is not eligibility or approval

The owner chooses a recognized charge, exact integer KRW amount no greater than
its unrefunded balance, and a review reason. The request has a stable UUID and
one unresolved operation per charge. Repeated identical requests are idempotent;
a different payload with the same key conflicts. This is a request for manual
review, not an automatic money-back promise. Cancellation is a separate control.

The draft source statement about days since payment and message reads is **not
an approved policy** and is not implemented as a default. No production refund
policy, approval, price change or real administrator is seeded.

`/admin/refunds` is guarded by fresh authentication and an unrestricted current
admin profile. The database independently checks the actual authenticated role,
not user metadata or a caller-selected user ID. Approving a case requires the
exact requested amount, the current explicitly approved/published immutable
policy version, an explicit UI acknowledgment and a review reason. The operator
must verify the real case against that policy; this feature does not infer legal
eligibility from message views or elapsed days. Review reasons are visible to the
requesting owner; never include secrets or unnecessary personal information.

Approval is distinct from execution. Another confirmation triggers an atomic
claim; the current executing and approving admins, policy version, original
verified payment identity and unchanged refund capacity are checked again.
Reject/withdraw is possible only before dispatch. Decisions are append-only.
A revoked authorizer or changed recognized balance is visible as manual review,
not a misleading executable approval.

## Configuration and supported policy boundary

1. Keep `PAYMENTS_REFUNDS_ENABLED=false` until authorized operational setup.
2. Obtain actual business/legal approval and publish a versioned policy in
   `private.refund_policies`, then select it through
   `private.refund_policy_current` using an appropriately authorized operator.
   These tables are not writable through fan/admin/service-role table grants.
   Approved versions cannot be edited or removed; a changed policy needs a new
   version and fresh case review. No example here fabricates approval.
3. This implementation supports `preserve_paid_access` and `taxable_krw` only.
   If the approved policy requires immediate entitlement termination or another
   tax treatment, do not enable this execution path; implement that explicitly.
4. Configure the original provider's matching test/live environment and merchant
   identity. Existing Toss/Kakao credentials are reused server-side; refund
   execution does not require a decrypted mandate or payment vault key.
5. Enable the explicit refund dispatch flag only after provider permissions and
   operational review. Refund **query recovery** remains available with matching
   provider configuration even if new dispatch is disabled.

Missing policy blocks authorization and dispatch. Missing/mismatched credentials
or provider identities never select a mock, another provider or a new charge.
Kakao partial cancellation eligibility can depend on the merchant contract;
request approval alone does not certify provider support.

## Ambiguity and money integrity

Request status moves through `requested → authorized → inflight` and then
`succeeded`, `failed` only on definitive evidence, or `unknown`. The actual
adapters conservatively treat HTTP failures/timeouts as unknown. Unknown
operations are never automatically dispatched again, including after a lease
expires or a browser loses its reply. The explicit reconcile action queries the
original provider payment and exact opaque cancellation marker. Three query
leases with one-hour backoff bound automatic recovery; unresolved cases remain
manual review, not fabricated failure or success. The interface disables all
new commands after an ambiguous browser response until a read-only refresh.

Verified results atomically append the existing immutable negative money event,
referencing the original charge, and finalize the request. Duplicate provider
actions are no-ops; cumulative recognized refunds cannot exceed the charge.
After an ambiguous database commit, the service observes durable state and can
retry only identical finalization once, never provider I/O. Already-moved money
can be recognized after administrator/policy revocation. Refund finalization
does not change paid access or future renewal intent.

Out-of-band provider refunds, missing/truncated provider histories or inconsistent
cumulative balances require a reviewed reconciliation procedure. No general
manual override that bypasses verification is supplied. See the exact
[provider contracts](refund-providers.md) and
[isolated CI boundaries](cancellation-ci.md).

## HTTP/runtime/security

- Owner POST: `/api/subscriptions/cancel`, `/api/subscriptions/refund-request`.
- Admin POST: `/api/admin/refunds/authorize`, `reject`, `execute`, `reconcile`.
- Read-only GET status routes accept strict UUID/page parameters; GET never
  changes money or cancellation. POST requires the canonical exact Origin,
  bounded UTF-8 JSON and strict input fields. Actor IDs, provider IDs and
  arbitrary amounts cannot be supplied to execution routes.
- Requests/responses use private no-store headers. Client DTOs contain no
  credential, customer/order/provider payment/action identity or session token.
  Existing PWA policy does not cache these documents or APIs.
- Execute/reconcile request a 240-second host budget. The host must honor it:
  provider refund deadline is 65 seconds, query deadline 15 seconds, durable
  lease 180 seconds, with time for auth and database persistence. A host crash
  still leaves unknown/reconcilable state. No scheduler or deployment is enabled.

Automatic analytics domain hooks, customer-support delivery, provider mandate
retention/revocation and production policy approval remain their separate
integration/operational work. This feature performs no real charge, refund,
merchant onboarding, email/notification delivery or production deployment.
