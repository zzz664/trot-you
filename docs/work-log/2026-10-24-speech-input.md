# 2026-10-24 — 팬 답장 음성 입력

## 범위와 판단

비공개 기획의 논리 단계 21, 프런트 공통 MicButton/브라우저 음성 입력, API 분석 경계를 참조했다. 비공개 원문은 저장소에 복사하지 않았다. 답장 PR #24의 develop `1f6ba23`/tree `edf71d12` 위에 기능 하나의 `feature/speech-input`을 만들었다. 이전 로컬 feature branch는 archive ref와 작업공간 bundle로 보존 후 삭제했다. `main`/`develop` 직접 push와 배포는 하지 않는다.

- 재사용 MicButton + native API adapter, Korean 한 발화, 명시적 안내 후 start, stop/cancel/error/미지원 fallback.
- 중간 결과는 별도 화면, full result snapshot은 교체 처리, 종료된 최종 결과를 선택 영역에 한 번만 넣음. 원본 초안·Unicode 길이·caret 보존, 자동 발송 없음.
- 페이지/세션/접근/작성기 수명주기와 abort 연동, 늦은 이벤트 무시, 재시작/권한 요청은 사용자 클릭만.
- 기존 `analytics_record_client`를 strict typed POST 서비스와 연결. 현재 선택 동의/승인 정책과 actor-bound DB 검사를 유지하고 transcript/audio/PII는 보내지 않음.
- DB schema/타입/운영 정책 변경 없음. 원자적 수집 rate policy는 기존 미정 운영 조건으로 기록하며 임의 정책을 활성화하지 않음.
- 공식 API draft/vendor 문서를 확인하고 서버 기반 처리 가능성 안내. 실제 마이크/provider 서비스는 사용하지 않음.

## 검증 기록

- 초기 집중 검증: 기존 reply/chat/recovery 75, speech UI/selection 31, native speech 계약 61, 분석 경계 112 통과.
- CI 전용 speech harness: guard fixture 15, browser-suite isolation 21 통과. 기본 Playwright 수집에서 분리하고 비-CI 전용 `--list`는 차단됨.
- 최종 `npm run check:all` 통과: ESLint/Prettier, Next route typegen/TypeScript, 132개 파일의 4,366 단위 테스트, contrast, production build/PWA.
- 전체 fixture 97개 통과(기존 82 + speech 15). 최종 독립 `tsc --noEmit --incremental false`와 `git diff --check` 통과.
- speech-only 코드 검토에서 안내만 연 상태로 작성기를 닫았다 다시 열면 잠금이 남는 문제와 동일 글자 치환 시 caret 복원이 빠지는 문제를 발견·수정했다. 회귀 단위/브라우저 케이스를 추가하고 좁은 재검토를 통과했다.
- 전용 CI suite는 52개 브라우저 테스트와 65개 상태 캡처를 준비했다. 이 개수는 아직 실행 결과가 아니라 수집 계획이다.
- 실제 전체 브라우저/DB CI 및 새 UI 시각 검토는 아직 실행 대기이며, 통과한 것으로 표기하지 않는다.

## 검증 제한

로컬 브라우저 실행은 기존 제한으로 재시도/우회하지 않았고 Docker/로컬 DB도 실행하지 않았다. 실제 마이크 권한/사용자 음성/브라우저 vendor 인식 서비스와 production 배포는 미실행이다. CI 합성 이벤트는 API 사용 계약만 증명한다. 기존 미디어 독립 보안 재검토 제한을 재시도·복제·위임하지 않았으며 이 기능 검토로 닫지 않는다.
