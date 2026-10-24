# 프로필 온보딩 데이터 경계

## 범위와 완료 상태

글자 크기 → 부를 이름 → 만 14세 이상 자기 확인·필수 정책 동의 단계만 구현한다. `profiles.font_selected_at`, `age_self_attested_at`, `profile_completed_at`은 해당 단계의 서버 기록이다. 나이 확인은 **자기 확인이며 신원·생년월일·외부 공급자의 연령 검증이 아니다.** 불필요한 생년월일이나 신분증은 수집하지 않는다.

`profile_completed_at`은 전체 온보딩 완료가 아니다. 이후 가수 선택·설치/알림 안내 단계가 남으므로 `onboarding_completed_at`과 `signup_complete` 이벤트는 쓰지 않는다. 이미 전체 온보딩을 끝낸 계정은 단계 쓰기 RPC를 재사용할 수 없다. 추후 프로필 수정 기능은 별도 권한 경계를 정한다. 기존 본인 `font_scale` 직접 수정 권한은 안전한 환경설정 범위로 유지하지만 `font_selected_at`은 기록하지 못하므로 단계 통과를 위조하지 못한다.

## 승인된 정책만 제공

- `private.onboarding_documents`: `terms`, `privacy`, `analytics`별 UUID 버전, 제목·비어 있지 않은 본문, 승인/공개 시각. 승인된 버전의 수정·삭제는 금지한다. 개정은 새 UUID의 새 문서다. 초안·미공개·미래 공개 문서는 안전한 공개 view에 나타나지 않는다.
- `public.onboarding_policy_documents`: 승인·공개가 완료된 문서의 고정 열만 읽는 owner-rights projection. 계정·동의 이력·초안은 공개하지 않는다. 본문은 실행 가능한 HTML이 아니라 표시할 텍스트다.
- `private.profile_onboarding_policy`: 승인된 이름 정책 UUID/시각, 문서 기본 범위 안에서 설정하는 2–10자 길이, 비어 있지 않은 욕설 목록, 현재 정책 버전 참조. 이름 정책이나 필수 공개 정책이 없으면 `ONBOARDING_SETUP_NOT_READY`로 실패한다. 빈 욕설 목록이나 문서 placeholder를 정상 운영 정책으로 대체하지 않는다.
- `private.profile_policy_acceptances`: `(사용자, 종류, 버전)`별 최초 명시적 수락 시각. 원시 테이블은 일반 authenticated/admin/service에 SELECT/DML 권한이 없다.

마이그레이션·seed는 어떠한 정책/법률 문구도 등록하거나 승인하지 않는다. 실제 공개 본문·법적 주체·지원 정보 및 검토된 욕설 목록을 별도 승인한 뒤 운영자가 설정해야 한다. 승인/활성화용 HTTP/RPC는 이 기능에 포함하지 않는다. 테스트의 영어 정책 문구와 욕설 목록은 가상의 격리 CI fixture이며 실제 서비스 문구가 아니다.

## RPC와 권한

모든 변경은 검증된 세션의 `auth.uid()`에만 묶이며 사용자 ID·role·승인/완료 시각을 인자로 받지 않는다. profile 행 잠금으로 같은 사용자의 동시 완료/반복 전송을 직렬화하고 현재 정책을 공유 잠금으로 읽는다. 제한된 계정, 미인증 계정, 전체 온보딩 완료 계정은 단계 쓰기를 할 수 없다. 사용자 metadata는 어떤 승인 증거도 아니다.

| RPC                                                                                                                                                           | 동작                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `onboarding_get_state()`                                                                                                                                      | 본인 글자/이름/진행 상태, 설정 준비 여부, 현재 승인·공개된 정책 본문만 읽는다.                               |
| `onboarding_save_font(font_scale)`                                                                                                                            | enum 검증 후 선호도와 최초 선택 시각을 저장한다.                                                             |
| `onboarding_save_name(call_name)`                                                                                                                             | 글자 단계 확인, NFC·앞뒤 공백 정리, 설정된 코드 포인트 길이·제어/숨은 문자·욕설 검증 후 이름을 저장한다.     |
| `onboarding_complete_profile(age_over_14, terms_accepted, terms_version, privacy_accepted, privacy_version, analytics_granted=false, analytics_version=null)` | 최신 이름 재검증, 독립적인 명시적 true 선택, 현재 필수 버전 일치, 선택 분석 동의를 한 트랜잭션으로 처리한다. |

필수 동의/나이/선택 동의 중 하나라도 실패하면 모든 쓰기가 rollback된다. 같은 제출은 수락 행을 복제하지 않고 최초 나이/단계 완료 시각을 유지한다. 새 필수 정책이 활성화되면 getter는 기존 완료 시각을 숨기고 동의 단계 재개를 요구한다. 저장된 원래 시각과 이전 버전 수락 이력은 보존한다. 오래 열린 페이지가 과거 버전을 보내면 `ONBOARDING_POLICY_CHANGED`로 실패하고 새 본문을 읽게 한다.

선택 분석은 필수 동의와 별개이며 기본 false다. 정확히 같은 UUID의 승인·공개 analytics 본문과 활성 `analytics_policy`가 있어야 true를 받을 수 있다. 기존 `analytics_set_consent`를 직접 호출해도 같은 본문 검사를 거치므로 UI 우회가 없다. false는 기존 분석 동의를 철회하며 제한 계정/정책 부재에서도 독립 철회 RPC를 쓸 수 있다. 프로필 단계는 이벤트 수집을 시작하지 않는다.

## 검증과 한계

`supabase/tests/profile_onboarding.test.sql`은 실제 로컬 Supabase CI에서 metadata 위조·ACL/RLS·누락/초안/빈 문서·불변 버전·NFC/이름 경계·직접 RPC·반복 요청·정책 교체·계정 제한·원자성·연쇄 삭제를 검증한다. 기존 분석 SQL/동시성 fixture에도 가상의 승인 공개 문서를 추가하여 회귀를 보존한다. pgTAP fixture는 rollback하고 동시성/브라우저 fixture는 격리된 로컬 CI DB 수명 안에서만 사용한다.

`src/types/database.ts`는 실제 Supabase 생성 artifact로 갱신해야 한다. 손으로 새 테이블/RPC 타입을 작성하지 않는다. 현재 작업 환경에서는 Docker 기반 DB 실행과 로컬 브라우저가 허용되지 않으므로 실제 DB lint·pgTAP·타입 생성·브라우저 검증은 CI 결과로만 판정한다.
