# 2026-10-24 — 구독·검증된 결제 원장 DB 기반

## 범위

- `develop`의 `2a1349a`에서 기능 브랜치 `feature/billing-ledger-database` 하나로 작업. 이전 기능의 깨끗한 로컬 커밋은 저장소 밖 bundle로 보존한 뒤 이전 로컬 브랜치를 제거했다.
- 안정적인 사용자+가수 구독 ID, 유료/유예 기간 분리, 평생 첫 달 혜택 사용 이력, 해지·만료·재구독 기반을 추가했다.
- `billing_obligations`/`payment_attempts`와 승인된 금액 원장을 분리했다. 청구 전에는 매출을 기록하지 않는다. UUID 청구 ID·lease·확정 실패·불명 결과·멱등 승인·환불 누적 한도를 DB RPC로 다룬다.
- 결제 제공자별 테스트/운영·merchant·action ID를 서버 전용 영역에 고정하고, 사용자 공개 DTO에는 안전한 구독/원장 정보만 둔다. 실제 결제키/SID를 저장하거나 임의 암호화 체계를 만들지 않았다. UUID 보안 저장소 참조를 해석할 어댑터는 아직 없다.
- 모든 새 테이블의 직접 금융 변경 권한을 제한했다. 사용자/관리자는 금융 상태를 위조할 수 없고, 서비스 역할도 지정 RPC를 통한다. 검색 경로·호출 역할 검증·원장 불변 트리거·삭제 방지 FK를 명시했다.
- 실제 결제 서비스·HTTP 어댑터·UI·웹훅·스케줄러·알림 outbox·정산·운영 배포는 범위 밖이다. 비공개 원본 문서, 실제 계정, 키, provider payload는 커밋하지 않는다.

## 주요 결정

[DB 계약/한계 문서](../database/billing-ledger.md)에 상세히 기록했다.

- 유료/유예 열람 종료는 각각의 exclusive 경계를 사용한다. 유예는 미납 갱신 기간 시작에 고정하고 재시도마다 연장하지 않는다.
- 재시도는 확정 실패 후에만 가능하다. 유예 기간·재시도 간격/최대 횟수·가격 버전은 의무 생성 시 snapshot으로 받는다. 만료된 lease나 네트워크 불명 결과는 새 청구를 허용하지 않는다.
- 해지와 claim은 동일 구독 잠금으로 직렬화한다. 먼저 해지되면 claim이 거부되고, 이미 claim된 작업의 늦은 승인 결과는 실제 금액만 기록하며 해지를 해제하지 않는다. 미납 유예 중 해지는 유료 기간 밖 접근을 끝내는 잠정 구현이다.
- 재구독은 유료 기간 종료 및 미해결 청구 해소 후 동일 구독 ID를 재사용한다. 첫 달 혜택·첫 시작 시각은 유지하고, 새 회차 최초 승인에만 현재 episode 시작을 옮긴다. 메시지 이력 cutoff는 이후 서비스가 현재 episode 기준으로 계산해야 한다.
- 환불 원장은 원승인에 연결된 음수 KRW만 기록한다. 원승인 잠금+누적 합으로 동시 초과 환불을 막고, 동일 provider action 재전송은 하나만 기록한다. 외부 환불 요청의 reservation/unknown 처리와 환불 자격·접근권 변경은 아직 구현하지 않았다.
- 운영 문서 기본안(월 6,500원, 첫 달 1,000원, 유예 3일, 24시간 간격 최대 3회, 이전 이력 7일)은 승인된 약관/법률 검토가 아니다. 새 운영 설정값을 seed하거나 변경하지 않았다. 환불·보관/익명화·유예 중 해지·지연 복구·정기결제 승인/계약 및 카카오페이 불명 결과 복구는 미확정 사항으로 남긴다.

## 검증 기록

- 기존 140개 identity/artist pgTAP 검사는 그대로 유지했다.
- 로컬 보조 검증: PGlite 0.5.11/PostgreSQL 18.6 WASM + synthetic Auth + permissive default grants에서 전체 마이그레이션과 **362개 검사(기존 140 + lifecycle 151 + 독립 security 71)**가 두 차례 통과했다. psql 방식과 같이 SQL 문 단위로 실행하고 모든 fixture rollback을 확인했다. 이것은 실제 Supabase PG17 또는 JWT/PostgREST 검증이 아니다.
- 새 실제 동시성 검사: 독립 PostgreSQL 세션과 `pg_blocking_pids` barrier로 이중 claim, 중복 승인, 해지/claim 양방향 순서, 동시 부분 환불 한도, 중복 환불, 잠금 대기 중 유예 만료를 포함한 **7개 경우**를 확인하도록 CI에 추가했다. 로컬에는 Docker/psql이 없어서 실행은 **차단됨**이며 성공으로 기록하지 않는다.
- `npm run check:all`: 최종 7번째 동시성 회귀 검사까지 통합한 상태에서 lint/typecheck/**166 unit tests**/contrast/build 통과.
- 최초 게시 시 실제 Supabase PG17/동시성/타입 생성/브라우저 CI는 미실행 상태였으며, 아래 bootstrap 실행으로 검증했다. 생성 타입은 손으로 편집하지 않고 CI artifact 원본을 후속 반영했다. 전체 green 여부는 타입 반영 후 새 exact-head CI에서 다시 확인해야 한다.
- 독립 보안 리뷰에서 비유한 기간, 최대 retry 정수 overflow, 등록 자격 확인/변경 경합, 결제사업자 초 단위 승인 시각, 잠금 대기 전 시각으로 claim하는 결함을 찾아 수정했다. 전체 수정 후 독립 재검토에서 DB-only 범위의 남은 보안 차단 사항은 발견하지 않았다.
- 추가 로컬 브라우저 검증: 기본 실행은 Playwright 번들 Chromium 미설치로 시작하지 못했다. 이미 설치된 `/usr/bin/chromium`을 문서화된 실행 경로 옵션으로 사용한 두 번째 실행도 브라우저의 `socket() failed: Operation not permitted`로 차단되었다. 테스트 본문은 실행되지 않았으며, 13개 항목을 통과로 기록하지 않는다. 해당 실행 경로를 더 우회하지 않고 기존 CI 브라우저 검사를 유지한다.

실결제·환불·샌드박스 provider API·호스팅 DB 변경·실사용자 생성·시크릿 설정·운영 배포는 수행하지 않았다. 로컬/CI SQL 검증은 결제 사업자 운영 승인을 뜻하지 않는다.

## 실제 CI 및 생성 타입 후속 반영

- [PR #5 bootstrap CI run 40053859325](https://github.com/zzz664/trot-you/actions/runs/40053859325)는 head `498948dd9d7e397e97005562ed86cee797e3f863`에서 실행했다. 로컬 구현 커밋 `c7af3a5`와 동일한 tree `0364bd0b82fe1f57f96b83b02fdbf404441f5b14`임을 확인하고 기존 로컬 커밋을 별도 bundle로 보존한 뒤 원격 head 위에 후속 커밋을 준비했다.
- 실제 공식 Supabase PostgreSQL **17.11.0.006**에서 start/reset 및 public/private lint, **362개 pgTAP 검사 두 차례**, **7개 독립 세션 동시성 검사**, 타입 생성·typecheck·artifact 업로드·정리 모두 통과했다. quality job의 aggregate 검사, **166개 unit test와 13개 E2E**도 통과했다.
- 이 bootstrap run의 전체 결과는 **실패**다. 실패 원인은 artifact 업로드 이후 실행된 **기존 커밋의 생성 타입 drift gate 하나**이며, 이를 다른 검사 실패나 전체 CI 통과로 표현하지 않는다.
- `database-types` artifact **12544446696**의 GitHub metadata가 위 run/정확한 head에 연결됨을 독립 검증했다. ZIP SHA-256은 `6326de1374ec8d15970f8e4d92eece4ed51c0b6d705a4ecdf7b1ee0732245d8f`로 GitHub digest와 일치했다.
- 포함된 `database.ts`는 **18,967 bytes / 581 lines**, SHA-256 `6cf20ecf2f7af071dd042e9954f97b91594a9454fcb620353f7975790aad4542`다. 이 파일을 그대로 `src/types/database.ts`로 복사했고 hash 일치를 재확인했다. 수동 생성·형태 수정은 하지 않았다. private 테이블을 공개 schema에 노출하는 변경도 없다.
- 생성 타입 반영 후 로컬 `npm run check:all`(lint/format/typecheck/166 unit tests/contrast/build)도 통과했다. 후속 변경은 생성 타입과 이 검증 기록뿐이다. 로컬 브라우저/socket 경로를 재시도하지 않았으며, 이 CI 증거는 테스트/개발용 환경에 한정된다. 운영 인증·결제 사업자·실거래·배포 검증은 여전히 수행하지 않았다.
