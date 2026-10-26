# Settlement report review and two-sheet Excel

This is a reporting/review feature, **not remittance**. It does not pay an
artist, call a provider or bank, collect an account number, authorize a refund,
activate a policy, run the monthly scheduler, or deploy to production. Existing
explicit approved per-artist/month policy is required; missing terms fail closed.
The formula and unresolved policy boundaries remain those documented in
[the database foundation](../database/settlement-reports.md) and
[the exact calculation service](settlement-calculation.md).

## Workflow

- An unrestricted current admin opens `/admin/settlements`, selects an artist
  UUID and first day of a completed KST month, and fetches a private fresh report.
  This deliberately does not broaden the artist-directory query boundary.
- Create requires no existing report and `expectedRevision:null`. Recalculate
  requires the exact currently displayed draft revision. The database acquires
  fresh authority/source locks, validates the complete approved source set, and
  invokes the established calculator in the same transaction. No browser totals,
  rates, event arrays or earlier preview authorize a write.
- Review displays the saved breakdown, exact numerator/denominator pairs, applied
  policy and clipped weekly statistics. Confirmation requires opening the review
  prompt, checking the acknowledgement, and sending the report ID plus revision.
- A revision conflict or changed source/policy makes confirmation fail. The
  screen clears its old snapshot; refresh/recalculate and a new review are needed.
  Confirming the same already-confirmed revision is idempotent. Confirmed history
  cannot be recalculated, edited, deleted or silently reopened.
- Artists enter through their current artist menu, or `/artist/settlements`.
  They see only their own confirmed report. Current artist role, unrestricted
  profile, completed onboarding, approved/published current terms/privacy
  acceptance and current membership are checked for every read. The matching
  direct table RLS rule prevents bypass via a raw report query. Draft existence
  is not disclosed to an artist.
- Admin export is bound to the reviewed report ID **and revision**, including
  drafts (their draft label remains in the workbook). A revision change requires
  a fresh read; export never silently substitutes a newer report.

## Contracts and precision

Four new security-definer RPCs use an empty search path and authenticated-role
checks: `settlement_report_read`, `settlement_report_calculate`,
`settlement_report_confirm`, and `settlement_report_export`. Reads and exports
hold the existing reporting fence for a coherent saved report/weekly/source
snapshot. Profile/consent/membership authority is current; artist locking is
NOWAIT to preserve the established source-writer order. Stronger transaction
isolation is rejected rather than returning a stale authorization snapshot.

JSON money, counts, source versions and saved exact rational components are
strings, never IEEE-754 numbers. The service validates artist/month/actor/mode,
closed-month boundaries, complete clipped weeks, source totals, exact arithmetic
and final half-up rounding. PostgreSQL decimal projections are display values:
the stored rational remains authoritative, including division with variable
significant precision. Only verified immutable charge/refund snapshots count;
attempts, failures, obligations and live subscription state do not become revenue.

Ordinary reads omit source IDs. Admin-only export includes exactly the frozen
source event ID, charge/refund kind, signed integer KRW, occurrence timestamp and
current/adjustment origin. There are no fan identities, emails, subscription IDs,
message bodies, provider verification evidence, account details or recipients.
Existing legacy admin RPCs remain established capabilities; the application uses
the new revision-bound workflow rather than changing their authorized ABI.

## Download safety

The server creates a genuine `.xlsx` ZIP with exactly two worksheets:
**요약** (complete saved report/policy/week audit fields) and **결제 이벤트 상세**
(frozen payment sources). All cells use literal inline text, including decimal,
large integer, rational and formula-like values. This intentionally preserves
precision rather than making Excel infer numeric/formula types. Values are XML
escaped; Excel escape-looking literals are protected. Invalid XML/control text,
duplicate events, malformed signed money, oversized cells/rows/workbooks fail
closed. No formulas, hyperlinks, external relationships or macros are emitted.

Limits are technical bounds, not financial policy: 50,000 events, 512 summary
rows, 32,767 UTF-16 units per cell, and 32 MiB total workbook. Export uses private
no-store, nosniff, attachment and restrictive CSP headers with a validated UUID
filename. A current-actor header prevents stale-tab identity confusion; POSTs
also require same-origin JSON. The browser downloads through authenticated fetch,
never a shareable source URL. Its temporary blob link is revoked on refresh,
navigation, hidden-page/identity invalidation and unmount.

Refresh, repeated clicks, stale responses, interrupted mutations and history
restoration do not auto-retry financial state changes. A lost acknowledgement is
an uncertain outcome: refresh the saved report rather than replaying a write.
The user-facing copy explicitly distinguishes confirmation from actual payment.

## Selected verification only

`ci/scopes/settlement-reports.json` binds the exact feature diff and selected files
to base `656c6f1292ba408df339521c8d982acd1fdbb305`. It selects new report units,
new SQL/isolation/precision assertions, new report-only independent-session races,
one populated 39→40 upgrade, and the new report browser cases. The edited CI
registry/runner/workflow guard files are the only selected existing contracts.
Historical feature test collections remain stored and dormant. Unknown impact
fails closed; no full/cumulative unit, SQL, browser, race, upgrade, `check:all`, or
predeployment run is authorized. Applying migrations is disposable schema setup,
not permission to execute historical tests. Compilation and genuine type
generation are separately identified.

Local Docker and browser runtime are unavailable and are not retried. Hosted
selected checks and visual review at all three text scales must provide actual
DB/browser evidence. Production deployment and the one separately designated
predeployment full run remain outside this feature.
