# Attendance and private point history

## Boundary

The feature provides `/points`, actor-bound private balance/history, and explicit
attendance. Points are nonmonetary records: there is no cash value, redemption,
transfer, reward activation, activity grade, share claim or mission operation.
Post/comment award mechanics remain the existing foundation behavior, not a new
application action in this feature.

`private.point_policy` remains an explicitly approved configuration snapshot.
This migration does not create or change it. If no row exists, the UI receives a
null attendance amount and new attendance fails closed. A configured zero amount
still records attendance. No frontend value determines an award.

## Atomicity and privacy

- Existing `point_check_attendance()` owns the KST day and ledger award. The
  database clock is read after locks; browser time and session timezone do not
  choose the day. Unique actor/reason/day identity prevents a second daily award.
- `point_ui_check_attendance(operation_id)` binds an immutable receipt to the
  current actor. Replaying the same operation after KST midnight returns its
  original entry, not another day's award. Different operations on the same day
  still share one entry. Failed transactions leave no successful receipt.
- Current database profile/onboarding/restriction authorization is checked before
  both fresh writes and receipt recovery. UI RPCs require READ COMMITTED and are
  executable only by authenticated users; service credentials cannot impersonate
  the private browser boundary.
- `point_ui_snapshot()` holds the actor profile SHARE lock while projecting the
  balance, current KST day, attendance status, current approved amount and bounded
  history. This serializes with existing ledger writers. History uses descending
  `(created_at, id)` keyset pagination and a sentinel for the next page.
- Only the current actor's records appear. History omits correction notes, source
  references, policy snapshots/versions and the identity of correction authors.
  Neither a role claim nor an arbitrary user-id request selects someone else's
  ledger. Raw ledger and receipt tables remain private and immutable.

## Verification and operation

Local static/unit/build validation and hosted integration results are recorded in
`docs/work-log/2026-10-26-attendance-points.md`. The hosted disposable database job
retains both pgTAP passes, existing races/upgrades, new independent-session races,
a populated migration-35-to-36 upgrade, and official schema-type generation. Its
existing 30-minute timeout is not silently relaxed; runtime headroom is monitored.

Browser fixtures are synthetic and local-only, never evidence of live rewards or
provider connectivity. No production data, active point policy, real attendance,
provider, role assignment, deployment or recurring job is changed by development.
