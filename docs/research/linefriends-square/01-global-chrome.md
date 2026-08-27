# linefriendssquare.com — 01. 전역 크롬 (공지바 · 헤더 · GNB · 푸터 · 모바일 크롬)

> 실측 기준: 2026-08-26, 데스크톱 1440×900 / 모바일 375×812, `getComputedStyle` + CSSOM 규칙 추출.
> 렌더 폭 참고: 데스크톱에서 스크롤바 15px 제외한 페이지 폭 1425px 기준으로 rect를 기록했다.
> 스크린샷: `outputs/lfs-reference/screenshots/01-home-desktop.png`, `01-home-mobile.png`,
> `detail/chrome-sticky-header-desktop.png`, `detail/chrome-megamenu-category-open.png`,
> `detail/chrome-mobile-category-sheet.png`, `detail/chrome-mobile-header-floatbar.png`, `detail/03r-search-overlay-desktop.png`.

## 0. 크롬 전체 해부(anatomy)

```
body
├─ section.hb-simple_banner            … 공지(프로모) 이미지 스트립 — 스크롤 시 사라짐
├─ div.section-top-header              … 유틸바(국가/언어) — 데스크톱 전용, 스크롤 시 사라짐
├─ div.section-header (sticky top:0, z:3)
│   ├─ header.header--middle-left      … 로고 + 아이콘 행 (68px)
│   │   ├─ h1.header__heading > selection-menu
│   │   │   ├─ .desktop_logo (SVG 530×21)     — 데스크톱
│   │   │   └─ .mobile_logo  (SVG 138×53)     — 모바일, 탭하면 스토어 전환 패널
│   │   └─ .header__icons  … 검색 / 카트(+수량뱃지) / 계정
│   ├─ nav.mobile-top-nav (≤989px)     … 가로 스크롤 GNB 탭 (51px)
│   └─ div.top-nav > nav.header-main-menu (≥990px) … GNB (54px) + 메가메뉴
├─ main#MainContent
├─ div.ipx-footer-float-menu (≤989px)  … 하단 고정 탭바 62px (fixed bottom)
├─ div.ipx-footer
│   ├─ footer.only_pc                  … 데스크톱 푸터
│   └─ footer.only_mo                  … 모바일 푸터 (≤990px flex)
└─ (fixed 오버레이) .ipx-search / .searchBackdrop / .mobileMenuSearch / 카테고리 바텀시트 / 채널톡
```

데스크톱 세로 적층(스크롤 최상단): 공지바 36 → 유틸바 34 → 헤더 행 68 → GNB 54(+1 여백) → main 시작 y=193.

---

## 1. 공지바 (프로모 스트립)

- **텍스트 공지바가 아니라 "이미지 스트립 배너"다.** `section.hb-simple_banner > .hb-banner-container > .hb-banner-item > a > picture > img`.
- 높이: 이미지 비율을 그대로 따른다(`img { width:100%; height:auto }`). 실측 **데스크톱 ≈36px**(1680w PC 이미지), **모바일 60px**(420w MO 이미지). srcset: `min-width:1440` → 1680/2520/3000w, 그 미만 데스크톱용, 모바일용 3계층.
- 배경/텍스트색 없음(이미지가 전부). 전폭 100vw, `overflow:hidden`.
- **롤링 아님, 정적 1장.** DOM에는 배너 아이템이 여러 개 존재(실측 2개)하고 `data-start`/`data-end`(KST), `data-country-include/exclude`, `data-show-home/product/collection/blog/others` 속성으로 JS가 노출기간·국가·페이지타입을 판정해 1개만 `display:block` 한다.
- 전체가 하나의 링크(이벤트/컬렉션 상세로). **닫기 버튼 없음.**
- 스크롤하면 같이 밀려 올라간다(sticky 아님). 헤더 그룹 섹션이라 z-index 4 계층에 속함.

## 2. 유틸바 (.section-top-header) — 데스크톱 전용

- 높이 **34px**, 배경 투명(=흰색 위), 내부 `.page-width`(max-width 1212px, padding 0 16px) 중앙 정렬, 내용은 **우측 정렬**.
- 구성: 버튼 2개 — `국가/지역` 셀렉터(현재값 예: "대한민국(KRW ₩)" + 캐럿), `언어` 셀렉터("한국어" + 캐럿). 두 버튼 간격 ≈16px.
- 버튼 타이포: **12px / 400 / #616161 / letter-spacing -0.2px**, 높이 34px(줄맞춤).
- 클릭 시 디스클로저 패널이 열린다: 패널 제목 `h2` "국가/지역"·"언어" **24px/#121212**, 국가 항목 링크 **14px / rgba(18,18,18,.75)**, 전 세계 국가+통화 목록(스크롤). 언어는 한국어/English 2개.
- **모바일(≤989px)에서는 통째로 숨김** (모바일 푸터 하단에 localization 열이 대신 존재).

## 3. 헤더 행 (로고 + 아이콘, 68px)

- `header.header.header--middle-left.page-width`: `display:grid`, `grid-template-areas: "heading navigation icons"`, 실측 columns `972px 0 208px`, `align-items:end`, max-width 1212px, padding 0 16px, 배경 #FFFFFF.
- **로고**: 인라인 SVG **530×21**, 좌측(x=123 at 1440), 하단 정렬(y 93~114). "LINE FRIENDS SQUARE" 워드마크 + 우측에 검정 사각 태그 "GLOBAL OFFICIAL"이 한 SVG에 포함. 링크 `/`.
- **아이콘 그룹** `.header__icons`: 우측 끝, flex, **gap 8px**, 각 아이콘 터치영역 **44×44**(내부 svg 24×24, stroke형), 색 #121212, padding-bottom 12px(하단 정렬 보정), 카트는 margin-right -10px.
  - 검색 `a#ipx-header-search` (href /search — JS가 가로채 오버레이 오픈, §5)
  - 카트 `a#cart-icon-bubble` (href /cart)
  - 계정 (href /account/login) — 로그인 시 /account
- **아이콘 hover**: 내부 svg `transform: scale(1.07)`.
- **카트 수량 뱃지** `.cart-count-bubble`: 아이콘 기준 `top:6px; left:24px`(우상단 겹침), **min-width 18px, border-radius 10px, padding 0 6px, 배경 #F83BAA, 텍스트 흰색 10px/700/line-height 10px**, 중앙 정렬. 0개면 미표시.
- 위시리스트 아이콘은 **데스크톱 헤더에 없음**(모바일 하단 탭바 LIKE로만 진입, /pages/wish-list).

### 3.1 sticky 동작 (중요)

- sticky 대상은 `.section-header` 하나: `position:sticky; top:0; z-index:3`. **공지바·유틸바는 고정되지 않고 스크롤 아웃.**
- 스크롤이 상단을 벗어나면 섹션에 `on-sticky` 클래스가 붙고:
  - `.top-nav`(GNB 랩퍼)가 `margin-top:-54px`로 헤더 행 뒤로 슬라이드되어 **GNB가 가려지고 로고+아이콘 단일 바(총 높이 ≈69px)만 남는다.** transition `margin .3s, opacity .3s`.
  - 모바일은 `.mobile-top-nav { margin-top:-55px; opacity:0 }` — 동일하게 탭 행이 사라진다.
- 스크롤을 다시 최상단 근처로 되돌리면 해제(스크롤 방향 감지형 아님 — scrollY 400에서도 축약 유지 실측).
- **그림자/보더 변화 없음** (box-shadow none 유지, 하단 헤어라인 없음). 스크린샷: `detail/chrome-sticky-header-desktop.png`.

## 4. GNB (데스크톱, nav.header-main-menu, 54px)

- 랩퍼 `div.top-nav`(≥990 전용) 안 `nav.header-main-menu`(margin-left -16px로 첫 항목 텍스트를 컨테이너 왼끝에 정렬) > `ul`(inline-flex).
- **항목 7개** (좌→우):

| 라벨 | href | 서브메뉴 |
|---|---|---|
| 베스트 | /collections/26y-aug-4th-best-items (주차별 slug 갱신) | – |
| 신제품 | /collections/new | – |
| 카테고리 | /collections/shop | 메가메뉴 A |
| K-POP | /collections/k-pop | 메가메뉴 B |
| 이벤트 | /pages/event | – |
| 브랜드 | /pages/brand | 메가메뉴 C |
| SALE | /collections/sale | – |

- 항목 타이포: **16px / 700 / #111111 / letter-spacing -0.2px / line-height 50px**, `a` padding `0 16px 4px`. 항목 높이 54px.
- **hover/활성(핑크 밑줄) 메커니즘** — CSS 원문 요지:
  ```css
  .header__menu-item { --link-color:#111; }
  .header__menu-item:hover, .header__menu-item.active { --link-color:#F83BAA; }
  .header__menu-item span { position:relative; color:var(--link-color); }
  .header__menu-item span::after {
    content:""; height:3px; width:100%; background:var(--link-color);
    position:absolute; bottom:-4px; left:0;
    transform:scaleX(0); transform-origin:center;
    transition:transform .3s;            /* 중앙에서 양쪽으로 자라는 바 */
  }
  .header__menu-item:hover span::after,
  .header__menu-item.active span::after { transform:scaleX(1); }
  ```
  즉 **텍스트 핑크 전환 + 두께 3px 핑크 바(텍스트 baseline 아래 4px 오프셋)가 중앙에서 scaleX로 0.3s 성장.** `.active`는 현재 페이지가 해당 메뉴 링크이거나 그 메가메뉴 하위 컬렉션일 때 붙어 상시 유지된다(예: /collections/category-toy에서 "카테고리"가 핑크+밑줄).

### 4.1 메가메뉴 (hover 오픈)

- 트리거 li `.desktop-item-wrap` hover 시 `.ipx-megamenu-wrap`(absolute, top:54px(=100%), 화면 전폭 100vw, z 0 — 헤더 섹션 z3 내부) 안의 패널이 열린다.
- 패널 `.ipx-megamenu.mega-menu__content`: **배경 #FFFFFF, border-top/bottom 1px rgba(18,18,18,.1), box-shadow 0 4px 5px rgba(18,18,18,.05), padding 33px 0 53px, max-height ≈660px(뷰포트-헤더), overflow auto.** 배경 딤 없음(본문이 그대로 보임). 열림은 opacity 전환(`--duration-default .2s` 계열).
- 내부 `ul.mega-menu__list.page-width`(max-width 1212 중앙)가 grid.
- **메가메뉴 A — 카테고리** (`.shop-mega-menu.mega-menu__list--with-separator`): `grid-template-columns: 130px 180px 150px 80px 80px 80px 180px; column-gap:20px; row-gap:18px`. 3번째 트랙은 `li.mega-menu__separator`(width 1px, margin 0 50px, 배경 rgba(0,0,0,.1) 세로 헤어라인).
  - 그룹(헤딩 → 하위): **스퀘어픽**(데일리베스트 /collections/daily-best · 품절임박 /low-stock · 재입고 /category-back-in-stock · 멤버십 안내 /blogs/notice/membership · 배송 서비스 /blogs/notice/shipping_info) / **컬렉션**(이주의 테마·이주의 브랜드 + 시즌 기획전 4) ‖ **토이**(토이·키링·클로젯) / **라이프스타일**(인테리어·생활잡화·가전/디지털·문구/오피스·여행) / **패션**(패션잡화·의류·파우치·스티콘) / **K-POP**(TRUZ·BT21·i-dle·NCT DREAM·NewJeans·ZEROBASEONE·ZO&FRIENDS — 각 /collections/category-*).
- **메가메뉴 B — K-POP / C — 브랜드**: `repeat(6, minmax(0,1fr))`(트랙 ≈163px), gap 18×40. 1열 "이달의 추천"(기획전 6), 2열 "라인업"(IP 7), 4열부터(`li.col-start-4`) "전체보기" 헤딩 + **브랜드 이미지 타일 136×136** 2개. 브랜드 메뉴는 EXCLUSIVE BRAND(5) / NEW BRAND(5) / 이미지 타일 2 + 전체보기.
- 링크 타이포: 그룹 헤딩 **14px/700/#111**, 하위 링크 **14px/400/#111, line-height 130%, letter-spacing -0.5px, padding 7px 0**. hover 시 underline, 현재 페이지 링크는 **핑크(#F83BAA) + underline 없음**.
- 스크린샷: `detail/chrome-megamenu-category-open.png`.

## 5. 검색 진입 UI

- **아이콘형**이다(헤더에 인풋 상시 노출 없음). 클릭 시 페이지 이동 대신 **고정 드롭 패널 오버레이**가 열린다.
- 데스크톱 `.ipx-search`: `position:fixed; top:156px`(헤더 스택 바로 아래), 전폭, **높이 200px, 배경 #FFF, z-index 1001** + `.searchBackdrop`(z 1000) 딤. 내부 `.wrap.page-width`:
  - 뒤로가기(←, 24×24 stroke #111 1.7) — 닫기 역할
  - `input.search_input[type=search]` — **min-height 60px, 배경 #F6F8FA, border 없음, 16px, caret-color #F83BAA**, placeholder "어떤 상품을 찾으시나요?" #BBBBBB
  - 돋보기 submit(GET /search, `type=product`)
  - 추천 검색어 칩 줄: 제목 17px/700, 칩 `height 32px, line-height 32px, border-radius 17px, padding 0 16px, 배경 rgba(248,59,170,.1), 텍스트 #F83BAA 14px/400`
- 모바일 `.mobileMenuSearch`: `fixed; top:0; height:86px; z-index:1001`, form padding 16px 16px 0, gap 12px, 인풋 min-height **50px** 동일 스타일. (공지 배너가 떠 있으면 ≤989px에서 `.ipx-search`는 top 64px.)
- 참조 컷: `detail/03r-search-overlay-desktop.png`, `05-search-desktop.png`(결과 페이지).

## 6. 푸터 (데스크톱, footer.only_pc)

- **배경 #F6F8FA, border-top 1px #EBEDEE, padding 40px 0 60px.** 내부 `.inner` 고정폭 1180px(padding 0 20px → 콘텐츠 1140px) 중앙.
- 4개 행 구조(열 그룹형 아님 — 링크는 가로 1줄):

1) **`.top` 링크 행** (h 19): `ABOUT US · 사이트맵 · 개인정보처리방침 · 서비스 약관 · 배송 · 환불` — **15px/700/#111, line-height 17px, letter-spacing 0**. 항목 간격: `li:not(:first-child) { padding-left:32px }` + `::before`로 **1×12px #A0A0A0 세로 구분선**(left 16px, top 4px — 32px 간격의 정중앙).
2) **`.footer_logo`**: 워드마크 SVG **258×14**, margin-top 50px.
3) **`.bottom`** (margin-top 24px, flex justify-between, h 104):
   - 좌 `.bottom_left`:
     - `고객센터` 헤딩 15px/700/#111 → 아래 13px/400/#3F3F3F 2줄: `고객센터 : 1544-5921 | 이메일 : square_cs@linefriends.com`, `평일 09:00 – 18:00 (점심 12:00-13:00)`
     - `.box_wrapper` — "라인프렌즈 스퀘어 주식회사 사업자 정보" **15px/700 + 12×7px 화살표 아이콘**의 아코디언 토글. 펼치면 높이 +113px: 법인명/대표/통신판매업신고번호/사업자등록번호(+`사업자정보확인` FTC 팝업 링크, 13px underline)/주소/개인정보 보호책임자/호스팅(Shopify) — 13px/400/#3F3F3F.
   - 우 `.bottom_right` 2열:
     - `.bottom_right_menu1`: `1:1 문의 / 멤버십 / 공고` 세로 3링크 — **15px/700/#111**, 행간 37px.
     - `.bottom_right_menu2`: `FOLLOW US` 헤딩 15px/700 → `INSTAGRAM`, `X (Twitter)` **텍스트 링크 13px/400/#3F3F3F (SNS 아이콘 없음)**, 행간 21px.
4) **`.line_box`**: `border-top 1px #3F3F3F`(진한 라인), padding-top 20px, margin-top 32px → © 카피 **13px/400/#3F3F3F**.

- **국가/언어 셀렉터는 데스크톱 푸터에 없다**(유틸바 담당). 뉴스레터 폼도 데스크톱 푸터에 없음.

### 6.1 모바일 푸터 (footer.only_mo, ≤990px에서 flex)

행 순서: `footer_logo` → `.menu1`(개인정보처리방침 / 서비스 약관 / 배송 · 환불) → `.bottom`(고객센터 블록 → 사업자 정보 토글 → FOLLOW US → `.menu2`: ABOUT US / 사이트맵 / 멤버십 / 공고 → 뉴스레터 블록 자리) → `.line_box`(© + 소셜) → `.footer__content-bottom`(localization 열 + info 열). 배경·패딩은 PC와 동일 계열(#F6F8FA, 40/60).

## 7. 모바일 크롬 (≤989px)

- **적층**: 이미지 배너 60px → 헤더 행 **81px** → 가로 GNB 탭 **51px** (합계 section-header 121px, sticky 동작은 §3.1과 동일 — 탭 행만 숨고 로고 행 유지).
- **헤더 행**: 로고 SVG **138×53**(워드마크 2줄 + 검정 라운드 태그 112×19 rx2 "GLOBAL OFFICIAL"), 좌 16px. 우측 아이콘 **검색 + 카트만**(44×44, 계정 아이콘 없음 — MY는 하단 탭바). **햄버거 메뉴 없음.**
- **로고 = `<selection-menu>` 커스텀 엘리먼트**: 탭하면 로고 아래로 스토어 전환 패널(`.selection-menu`: absolute top 44, 전폭, padding 20 16, border-top 1px #EBEDEE, 행 높이 60px·radius 2px·배경 #EBEDEE·로고 이미지 h15, active/hover 시 검정 배경+흰 로고) + 검정 70% 백드롭 + `#MainContent blur(2px)`. 현재 항목은 HOME 1개뿐(사실상 미사용 장치).
- **가로 스크롤 GNB 탭** `nav.mobile-top-nav` (51px, 배경 #FFF):
  - 동일 7항목. **17px/700/uppercase/line-height 51px**, `a` padding 0 11px, 첫/끝 li margin 5px. 전체 폭 실측 488px > 375px → 가로 스크롤(`.wrap { overflow-x:scroll }`, 스크롤바 숨김).
  - **활성 표기: 색·밑줄이 아니라 불투명도** — 기본 `opacity:.35`(회색처럼 보임), `.active`만 `opacity:1`.
  - **좌우 스크롤 fade**: `::before/::after`로 양 끝 **16px 흰색 그라디언트** 오버레이.
  - sticky 시 `margin-top:-55px; opacity:0`으로 숨김(.3s).
- **카테고리 토글 패널(바텀시트)**: 탭의 "카테고리"는 링크가 아니라 `a.gnb-category-trigger[href="#"]`. 탭하면 `.gnb-category-popup-wrapper > .showcase_category_mo_new`의:
  - 딤 `.dimmed_inside` rgba(0,0,0,.7), z 99
  - 시트 `.bottom_panel`: `fixed bottom:0; height:75%; border-radius 8px 8px 0 0; 배경 #FFF; z 100; padding-top 20px`, 내부 `.panel_inner` 세로 스크롤(스크롤바 숨김)
  - 콘텐츠 패턴: 섹션 제목 `h2.title_wrap` **18px/700, margin-bottom 20px** → ① 아이콘 퀵링크 가로 스크롤(`.icon-item` 폭 17vw, 이미지 래퍼 1:1·radius 10px·배경 #F8F8F8, 라벨 위 8px/아래 10px, gap 1.33vw, scroll-snap-x) ② 2열 컬렉션 이미지 카드 + 하단 도트 페이지네이션. 섹션 사이 **10px #F6F8FA 두꺼운 디바이더**.
  - 스크린샷: `detail/chrome-mobile-category-sheet.png`.
- **하단 고정 탭바** `.ipx-footer-float-menu` (모바일 전용, `large-up-hide`):
  - `fixed bottom:0; height:62px; 배경 #FFF; border-top 1px #EBEDEE; padding 5px 13px; z-index 99(테마 오버라이드로 3 !important — 헤더(3)와 동급, 셀렉션 메뉴 열리면 0)`, `transition .3s`.
  - 5탭 `space-between`: **MENU**(/pages/menu) · **SHOP**(/collections/shop) · **HOME**(/) · **LIKE**(/pages/wish-list) · **MY**(/account). 각 아이템 50×50 세로 flex, svg 22×22 + 라벨 **10px/700/#111**, gap 4px. **비활성 opacity .3 / 활성 1.**
  - 스크린샷: `detail/chrome-mobile-header-floatbar.png`.
- 유틸바(국가/언어)는 숨기고 모바일 푸터 하단 localization으로 대체.

## 8. 페이지 공통 요소

- **브레드크럼: 없음**(전 페이지 공통 — nav[breadcrumb]/.breadcrumb 계열 요소 부재).
- **맨 위로 버튼: 없음.**
- **채널톡(Channel.io) 위젯 존재**: 우하단 고정 핑크 원형 런처(브랜드 핑크와 동일 계열). 데스크톱은 우하단 여백에, 모바일은 하단 탭바 위에 겹쳐 뜬다. (존재만 기록)
- 접근성: `a.skip-to-content-link`(visually-hidden) 존재. 헤더 로고는 h1(홈), 아이콘에 visually-hidden 라벨("카트", "로그인").
- 헤더/푸터 마크업은 전 페이지 동일(Shopify 헤더 그룹/푸터 그룹 섹션).

## 9. 재현 시 요점 체크리스트

1. sticky는 "헤더 스택 전체"가 아니라 **로고 행만 남는 축약형**이다. 공지바·유틸바·GNB는 스크롤 아웃(GNB는 -54px 슬라이드 + 재등장 시 0.3s 복귀).
2. GNB 활성/hover는 **텍스트 색 + 3px 바(offset 4px) scaleX 애니메이션** 두 요소가 한 세트.
3. 메가메뉴는 화면 전폭 패널이지만 **콘텐츠는 page-width(1212) 그리드**이고, 카테고리 메뉴만 고정 트랙폭 + 세로 구분선 변형이다.
4. 모바일은 햄버거·드로어가 없고 **가로 탭 GNB + 카테고리 바텀시트 + 하단 5탭 바** 3장치로 대체된다.
5. 검색은 어느 뷰포트든 **오버레이 패널**(데스크톱 200px 드롭, 모바일 86px 풀바)이고 최종 목적지는 `/search?type=product&q=…`.
