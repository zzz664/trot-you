# 2026-10-24 — 사용자·가수 DB 기반

## 범위

- 고정된 Supabase CLI 2.122.0, 로컬 Postgres 17 설정과 migration/reset/lint/test/typegen 명령.
- `profiles`, `artists`, `artist_members`, 네 가지 enum, FK/제약/인덱스, auth 삽입 트리거, DB 관리 timestamp.
- 명시적 grant와 RLS, private 역할·소속 helper, 제한된 admin 역할 변경 RPC, 모든 writer에 공통 적용되는 역할 회수 시 소속 제거.
- 공개 가수용 안전한 `artist_catalog` projection; raw 계약 정보와 팬 개인정보 비공개.
- 실제 pgTAP SQL 140개 검사, 별도 CI DB job, 가상 가수 두 명만 있는 seed. 사용자·관리자·초대 없음.
- 인증/온보딩 UI·서비스, app_settings 영속화, 알림, billing, 메시지 테이블은 범위 밖입니다.

## 근거와 결정

비공개 DB §2/§3.2/§3.3/§4, 아키텍처 §2.2/§4/§5, API §2.4/§3.1/§3.2, 코딩 규칙과 사전 보안 분석을 참고했습니다. 원본 문서는 공개하지 않았습니다.

- 원본의 broad active-row 읽기 대신, 계약·등급·소속 ID를 제외한 owner-rights/security-barrier view만 공개합니다. 의도된 제한적 RLS 우회이므로 projection 확장은 별도 보안 검토가 필요합니다.
- 회원 metadata는 `role`, restriction, onboarding, channel verification에 사용하지 않습니다. 닉네임·연령·성별 문자열도 신뢰되지 않는 표시 정보이며 연령/동의 증거가 아닙니다.
- authenticated 직접 수정은 본인 `font_scale`만 허용합니다. `call_name`은 나중의 운영 설정 길이/욕설 검사를 우회하지 못하도록 server-only입니다. SQL의 구조적 제약을 비즈니스 검증 완료로 표현하지 않습니다.
- admin bootstrap은 별도 승인된 서버/운영자 작업입니다. 실제 계정은 만들지 않았습니다. 서비스 키는 RLS 우회 권한이 있으므로 후속 서비스가 actor 검증을 담당해야 합니다.
- 운영 migration 적용은 별도 승인 후 수동 수행하며 **실행하지 않았습니다**. 로컬 reset/seed를 운영 환경에서 실행하면 안 됩니다.

## 검증

- `npm run check:all`: ESLint/Prettier, strict typecheck, 단위 테스트 166개(10개 파일), 대비 10쌍, Next.js production build 통과.
- 로컬 Docker/psql/postgres가 없어 전체 Supabase는 실행하지 않았습니다. 로컬 브라우저는 앞선 socket 거절을 우회하거나 재시도하지 않았습니다. 기존 UI 13개 회귀 suite는 CI gate를 유지합니다.
- 보조 실행: 임시 디렉터리의 PGlite 0.5.11(PostgreSQL 18.6 WASM) + pgTAP 0.0.12에서 최소 `auth.users`/`auth.uid`/role fixture를 명시적으로 만든 뒤, 빈 DB에 실제 migration/seed SQL을 적용했습니다. 동일한 140개 pgTAP 검사를 두 번 실행해 모두 통과하고 rollback 재실행도 확인했습니다. SQL 문자열 비교가 아닌 DB 실행입니다. Supabase Auth/PostgREST 및 Postgres 17 검증과는 **구별**합니다. 이 임시 smoke 의존성은 저장소에 추가하지 않았습니다.
- pgTAP 범위: anon/팬 둘/가수 둘/admin/미인증 subject/server, 자기 역할 상승·UPSERT·타인 행 수정 방어, 팬 PII 차단, 소속/관리자 권한, metadata 조작, restricted/expired 상태, 직접 부를 이름/온보딩/전화/역할 수정 차단, FK/고유/날짜/이름 제약, timestamp, cascade, 역할 회수·재승격.
- 독립 read-only 보안 리뷰에서 직접 call_name 쓰기 우회와 서버 역할 회수 시 소속 잔류를 발견해 수정했습니다. 수정 후 독립 리뷰에서 남은 보안 차단 이슈가 없음을 확인했습니다. 리뷰어가 보조 PG18.6 suite 139개를 두 번 독립 재실행해 통과했고, 이후 구현자가 실제 binding이 존재하는 cascade 사전조건 1개를 추가해 최종 140개를 두 번 통과했습니다. 전체 Supabase CI 결과는 아래 병합 gate를 통해 확인합니다.

## 병합 전 남은 gate

1. CI에서 공식 Supabase 로컬 스택을 시작하고 빈 DB reset → lint → pgTAP 두 번을 실행합니다. 구성만 추가한 상태를 실행 성공으로 보지 않습니다.
2. 같은 실제 스키마에서 공식 CLI가 생성한 `database-types` artifact를 받아 `src/types/database.ts`로 검토·커밋합니다. 손으로 생성된 것처럼 작성하지 않습니다. 첫 CI는 artifact 업로드 후 미커밋 타입 gate에서 의도적으로 실패하며, 이후 CI는 누락/드리프트를 차단합니다.
3. 최종 commit의 DB/quality/기존 브라우저 CI, 독립 리뷰를 확인한 뒤에만 병합합니다. PR 발행·병합·원격 branch 삭제는 부모 작업이 담당합니다.

외부 프로젝트·키·실제 계정·운영 데이터·배포를 생성/변경하지 않았습니다. OAuth, REST/JWT 경계, staging 연결, 운영 backup/restore 및 운영 적용은 아직 검증하지 않았습니다. 전체 설정과 권한 계약은 [DB 안내](../database/identity-artists.md)를 따릅니다.
