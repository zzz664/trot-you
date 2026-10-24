# Settlement reports — database foundation, not remittance

This feature calculates **KRW reports**, not payments. It does not transfer money, contact a bank/payment provider, collect account details, authorize a refund, run a scheduler, export spreadsheets, or add an application UI. Financial/tax labels describe configurable arithmetic, not legal or accounting advice. No operational settlement policy is seeded or activated.

## Authorization and data boundary

| Object                               | Purpose                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.settlements`                 | One artist/KST month report, decimal breakdown, exact rational components, applied policy, review revision and draft/confirmed state.                                          |
| `public.settlement_weekly_stats`     | Report-owned Monday-KST activity windows clipped to the month; sent-message and photo-message counts and requirements.                                                         |
| `private.settlement_policies`        | Explicit per-artist/month policy and full-month contract coverage. Provisioning is a separate authorized owner/migration operation, not a browser or service-key settings API. |
| `private.settlement_event_sources`   | Frozen verified charge/refund identities, signed integer KRW, occurrence time and current/adjustment origin. No fan/subscription identity or provider evidence.                |
| `private.settlement_message_sources` | Frozen message UUID, type and sent time. No body, sender, fan, read, or reply information.                                                                                     |
| `private.settlement_adjustments`     | Append-only explicit late-event assignment to a later report month under its chosen valuation policy.                                                                          |
| `private.settlement_source_versions` | Append-only transactional change stamps used to invalidate stale drafts.                                                                                                       |

Unrestricted authenticated admins can calculate, confirm and queue adjustments. The actual database role must be `authenticated`, with an existing admin profile; a forged JWT role or a service credential with a spoofed subject is insufficient. No application role, including `service_role`, has direct report/source/policy mutation grants. Private helpers have no application EXECUTE grant. All privilege-crossing functions pin an empty search path and all tables enable RLS.

Admins can read drafts and confirmed reports. Artists can read **only their own confirmed reports and associated weekly rows**, based on current membership and current unrestricted artist role. Removing membership, changing role, or restricting the profile removes access on subsequent reads; snapshots never preserve a recipient list. Fans and anonymous clients cannot read reports. Source-event and pending-adjustment RPCs are admin-only; artists receive no fan identifiers, ledger IDs, private verification evidence or financial account information.

## Policy inputs are not approval

A report requires an explicitly enabled private policy for that exact artist/month. No application RPC enables or changes policy. Rates are exact finite decimal numbers from 0 to 1 with at most six decimal places; input exceeding that precision is rejected, never silently rounded. `performance_conditions` must remain SQL NULL, so the snapshotted performance rate is **not applied**. Unspecified contract/performance terms do not become a guessed business rule.

- **Contract range:** `[contract_from, contract_until)` must cover the entire calendar month. Mid-month contracts fail closed; there is no invented proration of revenue or contract eligibility.
- **Activity disabled:** explicitly configured `activity_enabled=false` means ratio 1, with both weekly requirements NULL. This is not an implicit waiver when policy is missing.
- **Activity enabled:** both weekly requirements must be positive integers. Zero or missing requirements are rejected rather than divided by zero or treated as achieved.
- **Partial weeks:** the default `block` rejects an activity-enabled month with partial Monday weeks. An explicitly provisioned `prorate_days` policy uses each week's actual overlapping calendar days divided by seven. It counts activity only inside that clipped interval, not the whole cross-month week.
- **Negative net revenue:** the only supported policy is `block`. A negative gross sum fails and rolls back the entire calculation, preserving the previous draft. Carry-forward, debt, zero-clamping and reverse deductions are unresolved policy, not silently implemented behavior.
- **Late events:** the default is `block`. `explicit_current_formula` is a distinct, consequential policy input: an individually queued late event joins the selected later month's gross and uses that month's rates and activity. It is **not** a reversal at the historical report's rate. No such choice is seeded or approved by this migration.

The private design's draft values (base/performance 30%/40%, VAT 10%, tentative fee 3%, weekly 3/2) are not operational defaults in this schema. Future approved settings integration must deliberately provision versioned inputs. The report stores the complete applied policy, including contract dates, policy UUID, disabled performance conditions, requirements and handling modes.

## Source recognition and weekly metrics

A month is `[00:00 first day Asia/Seoul, 00:00 first day next month Asia/Seoul)`, independent of the database/session time zone. Only completed months can be calculated. The recognition basis is verified ledger **occurrence time**, not subscription service period, client time, or `recorded_at`.

Only `payment_events` with an immutable verification row contribute. Signed integer KRW charges/refunds are the source; attempts, failed/unknown outcomes and obligations are not revenue. Foreign currency is not supported and there is no inferred FX rate. Existing billing constraints allow only KRW. A refund occurring in a later month normally belongs to that later occurrence month even when its original charge/service period is older; it does not reopen the old report.

Message counts include every `status='sent'` message within the monthly boundary. Photo counts count photo **messages**, not attachments, and are a subset of all-message counts. Draft/scheduled/canceled messages are excluded. Monday week anchors and clipped start/end dates are persisted, including zero-activity windows. Historical subscriber totals cannot be reconstructed reliably from the current subscription rows; this feature does not invent subscriber/new/churn counts or performance thresholds.

The source UUID snapshots intentionally do not add foreign keys to payment/message rows: such foreign-key key-share locks would invert the source RPC's existing row locks against the reporting fence. Payment history already cannot be updated/deleted through the billing foundation. The snapshots retain the reporting facts independently; all application direct writes are denied. Report-owned children retain report foreign keys.

## Formula, precision and audit

The documented formula is evaluated from the frozen sources and applied settings:

```text
gross = current_month_signed_events + explicitly_queued_late_events
vat = gross × vat_rate / (1 + vat_rate)
pg_fee = gross × pg_fee_rate / (1 + vat_rate)
base = gross × (1 − pg_fee_rate) / (1 + vat_rate)
rate = base_rate                         # performance conditions disabled
activity = min(1, (messages / required_messages + photos / required_photos) / 2)
deduction = base × rate × (1 − activity)
final = base × rate − deduction
```

For day-prorated activity, the summed exact requirements are `days_in_month × weekly_min / 7`. The numerator is `7 × (messages × weekly_photo_min + photos × weekly_message_min)` and denominator is `2 × days_in_month × weekly_message_min × weekly_photo_min`, capped at one. This is the ratio of monthly sums, not an average of rounded weekly ratios.

All monetary components and ratios use unconstrained PostgreSQL `numeric`, not integer money columns, float/double or JavaScript numbers. Repeating decimal display values are necessarily finite approximations; no claim of an exact finite representation of one-third is made. `exact_components` additionally persists integer-valued numerator/denominator strings for VAT, fee, base, share, activity, deduction and final. Policy requirements and each weekly window retain the exact operands for weekly requirement reconstruction. These fractions are the audit authority when displayed decimals differ in their last place.

The final whole-KRW amount is computed **directly from the exact final fraction**, using integer quotient arithmetic `div(2*numerator + denominator, 2*denominator)` for supported nonnegative revenue. Thus ties round up (half away from zero), and neither a rounded VAT/activity intermediate nor floating-point conversion decides the rounding boundary. Zero revenue/rate/activity produce exact zero. Exports and UI must preserve numeric/fraction strings and only apply display formatting at their edge.

Confirmation reconciles source-event count, signed total, current/adjustment subtotals, message/photo counts, weekly count sums, all calculated components and the exact fractions. It does not merely trust a client-supplied total.

## RPC lifecycle and concurrency

1. `settlement_calculate(artist, month)` validates actor, closed KST month and explicit policy; snapshots the verified source set, activity and settings; creates or replaces a **draft** under the same report ID. Every successful calculation issues a new UUID `revision`, even with identical totals. All writes roll back on an error.
2. Admin reads the report and its revision. `settlement_confirm(report, expected_revision)` rejects a revision mismatch or any committed source/policy/adjustment change since calculation. The reviewer must recalculate and review again. Confirmation validates the saved breakdown and sets `confirmed_at` atomically.
3. Repeating confirmation of the same confirmed revision is idempotent, even after later source changes. Recalculation or any UPDATE/DELETE/TRUNCATE of a confirmed report or its frozen children fails. There is no `paid` state, payout action, reset-to-draft, or upsert that overwrites a confirmed report.
4. A newly recorded event with occurrence time inside an already confirmed month appears in `settlement_pending_adjustments(artist)`. It never changes the confirmed report. `settlement_queue_adjustment(event, later_month)` requires that original month to be confirmed, an unallocated verified source, a later unconfirmed target month, and an explicitly enabled target valuation policy. Exact repeats succeed; another target conflicts. Queuing is a separate transaction and invalidates an existing target draft. Recalculation includes the queued source once; a globally unique event allocation prevents double counting across reports.
5. `settlement_report_sources(report)` is the admin-only ledger reconciliation projection. No client-supplied event array, amount, source timestamp or activity total enters calculation.

Reporting mutations use one coarse transaction-scoped exclusive advisory fence; payment-event insertion, verification insertion and message/policy mutations acquire its shared side before allocating an append-only source stamp. Generation/confirmation wait for in-flight sources to commit or roll back, then subsequent statements see a stable set. They require READ COMMITTED; repeatable-read/serializable calls fail closed instead of using an older transaction snapshot after a lock wait. `recorded_at <= calculated_at` is not a consistency mechanism because a source transaction can begin earlier and commit later.

The admin profile share lock precedes the exclusive fence. After obtaining the fence, reporting takes the artist key-share lock with **NOWAIT**, never waiting behind a source operation that might itself need the fence. Contention at that point fails closed with `SETTLEMENT_SOURCE_BUSY` / SQLSTATE `40001`; a caller may retry the entire rolled-back transaction. This avoids lock inversion even when a source transaction touches multiple artists. Calculation never takes subscription, original-charge or message row locks after the fence. Source stamps have no artist foreign key and no counter-row update, avoiding new source lock inversion. Their identity values are allocated after the shared fence; rolled-back sequence gaps are harmless, and the greatest committed artist stamp identifies the snapshot. The log is append-only and has an `(artist_id, version DESC)` index; retention/compaction requires a separately designed safe mechanism, not unbounded silent deletion. The coarse fence and change log deliberately favor correctness over high-throughput reporting. Source operations and report calls should use short transactions, not wrap external I/O or unrelated multi-artist operations.

A database owner/superuser capable of changing triggers, grants or schema is outside the application threat model. Owner-only fictional test setup is not an operational policy/provisioning API.

## Verification boundary and remaining work

The pgTAP lifecycle/security suite and real independent-session runner are added to existing regression gates. The race runner is restricted to a disposable local Supabase Docker container, checks for existing data before committing fictional fixtures and resets afterwards. It has no remote connection URL or provider credential path. Actual source/report RPCs retain real caller-role checks; historical fixture setup is explicitly owner-only synthetic data.

This environment lacks Docker, so local PGlite PG18 with synthetic Auth/Storage is supplemental syntax/logic/ACL evidence only. It cannot prove Supabase PG17, real JWT/PostgREST or multi-session locks. Genuine schema types must be obtained from the exact-head CI artifact and committed without hand editing; the intentional bootstrap drift failure is not a passing CI result. All existing quality, browser, integration and concurrency gates remain required.

Later coherent features include approved settings/contract integration, pure application service/adapters, scheduler, admin/artist UI, spreadsheet export, and any expanded policy behavior. No real records, hosted database, account details, external provider or money movement are used here.
