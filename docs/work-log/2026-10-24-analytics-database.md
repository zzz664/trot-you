# 2026-10-24 분석 이벤트 DB 기반

## 기준과 범위

- PR #10이 병합된 `develop`의 `026a935ce835f28a86360550c7f65db8e9fe0fc2`를 fetch한 뒤 exact SHA를 확인했다. 직전 로컬 `c28a727`은 `archive/notification-outbox-database-local`로 보존하고 같은 SHA임을 확인한 후 이전 로컬 feature 참조를 정리했다. 작업 branch는 `feature/analytics-database` 하나이며 develop/main 직접 push, 운영 DB, 실제 데이터, 외부 전송은 다루지 않는다.
- private 비파티션 이벤트 테이블, 13개 고정 이름과 strict Zod 계약, 최소 typed 속성, 본인 동의, client/service/verified charge 권한 분리, 멱등 수집, KST 일별 건수 및 service-only 보존 삭제 hook만 구현했다. 원본의 파티션 키 없는 PK 오류를 비파티션 MVP + 시간/종류 인덱스로 해소했다.
- 일반 JSON properties를 저장하지 않고 UUID source·font enum·voice context enum으로 제한한다. 개인 이름·email·본문·키·URL·IP·기기/session·fingerprint를 넣는 API/열은 없다. user_id는 개인 연결 정보이므로 raw 행은 private이며 admin/service조차 직접 읽을 수 없다.

## 승인·서비스 경계

승인된 동의 version/retention 정책을 seed하지 않아 기본적으로 수집이 차단된다. 사용자 metadata는 동의가 아니며 `analytics_set_consent`는 실제 본인 `auth.uid()`만 받는다. restricted 계정도 철회할 수 있다. profile 잠금으로 철회와 수집을 직렬화하고 새 policy version/재동의는 과거 source를 소급 수집하지 않는다.

클라이언트 관측은 `message_open`, `voice_input_used` 두 종류만 허용하며 actor/time을 지정할 수 없다. 클라이언트 관측의 진위나 속도 제한을 구현했다고 주장하지 않는다. 다른 이벤트는 서비스 경로이며 실제 source 소유/상태/시각을 확인한다. 미래 HTTP service는 actor를 검증 세션에서 결정해야 한다.

`subscribe_complete`/`renew`는 별도 함수가 검증 charge 원장 + verification + success attempt + settled obligation에서 사용자·initial 여부·시각을 유도한다. failed/unknown/refund는 결제 성공으로 집계하지 않는다. 분석 함수는 돈·구독·금융 원장을 변경하지 않는다. 자동 domain hook은 없고 미래 서비스가 성공한 finalize 뒤 또는 검증 원장 replay로 호출해야 한다. 수집 거절을 이유로 실제 외부 결제를 재시도하지 않는다.

발생 시각과 기록 시각은 서버 증거/DB clock이며 finite다. 동의는 먼저 commit하고 domain action을 시작한다. 같은 transaction의 기존 `now()` source가 동의 clock보다 빠르거나 provider 초 정밀도 때문에 같은 초 승인 시각이 동의보다 빠르게 보이면 안전하게 거절한다. 금융 시각을 임의 보정하지 않으며 서비스 통합의 명시적 제한이다.

## 독립 검토와 멱등성 보완

- client가 본인에게 알려진 payment UUID를 retry key로 먼저 사용해 verified charge 수집을 막는 위험을 확인했다. `(user_id, origin, event_key)`로 권한 namespace를 분리해 결제 지표를 client key로 점유할 수 없게 했다.
- 동일 source에 새 key를 보내면 기존 ID를 성공 반환하되 새 key를 저장하지 않던 alias 계약 문제가 있었다. 다른 key의 동일 source 요청을 명시 conflict로 바꿨다. 성공한 key는 payload에 고정되며 실제 source별 건수도 한 번이다.
- signup·실제 creation/failure/charge는 source identity로 한 번이고, cancel은 `(source, canceled_at)`로 episode를 구분한다. source-derived 시각도 같은 key의 불변 payload로 검사한다. 관측 이벤트의 영구 key/tombstone 저장소는 만들지 않았으며 보존 기간 안에서 dedupe한다.
- 독립 read-only 검토의 PGlite probe로 namespace·alias 수정, raw table/private helper 권한 차단, fan/anon 집계 거절, admin의 KST 3필드 집계 및 유한 날짜 범위를 확인했다. 해당 probe는 실제 Supabase나 다중 세션 검증이 아니다.

## 명시적 미완료

익명 acquisition 이벤트는 전체 MVP에서 삭제하지 않았으며 동의·철회·멱등성 모델 정의 후 통합하는 항목이다. 현재 `anon` 수집/nullable actor/device identifier를 임의로 열지 않는다. 원본의 네 가지 퍼널/KPI 이름·단계 순서·분모/분자·관찰 기간·중복/재가입 처리 정의가 제공되지 않아 수식은 만들지 않았다. 이번 집계는 KST 날짜별 이벤트 관측 건수이고 전환율·사용자 퍼널 완성이 아니다.

UI/SDK, `/api/analytics` 및 다른 HTTP API, 자동 source hook, 외부 분석 adapter, 데이터 전송, 대시보드, scheduler/Cron, 운영 동의·보존 정책 활성화는 별도 후속 구현이다. 실제 분석 MVP나 실결제 운영 완료로 표현하지 않는다.

## 검증 경로

기존 1,421개 pgTAP와 68개 다중 세션 경합을 보존한다. 새로운 분석 pgTAP와 10개 실제 psql 경합, 별도의 source/event rollback visibility check를 추가했다. PostgreSQL `pg_blocking_pids`로 겹침을 입증하고 병렬 retention은 SKIP LOCKED 동작을 확인하도록 CI에 연결했다. 실행 대상은 CLI-managed disposable local Supabase뿐이고 기존 실제 사용자/설정 행이 있으면 fixture 작성/teardown reset을 거절한다.

Docker executable이 없는 이 환경에서는 실제 Supabase PG17/Auth/Storage reset·linter·pgTAP·독립 psql 경합·genuine 타입 생성을 실행할 수 없다. 기존 PGlite PG18/synthetic Auth·Storage harness는 migration/test 보조 검사로만 사용한다. 로컬 브라우저의 기존 제한은 재시도하지 않았고 UI는 변경하지 않았다.

CI 순서는 기존 reset/lint → 전체 pgTAP 두 번 → 기존 68개와 신규 10개 경합/rollback → genuine 생성 타입/typecheck → artifact 업로드 → committed type drift 검사를 유지한다. `src/types/database.ts`는 손으로 작성하지 않았다. bootstrap은 타입 drift gate 실패가 예상되며 실제 artifact를 반영한 후 exact-head 전체 gate 통과 전에는 병합하면 안 된다. CI의 기존 13개 E2E도 유지한다.

## 로컬 최종 결과

- 신규 pgTAP lifecycle 64개 + security 134개 = 198개를 추가했다. 기존 1,421개를 포함한 총 1,619개가 supplemental PGlite PG18/synthetic Auth·Storage에서 두 번 모두 통과했다. 13종 authorized ingestion, 실제 billing RPC로 initial/unknown/failure/renewal/refund 분리, 타인 source 거절, malformed 속성, 동의·role·raw 권한, KST 정확 경계, retention 범위, key namespace/alias/cancel episode, source rollback을 포함한다.
- 10개 신규 실제 psql 경합과 별도의 source/event rollback visibility check를 CI에 연결했고 기존 68개 경합은 그대로 유지했다. Node syntax·ESLint·Prettier 및 fixture/RPC의 PGlite **순차** smoke는 통과했으며 실제 경합 통과 수로 계산하지 않는다.
- `npm run check:all`의 lint·strict typecheck·11 files / 240 unit tests·10개 대비 조합·production build가 통과했다. 분석 strict schema unit test 73개가 신규이며 기존 167개를 보존한다. 독립 최종 read-only 검토에서 남은 차단 결함은 없었다.
- 로컬 검증 로그는 `/tmp/trot-you-db-check/analytics-final-verification.log`, `analytics-tap-1.txt`, `analytics-tap-2.txt`, `analytics-final-check-all.log`와 review/concurrency sequential smoke 파일에 있다. 실제 사용자 데이터나 비공개 원문을 commit하지 않는다.
- 실제 Supabase lint·pgTAP 1,619개 두 번·68+10 다중 세션 경합과 rollback visibility·genuine 타입 artifact·committed drift·기존 브라우저 E2E 13개는 원격 exact-head CI에서 확인할 **대기 항목**이다. 생성 타입을 반영하고 같은 head 전체 CI가 통과하기 전에는 완료/병합 상태로 표현하지 않는다.

## 실제 CI 검증과 genuine 생성 타입 반영

- [PR #11 CI 40066424402](https://github.com/zzz664/trot-you/actions/runs/40066424402)는 원격 head `d1d2c243909540c967f946c5a117c3146a4bb5bb`에서 실행했다. checkout merge commit은 `245b36edf96c036393e50352c761eca1217ddcfe`이고 기준 develop은 `026a935ce835f28a86360550c7f65db8e9fe0fc2` 그대로다. 로컬 bootstrap `8996d1ead7fa4dff2643291675021644f511c651`과 원격 head의 tree가 `3f8c79df0c4f36cff467c1f1a4e4547525204401`로 동일함을 확인했다. 로컬 기록을 `archive/analytics-bootstrap-8996d1e`에 보존한 뒤 원격 head에서 후속 변경을 준비했다.
- 실제 Supabase PG17 환경에서 시작/reset/SQL lint, pgTAP 1,619개 두 번, 독립 psql 경합 78개(기존 68 + 분석 10)와 source/event rollback visibility, genuine 타입 생성/typecheck, cleanup이 통과했다. quality의 240 unit tests·build·브라우저 E2E 13개도 통과했다. 앞선 PGlite 보조 검사와 구분되는 실제 CI 증거다.
- 이 run의 최종 실패는 예상된 committed generated-type drift 검사뿐이다. 실패 run 자체를 전체 CI 통과로 표시하지 않는다. 생성 타입을 반영한 다음 exact-head CI에서 drift를 포함한 전체 gate 통과를 확인해야 병합할 수 있다.
- 해당 run의 `database-types` artifact `12550090216`을 반영했다. ZIP SHA-256은 `52af6e3eefba849089826699ca8327c07dd9d534f72b5b0d0cc7932af3e64be4`로 보존된 GitHub artifact metadata와 일치한다. 추출된 `database.ts`는 56,107 bytes, SHA-256 `8eb38c94479189c5675e56b13d15e1e91615099143deaef807d5898488d1a77f`다. `src/types/database.ts`로 byte-identical 복사하고 `cmp` 및 SHA-256을 다시 확인했으며 수동 수정하지 않았다.
- 이 후속 변경 범위는 생성 타입과 본 기록 두 파일뿐이다. 승인된 정책 활성화·실제 사용자 수집·외부 analytics 전송·운영 DB 변경은 하지 않았으며 위의 미구현 경계는 유지한다. 새 타입을 포함한 로컬 `npm run check:all`로 lint/typecheck/240 unit tests/10개 대비 조합/build를 다시 확인했고 모두 통과했다. 원격 exact-head 전체 CI는 부모 작업에서 확인한다.
