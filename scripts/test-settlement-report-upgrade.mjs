import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exactly the populated 39 -> 40 upgrade. Disposable local Docker only; no
// hosted URL, provider credential, account action or historical test dispatch.
const docker = ['--context', 'default'];
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
const psql = (sql) =>
  execFileSync(
    'docker',
    [
      ...docker,
      'exec',
      '-i',
      'supabase_db_trot-you',
      'psql',
      '-X',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
const snapshot = () =>
  psql(`set timezone='UTC'; select jsonb_build_object(
  'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
  'artists',(select jsonb_agg(to_jsonb(a) order by a.id) from public.artists a),
  'members',(select jsonb_agg(to_jsonb(m) order by m.artist_id,m.user_id) from public.artist_members m),
  'legal_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.profile_onboarding_policy p),
  'legal_documents',(select jsonb_agg(to_jsonb(d) order by d.version) from private.onboarding_documents d),
  'acceptances',(select jsonb_agg(to_jsonb(a) order by a.user_id,a.kind,a.version) from private.profile_policy_acceptances a),
  'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
  'payments',(select jsonb_agg(to_jsonb(e) order by e.id) from public.payment_events e),
  'verifications',(select jsonb_agg(to_jsonb(v) order by v.event_id) from private.payment_event_verifications v),
  'mandates',(select jsonb_agg(to_jsonb(m) order by m.id) from private.payment_mandates m),
  'obligations',(select jsonb_agg(to_jsonb(o) order by o.id) from private.billing_obligations o),
  'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.payment_attempts a),
  'policies',(select jsonb_agg(to_jsonb(p) order by p.id) from private.settlement_policies p),
  'versions',(select jsonb_agg(to_jsonb(v) order by v.version) from private.settlement_source_versions v),
  'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.messages m),
  'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from public.settlements r),
  'event_sources',(select jsonb_agg(to_jsonb(e) order by e.report_id,e.event_id) from private.settlement_event_sources e),
  'message_sources',(select jsonb_agg(to_jsonb(m) order by m.report_id,m.message_id) from private.settlement_message_sources m),
  'weekly_stats',(select jsonb_agg(to_jsonb(w) order by w.report_id,w.week_start) from public.settlement_weekly_stats w),
  'adjustments',(select jsonb_agg(to_jsonb(a) order by a.event_id) from private.settlement_adjustments a));`);
const ids = {
  admin: 'd4100000-0000-4000-8000-000000000001',
  fan: 'd4100000-0000-4000-8000-000000000002',
  artist: 'd4100000-0000-4000-8000-000000000003',
  member: 'd4100000-0000-4000-8000-000000000010',
  subscription: 'd4100000-0000-4000-8000-000000000004',
  charge: 'd4100000-0000-4000-8000-000000000005',
  febCharge: 'd4100000-0000-4000-8000-000000000006',
  unverified: 'd4100000-0000-4000-8000-000000000007',
};
const userSql = (who, sql) =>
  psql(
    `begin; set local role authenticated; set local "request.jwt.claim.sub"='${who}'; ${sql} commit;`,
  );
const serviceSql = (sql) =>
  psql(`begin; set local role service_role; ${sql} commit;`);
const readSql = (month) =>
  `select public.settlement_report_read('${ids.artist}','${month}');`;
let shouldReset = false;

// Validate actual database report/export envelopes through the app parser,
// not a handwritten approximation. Bundle only this explicit boundary.
async function applicationParser() {
  const result = await build({
    stdin: {
      contents: `export { validateSettlementReportEnvelope } from './src/server/services/settlement-reports/manage';`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'isolated-server-only-marker',
        setup(builder) {
          builder.onResolve({ filter: /^server-only$/ }, () => ({
            path: 'server-only',
            namespace: 'report-test-marker',
          }));
          builder.onLoad(
            { filter: /.*/, namespace: 'report-test-marker' },
            () => ({ contents: 'export {};', loader: 'js' }),
          );
        },
      },
    ],
  });
  return await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}

try {
  assert.ok(
    !process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
    'Unset Docker overrides before disposable upgrade verification.',
  );
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
  );
  assert.ok(
    execFileSync(
      'docker',
      [
        ...docker,
        'context',
        'inspect',
        '--format',
        '{{.Endpoints.docker.Host}}',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .startsWith('unix://'),
  );
  assert.equal(
    psql(
      `select (select count(*) from auth.users)+(select count(*) from public.payment_events)+(select count(*) from private.settlement_policies)+(select count(*) from public.settlements)+(select count(*) from private.point_ledger)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261026000039'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values('${ids.admin}','report-upgrade-admin@example.invalid','{}'),('${ids.fan}','report-upgrade-fan@example.invalid','{}'),('${ids.member}','report-upgrade-member@example.invalid','{}');
    update public.profiles set role='admin' where id='${ids.admin}';
    update public.profiles set role='artist',call_name='가수',onboarding_completed_at=clock_timestamp() where id='${ids.member}';
    insert into public.artists(id,slug,name,grade,status) values('${ids.artist}','report-upgrade','Fictional preserved settlement artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${ids.artist}','${ids.member}');
    insert into public.subscriptions(id,user_id,artist_id,provider) values('${ids.subscription}','${ids.fan}','${ids.artist}','toss');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at) values
      ('${ids.charge}','${ids.subscription}','charge',10000,'toss','2026-01-01+09','2026-02-01+09','2026-01-02+09'),
      ('${ids.febCharge}','${ids.subscription}','charge',10001,'toss','2026-02-01+09','2026-03-01+09','2026-02-01 00:00:00+09'),
      ('${ids.unverified}','${ids.subscription}','charge',999999,'toss','2026-02-01+09','2026-03-01+09','2026-02-10+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      select id,'toss','test','fictional-report-upgrade-merchant',id::text,gen_random_uuid() from public.payment_events where id in ('${ids.charge}','${ids.febCharge}');
    insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min,partial_week_policy,late_event_policy) values
      ('${ids.artist}','2026-01-01',true,'2026-01-01','2027-01-01',0.300000,0.400000,0.100000,0.030000,false,null,null,'block','block'),
      ('${ids.artist}','2026-02-01',true,'2026-01-01','2027-01-01',0.300000,0.400000,0.100000,0.030000,true,3,2,'prorate_days','explicit_current_formula'),
      ('${ids.artist}','2026-03-01',false,'2026-01-01','2027-01-01',0.300000,0.400000,0.100000,0.030000,false,null,null,'block','block');
    insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values
      ('${ids.artist}','${ids.admin}','text','Preserved January private body','sent','2026-01-05+09','2026-01-05+09'),
      ('${ids.artist}','${ids.admin}','photo','Preserved February photo body','sent','2026-02-01+09','2026-02-01+09'),
      ('${ids.artist}','${ids.admin}','text','Preserved boundary private body','sent','2026-02-28 23:59:59.999999+09','2026-02-28 23:59:59.999999+09');`);
  // Failed and unknown attempts are separate operational state, never ledger
  // revenue. Their large obligation amount must not leak into the calculator.
  psql(`insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
    values('d4100000-0000-4000-8000-000000000008','${ids.subscription}','toss','test','fictional-upgrade-attempt-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-test-consent');
    insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,next_attempt_at)
    values('d4100000-0000-4000-8000-000000000009','${ids.subscription}','d4100000-0000-4000-8000-000000000008','2026-02-01+09','2026-03-01+09',2147483647,false,false,'fictional-attempt-price',0,3600,2,'2026-02-01+09');
    insert into private.payment_attempts(obligation_id,ordinal,state,outcome_evidence_ref) values
    ('d4100000-0000-4000-8000-000000000009',1,'failed',gen_random_uuid()),
    ('d4100000-0000-4000-8000-000000000009',2,'unknown',null);`);
  const january = userSql(
    ids.admin,
    `select public.settlement_calculate('${ids.artist}','2026-01-01');`,
  );
  const revision = psql(
    `select revision from public.settlements where id='${january}';`,
  );
  userSql(
    ids.admin,
    `select public.settlement_confirm('${january}','${revision}');`,
  );
  const late = serviceSql(
    `select public.billing_record_refund('${ids.charge}','fictional-upgrade-late',600,'KRW','2026-01-20+09',gen_random_uuid());`,
  );
  serviceSql(
    `select public.billing_record_refund('${ids.charge}','fictional-upgrade-current-refund',700,'KRW','2026-02-10+09',gen_random_uuid());`,
  );
  userSql(
    ids.admin,
    `select public.settlement_queue_adjustment('${late}','2026-02-01');`,
  );
  userSql(
    ids.admin,
    `select public.settlement_calculate('${ids.artist}','2026-02-01');`,
  );
  const beforeRaw = snapshot();
  const before = JSON.parse(beforeRaw);
  assert.equal(before.payments.length, 5);
  assert.equal(before.verifications.length, 4);
  assert.equal(before.policies.length, 3);
  assert.equal(before.mandates.length, 1);
  assert.equal(before.obligations.length, 1);
  assert.equal(before.attempts.length, 2);
  assert.deepEqual(before.attempts.map((row) => row.state).sort(), [
    'failed',
    'unknown',
  ]);
  assert.equal(before.messages.length, 3);
  assert.equal(before.reports.length, 2);
  assert.equal(before.adjustments.length, 1);
  assert.equal(
    before.reports.filter((row) => row.status === 'confirmed').length,
    1,
  );
  assert.equal(
    before.reports.filter((row) => row.status === 'draft').length,
    1,
  );
  assert.equal(before.event_sources.length, 4);
  assert.equal(before.message_sources.length, 3);
  assert.equal(before.weekly_stats.length, 10);
  assert.ok(before.versions.length > 0);
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.equal(
    snapshot(),
    beforeRaw,
    'additive read boundary preserves every populated predecessor field',
  );
  const response = JSON.parse(userSql(ids.admin, readSql('2026-02-01')));
  assert.equal(response.actorId, ids.admin);
  assert.equal(response.artist.id, ids.artist);
  assert.equal(response.month, '2026-02-01');
  assert.equal(response.report.status, 'draft');
  assert.equal(response.sources, null);
  assert.equal(response.report.grossKrw, '8701');
  assert.equal(response.report.currentGrossKrw, '9301');
  assert.equal(response.report.adjustmentGrossKrw, '-600');
  assert.equal(response.report.weeklyStats.length, 5);
  assert.equal(response.report.sourceEventCount, '3');
  assert.equal(response.report.sourceMessageCount, '2');
  assert.equal(response.report.policySnapshot.baseRate, '0.300000');
  const exported = JSON.parse(
    userSql(
      ids.admin,
      `select public.settlement_report_export('${response.report.id}','${response.report.revision}');`,
    ),
  );
  assert.deepEqual(exported.report, response.report);
  assert.equal(exported.sources.length, 3);
  assert.equal(
    exported.sources.filter((row) => row.origin === 'adjustment').length,
    1,
  );
  assert.equal(
    exported.sources.reduce((sum, row) => sum + BigInt(row.amountKrw), 0n),
    8701n,
  );
  assert.ok(
    !JSON.stringify(exported).includes('Preserved February photo body'),
  );
  assert.ok(
    !JSON.stringify(exported).includes('fictional-report-upgrade-merchant'),
  );
  const { validateSettlementReportEnvelope } = await applicationParser();
  for (const value of [response, exported]) {
    const parsed = validateSettlementReportEnvelope(value);
    assert.equal(
      parsed.ok,
      true,
      `actual PostgreSQL report/export envelope must pass app parser: ${JSON.stringify(parsed.error)}`,
    );
  }
  const confirmed = JSON.parse(userSql(ids.admin, readSql('2026-01-01')));
  assert.equal(confirmed.report.status, 'confirmed');
  assert.equal(confirmed.report.revision, revision);
  assert.equal(
    snapshot(),
    beforeRaw,
    'new report reads and exports never rewrite preexisting audit or financial records',
  );
  assert.throws(
    () => userSql(ids.member, readSql('2026-01-01')),
    /SETTLEMENT_CONSENT_REQUIRED/,
  );
  assert.equal(
    userSql(ids.member, 'select count(*) from public.settlements;'),
    '0',
    'preexisting artist membership cannot bypass new current legal-consent boundary',
  );
  assert.throws(
    () => userSql(ids.fan, readSql('2026-02-01')),
    /SETTLEMENT_FORBIDDEN/,
  );
  assert.equal(
    snapshot(),
    beforeRaw,
    'denied accesses never backfill or approve historical legal consent',
  );
  // Tiny high-magnitude projection contract: two max-int successes and a
  // signed refund, not the prior feature's source-limit or historical matrix.
  psql(`insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min,partial_week_policy)
    values('${ids.artist}','2026-04-01',true,'2026-04-01','2026-05-01',0.300001,0.400001,0.123457,0.033333,true,3,2,'prorate_days');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at) values
    ('d4100000-0000-4000-8000-000000000011','${ids.subscription}','charge',2147483647,'toss','2026-04-01+09','2026-05-01+09','2026-04-02+09'),
    ('d4100000-0000-4000-8000-000000000012','${ids.subscription}','charge',2147483647,'toss','2026-04-01+09','2026-05-01+09','2026-04-03+09');
    insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
      select id,provider,'test','fictional-report-precision-account',id::text,gen_random_uuid() from public.payment_events
      where id in('d4100000-0000-4000-8000-000000000011','d4100000-0000-4000-8000-000000000012');
    insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at)
      values('${ids.artist}','${ids.admin}','photo','Fictional precision body','sent','2026-04-03+09','2026-04-03+09');`);
  serviceSql(
    `select public.billing_record_refund('d4100000-0000-4000-8000-000000000011','fictional-report-upgrade-precision',1000000,'KRW','2026-04-15+09',gen_random_uuid());`,
  );
  const precise = JSON.parse(
    userSql(
      ids.admin,
      `select public.settlement_report_calculate('${ids.artist}','2026-04-01');`,
    ),
  );
  assert.equal(precise.report.grossKrw, '4293967294');
  assert.equal(precise.report.sourceEventCount, '3');
  assert.equal(
    validateSettlementReportEnvelope(precise).ok,
    true,
    'actual large-gross repeating-decimal snapshot passes exact application validation',
  );
  const preciseExport = JSON.parse(
    userSql(
      ids.admin,
      `select public.settlement_report_export('${precise.report.id}','${precise.report.revision}');`,
    ),
  );
  assert.equal(
    validateSettlementReportEnvelope(preciseExport).ok,
    true,
    'complete signed-source export passes exact application validation',
  );
  assert.equal(
    preciseExport.sources.reduce((sum, row) => sum + BigInt(row.amountKrw), 0n),
    4293967294n,
  );
  console.info(
    'PASS: populated 39-to-40 upgrade preserves financial ledger, policies, draft/confirmed snapshots and exact fractions; coherent real report/export DTO passes app parser and new current-consent RLS fails closed without backfill.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (shouldReset)
    try {
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Settlement upgrade fixture cleanup failed; reset disposable database before reuse.',
        error,
      );
      process.exitCode = 1;
    }
}
