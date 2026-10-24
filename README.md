# 트롯유 (trot-you)

한국어 팬 서비스의 Next.js App Router 애플리케이션입니다. **현재 구현 범위는 개발 기반·접근성 UI·연동 설정 검증과 준비 화면뿐입니다.** 회원가입·구독·결제·메시지 기능 또는 운영 배포가 완료된 상태가 아닙니다.

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
- 서버 기능은 `server/services → adapters | db | settings` 순서로 추가합니다. 현재 서버에는 설정 검증·로그·운영 설정 draft 검증만 있습니다.
- 기본 글자 크기는 `large`; 로그인 전 쿠키를 첫 서버 렌더에 적용합니다. 프로필 저장은 아직 없습니다.
- Supabase·인증·결제·알림·PWA는 별도 기능 PR에서 구현합니다. 현재 서비스 워커·DB 연결·가짜 결제 성공 로직은 없습니다.

## 연동 설정 기반

[설정·오류·로그·운영 설정 안내](docs/configuration/integration-foundations.md)를 참고하세요. 기본 결제 mode는 `disabled`이고, 키 누락이나 잘못된 mode를 mock 성공으로 바꾸지 않습니다. `configured`는 credential 형태/존재만 뜻하며 모든 연동의 `operational`은 아직 `false`입니다. 운영 설정 기본값은 DB 값이나 승인된 정책이 아닌 문서 기반 draft입니다.

## 브랜치와 작업 기록

`main`은 배포용, `develop`은 기본 개발 통합 브랜치입니다. 두 브랜치에 기능 코드를 직접 푸시하지 않습니다. 기능 하나마다 브랜치 하나를 만들고 검증 후 PR로 `develop`에 병합합니다. 완료 브랜치를 삭제한 다음 다음 기능을 시작합니다. 운영 배포는 별도 승인 대상입니다.

2026-10-24 사용자 결정으로 PR 300줄 제한은 제거했습니다. 한 기능에 집중하는 PR 원칙과 검증·리뷰 기록은 유지합니다.

변경 목적, 설계 결정, 검사 결과, 미검증 항목은 [`docs/work-log/`](docs/work-log/)에 기록합니다. 비공개 원본 설계 문서나 자격 증명은 공개 저장소에 복사하지 않습니다.

## 알려진 개발 도구 제약

Next.js 권장 ESLint 구성의 React/import/a11y 플러그인 호환 범위에 맞춰 ESLint 9.39.5를 고정했습니다. [ESLint 9는 EOL](https://eslint.org/version-support/)이며, 호환 플러그인이 출시되면 ESLint 10으로 함께 갱신해야 합니다. 런타임 의존성이 아닌 개발 도구 제약이며, 점검일과 보안 검사 결과는 작업 기록에 남깁니다.
