# Kakao 인증과 서버 세션

## 구현 범위

- `@supabase/ssr` 0.12.7 / `@supabase/supabase-js` 2.118.0의 실제 PKCE·세션 API를 사용한다. 직접 JWT나 refresh protocol을 구현하지 않는다.
- `POST /api/auth/login`은 Kakao 로그인을 시작하고 `GET /api/auth/callback`은 일회용 code를 교환한다. `POST /api/auth/logout`은 현재 기기 세션을 종료한다. GET 로그아웃은 없다.
- `/start`, 팬·아티스트·운영자 세션 확인 화면, 온보딩 미완료/이용 제한 안내만 포함한다. 이름·나이·필수 동의·가수 선택·온보딩 완료 처리나 다른 도메인 UI는 포함하지 않는다.
- 기존 DB와 생성 타입을 그대로 사용한다. 실제 사용자·관리자를 생성하거나 역할을 승격하지 않는다.

## 운영자가 별도로 준비할 설정

1. 승인된 대상 Supabase 프로젝트에 버전 관리된 스키마를 적용한다. 개발 seed/reset은 운영에 사용하지 않는다.
2. `NEXT_PUBLIC_APP_URL`을 정확한 앱 origin으로 설정한다(운영 HTTPS, 경로·쿼리 없음). `NEXT_PUBLIC_SUPABASE_URL`과 공개 publishable/anon key를 설정한다. 공개 환경값은 Next.js 빌드 시 고정되므로 변경 후 다시 빌드한다. **인증에는 service-role key가 필요 없다.**
3. Kakao Developers에 앱을 준비하고 Supabase 대시보드가 제시하는 `https://<project>.supabase.co/auth/v1/callback`을 Kakao redirect URI로 등록한다. Kakao REST API key/client secret은 **Supabase provider 설정에만** 넣는다. 브라우저/앱 환경변수에 Kakao secret을 추가하지 않는다.
4. Supabase Site URL을 `NEXT_PUBLIC_APP_URL`과 동일하게 설정한다. Kakao provider를 활성화하고 앱의 정확한 `<app-origin>/api/auth/callback`을 redirect allowlist에 등록한다. 운영에서는 와일드카드 origin을 허용하지 않는다. provider에 전달하는 callback에는 쿼리가 없다. 요청의 `next`는 내부의 고정된 세션 경로만 사용하며 현재 역할/상태 경로가 우선한다.
5. 실제 서비스에 필요한 최소 Kakao 동의 항목과 Supabase의 이메일 없는 사용자 허용 여부를 검토한다. 이 기능은 불필요한 연령/성별/전화 scope를 추가하지 않으며 카카오 metadata를 나이·동의·역할 증거로 쓰지 않는다.
6. 별도 승인된 검증 계정으로 중단/취소·재시도·콜백·갱신·로그아웃을 staging에서 검증한다. 이 작업에서는 해당 앱 설정, 실제 Kakao 로그인, 실사용자 정보 전송 또는 배포를 실행하지 않았다.

키가 없으면 `/start`의 버튼은 비활성이고 연결 준비 안내를 표시한다. 잘못된 공개 URL/key는 기존 환경 검증에 따라 오류로 차단되며 가짜 로그인 성공으로 대체하지 않는다. 설정된 키의 존재는 provider 승인이나 실제 로그인 성공의 증거가 아니다. 기존 integration configuration report의 `operational: false`도 원격 검증을 임의로 통과 처리하지 않는다.

## 보안 경계

- 세션은 서버 소유다. 요청마다 새 SSR client를 만들며 browser SDK client, localStorage 토큰, 클라이언트 session props 또는 service-role client를 만들지 않는다. `HttpOnly`, host-only, `/`, `SameSite=Lax`, HTTPS에서 `Secure` 및 `__Host-` 이름 접두사를 사용해 다른 하위 도메인의 쿠키 주입도 차단한다. 쿠키 수명은 세션 유효성 증거가 아니며 실제 JWT/refresh 검증을 거친다.
- Next.js 16의 `src/proxy.ts`는 `getClaims()`로 refresh하고 변경된 쿠키를 다음 요청 헤더와 최종 응답 모두에 전달한다. callback/login/logout은 자체 쿠키 전파를 책임진다. 모든 누적 cookie write 및 SDK가 첫 write에서만 보내는 cache header를 보존한다.
- Proxy나 layout만 믿지 않는다. 모든 세션 페이지의 DAL이 `getClaims()`로 서명을 검증하고 `getUser()`의 현재 subject를 확인한 뒤, 동일 actor client로 `profiles.id = subject`를 조회한다. 필요한 역할/온보딩/제한 열만 읽는다. 계정 ID·이메일·연락처·토큰은 화면에 출력하지 않는다.
- 역할은 수정 가능한 user metadata나 JWT custom role이 아니라 현재 DB 프로필에서 읽는다. 제한(무기한/미래 만료)이 온보딩보다 우선하고, 그다음 미완료 온보딩, 그다음 팬/가수/운영자별 경로로 이동한다. 제한 만료는 요청 시 다시 평가한다. 누락 프로필, Auth/DB 오류는 fail closed로 안내한다.
- return path는 `/`, `/artist`, `/admin`, `/onboarding`의 정확한 문자열만 허용하며, 허용된 경로도 실제 역할/상태의 landing과 다르면 무시한다. URL scheme, `//`, 인코딩·역슬래시·쿼리로 경로를 우회할 수 없다. `Host`/`X-Forwarded-Host`를 callback·redirect origin에 사용하지 않는다.
- login/logout POST는 정확한 configured origin의 `Origin`만 허용한다. 없거나 `null`/다른 origin이면 거부한다. 콜백은 SDK PKCE verifier로 요청을 묶는다. 정확한 callback URL을 유지하기 위해 experimental flow-id query는 사용하지 않고 브라우저당 하나의 진행 중인 로그인만 지원한다. 다시 시작하면 이전 시도를 교체하며, 성공/실패 후 고정 verifier뿐 아니라 SDK의 flow별 slot·index·numeric chunk까지 본인 프로젝트 범위에서 삭제한다. 다른 탭의 이전 시도는 로그인 화면에서 다시 시작해야 한다. 중복 code, provider error, 부정 형식은 일반 오류로 바꾸고 원본 code/error_description을 HTML이나 로그에 반사하지 않는다.
- 응답은 private/no-store다. 인증 handler/콜백은 Referrer-Policy=no-referrer로 code 유출을 막고, 문서 응답은 same-origin으로 외부 referrer를 차단하면서 네이티브 form POST의 실제 Origin을 보존한다. no-referrer 문서의 Origin:null을 예외 허용하는 방식은 쓰지 않는다. SDK I/O는 요청별 no-store와 10초 fetch timeout을 사용한다. 단일 사용 code/로그아웃은 앱이 무조건 재시도하지 않으며 SDK의 refresh 재시도 계약을 따른다.
- 로그아웃은 `scope: local`이며, SDK refresh/네트워크 오류가 있어도 현재 앱의 auth cookie와 chunk를 지운다. 실패 시 원격 종료를 확인하지 못했다는 문구를 보인다. 기존 access JWT의 즉시 전역 폐기를 보장하지 않는다. 다른 기기를 종료하지 않으며 이 기능은 고위험 결제/관리 변경용 재인증을 대신하지 않는다.
- 로그인/로그아웃은 전체 문서 POST 이동이고, history BFCache 복원 시 서버 재검증을 위해 새로고침한다. 같은 버튼을 기다리는 동안 중복 클릭을 막되 뒤로 돌아오면 영구 비활성 상태를 남기지 않는다.

## 검증 구분

`npm run check:all`은 lint/format/strict type/unit/contrast/keyless production build를 수행한다. 기본 `npm run test:e2e`는 키 없는 start, 콜백 오류, 접근성 UI를 3개 글자 크기 × 360/414px에서 검사한다. 브라우저가 허용되지 않는 실행 환경에서는 이를 시도/재시도하지 않고 CI에서 실행한다.

별도 `auth-browser` CI는 공식 local Supabase stack만 사용한다. helper는 GitHub Actions, loopback URL과 local Unix Docker를 확인하고 config를 그 job에서만 변경한다. 공개 signup은 끈 채 폐기용 가상 계정을 admin API로 만들며, local Mailpit에서 email PKCE code를 받아 **실제 callback 교환**을 검증한다. 테스트 admin key는 앱 서버에 전달하지 않는다. fixture는 삭제하고 stack은 `--no-backup`으로 중지한다.

CLI 2.122.0에서 `[auth.email].enable_signup`은 이름과 달리 `GOTRUE_EXTERNAL_EMAIL_ENABLED`(이메일 provider 전체 활성화)에 매핑된다. 따라서 폐기용 CI override에서만 이를 `true`로 설정하고, 전역 `[auth].enable_signup=false` → `GOTRUE_DISABLE_SIGNUP=true`로 실제 신규 가입 차단을 유지한다. 지원하지 않는 `auth.email.enabled` 필드는 추가하지 않는다. fixture 전에 loopback Auth의 실제 `/settings`가 `external.email=true`, `disable_signup=true`임을 확인하며 다른 값이면 즉시 실패한다. 저장소의 기본 `supabase/config.toml`과 운영 설정은 바꾸지 않는다.

실제 SDK cookie 생성과 actor-scoped 조회, 로그인된 start 이동, 역할/제한/온보딩 가드, forged JWT 거부, callback 반복·잘못된 verifier, logout 반복·Origin 차단·뒤로/앞으로, 쿠키 갱신 전파와 HTTPOnly를 확인한다. 갱신 테스트는 진짜 토큰을 유지한 채 client storage의 `expires_at`만 과거로 바꿔 실제 refresh endpoint를 호출한다. 이는 실시간 JWT 자연 만료 대기나 Kakao OAuth 원격 검증과 다르다. 세션을 담을 수 있는 CI trace는 끈다.

기존 `database` CI의 pgTAP 1,794개 × 2회와 96개 독립 세션 경합 테스트, DB lint 및 생성 타입 drift gate는 그대로 유지한다. 이 기능은 migration이나 수기 타입을 추가하지 않는다. **CI 구성/테스트 코드의 존재와 실제 실행 성공은 별도 기록한다.**

## 참조

설치된 Next.js 16.4.3 문서의 `proxy`, `cookies`, authentication DAL 규칙을 확인했다. 공개 공식 문서: [Supabase SSR client](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [SSR 보안과 캐시](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [Kakao OAuth](https://supabase.com/docs/guides/auth/social-sign-in/auth-kakao), [Fetch 표준 Origin 헤더 처리](https://fetch.spec.whatwg.org/#append-a-request-origin-header). 비공개 원본 사양은 저장소에 복사하지 않는다.
