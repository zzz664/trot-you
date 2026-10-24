# 2026-10-24 — Kakao/Supabase 인증·세션

## 범위와 결정

- PR #12 병합 SHA `caa31fb78b515d87b9b64c2b1026fd2d65e4d3b9`에서 `feature/auth-sessions`를 시작했다. 이전 로컬 정산 이력은 `archive/settlement-database-final-0d99c87`로 보존했다. develop 직접 push/운영 배포는 하지 않는다.
- 설치된 Next.js 16.4.3의 proxy/cookies/authentication 문서, 비공개 01/03/05/06 사양과 기존 identity DB 권한을 검토했다. 원본 사양은 커밋하지 않는다. 한 인증 기능에 SDK·화면·테스트·설정 문서를 함께 포함하며 이전 300줄 제한은 적용하지 않는다.
- 실제 Supabase SSR 0.12.7·JS 2.118.0으로 요청별 서버 소유 세션과 Kakao PKCE 경로를 연결했다. 서비스 키·브라우저 토큰 저장·mock 로그인·테스트용 production 로그인 endpoint는 없다.
- Next16 `src/proxy.ts`가 갱신 쿠키를 요청과 응답에 전파하고, 페이지마다 서버 검증 subject와 actor-scoped 최소 프로필을 다시 읽는다. 역할보다 제한·미완료 온보딩을 우선하며 return path로 권한을 우회하지 않는다.
- 고정된 configured origin, 정확한 same-Origin POST, callback 형식·중복 검사, 소모된 PKCE verifier 삭제, HttpOnly/Lax와 HTTPS Secure/`__Host-`, 누적 Set-Cookie 보존·no-store를 구현했다. 오류나 원본 code/provider message를 사용자에게 노출하지 않는다.
- 로그아웃은 현재 기기 scope이며 실패 시에도 로컬 cookie/chunk를 지운다. 서버 종료 미확인 상태와 성공을 다르게 안내한다. 로그인된 `/start` 순환, 키 없는 가짜 성공, 제한된 사용자 화면 접근을 방지한다.
- `/start`와 최소 세션 상태/로그아웃만 구현했다. 온보딩은 미완료 안내이며 나이·동의·가입 완료를 대체하지 않는다. DB migration/생성 타입은 변경하지 않는다.

## 검증과 제한

- 최종 `npm run check:all` 통과: 전체 ESLint/Prettier, strict type, 단위 테스트 366개(새 인증 테스트 126개 포함), 10개 대비 조합, 키 없는 production build. 12개 동적 경로와 Next16 Proxy가 생성됐다.
- `npm audit --omit=dev`: 런타임 의존성 취약점 0개(2026-10-24 확인).
- 기본 Playwright 16개와 인증 전용 17개의 테스트 발견(`--list`)을 확인했다. `--list`는 브라우저 동작 통과가 아니다.
- 기존 로컬 브라우저 제한을 재시도하지 않았다. 실제 browser/3가지 글자 크기×2모바일 screenshot, 로컬 Supabase PKCE/session은 별도 CI에서 검증해야 한다. 해당 결과 전에는 실제 로그인 검증 완료로 표현하지 않는다.
- `auth-browser` CI는 loopback/Docker 대상 검증 후 폐기용 가상 email 계정과 로컬 Mailpit만 사용한다. signup은 계속 비활성이고 admin fixture key는 앱에 전달하지 않는다. 세션 trace는 저장하지 않는다. 반복 code는 원래 verifier를 복원해 실제 일회용 교환을 검증한다.
- refresh 검사는 진짜 access/refresh token을 유지하고 cookie storage의 만료 metadata만 과거로 바꿔 실제 SDK refresh를 유도한다. 자연 만료 대기·실제 Kakao OAuth 검증으로 주장하지 않는다.
- 기존 DB 1,794개 × 2회·96개 경합, lint·생성 타입 drift gate는 변경하지 않았다. 이 커밋의 CI 회귀 결과는 별도로 확인해야 한다.
- read-only 보안 리뷰에서 차단 수준 발견 사항은 없었다. role/redirect/Origin/쿠키/검증 경계를 점검했다. callback의 불필요한 `next` query를 제거해 exact redirect allowlist와 맞췄고 HTTPS cookie 이름을 `__Host-`로 강화했다.
- 실제 Kakao 앱/개인 계정 로그인, 원격 DB 변경, 실제 개인정보 전달, 운영 배포는 실행하지 않았다. 승인된 staging 자격 증명/provider 설정과 실제 OAuth 검증은 후속 운영 준비 사항이다.

## CI 이메일 provider 설정 보정

- 첫 PR #13 CI `40070995997`의 quality는 단위 366개와 기본 E2E 16개를 통과했다. 인증 job은 2개 통과/15개 실패했고, 모두 앱 검증 전에 가상 계정 password/OTP 단계에서 `Email logins are disabled`를 반환했다. 실제 인증 경로가 통과한 것으로 기록하지 않는다.
- 설치된 CLI 2.122.0의 실제 실행 번들에서 `GOTRUE_EXTERNAL_EMAIL_ENABLED:String(e.email.enable_signup)` 및 전역 `GOTRUE_DISABLE_SIGNUP:String(!e.enableSignup)` 매핑을 확인했다. `auth.email.enabled`는 지원 필드가 아니다.
- CI에서만 생성하는 `[auth.email].enable_signup=true`로 provider를 활성화하고, 전역 signup=false는 유지한다. 생성 함수에 15개 회귀 테스트를 추가하고, 실제 loopback `/auth/v1/settings`에서 email=true·disable_signup=true가 모두 확인되어야 fixture를 생성하도록 사전 검증을 추가했다. redirect는 허용하지 않으며 요청 timeout은 10초다.
- 원격 PR head `ae548496a2f113a7949785480105bccd7283c232`와 기존 로컬 커밋 tree가 동일함을 확인하고 기존 로컬 이력을 archive에 보존한 뒤 동일 feature 브랜치에서 수정했다. 기본 Supabase config·앱 코드·DB schema는 수정하지 않았다. 수정 후 전체 검증 결과와 실제 CI 재실행 결과는 구분한다.
- 수정 후 `npm run check:all` 통과: lint/format/type, 단위 381개, 대비 10조합, 키 없는 build. 실제 로컬 이메일 provider·PKCE·세션 재검증은 새 CI 실행 대기이며 로컬 브라우저를 재시도하지 않았다.

## 실제 브라우저 쿠키·POST 동작 보정

- 두 번째 CI `40071569245`는 실제 인증 E2E 15개 통과/2개 실패였다. 6개 세션 모바일 화면, 서버 폐기 세션, 갱신 전파, 권한·제한 가드 등은 통과했지만 PKCE 후 verifier 존재와 네이티브 로그아웃 POST가 실패했다.
- 로그아웃 오류 artifact는 FORBIDDEN을 확인했다. Fetch 표준상 no-referrer 문서의 네이티브 POST는 Origin:null을 보낸다. 문서만 same-origin 정책으로 변경하고 인증 handler/콜백 no-referrer 및 null/누락 Origin 거부는 유지했다. 실제 로그인/로그아웃 버튼의 POST Origin과 응답 상태를 E2E에서 직접 확인하도록 추가했다.
- 설치된 auth-js 2.118은 정확한 callback URL을 쓰더라도 fixed verifier 외에 flow별 verifier slot과 index를 함께 저장한다. 기존 정리는 fixed 이름만 다뤘다. 정확한 프로젝트 prefix와 제한된 suffix 패턴으로 전체 PKCE artifacts를 지우고 session은 보존하도록 수정했다. 새 로그인은 이전 시도를 교체하는 단일 진행 정책을 문서화했다.
- 실제 설치 SDK로 네트워크 없이 PKCE 쿠키들을 생성하고 두 차례 재시작/정리를 수행하는 회귀를 추가했다. flow ID 8/64 경계·orphan slot·index chunk 삭제, 다른 프로젝트/유사 이름/기존 세션 보존도 검증한다. 테스트의 실패 조건을 완화하지 않았다.
- 수정 후 `npm run check:all` 전체 통과(단위 382개 포함), 인증 E2E 18개 발견 확인. 실제 브라우저 재실행 결과는 새 CI에서 확인하며 로컬 브라우저는 실행하지 않았다.
