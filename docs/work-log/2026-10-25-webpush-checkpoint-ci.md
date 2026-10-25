# Web Push checkpoint CI observations

## First checkpoint: fixture ambiguity

[Run 40151754788](https://github.com/zzz664/trot-you/actions/runs/40151754788)
tested remote head `453c34db49a5b68cf87511b10317c8aedbc511fb`, tree
`10da13bd604c7b6ba9df88c6d21eda14f57cfaba`. Checkout merge
`808f70ac96c42123d363e9e1e94d493b3c1d1a49` was verified tree-identical.

Actual Supabase migration/reset and schema lint passed. The first pgTAP pass
executed 3,215 assertions, including the new primary 76-assertion suite, then
failed before either of the other two new suites could run: their rollback-only
`pg_temp.claim_webpush` helper used local variable `message_id` beside an
unqualified table containing a `message_id` column. PostgreSQL correctly rejected
that ambiguous reference. This does not establish the unexecuted tests passed.

Both fixture helpers now use `v_message_id` and explicitly qualified job columns.
No production schema, generated type or assertion was changed/weakened. Static
inspection found no equivalent reference in the separately prepared bulk suite.
The correction still needs actual CI execution. The first run skipped the second
pgTAP pass, concurrency scripts and generated-type upload after the failure;
there is no genuine type artifact from that run.

Existing checkpoint quality checks passed 5,254 unit tests and 31 base browser
cases; these are not proof of the new application UI, which was not in that
DB-only checkpoint. Full final application and browser/visual checks remain due.
