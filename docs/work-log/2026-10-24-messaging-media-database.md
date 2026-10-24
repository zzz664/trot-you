# 2026-10-24 — 메시지·미디어 DB 기반

## 범위

- PR #5가 병합된 정확한 `develop` base `85328bc3408391c866d3700dfacf8adbabed62d4`를 fetch하여 기능 브랜치 `feature/messaging-media-database` 하나를 만들었다. 깨끗한 이전 로컬 billing 커밋은 저장소 밖 검증된 git bundle로 보존한 뒤 종료된 로컬 기능 브랜치를 제거했다.
- 메시지/답장/읽음/정규화한 미디어 metadata 및 private Storage bucket/RLS, 서비스 전용 lifecycle/조회 RPC, 호출자 전용 멱등 읽음 RPC를 추가했다.
- 팬 원문 직접 SELECT, draft/scheduled/canceled/다른 가수/이력 밖 메시지 노출, 관리자/가수의 직접 상태 변경, 임의 경로 미디어 연결, 클라이언트 Storage 우회를 차단했다.
- 실제 업로더/파일 검사/서명 URL/개인화 서비스/메시지 UI/예약 Cron/알림 outbox·dispatcher는 구현하지 않았다. provider·호스팅 DB·실사용자·실제 자산·시크릿·운영 배포를 사용하지 않았다.
- 비공개 원본 기획 문서를 커밋하지 않았으며, 수정한 안전 계약은 [DB 계약 문서](../database/messaging-media.md)에 정리했다.

## 주요 결정 및 원문 보완

- raw 메시지/미디어는 가수 소속/관리자만 읽고, 팬 내용은 검증된 서버가 안전한 서비스 DTO를 받아 개인화하도록 분리했다. `body_template`을 브라우저에 그대로 전달하는 API는 없다.
- 이력은 현재 subscription episode를 기준으로 계산하고 유료 active/canceled 및 명시적 grace 기간을 기존 공통 구독 판정과 동일하게 적용했다. 기존 공개 `has_active_access`의 호출자/transaction-time 의미는 유지하면서 임의 사용자 조회가 불가능한 내부 공통 함수를 사용한다.
- 승인된 운영 설정을 받는 private 정책 snapshot은 비워 두었다. 미설정 시 실패하며 임의 요청별 길이/이력/취소 시간이나 문서 기본값 fallback을 허용하지 않는다. 실제 설정 관리 연동은 후속 범위다.
- lifecycle과 권한 변경의 잠금 순서를 맞추고, 잠금 후 현재 시각으로 읽음/답장 권한과 취소 경계를 확인한다. 서버 시각의 sent 기록만 생성하며 직접 INSERT/UPDATE/DELETE를 서비스 역할에도 허용하지 않는다.
- 답장은 실제 팬과 관련 구독만 가능하며 원본 팬 ID/전화/닉네임을 가수에게 노출하지 않는다. 금칙/욕설·빈도 제한은 후속 서비스 책임으로 남기고 직접 쓰기를 열어 우회하지 않았다.
- 읽음은 최초 시각을 유지한다. 취소 이후 mark는 거부하지만 기존 읽음 증거는 보존한다. 맛보기만 보는 비구독자는 유료 읽음 증거를 만들 수 없다.
- `message-media`만 private으로 만들고 bucket/object에 restrictive 정책을 적용해 미래의 permissive 정책이 클라이언트 접근이나 public 전환을 다시 열지 못하게 했다. Storage가 실제 CI에서 시작되도록 로컬 설정을 켰다.
- 미디어는 실제 message/object FK와 정확한 가수/메시지/미디어 UUID 경로, MIME/확장자/종류별 size 및 필수 차원·재생 시간에 결합한다. SQL은 실제 파일 바이트를 검사하지 않으므로 후속 trusted uploader가 검증해야 한다. 임의 path 서명 RPC는 없으며 이미 발급된 URL의 취소/TTL 문제도 문서화했다.

## 검증

- 기존 **362개 pgTAP**(identity 140, billing lifecycle 151, billing security 71)와 기존 **7개 billing 독립 세션 동시성 검사**는 보존했다. 기존 billing concurrency script는 byte-identical이다.
- 새 실제 pgTAP: **lifecycle 128 + security 71**, 총 **561개**. 직접 table SELECT/INSERT/UPDATE/DELETE, 각 역할의 RPC, paid/grace/history/preview/cancel/read/reply 경계, populated 미디어 DTO의 안전 필드, Storage에 임시 broad permissive 정책을 추가한 뒤에도 접근이 거절되는지 검사한다. 모든 fixture는 rollback한다.
- 로컬 보조 검증은 **PGlite 0.5.11 / PostgreSQL 18.6 WASM + 명시적인 synthetic Auth/Storage schema**에서 전체 migration과 561개 검사를 두 번 통과했다. 보조 harness의 SQL tokenizer가 표준 문자열의 backslash를 escape로 오인하던 부분을 고쳐 각 SQL statement 경계를 psql 방식으로 실행한 최종 결과다. 실제 Supabase PG17/HTTP/JWT/Storage blob 검증으로 표현하지 않는다.
- 새 **5개 독립 PostgreSQL 세션 concurrency 검사**를 CI에 추가했다: dispatch 중복, 취소가 먼저인 read 거절, read가 먼저인 취소 후 증거 보존, 전체 맛보기 선택의 직렬화, 구독 잠금 대기 중 접근 기간 만료. `pg_blocking_pids`로 실제 대기를 확인하고 허구 fixture 후 disposable local DB를 reset한다. 기존 7개 검사는 그대로 별도로 실행한다.
- 로컬 concurrency 실행은 `docker context show`에서 **`spawnSync docker ENOENT`로 차단**되었다. Docker 실행 파일이 없어 DB 세션/fixture/reset을 시작하지 않았다. 로컬 `psql`도 없다. 실제 concurrency, Supabase PG17 reset/lint/pgTAP/Storage schema/type generation은 부모가 게시할 draft PR의 CI에서 확인해야 한다.
- 독립 read-only 보안 검토에서 nullable duration/preview order CHECK, preview 교체의 잠금 승격과 잠금 순서, stale 시간 검사 및 read 권한 변경 경합, 미래 permissive bucket 정책 문제를 찾아 보완했다. lifecycle 테스트에서 nested SQL alias의 잘못된 ID 해석도 발견해 명시 alias와 최종 artist/status guard로 수정했다. 최종 검토에서 DB-only 범위의 남은 차단 사항은 발견하지 않았다.
- `npm run check:all`: lint/format/typecheck/**166 unit tests**/contrast/build 통과. 새 concurrency script의 Node syntax/ESLint/Prettier도 통과했다. UI 변경은 없고 알려진 로컬 Chromium socket 거절 경로는 재시도하지 않았다. CI 브라우저 검사는 유지했다.
- 생성 타입 `src/types/database.ts`는 **수동 편집하지 않았다**. 첫 CI는 실제 생성 artifact를 업로드한 뒤 기존 타입 drift gate에서 실패할 것으로 예상한다. 부모가 exact-head artifact 검증/후속 타입 커밋/재실행을 완료하기 전까지 전체 CI green이나 merge-ready라고 표현하지 않는다.

이 기록은 로컬 구현 완료 시점이다. push/PR/실제 CI artifact 취득/병합/원격 branch 삭제는 부모 작업에서 담당한다. 운영 정책 승인, 실파일 처리, 실제 인증·개인화·알림·전달 및 운영 배포는 아직 검증하지 않았다.

## 첫 실제 CI의 lint 실패 및 수정

- [PR #6 CI run 40055958655](https://github.com/zzz664/trot-you/actions/runs/40055958655)의 head `a02358c`는 최초 로컬 커밋 `4bb72270`과 동일한 tree `c925c8724238174dd63c3ccd40304e8a2b79c845`다. 로컬 커밋을 별도 git bundle로 보존하고 원격 head 위에서 같은 기능의 수정 커밋을 준비했다.
- 실제 Supabase start/reset은 통과했지만 DB lint가 `messaging_list_messages`의 STABLE 본문이 기본 VOLATILE 역할 guard를 호출한다고 경고하여 실패했다. **이 실행에서는 pgTAP/concurrency/type generation/artifact/type drift 검사가 모두 미실행**이며 생성 타입 artifact가 없다. quality job은 166 unit tests 및 13 E2E를 포함해 통과했다.
- `private.require_message_service`는 `current_setting('role', true)` 조회와 거절 예외만 수행하므로 정확히 STABLE로 선언했다. SQL lint를 끄거나 메시지 조회의 snapshot 의미를 변경하지 않았다. row lock/쓰기/실시간 clock을 사용하는 author/lifecycle/read-mark/reply 함수는 VOLATILE로 유지했다.
- 재발 방지로 읽기 전용 guard와 잠금/실시간 함수의 `provolatile` 분류를 검사하는 pgTAP 2개를 추가했다. 생성 타입은 여전히 수정하지 않았다. 수정 후 실제 DB lint 및 뒤따르는 모든 CI 단계는 새 exact-head 실행에서 다시 확인해야 한다.
- 수정 후 보조 PGlite 검사는 **563개(기존 362 + lifecycle 128 + security 73)**를 두 번 통과했고, `npm run check:all`도 166 unit tests를 포함해 통과했다. 독립 read-only 검토는 guard 및 조회 함수의 STABLE call graph와 잠금 함수의 VOLATILE 유지가 적절하며 권한 의미를 바꾸지 않는다고 확인했다. 이 결과는 실제 PG17 lint 재실행 성공을 대신하지 않는다.
