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

## Application implementation

- Adds resource-ID-only, same-origin authenticated upload, completion, read and revoke routes; strict bounded UTF-8 JSON and private/no-store/no-referrer responses. Caller-selected bucket/path/actor input is rejected. Only the necessary scoped short-lived bearer URL reaches its authorized recipient; service credentials, unrelated storage paths, raw provider errors and original filenames do not.
- Real Supabase Storage uses signed private quarantine uploads, bounded downloads and immutable verified-byte promotion. Photo verification fully decodes/re-encodes JPEG/PNG/WebP; audio/video uses bounded container/track inspection plus complete packet timing, never client MIME/duration assertions alone.
- Signed reads compare the actual provider token expiration with freshly revalidated DB access; a shorter JSON expiry does not pretend to revoke a longer-lived token. Already issued bearer URLs retain a bounded residual access window; this is documented, not claimed as immediate revocation.
- Preview DTOs now contain only registered media IDs/kinds. Explicit accessible controls load private images/voice/video. Playback renewals preserve position for clips longer than one grant, stop on denial, and abort on navigation. Upload/read helpers are reusable; full artist compose, fan chat and board/avatar resource workflows are not prematurely added.
- Dedicated real local Storage CI is isolated from default/auth/payment suites and uses generated fictional bytes only. No production uploads, policy activation, secrets, hosted storage or deployment are performed.

## Review and verification boundaries

- Independent review found and drove fixes for provider signing-latency expiry, cancellation/completion race reporting, trailing/corrupt container acceptance, misleading metadata-only media duration, and long-voice playback interruption. Positive and defensive regressions are retained.
- The independent review child subsequently ended with a runtime `possible cybersecurity risk` error; no exact internal tool/action was exposed. The same review was not retried or delegated around that block. Final independent re-review/sign-off of the resulting packet-timing/UI revisions remains **not completed**; implementation tests are not represented as that approval.
- Early CI first exposed a PL/pgSQL CASE-parenthesis error; the next run reached 71 new pgTAP assertions before finding two improperly nested data-changing test CTEs. Both were corrected in dedicated immutable DB checkpoints. These unsuccessful runs are not counted as passed database validation.
- Local Docker and browser socket execution remain unavailable and were not retried/escalated. Real database/types/browser evidence must come from the exact committed GitHub Actions head. Final counts and observed outcome will be recorded after those checks.

## Local application checks before generated-type import

- Full unit suite: 3,530 tests in 107 files passed. All 54 pure fixture tests passed. ESLint, Prettier, the ten contrast pairs, and diff whitespace checks passed.
- Discovery-only Playwright listings confirm the dedicated media suite has 39 tests and the default suite remains 24 (authenticated suite remains 78). These listings are not browser execution.
- Typecheck currently fails only on the five new RPC names absent from the previous genuine generated schema. This is an explicit pending artifact dependency, not a hand-written type workaround or a successful full aggregate check.

## Genuine database artifact and application checkpoint

- Official CI run `40118735340`, exact remote checkpoint `de7a92333c0caf4daee975437ed01bdeb6ec2ed1`, passed database reset/lint, all 2,677 pgTAP assertions twice, and all concurrency scripts including the ten new media races (197 total). The type-generation/typecheck steps passed; the committed-type comparison then failed as expected before importing new types.
- Imported only the unchanged official `database-types` artifact `12569334985`: `database.ts` is 76,373 bytes, SHA-256 `ebd8ab93c5090fb316809b9fc6e4f3437a2484de82f7d62d1be9ea90c4ce1bef`. No generated declaration was hand-written.
- With that artifact, local `npm run check:all` passed (lint/format, genuine-schema typecheck, 3,530 unit tests, ten contrast checks, Next production build and PWA build). All four media route NFT manifests contain existing MediaInfo WASM, Sharp native binary and libvips runtime files.
- The checkpoint CI cancellation-browser runner failed before tests because host port 54322 was already in use; this was not a media assertion result. Final application-head CI, actual media-browser execution and screenshot review are still pending publication. No local Docker/browser restriction was retried or escalated.
