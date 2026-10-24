# 2026-10-24 정산 리포트 DB 기반

## 기준과 범위

- PR #11 병합 후 `origin/develop`을 fetch하여 exact SHA `bad18c16f643e1a42b05eb2e7f576f533c83a046`를 확인했다. 깨끗한 작업 트리에서 `feature/settlement-database` 하나를 만들었다. 이전 analytics 로컬 tip `4bb304072885a45d2a4e0af5326b33188932dfec`는 동일 SHA의 `archive/analytics-database-final-4bb3040`에 보존한 뒤 완료 feature 참조만 정리했다.
- 비공개 02/04 설계의 정산·활동량 부분과 ANALYSIS의 정밀도/불완전 월 지적, 기존 billing ledger를 읽었다. 비공개 원문·실사용자·계좌·자격증명은 commit하지 않는다. 부모가 draft PR·genuine 타입 artifact·exact-head CI·develop 병합·원격 branch 삭제를 처리하며 이 작업은 push/PR/운영 DB/외부 결제 호출을 하지 않는다.
- 한 기능은 정산 **리포트 데이터베이스 기반**이다. KST 닫힌 월, 검증 원장·메시지 source snapshot, decimal 및 exact fraction 계산, 관리자 draft 계산/확정, 소속 가수 confirmed 조회, 명시적 지연 원장 조정과 검증만 포함한다. 송금·지급 승인·은행·PG 호출·스케줄러·UI·스프레드시트 export가 아니다.

## 승인 없는 정책을 만들지 않은 부분

- private artist/month 정책을 seed하지 않는다. 기본 enabled=false, 성과 조건 NULL만 허용하고 적용률은 base_rate다. 기존 문서 draft 비율을 운영 승인으로 보지 않는다.
- 월 전체를 덮는 contract 범위만 허용한다. 부분 월 계약, 음수 순매출, 0/누락 활동 기준은 fail-closed이고 임의 채무·이월·0-clamp·계약 비례율을 만들지 않았다.
- 활동 비활성화는 명시된 정책에서만 ratio=1이며, 활성화 시 부분 주는 기본 block이다. 명시된 prorate_days에서만 월과 겹치는 일수/7을 분모로 쓴다. Monday KST anchor와 clipped window, 메시지·사진 메시지 수, 요구량을 저장한다. 재구성 불가능한 과거 subscriber/new/churn 지표는 만들지 않았다.
- 늦게 기록된 과거 발생월 이벤트는 확정 리포트를 바꾸지 않는다. 관리자 별도 queue transaction과 target 정책 explicit_current_formula가 있을 때만 이후 선택 월의 gross와 그 월 rate/activity로 평가한다. 과거율 reversal과 다른 의미임을 문서화했고 이 선택을 운영에서 활성화하지 않았다. 통상 과거 charge의 환불이 현재 월에 발생하면 occurrence-month 원칙에 따라 현재 월 원장이다.

## 정밀도·확정·접근 보장

- intermediate 금액/ratio는 unconstrained numeric이다. source sum은 입력부터 numeric으로 cast하여 bigint 집계 overflow를 피한다. 무한소수의 표시 근삿값과 별도로 VAT/fee/base/share/activity/deduction/final의 정확한 정수 numerator/denominator 문자열을 저장한다. 최종 KRW는 exact final fraction에 대한 quotient 연산으로 half-up하며 중간 반올림이 최종 경계를 결정하지 않는다.
- 확인한 revision UUID를 confirm 인자로 요구한다. 새 계산이 같은 report ID를 갱신해도 이전 revision 검토자가 몰래 새 내용을 승인할 수 없다. source·policy·조정 변화가 있으면 stale draft 확정도 거절한다. source 합계/개수/주간 count와 수식/분수 재검산 후 확정한다.
- confirmed 보고서와 event/message/week snapshot은 UPDATE/DELETE/TRUNCATE가 거절되며 재계산/upsert로 덮어쓸 수 없다. exact confirmed revision 재확인은 멱등이다. event별 고유 할당은 월간 중복 합산을 막는다.
- 실제 authenticated admin만 mutation RPC를 실행한다. forged JWT role, service key의 가짜 subject, raw DML로 우회할 수 없다. 모든 private helper/표/sequence 권한과 public RLS를 감사했다. 아티스트는 현재 membership·role·restriction을 확인한 본인 confirmed와 주간 수치만 읽는다. 팬 식별자·subscription·본문·private verification·계좌 정보는 리포트에 없다.

## 독립 검토에서 발견하고 수정한 사항

- 단순 source FK는 calc의 exclusive fence → FK KEY SHARE와 refund/cancel의 원장/message FOR UPDATE → shared fence 사이에 교착을 만들었다. 감사용 source UUID snapshot에는 새 source FK를 추가하지 않고 report-owned FK만 유지했다.
- source version을 artist counter UPDATE 대신 shared fence 이후 발급하는 append-only identity stamp로 바꿨다. 여러 artist를 건드리는 source transaction이 새 counter row lock으로 역전되지 않는다. `(artist_id, version DESC)` index, 직접 권한 차단과 불변 trigger를 둔다. 안전한 보존/압축은 별도 설계다.
- report artist FK 보호는 exclusive fence 뒤 KEY SHARE **NOWAIT**로 얻는다. source가 artist UPDATE를 보유한 상태라면 기다려 교착하지 않고 `SETTLEMENT_SOURCE_BUSY` / `40001`로 전체 transaction을 실패시킨다. caller는 완전히 rollback한 transaction을 재시도할 수 있다. 여러 artist source 배치와도 row/advisory 역전을 피한다.
- snapshot은 공유 source fence와 배타 report fence로 commit/rollback까지 보호한다. READ COMMITTED만 허용하여 기다린 후에도 오래된 transaction snapshot을 쓰는 것을 막는다. recorded_at timestamp cutoff로 phantom을 숨기지 않는다.
- generic trigger의 존재하지 않는 OLD.artist_id를 boolean short-circuit에 의존해 참조하던 문제를 pgTAP/독립 probe에서 재현해 nested IF로 수정했다.
- 별도 math reviewer가 BigInt rational oracle과 403개 결정적 입력을 비교했다. 여섯 자리 비율, 활성/비활성 activity, cap, 28–31일, bigint보다 큰 gross에서 exact final 결과가 일치했다. 정확한 0.5와 그 경계에서 약 ±2.38e−32 떨어진 adversarial 입력도 포함한다. 이것은 PGlite 보조 수식 증거이며 실제 Supabase/동시성 통과가 아니다.

## 검증 경계

기존 1,619 pgTAP와 78개 실제 독립-session 경합은 삭제/수정하지 않고 새 suite와 CI 명령을 추가한다. 이 환경에는 Docker executable이 없어 Supabase PG17 reset/lint/pgTAP/psql 경합/타입 생성은 로컬 실행 불가다. PGlite PG18/synthetic Auth·Storage는 보조 syntax/logic/ACL 검사이고 실제 JWT/PostgREST 또는 경합 증거가 아니다. 로컬 브라우저의 기존 제한은 재시도하지 않는다.

CI는 기존 reset/lint → pgTAP 두 번 → 기존/신규 독립 psql 경합 → official 타입 생성/typecheck → artifact → committed drift gate, 기존 quality/build/E2E를 유지한다. `src/types/database.ts`는 수동 수정하지 않는다. 첫 bootstrap의 예상 타입 drift 실패를 전체 성공으로 표시하지 않고 genuine artifact를 반영한 exact-head 전체 통과 전에는 병합하지 않는다.

## 로컬 최종 결과

- 신규 pgTAP 173개(생명주기 100, 보안 70, 격리 수준 3)를 추가했다. 기존 1,619개와 합친 총 **1,792개가 두 번 모두** supplemental PGlite PG18/synthetic Auth·Storage에서 통과했다. billing 실제 SQL RPC의 charge/refund 연계, KST/session-timezone 경계, 검증 없는 원장 제외, fractional/거액/half 반올림, 정책 거절, 음수 재계산 rollback, 확정 후 조정·불변성, 현재 membership/role/restriction 철회와 권한을 포함한다.
- 기존 78개 독립-session 경합에 신규 settlement 18개를 CI에 추가했다. 첫 16개 scenario의 fixture/RPC SQL은 별도 **순차** PGlite smoke에서 통과했다. 마지막 두 경우는 실제 artist-row NOWAIT/다중 artist 잠금 순서 전용이며 순차 smoke로 통과 처리하지 않는다. 실제 96개 경합은 Supabase exact-head CI 대기다.
- `npm run check:all`의 lint·strict typecheck·11 files / 240 unit tests·10개 대비 조합·production build가 통과했다. UI/브라우저 변경은 없고 로컬 browser 재시도는 하지 않았다. 독립 read-only 최종 검토에서 추가 차단 결함은 없었다.
- 보조 검사 로그는 `/tmp/trot-you-db-check/settlement-final-verification.log`, `settlement-tap-1.txt`, `settlement-tap-2.txt`, `settlement-concurrency-sequential-smoke.log`, `settlement-final-check-all.log`에 있다. 독립 수식 probe는 `review-settlement-math.mjs`이며 공개 저장소에 임시 도구/로그를 넣지 않는다.
- 실제 Supabase PG17 lint·1,792개 pgTAP 두 번·96개 경합·genuine 타입 artifact/committed drift·기존 E2E 13개는 부모가 확인할 **대기 항목**이다. 생성 타입 반영 및 동일 exact head 전체 CI 통과 전에는 완료/병합으로 표현하지 않는다.

## 실제 CI SQL lint 발견과 volatility 수정

- [CI 40068555288](https://github.com/zzz664/trot-you/actions/runs/40068555288)의 원격 exact head `7a2476b5a24837eff593f8c1ef1d95f88a5da1cb`는 로컬 bootstrap `e8aa9e0c9797bbe8873ebf8f0813b6d2ebb09658`와 tree `3099e741f631eb2a927830e5460de5c8cce9241a`가 동일하다. bootstrap은 `archive/settlement-bootstrap-e8aa9e0`에 보존하고 깨끗한 branch를 원격 head로 정렬한 뒤 수정했다.
- 실제 Supabase PG17.11.0.006 시작/reset은 성공했으나 SQL lint가 `private.settlement_calculate_components`의 IMMUTABLE 선언과 RETURN의 STABLE expression 불일치를 보고했다. 해당 run의 pgTAP·경합·타입 생성·artifact·drift 단계는 **실행되지 않았다**. quality의 240 unit tests 및 13 E2E는 통과했지만 전체 CI 성공이 아니다.
- PostgreSQL의 polymorphic JSON 생성 함수는 타입별 출력 변환을 포함하므로 STABLE 계약이다. 계산 helper를 STABLE로 정정했으며 exact numerator/denominator·분기·반올림 수식은 바꾸지 않았다. 읽는 table은 여전히 없고 호출하는 calculate/confirm mutation 함수는 VOLATILE을 유지한다. lint gate를 약화하거나 예외 목록을 추가하지 않았다.
- helper STABLE과 두 mutation caller VOLATILE 계약을 pgTAP 두 assertion으로 고정했다. 신규 누계는 175개, 전체 누계는 **1,794개**다. 독립 affected-callers 재검토에서 immutable caller/index 의존이 없고 JSON builders의 실제 STABLE catalog 계약과 일치함을 확인했다. 403개 BigInt oracle 수식 검사는 다시 통과했다. 전체 보조 pgTAP **1,794개가 두 번** 통과했고 수정 후 `check:all`도 통과했다. 실제 PG17 lint 이후 전체 DB gate·genuine 타입·exact-head CI는 부모가 다시 확인한다.
