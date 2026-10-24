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
