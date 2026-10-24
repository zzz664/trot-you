# 메시지·답장·읽음·미디어 DB 계약

## 범위와 신뢰 경계

이 기능은 PostgreSQL/Supabase Storage의 **데이터 기반**이다. 메시지 화면, API/인증 어댑터, 이름 치환, 업로드, 파일 검사, 서명 URL, 예약 실행 Cron, 알림 outbox/전송기는 구현하지 않는다. `messaging_dispatch`는 잠긴 메시지 한 건의 DB 상태 전이일 뿐 실제 발송 시스템이 아니다.

- 팬에게 `messages`/`message_media` 원본 행을 노출하지 않는다. 직접 PostgREST와 동일한 DB 역할의 SELECT도 0행이다. 가수는 현재 소속 가수의 원본 작성 자료, 관리자는 전체 작성 자료를 읽을 수 있다.
- 모든 메시지·미디어·답장 변경은 지정한 `service_role` RPC를 통한다. 인증된 관리자도 직접 INSERT/UPDATE/DELETE로 발송·예약·취소·맛보기를 우회할 수 없다. 서비스 역할에도 해당 테이블의 직접 변경 권한이 없다.
- RPC의 `p_actor_id`는 미래 서버 서비스가 검증된 세션에서 얻어야 한다. 브라우저가 보내는 사용자 ID를 그대로 전달하면 안 된다. RPC는 실제 profile 역할·제한·가수 소속을 다시 확인한다.
- 팬 조회 RPC 역시 서비스 전용이다. 반환되는 `body_template`은 서버 이름 치환의 입력이지 브라우저 DTO가 아니다. 개인화는 미래 공통 메시지 렌더링 서비스 한 곳에서 수행해야 한다. 원문, 작성자 ID, Storage 경로를 클라이언트에 그대로 전달하지 않는다.
- 기존 `has_active_access(artist_id)`의 호출자 전용 계약과 유료/해지/유예 경계를 유지한다. 내부 공통 판정 함수에는 EXECUTE를 주지 않아 임의 사용자의 구독 조회 통로를 만들지 않는다.

## 정책은 설정 전까지 차단

`private.message_policy`는 서버 전용 단일 정책 snapshot이다. **seed나 누락 시 fallback이 없다.** 정책이 없으면 작성·조회·읽음·답장이 실패한다. 테스트는 transaction-local 허구 정책만 사용한다.

필드: 정책 버전, 현재 episode 이전 이력 허용 초, 발송 후 취소 허용 초, 글/답장 길이, 사진 수, 음성/영상 길이, 맛보기 수, 종류별 바이트 한도. SQL에는 음수·overflow·무제한 값을 방지할 기술 상한만 둔다. 문서의 잠정 기본값이 승인된 약관이나 실제 운영 설정이라는 뜻이 아니다.

후속 설정 서비스는 승인된 설정을 이 DB 정책에 일관되게 반영해야 한다. 이 snapshot을 기존 TypeScript 설정 초안과 별개로 임의 운영하거나, 클라이언트가 요청마다 이력 범위/취소 시간을 지정하게 하면 안 된다. 운영 설정 승인/관리 UI는 이 기능에서 만들지 않았다.

## 생명주기와 잠금

| 단계      | 계약                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 저장      | 현재 소속 가수/관리자만 draft 작성·수정. 생성 시 작성자와 가수는 고정한다. 같은 가수 소속 구성원은 공동 초안을 수정할 수 있다. 미디어가 있으면 종류를 변경할 수 없다.                 |
| 예약      | active 가수의 draft만 가능. 정책과 연결 미디어를 재검증한다. 과거 요청 시각은 DB의 현재 시각으로 올려 즉시 발송 대기 상태로 만든다. 유한 시각만 허용한다.                             |
| 발송 전이 | 서비스만 실행. 현재 active 가수, 원작성자의 유효한 역할/소속, `scheduled` 및 도래 시각을 재확인한다. 잠금 후 DB 시각을 `sent_at`으로 기록한다. 이미 처리되었거나 아직 이르면 false다. |
| 취소      | draft/scheduled는 소속 가수/관리자가 취소 가능. sent는 정책의 exclusive 종료 경계 전까지만 가능하다. 이미 canceled인 호출은 멱등이며 맛보기 지정도 해제한다.                          |
| 맛보기    | 제한되지 않은 관리자만 active 가수의 sent 메시지를 지정한다. 중복/다른 가수/미발송 ID를 거절하고 가수별 전체 선택을 원자적으로 교체한다.                                              |

가수 변경 경로는 profile → artist → membership → message 순으로 잠근다. 가수 row는 처음부터 UPDATE 잠금을 사용해 동시 맛보기 교체 시 SHARE→UPDATE 승격 교착을 피한다. 가수 삭제의 membership cascade와도 순서를 맞춘다. 읽음/답장은 profile → artist → subscription → message(읽음만) 순이다. 제한 변경, 가수 일시중지, 해지, 취소와 경합할 때 잠금 후 권한을 재확인한다.

새 조회는 요청 statement 시각, 읽음/답장 같은 변경은 잠금 후 실제 시각을 사용한다. 기존 구독 조회 함수의 transaction-time 의미는 바꾸지 않았다. 원작성자 소속이 제거되면 그 작성자의 예약 메시지는 발송되지 않는다. 재배정/원작성자 이전 도구는 아직 없다.

## 팬 열람과 답장

서비스용 `messaging_list_messages`는 다음 조건을 모두 적용한다.

1. 실제 팬 역할, 완료된 온보딩, 현재 이용 제한 없음.
2. 현재 active 가수, `sent`, 실제 `sent_at` 도래.
3. 일반 대화 목록은 관련 구독의 유료 active/canceled 기간 또는 명시적인 grace 기간 안이어야 한다. 기간 종료 경계는 exclusive다.
4. 이력은 `episode_started_at - history_before_seconds`부터 inclusive다. 재구독 때 현재 episode가 이동하므로 과거 가입 이력 전체를 재노출하지 않는다. episode가 없으면 일반 메시지는 보이지 않는다.
5. 맛보기 요청은 구독 대신 현재 지정된 맛보기 조건을 적용한다. 초안·예약·취소·중지 가수·제한 사용자는 맛보기로도 우회하지 못한다.

일반 목록은 `(sent_at, id)` 내림차순 keyset cursor이며 두 cursor 값이 함께 있어야 한다. 페이지 범위는 1–100이다. 맛보기는 `preview_order` 순, 현재 정책 상한 이내의 작은 전체 목록이며 cursor를 받지 않는다. 정책 상한을 낮추면 기존 선택이 많아도 반환 수가 즉시 제한된다.

미디어 DTO에는 논리 ID, 종류, 화면 크기, 재생 시간만 들어간다. bucket/path/object ID와 작성자 ID는 없다. 이것이 미디어 바이트 접근권을 부여하지는 않는다.

답장은 서비스 RPC만 생성하며 팬 역할·온보딩·제한·active 가수·관련 구독을 확인하고 구독 ID를 연결한다. 공백/길이는 DB도 검사한다. **금칙어/욕설·개인정보 필터와 빈도 제한은 후속 서비스의 필수 책임**이며 아직 구현하지 않았다. 따라서 이 RPC를 직접 사용자 endpoint로 공개할 수 없다.

가수는 답장 원본 테이블을 읽을 수 없다. 서버 전용 feed는 자신의 가수에 한해 `id`, `call_name`, `body`, `created_at`만 반환하고 차단 답장을 제외한다. 팬 profile ID/닉네임/전화/구독 ID를 반환하지 않는다. 팬은 자기 답장과 읽음 기록만 직접 읽을 수 있다. 구독 만료 후에도 자기 이력은 유지되지만 현재 제한 중이거나 팬 역할이 아니면 직접 조회가 차단된다. 관리자 moderation 도구는 별도다.

## 읽음 기록

`mark_message_read(message_id)`만 authenticated 역할에 허용한다. 사용자 ID를 입력받지 않고 `auth.uid()`를 사용한다. 현재 관련 구독과 이력 조건을 통과하는 sent 메시지만 가능하며 맛보기만 보는 비구독자는 읽음 증거를 만들 수 없다.

- `(user_id, message_id)` PK와 실제 FK로 중복/유령 기록을 막는다.
- 재호출은 최초 `read_at`을 돌려주며 덮어쓰지 않는다.
- 취소와 동일 메시지 잠금으로 직렬화한다. 취소 후 신규/반복 mark는 거부한다.
- 이미 저장된 읽음 기록은 메시지 취소 뒤에도 보존한다. 이것을 곧바로 승인된 환불 자격 판정이나 물리적 읽기 증명으로 간주하지 않는다.
- 가수에게 팬 ID가 있는 원본 읽음 행을 노출하지 않는다.

## Storage 및 미디어

`message-media` 하나만 private으로 만든다. `board-media`/avatars는 이 기능에 포함하지 않는다. Storage bucket에는 100 MiB 기술 상한과 명시적인 JPEG/PNG/WebP, MPEG/MP4/WebM 음성, MP4/WebM 영상 MIME allowlist를 둔다. 세부 종류별 정책은 DB snapshot이 더 낮게 제한할 수 있다.

익명/인증 사용자에 대해 bucket과 object의 restrictive RLS를 둔다. 나중에 다른 버킷용 permissive 정책이 넓게 추가되어도 이 버킷의 조회/쓰기/삭제/공개 전환은 허용되지 않는다. 가수·관리자도 일반 인증 역할로 파일을 직접 올리거나 서명할 수 없다. 서비스 키는 RLS를 우회하는 강한 권한이므로 서버 밖에 두면 안 된다.

미디어 등록 RPC는 이미 존재하는 Storage object를 읽고 다음을 확인한다.

- 현재 작성 권한과 실제 draft 메시지, 메시지 종류, 정책상 파일 수.
- 고정 bucket 및 정확한 `{artist_uuid}/{message_uuid}/{media_uuid}.{extension}` 경로. 원문 문서의 연/월 경로 대신 실제 resource 결합을 강화했다.
- 실제 Storage metadata의 MIME/size 및 일치하는 확장자. 사진 10 MiB/음성 20 MiB/영상 100 MiB 기술 상한과 현재 정책을 적용한다.
- 사진/영상의 양수 크기, 음성/영상의 **NULL이 아닌** 양수 재생 시간. 서버가 검증한 값을 받는다.
- 실제 message/object FK 및 유일한 object 연결. 예약 후 연결 metadata는 변경할 수 없다.
- 예약 및 발송 시 object 경로/MIME/size를 다시 비교한다.

SQL은 Storage metadata와 전달된 검사 결과를 확인할 뿐 **실제 파일 바이트나 미디어 재생 시간을 검사하지 못한다**. 미래 업로더가 파일 sniffing, 실제 크기/차원/길이 probe, 콘텐츠 검증을 마친 뒤에만 이 RPC를 호출해야 한다. 서비스 업로드의 `owner_id`는 비어 있을 수 있으므로 이를 사용자 소유권 증거로 신뢰하지 않는다. 소유권은 검증된 actor와 가수/메시지의 정확한 경로로 판정한다.

업로드·이동·삭제 등 실제 Storage 작업은 [공식 Storage API](https://supabase.com/docs/guides/storage/schema/design)를 사용해야 한다. 앱 RPC는 `storage.objects`를 변경하지 않는다. 테스트의 object 행은 rollback-only metadata fixture이며 업로드/실제 자산 검증이 아니다. FK 때문에 연결된 object를 삭제하려면 별도의 권한 있는 정리 정책/절차가 먼저 필요하다. cleanup/uploader는 아직 없다.

서명 URL 함수는 의도적으로 없다. 후속 서명 서비스는 임의 path 입력 대신 논리 media ID로 메시지·가수·상태·구독/맛보기·이력·현재 object 연결을 검증해야 한다. 기존에 발급된 URL은 만료까지 유효할 수 있어 메시지 취소가 URL을 소급 철회한다고 약속할 수 없다. TTL/캐시/취소 UX를 명시적으로 정해야 하며 문서의 한 시간 기본안을 그대로 사용하지 않는다. [Storage 권한 모델](https://supabase.com/docs/guides/storage/security/access-control), [owner 의미](https://supabase.com/docs/guides/storage/security/ownership)를 따른다.

## 검증 경계

- 실제 pgTAP 파일은 공식 Supabase PG17 CI에서 실행한다. role/JWT claim을 설정한 직접 table SELECT/INSERT/UPDATE/DELETE와 RPC를 모두 검사한다.
- Storage 테스트는 실제 schema/RLS에 fictional metadata를 넣고 모두 rollback한다. 더 넓은 permissive 정책을 임시 추가해도 restrictive guard가 유지되는지 확인한다.
- 기존 billing/identity pgTAP와 7개 결제 동시성 회귀 검사는 유지한다. 메시지 경합은 별도 독립 psql 세션 검사다.
- 로컬 PGlite는 synthetic Auth/Storage schema를 쓰는 보조 SQL 검사일 뿐 Supabase PG17, JWT 검증, PostgREST HTTP, 실제 blob, 업로드/서명 URL, E2E 전달의 증거가 아니다.
- 실제 DB에서 생성한 TypeScript 타입은 CI artifact로만 반영한다. 첫 게시 시 drift gate 실패를 허용해 artifact를 얻고, 후속 타입 커밋의 exact-head CI를 다시 통과해야 한다. 수동 타입을 작성하지 않는다.
