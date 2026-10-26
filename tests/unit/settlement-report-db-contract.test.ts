import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source/provenance assertions only. They do not substitute for PostgreSQL,
// independent sessions, effective RLS execution or populated-upgrade evidence.
const migration = readFileSync(
  'supabase/migrations/20261026000040_settlement_report_workflow.sql',
  'utf8',
);
const races = readFileSync(
  'scripts/test-settlement-report-concurrency.mjs',
  'utf8',
);
const upgrade = readFileSync(
  'scripts/test-settlement-report-upgrade.mjs',
  'utf8',
);
const precision = readFileSync(
  'supabase/tests/settlement_report_precision.test.sql',
  'utf8',
);
const body = (name: string) => {
  const definition = migration.slice(
    migration.indexOf(`create function ${name}(`),
  );
  return definition.slice(
    definition.indexOf('as $$') + 5,
    definition.indexOf('$$;'),
  );
};

describe('settlement report selected database contracts', () => {
  it('adds four guarded report RPCs without money/policy tables or provisioning', () => {
    expect(migration.match(/create function public\./g)).toHaveLength(4);
    expect(migration).not.toMatch(
      /create table|cron\.schedule|insert into private\.settlement_policies|update public\.payment_events/i,
    );
    for (const name of ['read', 'export', 'calculate', 'confirm']) {
      expect(migration).toContain(`public.settlement_report_${name}(`);
      expect(body(`public.settlement_report_${name}`)).toContain(
        'private.settlement_report_actor',
      );
    }
    expect(migration).toContain('from public,anon,authenticated,service_role');
    expect(migration).toContain('to authenticated');
  });
  it('locks current actor before the existing fence, avoids source-row waits and rejects stale isolation', () => {
    const actor = body('private.settlement_report_actor');
    expect(actor.indexOf('from public.profiles')).toBeLessThan(
      actor.indexOf('pg_advisory_xact_lock'),
    );
    expect(actor.indexOf('profile_policy_acceptances')).toBeLessThan(
      actor.indexOf('pg_advisory_xact_lock'),
    );
    expect(actor.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      actor.indexOf('for key share nowait'),
    );
    expect(actor).toContain(
      "current_setting('role',true) is distinct from 'authenticated'",
    );
    expect(actor).toContain(
      "current_setting('transaction_isolation')<>'read committed'",
    );
    expect(actor).toContain('SETTLEMENT_SOURCE_BUSY');
    expect(actor).not.toMatch(
      /from (?:public\.payment_events|private\.payment_event_verifications|public\.messages)/,
    );
  });
  it('enforces current artist consent at direct SELECT as well as the RPC without inventing admin onboarding', () => {
    const consent = body('private.settlement_artist_consent_ready');
    expect(consent).toContain('p.id=p_actor and p.id=auth.uid()');
    expect(consent).toContain('p.onboarding_completed_at is not null');
    expect(consent).toContain('terms.published_at<=now()');
    expect(consent).toContain('privacy.published_at<=now()');
    expect(consent).toContain("ta.kind='terms'");
    expect(consent).toContain("pa.kind='privacy'");
    expect(migration).toContain(
      "status='confirmed' and private.is_artist_member(artist_id)",
    );
    expect(migration).toContain(
      'private.settlement_artist_consent_ready(auth.uid())',
    );
    expect(body('private.settlement_report_actor')).toContain(
      "if actor.role='artist' then",
    );
    expect(migration).not.toMatch(
      /revoke[^;]*public\.settlement_calculate\(uuid,date\)/,
    );
  });
  it('transports saved money, counts, policy and frozen sources losslessly without client money inputs', () => {
    const read = body('public.settlement_report_read');
    for (const field of [
      'gross_krw',
      'vat_krw',
      'pg_fee_krw',
      'rate',
      'activity_ratio',
      'final_amount_krw',
      'source_version',
    ])
      expect(read).toContain(`report.${field}::text`);
    expect(read).toContain("'exactComponents',report.exact_components");
    expect(read).toContain("'amountKrw',e.amount_krw::text");
    expect(read).toContain('private.settlement_event_sources');
    expect(read).not.toContain('private.payment_attempts');
    expect(read).not.toMatch(/double precision|::float|\bround\(/i);
    expect(read).not.toMatch(/\blimit\s+[0-9]/i);
    expect(read).toContain("'sources',sources");
  });
  it('bounds new draft mutations by expected revision and confirms through established exact CAS', () => {
    const calculate = body('public.settlement_report_calculate');
    expect(calculate).toContain(
      'report.id is null and p_expected_revision is not null',
    );
    expect(calculate).toContain(
      'p_expected_revision is distinct from report.revision',
    );
    expect(
      calculate.indexOf('public.settlement_calculation_input'),
    ).toBeLessThan(calculate.indexOf('public.settlement_calculate('));
    expect(body('public.settlement_report_export')).toContain(
      'p_expected_revision is distinct from report.revision',
    );
    expect(body('public.settlement_report_confirm')).toContain(
      'public.settlement_confirm(p_report_id,p_expected_revision)',
    );
  });
  it('keeps independent-session proof local, bounded and specific to the ten new report races', () => {
    expect(races).toContain('waitForBlock(db, second, first)');
    expect(races).toContain('pg_blocking_pids(waiting.pid)');
    expect(races).toContain("endpoint.startsWith('unix://')");
    expect(races).toContain(
      'Use freshly reset disposable local database only.',
    );
    expect(races).toContain(
      'All ten selected PostgreSQL settlement-report races passed.',
    );
    for (const scenario of [
      'create-cas',
      'recalculate-export-',
      'confirm-idempotent',
      'admin-revoke',
      'artist-${kind}-revoke',
      'reader-before-consent',
      'artist-row-first',
      'calculate-before-read',
    ])
      expect(races).toContain(scenario);
    expect(races).not.toMatch(
      /process\.env\.(?:DATABASE_URL|SUPABASE_URL|SERVICE_ROLE_KEY)|test-settlement-calculation-concurrency|npm run test/,
    );
  });
  it('selects only populated migration39-to40 with complete source records and actual app validation', () => {
    expect(upgrade).toContain(
      "['db', 'reset', '--local', '--version', '20261026000039']",
    );
    expect(upgrade.match(/\['migration', 'up', '--local'\]/g)).toHaveLength(1);
    expect(upgrade).toContain('const beforeRaw = snapshot()');
    expect(upgrade).toContain('validateSettlementReportEnvelope');
    expect(upgrade).toContain(
      'actual large-gross repeating-decimal snapshot passes exact application validation',
    );
    const snapshot = upgrade.slice(
      upgrade.indexOf('const snapshot ='),
      upgrade.indexOf('const ids ='),
    );
    for (const table of [
      'public.profiles',
      'public.artist_members',
      'private.profile_onboarding_policy',
      'private.profile_policy_acceptances',
      'public.payment_events',
      'private.payment_event_verifications',
      'public.settlements',
      'private.settlement_event_sources',
      'private.settlement_message_sources',
      'public.settlement_weekly_stats',
      'private.settlement_adjustments',
    ])
      expect(snapshot).toContain(table);
    expect(snapshot).not.toMatch(/-'[a-z_]+'|::float|double precision/);
    expect(upgrade).not.toContain('generate_series(1,50000)');
  });
  it('uses a tiny signed precision fixture and tests stale isolation across all four entrypoints', () => {
    expect(precision).toContain('generate_series(1,2)');
    expect(precision).toContain("'refund',-1000000");
    expect(precision).toContain("'4293967294'");
    expect(precision).not.toContain('50000');
    for (const level of ['repeatable_read', 'serializable']) {
      const sql = readFileSync(
        `supabase/tests/settlement_report_${level}.test.sql`,
        'utf8',
      );
      expect(
        sql.match(/'25001','SETTLEMENT_READ_COMMITTED_REQUIRED'/g),
      ).toHaveLength(4);
    }
  });
});
