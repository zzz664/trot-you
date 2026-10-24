# PWA 정적 캐시 경계

## 빌드와 공개 리소스

Next 16의 기본 Turbopack 빌드를 유지한다. 공식 [Serwist configurator mode](https://serwist.pages.dev/docs/next/config)를 사용해 Next 빌드 **이후** 정적 파일 목록을 생성한다. webpack 플러그인이나 broad `defaultCache`를 적용하지 않는다. 설치한 `@serwist/next`, `@serwist/cli`, `serwist`는 9.5.13으로 고정하며 `esbuild`도 고정한다. Serwist 빌드 패키지가 고정한 Zod 4.6.5의 [리소스 소모 취약점](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)은 해당 네 패키지에만 기존 앱 Zod 4.6.7을 사용하도록 patch-level override하여 제거했다. major 버전을 강제하지 않으며 실제 worker 빌드와 `npm audit` 0개를 확인했다.

- `src/app/manifest.ts`는 공개 이름·설명과 자체 제작 아이콘, root scope/start URL, standalone 표시를 제공한다. 새 아이콘은 저장소 SVG를 PNG로 변환한 것이며 외부 이미지를 가져오지 않았다.
- `npm run build`는 Next → 스크립트 없는 공개 offline HTML 생성 → Serwist 번들을 순서대로 실행한다. Serwist CLI의 configuration 오류가 출력만 남길 가능성을 피하기 위해 rejecting API를 호출한다. 생성 실패는 전체 빌드 실패다.
- `public/sw.js`, `public/offline.html`은 빌드 산출물이며 커밋하지 않는다. 오프라인 문구는 `messages/ko.json`, 글자·색은 공통 design token에서 생성한다. 개인정보/저장된 선호도를 읽지 않으며 큰 글자를 기본으로 사용한다.
- worker/manifest/offline/icons는 인증 refresh proxy를 통하지 않는다. worker는 `no-store` 및 root scope 헤더, offline은 스크립트·연결·폼을 금지하는 CSP를 갖는다.
- worker 등록은 production·secure context·지원 API일 때만 실행한다. 등록 실패는 온라인 이용을 막지 않으며 설치 성공으로 표시하지 않는다.

## 저장할 수 있는 데이터

두 번의 allowlist 검사로 **해당 production 빌드의 정확한 JS/CSS URL**과 `/offline.html`만 캐시에 들어간다. 전체 `public/**`, prerendered HTML, 페이지/응답 캐시, manifest 및 업로드 미디어를 glob하지 않는다.

설치 중에는 쿠키/credentials를 보내지 않고 redirect를 오류로 처리한다. 응답이 200, 비리디렉션, 같은 URL, 기대 MIME이고 `private`/`no-store`, session 관련 Vary, Set-Cookie가 없어야 한다. 설치 중 하나라도 거절되면 install 자체가 실패한다. private API, OAuth, RSC/Next action, 미디어 및 query가 붙은 asset은 캐시 응답을 받지 않는다. 정확한 manifest URL이어도 Authorization/RSC/Next router/Range 헤더가 있으면 캐시 경로를 건너뛴다.

일반 문서 navigation은 network 응답을 그대로 반환하고 **저장하지 않는다**. 네트워크가 실패한 경우에만 정적인 offline 문서를 보여 준다. API/OAuth/RSC/media 요청은 이 fallback에서도 제외된다. `CACHE_URLS`, push, background sync, 알림 표시/구독은 구현하지 않는다.

현재 캐시의 obsolete entry는 Serwist activation에서 제거된다. 구버전 정리는 `trot-you-public-`로 시작하는 이전 캐시만 삭제하고 현재 및 다른 애플리케이션 캐시는 보존한다. 자동 강제 skipWaiting/새로고침은 하지 않는다.

## 검증 경계

단위 검사는 allowlist, query/header/method 차단, response 종류, credential-free 설치, 등록 실패/비지원, 버전 정리, proxy 제외를 검사한다. `pwa-offline.spec.ts`는 **실제 production worker**를 제어하는 localhost Chromium에서 manifest/아이콘, 쿠키 없는 install request, 정확한 offline asset 응답, API/RSC/OAuth/media 실패, cache 내용, 실제 activation 정리와 360/414px offline 화면을 검증하도록 작성했다. worker fetch를 mock/route fulfill하지 않으며 Notification 권한을 부여하지 않는다.

로컬 브라우저는 실행하지 않았다. 새 Chromium E2E와 스크린샷의 실제 통과 여부는 해당 exact-head CI 결과로만 판정한다. 실제 iOS 홈 화면 설치, Android 설치 prompt, OS 알림 전달은 이 검사의 증거가 아니다. Web Push 구독/전달 및 실제 기기 검증은 별도 기능/권한 범위다.
