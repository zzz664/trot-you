# 측정 이벤트 DB 기반

## 구현과 미구현

13개 이벤트의 첫-party 수집 **DB 계약**이다. SDK, 브라우저/서버 HTTP API, 자동 domain hook, 외부 분석 도구, 운영 설정 활성화, 대시보드와 Cron은 구현하지 않았다. 승인된 `private.analytics_policy` 행을 seed하지 않으므로 기본 상태에서는 수집·동의 등록이 차단된다. `app_settings`나 실제 프로젝트에 정책을 적용하지 않는다.

원본 설계의 `id` 단독 PK + 시간 파티션 조합은 PostgreSQL에서 생성할 수 없다. 이번 MVP는 private 비파티션 테이블과 이름/발생 시각·발생 시각·기록 시각 인덱스를 쓴다. 다음 달에도 파티션 생성 작업 없이 저장할 수 있지만 미래 발생 시각을 주입하는 API는 없다. 대량 적재/월별 partition 전환은 실제 규모를 확인한 별도 변경이다.

익명 유입 이벤트는 전체 MVP에서 제거한 것이 아니다. 현재 익명 동의 수명·철회·멱등성 식별 계약이 없으므로 **후속 통합 대기**다. `anon`은 수집 권한이 없고 user_id는 NULL이 될 수 없다. 새 session/device 식별자나 fingerprint를 임의로 도입하지 않는다.

## 허용 이벤트와 최소 속성

`src/config/analytics-events.ts`의 이름·Zod discriminated union이 13종을 정의한다. 모든 객체는 strict이며 추가 키, 자유 문자열, URL, 개인정보, 메시지 원문, 결제키, provider 응답, user-agent, IP, 기기·세션 식별자를 받지 않는다. DB에는 JSON properties 열 자체가 없고 UUID source·font enum·voice enum만 저장한다.

| 이벤트               | 속성                                | DB 경로와 검증                                             |
| -------------------- | ----------------------------------- | ---------------------------------------------------------- |
| `signup_complete`    | 없음                                | service; 실제 본인 onboarding 시각                         |
| `font_size_selected` | `font_scale`: normal/large/xlarge   | service; 현재 profile 값과 일치                            |
| `preview_view`       | `source_id`: message UUID           | service; 현재 본인에게 보이는 preview                      |
| `subscribe_start`    | `source_id`: subscription UUID      | service; 본인 pending 구독                                 |
| `subscribe_complete` | `source_id`: payment event UUID     | 전용 verified-charge 경로; initial obligation에서 유도     |
| `subscribe_fail`     | `source_id`: attempt UUID           | service; 본인 failed attempt와 증빙                        |
| `message_open`       | `source_id`: message UUID           | authenticated; 현재 유료 접근과 메시지 공개/기록 범위 검사 |
| `reply_sent`         | `source_id`: reply UUID             | service; 실제 본인 답장                                    |
| `voice_input_used`   | `voice_context`: reply/post/comment | authenticated 관측                                         |
| `renew`              | `source_id`: payment event UUID     | 전용 verified-charge 경로; non-initial obligation에서 유도 |
| `cancel`             | `source_id`: subscription UUID      | service; 실제 본인 canceled 상태/시각                      |
| `post_create`        | `source_id`: post UUID              | service; 실제 본인 글                                      |
| `attendance`         | `source_id`: point ledger UUID      | service; 실제 본인 attendance 원장                         |

클라이언트 관측은 `message_open`, `voice_input_used` 두 종류뿐이며 행동의 진위를 증명하지 않는다. 사용자는 이를 임의 반복 보고할 수 있으므로 보상·결제·공식 KPI의 증거로 사용하지 않는다. 향후 API의 입력/속도 제한도 별도 구현해야 한다. 일반 service 경로도 독립 검증된 외부 사실 전체를 증명하는 것은 아니며, 예를 들어 font 선택·preview 관측은 신뢰된 서비스의 정확한 호출에 의존한다.

## 동의·호출자 경계

- `analytics_set_consent(granted, consent_version)`과 `analytics_get_consent()`는 authenticated 본인의 `auth.uid()`만 사용한다. service에 임의 사용자 동의를 작성하는 권한은 없다. 동의 버전은 승인된 정책의 UUID이고 다른 문자열이나 사용자 metadata를 동의 증거로 읽지 않는다.
- 수집은 온보딩 완료·미제한 fan + 현재 버전 명시적 opt-in을 요구한다. 신규 사용자는 기본 미동의다. 온보딩 이전 fan도 먼저 동의할 수 있다. artist/admin 권한이 fan 동의를 대신하지 않는다.
- 동의 수락을 먼저 commit한 뒤 domain action을 시작한다. 기존 source의 `now()`는 트랜잭션 시작 시각이므로 같은 transaction에서 동의 뒤 source를 만들더라도 시간상 앞설 수 있다. 이를 임의 보정/소급 수집하지 않고 거절한다. signup도 동의 성공 이후 온보딩 완료를 기록하는 서비스 통합이 필요하다.
- 철회는 제한 계정이나 비활성 정책에서도 가능하다. profile 잠금을 통해 철회가 먼저 commit하면 뒤따른 수집은 실패한다. 수집이 먼저 commit된 행은 철회로 즉시 삭제하지 않으며 보존 hook의 대상이다. 재동의는 새 시작 시각이므로 철회 이전 source를 뒤늦게 수집하지 않는다.
- 클라이언트에는 actor/time 인자가 없다. service용 `analytics_record_server`는 실제 DB `service_role`만 허용한다. 미래 서버 서비스는 actor를 검증 세션에서 결정해야 하며 request JSON에서 가져오면 안 된다. 이 파일의 TS inclusive 스키마는 browser 수집 allowlist가 아니다.
- policy·consent·event raw 테이블은 RLS와 명시적 REVOKE로 보호하며 authenticated admin과 service에도 원시 SELECT/DML을 주지 않는다. 정책 변경 RPC는 없으며 운영 활성화는 승인된 별도 작업이다.

## 결제와 멱등성

`analytics_record_charge(event_id)`는 실제 `payment_events` charge + verification + success attempt + settled obligation을 조인한다. 사용자·initial/renew 구분·발생 시각을 그 증거에서만 유도한다. 브라우저나 일반 server RPC는 purchase/renew 이름을 기록할 수 없다. refund/failed/unknown 시도는 완료 지표가 아니다.

자동 결제 trigger는 추가하지 않았다. 향후 신뢰된 서비스가 `billing_finalize_charge` 성공 뒤 호출하거나 검증 원장을 재처리해야 한다. 분석 opt-in 부재/수집 실패를 결제 실패로 오인하지 않도록 외부 청구를 다시 실행해서는 안 된다. 이 함수는 금액·구독·금융 원장을 바꾸지 않고 실제 외부 결제 성공이나 자동 수집을 보장하지 않는다.

- retry key는 `(user_id, origin, event_key)`로 분리된다. client가 본인 payment UUID를 알고 같은 key를 먼저 사용해도 verified charge를 점유/차단하지 못한다.
- 같은 authority/key에 다른 payload를 넣으면 conflict다. 현재 동의·actor·source 검사를 계속 통과하는 같은 입력 replay는 보존된 같은 event ID를 돌려준다. 철회·접근 해제·source 상태 변경 뒤의 replay를 과거 성공만으로 허용하지 않는다. 행 INSERT와 unique index가 동시 요청을 직렬화한다.
- charge, failed attempt, reply, post, attendance는 source별 한 번이고 signup은 사용자별 한 번이다. 다른 key로 같은 source를 다시 보내면 conflict로 거절하고 건수를 늘리지 않는다. 성공한 key를 저장하지 않는 alias로 취급하지 않으며 호출자는 최초 안정 key를 재사용한다. cancel은 source와 실제 canceled_at 조합으로 한 번이며, 같은 구독의 다음 episode 취소는 다른 시각·새 key를 요구한다. font/preview/start/client 관측은 안정적인 요청 key를 미래 호출자가 재사용해야 한다.
- dedupe는 보존된 행 기준이다. 삭제된 오래된 client key를 다시 보내는 것을 영구 차단하는 device/tombstone 저장소는 만들지 않았다. 오래된 charge/source는 원본 발생 시각이 보존 기한 밖이므로 다시 수집할 수 없다. 보존 정책을 늘리거나 과거 자료를 재수집하는 변경은 별도 검토가 필요하다.

## 발생 시각·집계·보존

발생 시각은 source의 서버 기록 시각 또는 DB가 관측한 실제 시각이며 client/service가 임의 timestamp를 주입하지 못한다. `recorded_at`은 삽입 시점의 DB clock이다. 양쪽은 finite이며 발생 시각이 미래·현 동의 시작 이전·설정 보존 기간 이전이면 거절한다. 따라서 뒤늦은 수집은 발생일에 집계되지만 동의 이전 소급 수집은 하지 않는다. Provider의 승인 시각은 초 단위 정밀도일 수 있어 동의 직후 같은 초의 정상 결제도 동의 시각보다 앞선 것으로 보이면 분석 수집을 거절한다. 금융 원장 시각을 조작해 맞추지 않으며, 해당 경계의 정밀한 동의 증빙 판단은 후속 서비스 통합 대상이다.

`analytics_daily_counts(from, until)`는 실제 관리자 또는 service에 KST 날짜·이벤트명·건수만 돌려준다. 범위는 `[from, until)`, 1~366일이며 날짜는 0001-01-01~9999-12-31 안의 finite 값이다. session timezone에 영향을 받지 않는다. 결과가 없는 날짜/종류는 행이 없으며 호출자가 0으로 해석할 수 있다. 사용자·source별 필터, 원시 속성, distinct 사용자 수, 금액, 전환율은 반환하지 않는다.

원본 계획의 **네 가지 퍼널/KPI 정의가 제공되지 않았다.** 지표 이름, 단계와 순서, 분모·분자, 전환 관찰 기간, 중복/재가입 처리 기준을 승인된 사실로 만들지 않는다. 여기의 event 건수는 전환율/퍼널 완성이 아니며 최종 수식과 시각화는 후속 작업으로 남는다.

`analytics_purge_expired(limit)`는 service만 실행할 수 있고 승인된 retention_days를 사용해 `recorded_at` 기준 오래된 raw event를 1~10,000건씩 정렬·SKIP LOCKED 삭제한다. 보존 기간은 정책에서 명시적으로 정해야 하며 기본값은 없다. delayed source도 기록 후 보존 기간만큼 멱등성 행을 유지한다. consent 행이나 금융/포인트 원장은 이 hook으로 삭제하지 않는다. 별도 운영 Cron·대량 삭제·실제 프로젝트 실행은 하지 않았다. 계정 삭제의 전체 제약과 법적 보존 정책은 별도 도메인 통합 대상이다.

## 검증

`npm run check:all`, `npm run test:integration` 두 번, `npm run test:db:analytics-concurrency`를 사용한다. 실제 CI의 Supabase reset/lint/pgTAP/독립 psql 세션/genuine 타입 생성과 drift 검사가 병합 gate다. `src/types/database.ts`는 CI artifact로만 갱신하고 손으로 작성하지 않는다. UI 변경이 없어 로컬 브라우저 재시도는 하지 않으며 CI의 기존 E2E는 보존한다.
