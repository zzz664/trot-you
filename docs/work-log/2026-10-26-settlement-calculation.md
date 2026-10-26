# 2026-10-26 정산 순수 계산과 주간 통계

## 기준과 범위

- 이전 clean tip `1d209b1dcf7c8cea0ca08cfea60eb3e2621171ad`의 bundle을 비공개
  `/workspace/shared/trot-you-checkpoints/before-settlement-calculation-1d209b1.bundle`에
  생성하고 검증했다. fetch 결과 develop
  `e0a8f8be79d5b4f3792eb84128865c4ef84e2f3c`, tree
  `838c75590b8f6505686018966e0bdce2d6130696`가 이전 tip tree와 동일하다.
- 이전 feature 참조는 `archive/analytics-funnel-final-1d209b1`에 보존하고
  develop을 fast-forward한 뒤 `feature/settlement-calculation` 하나만 시작했다.
- 비공개 설계 04 §3, 02의 정산·활동량, ANALYSIS의 정밀도·정책 공백과 기존
  migration09 정산 기반을 확인했다. 원문은 저장소에 게시하지 않는다.
- 기능40: read-only 관리자 입력 snapshot, 승인 artist/month 정책, 검증된 성공
  원장, KST 주간 통계, 순수 정밀 월별 계산. 기능41 리포트/확정/Excel, UI,
  실지급·PG·Cron·배포·실운영 설정 변경은 제외한다.

## 검증 계획과 최신 지시 준수

구현 검사 전에 부모에게 변경 범위만 검사하는 계획을 전달했다. 현재 baseline에
묶인 `ci/scopes/settlement-calculation.json`에 정확한 변경 파일과 unit/SQL/race/
upgrade 선택 및 제외 이유를 기록한다. 기존 CI workflow의 PR-only scoped runner를
유지하고 이전 analytics manifest를 재사용하지 않는다. 미매핑은 오류이며 전체
검사로 확대하지 않는다. historical tests는 삭제하지 않고 dormant로 둔다.

로컬 Docker/browser/socket 제한은 재시도·승격하지 않는다. DB setup에 전체
migration 적용은 허용되지만 선택 SQL만 실행한다. 공식 생성 타입은 초기
96,990 bytes / SHA-256
`77c17c12c14d75b88d224d3b7083868cf3e3af93486c6c05c2a23b4932dfa8f0`
에서 변경이 필요할 때 CI genuine artifact로만 교체한다. 전체 누적 검사는 지금
실행하지 않으며 배포 직전 별도 명시된 단 한 번의 검사만 허용된다.

## 미승인 금융 규칙

기존 private 정책을 활성화하지 않는다. NULL 아닌 성과 조건, 부분 월 계약,
음수 순매출, 미승인 부분 주 기준, 지연 조정 근거는 임의로 정하지 않는다.
계산 input의 enabled 정책 및 immutable verification과 분리된 attempt를 사용하고,
환불은 발생월 또는 명시적으로 승인된 기존 조정의 계산 근거를 보존한다.
과거 subscriber/new/churn 지표를 현재 상태에서 만들어내지 않는다.

## 첫 DB checkpoint

- additive migration39의 read-only 입력 RPC와 새 SQL 3개를 먼저 commit한다.
  초기 manifest는 SQL 3개만 선택하며 아직 작업 중인 app/unit/race/upgrade를
  통과한 것처럼 선택하지 않는다. 모든 browser job은 false다.
- socket-free supplemental PGlite PG18/synthetic Auth에서 새 SQL만
  55 + repeatable-read 1 + serializable 1 = **57 assertions** 통과했다.
  처음 read-only JSON 비교는 session timezone을 바꾼 채 비교한 픽스처 오류로
  실패했으며 UTC/ISO 복원 후 통과했다. 실제 PG17/Auth/RLS/독립 경합 증거가 아니다.
- scoped planner가 이번 manifest만 선택하고 이전 analytics scope는 선택하지
  않는 것을 확인했다. 변경 파일만 Prettier 검사 통과, git diff 공백 검사 통과.
  workflow 파일은 수정하지 않았다.
- hosted selected SQL/official DB types/drift gate는 대기다. 첫 실행은 새 함수에
  대한 genuine 타입 artifact를 얻는 checkpoint이며 타입 drift 실패를 성공으로
  표시하지 않는다. 공개 타입은 수동 보정하지 않았다.
