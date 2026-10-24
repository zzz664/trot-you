# 2026-10-24 — Resource-authorized media access

## Immutable database checkpoint

- One feature branch from merged `develop`; original specifications remain private.
- Adds actor/resource-bound, expiring, idempotent upload reservations and an isolated private quarantine bucket. Client Storage access remains denied by restrictive policies.
- Registration remains a trusted verified-byte boundary; the application must inspect/sanitize bytes, publish an immutable final object, and finalize atomically. No operational policy or real media is seeded.
- Read RPC checks current artist membership or fan preview/subscription/history authorization. The server must keep signed read lifetime within 60 seconds and the current entitlement deadline.
- Added rollback-only pgTAP fixtures and independent lock-observed concurrency scenarios. Existing fixture dependencies were inspected; the new registry is not populated by previous suites.
- Independent read-only DB review found no blocking authorization/RLS/lock-order flaw in this checkpoint. Application review is ongoing, not an approval of unfinished app code.
- SQL execution and genuine type generation remain pending GitHub Actions: local Docker is unavailable. No generated database type was hand-edited; the real generated artifact is required before the feature is complete.

This checkpoint is for early migration/fixture/race validation and generated types, not a claim that the entire media feature has passed.
