# 2026-10-25 — Schedule notice database checkpoint

## Scope and contract

Feature 32 uses only `feature/schedule-notices`, based on merged develop
`3570903337cd5a164f3f45da1d26f021872564a0`. The previous local schedule branch
was preserved in a bundle and archived after verifying both trees were exactly
`cb7561eed15b0ed46e6b415d7a4c66dfeb0ac882`; no destructive reset or direct
main/develop publication occurred.

Private specifications 01 §2.4–2.5, 02 §3.8–3.9, 03 §3.7/3.9 and the
implementation analysis define next-day schedule notices, category preference
and per-event opt-out. They suggest 10:00 KST and Web Push/Alimtalk channels;
these source defaults are **not runtime business approval**. The new immutable
notice policy is deliberately unseeded. No operator setting, role, secret,
policy approval, actual push or Alimtalk provider is activated.

- Next day means the next `Asia/Seoul` calendar date, not rolling 24 hours.
  Queue creation begins at the approved KST hour; it never catches up on the
  event's own date.
- Recipients must be current unrestricted onboarded fans with an active artist
  and current subscription access, consistent with the existing my-artists
  schedule filter. Current category consent, per-event opt-out, valid push
  consent and active session-bound device are checked, then checked again at
  delivery preparation.
- Retire legacy publish-trigger/rolling-hour enqueue so it cannot bypass the
  new approval/window gate. Existing historical attempts remain audit history;
  active old work is canceled/requested-canceled, never relabeled unsent or
  recalled after a possible external request.
- Reuse existing transactional outbox identity, lease, retry and provider
  evidence machinery. A schedule/channel/user/device identity is lifetime
  unique. Time changes or cancellation invalidate old work; re-enabling an
  event or preference never resurrects terminal or uncertain work. New-date
  re-notification policy is not invented.
- Explicit desired booleans replace blind toggles at the user-facing API so
  retried requests cannot accidentally invert a preference. Owner identity
  comes from authenticated context, not a caller user ID.

## Verification plan and boundaries

The checkpoint adds real pgTAP assertions, independent-session races and a
populated pre-migration upgrade check. Existing notification schedule tests are
adapted to the new approved contract while retaining deletion, cancellation,
opt-out and replay coverage; unrelated message/billing coverage is preserved.
Official CI retains migration, DB lint, both full pgTAP runs, all concurrency
suites, all populated upgrades and zero-drift generated-schema checks.

The last verified feature31 DB run approached 20 minutes. The database job
budget is increased from 25 to 30 minutes to retain every check while adding
another populated upgrade/reset and race suite; no gate is removed or weakened.

Local Docker and browser execution remain unavailable/blocked as previously
reported and were not retried. SQL and actual migration outcomes are pending
this checkpoint's official Supabase CI; syntax/source checks are not claimed
as DB execution. The committed generated schema is intentionally unchanged
until the genuine CI artifact is available byte-for-byte. An expected bootstrap
schema-drift failure is not a merge pass.

No private source document is published. The prior independent-media runtime
review denial remains unchanged and was not retried, replicated or probed.
