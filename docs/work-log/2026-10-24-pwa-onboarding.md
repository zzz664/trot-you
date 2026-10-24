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

## 앱·설치 안내·정적 워커 연결

- `/api/onboarding/install`에 정확한 Origin·검증된 Auth subject·팬/제한 검사·1 KiB strict JSON 경계를 추가하고 actor-scoped RPC로만 안내 선택/전체 완료를 처리한다. 이미 완료된 세션의 재시도도 막지 않고 DB에서 현재 조건을 다시 검증한다. 서버나 브라우저가 설치/알림을 임의 완료로 바꾸지 않는다.
- iOS/iPadOS 수동 설치, 실제 Android/desktop `beforeinstallprompt`가 있는 경우의 사용자 클릭, 미지원/설치 거부 fallback, 홈 화면 실행 관측과 별도 자기 보고를 구현했다. 알림은 사용자 클릭·홈 화면 실행·보안 컨텍스트·API 지원 때만 요청하며 허용/거부/닫기가 가입 완료를 막지 않는다. Web Push 등록/발송은 없다.
- 안내 선택 저장 → 별도 가입 완료를 구분한다. 새로고침·재로그인·Back/Forward를 복구하고, 이전 요청의 늦은 응답이 새로운 이동/저장을 덮지 않도록 request epoch를 검사한다. 새 서버 증거가 도착하면 폼을 재생성하며 저장 중 새 선택을 받지 않는다.
- 독립 리뷰에서 과거 계정의 안내 기록을 읽을 수 없는데 홈이 완료 안내를 단정하던 문제와 갱신된 서버 선택이 기존 클라이언트 폼에 남던 문제를 발견해 고쳤다. 홈의 확인 불가 상태는 중립적으로 표시하고 유료 구독/알림 활성화를 주장하지 않는다. 각 회귀 단위 검사도 추가했다.
- Next 16 기본 Turbopack 다음 공식 Serwist 9.5.13 configurator/API로 워커를 생성한다. 정확한 현재 빌드 JS/CSS와 정적 offline HTML만 credential 없이 precache하고, API/RSC/OAuth/인증 HTML/미디어는 캐시하지 않는다. broad runtimeCache·push·CACHE_URLS 기능은 넣지 않았다. 공개 워커 리소스는 auth refresh proxy에서 제외하며 오래된 항목/전용 버전 캐시만 정리한다.
- 새 의존성 audit에서 Serwist build 패키지가 정확히 고정한 Zod 4.6.5 취약점 `GHSA-mrhx-c7xc-m3w5`를 발견했다. 네 Serwist build 패키지에만 기존 앱의 같은 minor/patch Zod 4.6.7을 지정하여 해결했다. major 강제나 전체 의존성 강제 변경은 없다. 실제 설치 tree가 모두 4.6.7이고 `npm audit` 결과 **0개**다. 버전 회귀 검사도 추가했다.
- 로컬 ESLint/Prettier와 전체 단위 **948개/46파일**, 대비 **10개**가 통과했다. Serwist `build:pwa`도 실제 실행 성공했지만 당시 기존 Next 출력의 **25개 URL**을 사용한 보조 빌드이며 최종 전체 앱 빌드 성공을 뜻하지 않는다. 현재 typecheck는 실제 신규 RPC 3개 생성 타입을 기다리는 상태이고 수기 타입은 쓰지 않았다.
- 기본 Playwright는 기존 16개 + 실제 워커 검사 5개 = **21개**, authenticated는 기존 47개 + 실제 완료/개인 캐시 검사 18개 = **65개**로 정적 수집이 통과했다. 실제 UI/RPC의 3글자 크기 × 360/414px 화면 18장, iOS 기능 모의 안내 1장, 정적 offline 2장을 새로 생성하도록 작성했다. 모의 알림 permission 응답은 명시적인 테스트 stub이며 실제 기기 권한 승인/구독/알림을 실행하지 않는다.
- 워커 E2E 검토에서 strict offline CSP가 fetch를 막아 캐시 검사를 오인시킬 수 있는 순서를 찾아 고쳤다. 온라인 문서에서 오프라인 fetch를 검사한 뒤 정적 fallback으로 이동하며 CSP를 완화하지 않는다. 인증 후 실제 HTML/API/RSC가 캐시에 들어가지 않는 경우도 추가했다.
- 실제 Supabase **2,051개 ×2**, **114개** 독립 세션 경합, 새 전체 **21/65개** 브라우저 실행, 시각 검토와 최종 `check:all`은 exact-head CI/진짜 타입 반영 뒤 확인해야 한다. 로컬 브라우저·실제 기기 설치·OS 알림 권한·실제 Web Push·운영 배포는 실행하지 않았다.

## 실제 생성 타입 체크포인트

- 실제 bootstrap head `f59067928ecbb9fa4ff41a911577cdd20c884ec6`, CI run `40079729442`: Supabase DB lint, pgTAP **2,051개 ×2**, 기존 **104개** 경합, 타입 생성 뒤 typecheck가 통과했다. 생성 타입이 아직 커밋되지 않은 예상된 drift gate만 실패했다. 이 시점에는 새 10개 경합/앱/워커가 포함되지 않았다.
- 같은 bootstrap의 quality는 단위 **702개**(기존 687 + 새 fixture 안전성 15)와 기본 E2E **16개**, auth-browser는 기존 **47개**를 통과했다. 새 완료 UI와 worker 실행 결과로 오인하지 않는다.
- artifact `12553984240`의 실제 `database.ts` **65,516 bytes**, SHA-256 `066ab89837216388e71a6ab480f0f2b3ddb41a92edbf974e8a50722d5ce55f76`를 변경 없이 반영했다. 차이는 새 RPC 3개 선언뿐이며 수기로 보완한 타입이 아니다. 원격 bootstrap과 동일 tree를 확인한 뒤 기존 로컬 checkpoint를 archive tag에 보존하고 원격 ancestry에 맞췄다. 앱 WIP는 보존했다.
- 타입 반영 후 로컬 **`npm run check:all` 전체 통과**: ESLint/Prettier, Next route typegen/TypeScript, 단위 **948개/46파일**, 대비 **10개**, Next 16.4.3 native Turbopack production build와 이어지는 실제 Serwist 빌드. 최종 빌드 worker는 정확한 공개 **25개 URL / 약 840 kB**만 precache한다. 신규 manifest/설치 API/설치 페이지가 빌드 출력에 포함된다.
- 독립 보안 리뷰는 DB 경합/ACL, HTTP/DTO, 브라우저 선택·권한·늦은 응답, private 캐시 금지, isolated CI fixture, 취약 의존성 patch override까지 확인했으며 남은 구체적 source blocker가 없다. 새 **114개 경합 / 기본 21개 / authenticated 65개 / 화면 검수**의 실제 최종 통과는 아직 앱 exact-head CI 대기다.

## 최종 앱 CI 관측 오류 수정

- 앱 head `96a24037f13e92dacac8f77200a8c3a91ce90f74`, CI run `40094145990`에서 quality는 **948개 단위 검사·기본 E2E 21개**를 통과했다. authenticated는 **63/65개** 통과이며 설치/완료의 새 17개 시나리오는 통과했다. 남은 인증 캐시 검사의 후반 assertion 및 로그아웃 cookie/Back/Forward 후반 assertion은 앞선 관측 오류 때문에 실행되지 않았으므로 통과로 기록하지 않는다.
- 새 인증 캐시 E2E가 Next 라우터 이동 후 Chromium의 폐기된 RSC response-body handle을 읽어 실패했다. 기존 PR15에서 검증한 방식처럼 **브라우저가 시작한 실제 요청**을 관측하고 `route.fetch({maxRedirects:0,maxRetries:0})`의 실제 서버 bytes를 먼저 읽은 뒤 **그 응답을 변경 없이** 전달한다. 200·RSC MIME·no-store·비어 있지 않은 개인화 본문과 실제 UI 렌더를 모두 검사한다. 오프라인 검사 전 이 관측 route만 제거하여 API 클라이언트가 실제 브라우저 오프라인을 우회하지 못하게 했다. 캐시 원문/키·개인정보 비노출 및 offline assertion은 유지했다.
- native 로그아웃의 frame-level response에서 303 대신 200을 관측했다. POST와 `/api/`는 서비스 워커가 이미 우회하며 실패 화면은 signed-out UI지만, 이 사실만으로 원래 네트워크 303·쿠키 삭제를 증명하지 않는다. 테스트는 Chromium의 **읽기 전용 CDP**에서 정확한 native POST request ID와 **첫 번째 wire response**를 연결해 303·no-referrer·no-store·정확한 공개 signed_out Location을 검사하도록 바꿨다. redirects가 같은 ID를 재사용하므로 나중의 원하는 status를 찾아 통과시키지 않는다. 응답·쿠키를 fetch/fulfill하거나 수정하지 않으며, 원래 Origin/화면/쿠키 삭제/Back/Forward/중복 POST 검사는 그대로 유지한다. 원시 헤더·쿠키는 기록하지 않고 고정 값에 대한 boolean만 보존한다. 새 관측의 실제 수용 여부는 다음 CI에서 확인한다.
- database는 pgTAP **2,051개 ×2**, 기존 경합 **104개 + 신규 첫 4개 = 108개**까지 통과했다. 다섯 번째 `acceptance-withdrawal-before-finish`는 **64/65-byte application_name이 PostgreSQL의 63-byte 제한으로 잘려**, 전체 이름을 찾던 observer가 실제 잠금 대기를 관측하지 못했다. observer를 각 살아 있는 세션의 실제 `pg_backend_pid()`(양의 안전 정수 검증)로 연결하고 `wait_event_type='Lock'` 및 정확한 `pg_blocking_pids` 관계를 유지했다. 제품 SQL·fixture·타입은 바꾸지 않았다. 마지막 6개 경합, 최종 타입 drift는 이 run에서 완료되지 않았으므로 다음 CI 대기다.
- 원격 앱 tree가 로컬 `43dc8cd`와 같음을 확인하고 archive tag에 보존한 뒤 ancestry를 맞췄다. 로컬 브라우저/DB 실행을 재시도하지 않았다. 독립 리뷰가 세 관측 변경의 증거 강도를 확인하며 제품 권한·캐시 규칙·알림 동작은 변경하지 않는다.
- 수정 후 로컬 `npm run check:all`은 다시 전체 통과했다(948개 단위 검사, lint/typecheck/대비/Next+Serwist build). 인증 E2E 정적 수집도 65개를 유지한다. 독립 리뷰가 RSC 실제 응답 provenance, logout 첫 wire response의 읽기 전용 증거, 정확한 PID 잠금 관측을 확인했다. 실제 수정된 세 경로의 통과는 새 CI 대기다.
