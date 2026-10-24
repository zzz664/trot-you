# 음성 입력 관측 전송

음성 입력 기능의 `MicButton`은 확정된 비어 있지 않은 인식 결과를 초안에 수용한 세션에 한해 `recordVoiceInput(context, eventKey, signal)`을 한 번 호출한다. 호출자가 만든 세션 UUID를 그대로 사용하며, 한 세션의 중간/중복 결과마다 새 이벤트를 만들지 않는다. 인식 취소·오류·미지원·빈 결과를 성공 관측으로 보내지 않는다. 실제 답장 전송과는 독립이다.

## 허용 데이터와 경계

- `POST /api/analytics`는 `event_key`, 고정된 `voice_input_used` 이름, `properties.voice_context`만 허용한다. context는 기존 DB 계약의 `reply | post | comment`이며 이번 연결은 `reply`뿐이다. 미구현 가수/온보딩 context를 임의로 추가하지 않는다.
- 자유 문자열, 음성/인식 원문, 녹음, 길이·시간, 가수/사용자/기기 식별자, URL, provider 응답은 전송하거나 저장하지 않는다. 요청은 1 KiB와 5초의 기술적 상한을 가진다.
- 브라우저는 동일 출처 세션 쿠키만 사용한다. 서버는 설정된 Origin과 일치하는 POST, 쿼리 없는 경로, 실제 검증 세션, 온보딩 완료·미제한 fan을 확인한다. 클라이언트 actor 또는 timestamp를 받지 않는다.
- 서비스 `track`은 기존 client-observation allowlist로 검증한 뒤 request-bound DB adapter를 호출한다. generic 서비스가 기존 `message_open` 계약도 이해하지만 이 endpoint는 아직 그 이벤트를 받거나 자동 발생시키지 않는다.
- `analytics_record_client`가 승인된 활성 정책과 **현재 버전의 선택적 분석 동의**를 원자적으로 재확인한다. 마이크 사용 허용/브라우저 권한은 분석 동의를 대체하지 않는다. 분석 정책과 동의가 없으면 `CONSENT_REQUIRED`로 거절되어 저장되지 않으며, 음성 입력 자체는 계속 사용할 수 있다.
- DB가 같은 사용자/authority/event key의 같은 입력을 중복 제거한다. 반환된 내부 event ID는 브라우저에 공개하지 않는다. 네트워크 중단 직전에 이미 기록되었을 수 있으므로 abort가 기록 취소를 뜻하지는 않는다.
- 실패는 초안을 지우거나 수정하거나 보내지 않는다. 자동 재시도, 오프라인 저장, background queue, beacon, keepalive 전송을 하지 않는다. 수집 실패를 사용자에게 입력 실패로 표시하지 않는다.

## 설정과 남은 운영 조건

이번 변경은 분석 정책/동의/보존 기간을 활성화하거나 DB 스키마·생성 타입을 바꾸지 않는다. 기존 승인되지 않은 기본 상태에서는 이벤트 저장이 차단된다. 분석 정책의 활성화는 별도 승인된 운영 작업이다.

요청 크기/시간 상한과 세션별 UI 중복 억제는 사용자별 원자적 수집 rate limit이 아니다. 기존 DB 계약처럼 관측은 실제 음성 사용의 증명이 아니며, 임의 관측을 보상·결제·공식 KPI 근거로 쓰면 안 된다. 원자적 수집 rate policy/구현은 분석 퍼널의 운영 활성화 전 별도로 정해야 한다. 이번 기능에서 미승인 제한값이나 정책을 새로 만들지 않았다.

## 검증 구분

`analytics-client`, `analytics-service`, `analytics-db`, `analytics-http`, `analytics-security` 단위 검증은 전송 계약, actor/Origin/strict-body 경계, 취소, 현재 DB 거절 결과 보존과 실패 비간섭을 다룬다. adapter 단위 테스트의 RPC는 stub이며 실제 DB 동의를 대신 검증하지 않는다. 격리된 CI 브라우저/DB 테스트와 기존 analytics pgTAP/경합 검증 결과는 해당 실행의 기록을 기준으로 보고한다. 실제 마이크 오디오나 브라우저 vendor 음성 서비스는 이 analytics 검증에서 사용하지 않는다.
