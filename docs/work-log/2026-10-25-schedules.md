# 2026-10-25 — 공식 일정 (feature31)

## Scope and boundaries

Implements private-spec feature31: fan KST month/list/detail schedules, browser-state my-artists filter, public-coordinate map links, and administrative schedule CRUD. Existing event/catalog/audit semantics are retained. Schedule notices, opt-out UI, content-calendar UI, scheduler activation, live providers, deployments, roles and commercial policy changes are not part of this feature.

“My artists” means artists with current subscription access under the existing access function, including eligible grace and paid-through cancellation. The onboarding interest pick alone is not a paid subscription. This definition is explicitly shown in UI; it does not change billing access policy.

## Database-first checkpoint

- Add monotonically advancing schedule revisions; older authorized mutation RPCs remain compatible and invalidate open UI revisions.
- Add current-actor administrative safe projections, bounded month pages, own current-access artist identifiers, optimistic revision mutation, and immutable actor-scoped idempotent operation receipts.
- Existing safe public catalog remains author-free. No credentials, profile contact fields or stored map URLs enter the event projection.
- Add pgTAP authorization/validation/audit/replay coverage, independent-session concurrency races, and a populated version29→30 upgrade preservation check.
- Official CLI-generated schema types must come from the actual CI database artifact, unchanged byte-for-byte. They are not hand-written.

## Verification and limits

Database syntax/fixture/static checks are recorded at each immutable checkpoint. Actual PostgreSQL/pgTAP, race and upgrade execution requires the CI-managed disposable local Supabase instance; Docker is unavailable in the editing executor. The already-established local browser socket restriction is not retried or escalated. CI browser evidence and all three font scales at360/1280 remain required before completion.

No real account, recipient, payment, private location, provider request, policy approval, deployment or scheduler is exercised. Test source rows are fictional local fixtures. Private source documents are not copied into this repository.
