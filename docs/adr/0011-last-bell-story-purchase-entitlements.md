# ADR-0011: Last Bell 검증 스토리 구매권

- 상태: Accepted (2026-08-26 진행 검증 계약 보정)
- 날짜: 2026-08-25
- 관련 문서: [`PRD.md` §4.3](../PRD.md), [`ARCHITECTURE.md` §2.1](../ARCHITECTURE.md)

## 맥락

Last Bell은 무료 2챕터 스토리 안에서 사용자가 실물 굿즈 형태의 수집품을 직접 발견한다. 로컬 클라이언트 완료만 신뢰하면 개발자 도구, 이벤트 재전송, 불가능한 이동으로 구매 자격을 만들 수 있다. 반대로 이 캠페인을 기존 카드 보상형 `play_game`이나 legacy `goods` variant에 연결하면 카드 리워드·RNG·실물 구매권의 경제가 섞인다.

## 결정

Last Bell에만 `verified-story-run` 권위 경계를 둔다.

- `/games/prototype-last-bell`의 `LocalRunHost`는 QA 전용이며 구매권·계정 기록을 만들지 않는다.
- gate된 `/experiences/all-of-us-are-dead/last-bell`, 그 전용 `/store`, run·event·complete·claim·inventory authority API만 검증 권위에 연결한다. `ICONS_LAST_BELL_VERIFIED_EXPERIENCE !== '1'`이면 두 페이지와 모든 API가 404로 fail closed한다. 로그인 사용자는 계정 run, 게스트는 opaque raw token cookie를 사용하며 DB에는 digest만 저장한다. 로컬 QA 완료 CTA는 별도 prototype store에만 남긴다.
- 계정 run 시작·계정 진행·guest claim은 기존 정지, 탈퇴 write fence, 온보딩 완료 조건을 API preflight와 service-only RPC의 DB trigger에서 모두 다시 검사한다.
- 서버는 versioned collectible key, sequence, operation id, chapter/zone, checkpoint, 고정 milestone 순서와 전체·직전 milestone의 server-observed 물리적 최소 시간을 검증한다. 이 최소 시간은 event burst·순서 우회를 거절하는 anti-abuse 하한이지 10분 플레이를 만들기 위한 타이머가 아니다. 자연 cold-open은 선택적으로 skip할 수 있고, 준비 완료 뒤에는 문과 핵심 상호작용을 즉시 사용할 수 있다. 10분 목표는 실제 거리·탐색·조우·연출로 만들고 사람의 첫 성공 플레이 5회 중앙값으로 승인한다. 클라이언트는 `good_id`, 가격, 재고를 제출하지 않는다.
- 첫 플레이는 검증된 엔딩, 재플레이는 해당 챕터의 검증된 출구에 도달해야 그 run에서 실제로 수집한 key만 vest한다. 로그인 run은 즉시 계정 구매권으로 materialize하고, 게스트 완주는 7일 안에 로그인 claim할 수 있다. 한 guest cookie로 여러 완료 replay가 생겼다면 claim RPC가 같은 digest의 당시 유효한 완료 run을 한 트랜잭션에서 모두 같은 계정에 귀속한 뒤에만 cookie를 만료한다.
- `goods.purchase_access`는 `public | story_entitlement`다. 제한 상품은 cart 직접 DML, cart merge, order item 생성에서 구매권을 다시 검사하고 주문별 entitlement snapshot을 남긴다.
- 구매권은 할인, 재고 예약, 수량 혜택, 카드·카드팩, 경품 당첨이 아니다. 기존 판매기간·재고·장바구니 제한·Korpay `PaymentGateway`와 주문 TTL을 그대로 따른다.
- 대사·캐릭터·상품 그래픽은 교체 가능한 데이터/asset seam과 IP 검수 상태를 유지한다. production 상품 활성화는 가격·표시 의무·재고·IP 검수의 별도 승인이 필요하다.

## 결과

- 무료 게스트 플레이와 안전한 계정 귀속을 함께 제공하면서 클라이언트 완료 신호를 구매 권위로 사용하지 않는다.
- 상품 매핑과 판매기간을 run 시작 시 version으로 고정해 이후 카탈로그 변경에도 감사 가능한 근거를 남긴다.
- 일반 카드 보상형 참여형 게임, 실물 쿠지, 범용 온라인 팝업 운영 레이어에는 이 예외가 전파되지 않는다.
- 게스트 raw token이 사라지면 복구할 수 없다. server-observed milestone 간 물리적 최소 시간과 고정 순서는 event 일괄 재생 우회를 줄이지만, 클라이언트의 좌표·입력·물리 이동을 암호학적으로 증명하거나 서버에서 재연산하지는 않는다. 또한 이 하한을 플레이 시간 품질의 대리 지표로 사용하지 않는다. 운영 전 anti-abuse 관찰과 rate limit 조정이 필요하다.
