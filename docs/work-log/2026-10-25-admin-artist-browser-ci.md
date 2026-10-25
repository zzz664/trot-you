# 2026-10-25 — Admin artist browser CI corrections

## Observed CI evidence

- Application checkpoint `e0728a0`, run `40162673165`: 6,228 unit tests passed. The new authenticated browser suite reported 15 passed and 2 failed; both failures occurred in synthetic photo fixture preparation before preview administration was exercised.
- Completing an accepted upload advances the existing composer draft revision. The fixture reused its pre-upload revision and correctly received HTTP 409. It now reads the current draft through the same authenticated API, asserts matching identity, increased revision and attached media, then saves/dispatches with that revision. The production CAS behavior is unchanged.
- The general browser suite reported 51 passed and one flaky existing activity Back test. Its expected `/artist` URL was only an intermediate navigation state: the unchanged artist landing guard redirects keyless sessions to `/start?next=%2Fartist`. The test now awaits that exact settled destination and its disabled login control, rather than accepting transient navigation.

## Verification and remaining gate

- Focused fixture/discovery checks passed (28). Full local `npm run check:all` passed again: lint/format, TypeScript, 6,228 unit tests, contrast and production Next.js/PWA build. A fresh full CI run is required before claiming the corrections verified in a browser.
- Ordinary visual review covered all 24 initial keyless captures: list/create/detail/recipient pages at normal/large/xlarge text scales and 360/1280 widths. Error text and recovery/back controls remain readable and unclipped. CI also asserted computed body font sizes, no horizontal overflow and settled recovery destinations.
- Authenticated visual review and the successful accepted-photo capture remain pending. This failed run is not a clean final gate.
- No local browser or Docker execution, live account/invitation, credential, role grant, policy setup or independent media-security review was attempted.

## Second browser checkpoint

- Run `40163676066`, head `449def5`: both synthetic-photo revision conflicts were resolved. The admin suite reached 16 passed and one timeout because the test requested the exact label “사진 열기” while the existing shared media component renders “사진 메시지 열기”. The test now uses the shared artist message-kind namespace, matching the official failure snapshot; runtime media behavior is unchanged.
- The existing dispatch suite reported 42 passed and one failed viewport assertion. Its failure screenshot shows the chat at the page top with the read count already incremented and the asynchronously loaded reply panel above the message list. The unchanged fan UI can alter layout after an initial body scroll. The test now waits for the real reply history read and enabled refresh control, preserves the real read-receipt assertions, and scrolls/asserts visible plus in-viewport again after read acknowledgement and font/layout settlement. No assertion was removed, no wait timeout was increased and no test retry was added. This narrows a supported timing diagnosis without claiming the image proves the exact browser scroll event.
- All 66 available new feature captures at the preceding checkpoint passed ordinary visual review (42 authenticated plus 24 keyless); the accepted-photo-open capture and both corrected scenarios still require fresh CI evidence.
- With these two test-only corrections, full local `npm run check:all` passed again (6,228 unit tests, lint/format/types/contrast/build), together with the 28 admin and 27 dispatch fixture/discovery checks. Browser execution remains CI-only and pending on the corrected head.

## Activity navigation settlement

- Run `40164631977`, head `6dae83b`: admin 17/17, dispatch 43/43 and general browser 52/52 passed cleanly; the database passed 3,523 pgTAP assertions twice, 325 concurrency scenarios and generated-type zero drift. All 67 new feature captures were obtained and ordinary visual review found no clipping, overlap or readability issue.
- The activity job initially failed before tests because its isolated infrastructure could not start. An authorized activity-only retry reached tests and reported 23/24 passed. The large-text menu-pagination failure snapshot still showed the prior artist detail feed, not the menu: the test clicked Back, immediately performed synchronous fixture insertion and reloaded without waiting for its client navigation.
- That test now awaits the unfiltered feed URL/state, then the exact menu URL and heading before fixture insertion/reload. Existing pagination, destination, empty-state and screenshot assertions remain unchanged; no runtime code, retry policy or timeout was changed. A new exact-head CI run is still required to verify the navigation correction.
- The corrected test passed the 17 pure activity fixture/discovery checks and full local `npm run check:all` (6,228 unit tests plus lint/format/types/contrast/build). No local browser or database was launched.
