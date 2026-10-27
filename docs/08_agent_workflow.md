# 08. 에이전트 개발 워크플로 (Codex · Claude Code)

> 2026-10-24 기준. 모델·플랜 조건은 자주 바뀌므로 `developers.openai.com/codex/models`와 Codex 체인지로그를 **주 1회** 확인한다.

---

## 1. 도구 역할 분담

| 도구 | 역할 | 언제 |
| --- | --- | --- |
| **Codex (앱·CLI·IDE)** | 주력 구현 도구. 유스케이스 단위 구현, 테스트 작성, 리팩터링 | 기본 |
| **Claude Code (Fable 5.1 → Opus 5.5)** | Codex 한도 소진 시 대체. 또는 Codex가 두 번 실패한 문제(결제 상태 기계, RLS, 복잡한 집계)의 두 번째 의견 | 부득이할 때 |

두 도구 모두 **같은 `AGENTS.md`**(=`CLAUDE.md`)를 읽는다. 지시문은 도구에 상관없이 같은 형식으로 쓴다(§5).

**작업 지시는 사람이 직접 한다.** 에이전트에게 다른 에이전트를 부리게 하거나, 업무 시간 밖에 작업을 돌리지 않는다. 사람이 보낸 작업은 사람이 같은 날 결과를 확인한다.

---

## 2. Codex 모델·effort 선택

2026년 10월 기준 Codex에서 쓸 수 있는 모델은 **GPT-6.1 Sol(기본·권장), GPT-6 Luna(경량), GPT-6 Astra(최상위)**다. GPT-5.5는 10/14에 Codex에서 퇴역했다. Effort는 모델별로 `low / medium / high / xhigh / max / ultra` 중 일부를 지원한다(Sol은 Light~Ultra, Astra는 low~max).

### 2.1 작업 유형별 추천

| 작업 유형 | 모델 | effort | 이유 |
| --- | --- | --- | --- |
| 이름 바꾸기, 타입 수정, 문구 i18n 이동, 린트 오류 수정 | `gpt-6-luna` | `low` | 빠르고 싸다. 판단이 거의 필요 없다 |
| 화면 조립, CRUD 액션, 테스트 추가, 어드민 폼 | `gpt-6.1-sol` | `medium` | OpenAI 권장 일상 설정. 이 프로젝트 작업의 70% |
| 구독 상태 기계, 결제 콜백·웹훅, Cron 멱등성, RLS 정책, 정산 계산 | `gpt-6.1-sol` | `high` 또는 `xhigh` | 실수 비용이 크다. 한 번에 맞는 게 재작업보다 싸다 |
| 아키텍처 변경, 레이어 위반 대규모 정리, 원인 불명 버그 추적 | `gpt-6-astra` (플랜에서 보이면) | `high` ~ `xhigh` | 1M 컨텍스트로 저장소 전체를 보며 판단 |
| 22화면 × 3단계 스크린샷 생성처럼 **나눌 수 있는 큰 일** | `gpt-6.1-sol` | `ultra` | ultra는 서브에이전트 병렬. 나뉘지 않는 일엔 낭비 |
| 코드 리뷰(`/review`) | `gpt-6.1-sol` | `high` | 리뷰는 깊이가 중요 |

**원칙:** `medium`에서 시작한다. 결과가 두 번 틀리면 effort를 한 단계 올린다. 그래도 틀리면 지시문이 문제다(§5 체크리스트로 돌아간다).

### 2.2 프로젝트 설정 파일

```toml
# .codex/config.toml  (저장소에 커밋. 팀 전원 동일)
model = "gpt-6.1-sol"
model_reasoning_effort = "medium"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[profiles.chore]
model = "gpt-6-luna"
model_reasoning_effort = "low"

[profiles.high]
model = "gpt-6.1-sol"
model_reasoning_effort = "high"

[profiles.critical]
model = "gpt-6.1-sol"
model_reasoning_effort = "xhigh"

[profiles.deep]
model = "gpt-6-astra"
model_reasoning_effort = "high"
```

사용: `codex -p critical "docs/04_payment_settlement.md §2.2 갱신 Cron 구현"`. 세션 중 바꾸려면 `/model`.

### 2.3 Pro 플랜 한도 운용

- 한도는 5시간·주간 창으로 적용된다. **`ultra`·`xhigh`를 습관적으로 쓰지 않는 것**이 한도 관리의 전부다.
- 큰 작업은 Codex Cloud로 보내고(환경은 §4.2에서 미리 만든다) 로컬 세션은 리뷰·수정에 쓴다.
- 한도가 80% 넘으면 그날 남은 "중요" 작업은 Claude Code로 돌린다(§3).

---

## 3. Claude Code 대체 규칙

| 상황 | 모델 | effort |
| --- | --- | --- |
| Codex 한도 소진, 일반 구현 | **Claude Fable 5.1** | `medium` |
| Codex 한도 소진, 결제·RLS·정산 | Fable 5.1 | `high` |
| Fable 한도 소진 | **Claude Opus 5.5** | 위와 동일 기준 |
| 작은 수정 | Claude Haiku 5.5 | `low` |

```bash
claude --model claude-fable-5-1 --effort high
# 또는 세션 중 /model
```

- Claude Code는 `CLAUDE.md`를 읽는다. `AGENTS.md`의 심볼릭 링크로 두어 내용을 하나로 유지한다: `ln -s AGENTS.md CLAUDE.md`.
- 같은 작업을 두 도구에 동시에 시키지 않는다(충돌 PR). 작업은 GitHub 이슈 단위로 한 도구에 배정한다.
- Claude Code가 만든 변경도 Codex `/review`를 거친다(교차 리뷰가 둘 중 하나만 쓰는 것보다 결함을 더 잡는다).

---

## 4. Codex 클라우드 환경 (업무 시간 병렬 작업용)

### 4.1 언제 쓰나

로컬 Codex는 한 사람이 카드 하나를 보면서 일하기 좋다. 클라우드는 **DB가 필요 없는 독립 카드를 같은 시간에 하나 더** 돌릴 때 쓴다. 어느 카드를 어디서 돌릴지는 `11 §5.3` 표를 따른다. 클라우드 작업도 사람이 보내고, 사람이 같은 날 결과를 확인한다.

### 4.2 준비 (W0-F01 머지 후, 30분)

Codex 앱 → 새 작업 → Work in: Cloud → Select environment → Create environment → `trotyou` 저장소 선택 → 의존성 설치 확인(`npm ci`) → Publish.

- 클라우드에는 Docker가 없어 로컬 Supabase를 띄울 수 없다. 클라우드에서는 `npm run lint && npm run typecheck && npm run test && npm run build`까지만 돌리고, 통합 테스트는 CI의 `db` 잡이 돌린다.
- 시크릿은 **staging 값**만 넣는다. production 키는 절대 넣지 않는다.

### 4.3 주의

- 클라우드 작업도 Codex 사용량 한도를 쓴다(§2.3).
- 한 사람이 동시에 지켜보는 카드는 2장까지(로컬 1 + 클라우드 1). 리뷰가 병목이라서다(`11 §8`).
- 퇴근 전에 실행 중인 클라우드 작업이 남지 않게 한다. 끝나지 않은 작업은 `11 §3.7` 인수인계를 받아 두고 다음 날 새 세션에서 이어 간다.

### 4.4 사람이 직접 챙기는 것

에이전트가 상시로 프로젝트를 지켜보지 않으므로, 아래 일은 사람이 정해진 때에 한다.

| 할 일 | 방법 | 언제 |
| --- | --- | --- |
| PR·CI 상태 확인 | GitHub 브랜치 보호(CI 통과 필수) + CI 실패 알림 켜기. `gh pr list`로 열린 PR과 검사 상태 확인 | 매일 09:00, 13:00, 18:00 |
| CI 실패 원인 파악 | 해당 작업 세션에 `11 §3.6` 프롬프트 | 실패 알림을 본 때 |
| 문서와 코드가 어긋난 곳 찾기 | PR 체크리스트("문서와 다르면 문서도 수정") + 리드가 Codex에 `11 §3.10` 문서 대조 지시 | 매주 금요일 오전 |
| 이번 주 카드를 이슈로 만들기 | 리드가 Codex에 `11 §5.5` 지시 | 매주 월요일 09:00 |
| 테스트 보강 | 따로 하지 않는다. 테스트는 카드마다 수용 기준에 들어 있고, 4주차 W4-Q01이 마무리한다 | — |
| 출시 후 모니터링 | 10 문서 W5-L02 | 출시 후 48시간 |

---

## 5. 에이전트 지시문 작성 규칙 (Codex·Claude 공통)

지시문 품질이 결과 품질이다. 아래 형식을 GitHub 이슈 템플릿으로 만든다.

```
## 목표
docs/04_payment_settlement.md §2.2 의 갱신 청구 Cron 을 구현한다.

## 범위
- src/server/services/subscription/charge-due.ts (새 파일)
- src/app/api/cron/charge-renewals/route.ts
- vercel.json 에 Cron 추가
- tests/integration/subscription/charge-due.test.ts

## 범위 밖
- PaymentProvider 인터페이스 변경 금지
- 알림 문구 추가 금지 (notification_jobs 에 template_key 만 적재)

## 수용 기준
- [ ] docs/04 §4 매트릭스의 "갱신 성공", "갱신 실패→유예→만료" 테스트 통과
- [ ] 같은 구독이 동시에 두 번 처리되지 않음 (for update skip locked)
- [ ] 숫자 리터럴 없음. grace_days, retry 간격은 app_settings 에서 읽음
- [ ] npm run check:all 통과

## 참고
- 기존 패턴: src/server/services/message/dispatch.ts (withCron 사용법)
- Result 타입: src/lib/result.ts
```

체크리스트:
- 문서 **섹션 번호**를 적는다. "결제 기능 만들어 줘"는 지시문이 아니다.
- 파일 경로를 적는다. 에이전트가 파일을 새로 만들 자리를 추측하면 레이어가 깨진다.
- 범위 밖을 적는다. 에이전트는 묻지 않고 넓힌다.
- 수용 기준에 `npm run check:all`을 항상 포함한다.
- 한 이슈 = 한 PR = 300줄 이하.

---

## 6. 주간 리듬

| 요일 | 할 일 |
| --- | --- |
| 월 09:00 | 이번 주 완료 정의(07 §2) 확인, 이슈 배정(도구 포함), Codex 모델 페이지·체인지로그 확인 |
| 매일 09:00 | `gh pr list`로 열린 PR·CI 상태 확인, 오늘 카드 배정(사람당 2장까지) |
| 매일 | 사람 리뷰 → 머지. 에이전트 PR은 `check:all` + Codex `/review` 통과한 것만 큐에 올라옴 |
| 목 17:00 | 완료 정의 대비 점검. 밀리면 "중요" 항목 컷 결정 |
| 금 오전 | 문서-코드 대조(`11 §3.10`) |
| 금 | preview 배포 상태로 PM·디자이너 확인 |
