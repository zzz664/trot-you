import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  isDocumentation,
} from './ci-impact-registry.mjs';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_DIFF_BYTES = 16 * 1024 * 1024;
const MAX_PLAN_BYTES = 32 * 1024;
const lists = ['unit', 'fixtures', 'sql', 'races', 'upgrades'];
const browserJobs = new Set(['quality', ...BROWSER_JOBS]);
const sortedUnique = (items) => [...new Set(items)].sort();
function safePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\0') &&
    !path.startsWith('/') &&
    !path.startsWith('-') &&
    !/[?*]/.test(path) &&
    !path.includes('\\') &&
    !path.split('/').some((part) => !part || part === '.' || part === '..')
  );
}
function exactPaths(value, label, allowEmpty = true) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
    value.some((path) => !safePath(path)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`Invalid explicit ${label} inventory.`);
  return [...value].sort();
}
function selectionOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Missing explicit test selection.');
  const allowed = new Set([...lists, 'browser', 'typecheck']);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('Unknown test selection category.');
  const selection = Object.fromEntries(
    lists.map((key) => [key, exactPaths(value[key], key)]),
  );
  const patterns = {
    unit: /^tests\/unit\/[a-zA-Z0-9_./-]+\.test\.tsx?$/,
    fixtures: /^scripts\/[a-zA-Z0-9_.-]+\.test\.mjs$/,
    sql: /^supabase\/tests\/[a-zA-Z0-9_.-]+\.test\.sql$/,
    races: /^scripts\/test-[a-zA-Z0-9-]+-concurrency\.mjs$/,
    upgrades: /^scripts\/test-[a-zA-Z0-9-]+-upgrade\.mjs$/,
  };
  for (const key of lists)
    if (selection[key].some((path) => !patterns[key].test(path)))
      throw new Error(`Invalid explicit ${key} test-file path.`);
  if (value.typecheck !== undefined && typeof value.typecheck !== 'boolean')
    throw new Error('Invalid compile selection.');
  selection.typecheck = value.typecheck === true;
  if (
    !value.browser ||
    typeof value.browser !== 'object' ||
    Array.isArray(value.browser)
  )
    throw new Error('Missing explicit browser inventory.');
  selection.browser = {};
  for (const job of Object.keys(value.browser).sort()) {
    if (!browserJobs.has(job) || !Array.isArray(value.browser[job]))
      throw new Error('Unknown browser job selection.');
    const entries = value.browser[job]
      .map((entry) => {
        if (
          !entry ||
          !safePath(entry.file) ||
          !/^tests\/e2e\/[a-zA-Z0-9_./-]+\.spec\.ts$/.test(entry.file) ||
          Object.keys(entry).some((key) => !['file', 'grep'].includes(key)) ||
          (entry.grep !== undefined &&
            (typeof entry.grep !== 'string' || !entry.grep))
        )
          throw new Error('Invalid explicit browser file/case selection.');
        if (entry.grep !== undefined) new RegExp(entry.grep);
        return entry.grep === undefined
          ? { file: entry.file }
          : { file: entry.file, grep: entry.grep };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (
      new Set(entries.map((entry) => JSON.stringify(entry))).size !==
      entries.length
    )
      throw new Error('Duplicate browser selection.');
    selection.browser[job] = entries;
  }
  return selection;
}
export function validateScope(value) {
  if (
    !value ||
    value.version !== 1 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id || '') ||
    !SHA.test(value.base || '') ||
    typeof value.reason !== 'string' ||
    !value.reason.trim()
  )
    throw new Error('Invalid scoped-work manifest.');
  const scope = {
    version: 1,
    id: value.id,
    base: value.base,
    covers: exactPaths(value.covers, 'changed-path', false),
    reason: value.reason,
    selection: selectionOf(value.selection),
  };
  if (value.reasons !== undefined) {
    if (
      !value.reasons ||
      typeof value.reasons !== 'object' ||
      Array.isArray(value.reasons) ||
      Object.values(value.reasons).some(
        (reason) => typeof reason !== 'string' || !reason.trim(),
      )
    )
      throw new Error('Invalid test selection reasons.');
    scope.reasons = Object.fromEntries(Object.entries(value.reasons).sort());
  }
  if (value.exclusions !== undefined) {
    if (
      !Array.isArray(value.exclusions) ||
      value.exclusions.some(
        (reason) => typeof reason !== 'string' || !reason.trim(),
      )
    )
      throw new Error('Invalid test exclusion reasons.');
    scope.exclusions = value.exclusions;
  }
  const hasTests =
    lists.some((key) => scope.selection[key].length) ||
    Object.values(scope.selection.browser).some((entries) => entries.length);
  if (!hasTests)
    throw new Error('A code scope must select changed-work tests.');
  return scope;
}
export function loadScopes(cwd = process.cwd()) {
  const root = join(cwd, 'ci/scopes');
  return readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      if (!entry.isFile() || !/^[a-z0-9-]+\.json$/.test(entry.name))
        throw new Error('Unexpected scoped-plan file.');
      return validateScope(
        JSON.parse(readFileSync(join(root, entry.name), 'utf8')),
      );
    });
}
export function parseNameStatus(buffer) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (!value) return [];
  if (!value.endsWith('\0')) throw new Error('Truncated NUL-delimited diff.');
  const fields = value.slice(0, -1).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[AMDT]|[RC](?:100|0?\d{1,2}))$/.test(status))
      throw new Error('Unknown or unresolved diff status.');
    const count = /^[RC]/.test(status) ? 2 : 1;
    const paths = fields.slice(index, index + count);
    if (paths.length !== count || paths.some((path) => !safePath(path)))
      throw new Error('Missing or unsafe diff path.');
    index += count;
    changes.push({ status, paths });
  }
  return changes;
}
function verifyProvenance(provenance) {
  if (
    !provenance ||
    provenance.event !== 'pull_request' ||
    provenance.baseRef !== 'develop' ||
    !['testSha', 'base', 'head', 'mergeBase'].every((key) =>
      SHA.test(provenance[key] || ''),
    )
  )
    throw new Error('Scoped execution requires verified PR provenance.');
}
export function selectImpact(paths, { scopes = [], provenance = {} } = {}) {
  verifyProvenance(provenance);
  if (!Array.isArray(paths) || paths.some((path) => !safePath(path)))
    throw new Error('Invalid changed paths.');
  const changedPaths = sortedUnique(paths);
  if (!changedPaths.length)
    throw new Error(
      'Empty diff requires an explicit scoped plan; no automatic full run.',
    );
  const codePaths = changedPaths.filter((path) => !isDocumentation(path));
  const active = scopes
    .map(validateScope)
    .filter(
      (scope) =>
        scope.base === provenance.mergeBase &&
        scope.covers.some((path) => codePaths.includes(path)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(active.map((scope) => scope.id)).size !== active.length)
    throw new Error('Duplicate scoped-work id.');
  const unmapped = codePaths.filter(
    (path) => !active.some((scope) => scope.covers.includes(path)),
  );
  if (unmapped.length)
    throw new Error(
      `Explicit scoped test plan required for: ${JSON.stringify(unmapped)}`,
    );
  const selection = Object.fromEntries(
    lists.map((key) => [
      key,
      sortedUnique(active.flatMap((scope) => scope.selection[key])),
    ]),
  );
  selection.typecheck = active.some((scope) => scope.selection.typecheck);
  selection.browser = {};
  for (const job of [...browserJobs].sort()) {
    const entries = active.flatMap(
      (scope) => scope.selection.browser[job] || [],
    );
    if (entries.length)
      selection.browser[job] = [
        ...new Map(
          entries.map((entry) => [JSON.stringify(entry), entry]),
        ).values(),
      ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  const jobs = Object.fromEntries(
    CONDITIONAL_JOBS.map((job) => [
      job,
      job === 'database'
        ? selection.sql.length > 0 ||
          selection.races.length > 0 ||
          selection.upgrades.length > 0
        : (selection.browser[job]?.length || 0) > 0,
    ]),
  );
  const plan = {
    version: 2,
    mode: codePaths.length ? 'scoped' : 'docs-only',
    reason: codePaths.length
      ? 'explicit-changed-work-plan'
      : 'documentation-only',
    changedPaths,
    pathCount: changedPaths.length,
    pathDigest: createHash('sha256')
      .update(JSON.stringify(changedPaths))
      .digest('hex'),
    scopes: active,
    selection,
    jobs,
    provenance,
  };
  if (Buffer.byteLength(JSON.stringify(plan)) > MAX_PLAN_BYTES)
    throw new Error(
      'Scoped plan exceeds output budget; narrow/split its evidence, never run all tests.',
    );
  return plan;
}
function git(cwd, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd,
    encoding,
    maxBuffer: MAX_DIFF_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function planForEvent(
  { eventName, event, sha },
  cwd = process.cwd(),
  scopesOverride,
) {
  if (eventName !== 'pull_request')
    throw new Error(
      'Automatic cumulative execution is forbidden; explicit scoped PR required.',
    );
  if (!SHA.test(sha || '')) throw new Error('Missing or invalid workflow SHA.');
  const testSha = git(cwd, ['rev-parse', 'HEAD']).trim();
  if (testSha !== sha) throw new Error('Checkout does not match workflow SHA.');
  const pr = event.pull_request;
  if (
    pr?.base?.ref !== 'develop' ||
    !SHA.test(pr?.base?.sha || '') ||
    !SHA.test(pr?.head?.sha || '')
  )
    throw new Error('Missing or unsupported scoped PR provenance.');
  for (const commit of [pr.base.sha, pr.head.sha])
    git(cwd, ['cat-file', '-e', `${commit}^{commit}`]);
  const parents = git(cwd, ['rev-list', '--parents', '-n', '1', testSha])
    .trim()
    .split(' ');
  if (
    parents.length !== 3 ||
    parents[1] !== pr.base.sha ||
    parents[2] !== pr.head.sha
  )
    throw new Error(
      'PR merge-parent mismatch; scoped plan cannot be verified.',
    );
  const bases = git(cwd, ['merge-base', '--all', pr.base.sha, pr.head.sha])
    .trim()
    .split('\n');
  if (bases.length !== 1 || !SHA.test(bases[0]))
    throw new Error('Ambiguous merge-base; explicit scope required.');
  const changes = parseNameStatus(
    git(
      cwd,
      [
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        bases[0],
        pr.head.sha,
        '--',
      ],
      null,
    ),
  );
  return selectImpact(
    changes.flatMap(({ paths }) => paths),
    {
      scopes: scopesOverride ?? loadScopes(cwd),
      provenance: {
        event: eventName,
        testSha,
        base: pr.base.sha,
        head: pr.head.sha,
        baseRef: pr.base.ref,
        mergeBase: bases[0],
      },
    },
  );
}
export function validatePlan(plan) {
  if (
    !plan ||
    plan.version !== 2 ||
    !['scoped', 'docs-only'].includes(plan.mode)
  )
    throw new Error('Invalid scoped impact plan version or mode.');
  const expected = selectImpact(plan.changedPaths, {
    scopes: plan.scopes,
    provenance: plan.provenance,
  });
  if (
    JSON.stringify(Object.keys(plan).sort()) !==
    JSON.stringify(Object.keys(expected).sort())
  )
    throw new Error('Unexpected or missing scoped plan evidence.');
  for (const key of Object.keys(expected))
    if (JSON.stringify(plan[key]) !== JSON.stringify(expected[key]))
      throw new Error(`Scoped plan evidence mismatch: ${key}.`);
  return plan;
}
export function impactSummary(plan) {
  return [
    '## Changed-work-only CI plan',
    '',
    `Mode: **${plan.mode}**. No cumulative fallback.`,
    `Selected: ${plan.selection.unit.length} unit files, ${plan.selection.fixtures.length} fixture/planner files, ${plan.selection.sql.length} SQL files, ${plan.selection.races.length} race scripts, ${plan.selection.upgrades.length} upgrade scripts.`,
    '',
    'Exact file/case inventory and selection/exclusion reasons:',
    '',
    '```json',
    JSON.stringify(plan, null, 2).replaceAll('`', '\\u0060'),
    '```',
    '',
  ].join('\n');
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const plan = validatePlan(
    planForEvent({
      eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
      sha: process.env.GITHUB_SHA,
    }),
  );
  if (!process.env.GITHUB_OUTPUT)
    throw new Error('Missing GitHub output file.');
  appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, impactSummary(plan));
  console.log(
    JSON.stringify({ mode: plan.mode, reason: plan.reason, jobs: plan.jobs }),
  );
}
