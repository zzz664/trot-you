# 2026-10-24 — Fan text replies

## Immutable database checkpoint

- Starts the single `feature/fan-replies` branch from merged develop `db187db`.
  The prior local fan-chat tip had the same tree and was preserved in a local
  archive bundle before branch cleanup. No private source specification is
  published and no feature changes are pushed directly to develop or main.
- Adds authenticated, current-actor reply sending and own-history projections.
  An immutable operation UUID binds actor, artist, exact body and optional
  currently visible message. Replaying an accepted operation returns its
  original identity/time without spending quota or adding another reply.
- A separate explicitly approved reply policy controls bounded moderation
  categories/literal terms and atomic per-user quota. There is no seeded live
  policy or invented operational fallback. Without send policy, current eligible
  fans can still read their retained own history but cannot send.
- Current fan/onboarding/legal/name readiness and paid/grace/canceled-through-
  period access are rechecked in the database. The source gives an artist-message
  visibility window but no own-reply expiry: own text is retained across episodes
  without inventing deletion. Blocked history preserves identity/time with its
  body redacted. Raw authenticated reply SELECT is removed in favor of this DTO.
- The legacy trusted-service signature is routed through the same validation and
  quota core; it cannot bypass moderation. It has no caller operation key and is
  not used by the browser application or claimed to be retry-safe.
- Database tests use rollback-only fictional fixtures; separate multi-session
  races exercise locking and duplicate outcomes. No rewards, message read count,
  analytics capture, realtime, artist reply dashboard or outbound delivery is
  added. Speech input is a separate feature.
- Local Docker is unavailable. SQL reset/lint, pgTAP repeatability, races and
  genuine schema type generation remain pending isolated CI. Generated database
  types are never handwritten. This checkpoint is not application completion.

## Preserved verification boundary

The previous media feature's independent review ended with a runtime
`possible cybersecurity risk` error; final independent media re-review/sign-off
remains incomplete. That blocked review is not retried, replicated or delegated.
New reply functional/database-correctness review and existing accepted interface
regression tests do not imply an overall security sign-off. Local browser socket
execution is also unavailable and is not retried or escalated; browser execution
and three-scale screenshot inspection remain CI-only.

## Application and ordinary reply review

- The existing paid artist room now has a real actor-authenticated text composer
  and personal reply history. The current server length bound controls Unicode
  character counting; missing send policy disables the composer honestly while
  retaining authorized history. No artist receipt/response is fabricated.
- Immutable submission payload/key survives pending double taps, unknown results,
  explicit retry and composer close/reopen. Definitive validation failures keep
  the draft editable; uncertain writes remain read-only until same-key resolution.
  No automatic write retries or browser-stored drafts are introduced. Terminal
  session/readiness/access loss removes the entire private room; navigation and
  stale acknowledgements cannot restore its drafts or content.
- Adds strict bounded GET/POST transport, private/no-store responses, current
  verified session checks, same-origin writes and actor-only SQL capability.
  Cursor tuples preserve full timestamp precision and bind to the room. Own
  blocked history remains redacted; payload/operation/message mismatch fails
  closed rather than claiming success.
- Ordinary independent **reply-only functional/database-source** review found
  detector gaps for newer bare domain suffixes and compatibility-only whitespace,
  an overly broad Unicode domain false positive for normal Korean punctuation,
  and missing field-error association. All were corrected with direct tests.
  Bare domain matching is explicitly ASCII/punycode baseline; scheme/www cover
  internationalized forms. This is not a universal content-evasion guarantee.
  The punctuation refinement follows the immutable DB checkpoint without changing
  any RPC/type signature. Same-room subscription-loss recovery now refreshes the
  authoritative server projection rather than retaining stale paid room state.
- Dedicated guarded browser collection contains 28 cases and 27 planned captures,
  including normal/large/xlarge at 360/414/1024 widths, successful send/own history,
  immutable unknown-result retries, current eligibility, draft close/navigation,
  pagination ordering and actual recovery-link destinations. The default keyless
  suite separately adds unavailable GET/POST coverage and collects 26 cases.
  Guarded/default `--list` checks are collection, not browser execution.
- Local lint/format, 4,148 unit tests in 122 files, 82 pure fixture checks, ten
  contrast pairs and whitespace checks passed before two extra same-URL recovery
  tests were added; those focused tests also passed. Final full aggregation is
  still pending. Typecheck currently fails only for the two new RPC declarations
  awaiting genuine CI schema generation; no substitute declarations are written.
- Published schema checkpoint uses remote parent `a59f139` with exactly the same
  tree as local `e58a9d6`. Local history was bundled and safely aligned to that
  remote commit before continuing. Parent owns PR publication/merge and checks;
  this worker performs no remote mutation or production action.

## Genuine schema artifact

- Checkpoint CI `40127960067`, published head
  `a59f139c464ac23255364dd3a91ad249756b19ab`, passed reset/lint, 2,876 pgTAP
  assertions twice and all 225 concurrency scenarios (including 15 new reply
  races). Actual runner merge `40477f53266469540fced4c1bcbe0ac8b4dd176b`
  had the exact checkpoint tree `60398e33a124c417fb38a379ff997bc3560367f0`.
- Genuine type generation and post-generation typecheck passed. The committed
  type-freshness check then failed as expected before artifact import; the other
  eight checkpoint jobs passed. This checkpoint did not execute the new reply UI
  or its dedicated browser job, which remained local application work.
- Imported only unchanged official `database-types` artifact `12574356200`:
  `database.ts` is 78,302 bytes, SHA-256
  `071191b748e8ca8398cc4444cdb0c633e21e9e1c08b507ea1299db8b8ff87005`.
  ZIP digest matched the API/upload evidence. No generated declaration was
  handwritten. The later detector refinement does not change the schema shape.
- A final local unit rerun including both recovery callbacks passed 4,150 tests
  in 123 files. Full `npm run check:all` with the genuine artifact passed: lint/format,
  typecheck, all 4,150 unit tests, ten contrast pairs, production Next build and
  static-only PWA build. Final-head CI still must verify the additional Korean-punctuation
  SQL assertion, type zero drift, dedicated reply browser cases and all existing
  suites; checkpoint green outcomes do not establish those unexecuted results.

## Restricted-owner recovery expectation correction

- Application-head CI `40129089396` executed all 28 reply browser cases: 27
  passed, including the nine three-scale/width send flows; one expected a
  restricted fan's subscription link to redirect to `/restricted`.
- That expectation contradicted the established subscription-management contract:
  account restrictions deny paid chat/replies but never prevent an owner from
  inspecting or canceling existing billing. The application correctly reached
  `/me/subscriptions`. No application or access-policy change is required.
- The focused browser correction now verifies the actual subscription heading
  and management control, the absence of the paid-room link and private room
  content, and captures the destination. The suite remains 28 cases with 28
  planned screenshots. The corrected case requires fresh CI execution.
- The same run's media browser job failed before build/tests because runner host
  port 54322 was already in use. This is an infrastructure result, not a media
  assertion or a retry of the earlier blocked independent review. Parent owns
  any scoped CI recovery; no local Docker/browser retry is performed.
- Correction-local `npm run check:all` passed again (4,150 tests, 123 files,
  genuine types, contrast and production/PWA build); guarded discovery still
  collects 28. These checks do not claim the corrected browser case has run.

## Initial reply-read authorization race in existing chat tests

- The same application run completed chat coverage with 27 passes and three
  timeout failures: subscription/session/restriction recheck tests revoked access
  immediately after server-rendered text appeared, while the new initial own-feed
  request was still pending. That independent request correctly removed the
  private room, detaching the Refresh button before the test clicked it.
- Those three cases now wait for the initial own-feed heading before revocation
  so they deterministically test explicit chat Refresh as intended. They retain
  all private-content removal/read-evidence assertions. No application behavior
  is weakened or delayed.
- Adds a separate real-browser reply case that deliberately holds the initial
  own-feed request, revokes access, then releases it and requires immediate whole-
  room clearance without a send or refresh action. Dedicated reply discovery is
  now 29 cases with 29 planned captures; chat remains 30 cases/26 captures.
  Actual corrected/new executions remain pending the next exact-head CI.
- Local `npm run check:all` passed after these fixture changes (unchanged 4,150
  unit tests/123 files, genuine types, contrast and production/PWA build).
  Guarded collection confirms reply 29 and chat 30. The new case disables
  automatic readmarks and observes the actual reply GET's 403, isolating the
  reply authorization outcome rather than accepting unrelated room clearance.
