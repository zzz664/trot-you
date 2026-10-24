import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/database';

// Fictional records for the disposable Auth CI stack only. Storage rows below
// are metadata, not uploaded/licensed media. This suite checks deferred secure
// open controls only; the dedicated media CI suite proves actual byte playback.
export const discoveryFixtures = {
  main: {
    id: 'a1200000-0000-4000-8000-000000000001',
    slug: 'ci-discovery-01',
    name: '허구 가수 01',
  },
  empty: {
    id: 'a1200000-0000-4000-8000-000000000002',
    slug: 'ci-discovery-02',
    name: '허구 가수 02',
  },
  hiddenSlugs: [
    'ci-discovery-draft',
    'ci-discovery-paused',
    'ci-discovery-retired',
  ],
  body: '안녕하세요, {이름}님. {이름}님을 위한 허구 맛보기입니다. <script>window.__previewXss=1</script>',
  privateSentinel: '비공개 메시지 원문 노출 금지',
  privatePath: 'DO_NOT_EXPOSE_PRIVATE_ARTIST_PATH',
  contract: 'DO_NOT_EXPOSE_PRIVATE_CONTRACT',
} as const;

// Callers choose only declared fixture operations, never SQL/URL/key/project.
function localSql(sql: string): string {
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

export function prepareFictionalDiscovery(authorId: string) {
  assert.match(
    authorId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  localSql(`
    begin;
    insert into public.artists(id,slug,name,intro,grade,status,profile_image_path,agency_name)
    select ('a1200000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      'ci-discovery-' || lpad(n::text,2,'0'), '허구 가수 ' || lpad(n::text,2,'0'),
      '격리 CI 전용 허구 가수입니다. 실제 인물과 콘텐츠가 아닙니다.', 'B','active',
      '${discoveryFixtures.privatePath}', '${discoveryFixtures.contract}'
      from generate_series(1,14) n;
    insert into public.artists(id,slug,name,grade,status) values
      ('a1200000-0000-4000-8000-000000000021','ci-discovery-draft','공개 금지 허구 초안','C','draft'),
      ('a1200000-0000-4000-8000-000000000022','ci-discovery-paused','공개 금지 허구 중지','C','paused'),
      ('a1200000-0000-4000-8000-000000000023','ci-discovery-retired','공개 금지 허구 은퇴','C','retired');
    insert into public.artist_members(artist_id,user_id) values('${discoveryFixtures.main.id}','${authorId}');
    insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,
      max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,
      max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('fictional-discovery-ci-only',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
    insert into public.messages(id,artist_id,author_id,type,body,status,is_preview,preview_order,scheduled_at,sent_at)
    select ('a1300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      '${discoveryFixtures.main.id}','${authorId}',
      (case n when 2 then 'photo' when 3 then 'voice' when 4 then 'video' else 'text' end)::public.message_type,
      case n when 1 then '${discoveryFixtures.body}' when 2 then '허구 사진의 설명입니다.'
        when 3 then '허구 음성의 설명입니다.' when 4 then '허구 영상의 설명입니다.'
        else '${discoveryFixtures.privateSentinel} 미래' end,
      'sent',true,n,now()-interval '1 hour',
      case when n=5 then now()+interval '1 day' else now()-interval '30 minutes' end
    from generate_series(1,5) n;
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at)
    select ('a1300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      '${discoveryFixtures.main.id}','${authorId}','text','${discoveryFixtures.privateSentinel} '||n,
      (case n when 6 then 'draft' when 7 then 'scheduled' when 8 then 'canceled' else 'sent' end)::public.message_status,
      case when n<>6 then now()-interval '1 hour' end,
      case when n in (8,9) then now()-interval '30 minutes' end,
      case when n=8 then now() end
    from generate_series(6,9) n;
    insert into storage.objects(id,bucket_id,name,metadata)
    select ('a1400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'message-media',
      '${discoveryFixtures.main.id}/a1300000-0000-4000-8000-' || lpad(n::text,12,'0') ||
      '/a1500000-0000-4000-8000-' || lpad(n::text,12,'0') ||
      case n when 2 then '.jpg' when 3 then '.mp3' else '.mp4' end,
      jsonb_build_object('size',100,'mimetype',case n when 2 then 'image/jpeg' when 3 then 'audio/mpeg' else 'video/mp4' end)
    from generate_series(2,4) n;
    insert into public.message_media(id,message_id,storage_object_id,bucket_id,object_path,kind,mime_type,byte_size,width,height,duration_ms)
    select ('a1500000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      ('a1300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      ('a1400000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'message-media',
      '${discoveryFixtures.main.id}/a1300000-0000-4000-8000-' || lpad(n::text,12,'0') ||
      '/a1500000-0000-4000-8000-' || lpad(n::text,12,'0') || case n when 2 then '.jpg' when 3 then '.mp3' else '.mp4' end,
      (case n when 2 then 'photo' when 3 then 'voice' else 'video' end)::public.message_type,
      case n when 2 then 'image/jpeg' when 3 then 'audio/mpeg' else 'video/mp4' end,100,
      case when n<>3 then 800 end,case when n<>3 then 600 end,case when n<>2 then 1000 end
    from generate_series(2,4) n;
    commit;
  `);
}

// Only these three committed, metadata-only fixture objects are in scope.
// Use the real Storage API for metadata-only fixtures too; never disable
// protect_delete or mutate Storage metadata directly in cleanup.
const discoveryMediaPaths = [2, 3, 4].map((n) => {
  const suffix = String(n).padStart(12, '0');
  const extension = n === 2 ? 'jpg' : n === 3 ? 'mp3' : 'mp4';
  return `${discoveryFixtures.main.id}/a1300000-0000-4000-8000-${suffix}/a1500000-0000-4000-8000-${suffix}.${extension}`;
});

export async function clearFictionalDiscovery() {
  localSql(`
    begin;
    delete from public.message_media where id::text like 'a1500000-%';
    delete from public.messages where id::text like 'a1300000-%';
    delete from public.artists where id::text like 'a1200000-%';
    delete from private.message_policy where version='fictional-discovery-ci-only';
    update public.artists set status='active' where id='00000000-0000-4000-8000-000000000001';
    commit;
  `);
  // localSql above verifies GitHub CI, the fixed loopback URL and local Docker
  // before any credential is read or API request starts. Commit application FK
  // cleanup first so Storage can remove its own rows without orphaning app data.
  const serviceKey = process.env.AUTH_TEST_SERVICE_KEY;
  assert.ok(serviceKey, 'The disposable Storage fixture key must be ready.');
  const client = createClient<Database>('http://127.0.0.1:54321', serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        }),
    },
  });
  let failed: boolean;
  try {
    const { error } = await client.storage
      .from('message-media')
      .remove(discoveryMediaPaths);
    failed = error !== null;
  } catch {
    failed = true;
  }
  // Do not print the raw provider response, credentials or request headers.
  assert.equal(failed, false, 'Local Storage fixture cleanup failed.');
  assert.equal(
    localSql(`select count(*) from storage.objects where bucket_id='message-media'
    and name in (${discoveryMediaPaths.map((path) => `'${path}'`).join(',')});`),
    '0',
    'Local Storage fixture metadata still exists after API cleanup.',
  );
}

export function pauseMainArtist() {
  localSql(
    `update public.artists set status='paused' where id='${discoveryFixtures.main.id}';`,
  );
}

export function hideFictionalCatalog() {
  localSql(`update public.artists set status='paused' where id::text like 'a1200000-%'
    or id='00000000-0000-4000-8000-000000000001';`);
}

export function removeFictionalMessagePolicy() {
  localSql(
    "delete from private.message_policy where version='fictional-discovery-ci-only';",
  );
}

export function discoveryStoredInterest(actorId: string) {
  assert.match(actorId, /^[0-9a-f-]{36}$/i);
  return JSON.parse(
    localSql(`select jsonb_build_object('artistId',i.artist_id,'selectedAt',i.selected_at,
    'subscriptions',(select count(*) from public.subscriptions where user_id='${actorId}'),
    'completed',(select onboarding_completed_at from public.profiles where id='${actorId}'))
    from (select 1) one left join private.artist_interests i on i.user_id='${actorId}';`),
  ) as {
    artistId: string | null;
    selectedAt: string | null;
    subscriptions: number;
    completed: string | null;
  };
}

export function invalidateFictionalCallingName() {
  localSql(`update private.profile_onboarding_policy set
    name_policy_version='a1100000-0000-4000-8000-000000000006',
    name_approved_at=clock_timestamp(),profanity_words=array['금칙예시','<b>팬</b>'];`);
}
