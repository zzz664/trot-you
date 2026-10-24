# Subscription cancellation / refund database checkpoint — 2026-10-24

## Scope

- Owner subscription/charge history and cancellation projections, including restricted owners who still need to stop future billing.
- Separate refund request, authenticated administrator authorization, durable dispatch/query leases and verified immutable refund recognition.
- No approved policy is installed. Missing or unpublished policy blocks authorization/dispatch; the source's draft refund eligibility is not a runtime default.
- Refund financial recognition preserves paid-period access and does not implicitly cancel future renewal. Those are separate actions.
- Current administrator authority, original charge capacity, policy version, duplicate request keys and ambiguous provider operations are checked transactionally.

## Checkpoint verification

- Migration, pgTAP tests and independent-session concurrency checks prepared.
- JavaScript syntax and scoped ESLint passed; whitespace checks passed.
- Actual Supabase database execution and generated public TypeScript types are pending GitHub Actions. No Docker, local browser, provider request, charge/refund, deployment or scheduler was executed here.
- This checkpoint intentionally retains the previous generated types so CI can produce the genuine artifact. Import that artifact before completing the feature; the drift gate is expected to fail until then.

Application, provider contracts, fan/admin UI and controlled mock browser coverage follow on the same feature branch. This is not a production-readiness claim.

## Static review corrections before application integration

- Canonicalize the full ECMAScript trim whitespace set in RPC reasons, preventing direct-RPC blank data from making safe application projections unreadable.
- Surface revoked authorizer/changed financial balance as manual review rather than leaving a misleading executable authorization.
- Align administrator role-change identity locks with refund claims; an additional independent-session race covers the former ABBA order. The concurrency suite now contains 13 races.

## First actual CI checkpoint

The new cancellation pgTAP file passed. The existing immutable-ledger TRUNCATE test failed earlier than its trigger because its exhaustive foreign-key table list omitted the new refund request/decision tables. Those tables are now included without weakening the expected immutable-ledger exception. Types and concurrency had not run after that failure; another exact-head database CI run is required.
