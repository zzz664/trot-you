# Community moderation

## Policy and operational boundary

This feature adds reporting and administrator review to the existing community
policy. It does not approve that policy, set an automatic-hide threshold, enable
a scheduler, grant roles, send a provider notification or deploy anything.
Reports require the existing approved community policy and its rate/text limits.
Absent policy fails closed; transport ceilings are not operating defaults.

A person can report a given target only once. The distinct-report total is a
lifetime count; automatic hiding uses the unresolved reports in the current review
cycle. Restoring a target resolves that cycle and does not let the same reporter
increment the count again. Report receipt recovery discloses no target body.

Replies are private communications. Only the intended artist's current authorized
membership may expose a received reply for reporting; guessing a UUID must not
make it public. Reply moderation state is separate from the original send-time
content block. Restoring a report never approves previously blocked reply content.

## Review and restrictions

The administrator queue exposes the target and current revision for a deliberate
restore/delete decision. A reason and explicit confirmation are required. Stale
revision checks protect newer decisions. Deletion is terminal and retains report
and audit history rather than physically erasing it.

Restrictions use the current target profile snapshot, a reason, explicit
confirmation and a finite future expiry. Administrator/self targets are excluded.
Restriction expiry is evaluated server-side from the current time; an expired flag
must not require a cleanup job to regain permitted access. Changes do not alter
roles, subscriptions, financial history or points.

## Result recovery and private state

Each write has an immutable actor-scoped operation identity and exact request.
When the response is lost, the UI offers an exact retry rather than inventing a
new operation. A target hidden/deleted by the unresolved write is not proof that
the write failed. Account, authorization or target changes invalidate the previous
private view and its pending intent. Repeated clicks cannot submit parallel writes.

## Reporter notices

Resolved reports produce deduplicated, private in-app decision notices in the same
transaction as the review effect. Notices identify the report and decision, not
another user's body, reason, profile, email, phone or private media locator.
Recipient access is checked again when reading the inbox.

No moderation Web Push/Alimtalk category, delivery consent or external message
policy has been approved. Therefore this feature deliberately does not enqueue
provider jobs or modify the existing notification delivery wrapper chain. An in-app
notice is not a claim of provider acceptance or device delivery.

## Verification

All data in tests is fictional and confined to the disposable CLI-managed CI
stack. The full pgTAP suite runs twice. Dedicated independent-session races and a
populated upgrade run before the official generated-schema artifact. The upgrade
compares existing data using the actual schema, with only deliberate new columns
excluded from before/after equality and separately checked for correct defaults.

The isolated browser suite exercises real Auth/RPCs, while fixtures disable
payments, providers and workers. It captures settled screens at three text scales
and narrow/wide widths, including offscreen controls. The required CI aggregate
includes this browser and fails on missing or unexpected skipped results.
