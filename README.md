# 트롯유 (trot-you)

한국어 팬 서비스의 Next.js App Router 애플리케이션입니다. **개발 기반·접근성 UI·도메인 DB, Kakao/Supabase 인증·세션, 전체 온보딩과 정적 자산 전용 PWA를 구현하고 있습니다.** 실제 Kakao 승인/로그인, 운영 정책 활성화, 실제 구독 결제·메시지 전달 또는 운영 배포가 검증된 상태가 아닙니다.

## 로컬 실행

Node.js 24와 npm을 사용합니다. 의존성 버전과 `package-lock.json`을 함께 고정합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

기본 주소는 <http://localhost:3000>입니다. 이 단계는 외부 서비스 키 없이 실행됩니다. `NEXT_PUBLIC_*` 값은 공개되므로 비밀키를 넣지 마세요. 실제 키는 `.env.local` 또는 배포 환경의 비밀 저장소에만 보관합니다.

## 검증

```sh
npm run check:all       # lint, formatting, strict types, unit tests, contrast, build
npx playwright install chromium
npm run test:e2e        # production build 필요: 3개 글자 크기 × 2개 모바일 너비
```

브라우저 테스트는 포트 3100에서 자체 서버를 시작합니다. 미리 실행한 서버는 종료해야 합니다. 별도 Chromium이 필요하면 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`로 지정할 수 있습니다. GitHub Actions는 `develop`/`main` 대상 PR에서 같은 검사와 브라우저 테스트를 실행합니다. 검사가 등록되어 있다는 사실은 실제 통과했다는 뜻이 아닙니다.

## 구조와 규칙

- `src/app/`: 화면과 요청 진입점; 비즈니스 로직·SQL·외부 API 호출 금지.
- `src/components/ui/`: 도메인과 무관한 기본 UI.
- `src/config/`: 환경 검증, 라우트, 기술 상수, 단일 디자인 토큰 원본.
- `src/lib/`: 순수 함수. `src/messages/ko.json`: 사용자 문구.
- 서버 기능은 `server/services → adapters | db | settings` 순서를 따릅니다. `server/auth`는 Next.js 요청/쿠키와 인증 서비스를 조립하는 경계입니다.
- 기본 글자 크기는 `large`; 로그인 전 쿠키를 첫 서버 렌더에 적용하고, 로그인 후에는 본인 프로필의 저장값을 우선합니다. 온보딩에서 세 단계 크기를 저장할 수 있습니다.
- Supabase 스키마·RLS·로컬 검증 도구와 actor-scoped 인증 조회가 있습니다. PWA 서비스 워커는 공개 빌드 자산과 정적 오프라인 안내만 캐시합니다. 첫 구독 등록·청구는 실제 어댑터로 연결하되 기본 비활성 상태이며, Web Push 전달은 별도 기능입니다. 가짜 로그인/결제/알림 성공으로 운영을 대체하지 않습니다.

## 인증·세션 연결

[Kakao 설정과 세션 보안·검증 범위](docs/configuration/auth-sessions.md)를 참고하세요. `/start`는 키가 없으면 로그인 버튼과 준비 안내를 표시하며, 설정 후 Supabase의 Kakao PKCE 흐름을 시작합니다. 세션 토큰은 HttpOnly 쿠키에만 두고, 서버가 서명 검증·현재 사용자·본인 프로필을 조회해 역할, 미완료 온보딩, 이용 제한에 맞는 화면으로 이동합니다. `/onboarding`은 저장된 프로필 설정 단계로 이어가는 입구이며 전체 가입을 임의 완료하지 않습니다. CI의 폐기용 이메일 계정/로컬 메일함은 세션 검증 전용이고 실제 Kakao 연동 성공의 증거가 아닙니다.

## 프로필 온보딩

[화면·운영 준비 안내](docs/configuration/profile-onboarding.md)와 [DB 권한/동의 경계](docs/database/profile-onboarding.md)를 참고하세요. 글자 크기 → 부를 이름 → 만 14세 이상 자기 확인·명시적 버전별 동의를 실제 RPC로 저장합니다. 다음 가수 선택 단계에서 관심 선호를 저장하고, [설치 안내와 선택 기록](docs/configuration/pwa-onboarding.md)을 거쳐 전체 온보딩 완료 RPC로 이어집니다. 설치/알림 권한 자체는 강제하지 않습니다. **승인된 실제 정책 본문/금칙어 설정은 아직 없으므로 해당 단계는 준비 중 상태로 닫힙니다.** CI의 허구 문서는 법률 문구나 실제 사용자 동의가 아닙니다.

## 가수 탐색·맛보기·관심 선택

[화면·보안·준비 범위](docs/configuration/artist-discovery.md)와 [DB 계약](docs/database/artist-discovery.md)을 참고하세요. `/artists`는 공개된 active 가수의 안전한 목록만, `/artists/[slug]`는 현재 프로필/동의 조건을 만족한 팬에게 서버 이름 치환 맛보기 또는 유료 대화방을 제공합니다. `/onboarding/artists`의 관심 가수 선택은 유료 구독이나 결제가 아닙니다. 선택 후 `/onboarding/install`에서 브라우저별 설치 안내·명시적 선택을 저장한 뒤 현재 모든 필수 조건을 DB에서 다시 확인하여 가입 준비를 완료합니다. 사진·음성·영상은 기존 [권한 기반 미디어 흐름](docs/configuration/media.md)을 통해 명시적으로 열며, 실제 바이트 권한을 다시 확인합니다. 서버 전용 맛보기·대화방 RPC에 기존 `SUPABASE_SERVICE_ROLE_KEY`가 필요하며 브라우저·인증 actor client에는 전달하지 않습니다.

## 메시지 즉시 공개·예약·취소

[작동·설정 경계](docs/configuration/message-dispatch.md), [원자적 DB 계약](docs/database/message-dispatch.md), [전용 검증 안내](docs/configuration/message-dispatch-ci.md)를 참고하세요. 저장된 본인 초안의 revision을 확인한 뒤 명시적으로 즉시 공개 또는 한국 시간(KST) 예약을 승인합니다. 공개는 앱 대화방의 실제 메시지와 조건을 충족하는 기기의 알림 outbox를 한 트랜잭션에 반영하지만 **푸시·알림톡 전송/수신 성공을 뜻하지 않습니다.** `/artist/messages`의 본인 처리 내역은 활동이 멈춘 가수에서도 현재 소속 권한으로 조회·취소할 수 있습니다. 응답 유실·중복 클릭·이전 초안 URL 복구와 정책상 취소 마감 시각을 처리합니다. 예약 worker는 기본 비활성이고 보호된 route 코드만 있으며 실제 scheduler·호스팅·provider 연결을 활성화하지 않았습니다.

## 팬 대화방 열람

[화면·API·준비 범위](docs/configuration/fan-chat.md)와 [DB 계약](docs/database/fan-chat.md)을 참고하세요. 유료 권한이 있는 팬의 첫 30개 메시지, 정밀 커서 기반 이전 메시지, 서버 이름 치환, 기존 미디어 뷰어, 실제 화면에 보인 메시지의 멱등 읽음 기록과 개인 읽음 수를 연결합니다. 구독 만료·제한·정책 변경은 새 요청마다 다시 확인합니다. 팬 텍스트 답장은 아래 별도 기능으로 연결하며, 가수의 앱 내 공개는 아래 메시지 발송 기능으로 연결하며, 실시간 provider 전달·분석 수집은 후속 기능입니다. 실제 서비스 운영과 이전 미디어의 미완료 독립 재검토를 승인한 것은 아닙니다.

## 팬 텍스트 답장

[화면·API·운영 준비 범위](docs/configuration/fan-replies.md)와 [DB 계약](docs/database/fan-replies.md)을 참고하세요. 현재 구독 권한이 있는 팬은 대화방에서 텍스트 답장을 작성하고 자신의 답장 이력을 정밀 커서로 조회합니다. 승인된 길이·금칙·원자적 사용자별 횟수 제한을 DB에서 검사하며, 응답 유실/반복 클릭은 같은 제출 키로 확인하여 중복 답장을 만들지 않습니다. 작성 중 오류나 닫기는 초안을 메모리에 보존하고 세션·권한 상실 또는 이동은 민감한 상태를 지웁니다. 실제 운영 정책이 없으면 전송은 비활성이고 가짜 성공을 반환하지 않습니다. 마이크 입력은 아래 별도 기능으로 연결하며, 가수 받은 답장 화면·실시간 전달은 후속 기능입니다.

## 답장 음성 입력

[음성 입력·브라우저 지원·검증 범위](docs/configuration/speech-input.md)와 [선택적 분석 이벤트 경계](docs/configuration/voice-analytics.md)를 참고하세요. 지원되는 보안 브라우저에서 안내 확인 후 명시적으로 마이크를 시작하고 한국어 인식 결과를 답장 초안의 선택 영역에 넣습니다. 중간 인식·취소·오류는 초안을 변경하지 않으며 자동 전송·녹음 저장·외부 STT 연동은 없습니다. 브라우저 자체 인식은 외부 서비스에 음성을 전송할 수 있어 시작 전에 안내합니다. 미지원 시 직접 입력 또는 키보드 마이크를 안내합니다. 표준/접두 API가 존재해도 실제 기기·한국어 서비스 동작을 보장하지 않으며 CI는 실제 오디오 없이 제어된 API 스텁으로 계약을 검증합니다.

## 아티스트 메시지 초안 작성

[화면·저장·업로드 계약](docs/configuration/artist-compose.md), [DB 소유권·충돌 방지](docs/database/artist-compose.md), [전용 브라우저 CI](docs/configuration/artist-compose-ci.md)를 참고하세요. `/artist`에서 현재 소속된 가수를 선택해 글·사진·음성·영상 메시지를 작성합니다. 사진 리사이즈, 명시적 동의 후 브라우저 녹음, 기존 보호 미디어 업로드, 서버 이름 치환 미리보기와 본인 초안 저장·복구를 연결했습니다. 저장과 첨부는 멱등 키·revision 검사로 중복이나 오래된 수정이 새 내용을 덮지 않게 합니다. **초안 저장은 팬에게 발송이 아닙니다.** 저장한 초안을 아래 별도 확인 절차로 앱에 공개하거나 예약할 수 있습니다. 실제 운영 정책·기기별 녹음·호스팅 검증 및 기존 독립 미디어 재검토 제한은 그대로 남아 있습니다.

## 연동 설정 기반

[설정·오류·로그·운영 설정 안내](docs/configuration/integration-foundations.md)를 참고하세요. 기본 결제 mode는 `disabled`이고, 키 누락이나 잘못된 mode를 mock 성공으로 바꾸지 않습니다. `configured`는 credential 형태/존재만 뜻하며 모든 연동의 `operational`은 아직 `false`입니다. 운영 설정 기본값은 DB 값이나 승인된 정책이 아닌 문서 기반 draft입니다.

## 사용자·가수 DB 기반

[로컬 Supabase 설정·권한·검증 안내](docs/database/identity-artists.md)를 참고하세요. Docker가 있는 환경에서 `npm run db:start`, `npm run db:reset`, `npm run test:integration`을 실행합니다. 공개 가수 조회는 계약 정보가 없는 `artist_catalog`만 사용하며, 프로필의 역할·온보딩·부를 이름은 클라이언트 직접 변경을 막았습니다. 실제 사용자·관리자 계정은 생성하지 않습니다. 운영 DB 적용은 별도 승인 후 수동으로 수행하며 아직 실행하지 않았습니다.

## 구독·결제 원장 DB 기반

[구독·검증된 금액 원장·권한 안내](docs/database/billing-ledger.md)를 참고하세요. 구독 ID와 첫 달 혜택 이력을 보존하고, 결제 시도와 실제 승인 금액을 분리합니다. 서버 전용 RPC가 청구 claim·불명 결과·중복 승인·환불 누적 한도를 처리합니다. [첫 구독 등록·최초 청구](docs/configuration/initial-subscription.md)는 Toss 카드 등록/빌링과 직접 KakaoPay ready→approve, 전용 AES-256-GCM vault, 원래 로그인 세션·nonce 바인딩, 별도 명시적 결제 동의, 원장·구독·알림 아웃박스의 원자적 확정을 연결합니다. 응답 유실은 재청구하지 않고 조회 또는 수동 확인 상태로 유지합니다. 기본 비활성이며 실제 키·운영 정책·가맹점 검증이 필요합니다. [구독 갱신·유예·재시도](docs/configuration/subscription-renewal.md)는 승인된 정책·정확한 월 기념일·전용 비밀키·원자적 lease를 요구하는 별도 비활성 worker로 연결합니다. Toss 원 주문 조회와 Kakao TID 유실 수동 검토를 구분하고 실제 스케줄러는 활성화하지 않습니다. [해지·관리자 승인형 환불](docs/configuration/subscription-cancellation.md)은 소유자 해지, 과거 결제 내역, 별도 환불 요청·정책 승인·실행·불명 결과 조회를 연결합니다. 승인된 실제 환불 정책은 없으며 기본 금전 실행은 비활성입니다. 실패·만료 알림 발송은 후속 범위입니다. DB/CI 테스트 성공은 실제 공급자 결제 성공을 뜻하지 않습니다.

## 브랜치와 작업 기록

`main`은 배포용, `develop`은 기본 개발 통합 브랜치입니다. 두 브랜치에 기능 코드를 직접 푸시하지 않습니다. 기능 하나마다 브랜치 하나를 만들고 검증 후 PR로 `develop`에 병합합니다. 완료 브랜치를 삭제한 다음 다음 기능을 시작합니다. 운영 배포는 별도 승인 대상입니다.

2026-10-24 사용자 결정으로 PR 300줄 제한은 제거했습니다. 한 기능에 집중하는 PR 원칙과 검증·리뷰 기록은 유지합니다.

변경 목적, 설계 결정, 검사 결과, 미검증 항목은 [`docs/work-log/`](docs/work-log/)에 기록합니다. 비공개 원본 설계 문서나 자격 증명은 공개 저장소에 복사하지 않습니다.

## 알려진 개발 도구 제약

Next.js 권장 ESLint 구성의 React/import/a11y 플러그인 호환 범위에 맞춰 ESLint 9.39.5를 고정했습니다. [ESLint 9는 EOL](https://eslint.org/version-support/)이며, 호환 플러그인이 출시되면 ESLint 10으로 함께 갱신해야 합니다. 런타임 의존성이 아닌 개발 도구 제약이며, 점검일과 보안 검사 결과는 작업 기록에 남깁니다.

## 팬 커뮤니티 데이터 기반

[게시판·신고·운영 제한 DB 계약](docs/database/community.md)을 참고하세요. 호출자 고정 RPC, 원자적 좋아요/댓글/신고 집계, distinct 신고 자동 숨김, 관리자 복구/삭제·공지와 유한한 이용 제한을 포함합니다. 운영 정책은 별도 승인된 snapshot 설정 전까지 차단되며 업로더·화면·알림 및 답장 신고는 아직 없습니다. 후속 포인트 DB는 별도 승인 snapshot이 있을 때만 생성과 원자적으로 적립합니다.

## 공식 일정·콘텐츠 캘린더 데이터 기반

[일정·캘린더 DB 계약](docs/database/schedule-calendar.md)을 참고하세요. active 가수의 공개 일정 projection, KST 월 조회와 안정적 cursor, 좌표 기반 장소 정보, 본인 알림 opt-out, 관리자 일정·월간 기획 CRUD와 감사 기록을 포함합니다. 소속 가수는 기획 읽기만 가능하며, 달력 UI·지도 링크 실행·알림 큐/전송·활동량 대시보드는 아직 없습니다.

## 출석·포인트 원장 데이터 기반

[출석·포인트 DB 계약](docs/database/points-ledger.md)을 참고하세요. KST 하루 한 번 출석, 실제 글/댓글 생성의 원자적 보상, 본인 잔액·내역, 감사 보정을 포함합니다. 운영 보상 정책은 기본 비활성이며 문서 draft 금액을 자동 적용하지 않습니다. 원장은 비금전·불변 기록이고 공유·미션·활동 등급은 명시적 미설정 상태입니다. 화면·운영 설정 서비스·전체 포인트 MVP 완성을 뜻하지 않습니다.

## 측정 이벤트 DB 기반

[13종 측정 이벤트·동의·집계 계약](docs/database/analytics-events.md)을 참고하세요. private 원시 행, strict typed 속성, 본인 동의와 client/service/검증 charge 권한 분리, 멱등 수집과 KST 일별 건수를 포함합니다. 승인된 정책은 기본 미설정이며 음성 입력의 strict typed HTTP 관측만 현재 동의/정책 검사와 연결했고, SDK·다른 자동 domain hook·대시보드·외부 분석 전송은 없습니다. 익명 유입 동의 모델과 원본의 네 가지 퍼널/KPI 수식은 후속 정의·통합 대기이며 전체 분석 MVP 완료를 뜻하지 않습니다.

## 월별 정산 리포트 DB 기반

[정산 리포트·불변 snapshot 계약](docs/database/settlement-reports.md)을 참고하세요. 검증된 charge/refund 원장의 KST 월 집계, 주간 메시지·사진 활동 snapshot, 소수 중간값과 정확한 유리수 최종 반올림, 관리자 draft 계산·revision 확인·확정 잠금, 현재 소속 가수의 confirmed 조회를 포함합니다. 운영 정책은 seed하지 않으며 부분 주·지연 원장은 명시된 정책과 개별 조정을 요구합니다. 음수 매출·부분 월 계약·미정 성과 조건은 임의로 적용하지 않습니다. 이는 리포트 기반이며 송금·은행/결제 호출·UI·엑셀 내보내기 구현이 아닙니다.
