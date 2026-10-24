# Initial-subscription provider adapters and credential vault

## Implemented HTTP contracts

These server-only adapters do not create a subscription by themselves. A trusted
service must first acquire the durable database claim, bind the current actor,
session, consent and immutable commercial snapshot, and then atomically record
verified settlement through the enrollment RPCs. An adapter never retries a call.

- **Toss CARD billing:** exchange SDK `authKey` plus the server-generated
  `customerKey` at `POST /v1/billing/authorizations/issue`. Verify returned MID,
  customer and method before storing the billing credential. The initial charge
  uses `POST /v1/billing/{billingKey}` with that bound customer and immutable
  amount/order. Both requests carry their persisted operation UUID in
  `Idempotency-Key`. Requests have a 65-second deadline; the documented charge
  timeout minimum is 60 seconds. Query a missing result by immutable order ID,
  never by generating a new charge. [Core API](https://docs.tosspayments.com/reference),
  [authentication and idempotency](https://docs.tosspayments.com/reference/using-api/authorization).
- **Direct KakaoPay:** use recurring CID with charged `ready → approve`, not
  zero-amount SID registration followed by a second first charge. Ready sends the
  exact initial amount; approve sends the same amount, stored TID/order/customer
  and captured `pg_token`. Successful approval supplies SID and the first charge.
  No `/subscription` call exists in this feature. No undocumented idempotency
  header or merchant-order deduplication guarantee is assumed.
  [First-payment API](https://developers.kakaopay.com/docs/payment/online/single-payment),
  [recurring enrollment](https://developers.kakaopay.com/docs/payment/online/subscription).
- **KakaoPay recovery:** query `POST /online/v1/payment/order` only when TID is
  known. Verify CID, TID, order, customer, amount, `SUCCESS_PAYMENT`, no canceled
  amount and exactly one matching `PAYMENT` action/AID. `ISSUED_SID` is not
  revenue. The documented query response does not include SID. A lost approval
  response can therefore establish payment but cannot reconstruct the recurring
  credential; absent an already encrypted SID, keep the recovery/manual gate
  rather than calling approve again. [Order query](https://developers.kakaopay.com/docs/payment/online/payment-detail).

The normalized result retains only payment ID, transaction ID, approval instant,
amount, KRW, merchant and opaque order/customer bindings. Provider card details,
raw bodies and messages are discarded. Toss Payment responses do not document
`customerKey`; customer association is established at issuance and retained in
the private immutable order/credential binding, not fabricated as a required
response field. Toss evidence must be `BILLING`, `DONE`, CARD, expected MID/order,
KRW and exact original/remaining amount. A canceled or partial result is not
initial-settlement success.

This path supports positive, taxable KRW initial charges only (`tax_free_amount`
zero). Unsupported zero-price snapshots fail closed. KakaoPay's documentation
uses offsetless `Datetime` examples; the application explicitly interprets those
as Seoul (+09:00), never the host timezone. Offset-bearing values retain their
stated instant. Confirm merchant tax treatment and timestamp behavior during the
separate provider verification, rather than treating local tests as that proof.

## Unknown outcomes are not declines

Each invocation dispatches at most once. Network failure, timeouts, malformed or
oversized JSON, wrong identity/amount, unrecognized error codes, processing or
already-completed errors remain `OUTCOME_UNKNOWN`. Query failure/not-found also
remains unknown; it does not authorize another payment.

Only a narrow allowlist of documented refusals is classified rejected. Toss
refusals are taken from its [billing error reference](https://docs.tosspayments.com/reference/error-codes).
Kakao authentication-incomplete `-701` is distinguished from already-approved
`-702` by [official support](https://developers.kakaopay.com/forum/t/error-parsing-http-request-header/373/2).
No provider error text escapes into a response or log. All results explicitly
have `retryAllowed: false`; the state machine and reviewed reconciliation policy,
not an HTTP retry helper, own any later action.

Transport rejects redirects, omits cookies, uses no-store, bounds body size and
uses one deadline across both request and body consumption. Only documented
exact HTTPS handoff origins are accepted; sandbox-only handoff is test-only.

## Credential and callback encryption

`PAYMENTS_VAULT_KEY` is a dedicated 32-byte key encoded as canonical base64;
`PAYMENTS_VAULT_KEY_VERSION` identifies it. Both are server-only and required
together. The application never generates or persists this key, never derives it
from a payment/Supabase secret and does not fall back to a default.

The Node/OpenSSL AES-256-GCM adapter uses a fresh random 12-byte IV and a 16-byte
authentication tag. Its private JSON envelope is exactly
`{ version, iv, ciphertext, tag }`, with canonical unpadded base64url binary
fields. Authenticated additional data binds the format domain, key version,
actor, artist, provider, environment, mandate ID and payload purpose
(`callback`, `credential`, `ready`). Copying an envelope to another binding or
purpose fails authentication. Parsing alone is structural validation; only
`vault.open` authenticates the ciphertext.

Unknown versions and wrong/tampered keys fail closed with one sanitized error.
Rotation needs a separately reviewed key-retention/re-encryption process before
changing the active version; changing the variable alone is not a migration.
No rotation, production secret provisioning or persistent real credential was
performed in this implementation.

## Verification boundary

Offline HTTP-contract tests inject fixture responses and forbid global provider
fetch. Vault tests use fixed, publicly recognizable fixture bytes only. They test
cryptographic tamper/misbinding, version handling and configuration, not external
key-store operation. Controlled local CI-provider tests are a separate explicit
loopback-only injection, not a runtime mock-success fallback.

No provider account, contract, real API credentials, card/PII, registration,
payment, cancellation, refund, webhook or live/sandbox provider transaction was
created or used during development. Sandbox/live merchant verification remains
a separate authorized activity.
