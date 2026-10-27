# AGENTS.md — 트롯유 저장소 에이전트 지침

이 파일은 Codex와 Claude Code(CLAUDE.md는 이 파일의 심볼릭 링크)가 자동으로 읽는다. 사람이 쓴 지시문보다 우선하지 않지만, 지시문이 침묵하는 모든 것의 기본값이다.

## 프로젝트

- 중장년 트로트 팬을 위한 가수 구독 메시지 서비스. PWA. Next.js(App Router) + Supabase + Vercel. 패키지 관리는 **npm**.
- 설계 문서는 `docs/00~11`. 작업 카드는 `docs/10`, 일하는 방식은 `docs/11`. 작업 전에 지시문이 가리키는 문서 섹션을 읽는다. 문서와 코드가 다르면 **코드를 문서에 맞추지 말고 먼저 물어본다.**
- 레이어: `app → server/services → server/adapters | server/db | server/settings → config | lib | types`. 역방향 import 금지. 상세는 `docs/06_coding_standards.md`.

## 절대 규칙

1. **하드코딩 금지.** 숫자·문구·경로·키를 코드 본문에 쓰지 않는다. 위치는 `docs/06 §1` 표를 따른다: 운영 값 → `app_settings`(`getSetting`), 환경 값 → `src/config/env.ts`, 문구 → `src/messages/ko.json`, 경로 → `src/config/routes.ts`, 식별자 → `src/config/*.ts`.
2. **로직은 `src/server/services`에만.** Route Handler·Server Action·Cron은 검증 후 서비스를 호출만 한다.
3. **외부 I/O는 어댑터 인터페이스 뒤에.** `PaymentProvider`, `NotificationChannel`, `StorageAdapter`를 거치지 않는 `fetch`를 쓰지 않는다.
4. **메시지 원문은 서버에서만 치환.** `{이름}` 치환은 `src/server/services/message/render.ts` 하나. 클라이언트에서 치환하거나 `messages` 테이블을 직접 SELECT하지 않는다.
5. **돈·구독 상태는 DB 함수로.** `transition_subscription`, `has_active_access`를 우회하는 UPDATE 금지. `payment_events`는 INSERT만.
6. **가수에게 팬 개인정보 비노출.** 아티스트 모드 쿼리는 `profiles.call_name`만 조인한다.
7. **원시 `<button>/<a>/<input>` 금지.** `src/components/ui`의 컴포넌트를 쓴다(터치 48dp, 라벨 내장).
8. **테스트 없는 서비스 함수 금지.**
9. **`main` 머지, production 배포, `app_settings` 값 변경, 시크릿 파일 수정은 하지 않는다.** 필요하면 사람에게 넘긴다.
10. **이미 적용된 마이그레이션 파일은 고치지 않는다.** 바꿀 게 있으면 새 번호 파일을 만든다. 마이그레이션은 A 갈래 카드에서만 만든다.
11. **시간은 `clock.now()`로만 읽는다.** 서비스 코드에서 `new Date()`를 직접 쓰지 않는다(테스트에서 시각을 고정하기 위해).

## 작업 절차

1. 지시문의 문서 섹션과 "참고" 파일을 읽는다. 비슷한 기존 구현이 있으면 그 패턴을 따른다.
2. 범위 밖 파일은 건드리지 않는다. 필요해 보이면 PR 설명에 제안만 쓴다.
3. 구현 → 테스트 → `npm run check:all` 통과 확인. 실패를 남기고 끝내지 않는다.
4. 커밋은 Conventional Commits 한국어 요약 (`feat(subscription): 갱신 청구 Cron 추가`). PR은 300줄 이하.
5. PR 설명에 (a) 구현한 문서 섹션, (b) 테스트 방법, (c) 판단이 필요했던 지점을 쓴다.
6. 작업 끝에 `docs/11_agent_playbook.md §3.8`의 **완료 보고 형식**으로 보고한다. 못 한 것, 추측한 것을 숨기지 않는다.
7. 공용 파일(`src/config/routes.ts`, `src/config/analytics-events.ts`, `src/messages/ko.json`, `vercel.json`, `src/server/container.ts`)은 **기존 줄을 고치지 말고 추가만** 한다. 충돌을 줄이기 위해서다.

## 명령

```
npm run dev            개발 서버
npm run db:start       로컬 Supabase (Docker 필요. Codex Cloud 에서는 불가)
npm run db:reset       마이그레이션 + 시드 재적용
npm run db:types       DB 타입 생성 (src/types/database.ts 는 손으로 수정 금지)
npm run check:all      lint + typecheck + test + build  ← 작업 완료 조건
npm run test:integration  로컬 Supabase 필요
npm run test:e2e       Playwright (preview URL)
```

## 자주 틀리는 것

- `process.env` 직접 접근 → `import { env } from '@/config/env'`.
- 한글 문구를 JSX에 직접 → `t('key')`.
- `'/artists/' + slug` → `routes.artist(slug)`.
- Cron 핸들러에 로직 작성 → `withCron(deps => service(deps))`.
- `enum` 선언 → `as const` 객체.
- `any` → `unknown` + zod.
- 글자 크기 px 고정 → `var(--fs-*)`, 고정 `height` → `min-height`.
- `console.log` → `logger`.

## 문서 색인

| 문서 | 내용 |
| --- | --- |
| `docs/01_architecture.md` | 시스템 구성, 데이터 흐름, 디렉토리 |
| `docs/02_database.md` | 스키마, `app_settings` 키 목록, RLS |
| `docs/03_api.md` | 엔드포인트, 에러 코드, Result 규약 |
| `docs/04_payment_settlement.md` | 결제 어댑터, 구독 생명주기, 정산 계산 |
| `docs/05_frontend.md` | 라우팅, 글자 크기 토큰, 컴포넌트 규칙 |
| `docs/06_coding_standards.md` | 린트 규칙, 네이밍, 테스트 기준 |
| `docs/07_schedule.md` | 범위 컷 라인, 주차별 완료 정의 |
| `docs/08_agent_workflow.md` | 모델·effort 선택, Codex 클라우드 환경 |
| `docs/10_dev_plan.md` | **작업 카드 목록**. 지시문의 작업 ID(예: `W1-M03`)는 여기서 찾는다 |
| `docs/11_agent_playbook.md` | 작업 흐름, 보고 형식 |
