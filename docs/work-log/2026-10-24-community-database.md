# 2026-10-24 팬 커뮤니티 DB 기반

## 범위

- PR #6 병합 후 확인한 `develop`의 `7be56d21716a25a9a106dc8ce58e4e4a2b969e2f`에서 `feature/community-database` 하나로 분기했다. 이전 clean 로컬 커밋은 보존 태그로 남기고 완료된 로컬 기능 브랜치는 제거했다. develop/main 직접 push는 하지 않았다.
- 게시글·댓글·좋아요·distinct 신고·자동 숨김·공지·관리자 hide/restore/delete·유한 임시 제한, 안전한 이미지 metadata 및 Storage 경계만 구현했다.
- 비공개 원문 DB/API/코딩 규칙/분석의 관련 계약을 대조했다. 원문 자체는 저장소에 복사하지 않았다.
- 단일 기능을 테스트 가능한 온전한 범위로 유지했으며 이전 300줄 분할 제한은 적용하지 않았다.

## 결정

- 게시판은 로그인한 user 영역이고 유료 메시지 구독이 필수 조건이 아니다. active 가수 + 현재 제한 없음 + 팬 온보딩 완료를 DB에서도 강제한다. 가수 소속만으로 관리자가 되지 않는다.
- 일반 쓰기는 auth.uid() 고정 RPC이며 직접 DML/작성자·신고자·counter·공지 위조를 차단한다. 이미지 등록만 검증된 서버 세션 actor를 받는 service 전용 RPC다.
- typed 정책 snapshot을 명시적으로 승인·설정하기 전 신규 내용·신고·이미지 등록은 기본 차단한다. 문서/TypeScript의 잠정 기본값을 운영 설정으로 활성화하지 않았다. DB 문자열/정규식 검증 및 사용자별 contribution/report 원자적 rate를 포함한다.
- desired-state like, 작성 요청 UUID, distinct 신고 고유키와 profile→artist→post→comment 잠금을 함께 적용한다. 댓글 카운트는 공개 댓글 수, 신고 카운트는 평생 distinct 수다. 복구는 미처리 신고를 해결하며 같은 사람의 재신고는 허용하지 않는다. 삭제는 soft-delete terminal이며 금융·콘텐츠 증거를 물리 삭제하지 않는다.
- 관리자는 기존 글을 공지로 승격할 수 있지만 비관리자 원작성자는 그 상태에서 본문/이미지를 수정할 수 없다. 원작성자의 삭제 권한은 유지한다. 이 동작을 DB 계약에 명시했다.
- `reply` 신고/삭제/관리 값은 `0A000 COMMUNITY_REPLY_REPORT_UNSUPPORTED`로 거절한다. 답장 신고 권한, 가수 feed 차단·복구와 알림은 **후속 moderation 기능에서 완료할 항목**이며 전체 MVP 지원으로 표시하지 않는다.
- 포인트 적립·회수/일일 cap/share/mission/등급 정책은 별도 기능에 남겼다. 이번 작성 RPC가 포인트를 적립한다고 가장하지 않는다.

## 독립 검토

별도 검토자가 SQL과 원문 경계를 읽고 실제 보조 SQL로 다음 세 가지를 재현했다. 모두 수정 후 독립 재검증했다.

1. 미온보딩 팬이 middleware 없이 직접 DB에 접근하는 우회 → RLS/잠긴 actor 검사에 팬 온보딩 조건 추가.
2. 일반 글이 공지로 승격된 뒤 원작성자가 내용을 바꾸는 우회 → 비관리자 공지 본문/이미지 수정 차단.
3. 줄바꿈/탭만 있는 문자열을 공백이 아닌 것으로 취급 → whitespace-aware 빈 내용 검사.

수정된 5개 표적 SQL 검사가 보조 PGlite에서 통과했으며 현재 남은 blocking finding은 없다. 독립 검토는 실제 Supabase/Auth/Storage/동시 세션 검증을 대신하지 않는다.

## 검증

- `npm run check:all`: lint/Prettier, typecheck, Vitest **166개**, 대비 검사와 production build 통과. 화면/Next.js 동작 변경은 없다.
- 새 pgTAP **223개**(lifecycle 81, policy/media 74, security 68)와 기존 **564개**를 합한 **787개**가 보조 PGlite PostgreSQL 18에서 **2회 모두 통과**했다. synthetic Auth/Storage fixture는 현재 테스트가 요구하는 Storage migration 0055의 직접 DELETE statement guard를 명시적으로 포함한다.
- 실제 PostgreSQL17 Supabase CI는 전체 pgTAP를 2회 실행하고 기존 **12개** 결제/메시지 경합과 신규 커뮤니티 **12개** 독립 psql 세션 검사를 실행한다. 신규 경합은 중복 작성/댓글/좋아요/취소/신고, distinct 임계점, 숨김→삭제, 제한/가수 중지/삭제 경합, 제한 만료 fresh-clock, 마지막 rate quota 경쟁을 다룬다. 로컬 실행은 `docker context show` 단계의 `spawnSync docker ENOENT`로 DB 접근/fixture 쓰기 전 차단되었다. 여기서 실제 Supabase/다중 세션을 실행했다고 보고하지 않는다.
- Storage 테스트는 rollback-only metadata다. 업로드·이미지 실제 바이트·서명 URL·Storage HTTP 삭제를 검증하지 않았다.
- 로컬 브라우저는 알려진 sandbox 실행 거절을 재시도하지 않았다. 이번 변경에는 UI가 없으며 실제 CI browser suite **13개**는 통과했다.
- 실제 생성 타입은 수동으로 작성하지 않았다. 첫 구현 커밋의 CI는 artifact 생성 후 예상한 type-drift gate에서만 실패했다. 아래 genuine artifact를 후속 커밋에 반영했고, 이 타입 커밋의 exact-head 전체 CI를 확인한 뒤에만 병합한다.

상세 접근/상태 전이/정책/이미지 계약은 [커뮤니티 DB 문서](../database/community.md)를 참고한다. 운영 DB, 실제 계정·자산·키·외부 전송·배포는 변경하지 않았다.

## 실제 Supabase CI 및 생성 타입 반영

- PR #7 bootstrap exact head `9bdd9b00f007c1f29aaffcf78e3f9129e0af0115`, CI run `40058596107`을 독립 검증자가 확인했다. 실제 Supabase PostgreSQL **17.11.0.006**에서 reset/lint, **787 pgTAP × 2회**, **24개 독립 세션 경합**(결제 7 + 메시지 5 + 커뮤니티 12), 타입 생성/typecheck/정리가 통과했다. quality job의 **166개 단위검사·13개 E2E**도 통과했다. 실패는 기존 파일과 신규 스키마의 예상된 생성 타입 차이 gate뿐이다.
- genuine `database-types` artifact ID `12546905583`: ZIP SHA-256 `994df6ad440c75a784b6aa994683d237ce17e4b69bcc07b63535f979e129837f`. ZIP에는 `database.ts` 한 파일만 있다.
- 생성 파일은 **38,907 bytes / 1,267 lines**, SHA-256 `e824d378b976a801fb957b6db11148a9210c6324c8312bc7e0fd4c560778a121`를 검증하고 `src/types/database.ts`에 바이트 그대로 반영했다. 수동 보정은 하지 않았다.
- 게시된 구현 커밋과 로컬 구현 커밋의 tree가 `4ddc48b98473a6a5832c1165755cf20933ff086f`로 같은 것을 확인했다. 로컬 커밋을 보존 태그로 남긴 뒤 게시된 exact head로 안전하게 맞춰 타입·작업 기록만 후속 커밋으로 작성했다.
- 생성 타입 반영 후 `npm run check:all`을 다시 실행해 lint/format/typecheck, **166개 단위검사**, 대비 검사와 build가 모두 통과했음을 확인했다. 최종 타입 커밋의 실제 Supabase/브라우저 CI는 부모 작업에서 게시 후 확인해야 하며 아직 성공으로 간주하지 않는다.
