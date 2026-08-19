---
status: accepted
---

# 검증되지 않은 online-popup 전용층과 Expo 앱 약속을 현행 범위에서 제거한다

2026-08-12 현재 제품은 **web-only v1**로 유지한다. 기본 웹 굿즈 커머스, 팝업 티케팅, IP 허브, 커뮤니티, 카드팩 개봉과 서버 결정 참여형 게임은 계속 현행 범위다. 반면 `popups` 운영 단위, 미션·등급·도장, 래플, 브랜드 리포트, 범용 WebView 미니앱 플랫폼과 Expo 네이티브 앱 셸은 active roadmap·backlog에서 제거한다.

이는 단순 연기가 아니다. 운영 주체, partner, pilot budget, native-only 가치가 없는 거대 예약 이슈를 유지하면 현재 출시 경계가 흐려지고 구현자가 역사적 스펙을 현행 AC로 오인한다. #66과 #115는 정본 문서가 default branch에 반영된 뒤 `not planned`로 닫고, 필요가 생기면 새 소형 RFC와 새 이슈로 검증한다.

## Considered Options

- **#66·#115를 무기한 backlog로 유지** — 향후 아이디어를 잃지 않지만 서로 다른 도메인과 외부 의존성을 완료 가능한 일처럼 보이게 한다. 폐기.
- **현재 전체 구현** — native repo·스토어·보안 owner와 popup partner·운영 owner·법무 증거가 없어 검증 불가능하다. 폐기.
- **현행 범위에서 제거하고 재진입 조건을 둔다 (채택)** — YAGNI를 지키면서 역사적 연구와 보안 불변식은 보존한다.

## Consequences

- [ADR-0002](./0002-cross-platform-popup-game-miniapps.md)는 부분 supersede한다. **게임 결과는 서버가 정하고 웹 클라이언트는 렌더러다**라는 경계만 현행 결정으로 유지한다. 두 호스트·Expo 임베딩·범용 bridge는 historical candidate다.
- [ADR-0003](./0003-free-reward-pivot.md)·[ADR-0004](./0004-draw-ticket-card-packs.md)의 현행 웹 카드 리워드와 서버 RNG 계약은 바꾸지 않는다.
- [ADR-0005](./0005-icons-allocated-inventory.md)의 수기 ICONS 할당 재고를 유지한다. 실제 다채널 재고 충돌과 WMS API 계약이 확인되기 전에는 공유재고 동기화를 만들지 않는다.
- `docs/online-popup/`은 historical research/candidate로 남기며 구현 권한·일정·acceptance criteria가 아니다.
- 코드에 남은 historical goods game variant는 읽기 전용으로 유지하고 새 운영을 거부한다. 안내 문구는 종료 이슈 대신 “현재 지원하지 않음”으로 정리한다.

## 재진입 조건

### Expo/native

다음을 모두 만족할 때 새 RFC를 검토한다.

1. 월간 활성 사용자 5,000명 이상이 3개월 연속 측정된다.
2. 웹/PWA로 충족할 수 없는 native-only use case가 2개 이상 증거와 함께 존재한다.
3. 앱·스토어·보안·운영 owner와 iOS/Android 배포 예산이 지정된다.

재검토 시 refresh token·범용 Supabase session의 WebView 주입을 금지하고, capability/resource-bound single-use BFF 경계를 새 위협모델에서 승인한다.

### Online-popup 전용 운영층

다음을 모두 만족할 때 하나의 tracer RFC로 시작한다.

1. 실제 참여 의사를 확인한 active IP partner가 1곳 이상 있다.
2. 90일 pilot의 콘텐츠·운영 owner와 예산이 지정된다.
3. 예상 MAU 5,000 또는 사전등록 1,000의 측정 가능한 수요 증거가 있다.
4. 첫 RFC는 한 개의 `popups` 운영 단위와 공개 landing/archive 같은 단일 흐름만 다루며 미션·래플·리포트·native를 묶지 않는다.

임계치는 재검토 시작 조건일 뿐 자동 구현 승인이 아니다. 새 RFC는 당시 코드·법무·개인정보·운영 사실을 다시 확인한다.
