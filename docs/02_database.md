# 02. 데이터베이스 설계 (Supabase Postgres)

> 기준: 개발기획안 7장(데이터 모델), 6장(기능 명세)
> 적용: `supabase/migrations/` 에 아래 SQL을 번호 순서대로 나눠 넣는다.

---

## 1. 설계 원칙

1. **설정값은 코드가 아니라 `app_settings`에 있다.** 글자 수 제한, 가격, 주기, 금칙 패턴 등 운영 중 바뀔 수 있는 값은 전부 여기 둔다. 코드는 키로 읽는다.
2. **돈·포인트는 원장(ledger)으로만 기록한다.** 잔액·누적은 계산하거나 집계 테이블에 캐시한다. UPDATE로 잔액을 덮어쓰지 않는다.
3. **상태 변화는 enum + 상태 기계 함수.** 구독·메시지 상태 전이는 DB 함수가 담당해 어디서 호출하든 같은 규칙이 적용된다.
4. **RLS를 기본으로 켠다.** 서버는 상황에 따라 service_role을 쓰되, 팬 화면 조회는 가능한 한 anon/authenticated 키 + RLS로 처리해 실수로 남의 데이터가 새지 않게 한다.
5. **이름 규칙:** 테이블·컬럼 `snake_case`, 테이블은 복수형, FK는 `<singular>_id`, 시간은 `*_at timestamptz`, 불리언은 `is_*`.

---

## 2. Enum

```sql
create type user_role as enum ('fan', 'artist', 'admin');
create type font_scale as enum ('normal', 'large', 'xlarge');
create type artist_grade as enum ('B', 'C');
create type artist_status as enum ('draft', 'active', 'paused', 'retired');
create type subscription_status as enum ('pending', 'active', 'grace', 'canceled', 'expired');
create type payment_event_type as enum ('initial', 'renewal', 'retry', 'cancel', 'refund', 'failed');
create type message_type as enum ('text', 'photo', 'voice', 'video');
create type message_status as enum ('draft', 'scheduled', 'sent', 'canceled');
create type notification_channel as enum ('webpush', 'alimtalk');
create type notification_status as enum ('queued', 'sent', 'failed', 'skipped');
create type report_target as enum ('post', 'comment', 'reply');
create type report_status as enum ('open', 'hidden', 'restored', 'deleted');
create type point_reason as enum ('attendance', 'post', 'comment', 'share', 'admin_adjust');
create type schedule_type as enum ('broadcast', 'concert', 'event', 'festival');
create type settlement_status as enum ('draft', 'confirmed', 'paid');
```

---

## 3. 테이블

### 3.1 설정

```sql
-- 운영 중 바뀔 수 있는 모든 숫자·문구·패턴. 코드에 리터럴로 두지 않는다.
create table app_settings (
  key         text primary key,            -- 'subscription.price_krw'
  value       jsonb not null,
  description text not null,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
```

**초기값 (seed.sql):**

| key | value | 설명 | 출처 |
| --- | --- | --- | --- |
| `subscription.price_krw` | `6500` | 월 구독료 | 전제 조건 |
| `subscription.intro_price_krw` | `1000` | 첫 달 금액 | F-02 |
| `subscription.grace_days` | `3` | 결제 실패 유예일 | 01 §3.2 |
| `subscription.billing_notice_days_before` | `1` | 결제 전 안내 | F-02 |
| `message.max_text_length` | `1000` | 글 메시지 글자 수 | F-03 |
| `message.max_photos` | `10` | 사진 장수 | F-03 |
| `message.max_voice_seconds` | `180` | 음성 길이 | F-03 |
| `message.max_video_seconds` | `60` | 영상 길이 | F-03 |
| `message.cancel_window_minutes` | `5` | 발송 취소 가능 시간 | F-09 |
| `message.visible_before_subscription_days` | `7` | 구독 전 메시지 노출 범위 | D-3 |
| `message.page_size` | `30` | 대화방 페이지 크기 | 9.2 |
| `message.preview_max_count` | `5` | 가수별 맛보기 수 | F-05 |
| `reply.max_length` | `100` | 답장 글자 수 | F-04 |
| `profile.call_name_min` / `profile.call_name_max` | `2` / `10` | 부를 이름 길이 | F-01 |
| `board.max_images` | `3` | 게시글 사진 수 | F-06 |
| `board.image_max_long_edge_px` | `1600` | 업로드 리사이즈 | F-06 |
| `board.auto_hide_report_count` | `3` | 자동 숨김 신고 수 | F-06 |
| `board.grade_thresholds` | `{"sprout":0,"fervent":20,"core":100}` | 활동 등급 기준(활동 점수) | F-06 |
| `points.attendance` / `points.post` / `points.comment` / `points.share` | `10` / `20` / `5` / `5` | 적립량 | F-07 |
| `artist.weekly_message_min` | `3` | 계약 메시지 횟수/주 | 전제 조건 |
| `artist.weekly_photo_min` | `2` | 계약 사진 횟수/주 | 전제 조건 |
| `settlement.base_rate` | `0.30` | 기본 정산률 | 전제 조건 |
| `settlement.performance_rate` | `0.40` | 성과 정산률 | 전제 조건 |
| `settlement.vat_rate` | `0.10` | 부가세 | F-10 |
| `settlement.pg_fee_rate` | `0.03` | PG 수수료(계약 후 수정) | 01 §2.1 |
| `settlement.performance_conditions` | `null` | 성과 조건(계약 후 입력, D-4) | F-10 |
| `schedule.notice_hour_kst` | `10` | 일정 전날 알림 시각 | F-08 |
| `moderation.forbidden_patterns` | `[{"name":"phone","regex":"..."},{"name":"account","regex":"..."},{"name":"url","regex":"..."}]` | 금칙 패턴 | F-04, 9.3 |
| `moderation.profanity_words` | `[...]` | 욕설 목록 | F-01 |
| `notification.retry_max` | `3` | 발송 재시도 | 01 §2.5 |

서버에서는 `src/server/settings/get.ts`의 `getSetting<T>(key)`로만 읽는다. 60초 메모리 캐시, zod로 타입 검증.

### 3.2 사용자

```sql
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          user_role not null default 'fan',
  nickname      text,                       -- 카카오 닉네임 (가수에게 비노출)
  call_name     text,                       -- 부를 이름 (가수에게 노출되는 유일한 이름)
  font_scale    font_scale not null default 'large',
  age_range     text,                       -- 카카오 제공값 그대로 ('50~59')
  gender        text,
  phone         text,                       -- 선택. 알림톡용. 가수 비노출
  kakao_channel_added boolean not null default false,
  onboarding_completed_at timestamptz,
  is_restricted boolean not null default false,   -- 운영 이용 제한
  restricted_until timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table notification_preferences (
  user_id        uuid primary key references profiles(id) on delete cascade,
  new_message    boolean not null default true,
  schedule       boolean not null default true,
  billing        boolean not null default true,
  board          boolean not null default true,
  updated_at     timestamptz not null default now()
);

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

-- auth.users INSERT 시 profiles 자동 생성
create function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, nickname, age_range, gender)
  values (new.id,
          new.raw_user_meta_data->>'name',
          new.raw_user_meta_data->>'age_range',
          new.raw_user_meta_data->>'gender');
  insert into notification_preferences (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
```

### 3.3 가수

```sql
create table artists (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,        -- URL용 ('kim-trot')
  name           text not null,
  profile_image_path text,                    -- Storage 경로
  intro          text,
  grade          artist_grade not null,
  status         artist_status not null default 'draft',
  agency_name    text,
  contract_started_at date,
  contract_ended_at   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 가수 계정 ↔ 가수 연결 (매니저 계정도 같은 가수에 연결 가능)
create table artist_members (
  artist_id   uuid not null references artists(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  is_manager  boolean not null default false,
  primary key (artist_id, user_id)
);
```

### 3.4 구독·결제

```sql
create table subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  artist_id        uuid not null references artists(id),
  status           subscription_status not null default 'pending',
  provider         text not null,               -- 'toss' | 'mock' (PaymentProvider 식별자)
  billing_key_ref  text,                         -- PG 빌링키 참조 (실제 키는 PG가 보관)
  is_intro_used    boolean not null default false,
  started_at       timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,              -- 이 시각까지 메시지 열람 가능
  next_billing_at  timestamptz,
  canceled_at      timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, artist_id)
);
create index on subscriptions (artist_id, status);
create index on subscriptions (next_billing_at) where status in ('active', 'grace');

-- 정산의 원천. 절대 UPDATE/DELETE 하지 않는다.
create table payment_events (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references subscriptions(id),
  type             payment_event_type not null,
  amount_krw       integer not null,             -- 환불·취소는 음수
  provider         text not null,
  provider_tx_id   text,
  provider_payload jsonb,                        -- 웹훅/응답 원문
  period_start     timestamptz,
  period_end       timestamptz,
  occurred_at      timestamptz not null default now(),
  unique (provider, provider_tx_id)
);
create index on payment_events (occurred_at);
create index on payment_events (subscription_id, occurred_at);

-- 웹훅 중복 처리 방지
create table webhook_receipts (
  provider     text not null,
  event_id     text not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);
```

**구독 상태 기계 (DB 함수로 강제):**

```
pending ──(1회차 승인)──▶ active ──(갱신 성공)──▶ active
                           │                       
                           ├─(갱신 실패)──▶ grace ──(재시도 성공)──▶ active
                           │                 └──(유예 만료)──▶ expired
                           └─(사용자 해지)──▶ canceled ──(기간 종료)──▶ expired
```

```sql
create function transition_subscription(p_id uuid, p_to subscription_status, p_reason text default null)
returns subscriptions language plpgsql security definer as $$
declare s subscriptions;
begin
  select * into s from subscriptions where id = p_id for update;
  if not (
    (s.status = 'pending'  and p_to in ('active', 'expired')) or
    (s.status = 'active'   and p_to in ('active', 'grace', 'canceled')) or
    (s.status = 'grace'    and p_to in ('active', 'expired')) or
    (s.status = 'canceled' and p_to in ('expired'))
  ) then
    raise exception 'INVALID_TRANSITION % -> %', s.status, p_to using errcode = 'P0001';
  end if;
  update subscriptions set status = p_to, updated_at = now(),
    canceled_at = case when p_to = 'canceled' then now() else canceled_at end,
    cancel_reason = coalesce(p_reason, cancel_reason)
  where id = p_id returning * into s;
  return s;
end $$;

-- "현재 열람 가능한 구독" 판정은 한 곳에서
create function has_active_access(p_user uuid, p_artist uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from subscriptions
    where user_id = p_user and artist_id = p_artist
      and status in ('active', 'grace', 'canceled')
      and current_period_end > now()
  );
$$;
```

### 3.5 메시지·답장

```sql
create table messages (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references artists(id),
  author_id     uuid not null references profiles(id),   -- 작성한 가수/매니저 계정
  type          message_type not null,
  body          text,                                     -- {이름} 포함 원문
  media         jsonb not null default '[]',              -- [{path, kind, duration_sec, width, height}]
  status        message_status not null default 'draft',
  is_preview    boolean not null default false,           -- 맛보기 지정 (운영팀)
  preview_order smallint,
  scheduled_at  timestamptz,
  sent_at       timestamptz,
  canceled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on messages (artist_id, sent_at desc) where status = 'sent';
create index on messages (scheduled_at) where status = 'scheduled';
create index on messages (artist_id, preview_order) where is_preview;

create table message_reads (
  user_id     uuid not null references profiles(id) on delete cascade,
  message_id  uuid not null references messages(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (user_id, message_id)
);

create table replies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  artist_id   uuid not null references artists(id),
  body        text not null,
  is_blocked  boolean not null default false,   -- 금칙 패턴 사후 탐지 시
  created_at  timestamptz not null default now()
);
create index on replies (artist_id, created_at desc);
```

### 3.6 게시판·신고

```sql
create table posts (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references artists(id),
  user_id       uuid not null references profiles(id) on delete cascade,
  title         text not null,
  body          text not null,
  images        jsonb not null default '[]',
  is_notice     boolean not null default false,
  is_pinned     boolean not null default false,
  is_hidden     boolean not null default false,
  report_count  integer not null default 0,
  like_count    integer not null default 0,
  comment_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on posts (artist_id, is_pinned desc, created_at desc) where deleted_at is null and not is_hidden;

create table comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  body        text not null,
  is_hidden   boolean not null default false,
  report_count integer not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table post_likes (
  post_id   uuid not null references posts(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  report_target not null,
  target_id    uuid not null,
  reporter_id  uuid not null references profiles(id),
  reason       text not null,
  status       report_status not null default 'open',
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);

-- 신고 수 집계와 자동 숨김은 트리거가 담당 (임계값은 app_settings에서 읽음)
create function apply_report() returns trigger language plpgsql security definer as $$
declare threshold int := (select (value)::int from app_settings where key = 'board.auto_hide_report_count');
begin
  if new.target_type = 'post' then
    update posts set report_count = report_count + 1,
      is_hidden = (report_count + 1 >= threshold) or is_hidden
    where id = new.target_id;
  elsif new.target_type = 'comment' then
    update comments set report_count = report_count + 1,
      is_hidden = (report_count + 1 >= threshold) or is_hidden
    where id = new.target_id;
  end if;
  return new;
end $$;
create trigger on_report_created after insert on reports for each row execute function apply_report();
```

### 3.7 포인트 (원장)

```sql
create table point_ledger (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  amount      integer not null,               -- 적립 +, 차감 −
  reason      point_reason not null,
  ref_type    text,                            -- 'post', 'comment', 'attendance_date' …
  ref_id      text,
  created_at  timestamptz not null default now(),
  unique (user_id, reason, ref_type, ref_id)   -- 같은 행동 중복 적립 방지
);
create index on point_ledger (user_id, created_at desc);

-- 출석은 ref_id = 'YYYY-MM-DD' (KST) 로 하루 1회 보장
create view point_balances as
  select user_id, coalesce(sum(amount), 0) as balance from point_ledger group by user_id;
```

### 3.8 일정·콘텐츠 캘린더

```sql
create table schedules (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references artists(id),
  type        schedule_type not null,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  place_name  text,
  address     text,
  lat         double precision,
  lng         double precision,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on schedules (artist_id, starts_at);

-- 일정별 알림 끄기
create table schedule_notification_optouts (
  user_id     uuid references profiles(id) on delete cascade,
  schedule_id uuid references schedules(id) on delete cascade,
  primary key (user_id, schedule_id)
);

create table content_calendar (
  id           uuid primary key default gen_random_uuid(),
  artist_id    uuid not null references artists(id),
  date         date not null,
  topic        text not null,
  example_text text,
  created_by   uuid references profiles(id),
  unique (artist_id, date)
);
```

### 3.9 알림 큐

```sql
create table notification_jobs (
  id           bigserial primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  channel      notification_channel not null,
  template_key text not null,                    -- 'new_message', 'billing_notice', 'schedule_notice', 'report_resolved'
  payload      jsonb not null,                   -- 치환 완료된 제목·본문·링크
  status       notification_status not null default 'queued',
  attempts     smallint not null default 0,
  last_error   text,
  scheduled_at timestamptz not null default now(),
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on notification_jobs (status, scheduled_at) where status = 'queued';
```

### 3.10 집계·정산

```sql
create table artist_weekly_stats (
  artist_id       uuid not null references artists(id),
  week_start      date not null,                  -- 월요일 (KST)
  message_count   integer not null default 0,
  photo_count     integer not null default 0,
  subscriber_count integer not null default 0,
  new_subscribers  integer not null default 0,
  churned_subscribers integer not null default 0,
  computed_at     timestamptz not null default now(),
  primary key (artist_id, week_start)
);

create table settlements (
  id               uuid primary key default gen_random_uuid(),
  artist_id        uuid not null references artists(id),
  month            date not null,                 -- 해당 월 1일
  gross_krw        integer not null,              -- 구독 매출(부가세 포함)
  vat_krw          integer not null,
  pg_fee_krw       integer not null,
  base_amount_krw  integer not null,              -- 정산 기준 금액
  rate             numeric(4,3) not null,         -- 0.300 | 0.400
  activity_ratio   numeric(4,3) not null,         -- 실제/계약 활동량, 상한 1.0
  deduction_krw    integer not null,
  final_amount_krw integer not null,
  breakdown        jsonb not null,                -- 계산 근거 전체(감사용)
  status           settlement_status not null default 'draft',
  created_at       timestamptz not null default now(),
  confirmed_at     timestamptz,
  unique (artist_id, month)
);
```

### 3.11 측정 이벤트

Firebase/Amplitude 없이 시작한다. 이벤트는 DB에 적재하고 어드민 대시보드가 집계한다. 외부 분석 도구는 어댑터로 나중에 붙인다.

```sql
create table analytics_events (
  id          bigserial,
  user_id     uuid,                               -- 비로그인 이벤트 허용
  name        text not null,                      -- 10장 이벤트명 그대로
  properties  jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  primary key (id, occurred_at)                 -- 파티션 테이블의 PK에는 파티션 키가 들어가야 한다
) partition by range (occurred_at);
-- 월별 파티션은 마이그레이션에서 생성
create index on analytics_events (name, occurred_at);
```

---

## 4. RLS 정책 요약

| 테이블 | 팬(authenticated) | 가수(artist) | 어드민 | 비고 |
| --- | --- | --- | --- | --- |
| `app_settings` | 읽기 (공개 키만: `public.*`) | 동일 | 전체 | 서버는 service_role |
| `profiles` | 본인 행 읽기·수정(`role` 제외) | 본인 행 | 전체 | 가수가 팬 프로필을 직접 읽는 정책 없음 |
| `artists` | `status='active'` 읽기 | 소속 가수 | 전체 | |
| `subscriptions` | 본인 행 읽기 | 없음 | 전체 | 쓰기는 서버 함수만 |
| `payment_events` | 본인 구독 건 읽기 | 없음 | 전체 | |
| `messages` | `is_preview` 또는 `has_active_access()` 통과 시 읽기 | 소속 가수 CRUD | 전체 | **body 원문 노출 주의**: 팬 조회는 반드시 서버 치환 API 경유 |
| `replies` | 본인 쓰기·읽기 | 소속 가수 읽기 (조인은 `call_name`만) | 전체 | |
| `posts`/`comments` | 읽기, 본인 쓰기·수정, 소프트 삭제 | 동일 | 전체 | 숨김·공지는 어드민만 |
| `point_ledger` | 본인 읽기 | — | 전체 | 쓰기는 서버 함수만 |
| `schedules` | 읽기 | 읽기 | 전체 | |
| `notification_jobs` | 없음 | 없음 | 전체 | 서버 전용 |
| `settlements` | 없음 | 소속 가수 `confirmed` 읽기 | 전체 | |

역할 판별은 `profiles.role`을 보는 헬퍼 함수로 통일한다:

```sql
-- 주의: current_role 은 Postgres 예약 함수 이름이라 쓸 수 없다
create function auth_user_role() returns user_role language sql stable security definer as $$
  select role from profiles where id = auth.uid();
$$;
create function is_artist_member(p_artist uuid) returns boolean language sql stable security definer as $$
  select exists (select 1 from artist_members where artist_id = p_artist and user_id = auth.uid());
$$;
```

> **메시지 조회는 RLS만 믿지 않는다.** 팬 대화방 API는 서버에서 `has_active_access`를 다시 확인하고 `{이름}`을 치환해 돌려준다. 클라이언트가 `messages` 테이블을 직접 SELECT하는 코드는 리뷰에서 반려한다.

---

## 5. Storage 버킷

| 버킷 | 공개 | 읽기 정책 | 쓰기 | 최대 크기 |
| --- | --- | --- | --- | --- |
| `avatars` | 공개 | 전체 | 어드민 | 2 MB |
| `message-media` | 비공개 | 서명 URL(서버가 구독 확인 후 발급, 유효 1시간) | 가수·어드민 | 사진 10 MB, 음성 20 MB, 영상 100 MB |
| `board-media` | 비공개 | authenticated | 팬 | 5 MB |

경로 규칙: `{bucket}/{artist_id}/{yyyy}/{mm}/{uuid}.{ext}`. 크기 상한은 `app_settings`의 `media.*` 키로도 복제해 두고 서버 검증에 쓴다.

---

## 6. 마이그레이션 파일 분할

```
supabase/migrations/
├── 0001_enums.sql
├── 0002_settings.sql
├── 0003_profiles.sql
├── 0004_artists.sql
├── 0005_subscriptions_payments.sql
├── 0006_messages_replies.sql
├── 0007_board_reports.sql
├── 0008_points.sql
├── 0009_schedules_calendar.sql
├── 0010_notifications.sql
├── 0011_stats_settlements.sql
├── 0012_analytics.sql
├── 0013_rls_policies.sql
└── 0014_storage_buckets.sql
```

타입은 `npm run db:types` (`supabase gen types typescript`)로 `src/types/database.ts`에 생성한다. 손으로 수정하지 않는다.
