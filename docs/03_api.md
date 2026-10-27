# 03. API 설계

> 기준: 개발기획안 8장(API 목록), 6장(기능 명세)

---

## 1. 호출 방식 선택 기준

Next.js App Router에서는 두 가지 방식을 쓴다. 섞어 쓰되 기준은 하나다.

| 방식 | 쓰는 경우 | 예 |
| --- | --- | --- |
| **Server Action** | 팬·가수·어드민 화면에서 폼 제출, 버튼 클릭 등 UI와 1:1로 묶인 쓰기 | 답장 보내기, 출석 체크, 글쓰기, 글자 크기 변경 |
| **Route Handler (`/api/*`)** | 외부가 호출하거나(웹훅, Cron), 브라우저 외 클라이언트가 쓸 수 있거나, 파일 업로드 URL처럼 UI와 분리된 것 | 결제 웹훅, Cron, 업로드 URL, 메시지 목록(무한 스크롤) |
| **Server Component 직접 조회** | 읽기 전용 초기 렌더 | 홈, 가수 목록, 일정 달력 |

**둘 다 `src/server/services/*`의 같은 함수를 호출한다.** Server Action과 Route Handler에 로직을 쓰지 않는다.

---

## 2. 공통 규약

### 2.1 응답 형식

```ts
// 성공
{ ok: true, data: T, meta?: { nextCursor?: string } }
// 실패
{ ok: false, error: { code: ErrorCode, message: string, details?: unknown } }
```

Server Action도 같은 형태의 객체를 반환한다(throw 하지 않는다). UI는 `error.code`로 분기하고, 사용자 문구는 `messages/ko.json`의 `errors.<code>`에서 가져온다.

### 2.2 에러 코드 (`src/server/errors.ts`)

| code | HTTP | 의미 |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | 로그인 필요 |
| `FORBIDDEN` | 403 | 역할·소유권 불일치 |
| `NOT_FOUND` | 404 | |
| `VALIDATION_FAILED` | 400 | zod 검증 실패. `details`에 필드별 오류 |
| `FORBIDDEN_CONTENT` | 400 | 금칙 패턴·욕설 포함 (F-04 "이 내용은 보낼 수 없어요") |
| `SUBSCRIPTION_REQUIRED` | 402 | 구독이 없거나 만료 |
| `SUBSCRIPTION_EXISTS` | 409 | 이미 구독 중 |
| `PAYMENT_FAILED` | 402 | PG 승인 실패. `details.providerCode` |
| `INVALID_TRANSITION` | 409 | 상태 기계 위반 |
| `CANCEL_WINDOW_PASSED` | 409 | 발송 취소 가능 시간 초과 |
| `RATE_LIMITED` | 429 | |
| `INTERNAL` | 500 | 상세는 로그에만 |

### 2.3 검증

모든 입력은 `src/server/schemas/*.ts`의 zod 스키마로 검증한다. 길이 제한 등 숫자는 스키마 생성 시 `getSetting`으로 읽어 넣는다(`replySchema(await getSetting('reply.max_length'))` 형태의 팩토리).

### 2.4 인증·권한

- 세션: Supabase SSR 헬퍼(`@supabase/ssr`)로 쿠키 기반. `src/server/db/client.ts`의 `createServerClient()` 사용.
- 권한 검사: `src/server/auth/guard.ts`
  - `requireUser()` → 로그인 사용자
  - `requireRole('artist' | 'admin')`
  - `requireArtistMember(artistId)` → 가수 계정이 그 가수 소속인지
  - `requireSubscriber(artistId)` → `has_active_access`
- Cron: `Authorization: Bearer ${CRON_SECRET}` 검사. Vercel Cron이 자동으로 붙인다.
- 웹훅: PG가 제공하는 서명 검증. 실패 시 401, 로그 남김.

### 2.5 페이지네이션

커서 방식만 쓴다. `?cursor=<base64(sent_at|id)>&limit=`. `limit` 기본값·상한은 `app_settings`(`message.page_size`) 또는 `config/constants.ts`(기술 상한 100).

### 2.6 속도 제한

Vercel Edge Middleware + Upstash 없이 시작한다. 답장·글쓰기·신고는 서비스 레이어에서 DB 기반 간단 제한(사용자별 1분 N회, N은 설정값). 2차에 외부 레이트리밋 도입.

---

## 3. 엔드포인트 목록

### 3.1 인증·사용자

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/auth/callback` | — | Supabase OAuth 콜백. 세션 교환 후 온보딩 여부에 따라 리다이렉트 |
| Action | `signOut()` | user | |
| Action | `updateProfile({ callName?, fontScale? })` | user | F-01. 부를 이름 길이·욕설 검사 |
| Action | `completeOnboarding()` | user | `onboarding_completed_at` 기록, `signup_complete` 이벤트 |
| Action | `updateNotificationPreferences(prefs)` | user | |
| POST | `/api/push/subscribe` | user | Web Push 구독 저장 |
| DELETE | `/api/push/subscribe` | user | |

### 3.2 가수·맛보기

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| RSC | `listActiveArtists()` | 공개 | S-04, 홈 |
| RSC | `getArtist(slug)` | 공개 | |
| GET | `/api/artists/{id}/preview` | user | F-05. 맛보기 메시지, `{이름}` 치환 적용, `preview_view` 이벤트 |

### 3.3 구독·결제

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| Action | `startSubscription(artistId)` | user | `pending` 생성 → PG 빌링키 발급 URL 반환. `subscribe_start` 이벤트 |
| GET | `/api/payment/callback` | user | PG 카드 등록 콜백 → 빌링키 교환 → 1회차 청구 → `active` 전이. 성공 시 대화방으로, 실패 시 M-04로 돌아가 `PAYMENT_FAILED` 문구 |
| POST | `/api/webhooks/payment` | PG | 결제 상태 이벤트. `webhook_receipts`로 중복 차단 |
| RSC | `getMySubscriptions()` | user | U-02. 다음 결제일, 금액 |
| Action | `cancelSubscription(subscriptionId, reason?)` | user(소유자) | `canceled` 전이. `current_period_end`까지 열람 유지 |
| Action | `resumeSubscription(subscriptionId)` | user | `canceled` → 기간 내면 `active` (2차 검토) |

### 3.4 메시지·답장

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| GET | `/api/artists/{id}/messages?cursor=&limit=` | subscriber | 치환 완료본. `visible_before_subscription_days` 적용. `message_open`은 클라이언트가 보이는 시점에 기록 |
| POST | `/api/artists/{id}/messages/{messageId}/read` | subscriber | 읽음 처리 (idempotent) |
| GET | `/api/media/signed-url?path=` | subscriber/user | 미디어 서명 URL. 버킷별 권한 검사 |
| Action | `sendReply(artistId, body)` | subscriber | F-04. 길이·금칙 검사, `reply_sent` 이벤트 |

### 3.5 아티스트 모드

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| Action | `saveMessage(artistId, draft)` | artist member | 글·미디어·`scheduled_at`. `scheduled_at` 없으면 즉시 = now |
| Action | `cancelMessage(messageId)` | artist member | `cancel_window_minutes` 이내만. 큐 삭제 |
| RSC | `previewMessage(body, sampleName)` | artist member | "김순자 님에게는 이렇게 보여요" |
| RSC | `listReplies(artistId, cursor)` | artist member | `call_name`만 조인 |
| RSC | `getArtistCalendar(artistId, month)` | artist member | 콘텐츠 캘린더 + 이번 주 활동량 + 계약 기준 대비 |
| POST | `/api/media/upload-url` | artist member / user | 버킷·확장자·크기 검사 후 서명 업로드 URL |

### 3.6 게시판·신고·포인트

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| RSC | `listPosts(artistId, cursor)` | user | 공지 고정 상단 |
| RSC | `getPost(postId)` | user | 댓글 포함 |
| Action | `createPost(artistId, { title, body, images })` | user | 금칙 검사, 포인트 적립, `post_create` 이벤트 |
| Action | `createComment(postId, body)` | user | 포인트 적립 |
| Action | `togglePostLike(postId)` | user | |
| Action | `deletePost(postId)` / `deleteComment(id)` | 소유자 | 소프트 삭제 |
| Action | `createReport({ targetType, targetId, reason })` | user | 트리거가 자동 숨김 처리 |
| Action | `checkAttendance()` | user | KST 날짜 기준 하루 1회. `attendance` 이벤트 |
| RSC | `getPointSummary()` | user | 잔액 + 최근 내역 |

### 3.7 일정

| 방식 | 경로/액션 | 권한 | 설명 |
| --- | --- | --- | --- |
| RSC | `listSchedules({ artistIds?, month })` | user | 내 가수 필터는 클라이언트 상태 |
| RSC | `getSchedule(id)` | user | 지도 링크는 `lib/map-links.ts`가 좌표로 생성 |
| Action | `toggleScheduleNotification(scheduleId)` | user | optout 행 토글 |

### 3.8 운영 어드민 (`/admin`, role=admin)

| 방식 | 액션 | 설명 |
| --- | --- | --- |
| Action | `upsertArtist(input)` | 가수 등록·수정 |
| Action | `issueArtistAccount(artistId, email)` | Supabase Admin API로 계정 생성, `artist_members` 연결, `role=artist` |
| Action | `setPreviewMessages(artistId, messageIds[])` | 맛보기 지정(최대 `preview_max_count`) |
| Action | `upsertSchedule(input)` / `deleteSchedule(id)` | |
| Action | `upsertContentCalendar(artistId, entries[])` | 월간 주제 |
| Action | `createNotice(artistId, input)` | 공지 작성·고정 |
| Action | `resolveReport(reportId, decision)` | 복구·삭제, 신고자에게 알림 큐 적재 |
| Action | `restrictUser(userId, until)` | 이용 제한 |
| Action | `updateSetting(key, value)` | `app_settings` 수정 (zod로 키별 타입 검증) |
| RSC | `getSubscriptionDashboard(artistId?, range)` | 구독자 수, 신규·해지, 재결제율 |
| RSC | `getActivityDashboard(week)` | 가수별 주간 활동량 |
| RSC | `getSettlement(artistId, month)` / Action `confirmSettlement(id)` | 정산 리포트 |
| GET | `/api/admin/settlements/{id}/export` | 엑셀 내려받기 (`xlsx` 생성은 서버) |
| RSC | `getFunnelDashboard(range)` | 10장 핵심 지표 4종 |

### 3.9 Cron (`/api/cron/*`, Bearer CRON_SECRET)

| 경로 | 주기 (vercel.json) | 서비스 함수 |
| --- | --- | --- |
| `dispatch-messages` | `* * * * *` | `message/dispatch.ts` |
| `send-notifications` | `* * * * *` | `notification/send-queue.ts` |
| `charge-renewals` | `*/10 * * * *` | `subscription/charge-due.ts` |
| `notify-billing` | `0 1 * * *` (UTC = 10:00 KST) | `notification/billing-notice.ts` |
| `notify-schedules` | `0 * * * *` (매시, KST 시각이 `schedule.notice_hour_kst`일 때만 발송) | `notification/schedule-notice.ts` |
| `aggregate-weekly-stats` | `10 15 * * 0` (UTC = 월 00:10 KST) | `settlement/weekly-stats.ts` |
| `settle` | `0 0 1 * *` (UTC = 1일 09:00 KST) | `settlement/monthly.ts` |

> 매분 크론은 Vercel **Pro** 플랜에서만 배포된다(Hobby는 하루 1회 제한). 크론 시각은 vercel.json에 고정되므로, 운영 중 바뀔 수 있는 시각은 "매시 실행 + 설정값 비교" 방식으로 처리한다.

Cron 경로 하나는 10초 안에 끝나야 한다(Vercel 함수 시간 제한 고려). 큐 처리는 한 번에 배치 크기(`notification.batch_size`, 기본 500)만 처리하고 남은 건 다음 분에 처리한다.

---

## 4. 측정 이벤트 API

`src/server/services/analytics/track.ts`의 `track(name, properties, userId?)` 한 함수. 이벤트명은 `src/config/analytics-events.ts`의 상수 객체에서만 가져온다(문자열 리터럴 금지).

```ts
export const AnalyticsEvent = {
  SIGNUP_COMPLETE: 'signup_complete',
  FONT_SIZE_SELECTED: 'font_size_selected',
  PREVIEW_VIEW: 'preview_view',
  SUBSCRIBE_START: 'subscribe_start',
  SUBSCRIBE_COMPLETE: 'subscribe_complete',
  SUBSCRIBE_FAIL: 'subscribe_fail',
  MESSAGE_OPEN: 'message_open',
  REPLY_SENT: 'reply_sent',
  VOICE_INPUT_USED: 'voice_input_used',
  RENEW: 'renew',
  CANCEL: 'cancel',
  POST_CREATE: 'post_create',
  ATTENDANCE: 'attendance',
} as const;
```

클라이언트 이벤트(`message_open`, `voice_input_used`)는 `POST /api/analytics` 로 보내고 서버가 같은 `track`을 호출한다.

---

## 5. 서비스 함수 시그니처 예시

서비스 함수는 **의존성을 인자로 받는다**(테스트에서 어댑터를 바꿔 끼우기 위해). 앱 코드에서는 `src/server/container.ts`가 실제 구현체를 묶어 준다.

```ts
// src/server/services/subscription/start.ts
export async function startSubscription(
  deps: { db: Db; payment: PaymentProvider; settings: Settings; analytics: Analytics },
  input: { userId: string; artistId: string },
): Promise<Result<{ redirectUrl: string }, 'SUBSCRIPTION_EXISTS' | 'NOT_FOUND'>> { ... }
```

`Result<T, E>`는 `src/lib/result.ts`에 정의한다. 서비스는 예외 대신 `Result`를 반환하고, 예상 못 한 오류만 throw 한다.
