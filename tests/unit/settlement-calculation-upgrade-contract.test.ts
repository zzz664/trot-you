import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTLEMENT_CALCULATION } from '@/config/settlement-calculation';

// Harness/provenance assertions only. Real SQL, locks and populated upgrade are
// separate selected hosted-CI jobs, never inferred from these source checks.
const upgrade = readFileSync(
  'scripts/test-settlement-calculation-upgrade.mjs',
  'utf8',
);
const races = readFileSync(
  'scripts/test-settlement-calculation-concurrency.mjs',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/20261026000039_settlement_calculation.sql',
  'utf8',
);
const limits = readFileSync(
  'supabase/tests/settlement_calculation_limits.test.sql',
  'utf8',
);
const snapshot = upgrade.slice(
  upgrade.indexOf('const snapshot ='),
  upgrade.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261026000039')
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n');
const definitions = new Map(
  [
    ...predecessor.matchAll(
      /create table ((?:public|private)\.[a-z_]+)\s*\(([\s\S]+?)\);/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
const relations = [
  ...snapshot.matchAll(
    /jsonb_agg\(to_jsonb\(([a-z]+)\) order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

describe('settlement calculation selected DB harness contracts', () => {
  it('has one additive read-only RPC and no new mutable policy, report or scheduler objects', () => {
    expect(migration.match(/create function /g)).toHaveLength(1);
    expect(migration).toContain(
      'public.settlement_calculation_input(p_artist_id uuid,p_month date)',
    );
    const body = migration.split('as $$')[1]!.split('$$;')[0]!;
    expect(body.replace(/--[^\n]*/g, '')).not.toMatch(
      /\b(?:insert\s+into|update\s+public|update\s+private|delete\s+from|truncate|create\s+table)\b/i,
    );
    expect(migration).not.toContain('cron.schedule');
    expect(migration).toContain(
      'perform private.settlement_admin_lock(p_artist_id)',
    );
    expect(body).not.toMatch(/\bfor\s+(?:update|share|key\s+share)\b/i);
  });
  it('keeps application and DB technical bounds aligned without silently truncating output', () => {
    expect(migration).toContain(
      `source_limit constant integer:=${SETTLEMENT_CALCULATION.maxSourceRows}`,
    );
    expect(migration).toContain(
      `p_month<date '${SETTLEMENT_CALCULATION.earliestMonth}'`,
    );
    expect(migration).toContain(
      `p_month>date '${SETTLEMENT_CALCULATION.latestMonth}'`,
    );
    expect(migration.match(/limit source_limit\+1/g)).toHaveLength(2);
    expect(migration.match(/SETTLEMENT_SOURCE_LIMIT_EXCEEDED/g)).toHaveLength(
      2,
    );
    const transport = migration.slice(
      migration.indexOf('select coalesce(jsonb_agg'),
    );
    expect(transport).not.toMatch(/\blimit\s+/i);
    expect(limits.match(/generate_series\(1,50000\)/g)).toHaveLength(2);
    expect(
      limits.match(/'54000','SETTLEMENT_SOURCE_LIMIT_EXCEEDED'/g),
    ).toHaveLength(2);
    expect(limits).not.toMatch(/rollback to|disable trigger/i);
  });
  it('reads only verified money and preserves recognized event types and decimal transport', () => {
    expect(migration).toContain(
      'join private.payment_event_verifications v on v.event_id=e.id',
    );
    expect(migration).not.toContain('private.payment_attempts');
    expect(migration).toContain("'kind',e.kind,'amountKrw',e.amount_krw::text");
    expect(migration).toContain("'sourceVersion',source_version::text");
    expect(migration).toContain("'baseRate',cfg.base_rate::text");
    expect(migration).toContain("'actorId',auth.uid()");
    expect(migration).toContain(
      'assigned.report_id is distinct from report.id',
    );
  });
  it('snapshots complete predecessor records with no volatile-field omission', () => {
    expect(snapshot).not.toMatch(/-'[a-z_]+'/);
    expect(snapshot).not.toContain('JSON.parse');
    expect(upgrade).toContain('const beforeRaw = snapshot()');
    expect(upgrade).toContain('const before = JSON.parse(beforeRaw)');
    expect(relations.map((row) => row.table)).toEqual([
      'public.profiles',
      'public.artists',
      'public.subscriptions',
      'public.payment_events',
      'private.payment_event_verifications',
      'private.payment_mandates',
      'private.billing_obligations',
      'private.payment_attempts',
      'private.settlement_policies',
      'private.settlement_source_versions',
      'public.messages',
      'public.settlements',
      'private.settlement_event_sources',
      'private.settlement_message_sources',
      'public.settlement_weekly_stats',
      'private.settlement_adjustments',
    ]);
  });
  it.each(relations)(
    '$table snapshot ordering uses actual predecessor columns',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, table).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(
          new RegExp(`(?:^|[\\n,])\\s*${name}\\s+[a-z]`),
        );
      }
    },
  );
  it('performs exactly the populated latest upgrade and compares state before/after success and denial', () => {
    expect(upgrade).toContain(
      "['db', 'reset', '--local', '--version', '20261026000038']",
    );
    expect(upgrade).toContain("['migration', 'up', '--local']");
    expect([
      ...upgrade.matchAll(/assert\.equal\(\s*snapshot\(\),\s*beforeRaw,/g),
    ]).toHaveLength(3);
    for (const name of [
      'settlement_calculate',
      'settlement_confirm',
      'settlement_queue_adjustment',
      'billing_record_refund',
      'settlement_calculation_input',
    ])
      expect(upgrade).toContain(`public.${name}`);
    expect(upgrade).toContain('before.reports.length, 2');
    expect(upgrade).toContain('before.payments.length, 5');
    expect(upgrade).toContain('before.weekly_stats.length, 10');
  });
  it('feeds real RPC input through the actual application calculator and checks all exact rational components', () => {
    expect(upgrade).toContain(
      "from './src/server/services/settlement/calculate'",
    );
    expect(upgrade).toContain('const result = calculate(parsed.data.input)');
    expect(upgrade).toContain(
      'private.settlement_calculate_components(8701,2,1,28',
    );
    expect(upgrade).toContain('BigInt(application.numerator) * denominator');
    expect(upgrade).toContain('numerator * BigInt(application.denominator)');
    for (const key of [
      'vatKrw',
      'pgFeeKrw',
      'baseAmountKrw',
      'shareKrw',
      'activityRatio',
      'deductionKrw',
      'unroundedFinalKrw',
    ])
      expect(upgrade).toContain(`['${key}',`);
  });
  it('proves real blocking relationships rather than assuming races after sleep', () => {
    expect(races).toContain("waiting.wait_event_type = 'Lock'");
    expect(races).toContain(
      'blocking.pid = any(pg_blocking_pids(waiting.pid))',
    );
    expect(races).toContain('await waitForBlock(db, second, first)');
    expect(races.indexOf('await waitForBlock(db, second, first)')).toBeLessThan(
      races.indexOf('await first.query(`${finalize};`)'),
    );
    for (const scenario of [
      'refund-before',
      'reader-before-refund',
      'policy-disable',
      'admin-revoke',
      'reader-before-revoke',
      'source-row-first',
      'artist-row-first',
      'confirmed-before-reader',
    ])
      expect(races).toContain(scenario);
    expect(races).toContain("for (const finalize of ['commit', 'rollback'])");
  });
  it('keeps destructive test setup local and restores it without any full-suite invocation', () => {
    for (const harness of [races, upgrade]) {
      expect(harness).toContain("['--context', 'default']");
      expect(harness).toContain("startsWith('unix://')");
      expect(harness).toContain('DOCKER_HOST');
      expect(harness).toContain('DOCKER_CONTEXT');
      expect(harness).toContain("['db', 'reset', '--local']");
      expect(harness).not.toMatch(
        /test:integration|check:all|supabase test db|test-analytics.*\.mjs|test-settlement-concurrency\.mjs/,
      );
    }
  });
});
