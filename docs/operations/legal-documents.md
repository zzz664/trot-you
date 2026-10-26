# Read-only legal document pages

## Public routes and sources

- `/legal/terms` and `/legal/privacy` read the current configured pointers through `public.current_onboarding_policy_documents`.
- `/legal/terms/<version-uuid>` and `/legal/privacy/<version-uuid>` read that exact approved, published, immutable version through the existing `public.onboarding_policy_documents` projection.
- Publication order never chooses the current version. A newer published document can exist without being current; an earlier exact version remains readable after a pointer change.
- The minimal current view joins by both kind and version, and projects only the same public document fields. It exposes neither unpublished IDs nor private policy/name/account/acceptance data. Analytics documents are not legal-page kinds.
- Both projections exclude draft, unpublished, future-approved and future-published documents. The application validates identifiers, kind/version agreement, required text and publication timestamps, and fails closed on unexpected data.

## Navigation and accessibility

- Public start and existing authenticated session/account entry screens link to current terms/privacy. The existing onboarding consent screen also links to the exact version being displayed and accepted.
- Reading never records consent, changes current pointers, completes onboarding, grants roles, or requests a service-role key. Existing consent mutations still enforce their exact version and current actor prerequisites.
- `from=start|onboarding|account` selects a known in-app Back destination; unknown values fall back to start. Arbitrary return URLs are not accepted. Account returns through the existing guarded home entry, which chooses the user's authorized landing.
- Terms/privacy text is React-escaped plain text with preserved whitespace and wrapping, not HTML/Markdown, executable markup or automatically followed links. Text and spacing use existing design tokens.
- Current versus exact-version mode is explicit. Version and publication timestamp are shown; exact pages link back to the current pointer and current pages link to the exact URL.
- Retry/refresh is a new public server read, not a mutation. Browser Back/Forward and persisted-page restoration refresh the public projection. The feature does not cache documents in the service worker.

## Honest unavailable states

- Missing environment/connection configuration: explicitly unconfigured.
- Missing current pointer, wrong-kind pointer or unreadable configured document: no current document configured; never substitute another published row.
- Invalid, unknown, wrong-kind or nonpublic exact version: not found, without distinguishing draft existence.
- Upstream failure or malformed projection: unavailable, with no SQL/provider/private detail returned.

## Operational limits

This feature provides a display/navigation surface only. It does **not** provide an approval editor, activate or seed policies, supply legal advice/text, invent operator/support identity, contact an external recipient, or deploy anything. Final approved terms/privacy and genuine support phone/Kakao destinations remain separately pending. No legal/support launch-complete claim is made.

Only the new feature's explicit scoped units, SQL contract and 1+7 browser cases are selected. The three mobile text-scale screenshots require hosted generation and visual review because this executor cannot run local browser sockets or Docker. Historical regression suites remain stored but dormant; the one predeployment cumulative run remains unperformed and unauthorized for this work.
