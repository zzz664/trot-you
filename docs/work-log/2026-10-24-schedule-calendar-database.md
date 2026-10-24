# 2026-10-24 공식 일정·콘텐츠 캘린더 DB 기반

## 범위와 결정

- PR #7 병합된 develop `8cb8d0962d53b4c7f08ab9e0653c2009177500c0`을 fetch/검증하고 `feature/schedule-calendar-database` 하나로 분기했다. 완료된 community 로컬 clean history는 외부 bundle로 안전하게 보존한 뒤 이전 기능 브랜치를 제거했다. develop/main 직접 push는 하지 않았다.
- 비공개 DB/API/frontend/분석의 일정 관련 계약을 읽고 공식 일정, 장소·유한 좌표, 본인 알림 opt-out, 콘텐츠 기획과 관리자 감사의 단일 기능으로 구현했다. 원문 파일은 공개하지 않았다.
- source에 쓰기 권한은 관리자, 가수 캘린더는 소속 읽기로 구분되어 있어 가수/manager에게 편집 권한을 임의로 부여하지 않았다.
- 공개 projection은 active 가수의 published 일정만 노출하고 raw 작성자·profile·이메일을 배제한다. 초안·비활성·없는/삭제 일정은 공개 detail과 선호 RPC에서 차단한다.
- 외부 URL 저장 대신 유한한 좌표 쌍만 저장한다. 실제 지도 링크 생성/호출, 달력 UI, 알림 큐/전송, 활동량 집계는 범위 밖이다.
- KST 월은 session timezone과 독립, 기간은 half-open overlap, 동시 시작 tie는 `(starts_at,id)` cursor로 정렬한다. 선호는 toggle 대신 멱등 desired-state 설정이다.
- 관리자 CRUD를 감사 snapshot과 묶고 actor→artist→event 잠금, 삭제 FK cascade와 fresh 권한 검사로 삭제/선호·가수 중지·역할 회수 경합을 처리한다. 기획은 artist별 직렬화로 날짜 유일 슬롯과 before/after audit 순서를 보호한다.

## 검증 상태

- 기존 **787개 pgTAP**를 유지하고 신규 **185개**(lifecycle 111, security 74)를 추가했다. 합계 **972개**가 보조 PGlite PG18에서 **2회 모두 통과**했다.
- `npm run check:all`: lint/Prettier, typecheck, **166개 단위 검사**, 대비 검사와 production build가 통과했다.
- 기존 **24개 독립 세션 경합**은 변경하지 않았다. 신규 **7개 일정·캘린더 경합**은 중복 opt-out, disable→enable, 삭제→선호/선호→삭제 양방향, 가수 중지, 관리자 역할 회수 및 콘텐츠 기획 동일 슬롯 upsert를 검증한다.
- 로컬 PGlite PG18 synthetic Auth/Storage는 보조 검증이며 실제 Supabase PG17/HTTP/동시 세션으로 표시하지 않는다.
- Docker 실행 파일이 없는 환경이므로 실제 Supabase PG17 lint/pgTAP/독립 세션은 CI에서 확인해야 한다. 로컬 브라우저의 알려진 실행 거절은 재시도하지 않는다. 화면/Next.js 행동은 변경하지 않았다.
- 첫 구현 커밋에서는 생성 타입을 수정하지 않았다. 아래 실제 CI genuine artifact를 두 번째 커밋으로 반영했고 이 커밋의 exact-head 전체 CI를 다시 확인해야 한다.
- 운영 DB/실제 행사/사용자·외부 초대/발송·지도 호출/키/배포는 변경하지 않았다.

접근권한·시간·cursor·잠금·삭제 및 후속 경계는 [일정·캘린더 DB 계약](../database/schedule-calendar.md)을 참고한다.

## 독립 검토

별도 read-only 검토자가 SQL·문서·테스트와 권한 경계를 검토하고 보조 SQL probe로 raw author whole-row 우회, 임의 actor 정보 조회, 날짜/배열 경계를 재현했다.

- 공백-only 문자열이 탭/줄바꿈도 포함하도록 강화했다.
- 월 API의 지원 연도와 일정·기획 저장 날짜 범위를 일치시켰다.
- 다차원 artist 배열을 명시적인 invalid-filter 오류로 거절했다.
- join projection UPDATE의 실제 오류는 view 비갱신 가능 오류55000임을 맞추고 별도로 DML grant 부재도 검사했다.

수정 후 독립 probe가 통과했고 남은 blocking finding은 없다. 감사 admin CRUD, 비공개 작성자 보호, KST half-open overlap, cursor와 opt-out 삭제 잠금 검토는 통과했지만 실제 Supabase PG17/동시 세션 CI 결과를 대신하지 않는다.

## 실제 Supabase CI 및 생성 타입 반영

- bootstrap exact head `aeb2bea7c40f3d8e1871c174a62fdef3c758bacf`, CI run `40060344126`을 독립 검증자가 확인했다. 실제 Supabase PostgreSQL **17.11.0.006**에서 reset/lint, **972 pgTAP × 2회**, **31개 독립 세션 경합**(결제 7 + 메시지 5 + 커뮤니티 12 + 일정·캘린더 7), 타입 생성/typecheck/정리가 통과했다. quality job의 **166개 단위검사·13개 E2E**도 통과했다. 실패는 새 스키마와 이전 생성 타입의 예상된 drift gate뿐이다.
- genuine `database-types` artifact ID `12547206718`: ZIP SHA-256 `697bebc3fe6838b110349b03b896c18ceabbee7e0d6f9580857916a347bb710e`. ZIP에는 `database.ts` 한 파일만 있다.
- 생성 파일은 **50,271 bytes / 1,647 lines**, SHA-256 `6acc80340f5d920ef99e731ad407234b8140e105ef970139cb3aa59aeee99d2e`를 검증하고 `src/types/database.ts`에 바이트 그대로 반영했다. 수동 보정은 하지 않았다.
- 게시된 구현 커밋과 로컬 구현 커밋의 tree가 `0e1eed3643231b4619d39f425cc738c6aa1eca4d`로 같은 것을 확인했다. 이전 clean 로컬 구현 커밋은 검증된 외부 bundle로 보존한 뒤 게시된 exact head로 안전하게 맞췄다. 이 후속 커밋의 범위는 생성 타입과 이 작업 기록뿐이다.
- 생성 타입 반영 후 `npm run check:all`을 재실행해 lint/format/typecheck, **166개 단위검사**, 대비 검사와 build가 모두 통과했음을 확인했다. 최종 타입 커밋의 실제 Supabase/브라우저 CI는 게시 후 확인해야 하며 아직 성공으로 간주하지 않는다.
