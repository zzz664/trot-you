# 공통 접근성 UI

## 사용 원칙

- 버튼은 `Button`, 아이콘 포함 버튼은 **화면에 보이는 `label`이 필수**인 `IconButton`을 사용합니다. 기본 `type`은 `button`입니다. 비동기 작업 중에는 `isLoading`을 전달합니다. 실제 도메인 작업의 중복 실행 방지는 해당 서비스에서도 보장해야 합니다.
- `Input`은 필수 `label`, 선택 `hint`/`error`를 연결합니다. 오류를 지우는 책임은 폼에 있습니다. 사용자 안내를 placeholder만으로 제공하지 않습니다.
- `Card`는 고유 ID의 제목을 가진 영역입니다. 로딩은 `Loading`의 글자와 스피너로, 실패는 `InlineError`의 문구와 큰 재시도 버튼으로 표시합니다. 재시도 콜백은 완료 시 resolve하고 실패 시 reject합니다. 컴포넌트는 동시 재시도를 막으며 실패 문구를 숨기거나 성공을 가정하지 않습니다. 성공 후 오류 제거는 호출자가 처리합니다.
- 글자 크기, 간격, 색은 `design-tokens.ts`에서 가져옵니다. 터치 영역은 최소 3rem, 입력란 높이는 최소 3.5rem입니다. 컨테이너 높이는 콘텐츠에 따라 늘어납니다.
- `BackButton`은 검증되지 않은 브라우저 history를 사용하지 않고, `routes`의 알려진 부모 경로로 `replace`합니다(기본 홈). 신뢰할 수 있는 앱 내부 방문 이력을 구현하기 전의 의도적인 안전 기본값입니다.

## 대화상자

앱 루트의 `DialogRoot`가 관리하는 **하나의** `DialogProvider`와 `useDialog()`를 사용합니다. `DialogRoot`는 pathname을 `scopeKey`로 전달해 큐만 교체하며 앱/레이아웃 자식 상태는 유지합니다. `Dialog`를 직접 여러 개 렌더링하지 않습니다.

```tsx
const { showDialog, cancelDialog } = useDialog();
const result = await showDialog({
  key: requestKey,
  title: t('title'),
  description: t('description'),
});
if (result === 'confirmed') {
  // 실행 권한, 검증, 중복 방지는 실제 작업 계층에서 처리합니다.
}
// 필요한 경우 대기 중이거나 열린 요청을 취소합니다.
cancelDialog(requestKey);
```

- 동일 경로의 동일 `key`는 활성/대기/닫힘 처리 중 하나의 Promise를 공유합니다. 같은 작업의 반복 클릭에 안정적인 key를 사용합니다. 기존 요청의 문구를 변경하지 않습니다.
- FIFO로 하나씩 열며 이전 Radix focus-scope가 해제된 후 다음 요청을 표시합니다. 최초 포커스는 취소 버튼입니다.
- 확인은 `confirmed`, 취소 및 프로그램 취소는 `canceled`, 닫기/Escape/바깥 영역 클릭은 `dismissed`입니다. 확인 외 결과에서는 작업을 실행하지 않습니다.
- `cancelDialog(key)`는 대기 항목도 제거합니다. `cancelAll()`은 전체 큐를 취소합니다. pathname 변경은 이전 화면 요청만 취소하고 새 화면 요청은 유지합니다. Provider 해제 시 미완료 Promise도 취소됩니다.
- 닫힌 후 요청을 연 요소로 포커스를 돌립니다. 요소가 제거되었거나 포커스를 받을 수 없으면 현재 `main`(없으면 body)으로 이동합니다.

## 점검 화면

`UI_PREVIEW_ENABLED=true npm run dev`로 서버에서 명시적으로 켜고 `/ui-preview`를 엽니다. 기본값은 꺼짐이며 비활성 상태에서는 not-found입니다. `noindex`이며 공개 홈에 링크하지 않습니다. 서버 플래그는 공개 환경 설정으로 내보내지 않습니다.

화면의 입력/오류/재시도/대화상자는 저장이나 외부 요청 없는 접근성 점검 전용입니다. 회원가입·구독·결제가 완료되었다는 의미가 아닙니다. Playwright 서버만 이 플래그를 켜서 세 글자 크기 × 360/414px 및 확대 화면을 점검합니다.

## 프로필 설정 컨트롤

`Checkbox`와 `RadioGroup`은 네이티브 체크/단일 선택 의미 및 키보드 조작을 유지한다. 입력뿐 아니라 연결된 전체 라벨이 최소 3rem 터치 영역이다. 프로필 온보딩은 이 컨트롤과 기존 Input/Button/InlineError를 조합하며 원시 버튼/입력으로 접근성 경계를 우회하지 않는다.
