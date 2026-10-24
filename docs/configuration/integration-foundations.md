# 연동 설정·오류·운영 설정 기반

이 기능은 **설정 검증 기반**입니다. DB·인증·결제·알림 어댑터를 구현하거나 외부 API를 호출하지 않습니다. 키를 입력해 `configured`가 되어도 실제 연동 또는 결제 가능 상태를 뜻하지 않습니다.

## 공개 환경과 서버 환경

- `src/config/env.ts`: 공개 앱 origin, Supabase 공개 URL/키, Toss 빌링 client key만 명시적으로 읽습니다. 알 수 없는 입력 필드는 반환하지 않습니다. Next.js의 정적 `process.env.NEXT_PUBLIC_*` 접근을 유지합니다.
- `src/config/env.server.ts`: `server-only` 경계에서 서버 비밀키·Cron·provider 플래그를 읽습니다. import 시 키 검증을 실행하지 않습니다. `getServerEnv()` 또는 `parseServerEnv()`를 명시적으로 호출합니다.
- 오류에는 원본 값, Zod 오류, credential, stack을 넣지 않습니다. 잘못된 환경은 고정된 `CONFIGURATION_INVALID` 오류로 반환합니다.
- 환경 읽기는 위 두 파일로 제한합니다. 순수 `lib`와 UI primitive는 서버 환경 모듈을 import할 수 없습니다. Next.js도 `server-only`가 client graph로 유입되면 빌드를 거부합니다. Vitest의 marker 대체는 테스트 설정에만 존재합니다.

공개 키 형태 검사는 흔한 secret 오입력을 막을 뿐, 발급·서명·권한을 인증하지 않습니다. Supabase 공개 키는 `sb_publishable_*` 또는 role=`anon`인 legacy JWT이며, 서버 키는 `sb_secret_*` 또는 role=`service_role`입니다. JWT payload 확인은 서명 검증이 아닙니다. URL은 사용자정보·경로·query·fragment 없는 HTTPS origin만 허용하고 개발 loopback에만 HTTP를 허용합니다.

공개 변수는 build 시점에 고정됩니다. 환경을 옮길 때 해당 환경의 공개 값으로 다시 빌드해야 합니다. 어떤 `NEXT_PUBLIC_*`에도 비밀을 넣어서는 안 됩니다. 서버 파서는 allowlist 밖 공개 변수와 폐기한 `PAYMENT_PROVIDER`/`TOSS_WEBHOOK_SECRET`를 거부합니다. `PATH`, `CI` 같은 일반 host 변수는 무시합니다. 빈 credential은 미설정으로, 공백 포함 credential은 잘못된 입력으로 처리합니다.

## 연동 준비 상태: 성공 대신 명확한 구분

`inspectConfiguration(input)`은 secret을 반환하지 않고 다음만 보고합니다.

| 상태         | 의미                                                        |
| ------------ | ----------------------------------------------------------- |
| `disabled`   | 결제 mode 또는 해당 provider 플래그가 비활성                |
| `missing`    | 필수 credential 누락; `missing`에는 알려진 변수 이름만 포함 |
| `configured` | 필수 값의 형태가 갖춰짐. 실제 인증·계약·연동은 미검증       |

모든 항목의 `operational`은 아직 `false`입니다. `requireIntegrationConfiguration()`은 비활성·누락·잘못된 설정을 오류로 반환하며 mock으로 대체하지 않습니다. 성공 payload에는 **해당 연동에 필요한 credential만** 투영하며 다른 provider의 키를 포함하지 않습니다. 그래도 비밀을 포함하는 서버 전용 데이터이므로 props/API/오류/로그로 직렬화하면 안 됩니다.

- 공통: `PAYMENTS_MODE=disabled|test|live`, 기본 `disabled`. test는 명시적인 향후 provider sandbox 방향이지 앱 내부 가짜 결제 성공이 아닙니다.
- Toss: `TOSS_BILLING_ENABLED`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`, `TOSS_BILLING_MID`. 빌링용 개별 `ck/sk`만 허용하고 client/secret의 test/live 혼용을 거부합니다. 같은 mode라도 실제 동일 MID의 key pair인지는 API 연동 전 확인할 수 없습니다.
- 직접 KakaoPay: `KAKAOPAY_SUBSCRIPTION_ENABLED`, `KAKAOPAY_SECRET_KEY`, `KAKAOPAY_RECURRING_CID`; `KAKAOPAY_CID_SECRET`는 발급된 경우에만. test recurring CID는 `TCSUBSCRIP`만, live는 알려진 test CID(`TCSUBSCRIP`, `TCSEQUENCE`, `TC0ONETIME`)를 거부합니다. 문서화되지 않은 live CID 형식은 추정하지 않습니다. 불투명 Secret key의 실제 dev/live 소속은 오프라인 검증 불가입니다.
- live 결제 mode는 HTTPS 앱 origin이 필요합니다. build·준비 화면은 credential 없이 동작하지만, 설정 누락을 운영 성공으로 처리하지 않습니다.
- Supabase, Web Push, Alimtalk, Cron의 `configured`도 현재 이름난 필드의 존재만 의미합니다. SDK, VAPID contact, Alimtalk 업체/템플릿, 실제 DB 권한 확인은 해당 기능에서 보완합니다.

두 결제 provider의 등록·승인·조회·웹훅 프로토콜을 동일하다고 가정하지 않았습니다. `TOSS_WEBHOOK_SECRET` 같은 가상의 보편 HMAC, 자동 provider failover, 휴대폰 정기결제 지원은 만들지 않았습니다. 상점 승인, 암호화된 mandate 저장, 원장/중복 방지, 정책 승인, sandbox/live 검증, 불확실한 청구 결과의 조정 절차는 `PAYMENT_LAUNCH_GATES`에 남아 있습니다. 암호화 키 포맷·버전은 실제 암호화 설계와 함께 정의합니다.

## Result와 오류

`src/lib/result.ts`의 `Result<T, E>`는 `ok`로 구분하는 합집합이며, `E`는 공통 오류 코드의 부분집합입니다. 성공은 `data`와 선택적 pagination meta를 가집니다. 실패 생성기는 고정된 코드와 `messages/ko.json`의 한국어 문구만 반환합니다. 원본 provider 오류나 임의 `details`를 전달하는 통로는 제공하지 않습니다. 필요해지면 검증된 공개 DTO를 별도로 정의해야 합니다.

원래 API 코드 12개와 구성 실패/연동 불가의 503 코드 2개를 중앙 HTTP 매핑으로 관리합니다. 아직 Route Handler 또는 상태 전이 구현은 없습니다. 예상치 못한 오류는 `internalFailure()`로 숨기고, 진단에 필요한 허용 메타데이터만 서버 로거에 전달합니다.

## 로그의 공개 범위

`src/server/logging/logger.ts`는 `server-only`이며 문자열 JSON을 sink에 전달합니다. 일반 source의 `console` 금지는 유지하고 이 sink 파일에만 예외를 둡니다.

- event·provider·mode·outcome·errorCode는 고정 allowlist 값만 보존합니다.
- HTTP status, duration, attempt count는 안전한 정수만 보존합니다.
- 사용자 이름/연락처, customer/auth/billing key, SID, token, 헤더, URL, 요청/응답 body, provider raw payload, 중첩 object, 알 수 없는 필드, 자유문구는 **전체 제외**합니다. 위험한 key 이름만 가리는 방식이 아닙니다.
- Error는 고정 marker만 남기고 name/message/stack/cause를 쓰지 않습니다. getter·toJSON은 실행하지 않고 순환 객체·악성 proxy·sink 예외를 안전하게 처리합니다.

이 로거는 결제 원장용 정규화 DTO 또는 원본 payload 저장 구현이 아닙니다. 향후 필요한 provider 거래 식별자도 임의 원문 로깅 대신 별도 검증·접근통제·보존 정책을 정해야 합니다.

## 운영 설정은 현재 문서 기반 draft

`src/config/settings.ts`에 37개 key와 문서상 기본값, 구조적 범위를 모았습니다. `src/server/settings/registry.ts`는 타입에 맞는 단일 값 또는 **완전한 draft**를 검증할 뿐 DB 읽기·쓰기, 캐시, 관리자 변경, production fallback을 수행하지 않습니다. `createDocumentedSettingsDraft()`도 이름과 결과에 draft임을 명시합니다. 실제 `getSetting`/DB 저장소는 후속 기능입니다.

- 숫자는 유한 safe integer, 금액/횟수/기간은 음수 금지, 필요한 수량은 양수, 비율은 0–1입니다. 페이지 상한 100, KST 시각 0–23은 문서/API·시간 구조에서 도출했습니다. 임의 상업적 최대값은 추가하지 않았습니다.
- 이름 최소/최대와 등급 경계 순서를 확인합니다. 정산 주간 최소량은 0일 때 정책이 미정이고 분모가 될 수 있어 양수만 허용합니다.
- unknown/prototype key, inherited 값, accessor, symbol, 비정상 입력을 거부하고 오류에 입력 원문을 반영하지 않습니다.
- 금칙 패턴/욕설 목록은 원문에 placeholder만 있어 `null`로 남깁니다. 빈 배열을 정상 moderation으로 취급하지 않습니다. 성과 조건도 스키마가 정해지지 않아 `null`만 허용합니다. 향후 기능에서는 미설정 정책을 반드시 gate로 다뤄야 합니다.
- 첫 달 적용 범위, 환불, 재시도, 과거 메시지 공개 범위, 활동 점수/공유 검증·상한, 계약 정산률·수수료, 회계 처리, moderation, 부하 검증, rate limit, upload byte limit, 약관/지원 문구 등은 `unresolvedSettingDecisions`에 기록했습니다. 문서 기본값은 운영 승인 사실이 아닙니다.

## 근거와 검증 한계

비공개 설계의 아키텍처 §5, DB §3.1, API §2/§5, 결제·정산 §1/§5, 코딩 규칙 §1–3/§6을 읽고, 별도 검토에서 확인한 보안 수정 방향을 반영했습니다. 원본은 공개 저장소에 복사하지 않았습니다. 키 없이 개발한다는 현재 요구가 원문의 “키 누락 시 빌드 실패” 예시보다 우선하며, 실제 연동 진입은 fail-closed입니다.

공개 형태 확인 근거: [Toss API 키](https://docs.tosspayments.com/reference/using-api/api-keys), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys). Next.js 경계/환경 동작은 설치된 16.4.3 문서에서 확인했습니다.

단위 테스트는 실제 키나 네트워크를 쓰지 않습니다. UI 구조·스타일·상호작용은 변경하지 않았고 preview helper의 서버 import 경계만 옮겼습니다. 기존 13개 Playwright 회귀 시나리오는 CI에서 여전히 통과해야 합니다.
