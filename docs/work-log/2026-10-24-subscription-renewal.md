# 2026-10-24 — 구독 갱신·유예·재시도 처리

## 범위와 기준

- 병합된 develop `9a0ca4b8e9d5beb24b69db010142487c812771cc`에서 단일
  `feature/subscription-renewal` 분기. 이전 깨끗한 로컬 HEAD는 archive 참조로
  보존하고 완료된 feature 참조를 제거했다. develop 직접 push는 하지 않았다.
- 비공개 설계 04 §2.2–2.3, 03 §3.9, 02 구독/결제 및 별도 이중 PG 분석을
  검토했다. 원문·개인정보·비밀키는 저장소에 복사하지 않았다.
- 승인된 불변 정책과 달력·가격·약관·공지 증거를 요구하는 갱신 서비스,
  전용 비밀키 Cron, 원자적 DB claim, 정기결제 어댑터와 격리 검증에 한정한다.
  환불/해지 UI, 관리자 지급, 배포, 스케줄러 활성화는 추가하지 않는다.

## 주요 판단

- 원문의 24시간/최대 3회/유예 3일 및 가격은 제안값일 뿐 자동 승인/seed하지
  않는다. 실제 운영은 명시적으로 승인·게시된 immutable 정책이 있어야 한다.
- 원문 10초 Cron 예제는 Toss의 60초 이상 요청 제한과 양립하지 않아 300초
  host budget, 후보 최대 4개, 외부 요청 최대 1개로 제한한다. 실제 host 설정과
  스케줄러 활성화는 별도 승인/검증 단계다.
- 최초 episode 월 기념일을 유지해 1월 31일→2월 말→3월 31일로 계산한다.
  retry는 같은 기간 obligation만 사용하고 intro 가격을 재사용하지 않는다.
- 실패가 확정된 경우만 승인된 재시도를 허용한다. 불확실 응답·만료 lease는
  다른 charge를 만들지 않는다. Toss는 원 주문 조회, Kakao TID 유실은 수동
  검토이며 SID 상태로 결제 성공을 추정하지 않는다.
- 기존 성공 결제 outbox는 원자적으로 유지한다. 실패/만료 통지의 신규 source
  모델과 발송은 후속 billing-notices 기능이다. 필수 사전 통지가 없으면 청구를
  막으며 큐 등록을 전달 성공으로 간주하지 않는다.

## 검증 기록

- 로컬 기존+신규 전체 unit 2,023개, 전체 lint/format, fixture 21개(기존 14 + 신규 7), contrast 검증을 통과했다.
- 실제 프로토콜을 모사한 어댑터 HTTP/기존 등록 회귀 377개 통과.
- 체크포인트 CI `40105233211` / head `edb5da555c79e7df7d1ff29535a9d953871068db`의
  genuine generated type artifact를 변경 없이 가져왔다. SHA-256:
  `b15de2998812822a678065b70e029e689426703d7f0ea17e68b26ef1c700138a`.
  `src/types/database.ts`를 손으로 수정하거나 임시 캐스트로 우회하지 않았다.
- artifact 반영 후 `npm run check:all` 전체 통과: lint/format, Next typegen +
  strict TypeScript, unit 2,023개, contrast 10조합, production/PWA build.
- 체크포인트 실제 Supabase PG17 CI는 pgTAP 2,414개 ×2, 기존 독립 세션 race
  144개, generated typecheck를 통과했고 예상한 type drift gate에서만 실패했다.
  해당 체크포인트 기존 quality/browser도 unit 1,658 / fixture 14 / browser
  default 23 · auth 78 · enrollment 21을 통과했다. 신규 application 검증과
  혼동하지 않는다. 신규 갱신 race 18개(총 162)와 갱신 browser 20개는 이번
  application commit에 CI 연결했으며 부모가 exact-head 실제 실행을 확인한다.
- 로컬 실제 DB 실행은 `docker context show`를 시작할 실행 파일 부재
  (`spawnSync docker ENOENT`)로 DB 접근 전에 차단되었다. 재시도하지 않았다.
  PGlite 보조 검증 2,414 assertions ×2 및 18개 race fixture의 순차 smoke는
  통과했지만 실제 Supabase PG17/독립 세션 race 증거가 아니다.
- 기존 로컬 브라우저 실행 거부를 반복 시도하지 않는다. 실제 UI/DB/격리 PG
  fixture 브라우저 검증은 독립 CI job으로 준비하며 결과를 확인하기 전 통과로
  기재하지 않는다. 기존 default/auth/enrollment 회귀 job을 유지한다.
- 독립 결제/보안 검토를 받았다. 후보 starvation과 공개 CI Cron 토큰의 운영
  오사용 위험을 fair cursor와 완전한 격리 runtime gate로 수정했다. 만료 query
  completion replay는 backoff를 늘리지 않고, 최악의 DB 복구 시간까지 고려해
  lease를 180초로 보완했다. 최종 HTTP/configuration 추가 검토 162개 검증도
  통과했으며 코드 수준 차단 항목은 없다. 최종 application exact-head CI/browser 증거는 별도다.

## 실행하지 않은 작업

실제 PG API/카드/계좌 호출, 결제·환불·외부 계정 변경, 실제 정책 승인·시크릿
설정, 스케줄러 설치·활성화, 배포를 하지 않았다. 부모가 draft PR/CI artifact/
검증 후 병합을 담당한다. 금전 작업에 대한 불확실한 실행 결과는 없다.

## 실제 CI 경합 fixture 보완

- app head `4a47e7924b6ade44c6cf8e72dd2c36f464632f2c` / CI `40106167722`에서
  기존 144개와 신규 첫 9개 race는 통과했지만, 열 번째 lease-expiry 시나리오는
  두 번째 세션이 첫 번째에 block되지 않아 strict contention 검증이 실패했다.
- 원인은 fixture가 attempt row만 갱신한 동안 claim의 subscription 잠금 후
  MVCC 조회에는 미커밋 lease 변경이 보이지 않았기 때문이다. 기존의 아직
  유효한 lease를 보고 no-dispatch로 반환하는 것은 안전하고 정상적인 동작이다.
  이 실패는 중복 청구 증거가 아니며 단일 세션 smoke로는 발견할 수 없었다.
- fixture가 실제 직렬화 기준인 subscription row를 먼저 `FOR UPDATE`로
  잠근 다음 같은 트랜잭션에서 허구 lease 시간을 바꾸도록 수정했다. 실제
  `pg_blocking_pids` 대기 관측과 커밋 후 unknown/no-second-charge 검증을
  Toss/Kakao 모두 그대로 유지한다. 운영 SQL·원장·PG 어댑터·타입은 변경 없다.
- 실제 PG17 독립 세션 재검증은 부모의 새 exact-head CI에서 확인해야 한다.
  로컬 Docker 부재와 브라우저 실행 거부를 다시 시도하지 않았고 실제 PG 호출,
  스케줄러 활성화 또는 금전 작업은 없다.
- 수정본 `npm run check:all`(unit 2,023개 포함) 및 기존/신규 fixture 21개를
  통과했다. 독립 검토에서도 두 파일만 변경했으며 나머지 경합 barrier가 실제
  RPC 잠금 행과 일치함을 확인했다. 새 actual CI 결과는 아직 대기 중이다.

## 실제 CI 브라우저 fixture 보완

- 같은 CI의 신규 갱신 브라우저는 14개를 통과했고, 두 PG × 세 글자 크기의
  6개 성공 시나리오는 갱신/원장/유료 접근 검증 뒤 중복 구독 화면에서 timeout이
  발생했다. 새 checkout은 의도적으로 PG를 사전 선택하지 않는데 테스트가
  약관 checkbox만 체크하여 준비 버튼이 정상적으로 비활성 상태였기 때문이다.
- 테스트에서 초기 비활성 상태를 확인하고 해당 provider radio와 약관 동의를
  명시적으로 선택한 뒤 활성 버튼을 누른다. force-click이나 UI의 안전 조건
  완화는 없다. 실제 `SUBSCRIPTION_EXISTS` 오류와 기존 두 원장/한 갱신 attempt,
  provider charge 카운터 불변을 모두 검증한다. 운영 UI/서비스는 변경 없다.
- 새 exact-head 실제 브라우저 결과와 세 글자 크기 화면은 다시 확인해야 하며,
  로컬 브라우저 실행은 재시도하지 않는다.
- 두 fixture 보완을 함께 적용한 `check:all`(unit 2,023)과 fixture 21개를
  다시 통과했다. 독립 검토도 checkbox-only 원인, 기존 prepare helper와 같은
  정상 PG 선택 순서, 금액·attempt·provider 호출 불변 검증 유지를 승인했다.
