# 2026-10-26 — Read-only legal document pages

## Scope and source decisions

- One branch: `feature/legal-document-pages`, based on `fb5c6654d51e427e0956ae5e07cfeab4847b6099`. No direct develop/main publication.
- Private frontend navigation/accessibility and schedule launch requirements reviewed; private source text is not copied here.
- Existing immutable, approved/published `public.onboarding_policy_documents` is the exact-version source. Current terms/privacy must follow the private configured pointers, never newest publication.
- Migration 41 adds only the read-only public current-pointer view; no approval/editor, activation, legal copy, account data, or support identity is added. Final approved production legal copy and actual support destinations remain pending.

## Schema checkpoint

- Explicit base-bound scope: `ci/scopes/legal-document-pages.json`. Only `supabase/tests/legal_document_pages.test.sql` selected (29 assertions), no historical unit/browser/SQL/race/upgrade tests.
- Local `git diff --check`: passed. Docker is unavailable and local browser sockets are denied; neither was retried or escalated. SQL execution is blocked locally, awaiting the genuine isolated hosted stack.
- `src/types/database.ts` remains untouched: 97,767 bytes, SHA-256 `26f47a45af0a5bf25128b90e2d8140c7d57becd7b50df6264748a95f06bfce7b`. Official generation is required before application publication/merge; the first hosted type-diff gate is expected to report the new view until the official artifact is imported.
- Application, focused unit/browser evidence and three-scale visual review remain in progress on this same branch. No production deployment or predeployment full run performed.
