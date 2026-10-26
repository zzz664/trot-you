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
