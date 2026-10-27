# 06. 코딩 규칙

> 목적: 사람 3명 + 에이전트(Codex, Claude Code)가 같은 코드베이스에서 **같은 품질**을 내게 한다.
> 원칙: 규칙은 문서가 아니라 **도구가 강제**한다. 도구로 못 잡는 것만 리뷰에서 본다.

---

## 1. 하드코딩 금지 — 구체적 규칙

"하드코딩 금지"를 판별 가능한 규칙으로 바꾼다. 아래 표의 값은 **코드 본문에 리터럴로 나타나면 안 된다.**

| 값의 종류 | 있어야 할 곳 | 읽는 법 | 예 |
| --- | --- | --- | --- |
| 운영 중 바뀔 수 있는 숫자·목록 (가격, 글자 수, 주기, 금칙어, 임계값) | DB `app_settings` | `getSetting('reply.max_length')` | 6500, 100, 7일, 3건 |
| 환경에 따라 다른 값 (URL, 키, 프로바이더 선택) | 환경 변수 → `src/config/env.ts` | `env.TOSS_SECRET_KEY` | API 키, 앱 URL |
| 사용자에게 보이는 문구 | `src/messages/ko.json` | `t('subscribe.cta')` | "구독하기", 에러 안내 |
| 경로·라우트 | `src/config/routes.ts` | `routes.artist(slug)` | `/artists/${slug}` |
| 이벤트명·설정 키·버킷명 같은 식별자 | `src/config/*.ts`의 `as const` 객체 | `AnalyticsEvent.REPLY_SENT` | `'reply_sent'` |
| 디자인 값 (글자 크기, 색, 간격) | `src/config/design-tokens.ts` → CSS 변수 | `var(--fs-body)` | `18px`, `#333` |
| 절대 안 바뀌는 기술 상수 | `src/config/constants.ts` | `MAX_PAGE_LIMIT` | 커서 상한 100, 재시도 백오프 |

**예외(리터럴 허용):** `0`, `1`, `-1`, 빈 문자열, 배열 인덱스, 테스트 코드의 입력값, 타입 정의의 리터럴 타입.

**판별 질문:** "이 값을 바꾸려면 배포가 필요한가?" → 운영팀이 바꿀 값인데 배포가 필요하면 위치가 틀린 것이다.

### 1.1 도구 강제

```js
// eslint.config.mjs (발췌)
'no-magic-numbers': ['error', { ignore: [0, 1, -1], ignoreArrayIndexes: true, enforceConst: true, detectObjects: false }],
'no-restricted-syntax': ['error',
  { selector: "MemberExpression[object.name='process'][property.name='env']", message: 'env는 src/config/env.ts를 통해서만 읽는다.' },
  { selector: "JSXText[value=/[가-힣]/]", message: '한글 문구는 messages/ko.json에 둔다.' },
  { selector: "Literal[value=/^\\/(artists|board|schedules|me|admin|artist|api)/]", message: '경로는 config/routes.ts에서 가져온다.' },
],
'no-restricted-imports': ['error', { patterns: [
  { group: ['**/adapters/**'], message: 'adapters는 services에서만 import한다.' },  // app/, components/ 전용 override
  { group: ['next/*'], message: 'services는 next를 모른다.' },                       // server/services 전용 override
]}],
```

- `tests/`와 `supabase/seed.sql`은 `no-magic-numbers` 제외.
- `src/config/**`는 리터럴이 **있어야 하는** 곳이므로 제외.

---

## 2. 레이어와 의존 방향

```
app → services → adapters | db | settings → config | lib | types
```

| 레이어 | 허용 | 금지 |
| --- | --- | --- |
| `app/` (page, layout, route, action) | services 호출, UI 조립, 입력 파싱 | 비즈니스 분기, SQL, 외부 API 호출 |
| `components/ui` | 원시 props, 토큰 | 도메인 타입 import, 데이터 fetch |
| `components/{fan,artist,admin}` | ui 조립, 도메인 타입 | 데이터 fetch(서버에서 props로 받음), Server Action 직접 import는 허용 |
| `server/services` | 도메인 로직, `Result` 반환, deps 주입 | `next/*`, 직접 `fetch`, `process.env` |
| `server/adapters` | 외부 I/O 구현 | 도메인 판단 (성공/실패만 정규화) |
| `server/db` | Supabase 클라이언트 생성, 쿼리 헬퍼 | 비즈니스 로직 |
| `lib/` | 순수 함수 | I/O 일체 |

**같은 기능이 두 곳에서 필요하면 services에 하나 만들고 둘 다 호출한다.** 복붙 발견 시 리뷰 반려.

---

## 3. TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- `any` 금지(ESLint `no-explicit-any: error`). 외부 응답은 `unknown`으로 받아 zod로 좁힌다.
- DB 타입은 생성된 `src/types/database.ts`만 쓴다. 테이블 행 타입은 `Tables<'subscriptions'>` 헬퍼로.
- 서비스 함수는 `Result<T, E>`를 반환. `E`는 `src/server/errors.ts`의 코드 유니온 부분집합.
- `enum` 대신 `as const` 객체 + 유니온 타입.

---

## 4. 네이밍

| 대상 | 규칙 | 예 |
| --- | --- | --- |
| 파일 | kebab-case. 컴포넌트 파일은 PascalCase | `charge-due.ts`, `MessageBubble.tsx` |
| 컴포넌트 | PascalCase 명사 | `SubscribeSummary` |
| 함수 | camelCase 동사 | `startSubscription`, `renderMessageBody` |
| 서비스 함수 파일 | 1 파일 = 1 유스케이스 | `subscription/start.ts`, `subscription/cancel.ts` |
| Server Action | 동사 + 명사, `'use server'` 파일은 `actions.ts` | `app/(fan)/artists/[slug]/actions.ts` |
| 불리언 | `is/has/can` 접두 | `isIntroUsed` |
| 시간 | `*At` (Date), `*Ms`/`*Days` 단위 접미 | `nextBillingAt`, `graceDays` |
| 금액 | `*Krw` 접미, 정수 | `amountKrw` |
| 설정 키 | `영역.항목` 점 표기 | `message.cancel_window_minutes` |
| DB | snake_case (02 문서) | |

---

## 5. 컴포넌트 작성 규칙

- Server Component가 기본. `'use client'`는 상태·이벤트·브라우저 API가 필요한 **최소 단위**에만.
- props는 명시적 타입. `children` 외 spread props 금지.
- `components/ui`의 모든 interactive 컴포넌트는 `min-h-[var(--touch-min)]`를 내장한다. 원시 `<button>`, `<a>`, `<input>`을 `app/`·`components/{fan,artist,admin}`에서 쓰면 ESLint 오류.
- `IconButton`의 `label`은 필수 prop. 화면에 글자로도 표시된다.
- 조건부 렌더의 빈 상태는 `EmptyState` 컴포넌트로 통일(문구는 i18n).

---

## 6. 서버 코드 규칙

- 모든 입력은 zod로 검증한 뒤 서비스에 넘긴다. 서비스는 이미 검증된 타입을 받는다.
- 트랜잭션이 필요한 쓰기(구독 전이+이벤트, 포인트 적립+카운트)는 **DB 함수(RPC)** 하나로 묶는다. 앱 코드에서 여러 쿼리를 순차 실행해 정합성을 흉내 내지 않는다.
- 외부 호출은 반드시 타임아웃(`config/constants.ts`의 `EXTERNAL_TIMEOUT_MS`)과 재시도 정책을 가진다.
- 로그는 `src/lib/logger.ts`(pino). `console.log` 금지(ESLint). 개인정보(이름, 전화)는 로그에 남기지 않는다 — 로거의 redact 설정.
- Cron Route Handler 템플릿:
  ```ts
  export const GET = withCron(async (deps) => dispatchScheduledMessages(deps));
  ```
  `withCron`이 시크릿 검증·타임아웃·오류 로깅을 담당. 핸들러마다 반복하지 않는다.

---

## 7. 테스트 기준

| 층 | 도구 | 필수 범위 |
| --- | --- | --- |
| 단위 | Vitest | `lib/*` 전부, `services/settlement/calculate.ts`, `services/message/render.ts`, `lib/validation/*`, 상태 전이 |
| 통합 | Vitest + 로컬 Supabase | 구독 생명주기(04 §4 매트릭스), 메시지 발송→큐 적재, 포인트 중복 방지, RLS(팬이 남의 구독 못 봄) |
| E2E | Playwright | 출시 기준 시나리오 1개 × 글자 3단계 × 뷰포트 2 |
| 부하 | k6 (`tests/load/`) | 구독자 1,000명 발송 1분 |

- 새 서비스 함수는 단위 또는 통합 테스트 없이는 머지하지 않는다.
- 테스트는 `mock` 어댑터를 쓴다. 실제 PG·알림톡을 호출하는 테스트는 없다.
- 커버리지 수치 목표는 두지 않는다. 대신 위 "필수 범위"가 체크리스트다.

---

## 8. Git·PR

- 브랜치: `main`(production), `develop`(preview), 작업은 `feat/<영역>-<요약>`, `fix/…`, `chore/…`.
- 커밋: Conventional Commits. `feat(subscription): 갱신 청구 Cron 추가`.
- PR은 **한 유스케이스**. 300줄 넘으면 쪼갠다(에이전트에게도 같은 기준).
- PR 템플릿 체크리스트:
  - [ ] 관련 문서 섹션 링크 (`docs/0X_*.md §N`)
  - [ ] 리터럴이 config/settings/messages 밖에 없음
  - [ ] 서비스 함수에 테스트 있음
  - [ ] 글자 크기 3단계 확인 (UI 변경 시 스크린샷 3장)
  - [ ] 문서와 코드가 다르면 문서도 수정함
- CI (GitHub Actions): `npm run lint && npm run typecheck && npm run test && npm run build`. 실패 시 머지 불가. preview 배포는 Vercel이 자동.
- 에이전트가 만든 PR도 사람이 읽고 머지한다. 머지 버튼은 사람만 누른다.

---

## 9. npm 스크립트 (package.json)

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint . && prettier --check .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test",
    "db:start": "supabase start",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > src/types/database.ts",
    "db:migrate:new": "supabase migration new",
    "check:contrast": "node scripts/check-contrast.mjs",
    "check:all": "npm run lint && npm run typecheck && npm run test && npm run build"
  }
}
```

에이전트에게 "작업 끝나면 `npm run check:all`이 통과해야 한다"를 항상 포함한다.
