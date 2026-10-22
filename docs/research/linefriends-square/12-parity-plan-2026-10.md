# linefriends-square 재현 스펙 — 12. 패리티 2차 구현 계획 (2026-10)

> [11-parity-audit-2026-10.md](./11-parity-audit-2026-10.md)의 차이 목록을 닫는 실행 계획이다. 이 계획과 §4 결정 항목의 승인이 착수 계약이다.
> **2026-10-22 승인**: 계획과 §4 기본값 승인, LD-1·LD-1a·LD-1b·LD-2는 기본값으로, LD-6은 "상세 패널 끝"으로 확정. 진행 범위는 L0 + W-A(L1·L3·L10)를 PR·CI까지, 머지는 PR마다 별도 승인.
> 디자인 정본은 `DESIGN.md`(White Catalog v4), 결정은 [ADR-0011](../../adr/0011-lfs-storefront-redesign.md)을 따른다. 2026-10-22 독립 검토(blocker 1·major 9·minor 16)를 반영한 판이다.

## 0. 목표와 전제

- **목표:** 11 §8의 모든 ID를 닫는다. 닫힘은 넷 중 하나다: ① 구현·검증 완료 ② 운영 게이트(LG)로 넘겨 운영자가 입력 ③ `INTENTIONAL`·`N/A`로 근거와 함께 문서화 ④ 결정(LD)으로 범위에서 제외하고 사유를 11 §8에 기록. 각 단계 PR은 11 §8의 해당 행에 완료 표시와 PR 번호를 단다.
- **"완벽 적용"의 경계(ADR-0011):** 레이아웃·IA·컴포넌트 구조·수치·동작·기능은 맞춘다. 레퍼런스의 이미지·로고·캐릭터·카피·핑크·등급 배지 원색은 가져오지 않고 ICONS 자산과 토큰으로 바꾼다. 레퍼런스 결함과 T-C(외부 SaaS)는 재현하지 않는다(11 §9).
- **돈·재고 경계(DESIGN §11, AGENTS.md 데이터 무결성):** 결제 확정, 주문 생성 금액 계산, 카드 RNG, 검표는 어떤 단계도 바꾸지 않는다. 재고에 닿는 것은 L2의 옵션 재입고 트리거 하나뿐이다 — 재고를 **읽어** 알림만 만들고, 재고를 바꾸는 트랜잭션(주문 생성·취소 환원·재고 조정) 안에서 실행되므로 예외를 던지지 않음을 회귀 테스트로 증명한다. 사은품 자동 증정(LD-9)은 할당 재고·주문 행을 바꾸므로 기본 범위에서 뺀다.
- **출고 방식(LD-3):** 단계마다 PR 1개(큰 단계는 2개)를 main에 직접 올린다. 전면 교체가 아니라 표면별 보정이라 통합 브랜치를 두지 않는다. 머지는 운영 배포이므로 PR마다 사용자의 명시 승인을 받고, 배포 뒤 iconsip.com에서 실측 확인한다.
- **10/14 실사용 QA 후속 백로그**(`outputs/meeting-2026-10-14-followup/backlog.md`, 로컬 전용)와 같은 화면을 건드린다. 겹치는 항목의 처리는 §1·LD-1을 따르고, 흡수한 완료 기준은 이 문서에 옮겨 적는다(백로그 파일은 저장소에 없다).

## 1. 10/14 후속 백로그와의 관계

| 이 계획 | 10/14 백로그 | 기본 처리 |
|---|---|---|
| MY-01·MY-02·MY-04 마이 셸·대시보드(L6) | S16(PR-9) | **흡수(LD-1).** 모바일 기준은 LD-1a |
| MY-06·MY-13 위시 그리드·담기·데스크톱 진입(L6) | S14·S15(PR-1 일부) | **흡수(LD-1)** |
| PD-02 담기 결과 모달(L1) | S17 첫째·둘째 기준(PR-8 일부) | **흡수(LD-1)** |
| CT-02 빈 카트 둘러보기 버튼(L9) | S17 셋째 기준(PR-8 일부) | **흡수(LD-1)** |
| MY-11 주소록(L7) | S6b·S3(PR-10), S6a(PR-1 일부) | **흡수(LD-1).** S6a는 LD-1b |
| SR-01 검색 결과 필터·정렬(L4) | S25(H10 MD 재확인) | L4에서 구현, H10 회신이 다른 요구면 반영 |
| MY-10 메일·SMS 수신 동의 분리 | S4(PR-16, D4·H4) | 10/14 트랙 유지 |
| — | S10~S13, S12·S8, S18, S7, S19~S21, S26, S22, S23, S1·S5, S9, S24, S2, A1~A16 | 10/14 트랙 유지. 같은 파일은 §5 순서로 직렬화 |

**흡수한 완료 기준(10/14 백로그 원문 요지):**
- S16: PC에서 주문을 포함한 모든 마이페이지 하위 화면에 같은 좌측 메뉴. `/my`에 주문 상태별 건수·쿠폰·적립금·위시 요약 대시보드. 390px은 "기존 모바일 패턴"(→ LD-1a).
- S14·S15: 위시 행에 수량 없는 '장바구니 담기' 버튼이 `showCart`와 무관하게 보이고, 누르면 담았다는 확인이 뜬다. 데스크톱에서 위시로 바로 간다. 상품 카드 전반의 `showCart` 동작은 그대로. 헤더 메뉴 목록(`STOREFRONT_MENU_ITEMS`)에 넣으면 저장된 내비 설정이 개수 불일치로 무시되므로 다른 자리를 쓴다(`lib/store-navigation.ts:27-28`).
- S17: 담기에 성공하면 '장바구니 보기 / 계속 쇼핑' 확인이 뜨고, '계속 쇼핑'을 누르면 지금 페이지에 머문다. 빈 상태의 둘러보기 버튼은 직전에 보던 목록으로 돌아간다.
- S6b·S3: 본인만 읽고 쓰는 주소록(기본 배송지·별칭·여러 개). 두 주문서 모두에서 고르고 추가할 수 있다. 온보딩이 끝나면 배송지 등록을 안내한다(건너뛸 수 있음). 주문 주소 JSON 계약은 그대로, 선물 수령인 주소는 주소록에 섞지 않는다.
- S6a(LD-1b): 주문서의 '배송지 미리 채우기' 표현·동작 정정 — 주소록이 생기면 기본 배송지로 채운다.

흡수한 항목은 backlog.md에 "LFS 패리티 L1/L6/L7/L9로 이관"으로 표시해 두 트랙이 같은 일을 하지 않게 한다.

## 2. 사람·운영 게이트

| ID | 내용 | 막는 것 | 담당 |
|---|---|---|---|
| LG-1 | 홈 큐레이션 편성: 히어로 여러 장, 카테고리 BEST·인기템 탭, 배너+리스트 2~3개, 이미지 공지 스트립(DT-01~04·06) | 홈 밴드, `/shop/best` 빈 화면(P0) | MD·운영 |
| LG-2 | 시연 굿즈 정리와 실판매 카탈로그 노출(#318·#316) | 카탈로그 전반(P0) | 운영(사용자 요청 시 실행) |
| LG-3 | 카테고리 고객 공개 활성화 + 전시 카테고리 편성(DT-10) | L5 | 운영 |
| LG-4 | 캠페인 등록(DT-07) | 이벤트 허브 | 운영 |
| LG-5 | 굿즈 상세 이미지·고시 입력(DT-08) | PDP 상세 패널 | MD |
| LG-6 | 스토어 표시 설정: 목록 카드 설명 줄 끄기(CL-04, LD-7), `listing.showCart` 의도 확인(10/14 H8) | 목록 카드 문법 | 운영 |
| LG-7 | ICONS 자체 라인아트(빈 카트·404·마이 빈 상태)와 카테고리 아이콘 | CT-02, CH-14, L5 | 디자인(AGENTS.md 이미지 작업 규칙: 내장 imagegen + 비전 QA, SHA-256 결속) |
| LG-8 | 로고·SNS·사업자 정보 확정(#239) | 헤더 로고, 푸터, PD-06 판매자 정보 칸 | 운영 |
| LG-9 | 텍스트 공지 바 문구·기간 입력(L8a 배포 후) | CH-01 노출 | 운영 |

## 3. 단계 (= PR 단위)

| 단계 | 범위(11 §8 ID) | 주요 파일 | DB | 크기 | 선행 |
|---|---|---|---|---|---|
| **L0 문서 정합** | 11 §4 정정 전부, §3 해당 절 날짜 주석, 09·10의 CLI 버전, DESIGN·ADR 기존 충돌(바텀탭 채택 주석, GNB 8항목, 홈 추가 블록, 전환 완료 문구, `mini-checkout-cart` 메모 위치 LD-8), 00 색인. DESIGN frontmatter는 L10 소유라 건드리지 않는다 | `docs/research/linefriends-square/00~10`, `DESIGN.md`, `docs/adr/0011-*.md` | — | S | 승인 |
| **L1 상품 상세 구매 경험** | PD-01~09, PD-12~15, PD-16b, PD-17, PD-19, CH-16 | `components/screens/GoodDetail.tsx`, `components/shop/GoodPurchasePanel.tsx`(+신규 구매 시트·담기 결과 모달·공유 시트), `components/wc/TabPanels.tsx`(opt-in prop), `app/styles/wc-catalog.css`(PDP 구간)·`product-detail-*.css`·`wc-inquiry-widget.css`, `lib/goods-options.ts`, `app/shop/[goodId]/page.tsx` | — | L | L0 |
| **L2 품절 옵션·옵션 단위 재입고** | PD-10, PD-11 | migration·`supabase/tests/*`, `components/shop/RestockCta.tsx`, `GoodPurchasePanel.tsx`(옵션 셀렉트), `lib/wishlist.server.ts`, `app/shop/actions.ts`(옵션 인자를 받는 새 action), GoodDetail engagement 타입, `lib/email/dedupe.ts`, `lib/notifications.ts`, `CONTEXT.md` | ✓ | M | L1 |
| **L3 전역 크롬·검색 오버레이·기본 표면** | CH-03·04·06·08·09·11(푸터·오버레이)·12·13·14·15, MC-01~04, AU-01·02 | `components/shell/Nav.tsx`·`SearchOverlay.tsx`·`BottomTabBar.tsx`·`SiteFooter.tsx`, `app/styles/wc-chrome.css`, `lib/routes.ts`(셸 조건·GNB 활성·유틸바 링크 자리), `app/not-found.tsx`, `components/screens/Login.tsx` | — | M | L0 |
| **L4 목록·검색·온라인 팝업·홈** | CL-01~03·05~08·10·11, SR-01~03, IP-01~05, HM-01~08, DT-11 | `components/wc/ProductCard.tsx`·`ContentCard.tsx`·`Badge.tsx`, `components/screens/Shop.tsx`·`Search.tsx`·`IpDirectory.tsx`·`IpDetail.tsx`·`Home.tsx`, `lib/search-goods.ts`·`lib/shop-catalog.ts`·`lib/home-catalog.ts`·`lib/wishlist.server.ts`(목록용 조회), `app/styles/wc-catalog.css`(목록 구간)·`wc-discovery.css`·`wc-home.css`·`wc-foundation.css`·`wc-product-mosaic.css`·`wc-review-events.css` | 읽기 집계(CL-02) | L | L1·L3 |
| **L5 카테고리 내비게이션** | CH-05, CH-07, MC-05 | migration(`private.category_display_nodes` 이미지 열 — 지금은 없음 `20261020085359:3-14`), 어드민 업로드·`/admin/guide`, `lib/routes.ts`·`lib/store-navigation.ts`, `Nav.tsx`(메가메뉴), 신규 카테고리 시트, `MenuSheet.tsx`, `wc-chrome.css` | ✓ | L | L3, LG-3 |
| **L6 마이페이지** | MY-01~09, MY-12~14 | `components/screens/MyPage.tsx`·`Wishlist.tsx`·`Orders.tsx`·`OrderDetail.tsx`(셸 래핑)·`Settings.tsx`·`MyCoupons.tsx`, `components/wc/MypageShell.tsx`, 신규 회원 등급 혜택 화면·라우트, `app/styles/wc-account-commerce.css`, migration(읽기 RPC 1) | ✓ | L | L0, L1(모달)·L4(하트) 공용 부품 |
| **L7 주소록** | MY-11 | migration·`supabase/tests/*`, `lib/` 주소록 모듈, 두 주문서(`components/screens/Checkout.tsx`, `GoodsTransactionCheckout.tsx`), `lib/checkout.server.ts`, `app/onboarding/*`, `/my/addresses`, `Settings.tsx` 진입, `lib/legal/documents.ts`(개인정보 처리방침 개정), 탈퇴 경로, `CONTEXT.md` | ✓ | L | L6, §5 직렬 순서 |
| **L8a 공지 바·스트립** | CH-01, CH-02 | migration(`home_curations` kind 확장 + 운영자 RPC 계약 재등록), 공지 바 로더·렌더(`Nav.tsx`), 어드민 큐레이션 폼, `/admin/guide` | ✓ | M | L3 |
| **L8b 컬렉션 배너·추천어·IP 배너** | CL-09, CH-10, IP-06 | migration(큐레이션 kind·IP PC/MO 배너 필드), `Shop.tsx` 배너 슬롯, `SearchOverlay.tsx` 칩, 어드민 폼, `/admin/guide` | ✓ | M | L4·L5·L8a |
| **L9 카트 정합** | CT-01~04 (+S17 셋째 기준) | `components/screens/Cart.tsx`, `wc-catalog.css`(카트 구간) | — | M | L4, §5 직렬 순서 |
| **L10 이벤트·정적 재조판** | EV-01~05, EV-07, CH-11(이벤트 허브 부제) | `CampaignHub.tsx`·`wc-campaign.css`, campaigns 블록 타입 migration + `lib/campaigns.ts` 파서 + 어드민 편집기(`lib/admin/campaigns.ts`, `components/admin/sections/CampaignSection*`), `components/screens/Events.tsx`·`EventDetail.tsx`, `LegalDocument.tsx`, 격리 CSS 2종(`offline-popups-legacy.css`·`legal-doc.css`) 삭제와 `app/layout.tsx` 해당 임포트, `app/editorial-design.test.ts` | ✓ 소폭 | L | L0 |
| L11 (선택) 공지 게시판 | EV-06 | 신규 콘텐츠 도메인 + 어드민 | ✓ | M | LD-12 |
| L12 (선택) 사은품 자동 증정 | CT-06 | ADR 선행: 주문 생성 RPC·할당 재고·취소/반품 처리 | ✓ | XL | LD-9 |

### 3.1 단계별 세부

**L1 상품 상세 구매 경험** — P0 4건이 몰린 단계다.
- **모바일 구매 시트는 `GoodPurchasePanel` 전체를 담는다:** 구매 한도·예약 안내, 직접 입력(필수 항목 — ADR-0019), 추가 구성, 거래 조건, 합계, CTA 또는 재입고, 정기·선물 진입, 상태 문구. LFS 시트 수치(375×291, r 8 8 0 0 등)는 배치 기준일 뿐 필드를 줄이지 않는다. 필드가 많으면 시트 높이는 콘텐츠를 따르고 내부 스크롤한다. 하단 바를 누르면 열리고(`OverlayPortal`+`useOverlayA11y`, 백드롭·ESC 닫기, 포커스 복귀), 모바일 본문의 인라인 폼은 숨긴다. 구매 컨트롤러는 그대로 재사용한다. 품절이면 바 전체가 재입고 알림인 현행 규칙은 유지한다(DESIGN §12).
- **담기 결과 모달**은 카트 반영이 확정된 뒤에만 연다: [장바구니 보기]/[계속 쇼핑](계속 쇼핑 = 닫고 현재 페이지 유지), 헤더 카트 뱃지 갱신. 패널·플로팅 박스·시트·위시(L6)가 같은 모달을 쓴다 — 이 단계가 공용 부품으로 먼저 만든다.
- **데스크톱:** 하부 탭 영역을 탭바 전폭 + 패널 840 + 레일 340으로 바꾸고, 레일 안에 sticky 회색 박스(합계 + [카트 50][구매 226])를 둔다. 뷰포트 고정 미니 바는 없앤다. 문의 런처는 PDP에서 구매 UI와 겹치지 않게 옮긴다(701–989px 포함).
- 모바일 갤러리 풀블리드, '추가정보' 아코디언(고시·배송·교환/반품·판매자 정보 — 기존 고시정보·배송 정책 템플릿·사업자 정보 데이터, 판매자 정보는 LG-8 확정값), 공유(URL 복사·`navigator.share`, SNS SDK 미도입), 품절 합계 결함, 브랜드 칩 카드(IP 이미지, 없으면 텍스트), 상세 패널의 브랜드 스토리·브랜드 카드(IP 소개 데이터, PD-19).
- P2: 합계 위 1px 선, 2CTA 실측 27:73, 별점 행 링크, 재고 라벨, 탭 클릭 스크롤(`TabPanels`에 opt-in prop — 홈·이벤트 허브는 기본 동작 유지), `?variant=` 동기화, 가격 라벨, SALE 배지 파생, JSON-LD·og:price/image.
- 추천 블록(관련 굿즈)은 상세 설명 패널 맨 끝으로 옮긴다(LD-6 확정). 띠배너는 현 위치 유지(PD-16a). MD에게 배치 변경을 공유한다.
- **불변:** 주문 생성·바로구매 경로·결제 계약. 구매 컨트롤러의 담기/구매 함수는 바꾸지 않고 진입 UI만 늘린다.

**L2 품절 옵션·옵션 단위 재입고**
- 다옵션 기본 선택 = 첫 구매 가능 옵션, 품절 옵션도 `· 품절`로 선택 가능 → CTA가 재입고 알림으로 바뀐다(LD-5 — #427 수용 기준 번복, ADR-0015에는 날짜 보완으로 기록).
- `restock_alerts`에 옵션 키를 더한다. 기존 굿즈 단위 신청은 "모든 옵션"(NULL)으로 보존하고, 유일성은 `unique nulls not distinct (user_id, good_id, variant_id)` 또는 부분 유니크 인덱스로 명시한다(평범한 unique는 NULL 중복을 막지 못한다).
- 소비처를 함께 바꾼다: `lib/wishlist.server.ts:60-65`의 `.eq('good_id').maybeSingle()`은 옵션 신청이 2건 이상이면 오류를 내고 `restockRequested=false`로 접힌다(`:70`). 신청 action은 기존 시그니처(`app/shop/actions.ts:86`)를 유지하고 옵션 인자를 받는 새 action을 더한다(DESIGN §11 action 계약).
- **옵션 신청은 옵션 행의 재고 전이로 깨운다:** `goods_variants` 행의 `old.stock_qty <= 0 → new.stock_qty > 0` 전이에서 그 옵션 키의 신청만 발송한다. 굿즈 단위 판매 가능 술어(`20260910072933:911-928`)를 그대로 쓰면 안 된다 — 다른 옵션이 판매 중이면 `goods_variants_refresh_stock` 뒤에도 굿즈 행은 전후 모두 판매 가능이라 `notify_goods_restock`이 아무것도 깨우지 않는다. 부모 굿즈의 판매 가능 게이트(공개·보관·판매 제한 등 재고 외 조건)는 별도로 적용한다. 기존 굿즈 단위 신청(NULL = 모든 옵션)은 지금처럼 굿즈 단위 전이로 깨운다.
- 메일·알림 dedupe 키에 옵션을 넣는다(`:956-959`, `lib/email/dedupe.ts`, `lib/notifications.ts`). 트리거는 주문 생성·취소 환원·재고 조정 트랜잭션 안에서 돌므로 예외를 던지지 않음을 `supabase/tests`의 `checkout_order.sql`·`cart_order_variants.sql`·`commerce_wishlist_restock.sql` 회귀와, "옵션 A 판매 중 + 옵션 B 0→양수" 시나리오 스모크로 확인한다.
- 신규 함수는 `revoke all … from public, anon, authenticated, service_role` 봉인 후 필요한 롤만 grant. `CONTEXT.md`의 **재입고 알림** 정의를 옵션 기준으로 고친다.

**L3 전역 크롬·검색 오버레이·기본 표면**
- 오버레이: 패널이 GNB 행을 덮는 위치, 딤 10% + blur 5px, body 스크롤 고정. ICONS가 이미 가진 ESC·포커스 트랩은 유지한다(레퍼런스 결함 미재현). 데스크톱 입력은 돋보기 안쪽 1180×60, 모바일 칩은 한 줄 가로 스크롤, 오버레이 중 탭바 숨김.
- 축약 기준은 B1 한 쌍(>150 축약 / <64 해제)을 함께 바꾸고, 공지 스트립·공지 바 높이를 양쪽 기준에 더한다(해제만 바꾸면 34~64px이 역전 구간이 된다 — `Nav.tsx:47-51` 히스테리시스 의도 유지).
- 모바일 스크롤 동작(LD-2): 기본값이면 스크롤 시 로고 행을 숨기고 탭 GNB를 유지하며, 하단 탭바는 아래로 300px 이상에서 숨기고 위로 스크롤하면 다시 보인다. `prefers-reduced-motion`에서는 전환 없이 즉시 바꾼다.
- 게이트 누수(푸터 ©·오버레이 placeholder), 인증 화면 전역 크롬(`/login`을 독립 셸에서 제외), 404 2CTA(일러스트는 LG-7), 모바일 푸터 순서·사업자 정보 기본 펼침, GNB 하단 1px, 메가메뉴 첫 링크 라벨 결함, PDP의 GNB 활성 해제, 소셜 공식 마크(각 사 브랜드 가이드 준수), 재설정 안내 1줄. `lib/routes.ts`는 이 단계가 소유하므로 L6의 유틸바 위시 링크 자리도 여기서 만든다.

**L4 목록·검색·온라인 팝업·홈**
- 모든 상품 카드와 홈 리스트 행에 위시 하트(LD-4). 지금은 배치 조회 API가 없고(`getWishlistEntries()`는 전체 목록, `lib/wishlist.server.ts:74`) `WishlistHeart`는 토글마다 `router.refresh()`(`:49`)를 부른다. 목록 페이지에는 로그인 회원의 위시 굿즈 ID 집합을 한 번 내려주고, 카드 하트는 refresh 없이 낙관 갱신 후 실패하면 되돌린다. 비로그인 클릭은 현행 로그인 벽. 이 하트를 `ProductCard` action 슬롯의 공용 부품으로 만들어 L6이 재사용한다.
- 검색 결과: 굿즈샵 사이드바(카테고리·IP·타입·가격) 재사용 + 관련성 정렬 + '전체 › N개 결과' + 모바일 '필터 및 정렬'. IP·카드·포스트 같은 ICONS 통합 검색 결과는 유지한다. 제목·입력 한 줄 배치, 모바일 페이저 5칸·창 단위 점프.
- IP 관 상품 영역을 IP로 좁힌 굿즈샵 컬렉션으로 교체(사이드바·정렬·VIEW MORE·212 카드). 디렉토리 피처드 띠·A–Z 바·모바일 점 표시·모바일 IP 관 정렬.
- 홈: 에디터 모바일 다음 카드 노출 결함, 콘텐츠 카드 배지, 리스트 행 선·하트, '전체보기' 1px `#C8CACC`, 제목 자간 -0.2, 밴드 사이 1px 선, 혜택 타일 아이콘, 다크 면 토큰 정리, 혜택 밴드 게이트 처리(LD-15).
- 컬렉션: SALE 아웃라인 배지, 수량·정렬 줄, 필터 그룹 선, VIEW MORE 896×48 1px `#DCDEE0` r5, NEW 제목 제거, 정렬에 이름 가나다순·역순·오래된 순 추가(집계 불요, LD-13), PRE-ORDER는 타입 축 표기만.
- 카드 별점(CL-02)은 목록 리뷰 집계를 카탈로그 스냅샷에 더하는 읽기 전용 변경이라 별도 커밋으로 둔다.

**L5 카테고리 내비게이션** — LG-3 이후, DB 단계.
- `private.category_display_nodes`에 이미지 열이 없으므로 migration + 어드민 업로드 + `/admin/guide` 갱신이 범위에 들어간다.
- 메가메뉴 = 공개 전시 카테고리 트리 + 기획전 링크, 세로 구분선. 기획전 링크·카드의 데이터 원천은 캠페인(`campaigns`)으로 정하고 정적 배열을 두지 않는다(DESIGN §0). 온라인 팝업 메가메뉴 = 디렉토리 피처드 IP(기존 데이터) + 이미지 타일 2(피처드 상위 2) + 전체보기.
- 모바일 '카테고리' 탭 전용 시트: 아이콘 바로가기 → 기획전 카드 2×2 슬라이드 → 탭 + 아이콘 그리드. 메뉴 시트와 분리한다.

**L6 마이페이지** — 10/14 S16·S14·S15 흡수.
- 데스크톱 좌측 메뉴 셸을 주문 목록·상세를 포함한 모든 하위 화면에 적용한다. 영수증 지면(DESIGN §8)은 셸 안 콘텐츠로 유지한다. 메뉴에 **회원 등급 혜택**을 추가한다.
- `/my` 대시보드: 최근 주문(상태별 건수), 위시 상품, 팔로우한 IP, 쿠폰·적립금 요약, 최근 본 굿즈(LD-16). 모바일은 LD-1a 답대로 — 기본값이면 웰컴 행 → 바로가기 4칸(카운트 배지) → 세로 메뉴(10px 밴드) → 블록 → 로그아웃.
- 프로필 스트립: "한 화면 한 링크" 규율(`MypageShell.tsx:126-127`)은 유지한다 — 메뉴와 같은 목적지 링크를 스트립에 또 두지 않고, 등급 배지와 위시 수는 텍스트로 보인다.
- **회원 등급 혜택** 페이지(`/my` 하위, 로그인 필요): 등급 조건은 기존 `get_my_loyalty_status()`를 재사용한다. 새 읽기 RPC는 등급별 혜택만 돌려준다 — 등급 혜택 쿠폰의 이름·혜택·최소 주문 금액·유효 기간(코드 제외), 등급 적립률. 봉인 후 `authenticated`에만 grant한다. 배지 색은 `--wc-loyalty-*` 토큰을 쓰고, DESIGN §2 "사용처는 두 곳으로 폐쇄" 목록에 이 페이지를 추가한다.
- 위시: 굿즈 그리드 5열(L4 하트 부품으로 플로팅 제거), 수량 없는 '장바구니 담기'(showCart와 무관, 담은 뒤 L1 모달), **'팔로우한 IP' 탭**(위시리스트는 굿즈만 — `CONTEXT.md`). 데스크톱 위시 진입은 유틸바 링크(L3이 만든 자리, 헤더 아이콘 3개 문법 유지).
- 주문 목록 상단 리뷰 보상 배너: 주문에 든 굿즈 ID로 `get_goods_review_events`를 조회해 진행 중인 이벤트가 있을 때만 기존 `ReviewEventBanner`를 보인다. 보상 명칭은 이벤트 기준(적립금 등)이다. 배송과정 안내, 설정의 약관 링크·비밀번호 변경 진입, 쿠폰함 수치(MY-14).

**L7 주소록** — 10/14 S6b·S3(+S6a, LD-1b) 흡수. 완료 기준은 §1. 추가 DoD:
- 개인정보 처리방침 개정: `lib/legal/documents.ts`의 수집 항목(지금은 "굿즈 주문·배송 — 주문 시"만, `:489`)에 주소록의 수집 시점·보유 기간을 더하고, 이전 판 보존·개정 고지를 함께 한다.
- 쓰기 RPC는 탈퇴 진행 중 계정을 `private.is_account_write_fenced`로 거절한다(기존 관례: `product_questions`·`coin_participation`).
- 탈퇴 시 주소록 삭제 범위를 정하고 SQL smoke로 고정한다.
- `CONTEXT.md`에 **주소록** 용어를 추가한다.

**L8a 공지 바·스트립**
- 텍스트 공지 바: `home_curations` kind 확장(문구·CTA 라벨·링크·노출 기간·대상 페이지 유형), 이미지 스트립 위.
- **이미지 스트립(CH-02):** 지금 `getActiveNoticeStrip()`은 결정적 정렬 + `.limit(1)`이라 후보가 여럿이어도 늘 같은 1장만 나온다. 유효한 스트립 전체(기간·대상 페이지 유형 포함)를 쿠키 없는 캐시 읽기로 내려 클라이언트에서 pathname으로 페이지 유형을 거른 뒤 남은 후보 중 무작위 1개를 고른다(레퍼런스: 컬렉션 페이지 미노출). 노출·클릭 집계는 동의 기반 1st-party 분석(`/api/store-analytics`, `lib/store-analytics.ts` — 지금은 페이지뷰만)에 공지 노출·클릭 이벤트 종류를 더한다: 수집 API·저장 스키마·어드민 집계 표시·테스트까지 이 단계 범위. 전역 셸 공지는 **쿠키 없는 캐시 읽기**를 유지한다(`lib/notice-strip.server.ts:22-28` — 법적 문서 SSG 붕괴 이력 #325). 그래서 닫힘(sessionStorage)과 대상 페이지 판정(pathname)은 클라이언트에서 한다. 오버레이·sticky 오프셋은 실제 크롬 높이로 계산한다(레퍼런스의 모바일 가림 결함 회피).
- `admin_upsert_home_curation`은 운영자 RPC 계약에 시그니처로 등록돼 있다(`20261020085215:16778`). 함수를 바꾸면 migration에서 `private.register_operator_rpc_contract`로 재등록하고 `operator_capability_coverage.sql`을 통과시킨다.
- 배포 전 운영 `home_curations` 실데이터가 새 CHECK 제약을 통과하는지 SELECT로 미리 확인한다(9/1 전환 때 23514 실패 이력).

**L8b 컬렉션 배너·추천어·IP 배너** — 굿즈샵 전체 슬라이드·BEST·NEW 배너, 추천 검색어 운영 편집, IP 관 PC/MO 배너 필드. 어드민 폼 최소 지원과 `/admin/guide` 주제 갱신. L8a와 같은 운영자 RPC 계약·CHECK 사전 검증 규칙.

**L9 카트 정합** — 요약 회색 박스와 총액 강조, 빈 상태(라인아트 LG-7, CTA 220×60 액센트, 둘러보기 버튼은 직전 목록으로), 모바일 서브헤더 + 하단 고정 주문 CTA, 목록 2px 선·64 썸네일·옵션 밴드(출고지 그룹은 유지). 카트 로직은 바꾸지 않는다.

**L10 이벤트·정적 재조판**
- 이벤트 허브 머리·탭 카운트 제거, 부제의 카드 게이트 누수 제거, EVENT·DROP 10건 + 더보기, 배너 autoplay 5s(정지·reduced-motion 규칙).
- 캠페인 `cta` 블록: `validate_campaign_sections`·`lib/campaigns.ts` 파서·어드민 편집기를 함께 바꾼다. 링크 정책은 LD-18.
- 오프라인 팝업: 목록 = R-06 §1.4 카드 + 기간·상태, 상세 = R-06 §2.3 안내형 + R-04 buybox 문법. 회차·잔여·예매·검표 계약 동결.
- 법적 문서: 620 `document-page`(개정 공지·표·이전 판 유지, 정적 파라미터 유지).
- DESIGN frontmatter `retained-legacy-surfaces`에서 오프라인 팝업·법적 문서를 빼고 `/about`만 남기며, "재조판은 후속" 문구를 about 보존(ADR-0011, LD-11)에 맞게 고친다(EV-07).
- 삭제는 `offline-popups-legacy.css`·`legal-doc.css` 임포트와 그 전용 선택자로만 한정한다. **Space 폰트 로드(`app/layout.tsx:103-112`)는 유지한다** — `/about`(`about-legacy.css:9,28-29`)과 게임 HUD가 쓰고, `app/editorial-design.test.ts:52-64`의 해당 단언은 완화하지 않는다(DESIGN §11 회귀 기준선).

## 4. 결정 항목

| ID | 결정 | 기본값 | 근거 |
|---|---|---|---|
| LD-1 | 10/14 백로그와 겹치는 항목 | **확정: 이 계획이 흡수(§1)** | 같은 파일을 두 트랙이 고치면 충돌한다. LFS 문법과 회의 완료 기준을 한 번에 충족 |
| LD-1a | S16의 "390px은 기존 모바일 패턴" | **확정: LFS 모바일 대시보드로 대체** | 회의 요구는 PC 좌측 메뉴 + 대시보드였고, 모바일 대시보드는 그 모바일 짝이다 |
| LD-1b | S6a(주문서 배송지 미리 채우기 정정) | **확정: L7에 흡수** | 주소록이 프리필 자체를 대체한다 |
| LD-2 | 모바일 스크롤 동작(MC-01 축약 방향, MC-02 탭바 숨김) | **확정: LFS 동작 채택** | 레퍼런스의 의도된 동작이고 8/26 기록이 틀렸다. 대가: 스크롤 중 헤더의 검색·카트 아이콘이 사라진다(레퍼런스와 같음) |
| LD-3 | 출고 방식 | 단계별 PR → main, PR마다 머지 승인 | 표면별 보정이라 독립 배포가 안전하고 빠르다 |
| LD-4 | 목록 카드·리스트 행 위시 하트 | 채택(#326 결정 번복) | 레퍼런스 전 표면에 있고 위시 기능은 이미 있다 |
| LD-5 | 다옵션 기본 선택·품절 옵션 선택 + 옵션 단위 재입고 | 채택(#427 수용 기준 번복, ADR-0015에 날짜 보완) | 지금은 품절 옵션의 재입고 신청 경로가 없다. `DESIGN.md:271` `restock-cta`와도 맞춘다 |
| LD-6 | PDP 추천 블록 위치(탭 위 ↔ 상세 패널 끝) | **확정(2026-10-22): 상세 패널 끝** | 스마트스토어 대조로 MD가 정한 배치를 바꾸는 문제다. 띠배너는 서로 다른 장치라 현 위치 유지(PD-16a) |
| LD-7 | 목록 카드 설명 줄 | 운영 설정을 끈다(LG-6), 코드 기본값은 유지 | 레퍼런스 카드에 없다. 운영 설정이라 코드 변경 불요 |
| LD-8 | 배송 메모 위치 | 주문서 유지, DESIGN `mini-checkout-cart` 문구 정정(L0) | 메모는 주문 생성 계약의 일부라 카트로 옮기면 주문 생성 경로가 바뀐다 |
| LD-9 | 사은품 자동 증정 | 이번 범위 제외(L12 선택) | 주문 생성·할당 재고·취소/반품에 닿는다. 도입하면 ADR부터 |
| LD-10 | 게스트 찜 | 적용 안 함 | 위시리스트 용어 정의(로그인 사용자)와 RLS가 바뀐다 |
| LD-11 | /about | 구 홈 콘텐츠 보존(ADR-0011), DESIGN frontmatter의 "재조판 후속" 문구 정리(L0) | 결정된 보존 대상 |
| LD-12 | 공지 게시판 | 이번 범위 제외(L11 선택) | 새 콘텐츠 도메인이 필요하다 |
| LD-13 | 정렬 | 이름 가나다순·역순·오래된 순 추가(L4), 베스트셀러는 보류 | 세 가지는 집계가 필요 없다. 판매 순위(`get_home_sales_rankings`)는 운영 가주문이 섞여 있어 지금은 왜곡된다 |
| LD-14 | 푸터 대량구매·제휴 링크 | 넣지 않음(필요 시 1:1 문의로) | 콘텐츠·영업 결정 |
| LD-15 | 카드 리워드 게이트 OFF일 때 홈 혜택 밴드 | 카드·게임 목적지가 아닌 혜택 타일은 게이트와 무관하게 노출(다른 큐레이션처럼 목적지 기준으로 거름), DESIGN §7-9 갱신 | 지금은 게이트가 밴드를 통째로 비워 LG-1을 마쳐도 홈이 6밴드다 |
| LD-16 | 대시보드 최근 본 굿즈 | 상세 경험 `interests` 스위치를 따른다(OFF면 블록 숨김) | 기록·저장 고지(`ProductInterestShelf.tsx:58`)가 운영 스위치에 묶여 있다. 스위치와 분리하려면 고지 문구와 함께 따로 정한다 |
| LD-17 | `/shop/best` 큐레이션 공백 시 판매 순위 폴백 | 하지 않는다(LG-1 편성으로 해소) | 큐레이션이 BEST 정본이라는 설계(`app/shop/best/page.tsx:15-18`)와 가주문 왜곡 |
| LD-18 | 캠페인 `cta` 블록 링크 | ICONS 내부 경로만 허용 | 외부 링크는 피싱·추적 위험. 필요해지면 허용 도메인 목록을 따로 정한다 |

## 5. 순서와 병렬화

**10/14 트랙과 같은 파일을 만지는 PR은 동시에 열지 않는다.**

| 파일·영역 | 이 계획 | 10/14 | 기본 순서 |
|---|---|---|---|
| `GoodPurchasePanel.tsx` | L1, L2 | PR-3(S10 바로구매 `:296-300`) | L1 → L2 → PR-3. L1·L2는 구매 함수를 바꾸지 않아 PR-3의 재작업이 작고, L1이 P0다. PR-3가 먼저 착수돼 있으면 그 PR이 끝난 뒤 L1 |
| `GoodDetail.tsx` 배송 안내 | L1(PD-06) | PR-1(S7 출고지명 제거) | PR-1(작은 문구 PR) → L1 |
| `Orders.tsx`·`OrderDetail.tsx` | L6 셸 래핑 | PR-1(S19~S21) | PR-1 → L6 |
| 주문서 2벌·`lib/checkout.server.ts`·온보딩 | L7 | PR-1(S2), PR-3·PR-4, PR-16 | PR-1(S2, S6a 제외) → L7 → PR-3·PR-4 → PR-16. PR-3·PR-4가 먼저 시작되면 L7은 그 뒤 |
| `Cart.tsx` | L9 | PR-1(S7), PR-3·PR-4 | PR-1 → L9, PR-3·PR-4와는 먼저 시작한 쪽이 끝난 뒤 |

이 계획 안의 순서:

| 웨이브 | 단계 | 비고 |
|---|---|---|
| W-A | L0 → L1 ‖ L3 ‖ L10 | `CampaignHub.tsx`는 L10 단독 소유. `TabPanels.tsx`는 L1이 opt-in prop만 더한다 |
| W-B | L2(L1 후) ‖ L4(L1·L3 후) ‖ L6(L1 모달·L4 하트 부품이 머지된 뒤) ‖ L8a(L3 후) | L6은 공용 부품을 기다린다 |
| W-C | L7(L6 후, 위 직렬 순서) ‖ L5(L3 후, LG-3 완료) ‖ L9(L4 후, 위 직렬 순서) | — |
| W-D | L8b(L4·L5·L8a 후) | `Shop.tsx`·`SearchOverlay.tsx`를 마지막에 만진다 |

병렬로 진행할 때: 단계마다 별도 워크트리·브랜치·격리 DB, 착수 전 파일 소유와 migration 타임스탬프 구간 배정, 공유 개발 DB 사용 금지, 전역 lint·typecheck·test·build는 통합 시점에.

## 6. 검증 (모든 단계 공통 DoD)

1. **테스트:** 관련 vitest와 클래스명을 단언하는 컴포넌트 테스트 갱신, 새 동작 테스트(시트·모달 포커스, 서버 반영 후 모달, 옵션 단위 재입고 멱등 등). `npm run lint`·`typecheck`·`build`. 기존 계약 테스트의 단언을 완화해 통과시키지 않는다(DESIGN §11).
2. **DB 단계:** 격리 로컬 스택(`SUPABASE_WORKDIR`)에 **Supabase CLI 2.109.1**(`.github/workflows/pipeline.yml:42-44`와 같음)로 migration 적용·reset, SQL smoke, 함수 봉인(anon·authenticated 거절) 확인. 기존 개발 DB는 reset하지 않는다.
3. **브라우저 QA:** 격리 스택 + 운영 빌드(`build:local`·`start:local`)에서 1440·375(10/14 기준 390도) 고객 시나리오. 운영에서 못 본 상태는 시드해서 확인한다 — 다옵션(품절 옵션 포함)·품절·예약판매·**직접 입력 필수·추가 구성·선물·정기구매 대상 굿즈의 375px 담기·구매 완주**·담긴 카트·캠페인.
4. **REA 패리티 QA:** 단계가 건드린 표면마다 같은 REA 시나리오를 LFS(이번 근거 캡처 재사용, 재방문은 단계당 1회 이내)와 ICONS 로컬 빌드에 돌려 나란히 비교 이미지와 측정값을 PR에 남긴다. 건드리지 않은 표면은 변경 전후 ICONS 캡처를 `compare-web-screenshots`로 회귀 확인한다.
5. **적대적 리뷰:** 독립 서브에이전트 리뷰 — 재현 시나리오를 못 쓰는 지적은 버리고, 남은 지적은 심각도와 무관하게 수정 단계로.
6. **문서:** 바뀐 패턴의 `DESIGN.md`, 11 §8 완료 표시, 새 용어 `CONTEXT.md`, 결정 보정(LD-5 → ADR-0015 날짜 보완, LD-9 도입 시 신규 ADR), 어드민 폼이 바뀌면 `/admin/guide` 주제와 업데이트 내역(가이드 계약 테스트), 개인정보 처리방침(L7).
7. **CI·배포:** 필수 CI green, preview 격리(ADR-0006). 머지는 PR마다 사용자 명시 승인, 배포 뒤 iconsip.com REA 캡처로 실측 확인, 이슈 close·Project Done 확인.

## 7. 리스크

- **10/14 트랙과 같은 파일**(구매 패널·주문서·카트·주문 화면·온보딩) — §5 직렬 순서로 막는다. 두 트랙이 동시에 진행되면 착수 전에 파일 소유를 다시 배정한다.
- **PDP 구매 진입 변경**이 결제 경로에 미치는 영향 — 구매 컨트롤러 재사용, 주문 생성 계약 무변경을 기존 계약 테스트로 증명한다. 모바일 시트가 패널 필드를 빠뜨리면 해당 굿즈를 모바일에서 살 수 없으므로 §6-3 시드 시나리오로 막는다.
- **재입고 옵션 단위 전환** — 기존 신청 보존(NULL = 모든 옵션), NULL 중복 방지 제약, 다건 조회 소비처, 재고 트랜잭션 안 트리거 예외를 SQL smoke로 고정한다.
- **주소록** — 주문에 저장되는 주소 JSON은 그대로 두고 입력 보조로만 쓴다. 처리방침·탈퇴 펜스·삭제 범위 누락은 개인정보 위반이므로 DoD로 막는다.
- **운영 슬롯 확장** — 운영 CHECK 제약 사전 검증, 운영자 RPC 계약 재등록, 전역 셸 캐시(쿠키 없는 읽기) 유지.
- **운영 데이터 공백** — LG-1·LG-2가 진행되지 않으면 코드 단계를 모두 끝내도 라이브 홈은 레퍼런스와 다르게 보인다.
- **레퍼런스 재방문 차단**(8월 Cloudflare 이력, 이번엔 없음) — 이번 근거 자료를 기준으로 QA하고 재캡처는 최소화한다.

## 8. 티켓 구조 (승인 후 생성)

- 에픽: `feat(storefront): LINE FRIENDS SQUARE 패리티 2차 (2026-10)` — 이 문서·11 링크, 단계 체크리스트.
- 단계 티켓: L0~L10(L8a·L8b 분리, +승인 시 L11·L12). 본문에 범위 ID·주요 파일·DoD·선행.
- 운영 게이트 티켓: LG-1~LG-9(`ready-for-human`).
- Project #8에 등록, 형식은 `docs/agents/issue-tracker.md`·`triage-labels.md`.
- 10/14 백로그의 흡수 항목은 backlog.md에 이관 표시하고, 10/14 이슈를 만들 때 이 에픽 티켓을 연결한다.
