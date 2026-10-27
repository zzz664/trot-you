# 04. 결제·정산 설계

> 기준: 개발기획안 F-02(구독 결제), F-10(정산 규칙), 13장 확인 사항 1·3·4
> 전제: `01_architecture.md` §2.1 — MVP는 PG 정기결제(빌링키), 스토어 결제는 확장 포인트로 남김

---

## 1. PaymentProvider 인터페이스

결제 수단·PG가 바뀌어도 서비스 레이어가 바뀌지 않도록 인터페이스를 고정한다.

```ts
// src/server/adapters/payment/provider.ts
export interface PaymentProvider {
  readonly id: 'toss' | 'mock' | 'appstore' | 'playstore';

  /** 빌링키 등록 화면으로 보낼 URL (카드·간편결제·휴대폰 선택은 PG 창에서) */
  createBillingSession(input: {
    customerKey: string;        // userId
    subscriptionId: string;
    successUrl: string;
    failUrl: string;
  }): Promise<{ redirectUrl: string }>;

  /** 콜백에서 받은 authKey를 빌링키로 교환 */
  exchangeBillingKey(input: { customerKey: string; authKey: string }): Promise<{ billingKeyRef: string; method: PaymentMethod }>;

  /** 빌링키로 청구 */
  charge(input: {
    billingKeyRef: string;
    customerKey: string;
    orderId: string;            // payment_events.id 를 미리 생성해 사용 → 멱등
    amountKrw: number;
    orderName: string;
  }): Promise<ChargeResult>;

  /** 환불 */
  refund(input: { providerTxId: string; amountKrw: number; reason: string }): Promise<RefundResult>;

  /** 웹훅 서명 검증 + 정규화 */
  parseWebhook(req: Request): Promise<NormalizedWebhookEvent | null>;
}

export type ChargeResult =
  | { ok: true; providerTxId: string; approvedAt: Date; raw: unknown }
  | { ok: false; code: string; message: string; retryable: boolean; raw: unknown };

export type NormalizedWebhookEvent = {
  eventId: string;              // 중복 차단용
  type: 'charge.succeeded' | 'charge.failed' | 'refund.completed' | 'billing_key.revoked';
  providerTxId?: string;
  customerKey: string;
  amountKrw?: number;
  occurredAt: Date;
  raw: unknown;
};
```

- `src/server/adapters/payment/toss.ts`: 실구현. 토스페이먼츠 빌링 API.
- `src/server/adapters/payment/mock.ts`: 로컬·테스트용. 성공/실패/지연을 환경 변수로 제어.
- 선택은 `env.PAYMENT_PROVIDER`로. 스토어 결제가 필요해지면 `appstore.ts`, `playstore.ts`를 추가하고 `createBillingSession` 대신 영수증 검증 흐름을 같은 인터페이스에 맞춘다(그때 인터페이스에 `verifyReceipt`를 추가하는 것은 허용).

---

## 2. 구독 생명주기

### 2.1 신규 구독

```
startSubscription
  1. 기존 구독 확인 → active/grace/canceled(기간 내)면 SUBSCRIPTION_EXISTS
  2. subscriptions INSERT (pending, provider)
  3. provider.createBillingSession → redirectUrl
  4. track(SUBSCRIBE_START)

/api/payment/callback (success)
  1. authKey → exchangeBillingKey → billing_key_ref 저장
  2. 금액 결정: is_intro_used=false 이면 intro_price_krw, 아니면 price_krw
     (한 사용자가 같은 가수를 재구독하면 intro 재적용 금지. 다른 가수는 가수마다 첫 달 적용 — PM 확인 D-8로 추가)
  3. payment_events INSERT (type=initial, 금액, period)  ← orderId 선생성
  4. provider.charge
  5. 성공: transition(pending→active), started_at/current_period/next_billing_at 설정, is_intro_used=true, track(SUBSCRIBE_COMPLETE), 알림 큐(구독 환영)
     실패: payment_events UPDATE 없음 → 별도 failed 이벤트 INSERT, track(SUBSCRIBE_FAIL), M-04로 리다이렉트 + 에러 코드
```

기간 계산은 `src/lib/billing-period.ts` 한 곳. 월 단위, 31일 → 다음 달 말일 보정(date-fns `addMonths`).

### 2.2 갱신 (Cron `charge-renewals`, 10분마다)

```
대상: status in (active, grace) AND next_billing_at <= now()
각 건:
  1. payment_events INSERT (type=renewal 또는 retry)
  2. charge(price_krw)
  3. 성공 → active, period 1개월 연장, next_billing_at 갱신, track(RENEW)
     실패(retryable) → grace, next_billing_at += retry_interval_hours(설정, 기본 24), 알림 큐(결제 실패 안내)
     실패(non-retryable, 예: 카드 해지) → grace, 사용자에게 카드 재등록 안내
  4. grace 진입 후 grace_days 경과 → expired, 알림 큐(만료 안내)
```

멱등성: `payment_events.id`를 `orderId`로 쓰므로 Cron이 겹쳐 돌아도 PG가 중복 승인을 거절한다. 추가로 대상 조회 시 `for update skip locked`.

### 2.3 해지

- 사용자 해지: `canceled`. `current_period_end`까지 열람. `next_billing_at = null`. track(CANCEL).
- 기간 종료 후 Cron이 `canceled → expired`.
- **환불 정책(결정 필요 D-9):** 기본안 — 결제 후 7일 이내 미열람(message_reads 0건)이면 전액 환불, 그 외 환불 없음. 어드민에서 수동 환불 가능(`provider.refund` + `payment_events` type=refund 음수).

### 2.4 웹훅

PG 웹훅은 **보조 채널**이다. 승인은 동기 응답으로 이미 처리했으므로 웹훅은 (a) 우리가 못 받은 응답의 보정, (b) PG 측 환불·빌링키 해지 반영에 쓴다.

```
/api/webhooks/payment
  1. provider.parseWebhook → 서명 실패 시 401
  2. webhook_receipts INSERT (provider, eventId) → 충돌이면 200 반환(이미 처리)
  3. type별 처리:
     charge.succeeded  → 해당 providerTxId의 payment_events 존재 확인. 없으면 보정 INSERT + 구독 전이
     charge.failed     → 보정 (갱신 실패와 같은 처리)
     refund.completed  → payment_events refund INSERT (음수)
     billing_key.revoked → subscriptions.billing_key_ref = null, grace 전이, 재등록 안내
  4. processed_at 기록, 200
```

---

## 3. 정산

### 3.1 계산 규칙 (기획안 F-10을 PG 기준으로 치환)

```
gross            = Σ payment_events.amount_krw (해당 월, type in initial/renewal/retry, refund 음수 포함)
vat              = gross × vat_rate / (1 + vat_rate)          -- 부가세 포함가에서 역산
pg_fee           = (gross − vat) × pg_fee_rate
base_amount      = gross − vat − pg_fee                        -- 정산 기준 금액
rate             = performance_conditions 충족 ? performance_rate : base_rate
activity_ratio   = min(1, (Σ 주간 message_count / Σ 주간 weekly_message_min
                            + Σ photo_count / Σ weekly_photo_min) / 2)
deduction        = base_amount × rate × (1 − activity_ratio)
final_amount     = base_amount × rate − deduction
```

- 모든 비율·기준은 `app_settings`에서 읽는다. 함수는 `src/server/services/settlement/calculate.ts`이며 **순수 함수**(입력: 이벤트 배열, 주간 통계 배열, 설정 객체 → 출력: `SettlementBreakdown`). 테스트는 이 함수에 집중한다.
- `performance_conditions`가 `null`이면 항상 `base_rate`.
- 원 단위 반올림은 마지막 `final_amount`에서만 한다. 중간값은 소수로 유지하고 `breakdown`에 그대로 기록한다.

### 3.2 실행 (Cron `settle`, 매월 1일)

1. 전월 대상 가수(해당 월에 `payment_events`가 1건 이상) 조회
2. 가수별 `calculate` → `settlements` upsert (status=draft)
3. 어드민이 리포트 확인 후 `confirmSettlement` → `confirmed`. 이후 재계산 불가(재계산은 `draft`일 때만).
4. 엑셀 내려받기: `breakdown`을 펼쳐 시트 2개(요약, 결제 이벤트 상세).

### 3.3 주간 활동량 (Cron `aggregate-weekly-stats`, 매주 월)

```
message_count = count(messages where status='sent' and sent_at in [week_start, week_end))
photo_count   = count(messages where type='photo' …)   -- 사진 '횟수' = 사진 메시지 수 (장수 아님)
subscriber_count 등은 week_end 시점 스냅샷
```

아티스트 모드 A-03의 "이번 주 활동량"은 집계 테이블이 아니라 **실시간 쿼리**(이번 주는 아직 집계되지 않았으므로). 같은 집계 SQL을 `src/server/services/settlement/weekly-stats.ts`의 함수 하나로 두고 Cron과 화면이 공유한다.

---

## 4. 테스트 매트릭스 (출시 기준 12장 "결제 4가지 경우")

| 시나리오 | 방법 | 기대 결과 |
| --- | --- | --- |
| 신규 (첫 달 1,000원) | mock provider 성공 | pending→active, intro 금액, 대화방 진입 |
| 신규 실패 | mock 실패 | pending 유지, failed 이벤트, M-04 복귀 + 문구 |
| 갱신 성공 | `next_billing_at` 과거로 세팅 후 Cron 호출 | 6,500원 이벤트, 기간 연장 |
| 갱신 실패 → 유예 → 만료 | mock 실패 × grace_days | grace → expired, 알림 3종 |
| 사용자 해지 | `cancelSubscription` | canceled, 기간 내 열람 가능, 종료 후 expired |
| 환불 | 어드민 환불 | 음수 이벤트, 정산 반영 |
| 웹훅 중복 | 같은 eventId 2회 | 두 번째는 no-op 200 |
| 정산 계산 | 고정 입력 → 스냅샷 | `calculate` 단위 테스트 |

실PG 테스트는 D-2 라이브 키 수령 후 preview 환경에서 1,000원 실결제 → 즉시 환불로 1회 확인한다.

---

## 5. 추가 결정 요청 (00_README §3에 합류)

| 번호 | 결정 사항 | 기본안 |
| --- | --- | --- |
| D-8 | 첫 달 1,000원을 가수마다 적용하는가, 계정당 1회인가 | 가수마다 1회 (가수별 상품이라는 기획 의도 유지) |
| D-9 | 환불 정책 | 7일 이내 미열람 전액 환불, 그 외 없음. 이용약관에 명시 |
| D-10 | 결제 실패 재시도 간격·횟수 | 24시간 간격, 유예 3일 동안 최대 3회 |
