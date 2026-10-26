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
