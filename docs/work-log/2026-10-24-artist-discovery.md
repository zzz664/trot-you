# 2026-10-24 가수 탐색·맛보기·관심 선택

## 범위와 결정

- develop `737d5e85aafc39f4689898efa5e07a5260115768`에서 `feature/artist-discovery-preview` 하나로 작업한다. 기존 로컬 profile 작업은 archive tag로 보존하고 종료된 feature ref를 제거했다. main/develop에 직접 변경을 게시하지 않는다.
- 공개 active 가수 목록, 서버에서만 이름을 치환하는 승인된 맛보기, 한 명의 관심 선호 저장과 재개를 연결한다. 관심은 유료 구독/결제/유료 접근권이 아니다.
- 프로필·현재 이름 정책·현재 승인된 필수 동의·역할·제한 상태를 DB에서도 확인한다. 원문 맛보기는 서비스 전용 RPC로 유지하고 actor는 서버가 검증한 세션에서만 가져온다.
- 선택은 설치 대기 단계로만 이어지며 full onboarding을 완료하지 않는다. 승인 근거 없는 건너뛰기는 제공하지 않는다. 미디어는 종류별 준비 중 표시이며 서명/재생이 구현되었다고 주장하지 않는다.

## Migration 선행 체크포인트

- migration 00011: private 관심 선호, 본인 상태/선택 RPC, 서버 전용 안전한 맛보기 입력 projection. 운영 정책·실제 콘텐츠를 seed하지 않는다.
- 새 pgTAP 86개. 기존 1,887개를 유지하여 총 1,973개. 로컬 PGlite 보조 검사에서 21개 SQL suite를 2회 실행했고 각 1,973개 assertion이 통과했다. 이는 실제 Supabase/PostgreSQL 17 결과가 아니다.
- 새 5개 독립 세션 경합 시나리오를 CI에 연결한다. 기존 97개 경합 검사를 유지한다. script syntax/ESLint/Prettier는 로컬 통과했고 실제 DB 경합은 아직 실행 전이다.
- 실제 Supabase DB lint, 전체 pgTAP, 독립 세션 경합, 생성 타입 drift는 CI에서 검증한다. migration-only commit으로 실제 타입 artifact를 먼저 얻고 해당 출력만 별도 반영한다. `src/types/database.ts` 수기 수정은 하지 않는다.
- 앱/UI 작업은 이 체크포인트에 섞지 않는다. 최종 앱 검사·CI·3단계 글자 크기 화면 검토 결과는 별도 완료 기록으로 추가한다. 이 단계만으로 통합 기능 완료 또는 배포 가능 상태를 주장하지 않는다.
