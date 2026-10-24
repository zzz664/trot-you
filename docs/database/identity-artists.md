# Identity and artist database foundation

This feature supplies schema, grants, RLS, local tooling and executable database tests. It does **not** implement login UI, OAuth, profile/onboarding services, notifications, billing or messaging. No hosted project is created or migrated.

## Local setup (Docker required)

Use Node 24, a running Docker-compatible daemon, and the CLI version pinned in `package-lock.json`. No Supabase login, project link, hosted keys or `.env.local` changes are required for these commands.

```sh
npm ci
npm run db:start
npm run db:reset       # DESTRUCTIVE: local DB only, migrations then fictional seeds
npm run db:lint
npm run test:integration
npm run db:types       # inspect actual local schema; never edit generated types by hand
npm run check:all
npm run db:stop
```

Ports: API `54321`, PostgreSQL `54322`, migration shadow DB `54320`. `supabase/config.toml` exposes **only `public`**, not `private`; do not add `private` to exposed or extra search-path schemas. New objects are not auto-exposed. Migrations also revoke/regrant explicitly so permissive hosted defaults cannot reopen these objects.

Only database/API/Auth services needed for this foundation are enabled; Studio, email, Storage, Realtime, analytics and Edge Runtime are disabled. Signup is disabled; SQL tests insert rollback-only fictional identities. Enabling OAuth/signup, redirect configuration, real accounts and invitations are later authorized work. Do not enable email or supply real credentials just to run schema tests.

`db:reset`, `db:lint` and `test:integration` are explicitly local. Do not append `--linked` or a remote URL. The reset deletes local data. `supabase stop` normally retains local Docker volumes; CI uses `--no-backup` for disposable volumes.

## Schema and permissions

| Object             | Anonymous / fan                                           | Artist account                                   | Admin account                                                       | Trusted server                                         |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------ |
| `profiles`         | Anonymous denied; fan reads own, changes own `font_scale` | Same own-row permissions; no fan PII             | Reads all; updates font preference; role changes only via named RPC | Explicit provisioning and validated profile writes     |
| `artist_catalog`   | Reads active artists' five safe fields                    | Same                                             | Same public projection                                              | Same                                                   |
| `artists`          | No raw rows                                               | Reads member artists, including nonpublic status | Reads/creates/updates/deletes                                       | Full data access                                       |
| `artist_members`   | No rows for a fan without a binding                       | Reads own bindings, no write                     | Reads/creates/updates/deletes bindings                              | Full data access                                       |
| `set_profile_role` | Denied                                                    | Denied                                           | Explicit role change with locked actor authorization                | Not granted; provision through authorized server write |

The public catalog is an intentional **owner-rights, security-barrier view** with a fixed `status = 'active'` predicate and explicit columns: `id`, `slug`, `name`, `profile_image_path`, `intro`. It has no write grants. It bypasses raw-artist RLS only for that public projection; contract dates, agency, grade and member IDs are never projected. Do not replace it with `SELECT *` or make it security-invoker without redesigning access. Public discovery code must use the catalog, not raw artists. This is deliberately tighter than the source's broad active-row read summary.

`private.current_user_role()` reads the database profile for `auth.uid()`, not editable JWT/user metadata. `private.is_artist_member(artist_id)` also requires the actor's current artist role. Helpers use a fixed empty `search_path`, fully qualified relations and explicit execute grants. They are outside the exposed API schema. Trigger functions are not client-callable.

An active restriction disables elevated artist/admin capability. `is_restricted = true` with null expiry is indefinite; with a future expiry it lasts until that time; an expired timestamp restores capability. Own profile reads/preferences remain accessible. This foundation does not yet implement content/action restrictions in future services.

## Profile and privileged writes

- Auth insertion creates a fan profile with `font_scale = 'large'`. Only string-shaped nickname/age-range/gender metadata is copied, as **untrusted informational data**. It is never proof of age, consent, identity or role.
- `role`, restrictions, phone, channel verification, demographics, timestamps and onboarding completion are not directly writable by authenticated clients, including admins.
- `call_name` is also server-only: granting direct writes would bypass future configurable length/profanity checks. Only basic nonempty/trimmed/no-control-character integrity is in SQL. Runtime calling-name rules, age eligibility, consent records and onboarding completion are **not implemented** here; the future validating service must enforce them before any server write. The database additionally requires a calling name and a sensible timestamp before completion.
- The only direct preference update is `font_scale`, restricted by row ownership (or admin authorization) and enum type.
- `public.set_profile_role(user_id, role)` locks and authorizes the caller's database admin profile; fans, artists, missing users and restricted admins fail closed. It rejects null roles and missing targets. Role revocation clears artist bindings via a trigger for both RPC and trusted-server changes, so re-promotion cannot resurrect them.
- No first admin is seeded. Initial operator access needs a separately authorized server/operator action against a verified account; no such action has occurred. The service-role key bypasses RLS and must remain server-only. Future services must authenticate and authorize the actor before using it; this schema cannot compensate for a leaked service key.
- IDs and original creation timestamps are immutable on update; `updated_at` is database-controlled. Auth deletion cascades to profile and member bindings. Artist deletion removes bindings. Contract date ordering, unique URL slugs, membership uniqueness and foreign keys are enforced.

## Tests and generated types

`supabase/tests/identity_artists.test.sql` runs pgTAP assertions on actual PostgreSQL with the real Supabase auth schema in CI. It switches among `anon`, two fans, two artists, admin, missing subject and `service_role`; it verifies positive reads/writes and negative table/RPC access, metadata attacks, ownership, sensitive fields, constraints, restrictions, role changes, timestamps and deletion cascades. All fixtures are fictional and rolled back. Run on a freshly reset local database, not a personal/shared populated instance. CI runs it twice to detect leaked fixtures.

The separate `database` CI job starts the official local Supabase stack (PostgreSQL 17), reapplies migrations from empty, runs lint and integration tests, then generates `src/types/database.ts` with the pinned official CLI and typechecks. It uses no hosted project or external keys. The existing quality/browser job remains independent and runs all 13 UI regressions.

Type generation writes a temporary file and replaces the target only after CLI success and formatting. Never describe hand-written interfaces as generated. During the initial bootstrap, CI publishes a `database-types` artifact and then fails the missing-committed-types gate; that exact generated output must be reviewed and committed before merging. CI also fails on schema/type drift. Later migrations must regenerate and commit types in the same feature PR.

Local WASM PostgreSQL smoke execution is useful supplementary evidence, not a substitute for this CI gate: it uses a minimal auth fixture, not the full Auth/PostgREST stack, and may run a different PostgreSQL major version. Neither local SQL execution nor CI proves OAuth, REST/JWT verification, staging connectivity, backups or production readiness.

## Deployment boundary

Production application is **manual, separately authorized and not executed**. Before staging/production application, verify the target project/version, backup and restore plan, schema ownership/default grants, intended migration diff, restricted exposed schemas and role/bootstrap plan. Apply versioned migrations through an approved process, without development seeds or database reset, then verify RLS using isolated authorized accounts and regenerate types if needed. Never copy the seed or SQL test users into a live project.

## References

Implementation follows the supplied private database identity/artist/RLS sections and architecture/API layer boundaries; the originals are not published. Public references: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [function security](https://supabase.com/docs/guides/database/functions), [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config), [database tests](https://supabase.com/docs/guides/local-development/testing/overview), [generated schema types](https://supabase.com/docs/reference/cli/supabase-gen-types).
