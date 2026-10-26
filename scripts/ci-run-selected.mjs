// Changed-work execution only. Importing this module never loads a command
// runner or starts tests. Missing plans/mappings are errors, not full-suite runs.
import { pathToFileURL } from 'node:url';

export const BROWSER_CONFIGS = Object.freeze({
  quality: ['playwright.config.ts', ''],
  'auth-browser': ['playwright.auth.config.ts', 'authenticated'],
  'enrollment-browser': ['playwright.enrollment.config.ts', 'enrollment'],
  'renewal-browser': ['playwright.renewal.config.ts', 'renewal'],
  'cancellation-browser': ['playwright.cancellation.config.ts', 'cancellation'],
  'reconciliation-browser': [
    'playwright.reconciliation.config.ts',
    'reconciliation',
  ],
  'media-browser': ['playwright.media.config.ts', 'media'],
  'chat-browser': ['playwright.chat.config.ts', 'chat'],
  'reply-browser': ['playwright.replies.config.ts', 'replies'],
  'speech-browser': ['playwright.speech.config.ts', 'speech'],
  'compose-browser': ['playwright.compose.config.ts', 'compose'],
  'dispatch-browser': ['playwright.dispatch.config.ts', 'dispatch'],
  'activity-browser': ['playwright.activity.config.ts', 'activity'],
  'webpush-browser': ['playwright.webpush.config.ts', 'webpush'],
  'billing-notices-browser': [
    'playwright.billing-notices.config.ts',
    'billing-notices',
  ],
  'admin-artists-browser': [
    'playwright.admin-artists.config.ts',
    'admin-artists',
  ],
  'admin-settings-browser': [
    'playwright.admin-settings.config.ts',
    'admin-settings',
  ],
  'admin-subscriptions-browser': [
    'playwright.admin-subscriptions.config.ts',
    'admin-subscriptions',
  ],
  'schedules-browser': ['playwright.schedules.config.ts', 'schedules'],
  'schedule-notices-browser': [
    'playwright.schedule-notices.config.ts',
    'schedule-notices',
  ],
  'content-calendar-browser': [
    'playwright.content-calendar.config.ts',
    'content-calendar',
  ],
  'community-posts-browser': [
    'playwright.community-posts.config.ts',
    'community-posts',
  ],
  'community-interactions-browser': [
    'playwright.community-interactions.config.ts',
    'community-interactions',
  ],
  'community-moderation-browser': [
    'playwright.community-moderation.config.ts',
    'community-moderation',
  ],
  'attendance-points-browser': [
    'playwright.attendance-points.config.ts',
    'attendance-points',
  ],
  'activity-rewards-browser': [
    'playwright.activity-rewards.config.ts',
    'activity-rewards',
  ],
  'analytics-funnel-browser': [
    'playwright.analytics-funnel.config.ts',
    'analytics-funnel',
  ],
  'settlement-reports-browser': [
    'playwright.settlement-reports.config.ts',
    'settlement-reports',
  ],
});
const MODES = [
  'unit',
  'fixtures',
  'sql',
  'races',
  'upgrades',
  'browser',
  'lint',
];
const TARGETS = Object.freeze({
  unit: /^tests\/unit\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.tsx?$/,
  fixtures: /^scripts\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.mjs$/,
  sql: /^supabase\/tests\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:sql|pg)$/,
  races: /^scripts\/test-[a-z0-9-]+-concurrency\.mjs$/,
  upgrades: /^scripts\/test-[a-z0-9-]+-upgrade\.mjs$/,
});
const MAX_ITEMS = 10_000;
const MAX_PATH_LENGTH = 1024;
const MAX_GREP_LENGTH = 4096;
const MAX_PLAN_BYTES = 1024 * 1024;
const ESLINT_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const PRETTIER_EXTENSIONS =
  /\.(?:[cm]?[jt]s|[jt]sx|json|jsonc|ya?ml|md|mdx|css|scss|html|sql)$/;
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const unique = (values) => [...new Set(values)].sort();
function safePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    !/^[/-]/.test(value) &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    !/^[A-Za-z]:/.test(value) &&
    !value
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..')
  );
}
function paths(value, category) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ITEMS ||
    value.some(
      (path) => !safePath(path) || (category && !TARGETS[category].test(path)),
    )
  )
    throw new Error(`Invalid ${category || 'changed'} path selection.`);
  if (new Set(value).size !== value.length)
    throw new Error(`Duplicate ${category || 'changed'} path selection.`);
  return value;
}
function browserEntries(value, job) {
  if (
    !Object.hasOwn(BROWSER_CONFIGS, job) ||
    !Array.isArray(value) ||
    value.length > MAX_ITEMS
  )
    throw new Error('Invalid browser job selection.');
  const directory = BROWSER_CONFIGS[job][1];
  const root = `tests/e2e/${directory ? `${directory}/` : ''}`;
  for (const entry of value) {
    if (
      !object(entry) ||
      Object.keys(entry).some((key) => key !== 'file' && key !== 'grep') ||
      !safePath(entry.file) ||
      !entry.file.startsWith(root) ||
      !/^[A-Za-z0-9_./-]+\.spec\.tsx?$/.test(entry.file) ||
      (!directory && entry.file.slice(root.length).includes('/'))
    )
      throw new Error('Invalid browser file selection.');
    if (Object.hasOwn(entry, 'grep')) {
      if (
        typeof entry.grep !== 'string' ||
        !entry.grep.trim() ||
        entry.grep.length > MAX_GREP_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(entry.grep)
      )
        throw new Error('Invalid browser case expression.');
      try {
        new RegExp(entry.grep);
      } catch {
        throw new Error('Invalid browser case expression.');
      }
    }
  }
}
export function validateSelectionPlan(plan) {
  if (
    !object(plan) ||
    plan.version !== 2 ||
    !['scoped', 'docs-only'].includes(plan.mode) ||
    !object(plan.selection)
  )
    throw new Error('A scoped version 2 impact plan is required.');
  paths(plan.changedPaths);
  if (
    JSON.stringify(plan.changedPaths) !==
    JSON.stringify(unique(plan.changedPaths))
  )
    throw new Error('Changed paths must be canonical and sorted.');
  const keys = [...Object.keys(TARGETS), 'browser', 'typecheck'];
  if (
    Object.keys(plan.selection).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(plan.selection, key))
  )
    throw new Error('Selection inventory is missing or unexpected.');
  for (const category of Object.keys(TARGETS))
    paths(plan.selection[category], category);
  if (typeof plan.selection.typecheck !== 'boolean')
    throw new Error('Typecheck selection must be boolean.');
  if (!object(plan.selection.browser))
    throw new Error('Browser inventory is missing.');
  for (const [job, entries] of Object.entries(plan.selection.browser))
    browserEntries(entries, job);
  if (
    plan.mode === 'docs-only' &&
    (plan.selection.typecheck ||
      Object.keys(TARGETS).some((key) => plan.selection[key].length) ||
      Object.values(plan.selection.browser).some((entries) => entries.length))
  )
    throw new Error('Documentation-only plan cannot select executable tests.');
  return plan;
}
export function parseSelectionPlan(raw) {
  if (
    typeof raw !== 'string' ||
    !raw ||
    new TextEncoder().encode(raw).byteLength > MAX_PLAN_BYTES
  )
    throw new Error('CI_IMPACT_PLAN is missing or oversized.');
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch {
    throw new Error('CI_IMPACT_PLAN is not valid JSON.');
  }
  return validateSelectionPlan(plan);
}
const command = (args, files) => ({ command: 'node', args, files });
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function groupedBrowser(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const group = grouped.get(entry.file) ?? {
      all: false,
      patterns: new Set(),
    };
    if (entry.grep === undefined) group.all = true;
    else group.patterns.add(entry.grep);
    grouped.set(entry.file, group);
  }
  return [...grouped]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([file, group]) => {
      if (group.all) return [{ file }];
      const patterns = [...group.patterns].sort();
      // Backreferences can change meaning when capture groups are unioned. Keep
      // those expressions separate; also reject a union with duplicate group names.
      if (
        patterns.length > 1 &&
        patterns.every(
          (pattern) =>
            !/\\(?:[1-9]|k<)/.test(pattern) && !/^\/.*\/[a-z]*$/i.test(pattern),
        )
      ) {
        const grep = patterns.map((pattern) => `(?:${pattern})`).join('|');
        try {
          new RegExp(grep);
          return [{ file, grep }];
        } catch {
          /* Preserve original expressions separately. */
        }
      }
      return patterns.map((grep) => ({ file, grep }));
    });
}
// Pure builder. Inventories are passed as values, not read from the filesystem.
// Vitest's installed CLI uses substring filters, so known unselected collisions
// must be excluded explicitly (e.g. a.test.ts must not run a.test.tsx).
export function buildSelectedCommands(
  plan,
  mode,
  {
    browserJob,
    availableUnitFiles,
    existingChangedPaths = plan?.changedPaths,
  } = {},
) {
  validateSelectionPlan(plan);
  if (!MODES.includes(mode) || (mode !== 'browser' && browserJob !== undefined))
    throw new Error('Invalid selected-run mode or arguments.');
  const selected = plan.selection;
  if (mode === 'lint') {
    if (plan.mode === 'docs-only') return [];
    paths(existingChangedPaths);
    if (existingChangedPaths.some((path) => !plan.changedPaths.includes(path)))
      throw new Error('Lint paths must be changed paths.');
    const eslint = existingChangedPaths.filter((path) =>
      ESLINT_EXTENSIONS.test(path),
    );
    const prettier = existingChangedPaths.filter((path) =>
      PRETTIER_EXTENSIONS.test(path),
    );
    return [
      ...(eslint.length
        ? [
            command(
              [
                'node_modules/eslint/bin/eslint.js',
                '--max-warnings=0',
                '--no-warn-ignored',
                '--',
                ...eslint,
              ],
              eslint,
            ),
          ]
        : []),
      ...(prettier.length
        ? [
            command(
              [
                'node_modules/prettier/bin/prettier.cjs',
                '--check',
                '--ignore-unknown',
                '--',
                ...prettier,
              ],
              prettier,
            ),
          ]
        : []),
    ];
  }
  if (mode === 'unit') {
    if (!selected.unit.length) return [];
    if (!Array.isArray(availableUnitFiles))
      throw new Error('Exact unit inventory is required.');
    paths(availableUnitFiles, 'unit');
    if (selected.unit.some((path) => !availableUnitFiles.includes(path)))
      throw new Error('Selected unit target is absent from the inventory.');
    const collisions = availableUnitFiles.filter(
      (path) =>
        !selected.unit.includes(path) &&
        selected.unit.some((selectedPath) =>
          path.toLowerCase().includes(selectedPath.toLowerCase()),
        ),
    );
    return [
      command(
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          '--passWithNoTests=false',
          '--allowOnly=false',
          ...collisions.flatMap((path) => ['--exclude', path]),
          // Vitest CAC puts post-`--` args in a separate option, not filters.
          // Our exact file allowlist already rules out option-like inputs.
          ...selected.unit,
        ],
        selected.unit,
      ),
    ];
  }
  if (mode === 'fixtures')
    return selected.fixtures.length
      ? [command(['--test', ...selected.fixtures], selected.fixtures)]
      : [];
  // Official CLI usage: supabase test db [path] ... [flags]. Never omit paths:
  // https://supabase.com/docs/reference/cli/supabase-test-db
  if (mode === 'sql')
    return selected.sql.length
      ? [
          command(
            [
              'node_modules/supabase/dist/supabase.js',
              'test',
              'db',
              '--local',
              ...selected.sql,
            ],
            selected.sql,
          ),
        ]
      : [];
  if (mode === 'races' || mode === 'upgrades')
    return selected[mode].map((path) => command([path], [path]));
  if (!Object.hasOwn(selected.browser, browserJob ?? ''))
    throw new Error('Requested browser job is absent from the plan.');
  const config = BROWSER_CONFIGS[browserJob][0];
  return groupedBrowser(selected.browser[browserJob]).map(({ file, grep }) =>
    command(
      [
        'node_modules/@playwright/test/cli.js',
        'test',
        '--config',
        config,
        '--forbid-only',
        ...(grep === undefined ? [] : ['--grep', grep]),
        '--',
        `(?:^|/)${escaped(file)}$`,
      ],
      [config, file],
    ),
  );
}

// No shell and no plan-provided executable. Injection is only for unit tests;
// production uses the pinned local executable entrypoints above.
export function executeSelectedCommands(
  commands,
  spawn,
  { cwd, nodeExecutable = 'node', log = () => undefined } = {},
) {
  if (!commands.length) {
    log('not selected');
    return 0;
  }
  for (const item of commands) {
    log(`selected: ${JSON.stringify(item.args)}`);
    const result = spawn(nodeExecutable, item.args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });
    if (result.error || result.signal || result.status !== 0)
      return Number.isInteger(result.status) && result.status > 0
        ? result.status
        : 1;
  }
  return 0;
}

export async function runSelected({
  rawPlan,
  args,
  cwd = process.cwd(),
  log = console.log,
}) {
  const plan = parseSelectionPlan(rawPlan);
  if (
    !Array.isArray(args) ||
    args.length < 1 ||
    args.length > 2 ||
    (args[0] === 'browser' ? args.length !== 2 : args.length !== 1)
  )
    throw new Error(
      'Usage: ci-run-selected.mjs <lint|unit|fixtures|sql|races|upgrades|browser JOB>.',
    );
  const [{ lstatSync, readdirSync, realpathSync }, { resolve, relative, sep }] =
    await Promise.all([import('node:fs'), import('node:path')]);
  const root = realpathSync(cwd);
  function regularFile(path, optional = false) {
    const absolute = resolve(root, path);
    let status;
    try {
      status = lstatSync(absolute);
    } catch (error) {
      if (optional && error?.code === 'ENOENT') return false;
      throw new Error(`Selected target is missing: ${path}`);
    }
    if (
      !status.isFile() ||
      status.isSymbolicLink() ||
      realpathSync(absolute) !== absolute
    )
      throw new Error(
        `Selected target must be a regular in-repository file: ${path}`,
      );
    const fromRoot = relative(root, absolute);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..')
      throw new Error('Selected target escapes repository.');
    return true;
  }
  // Preflight the whole plan before any subprocess, not one target at a time.
  for (const category of Object.keys(TARGETS))
    for (const path of plan.selection[category]) regularFile(path);
  for (const [job, entries] of Object.entries(plan.selection.browser))
    if (entries.length) {
      regularFile(BROWSER_CONFIGS[job][0]);
      for (const entry of entries) regularFile(entry.file);
    }
  const existingChangedPaths = plan.changedPaths.filter((path) =>
    regularFile(path, true),
  );
  const availableUnitFiles = [];
  if (args[0] === 'unit' && plan.selection.unit.length) {
    const visit = (directory) => {
      for (const entry of readdirSync(resolve(root, directory), {
        withFileTypes: true,
      })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isSymbolicLink())
          throw new Error(`Unit inventory contains a symbolic link: ${path}`);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && /\.test\.tsx?$/.test(path)) {
          if (!TARGETS.unit.test(path))
            throw new Error(
              `Unit inventory contains an unsupported test path: ${path}`,
            );
          availableUnitFiles.push(path);
        }
      }
    };
    visit('tests/unit');
  }
  const commands = buildSelectedCommands(plan, args[0], {
    ...(args[1] ? { browserJob: args[1] } : {}),
    availableUnitFiles,
    existingChangedPaths,
  });
  for (const item of commands)
    if (item.args[0].startsWith('node_modules/')) regularFile(item.args[0]);
  const { spawnSync } = await import('node:child_process');
  return executeSelectedCommands(commands, spawnSync, {
    cwd: root,
    nodeExecutable: process.execPath,
    log,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = await runSelected({
      rawPlan: process.env.CI_IMPACT_PLAN,
      args: process.argv.slice(2),
    });
  } catch (error) {
    console.error(
      `Selected CI failed: ${error instanceof Error ? error.message : 'invalid selection'}`,
    );
    process.exitCode = 1;
  }
}
