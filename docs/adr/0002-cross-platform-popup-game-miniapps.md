---
status: superseded
---

# 웹 게임을 Expo webview 미니앱으로 함께 제공한다 (superseded)

이 ADR은 웹 참여형 게임을 자기완결 번들로 만들고 같은 원격 URL을 Expo 앱의 `react-native-webview`에서 로드하는 전달 구조를 채택했다. 범용 팝업 운영 레이어와 Expo 앱 셸이 함께 추진된다는 전제에서 나온 결정이었다.

2026-08-13 제품 범위를 다시 정리하면서 **범용 온라인 팝업 운영 레이어와 Expo webview 호스트는 현 로드맵에서 제외**했다. 따라서 이 문서는 신규 구현의 정본이 아니며, 네이티브 앱·브리지·원격 미니앱 런타임을 만들 근거로 사용할 수 없다. 미래에 앱 전달 계층이 다시 필요해지면 당시의 App Store 정책, 인증 경계, 배포·심사 책임을 다시 조사하고 새 ADR로 결정한다.

## 남아 있는 독립 불변식

- 현재 참여형 게임은 웹 경로로만 제공한다. 기존 코드의 `PopupGameHost` 이름이나 브리지 모양은 Expo 지원 약속이 아니다.
- 카드팩 개봉과 참여형 게임의 결과는 서버 신뢰 경계에서 결정하고, 클라이언트는 확정 결과를 연출만 한다. 이 불변식의 현재 정본은 [ADR-0004](./0004-draw-ticket-card-packs.md)와 [ARCHITECTURE §7](../ARCHITECTURE.md#7-db-rpc--신뢰-경계)이다.
- 기존 게임의 `goods` variant는 운영 콘솔에서 읽기 전용이다. 남아 있는 mock 연출은 실제 경품·구매권을 만들지 않으며, 이를 활성화하거나 새 실물 판매에 재사용하지 않는다.
- 19+ 유한 실물 쿠지는 카드·게임과 분리된 `prize_sale` 도메인에서 별도 설계한다. 구현 범위는 [#212](https://github.com/icons-hq/icons-ip/issues/212)와 [#213](https://github.com/icons-hq/icons-ip/issues/213)이 추적한다.

과거 조사 자료는 당시 판단을 재현하기 위한 historical 자료일 뿐 현재 제품·법률·아키텍처의 정본이 아니다.
