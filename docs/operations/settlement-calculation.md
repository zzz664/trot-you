# Settlement calculation (feature 40)

This feature is a **read-only calculation boundary**, not a report confirmation,
export, payout, scheduled operation, or permission to enable a policy. It does
not expose a new browser/API route. Report UX and export remain separate work.

## Inputs and approval

- The current authenticated, unrestricted administrator requests one artist and
  one closed KST calendar month. The database rechecks current authority and
  takes the existing settlement source fence before reading a coherent snapshot.
- Only the existing enabled artist/month `private.settlement_policies` record is
  eligible. No record is seeded or enabled. Global draft settings and documented
  example rates are not approvals and are never fallback values.
- The approved policy snapshot includes the contract coverage, VAT and PG fee,
  share rates, activity thresholds, partial-week handling, negative-net handling,
  and late-event basis. Unsupported performance conditions are rejected; NULL
  conditions always choose the base rate.
- Revenue comes only from the append-only successful `payment_events` ledger
  joined to its verification evidence. `charge` and `refund` are ledger kinds;
  initial/renewal/retry classify payment attempts, not extra revenue. Failed,
  unknown, or pending attempts cannot become settlement revenue.
- Rate and amount JSON values are strings. The application never round-trips
  money through a JavaScript floating-point number. A source bound fails closed
  rather than returning a partial month.

## Deterministic calculation

The pure service uses integer rational arithmetic. Each intermediate result has
an exact numerator/denominator and a decimal-string display projection. Decimal
projection is not used for later arithmetic. Only the final KRW result rounds,
using the existing nonnegative half-up rule.

KST month windows are half-open. Weekly windows begin on Monday and are clipped
to the requested month. Counts include only sent messages; a photo message is
one activity event regardless of its number of attachments. Full monthly
coverage is required. Partial weeks fail closed unless the selected policy
explicitly says `prorate_days`. Disabled activity is an explicit policy choice,
not a missing-threshold fallback.

No historical subscriber/new/churn count is invented from present-day rows.
Negative net revenue, partial-month contracts, and undefined performance rules
remain blocked until their actual accounting rules are decided. A refund uses
its verified occurrence month. An earlier-occurrence event is included only as
an explicit existing queued adjustment under `explicit_current_formula`; this
is not an implied reversal at an earlier contract rate.

## Read-only and authority boundaries

The snapshot RPC returns an actor-bound envelope. The application validates the
actor, artist, month, policy, source evidence shape, duplicate IDs, timestamp
windows, and exact numeric representations before calculation. Unexpected SQL
or transport details become a safe unavailable result.

A confirmed month is not silently recalculated. Events assigned to another
report are not counted again. The RPC does not create/update a draft, confirm a
report, move an adjustment, change settings, touch money, or invoke a provider.
Returned source versions describe the snapshot; they do not authorize a later
write. A later report feature must obtain current authority and source evidence
again rather than trust an earlier preview.

## Changed-work verification only

`ci/scopes/settlement-calculation.json` binds exact changed paths and exact tests
to the `e0a8f8be79d5b4f3792eb84128865c4ef84e2f3c` baseline. New calculation,
weekly-stat, DB boundary, concurrency and populated 38→39 upgrade tests are
selected. Historical test files remain stored and dormant. No cumulative
unit/SQL/race/upgrade/browser command, `check:all`, production build, deployment,
or predeployment run is authorized by this feature.

No UI changes means no browser job or visual review is selected. Local Docker
and browser execution are known unavailable and are not reprobed; real database
and concurrent-session evidence comes from the exact-head hosted selected CI.
Generated database types must be imported byte-for-byte from official CI output,
never edited to look generated.
