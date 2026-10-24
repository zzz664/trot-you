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
