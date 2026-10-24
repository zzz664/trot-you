# 답장 음성 입력

## 범위와 사용

팬 답장 작성기의 재사용 `MicButton`은 `onResult(text)`로 비어 있지 않은 최종 한국어 인식 결과를 전달한다. 이번 연결은 팬 답장뿐이며 가수 작성·온보딩·게시판 화면을 만들거나 미승인 분석 context를 추가하지 않는다.

1. `음성으로 쓰기`를 누르면 현재 초안/선택 영역을 메모리에 보존하고 안내를 보여 준다. 이때 마이크 API를 생성하거나 시작하지 않는다.
2. 외부 음성 서비스 가능성·권한·초안 전용 동작을 읽은 뒤 `안내 확인 후 마이크 시작`을 직접 누르면 그 클릭 안에서 `start()`를 호출한다.
3. 시작 대기, 듣는 중, 마치고 결과 대기 상태를 글로 표시한다. 중간 인식은 별도 미리보기이며 아직 초안을 바꾸지 않는다.
4. `말하기 마치기`는 `stop()` 후 최종 결과와 종료를 기다린다. 자연 종료도 같은 경로다. 종료한 세션의 final snapshot만 한 번 넣는다. 보내기는 반드시 별도 사용자 동작이다.
5. `음성 입력 취소`, Escape, 작성기 닫기, 언마운트, 이동/Back/Forward, pagehide/숨김 또는 접근 재검증으로 작성이 중단되면 `abort()`하고 늦은 이벤트를 무시한다. 재시작은 항상 새 사용자 클릭이다.

음성 입력 동안 원본/선택 영역 보존을 위해 편집기는 readOnly이며 보내기도 막는다. 종료 후 원래 선택 영역만 치환하고 UTF-16 DOM caret을 복원한다. 실제 답장 길이 정책은 서버에서 받은 Unicode scalar 상한을 사용하며 남은 용량을 넘으면 전부 거절하고 원래 초안을 보존한다. 이모지의 surrogate pair를 반으로 잘라 넣지 않는다. 권한 상실/이동 시에는 기존 답장 보안 수명주기대로 민감한 초안을 지운다.

## 브라우저 기능 분기

- 보안 컨텍스트(`isSecureContext === true`)에서 함수형 `window.SpeechRecognition`, 없으면 `window.webkitSpeechRecognition`을 확인한다. UA 문자열로 허용 목록을 추측하지 않는다. 이 검사는 사용 가능 후보의 존재일 뿐 서비스 가동/한국어 지원/권한을 증명하지 않는다.
- `lang='ko-KR'`, `continuous=false`, `interimResults=true`, `maxAlternatives=1`로 한 번의 발화를 요청한다. 공통 지원이 보장되지 않는 실험적 `available`, `install`, `processLocally`를 강제하거나 언어 팩을 자동 설치하지 않는다.
- 없는 API/비보안 컨텍스트는 직접 입력 또는 OS 키보드에 마이크가 있는 경우 이를 사용하도록 안내한다. 모든 브라우저에서 지원하거나 오프라인으로 된다는 약속은 하지 않는다.
- 권한/서비스 거부, 음성 없음, 오디오 장치 문제, 네트워크, 한국어 미지원, 알 수 없는 오류를 중앙 한국어 문구로 표시한다. 브라우저 진단 문자열은 출력/로그/전송하지 않는다.
- 시작 15초, 한 발화 60초, 종료 대기 5초는 기술적 자원 상한이다. 응답 없는 브라우저 서비스는 취소하며 기존 초안을 보존한다. 제품 길이/횟수 정책을 새로 만들지 않는다.

## 개인정보와 분석

앱은 `getUserMedia`, `MediaRecorder`, 오디오 파일, 브라우저 저장소, 오디오 업로드/분석, 서버 STT나 유료 speech provider를 사용하지 않는다. **그렇다고 브라우저 자체의 인식이 항상 기기 안에서 처리된다는 뜻은 아니다.** 브라우저 제공업체의 외부 처리와 인터넷 필요 가능성을 시작 전에 명시한다. 앱의 녹음 비저장 약속은 제3자 브라우저 서비스의 보존 정책을 대신 보증하지 않는다.

채택된 세션의 `voice_input_used`는 `reply` context와 랜덤 멱등 키만 관측한다. 원문, 오디오, 길이/시간, 사용자/가수/기기 식별자를 보내지 않는다. 저장은 기존 DB의 현재 선택 동의/승인 정책 검사로 차단 또는 허용된다. 마이크 권한과 분석 동의는 별개다. [세부 계약과 미승인 수집 rate-policy 제한](voice-analytics.md)을 참고한다.

## 공식 문서 근거 (2026-10-24 확인)

- [Web Speech API Community Group draft](https://webaudio.github.io/web-speech-api/): 명시적 동의, 서버/기기 기반 구현 가능성, 결과 snapshot과 final/interim 교체, stop/abort 의미의 기준이다. 최종 W3C Recommendation이 아닌 draft이다.
- [Chrome Web Speech API 안내](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api/): 접두 API 기능 검사와 명시적 시작/중간·최종 결과 처리의 vendor 문서다. 오래된 소개 글이므로 현재 브라우저 지원 보증으로 사용하지 않는다.
- [WebKit Safari 14.1 기능 소개](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/): Safari 음성 인식은 Siri 엔진/OS 설정의 영향을 받는다고 설명한다. API 존재만으로 실제 서비스 가용성을 가정하지 않는 이유다.

## 검증과 남은 조건

단위/격리 CI 브라우저 검증은 제어된 `SpeechRecognition`/`webkitSpeechRecognition` 생성자와 합성 이벤트를 주입한다. **실제 마이크 권한, 사용자 오디오, 실제 Chrome/Safari 기기 및 vendor speech service 성공의 검증이 아니다.** CI에서도 외부 요청을 차단하고 오디오 권한을 부여하지 않는다. Auth/답장/분석 동의는 폐기용 로컬 Supabase의 실제 RPC로 검증한다.

`speech-browser`는 CI/loopback/전용 플래그 guard로만 실행하며 기본 keyless `test:e2e`에서 제외한다. `--list`도 전용 guard를 우회하지 않는다. 세 글자 크기 × 360px/1024px 화면에서 안내·시작·듣기·중간·마치기·채택·취소·미지원·오류 및 접근 상실을 캡처한다. 실제 통과 여부/시각 검토는 해당 CI 실행 기록을 따른다.

릴리스 전 사용자가 승인한 실제 장치/브라우저의 한국어 인식, 권한 거부/복구, 서비스 네트워크 오류, 모바일/PWA 생명주기 검증이 별도로 필요하다. 본 작업은 실제 마이크 사용이나 배포를 승인하지 않는다. 기존 미디어 독립 재검토의 제한은 그대로 유지하며 이 기능 검증으로 대신하지 않는다.
