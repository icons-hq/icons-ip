# 카드·게임 기획을 접고 일반 쇼핑몰로 전환한다

- Status: accepted (2026-11-24) — 사용자 결정(아래 인용). main 머지와 운영 배포는 별도 승인.
- 삭제한 결정 기록: ADR-0001(유료 디지털 가챠), ADR-0002(크로스플랫폼 팝업 게임 미니앱), ADR-0003(무료 리워드 피벗), ADR-0004(뽑기권 카드팩)와 `docs/online-popup/05-game-miniapp-spec.md`. 그때의 결정은 git 이력에 남는다.
- 관련: [ADR-0008](./0008-remove-unvalidated-popup-native-roadmap.md)(온라인 팝업 운영층·네이티브 로드맵 제거), [ADR-0012](./0012-goods-purchase-entitlement-game-reward.md)(지우학 게임 보상 구매권 — 유지), [ADR-0043](./0043-xsquare-figma-storefront.md)(X SQUARE 스토어)

## 맥락

ICONS는 서브컬처 팬덤 "슈퍼앱"으로 출발해 실물 굿즈 커머스 옆에 수집형 디지털 카드를 두었다. 유료 가챠(ADR-0001)는 2026-07-03 무료 리워드(ADR-0003·0004)로 바뀌었고, 굿즈 주문 확정·참여형 게임(마블 룰렛)·캠페인 코인 교환으로 카드팩(뽑기권)을 받아 개봉해 바인더에 모으는 구조였다. 하지만 실제 운영에서는 이 축이 한 번도 켜지지 않았다.

- 카드 리워드 전역 gate `private.card_reward_control`은 기본 OFF이고, 켜는 migration이 없다. 신규 발급·개봉·게임 플레이는 DB가 거부해 왔다.
- 바인더·굿즈 마켓·카드 트레이드는 2026-11-18 운영하지 않기로 하고 DB 공개 스위치 `private.collectible_feature_control`(기본 전부 꺼짐)로 닫았다.
- 그런데도 셸·홈 혜택 타일·검색·마이페이지·알림·메뉴·푸터·주문 상세·클레임 화면·어드민(카드 운영·게임 운영 칸, 기능 공개 관리, 캠페인 교환처, IP 카드풀 탭)에 이 축의 화면과 게이트 분기가 남아 문서·용어집(카드 vs 굿즈, 트레이드 vs 마켓 vs 교환, 뽑기권 vs 쿠폰 등)과 함께 새 작업마다 따라 읽고 지켜야 했다.

사용자 결정 원문(2026-11-24):

> "아예 어휘계약 관련된 문서 제거해줘 우리 이제 예전 초기 기획에서 벗어나고 일반적인 쇼핑몰로 바뀌었으니까 뭐 카드 이런것도 안할거고 다 지워줘"

범위 선택: "문서+화면 코드 삭제 (권장) — 규칙 문서에서 카드 기획을 지우고, 고객 화면·어드민의 카드·카드팩·게임·바인더·마켓·트레이드 화면과 진입점 코드를 삭제. DB 테이블·기록은 남김(되돌릴 수 있게)". 용어집 선택: "쇼핑몰 용어만 남김 (권장)".

## 결정

1. **카드·카드팩(뽑기권)·참여형 게임·바인더·마켓·트레이드와 스태프 mock 시연을 앱에서 지운다.** 고객 라우트 `/packs`·`/binder`·`/market`·`/exchange`, `/games/*`(효산의 기억 제외), `/gacha` 리디렉트와 어드민 `/admin/catalog/{cards,pools,policies,grants,games}`를 없앤다(404). 진입점(셸 메뉴·메가메뉴·메뉴 시트·푸터 시연 블록·홈 혜택 타일·검색 카드 결과·마이페이지·주문 상세 카드팩 안내·캠페인 카드팩 교환 블록·IP 상세 카드풀 탭·클레임 상세 카드팩 행)과 서버 동작·도메인 모듈·시험도 함께 지운다.
2. **DB 테이블·함수·기록은 그대로 둔다.** 이번 변경은 migration을 만들지 않는다. 되돌릴 수 있게, 그리고 이미 남은 발급·감사 기록의 추적 가능성을 해치지 않으려고다. 전역 gate는 계속 OFF라 DB에서도 신규 발급·개봉·게임이 일어나지 않는다.
3. **DB 계약에 남은 자리는 앱이 조용히 건너뛴다.**
   - 공개 메뉴 계약(`private.store_navigation_valid`)은 고정 9칸에 `packs`를 요구한다. 칸은 저장 값 그대로 두고 앱이 `RETIRED_STORE_MENU_IDS`(`lib/routes.ts`)로 GNB·메가메뉴·메뉴 설정 화면에서 숨긴다.
   - 큐레이션·공지·셸 알림에 저장된 옛 목적지는 `isRetiredDestination`(`lib/home-catalog.ts`)이 거른다(`/packs`·`/games`·`/binder`·`/market`·`/exchange`·`/gacha`).
   - `search_public_content`가 돌려주는 카드 행, 캠페인의 옛 `exchange` 블록은 앱 파서가 버린다(DB 검증은 여전히 받는다).
   - 어드민 상단 칸 ID `card`는 창 이름·즐겨찾기 호환을 위해 그대로 두고 이름만 "커뮤니티"로 바꾼다.
4. **이 기능을 앱에 다시 들이지 않는다.** 되살리려면 이 ADR을 대체하는 새 결정이 먼저다.
5. **규칙 문서와 용어집은 쇼핑몰 기준으로 다시 쓴다.** `AGENTS.md`·`DESIGN.md`·`README.md`·`docs/PRD.md`·`docs/ARCHITECTURE.md`에서 카드·게임 범위를 지우고 "2026-11-24 일반 쇼핑몰 전환으로 삭제(DB 테이블·기록은 보존)"라고 남긴다. `CONTEXT.md`는 카드·게임·커뮤니티·굿즈/카드 구분 항목을 지우고 주문·클레임·배송 등 쇼핑몰 용어만 남긴다. 어휘 검사 시험(`lib/vocabulary-contract.test.ts`)은 지운다.

### 남긴 것

- 굿즈 커머스 전부(주문·결제·배송·클레임), 오프라인 팝업·티켓, `/events` 캠페인 허브(출석 코인 적립 포함), 온라인 팝업 IP관, 쇼핑스토리, 리뷰이벤트.
- 커뮤니티(공개 비공개 + 스태프 전용 프리뷰 그대로).
- 넷플릭스 지우학 캠페인(`/ip/aouad`)과 체험존 게임 효산의 기억(`/games/hyosan-memories`, `lib/games/hyosan-memories/*`, `docs/games/**`), 그 보상 계약 [ADR-0012](./0012-goods-purchase-entitlement-game-reward.md).
- 마케팅·회원 활동 동의 문구와 법정 문서(약관·처리방침·탈퇴 보존 정책)의 카드팩 언급 — 법정 문서 개정 절차가 따로 있어 이번에 바꾸지 않는다.
- `supabase/migrations/*`·`supabase/tests/*` 전부.

## 결과

- 코인은 적립만 되고 쓸 곳이 없다(유일한 소진처가 카드팩 교환이었다). 사용처를 새로 정하거나 적립을 멈출지는 별도 결정이다.
- 주문 취소·클레임 완료 RPC는 여전히 미사용 카드팩을 회수하고, 보관 가드는 활성 카드풀·발급 정책·게임이 남은 IP·굿즈·이벤트의 보관을 막는다. 그런 행이 운영 DB에 남아 있으면 어드민 화면이 없어 개발팀이 정리해야 한다(보관 실패 문구가 그렇게 안내한다).
- 알림 종류 `draw_ticket_issued`는 옛 알림을 읽기 위해 이름표만 남긴다.

### 정리 후보(별도 migration·사용자 승인 필요)

앱이 더 이상 부르지 않는 DB 객체다. 지우려면 기존 계약(공개 메뉴 9칸, 검색 RPC, 주문 취소·클레임 RPC의 카드팩 회수, 보관 가드, 캠페인 블록 검증, 알림 종류, 코인 원장 `exchange` 사유, IP 삭제 준비도 키, SQL 스모크)을 함께 고쳐야 한다.

- 테이블: `public.cards`·`card_pools`·`pool_odds`·`user_cards`·`card_grants`·`draw_tickets`·`reward_policies`·`games`·`game_plays`·`coin_exchange_offers`, `private.card_reward_control`·`private.collectible_feature_control`, 유료 가챠 유산 `wallets`·`wallet_ledger`·`pulls`·`pull_results`.
- 공개 함수: `card_rewards_enabled`·`grant_cards`·`open_draw_ticket`·`play_game`·`exchange_coins_for_draw_tickets`·`admin_upsert_card`·`admin_archive_card`·`admin_unarchive_card`·`admin_upsert_card_pool`·`admin_set_pool_odds`·`assert_pool_odds_total`·`admin_upsert_reward_policy`·`admin_list_reward_policies`·`validate_reward_policy_mutation`·`admin_grant_draw_tickets`·`admin_list_draw_ticket_grants`·`admin_upsert_game`·`admin_list_games`·`guard_game_event_contract`·`admin_upsert_coin_exchange_offer`·`get_collectible_features`·`admin_get_collectible_features`·`admin_save_collectible_features`.
- private 함수·트리거: `require_card_rewards_enabled`·`assert_card_pool_ready`·`guard_draw_ticket_issuance`와 카드풀·카드·게임·발급 정책·뽑기권 소비 가드, 뽑기권 알림 trigger, 수집·거래 스위치 문서 함수.
