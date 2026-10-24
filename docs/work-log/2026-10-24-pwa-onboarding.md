# 2026-10-24 PWA 설치 안내와 전체 온보딩 완료

## DB 선행 체크포인트

- develop `c9d3346c4594e05a67bfe05274fddb7fcb575f33`에서 `feature/pwa-onboarding` 하나로 진행한다. main/develop 직접 push와 운영 배포는 하지 않는다.
- migration 00012: 안내 확인/건너뛰기/검증되지 않은 설치 자기 보고를 구분하는 private 증거와 actor-scoped 읽기·기록·전체 완료 RPC를 추가했다. 실제 설치나 Notification 권한, Web Push 등록/전송을 완료했다고 주장하지 않는다.
- 플랫폼 제약상 실제 설치는 강제할 수 없으므로 필수 기술 단계는 명시적인 안내 확인이다. 지원 브라우저에서도 설치를 건너뛸 수 있다. 알림 권한과 선택 분석 동의는 완료 조건이 아니다. 이 단계는 signup 분석 이벤트도 생성하지 않는다.
- 현재 이름/법률 정책·팬 역할/제한·active 관심·안내 기록을 DB에서 다시 검증하고 경합 잠금을 유지한다. 완료와 동일 선택 재전송은 최초 시각을 보존하며, 정책 교체나 관심 철회 뒤 재시도는 실패한다. service-role 직접 profile 쓰기로 완료를 위조/초기화하지 못하도록 trigger를 추가했다.
- 새 pgTAP **78개**, 기존 **1,973개**를 유지하여 총 **2,051개**다. 보조 PGlite harness에서 **22개 SQL suite ×2**, 각 **2,051개**가 통과했다. 합성 Auth/Storage를 쓰는 이 보조 결과는 실제 Supabase/PostgreSQL 17 결과가 아니다.
- 새 독립 세션 경합 **10개**는 script syntax·ESLint·Prettier만 로컬 통과했다. 실제 DB 잠금 경합은 아직 실행 전이며 최종 CI에 연결한다. 기존 **104개**와 합쳐 **114개**가 된다.
- 실제 Supabase lint·전체 pgTAP·경합·생성 타입 drift는 CI에서 검증한다. migration-only checkpoint를 먼저 게시하여 진짜 `database.ts` artifact를 받고 그대로 반영한다. 수기 타입은 추가하지 않았다.
- 이 체크포인트는 앱/UI/서비스워커 통합 완료, 실제 기기 설치, 알림 권한/구독/전송, 운영 배포의 성공 근거가 아니다. 로컬 브라우저/DB 제한은 재시도하거나 우회하지 않았다. 최종 검사·화면 검토 결과는 이후 기록한다.
