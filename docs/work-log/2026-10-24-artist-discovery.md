# 2026-10-24 가수 탐색·맛보기·관심 선택

## 범위와 결정

- develop `737d5e85aafc39f4689898efa5e07a5260115768`에서 `feature/artist-discovery-preview` 하나로 작업한다. 기존 로컬 profile 작업은 archive tag로 보존하고 종료된 feature ref를 제거했다. main/develop에 직접 변경을 게시하지 않는다.
- 공개 active 가수 목록, 서버에서만 이름을 치환하는 승인된 맛보기, 한 명의 관심 선호 저장과 재개를 연결한다. 관심은 유료 구독/결제/유료 접근권이 아니다.
- 프로필·현재 이름 정책·현재 승인된 필수 동의·역할·제한 상태를 DB에서도 확인한다. 원문 맛보기는 서비스 전용 RPC로 유지하고 actor는 서버가 검증한 세션에서만 가져온다.
- 선택은 설치 대기 단계로만 이어지며 full onboarding을 완료하지 않는다. 승인 근거 없는 건너뛰기는 제공하지 않는다. 미디어는 종류별 준비 중 표시이며 서명/재생이 구현되었다고 주장하지 않는다.

## Migration 선행 체크포인트

- migration 00011: private 관심 선호, 본인 상태/선택 RPC, 서버 전용 안전한 맛보기 입력 projection. 운영 정책·실제 콘텐츠를 seed하지 않는다.
- 새 pgTAP 86개. 기존 1,887개를 유지하여 총 1,973개. 로컬 PGlite 보조 검사에서 21개 SQL suite를 2회 실행했고 각 1,973개 assertion이 통과했다. 이는 실제 Supabase/PostgreSQL 17 결과가 아니다.
- 새 5개 독립 세션 경합 시나리오를 CI에 연결한다. 기존 97개 경합 검사를 유지한다. script syntax/ESLint/Prettier는 로컬 통과했고 실제 DB 경합은 아직 실행 전이다.
- 실제 Supabase DB lint, 전체 pgTAP, 독립 세션 경합, 생성 타입 drift는 CI에서 검증한다. migration-only commit으로 실제 타입 artifact를 먼저 얻고 해당 출력만 별도 반영한다. `src/types/database.ts` 수기 수정은 하지 않는다.
- 앱/UI 작업은 이 체크포인트에 섞지 않는다. 최종 앱 검사·CI·3단계 글자 크기 화면 검토 결과는 별도 완료 기록으로 추가한다. 이 단계만으로 통합 기능 완료 또는 배포 가능 상태를 주장하지 않는다.

## 앱 연결과 로컬 검증

- DB 독립 리뷰의 선택적 회귀 공백을 닫기 위해 마지막으로 비어 있지 않은 맛보기와 실제 메시지 취소/관리자 맛보기 교체의 경합 2개를 추가했다. 최종 discovery 경합은 7개, 기존 97개와 합쳐 총 104개다. migration/pgTAP/schema는 선행 체크포인트와 동일하며 추가 경합의 실제 실행은 최종 CI에서 확인한다.

- 공개 목록과 개인정보 없는 DTO, 서버 전용 DB 어댑터/공통 이름 치환, 세션·Origin·본문 한도와 DB 재검증을 가진 관심 저장 API, 목록/맛보기/선택/설치 대기 RSC·클라이언트 화면을 연결했다.
- 프로필 단계를 마친 팬만 맛보기/선택에 진입한다. `/onboarding`은 active 관심을 다시 읽어 설치 대기로 재개한다. 비활성 관심 또는 현재 정책 무효는 이전 필수 단계로 돌아가며 접근을 임의 허용하지 않는다.
- 독립 앱 리뷰에서 현재 이름 정책이 예전 이름을 거절할 때 재개가 동의 단계로 향하는 복구 문제를 발견했다. 저장된 이름을 지우지 않고 명시적 이름 재검증 상태로 이름 화면부터 재개하도록 고쳤고 단위/실제 CI E2E 회귀를 추가했다.
- 페이지 번호만 바뀌는 브라우저 Back에서 전역 확인창이 남을 수 있는 문제를 리뷰 중 발견했다. 확인창 소유 화면이 unmount될 때 고유 키로 취소하도록 수정하고 같은 pathname의 페이지 변경 회귀를 단위/E2E에 추가했다.
- 로컬 `npm run lint`, 전체 단위 검사 **678개/32파일**, 10개 팔레트 대비 검사가 통과했다. `typecheck`는 실제 신규 RPC 생성 타입이 아직 없어 실패하는 상태이며, 수기 대체 타입은 추가하지 않았다. 이 시점의 build/`check:all` 전체 통과를 주장하지 않는다.
- authenticated E2E는 기존 29개를 유지하고 새 18개를 추가하여 총 47개다. 실제 local Supabase/Auth 기반으로 3단계 글자 크기 × 2폭의 목록/맛보기/확인창/설치 대기 및 빈 상태/저장 중 화면 27장을 생성하도록 한다. 세션·DB fixtures는 허구이고 외부 HTTP 요청은 차단한다. 원문/키/사설 경로가 문서·RSC·JS에 나오지 않는지 검사한다.
- 로컬 브라우저는 기존 권한 제한 때문에 실행/재시도하지 않았다. 기본 E2E 16개, authenticated 47개 및 시각 검토는 CI에서 아직 확인해야 한다. 실제 Kakao/운영 데이터/외부 이미지/실제 결제·구독/설치/알림은 실행하지 않았다.

## 실제 생성 타입과 앱 검증 체크포인트

- migration-only remote `83c5390f18dbaab3b77dae32f023517bce195ec8` (local `2b0349e`와 tree 동일)의 CI run `40076533144`: 실제 Supabase DB lint, pgTAP **1,973개 ×2**, 당시 경합 **102개**, 타입 생성 뒤 typecheck 통과. 예상된 미커밋 타입 drift gate만 실패했다. 이 bootstrap의 quality는 기존 단위 464개/기본 브라우저 16개, authenticated 29개를 통과했고 새 앱 코드는 아직 포함하지 않았다.
- artifact `12553508011`의 실제 `database.ts`를 변경 없이 반영했다. 파일 SHA-256: `d254a02ac8ef6e55c2e7f558cd9dd8afed28bf81de0eb2bb7367dd2a5e9b3c9f`. 차이는 신규 discovery RPC 3개 선언뿐이며 수기 타입이 아니다. 동일 tree를 검증하고 로컬 checkpoint를 archive tag에 보존한 뒤 안전하게 원격 ancestry와 맞췄다.
- 타입 반영 후 **`npm run check:all` 전체 통과**: ESLint/Prettier, Next route typegen/TypeScript, 단위 **678개/32파일**, 대비 10개, 키 없는 production build. 새 페이지와 API가 빌드 목록에 포함된다.
- 독립 DB/앱 리뷰에서 남은 구체적 차단 사항은 없으며, 지적된 이름 재검증 복구와 same-path Back 확인창 문제는 수정/회귀 추가했다. 마지막 script-only 2개 경합 추가도 독립 검토를 마쳤다.
- 최종 앱 exact-head의 실제 **104개 경합 / 기본 E2E 16개 / authenticated E2E 47개 / 27개 신규 스크린샷 시각 검토**는 아직 CI에서 확인해야 한다. 로컬 브라우저는 실행하지 않았다. 이 커밋만으로 최종 CI·운영 배포 완료를 주장하지 않는다.

## 실제 인증 CI fixture 정리 오류 수정

- 앱 exact-head `e28a6ddde820700e10f20c84f7da1943ba0160ba`의 CI run `40077216191`에서 첫 discovery 시나리오는 화면/저장 검사를 마치고 정리 단계에 도달했지만, fixture의 직접 `storage.objects` DELETE가 실제 `storage.protect_delete()`에 의해 거절되었다. transaction rollback 뒤 사용자 정리 500 및 다음 17개 discovery fixture 중복 오류가 연쇄 발생했다. 기존 authenticated 29개는 통과했다. 이를 전체 앱 E2E 통과로 기록하지 않는다.
- [공식 Storage 문서](https://supabase.com/docs/guides/storage/schema/design)의 API 전용 변경 규칙에 맞춰 정리를 수정했다. 격리된 GitHub CI·고정 loopback·local Docker 검증 뒤 앱 FK/메시지/가수 정리를 먼저 커밋하고, 기존 폐기용 fixture 키로 Storage API `remove()`에 정확한 세 fixture 경로만 보낸다. 이후 Storage metadata가 0행인지 읽기 전용 SQL로 확인한다. API 실패는 일반 오류로 처리하며 원문 응답/키/헤더를 출력하지 않는다.
- 정리 hook은 async 완료를 기다리고, 실패하더라도 finally에서 허구 정책을 제거한다. Storage 보호 트리거·권한·production 설정을 끄거나 우회하지 않으며, 새 키·실제 미디어 업로드·스키마 변경을 추가하지 않았다. fixture는 여전히 허구 metadata이며 미디어 바이트/서명 기능 검증이 아니다.
- 새 정리 단위 테스트 9개가 통과했다. 순서/FK 분리/정확한 Storage 경로/환경 거절/오류 비노출/잔여행 검증/비우회/async hook을 확인한다. 실제 local Storage API 정리와 전체 47개 authenticated E2E 재실행은 다음 exact-head CI에서 확인해야 한다. 로컬 브라우저는 실행하지 않았다.
- 같은 run의 database는 실제 pgTAP **1,973개 ×2**, **104개 경합**(discovery 7개 포함), 생성 타입 drift 검사를 모두 통과했고 quality는 단위 678개/기본 E2E 16개를 통과했다. 첫 normal/360 discovery 화면 4장은 생성되었지만 나머지 신규 화면 및 실제 키 비노출 E2E는 정리 오류 연쇄로 확인하지 못했다.
- 정리 수정 후 로컬 **`npm run check:all` 전체 통과**: 단위 **687개/33파일**, 타입·린트·대비·빌드. bounded 독립 리뷰에서도 구체적 차단 사항이 없었다. 실제 Storage 정리 수용 여부와 최종 authenticated 전체 성공은 아직 CI 재실행 대기다.

## 실제 RSC 바이트 관측 수명 오류 수정

- 후속 CI run `40077826372`, head `50ee34767fe48469ac05bac417d61747e5ae9990`에서 실제 Storage API 정리가 정상 동작하고 authenticated **46/47개**가 통과했다. 남은 한 건은 비밀키 비노출 검사의 `previewResponse.text()`가 페이지 이동 후 Chromium의 폐기된 응답 핸들을 읽어 실패한 관측 수명 문제였다. 정보 유출 assertion 실패나 제품 동작 실패로 해석하지 않는다.
- 테스트의 **브라우저가 실제 시작한** 고정 loopback preview/RSC 요청을 관측한다. `route.fetch()`로 실제 서버 응답을 받고, 라우터에 전달하기 전에 body를 읽은 뒤 `route.fulfill({ response })`로 **그 응답을 변경 없이** 브라우저에 전달한다. 가짜 본문·헤더·쿠키로 대체하지 않으며 redirect/retry를 허용하지 않는다. 응답이 200·비어 있지 않은 `text/x-component`인지와 실제 개인화 UI가 렌더되는지도 확인한다.
- 실제 local 서비스 키·사설 경로·계약 정보·원문 필드·actor ID·미치환 토큰이 HTML/RSC/브라우저 JS에 없는지 확인하는 기존 assertion은 삭제하거나 약화하지 않았다. 본문/키는 파일·로그에 출력하지 않고 boolean 결과만 assertion에 사용한다. 스키마/제품 코드/미디어 권한은 변경하지 않았다.
- 수정한 관측 경로와 최종 47/47 실행 통과는 새 exact-head CI에서 확인해야 한다. 로컬 브라우저 실행이나 미실행 검사 통과 주장은 하지 않는다.
- 독립 리뷰에서 관측 결과의 완료 신호가 fulfill보다 앞서지 않도록 보완했다. 실제 응답 전달이 성공한 뒤 capture를 공개하고, UI 렌더 확인 뒤에도 handler 실패 여부를 다시 검사한다. 리뷰는 이 순서와 실제 서버 응답 provenance/검사 강도가 유지됨을 확인했다.
- 최종 수정 상태의 로컬 `npm run check:all`은 다시 전체 통과했다(단위 **687개/33파일**, 타입·린트·대비·production build). 두 파일(E2E 검사와 이 기록)만 바뀌며, 새 실제 브라우저 실행 결과는 CI 대기다.
