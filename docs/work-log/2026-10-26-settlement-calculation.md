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

## 앱 계산과 선택 검증

- 부모가 게시한 draft PR #44의 첫 원격 head
  `fb2420358a95bcd3432d0e060d712bab4b72bc00` tree는 로컬 DB checkpoint
  `2de91c5d1399411ca9980a80cd467d7deda46ab9`의
  `819a5472e7ea9da4684b09480f94f5053206153b`와 동일하다. 로컬 tip을 archive와
  bundle에 보존하고 soft 정렬하여 작업 중 파일을 그대로 유지했다.
- config의 strict 입력/응답 schema, 정수 유리수 연산, KST 주간 clipping과
  정확한 요구량, 순수 calculate, actor/artist/month 바인딩 service, actor DB
  adapter를 추가했다. money/rate/source version은 문자열이며 JS Number로
  계산하지 않는다. 마지막 KRW만 half-up하고 30자리 표시 소수는 별도로
  exact=false임을 표시하여 계산·감사 원본 분수와 혼동하지 않는다.
- 새 계산/주간/유리수 unit 79개와 새 DB/service boundary 43개, 정확히
  **5 files / 122 tests**를 함께 실행해 통과했다. 내부 oracle 64 조합,
  표시 정밀도보다 작은 약 2e-34 차이의 half 경계, 큰 금액, 마이크로초,
  실패/미확정 attempt 거절과 정책 복사·반복 읽기 권한 철회를 포함한다.
- 초기 경계 unit 실행은 공유 schema export 작업 전 실행하여 실패했고,
  export 완료 후 같은 선택 파일이 통과했다. compile에서 bigint 리터럴
  추론을 명시 bigint 타입으로 바로잡았다. 현재 pre-types compile의 유일한
  오류는 아직 genuine 타입에 없는 새 RPC 이름이다. 타입을 위조하지 않는다.
- 변경된 앱 파일만 ESLint 통과했다. 기존 feature의 tests는 실행하지 않았다.
  독립 read-only 검토는 수식/잠금/정책/actor 경계에서 차단 결함을 발견하지
  않았다. 실제 DB DTO와 계산의 연결, 실제 blocked session 경합, 두 source
  cap의 전체 거절은 별도 선택 검증으로 보강한다.

## genuine 타입과 실제 초기 SQL 증거

- PR #44 exact head `fb2420358a95bcd3432d0e060d712bab4b72bc00`의
  [CI 40378109128](https://github.com/zzz664/trot-you/actions/runs/40378109128)는
  실제 Supabase PG17에서 선택 SQL 3개 **57 assertions를 두 번** 통과했다.
  전체 SQL·기존 analytics·기존 race/upgrade/browser는 실행하지 않았다.
- 해당 run의 예상된 유일한 실패는 committed type drift다. 공식 artifact
  `12676986599` ZIP digest를 부모 검증자가 검증했고 그 `database.ts`를
  **97,116 bytes**, SHA-256
  `a6ad66c3de2b08a4d9a9899eac33261d4ce0b168e717e87ac5448210dda43a81`
  그대로 반영했다. 원본 artifact와 cmp byte-identical을 확인했다.
- 타입 변경은 `settlement_calculation_input` 함수 Args/JSON 반환 계약 추가뿐이다.
  genuine 반영 후 dependency graph typecheck가 통과했다. 전체 build나 누적
  테스트를 typecheck의 일부로 실행하지 않았다.
- 별도 새 limit SQL은 supplemental PG18에서 정확히 **5 assertions** 통과했다.
  메시지와 검증 원장 각각 50,000 전체 입력을 허용하고 50,001에서 계산 자체를
  거절하며 report를 만들지 않는다. 최종 hosted scoped run에서 실제 PG17 재검증한다.
- 독립 harness review가 지적한 precision 검증 공백을 수정했다: upgrade의
  predecessor JSON은 Number로 parse한 값이 아니라 canonical raw JSON 문자열로
  byte-exact 비교한다. SQL 분수의 정수 `.000000` suffix는 엄격히 0만 허용해
  제거하며 Number 변환 없이 BigInt 교차곱으로 검사한다. 실제 RPC envelope를
  실제 strict schema로 검증한 뒤 계산기와 SQL의 7개 exact component를 비교한다.

## 최종 앱 checkpoint 선택 결과

- 전체 PR 변경 24개 경로가 이번 baseline manifest 한 개로 매핑된다.
  정확한 선택은 새 unit 6 files / **146 tests**, 새 SQL 4 files / **62 assertions**,
  새 독립-session 경합 script 1개 / **11 cases**, populated 38→39 upgrade 1개다.
  browser/fixture 선택은 빈 목록이며 기존 테스트는 모두 보존·비활성이다.
- scoped runner로 새 unit 146개와 변경 24개 경로의 ESLint/Prettier가 통과했다.
  두 신규 DB harness의 `node --check`, `git diff --check`, genuine 반영
  `npm run typecheck`가 통과했다. 전체 단위/SQL/경합/upgrade/브라우저,
  `check:all`, production build는 실행하지 않았다.
- supplemental PG18의 추가 source-cap 5개 및 populated38→39 + 실제 JSON을
  strict envelope·순수 계산기에 통과시킨 7 exact component parity가 통과했다.
  이 증거는 실제 Supabase PG17 populated upgrade/병렬 경합을 대신하지 않는다.
- 후속 exact-head hosted 검증은 SQL 62개를 두 번, 새 경합 11개, 새 upgrade
  하나, genuine drift 및 선택 unit/lint만 실행한다. 선택 실패를 실패로 유지하고
  모든 실제 gate가 관측되기 전 병합 완료라고 표현하지 않는다.
