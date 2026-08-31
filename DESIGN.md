---
name: ICONS — White Catalog v4
status: in-migration
description: >
  화이트 캔버스, 무채색 잉크, 단일 brand-green 액센트, radius 0의 각진 플랫,
  스크롤 연출 없는 정적 카탈로그 커머스 디자인 시스템.
  linefriendssquare.com의 레이아웃·IA·컴포넌트 문법을 재현 스펙(docs/research/linefriends-square/)
  기준으로 이식하되, 레퍼런스의 자산·문구·핑크 액센트는 재사용하지 않는다.
authority:
  decision: docs/adr/0011-lfs-storefront-redesign.md
  reproduction-spec: docs/research/linefriends-square/
  product-language: CONTEXT.md
  product-scope: docs/PRD.md
  architecture: docs/ARCHITECTURE.md
  target-design: DESIGN.md
  target-code:
    foundation: app/styles/wc-foundation.css
    chrome: app/styles/wc-chrome.css
    home: app/styles/wc-home.css
    catalog: app/styles/wc-catalog.css
    discovery: app/styles/wc-discovery.css
    account-commerce: app/styles/wc-account-commerce.css
    campaign: app/styles/wc-campaign.css
    about-legacy: app/styles/about-legacy.css
  retained-for-admin:
    - app/styles/editorial-foundation.css
    - app/styles/editorial-admin.css
    - app/styles/admin-console.css
  route-map: lib/routes.ts
  note: >
    status=in-migration: 이 문서는 통합 브랜치(ps/feat/lfs-storefront-redesign)에서 구현 중인 목표 정본이다.
    아직 이행되지 않은 표면의 코드 진실은 직전 시스템(Living IP Editorial, git 이력의 DESIGN.md v3)이다.
    전체 이행 완료 시 status를 implemented로 승격하고 retained 파일의 범위를 재확인한다.
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

## 0. 상태와 적용 원칙

- 근거 결정은 [ADR-0011](docs/adr/0011-lfs-storefront-redesign.md)이다. 공개 스토어프론트 전 표면을 이 시스템으로 이행하고, 직전 시스템(Living IP Editorial)과 1세대 잔재(Holographic Midnight)는 이행 완료 표면에서 제거한다.
- 예외 두 곳: **어드민**(`/admin/**`)은 이번 개편 대상이 아니며 editorial-admin 계열 CSS와 함께 유지한다. **`/about`**은 구 홈의 콘텐츠 섹션을 보존 전시하는 표면으로, 자체 스타일(about-legacy)을 갖되 전역 셸은 White Catalog을 쓴다.
- 시각·IA는 전면 교체하지만 기능 계약(인증, 카트, 주문, 결제, 카드팩, 예매, QR, 권한)은 §11의 동결 경계를 따른다.
- 용어는 `CONTEXT.md`를 따른다: **온라인 팝업**(구 IP 허브), **오프라인 팝업**(예매 도메인), **이벤트**(캠페인 허브), **카테고리**(굿즈 분류), 수집형 **카드** ≠ 실물 **굿즈**.
- 실데이터 원칙: 새로 보이게 하려고 정적 배열, 가짜 수치, 가짜 후기, 존재하지 않는 링크를 넣지 않는다.

## 1. 정체성

**White Catalog**은 상품이 주인공인 백화점 진열대다. 크롬은 존재감을 지우고(흰 지면·각진 플랫·그림자 1종·연출 없음), 정보는 밀도 있게 정렬되며, 액센트는 "지금 주목할 것" 하나만 가리킨다.

1. **지면은 항상 희다.** 섹션 구분은 색면이 아니라 여백과 헤어라인이 한다.
2. **액센트는 한 색, 한 역할.** brand-green은 활성·주목·행동 유도에만 쓴다. 화면을 초록으로 칠하지 않는다.
3. **연출보다 목록.** 스크롤 트리거 애니메이션, 패럴랙스, 대형 타이포 연출을 쓰지 않는다. 움직임은 캐러셀·전환·피드백뿐이다.
4. **유산 예외**: 수집형 카드의 foil·rarity 물성(`lib/rarity.ts`), IP 액센트 메타(`lib/ip-display.ts`)는 카드·IP 식별 국소 요소로 유지한다. `/about`은 직전 시스템의 파스텔 연출을 보존 전시한다.

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
    hairline-dark: "rgba(17,17,17,.1)"
    control: "#C8CACC"        # 아웃라인 버튼 보더
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

### 규칙

- 다크모드 없음 — 단일 라이트 테마. `color-scheme: light`.
- 흰 글자는 잉크 면(primary 버튼·구매바)과 이미지 스크림 위에만 쓴다.

### 회원 등급 뱃지 색 (B2에서 확정 — 액센트 단일 규칙의 명시적 예외)

등급 4단(WELCOME/SILVER/GOLD/PLATINUM — VIP·티어 어휘 금지, CONTEXT.md)의 뱃지에만
쓰는 틴트 배경 + AA 잉크 쌍. 레퍼런스의 배지 색 체계에서 핑크·퍼플 원색을 치환했다.
사용처는 프로필 스트립 등급 뱃지와 쿠폰함의 등급 혜택 뱃지 두 곳으로 폐쇄한다.

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
  section-title: "28/700/-0.8"            # 홈·목록 섹션 헤딩 (브레이크포인트 무관) — R-02 §1-1 실측. R-07 h2 축의 24는 베이스 스케일로, 표면 수치는 표면 문서가 이긴다
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
  mypage: "프로필 스트립(surface.grey) + 좌 메뉴 200px + 콘텐츠"
  header: { notice: "이미지 스트립 ≈36px/60px(mo)", tiers: "유틸바+로고단+GNB", sticky-condensed: "69px 로고+아이콘 단일 바" }
  buybar-mobile: "높이 72px 고정 풀폭"
  touch-target: "아이콘 44px, 버튼 h50"
```

- 상품 카드 이미지 비율은 **3:4 세로형으로 통일**(의도적 편차 — R-스펙 00 §재현 원칙).
- 섹션 공통 마진 없음 — 각 섹션이 자체 상하 패딩을 가진다(표면별 수치는 R-스펙 02~06).

## 5. 형태·선·깊이·모션

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

| 패턴 | 목적 | 필수 규칙 (R-스펙) |
|---|---|---|
| `notice-strip` | 운영 공지 | 어드민 큐레이션 이미지 스트립 1장, 스케줄 노출, 닫기 없음 (01) |
| `triple-header` | 전역 탐색 | 유틸바+로고단+GNB 3단, 스크롤 시 69px 단일 바로 축약, 그림자 없음 (01) |
| `underline-gnb` | 1차 탐색 | NEW·BEST·카테고리·온라인 팝업·카드팩·이벤트·커뮤니티. 활성=green 텍스트+3px 밑줄 (01) |
| `mega-menu` | 카테고리 확장 | 헤더 컨텍스트 내 z0, 헤어라인 상하, 그룹 헤딩 14/700 (01) |
| `search-overlay` | 검색 진입 | 페이지 이동 없는 오버레이, 인풋 60px(grey)+추천 칩(green), 결과는 `/search` (01·03) |
| `mobile-tab-gnb` | 모바일 1차 탐색 | 햄버거 없는 가로 스크롤 탭, 활성 opacity 1/비활성 .35, 좌우 16px fade (01) |
| `bottom-tab-bar` | 모바일 전역 바 | 5탭(메뉴·굿즈샵·홈·위시·마이) 62px, 상단 헤어라인 (01) |
| `category-sheet` | 모바일 카테고리 | 75% 높이 바텀시트, 상단 radius 8, 딤 70% (01) |
| `product-card` | 상품 단위 | 3:4 이미지 무보더 플랫 → 뱃지(정보영역 인라인) → 브랜드 12/600 → 이름 13/400 → 가격 14/600. 품절=하단 1/3 scrim 밴드+italic SOLD OUT (02·03) |
| `content-card` | 콘텐츠 단위 | 썸네일+뱃지+타이틀, 홈 ②·이벤트 허브·커뮤니티 공용 (02·06) |
| `tab-product-slider` | 카테고리 BEST | 좌탭(모바일 가로 탭)+탭별 독립 슬라이더, 4열/2×2 페이지 (02) |
| `banner-list-band` | 큐레이션 밴드 | 좌 배너 780 + 우 리스트 380, 모바일 재배치, 3연속 동일 템플릿 (02) |
| `benefit-tiles` | 혜택 안내 | 280px 4타일 — 홈 ⑧은 카드팩·게임 진입 밴드로 대체 (02) |
| `filter-sidebar` | 목록 필터 | 200px: IP·타입·가격 듀얼 슬라이더, 적용 칩 없이 카운트 피드백, 모바일 바텀시트 지연 적용 (03) |
| `view-more` | 목록 더보기 | 300×50 아웃라인 버튼, 20개 append URL 불변. 검색은 36px 숫자 페이지네이션 (03) |
| `pdp-gallery` | 상품 갤러리 | 1:1 크롭+도트+84px 썸네일 7열, 모바일 세로형+도트, 줌 없음 (04) |
| `pdp-buybox` | 구매 정보 | 뱃지→제목→가격(할인 2행)→별점+하트/공유→옵션→수량 스테퍼→실시간 합계→CTA (04) |
| `cta-pair` | 구매 행동 | [장바구니 아웃라인 : 구매하기 잉크] ≈27:73, `.wc-btn` h50 r4 (04) |
| `restock-cta` | 재입고 알림 | 품절 옵션 선택 시 CTA를 벨 아이콘+풀폭 잉크 버튼으로 교체, 비로그인 클릭=로그인 벽 (04) |
| `panel-tabs` | PDP 하부 | 앵커 아님·패널 전환 탭, sticky, 리뷰 카운트 표기 (04) |
| `floating-buybar` | 데스크톱 스크롤 | 우하단 [카트 50²][구매 226×50] 미니 바 (04) |
| `mobile-buybar` | 모바일 구매 | 72px 잉크 풀폭 고정(카트 존+구매 존), 옵션은 본문 인라인 (04) |
| `mini-checkout-cart` | 카트 | 780+360 2열, 쿠폰 select·배송 메모가 카트 단계에, 빈 상태=일러스트+CTA (05) |
| `flat-auth-form` | 인증 | 448px 1칼럼, 잉크 60px CTA, 소셜 55px 원형(도입 시), in-place 복구 스왑 (05) |
| `mypage-shell` | 계정 허브 | 프로필 스트립(등급 뱃지)+좌 200px 메뉴 3그룹, 모바일은 메뉴 숨김 (05) |
| `coupon-ticket-card` | 쿠폰함 | 2열 티켓형 카드+등급별 뱃지 (05) |
| `campaign-hub` | 이벤트 허브 | 배너 스와이퍼 1180×260 + ALL/EVENT/DROP 탭 + 2열 580px 카드(3:2) — **기간·상태 뱃지는 추가한다**(레퍼런스 미표기 결함 보완) (06) |
| `campaign-landing` | 캠페인 상세 | sticky 앵커 내브+코인 잔액 노출+게스트 로그인 CTA 치환. 코인 소진처는 뽑기권 교환 UI(가챠 어휘 금지) (06) |
| `document-page` | 정책·법적 | 620px 문서 서식. 공지 상세는 1180px (06) |
| `standalone-game` | 참여형 게임 | 크롬 없는 풀스크린 유지, 팔레트만 White Catalog 정합 (06) |
| `about-legacy-showcase` | 회사 소개 | 구 홈 콘텐츠 섹션(파스텔 에디토리얼) 보존, 자체 헤더/푸터 제거, 전역 셸 아래 |

### 버튼·인풋 기본형

- `.wc-btn`: w100% h50 r4 18/700, 변형 = 아웃라인(#FFF/`line.control`/잉크) · `primary`(잉크/잉크/흰) · `disabled`(#BBB) · `accent`(green/green/흰). 연속 배치 7px, 2열 그룹 gap 8.
- 폼 버튼(잔여): min-h 50, r2, 15/+1ls, hover=box-shadow 0 0 0 1px 잉크 링.
- 인풋: r0, 보더 box-shadow 1px(rgba ink .55), focus 2px 잉크 + caret green, 플로팅 라벨 16→10px. 검색 인풋만 보더 없는 grey 필드. invalid=green 아님 — `state.danger` 보더+13px 피드백.
- 수량 스테퍼 92×32, 셀렉트 12px+caret svg.

## 7. 홈 정본

밴드 구성과 수치는 R-스펙 02가 정본이다. 데이터는 전부 어드민 큐레이션·카탈로그에서 온다.

1. `notice-strip` + `triple-header`
2. 히어로 캐러셀 — 1425×770(1440+), fade 1s·5s·루프, 전폭 9등분 세그먼트 진행바, PC/MO 별도 아트웍(5:6), `home_curations.hero`
3. "에디터의 제안" `content-card` 3열 — 이벤트·커뮤니티·드랍 소재 큐레이션
4. 카테고리 BEST `tab-product-slider` — 카테고리 탭+판매량/큐레이션 정렬
5.–7. `banner-list-band` ×3 — 주간 온라인 팝업(IP)·기획전·테마 큐레이션 슬롯
8. 인기템 `tab-product-slider`
9. 카드팩·게임 진입 밴드(`benefit-tiles` 변형 — 유일한 창작 밴드)
10. 푸터 — 링크 그룹+사업자 정보+**오프라인 팝업 진입**+`/about` 링크

빈 카탈로그·큐레이션 상태에서도 각 밴드는 명시적 빈 상태 또는 영역 제거로 처리하고 가짜 콘텐츠를 만들지 않는다.

## 8. 표면군별 플레이북

| 표면 | 라우트 | 적용 패턴 | 기능 불변 조건 |
|---|---|---|---|
| 홈 | `/` | §7 | `getHomeSnapshot` 계약 유지(큐레이션 kind 확장은 서버 작업으로 분리) |
| 굿즈샵 | `/shop` | 컬렉션+`filter-sidebar`+정렬+`view-more` | 재고·판매 상태 계약 유지 |
| 상품 상세 | `/shop/[goodId]` | `pdp-*`·`cta-pair`·`restock-cta`·`panel-tabs`·리뷰/Q&A | 카트·주문 생성 경로 유지, 바로구매=기존 주문 RPC |
| 온라인 팝업 | `/ip`, `/ip/[id]` | A–Z 디렉토리 / 풀블리드 배너 540px+팔로우+facet 축약 컬렉션 | 공개 읽기·팔로우(`fans_count`) 유지 |
| 카드팩·바인더 | `/packs`, `/binder` | `campaign-landing`·카탈로그 문법 재조판, 카드 foil 물성 유지 | 카드풀·확률·개봉 계약 동결 |
| 이벤트 | `/events`(재정의) | `campaign-hub`+`campaign-landing` | 신규 campaigns 도메인(B5) |
| 오프라인 팝업 | 신규 경로(이사) | 기존 예매·상세를 White Catalog으로 재조판, 푸터 진입 | 회차·잔여·예매·검표 계약 동결 |
| 커뮤니티 | `/community` | `content-card` 문법 재조판 | 작성·좋아요·신고 계약 유지 |
| 검색 | `/search` + 오버레이 | `search-overlay`+결과 그리드+숫자 페이지네이션 | `getSearchSnapshot`·URL 상태 유지 |
| 카트 | `/cart` | `mini-checkout-cart`(쿠폰 select는 B1에서 활성) | local/DB 병합·수량 계약 유지 |
| 체크아웃·주문·티켓 | `/checkout*`, `/orders*`, `/tickets*`, `/ticket-checkout*` | 흰 종이형 영수증·상태 타임라인, 크롬만 교체 | **결제 플로우·금액 확정·콜백 처리 동결** |
| 인증 | `/login` 등 | `flat-auth-form` | OAuth·recovery·필드 계약 유지 |
| 마이 | `/my` 이하 전부 | `mypage-shell`+위시리스트·쿠폰함(B1)·Q&A 내역(B3) | 기존 조회·설정 계약 유지 |
| 법적·문서 | `/legal/*` | `document-page` | 정적 파라미터 유지 |
| 회사 소개 | `/about`(신규) | `about-legacy-showcase` | 구 홈 콘텐츠 보존, CTA 링크는 신 사이트로 |
| 마켓·트레이드 | `/market`, `/exchange` | v2 플레이스홀더 재조판 | 플레이스홀더 유지 |
| 게임 | `/games/[gameId]` | `standalone-game` | 서버 판정·한도·보상 동결 |
| 404·에러·로딩 | `not-found`·`error`·`loading` | White Catalog 기본 표면 신설 | — |

## 9. 상태·피드백 (승계)

로딩=최종 비율 보존 skeleton / 빈 상태=원인+다음 행동 1개 / 오류=재시도와 안전 이탈 / 성공=서버 확인 전 "완료" 금지 / disabled=시각+`aria` 일관. 결제·예매·검표 진행 중 주변 자동 모션 금지.

## 10. 반응형·접근성 (승계 + 갱신)

- 반응형: §frontmatter 브레이크포인트. 모바일에서 콘텐츠는 2열(상품)·1열(정보), 유틸바 숨김, GNB는 가로 탭, PDP는 1열 스택+`mobile-buybar`. 360px에서 금액·주문번호·CTA overflow 별도 검증.
- 접근성: WCAG AA 대비(**확정 — 소형 액센트 텍스트는 brand-green 대신 `state.success`를 쓴다. §2 사용처 분류 참조**), 키보드 전 조작, focus-visible 2px `state.focus`, 아이콘 버튼 44px+접근 이름, 캐러셀 정지 수단·현재 위치, 모달·시트 focus trap·Escape·복귀 포커스, 색·위치 단독 의미 전달 금지.

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

- 결제: 굿즈·티켓 신규 결제 provider는 **Korpay**(provider-neutral seam 뒤 gate 제어)이고, 확정은 서버 전용 `PaymentGateway.confirm/reconcile`+DB 멱등 finalizer뿐이다. Toss는 `provider=toss` 기존 거래의 조회·취소·웹훅에만 남긴다. 콜백 body·클라이언트 성공 신호는 진실원이 아니다.
- **쿠폰(B1)이 유일한 금액 개입 지점**이며 할인은 서버 주문 생성 RPC에서 확정한다. 코인·등급·리워드는 결제와 무관하다.
- 가격·재고·카드 RNG·뽑기권 발급/개봉·티켓 수용량·QR 검표를 클라이언트 상태로 옮기지 않는다.
- 공개 브라우징 유지 — 로그인은 보호 액션 시점에만.
- 신규 함수는 생성 후 `revoke all ... from public, anon, authenticated, service_role`로 봉인 후 필요한 롤에만 grant.
- 관리자 권한은 `profiles.role`+RLS 양쪽, 민감 작업은 감사 가능.

### 회귀 기준선

- 이행 각 단계 시작 시 `npm run test` 전체 통과 수를 기준선으로 기록하고, 기능 assertion을 느슨하게 만들어 통과시키지 않는다. 시각 마크업 변경으로 클래스명·스냅샷 기대값을 바꿀 때도 행동 단언은 유지한다.
- CSS 계약 테스트는 `app/editorial-design.test.ts`를 대체하는 `app/wc-design.test.ts`(임포트 순서·토큰 hex·reduced-motion·focus ring)로 승계한다.

## 12. Do / Don't

**Do** — 흰 지면·잉크·헤어라인 기본 / 액센트는 한 역할 / 상품 카드 anatomy 통일(3:4) / 모든 목록에 빈·오류·품절 상태 / 실데이터·실경로만 / R-스펙 수치 우선, 어긋나면 R-스펙 갱신과 함께.

**Don't** — 레퍼런스의 이미지·카피·로고·핑크 재사용 금지 / 스크롤 연출·패럴랙스·카드 그림자 금지 / 파스텔 면 사용 금지(`/about` 제외) / 다크 표면 금지(이미지 스크림·잉크 버튼 제외) / 레퍼런스 결함(강제 리다이렉트·숨김 위젯·영문 노출·기간 미표기) 재현 금지 / 새 디자인을 이유로 form field·action·권한 검사 교체 금지 / '가챠·뽑기·충전' 어휘 사용자-facing 금지.

## 13. 구현 순서

구현 단계·PR 구조·티켓 분해는 [docs/research/linefriends-square/09-implementation-plan.md](docs/research/linefriends-square/09-implementation-plan.md)가 정본이다. 완료 조건: 각 표면이 §8 플레이북과 R-스펙 수치를 만족하고, §11 계약 테스트가 통과하며, `npm run lint`·`npm run build`·`npm run test` 통과 + preview 검수 후 일괄 전환한다.
