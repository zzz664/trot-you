import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  FEATURE_RULES,
  classifyPath,
} from './ci-impact-registry.mjs';

const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_DIFF_BYTES = 16 * 1024 * 1024;
// The aggregate also receives needs JSON containing an escaped copy of this
// output. Leave ample room below per-environment-string OS/GitHub limits.
const MAX_PLAN_BYTES = 32 * 1024;

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
    const paths = fields.slice(index, index + (/^[RC]/.test(status) ? 2 : 1));
    if (
      paths.length !== (/^[RC]/.test(status) ? 2 : 1) ||
      paths.some(
        (path) =>
          !path ||
          path.startsWith('/') ||
          path.split('/').some((part) => part === '.' || part === '..'),
      )
    )
      throw new Error('Missing or unsafe diff path.');
    index += paths.length;
    changes.push({ status, paths });
  }
  return changes;
}

function jobsFor(mode, ruleIds) {
  const selected = new Set(
    FEATURE_RULES.filter(({ id }) => ruleIds.includes(id)).flatMap(
      ({ jobs }) => jobs,
    ),
  );
  return Object.fromEntries(
    CONDITIONAL_JOBS.map((job) => [
      job,
      mode === 'full' ||
        (mode === 'selective' && (job === 'database' || selected.has(job))),
    ]),
  );
}

export function selectImpact(
  paths,
  { forceFull = null, provenance = {} } = {},
) {
  const uniquePaths = [...new Set(paths)].sort();
  const decisions = uniquePaths.map((path) => ({
    path,
    ...classifyPath(path),
  }));
  const ruleIds = [...new Set(decisions.flatMap(({ rules }) => rules))].sort();
  const reason =
    forceFull ||
    (!uniquePaths.length ? 'empty-diff' : null) ||
    (decisions.some(({ kind }) => kind === 'full') ? 'full-impact-path' : null);
  const mode = reason
    ? 'full'
    : decisions.every(({ kind }) => kind === 'docs')
      ? 'docs-only'
      : 'selective';
  const plan = {
    version: 1,
    mode,
    reason:
      reason || (mode === 'docs-only' ? 'documentation-only' : 'mapped-paths'),
    jobs: jobsFor(mode, ruleIds),
    paths: uniquePaths,
    pathCount: uniquePaths.length,
    pathDigest: createHash('sha256')
      .update(JSON.stringify(uniquePaths))
      .digest('hex'),
    rules: ruleIds,
    provenance,
  };
  // GitHub job outputs are bounded. An unusually large diff must broaden the
  // run, never truncate its file list and accidentally select fewer suites.
  if (Buffer.byteLength(JSON.stringify(plan)) > MAX_PLAN_BYTES) {
    return {
      ...plan,
      mode: 'full',
      reason: 'oversized-plan',
      jobs: jobsFor('full', []),
      paths: null,
      rules: [],
    };
  }
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

export function planForEvent({ eventName, event, sha }, cwd = process.cwd()) {
  if (!SHA.test(sha || '')) throw new Error('Missing or invalid workflow SHA.');
  const testSha = git(cwd, ['rev-parse', 'HEAD']).trim();
  if (testSha !== sha) throw new Error('Checkout does not match workflow SHA.');
  const provenance = { event: eventName, testSha };
  const full = (reason) => selectImpact([], { forceFull: reason, provenance });
  if (eventName !== 'pull_request') return full('full-event');
  const pr = event.pull_request;
  if (pr?.base?.ref !== 'develop') return full('protected-or-unknown-base');
  if (!SHA.test(pr?.base?.sha || '') || !SHA.test(pr?.head?.sha || ''))
    return full('missing-pr-commits');
  provenance.base = pr.base.sha;
  provenance.head = pr.head.sha;
  provenance.baseRef = pr.base.ref;
  try {
    // checkout@v4 fetch-depth:0 supplies merge/base/head objects, including fork
    // heads via the PR merge ref. No PR API, write token, or target event needed.
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
      return full('merge-parent-mismatch');
    const bases = git(cwd, ['merge-base', '--all', pr.base.sha, pr.head.sha])
      .trim()
      .split('\n');
    if (bases.length !== 1 || !SHA.test(bases[0]))
      return full('ambiguous-merge-base');
    provenance.mergeBase = bases[0];
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
        forceFull: changes.some(({ status }) => status === 'T')
          ? 'file-type-change'
          : null,
        provenance,
      },
    );
  } catch {
    // Missing history, malformed output, and byte-limit errors are full runs,
    // not empty successful selections. Checkout identity errors above fail CI.
    return full('diff-unavailable');
  }
}

export function validatePlan(plan) {
  if (
    !plan ||
    plan.version !== 1 ||
    !['full', 'selective', 'docs-only'].includes(plan.mode)
  )
    throw new Error('Invalid impact plan version or mode.');
  if (
    !plan.provenance ||
    !SHA.test(plan.provenance.testSha || '') ||
    !Number.isSafeInteger(plan.pathCount) ||
    plan.pathCount < 0 ||
    !/^[a-f0-9]{64}$/.test(plan.pathDigest || '') ||
    typeof plan.reason !== 'string' ||
    !plan.reason ||
    !Array.isArray(plan.rules)
  )
    throw new Error('Missing impact plan evidence.');
  if (plan.mode !== 'full') {
    if (
      plan.provenance.event !== 'pull_request' ||
      plan.provenance.baseRef !== 'develop' ||
      ![
        plan.provenance.base,
        plan.provenance.head,
        plan.provenance.mergeBase,
      ].every((sha) => SHA.test(sha || ''))
    )
      throw new Error('Selective execution requires verified PR provenance.');
  }
  if (plan.paths === null) {
    if (plan.mode !== 'full' || plan.reason !== 'oversized-plan')
      throw new Error('Only a full oversized plan may omit paths.');
  } else {
    if (
      !Array.isArray(plan.paths) ||
      plan.paths.some((path) => typeof path !== 'string' || !path)
    )
      throw new Error('Invalid impact paths.');
    const expected = selectImpact(plan.paths, {
      forceFull: plan.mode === 'full' ? plan.reason : null,
      provenance: plan.provenance,
    });
    for (const field of [
      'mode',
      'reason',
      'pathCount',
      'pathDigest',
      'rules',
      'paths',
    ])
      if (JSON.stringify(plan[field]) !== JSON.stringify(expected[field]))
        throw new Error(`Impact plan evidence mismatch: ${field}.`);
  }
  const expectedJobs = jobsFor(plan.mode, plan.rules);
  if (
    !plan.jobs ||
    JSON.stringify(Object.keys(plan.jobs).sort()) !==
      JSON.stringify([...CONDITIONAL_JOBS].sort()) ||
    CONDITIONAL_JOBS.some((job) => plan.jobs[job] !== expectedJobs[job])
  )
    throw new Error('Incomplete or inconsistent impact job inventory.');
  return plan;
}

export function impactSummary(plan) {
  const selected = BROWSER_JOBS.filter((job) => plan.jobs[job]);
  return [
    '## CI impact plan',
    '',
    `Mode: **${plan.mode}**; reason: \`${plan.reason}\`.`,
    `Feature browsers selected: **${selected.length}/${BROWSER_JOBS.length}**.`,
    `Database: **${plan.jobs.database ? 'full regression' : 'documentation-only skip'}**. Quality always runs.`,
    '',
    '| Job | Decision |',
    '| --- | --- |',
    ...CONDITIONAL_JOBS.map((job) =>
      [
        `| ${job} | ${plan.jobs[job] ? 'run' : 'intentional skip: outside impact plan'} |`,
      ].join(''),
    ),
    '',
    'Selection evidence (JSON-escaped paths; no shell evaluation):',
    '',
    '```json',
    JSON.stringify(
      {
        ...plan,
        paths: plan.paths?.map((path) => path.replaceAll('`', '\\u0060')),
      },
      null,
      2,
    ),
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
