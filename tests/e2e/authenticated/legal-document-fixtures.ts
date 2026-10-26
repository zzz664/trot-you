import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Fictional documents exist only in the disposable auth-browser CI database.
// This module cannot select a project, URL, credentials, or arbitrary SQL.
export const legalFixtures = {
  terms: 'a1420000-0000-4000-8000-000000000001',
  privacy: 'a1420000-0000-4000-8000-000000000002',
  newerTerms: 'a1420000-0000-4000-8000-000000000003',
  historicalTerms: 'a1420000-0000-4000-8000-000000000004',
  draft: 'a1420000-0000-4000-8000-000000000005',
  future: 'a1420000-0000-4000-8000-000000000006',
  analytics: 'a1420000-0000-4000-8000-000000000007',
  missing: 'a1420000-0000-4000-8000-000000000099',
  namePolicy: 'a1420000-0000-4000-8000-000000000010',
  termsTitle: 'CI 허구 문서 — 현재 포인터 이용약관',
  privacyTitle: 'CI 허구 문서 — 개인정보 안내',
  newerTitle: 'CI 허구 문서 — 포인터가 아닌 최신 게시본',
  historicalTitle: 'CI 허구 문서 — 이전 공개 이용약관',
  draftSecret: 'CI_DRAFT_NEVER_PUBLIC_142',
  futureSecret: 'CI_FUTURE_NEVER_PUBLIC_142',
  analyticsSecret: 'CI_ANALYTICS_NOT_LEGAL_ROUTE_142',
  markup:
    '<img src="/never-legal-image" onerror="window.legalMarkupExecuted=true">',
  longToken: 'READ_ONLY_FICTIONAL_DOCUMENT_'.repeat(8),
} as const;

const termsBody = [
  '이 문서는 격리 CI에서 화면과 탐색만 점검하는 허구 자료입니다. 실제 서비스 약관이 아니며 실제 이용자의 동의를 받지 않습니다.',
  '첫 번째 문단입니다. 큰 글자에서도 긴 문장이 가로로 잘리지 않고 자연스럽게 줄을 바꾸어 읽을 수 있어야 합니다.',
  legalFixtures.markup,
  '두 번째 문단입니다. 문서 열람은 동의가 아닙니다. 이 화면에서는 동의 기록이나 개인정보를 변경하지 않습니다.',
  legalFixtures.longToken,
  '마지막 문단입니다. 이 테스트용 내용은 운영 환경에 등록하거나 실제 법률 문서로 사용할 수 없습니다.',
].join('\n\n');

function localSql(sql: string) {
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
      '-A',
      '-t',
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

export function prepareLegalDocuments() {
  // All values are fixed in this module. SQL quote escaping also protects the
  // test if its clearly fictional body gains an apostrophe in a later edit.
  const body = termsBody.replaceAll("'", "''");
  localSql(`
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
    ('${legalFixtures.terms}','terms','${legalFixtures.termsTitle}','${body}',now()-interval '2 days',now()-interval '2 days'),
    ('${legalFixtures.privacy}','privacy','${legalFixtures.privacyTitle}','CI 허구 개인정보 안내 본문입니다. 실제 정책이 아니며 문서 열람은 동의가 아닙니다.',now()-interval '2 days',now()-interval '2 days'),
    ('${legalFixtures.newerTerms}','terms','${legalFixtures.newerTitle}','CI 허구 최신 게시본입니다. 현재 포인터가 선택하지 않았습니다.',now()-interval '1 day',now()-interval '1 day'),
    ('${legalFixtures.historicalTerms}','terms','${legalFixtures.historicalTitle}','CI 허구 이전 공개 본문입니다. 현재 포인터와 독립적으로 정확한 버전으로만 읽습니다.',now()-interval '3 days',now()-interval '3 days'),
    ('${legalFixtures.draft}','terms','CI 허구 비공개 초안','${legalFixtures.draftSecret}',null,null),
    ('${legalFixtures.future}','terms','CI 허구 미래 게시본','${legalFixtures.futureSecret}',now()+interval '1 day',now()+interval '1 day'),
    ('${legalFixtures.analytics}','analytics','CI 허구 분석 문서','${legalFixtures.analyticsSecret}',now()-interval '1 day',now()-interval '1 day')
    on conflict(version) do nothing;
  `);
}

export function enableLegalPolicy() {
  localSql(`
    insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version)
    values(true,'${legalFixtures.namePolicy}',now(),2,10,array['금칙예시'],'${legalFixtures.terms}','${legalFixtures.privacy}')
    on conflict(singleton) do update set name_policy_version=excluded.name_policy_version,name_approved_at=excluded.name_approved_at,call_name_min=excluded.call_name_min,call_name_max=excluded.call_name_max,profanity_words=excluded.profanity_words,terms_version=excluded.terms_version,privacy_version=excluded.privacy_version,analytics_version=null;
  `);
}

export function disableLegalPolicy() {
  localSql('delete from private.profile_onboarding_policy;');
}

export function readLegalConsentEvidence(actorId: string) {
  assert.match(
    actorId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const result = localSql(`
    select json_build_object(
      'accepted', (select count(*) from private.profile_policy_acceptances where user_id=p.id),
      'profileCompleted', p.profile_completed_at,
      'onboardingCompleted', p.onboarding_completed_at,
      'ageAttested', p.age_self_attested_at
    ) from public.profiles p join auth.users u using(id)
    where p.id='${actorId}'::uuid and u.email ~ '^auth-e2e-[0-9a-f-]{36}@example[.]invalid$';
  `);
  assert.ok(result, 'Expected one fictional local actor.');
  return JSON.parse(result) as {
    accepted: number;
    profileCompleted: string | null;
    onboardingCompleted: string | null;
    ageAttested: string | null;
  };
}
