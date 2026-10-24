# 2026-10-24 알림 outbox DB 기반

## 구현 범위

- 기준은 PR #9가 병합된 `develop`의 `713469c97a4287ad3796c462db5c9dc6f86970d3`이다. 직전 로컬 `024a3f0` 기록은 `archive/points-ledger-ci-024a3f0`에 보존하고 `feature/notification-outbox-database` 하나에서 작업한다. develop/main 직접 push, 운영 배포, 외부 알림 발송은 하지 않는다.
- 발송 메시지, 검증된 결제 charge/refund 기록, 공개 일정과 같은 트랜잭션에 private Web Push 작업을 만든다. 원본 종류·UUID, 채널, 수신자, 기기 조합으로 멱등성을 보장한다. 임의 JSON 본문·URL·redirect·전화번호·VAPID 키는 저장하거나 받지 않는다. 청구 예정/실패/만료 안내용 별도 원인·템플릿 정책은 이번 DB 기반에 포함하지 않는다.
- 메시지는 현재 유료 접근·history 권한, 일정은 현재 구독 접근·공개 상태·가수 활성 상태·일정별 optout을 검사한다. 결제 알림은 본인 소유의 검증된 불변 charge/refund 증빙이 기준이다. 결제 완료 RPC가 아직 `pending` 상태인 중간 단계 또는 이미 종료한 구독이어도 정상적인 금융 영수증을 누락하지 않으며, 다른 사용자의 이벤트는 불가하다.
- 모든 종류는 완료된 fan 온보딩, 현재 제한 상태, 명시적인 전체/종류별 선호, 활성 기기의 승인된 버전 동의를 요구한다. 신규 선호는 모두 false, 승인된 notification policy 기본 행은 없다. 설정 registry에 동의 버전·retry/lease·일정 lead·provider origin 검증·Alimtalk 계약 미결정을 명시한다.
- Alimtalk는 provider·템플릿·전화번호 동의 계약 미정으로 명시적으로 disabled다. `notification_capabilities`의 Web Push 필드는 DB policy 준비 여부만 뜻하며 `delivery_implemented=false`를 별도로 반환한다. 기기 수신 확인 지원도 false다.

## 개인정보와 API 경계

`private.push_subscriptions`와 선호·작업·시도 테이블은 RLS와 명시적 REVOKE로 보호한다. authenticated/admin/artist뿐 아니라 service_role에도 raw table SELECT/DML을 주지 않는다. endpoint/key는 한 작업의 독점 claim 반환에만 포함되며 bulk 읽기 RPC는 없다.

브라우저용 기기 등록 HTTP API는 아직 없다. 미래 서버 API가 세션에서 actor UUID를 결정하고 endpoint origin allowlist·실제 key 형식/의미·권한 동의를 검증한 뒤 service-only 등록/해제 함수를 호출해야 한다. DB의 HTTPS 모양·길이·base64url 구조 제한은 SSRF allowlist나 endpoint 소유 증명이 아니며 URI에 접속할 권한도 아니다. 다른 사용자로 endpoint를 이동하거나 같은 endpoint의 key/consent를 조용히 바꾸지 않는다. revoked/dead endpoint를 자동 복구하지 않으며 재동의·키 교체·브라우저 재구독 lifecycle API는 후속 구현 사항이다. 제한된 사용자도 자기 기기 해제는 가능해야 한다.

클릭 목적지는 `artist_chat`/가수 UUID, `billing`/구독 UUID, `schedule`/일정 UUID만 DB에서 유도한다. 미래 서버/클라이언트 route mapper가 내부 경로를 만들며 임의 외부 URL을 수용하지 않는다. 메시지 원문·개인화 미리보기는 outbox에 복제하지 않는다.

## Lease·결과·취소 의미

- 작업을 읽는 것과 claim은 다르다. claim은 profile → artist → subscription → source → preference → device → policy → job 잠금 뒤 실제 현재 시간으로 권리를 다시 확인한다. 같은 job은 `FOR UPDATE SKIP LOCKED`로 두 worker에게 배정하지 않는다.
- leased 기한이 지나도 재할당하지 않는다. `unknown`으로 기록하고 기존 token을 유지한다. 늦은 worker가 아직 외부 요청을 실행할 수 있으므로 새 worker를 시작하지 않는 보수적 경계다.
- `provider_accepted`는 provider가 수락했다는 검증 결과이지 기기에 표시됐다는 보장이 아니다. `unknown`을 timeout이나 네트워크 오류만으로 실패/재시도 처리하지 않는다.
- `notification_list_uncertain`은 endpoint 없는 job/token/만료/취소 handle만 service에 반환하며 `(lease_expires_at,id)` keyset으로 오래된 미확정 작업이 100개 이상이어도 다음 페이지를 조회한다. 목록 조회는 재claim이나 상태 변경이 아니다.
- `not_sent`는 **provider 수락이 없고 계속 실행 가능한 기존 요청도 없음**을 검증한 증빙 UUID를 요구한다. 그때만 설정된 backoff와 시도 상한 안에서 retry_wait가 된다. reconciliation도 같은 token으로만 처리하며 terminal 결과의 동일 증빙 replay는 멱등적, 충돌 결과는 거절한다. 외부 exactly-once는 보장하지 않는다.
- 취소·선호 해제·기기 해제·일정 비공개/삭제가 먼저 commit하면 미claim 작업을 취소한다. 이미 claim된 요청은 상태를 거짓 `canceled`로 덮지 않고 cancellation_requested_at을 기록한다. 실제 provider 수락이 뒤늦게 확인되면 그 사실을 보존한다. 취소/수신 거부가 이미 외부로 나간 알림을 회수한다고 주장하지 않는다.
- `dead_endpoint`는 기기를 비활성화하고 남은 queued/retry 작업을 취소한다. 소스 replay·재공개·선호 재활성화로 terminal 작업을 부활시키지 않는다. 일정 삭제는 source UUID를 유지한 채 FK만 NULL 처리해 기존 삭제 API를 깨지 않는다.
- 일정 변경은 queued와 retry_wait의 due를 다시 계산한다. retry_wait는 마지막 검증된 non-send 시각의 실제 backoff보다 앞당기지 않으며, 과거 일정 연기로 생긴 낡은 due를 backoff로 오해하지 않는다. lease 중 연기 후 non-send가 확정되는 경우도 claim에서 현재 일정 due를 다시 확인한다. 알림 lead는 양수의 명시적 policy이며 KST 전날 고정 시각 등 최종 운영 스케줄러의 정책 연결은 아직 구현하지 않았다. 이미 lease된 알림의 외부 취소는 보장하지 않는다.

## 독립 검토와 보완

- 독립 read-only 검토로 일정 연기·재앞당김·lease 중 연기 시 retry_wait의 due와 실제 backoff 혼동을 찾아 수정했다. 최종 재검토에서 남은 차단 제품 결함은 없었다.
- source trigger의 새 job INSERT가 중복 profile FK의 KEY SHARE를 요구하면 기존 일정 optout의 profile FOR UPDATE → source 순서와 역전된다. job의 중복 profile FK를 제거하고 `(device_id,user_id)` 복합 FK → 기기의 profile FK로 동일 소유자 무결성을 유지한다. 정확한 교차 interleave 경합 테스트를 추가한다.
- 여러 작업의 선호 해제와 dead endpoint 정리가 서로 다른 job을 먼저 잡으면 역전될 수 있다. completion도 profile SHARE를 먼저 획득해 선호 변경과 직렬화한다. 서로 다른 소스의 취소와 여러 기기의 정리가 겹치는 다중 경합까지 막도록 모든 bulk 변경은 active job UUID 정렬 잠금을 먼저 획득하며, dead endpoint 완료는 primary job보다 정렬된 전체 기기 집합을 먼저 잠근다. 메시지 history policy도 claim 시 SHARE 잠금으로 재확인한다.

## 검증과 남은 경계

검증 최종 결과는 아래에 기록한다. 로컬 Docker executable이 없어 실제 Supabase PG17/Auth/Storage SQL lint·pgTAP·독립 psql 경합·genuine 타입 생성은 이 환경에서 실행할 수 없다. 기존 PGlite PG18/synthetic Auth·Storage 보조 도구는 SQL·테스트의 빠른 검증에만 쓰며 실제 Supabase/다중 세션 증거로 표시하지 않는다. 기존 로컬 브라우저 제한은 재시도하지 않았고 UI는 바꾸지 않았다.

CI의 기존 1,184 pgTAP와 47 경합을 보존하고 신규 알림 테스트와 21개 경합을 추가한다. 기존 금융 불변성 TRUNCATE 검사는 새 FK 종속 테이블 두 개를 목록에 포함했으며 기존 55000 불변 트리거 assertion과 검사 수는 그대로 유지한다. CI는 실제 Supabase 시작/reset/lint → pgTAP 두 번 → 모든 경합 → genuine 타입 생성/typecheck → artifact → committed type drift 검사 순서를 유지한다. bootstrap은 타입 drift 실패가 예상되며 실제 artifact를 받아 한국어 후속 커밋으로 반영한 exact-head CI 통과 전에는 병합하면 안 된다. 타입을 손으로 작성하지 않는다.

전송 adapter, server-bound 등록/해제 HTTP API, 정책 승인/운영 설정, payload 렌더링, worker/Cron, provider 증빙 검증/보관 서비스, 실제 브라우저 재동의 lifecycle, 단말 수신·1,000명 성능/SLA 측정은 이번 범위 밖이며 미구현 상태다. 이 DB 기반을 전체 MVP나 실제 발송 운영 완료로 표현하지 않는다.

## 로컬 최종 검증

- 신규 pgTAP lifecycle 130개 + security 107개 = 237개를 추가했다. 기존 1,184개를 포함한 총 1,421개가 supplemental PGlite에서 두 번 모두 통과했다. 실제 메시지 dispatch·결제 finalize/refund·일정 API와 함께 동작하며, 권한/동의/소유자/시점 재검사, source rollback, 중복·token replay, unknown 복구 cursor, 일정 연기·재앞당김, lease 중 변경, dead endpoint와 민감 DTO 경계를 검사한다.
- 신규 독립 psql 경합 21개를 CI에 연결했다. 기존 47개는 그대로 유지한다. 중복 등록·소유권 충돌, 동시 claim, 취소/claim 양방향, retry/취소 양방향, 기기 해제·계정 제한·가수 중지·구독 만료·선호·일정 optout/삭제, source rollback, 만료 lease와 늦은 수락, profile FK 교차 잠금, 선호/기기 정리 교차 잠금, source/device 정렬 잠금 경계를 다룬다. `pg_blocking_pids`와 실제 독립 세션을 사용하며 순차 RPC 호출을 concurrency 통과로 계산하지 않는다.
- Node syntax/ESLint/Prettier 및 `npm run check:all`의 lint, strict typecheck, 10 files / 167 unit tests, 10개 대비 조합, production build가 통과했다. race fixture/RPC의 PGlite 순차 보조 smoke는 별도로 수행했으며 실제 21개 다중 세션 결과가 아니다.
- 실제 Supabase lint·pgTAP 2회·47+21 경합·generated artifact·committed type drift·기존 13개 브라우저 E2E는 원격 exact-head CI에서 별도로 확인해야 한다. 이 문서의 로컬 통과를 해당 검증의 통과로 바꾸어 읽으면 안 된다.

## 최종 검토의 READ COMMITTED 경합 보완

최초 draft 후보를 게시한 뒤 마지막 read-only 검토에서 선호 변경의 두 SQL 문 사이 phantom job 경합을 확인했다. enqueue는 source→profile 역전을 피하려고 profile을 잠그지 않으므로 정렬 prelock 뒤 새 낮은 UUID 작업이 commit될 수 있다. 다음 UPDATE가 그 작업까지 새 snapshot에서 포함하면 source 취소와 교차 대기가 생길 수 있었다. 선호 변경은 정렬 잠금에서 확보한 UUID 배열만 UPDATE하도록 보완했다. 새로 생긴 작업은 이후 claim의 현재 선호 검사에서 차단한다. 기존 source/device 경로는 해당 source/device 잠금이 새 관련 INSERT를 막으므로 같은 phantom 경계가 아니다.

21번째 실제 psql 경합은 최대 UUID의 기존 두 작업과 gate를 사용해 선호 RPC의 prelock 대기 → 실제 enqueue의 새 낮은 UUID 작업 commit → 실제 메시지 취소의 교차 대기 순서를 고정한다. 우연한 행 조회 순서나 순차 호출로 이 문제를 대신 검사하지 않는다. 이미 게시한 bootstrap history를 amend하지 않고 동일 브랜치의 후속 한국어 커밋으로 수정한다. 원격 bootstrap과 로컬 bootstrap의 tree 일치를 확인하고 로컬 최초 커밋은 archive에 보존한다. 실제 Supabase 경합 결과는 여전히 exact-head CI 검증 대상이다.
