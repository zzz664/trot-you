# 2026-10-25 — Official schedule-notice schema provenance

The committed `src/types/database.ts` is copied byte-for-byte from the official
Supabase CLI artifact, not synthesized, cast over or edited by hand.

- Workflow run: `40185486300`.
- Exact remote head: `19a164e4ae8037e1885b72d60a58645287148a71`.
- Verified tree: `018702fbb4812c0de60732909928ccb0c8b57c2a`.
- Artifact name / ID: `database-types` / `12596263853`.
- Artifact ZIP size: 9,016 bytes.
- Artifact ZIP SHA-256:
  `6812fab7033e4948b9e25a97ca2ba1bce0c821eb8c2ebbedd25ec9ad8bd5d554`.
- Extracted TypeScript size: 89,430 bytes.
- Extracted TypeScript SHA-256:
  `a4d3c16f4607e94ec971cbd3a9a84fe75344bd323c453d8ecf9f0d20367cf7cb`.

The monitor verified exact-head attribution, archive size/hash/CRC, successful
migration/lint, both full pgTAP passes, all concurrency suites (including the 23
checkpoint schedule races), and all four populated upgrades before generation.
The final database failure is the intentional stale committed-type gate. The
initial failed checkpoint generated no artifact and was not used.

The file was imported unchanged and compared with `cmp`. The final application
still needs an exact-head full CI pass, including the two additional authored
current-consent race cases and repaired schedule-browser response-capture
harness. Checkpoint evidence is not final application/browser evidence, live
provider delivery or production operation.
