import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Only fictional rows in the fixed disposable GitHub CI stack. This is not a
// production seed, real policy approval or provider test. No credentials or
// arbitrary SQL/URL can be supplied by callers. Immutable policies remain only
// until the isolated stack is destroyed; the active pointer is always removed.
export const checkoutFixtures = {
  artist: {
    id: 'a1600000-0000-4000-8000-000000000001',
    slug: 'ci-checkout-star',
    name: '허구 구독 가수',
  },
  policy: 'a1600000-0000-4000-8000-000000000011',
  nextPolicy: 'a1600000-0000-4000-8000-000000000012',
  title: '격리 자동화 점검용 허구 구독 약관',
  body: '이 약관은 격리 CI 화면 점검용 허구 자료입니다. 실제 서비스 약관이 아니며 실제 동의나 결제를 받지 않습니다.\n정기 가격과 첫 가격의 표시 및 버전 검증만 점검합니다.',
} as const;

function localSql(sql: string): string {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:3100');
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
  );
  assert.ok(
    execFileSync(
      'docker',
      [
        '--context',
        'default',
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
  return execFileSync(
    'docker',
    [
      '--context',
      'default',
      'exec',
      '-i',
      'supabase_db_trot-you',
      'psql',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

function actorId(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}

export function prepareFictionalCheckoutPolicies() {
  localSql(`
    insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at) values
    ('${checkoutFixtures.policy}','${checkoutFixtures.title}','${checkoutFixtures.body}',6500,1000,now(),now()),
    ('${checkoutFixtures.nextPolicy}','새 허구 구독 약관','격리 CI에서 약관 변경을 점검하는 허구 본문입니다.',7000,1200,now(),now())
    on conflict(version) do nothing;
  `);
}

export function enableFictionalCheckout() {
  localSql(`
    insert into public.artists(id,slug,name,intro,grade,status)
    values('${checkoutFixtures.artist.id}','${checkoutFixtures.artist.slug}','${checkoutFixtures.artist.name}',
      '격리 CI 구독 준비 점검용 허구 가수입니다. 실제 인물이 아닙니다.','B','active');
    insert into private.checkout_policy_current(singleton,policy_version)
    values(true,'${checkoutFixtures.policy}')
    on conflict(singleton) do update set policy_version=excluded.policy_version;
  `);
}

export function disableFictionalCheckoutPolicy() {
  localSql('delete from private.checkout_policy_current;');
}

export function rotateFictionalCheckoutPolicy() {
  localSql(`update private.checkout_policy_current
    set policy_version='${checkoutFixtures.nextPolicy}' where singleton;`);
}

export function clearFictionalCheckout() {
  localSql(`
    begin;
    delete from private.checkout_sessions where artist_id='${checkoutFixtures.artist.id}';
    delete from private.checkout_policy_current;
    delete from public.artists where id='${checkoutFixtures.artist.id}';
    commit;
  `);
}

export function expireFictionalCheckout(userId: string) {
  const id = actorId(userId);
  localSql(`update private.checkout_sessions s
    set created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute'
    where s.user_id='${id}' and s.artist_id='${checkoutFixtures.artist.id}' and s.status='pending_intent'
      and exists(select 1 from auth.users u where u.id=s.user_id
        and u.email ~ '^auth-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}

export function storedFictionalCheckout(userId: string) {
  const id = actorId(userId);
  return JSON.parse(
    localSql(`select jsonb_build_object(
      'sessions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'policyVersion',s.policy_version)), '[]'::jsonb)
        from private.checkout_sessions s where s.user_id='${id}' and s.artist_id='${checkoutFixtures.artist.id}'),
      'subscriptions',(select count(*) from public.subscriptions where user_id='${id}'),
      'payments',(select count(*) from public.payment_events e join public.subscriptions s on s.id=e.subscription_id where s.user_id='${id}'))
      from auth.users u where u.id='${id}' and u.email ~ '^auth-e2e-[0-9a-f-]{36}@example[.]invalid$';`),
  ) as {
    sessions: { id: string; status: string; policyVersion: string }[];
    subscriptions: number;
    payments: number;
  };
}
