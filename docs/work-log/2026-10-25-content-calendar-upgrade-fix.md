# Content-calendar populated-upgrade fixture correction — 2026-10-25

Hosted checkpoint CI run 40213408644 passed DB lint, both complete pgTAP passes,
all existing race gates and all 24 new content-calendar races. The final new
populated-upgrade harness then failed before applying migration 32: its snapshot
queried a nonexistent `public.app_settings` table. Official type generation did
not run; this result is not a passing DB checkpoint.

The fixture now snapshots the six actual existing typed settings sources:
`private.admin_settings_state`, `private.admin_display_settings`,
`private.admin_settings_audit`, `private.admin_settings_operations`,
`private.message_policy`, and `private.community_policy`. It also populates a
fictional local display value and its genuine operator audit before upgrade.
Both complete before/after equality assertions remain, as do source text/audit
preservation and legacy/new CAS verification. No migration or runtime code changed.

A new 17-case static regression verifies all 14 snapshot relations and ordering
columns against predecessor migrations, exact settings coverage, populated audit,
retained preservation assertions and CAS boundary checks. It passed locally,
alongside Node syntax, ESLint, Prettier and diff checks. Static checks do not replace
real PostgreSQL execution: the fixed populated upgrade and official types must
still pass hosted CI. App WIP is excluded from this immutable correction.

The independent compose-browser failure in that checkpoint was hosted db:start
port binding (`54322` already in use), before any application test. No gate was
removed or weakened to accommodate it, and no local restricted runtime was tried.
