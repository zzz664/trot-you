# 팬 커뮤니티 DB 계약

## 범위·접근 권한

이 변경은 게시글·댓글·좋아요·신고·공지·관리자 조치·임시 이용 제한과 이미지 **메타데이터**의 DB 기반이다. 화면, HTTP API, 업로더, 실제 파일 검사, 서명 URL, 알림 전송, 포인트 적립·등급·일정은 구현하지 않는다.

- 원문 게시판 권한은 `user`이며 유료 메시지의 구독 권한과 다르다. 제한되지 않은 로그인 사용자(팬은 온보딩 완료 필수)는 **active 가수 게시판**을 읽고 쓸 수 있다. 미구독자도 가능하며 가수 소속은 게시판 전체 관리 권한이 아니다. 익명 접근은 거절한다.
- 숨김·삭제 글은 작성자와 관리자만 읽는다. 댓글은 일반 사용자에게 댓글과 부모 글이 모두 공개 상태여야 보인다. 작성자는 숨김 부모 아래의 **자기 댓글만** 읽을 수 있다. inactive 게시판은 관리자만 조회·관리할 수 있다.
- 이용 제한 중인 사용자는 커뮤니티 읽기·쓰기·이미지 등록·관리 권한을 모두 잃는다. 제한 종료 시각은 exclusive이며 종료 뒤 자동으로 정상 권한을 회복한다. 기존 금융 원장과 자기 계정 관리 접근은 삭제하지 않는다.
- 다른 사람의 profile, 전화번호, 구독, 읽음 기록은 게시판에서 조인해 노출하지 않는다. 좋아요 원본은 본인/관리자, 신고 원본은 신고자/관리자, 운영 감사 로그는 관리자만 읽는다. 게시글/댓글의 작성자 UUID는 콘텐츠 소유권 필드이지 공개 profile 조회 권한이 아니다.
- 직접 INSERT/UPDATE/DELETE는 관리자 및 `service_role`에도 허용하지 않는다. 지정된 RPC만 원자적으로 변경한다. 관리자가 일반 인증 DB 역할을 쓴다고 관리 권한을 얻는 것은 아니며 실제 profile 역할과 현재 제한을 다시 검사한다.

## 정책과 기본 차단

`private.community_policy`는 신뢰된 설정 서비스가 승인된 설정을 반영할 **단일 typed snapshot**이다. migration/seed에 운영 정책 행이나 fallback을 넣지 않았다. 정책 미설정 시 신규 게시글·댓글·수정·신고·이미지 등록은 실패한다. 기존 콘텐츠 읽기, 좋아요, 삭제와 관리자 안전 조치는 설정 장애 중에도 가능하다.

정책 필드에는 버전, 제목/본문/댓글/신고 사유 길이, 이미지 수·바이트·긴 변 크기, 자동 숨김 임계값, rate window와 글/댓글/수정·신고 횟수, 차단 문자열·정규식 목록이 있다. 테이블의 큰 상한은 SQL/저장소 안전 한계일 뿐 제품 기본값이 아니다. 빈 차단 목록을 포함해 **모든 필드를 운영자가 명시적으로 승인**해야 한다. 기존 TypeScript 설정 기본안을 자동으로 가져오지 않는다.

DB는 Unicode 문자 길이, 공백/제어문자, 대소문자 무시 literal term 및 정규식을 검사한다. 잘못된 정규식도 쓰기를 실패시킨다. 정규식 운영 검토, 과도한 복잡도 방지, 실제 콘텐츠 분류, 입력 정규화 및 승인된 설정 registry와의 연결은 후속 서비스 책임이다. 임의 사용자가 정책을 전달하거나 수정할 수 없다. 테스트 정책은 허구이고 rollback한다.

글·댓글 신규 작성과 실제 내용 수정은 공통 contribution 횟수를 소비한다. 신고는 별도 횟수를 소비한다. actor profile 잠금 아래 사용자별 window를 검사·증가시키므로 동시 요청으로 우회하지 못한다. window의 경과 시점부터 새 window를 열며 정책 window 변경은 다음 검사부터 적용한다. 동일 요청 재시도와 실제 변경 없는 수정은 횟수를 다시 쓰지 않는다. 좋아요는 멱등 set 연산이며 이 작성 rate에 포함하지 않는다.

## RPC·멱등성

모든 일반 RPC의 사용자 신원은 `auth.uid()`다. 작성자, 신고자, 관리자를 입력으로 받지 않는다.

| RPC                                                            | 계약                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `community_create_post(artist_id, request_id, title, body)`    | 작성자별 request UUID 고유. 같은 현재 내용/가수 재시도는 같은 ID, 다른 내용은 conflict.                      |
| `community_update_post(post_id, title, body)`                  | 공개·미삭제 자기 글만 수정. 공지로 승격된 글은 비관리자 소유자가 수정할 수 없다. 가수/작성자/요청 ID는 불변. |
| `community_create_comment(post_id, request_id, body)`          | 공개·미삭제 부모에만 생성. 작성자별 request UUID와 부모·현재 내용으로 멱등 처리.                             |
| `community_update_comment(comment_id, body)`                   | 공개·미삭제 부모/자기 댓글만 수정.                                                                           |
| `community_set_like(post_id, liked)`                           | toggle 대신 원하는 상태를 지정. 중복 true/false는 카운트를 바꾸지 않는다.                                    |
| `community_report(target_type, target_id, reason)`             | 대상 존재·열람·자기 신고 금지를 확인하고 신고자별 하나만 생성.                                               |
| `community_delete(target_type, target_id)`                     | 소유자 또는 관리자 soft delete. 반복 삭제는 멱등.                                                            |
| `community_moderate(target_type, target_id, decision, reason)` | 관리자만 hide/restore/delete.                                                                                |
| `community_set_notice(post_id, is_notice, is_pinned)`          | 관리자만 지정. 고정은 반드시 공지여야 한다.                                                                  |
| `community_restrict_user(user_id, restricted, until, reason)`  | 관리자만 임시 제한/해제. 자기 자신과 관리자 대상은 거절한다.                                                 |

관리자는 자기 글을 공지로 지정하거나 기존 사용자 글을 승격할 수 있다. 승격 상태에서는 비관리자 원작성자의 본문 수정과 이미지 추가를 차단한다. 원작성자의 자기 글 soft-delete 권한은 유지하며 삭제는 공지 고정 해제와 terminal 숨김을 함께 수행한다. 이를 공지의 모든 변경이 관리자 전용이라는 뜻으로 해석하면 안 된다.

생성 요청 UUID는 삭제 뒤에도 재사용할 수 없다. 콘텐츠를 수정한 뒤 원래 요청의 옛 payload로 재전송하면 현재 내용과 달라 conflict이며 수정 내용을 덮어쓰거나 새 행을 생성하지 않는다. 삭제된 글의 생성 재시도는 같은 ID만 돌려주며 복원하지 않는다. 댓글은 부모 접근 가능성을 먼저 검사하므로 부모 숨김/삭제 뒤 재시도가 거절될 수 있다.

## 신고·숨김·복구·삭제

- `(target_type, target_id, reporter_id)` 고유 제약과 대상 잠금이 **서로 다른 신고자**만 집계한다. 허위 대상/남의 비공개 대상/자기 콘텐츠는 신고할 수 없다.
- `report_count`는 평생의 distinct reporter 수다. 복구해도 지우지 않으며 동일 사용자가 다시 신고할 수 없다.
- 자동 숨김은 현재 미처리(`open`/`hidden`) 신고 수와 **그 요청에서 읽은 정책 snapshot 임계값**을 비교한다. 임계점에서 대상 숨김과 미처리 신고들의 `hidden` 전이를 함께 커밋한다.
- 기존 신고자는 자기 신고 ID를 재조회할 수 있다. 자기 신고가 대상을 숨겼더라도 안전한 재시도가 가능하지만 본문이나 추가 조회 권한은 돌려주지 않는다. 새로운 신고자는 이미 숨김/삭제된 대상을 신고할 수 없다.
- 관리자의 restore는 대상 숨김을 풀고 해당 미처리 신고만 `restored`로 해결한다. 해결자·시각을 남긴다. 과거 신고는 다시 활성화되지 않으므로 **새로운 distinct 신고자**가 새 임계값을 채워야 다시 자동 숨김된다.
- delete는 soft delete이며 terminal이다. restore로 삭제를 취소할 수 없다. 대상의 모든 신고를 `deleted`로 해결하고 원본/신고/좋아요/댓글/이미지 참조는 보존한다. 부모 글 삭제는 자식 댓글을 물리 삭제하지 않으며 일반 조회로는 부모 때문에 숨겨진다.
- 관리자 hide/restore와 소유자/관리자 delete, 공지/제한 변경은 감사 로그에 남긴다. 자동 숨김은 원인인 distinct 신고와 상태 변화로 추적한다. 알림 큐/신고자 통지는 아직 없다.
- `report_target.reply`는 API 호환을 위한 예약 값일 뿐 **현재 지원하지 않는다**. 신고/삭제/관리 RPC는 `0A000 COMMUNITY_REPLY_REPORT_UNSUPPORTED`로 명시 거절하고 테이블 CHECK도 reply 행을 막는다. 메시지 답장 신고·권한·가수 feed 차단·복구는 **후속 moderation 기능의 미완료 항목**이다.

`comment_count`는 숨김/삭제되지 않은 댓글 수다. 댓글 숨김/삭제 시 한 번 감소하고 restore 시 한 번 증가한다. 부모 자체의 숨김/삭제와는 별개로 유지되어 복구 때 틀어지지 않는다. `like_count`는 보존된 좋아요 행 수이며 부모 숨김/삭제 뒤에도 감사용으로 남는다. 직접 count 위조는 불가능하다.

## 잠금·권한 변경 경합

쓰기의 잠금 순서는 actor profile → artist → post → comment다. profile은 처음부터 UPDATE로 잠가 사용자별 rate/idempotency를 직렬화하고 artist는 SHARE, post/comment는 UPDATE다. 권한은 잠금 뒤 실제 DB 시각으로 확인한다. 댓글의 신고·삭제·좋아요·다른 댓글 작성도 같은 부모 post 잠금으로 카운트를 보호한다.

제한 변경은 actor/target profile을 UUID 정렬 순서로 잠근다. 진행 중 쓰기가 먼저 잠갔으면 그 작업 완료 후 제한이 적용되고, 제한이 먼저 커밋되면 대기 중 쓰기가 새 제한을 보고 거절한다. active→paused 변경도 artist 잠금과 직렬화한다. 독립 세션 테스트는 실제 blocking 관계를 확인한 뒤 첫 트랜잭션을 commit하므로 단순 순차 재시도와 다르다.

임시 제한은 유한한 미래 종료 시각이 필수다. 영구 제한 생성, 관리자 잠금/자기 제한, 금융 데이터 삭제 도구를 제공하지 않는다. 해제 시에는 `restricted=false, until=null`만 허용한다. 신규 콘텐츠 FK는 RESTRICT라 계정 삭제 cascade로 증거/기록을 잃지 않는다. 계정 비활성화·익명화·보존 기간 정책은 별도다.

## 이미지 메타데이터·Storage

`post_images`는 임의 JSON URL 대신 존재하는 Storage object FK, 정확한 `{artist_uuid}/{post_uuid}/{image_uuid}.{extension}`, MIME/바이트/크기, 유일한 object 연결을 보관한다. 일반 사용자와 클라이언트 관리자는 논리 ID·post ID·MIME·바이트·크기·생성 시각 열만 SELECT할 수 있고 bucket/path/object ID는 읽지 못한다.

`community_register_image(actor_id, post_id, image_id, object_id, width, height)`만 `service_role`에 허용한다. 미래 업로더는 **검증된 서버 세션에서 actor ID를 얻어야 하며 클라이언트 입력을 그대로 신뢰하면 안 된다.** DB는 현재 actor/글 소유권·활성 게시판·공개 미삭제 상태를 검사하고 잠금 아래 파일 수와 기술/정책 한도를 검증한다. 잘못된 MIME/확장자/경로/0·NULL·음수 크기/다른 object·중복 연결은 거절한다. 동일 등록은 멱등이며 기존 메타데이터를 변경하지 않는다. 공지로 승격된 글에는 비관리자 원작성자가 이미지를 추가할 수 없다.

`board-media`는 private이며 JPEG/PNG/WebP와 10 MiB 기술 상한만 허용한다. restrictive Storage RLS는 나중에 더 넓은 permissive 정책이 생겨도 익명/인증 사용자의 버킷 공개 전환·직접 읽기·업로드·변경·삭제를 차단한다. SQL은 파일 바이트를 sniff/probe하지 않는다. 실제 MIME, 치수, 리사이즈, 바이러스/유해성 검사·Storage metadata의 신뢰성은 아직 없는 업로더가 책임져야 한다.

미래 서명 서비스는 사용자가 전달한 path가 아니라 논리 image ID로 현재 글/가수/제한/숨김/삭제 및 **현재 Storage metadata 일치**를 재검증해야 한다. DB 참조 등록이 파일 읽기 권한이나 영구 유효 URL은 아니다. 이미 발급된 URL의 취소/캐시 정책은 후속 과제다. Storage object 행을 애플리케이션 SQL로 수정하지 않으며 실제 업로드/삭제는 공식 Storage API가 필요하다. 테스트 object는 rollback-only 메타데이터 fixture다.

## 검증과 후속 경계

- pgTAP: 기존 identity/billing/messaging 회귀와 새 lifecycle/security 테스트. 인증 역할로 직접 테이블 접근·RPC·RLS·정책·카운터·metadata를 검사한다.
- 독립 psql 세션: 기존 12개 경합 검사와 새 커뮤니티 중복/카운터/권한 변경 경합. CLI가 관리하는 새 disposable 로컬 DB만 허용하며 끝에 reset한다.
- CI는 실제 Supabase PG17/Auth/Storage에서 lint·pgTAP 2회·경합을 실행한다. Storage의 직접 DELETE 방지 trigger를 테스트에서 우회했다고 실제 Storage API 삭제를 검증한 것은 아니다.
- 로컬 PGlite PG18/synthetic Auth·Storage는 SQL 보조 검사일 뿐 실제 Supabase/동시 세션/HTTP/업로드/E2E 결과가 아니다.
- 타입은 CI가 실제 DB에서 생성한 artifact를 두 번째 커밋에 반영한다. 첫 커밋의 type drift는 예상되지만 artifact 반영 후 exact-head CI가 모두 통과해야 병합한다. 수동 타입을 만들지 않는다.

포인트는 작성 RPC에서 적립하지 않는다. 삭제 콘텐츠 보상 회수·일일 cap·share/mission 검증·등급 점수의 미정 정책을 다음 기능에서 별도로 정해야 한다. 이 DB 기반을 전체 커뮤니티 MVP나 사용자에게 바로 노출 가능한 완성 서비스로 표시하지 않는다.
