# 2026-10-24 — 애플리케이션 기반

## 목적과 범위

`feature/app-foundation`을 초기 `develop` 커밋 `6f54d4624c084cf56a56dee5228d1a966475867e`에서 분기했습니다. 검토한 비공개 설계의 아키텍처 §4–5, 프론트엔드 §1–2·6·9, 코딩 규칙 §1–5·7–9에 대응하는 **첫 개발 기반**입니다. 원본 문서는 공개하지 않았습니다.

## 변경과 결정

- Next.js 16.4.3 App Router, React 19.3.1, npm 잠금 파일, Node.js 24.
- TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; Next 권장 ESLint, Prettier, Vitest/Testing Library, Playwright, PR CI.
- 한국어 서버 렌더 준비 화면. 미구현 기능을 실제 서비스처럼 보이게 하지 않습니다.
- next-intl 번역 파일, 라우트·환경·디자인 토큰 분리. 토큰 객체가 CSS 변수와 Tailwind 참조의 기준입니다.
- normal/large/xlarge 글자 크기, rem 단위, 높이 고정 없는 레이아웃, 기본 large 및 안전한 쿠키 선택값 처리. 색상은 대비 검사를 거친 임시 기반 팔레트이며 확정 브랜드 디자인이 아닙니다.
- `.env.example`에는 공개 앱 주소만 포함합니다. 외부 키를 나중에 연결한다는 요청에 맞춰 일반 빌드에는 서비스 비밀키를 요구하지 않습니다. 실제 기능 도입 시 각 서버 어댑터에 필수 설정 검증을 추가해야 합니다. 키가 없을 때 실제 처리를 mock 성공으로 대체하지 않습니다.
- ESLint 10 시도에서 Next 구성의 React/import/a11y 플러그인 peer 호환 불일치를 확인해 권장 규칙을 보존하는 9.39.5로 되돌렸습니다. [ESLint 9 EOL](https://eslint.org/version-support/)은 남은 개발 도구 제약입니다.
- Next.js 선택 시 [2026-10-14 공식 보안 공지](https://nextjs.org/blog/nextjs-security-update-october-14-2026)를 확인했습니다. 선택한 16.4.3은 공지의 16.4.1 수정 버전 이후입니다.

## 검증 결과

- `npm ci`: 통과, 잠금 파일에서 설치.
- `npm run check:all`: lint/포맷/타입/단위 테스트/대비/production build 통과.
- Vitest: 13개 통과(기본 UI 의미 구조, 글자 선택값·잘못된 값, 공개 환경 검증·알 수 없는 키 제외).
- 대비: 텍스트 3종 × 배경 2종 모두 4.5:1 이상; 최저 6.87:1.
- `npm audit`: 보고된 취약점 0개(2026-10-24 기준; 이후 재검사 필요).
- 로컬 production HTTP smoke: 기본값·3개 글자 크기·잘못된 쿠키 2개 모두 HTTP 200, 한국어 SSR·선택값·토큰 및 `x-powered-by` 비노출 확인.
- 로컬 Playwright: Chromium의 소켓 권한 제한으로 앱을 열기 전에 중단되었습니다. 허용된 1회 sandbox escalation도 초기화에서 실패하여 재시도하지 않았습니다. 로컬 브라우저 검증을 통과했다고 주장하지 않습니다.
- GitHub CI [40046883276](https://github.com/zzz664/trot-you/actions/runs/40046883276): 원격 커밋 `378fc51c791c8cea944666503e1d2485ad4a46b4`에서 lint/타입/빌드, 단위 13개, E2E 6개 및 대비 검사 통과를 확인했습니다. 검토자가 생성된 6개 스크린샷을 확인했고 잘림·겹침·가로 넘침은 없었으나 일부 한국어 단어가 음절 단위로 줄바꿈되는 문제를 발견했습니다.

## 화면 검토 후 보완

- `word-break: keep-all`로 한국어 단어 단위 줄바꿈을 적용했습니다. 긴 문자열이나 글자 크기 200%에서는 `overflow-wrap: anywhere`가 가로 넘침을 막는 fallback으로 유지됩니다.
- E2E에 두 줄바꿈 속성 검사를 추가했습니다. 기존 3개 글자 크기 × 2개 너비 및 200% 글꼴 확대 넘침 검사는 유지합니다.
- 수정 후 로컬 `npm run check:all`을 다시 통과했습니다. 이전 CI 성공은 이 수정의 브라우저 검증 결과가 아닙니다. 새 원격 커밋의 CI 재실행과 새 스크린샷 검토가 필요합니다.

## 미구현 / 검토 사항

- 인증·DB·결제·메시지·PWA·외부 연동, 실제 사용자 흐름, 실기기 접근성 및 배포는 아직 구현·검증하지 않았습니다.
- 2026-10-24 사용자가 기존 PR 300줄 제한을 제거했습니다. 초기 기반의 설정·테스트·문서·생성된 잠금 파일을 하나의 기능 PR로 유지하며, 크기 제한에 대한 추가 승인은 필요하지 않습니다. 한 기능당 한 브랜치·한 PR 원칙은 유지합니다.
- 이 기록의 로컬 검사 통과는 원격 CI 통과나 병합·배포 완료를 뜻하지 않습니다.
