# 2026-10-24 메시지 공개·예약 처리

## 범위와 기준

- PR #26 병합 후 `develop` `acc788cc8010368ac805a56d01918e5f5478d5d6`에서
  `feature/message-dispatch` 하나로 시작했다. 이전 로컬 가수 작성 브랜치의
  tree가 병합본과 같음을 확인하고 전체 ref bundle을 저장한 뒤 정리했다.
- 비공개 설계의 01 §3.3–3.4, 02 메시지·알림 모델, 03 §3.5/3.9,
  05 A-01과 07의 즉시·예약 발송 범위를 참고했다. 원본 문서는 공개하지 않는다.
- 기존 가수 작성 화면에 저장된 초안의 명시적 즉시·KST 예약 확인, 공개/예약/취소
  내역, 취소 창과 결과 복구를 추가한다. 팬 답장 활동 화면·관리자 설정·실제 푸시/
  알림톡 전송은 다른 기능이다.

## 결정과 검증 경계

- 공유 sent 메시지를 앱 내 받은 메시지로 사용하고 기존 fan 조회/서버 이름 치환/
  미디어 권한을 재사용한다. 예약 시점에 팬 목록을 고정하지 않고 실제 공개 시점에
  알림 대상 기기를 고른다. 앱 조회의 현재 접근·이력 정책은 계속 적용된다.
- publish와 outbox 생성은 같은 DB 트랜잭션이다. 외부 I/O가 없는 예약 worker는
  짧은 원자적 DB claim을 사용하므로 별도 외부 전송 lease나 가짜 provider 성공을
  만들지 않는다. 취소와 동시 실행·crash·응답 유실은 DB 테스트 대상으로 둔다.
- 문서의 잠정 취소 5분을 하드코딩하거나 정책을 seed하지 않는다. 실제 정책의
  exclusive 마감 시각과 서버 현재 시각을 UI에 전달한다. 이미 본 내용과 파일,
  기존 서명 URL, 외부로 나간 알림을 회수한다고 약속하지 않는다.
- 전용 Cron flag/secret은 기본 비활성이다. 보호된 route 코드만 만들고 scheduler,
  배포, 운영 값, 실사용자, 실제 알림, 외부 provider 연결은 활성화하지 않는다.
- 한 메시지/작업 키의 재생은 현재 상태를 반환한다. UI의 불확실한 요청은 같은
  intent로만 재시도하며 새 요청을 자동 생성하지 않는다. 이전 draft URL의 reload/
  Back/Forward는 정확한 소유 메시지 receipt로 복구한다.
- 독립 검토에서 기존 COMPOSE_NOT_DRAFT→CONFLICT 매핑과 old draft URL mount가
  복구를 막는 점을 발견했다. 서버 및 client navigation에 exact receipt 기반
  처리를 추가하고 회귀 테스트를 보강했다.
- 기존 media API의 정상 통합만 검증한다. 차단된 독립 media-security 검토를
  재시도/복제/위임하거나 payload parser probe를 하지 않는다. 실제 마이크 권한,
  device permission UI와 모든 동영상 재생 환경은 검증된 것으로 표시하지 않는다.

- 새 boolean dispatch flag가 payment adapter의 중앙 환경 재검증에 그대로 들어가면
  기존 결제 fixture까지 CONFIGURATION_INVALID가 되는 회귀를 전체 unit 실행에서
  발견했다. 해당 경계가 다른 Cron 플래그와 같이 dispatch flag/secret을 provider
  자격증명에서 제외하도록 보완하고 전용 회귀 assertion을 추가했다. 첫 실패
  490개를 숨기지 않았으며 수정 후 전체 4,989개가 통과했다.
- paused 가수에서도 현재 소유자·소속이 유지되면 기존 예약을 취소할 수 있는 원래
  계약을 보존했다. `/artist/messages`에서 본인 내역이 있는 가수를 찾아 별도
  읽기/취소 화면으로 이동한다. 활동이 멈춘 가수의 새 작성·공개를 열지는 않는다.

## 실행 결과

애플리케이션 후보의 로컬 정적 검증 결과는 다음과 같다.

- 전체 Vitest **158 files / 4,993 tests** 통과. 변경 전 4,680개를 보존하고
  dispatch·history·recovery·환경 호환성 테스트를 추가했다.
- 기존 114개를 보존한 **141 fixture/discovery checks** 통과. 이 중 새 27개는
  dispatch CI 격리·기본 suite 제외·명시적 전용 탐색을 검사하며 browser를
  시작하지 않는다.
- 실제 checkpoint CI의 genuine 타입을 byte-identical로 반영한 뒤
  **`npm run check:all` 전체 통과**: ESLint/Prettier, strict typecheck,
  4,993 unit tests, 10개 대비 조합, production/PWA build. 생성 타입은
  수동 작성하지 않았으며 출처·해시는 checkpoint 작업 로그에 기록했다.
  `git diff --check`도 통과했다.
- 전용 브라우저 43개 시나리오와 성공 경로 기준 290개 새 화면 캡처, 기본
  keyless 2개 시나리오를 작성했다. 세 글자 크기와 360/1280 폭의 확인·예약·
  공개·취소·모든 새 오류·불확실 복구·Back/Forward·paused 내역을 포함한다.
  이 숫자는 작성된 inventory이며 실제 브라우저 실행/이미지 검사 통과가 아니다.
- 독립 read-only 검토의 구체적 차단 사항을 보완했다. 겹치는 focused test
  실행은 전체 unit 숫자에 중복 합산하지 않는다.

로컬 Docker 부재와 기존 브라우저 실행 제한 때문에 실제 Supabase/브라우저
검사는 GitHub의 disposable-local CI에서만 수행한다. DB checkpoint의 실제
PG17·독립 경합·genuine 타입은 checkpoint 작업 로그의 실제 run에서 확인했고,
최종 app head의 전체 CI·보통 크기 이미지 검토는 별도로 확인해야 한다. 현재 검증을 배포·실제 고객 전송·기기 수신 완료로
표현하지 않는다.

## 첫 애플리케이션 CI의 만료 접근 assertion 보정

[앱 run 40142771491](https://github.com/zzz664/trot-you/actions/runs/40142771491)의
head `666e9424e192fd4077a030579d4548b3125f9ff1`, tree
`2e7d4220f4ba844bf4c187bd220f7691153956c1`에서 dispatch browser 41개가 통과하고
새 테스트 2개가 실패했다. 두 실패 모두 유예 팬의 정상 조회가 통과한 **뒤**, 만료
구독 조회에 `200` 빈 feed를 기대한 새 테스트 때문이었다. 기존 chat HTTP는
유료 feed를 조용히 다른 데이터로 바꾸지 않고 `403 SUBSCRIPTION_REQUIRED`를
반환하도록 구현·검증되어 있다.

제품 권한을 완화하지 않고 두 만료 assertion만 기존 계약에 맞췄다. 정확한 403,
`no-store`, `{ ok: false, code: 'SUBSCRIPTION_REQUIRED' }` 전체를 확인하므로
본문/수신자 DTO가 누출되지 않는 것도 검사한다. 유예·공개·outbox·이름 치환 및
기존 성공 helper의 assertion은 그대로 유지한다. 공식 실패 로그와 artifact
`12579491810`을 보존했고 이 실패를 통과로 표시하거나 동일 head의 무근거
재실행으로 덮지 않았다. 수정한 head의 전체 CI를 다시 확인해야 한다.

이 첫 앱 run은 13개 job 모두 종료했고 12개 성공, 위 전용 browser job만
실패했다. 실제 PG17에서는 3,065 pgTAP를 두 번, 독립 경합 260개를 통과했고
genuine 타입 생성·typecheck·committed type drift 0도 확인했다. 공식 타입
artifact `12579552361`은 앞서 반영한 타입과 byte-identical이다. 이 DB 통과와
앱 전체 CI 통과를 혼동하지 않는다.

## 실제 화면 검토에서 찾은 큰 글자 입력과 팬 캡처 보완

같은 첫 앱 run의 실제 xlarge·360px 이미지에서 native `datetime-local`의
오전/오후 표시가 달력 아이콘 아래 잘리는 것을 확인했다. 글자 크기를 줄이지
않고 KST를 명시한 날짜·시간 입력을 세로로 분리했다. 엄격한 날짜 변환,
서버 기준 미래 시각 검사, 확인창 및 같은 operation의 불확실 재시도는
유지한다. 불완전한 입력과 세 글자 크기 라벨·동일 재시도를 unit으로 보강했다.

팬 화면은 DOM의 개인화 본문 assertion은 통과했지만 여섯 조합 중 다섯 실제
full-page 캡처가 카드 본문 아래까지 담지 못했다. 앱 본문 잘림으로 단정하지
않고 캡처 증거 부족으로 기록했다. 이제 개인화 본문을 실제 viewport에 넣고
읽음 저장 완료와 font/layout 안정을 확인한 뒤 full-page와 full-card를 모두
저장한다. 여섯 카드 캡처를 추가하여 전용 suite의 계획된 성공 경로는
43개 테스트 / 296개 캡처다. 기존 권한·게시·읽음·개인화 assertion은 보존·강화했고
수정한 head의 실제 CI와 이미지 재검토 전에는 시각 검증 완료로 표시하지 않는다.

이 보완을 포함한 로컬 `npm run check:all`은 전체 통과했다: ESLint/Prettier,
strict typecheck, **158 files / 5,001 unit tests**, 대비 검사와 production/PWA
build. 전용 fixture/discovery 27개와 `git diff --check`도 통과했고 generated
타입은 검증한 genuine artifact와 다시 byte 비교했다. 로컬 browser/Docker는
실행하지 않았으며 수정 commit의 전체 CI·실제 화면 검토는 아직 대기 중이다.
