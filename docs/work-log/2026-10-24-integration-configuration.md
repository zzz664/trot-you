# 2026-10-24 — 연동 설정·오류 기반

## 범위

- 공개/서버 환경 분리, `server-only` 경계, 비동작 기본 mode와 provider별 credential 검증.
- Toss 카드 빌링과 직접 KakaoPay 구독의 별도 설정. 가상 공통 protocol·웹훅 secret·mock 성공 없음.
- 타입이 있는 Result, 중앙 오류/HTTP 상태, 한국어 안전 오류 문구.
- 서버 로거의 필요한 진단 필드 allowlist. raw provider payload·PII·credential·unknown 필드 제외.
- 문서 기반 37개 운영 설정 draft의 타입/기본값/구조적 범위와 미결정 정책 기록. DB·캐시·운영 값 변경 없음.
- 환경 직접 읽기와 역방향 import 금지 강화. UI는 helper import 경계만 이동하고 화면/동작은 유지.

## 근거와 결정

비공개 아키텍처 §5, DB §3.1, API §2/§5, 결제·정산 §1/§5, 코딩 규칙 §1–3/§6 및 사전 보안 분석을 참고했습니다. 원본은 공개하지 않았습니다. 키 없이 개발 가능한 요구에 따라 import/build는 키를 요구하지 않고, 명시적 연동 설정 조회가 누락/잘못된 값에 fail-closed합니다. `configured`는 연결 완료가 아니며 `operational=false`를 유지합니다.

placeholder moderation 데이터와 정의되지 않은 성과 조건은 `null`로 남겼습니다. 문서 초안의 가격·정산률·수수료·재시도 기본값을 실제 정책 승인으로 보지 않습니다. 임의 상업적 cap 또는 미정 encryption scheme은 추가하지 않았습니다. 구체적인 경계와 미결정 항목은 [설정 안내](../configuration/integration-foundations.md)에 있습니다.

## 검증

- `npm run check:all`: ESLint/Prettier, strict typecheck, 162개 단위 테스트(9개 파일), 대비 10쌍, Next.js production build 통과. 외부 credential 없이 확인.
- 단위 테스트: 비밀키의 공개 변수 오입력, 누락/혼용/잘못된 환경, 알려지지 않은 공개 key, 안전하지 않은 URL, getter/proxy, 로그 payload/PII/secret/순환 참조, 설정 key별 타입·범위·교차 제약, lint 경계.
- `npx playwright test --list`: 기존 13개 사례 확인. 브라우저 실행은 앞선 sandbox 거절을 우회/재시도하지 않았고, 이번 작업에서도 로컬 실행하지 않았습니다. CI의 동일 회귀 suite 통과가 병합 조건입니다.
- 독립 read-only 리뷰 완료: 차단 이슈 없음. 동적 provider union의 credential 타입이 과도하게 넓어지는 P2 지적을 distributive discriminated union과 컴파일 오류 회귀 테스트로 수정했습니다. provider별 최소 credential 투영과 알려진 sandbox CID만 거부하도록 보완했습니다. 리뷰어가 strict typecheck·162개 테스트를 별도로 재실행해 통과를 확인했습니다.

## 미구현·미검증

DB·RLS·인증·provider SDK/API·청구·환불·알림·암호화 저장·Cron 실행을 구현/호출하지 않았습니다. 실제 키, 운영 설정, hosting, merchant 계약을 변경하지 않았습니다. sandbox/live 결제 검증과 불확실한 결과의 조정은 별도 필수 gate입니다. 현재 기능만으로 API 키를 넣자마자 전체 서비스가 동작한다고 주장하지 않습니다.
