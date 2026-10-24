# 2026-10-24 공통 접근성 UI

## 범위

단일 `feature/accessible-ui`에서 Radix Dialog/Label 기반 공통 UI를 추가했습니다. Button/IconButton, Input, Card, Loading, InlineError, BackButton과 단일 대화상자 큐를 구현했습니다. 기존 준비 중 안내는 Card를 재사용합니다. 도메인 기능, 실데이터, 로그인, 결제, 외부 전송, 배포는 포함하지 않습니다.

기준: 제공된 비공개 설계 `05_frontend.md` §2/4/5/6/9, `06_coding_standards.md` §1/5/7, `01_architecture.md` §4. 원본 문서는 게시하지 않았습니다. 사용자의 최신 승인에 따라 PR 300줄 상한은 적용하지 않고 한 기능으로 유지합니다.

## 결정

- Radix가 모달 키보드/focus-scope/배경 비활성화를 담당하며, 앱 큐는 안정적 key 중복 제거와 FIFO 및 취소/해제 처리를 담당합니다.
- 아직 렌더되지 않은 요청의 즉시 취소, StrictMode setup/cleanup 재실행, 이전 경로 취소와 새 경로 요청을 별도 회귀 테스트로 보호합니다.
- 브라우저 history의 출처는 확실히 판단할 수 없으므로 BackButton은 알려진 부모 경로로 replace합니다. 내부 내비게이션 이력 구현 전까지의 안전한 기본값입니다.
- `/ui-preview`는 서버 플래그로 명시적으로 켤 때만 보이는 noindex 점검 화면입니다. 실제 작업을 가장하지 않고 입력값도 저장하지 않습니다.
- 폼 라이브러리/온보딩/하단 탭/도메인 화면은 다음 독립 기능 범위입니다.

## 검증

- Vitest/Testing Library: 네이티브 버튼/입력 의미, 필수 아이콘 글자, 상태 안내, 동시 재시도, 대화상자 초점 이동/복귀, FIFO/중복/취소/Provider 해제, StrictMode 및 경로 변경 회귀 테스트.
- Playwright: 기존 foundation 6개 + 공통 UI 7개, 총 13개 발견. 세 글자 크기와 360/414px, 200% 기본 글꼴 확대, 최소 터치 영역, 가로 넘침, 키보드 순환, 바깥 닫기 및 안전한 뒤로 이동을 포함합니다.
- 로컬 브라우저 실행/스크린샷 검수는 현재 실행 환경의 Chromium socket 권한 제한으로 차단된 상태입니다. 이전 거부된 권한 상승을 재요청하지 않았습니다. CI의 실제 E2E 결과와 첨부 스크린샷 검수 전에는 브라우저 통과로 주장하지 않습니다.
- 최종 `npm run check:all` 통과: ESLint/Prettier, Next 타입 생성/TypeScript, 42개 단위 테스트, 10개 색 대비 조합(최저 6.87:1), 프로덕션 빌드.
- HTTP 점검: 기본/false 플래그에서 `/ui-preview` 404, true에서 200 및 noindex와 점검용 h1 확인. 홈은 양쪽에서 200입니다.
- 별도 읽기 전용 리뷰에서 즉시 취소/StrictMode/오래된 경로 콜백의 독립 회귀 5개 모두 통과했고 남은 코드 차단 사항은 없습니다.
- 이전 경로 큐만 폐기하는 scopeKey를 사용하며 앱/레이아웃 자식 상태를 재마운트하지 않는 것도 테스트했습니다.
