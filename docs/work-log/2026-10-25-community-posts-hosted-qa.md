# Community posts hosted QA and entitlement-boundary fixture repair

## Actual board runtime and pixel evidence

Application run `40235916565`, head
`738e946d872c41854a8377ed2ff18003260c1412`, passed all 25 isolated community
post scenarios, including real synthetic-image storage, exact lost-response
recovery, owner deletion, administrator notice conflicts, current-account denial,
and cancellation that actually releases all three staged-image reservations.
The keyless quality browser job also passed.

The official artifacts were matched to that head and checked for ZIP size,
SHA-256 and CRC before review. All 164 new-board PNGs were visually reviewed:
140 isolated board images (71 mobile, 69 desktop) and 24 keyless images across
normal, large and extra-large text at 360/1280 widths. Full-page and offscreen
controls were covered, with original-resolution checks of long forms, unknown
results, modal controls and privacy-denial states. No clipping, overlap, missing
settled panels, inaccessible visible controls or stale private content was found.

## Existing media assertion diagnosis and narrow repair

The same run failed an existing media assertion after its actual Storage-token
expiry check had already passed. The failure was the subsequent fresh-read
denial, not an expired token being accepted by Storage. Its four-second fictional
subscription was still live: integer-second capability expiry can precede the
persisted entitlement deadline. The failing test finished in 3.4 seconds.

Only the existing functional test harness and ordinary unit regressions changed.
The fixture reads the exact fictional actor/artist subscription deadline and a
single materialized database clock. Strict validation retains microsecond
precision and rejects changed or mismatched evidence. The test preserves both the
original clamping assertion and real Storage-expiry polling, adds clamping to the
persisted deadline, then polls that unchanged DB deadline before requesting a
single fresh grant that must be denied. There is no fixed sleep, repeated grant
probe, softened assertion or product authorization/storage change.

Focused unit regressions passed (105 tests), including distinct bearer and
entitlement expiry, the exact deadline, microsecond precision and fail-closed
fixture evidence. A fresh full `npm run check:all` passed ESLint/Prettier,
TypeScript, all 8,283 units in 276 files, contrast and Next/PWA builds. All 591
CI/fixture checks passed with zero skips. The 92,579-byte generated schema remains
byte-identical to the verified official artifact. Corrected hosted CI is pending.
The separate admin-artists job failed during local-service startup; this is not
reported as a passed browser gate. Merge remains blocked until required CI passes.

No local Docker/browser execution or denied independent media-security runtime
was retried or reproduced. No actual user assets, provider calls, deployment,
Cron activation, settings approval or production role changes were performed.
