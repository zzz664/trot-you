import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_CONFIGS,
  buildSelectedCommands,
  executeSelectedCommands,
  parseSelectionPlan,
  runSelected,
  validateSelectionPlan,
  validateBrowserInventory,
  selectBrowserInventory,
  assertBrowserInventory,
  prepareBrowserCommands,
} from './ci-run-selected.mjs';

const unit = 'tests/unit/analytics-funnel-client.test.ts';
const fixture = 'scripts/ci-run-selected.test.mjs';
const sql = 'supabase/tests/analytics_funnel.test.sql';
const race = 'scripts/test-analytics-funnel-concurrency.mjs';
const upgrade = 'scripts/test-analytics-funnel-upgrade.mjs';
const browser = 'tests/e2e/analytics-funnel/analytics-funnel.spec.ts';
function plan(overrides = {}) {
  return {
    version: 2,
    mode: 'scoped',
    changedPaths: ['scripts/ci-run-selected.mjs'],
    provenance: { arbitraryEvidenceIsNotExecuted: true },
    selection: {
      unit: [],
      fixtures: [],
      sql: [],
      races: [],
      upgrades: [],
      typecheck: true,
      browser: { quality: [], 'analytics-funnel-browser': [] },
    },
    ...overrides,
  };
}
function selected(selection, overrides = {}) {
  const base = plan(overrides);
  return { ...base, selection: { ...base.selection, ...selection } };
}
function command(value, mode, options) {
  const commands = buildSelectedCommands(value, mode, options);
  assert.equal(commands.length, 1);
  return commands[0];
}
function temp() {
  const root = mkdtempSync(join(tmpdir(), 'ci-selected-test-'));
  return {
    root,
    dispose: () => rmSync(root, { recursive: true, force: true }),
    file(path, text = '') {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    },
  };
}

test('import exports a pure builder with no static command runner or default suite', () => {
  const source = readFileSync(
    new URL('./ci-run-selected.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /^import .*['"]node:child_process['"]/m);
  assert.doesNotMatch(source, /execSync|execFileSync|shell:\s*true|eval\(/);
  assert.equal(typeof buildSelectedCommands, 'function');
});
test('accepts exact v2 evidence without executing or reinterpreting metadata', () => {
  const value = plan();
  assert.equal(validateSelectionPlan(value), value);
  assert.deepEqual(parseSelectionPlan(JSON.stringify(value)), value);
});
for (const raw of [
  undefined,
  null,
  '',
  'null',
  '{',
  JSON.stringify({ version: 1 }),
  ' '.repeat(1024 * 1024 + 1),
])
  test(`missing/invalid plan fails closed (${String(raw).slice(0, 12)})`, () =>
    assert.throws(() => parseSelectionPlan(raw)));
for (const value of [
  plan({ mode: 'full' }),
  plan({ mode: 'selective' }),
  plan({ version: 1 }),
  plan({ changedPaths: null }),
  plan({ changedPaths: ['b', 'a'] }),
  plan({ changedPaths: ['a', 'a'] }),
  plan({ selection: {} }),
  plan({ selection: null }),
  selected({ typecheck: 'true' }),
  selected({ typecheck: undefined }),
  selected({ extra: [] }),
  selected({ browser: null }),
  selected({ browser: { unknown: [] } }),
])
  test(`invalid schema/evidence ${JSON.stringify(value).slice(0, 80)}`, () =>
    assert.throws(() => validateSelectionPlan(value)));
for (const path of [
  '/tmp/a',
  '../a',
  'a/../b',
  './a',
  '-flag',
  'C:/a',
  'a\\b',
  'a\0b',
  'a\nb',
  'a//b',
  'a/',
  '.',
])
  test(`unsafe changed path rejected ${JSON.stringify(path)}`, () =>
    assert.throws(() => validateSelectionPlan(plan({ changedPaths: [path] }))));
for (const mode of ['unit', 'fixtures', 'sql', 'races', 'upgrades', 'lint'])
  test(`explicit empty ${mode} selects nothing`, () =>
    assert.deepEqual(
      buildSelectedCommands(plan({ changedPaths: [] }), mode),
      [],
    ));
test('explicit empty browser job differs from missing job', () => {
  assert.deepEqual(
    buildSelectedCommands(plan(), 'browser', { browserJob: 'quality' }),
    [],
  );
  assert.throws(
    () =>
      buildSelectedCommands(plan(), 'browser', { browserJob: 'media-browser' }),
    /absent/,
  );
  assert.throws(() => buildSelectedCommands(plan(), 'browser'), /absent/);
});
for (const mode of [undefined, 'all', 'check:all', 'full', 'typecheck'])
  test(`unknown mode ${mode} cannot broaden tests`, () =>
    assert.throws(() => buildSelectedCommands(plan(), mode)));
test('non-browser mode rejects extra job argument', () =>
  assert.throws(() =>
    buildSelectedCommands(plan(), 'unit', { browserJob: 'quality' }),
  ));
for (const category of ['unit', 'fixtures', 'sql', 'races', 'upgrades']) {
  for (const value of [
    null,
    ['--help'],
    ['tests/unit'],
    ['scripts/test-analytics-funnel-concurrency.mjs;echo bad'],
    ['../tests/foo.test.ts'],
  ])
    test(`${category} rejects non-file/nonallowlisted target ${JSON.stringify(value)}`, () =>
      assert.throws(() =>
        validateSelectionPlan(selected({ [category]: value })),
      ));
}
test('a valid target category does not authorize another category', () => {
  for (const [category, path] of [
    ['unit', fixture],
    ['fixtures', unit],
    ['sql', race],
    ['races', upgrade],
    ['upgrades', race],
  ])
    assert.throws(() =>
      validateSelectionPlan(selected({ [category]: [path] })),
    );
});
test('unit command uses pinned local CLI and exact explicit selected files', () => {
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [unit, 'tests/unit/old.test.ts'],
  });
  assert.equal(built.command, 'node');
  assert.deepEqual(built.files, [unit]);
  assert.deepEqual(built.args, [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--passWithNoTests=false',
    '--allowOnly=false',
    unit,
  ]);
});
test('unit inventory is required and must contain selected targets', () => {
  assert.throws(
    () => buildSelectedCommands(selected({ unit: [unit] }), 'unit'),
    /inventory/,
  );
  assert.throws(
    () =>
      buildSelectedCommands(selected({ unit: [unit] }), 'unit', {
        availableUnitFiles: [],
      }),
    /absent/,
  );
});
test('Vitest substring collisions cannot expand selected file scope', () => {
  const collision = `${unit}x`;
  const nestedCollision = `${unit}.extra.test.ts`;
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [
      unit,
      collision,
      nestedCollision,
      'tests/unit/old.test.ts',
    ],
  });
  assert.deepEqual(built.args, [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--passWithNoTests=false',
    '--allowOnly=false',
    '--exclude',
    collision,
    '--exclude',
    nestedCollision,
    unit,
  ]);
});
test('case-insensitive Vitest filter collisions are excluded without excluding an explicitly selected sibling', () => {
  const upper = unit
    .toUpperCase()
    .replace('TESTS/UNIT/', 'tests/unit/')
    .replace('.TEST.TS', '.test.ts');
  const collision = `${unit}x`;
  const built = command(selected({ unit: [unit, collision] }), 'unit', {
    availableUnitFiles: [unit, upper, collision],
  });
  assert.ok(built.args.includes(upper));
  assert.equal(built.args.filter((arg) => arg === '--exclude').length, 1);
  assert.deepEqual(built.files, [unit, collision]);
});
test('fixture command names exact files and never node test discovery', () =>
  assert.deepEqual(
    command(selected({ fixtures: [fixture] }), 'fixtures').args,
    ['--test', fixture],
  ));
test('SQL command always includes local and exact paths, never linked or remote URL', () => {
  const built = command(selected({ sql: [sql] }), 'sql');
  assert.deepEqual(built.args, [
    'node_modules/supabase/dist/supabase.js',
    'test',
    'db',
    '--local',
    sql,
  ]);
  assert.doesNotMatch(built.args.join(' '), /--linked|--db-url/);
});
for (const [mode, path] of [
  ['races', race],
  ['upgrades', upgrade],
])
  test(`${mode} executes only named scripts individually`, () =>
    assert.deepEqual(command(selected({ [mode]: [path] }), mode).args, [path]));
for (const [job, [config, directory]] of Object.entries(BROWSER_CONFIGS))
  test(`browser ${job} uses exact config and exact file regex`, () => {
    const file = `tests/e2e/${directory ? `${directory}/` : ''}scoped.spec.ts`;
    const built = command(
      selected({ browser: { [job]: [{ file }] } }),
      'browser',
      { browserJob: job },
    );
    assert.deepEqual(built.files, [config, file]);
    assert.ok(built.args.includes(config));
    const filter = new RegExp(built.args.at(-1));
    assert.ok(filter.test(`/repo/${file}`));
    assert.ok(filter.test(file));
    assert.ok(!filter.test(`/repo/${file}x`));
    assert.ok(!filter.test(`/repo/other/scoped.spec.ts`));
    assert.ok(built.args.includes('--forbid-only'));
    assert.ok(!built.args.includes('--'));
  });
for (const entry of [
  {},
  { file: browser, arbitrary: true },
  { file: '--help' },
  { file: 'tests/e2e/authenticated/auth.spec.ts' },
  { file: 'tests/e2e/analytics-funnel/fixtures.ts' },
  { file: browser, grep: '' },
  { file: browser, grep: ' ' },
  { file: browser, grep: '[' },
  { file: browser, grep: 'a\nb' },
  { file: browser, grep: null },
  { file: browser, grep: 'x'.repeat(4097) },
])
  test(`invalid browser/case entry ${JSON.stringify(entry).slice(0, 100)}`, () =>
    assert.throws(() =>
      validateSelectionPlan(
        selected({ browser: { 'analytics-funnel-browser': [entry] } }),
      ),
    ));
test('quality cannot invoke private feature suite through default config', () =>
  assert.throws(() =>
    validateSelectionPlan(
      selected({ browser: { quality: [{ file: browser }] } }),
    ),
  ));
test('safe same-file case expressions union in one invocation without changing matching cases', () => {
  const built = command(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '^first exact$' },
          { file: browser, grep: '^second exact$' },
          { file: browser, grep: '^first exact$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  const grep = built.args[built.args.indexOf('--grep') + 1];
  const expression = new RegExp(grep);
  assert.ok(expression.test('first exact'));
  assert.ok(expression.test('second exact'));
  assert.ok(!expression.test('unselected'));
  assert.ok(!expression.test('first exact suffix'));
});
test('grep is never combined across files and cannot become shell syntax', () => {
  const other = 'tests/e2e/analytics-funnel/other.spec.ts';
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: 'exact;$(do-not-run)' },
          { file: other, grep: '^different$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
  assert.ok(built[0].args.includes('exact;$(do-not-run)'));
  assert.ok(!built[0].args.includes('^different$'));
});
test('backreference expressions remain separate to preserve numeric capture meaning', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '^(a)\\1$' },
          { file: browser, grep: '^(b)\\1$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
});
test('duplicate named captures never produce an invalid combined regex', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '(?<same>a)' },
          { file: browser, grep: '(?<same>b)' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  for (const item of built)
    assert.doesNotThrow(
      () => new RegExp(item.args[item.args.indexOf('--grep') + 1]),
    );
});
test('explicit full-file selection subsumes same-file named cases only', () => {
  const built = command(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser },
          { file: browser, grep: '^first$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.ok(!built.args.includes('--grep'));
});
test('lint only names changed existing files and honors tool ignore configuration', () => {
  const changedPaths = [
    'README.md',
    'docs/removed.md',
    'public/image.png',
    'scripts/new.mjs',
    'src/app/[slug]/page.tsx',
    'src/messages/ko.json',
    'supabase/migrations/new.sql',
  ];
  const built = buildSelectedCommands(plan({ changedPaths }), 'lint', {
    existingChangedPaths: changedPaths.filter(
      (path) => path !== 'docs/removed.md',
    ),
  });
  assert.equal(built.length, 2);
  assert.deepEqual(built[0].files, [
    'scripts/new.mjs',
    'src/app/[slug]/page.tsx',
  ]);
  assert.ok(built[0].args.includes('--no-warn-ignored'));
  assert.ok(built[1].args.includes('--ignore-unknown'));
  assert.ok(!built[1].files.includes('public/image.png'));
  assert.ok(!built[1].files.includes('docs/removed.md'));
  assert.ok(built[1].files.includes('supabase/migrations/new.sql'));
});
test('lint refuses unselected existing file injection', () =>
  assert.throws(() =>
    buildSelectedCommands(plan(), 'lint', {
      existingChangedPaths: ['old.mjs'],
    }),
  ));
test('documentation-only stays dependency-free and cannot silently select tests or typecheck', () => {
  const docs = selected(
    { typecheck: false },
    { mode: 'docs-only', changedPaths: ['docs/ci.md'] },
  );
  for (const mode of ['lint', 'unit', 'fixtures', 'sql', 'races', 'upgrades'])
    assert.deepEqual(buildSelectedCommands(docs, mode), []);
  assert.throws(() =>
    validateSelectionPlan(
      selected(
        { fixtures: [fixture], typecheck: false },
        { mode: 'docs-only' },
      ),
    ),
  );
  assert.throws(() => validateSelectionPlan(plan({ mode: 'docs-only' })));
});
test('empty executor reports not selected without calling spawn', () => {
  const lines = [];
  assert.equal(
    executeSelectedCommands([], () => assert.fail('must not spawn'), {
      log: (value) => lines.push(value),
    }),
    0,
  );
  assert.deepEqual(lines, ['not selected']);
});
test('executor uses argument arrays without shell and stops at first selected failure', () => {
  const commands = [
    { command: 'node', args: [race], files: [race] },
    { command: 'node', args: [upgrade], files: [upgrade] },
  ];
  const calls = [];
  const result = executeSelectedCommands(
    commands,
    (...args) => {
      calls.push(args);
      return { status: 7 };
    },
    { cwd: '/repo', nodeExecutable: '/runtime/node' },
  );
  assert.equal(result, 7);
  assert.deepEqual(calls, [
    ['/runtime/node', [race], { cwd: '/repo', stdio: 'inherit', shell: false }],
  ]);
});
for (const result of [
  { status: null, signal: 'SIGTERM' },
  { status: null, error: new Error('missing') },
  { status: -1 },
  {},
])
  test(`uncertain/failed command returns nonzero ${JSON.stringify(result)}`, () =>
    assert.equal(
      executeSelectedCommands([{ args: [race] }], () => result),
      1,
    ));
test('successful commands run exactly once in selection order', () => {
  const commands = [race, upgrade].map((path) => ({ args: [path] }));
  const calls = [];
  assert.equal(
    executeSelectedCommands(commands, (_, args) => {
      calls.push(args);
      return { status: 0 };
    }),
    0,
  );
  assert.deepEqual(calls, [[race], [upgrade]]);
});
test('runtime rejects missing selected files before importing/executing command runner', async () => {
  const directory = temp();
  try {
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /missing/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime rejects directories and symlinks as selected executable files', async () => {
  const directory = temp();
  try {
    mkdirSync(join(directory.root, fixture), { recursive: true });
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /regular/,
    );
    rmSync(join(directory.root, fixture), { recursive: true });
    directory.file('outside.mjs');
    symlinkSync(
      join(directory.root, 'outside.mjs'),
      join(directory.root, fixture),
    );
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /regular/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime checks the complete plan before executing an otherwise valid requested mode', async () => {
  const directory = temp();
  try {
    directory.file(fixture);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture], sql: [sql] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /missing/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime checks browser config before any selected invocation', async () => {
  const directory = temp();
  try {
    directory.file(browser);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(
          selected({
            browser: { 'analytics-funnel-browser': [{ file: browser }] },
          }),
        ),
        args: ['browser', 'analytics-funnel-browser'],
        cwd: directory.root,
      }),
      /playwright.analytics-funnel.config.ts/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime treats explicit no-op including deleted changed docs as success without node_modules', async () => {
  const directory = temp();
  const lines = [];
  try {
    const docs = selected(
      { typecheck: false },
      { mode: 'docs-only', changedPaths: ['docs/deleted.md'] },
    );
    assert.equal(
      await runSelected({
        rawPlan: JSON.stringify(docs),
        args: ['lint'],
        cwd: directory.root,
        log: (value) => lines.push(value),
      }),
      0,
    );
    assert.deepEqual(lines, ['not selected']);
  } finally {
    directory.dispose();
  }
});
for (const args of [
  [],
  ['unit', 'quality'],
  ['browser'],
  ['browser', 'quality', 'extra'],
])
  test(`runtime rejects ambiguous CLI arguments ${JSON.stringify(args)}`, async () =>
    assert.rejects(
      runSelected({ rawPlan: JSON.stringify(plan()), args }),
      /Usage/,
    ));

test('installed Vitest pure argument parser receives exact filters, not post-separator extras', async () => {
  const { parseCLI } = await import('vitest/node');
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [unit, `${unit}x`],
  });
  const parsed = parseCLI(['vitest', ...built.args.slice(1)]);
  assert.deepEqual(parsed.filter, [unit]);
  assert.deepEqual(parsed.options.exclude, [`${unit}x`]);
  assert.equal(parsed.options.passWithNoTests, false);
  assert.equal(parsed.options.allowOnly, false);
});

test('slash-delimited Playwright grep expressions retain independent flags and semantics', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '/first/i' },
          { file: browser, grep: '/second/i' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
  assert.ok(built[0].args.includes('/first/i'));
  assert.ok(built[1].args.includes('/second/i'));
});
test('runtime fails closed on unsupported unit inventory names rather than missing a filter collision', async () => {
  const directory = temp();
  try {
    directory.file(unit);
    directory.file(`${unit} unexpected.test.ts`);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ unit: [unit] })),
        args: ['unit'],
        cwd: directory.root,
      }),
      /unsupported test path/,
    );
  } finally {
    directory.dispose();
  }
});

test('settlement-reports selection cannot execute an analytics or other historical browser file', () => {
  assert.deepEqual(BROWSER_CONFIGS['settlement-reports-browser'], [
    'playwright.settlement-reports.config.ts',
    'settlement-reports',
  ]);
  assert.throws(() =>
    buildSelectedCommands(
      selected({
        browser: { 'settlement-reports-browser': [{ file: browser }] },
      }),
      'browser',
      { browserJob: 'settlement-reports-browser' },
    ),
  );
});

const scopedBrowserFile = 'tests/e2e/scoped.spec.ts';
function inventoryRow(overrides = {}) {
  return {
    id: 'selected-id',
    file: `/repo/${scopedBrowserFile}`,
    titlePath: ['', '', 'scoped.spec.ts', 'chosen'],
    grepTitle: ' scoped.spec.ts chosen',
    ...overrides,
  };
}
const inventory = (tests = [inventoryRow()]) => ({ version: 1, tests });
const checkedInventory = (value = inventory()) =>
  validateBrowserInventory(value, { file: scopedBrowserFile, root: '/repo' });

test('browser inventory requires exact file and nonempty unique stable identities/full titles', () => {
  assert.deepEqual(checkedInventory(), inventory());
  for (const value of [
    null,
    {},
    { version: 1, tests: [] },
    inventory([inventoryRow(), inventoryRow()]),
    inventory([inventoryRow({ file: '/repo/tests/e2e/old.spec.ts' })]),
    inventory([
      inventoryRow({ file: '/repo/tests/e2e/../e2e/scoped.spec.ts' }),
    ]),
    inventory([inventoryRow({ id: '' })]),
    inventory([inventoryRow({ id: 'bad\nid' })]),
    inventory([inventoryRow({ titlePath: [] })]),
    inventory([inventoryRow({ titlePath: ['', 'file', null] })]),
    inventory([inventoryRow({ grepTitle: '' })]),
    inventory([inventoryRow({ unknown: true })]),
  ])
    assert.throws(() => checkedInventory(value));
});
test('browser inventory comparison rejects extra, missing or changed IDs/files/titles, not merely counts', () => {
  const expected = checkedInventory();
  assert.doesNotThrow(() =>
    assertBrowserInventory(checkedInventory(), expected),
  );
  for (const actual of [
    inventory([]),
    inventory([inventoryRow(), inventoryRow({ id: 'extra' })]),
    inventory([inventoryRow({ id: 'different' })]),
    inventory([
      inventoryRow({ titlePath: ['', '', 'scoped.spec.ts', 'other'] }),
    ]),
    inventory([inventoryRow({ file: '/repo/tests/e2e/old.spec.ts' })]),
  ])
    assert.throws(() => assertBrowserInventory(actual, expected), /differs/);
});
test('independent browser title selection uses installed slash flags and resets global regex state', () => {
  const all = checkedInventory(
    inventory([
      inventoryRow(),
      inventoryRow({
        id: 'second',
        titlePath: ['', '', 'scoped.spec.ts', 'CHOSEN'],
        grepTitle: ' scoped.spec.ts CHOSEN',
      }),
      inventoryRow({
        id: 'third',
        titlePath: ['', '', 'scoped.spec.ts', 'old'],
        grepTitle: ' scoped.spec.ts old',
      }),
    ]),
  );
  assert.equal(selectBrowserInventory(all, 'chosen$').tests.length, 2);
  assert.equal(selectBrowserInventory(all, '/chosen$/g').tests.length, 1);
  assert.equal(selectBrowserInventory(all, '/chosen$/gi').tests.length, 2);
  assert.throws(() => selectBrowserInventory(all, '^absent$'), /absent/);
});
test('raw browser builder output cannot bypass mandatory collection preflight', () => {
  const built = buildSelectedCommands(
    selected({ browser: { quality: [{ file: scopedBrowserFile }] } }),
    'browser',
    { browserJob: 'quality' },
  );
  assert.throws(
    () =>
      executeSelectedCommands(built, () => assert.fail('No runtime may start')),
    /verified collection/,
  );
});
test('installed Playwright strips post-separator filters; generated filters are never post-separator', () => {
  const source = readFileSync(
    new URL('../node_modules/playwright/lib/program.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /const dashDashIndex = process\.argv\.indexOf\("--"\)/);
  assert.match(
    source,
    /const testFilters = args\.slice\(0, args\.length - postDashCount\)/,
  );
  const built = command(
    selected({ browser: { quality: [{ file: scopedBrowserFile }] } }),
    'browser',
    { browserJob: 'quality' },
  );
  assert.ok(!built.args.includes('--'));
});
test('installed report-begin is before the task that starts tests, and callback errors are swallowed', () => {
  const source = readFileSync(
    new URL('../node_modules/playwright/lib/runner/index.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /function createRunTestsTasks\(config2\) \{\s*return \[\s*createPhasesTask\(\),\s*createReportBeginTask\(\),\s*createRunTestsTask\(\)/,
  );
  assert.match(source, /this\._wrap\(\(\) => reporter\.onBegin\?\.\(suite\)\)/);
  // List mode excludes global/web-server setup and all test-run tasks.
  assert.match(
    source,
    /const tasks = options\.listMode \? \[\s*createLoadTask\("in-process", \{ failOnLoadErrors: true, filterOnly: false \}\),\s*createReportBeginTask\(\)\s*\] :/,
  );
});

function browserDiscoveryFixture() {
  const directory = temp();
  const cli = new URL(
    '../node_modules/@playwright/test/cli.js',
    import.meta.url,
  );
  const testModule = new URL(
    '../node_modules/@playwright/test/index.js',
    import.meta.url,
  );
  directory.file(
    'scripts/ci-run-selected.mjs',
    readFileSync(new URL('./ci-run-selected.mjs', import.meta.url), 'utf8'),
  );
  directory.file(
    'node_modules/@playwright/test/cli.js',
    `import ${JSON.stringify(cli.href)};`,
  );
  directory.file(
    'playwright.config.ts',
    `export default { testDir:'./tests/e2e', retries:2, reporter:[['list']], webServer:{command:'THIS_MUST_NEVER_RUN',url:'http://127.0.0.1:1'}, projects:[{name:'one',retries:3},{name:'two'}] };`,
  );
  directory.file(
    scopedBrowserFile,
    `import { test } from ${JSON.stringify(testModule.pathname)};
    test('chosen',()=>{ throw new Error('Test body must never execute during discovery'); });
    test('CHOSEN sibling',()=>{ throw new Error('Test body must never execute during discovery'); });
    test('not selected',()=>{ throw new Error('Unselected test body must never execute'); });`,
  );
  directory.file(
    'tests/e2e/historical.spec.ts',
    `throw new Error('Unselected historical test file must never even be imported.');`,
  );
  return directory;
}
async function discoveryOnly(directory, grep = '(?:^| )chosen$', extra = {}) {
  const { spawnSync } = await import('node:child_process');
  const built = buildSelectedCommands(
    selected({ browser: { quality: [{ file: scopedBrowserFile, grep }] } }),
    'browser',
    { browserJob: 'quality' },
  );
  const calls = [];
  const prepared = await prepareBrowserCommands(built, {
    cwd: directory.root,
    spawn: (command, args, options) => {
      assert.ok(
        args.includes('--list'),
        'Only collection, never runtime or test bodies',
      );
      calls.push(args);
      const result = spawnSync(command, args, options);
      if (result.status !== 0)
        process.stderr.write(String(result.stdout) + String(result.stderr));
      return result;
    },
    ...extra,
  });
  return { prepared, calls };
}
test('installed Playwright real discovery loads only one literal file and verifies exact named cases across projects', async () => {
  const directory = browserDiscoveryFixture();
  try {
    const lines = [];
    const { prepared, calls } = await discoveryOnly(
      directory,
      '(?:^| )chosen$',
      { log: (line) => lines.push(line) },
    );
    try {
      assert.equal(calls.length, 2);
      assert.ok(calls.every((args) => !args.includes('--')));
      assert.equal(prepared.commands.length, 1);
      const item = prepared.commands[0];
      assert.equal(item.browserAudit, true);
      const evidence = JSON.parse(
        lines[0].slice('browser-preflight-inventory: '.length),
      );
      assert.equal(evidence.count, 2);
      assert.match(evidence.digest, /^[a-f0-9]{64}$/);
      assert.ok(
        evidence.tests.every(
          (row) => row.file === join(directory.root, scopedBrowserFile),
        ),
      );
      assert.deepEqual(
        evidence.tests.map((row) => row.titlePath.at(-1)),
        ['chosen', 'chosen'],
      );
      const config = readFileSync(
        item.args[item.args.indexOf('--config') + 1],
        'utf8',
      );
      assert.match(config, /testMatch: \[exactFile\]/);
      assert.match(config, /retries: 0/);
      assert.match(config, /source\.projects\.map\(restrict\)/);
      assert.match(config, /grep: exactGrep, grepInvert: \[\]/);
      assert.match(config, /guard\.mjs/);
    } finally {
      prepared.dispose();
    }
    assert.ok(
      !readFileSync(
        join(directory.root, 'playwright.config.ts'),
        'utf8',
      ).includes('guard.mjs'),
    );
  } finally {
    directory.dispose();
  }
});
test('real discovery rejects missing named cases without importing a historical test or starting web server', async () => {
  const directory = browserDiscoveryFixture();
  try {
    await assert.rejects(discoveryOnly(directory, '^absent$'), /absent/);
  } finally {
    directory.dispose();
  }
});
test('each browser invocation is preflighted before any runtime, and an extra actual case aborts the whole selection', async () => {
  const directory = browserDiscoveryFixture();
  const { spawnSync } = await import('node:child_process');
  let calls = 0;
  try {
    const built = buildSelectedCommands(
      selected({
        browser: {
          quality: [{ file: scopedBrowserFile, grep: '(?:^| )chosen$' }],
        },
      }),
      'browser',
      { browserJob: 'quality' },
    );
    await assert.rejects(
      prepareBrowserCommands(built, {
        cwd: directory.root,
        spawn: (command, args, options) => {
          assert.ok(args.includes('--list'));
          calls++;
          // Simulate a CLI regression ignoring --grep. The exact-file wrapper still
          // prevents historical imports; the ID/title set gate rejects extra cases.
          const actual = [...args];
          if (calls === 2) actual.splice(actual.indexOf('--grep'), 2);
          return spawnSync(command, actual, options);
        },
      }),
      /differs/,
    );
    assert.equal(calls, 2);
  } finally {
    directory.dispose();
  }
});

test('lost runtime CLI file and grep filters still collect only exact pinned IDs and emit the runtime inventory', async () => {
  const directory = browserDiscoveryFixture();
  const { spawnSync } = await import('node:child_process');
  let prepared;
  try {
    ({ prepared } = await discoveryOnly(directory));
    const item = prepared.commands[0];
    const args = [...item.args];
    args.pop(); // Simulate losing the CLI file regex.
    args.splice(args.indexOf('--grep'), 2); // Simulate losing named-case selection.
    args.push('--list'); // Never execute a test body or start a web server.
    const result = spawnSync(process.execPath, args, {
      cwd: directory.root,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const line = result.stdout
      .split('\n')
      .find((line) => line.startsWith('browser-runtime-inventory: '));
    assert.ok(line, 'Actual onBegin inventory must be observable.');
    const actual = JSON.parse(line.slice('browser-runtime-inventory: '.length));
    assert.equal(actual.count, 2);
    assert.match(actual.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      actual.tests.map((row) => row.titlePath.at(-1)),
      ['chosen', 'chosen'],
    );
    assert.ok(
      actual.tests.every(
        (row) => row.file === join(directory.root, scopedBrowserFile),
      ),
    );
    assert.ok(!result.stdout.includes('CHOSEN sibling'));
    assert.ok(!result.stdout.includes('not selected'));
  } finally {
    prepared?.dispose();
    directory.dispose();
  }
});
test('runtime onBegin hard-exits before continuation for extra, missing, changed or foreign tests', async () => {
  const directory = browserDiscoveryFixture();
  const { spawnSync } = await import('node:child_process');
  let prepared;
  try {
    ({ prepared } = await discoveryOnly(directory));
    const source = readFileSync(
      prepared.commands[0].args[
        prepared.commands[0].args.indexOf('--config') + 1
      ],
      'utf8',
    );
    const reporter = source.match(/"([^"]+guard[.]mjs)"/)[1];
    const expectedPath = source.match(/"expected":\s*"([^"]+)"/)[1];
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
    const cases = [
      [],
      expected.tests.slice(1),
      [...expected.tests, { ...expected.tests[0], id: 'extra-id' }],
      expected.tests.map((row, index) =>
        index ? row : { ...row, id: 'changed-id' },
      ),
      expected.tests.map((row, index) =>
        index
          ? row
          : {
              ...row,
              file: join(directory.root, 'tests/e2e/historical.spec.ts'),
            },
      ),
      expected.tests.map((row, index) =>
        index
          ? row
          : {
              ...row,
              titlePath: [...row.titlePath.slice(0, -1), 'different title'],
            },
      ),
    ];
    for (const rows of cases) {
      const code = `import Guard from ${JSON.stringify(reporter)};
        const guard=new Guard({expected:${JSON.stringify(expectedPath)}});
        const rows=${JSON.stringify(rows)};
        guard.onBegin({projects:[{retries:0}]}, {allTests:()=>rows.map(row=>({id:row.id,location:{file:row.file},titlePath:()=>row.titlePath,_grepTitleWithTags:()=>' '+row.grepTitle}))});
        process.stdout.write('UNAUTHORIZED_CONTINUATION');`;
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', code],
        { cwd: directory.root, encoding: 'utf8', timeout: 30_000 },
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Exact browser collection guard rejected/);
      assert.ok(!result.stdout.includes('UNAUTHORIZED_CONTINUATION'));
    }
  } finally {
    prepared?.dispose();
    directory.dispose();
  }
});
test('later invocation missing selected cases aborts preparation before any earlier invocation can execute', async () => {
  const directory = browserDiscoveryFixture();
  const { spawnSync } = await import('node:child_process');
  const second = 'tests/e2e/second.spec.ts';
  directory.file(
    second,
    readFileSync(join(directory.root, scopedBrowserFile), 'utf8'),
  );
  let calls = 0;
  try {
    const built = buildSelectedCommands(
      selected({
        browser: {
          quality: [
            { file: scopedBrowserFile, grep: 'chosen$' },
            { file: second, grep: '^absent$' },
          ],
        },
      }),
      'browser',
      { browserJob: 'quality' },
    );
    await assert.rejects(
      prepareBrowserCommands(built, {
        cwd: directory.root,
        spawn: (command, args, options) => {
          assert.ok(
            args.includes('--list'),
            'Every call must still be discovery-only',
          );
          calls++;
          return spawnSync(command, args, options);
        },
      }),
      /absent/,
    );
    assert.equal(calls, 3);
  } finally {
    directory.dispose();
  }
});
