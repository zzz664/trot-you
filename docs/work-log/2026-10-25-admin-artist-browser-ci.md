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
