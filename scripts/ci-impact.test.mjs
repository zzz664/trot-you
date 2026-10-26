import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  REQUIRED_JOB_IDS,
} from './ci-impact-registry.mjs';
import { parseNameStatus, selectImpact, validatePlan } from './ci-impact.mjs';

const base = '2'.repeat(40);
const provenance = {
  event: 'pull_request',
  testSha: '1'.repeat(40),
  baseRef: 'develop',
  base,
  head: '3'.repeat(40),
  mergeBase: base,
};
const path = 'src/server/services/analytics/capture.ts';
const unit = 'tests/unit/analytics-capture.test.ts';
const emptySelection = () => ({
  typecheck: false,
  unit: [],
  fixtures: [],
  sql: [],
  races: [],
  upgrades: [],
  browser: {},
});
const scope = (overrides = {}) => ({
  version: 1,
  id: 'analytics-capture',
  base,
  covers: [path],
  reason: 'Verify the changed capture boundary only.',
  selection: { ...emptySelection(), unit: [unit] },
  ...overrides,
});
const plan = (paths = [path], scopes = [scope()]) =>
  selectImpact(paths, { scopes, provenance: { ...provenance } });

describe('explicit scoped development plans', () => {
  it('retains stable complete job inventory without a full-run mode', () => {
    assert.equal(BROWSER_JOBS.length, 26);
    assert.equal(new Set(CONDITIONAL_JOBS).size, 27);
    assert.deepEqual(CONDITIONAL_JOBS, ['database', ...BROWSER_JOBS]);
    assert.deepEqual(REQUIRED_JOB_IDS, [
      'impact',
      'quality',
      ...CONDITIONAL_JOBS,
    ]);
    const result = validatePlan(plan());
    assert.equal(result.version, 2);
    assert.equal(result.mode, 'scoped');
    assert.equal(result.selection.typecheck, false);
    assert.deepEqual(result.selection.unit, [unit]);
    assert.ok(CONDITIONAL_JOBS.every((job) => result.jobs[job] === false));
  });

  it('canonicalizes exact changed paths and their count without broadening tests', () => {
    const result = plan([path, 'docs/work-log/notes.md', path]);
    assert.deepEqual(result.changedPaths, ['docs/work-log/notes.md', path]);
    assert.equal(result.pathCount, 2);
    assert.match(result.pathDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      result,
      plan([path, path, 'docs/work-log/notes.md'].reverse()),
    );
  });

  it('unions only matching active scopes and deduplicates shared selected files', () => {
    const secondPath =
      'src/components/analytics-funnel/AnalyticsFunnelScreen.tsx';
    const first = scope();
    const second = scope({
      id: 'analytics-screen',
      covers: [secondPath],
      selection: {
        ...emptySelection(),
        typecheck: true,
        unit: [unit, 'tests/unit/analytics-funnel-ui.test.tsx'],
        browser: {
          'analytics-funnel-browser': [
            {
              file: 'tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
              grep: 'withdrawal',
            },
          ],
        },
      },
    });
    const unrelated = scope({
      id: 'not-changed',
      covers: ['src/client/schedules.ts'],
      selection: {
        ...emptySelection(),
        unit: ['tests/unit/schedules-client.test.ts'],
      },
    });
    const result = plan([secondPath, path], [first, unrelated, second]);
    assert.deepEqual(result.scopes.map(({ id }) => id).sort(), [
      'analytics-capture',
      'analytics-screen',
    ]);
    assert.deepEqual(
      result.selection.unit,
      [unit, 'tests/unit/analytics-funnel-ui.test.tsx'].sort(),
    );
    assert.equal(result.selection.typecheck, true);
    assert.equal(result.jobs['analytics-funnel-browser'], true);
    assert.equal(result.jobs.database, false);
    assert.ok(
      BROWSER_JOBS.filter((job) => job !== 'analytics-funnel-browser').every(
        (job) => !result.jobs[job],
      ),
    );
    assert.deepEqual(
      result,
      plan([path, secondPath], [second, first, unrelated]),
    );
  });

  it('derives database execution only from selected SQL, race or upgrade files', () => {
    for (const [kind, file] of [
      ['sql', 'supabase/tests/analytics_funnel.test.sql'],
      ['races', 'scripts/test-analytics-funnel-concurrency.mjs'],
      ['upgrades', 'scripts/test-analytics-funnel-upgrade.mjs'],
    ]) {
      const result = plan(
        [path],
        [scope({ selection: { ...emptySelection(), [kind]: [file] } })],
      );
      assert.equal(result.jobs.database, true, kind);
      assert.deepEqual(result.selection[kind], [file]);
      assert.ok(BROWSER_JOBS.every((job) => !result.jobs[job]));
    }
  });

  it('fixture-only selection never implicitly schedules DB, typecheck or browsers', () => {
    const result = plan(
      [path],
      [
        scope({
          selection: {
            ...emptySelection(),
            fixtures: ['scripts/analytics-funnel-local-config.test.mjs'],
          },
        }),
      ],
    );
    assert.equal(result.selection.typecheck, false);
    assert.ok(CONDITIONAL_JOBS.every((job) => !result.jobs[job]));
  });

  for (const changed of [
    'src/server/db/client.ts',
    'src/config/routes.ts',
    'src/messages/ko.json',
    'supabase/migrations/20261026000038_analytics_funnel.sql',
    '.github/workflows/ci.yml',
    'package.json',
    'new-unknown-feature.ts',
    'docs/executable.mjs',
  ]) {
    it(`${changed} needs an exact active scope rather than triggering cumulative tests`, () => {
      assert.throws(() => plan([changed], []));
      const result = validatePlan(
        plan([changed], [scope({ covers: [changed] })]),
      );
      assert.equal(result.mode, 'scoped');
      assert.deepEqual(result.selection.unit, [unit]);
      assert.ok(CONDITIONAL_JOBS.every((job) => !result.jobs[job]));
    });
  }

  it('one uncovered change fails an otherwise covered or documentation-only plan', () => {
    for (const known of [path, 'docs/readme.md'])
      assert.throws(() => plan([known, 'src/server/new-feature/index.ts']));
  });

  it('stale base scopes do not authorize this merge-base diff', () => {
    assert.throws(() => plan([path], [scope({ base: '4'.repeat(40) })]));
    const result = plan(
      [path],
      [scope({ id: 'old-scope', base: '4'.repeat(40) }), scope()],
    );
    assert.deepEqual(
      result.scopes.map(({ id }) => id),
      ['analytics-capture'],
    );
  });

  it('plain documentation and AGENTS instructions need no selected test files', () => {
    const result = validatePlan(
      plan(['README.md', 'AGENTS.md', 'docs/work-log/notes.md'], []),
    );
    assert.equal(result.mode, 'docs-only');
    assert.deepEqual(result.selection, emptySelection());
    assert.deepEqual(result.scopes, []);
    assert.ok(CONDITIONAL_JOBS.every((job) => !result.jobs[job]));
    assert.throws(() => plan(['docs/image.png'], []));
    assert.throws(() => plan(['README.md.mjs'], []));
  });

  it('rejects empty or oversized evidence instead of emitting an implicit all-tests plan', () => {
    assert.throws(() => plan([], []));
    const paths = Array.from(
      { length: 1500 },
      (_, i) => `docs/${i}-${'x'.repeat(100)}.md`,
    );
    assert.throws(() => plan(paths, []));
  });

  for (const mutate of [
    (s) => {
      s.version = 2;
    },
    (s) => {
      s.id = '';
    },
    (s) => {
      s.base = 'branch-name';
    },
    (s) => {
      s.reason = '';
    },
    (s) => {
      s.covers = ['src/**'];
    },
    (s) => {
      s.covers = ['/absolute'];
    },
    (s) => {
      s.covers = ['src/../secret'];
    },
    (s) => {
      s.selection.unit = ['tests/unit/*.test.ts'];
    },
    (s) => {
      s.selection.unit = ['--run'];
    },
    (s) => {
      s.selection.browser = {
        'unknown-browser': [{ file: 'tests/e2e/unknown.spec.ts' }],
      };
    },
    (s) => {
      s.selection.typecheck = 'true';
    },
  ])
    it(`rejects invalid manifest ${mutate.toString()}`, () => {
      const invalid = scope();
      mutate(invalid);
      assert.throws(() => plan([path], [invalid]));
    });

  it('requires verified PR provenance even for documentation-only changes', () => {
    for (const mutation of [
      { event: 'push' },
      { baseRef: 'main' },
      { base: undefined },
      { head: 'feature' },
      { mergeBase: undefined },
      { testSha: undefined },
    ])
      assert.throws(() =>
        selectImpact(['docs/notes.md'], {
          scopes: [],
          provenance: { ...provenance, ...mutation },
        }),
      );
    assert.throws(() => selectImpact([path], { scopes: [scope()] }));
  });

  for (const mutate of [
    (p) => {
      p.selection.unit = [];
    },
    (p) => {
      p.selection.sql = ['supabase/tests/analytics_security.test.sql'];
    },
    (p) => {
      p.selection.typecheck = true;
    },
    (p) => {
      p.jobs.database = true;
    },
    (p) => {
      p.changedPaths = ['docs/disguised.md'];
    },
    (p) => {
      p.pathCount = 0;
    },
    (p) => {
      p.pathDigest = '0'.repeat(64);
    },
    (p) => {
      p.scopes[0].selection.unit = ['tests/unit/unrelated.test.ts'];
    },
    (p) => {
      p.scopes = [];
    },
    (p) => {
      p.mode = 'full';
    },
  ])
    it(`rejects inconsistent plan ${mutate.toString()}`, () => {
      const result = structuredClone(plan());
      mutate(result);
      assert.throws(() => validatePlan(result));
    });
});

describe('NUL-delimited diff evidence', () => {
  it('preserves both sides of rename/copy and deleted/type-changed paths', () => {
    assert.deepEqual(
      parseNameStatus(
        Buffer.from(
          'R050\0old\0new\0C099\0source\0copy\0D\0deleted\0T\0link\0',
        ),
      ),
      [
        { status: 'R050', paths: ['old', 'new'] },
        { status: 'C099', paths: ['source', 'copy'] },
        { status: 'D', paths: ['deleted'] },
        { status: 'T', paths: ['link'] },
      ],
    );
  });
  it('untrusted filenames cannot silently select a wider suite', () => {
    const input = 'src/한글 [a] $HOME;\n`touch injected`.tsx';
    assert.throws(() => plan([input], []));
  });
  for (const input of [
    'M\0missing terminator',
    'R100\0old\0',
    'M\0\0',
    'U\0conflict\0',
    'X\0unknown\0',
    'R101\0old\0new\0',
    'M\0/absolute\0',
    'M\0docs/../code.md\0',
  ])
    it(`rejects malformed evidence ${JSON.stringify(input)}`, () =>
      assert.throws(() => parseNameStatus(Buffer.from(input))));
  it('rejects invalid UTF-8 instead of replacing path bytes', () =>
    assert.throws(() => parseNameStatus(Buffer.from([77, 0, 255, 0]))));
});
