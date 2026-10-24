# 2026-10-24 출석·포인트 원장 DB 기반

## 구현 범위

- 기준: 병합된 일정 PR 이후 `develop`의 `e929fcd00c248c40c070b7898f780599a81292ec`. 이전 로컬 일정 커밋은 보존용 archive 브랜치로 이름을 바꾸고 `feature/points-ledger-database` 하나에서 작업한다. develop/main 직접 push나 운영 배포는 하지 않는다.
- KST 하루 한 번 출석, private 불변 원장, 본인 잔액/내역, 실제 게시글·댓글 INSERT와 같은 트랜잭션의 보상, 관리자 비금전 감사 보정을 추가했다.
- 기존 글/댓글 작성 RPC의 인증·본문·작성 rate·소유권·부모 공개 상태 검증을 유지한다. 보상 실패는 콘텐츠/댓글 count/rate와 함께 rollback하며 별도 arbitrary claim API나 비동기 중복 적립을 만들지 않았다.
- 보상 설정 기본 행은 없다. 기존 10/20/5/5 draft는 runtime fallback이 아니며 활성화 승인·cap·삭제 처리 미결정을 registry에 명시했다. 공유·미션·등급은 capability false로 남기며 전체 MVP 후속 항목으로 유지한다.
- 숨김/삭제 기록 보존은 `retain` 정책의 명시적 승인을 전제로 한다. 자동 몰수, 현금 가치, 실제 송금/환급을 발명하지 않았다. 0점 원인도 한 번 기록해 cap 변경 뒤 재적립을 막는다.
- 원장 사유/참조는 NULL 불가이고 실제 콘텐츠 FK를 보존한다. 합계는 numeric 중간값과 JSON 정확 정수 상한으로 검사하며 음수 잔액/overflow를 거절한다. 적용 policy 전체 snapshot과 보정 관리자/사유는 private 감사 기록에 남긴다.

## 독립 검토와 보완

- read-only 독립 검토에서 기존 역할 변경 RPC의 actor→target 순서와 신규 보정의 정렬 profile 순서가 역전될 수 있음을 확인했다. 이번 migration에서 역할 변경도 UUID 정렬 잠금 뒤 현재 권한을 검사하도록 보완했다. 기존 역할 오류 계약과 membership 정리는 유지한다.
- 이 결함은 단순 완성 RPC 두 개의 순차 재시도로 드러나지 않으므로, 낮은 target 잠금 → 높은 admin의 역할 변경 대기 → 같은 admin 보정의 정확한 교차 RPC interleave를 16번째 경합 검사에 추가했다.
- 일반 원장의 보정 ref에 들어 있는 관리자 UUID를 공개 projection에서 제거했다. private dedupe/audit identity는 보존하고 본인 내역에는 request UUID만 반환한다.
- 수정 뒤 독립 read-only 검토에서 남은 차단 결함은 없었다. 별도 PGlite 보조 probe 13개도 통과했으며 실제 PG17 경합/CI 검증은 이 결과에 포함하지 않는다.

## 검증

- `npm run check:all`: lint/Prettier, strict typecheck, 10 files / 167 unit tests, 10개 대비 조합, production build 통과. UI 동작 변경은 없다.
- 새 pgTAP lifecycle 114개 + security 98개 = 212개를 추가했다. 기존 972개를 그대로 포함한 총 1,184개가 PGlite 보조 환경에서 두 번 통과했다. 출석·KST 경계·cap·정책 snapshot·원자적 rollback·삭제 보존·보정·권한·위조·불변성·동일 시각 cursor·정수 경계를 검사한다.
- 신규 독립 PostgreSQL 경합 16개: 중복 출석/글/댓글, 별도 사유 cap, 동시 차감, 보정 멱등성/대상 conflict, 현재 제한/관리자 권한 회수/가수 중지, 정책 snapshot 양방향 순서, 삭제 재시도, rollback 회복, 역할 변경과 보정의 교차 잠금. 기존 31개 경합은 그대로 유지한다.
- 로컬 Node syntax/ESLint/Prettier로 신규 경합 harness를 검사했다. 실제 `pg_blocking_pids` 대기와 PostgreSQL commit/rollback 검사는 CI에서 수행한다.
- 로컬 Docker 명령이 없어 실제 Supabase PG17/Auth/Storage lint·pgTAP·독립 세션·타입 생성은 여기서 실행하지 못했다. PGlite PG18/synthetic Auth·Storage 보조 검증은 실제 Supabase 통과로 표시하지 않는다.
- 기존 브라우저 실행 제한을 재시도하지 않았다. UI는 변경하지 않았으며 CI의 기존 E2E는 유지한다.

## CI와 다음 경계

CI database job에 신규 경합을 추가했다. 실제 Supabase의 lint → pgTAP 2회 → 기존31+신규16 경합 → genuine 타입 생성 → typecheck → artifact 업로드 → committed type drift 검사 순서를 유지한다. 첫 커밋은 schema type drift가 예상되며 실제 CI artifact를 받아 두 번째 한국어 커밋으로 반영하고 exact-head CI 통과 후 병합해야 한다. 수동으로 타입을 작성하지 않았다.

운영 정책 서비스/승인 화면, 출석·내역 UI/HTTP 서비스, 공유·미션 검증, 활동 등급 공식, 남용 탐지·cap 승인, 보존/익명화 정책은 미완료다. 이 DB 기반을 전체 MVP 완료나 운영 활성화로 표시하지 않는다. 실제 계정 생성·외부 발송·결제·금전 지급은 수행하지 않았다.
