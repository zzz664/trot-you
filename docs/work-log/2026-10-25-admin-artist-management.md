# 2026-10-25 — Admin artist management application

## Scope and decisions

- One feature branch based on merged billing notices: `feature/admin-artist-management`.
- Admin artist list/create/edit: text profile, slug, public display order, draft/active/paused/retired state, grade and contract-date metadata. No hard delete, price editor, merchant action or billing-policy write.
- Preview candidates, memberships and invitation history are reachable through bounded read-only pages; selected previews remain complete across detail pages.
- Preview curation reads sent same-artist message DTOs and existing accepted media; ordered replacements use current revision and existing protected media-read API. No new storage parser or independent media security review was performed.
- Exact existing-user account offers require a separately approved private onboarding policy, current admin confirmation, verified Auth identity, recipient consent and expiring/revocable invitation. The application does not create Auth users, send email, generate credentials or grant administrator role.
- Initial admin setup is a manual, session-only operator helper with one-time immutable audit; loading its source grants nothing. Actual persistent execution requires separate exact-target/environment authorization.
- Public portrait publication needs an approved asset/ownership workflow; existing image paths are preserved and no arbitrary path editor substitutes for it. Contract fields do not approve a legal agreement or settlement policy.
- Domain services contain validation and use actor-scoped DB ports; route handlers enforce same-origin JSON and fresh session checks. DB RPCs remain the current-role/ownership/CAS/idempotency authority.
- Recipient identity is projected from each current authenticated RPC response, not from a potentially restored RSC actor key; invitation rows are validated against that current identity.
- RSC contains only identity/navigation. Mounted clients refetch private data after history/visibility restore, clear stale snapshots before mutations and use read-only recovery after uncertain results. No blind retries or cached grants.

## Verification at application checkpoint

- Final local `npm run check:all` passed: lint/format, generated-type TypeScript check, 6,228 unit tests across 201 files, contrast and production Next.js/PWA build.
- New pure local fixture/discovery suite: 28 checks passed; no browser/server/database launched by those checks.
- Real database CI and generated-type provenance are recorded in `2026-10-25-admin-artist-types-ci.md`: 3,522 pgTAP assertions twice and 325 independent-session scenarios passed on the preceding database checkpoint.
- Final application CI must verify the fresh recipient identity projection (+1 pgTAP assertion), generated-type equality and 17 authenticated + 7 keyless browser scenarios. 67 new screenshots are planned across three text scales and narrow/desktop layouts, with focused initial error/recovery states. Browser counts and visual QA are pending, not claimed passed.
- Local Docker and browser execution were not retried. All database and real browser workflows remain isolated CI-only.
- No live accounts, invitations, emails, credentials, role grants, policy approvals, keys, providers, scheduler or deployment were created/enabled. Private source documents were read but not published.
