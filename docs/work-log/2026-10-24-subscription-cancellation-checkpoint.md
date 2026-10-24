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
