# 출석·포인트 원장 DB 계약

## 범위와 활성화 경계

KST 하루 한 번 출석, 게시글·댓글 생성과 같은 트랜잭션의 보상, 본인 잔액·내역, 관리자 감사 보정을 구현한다. 포인트는 **현금·환급·출금·송금·정산이 아닌 비금전 활동 기록**이다. 화면, HTTP/서비스 어댑터, 실제 계정·외부 전송·운영 설정 변경은 포함하지 않는다.

`private.point_policy`에는 migration/seed 기본 행이 없다. 기존 TypeScript registry의 출석/게시글/댓글/공유 10/20/5/5는 문서 기반 draft일 뿐 승인이나 runtime fallback이 아니다. 신뢰된 설정 서비스가 버전·세 적립량·일일 cap·삭제 처리 정책을 명시적으로 검토한 snapshot을 작성해야 활성화된다. 일반 사용자 및 클라이언트 관리자는 정책을 쓸 수 없다. 실제 `app_settings` 연결과 운영 승인 UI는 후속 작업이다.

정책 행이 없으면 신규 출석은 `POINT_POLICY_UNCONFIGURED`로 실패하고, 기존 커뮤니티 생성 기능은 **포인트 없이** 정상 동작한다. 이를 보상 성공으로 표시하면 안 된다. 정책 없이 작성한 과거 콘텐츠는 나중에 생성 RPC를 재호출해도 소급 적립되지 않는다. 이미 적립한 당일 출석 재조회는 정책 제거 뒤에도 같은 ID를 반환한다. 모든 재조회는 현재 권한을 먼저 검사한다.

`point_capabilities()`는 `rewards_configured`와 별도로 `share_configured`, `missions_configured`, `grades_configured`를 항상 false로 반환한다. 공유 검증·미션 조건·활동 점수 공식은 아직 정의되지 않았다. 공유를 클릭했다고 적립하거나 포인트 잔액을 등급 점수로 간주하지 않는다. 기존 등급 threshold draft도 비활성 상태를 바꾸지 않는다. **공유/미션/등급은 전체 MVP의 미완료 항목이지 범위 제외가 아니다.**

## 원장·권한·수량

- `private.point_ledger`의 일반/관리자/`service_role` 직접 SELECT·INSERT·UPDATE·DELETE·TRUNCATE를 모두 막는다. 사용자 공개 조회는 호출자 고정 RPC뿐이다. UPDATE/DELETE/TRUNCATE는 불변 trigger로도 차단한다. 운영 DB 소유자는 감사 목적 SQL을 사용할 수 있으며 소유자의 임의 DDL 방어를 주장하지 않는다.
- `user_id, reason, ref_id`는 NULL 불가·유일하다. 출석은 서버 KST 날짜, 글/댓글은 실제 UUID와 FK다. 임의 사용자 ID·적립량·참조 문자열을 받는 보상 RPC가 없다. 삭제 cascade로 기록을 잃지 않도록 사용자·콘텐츠 FK는 RESTRICT다.
- 계정 역할은 JWT metadata가 아니라 실제 profile에서 확인한다. 현재 이용 제한 중인 사용자와 온보딩 미완료 팬은 적립·잔액·내역·capability 모두 거절한다. 제한 종료 시각은 exclusive다. 관리자도 다른 사람의 잔액·내역을 읽는 공개 RPC는 없다. 가수 역할 자체는 기존 커뮤니티 user 권한과 동일하게 자기 활동만 적립한다.
- 원장 합계가 잔액이다. 수정 가능한 balance cache는 없다. `SUM(bigint)`의 numeric 중간값으로 검사하고 결과를 `0..9007199254740991` 안에 제한한다. 이는 JSON/JavaScript 정확 정수의 기술 상한이며 제품 보상 cap이 아니다. 상한 초과/음수 잔액을 만드는 작업은 전체 rollback한다.
- 적립량 0 또는 cap 소진은 0점 원장 행으로 기록한다. 동일 원인에 재시도해 나중에 점수를 얻지 못한다. `policy_version`과 실제 적용한 전체 `policy_snapshot`을 보존하므로 현재 설정이 바뀌어도 과거 계산은 바뀌지 않는다.

## 원자적 생성·멱등성·삭제

기존 `community_create_post`/`community_create_comment`의 실제 INSERT에 AFTER trigger가 연결된다. 신원·현재 제한·온보딩·active 가수·공개 부모·텍스트·작성 rate 검증을 통과해 저장되는 자기 콘텐츠만 보상한다. 새로운 별도 claim이나 비동기 적립 큐를 도입하지 않았다. 포인트 오류가 나면 콘텐츠, 작성 rate, 댓글 카운트와 원장이 함께 rollback한다.

기존 작성 요청 UUID 재시도는 같은 콘텐츠 ID를 반환하고 INSERT trigger가 다시 실행되지 않는다. 같은 UUID에 다른 payload는 기존 conflict를 유지한다. 수정·좋아요·공지 승격·복구는 새로운 적립 원인이 아니다.

각 일일 cap은 **그 사용자의 해당 사유별 KST 일자에 기록한 생성 횟수**다. 정수 N이 설정되면 앞 N개 원인만 설정 금액을 받는다. 0은 모두 0점, NULL은 별도 일일 cap 없음이다. 커뮤니티 작성 rate 제한은 계속 독립 적용된다. NULL을 임의의 숨겨진 수치 cap으로 바꾸지 않는다. cap 변경은 이후 새로운 원인에만 적용되며 이전 0점 원인을 보충하지 않는다. 미설정 기간의 콘텐츠는 원장 생성 횟수에도 포함하지 않는다.

지원하는 삭제 처리 snapshot은 반드시 `deleted_content_treatment='retain'`을 명시해야 한다. **이 정책을 승인하지 않으면 활성화하지 않는다.** 숨김/삭제/가수 중지는 기존 원장과 잔액을 자동으로 회수하거나 복구하지 않는다. 재생성 요청도 재적립하지 않는다. 필요한 보정은 승인된 관리자가 사유를 남겨 별도 delta로 추가한다. 자동 몰수·경제적 권리·현금 가치를 추정하지 않는다.

## RPC

| RPC                                                     | 계약                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `point_check_attendance()`                              | 호출자 고정. 서버 시각의 KST 날짜별 원장 ID 하나. 일자·금액·사용자 입력 없음.                                                        |
| `point_balance()`                                       | 호출자 원장 합계. 내역 없는 사용자는 0.                                                                                              |
| `point_history(limit, before_created_at, before_id)`    | 본인만. 기본 30/최대 100의 기술 페이지 한계. `(created_at DESC,id DESC)` keyset. 두 cursor 값은 함께 전달해야 함.                    |
| `point_capabilities()`                                  | 현재 보상 설정 유무와 공유/미션/등급의 명시적 미설정 상태.                                                                           |
| `point_admin_adjust(user_id, request_id, amount, note)` | 현재 관리자만. 사용자별 비금전 감사 delta 추가. 동일 관리자/request의 같은 payload 재시도는 같은 ID, 다른 대상/금액/사유는 conflict. |

관리자 보정은 0이 아닌 정확 정수와 공백 아닌 1..1000자 사유가 필요하다. 현재 제한·온보딩 규칙은 대상에게도 적용하며 삭제된 사용자나 제한 중인 사용자를 우회하지 않는다. 관리자 ID, 대상, 요청 UUID, delta, 사유, 시각을 private 원장에 보존한다. 일반 내역에는 관리자의 UUID·사유 원문을 노출하지 않는다. 관리자 보정은 정책 장애 중 감사 복구를 위해 보상 설정 행 없이 가능하다. 계정 권한을 바꾸거나 포인트를 이체하지 않는다.

## 잠금·시각·동시성

일반 보상/조회는 actor profile UPDATE 잠금으로 직렬화한다. 커뮤니티의 actor → artist → post → comment 잠금 순서를 유지하며 정책 행 SHARE 잠금을 추가한다. 관리자 보정은 actor/target profile을 UUID 정렬 순서로 잠근 뒤 현재 권한을 재검사한다. 기존 역할 변경 RPC도 같은 정렬 순서로 보완해 역할 변경과 보정 사이의 역순 잠금 deadlock을 방지한다. 설정 서비스는 정책 변경 트랜잭션 안에서 profile/커뮤니티 변경을 섞지 않아야 한다. 서로 역순으로 여러 RPC를 묶는 임의 다중 요청 트랜잭션까지 deadlock-free라고 주장하지 않는다.

출석은 actor 잠금을 획득한 뒤 `clock_timestamp()`를 KST로 변환하며, 정책 잠금을 기다렸으면 다시 시각을 읽는다. transaction 시작 시각·클라이언트 일자·session timezone을 사용하지 않는다. 하루 경계는 UTC 15:00이며 KST에는 DST가 없다. 동일 사용자 원장 쓰기와 cap 검사는 같은 profile 잠금 아래에서 수행한다. 정책 변경이 먼저 잠겼으면 대기 중 적립은 새 snapshot을 사용하고, 적립이 먼저 읽었으면 변경은 해당 적립 commit을 기다린다.

## 검증·후속 작업

pgTAP은 실제 SQL 권한/불변성/격리/재시도/원자적 rollback/정수 상한/정책/cursor/KST 경계를 검증한다. 독립 psql 세션은 `pg_blocking_pids`로 실제 대기를 관찰해 중복·cap·보정·권한 변경·정책 snapshot·rollback 경합을 검증한다. 테스트는 허구의 로컬 fixture만 사용하고 종료 시 disposable DB를 reset한다. 기존 전체 pgTAP과 31개 동시성 회귀를 유지한다.

로컬 PGlite PG18 및 synthetic Auth/Storage는 보조 검증이며 실제 Supabase PG17·HTTP·브라우저·독립 세션 결과가 아니다. CI에서 실제 Supabase lint, pgTAP 두 번, 기존 및 신규 경합을 실행하고 실제 생성 타입 artifact를 두 번째 커밋에 반영한다. 수동 타입을 생성 결과로 가장하지 않으며 exact-head CI가 모두 통과해야 병합한다.

전체 MVP에 남은 일: 승인된 운영 설정 서비스와 어드민 화면, 출석/원장 UI 및 HTTP 서비스, 공유/미션 검증, 활동점수·등급 산식/업데이트 정책, 남용 탐지와 cap 승인, 계정 보존/익명화 정책, 사용자에게 설명할 확정 정책. DB 기반을 이 항목들의 완성으로 표시하지 않는다.
