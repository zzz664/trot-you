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

## Corrected immutable checkpoint

[Run 40152209775](https://github.com/zzz664/trot-you/actions/runs/40152209775)
tested corrected remote head `e3abfd2d4187f7f41f4cd710603e3973c763a324`,
tree `480f2f8656a4bd551b4b374d18cbbe84d8b44c28`. The checkout merge tree
was verified identical. Both reset/pgTAP passes succeeded with **3,247 assertions
each**. All **297 independent-session concurrency scenarios** across 22 steps
passed, including all 24 new Web Push cases. Schema lint and generated-type
TypeScript validation passed.

Official artifact `12583138546` supplied genuine `database.ts`; its downloaded
ZIP SHA-256 matched GitHub metadata
`ff71ef20347aa222a10478c30e6c9317d380f1f00d5f0806adb7a79946f46e83`.
The extracted file SHA-256 is
`6c185f93f63d4dc76f2c832978faf9313467af6bcb6dc67b86771ef7ed60a29d`;
it was copied byte-for-byte into the application commit, not handwritten.
The checkpoint's final committed-type drift check failed as expected because
the new genuine schema was not committed in that DB-only checkpoint.

Separately, `activity-browser` could not start its disposable stack because
runner port 54324 was already in use. No browser case in that job executed;
this is not a browser regression pass or a reason to retry locally. The final
application head still requires every CI job and actual screenshot review.
