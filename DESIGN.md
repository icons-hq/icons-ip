---
name: ICONS — White Catalog v4
status: implemented
description: >
  화이트 캔버스, 무채색 잉크, 단일 brand-green 액센트, radius 0의 각진 플랫,
  스크롤 연출 없는 정적 카탈로그 커머스 디자인 시스템.
  linefriendssquare.com의 레이아웃·IA·컴포넌트 문법을 재현 스펙(docs/research/linefriends-square/)
  기준으로 이식하되, 레퍼런스의 자산·문구·핑크 액센트는 재사용하지 않는다.
  v5(§14): 셸·홈·NEW·BEST·카테고리·POP-UP·EVENT는 X SQUARE Figma 문법(잉크 액센트·둥근 카드·1320 컨테이너)이 시각 정본이며
  이 표면들에서는 위의 "단일 brand-green 액센트·radius 0"이 표면별 예외를 가진다.
authority:
  decision: docs/adr/0011-lfs-storefront-redesign.md
  x-square-decision: docs/adr/0043-xsquare-figma-storefront.md  # 셸·홈·NEW·BEST·카테고리·POP-UP·EVENT의 시각 정본(v5, §14) — ADR-0011의 해당 표면 부분을 대체
  x-square-figma: https://www.figma.com/design/L1C8DusFalAh7EZ5dhxugE/ICONS  # 2026-11-12 신사업팀 Figma(Main·New·Best·Category·POP-UP·Event, 1920 캔버스)
  reproduction-spec: docs/research/linefriends-square/
  product-language: CONTEXT.md
  product-scope: docs/PRD.md
  architecture: docs/ARCHITECTURE.md
  target-design: DESIGN.md
  target-code:
    foundation: app/styles/wc-foundation.css
    chrome: app/styles/wc-chrome.css
    store-branding: app/styles/wc-store-branding.css
    home: app/styles/wc-home.css
    product-mosaic: app/styles/wc-product-mosaic.css
    product-collection: app/styles/wc-product-collection.css
    shopping-stories: app/styles/wc-shopping-stories.css
    catalog: app/styles/wc-catalog.css
    document-formatting: app/styles/content-format.css # 상품 상세·스토리의 허용된 본문 서식만 공유
    good-relation-visual: app/styles/wc-good-relation-visual.css
    store-presentation: app/styles/store-presentation.css
    product-detail-presentation: app/styles/product-detail-presentation.css
    product-detail-experience: app/styles/product-detail-experience.css
    goods-media: app/styles/goods-media.css
    goods-review-best: app/styles/goods-review-best.css
    goods-benefits: app/styles/goods-benefits.css
    goods-after-sales: app/styles/goods-after-sales.css
    goods-size-chart: app/styles/wc-goods-size-chart.css
    review-events: app/styles/wc-review-events.css
    marketing-message: app/styles/marketing-message.css
    claim-collection-plan: app/styles/claim-collection-plan.css
    claim-fees: app/styles/claim-fees.css
    purchase-confirmation: app/styles/purchase-confirmation.css
    discovery: app/styles/wc-discovery.css
    account-commerce: app/styles/wc-account-commerce.css
    campaign: app/styles/wc-campaign.css
    storefront-x: app/styles/wc-storefront-x.css  # X SQUARE 공용 부품(넓은 컨테이너·상품 카드·그리드·섹션 머리·스트립 배너) — ADR-0043, §14
    listing: app/styles/wc-listing.css            # NEW·BEST·카테고리 목록 머리·칩·슬라이더 — ADR-0043
    popups: app/styles/wc-popups.css              # POP-UP·EVENT 목록과 PromoCard — ADR-0043
    offline-popups: app/styles/wc-offline-popups.css  # /offline-popups·/offline-popups/[eventId]
    document: app/styles/wc-document.css              # document-page — /legal/*
  admin:
    typography: app/styles/admin-font.css  # 어드민 전용 로컬 Pretendard 1.3.9
    template-kit: app/styles/admin-kit.css  # ADR-0028 shadcn/ui 템플릿 룩 — 토큰·@theme·방향 변형·콘솔 base
    kit-dress: app/styles/admin-kit-vocabulary.css  # 콘솔이 소유하지 않는 고객 부품·네이티브 입력에 kit 모양
    tokens: app/styles/wc-admin.css  # 콘솔이 읽는 --wc-* 의미색 이름(→ shadcn 토큰)·키보드 툴팁
    surfaces: app/styles/wc-admin-surfaces.css  # 공개 상품 상세 미리보기 보정·데이터 속성 색만
    components: components/admin/kit/  # shadcn CLI 복사 소스(Base UI)
    boundary: .wc-admin
  global-plumbing: app/globals.css  # Tailwind·Pretendard·element 리셋·공용 구조 유틸, 그리고 셸 고정 크롬을 따르는 html scroll-padding-top(해시 착지선)·화면 아래 고정 층을 따르는 scroll-padding-bottom(하단 착지선)만 소유
  retained-legacy-surfaces:         # 의도적으로 구 조판을 보존하는 공개 표면 — 자기 앵커 안 격리 CSS로 자립
    - app/styles/about-legacy.css           # /about — 구 홈 콘텐츠 보존 전시(ADR-0011, LD-11)
  route-map: lib/routes.ts
  note: >
    status=implemented: 공개 스토어프론트 전 표면이 이 시스템으로 이행됐다(S1~S9, 통합 브랜치
    ps/feat/lfs-storefront-redesign). 직전 시스템(Living IP Editorial)의 공개 표면 CSS 3파일은
    S9에서 삭제됐다. 어드민은 ADR-0028로 shadcn/ui 템플릿 룩(kit 부품·Tailwind)이며, globals.css는 전역 하부만 소유한다.
    retained-legacy-surfaces의 /about은 재조판 대상이 아니라 구 홈 콘텐츠를 보존 전시하는 표면이다
    (ADR-0011 · 패리티 2차 LD-11) — 자체 스타일(about-legacy)을 유지하고 전역 셸만 White Catalog을 쓴다.
    S9에서 함께 격리했던 오프라인 팝업·법적 문서는 패리티 2차 L10(2026-10)에서 재조판하고
    격리 CSS(offline-popups-legacy·legal-doc)를 지웠다.
    v5(2026-11-17, ADR-0043): 셸·홈·NEW·BEST·카테고리·POP-UP·EVENT와 상품 카드는 X SQUARE Figma가 시각 정본이다(§14).
    나머지 표면과 이 문서의 v4 절은 그대로 유효하고, 아래 절 중 v5 표면에 해당하는 규칙은 §14가 우선한다.
reference:
  source: https://linefriendssquare.com (2026-08-26 실측)
  restrictions:
    - 레퍼런스의 코드·이미지·캐릭터·로고·마케팅 카피·액센트 색을 복제하지 않는다.
    - 구조·수치·동작만 재현하며, 콘텐츠는 전부 현재 ICONS 카탈로그·큐레이션 데이터로 렌더한다.
    - 재현하지 않는 결함 목록은 docs/research/linefriends-square/00-overview.md를 따른다.
canvas: white-catalog
breakpoints:
  mobile: "<750px"
  tablet: "750–989px"
  desktop: ">=990px"
  container: 1212px
---

# ICONS — White Catalog v4

> 색은 상품과 IP 이미지가 낸다. 크롬은 흰 종이, 검정 잉크, 초록 한 점.
> 이 문서는 기계 판독 가능한 구현·검수 정본이다. 표면별 상세 수치는 재현 스펙(docs/research/linefriends-square/, 이하 "R-스펙")의 해당 문서를 인용한다.
>
> **적용 범위(v5, 2026-11-17)**: 셸(롤링 띠배너·유틸 메뉴·1단 헤더·GNB·푸터·검색 패널)·홈·NEW·BEST·카테고리·POP-UP·EVENT와 상품 카드는 X SQUARE Figma가 시각 정본이다 — [ADR-0043](docs/adr/0043-xsquare-figma-storefront.md), 이 문서 §14. 이 표면들에서 §2~§8의 수치와 규칙이 §14와 어긋나면 §14가 우선하고, 어긋나는 v4 규칙은 지우지 않고 그대로 둔다(이행하지 않은 표면의 정본이기 때문이다). IP관(`/ip/[id]`)의 굿즈 목록은 2026-11-24부터 카테고리 화면과 같은 틀(제목·정렬·`ListingGrid`, 필터 없음)이다. 그 밖의 표면(상품 상세·카트·체크아웃·마이·검색·오프라인 팝업·법적 문서·인증)은 v4 그대로다.

## 0. 상태와 적용 원칙

- 근거 결정은 [ADR-0011](docs/adr/0011-lfs-storefront-redesign.md)이다. 공개 스토어프론트 전 표면이 이 시스템으로 이행됐고, 직전 시스템(Living IP Editorial)의 공개 표면 CSS 3파일과 1세대 잔재(Holographic Midnight)의 공개 표면 규칙은 S9에서 제거됐다.
- **X SQUARE 표면(v5)**: 위 근거 결정 중 셸·홈·목록·POP-UP·EVENT의 시각·IA·수치는 [ADR-0043](docs/adr/0043-xsquare-figma-storefront.md)이 대체한다. 새 토큰은 `--wc-x-*`, 공용 부품은 `components/wc`(`ProductCard`·`ProductGrid`·`SectionHeader`·`StripBanner`·`PromoCard`), 정본 절은 §14다. ADR-0011의 금지선(레퍼런스 자산·카피·핑크 재사용 금지)과 §11의 동결 경계는 그대로 유효하다.
- **어드민**(`/admin/**`)은 White Catalog이 아니라 shadcn/ui 템플릿 룩이다(ADR-0028, 2026-11-06 전 화면 전환). 화면은 `components/admin/kit/` 부품과 Tailwind 유틸리티로 그리고, `globals.css`의 관리자 규칙은 sticky 상단 막대 48을 비키는 `html:has([data-admin-header])`의 scroll-padding-top 한 줄뿐이다(해시 착지·키보드 포커스용). 어드민 전용 규율은 §어드민 콘솔을 따른다. **`/about`**은 구 홈의 콘텐츠를 보존하는 표면으로 자체 스타일(about-legacy)을 갖고 전역 셸은 White Catalog을 쓴다.
- **오프라인 팝업**(`/offline-popups`·`/offline-popups/[eventId]`)과 **법적 문서**(`/legal/*`)는 S9에서 격리 CSS로 자립시켰다가 패리티 2차 L10(2026-10)에서 §8 플레이북대로 재조판했다(`wc-offline-popups.css`·`wc-document.css`). 구 조판을 보존하는 공개 표면은 `/about` 하나다.
- 시각·IA는 전면 교체하지만 기능 계약(인증, 카트, 주문, 결제, 예매, QR, 권한)은 §11의 동결 경계를 따른다.
- 용어는 `CONTEXT.md`를 따른다: **온라인 팝업**(구 IP 허브), **오프라인 팝업**(예매 도메인), **이벤트**(캠페인 허브), **카테고리**(굿즈 분류).
- 실데이터 원칙: 새로 보이게 하려고 정적 배열, 가짜 수치, 가짜 후기, 존재하지 않는 링크를 넣지 않는다.

## 1. 정체성

**White Catalog**은 상품이 주인공인 백화점 진열대다. 크롬은 존재감을 지우고(흰 지면·각진 플랫·그림자 1종·연출 없음), 정보는 밀도 있게 정렬되며, 액센트는 "지금 주목할 것" 하나만 가리킨다.

1. **지면은 항상 희다.** 섹션 구분은 색면이 아니라 여백과 헤어라인이 한다.
2. **액센트는 한 색, 한 역할.** brand-green은 활성·주목·행동 유도에만 쓴다. 화면을 초록으로 칠하지 않는다.
3. **연출보다 목록.** 스크롤 트리거 애니메이션, 패럴랙스, 대형 타이포 연출을 쓰지 않는다. 움직임은 캐러셀·전환·피드백뿐이다.
4. **유산 예외**: IP 액센트 메타(`lib/ip-display.ts`)는 IP 식별 국소 요소로 유지한다(수집형 카드의 foil·rarity 물성은 카드 화면과 함께 2026-11-24 삭제, ADR-0052). `/about`은 직전 시스템의 파스텔 연출을 보존 전시한다.

## 2. 색상 토큰

R-스펙 07 §1의 무채색 축을 그대로 채택하고, 액센트만 핑크→green으로 치환한다(치환 사용처 16곳: R-스펙 07 §1.2 표).

```yaml
colors:
  surface:
    default: "#FFFFFF"        # body·헤더·시트·탭바
    grey: "#F6F8FA"           # 푸터·검색 인풋·시트 디바이더
    grey-2: "#F3F3F3"         # 회색 대비 섹션
    icon-tile: "#F8F8F8"
  ink:
    default: "#111111"        # 본문·헤딩·가격 (#121212와 통합 취급)
    sub: "#3F3F3F"            # 카드 타이틀·푸터 본문
    tertiary: "#616161"       # 유틸바·옵션 라벨
    disabled: "#BBBBBB"       # placeholder·취소선 정가·비활성
  line:
    hairline: "#EBEDEE"       # 푸터/탭바/패널 상단
    hairline-soft: "#F0F2F4"  # 검색 오버레이 상단(레퍼런스 실측, 11 §4) — 헤더 하단 선은 MD-0045로 지웠다
    hairline-dark: "rgba(17,17,17,.1)"
    control: "#C8CACC"        # 아웃라인 버튼 보더
    control-soft: "#DCDEE0"   # 목록 VIEW MORE 선(R-03 §0 컨트롤 선 · 11 CL-07) — 토큰 --wc-line-control-soft
    divider: "#A0A0A0"        # 푸터 링크 세로 구분선
  accent:
    default: "#78BB53"        # brand-green — 유일 액센트
    tint: "rgba(120,187,83,.12)"  # 뱃지 bg·칩 bg
  state:                      # 폼·상태 피드백 (Living IP Editorial 승계)
    success: "#3F7D38"
    warning: "#9A5B00"
    danger: "#B8324A"
    info: "#365CA8"
    focus: "#5B74FF"
  dim: "rgba(0,0,0,.7)"       # 시트·오버레이 딤
  scrim: "rgba(0,0,0,.3)"     # SOLD OUT 밴드
```

### 액센트 사용처 (전수 — 이 밖에 쓰지 않는다)

**비텍스트·장식**(brand-green 유지): GNB 3px 밑줄바, 카트 수량 뱃지 bg, 카드 뱃지 tint bg, 위시 하트 선택됨, 인풋 caret, 추천 검색어 칩 bg, `.wc-btn.accent` 변형, 온라인 팝업 팔로우 카운트, 알림함 안읽음 점(S6 — sr-only 텍스트 병행으로 색 단독 전달 금지 준수).

**소형 액센트 텍스트**(S4에서 확정 — brand-green 2.3:1은 AA 미달이라 `state.success` #3F7D38 사용, 토큰 `--wc-success`): GNB hover/active 텍스트, 메가메뉴 현재 링크 텍스트, 카드 뱃지 텍스트, 세일 할인율 텍스트, 추천 검색어 칩 텍스트, 폼 검증 피드백 텍스트.

**파괴 행동은 `state.danger`**를 쓰고 액센트로 위장하지 않는다.

> v5 표면(§14)에는 이 사용처 목록이 적용되지 않는다. 그 표면들의 GNB 현재·hover 표시는 잉크 밑줄이고 알림·장바구니 수량 배지는 잉크 바탕이다. 초록이 남는 곳은 v5가 건드리지 않은 위 목록의 나머지 표면뿐이다. 하나의 사이트 안 두 문법의 통일은 ADR-0043의 후속 결정이다.

### 규칙

- 다크모드 없음 — 단일 라이트 테마. `color-scheme: light`.
- 흰 글자는 잉크 면(primary 버튼·구매바·홈 상품 모자이크 면·리뷰 이벤트 강조형 배너 — 색은 `--wc-ink` 토큰, 하드코딩 다크 금지 · 11 HM-08)과 이미지 스크림 위에만 쓴다.

### 회원 등급 뱃지 색 (B2에서 확정 — 액센트 단일 규칙의 명시적 예외)

등급 4단(WELCOME/SILVER/GOLD/PLATINUM — VIP·티어 어휘 금지, CONTEXT.md)의 뱃지에만
쓰는 틴트 배경 + AA 잉크 쌍. 레퍼런스의 배지 색 체계에서 핑크·퍼플 원색을 치환했다.
사용처는 프로필 스트립 등급 뱃지, 쿠폰함의 등급 혜택 뱃지, 회원 등급 혜택 페이지(`/my/grade-benefits`)의 등급표 뱃지 세 곳으로 폐쇄한다(패리티 2차 L6 · MY-05).

```yaml
loyalty:
  welcome: { bg: "rgba(120,187,83,.12)", ink: "#3F7D38" }   # 액센트 틴트 + success 잉크
  silver:  { bg: "#F3F3F3", ink: "#5A5A5A" }
  gold:    { bg: "#FBF3D9", ink: "#8A6D1B" }
  platinum: { bg: "#EFE9F7", ink: "#5B4791" }
```

토큰은 `--wc-loyalty-{grade}-bg` / `--wc-loyalty-{grade}-ink`.

## 3. 타이포그래피

- **Pretendard 단일 서체**(영문 포함). `html` 루트 10px 기법은 **채택하지 않는다**(Tailwind rem 스케일 충돌) — 수치는 px 직접 지정.
- 국문 letter-spacing은 음수가 기본(-0.2~-0.8px). 본문·폼 라벨은 -0.2px까지만.

```yaml
type:                       # size / weight / letter-spacing / line-height
  body: { desktop: "16/400/-0.2/1.8", mobile: "14/400/-0.2/1.8" }
  section-title: "28/700/-0.2"            # 홈·목록 섹션 헤딩 (브레이크포인트 무관) — R-02 §1-1 실측, 자간은 2026-10 재실측 -0.2(11 HM-05). R-07 h2 축의 24는 베이스 스케일로, 표면 수치는 표면 문서가 이긴다
  page-h1: "26/700/-0.8/1.3"
  banner-title: "22/700/-0.55/1.09"        # 배너 이미지 위 (흰 글자)
  hero-copy: "24/700 캐치 + 15/400 부제"    # 홈 히어로 오버레이 (R-02 §2①, 흰 글자)
  pdp-title: { desktop: "18/700/-0.5/1.11", mobile: "16/700" }
  module-title: "18/700/-0.4"              # 모달·추천상품·시트 섹션
  card-title: "13/400/-0.2/1.35"           # 색 ink.sub
  card-price: "14/600/0/17px"              # 모바일 15/600
  price-strike: "14/400 line-through"      # 색 ink.disabled
  badge: "11/600/0/18px"
  gnb: { desktop: "16/700/-0.2/50px", mobile-tab: "17/700/0/51px uppercase" }
  utility-bar: "12/400/-0.2"
  button: "18/700/0/1.11"                  # .wc-btn
  button-form: "15/400/+1"                 # 폼 잔여 버튼
  footer-link: "15/700/0/17px"
  footer-body: "13/400"
  tabbar-label: "10/700/0/1"
  caption: "12/400/+0.7"
  form-feedback: "13/400/-0.38"            # 색 accent 또는 state.danger
```

- 한국어 제목·본문은 `word-break: keep-all`, 기술 문자열(ID·URL)만 `overflow-wrap: anywhere`.

## 4. 레이아웃과 공간

```yaml
layout:
  container: "max-width 1212px, padding 0 16px"   # 콘텐츠 1180px
  mobile-gutter: 16px
  section-gap: { desktop: "120–140px", mobile: "64–100px" }
  heading-to-content: 24px
  product-grid: { desktop: "4열 gap 16/50(col/row)", mobile: "2열 gap 7–8/40" }
  content-card-grid: { desktop: "3열 380px gap 20", mobile: "1열 스와이프" }
  collection: "사이드바 200px + 거터 84px + 그리드 896px"
  pdp-columns: "갤러리 649 : 정보 531 (정보 콘텐츠 446px)"
  cart-columns: "아이템 780 + 요약 aside 360"
  auth-column: "플랫 448px 1칼럼"
  mypage: "1212 컨테이너(위 40·아래 100): 프로필 스트립(/my 전용, 620+276×2·높이 120) + 좌 메뉴 200 + 거터 60 + 콘텐츠 920"
  header: { notice: "텍스트 공지 바 47px(문구 13 · 잉크 버튼 23 · 닫기 44) 위에 이미지 스트립 ≈36px/60px(mo), 둘 다 유틸바 위 스크롤 아웃(sticky 아님)", tiers: "유틸바+로고단+GNB", sticky-condensed: "데스크톱 69px 로고+아이콘 단일 바(로고 행 68 + 하단 1px), 모바일·태블릿 52px GNB 탭 행(51 + 1px) — 표면 sticky 요소는 --wc-sticky-chrome-h 아래에 붙는다(데스크톱 헤더가 펼친 동안은 123, top 전환 .3s)", anchor-landing: "해시 이동·scrollIntoView 착지선 = html scroll-padding-top(globals.css, 크롬과 같은 높이 · 어드민 상단 막대 48) + 대상 scroll-margin-top(표면 sticky 하위 내브·여백만, 크롬 높이를 다시 더하지 않는다). 데스크톱 로고 행·GNB 링크 안 포커스는 이미 sticky 크롬 자리에 보이므로 scroll-margin-top −123으로 착지선을 상쇄한다(문서를 끌어올리지 않음)", bottom-landing: "키보드 포커스·해시 이동이 화면 아래 고정 층 뒤에 멈추지 않는 선 = html scroll-padding-bottom(globals.css) — 990 미만 탭바·PDP 구매바 위 문의 런처 윗변 128(+ 안전 영역), 카트 주문 바 109, 선택 방문 통계 안내·설정 버튼이 보이면 그 윗변(측정) 중 높은 쪽. 안내는 990 미만에서 런처 위(바닥 136, 카트 165)에 서고, 보이는 동안 푸터 바닥도 그 위까지 연다(WCAG 2.2 SC 2.4.11)" }
  buybar-mobile: "높이 72px 고정 풀폭"
  touch-target: "아이콘 44px, 버튼 h50"
```

- 굿즈 이미지(상품 카드·목록·장바구니·위시·상세 갤러리) 비율은 **1:1 정사각으로 통일**하고, 원본은 `contain`으로 잘리지 않게 가운데 놓는다(여백은 중립 회색 — 기존 카탈로그 `bg`의 gradient 대체 레이어는 이미지가 있으면 그리지 않는다, `lib/goods-image.ts`). 2026-10-07 MD 요청: 웹팀 썸네일 1000×1000 원본 유지(이전 3:4 세로형·가운데 크롭을 대체, R-스펙 00 §재현 원칙의 의도적 편차). 카드 아트·IP 배너·이벤트 포스터의 비율은 별개다.
- 이벤트 포스터는 관리자 목록·미리보기와 오프라인 팝업 목록·상세에서 `contain`으로 원본 전체를 가운데 표시한다. 공개 목록·상세의 3:2 영역은 유지하며, 세로형 포스터의 인물·일정·장소가 잘리지 않도록 비율 차이는 여백으로 둔다.
- 홈 자유상품 진열은 운영자가 정사각(1:1)·세로(4:5)·가로(5:4)를 명시적으로 고르는 별도 표면이다. 이 진열의 이미지에만 가운데 `cover` 크롭을 적용하며, 일반 상품 카드·목록·상세 갤러리의 1:1 `contain`은 유지한다. 적용 범위는 `wc-product-collection.css`와 전용 렌더러이며 [진열 계약](docs/research/smartstore-admin/home-free-products-contract.md)을 따른다.
- 섹션 공통 마진 없음 — 각 섹션이 자체 상하 패딩을 가진다(표면별 수치는 R-스펙 02~06).
- **적용 범위(v5)**: 위 `layout`의 컨테이너 1212·상품 그리드 4열·헤더 3단과 sticky 123은 v5 표면(셸·홈·NEW·BEST·카테고리·POP-UP·EVENT)에는 적용되지 않는다 — 그 표면은 넓은 컨테이너 1320(안쪽 1272)·5열·1단 헤더(sticky 펼침 109)다([§14.4](#144-컨테이너그리드브레이크포인트)·§14.6). 이행하지 않은 표면은 위 값이 정본이다.

## 5. 형태·선·깊이·모션

### 탐색 조작부·스태프 프리뷰 보정 (2026-09-09)

필터처럼 직접 조작하는 UI가 상품 이미지와 같은 사각형 박스로 보이지 않도록 다음 표면에 국소 예외를 둔다.
굿즈 이미지와 기본 카탈로그 지면의 radius 0은 유지한다.

- 굿즈샵·NEW·BEST·검색 결과(같은 컬렉션 본문, 굿즈샵·NEW·BEST는 §14로 필터 없음): 상품 수 → 정렬 → 필터를 한 줄에 정렬한다. 정렬과 필터는 최소 44px 높이이며, 필터는 24px 캡슐·슬라이더 아이콘·적용 개수로 상태를 표시한다. 정렬은 별도 네이티브 select이므로 트리거 문구는 `필터`다(레퍼런스 검색의 '필터 및 정렬' 단일 트리거 대신). 데스크톱(990+) 수량·정렬 줄은 896×50 상하 1px 헤어라인이다.
- 필터 시트: 상단 radius 20px, 명시적인 제목·44px 닫기 버튼, 최대 88dvh. IP·타입·가격 탭과 적용 전 draft 유지 계약은 동일하다.
- 커뮤니티의 필터 칩: 최소 높이 44px·radius 24px, 회색 지면·헤어라인, 선택된 값은 검정 잉크 반전. 모바일은 가로 스크롤한다.
- 커뮤니티: 피드 탭 아래 채널 필터·작성 폼·글 순서로 읽는다. 트렌딩은 데스크톱 우측 보조 영역, 모바일 피드 하단에 둔다. 글은 여백·하단 헤어라인으로 구분하고, 작성 폼·보조 영역은 12px, 입력은 8px 라운드다. 신고·차단·삭제·수정은 대상별 `더보기` disclosure 안에 두며 기존 폼 payload와 권한 계약을 보존한다.
- 공통 FAQ·문의 위젯: 런처는 48px 높이·24px 캡슐, 패널은 20px 라운드이며 모바일은 상단 모서리만 적용한다. 입력 8px·대화 영역 12px로 커뮤니티 조작부와 맞춘다.

이 보정은 아래 기본 토큰보다 해당 표면에서 우선한다. hover는 색·선 변화만 쓰고, focus-visible과 reduced-motion 계약을 유지한다.

```yaml
radius: { base: 0, badge: 1, button-form: 2, button-cta: 4, sheet-top: 8, pill: "17–40", circle: "하트·아이콘 원형" }
shadow: "0 4px 5px rgba(18,18,18,.05)"   # 메가메뉴·팝업 유일 — 카드·버튼·헤더 그림자 금지
hairline: "line.hairline 1px (두꺼운 디바이더는 surface.grey 10px)"
motion:
  duration: { short: .1s, default: .2s, medium: .3s, long: .5-.6s }
  easing: ["ease", "cubic-bezier(0,0,.3,1)"]
  patterns:
    gnb-underline: "scaleX 0→1, origin center, .3s"
    sticky-condense: "margin/opacity .3s"
    hero-fade: "1s crossfade, autoplay 5s, hover/조작/문서 비활성 시 정지"
    input-focus: "box-shadow .1s"
  forbidden: "스크롤 트리거 등장 연출·패럴랙스·hover lift 남용. prefers-reduced-motion에서 transition/autoplay 전부 중지"
z-index: { chrome: "3–4", panel: "10–100", overlay: "999+", toast-modal: "9999+" }
```

## 6. 핵심 컴포넌트 패턴

상세 anatomy·수치는 괄호의 R-스펙 문서가 정본이다.

> **적용 범위(v5)**: 아래 패턴 중 `notice-bar`(롤링 띠로 바뀜)·`triple-header`(데스크톱 1단 헤더·유틸 메뉴)·`underline-gnb`(기본 메뉴 5개·잉크 막대)·`search-overlay`(비모달)·푸터·히어로·상품 카드·`filter-sidebar`(NEW·BEST·카테고리에서 제거)·`collection-banner`(스트립 배너)는 §14가 우선한다. 모바일 셸 패턴(`mobile-tab-gnb`·`bottom-tab-bar`·`category-sheet`)과 나머지 표면 패턴은 이 표가 그대로 정본이다.

| 패턴 | 목적 | 필수 규칙 (R-스펙) |
|---|---|---|
| `notice-bar` | 운영 공지(텍스트) | 큐레이션 `notice_bar` — 셸 맨 위 `surface.grey` 47px 바: 13px 문구(60자, 줄바꿈 없음, 좁으면 줄을 바꿔 바가 자람) + 선택 잉크 버튼 23px(12자, 누르는 영역은 바 높이) + 오른쪽 끝 닫기 44. 대상 화면 유형(홈·상품 목록·상품 상세·쇼핑스토리/이벤트·그 밖)·스케줄 노출, 같은 화면에선 순서 첫 공지 하나. 닫으면 같은 탭 동안 숨고(sessionStorage) 문구·버튼·대상을 바꾸면 다시 보인다. 노출 종료 시각이 지나면 열린 화면에서도 숨는다. 서버는 결정적으로 그리고 첫 페인트 전 인라인 스크립트가 닫힘·종료를 반영 — 깜빡임·빈 띠 없음. 모달 오버레이 중 inert (01·11 Δ1) |
| `notice-strip` | 운영 공지(이미지) | 큐레이션 `notice_strip` 이미지 링크 스트립, 공지 바 아래·유틸바 위. 대상 화면 유형 선택(대상 없이 저장된 기존 행은 모든 화면, 새 행은 상품 목록 제외로 시작)·스케줄 노출, 같은 화면의 유효 후보 중 하드 로드마다 무작위 1장(첫 페인트 전 선택, 이동 중 유지 — 보이던 스트립이 종료되면 다음 후보로 넘기거나 숨김). 닫기 없음. 노출·클릭은 동의한 1st-party 방문 통계로만 집계 (01·11 B28) |
| `triple-header` | 전역 탐색 | 유틸바+로고단+GNB 3단, 헤더 하단 1px 자리는 투명 선(MD-0045, 2026-11-23 — 높이·스크롤 여백은 그대로). 데스크톱은 scrollY >150 축약·<64 해제(방향 무관, 유틸바 위 공지 높이를 두 기준에 가산 — 11 §6 B1)로 69px 단일 바, 로고 행·GNB 키보드 포커스 시 재전개. 모바일은 GNB를 접지 않고 로고 행이 스크롤과 함께 빠져 GNB 탭 행만 고정(LD-2 — sticky 기준을 로고 행 높이만큼 올림, 키보드 포커스 시 로고 행 복귀). 유틸바 맨 앞 '위시리스트'는 로그인 회원 전용. 그림자 없음 (01·11) |
| `underline-gnb` | 1차 탐색 | 고정 ID 8항목(NEW·BEST·카테고리·온라인 팝업·카드팩·이벤트·커뮤니티·쇼핑스토리, `lib/routes.ts`) — 이름·순서·노출은 운영 설정(`lib/store-navigation.ts`, ARCHITECTURE `store_settings.navigation`). 카드팩은 2026-11-24 퇴역 칸이라 그리지 않고(`RETIRED_STORE_MENU_IDS`), 커뮤니티는 기능 게이트가 숨긴다. 활성=green 텍스트+3px 밑줄, 최장 경로 하나만 켜고 굿즈 상세에서는 켜지 않는다. 메가메뉴 안 `/shop` 링크는 트리거 이름 대신 '전체 굿즈'. 하단 1px 자리는 투명(`triple-header`, MD-0045) (01·11) |
| `mega-menu` | 카테고리·온라인 팝업 확장 | 헤더 컨텍스트 내 z0, 헤어라인 상하, 그룹 헤딩 14/700. **카테고리**: 공개 전시분류 트리가 있으면(고객 카테고리 공개 스위치 ON + 공개 전시 1개 이상) [굿즈샵 바로가기 130][기획전 180 — 진행 중 캠페인, 없으면 칸을 접음] \| 세로선(기획전 칸 끝 +70, 전시분류는 선 +120) \| 최상위 전시분류 그룹(자기 전시가 있으면 제목이 링크, 없으면 이름표 — 하위는 트리 순서, 3단계 이하는 들여씀). 기획전 링크는 2줄에서 말줄임한다(제목 최대 120자 — 전체 제목은 접근 이름·title). 링크 목적지는 EVENT·POP-UP 카드와 같은 규칙이다(노출 설정의 바로가기 → POP-UP 캠페인은 `/popups/<id>` → 그 밖은 `/events/<id>`, 노출 설정을 못 읽으면 `/events/<id>`). 공개 전시가 없는 가지는 이름도 싣지 않는다. 트리가 없으면 굿즈샵·수집·거래 3그룹으로 폴백. **온라인 팝업**: 디렉토리 피처드 IP 목록(디렉토리와 같은 순서·최대 5) + 4열부터 '전체보기' + 상위 2개 이미지 타일 136(키아트가 없으면 이름 첫 글자), 피처드가 없으면 링크. 포커스로 열리고 ↓ 는 첫 링크, Escape 는 닫고 트리거로 돌아간다(다시 열지 않아 Tab 이 옆 항목으로) — 레퍼런스의 키보드 미지원 결함은 재현하지 않는다. 현재 위치(`aria-current`)는 메가 안에서 하나다 — 기획전은 그 링크의 경로로, 카테고리 전시(`/shop?displayCategory=`)는 쿼리로 그 전시분류 링크를 켜고 '전체 굿즈'는 켜지 않는다(쿼리 읽기는 메가 내용만 Suspense 로 감싸 정적 페이지를 지킨다). 셸 데이터는 쿠키 없는 300초 캐시, 전시 저장·고객 카테고리 공개 전환은 즉시 만료, 원천 읽기 실패는 캐시하지 않고 서버 로그로 남긴다 (01, 11 CH-05·CH-07·B4) |
| `search-overlay` | 검색 진입 | 페이지 이동 없는 오버레이. 패널은 sticky 헤더 기준 로고 행 바로 아래에서 GNB 행을 덮고(데스크톱 최소 200), 그 아래는 10% 잉크 딤 + blur 5px(미지원은 딤만)·스크롤 잠금. 데스크톱 입력은 전폭 60px grey 칸 + 칸 안 왼쪽 돋보기, 뒤로·제출 버튼은 키보드 포커스 때만 드러남(제출 Enter). 모바일은 [뒤로][입력 50][검색] + 추천 칩 한 줄 가로 스크롤, 열린 동안 하단 탭바 숨김. 라벨 '추천' 17/700 + 칩(green) — 칩은 운영 추천 검색어(홈 전시관리 `search_terms` 목록 하나, 최대 10개·20자, 노출 중인 목록 중 시작이 가장 늦은 것, 없으면 코드 상수 폴백, 셸 쿠키 없는 캐시 읽기), 입력값 그대로 `/search?q=`(새 탭 아님). ESC·포커스 트랩 유지(레퍼런스 결함 미재현). 결과는 `/search` (01·03·11 B5·CH-10) |
| `mobile-tab-gnb` | 모바일 1차 탐색 | 햄버거 없는 가로 스크롤 탭, 기본 ink.tertiary·활성 ink.default+2px 밑줄, 좌우 16px fade. 스크롤하면 이 행만 상단에 고정(로고 행은 빠짐, LD-2) (01·11 B2, §10 대비 보정) |
| `bottom-tab-bar` | 모바일 전역 바 | 5탭(메뉴·쇼핑·홈·위시·마이) 62px, 기본 ink.tertiary·활성 ink.default, 상단 헤어라인. 아래로 누적 300px 스크롤하면 내려가고 위로·최상단에서 복귀(.3s, reduced-motion 즉시), 검색 오버레이 중 숨김. 숨긴 상태는 포커스·접근성 트리에서 빠지고, 탭바 안에 **키보드 포커스**(`:focus-visible`)가 있으면 내리지 않는다 — 탭·클릭이나 포인터로 닫은 오버레이가 되돌린 포커스는 숨김을 막지 않는다. 결제·굿즈 상세·장바구니에서는 렌더하지 않는다 (01·11 B3, §10 대비 보정) |
| `category-sheet` | 모바일 카테고리 | 모바일 GNB '카테고리' 탭 전용(전체 메뉴 시트와 분리) 75% 높이 바텀시트, 상단 radius 8, 딤 70%, .3s 상승(모션 축소 시 즉시). ① 아이콘 바로가기 가로 스크롤(칸 17vw · 이미지 칸 60 정사각 r10 `surface.icon-tile` + 12px 라벨, ICONS 아이콘 세트) → ② 기획전(진행 중 캠페인) 카드 2×2 슬라이드 + 위치 점(카드 이미지는 캠페인 카드 비율 3:2) → ③ [카테고리 \| 온라인 팝업] 탭 + 4열 아이콘 그리드(전시분류 아이콘은 칸 안에 맞추고 IP 키아트는 칸을 채운다, 이미지가 없으면 이름 첫 글자 — 카테고리 라인아트 LG-7 대기). ③ 탭은 공용 탭 문법(시트 폭 반씩·높이 48·16/700, 활성 잉크 + 2px 밑줄, 비활성 `ink.tertiary`)이다 — 레퍼런스의 왼쪽 정렬 18/700 텍스트 탭(높이 28·비활성 #CCC·밑줄 없음)은 터치 높이 44 미달·비활성 대비 AA 미달(§10)이라 쓰지 않는다. ①·③ 라벨(12px)은 칸 폭에 열 간격의 반씩을 더 쓰고(375 칸 82 → 87, 라틴 IP 이름이 단어 중간에서 갈리지 않게) 한글은 낱말 단위로 바꾸며 2줄에서 말줄임한다. 섹션 사이 10px 회색 띠. 닫기 버튼 줄(위 8 + 44 = 52)은 머리줄이다 — 맨 위에서는 투명해 첫 섹션 제목 자리(시트 위 20)가 레퍼런스와 같고, 콘텐츠가 그 아래로 스크롤해 들어간 동안에만 지면색·하단 선을 깔아 X 가 기획전 이미지 위에 겹치지 않는다(전체 메뉴 시트의 공용 닫기는 그대로). body 직계 포털 + `useOverlayA11y`(배경 inert·포커스 트랩·Escape·포커스 복귀) — 트랩은 Tab 이 실제로 닿는 후보(숨김·inert·tabIndex 음수 제외)의 처음·끝으로 순환하고, 배경 inert 에는 body 직계 선택 방문 통계 안내도 든다 — 그래도 ③ 탭은 고른 패널만 DOM 에 둔다. 가로 스크롤 트랙(①·②)은 포커스 링이 잘리지 않게 안쪽 4px 여백을 바깥 여백으로 상쇄한다. 공개 전시 트리가 없으면 탭이 전체 메뉴 시트를 연다(폴백) (01, 11 MC-05) |
| `product-card` | 상품 단위 | 1:1 이미지(원본 비율 contain) 무보더 플랫 → 뱃지(정보영역 인라인 — 저장 배지는 틴트, 할인 파생 SALE은 흰 바탕+틴트 테두리 아웃라인) → 브랜드 12/600 → 이름 13/400 → 가격 14/600 → 리뷰가 있으면 별점(잉크 별 5칸·빈 칸 line.control + "(리뷰 수)" ink.tertiary, 가격 아래 7px — 숫자는 굿즈 상세 요약과 같은 그룹 범위, 0건이면 줄 없음. 홈 리뷰 BEST 밴드도 선정(평균 3 이상)·자동 정렬·'★ 평균 · 리뷰 N' 표시를 모두 같은 그룹상품 범위 요약으로 한다 — 같은 굿즈가 한 홈에서 두 숫자로 보이지 않고 보이는 평균이 곧 선정 이유다. 요약이 없는 굿즈만 굿즈 단위 후보 집계(`get_home_review_candidates`)로 폴백하고, 후보·대표 후기·최근 7일 조건은 그 후보 집계를 따른다(ARCHITECTURE 홈 review_best). 어드민 '현재 공개 홈'·편집 미리보기·노출 가능 수·상품 선택기 평점도 같은 요약을 읽는다). 품절=하단 1/3 scrim 밴드+italic SOLD OUT. 이미지 우상단 4px 에 **목록 하트**(36 흰 원·44 히트, 이미지 링크의 형제인 action 슬롯 — 링크 안에 버튼을 넣지 않는다. 키보드 포커스 링은 히트 상자가 아니라 36 원에 그려 이미지 프레임의 overflow 에 잘리지 않는다). 목록 페이지가 로그인 회원의 위시 ID 집합을 한 번 내려주고 하트는 refresh 없이 낙관 갱신·실패 시 되돌림(서버가 확인한 값은 세션 저장소에 회원별로 묶이고 탭 로그아웃 신호에서 비운다 — 같은 탭에서 회원이 바뀌어도 이전 회원의 하트가 남지 않는다), 비로그인은 로그인 벽, 어드민 미리보기(홈·쇼핑스토리 에디터)에는 없음(`components/shop/ListingWishHeart.tsx`). 하트·별점은 목록 밖 카드에도 같다 — PDP 선반(연관 굿즈·다른 구성·자동 추천·배송비 절약·관심 굿즈, `/interests` 포함)·캠페인 굿즈 진열·쇼핑스토리 상품 카드. 서버가 그리는 표면은 표면당 위시 ID 한 번·별점 한 묶음, 서버 액션으로 굿즈를 받는 선반은 받은 뒤 공개 RPC 한 묶음(`components/shop/listing-hearts.tsx`·`useListingReviewSummaries`) (02·03·04 §5.4, 11 CL-01~03, 12 LD-4) |
| `content-card` | 콘텐츠 단위 | 썸네일+뱃지+타이틀, 홈 ②·이벤트 허브·커뮤니티 공용. 뱃지는 상품 뱃지가 아니라 12/700 소형 액센트 글자(success)·surface.grey·3×6·r0. 모바일 슬라이더 카드 300 + gap 10(flex 항목 min-width 0) — 트랙은 컨테이너 거터를 넘어 화면 양끝까지 펴고 거터만큼 안쪽 패딩·scroll-padding을 둬 첫 카드와 스냅 위치는 x16, 다음 카드는 화면 끝에서 잘린다(375 폭 49px·390 폭 64px 노출). 데스크톱 3열은 컨테이너 안쪽 폭으로 되돌린다 (02·06, 11 HM-01·02·B20) |
| `tab-product-slider` | 카테고리 BEST | 좌탭(모바일 가로 탭)+탭별 독립 슬라이더, 4열/2×2 페이지 (02) |
| `banner-list-band` | 큐레이션 밴드 | 좌 배너 780 + 우 리스트 380, 모바일 재배치, 3연속 동일 템플릿. 리스트 행 = [링크(썸네일 80·브랜드·이름·가격·별점) \| 목록 하트], 하단 1px 헤어라인 + 여백 16(모바일)/18, 마지막 행은 선 없음. 행 높이는 썸네일 80이 정한다 — 글 블록(브랜드 12/16 한 줄·이름 13/18 한 줄·가격 14/17·별점 16, 간격 2·6·4 = 79)이 별점까지 80 안에 들어 데스크톱 380×99·모바일 343×97. '전체보기' 300×50 1px line.control (02, 11 HM-03·04) |
| `benefit-tiles` | 혜택 안내 | 280×158 흰 타일 4열(데스크톱 패딩 32/24 + 글 블록 92: 아이콘 32·8·제목 18/24·8·설명 13/20), 회색 면 밴드, 제목 '혜택'. 타일 머리 32px 아이콘은 ICONS 아이콘 세트에서 목적지로 고른다(레퍼런스 아이콘 금지). 지운 화면(카드팩·게임 등) 목적지 타일은 그리지 않고 나머지 혜택 타일은 그대로 노출 — 커뮤니티 목적지 타일은 다른 큐레이션처럼 커뮤니티 노출 게이트를 따른다 (02, 11 HM-07·DT-11, 12 LD-15) |
| `collection-banner` | 컬렉션 머리 배너 | 큐레이션 `collection_banner`(slot `all`·`best`·`new`). 굿즈샵 전체 = 헤더 선 바로 아래 전폭 1440×580(모바일 375×302) 수동 슬라이더(고객 카테고리 전시 내비가 공개되면 내비가 헤더 선 바로 아래, 배너는 그 아래다 — 카테고리 전시 페이지의 내비 → 전시 배너 → 목록과 같은 순서라 전시를 오가도 내비 자리가 흔들리지 않는다. 레퍼런스에는 이 내비가 없다) — 레퍼런스처럼 자동 넘김 없음·루프, 데스크톱 콘텐츠 왼쪽 선 아래 끝 이전·다음 44×45(면 rgba(0,0,0,.45) — 대비 보정), 모바일 스와이프 + 오른쪽 아래 'n / N' 알약(13px, 면 .6), 아래 76(모바일 40). BEST·NEW = 콘텐츠 폭 1180×260 위아래 40(모바일 전폭 375×175), 운영 순서 첫 장 하나(여러 장이어도 슬라이더 아님), 문구는 흐름 안 세로 가운데라 허용 한도의 긴 문구는 잘리지 않고 배너를 늘린다. 한 컬렉션에서 노출 기간이 겹치는 배너는 DB가 10장까지만 받고, 카드 리워드·커뮤니티 목적지 게이트는 서버 로더가 걸어 머리말 판정과 실제 배너가 같다. 문구는 이미지 위 텍스트 레이어(제목 28/700·부제 15, 칸 배너 22/700·14, 기본 잉크 글자·딤 없음, 운영자가 딤·흰 글자 선택), 이미지는 대체텍스트가 있을 때만 그림(없으면 alt=""), 첫 장 eager·fetchpriority high. 카테고리 전시·검색·IP관엔 없고, 배너가 없으면 목록 머리말 그대로 (11 CL-09) |
| `filter-sidebar` | 목록 필터 | 200px: (카테고리)·IP·타입·가격 듀얼 슬라이더, 첫 그룹 포함 모든 그룹 위 1px 헤어라인·제목 줄 58, 적용 칩 없이 카운트 피드백('전체 › N개 굿즈' 14px — 모바일은 'N개 굿즈', 검색은 '결과'), 모바일 바텀시트 지연 적용. facet 값은 스코프 안에 굿즈가 있는 것만 보인다(카테고리 포함 — 부모는 자손 합계, 지금 고른 값과 그 조상은 0개여도 남는다). 타입 축에 '예약판매' 값(예약판매 옵션을 가진 굿즈, 레퍼런스 상품타입 PRE-ORDER의 대응 — NEW·SALE은 배지로만). 카테고리 전시(서버 페이징)도 RPC가 같은 '예약판매' facet·필터를 계산한다. IP관은 IP 그룹을 그리지 않는다. 정렬 = 추천·이름 가나다순·이름 역순·낮은/높은 가격순·오래된순·최신순(베스트셀러 보류 — 카테고리 전시도 서버 페이징으로 같은 7종, 이름순은 ICU ko 숫자 자연·대소문자 동률), 검색 = 관련성·가격 2 (03, 11 CL-05·06·10·11, 12 LD-13) |
| `view-more` | 목록 더보기 | 1px line.control-soft(#DCDEE0)·r5 버튼(비활성 '불러오는 중…'은 더 옅은 hairline 선·ink.disabled 글자) — 컬렉션은 그리드 폭 896×48 'VIEW MORE'(이벤트 허브 더보기는 기본 폭), 20개 append URL 불변. 검색은 36px 숫자 페이지네이션: 데스크톱 10칸·767px 이하 5칸 고정 창, 이전·다음은 창 단위로 건너뛴다. 처음·마지막(« »)과 생략 부호는 데스크톱 전용이고 모바일은 ‹ 5칸 › 한 줄(44·36·간격 2 = 280, 첫 창 ‹ 는 1페이지·마지막 창 › 는 마지막 페이지로) (03, 11 CL-07·SR-03 · §6 B8) |
| `pdp-gallery` | 상품 갤러리 | 1:1 프레임(크롭 없이 contain)+도트+84px 썸네일 7열(대표 1 + 추가 이미지 최대 9 = 10장, 넘치면 다음 줄), 모바일도 1:1+도트, 줌 없음. 도트는 썸네일 줄 수와 무관하게 메인 이미지 안쪽 하단에 앉고, 8px 점마다 서로 겹치지 않는 24×44 터치 영역을 둔다(피치 24px — 레퍼런스 16px의 의도적 편차) (04, 2026-10-07 MD 요청·QA) |
| `pdp-buybox` | 구매 정보 | 뱃지→제목→가격(할인 2행, 정가·할인율·할인가는 숨은 라벨로 읽힘 — 할인 표기를 끄면 '가격'·SALE 배지 없음)→별점(0건=회색 별만 / 있으면 평균+'N개 리뷰보기'→리뷰 탭)+하트·공유(36 원형, 링크 복사·기기 공유)→옵션(다옵션 첫 선택 = 첫 구매 가능 옵션, 살 수 있는 옵션이 없으면 첫 옵션을 고른 채 — 빈 옵션(placeholder) 행 없이 셀렉트·제목 가격·합계가 같은 옵션. 품절 옵션도 `· 품절`로 고를 수 있고 고르면 CTA가 그 옵션의 재입고 알림 — LD-5)→수량 스테퍼→1px 잉크 선→실시간 합계(품절 굿즈·고른 품절 옵션은 가격)→CTA→IP 카드(446×82, IP 키아트 150×80·없으면 글자만, 레퍼런스의 브랜드 칩 자리). 재고 라벨(품절임박·품절) 없음 — 판매 기간·예약 상태만 글로 알린다. 담기는 카트 반영 확정 뒤에만 중앙 결과 모달([계속 쇼핑]/[장바구니 보기]) (04, 11 §8.4) |
| `cta-pair` | 구매 행동 | [장바구니 아웃라인 122 고정 : 구매하기 잉크 나머지] — 446 폭 122:319(≈27:73), 시트 343 폭 122:216, `.wc-btn` h50 r4 (04, 11 PD-12) |
| `restock-cta` | 재입고 알림 | 품절이면 CTA를 벨 아이콘+풀폭 잉크 버튼으로 교체 — 모든 옵션이 품절이면 굿즈 단위(어느 옵션이든 다시 판매되면), 고른 옵션만 품절이면 그 옵션 단위 신청. 본문 패널(모바일 시트 포함)·데스크톱 레일 박스가 같은 판정이다. 모바일 바는 모든 옵션이 품절이면 바 전체가 신청 버튼이고, 고른 옵션만 품절이면 같은 모양(벨+'재입고 알림 받기'·'신청됨')의 시트 트리거라 시트에서 신청하거나 다른 옵션을 고른다. 신청은 단방향(신청됨으로 잠김 — disabled 대신 aria-disabled라 모달 안에서도 포커스를 잃지 않는다). 결과는 버튼 옆 상태 줄(role=status)이 알린다: 실패는 본문 패널에서 버튼 아래 한 줄, 바·레일 박스는 버튼 글자로 보인다. 재입고 알림만 할 수 있는 동안(고른 옵션만 품절·모든 옵션 품절)은 구매에만 쓰는 칸(직접 입력 옵션·추가 구성 굿즈)을 접는다 — 적은 값·고른 추가 구성은 남고, 고른 옵션만 품절이면 셀렉트 아래 한 줄로 판매 중인 옵션을 고르면 보인다고 알린다. 판매 상태가 바뀐 거절은 화면을 다시 받아 그 자리가 담기·구매로 바뀌므로, 포커스를 같은 표면(시트 안이면 시트)의 새 CTA로 옮기고 이유는 그 표면의 상태 줄(패널 상태 줄·바·레일 박스의 숨은 상태 줄)이 든다. 비로그인 클릭=로그인 벽(복귀 주소에 고른 옵션) (04, 11 §6 B9·B11, LD-5) |
| `panel-tabs` | PDP 하부 | 앵커 아님·패널 전환 탭. 탭바는 화면 전폭 sticky(top = 전역 크롬 높이 `--wc-sticky-chrome-h`), 데스크톱 탭 220·모바일 4탭 같은 폭 한 줄, 리뷰 카운트 표기, 탭을 고르면 탭바 자리로 스크롤. 데스크톱은 패널 840 + 우측 레일 340. 4번째 '추가정보' = `<details>` 4(고시정보·배송 안내·교환/반품 안내·판매자 정보). 상세 설명 패널은 상세 이미지·하단 공지 다음에 추가정보와 같은 아코디언(제품 안전정보는 고시정보 안), 끝에 추천 블록(연관 굿즈→자동 추천) — IP 소개·굿즈 문의·패널 끝 IP 카드는 MD-0054·0055(2026-11-23)로 지웠다 (04, 11 §3 Δ4·PD-05·06·13·16b) |
| `floating-buybar` | 데스크톱 구매 요약 | 하부 탭 섹션 우측 레일(340) 안 sticky 회색 박스 320×153(`surface.grey`, p 24/20/18/19, top calc(100dvh − 154px), dvh 미지원은 vh) — 합계 라벨 14/700·금액 23/700 + [카트 50²][구매 226×50], 품절이면 재입고. 탭 섹션 범위에서만 보이고 뷰포트 고정 미니 바는 두지 않는다. 박스에서 누른 담기·구매가 실패하면 실패 문구가 있는 본문 패널의 고칠 칸(없으면 상태 줄)으로 스크롤·포커스한다. 문의 런처는 박스와 가로로 겹치는 폭(990–1459px)에서만 박스가 하단에 붙은 동안 그 위로 올라가고 박스가 레일 끝과 함께 밀려 올라가는 동안 감춘다 — 더 넓으면 제자리 (04 §5.5 정정, 11 §3 Δ3·PD-03·CH-16) |
| `mobile-buybar` | 모바일 구매 | 72px 잉크 풀폭 고정(카트 존+구매 존, 흰 글자)은 구매 시트 트리거다. 시트(하단 고정 r 8 8 0 0, p 20/16, 딤 .6, translateY .3s·모션 축소 시 없음, 높이 85% 상한 내부 스크롤)가 본문 구매 패널 전체를 담고 실행은 시트 CTA. 모바일 본문 인라인 폼은 숨기고, 모든 옵션이 품절이면 바 전체가 재입고 알림이다. 고른 옵션만 품절이면 바가 벨+'재입고 알림 받기'(카트 존 없음)인 시트 트리거로 바뀌고 시트 CTA가 그 옵션의 재입고 알림이다 — 레퍼런스의 상태 비반응 바는 결함이라 재현하지 않는다(04 §10-7). 시트가 열린 동안 연 버튼이 바뀌면(시트에서 옵션 전환·그 사이 재입고) 닫을 때 그 자리의 새 버튼(카트로 열었으면 카트, 아니면 주 버튼)으로 포커스가 돌아간다. 시트를 열 수 없는 상태(판매 불가·품절)는 본문 패널을 그대로 보여 옵션·가격·예약·한도 안내와 품절 합계를 남긴다. 갤러리는 화면 폭 풀블리드(1:1 contain) (04 §7.2 정정, 11 §3 Δ2·PD-01·04) |
| `mini-checkout-cart` | 카트 | 780+360 2열. 목록 = 맨 위 2px 잉크(데스크톱)·배송 묶음 머리 = 출고지 기본 택배사 이름('한진택배 배송' — 같은 택배사 묶음이 둘 이상이면 번호, 택배사를 모르면 '택배 배송'. 출고지 이름은 고객 표면에 내지 않음 — 10/14 S7 · R26), 묶음이 둘 이상이면 목록 위 이유 한 줄('택배사가 달라 배송비가 각각 계산됩니다.' — 주문서 묶음 위도 같다, R27), 행 [썸네일 64(모바일 80)·브랜드·이름·단가·상태] + 회색 옵션 밴드(옵션·직접 입력 \| 수량 92×32 \| 삭제 44) + 밴드 아래 줄 금액 16/700. 요약 = 데스크톱 360 `surface.grey` 박스(p 24/24/32, 모바일은 10px 회색 띠로 가른 흰 지면) → 금액 표(라벨 16/400·값 16/700) → 예상 총액 26/700 잉크(액센트 아님, 안내 문구면 14/400) → 주문 CTA 312×56. 쿠폰 select·코드 입력은 카트와 주문서가 같은 부품(`CouponPicker`)·같은 선택 상태(`cart_coupon_selections` 한 행)를 쓴다 — 주문서는 할인 행 바로 아래에 두고, 할인 0원이어도 쿠폰 행을 보이며, 바꾸면 재견적한다. 운영 주문서 계약은 주문 1건에 굿즈 쿠폰 1장이고 배송비 쿠폰은 받지 않는다(목록에서 빼고 사실대로 알림 — R25). 배송 메모는 주문서(주문 생성 계약 — 12 LD-8). 빈 상태 = [라인아트 146 자리(LG-7 전까지 비움)] → 16/400 안내 → 220×60 `accent` CTA(green 면·잉크 글자 — 흰 글자는 AA 미달), CTA는 직전에 보던 굿즈 목록(굿즈샵·NEW·BEST·검색 결과·IP관 — 셸이 목록을 실제로 그린 뒤 탭 세션에 기록, 목록 상태 키만·같은 출처 목록 경로만, 없으면 `/shop`)이고 문구는 그 목적지 표면을 말한다('굿즈샵·온라인 팝업·검색 결과 둘러보기' — 주문 목록 빈 상태·결제 실패 안내, 닫힌 주문 결제 화면의 둘러보기도 같은 규칙). 모바일(<990) = 전역 헤더 대신 서브헤더 52(← 이전·제목·홈, sticky — 셸 sticky 크롬 높이와 같다. ← 는 앞에 ICONS 화면이 있을 때만 뒤로, 없으면 직전 목록) + 하단 고정 주문 바(흰 바탕·위 1px·p 16 + 안전 영역, CTA 전폭×60, 확정된 예상 총액이면 '₩금액 주문하기'), 탭바 미렌더, 문의 런처·푸터 바닥은 바 위로. 라우트 로딩 경계(`app/cart/loading.tsx`)는 루트 그리드 스켈레톤 대신 카트 첫 렌더와 같은 서브헤더·'불러오는 중' 블록을 그리고, 그 블록은 모바일에서 빈 상태와 같은 최소 높이·데스크톱에서 한 화면 높이를 잡는다 — 첫 페인트부터 서브헤더 크롬이고 첫 화면에 푸터가 올라왔다 밀려나지 않는다. 수량·삭제·합계·쿠폰·주문서 진입 계산은 그대로 보인다 (05·11 §8.5 CT-01~04) |
| `flat-auth-form` | 인증 | 448px 1칼럼, 잉크 60px CTA, 소셜 55px 원형(도입 시), in-place 복구 스왑(재설정 모드는 소셜 가입 계정 안내 1줄). `/login`은 전역 헤더·푸터·모바일 탭바 안에서 연다 (05·11) |
| `mypage-shell` | 계정 허브 | 1212 컨테이너(위 40·아래 100). 프로필 스트립은 `/my` 전용(인사 620 grey + 스탯 타일 276×2: 회원 등급 뱃지·다음 등급 안내 / 위시 수 19/700 잉크) — 링크 없음(메뉴와 같은 목적지를 두지 않는 한 화면 한 링크 규율). 좌 200px 메뉴 3그룹(카드 1px hairline·r2·32/30, 제목 16/700, 항목 15/400 ink.tertiary 11/0, 그룹 사이 위 1px) + 거터 60 + 콘텐츠 920, 콘텐츠 헤더 17/700 + 2px 잉크 선. 주문·티켓 목록·상세(영수증 지면은 셸 안 콘텐츠, 상세 2열은 1200px 이상)를 포함한 모든 계정 하위 화면이 셸 안이다. 모바일 하위 화면은 메뉴를 숨기고, `/my` 대시보드만 세로 메뉴(그룹 사이 10px grey 밴드, 제목 14/700 ink.tertiary — 레퍼런스 #A0A0A0 대비 보정, 항목 16/700 높이 46) (05·11 §5.1, 12 LD-1a) |
| `mypage-dashboard` | `/my` 대시보드 | 데스크톱 블록: 최근 주문(주문 사다리 5단계 건수 + 최근 3건) → 쿠폰·적립금 요약(각 화면 링크) → 위시리스트(N, 상품 카드 5칸) → 팔로우한 IP(N, IP 타일 5칸) → 최근 본 굿즈(상세 경험 `interests` 스위치가 켜졌을 때만, 최대 5 — 12 LD-16). 블록 머리 17/700 + 건수 + '더보기 ›' 14/400 + 2px 선, 빈 상태 15/400·위 40·높이 156. 모바일(LD-1a): 웰컴 행(아바타 72 + 등급 뱃지 → 이름 22/700 → 인사 16/400) → 바로가기 4칸(장바구니·주문/배송·쿠폰·위시, 아이콘 34×30·라벨 14/700, 카운트 배지 18 원형 — 장바구니는 '카트 수량 뱃지'라 액센트, 위시는 잉크(§2 액센트 사용처 밖), 상하 1px hairline-soft) → 세로 메뉴 → 같은 블록(굿즈·IP 140 가로 스크롤, 섹션 사이 10px 밴드) → 로그아웃 343×50(14/700 ink.tertiary). 블록마다 기존 조회를 쓰고 실패하면 그 블록만 '확인하지 못했어요' (11 §5.2, 10/14 S16) |
| `wish-grid` | 위시리스트 | 탭 2(상품 / 팔로우한 IP — 460×48, 현재 15/900 잉크 + 2px 밑선·비현재 ink.tertiary, `?tab=ip`) → '총 N개' 14/400 → 상품 카드 5열(행 40·열 16, 750–989px 4열, 모바일 2열) + 이미지 우상단 목록 하트(해제) + 카드 아래 수량 없는 '장바구니 담기'(40, `listing.showCart`와 무관, 카트 반영 확정 뒤 담기 결과 모달, 옵션·직접 입력·최소 수량 굿즈는 상세로, 담을 수 없으면 aria-disabled). 판매 종료 굿즈는 회색 카드로 남겨 해제 수단을 둔다(같은 줄 카드처럼 목록 이미지 비율 `listing.imageShape`을 따른다). 팔로우한 IP 탭은 공개 IP 타일 + 팔로우 해제(IP 관 폼 계약 — 저장 실패 `?follow_error=1`은 탭 아래 role=alert 한 줄) (11 §5.6, 10/14 S14·S15) |
| `grade-benefits` | 회원 등급 혜택 | 안내 박스 920(grey·1px hairline-soft·r2·19/24, 15/400 두 줄) → 등급표(등급·기준 280 \| 혜택 640, 머리 13/400, 행 위아래 1px: 뱃지 → 등급명 18/900 → 기준 15/600 / 혜택 13/400 ink.sub 목록) — 내 등급 행 grey + '내 등급 · 다음 등급까지', 자동 승급을 운영하지 않는 등급은 내 등급일 때만 → 쿠폰함 CTA 260×56 잉크 18/400 r2 → 산정 안내 박스. 혜택은 지급 중인 등급 혜택 쿠폰(코드 제외 — 내 등급 이하는 이름·혜택·조건·기간, 오르지 않은 등급은 '굿즈 할인 쿠폰 N장'처럼 종류별 장수만)·등급 적립률("구매 금액의 N% 적립금" — 두 적립 정책이 켜졌을 때만, `get_loyalty_grade_benefits`). 산정 안내의 등급 적립금 한도 문장도 표가 적립률 줄을 그릴 때만 쓴다. 모바일은 표를 행 블록으로 쌓는다 (11 §5.5) |
| `address-book` | 배송지 관리·주문서 배송지 선택 | `/my/addresses`(셸 안): 헤딩 바(+ 'N / 10') → 요약 박스 920×62(grey·1px hairline-soft·r2: '기본 배송지' 15/700 + 이름·주소 한 줄, 2개 이상이면 '기본 배송지 변경' 106×30 12/700 흰 바탕 1px line.control-soft r2 → 인라인 라디오) → 표(배송지 이름 240 · 주소 393 · 연락처 180 · 관리 107 — 콘텐츠 920 기준, 더 좁은 데스크톱 칼럼은 이름·연락처 비율·관리 고정·주소 나머지로 줄어 칼럼을 넘지 않음, 머리 13/400, 아래 1px 잉크; 기본 배송지는 맨 앞 + 잉크 아웃라인 글자 배지, 연락처는 가운데를 가림, 행 [수정][삭제] 30 — 삭제는 행 아래 확인 줄) → '배송지 추가' 260×56 잉크 18/700 r2(10개면 비활성 + 이유) → 같은 화면 아래 추가·수정 폼(주문서와 같은 우편번호 부품·검증 문장, 배송 메모 없음) → 회색 안내 박스. 모바일은 표를 배송지 블록으로 쌓는다. 주문서 두 벌은 배송지 칸 위에 주소록 select('직접 입력한 배송지'/'새 배송지 입력' + 배송지들, 연락처 없음)·'이 배송지를 주소록에 저장'(이름 + 기본 지정, 주문 form 안이라 Enter 를 저장으로 돌린다)·'배송지 관리' 링크를 두고, 미리 채운 출처(기본 배송지 / 결제를 마친 직전 주문)를 그 배송지일 때만 안내한다. 온보딩 직후 안내(`/onboarding/address`)는 `flat-auth-form` 위 같은 폼 + '나중에 할게요'. 개인정보처리방침 주소록 개정 시행일(KST) 전에는 staff/admin 이 아닌 회원에게 `/my/addresses`가 여는 날·개정 사전 공지 링크만(빈 목록과 같은 자리·선) 보이고, 주문서 주소록 UI·온보딩 안내는 나오지 않는다. 액센트를 쓰지 않는다 (11 §5.8, L7) |
| `coupon-ticket-card` | 쿠폰함 | 2열 451(행 20·열 18, 위 24) 티켓형 카드(1px line.control-soft·r2·13/23, 우변 노치) — 등급별 뱃지 → 코드(등급 혜택 쿠폰은 코드 줄 없음 — 자동 지급·장바구니·주문서에서 선택) → 이름 16/700 → 혜택 14/700 → 정의 행 13px(dt ink.tertiary, 사용조건 값만 700). 안내 박스 grey 18/16·13/400·굵은 소제목 두 묶음(쿠폰 안내 / 취소·반품 안내) (05·11 §5.4) |
| `campaign-hub` | 이벤트 허브 | 보이는 제목·부제 없음(h1은 시각 숨김) → 배너 스와이퍼 1180×260(모바일 전폭 375×175, 자동 넘김 5s·loop 없음, hover·포커스·조작·문서 비활성 시 정지, reduced-motion이면 자동 넘김 없음, 정지 버튼+현재 위치) + ALL/EVENT/DROP 탭(14/700, 건수 없음) + 2열 580px 카드(3:2). ALL은 최대 100건, EVENT·DROP은 10건 + [더보기 (n/총)](URL 불변) — **기간·상태 뱃지는 추가한다**(레퍼런스 미표기 결함 보완) (06, 11 §6 B21) |
| `campaign-landing` | 캠페인 상세 | sticky 앵커 내브+코인 잔액 노출+게스트 로그인 CTA 치환. 코인 소진처였던 카드팩 교환 블록은 2026-11-24 삭제(가챠 어휘 금지는 유지). 본문 블록 8종 — `cta`(이동 버튼)는 잉크 버튼(모바일 전폭·태블릿 이상 최소 220×56)이고 링크는 `/`로 시작하는 ICONS 내부 경로만(외부·`//`·역슬래시·공백·제어문자·`.`/`..` 경로 조각·깨진 퍼센트 인코딩 거절 — DB `validate_campaign_sections`·파서·어드민 폼이 같은 판정, 버튼 문구의 공백·길이도 JS trim·코드 포인트로 같다, 12 §4 LD-18) (06) |
| `document-page` | 정책·법적 | 620px 한 칼럼(좌우 20 → 본문 580): 가운데 제목(모바일 30/700·데스크톱 40/700 — 레퍼런스 글리프 실측)·요약·시행일·다른 문서 링크 → 조항 h2 20/700 + 본문 p 14/1.6. 개정 공지는 회색 안내 상자, 표는 본문 폭 안 가로 스크롤, 이전 판은 details. 공지 상세는 1180px (06 §8) |
| `standalone-game` | 지우학 체험 게임(효산의 기억) | 크롬 없는 풀스크린 유지, 팔레트만 White Catalog 정합. 공용 헤더·탭바·문의 위젯은 없고 사업자 정보·법정 고지 푸터만 경험 아래에 둔다(1014-X36) (06) |
| `about-legacy-showcase` | 회사 소개 | 구 홈 콘텐츠 섹션(파스텔 에디토리얼) 보존, 자체 헤더/푸터 제거, 전역 셸 아래 |

### 버튼·인풋 기본형

- `.wc-btn`: w100% h50 r4 18/700, 변형 = 아웃라인(#FFF/`line.control`/잉크) · `primary`(잉크/잉크/흰) · `disabled`(#BBB) · `accent`(green/green/잉크 — 흰 글자는 2.3:1 AA 미달). 연속 배치 7px, 2열 그룹 gap 8.
- 폼 버튼(잔여): min-h 50, r2, 15/+1ls, hover=box-shadow 0 0 0 1px 잉크 링.
- 인풋: r0, 보더 box-shadow 1px(rgba ink .55), focus 2px 잉크 + caret green, 플로팅 라벨 16→10px. 검색 인풋만 보더 없는 grey 필드. invalid=green 아님 — `state.danger` 보더+13px 피드백.
- 수량 스테퍼 92×32, 셀렉트 12px+caret svg.

## 7. 홈 정본

밴드 구성과 수치는 R-스펙 02가 정본이다. 데이터는 전부 어드민 큐레이션·카탈로그에서 온다.

> **적용 범위(v5)**: 홈의 섹션 구성·기본 순서·수치는 [§14.7](#147-홈)이 정본이다. 아래 번호 목록(히어로 → 에디터의 제안 → 카테고리 BEST → 배너 밴드 → 인기템 → 혜택)은 v4 밴드 구성의 기록이고, 그 블록 중 v5 홈 기본 순서에 남은 것(카테고리 BEST·인기템·혜택·랭킹·모자이크·쇼핑스토리)은 렌더가 그대로다.

1. `notice-bar` + `notice-strip` + `triple-header`
2. 히어로 캐러셀 — 1425×770(1440+), fade 1s·5s·루프, 전폭 9등분 세그먼트 진행바, PC/MO 별도 아트웍(5:6), `home_curations.hero`
3. "에디터의 제안" `content-card` 3열 — 이벤트·커뮤니티·드랍 소재 큐레이션. 바로 다음 밴드 머리에 1180 폭 1px 헤어라인(회색 면 밴드 앞 제외, 11 §3 Δ8)
4. 카테고리 BEST `tab-product-slider` — 카테고리 탭+판매량/큐레이션 정렬
5.–7. `banner-list-band` ×3 — 주간 온라인 팝업(IP)·기획전·테마 큐레이션 슬롯
8. 인기템 `tab-product-slider`
9. 혜택 밴드(`benefit-tiles`, 제목 '혜택') — 밴드를 통째로 비우지 않고, 다른 큐레이션처럼 목적지 기준으로 지운 화면(카드팩·게임 등, `isRetiredDestination`) 타일만 거른다(12 LD-15). 커뮤니티 임시 비공개 동안에는 커뮤니티 목적지 타일도 히어로·에디터의 제안·배너 밴드와 같이 거른다. 카드팩·게임 진입 타일이 이 밴드의 창작 용도였지만 2026-11-24 그 화면을 지웠다
10. 푸터 — 링크 그룹+사업자 정보+**오프라인 팝업 진입**+`/about` 링크

빈 카탈로그·큐레이션 상태에서도 각 밴드는 명시적 빈 상태 또는 영역 제거로 처리하고 가짜 콘텐츠를 만들지 않는다.

운영 확장 블록(2026-09~10, 정본은 `docs/ARCHITECTURE.md` 홈 절): 판매 BEST(`sales_best`)·리뷰 BEST(`review_best`)·상품 모자이크(`product_mosaic`)·자유상품(`product_collection`)·쇼핑스토리·홈 검색·홈 공지 팝업은 데이터가 있을 때만 그리고, 전체 순서·노출은 `home_layout_settings.blocks`가 정한다.

## 8. 표면군별 플레이북

| 표면 | 라우트 | 적용 패턴 | 기능 불변 조건 |
|---|---|---|---|
| 홈 | `/` | §7 | `getHomeSnapshot` 계약 유지(큐레이션 kind 확장은 서버 작업으로 분리) |
| 굿즈샵 | `/shop` | 컬렉션+`filter-sidebar`+정렬+`view-more`(본문은 검색·IP관과 공유 — `components/shop/CollectionBrowser.tsx`). 굿즈샵·NEW는 보이는 제목 없이 목록으로 시작(h1 시각 숨김), 굿즈샵 전체·BEST·NEW는 `collection-banner`가 있으면 배너로 시작(BEST는 배너가 없을 때만 텍스트 제목), 카테고리 전시(`?displayCategory=`)엔 배너 없음 | 재고·판매 상태 계약 유지 |
| 상품 상세 | `/shop/[goodId]` | `pdp-*`·`cta-pair`·`restock-cta`·`panel-tabs`·`floating-buybar`(레일 박스)·`mobile-buybar`(구매 시트)·담기 결과 모달·리뷰/Q&A, JSON-LD Product·BreadcrumbList와 Open Graph 이미지·가격, 옵션 선택은 `?variant=` 동기화 | 카트·주문 생성 경로 유지. 바로구매는 LFS처럼 담기와 같은 카트 계약으로 담은 뒤 `/cart`로 이동한다(10/14 D2). 본문 패널·모바일 시트·레일 박스는 같은 구매 컨트롤러의 담기·구매 함수를 쓴다 |
| 온라인 팝업 | `/ip`, `/ip/[id]` | A–Z 디렉토리(데스크톱 피처드 212 타일 하단 36px scrim 띠 위 16/700 이름 · A–Z 바 위쪽 2px 잉크 선·글자 폭 그대로 · 모바일 피처드 위치는 점) / 풀블리드 배너 540px+팔로우(모바일은 가운데 정렬·해시태그는 배너 아래, 배너 그림은 IP관 PC/MO 배너 — 모바일은 모바일 → PC → 키아트, 데스크톱은 PC → 키아트 — 스크림 아래 장식 이미지. 키아트와 모바일 폭은 전면 스크림(.45→.62), 데스크톱 PC 배너는 흰 글자가 서는 왼쪽 글자 단(콘텐츠 왼쪽 선 + 560)에만 .62→.54 스크림(기존 스크림이 글자 줄에 주던 값 이상)을 깔고 그 끝에서 280px 동안 풀어 그림 오른쪽은 어둡게 하지 않는다(레퍼런스 브랜드관처럼 그림을 살린다), 11 IP-06)+IP로 좁힌 굿즈샵 컬렉션(카테고리·타입·가격 사이드바, 정렬, VIEW MORE, 212 카드 — URL 필터) | 공개 읽기·팔로우(`fans_count`) 유지 |
| 이벤트 | `/events` | `campaign-hub`+`campaign-landing` | 신규 campaigns 도메인(B5). 본문 블록은 DB `validate_campaign_sections`·`lib/campaigns.ts` 파서·어드민 폼이 1:1 |
| 오프라인 팝업 | `/offline-popups`, `/offline-popups/[eventId]` | 목록 = `campaign-hub` 카드 문법(2열 580·3:2·유형 뱃지 + 기간·상태 뱃지, R-06 §1.4) + 왼쪽 정렬 h1·필터 칩(§5 탐색 조작부) / 상세 = 안내형 골격(R-06 §2.3: 아트 → 기간·장소 → 리드 → 안내 패널) + `pdp-buybox` 문법(회차 선택 → 수량 스테퍼 → 합계 → 잉크 CTA, 데스크톱 649 \| 446). 푸터 진입, 레거시 `/events/[id]` 딥링크는 리다이렉트 | 회차·잔여·예매·검표 계약 동결 |
| 커뮤니티 | `/community` | `content-card` 문법 재조판 | 작성·좋아요·신고 계약 유지 |
| 검색 | `/search` + 오버레이 | `search-overlay`+결과 = 굿즈샵 컬렉션 본문(사이드바·관련성/가격 정렬·'전체 › N개 결과', 40개/페이지)+숫자 페이지네이션+상품 외 통합 결과(IP·카드·포스트, 커뮤니티 노출 게이트 그대로). 제목(24/400)·재검색 인풋(435×50, 칸 안 돋보기)은 데스크톱 한 줄, 결과가 있는 모바일은 둘을 걷는다(제목은 읽기 전용으로 남김). 검색어를 싣는 제목·빈 결과 제목은 공백 없는 긴 토큰도 어디서든 끊어 가로 넘침을 만들지 않는다 | `getSearchSnapshot`·URL 상태 유지(q → 필터·정렬 → page, 필터를 바꾸면 1페이지) |
| 카트 | `/cart` | `mini-checkout-cart`(쿠폰 select는 B1에서 활성, 모바일 서브헤더·하단 고정 주문 바) | local/DB 병합·수량 계약 유지 |
| 체크아웃·주문·티켓 | `/checkout*`, `/orders*`, `/tickets*`, `/ticket-checkout*` | 흰 종이형 영수증·상태 타임라인. 주문·티켓 목록·상세는 `mypage-shell` 안 콘텐츠(주문 목록 머리는 셸 문법, 상세 2열은 1200px 이상) — 목록 위 리뷰 이벤트 배너(내 주문 굿즈에 진행 중 이벤트가 있을 때만, 보상이 가장 큰 1장), 아래 '주문 후 배송 과정' 5단계. 주문서 두 벌의 배송지 칸 위 `address-book` 선택·저장(주소록 기본 배송지 → 결제를 마친 직전 주문 순으로 미리 채우고 출처를 안내) | 스타일 변경만으로 결제 계약을 바꾸지 않는다. 주소록은 입력 보조라 주문에 저장되는 배송지 JSON·주문 생성 경로를 바꾸지 않는다. 2026-10-14 승인된 [공통 거래 모델](docs/research/smartstore-admin/goods-transaction-module-proposal.md)의 굿즈 주문서는 별도 서버 견적·복구 계약을 따른다. 티켓·콜백의 기존 계약은 유지한다. |
| 인증 | `/login`(가입·재설정 모드), `/update-password`, `/account-suspended`, `/manager-invitation` | `flat-auth-form` — `/login`은 전역 셸 안, 나머지는 집중형 셸(`isAuthShellPath`) | OAuth·recovery·필드 계약 유지 |
| 마이 | `/my` 이하 전부 | `mypage-shell`+`mypage-dashboard`(`/my`)·`wish-grid`·`grade-benefits`·`address-book`(`/my/addresses`)·쿠폰함(B1)·Q&A 내역(B3). 설정은 배송지 관리 진입·약관 및 정책 링크·비밀번호 변경 진입(계정 이메일로 재설정 링크를 보내는 버튼 행 — 세션만으로 비밀번호 화면을 열지 않는다) | 기존 조회·설정·카트 담기 계약 유지(대시보드 새 조회는 팔로우한 IP 목록, 새 RPC는 등급별 혜택 읽기 하나). 주소록 쓰기는 본인 RPC 셋(저장·기본 지정·삭제)뿐이고 주문 주소 계약을 바꾸지 않는다 |
| 법적·문서 | `/legal/*` | `document-page`(620) | 정적 파라미터 유지 — 쿠키·세션을 읽지 않는다 |
| 회사 소개 | `/about`(신규) | `about-legacy-showcase` | 구 홈 콘텐츠 보존, CTA 링크는 신 사이트로 |
| 지우학 체험 게임 | `/games/hyosan-memories` | `standalone-game` | 서버 판정·한도·보상 동결 |
| 팝업 | `/popups`, `/popups/[id]` | v5 신설(§14.8) — `PromoCard` 3열 목록 + POP-UP 캠페인 랜딩(`CampaignLanding`, 머리에 장소 줄) | 오프라인 팝업 예매·티켓·검표 계약은 `/offline-popups`가 그대로 소유 |
| 404·에러·로딩 | `not-found`·`error`·`loading` | White Catalog 기본 표면. 404는 제목 18/700 + [이전 페이지(잉크, 기록 없으면 홈) · 메인으로(아웃라인)] 260×56 — 일러스트는 ICONS 라인아트(LG-7) 대기, 수치는 `wc-chrome.css` 404 구간 | — |

v5(§14) 적용: 위 표의 **홈**·**굿즈샵**(`/shop`·NEW·BEST·`?displayCategory=`)·**이벤트**(`/events` 허브) 행의 적용 패턴은 §14가 우선한다 — 굿즈샵의 사이드바 필터·`collection-banner`·4열은 NEW·BEST·카테고리에서 스트립 배너·탭 줄·5열로 바뀌었고(필터 본문은 검색·IP관만), 이벤트 허브의 ALL/EVENT/DROP 탭·2열 카드는 `PromoCard` 3열로 바뀌었다. 상품 상세·카트·마이 등 나머지 행은 그대로다.

지우학 프레젠테이션 `/ip/aouad`는 `/ip`의 별도 시연 카드에서 들어가는 전용 경험이다. 디렉토리는 White Catalog를 유지하고, 경험은 `components/online-popup/aouad`의 CSS module 경계 안에서 야간 효산고의 장면·소품·타이포를 사용한다. 공용 내비게이션·문의 위젯은 `isStandaloneShellPath`로 비우고, 사업자 정보·법정 고지 푸터는 경험 아래에 둔다(`hidesSiteFooter` — 푸터는 인증 집중 셸·어드민에서만 비운다, 1014-X36). 전역 토큰을 덮지 않는다. 프레젠테이션 표기와 ICONS 복귀 동선을 유지하고 실제 주문·결제·예약·리워드로 이어지지 않는다.

## 9. 상태·피드백 (승계)

로딩=최종 비율 보존 skeleton / 빈 상태=원인+다음 행동 1개 / 오류=재시도와 안전 이탈 / 성공=서버 확인 전 "완료" 금지 / disabled=시각+`aria` 일관. 결제·예매·검표 진행 중 주변 자동 모션 금지.

## 10. 반응형·접근성 (승계 + 갱신)

- 반응형: §frontmatter 브레이크포인트. 모바일에서 콘텐츠는 2열(상품)·1열(정보), 유틸바 숨김, GNB는 가로 탭, PDP는 1열 스택+`mobile-buybar`. 360px에서 금액·주문번호·CTA overflow 별도 검증.
- 접근성: WCAG AA 대비(**확정 — 소형 액센트 텍스트는 brand-green 대신 `state.success`를 쓴다. §2 사용처 분류 참조**), 키보드 전 조작, focus-visible 2px `state.focus`, 아이콘 버튼 44px+접근 이름, 캐러셀 정지 수단·현재 위치, 모달·시트 focus trap·Escape·복귀 포커스, 고정 크롬·하단 바·안내 뒤로 키보드 포커스가 가려지지 않음(WCAG 2.2 SC 2.4.11 — 상·하단 착지선), 색·위치 단독 의미 전달 금지.
- 모바일 탐색의 이동 가능한 비현재 메뉴는 불투명도 대신 `ink.tertiary`(#616161, 흰 지면 대비 약 6.2:1)를 쓴다. R-01의 GNB .35·하단 탭 .3 opacity는 비활성 상태로 오인되고 AA 대비에 미달하여 채택하지 않는다. 모바일 GNB의 현재 탭은 밑줄도 함께 표시한다.
- 모바일 회사·정책 링크는 구분선 없는 2열 목록으로 정렬한다.
- 온라인 팝업 디렉토리는 750~989px에서 2열 행과 피처드 캐러셀·가로 이니셜 필터를 유지하고, 990px부터 5열 피처드·4열 목록을 펼친다. 피처드 캐러셀의 현재 위치는 점 버튼(24×44 터치·aria-current)이 알린다. 클릭 가능한 이니셜 필터도 `ink.tertiary`를 써 비활성처럼 보이지 않게 한다.

## 11. 백엔드·API 불변 계약

디자인 이행은 표현 계층 변경이다. 아래는 별도 기능 승인 없이 수정하지 않는다.

```yaml
protected-boundaries:
  - supabase/migrations/**        # 신규 migration 추가는 T-A/T-B 기능 작업으로만
  - supabase/tests/**
  - lib/supabase/**
  - lib/auth/**
  - lib/payments/**
  - lib/admin/**
  - proxy.ts
  - app/auth/callback/**
  - app/api/**
  - app/**/actions.ts             # 신규 기능의 신규 action 추가는 허용, 기존 계약 변경 금지
  - components/shell/CartProvider.tsx
  - components/shell/AuthPresenceProvider.tsx
  - components/payments/**
```

- 결제: 굿즈·티켓 신규 결제의 기본 provider는 **토스페이먼츠 주문서형 v2**(provider-neutral seam 뒤 gate 제어, ADR-0013)이고, 확정은 서버 전용 `PaymentGateway.confirm/reconcile`+DB 멱등 finalizer뿐이다. **판매 제한 상품**(성인(19금))이 담긴 주문만 서버가 주문 단위로 **Korpay**를 파생한다 — 관리자가 PG를 고르는 축이 아니다. 콜백 body·클라이언트 성공 신호는 진실원이 아니다.
- 쿠폰 할인과 KRW 적립금 사용은 서버 주문 생성 RPC에서 확정한다. 상품·기간 할인, 쿠폰, 적립금, 배송비를 각각 구분해 표시하고 적립금의 사용 조건과 잔액을 클라이언트에서 확정하지 않는다. 참여 코인·카드 리워드는 결제금액과 분리한다.
- 가격·재고·랜덤 판매 배정·티켓 수용량·QR 검표를 클라이언트 상태로 옮기지 않는다.
- 공개 브라우징 유지 — 로그인은 보호 액션 시점에만.
- 신규 함수는 생성 후 `revoke all ... from public, anon, authenticated, service_role`로 봉인 후 필요한 롤에만 grant.
- 관리자 권한은 `profiles.role`+RLS 양쪽, 민감 작업은 감사 가능.

### 회귀 기준선

- 이행 각 단계 시작 시 `npm run test` 전체 통과 수를 기준선으로 기록하고, 기능 assertion을 느슨하게 만들어 통과시키지 않는다. 시각 마크업 변경으로 클래스명·스냅샷 기대값을 바꿀 때도 행동 단언은 유지한다.
- CSS 계약은 `app/wc-design.test.ts`(WC 토큰·임포트·모션·포커스), `app/admin-kit-contract.test.ts`(kit 토큰은 `.wc-admin` 안에만·남은 관리자 CSS의 레이어와 kit 부품 제외 가드·kit 옷의 범위), `app/admin-surface-contract.test.ts`(editorial 퇴역·관리자 규칙의 `.wc-admin` 경계·토큰 해석·검표 루트), `app/editorial-design.test.ts`(보존 공개 표면의 자립·퇴역 파일 부활 금지)가 지킨다. 문자열 계약은 실제 브라우저 시각 회귀 검수를 대신하지 않는다.

## 12. Do / Don't

**Do** — 흰 지면·잉크·헤어라인 기본 / 액센트는 한 역할 / 상품 카드 anatomy 통일(굿즈 이미지 1:1·잘림 없음) / 모든 목록에 빈·오류·품절 상태 / 실데이터·실경로만 / R-스펙 수치 우선, 어긋나면 R-스펙 갱신과 함께.

**Don't** — 레퍼런스의 이미지·카피·로고·핑크 재사용 금지 / 스크롤 연출·패럴랙스·카드 그림자 금지 / 파스텔 면 사용 금지(`/about` 제외) / 다크 표면 금지(이미지 스크림·잉크 버튼 제외) / 레퍼런스 결함(강제 리다이렉트·숨김 위젯·영문 노출·기간 미표기) 재현 금지 / 새 디자인을 이유로 form field·action·권한 검사 교체 금지 / '가챠·뽑기·충전' 어휘 사용자-facing 금지.

## 13. 구현 순서

1차 개편(S1~S9)의 단계·PR 구조는 [docs/research/linefriends-square/09-implementation-plan.md](docs/research/linefriends-square/09-implementation-plan.md)가 정본이고, 2026-09-01 main 전환(#333)으로 라이브됐다. 2차 패리티(2026-10)의 차이 목록과 단계는 [11-parity-audit-2026-10.md](docs/research/linefriends-square/11-parity-audit-2026-10.md)·[12-parity-plan-2026-10.md](docs/research/linefriends-square/12-parity-plan-2026-10.md)가 정본이다. 완료 조건: 각 표면이 §8 플레이북과 R-스펙 수치(11의 정정 포함)를 만족하고, §11 계약 테스트가 통과하며, `npm run lint`·`npm run build`·`npm run test` 통과 + preview 검수.

## 14. X SQUARE 표면 (v5 — ADR-0043)

2026-11-12 신사업팀 Figma(Main·New·Best·Category·POP-UP·Event, 1920 캔버스)가 아래 표면의 시각 정본이다. 결정과 대가는 [ADR-0043](docs/adr/0043-xsquare-figma-storefront.md), 운영 입력은 [xsquare-storefront-content](docs/runbooks/xsquare-storefront-content.md)·[storefront-categories](docs/runbooks/storefront-categories.md) 런북이다. 이 절은 v4 절(§2~§8)을 대체하지 않고 **겹치는 부분만 우선**한다.

### 14.1 적용 범위

| 표면 | 정본 | 비고 |
|---|---|---|
| 셸 — 롤링 띠배너·유틸 메뉴·1단 헤더·GNB·푸터·검색 패널 | v5 | 모바일 셸(로고 행 81 + GNB 탭 행 51 + 바텀 탭바·전체 메뉴 시트)은 로고만 바뀌고 v4 그대로 |
| 홈 `/` | v5 | 섹션 종류·기본 순서는 v5, 어느 IP·배너를 보이는지는 운영 데이터 |
| `/shop/new`·`/shop/best`·`/shop`(전체·`?displayCategory=`) | v5 | 필터가 있는 본문(`CollectionBrowser`)은 검색·IP관에만 남는다 |
| `/popups`·`/popups/[id]`·`/events` | v5 | `/events/[eventId]` 랜딩 본문(`CampaignLanding`)은 v4, 머리의 장소 줄만 추가 |
| 상품 카드 `ProductCard` | v5 | 카드를 쓰는 **모든** 화면(검색·IP관·위시·최근 본·PDP 연관·장바구니 추천 등)에 적용 |
| 그 밖(PDP·카트·체크아웃·주문·마이·검색·IP관·오프라인 팝업·법적 문서·인증·`/about`) | v4 | 이 절이 건드리지 않는다 |

v5 표면의 액센트는 초록이 아니라 잉크다. 빨강은 롤링 띠·할인율·위시 하트에만, 칩 3색은 카드 칩에만 쓴다. radius는 칩 3 · 상품 행 썸네일 6 · 카드·썸네일 8 · 스트립 12 · IP 버튼 15 · 히어로 18이다.

### 14.2 토큰 (`app/styles/wc-foundation.css` `.wc-root`, 접두 `--wc-x-`)

새 부품과 화면은 강한 글에 `--wc-x-ink`(#121212)를 쓴다. 옛 표면은 기존 `--wc-ink`(#111111) 그대로다. 썸네일 바탕 #F3F3F3은 기존 `--wc-surface-grey-2`다. "Figma 값"은 원본, "구현 값"은 AA 보정 뒤 값이다(§14.3).

| 토큰 | 구현 값 | Figma 값 | 쓰는 곳 |
|---|---|---|---|
| `--wc-x-container` | `1320px` | 1320 | 넓은 컨테이너 최대 폭 |
| `--wc-x-gutter` | `24px`(≥990) · `16px`(<990, 기존 `--wc-gutter`) | 24 | 넓은 컨테이너 좌우 |
| `--wc-x-content` | `1272px` | 1272 | 참고값(결과 폭) — 부품은 폭을 이 값으로 고정하지 않고 컨테이너 100%를 쓴다 |
| `--wc-x-ink` | `#121212` | `#121212` | 제목·상품명·가격·탭 선택 |
| `--wc-x-muted` | `#767676` | `#888888` | 보조 글자(IP명·탭 비선택·브랜드) |
| `--wc-x-separator` | `#888888` | `#888888` | 탭 사이 1×12 구분선(장식) |
| `--wc-x-footer-link` | `#535353` | `#535353` | 푸터 링크 |
| `--wc-x-line-pill` | `#DBD9D9` | `#DBD9D9` | 전체보기 알약 테두리 |
| `--wc-x-line-util` | `rgba(217,217,217,.5)` | `#D9D9D9`@50% | 유틸 아래·푸터 위·카테고리 칩 줄 구분선 |
| `--wc-x-line-row` | `#CFCFCF` | `#CFCFCF` | X SQUARE PICK 카드 상품 행 사이 |
| `--wc-x-line-card` | `rgba(196,196,196,.8)` | `#C4C4C4`@80% | X SQUARE PICK 카드 테두리(0.5px) |
| `--wc-x-sale` | `#E02424` | `#FF4D4D` | 할인율 글자 |
| `--wc-x-heart` | `#FF4D4D` | `#FF4D4D` | 위시 하트 선택(비텍스트) |
| `--wc-x-rolling-bg` | `#E31B23` | `#EC2227` | 롤링 띠배너 바탕 |
| `--wc-x-progress-track` / `-thumb` | `#E5E5E5` / `#555555` | 같음 | 히어로 진행 막대 |
| `--wc-x-control` | `#888888` | 같음 | 히어로 화살표(비텍스트) |
| `--wc-x-chip-preorder-bg` / `-ink` | `#F3EBFA` / `#8650BD` | `#F3EBFA` / `#955FCA` | 예약판매 칩 |
| `--wc-x-chip-shipping-bg` / `-ink` | `#E3F2F8` / `#276E89` | `#E3F2F8` / `#3485A3` | 무료배송 칩 |
| `--wc-x-chip-random-bg` / `-ink` | `#FFF1DA` / `#A6560B` | `#FFF1DA` / `#F08418` | 캡슐토이 칩 |
| `--wc-x-chip-tag-bg` / `-ink` | `#F3F3F3` / `#3F3F3F` | (Figma 숨은 NEW 레이어) | 운영 배지(NEW·EXCLUSIVE) 칩 |
| `--wc-x-radius-hero` / `-ip` / `-strip` / `-card` / `-thumb-sm` / `-chip` | 18 / 15 / 12 / 8 / 6 / 3 px | 같음 | 히어로 / IP 바로가기 / 스트립 배너 / 썸네일·프로모션 카드 / 상품 행 썸네일 / 칩 |

### 14.3 AA 보정 (Figma 값을 어둡게 한 곳)

Figma의 일부 색은 WCAG AA(작은 글자 4.5:1, 비텍스트 3:1)에 못 미친다. 이 저장소는 AA를 지켜 왔으므로(§10, 배지 글자색 선례) 아래만 어둡게 했다. 원본으로 되돌리기로 하면 토큰 한 곳만 바꾸면 되고, 그때는 이 표를 함께 고친다.

| 쓰임 | Figma 값(대비) | 구현 값(대비) | 배경 |
|---|---|---|---|
| 보조 글자 `--wc-x-muted` | `#888888`(3.5:1) | `#767676`(4.5:1) | 흰 지면 |
| 할인율 `--wc-x-sale` | `#FF4D4D`(3.3:1) | `#E02424`(4.7:1) | 흰 지면 |
| 롤링 띠 바탕 `--wc-x-rolling-bg`(흰 글) | `#EC2227`(4.4:1) | `#E31B23`(4.7:1) | 흰 글자 |
| 예약판매 칩 글자 | `#955FCA`(3.8:1) | `#8650BD`(4.6:1) | `#F3EBFA` |
| 무료배송 칩 글자 | `#3485A3`(3.6:1) | `#276E89`(5.0:1) | `#E3F2F8` |
| 캡슐토이 칩 글자 | `#F08418`(2.3:1) | `#A6560B`(4.8:1) | `#FFF1DA` |

유지한 값: 위시 하트 `#FF4D4D`·히어로 화살표 `#888888`(비텍스트 3:1 이상), 푸터 링크 `#535353`(7.7:1). 위시 하트는 Figma가 원 없는 `#E6E6E6` 채움이라 `#F3F3F3` 썸네일 위에서 1.1:1이므로 흰 원 32 + 1px `--wc-hairline` 위에 올리고 빈 하트의 선은 `--wc-ink-tertiary`로 그린다.

### 14.4 컨테이너·그리드·브레이크포인트

- 넓은 컨테이너 `<div className="wc-container wc-container--wide">`: 최대 1320, 데스크톱 좌우 24(안쪽 1272), <990은 기존 거터 16. 기존 `.wc-container`(1212)는 다른 표면이 계속 쓴다.
- 크롬 브레이크포인트 990(헤더·푸터), 콘텐츠 브레이크포인트 750(그리드)은 v4 그대로이고 그리드에만 1200 단이 하나 더 있다.

| 폭 | 상품 그리드 열 | 열 간격 | 줄 간격 홈 / 목록 | 히어로 | IP 바로가기 | X SQUARE PICK | POP-UP·EVENT 카드 |
|---|---|---|---|---|---|---|---|
| ≥1200 | 5 | 15 | 24 / 56 | 1272×540 r18 | 265×180, 4열 가운데(간격 20) | 3열 | 3열(408:260) |
| 990–1199 | 4 | 15 | 24 / 48 | 비율 유지 | 같음 | 3열 | 3열 |
| 750–989 | 3 | 12 | 24 / 40 | 5:6 r12 | 4열 유동(간격 12) | 2열 | 2열 |
| <750 | 2 | 12 | 28 / 32 | 5:6 r12 | 2열(간격 12, 줄 20) | 1열 | 1열 |

헤더·푸터: ≥990은 1단 헤더 행 108(스크롤 >150이면 68)과 푸터 한 줄 2열, <990은 모바일 셸(로고 행 81 + GNB 탭 행 51)과 푸터 세로 쌓기. 롤링 띠배너는 전 폭에서 높이 40(사본 간격 ≥990 200, 미만 80).

### 14.5 부품 (`components/wc` — 새 화면은 이것을 import하고 카드·그리드·머리를 새로 만들지 않는다)

| 부품 | 파일 | 규칙 |
|---|---|---|
| 상품 카드 | `components/wc/ProductCard.tsx` | 썸네일 정사각 r8(이미지는 1000×1000 `contain` 유지) → IP명 14 Medium `--wc-x-muted` 1줄 → 상품명 14 Medium `--wc-x-ink` 2줄 → 할인율 15 Bold `--wc-x-sale` + 판매가 16 Bold(**취소선 정가를 카드에 그리지 않는다** — `PriceBlock variant="inline"`) → 칩 줄(11 SemiBold, r3, 패딩 3/4, 간격 6) → 별점 줄. 위시 하트는 썸네일 우하단 inset 8(히트 44, 보이는 원 32). 카드 어디를 눌러도 상세로 간다 — 이름 링크 덮개, 하트·이미지 넘김·담기 버튼·색상 점은 덮개 위(MD-0044). 옵션 가격이 다르면 범위 대신 지금 살 수 있는 옵션의 최저가 한 금액(MD-0049). 품절·판매 기간 밴드('판매 예정'·'판매 종료')·19금 가림(썸네일만 가리고 IP·이름·가격, MD-0048)·갤러리·색상 칩·담기는 v4 동작 그대로 |
| 카드 칩 | `lib/product-card-chips.ts` | 순서 예약판매 → 무료배송 → 캡슐토이 → 운영 배지(NEW·EXCLUSIVE). 예약판매 = 옵션 하나라도 예약 접수 중이고 남은 물량 있음, 무료배송 = `shippingFeeType === 'free'`, 캡슐토이 = 랜덤 판매(ADR-0027). SALE은 칩이 아니다. 칩 판정은 이 함수 한 곳이고 화면이 따로 판정하지 않는다 |
| 상품 그리드 | `components/wc/ProductGrid.tsx` | `<ul class="wc-x-grid" data-density="home" 또는 "listing">`, 열·간격은 §14.4. 기존 `.wc-product-grid`(4열)는 v4 표면용으로 남는다 |
| 섹션 머리 | `components/wc/SectionHeader.tsx` | 제목 28 Bold `--wc-x-ink`(<750은 20) + 전체보기 알약(13 Medium, 1px `--wc-x-line-pill`, 높이 38, 접근 이름 "제목 전체보기"). `moreHref`가 없으면 알약을 그리지 않는다 |
| 스트립 배너 | `components/wc/StripBanner.tsx` | `size="home"` 1272×170 · `size="page"` 1272×340, r12, cover. 모바일(<750)은 r8이고 모바일 이미지가 있으면 그 고유 비율. 여러 장을 넘기는 슬라이더는 목록용 `CollectionBanners`·캠페인용 `CampaignBannerSlider`가 같은 `.wc-strip-banner` 계열로 맡는다 |
| 프로모션 카드 | `components/wc/PromoCard.tsx` | 408:260 r8, 아래 150px 그라데이션(#121212 0→100%) 위 흰 제목 20 Bold 최대 2줄(`<h3>`), 선택 메타 한 줄 14 Medium, 선택 배지("오픈 예정"). 카드 전체가 링크 하나. POP-UP·EVENT 목록과 홈 X SQUARE PICK이 같은 모양을 쓴다 |
| 위시 하트 | `components/shop/ListingWishHeart.tsx` | Figma 하트 경로, 선택은 채움·비선택은 선 |

새 CSS의 선택자는 `.wc-x-`·`.wc-strip-banner`·기존 `.wc-product-card` 계열(공용 부품), `.wc-listing*`(목록), `.wc-promo-*`·`.wc-popups*`(POP-UP·EVENT)로만 시작한다 — 전역 element 규칙을 두지 않는다. import 순서는 `wc-inquiry-widget.css` → `wc-storefront-x.css` → `wc-listing.css` → `wc-popups.css`로, 화면 CSS가 부품 기본값을 덮는다(`app/layout.tsx`).

### 14.6 셸

- **롤링 띠배너**(텍스트 공지 바): 높이 40, 바탕 `--wc-x-rolling-bg`, 글 13 Medium 흰색, 같은 사본 8개가 오른쪽에서 왼쪽으로 40초 선형 반복. 같은 화면 후보가 여럿이면 스토어를 새로 열 때마다 하나를 무작위로 보인다(이미지 띠배너와 같은 방식, 시드는 따로). 오른쪽 닫기(44×40 흰 X)를 두고, hover·포커스에서 멈추며, 줄인 움직임에서는 흐르지 않고 문구가 가운데에 선다(WCAG 2.2.2).
- **유틸 메뉴**(≥990만): 높이 48, 아래 1px `--wc-x-line-util`, 12 SemiBold `--wc-ink-tertiary`, 오른쪽 끝 정렬. 비로그인 `로그인 / 회원가입`·`고객센터`, 로그인 `위시리스트`·`주문조회`·`알림함`·`로그아웃`·`고객센터`. `공지사항`은 게시판이 없어 그리지 않는다. 어드민 콘솔에 들어갈 수 있는 운영자에게만 맨 앞에 `관리자 페이지`(`/admin`, 같은 스타일)가 더 선다 — 브라우저 운영 권한 readback 뒤에만 마크업이 생기고(서버 HTML 없음), 모바일은 전체 메뉴 시트 맨 위 `스태프 전용` 섹션, 공통으로 푸터 스태프 블록 맨 앞이 같은 링크를 든다.
- **1단 헤더**(≥990): 행 108(위아래 32), 왼쪽에 로고(높이 24)와 GNB(17 SemiBold, 항목 패딩 12/15), 오른쪽에 검색·장바구니·마이 아이콘(44×44, Figma 원본 경로 인라인, `currentColor`). GNB 현재·hover는 글 아래 2px 잉크 막대다. 스크롤 >150이면 행만 68로 줄고 GNB는 접히지 않는다. 로고는 `public/brand/xsquare-logo.png`(운영 업로드 로고가 우선, `data-store-header="color"`에서는 잉크가 흰색일 때 `invert`).
- **sticky 크롬 높이 계약**: 모바일 52 · 데스크톱 축약 69 · 데스크톱 펼침 **109**(행 108 + 선 1) — `wc-chrome.css`의 `--wc-sticky-chrome-h`와 `globals.css`의 `html scroll-padding-top`이 같은 값이고 `components/shell/chrome-styles.test.ts`가 맞춘다. (v4 §4의 데스크톱 123은 v5에 해당하지 않는다.)
- **검색 패널**: 비모달(`aria-modal="false"`). 딤 위에 밝게 남는 줄 — 공지 띠(롤링 띠배너·이미지 스트립)·유틸 메뉴·헤더 행 — 은 inert에서 빠져 열린 채로도 눌린다. 로고·장바구니·마이·유틸 메뉴·공지 링크(공지 닫기 포함)는 이동과 함께 패널을 닫고, 카테고리·온라인 팝업 메가메뉴는 열릴 때 패널을 닫으며, 검색 아이콘은 열기/닫기 토글이다. 본문·푸터·탭바(과 모바일 GNB 탭 행)는 딤 + inert(MD-0034 — 밝으면 눌리고 딤 아래면 안 눌린다).
- **GNB 구성**: 기본 NEW · BEST · 카테고리 · POP-UP · EVENT, 온라인 팝업·커뮤니티·쇼핑스토리는 기본 숨김(운영 메뉴 설정으로 켠다). `/popups*`·`/offline-popups*`에서 POP-UP, `/events*`에서 EVENT가 켜진다. 카드팩 칸은 2026-11-24 퇴역해 그리지 않고, 커뮤니티는 배포 게이트도 따로 거른다.
- **푸터**: 1행 왼쪽 `엑스스퀘어 이용약관`·`개인정보처리방침`·`배송·반품 정책`·`대량구매`(mailto, 16 Bold `--wc-x-footer-link`), 오른쪽 `고객센터` + 브랜딩 설정의 SNS(인스타그램 아이콘 18, 블로그·페이스북은 글자 링크) → 사업자 정보(상호·주소·대표자·사업자등록번호·통신판매업·전화·이메일·호스팅, 12 SemiBold `--wc-x-muted`, 접지 않음) → 스태프 블록(해당 시) → `© 연도 ICONS`. 법적 문서 3종과 법정 표기는 필수다. 목적지 없는 Figma 항목(공지사항·서비스 가이드라인·X)은 죽은 링크로 만들지 않는다.

### 14.7 홈

섹션은 `wc-container--wide` 안에서 간격 60(모바일 48)이다. 기본 순서(저장 레이아웃이 없을 때): 히어로 → IP 바로가기(`editor_picks`) → NEW ARRIVAL(`new_arrivals`) → 홈 스트립 배너(`strip_banner`) → IP 상품 섹션(상품 모음) → X SQUARE PICK(`band:`) → 카테고리 BEST·인기템·혜택 → 판매·리뷰 랭킹·모자이크 → 쇼핑스토리.

| 영역 | 데이터 원천 | 모양 |
|---|---|---|
| 히어로 | 프로모션 배너(최대 10) | 1272×540 r18, 글 왼쪽 70·아래 60(부제 21 → 제목 36 SemiBold), 아래 진행 막대(960×3) + 일시정지·이전·다음. 5초 자동 넘김은 손으로 옮겨도 끄지 않고, 일시정지·hover·포커스·탭 숨김·줄인 움직임에서만 멈춘다 |
| IP 바로가기 | 추천 콘텐츠(배지 = IP명, 제목 = 문구) | 265×180 r15 이미지 + IP명 13 Medium + 문구 14 Medium, 가운데 정렬 |
| NEW ARRIVAL | 최신 등록 10개 자동 | `SectionHeader` + 5열 × 2줄, 전체보기 → `/shop/new` |
| 홈 스트립 배너 | 옛 공지 배너(`announcement`)의 첫 노출 행 | `StripBanner size="home"` 1272×170 |
| IP 상품 섹션 | 상품 모음 '그리드형(5열)' 5 또는 10개 | `SectionHeader` + 5열, 고른 상품이 모두 한 IP면 전체보기가 그 IP관 |
| X SQUARE PICK | 연달아 놓인 기획전 배너 | 3열 `PromoCard` + 상품 2행(썸네일 94 r6) 묶음, 0.5px `--wc-x-line-card` 테두리 |

옛 블록(카테고리 BEST·인기템·혜택·쇼핑스토리·랭킹·모자이크·리스트형/풀이미지형 모음)은 렌더를 바꾸지 않고 넓은 컨테이너·섹션 간격만 맞췄다. 운영자가 영역 순서·노출에서 끄면 Figma와 같아진다. 내용(어느 IP·배너)은 코드가 정하지 않는다.

### 14.8 목록 · POP-UP · EVENT

- **한 틀(NEW·BEST·카테고리)**: 스트립 배너 1272×340(원천이 없으면 배너 없이 시작, 가짜 자리 금지) → 제목 28 Bold(MD-0047, 2026-11-23 — 옛 32) + 탭 줄 / 오른쪽 정렬 셀렉트 → 5열 그리드(줄 간격 56) → VIEW MORE(20개 단위). 탭은 URL을 바꾸는 링크 묶음(`nav` + `aria-current="page"`, 미선택 15 SemiBold `--wc-x-muted` · 선택 16 Bold `--wc-x-ink`, 사이 1×12 구분선)이고 ARIA tablist가 아니다. 정렬 셀렉트는 네이티브 `<select>`(라벨 "정렬 기준")다. 왼쪽 필터·필터 시트·수량 줄은 없다.
- **정렬 7종**: 추천순·인기도순·최신 등록순·판매량순·낮은 가격순·높은 가격순·리뷰 많은순. NEW는 탭 줄이 정렬(추천순 제외 6종, 기본 최신 등록순)이라 셀렉트가 없다. BEST 탭은 실시간·일간·주간·월간(기본 실시간)이고 셀렉트는 순위 목록 안에서 다시 줄 세운다.
- **카테고리 칩**(배너 아래, 가운데): 알약 높이 45·패딩 0 30·간격 10, 1줄 = '전체' + 1단계 트리 순서 앞 4개(18 SemiBold `--wc-x-ink`), 구분선 아래 2줄 = 나머지(15 SemiBold `--wc-x-muted`). 선택 칩은 `--wc-x-ink` 채움 + 흰 글자(`aria-current`). 선택한 1단계의 2단계가 하위 탭('전체' + 자식)이 된다. <750은 한 줄 가로 스크롤(높이 36).
- **POP-UP·EVENT**: 제목 28 Bold(MD-0047, POP-UP은 비었을 때 시각 숨김 h1) + `PromoCard` 3열(줄 간격 40, 열 간격 24). POP-UP 메타 줄은 `{온라인|오프라인|온·오프라인} · {장소?} · {기간}`, 오픈 예정 카드는 왼쪽 위 "오픈 예정" 배지. EVENT는 맨 위에 추천 캠페인 스트립 배너(이미지만, 슬라이더는 5초 자동·정지 버튼·줄인 움직임 존중). 빈 상태는 `EmptyState`("진행 중인 POP-UP이 없어요" / "새 POP-UP이 열리면 이 자리에서 가장 먼저 알려 드릴게요." / 홈으로 가기).

### 14.9 규율

1. v5 표면에 새 컴포넌트를 더할 때는 §14.5 부품을 먼저 쓰고, 값은 `--wc-x-*` 토큰으로만 적는다(색·반경 하드코딩 금지). Figma 값을 직접 쓰면 AA 보정이 사라진다.
2. 레퍼런스(LFS)와 마찬가지로 Figma의 이미지·카피·로고를 코드에 옮기지 않는다 — 콘텐츠는 운영 데이터이고, 로고만 승인된 `xsquare-logo.png`다.
3. 어드민(`/admin/**`)은 이 절의 영향을 받지 않는다. 어드민 전시 미리보기가 공개 컴포넌트를 렌더하므로 공개 부품은 `.wc-root` 안에서만 스타일이 먹도록 쓴다.
4. 기능 계약(§11)은 그대로다. 정렬·랭킹 읽기는 DB RPC(정렬된 id 배열만), 노출 설정은 `campaign_presentations`가 정한다.

## 어드민 콘솔 (ADR-0014 · ADR-0028 · ADR-0029)

- **룩(ADR-0028, 2026-11-06 전 화면 전환 · ADR-0029, 2026-11-09 색과 시각 위계):** shadcn/ui base-nova 부품 + 콘솔 전용 색 체계. 서체만 로컬 Pretendard 1.3.9(`admin-font.css`). 스마트스토어 기준은 룩이 아니라 업무 쪽 — 메뉴 IA·라벨 어휘·조회 조건·처리 동선·정책 — 에 남는다. 「판매자센터 기준(2026-10-16)」의 색(상단 `#2d3539`·좌측 `#475161`·초록 `#00c73c`)·크기(34·44px 입력)·표 밀도는 퇴역했다.
- 범위: 셸·2단 IA·audited RPC·원장·테스트는 유지한다. 재설계 대상은 워크플로 표면 — 폼·목록·상세·설정.
- 다섯 패턴이 합격 기준이다: 모든 자원에 전용 상세 페이지와 타임라인 / 모든 목록에 검색·필터·페이지·일괄 액션 / 초안→공개→보관 게시 상태와 실패에 살아남는 폼 / 설정 섹션(코드 상수→DB 설정) / 엑셀 가져오기·내보내기.
- 라벨 어휘: 스마트스토어의 업무 어휘(상품 조회/수정·상품 등록·상품번호·옵션)를 기준으로 한다. 시스템이 만드는 코드 두 칸만 예외로 상품 자동코드·옵션 자동코드라 부르고 기본으로 잠근다(ADR-0048, 스마트스토어의 판매자상품코드·관리코드는 판매자가 자기 코드를 넣는 칸으로 읽혀 바코드·ERP 코드를 넣는 사고가 났다). 티켓은 어드민 안에서도 "상품"이라 부르지 않는다(`CONTEXT.md` Flagged ambiguities). 템플릿의 영어 문구는 운영팀 어휘로 바꾼다.
- 문구(2026-11-19): 안내·칸 이름·예시 글·오류·확인창은 운영팀·MD가 읽는 말로 쓴다. 정보는 빼지 않고 개발 용어(반입·선행 0·미설정·스냅샷·응답·세션 등)를 운영 어휘로 바꾸며, 어느 칸에 무엇을 넣고 결과가 어디(고객 화면·엑셀·메일)에 보이는지, 오류는 고칠 방법까지 말한다. 이름이 비슷한 칸(ERP 코드·바코드·상품 자동코드·옵션 자동코드)은 서로 어떻게 다른지 적는다. 규칙과 용어 대체표는 [어드민 문구 작성 규칙](docs/admin-copy-guide.md)이다.
- 운영 합격 시나리오 S1~S5(일괄 등록 30종·입력값 소실 0·주문 100건 발송 클릭 10회 이내·이동 없는 문의 응대·배포 없는 설정 변경)는 ADR-0014에 기록돼 있다.
- 토큰(ADR-0029): `admin-kit.css`의 `.wc-admin`만 소유한다. 면 `--page`(앱 바탕 청회색)·`--card`(흰색), 주 색 `--primary`·`--primary-soft`·`--primary-soft-foreground`·`--ring`(값을 바꿀 때 이 넷만), 의미색 `--success`·`--warning`·`--info`·`--destructive`와 각 `-soft`·`-border`, 선 `--border`·`--border-strong`·`--input`(흰 바탕 3:1), 차트 `--chart-1..5`·`--chart-comparison`. 유틸리티는 `@theme inline`의 `bg-primary-soft`·`text-success`·`bg-warning-soft`·`bg-danger-soft` 등. 화면은 hex·oklch·팔레트 유틸리티(`text-green-600`)를 쓰지 않는다(계약 테스트). 색은 토큰과 공용 부품에서 해결하고 화면이 고르지 않는다. 주 색은 행동·현재 위치 전용, 의미색은 상태 전용이다. 같은 상태는 모든 화면에서 같은 색이며 상태→tone은 `lib/admin/status-tone.ts`가 진실원이다.

### 셸

- 사이드바: 흰 면, 현재 메뉴는 주 색 옅은 바탕(`bg-primary-soft`)·주 색 글자, 현재 메뉴가 속한 그룹은 주 색 글자. kit Sidebar inset·아이콘 접힘(15.5rem / 3rem), 768px 미만은 왼쪽 시트. 접힘 상태는 `sidebar_state` 쿠키로 다음 화면에도 같다(⌘/Ctrl+B·가장자리 레일·상단 버튼). 머리(브랜드·역할·메뉴 검색) → 홈 → 즐겨찾기 → 대분류(lucide 그룹 아이콘, 접이식 — 자동으로는 열기만 하고 닫기는 사용자만, 열린 그룹·즐겨찾기는 계정별 쿠키 `icons_admin_nav`) → 사이트로 돌아가기.
- 상단 막대: h-12 sticky(`data-admin-header`, `html` scroll-padding-top 48). 사이드바 버튼 · 현재 위치(홈 › 메뉴 › 화면) · 콘솔 전환(구분 선택) · 판매자 가이드·쇼핑몰 바로가기 · 업무 도구(알림·할 일·도움말 아이콘 → 오른쪽 비모달 시트 — 연 채로 본문을 조작하고, 패널의 닫기·Esc로 닫는다 — 상담하기 링크) · 계정 메뉴(이메일·권한·로그아웃). 768px 미만 메뉴 시트는 안쪽 닫기 버튼이 있다. ⌘/Ctrl+B는 입력칸·본문 편집기 안에서는 사이드바를 접지 않는다(굵게 등 편집 단축키 우선).
- 본문: 회색 바탕 위 rounded-xl 흰 패널(SidebarInset, div), 안쪽 p-4 md:p-6. 본문 칸만 `<main>`이고 상단 막대는 그 밖의 banner다. 첫 줄이 화면 제목 h1(text-xl semibold, 홈·상담하기는 sr-only), 화면이 돌려준 덩어리 사이는 gap-4. 화면 머리(`AdminPageHeader`)의 h2가 셸 h1과 같은 이름이면 h2는 sr-only로 감추고 설명·동작만 보인다(`admin-shell-title.tsx`). 화면 하단 고정 바는 `--admin-content-left`·`--admin-content-inset`으로 패널에 맞춘다.
- 인쇄: 상단 막대·사이드바·화면 제목을 숨기고 패널 여백·그림자를 뺀다. 상담하기는 선택한 대화만(목록·작성칸·상담 정보 제외) 높이 제한 없이, 문의·리뷰 팝업은 높이 제한·닫기 없이 인쇄한다.
- 현장 검표(`/admin/check-in`)는 셸 없는 전체 화면이다(`check-in-shell wc-admin`). 태블릿·휴대폰용으로 버튼·입력 48px.

### 부품

| 요소 | 구조와 규율 |
|---|---|
| 버튼 | kit `Button`·`buttonVariants`: default(주 동작, 한 영역에 실선 주 색 하나)·soft(자주 쓰는 조회·적용)·outline(보조)·destructive(복구 가능한 위험)·danger(되돌릴 수 없는 위험의 주 행동 — 환불 실행 등, 실선 빨강)·secondary·ghost(아이콘). 크기 default h-8 · sm h-7 · xs h-6 · lg h-9 · icon size-8/7. form 제출 버튼은 `type="submit"`(kit 기본은 button). Link·label·summary 버튼은 `buttonVariants` + `data-slot="button"`. 아이콘만 있는 버튼은 aria-label. |
| 입력 | kit Input·Textarea·NativeSelect·Label·Field, h-8 text-sm rounded-lg, 포커스 ring-3 ring/50, 오류 aria-invalid. 체크박스·라디오는 FormData·비제어 동작에 기대면 네이티브로 두고 `admin-kit-vocabulary.css`가 kit 모양을 입힌다. 숫자 입력 스피너 없음(R18, 휠은 AdminNumberWheelGuard). `AdminSelect`는 kit NativeSelect와 같은 폭 규칙(감싸개 기본 내용 폭, 화면이 준 폭은 셀렉트가 채움)이고, 긴 선택값은 실제 잘림에만 아래 도움말로 보인다. 파일 입력은 회색 "파일 선택" 버튼(kit Input), 색 입력은 둥근 견본. 네이티브 `details`의 기본 표시는 kit 화살표(`admin-kit-vocabulary.css`), fieldset 제목은 테두리 위가 아니라 상자 안(`float-left w-full`). 조회 줄은 위 기준 정렬(도움말이 달린 칸도 같은 높이). |
| 화면 골격 | `AdminPageHeader`(h2 text-lg semibold·설명·동작), `AdminSectionCard`(kit Card, 제목 text-base medium·필수·상태 배지·오류 수·요약), `AdminFormGrid`(최대 2열, 16rem 미만이면 1열, gap-x-6 gap-y-5), `AdminField`(label→입력→도움말→오류, `${inputId}-hint`·`-error`), `AdminSidePanel`, `fields.tsx`(Field·TextArea·SelectField·ColorField·FormShell·RecordList). 템플릿 화면군(상품정보제공고시·이벤트·카테고리·A/S·사이즈·배송 안내·배송정보 템플릿)은 같은 골격이다 — 머리(셸 제목과 같은 h2는 감추고 설명을 보인다, 오른쪽에 kit 기본 크기 등록 버튼 — 서버 폼은 `AdminCreateDialogButton` 팝업) → 조회 카드 → 목록 카드. 주 버튼은 kit 기본 크기(h-8)이고 고정폭·lg를 쓰지 않는다(현장 검표의 48px 터치 버튼만 예외). 엑셀 내려받기 버튼은 Download 아이콘을 단다. |
| 목록 | `ConsoleGrid`: kit 표 모양(머리 bg-muted text-xs, 행 hover·선택 bg-muted), 정렬 링크와 화살표 아이콘, 첫 셀 상세 링크, 선택 열 40px(칸 전체가 클릭 영역), 지정 열 너비는 최소 폭(좁으면 표만 가로 스크롤), 조회항목 설정(열 표시·순서·왼쪽 0~4열 고정, 계정별 저장), 인쇄에서 고정 칸 static, 칸 좌우 px-3. 빈 상태 문구는 표가 넓어도 보이는 폭 가운데(스크롤 영역 = 크기 질의 컨테이너, `sticky left-0 w-[100cqw]`). 가로 스크롤 영역(`role="region"` + tabIndex 0)은 스크롤하는 그 요소여야 화살표 키가 표를 옮긴다 — kit Table을 감쌀 때는 안쪽 컨테이너를 넘치게 둔다(`GOOD_TABLE_FRAME_CLASS`·`OPERATOR_TABLE`). `ConsoleFilterPanel`(카드, 라벨 위 입력, 기간 프리셋 구분 선택, 초기화·검색), `ConsoleFilterField`, `ConsoleCountChips`(건수 카드, 현재 상태 테두리·고리), `ConsoleBulkActionBar`(0건이면 숨김), `ConsolePagination`(범위 요약 + 이전·다음 아이콘 — URL 목록은 `hrefForPage` 링크, 화면 상태로 읽는 목록은 `onPageChange` 버튼, 처음·마지막·가운데 정렬 변형 없음). 조회 폼을 직접 그리는 화면도 `CONSOLE_FILTER_CARD_CLASS`·`ConsoleFilterActions`(구분선 아래 오른쪽 [초기화][검색], 왼쪽 `start`는 집계 기준·내보내기)로 같은 카드를 쓴다. 목록은 `ConsoleListCard`(흰 카드 안 머리 '제목 (총 N건)'·동작 → 표·항목 → 페이지 이동, 빈 목록도 카드 안 `py-10` 문구 — 셸 위에 바로 두거나 점선 상자로 그리지 않는다, 데이터분석의 `StatsSection`도 같은 카드), kit 표를 직접 그릴 때 머리는 `ConsoleTableHeader`(ConsoleGrid와 같은 bg-muted·text-xs·흐린 글자). 취소·반품·교환은 Dice data-table + `useConsoleTable`(열 머리 정렬·필터, 아래 ActionBar 일괄 처리, 스크롤 영역에 포커스·같은 빈 상태). 표의 URL은 화면의 기존 계약을 쓴다. |
| 팝업 | kit Dialog·Sheet·AlertDialog·Popover·DropdownMenu·Tooltip은 `AdminKitPortalHost`의 `body > .wc-admin.admin-kit-portal`에 붙는다. 공용 `CustomerServiceDialog`는 네이티브 dialog 동작(처리 중 닫기 막기·Esc·포커스 복귀)을 유지하고 kit 모양(rounded-xl·머리·닫기)을 쓴다. |
| 상태 | `AdminStatusBadge tone={statusTone(도메인, 값)}`: tone별 옅은 의미색 바탕 + 점 + 상태 이름 글자(ADR-0029). 화면은 kit `Badge` variant로 상태색을 고르지 않는다. 건수는 `AdminCountCard`(tone 아이콘 칸 + 숫자, 0건은 회색으로 조용히)·`ConsoleCountChips`·`SalesStatusSummary`. 처리 기한·저평점은 `data-sla-tone`·`data-low-rating`. |
| 안내·빈 상태 | 상태를 말하는 안내는 `AdminNotice tone=...`(아이콘 + 색 + 글자). 단순 묶음은 카드 안 `rounded-lg border bg-muted/40` 상자. 빈 상태는 `py-10 text-center text-muted-foreground`. 메뉴설명은 접는 `details`이고 기본 접힘이다(ADR-0029). |
| 차트 | recharts 범주색은 `var(--chart-1..5)`를 앞번호부터 고정 순서로(dataviz 검증 통과), 현재 vs 비교는 현재 `--chart-1`·비교 `--chart-comparison`(회색). 격자 `var(--border)`·축 muted-foreground, 글자는 텍스트 토큰, 애니메이션 끔(캡처 환경 rAF 정지). |

### CSS 소유

- `admin-kit.css`(토큰·`@theme inline`·방향 변형 `data-horizontal`/`data-vertical` → `data-orientation`·콘솔 base), `admin-kit-vocabulary.css`(콘솔이 소유하지 않는 고객 부품의 `btn`·`muted`·`mono`, 네이티브 입력·체크박스·라디오), `wc-admin.css`(`--wc-*` 이름·키보드 툴팁), `wc-admin-surfaces.css`(공개 상품 상세 미리보기 보정·데이터 속성 색), `admin-sales-console.css`(관리자 안의 고객 부품 ClaimWithdrawal), `admin-order-detail.css`(ShipmentDetails 관리자 모드), `admin-shopping-stories.css`(쇼핑스토리 모바일 미리보기), `admin-font.css`.
- 화면 전용 CSS를 새로 만들지 않는다. 남은 관리자 CSS는 `@layer components` 안에 있고 모든 선택자 주체가 `:not([data-slot])`이라 kit 부품에 닿지 않는다. kit 옷은 관리자 CSS 뒤에 싣고 kit 부품·공개 미리보기(`.wc-root`)를 건드리지 않는다.

공개 보존 표면(`/about`)의 바탕·폰트·입력·한글 줄바꿈은 그 격리 CSS(about-legacy) 안에 정의한다.

- `wc-product-mosaic.css`는 공개 홈의 상품 모자이크와 격리된 공개 미리보기만 소유한다. 관리자 편집 화면은 kit 부품으로 그린다.
- `wc-product-collection.css`는 공개 홈 자유상품의 리스트·풀이미지 열 수와 구성별 썸네일 비율만 소유한다. 기존 BEST 탭·모자이크·일반 상품목록의 전역 카드 스타일은 변경하지 않는다.
- 카테고리 전시는 공개 탐색·영상 간격을 `wc-category-display.css`가 소유하고, 관리자 편집·선택은 kit 부품, 격리 미리보기는 기존 공개 렌더러를 쓴다. 상품 카테고리·홈 배치의 스타일 소유권을 바꾸지 않는다.
- `store-analytics.css`는 공개 표면의 선택적 방문 분석 동의 배너·설정 대화상자만 소유한다. 주문 영수증의 요청 철회·유형 변경 이력은 `wc-account-commerce.css`, 관리자 안의 요청 철회는 `admin-sales-console.css`에서 각각 표면 경계를 유지한다.
