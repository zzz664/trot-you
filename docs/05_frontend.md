# 05. 프론트엔드 설계

> 기준: 개발기획안 5장(화면 목록), 9.1(접근성), 기획서 6장(중장년 UX 원칙)

---

## 1. 기술 선택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 프레임워크 | Next.js App Router, React Server Components 우선 | 초기 로딩 속도, 서버 조회 단순화 |
| 스타일 | Tailwind CSS + CSS 변수 토큰 | 글자 크기 3단계를 CSS 변수로 한 번에 제어 |
| 컴포넌트 | 자체 `components/ui` (Radix Primitives 기반 접근성) | 터치 영역·대비·라벨 규칙을 컴포넌트에 내장 |
| 폼 | React Hook Form + zod (서버 스키마 재사용) | 검증 규칙을 서버와 한 곳에서 |
| 클라이언트 상태 | URL + Server Component 재검증 우선, 필요 시 `useState`. 전역 스토어 없음 | 복잡도 억제 |
| 무한 스크롤 | TanStack Query (대화방·게시판 목록만) | 커서 페이지네이션 |
| PWA | `@serwist/next` (서비스 워커, 매니페스트, Web Push 수신) | |
| 음성 입력 | 브라우저 `SpeechRecognition` API. 미지원 브라우저는 OS 키보드 마이크 안내 | 외부 STT 비용 0 |
| 지도 | 외부 앱 링크(네이버·카카오 지도 URL 스킴) | 지도 SDK 로딩 없음 |
| 테스트 | Vitest + Testing Library, Playwright | |

---

## 2. 글자 크기 시스템 (가장 중요한 접근성 장치)

### 2.1 원리

`<html data-font-scale="normal | large | xlarge">` 속성 하나로 전체 앱의 글자·간격이 바뀐다. 컴포넌트는 px를 직접 쓰지 않고 토큰만 쓴다.

```css
/* src/app/globals.css */
:root {
  --fs-body: 18px;  --fs-title: 22px;  --fs-caption: 16px;  --fs-button: 20px;
  --space-unit: 8px;
  --touch-min: 48px;
  --input-min-h: 56px;
}
:root[data-font-scale="large"]  { --fs-body: 21px; --fs-title: 26px; --fs-caption: 18px; --fs-button: 23px; --space-unit: 10px; }
:root[data-font-scale="xlarge"] { --fs-body: 25px; --fs-title: 31px; --fs-caption: 21px; --fs-button: 27px; --space-unit: 12px; }
```

- 토큰 값은 `src/config/design-tokens.ts`에 하나의 객체로 정의하고 Tailwind 설정과 CSS 변수 생성을 **같은 객체에서** 만든다(값이 두 군데 있으면 어긋난다).
- `html`의 `font-size`는 사용자 OS 설정을 따르게 `rem` 기반으로 두고(`--fs-*`도 rem으로 변환), OS에서 글꼴을 키워도 레이아웃이 깨지지 않도록 **모든 컨테이너는 고정 높이 금지, `min-height`만 허용**.
- 선택값은 `profiles.font_scale`에 저장하고 서버 레이아웃에서 `data-font-scale`로 주입 → 첫 렌더부터 적용(깜빡임 없음). 로그인 전엔 쿠키.

### 2.2 검수 기준

| 항목 | 기준 | 검사 방법 |
| --- | --- | --- |
| 본문 | `--fs-body` ≥ 18px(normal) | 토큰 값 |
| 터치 영역 | 모든 interactive 요소 `min-h/min-w: var(--touch-min)` | `components/ui` 내장 + ESLint 커스텀 룰(원시 `<button>` 금지) |
| 대비 | 4.5:1 이상 | 팔레트를 `design-tokens.ts`에 고정, 검증 스크립트 `npm run check:contrast` |
| 아이콘 | 라벨 없는 아이콘 버튼 금지 | `IconButton`은 `label` prop 필수(타입으로 강제) |
| 3단계 × 22화면 깨짐 없음 | 출시 기준 | Playwright 스크린샷 66장 자동 생성, 수동 검수 |

---

## 3. 라우팅과 화면 매핑

| 화면 ID | 경로 | 렌더 | 비고 |
| --- | --- | --- | --- |
| S-01 | `/start` | RSC | 비로그인 랜딩. 버튼 1개 |
| S-02 | `/onboarding/font` | Client | 미리보기 즉시 반영 |
| S-03 | `/onboarding/name` | Client | 마이크 버튼 |
| S-04 | `/onboarding/artists` | RSC + Client | 카드 탭 → 맛보기 |
| — | `/onboarding/install` | Client | 홈 화면 추가 + 알림 허용 안내 (PWA 필수 단계) |
| H-01 | `/` | RSC | |
| M-01 | `/artists` | RSC | |
| M-02 / M-05 | `/artists/[slug]` | RSC + Client | 구독 여부로 대화방/맛보기 분기 |
| M-03 | `/artists/[slug]/media/[id]` | Client | 전체 화면, 저장 버튼 |
| M-04 | `/artists/[slug]/subscribe` | RSC + Action | 금액·다음 결제일·해지 방법 한 화면 |
| B-01 | `/board/[slug]` | RSC | |
| B-02 | `/board/[slug]/[postId]` | RSC | |
| B-03 | `/board/[slug]/new` | Client | |
| P-01 | `/points` | RSC | |
| C-01 | `/schedules` | RSC + Client | 월 이동은 URL `?month=` |
| C-02 | `/schedules/[id]` | RSC | |
| U-01 | `/me` | RSC | |
| U-02 | `/me/subscriptions` | RSC | |
| U-03 | `/me/help` | RSC | 전화·카톡 링크 |
| A-01 | `/artist/[slug]/compose` | Client | |
| A-02 | `/artist/[slug]/replies` | RSC | |
| A-03 | `/artist/[slug]/calendar` | RSC | |
| 어드민 | `/admin/*` | RSC + Action | 데스크톱 전용 레이아웃 허용 |

미들웨어(`src/middleware.ts`): 세션 없으면 `/start`, 온보딩 미완료면 `/onboarding/*`, `role`에 따라 `/artist`·`/admin` 접근 차단. 경로 문자열은 `src/config/routes.ts`에서만 가져온다.

---

## 4. 레이아웃·내비게이션 규칙

- 하단 탭 5개(홈·내 가수·팬 마당·일정·축제·내 정보): 아이콘 + 글자 라벨. 라벨 문구는 `messages/ko.json`.
- 모든 하위 화면 상단에 `BackButton`(글자 "뒤로" 포함). `app/(fan)/**/layout.tsx`가 자동 삽입.
- 팝업은 `components/ui/Dialog` 하나만 쓰고 전역 `DialogProvider`가 **동시에 하나만** 열리도록 큐 관리.
- 로딩은 스켈레톤이 아니라 "불러오는 중…" 글자 + 스피너(중장년은 스켈레톤을 깨진 화면으로 인식).
- 에러는 화면 안 인라인 문구 + 큰 "다시 시도" 버튼. 토스트는 쓰지 않는다(놓침).

---

## 5. 컴포넌트 규칙

```
components/ui/        도메인을 모름. props는 원시값·콜백만. Storybook 대상.
  Button, IconButton, Text, Heading, Input, TextArea, MicButton, Card,
  Dialog, BottomSheet, Tabs, List, ListItem, Avatar, Badge, Skeleton(어드민만), EmptyState
components/fan/       ui를 조립. 도메인 타입 사용. 서버 데이터는 props로 받음.
  MessageBubble, MessageList, ReplyComposer, ArtistCard, SubscribeSummary, PostCard, ScheduleCard …
components/artist/    MessageComposer, ReplyFeed, CalendarGrid, ActivityGauge
components/admin/     DataTable, SettingsForm, SettlementReport …
```

- `MicButton`: `onResult(text)` 콜백. 내부에서 `SpeechRecognition` 가용성 검사, 미지원 시 안내 문구. `voice_input_used` 이벤트는 이 컴포넌트가 보낸다(중복 구현 방지).
- `MessageBubble`은 치환 완료된 문자열을 받는다. 클라이언트에서 `{이름}`을 바꾸지 않는다.
- 금액 표시는 `lib/format.ts`의 `formatKrw` 하나만. "6,500원" 문자열을 컴포넌트에 쓰지 않는다.

---

## 6. 문구·i18n

- 사용자 노출 문구는 전부 `src/messages/ko.json`. 키는 `화면.요소` (예: `subscribe.cta`, `errors.FORBIDDEN_CONTENT`).
- `next-intl`로 읽는다. 다국어는 2차 밖이지만 **구조는 처음부터** 이렇게 둔다(문구 수정이 코드 변경 없이 가능하다는 것이 핵심 이득).
- 어드민에서 수정해야 하는 안내문(해지 방법, 고객센터 번호)은 `app_settings`의 `public.*` 키로 두고 서버에서 주입.

---

## 7. PWA·푸시

- `manifest.webmanifest`: 이름, 아이콘, `display: standalone`, `start_url: /`.
- 서비스 워커(`src/app/sw.ts`): 푸시 수신 → 알림 표시 → 클릭 시 `payload.url`로 이동. 오프라인 캐시는 정적 자산만(대화방 캐시는 2차).
- 온보딩 `/onboarding/install`: iOS는 "공유 → 홈 화면에 추가" 그림 안내, Android는 `beforeinstallprompt`로 버튼 제공. 알림 권한은 홈 화면 추가 **이후**에 요청(iOS 제약).
- 권한 상태는 `/me`에서 다시 켤 수 있게 안내.

---

## 8. 성능 기준 구현

| 기준 | 구현 |
| --- | --- |
| 홈 3초 | RSC + `next/image` + Storage 이미지 변환(`?width=`). 홈 데이터는 쿼리 3개 이내 |
| 대화방 1초 | 첫 30개 RSC로 렌더, 이후 TanStack Query 무한 스크롤 |
| 미디어 | 사진 lazy, 음성·영상은 탭 시 로드. 서명 URL은 서버 조회 시 함께 발급 |
| 번들 | 어드민·아티스트 모드는 별도 라우트 그룹 → 팬 번들에 섞이지 않음 |

---

## 9. 테스트

- 단위: `components/ui` 각 컴포넌트의 접근성 속성(role, label, min size).
- E2E(Playwright, preview 환경): 출시 기준 시나리오 "가입 → 글자 크기 → 이름 → 가수 → 맛보기 → 구독(mock) → 대화방 → 답장" 1개를 **3단계 글자 크기 × 2 뷰포트(360px, 414px)**로 실행.
- 사용성 테스트(50~60대 8~10명)는 preview URL로 진행하고, 세션 녹화 대신 `analytics_events`로 퍼널 이탈 지점을 본다.
