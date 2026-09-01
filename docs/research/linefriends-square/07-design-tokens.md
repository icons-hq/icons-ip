# linefriendssquare.com — 07. 디자인 토큰 (색 · 타이포 · 스페이싱 · radius · 컴포넌트 기본형)

> 실측 기준: 2026-08-26, 데스크톱 1440×900 / 모바일 375×812. `getComputedStyle` 실측 + CSSOM 원본 규칙(authored value) 추출 병행.
> 기반: Shopify Dawn 테마 + 자체 `ipx-*` 디자인 레이어. 테마 설정이 CSS 변수(`:root`)로 내려오고, `ipx-*` CSS가 px 단위로 덮어쓴다.

## 0. 루트 기법

- **`html { font-size: 10px }` — 10px 루트.** Dawn 계열의 `6.25%` 기법으로, 모든 `rem`은 ×10px (1.5rem=15px, 4.4rem=44px).
- `body`: **16px(≥750) / 14px(모바일 기본)**, line-height 1.8(28.8px), **letter-spacing -0.2px**, color #121212, background #FFFFFF.
- 폰트 스택 실측: `font-family: Pretendard, sans-serif` (`--font-body-family`·`--font-heading-family` 동일. heading weight 700).
  - `.eng-font`(GNB 등 영문 강조용 클래스)도 `Pretendard, "SF Pro Display", "Apple SD Gothic Neo", sans-serif` — **별도 영문 폰트 없음, 전부 Pretendard.**
  - 카테고리 바텀시트 내부만 `"Pretendard Variable", Pretendard, -apple-system, …` 확장 스택.
- 다크모드 없음(단일 라이트 테마).

## 1. 컬러 전수 + 사용처 맵

### 1.1 무채색 축

| Hex | 역할 | 사용처 |
|---|---|---|
| `#FFFFFF` | 지면 | body·헤더·메가메뉴·바텀시트·하단 탭바 bg, 다크 버튼 텍스트, Dawn 뱃지 bg, GNB fade 그라디언트 |
| `#F6F8FA` | 옅은 회지면 | 푸터 bg, 검색 인풋 bg(데스크톱 60px·모바일 50px), 바텀시트 섹션 디바이더(10px) |
| `#F8F8F8` | 아이콘 타일 | 카테고리 시트 아이콘 이미지 래퍼 bg |
| `#F3F3F3` | scheme-2 | Dawn `color-background-2`(회색 섹션·배너 대비면) |
| `#EBEDEE` | 헤어라인 | 푸터 border-top, 하단 탭바 border-top, 셀렉션 패널 border-top, 셀렉션 행 bg |
| `#C8CACC` | 컨트롤 보더 | `.ipx-btn` 기본(아웃라인) 보더 |
| `#BBBBBB` | 비활성 | placeholder(검색·폼), 세일 시 정가 취소선 텍스트, `.ipx-btn.disabled` bg/보더 |
| `#A0A0A0` | 구분선 | 푸터 링크 사이 1×12px 세로 디바이더 |
| `#616161` | 보조 텍스트 2 | 유틸바(국가/언어) 12px, PDP 옵션 리스트 라벨, PDP 주의문 타이틀 |
| `#3F3F3F` | 보조 텍스트 1 | 푸터 본문 13px(고객센터·사업자·SNS·©), 카드 타이틀(#3F3F3F 13px), 푸터 `.line_box` border-top |
| `#333333` / `#252525` | 시트 텍스트 | 카테고리 바텀시트 라벨/인풋 텍스트 |
| `#121212` | Dawn foreground | body 텍스트, 헤더 아이콘, Dawn 버튼/뱃지 변수(`--color-foreground: 18,18,18`), rgba 파생(보더 .1/섀도 .05) |
| `#111111` | ipx 잉크 | GNB·모든 ipx 헤딩·가격·버튼 텍스트·탭바 라벨·푸터 강조 링크 (실무상 #121212와 동일 잉크로 취급 가능) |
| `#000000` | 순검정 | 셀렉션 메뉴 active/hover bg, 버튼 hover 링, 딤(70% 알파의 베이스) |

### 1.2 액센트 핑크 `#F83BAA` — 치환 시 체크리스트

Dawn 변수 체계 밖에 **하드코딩**되어 있다(변수 아님). 사용처 전수:

| 표면 | 형태 |
|---|---|
| GNB 항목 hover/active | 텍스트 색 + 3px 밑줄바(`--link-color`로 스위치) |
| 메가메뉴 현재 페이지 링크 | 텍스트 색 (`.mega-menu__link--active`) |
| 카트 수량 뱃지 | bg (`.cart-count-bubble`, 흰 텍스트) |
| 카드 뱃지 `.ipx-badge.red` | 텍스트 + bg `rgba(248,59,170,.1)` |
| 카드 뱃지 `.ipx-badge.white` | 텍스트 + 보더 `rgba(248,59,170,.1)` |
| 세일 할인율 `.sale-percentage` | 텍스트 (카드·PDP·위시리스트 공통) |
| 위시 하트 선택됨 | svg fill+stroke (`.wk-selected`) / 플로팅 하트 아이콘 스트로크 |
| 검색 caret | `caret-color` (데스크톱 `.ipx-search`·모바일·검색 페이지 인풋) |
| 추천 검색어 칩 | 텍스트 + bg 10% (`.ipxSearchTerm`) |
| 폼 검증 | `.is-invalid` 보더, `.valid-feedback` 텍스트(13px), `.ipx-form-group` caret |
| 버튼 변형 `.ipx-btn.pink` | bg+보더 (흰 텍스트) |
| 홈 피처드 뱃지 | `.badges.drop`·`.badges.showcase` 텍스트 |
| 브랜드 좋아요 카운트 | `#mybrand-container .like-count` 14px |
| 유틸 클래스 | `.ipx-text-pink`(!important) / `.ipx-bg-pink` |
| (외부) 채널톡 런처 | 브랜드 컬러 동조 핑크 원형 버튼 |

기타: `--swiper-theme-color: #007aff`(스와이퍼 기본값 잔재, 실사용 안 함).

### 1.3 Dawn 컬러 스킴 변수 (rgb triplet)

```css
:root, .color-background-1 { --color-background:255,255,255; --color-foreground:18,18,18;
  --color-button:18,18,18; --color-button-text:255,255,255;
  --color-secondary-button:255,255,255; --color-secondary-button-text:18,18,18;
  --color-link:18,18,18; --color-badge-background:255,255,255; --color-badge-border:18,18,18; }
.color-background-2 { --color-background:243,243,243; /* 나머지 동일 */ }
```
보더·딤은 `rgba(var(--color-foreground), α)` 파생: 헤어라인 α .1 (`rgba(18,18,18,.1)` — 메가메뉴 상하 보더 등), 섀도 α .05, 인풋 보더 α .55, 링크 α .85(`--alpha-link`).

## 2. 타이포 스케일

### 2.1 Dawn 요소 스케일 (rem×10px, `--font-heading-scale`=1)

| 클래스 | 모바일 | ≥750px | 비고 |
|---|---|---|---|
| `.h0` | 40px | 52px | 헤딩 ls `+0.6px`(0.06rem), lh calc(1+.3/scale)≈1.3 |
| `h1/.h1` | 30px | 40px | |
| `h2/.h2` | 20px | 24px | 유틸바 디스클로저 제목 등 |
| `h3/.h3` | 17px | 18px | |
| `h4/.h4` | 15px | 15px | |
| `h5/.h5` | 12px | 13px | 카드 타이틀이 `.h5`를 상속 후 override |
| body | 14px | 16px | lh 1.8, ls -0.2px |
| `.caption` | 10px | 12px | ls .7px |
| `.caption-large`/필드 | 13px | 13px | lh 1.5 |
| `.subtitle` | 18px | 18px | rgba(fg,.7) |

### 2.2 ipx 헤딩 스케일 (`.ipx-header hN` — 섹션·모듈 제목용, 브레이크포인트 무관 동일)

| 레벨 | size/ls/lh |
|---|---|
| h1 | 26px / -0.8 / 1.3 |
| h2 | **24px / -0.8 / 1.33** ← 홈 섹션 타이틀("에디터의 제안" 등, `ipx-main-tab`·`featured-contents`에서는 700 강제) |
| h3 | 20px / -0.5 / 1.35 |
| h4 | 19px / -0.5 / 1.36 |
| h5 | 17px / -0.5 / 1.41 |
| h6 | 16px / -0.5 / 1.37 |

### 2.3 표면별 실측표 (weight, letter-spacing 포함)

| 표면 | 데스크톱 | 모바일 | 색 |
|---|---|---|---|
| GNB 항목 | 16 / 700 / -0.2 / lh 50px | (가로 탭) 17 / 700 / 0 / lh 51px / uppercase | #111 (모바일 비활성은 opacity .35) |
| 메가메뉴 그룹 헤딩 | 14 / 700 / -0.5 | – | #111 |
| 메가메뉴 링크 | 14 / 400 / -0.5 / lh 1.3 | – | #111 |
| 유틸바 | 12 / 400 / -0.2 | 숨김 | #616161 |
| 홈 섹션 타이틀 | 24 / 700 / -0.8 | 동일 스케일 | #111 |
| 히어로/PDP 배너 타이틀 | 22 / 700 / -0.55 / lh 1.09 (`.ipx-text__title`) | 동급 | 흰색(이미지 위) |
| 상품명(PDP h1) | 18 / 700 / -0.5 / lh 1.11 | 16 / 700 | #111 |
| 추천상품·모달 타이틀 | 18 / 700 / -0.4~-0.5 | 동일 | #111 |
| 카드 타이틀 | **13 / 400 / -0.2 / lh 1.35** | 동일 | **#3F3F3F** |
| 카드 가격 | **14 / 600 / lh 17px** (기본 `.price` 15/700, ≥990 override 14px+600) | 15 / 600~700 | #111 |
| 세일 정가(취소선) | 14 / 400 / line-through | 동일 | #BBBBBB |
| 세일 할인율 | 가격과 동급, 앞자리 | 동일 | #F83BAA |
| 카드 뱃지 | 11 / 600 / lh 18px | 동일 | 핑크 계열(§6) |
| 검색 인풋/placeholder | 16 / 400 (-0.5) | 16 | #000 / #BBBBBB |
| 추천 검색어 칩 | 14 / 400 / -0.4 | 동일 | #F83BAA |
| 푸터 링크·강조 | 15 / 700 / lh 17 | 유사 | #111 |
| 푸터 본문·© | 13 / 400 | 동일 | #3F3F3F |
| 버튼(Dawn `.button`) | 15(1.5rem) / ls +1px | 동일 | 스킴 따름 |
| 버튼(`.ipx-btn`) | 18 / 700 / lh 1.11 | 동일 | 변형별 |
| 하단 탭바 라벨 | – | 10 / 700 / lh 1 | #111 |
| 카트 수량 뱃지 | 10 / 700 / lh 10px | 동일 | #FFF on 핑크 |
| 바텀시트 섹션 제목 | – | 18 / 700 | #111 |
| 폼 피드백 | 13 / -0.38 | 동일 | #F83BAA |

- 국문 letter-spacing은 **음수(-0.2 ~ -0.8px)가 기본**, Dawn 잔재 표면(버튼 +1px, 캡션 +0.7px, 헤딩 +0.6px)만 양수. ipx 레이어가 대부분 음수로 덮는다.

## 3. 스페이싱 리듬

- **컨테이너**: `--page-width: 1212px` → `.page-width { max-width:1212px; padding:0 16px }` = **콘텐츠 1180px**. 1440 뷰포트에서 좌우 마진 ≈107px. 푸터만 자체 `.inner { width:1180px; padding:0 20px }` = 콘텐츠 1140px.
- **모바일 좌우 패딩: 16px** 일관(헤더·GNB 탭 fade 16px·시트 패딩 20/16).
- **섹션 상하 여백**: 테마 변수 `--spacing-sections-desktop/mobile: 0px` — 섹션 간 공통 마진 없음, **각 섹션이 자체 패딩을 가진다**(예: 검색 결과 main margin-bottom 64px, 메가메뉴 padding 33/53, 푸터 40/60). 표면별 수치는 각 페이지 문서(02~06) 참조.
- **그리드 gap 변수**: `--grid-desktop-vertical/horizontal-spacing: 8px`, `--grid-mobile-*: 4px` (Dawn 그리드 기본). 커스텀 그리드는 별도 gap: 메가메뉴 18×40(카테고리형 18×20), 바텀시트 아이콘 1.33vw, `.ipx-btn-group` 8px.
- **카드**: `--product-card-image-padding: 0`, `--product-card-corner-radius: 0`, 보더 0(α .1 변수만 존재), 그림자 off — **카드는 무보더·무패딩 플랫**. 컬렉션 카드 실측 폭 212px(1180 컨테이너 5열 기준).
- 헤더 리듬: 아이콘 터치영역 44px, GNB 항목 좌우 패딩 16px, 아이콘 gap 8px.

## 4. Radius 전수 / 그림자 / 헤어라인

### 4.1 radius 사용처 전수 (기본은 0 — 각진 시스템)

| 값 | 사용처 |
|---|---|
| **0** | 인풋(`--inputs-radius`), 카드·미디어·팝업·텍스트박스 (모두 변수로 0 지정) |
| 1px | 카드 뱃지(`.card__information span.badge`, `.ipx-badge`) |
| **2px** | Dawn 버튼(`--buttons-radius`), 셀렉션 메뉴 행, 로고 GLOBAL OFFICIAL 태그(rx 2) |
| 3px | 버튼 outset(`--buttons-radius-outset`) |
| **4px** | `.ipx-btn` (주요 CTA) |
| 8px | 모바일 카테고리 바텀시트 상단 모서리(8 8 0 0) |
| 10px | 카트 수량 뱃지, 바텀시트 아이콘 타일 |
| 12px | 바텀시트 icon-item 래퍼 |
| 17px | 추천 검색어 칩(h32의 절반) |
| 40px | `--badge-corner-radius`(Dawn pill 뱃지), `--variant-pills-radius`(옵션 필) |
| 원형 | 채널톡 런처, 카드 위시 하트 버튼(흰 원), 별점 아이콘 |

### 4.2 그림자 — 사실상 1종

- **`0 4px 5px rgba(18,18,18,.05)`** — 메가메뉴/팝업(`--popup-shadow-*`) 유일한 실사용 그림자.
- 카드·버튼·드로어 그림자 변수는 전부 opacity 0 (**플랫 디자인**). 헤더 sticky 시에도 그림자 없음.
- 버튼 hover의 "두꺼워지는 보더"는 그림자가 아니라 `box-shadow 0 0 0 Npx`(§5).

### 4.3 헤어라인 보더 패턴

| 색 | 위치 |
|---|---|
| `rgba(18,18,18,.1)` | 메가메뉴 상·하, Dawn 파생 보더 전반 |
| `#EBEDEE` | 푸터 상단, 모바일 탭바 상단, 셀렉션 패널 상단 |
| `rgba(0,0,0,.1)` | 메가메뉴 세로 구분선(1px 폭 li) |
| `#A0A0A0` | 푸터 링크 구분선(1×12px) |
| `#3F3F3F` | 푸터 © 위 구분선(유일하게 진한 1px) |
| `#F6F8FA` 10px | 바텀시트 섹션 사이 "두꺼운 디바이더" |

## 5. 버튼 변형 전수

### 5.1 `.ipx-btn` (ipx 레이어 — PDP CTA·주요 액션)

공통: **width 100%, height 50px, padding 15px, font 18px/700/lh 1.11, border-radius 4px, border 1px.** 연속 배치 시 위 7px 간격, `.ipx-btn-group`은 2열(50%-4px) gap 8px.

| 변형 | bg | border | text |
|---|---|---|---|
| 기본(아웃라인) | #FFF | #C8CACC | #111 |
| `.primary` | #121212 | #121212 | #FFF |
| `.disabled` | #BBBBBB | #BBBBBB | #FFF |
| `.pink` | #F83BAA | #F83BAA | #FFF |

### 5.2 Dawn `.button` (폼·계정·페이지네이션 등 잔여 표면)

- 공통: `min-height 50px(45px+보더)`, `min-width 120px+`, padding `0 30px`, font **15px / ls +1px**, radius 2px, inline-flex 중앙.
- 테마 오버라이드로 **primary가 흰 바탕**: `.button { --color-button:#fff; --color-button-text:#000 }`, `.button--secondary/tertiary { --color-button:#000; --color-button-text:#fff }` (Dawn 기본과 반전).
- 보더/hover는 `::after`의 box-shadow 링: secondary 상시 `0 0 0 1px`, **hover 시 전 변형 `0 0 0 1px #000 !important`**(두꺼워지는 효과, 일부 표면 2px #AAA). focus-visible: `0 0 0 3px` 계열 아웃라인 섀도.
- `.button--tertiary`: 12px, padding 10 15, min-h 35px, bg 투명+보더 α .2.
- `.button--small` padding 12 26 / `.button--full-width` / `.loading`(텍스트 투명+스피너).
- disabled: 별도 색 없음(cursor·이벤트만) — 실질 disabled 표현은 `.ipx-btn.disabled` 쪽.

### 5.3 기타

- 필터 "전체 초기화": 아웃라인(1px #121212 계열) + 리셋 아이콘, Dawn 버튼 파생.
- 텍스트 버튼: `.link`(underline offset 3px, α .85), "컬렉션 전체보기"류는 아웃라인 소형 버튼.

## 6. 뱃지 변형

| 변형 | 스타일 | 위치/용도 |
|---|---|---|
| `.ipx-badge.red` — **NEW/할인 강조** | font 11/600, lh 18px, padding 0 3px, radius 1px, **bg rgba(248,59,170,.1), text #F83BAA**, border 투명 | 카드 정보영역 상단(타이틀 위) 좌측 |
| `.ipx-badge.white` | bg #FFF, border 1px rgba(248,59,170,.1), text #F83BAA | 카드 정보영역(2차 라벨: EVENT 등) |
| 홈 피처드 뱃지 `.badges.drop/.showcase` | 텍스트 핑크(NEW/EVENT 라벨) | 에디터의 제안 카드 |
| Dawn `.badge` | 12px, ls +1px, padding 5 13 6, **radius 40px(pill)**, bg 흰/보더 #121212 | `품절`(price 영역 `.price__badge-sold-out`)·세일 뱃지 잔여 표면 |
| **SOLD OUT 오버레이** | 카드 이미지 위 `.card__overlay.sold-out`: min-height 79px, 타이틀 **16px/700/italic/ls +0.5** + 보조문구, gap 3px | 품절 카드 (04-product-soldout-* 참조) |
| 카트 수량 뱃지 | §1.2 (핑크 원형 pill) | 헤더 카트 아이콘 |

- 참고: 카드 뱃지는 이미지 위가 아니라 **정보영역 인라인**이 기본이고, 이미지 위 오버레이는 SOLD OUT/COMING SOON 전용.

## 7. 인풋 / 셀렉트 기본형

- **Dawn `.field__input`**(로그인·주소 등): 16px, padding 15px, bg `rgb(var(--color-background))`, 보더는 box-shadow 방식 `0 0 0 1px rgba(18,18,18,.55)`(`--inputs-border-opacity .55`), radius 0. **focus: `0 0 0 2px #121212`**(1px+보더폭) + outline 0, transition box-shadow .1s. 플로팅 라벨: 16px → 채워지면 10px로 축소(top 이동, .1s), placeholder는 숨김(opacity 0).
- **`.select__select`**: 12px, text rgba(fg,.75), padding 0 30 0 20, 우측 캐럿 svg 6px 높이 absolute(right 15px), radius 0.
- **ipx 폼(`.ipx-form-group .form-control`)**: focus 시 **border-color #111 + caret #F83BAA**(box-shadow 없음), invalid 보더 핑크, 피드백 텍스트 13px 핑크(mt 8px).
- **검색 인풋**: 보더 없는 회색 필드(#F6F8FA), 데스크톱 min-h 60px / 모바일 50px, radius 0, caret 핑크.
- textarea: min-height 100px, resize none.

## 8. z-index 층위

| z | 요소 |
|---|---|
| 3 | `.section-header`(sticky 헤더), `menu-drawer`, 모바일 하단 탭바(오버라이드 `3 !important`; 기본 99, 셀렉션 메뉴 열림 시 0) |
| 4 | 헤더 그룹 형제 섹션(공지바·유틸바), `.modal__content`, 열린 디스클로저 팝업 |
| 0 (헤더 내부) | `.ipx-megamenu-wrap` — 헤더(3) 컨텍스트 안이라 본문 위에 뜸 |
| 10 | `.selection-menu`(모바일 스토어 전환 패널) |
| 99 / 100 | 카테고리 바텀시트 딤 / 시트 본체 |
| 999 | `.main-backdrop`(전역 백드롭) |
| 1000 / 1001 | `.searchBackdrop` / `.ipx-search`·`.mobileMenuSearch` |
| 9999 / 10000 | `.toast-backdrop` / `toast-popup`·`.ipx-modal` |

메모: 검색(1001) > 시트(100) > 백드롭(999)… 등 ipx 오버레이는 Dawn(≤5)과 별도의 3자리·4자리 대역을 쓴다. 재현 시 "크롬 3~4 / 패널 10~100 / 전역 오버레이 999+ / 토스트·모달 9999+" 4대역으로 정리하면 동일 층위가 나온다.

## 9. 트랜지션 · 모션

### 9.1 duration/easing 토큰 (`:root`)

```css
--duration-short: .1s;            /* 인풋 box-shadow, 메가 링크 underline */
--duration-default: .2s;          /* 범용 (opacity 등) */
--duration-announcement-bar: .25s;
--duration-medium: .3s;           /* GNB 밑줄바, sticky 슬라이드, 탭바 */
--duration-long: .5s;  --duration-extra-long: .6s;  --duration-extended: 3s;
--ease-out-slow: cubic-bezier(0, 0, .3, 1);
--animation-slide-in: slideIn .6s cubic-bezier(0,0,.3,1) forwards;
--animation-fade-in:  fadeIn  .6s cubic-bezier(0,0,.3,1);
```

### 9.2 실사용 패턴

| 대상 | 트랜지션 |
|---|---|
| GNB 밑줄바 | `transform .3s` (scaleX 0→1, origin center) |
| sticky 축약(.top-nav/.mobile-top-nav) | `margin .3s, opacity .3s` |
| 하단 탭바 | `.3s` (전체) |
| 헤더 아이콘 hover | `scale(1.07)` (기본 duration) |
| 인풋 focus 링 | `box-shadow .1s ease` |
| 메가메뉴 링크 | `text-decoration .1s ease` |
| 햄버거류 아이콘(잔재) | `transform .15s, opacity .15s` |
| 배너/섹션 등장 | slideIn/fadeIn `.6s cubic-bezier(0,0,.3,1)` |
| hover-lift 카드/버튼(테마 옵션) | `transform var(--duration-medium) ease` (hover:hover + no-reduce-motion 가드) |

- 이징은 사실상 **ease(기본) + ease-out-slow `cubic-bezier(0,0,.3,1)`** 2종.

## 10. 재현용 최소 토큰 세트 제안 (관찰 요약)

```css
:root {
  /* color */
  --ink: #111111;            /* = #121212와 통합 취급 가능 */
  --ink-sub: #3F3F3F;  --ink-tertiary: #616161;
  --disabled: #BBBBBB; --border-control: #C8CACC;
  --hairline: #EBEDEE; --hairline-dark: rgba(18,18,18,.1);
  --surface: #FFFFFF;  --surface-grey: #F6F8FA;  --surface-grey-2: #F3F3F3;
  --accent: #F83BAA;   --accent-tint: rgba(248,59,170,.1);   /* ← 자체 색으로 치환 지점 */
  /* type: root 10px, Pretendard */
  /* radius: 0 기본, 버튼 2/4, pill 40, 시트 8 */
  /* shadow: 0 4px 5px rgba(18,18,18,.05) 단일 */
  /* motion: .1/.2/.3s + cubic-bezier(0,0,.3,1) */
}
```

핵심 성격: **10px 루트 + Pretendard 단일 서체 + 각진(radius 0) 플랫 + 무채색 잉크 + 단일 핑크 액센트(하드코딩) + 그림자 1종**. 액센트 치환은 §1.2 표의 16개 사용처를 일괄 교체하면 된다.
