# 공식 일정·콘텐츠 캘린더 DB 계약

## 범위와 권한

공식 방송·공연·행사·축제 일정, 장소·주소·좌표, 사용자별 일정 알림 opt-out, 월간 콘텐츠 기획과 관리자 감사 기록의 **데이터 기반**이다. 달력 화면, HTTP API, 지도 SDK/API/링크 생성기, 알림 큐·전송·Cron, 가수 활동량 대시보드는 아직 없다.

| 영역        | 익명·팬                                     | 소속 가수                           | 관리자                          |
| ----------- | ------------------------------------------- | ----------------------------------- | ------------------------------- |
| 공개 일정   | active 가수의 published 일정만              | 동일                                | 공개 API는 동일                 |
| 일정 관리   | 불가                                        | 불가                                | 모든 가수의 초안·공개 일정 CRUD |
| 콘텐츠 기획 | 불가                                        | active 소속 가수의 월간 기획 읽기만 | 모든 가수의 CRUD                |
| 알림 선호   | 로그인·팬 온보딩·현재 제한 없음일 때 본인만 | 현재 제한 없을 때 본인만            | 현재 제한 없을 때 본인만        |
| 감사 기록   | 불가                                        | 불가                                | 현재 제한 없는 관리자만 읽기    |

원문 API의 관리자 `upsertSchedule`/`deleteSchedule`/`upsertContentCalendar`와 가수 `getArtistCalendar` 구분을 따른다. `is_manager`와 멤버십만으로 기획 수정 권한을 새로 만들지 않는다. 직접 테이블 DML은 `service_role`을 포함한 애플리케이션 역할 모두 금지하며, 관리자도 지정된 RPC로만 변경한다. 팬의 유료 구독은 공개 행사 읽기나 본인 선호 저장의 조건이 아니다.

공개 정보는 로그인 상태나 이용 제한에 관계없이 공개다. 제한 사용자가 익명 공개 일정 조회를 할 수 있다는 것을 사적 캘린더나 쓰기 권한으로 해석하면 안 된다. 제한은 만료 시각 exclusive이며 mutation은 잠금 획득 후 실제 시각으로 다시 검사한다.

## 공개 projection과 식별자

- `schedule_catalog`는 의도적인 owner-rights, security-barrier, 읽기 전용 projection이다. 가수 active와 일정 published 조건을 자체 강제한다. 공개 필드만 명시하며 profile·이메일·전화번호·계약·`created_by`를 조인하거나 노출하지 않는다.
- `schedule_get(id)`는 존재하지 않거나 삭제·초안·비활성 가수의 일정이면 모두 `42501 SCHEDULE_UNAVAILABLE`이다. 관리자도 공개 detail 경로로 초안을 얻지 못한다.
- 관리자 원본 일정 SELECT는 안전한 열 grant + RLS를 함께 적용한다. 콘텐츠 캘린더의 직접 읽기도 소속/역할 RLS와 작성자 열 제외를 적용한다. `SELECT *` 대신 명시된 안전한 열을 사용해야 한다.
- 공식 가수 URL 식별자는 기존 `artists.slug`(`^[a-z0-9]+(-[a-z0-9]+)*$`)다. 공개 결과에 현재 slug를 포함한다. 내부 FK·RPC는 변경되지 않는 artist UUID, 일정 detail은 schedule UUID(`/schedules/[id]`)를 사용한다. 일정별 두 번째 slug 체계를 만들지 않는다.
- 가수 slug를 서버에서 UUID로 확인해 요청하고 slug 문자열을 UUID로 가장하지 않는다. 가수 route 변경으로 일정/FK 정체성이 바뀌지 않는다.

## 일정·시간·월 조회

`type`은 broadcast/concert/event/festival, `status`는 draft/published다. 생성은 기본 draft이고 공개는 관리자가 명시한다. 관리자는 inactive 가수의 기획용 일정도 관리할 수 있지만 공개 projection에 절대 나타나지 않는다.

- 시각은 `timestamptz`의 유한한 instant다. 월 API와 동일하게 시작은 KST 달력 연도 0001~9999이며 종료는 10000년 첫날 경계까지 허용한다. 콘텐츠 기획 date도 0001~9999년이다. 종료가 있으면 유한하며 시작보다 **엄격히 뒤**여야 한다. 종료가 없으면 순간 일정이고, 종료가 있는 일정은 `[starts_at, ends_at)`이다. NULL 시작, 무한 시각, 같거나 역전된 구간은 거절한다.
- `schedule_list(month, artist_ids?, after_starts_at?, after_id?, limit?)`의 month는 ISO 연도 0001~9999 내 **월 첫날 date**다. NULL·무한·월 중간 날짜는 `22023 CALENDAR_INVALID_MONTH`다.
- 월 경계는 `Asia/Seoul`에서 해당 월 첫날 00:00부터 다음 달 첫날 00:00 exclusive다. PostgreSQL session timezone/DST와 독립이다. 날짜 기반 콘텐츠 기획은 시각으로 변환하지 않고 해당 달의 date 범위로 읽는다.
- 기간 일정은 월과 **겹치면 포함**한다. 지난달 시작하여 이번 달까지 지속된 일정은 포함하지만 월 첫날 00:00에 정확히 끝난 것은 제외한다. 종료 없는 일정은 시작이 월 안에 있어야 한다.
- 순서는 `(starts_at ASC, id ASC)`이며 두 cursor 값을 함께 전달한다. 같은 시작 시각도 UUID tie-breaker로 건너뛰거나 중복하지 않는다. cursor를 한쪽만 주거나 무한 시각을 주면 거절한다. 응답 마지막 행의 두 값을 다음 페이지로 전달한다.
- 별도 snapshot을 저장하는 cursor는 아니다. 페이지 사이 관리자 변경이 있으면 일반 keyset pagination처럼 결과가 변할 수 있다. 필터를 바꾸면 cursor를 초기화한다.
- artist_ids NULL은 전체, 빈 배열은 없음이다. 잘못된/비활성 UUID는 아무 결과도 늘리지 않는다. NULL 배열 원소와 다차원 배열은 거절한다. 조회당 1~100개와 최대 100개 artist 필터는 운영 정책 기본값이 아니라 DB 응답/입력 크기 기술 상한이다.

## 장소·지도 안전성

장소 이름과 주소는 일반 텍스트이며 `lat`/`lng`는 둘 다 없거나 둘 다 있어야 한다. 위도 -90~90, 경도 -180~180만 허용하므로 NaN·무한·범위 밖 좌표는 저장할 수 없다. 단위는 WGS84 decimal degrees다.

**외부 URL을 저장하는 열이 없다.** 향후 `lib/map-links.ts`/어댑터가 검증된 좌표와 고정된 네이버·카카오 목적지/스킴으로 URL을 생성해야 한다. 주소·장소·설명 문자열을 URL/href로 실행하거나 임의 저장 URL을 열어서는 안 된다. 지도 생성·실행·외부 호출은 이번 기능에 포함하지 않았다.

문자열 최대 길이는 저장소 안전 한계(제목/주제 1,000, 설명/예문 100,000, 장소/주소 2,000자)다. 제목·주제·존재하는 장소/주소의 공백-only 입력은 금지한다. 팬 작성 커뮤니티의 moderation 정책과 혼동하지 않는다. HTML 해석·자동 링크화 없이 안전하게 렌더링하는 책임은 후속 UI에 남는다.

## 관리자 CRUD·감사

| RPC                                                                                                              | 계약                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `schedule_create(artist_id,type,title,starts_at,ends_at?,description?,place_name?,address?,lat?,lng?,status?)`   | 새 UUID 생성, actor는 auth.uid().                                                                |
| `schedule_update(schedule_id,type,title,starts_at,ends_at?,description?,place_name?,address?,lat?,lng?,status?)` | 기존 ID·가수·원작성자 불변. full replacement이므로 생략한 optional 값은 NULL, status는 draft.    |
| `schedule_delete(schedule_id)`                                                                                   | 물리 삭제 + opt-out FK cascade + 감사 기록을 한 트랜잭션에서 실행. 없는 ID/재삭제는 unavailable. |
| `content_calendar_upsert(artist_id,date,topic,example_text?)`                                                    | artist/date 유일 슬롯. 재편집은 같은 ID·원작성자를 유지한다.                                     |
| `content_calendar_delete(entry_id)`                                                                              | 항목 물리 삭제와 감사 기록. 없는 ID/재삭제는 unavailable.                                        |
| `content_calendar_list(artist_id,month)`                                                                         | 허용된 가수의 월간 주제/예문 안전 projection.                                                    |

실제 관리자 profile 역할을 잠금 아래 재검증한다. JWT의 임의 role metadata, `service_role`의 RLS 우회, 다른 사람 UUID 입력으로 관리자/작성자 신원을 주장할 수 없다. 작성/수정/삭제는 관리자 UUID, 대상 ID, 작업, 이전/이후 snapshot을 `calendar_audit_log`에 같은 트랜잭션으로 남긴다. 삭제 뒤에도 감사 target은 보존한다. 감사 테이블은 append RPC 경계 외의 변경을 허용하지 않는다.

기획 upsert는 artist 행 UPDATE 잠금으로 해당 가수의 신규 슬롯/수정을 직렬화하므로 서로 다른 관리자의 동시 upsert도 하나의 슬롯과 정확한 before/after 순서를 유지한다. 계정 삭제 cascade로 감사 작성자나 기획 원작성자를 지우지 않으며 별도 보존/익명화 정책이 필요하다.

## 알림 선호와 삭제 경합

`toggle` 대신 `schedule_set_notification(schedule_id, enabled)`의 **원하는 상태 설정**을 사용한다. false는 `(auth.uid(), schedule_id)` opt-out을 한 번만 넣고 true는 제거한다. 중복 false/true는 결과를 뒤집지 않는다. NULL은 거절한다. `schedule_get_notification`은 opt-out이 없으면 true를 반환한다.

이 boolean은 그 일정에 대한 선호일 뿐 **실제 발송 보장이나 전체 알림 동의**가 아니다. 후속 발송 서비스가 전역 알림 설정·사용자 상태·선호·일정/가수 현재 상태를 함께 재검증해야 한다. 기존 `app_settings`, notification preference, 실제 알림을 변경하지 않는다.

- 신원은 auth.uid()뿐이고 user_id를 받지 않는다. 다른 팬의 opt-out은 관리자에게도 이 경로로 노출하지 않는다.
- 선호 읽기·변경 모두 현재 공개 가능한 일정만 허용한다. draft/inactive 전환 시 기존 선호는 보존되지만 읽기/변경은 거절된다. 재공개 시 이전 사용자 선택을 존중한다.
- 잠금 순서는 actor profile UPDATE → artist SHARE → schedule UPDATE다. 역할 회수·가수 중지·일정 삭제 후 대기 중 mutation이 깨어나면 새 상태를 보고 거절한다.
- opt-out이 먼저 커밋되면 후속 일정 삭제의 FK cascade가 제거한다. 삭제가 먼저 잠금을 얻으면 대기하던 opt-out은 unavailable로 실패하며 고아 행을 만들지 않는다.
- 사용자 profile 삭제도 해당 사용자의 선호를 cascade한다. 삭제된 일정 ID를 update로 부활시키지 않으며 새 생성은 새 UUID를 사용한다.

## 검증·운영 경계

pgTAP는 CRUD, 모든 역할, grants/RLS, 역할 metadata 위조, 회원/관리자 제한, 데이터 projection, 감사, 월/윤년/UTC 경계와 cursor, NaN/무한/역전 구간, 중복 선호와 FK cleanup을 검증한다. 실제 Supabase PG17 CI는 전체 회귀 pgTAP를 2회 실행하고, 기존 24개 결제·메시지·커뮤니티 경합을 유지한 채 신규 7개 schedule/calendar 독립 psql 세션 검사를 추가한다.

로컬 PGlite PG18/synthetic Auth·Storage 결과는 보조 SQL 검증이다. 실제 Supabase·독립 세션·HTTP·외부 발송을 검증했다고 표시하지 않는다. 생성 타입은 실제 DB의 CI artifact를 그대로 다음 커밋에 반영하며 수동 작성하지 않는다. exact-head 전체 CI와 타입 drift gate 통과 전 병합하지 않는다. 운영 DB/실제 일정/계정·외부 초대·지도·알림·키·배포 작업은 이번 기능에서 하지 않는다.
