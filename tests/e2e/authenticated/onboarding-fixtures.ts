import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Fictional, disposable CI data, never a deployable policy seed. No URL, user,
// key, SQL, or project argument is accepted from callers. The fixed local stack
// is torn down by auth-browser CI. Immutable documents intentionally remain
// until that teardown; active configuration is removed after every test.
export const onboardingFixtures = {
  terms: 'a1100000-0000-4000-8000-000000000001',
  privacy: 'a1100000-0000-4000-8000-000000000002',
  analytics: 'a1100000-0000-4000-8000-000000000003',
  nextTerms: 'a1100000-0000-4000-8000-000000000004',
  namePolicy: 'a1100000-0000-4000-8000-000000000005',
} as const;

function localSql(sql: string) {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
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
  execFileSync(
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
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

export function prepareFictionalDocuments() {
  localSql(`
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
    ('${onboardingFixtures.terms}','terms','자동화 점검용 허구 이용약관','이 본문은 격리 CI의 화면 점검용 허구 자료입니다. 실제 서비스 약관이 아니며 실제 이용자의 동의를 받지 않습니다.',now(),now()),
    ('${onboardingFixtures.privacy}','privacy','자동화 점검용 허구 개인정보 안내','이 본문은 격리 CI의 화면 점검용 허구 자료입니다. 실제 개인정보 처리방침이 아니며 실제 이용자의 동의를 받지 않습니다.',now(),now()),
    ('${onboardingFixtures.analytics}','analytics','자동화 점검용 허구 분석 동의','이 본문은 격리 CI의 선택 항목 점검용 허구 자료입니다. 외부 분석 수집은 하지 않습니다.',now(),now()),
    ('${onboardingFixtures.nextTerms}','terms','자동화 점검용 새 허구 이용약관','이 본문은 버전 변경 점검용 허구 자료이며 실제 법률 문서가 아닙니다.',now(),now())
    on conflict(version) do nothing;
  `);
}

export function enableFictionalPolicy() {
  localSql(`
    insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version,analytics_version)
    values(true,'${onboardingFixtures.namePolicy}',now(),2,10,array['금칙예시'],'${onboardingFixtures.terms}','${onboardingFixtures.privacy}','${onboardingFixtures.analytics}')
    on conflict(singleton) do update set name_policy_version=excluded.name_policy_version,name_approved_at=excluded.name_approved_at,call_name_min=excluded.call_name_min,call_name_max=excluded.call_name_max,profanity_words=excluded.profanity_words,terms_version=excluded.terms_version,privacy_version=excluded.privacy_version,analytics_version=excluded.analytics_version;
    insert into private.analytics_policy(singleton,consent_version,enabled,retention_days)
    values(true,'${onboardingFixtures.analytics}',true,30)
    on conflict(singleton) do update set consent_version=excluded.consent_version,enabled=excluded.enabled,retention_days=excluded.retention_days;
  `);
}

export function disableFictionalPolicy() {
  localSql(
    'delete from private.profile_onboarding_policy; delete from private.analytics_policy;',
  );
}

export function rotateFictionalTerms() {
  localSql(
    `update private.profile_onboarding_policy set terms_version='${onboardingFixtures.nextTerms}';`,
  );
}
