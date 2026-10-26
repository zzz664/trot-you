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

## Application and official-type checkpoint

- Added current `/legal/terms` and `/legal/privacy` plus exact UUID-version pages. Public no-cookie reader uses only the approved projections; no private/legal activation or acceptance write is introduced.
- Start and existing session/account entries link to current documents; consent screen links exactly the displayed required document versions with an allowlisted return to onboarding. Reading does not precheck or save consent.
- Plain React text preserves approved title/body bytes, escapes markup, wraps long lines, and distinguishes current versus exact version. Explicit unconfigured, unset current, not-found and unavailable states offer safe Back and retry/refresh. Browser restoration refreshes current pointers.
- Consulted installed Next.js 16.4.3 `page`, dynamic-route and `connection` documentation before route implementation. Service/DB/page separation and existing UI primitives retained.
- Official schema checkpoint: remote `31c166c141819178edbbe6184a3bd3f3fd33d11f`, CI `40422564207`, artifact `12698012350`. Exactly 29 SQL assertions passed twice; lint and official-types compilation passed; generated-type diff was the expected remaining gate.
- Imported official `database.ts` verbatim: 98,082 bytes; SHA-256 `20bf14509d3bbabc324e3da5255442fbee2232f8c0a6f59e67732e754c58bd4d`. Only `current_onboarding_policy_documents` was added by the generator. No generated type was hand-edited. Pre-import application typecheck reported the missing new view; post-import `npm run typecheck` passed.
- Focused local units: 33 assertions across exactly `legal-documents-service.test.ts`, `legal-documents-db.test.ts`, `legal-documents-page.test.ts`, `legal-documents-routes.test.tsx`, and `legal-documents-ui.test.tsx`. Changed-file ESLint/formatting and diff whitespace checks passed. Independent focused read-only review found no concrete defect.
- The repaired `buildSelectedCommands` + `prepareBrowserCommands` used installed Playwright CLI `--list` with literal-file wrapper configurations (no browser, server, fixture body or historical test execution). Actual inventory: exactly one `tests/e2e/legal-documents-unconfigured.spec.ts` case plus seven `tests/e2e/authenticated/legal-documents.spec.ts` cases. Local inventory digests: `7edfed18ea05c17cef7294ae43dff1a744b8742d8c1d8ff836246d752aeec0d9` and `0cf5bc716209aad5b0e54f208d429d72698a117bfd05573e3da8a46da076d49c`.
- Browser cases cover public current-pointer versus newer publication, historical exact versions and escaped markup; configuration retry plus unknown/wrong-kind/draft/future nondisclosure; interrupted/repeated/Back/Forward/reload navigation; onboarding/account links with unchanged acceptance evidence; normal/large/xlarge mobile wrapping and touch targets. Runtime guard and zero retries are mandatory. Three screenshots and visual review remain pending hosted CI, not passed locally.
- Final selection retains only the new 29-assertion SQL projection contract consumed by the new DB reader, the 33 new units, and those exact 1+7 browser cases. No legacy auth/onboarding suite, races, upgrades or full/cumulative fallback. Build/browser execution is delegated to hosted CI; low local disk and known socket/Docker limitations were not worked around.
