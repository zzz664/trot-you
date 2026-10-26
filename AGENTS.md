# Repository instructions

- Keep one feature branch active at a time. Do not push feature changes directly to `main` or `develop`.
- Use Conventional Commits with a Korean summary. Keep each PR focused on one feature. The user removed the former hard 300-line PR limit on 2026-10-24; preserve complete tests and clear review notes rather than splitting solely by line count.
- Use draft pull requests targeting `develop`. Merge, delete the finished branch, then start the next feature only within the user's authorization. Production deployment requires separate approval.
- Read the relevant private project specifications when available; do not publish the originals or infer missing business decisions as approved facts.
- Before changing Next.js behavior, consult documentation matching the installed version under `node_modules/next/dist/docs/`.
- Keep domain logic in services, external I/O in adapters, and SQL access in the database layer. Services must not import Next.js or fetch directly.
- Centralize user copy, paths, environment validation, design tokens, and operational settings. Do not expose private credentials through `NEXT_PUBLIC_*` or client props.
- Never substitute mock success for a real integration. Clearly distinguish local tests, CI, staging verification, and production operation.
- During development and PR work, run only tests for the changed work and its explicitly identified direct contracts. Never run `npm run check:all`, the entire unit/SQL/browser suite, every race/upgrade, or any cumulative fallback because a migration, shared file or CI file changed. Unknown impact must fail closed and require a scoped test plan, not broaden to all tests. Record exact selected files/cases and their reasons; selected failures remain failures. Keep all historical tests stored but dormant.
- A full cumulative test run is permitted only once immediately before deployment, under an explicit designation for that predeployment run. Do not trigger it automatically on pushes, merges, workflow changes or manual-workflow defaults. No predeployment run or deployment is authorized by ordinary feature work.
- UI changes need the selected affected browser cases and visual review at all three text scales, not every historical browser suite. Schema setup may apply all migrations without executing all regression tests. Compilation/type generation is not permission to run cumulative tests. Report blocked checks as blocked, not passed.
- Add a dated `docs/work-log/` entry describing scope, decisions, tests and limitations. Do not commit logs containing secrets or private source documents.
