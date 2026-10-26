# 2026-10-26 — 정산 보고서 검토·확정·엑셀

## 기준과 범위

- PR44 병합 develop `656c6f1292ba408df339521c8d982acd1fdbb305` / tree
  `39cd5d9bf6eacc19a6128af2bec2c5c64b1a59a4`를 fetch/fast-forward한 깨끗한
  작업 트리에서 `feature/settlement-reports` 하나를 시작했다.
- 이전 로컬 계산 기능 ref는 squash 병합 이력 보존을 위해
  `archive/settlement-calculation-final-1f13be5`로 이름만 보존했다.
- 비공개 설계 04 §3.2, 02 §3.10/RLS, 03 관리자 정산 API, 05 UI 규칙,
  07 선택 정산 범위와 실제 기존 정산 DB 함수를 확인했다. 원문은 공개하지 않는다.
- 초안 생성/재계산 CAS, 검토한 revision 확정, 확정 이후 잠금, 현재 소속·동의에
  따른 가수 확정본 읽기, 관리자 두 시트 Excel까지가 범위다. 실제 지급이 아니다.
- 미승인 성과 조건·중도 계약·음수 순매출·조정 정책을 새로 정하지 않는다.

## 스키마 체크포인트

- migration40은 네 개의 actor-bound JSON RPC와 가수 current-consent RLS를 추가한다.
  기존 관리자 역할/제한 기준, 기존 확정 CAS·원장·금융 정책은 유지한다.
- 금액·집계·정확 분수 문자열, frozen source projection, 동일 revision export,
  비팬 개인정보 투영, READ COMMITTED/잠금 순서를 사용한다.
- Supplemental PGlite PostgreSQL18.6는 모든 migration을 **설정만** 적용하고
  신규 `settlement_report_workflow.test.sql`의 60개 assertion만 통과했다.
  실제 Supabase/독립 세션 경합 통과로 대신 주장하지 않는다.
- 공식 hosted schema-generated types가 필요하다. `src/types/database.ts`는 수작업
  편집하지 않는다. 로컬 Docker/browser 제한은 재시도하지 않는다.
- 이 체크포인트 manifest는 신규 SQL 한 파일만 선택한다. 앱/UI와 선택 경합·업그레이드
  증거는 같은 기능에서 이어서 추가한다. 전체 누적 검사, `check:all`, 배포 전 전체
  검사, 운영 배포, 정책·역할 승인, 외부 통지, 실결제·지급은 실행/승인하지 않는다.

## 앱·리포트·내보내기

- 관리자/가수 별 화면과 fresh actor-bound GET, same-origin JSON 변경, revision-bound
  export를 추가했다. 페이지 RSC에는 신원만 전달하고 보고서 스냅샷은 재사용하지 않는다.
- 숫자는 문자열/BigInt 분수로 검증한다. 현재 저장된 report/정책/주간 통계/이벤트의
  일관성을 검증하고 서버에서 두 시트 XLSX를 만든다. 모든 셀은 literal text이며
  XML/Excel escape, 범위 제한, 개인정보 allowlist를 적용한다.
- 리뷰에서 PostgreSQL numeric 나눗셈이 고정 소수16자리가 아닌 유효 정밀도를 사용함을
  실제 단일 numeric probe로 발견했다. 유효 숫자와 exact rational 기반 검증으로 고치고
  작은 실제 DB fixture를 추가한다. 유효 보고서를 잘못 거부하는 오류를 숨기지 않는다.
- 현재 동의·소속 해제, stale CAS, 확정 잠금, 응답 유실 뒤 읽기 복구, 반복 클릭,
  브라우저 이력/비활성화와 다운로드 링크 폐기, 글자 크기3종을 선택 케이스에 포함한다.
- 전체 누적 검사 대신 신규 파일과 변경 CI 직접 계약만 실행한다. 실제 hosted DB/
  브라우저와 시각 증거는 아직 대기다. 로컬에서 성공으로 대신 표시하지 않는다.

## 선택 검사 결과와 공식 타입

- 공식 schema 체크포인트 원격 head `9d3acc0cdea8e266e8a9ff16b8fc0726b11f18f3`
  / tree `c01e7de80d4f818e406aa6224be132e4304e0a8b`의 CI
  `40382499369`에서 초기 신규 SQL 60 assertion을 두 번 통과했다.
- 해당 run의 artifact `12679915459`에서 공식 `database.ts` 97,767 bytes를
  그대로 복사했다. SHA256
  `26f47a45af0a5bf25128b90e2d8140c7d57becd7b50df6264748a95f06bfce7b`.
  ZIP CRC/digest 검증이 이루어졌고 generated file과 byte-for-byte 동일하다.
  스키마 체크포인트의 committed-type drift 실패는 이 공식 산출물로 해소한다.
- 최종 선택 신규 unit **12개 파일/263 tests** 통과. 새 report fixture guard와
  변경 registry/runner/required/workflow 직접 계약 **5개 파일/347 tests** 통과.
  관련 없는 historical 기능 test는 실행하지 않았다.
- 변경 파일 ESLint 통과. Prettier가 신규 client test 한 파일의 포맷을 지적하여
  그 파일만 포맷 수정 후 변경 지원 포맷 전체 확인 통과. assertion은 삭제/약화하지 않았다.
- `npm run typecheck`(route type generation + tsc)와 `git diff --check` 통과.
  이는 컴파일이며 누적 회귀 실행/production build가 아니다.
- supplemental PGlite18.6는 신규 SQL 4개 파일 **75 assertions**를 통과했다.
  두 max-int charge + signed refund의 실제 DB DTO를 현재 BigInt 검증 서비스에
  넣은 독립 parity 확인도 통과했다. 이는 실제 독립-session 경합 증거가 아니다.
- report-only 경합 10개와 populated39→40 upgrade runner는 syntax/새 contract
  검사만 로컬 통과했다. 실제 PostgreSQL 경합/업그레이드 실행은 hosted 대기다.
- XLSX는 신규 unit47개와 독립 Python zipfile/openpyxl 두 시트/CRC/문자열 정밀도
  호환 확인을 통과했다. 임시 검증 파일은 제거했다.
- 브라우저 discovery는 신규 authenticated27개 + keyless1개만 확인했다. 실제
  브라우저/12개 시각 산출물(admin/artist ×3scale ×2width)은 hosted 대기다.
  로컬 browser socket/Docker는 재시도/우회하지 않았다.

## 23:07 UTC — browser response 수명에 한정한 수정

- 원격 앱 head `d2faf68f27f0398d964efd3a3a730c060b1aacc2`, tree
  `fa812d6eef0f0e50121dee581ede0d4d06b9f080`의 CI `40416137664`에서
  report SQL **75×2**, 독립 세션 경합 **10**, populated39→40 upgrade,
  공식 generated types/typecheck/drift가 통과했다. 이 증거는 그대로 보존한다.
- report browser는 **19/27 통과, 8 실패**였다. 실패 stack 모두 browser
  `waitForResponse` 결과를 나중에 `.json()`으로 읽다가 CDP
  `Network.getResponseBody: No data found for resource with given identifier`를
  냈다. 응답 body가 navigation/cancellation 수명 종료 후 사라진다는 진단이다.
  direct APIResponse/SQL/검증 경합 실패로 잘못 분류하지 않는다. 성공 처리로 숨기지 않는다.
- 수정은 `tests/e2e/settlement-reports/response-capture.ts`와 report spec의 관찰
  경계뿐이다. browser가 실제 시작한 exact URL(query 포함)/method/actor header와
  mutation body를 확인하고, 실제 upstream 요청을 **1회** 실행하여 bytes를
  forwarding 전에 보존한다. redirect/retry는 0, status/private headers도 검증한다.
  실제 bytes만 그대로 전달하며 mock success, 재요청, 취소된 CDP body 재읽기는 없다.
- 기존 schema·권한·revision·금액·DOM·금융 원장·반복 클릭·취소·12 visual assertion은
  모두 유지한다. timeout/retry/assertion 완화는 없다. navigation response만 status-only다.
- patch-only manifest는 신규 helper unit **1파일/17 tests**, 직접 report guard
  **1파일/35 tests**, 변경 helper를 사용하는 정확히 **24 named browser cases**와
  **12 visuals**만 선택한다. unchanged direct-API-only browser3개는 제외한다.
  keyless1개는 이전 실행이 아직 완료되지 않아 기존 미완료 요구로 계속 선택했다.
- 변경 unit/guard, targeted ESLint/Prettier, `tsc --noEmit`, diff-check 통과.
  실제 browser는 로컬에서 실행/재시도하지 않고 수정 head hosted 증거를 기다린다.
- 기존 263 report units/347 CI matrix/DB75×2/races10/upgrade는 이번 수정에서
  재실행하지 않는다. baseline-bound manifest의 전체 PR 파일 mapping은 유지하되
  선택 목록을 patch의 직접 계약으로 명시적으로 좁혔다. 실패를 skip 성공으로 바꾸지 않는다.
- `src` tree `950ec2258596d8c1e797a6ab57623032face82ba`, `supabase` tree
  `51541a705cc9255aa64c7c11a0d9db2f4b82d792`가 passing DB head와 완전히
  동일함을 `git diff --quiet d2faf68 -- src supabase`로 검증했다.
  product/schema/official type bytes, workflow와 registry에는 변경이 없다.

## 23:09 UTC — 실제 선택 범위 위반 발견, publication 중지

- 같은 run `40416137664` quality 로그는 계획상 keyless1파일을 표시했지만
  실제 실행은 **historical browser94개**였다. 이것은 사용자의 변경 범위 검사
  규칙 위반이며, 선택 계획이 맞았다는 이유로 정당화하거나 성공으로 숨기지 않는다.
  부모 작업은 발견 즉시 사용자에게 알리고 모든 publication/hosted rerun을 중지했다.
- 실제 설치된 Playwright1.64.1 `lib/program.js`는 `--` 뒤의 인수를 testFilters에서
  제거한다. 기존 runner가 유일한 파일 정규식을 `--` 뒤에 두어 effective file filter가
  비었고 default config의 historical94개가 실행되었다. dedicated report config가
  27개로 보인 것은 testDir 제한 때문이지 runner 파일 선택이 입증된 것이 아니었다.
- 재현 목적으로 historical suite를 다시 실행하지 않는다. 수정은 안전하게 allowlist한
  파일 정규식을 올바른 위치로 전달하고, 실제 CLI discovery의 file/title/test ID가
  명시적 선택과 정확히 일치하는지 실행 전에 fail-closed 확인하는 직접 계약에 한정한다.
  scope 불일치·missing·empty·추가 case는 실행 금지이며 full fallback은 없다.

## 23:23 UTC — 실행 전 실제 collection 강제 검증

- `ci-run-selected`는 `--` 뒤 파일 인수를 제거했다. 안전한 명시적 경로만 CLI에
  전달하고, 원래 config 옆의 임시 wrapper에서 root/모든 project `testMatch`를
  **선택한 한 파일의 절대 경로 정규식**으로 고정한다. 프로젝트 dependency/teardown은
  임의 확대하지 않고 별도 scope를 요구하며 실패한다.
- 실제 설치 CLI로 file-only discovery 후 요청된 grep에서 exact 기대 ID/file/full-title
  집합을 정한다. 두 번째 실제 targeted discovery가 그 집합과 완전히 같아야 한다.
  empty/추가/누락/다른파일/다른ID/다른title/지원되지 않는 metadata는 실행 전에 실패한다.
  모든 invocation의 preflight가 끝나기 전 runtime을 시작하지 않는다.
- runtime config도 literal file + exact title allowlist를 고정한다. mandatory reporter가
  `onBegin`에서 실제 동일 집합을 다시 검증하고 mismatch는 test task 전에 hard-stop한다.
  Playwright는 reporter exception을 삼키므로 단순 throw에 기대지 않는다.
  `onTestBegin`도 허용 ID를 검사하며 실제 count/ID/file/title/digest를 구조화 로그에 남긴다.
- original fixture/build/reporting 설정은 유지하되 root/project retries를 0으로 고정한다.
  선택 실패는 자동 retry로 성공 처리하지 않는다. 테스트 timeout은 늘리지 않았다.
  임시 파일은 해당 invocation 종료 시 자기 소유 파일만 정리한다.
- 신규 runner 직접 계약 **161 tests**, response capture **17 tests**, report guard
  **35 tests** 통과. installedCLI의 inert fixture discovery는 historical sibling의
  top-level throw를 전혀 import하지 않았고, test body/서버/browser 실행 sentinel도
  실행하지 않았다. CLI file/grep가 사라지는 음성 시나리오도 config 고정으로 정확히
  같은 ID만 수집했고, extra/missing/changed/foreign 집합은 continuation 전에 종료했다.
- 실제 프로젝트 최종 discovery 증거는
  `/workspace/shared/settlement-reports-browser-fix-discovery-final.jsonl`에 보존했다.
  **keyless1 / affected report24** 각각 preflight와 runtime guard를 모두 `--list`로만
  실행하여 count/ID/file/full-title/digest 동일성을 확인했다. 이 증거는 browser 테스트
  통과가 아니며, hosted execution은 publication hold 해제 후에만 가능하다.
- patch 선택은 helper unit1파일 + 실제 바뀐 runner/report guard2파일 + keyless1/
  report24(visual12)다. 앞서 통과한 unchanged product/schema/DB 및 historical
  service/CI matrices는 다시 실행하지 않는다. 기존 broad quality 성공은 범위 준수
  증거로 재사용하지 않고, isolated keyless1을 수정된 runner의 직접 검증으로 남긴다.
