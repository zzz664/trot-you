# AGENTS.md — 트롯유 저장소 에이전트 지침

이 파일은 Codex와 Claude Code(CLAUDE.md는 이 파일의 심볼릭 링크)가 자동으로 읽는다.
사람은 아래 **명령어** 한 줄만 보낸다. 무엇을 만들지는 `docs/10_dev_plan.md`의 카드에, 어떻게 일할지는 이 파일에 있다.

## 프로젝트

- 중장년 트로트 팬을 위한 가수 구독 메시지 서비스. PWA. Next.js(App Router) + Supabase + Vercel. 패키지 관리는 **npm**.
- 설계 문서는 `docs/00~11`. 작업 카드는 `docs/10`. 문서와 코드가 다르면 **코드를 문서에 맞추지 말고 멈추고 물어본다.**
- 레이어: `app → server/services → server/adapters | server/db | server/settings → config | lib | types`. 역방향 import 금지. 상세는 `docs/06_coding_standards.md`.

## 절대 규칙

1. **하드코딩 금지.** 숫자·문구·경로·키를 코드 본문에 쓰지 않는다. 운영 값 → `app_settings`(`getSetting`), 환경 값 → `src/config/env.ts`, 문구 → `src/messages/ko.json`, 경로 → `src/config/routes.ts`, 식별자 → `src/config/*.ts` (`docs/06 §1`).
2. **로직은 `src/server/services`에만.** Route Handler·Server Action·Cron은 검증 후 서비스를 호출만 한다.
3. **외부 I/O는 어댑터 인터페이스 뒤에.** `PaymentProvider`, `NotificationChannel`, `StorageAdapter`, `AnalyticsSink`를 거치지 않는 `fetch`를 쓰지 않는다.
4. **메시지 원문은 서버에서만 치환.** `{이름}` 치환은 `src/server/services/message/render.ts` 하나. 클라이언트에서 치환하거나 `messages` 테이블을 직접 SELECT하지 않는다.
5. **돈·구독 상태는 DB 함수로.** `transition_subscription`, `has_active_access`를 우회하는 UPDATE 금지. `payment_events`는 INSERT만, 결제 **성공 후에** 기록.
6. **가수에게 팬 개인정보 비노출.** 아티스트 모드는 `get_replies_for_artist`로 `call_name`만 받는다.
7. **원시 `<button>/<a>/<input>` 금지.** `src/components/ui`의 컴포넌트를 쓴다.
8. **테스트 없는 서비스 함수 금지.**
9. **`main` 머지, production 배포, `app_settings` 값 변경, 시크릿 파일 수정은 하지 않는다.**
10. **이미 적용된 마이그레이션 파일은 고치지 않는다.** 마이그레이션은 담당 A 카드에서만, 번호는 `develop`의 마지막 번호 + 1.
11. **시간은 `clock.now()`로만 읽는다.** 서비스 코드에서 `new Date()` 금지.
12. **공용 파일은 줄 추가만.** `routes.ts`, `analytics-events.ts`, `ko.json`, `vercel.json`, `container.ts`, `env.ts`, `seed.sql`, `settings/registry.ts`. 새 설정 키는 `docs/02 §3.1` 표에도 추가.
13. **`src/components/ui/`는 담당 B 카드에서만 고친다.**

## 명령어 (사람이 보내는 말)

| 사람이 보내는 말 | 하는 일 |
| --- | --- |
| `[작업] W1-M03` | 카드 하나를 처음부터 끝까지. 아래 "[작업] 절차" |
| `승인` 또는 `승인: {결정}` | critical 카드의 계획을 승인받고 구현을 이어간다 |
| `[리뷰] PR #123` | 다른 도구가 쓴 PR을 리뷰만 한다. 코드는 고치지 않는다 |
| `[반영] PR #123` + 리뷰 결과 | 리뷰 지적을 고친다 |
| `[CI] PR #123` | CI 실패 원인을 찾아 고친다 |
| `[인수인계]` | 지금 하던 카드를 다른 작업자에게 넘길 기록을 남긴다 |
| `[대조]` | 문서와 코드가 다른 곳을 찾아 보고한다 |
| `[이슈] W1` | 그 주차 카드를 GitHub 이슈로 만든다 |

명령어가 아닌 지시를 받으면, 그 지시가 어느 카드에 속하는지 먼저 묻는다.

## [작업] 절차

1. **카드 찾기.** `docs/10_dev_plan.md`에서 `#### {카드 ID}` 제목을 찾아 카드 전체를 읽는다. `docs/10 §1.3`(모든 카드에 공통인 완료 기준)도 읽는다.
   - 카드가 없거나 `종류: 사람`이면 → 멈추고 알린다.
   - 카드에 "조건"이 있으면(예: W1-X01) → 조건이 충족됐는지 묻고 멈춘다.
2. **선행 확인.** 카드의 `선행`에 있는 카드 ID마다 `git log origin/develop --oneline`에 `[그 ID]`가 있는지 본다(PR은 제목 그대로 squash 머지된다).
   - 없으면 → 어떤 선행이 빠졌는지 알리고 멈춘다.
   - `H-` 로 시작하는 선행(사람 할 일)은 확인할 수 없으니 보고의 "사람 확인 필요"에 적고 계속한다.
3. **브랜치.** 지금 브랜치가 `feat/{카드 ID}`면 그대로 쓴다. 아니면 `origin/develop`에서 `feat/{카드 ID}`를 만든다.
   - `.handoff/{카드 ID}.md`가 있으면 이어받는 작업이다. 먼저 읽고, 거기 적힌 "실패한 방법"은 다시 하지 않는다.
   - `.handoff/{카드 ID}-plan.md`가 있으면 승인된 계획이다. 그 계획대로 6단계부터 한다.
4. **읽기.** 카드의 "읽을 문서" 섹션, "따라 할 코드" 파일, `docs/00 §3-1`(설계 보정 이력)을 읽는다. 카드의 "구현 메모"는 이미 내려진 결정이니 다시 고민하지 않는다.
5. **critical이면 계획만.** 카드의 `프로필: critical`이면 코드를 쓰기 전에 아래 6가지를 `.handoff/{카드 ID}-plan.md`에 써서 커밋·push하고, 같은 내용을 보여준 뒤 **멈춰서 `승인`을 기다린다.**
   1. 만들거나 고칠 파일과 각 파일이 하는 일
   2. 핵심 함수의 이름·입력·출력
   3. 트랜잭션 경계: 무엇을 DB 함수 하나로 묶고 무엇을 앱 코드에 둘지, 이유
   4. 테스트 목록: 완료 기준 한 줄마다 테스트 이름 하나씩
   5. 문서에서 애매하거나 빠진 부분: 각각 선택지 2개와 추천
   6. 가장 틀리기 쉬운 곳 2가지와 그걸 막을 테스트
6. **구현.**
   - 종류에 `서버`·`DB`가 있으면: 입력과 출력이 분명한 로직은 **테스트를 먼저** 쓰고, 실패하는 걸 확인한 뒤 구현한다. 구현에 맞추려고 테스트를 고치지 않는다.
   - 종류에 `화면`이 있으면: `components/ui`만 조립하고, 문구는 `ko.json`에 추가만 한다. 카드에 적힌 화면마다 글자 크기 normal·large·xlarge, 폭 360px로 Playwright 스크린샷 3장을 `test-results/{카드 ID}/`에 저장한다. 잘리거나 겹치는 곳은 보고한다.
   - 종류가 `검증`이면: 버그를 찾아도 **고치지 않는다.** 재현 방법과 함께 보고한다.
   - 카드의 "만들 파일" 밖은 고치지 않는다.
7. **검증.** `npm run check:all`. `docker info`가 되면 `npm run db:reset`, `npm run test:db`, `npm run test:integration`도. Docker가 없으면 통합 테스트는 작성만 하고 보고에 "CI에서 확인"이라고 적는다. 실패를 남기고 끝내지 않는다.
8. **마무리.** `.handoff/{카드 ID}*` 파일을 지우고, Conventional Commits 한국어 요약으로 커밋하고, `git push -u origin feat/{카드 ID}`로 push한다(`develop`에 직접 push하지 않는다). `gh`를 쓸 수 있으면 드래프트 PR을 연다(제목 `[{카드 ID}] {카드 이름}`, 본문은 아래 완료 보고 + `.github/pull_request_template.md`의 체크리스트). PR은 300줄 이하(SQL·생성 타입·테스트 제외). 넘으면 나눌 방법을 보고한다.
9. **완료 보고**를 출력한다.

## 멈추고 물어볼 때

아래 경우에는 추측해서 진행하지 말고 멈춘다. 무엇을 결정해야 하는지 선택지와 추천을 함께 적는다.

- 카드와 설계 문서가 서로 다르거나, 문서에 답이 없다
- 카드의 "만들 파일" 밖을 고쳐야 한다
- 담당 A가 아닌 카드에서 마이그레이션이 필요하다
- 담당 B가 아닌 카드에서 `components/ui` 부품이 필요하다
- 선행 카드가 머지되지 않았다
- 같은 방법으로 두 번 실패했다

## 완료 보고

```markdown
## 완료 보고 — {카드 ID}

- **한 일:** (3줄 이내)
- **완료 기준:**
  - [x] {기준} — 증명: `{테스트 이름}` 또는 확인 방법
  - [ ] {기준} — 못 한 이유:
- **검증:** check:all 통과 / test:db·test:integration 통과 또는 "CI에서 확인"
- **스크린샷:** test-results/{카드 ID}/ (화면 카드만)
- **만들 파일 밖에서 고친 것:** 없음 / {파일과 이유}
- **추측한 것 (사람 확인 필요):** 문서에 없어서 정한 것
- **사람 확인 필요:** 실기기·staging 확인, 사람 선행(H-) 등
- **다음 카드에 넘길 것:**
```

## 다른 명령어 절차

**`승인` / `승인: {결정}`** — `.handoff/{카드 ID}-plan.md`에 결정을 덧붙여 커밋하고, [작업] 절차 6단계부터 이어간다.

**`[리뷰] PR #{번호}`** — 코드는 고치지 않는다. PR 제목의 카드 ID로 카드와 카드의 문서를 읽고 `gh pr diff {번호}`를 본다. 심각한 순서로 찾는다: ① 돈·구독 상태가 틀어지는 경로(동시 실행, 재시도, 중간 실패, 시간 경계) ② 다른 사람의 데이터를 보거나 바꾸는 경로 ③ 테스트로 증명되지 않은 완료 기준 ④ 하드코딩·레이어 위반·문서와 다른 곳. 지적마다 번호(①~④), 파일과 줄, 실제로 생기는 일, 고칠 방향. 확실하지 않으면 "추정". 문제가 없으면 없다고 한다. 스타일 지적은 하지 않는다.

**`[반영] PR #{번호}` + 리뷰 결과** — 그 PR의 브랜치에서 ①②③은 모두 고치고, ④는 간단하면 고친다. 동의하지 않는 지적은 고치지 말고 이유를 적는다. 지적마다 "반영 / 반대(이유)"로 보고한다.

**`[CI] PR #{번호}`** — `gh run view --log-failed`로 로그를 보고 원인을 한 문단으로 설명한 뒤 고친다. 테스트를 지우거나, 건너뛰게 하거나, 기대값을 바꿔서 통과시키지 않는다. 그래야 할 이유가 있으면 고치지 말고 보고한다.

**`[인수인계]`** — `.handoff/{카드 ID}.md`에 ① 지금까지 한 일(커밋 목록) ② 남은 일 ③ 시도했다가 실패한 방법과 이유 ④ 다음 작업자가 먼저 볼 파일 3개 ⑤ 의심하는 원인을 쓰고, 커밋·push한 뒤 멈춘다.

**`[대조]`** — 코드는 고치지 않는다. `docs/02_database.md` ↔ `supabase/migrations/`, `docs/03_api.md` ↔ `src/app/api/**`와 `**/actions.ts`를 비교해 표로 보고한다: 위치(문서 §, 파일:줄) / 문서 내용 / 코드 내용 / 추천(문서를 고칠지, 코드를 고칠지) / 이유. 결정 사항(00 §3)이나 보안·돈 규칙이면 코드를 고치는 쪽으로, 이미 머지된 코드가 더 나은 판단이면 문서를 고치는 쪽으로 추천한다. 확실하지 않으면 "사람 결정".

**`[이슈] W{n}`** — 코드는 고치지 않는다. `docs/10`의 그 주차 카드마다 `gh issue create`로 이슈를 만든다. 제목 `[{카드 ID}] {카드 이름}`, 본문은 카드 전체, 라벨 `week-{n}`·`lane-{A|B|C}`·`profile-{프로필}`(없으면 만든다). 같은 제목이 있으면 건너뛴다. 만든 번호 목록을 보고한다.

## npm 명령

```
npm run dev               개발 서버
npm run db:start          로컬 Supabase (Docker 필요)
npm run db:reset          마이그레이션 + 시드 재적용
npm run db:types          DB 타입 생성 (src/types/database.ts 는 손으로 수정 금지)
npm run check:all         lint + typecheck + test + build
npm run test:db           pgTAP (Docker 필요)
npm run test:integration  통합 테스트 (Docker 필요)
npm run test:e2e          Playwright
```

## 자주 틀리는 것

- `process.env` 직접 접근 → `import { env } from '@/config/env'`
- 한글 문구를 JSX에 직접 → `t('key')`
- `'/artists/' + slug` → `routes.artist(slug)`
- 크론 핸들러에 로직 → `withCron(deps => service(deps))`
- `enum` → `as const` 객체
- `any` → `unknown` + zod
- 글자 크기 px 고정 → `var(--fs-*)`, 고정 `height` → `min-height`
- `console.log` → `logger`
- 파일 맨 위 `const MAX = 100` → 운영 값이면 `app_settings`, 기술 상수면 `src/config/constants.ts`

## 문서 색인

| 문서 | 내용 |
| --- | --- |
| `docs/00_README.md` | 결정 사항(D-1~), 설계 보정 이력 |
| `docs/01_architecture.md` | 시스템 구성, 데이터 흐름, 디렉토리 |
| `docs/02_database.md` | 스키마, `app_settings` 키 목록, RLS |
| `docs/03_api.md` | 엔드포인트, 에러 코드, Result 규약 |
| `docs/04_payment_settlement.md` | 결제 어댑터, 구독 생명주기, 정산 |
| `docs/05_frontend.md` | 라우팅, 글자 크기 토큰, 컴포넌트 규칙 |
| `docs/06_coding_standards.md` | 린트 규칙, 네이밍, 테스트 기준 |
| `docs/07_schedule.md` | 범위 컷 라인, 주차별 완료 정의 |
| `docs/08_agent_workflow.md` | 모델·effort, Codex 클라우드 환경 |
| `docs/10_dev_plan.md` | **작업 카드.** 카드 ID는 여기서 찾는다 |
| `docs/11_agent_playbook.md` | 사람용 안내서 |
