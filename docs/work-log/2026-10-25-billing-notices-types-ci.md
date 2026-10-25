# 2026-10-25 — Genuine billing-notice schema artifact

The corrected checkpoint ran in
[CI 40155816185](https://github.com/zzz664/trot-you/actions/runs/40155816185),
at attempt 1, branch head `35886f3cead99c71bf2956a750bb9d9545608bfb`.
Its tree is `7c2a47e6625ce9f03e0918860f0c660f54fb8d31`. The database job logged
merge checkout `0f600582a26dfbd44425bb83b071ca3b7093207e`, independently verified
to have the same tree.

Actual database migration/reset and lint passed. All 3,375 pgTAP assertions passed
twice, followed by all existing independent-session race steps and the 12 new
billing-notice races. Genuine local-Supabase schema generation and its subsequent
typecheck passed. The checkpoint database job failed only its intentional final
committed-schema-drift gate because it still contained the earlier schema.

Official `database-types` artifact **12585510244** was downloaded and checked:

- ZIP size: 8,527 bytes; integrity check passed; only `database.ts` present.
- ZIP SHA-256:
  `8e4b012436248f41d6bde9f1edf227a89f488568cdc64543ab4c0d8c46e91f16`,
  matching the official artifact metadata digest.
- Generated file SHA-256:
  `4672be28a19197acbaf2ce79e97ba4d0045415233b724b39dba9cc1aec36d343`.

The generated file was copied unchanged to `src/types/database.ts`, and its
SHA-256 was checked again. It adds the six actual billing-notice RPC contracts
and the final Web Push preparation source discriminator. No hand-authored schema
extension or type assertion substitutes for this output.

This is database evidence, not a claim of whole-feature CI success. The old
keyless Web Push Back test failed on a transient root URL expectation, which is
corrected in the application change. Full exact-head application/browser checks,
zero schema drift and ordinary visual review remain required before merge. No
local Docker/browser execution, hosted database, provider request or deployment
was used to obtain or validate this artifact.
