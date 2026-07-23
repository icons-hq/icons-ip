---
name: ICONS — Living IP Editorial v3
status: implemented
description: >
  IP를 주인공으로 두는 밝은 에디토리얼 팬덤·커머스 디자인 시스템.
  넓은 여백, 과감한 타이포그래피, 실제 IP 이미지, 절제된 파스텔 면,
  시네마틱 모션으로 세계를 소개하되 거래·인증·운영 표면은 평온하고 명료하게 유지한다.
authority:
  product-language: CONTEXT.md
  product-scope: docs/PRD.md
  architecture: docs/ARCHITECTURE.md
  target-design: DESIGN.md
  current-code:
    foundation: app/styles/editorial-foundation.css
    shell: app/styles/editorial-shell.css
    home: app/styles/editorial-home.css
    public: app/styles/editorial-public.css
    account-commerce: app/styles/editorial-account-commerce.css
    admin: app/styles/editorial-admin.css
    legacy-compatibility: app/globals.css
  route-map: lib/routes.ts
  note: >
    이 문서는 구현된 디자인 정본이다. 실제 토큰과 화면군 규칙은 app/styles/editorial-*.css가 진실이며,
    app/globals.css는 기존 클래스와 도메인 재질을 보존하는 호환 계층이다. 이후 변경은 문서와 코드를 함께 동기화한다.
reference-prototype:
  url: https://icons-ip-world-preview.sangwopakr19.chatgpt.site
  role: approved visual and interaction reference
  restrictions:
    - 외부 사이트의 코드, 이미지, 로고, 문구를 복제하지 않는다.
    - 현재 프로젝트 데이터, 라우트, 액션, 자산으로 같은 방향성과 리듬을 재구성한다.
canvas: light-editorial
breakpoints:
  compact: 720px
  wide: 1200px
  edge: [420px, 360px]
---

# ICONS — Living IP Editorial v3

> IP가 전면에 나오고, 팬은 그 세계를 발견하고 모으고 만나는 사람이다.
> 이 문서는 디자인 취향 모음이 아니라 실제 구현과 검수에 쓰는 기계 판독 가능한 정본이다.

## 0. 상태와 적용 원칙

- 이 문서는 사용자가 승인한 Sites 프로토타입을 실제 제품에 이식한 **구현 디자인 정본**이다.
- `Living IP Editorial`은 전역 기본값이며, 기존 `Holographic Midnight` 재질은 수집형 카드와 필요한 역상 표면에만 제한적으로 남는다. 실제 클래스와 동작은 `app/styles/editorial-*.css`, `app/globals.css`, 해당 컴포넌트가 함께 진실이다.
- 시각 시스템은 전면 교체하지만, 공개 브라우징, 인증, 장바구니, 주문, 결제, 카드팩, 예매, QR, 관리자 권한을 포함한 기능 계약은 바꾸지 않는다.
- 페이지를 새로 보이게 만들기 위해 실제 데이터 대신 정적 배열, 가짜 수치, 가짜 후기, 존재하지 않는 링크를 넣지 않는다.
- 용어는 `CONTEXT.md`를 따른다. 수집형 디지털 **카드**와 실물 **굿즈**, 카드 C2C **교환**과 굿즈 C2C **마켓**을 혼용하지 않는다.

## 1. 정체성

### 한 문장

**Living IP Editorial**은 각 IP를 하나의 살아 있는 세계처럼 편집하고, 상품·카드·이벤트·커뮤니티를 그 세계로 들어가는 서로 다른 입구로 보여주는 시스템이다.

### 세 가지 원칙

1. **IP가 주인공이다.** 장식보다 실제 키아트와 캐릭터를 크게 보여주고, 여백과 타이포그래피는 이미지를 돋보이게 한다.
2. **파스텔은 의미가 있는 공간이다.** 초록·분홍·파랑·노랑은 무작위 장식이 아니라 섹션, 경험, 상태를 구분하는 넓은 면으로 사용한다.
3. **팬덤의 설렘과 거래의 신뢰를 분리한다.** 발견 화면은 시네마틱하고 대담하게, 결제·예매·인증·관리 화면은 흰 종이처럼 차분하고 예측 가능하게 만든다.

### 유지하는 유산

- 홀로·foil은 전역 브랜드 효과가 아니라 **수집형 카드라는 물성** 안에서만 유지한다.
- IP별 액센트와 영문 표기는 `lib/ip-display.ts`, 희귀도 표현은 `lib/rarity.ts`를 진실원으로 유지한다.
- Space Mono는 가격, 수량, 주문번호, 확률, 시간, 규제·정책 메타처럼 정확성이 중요한 짧은 정보에만 사용한다.
- 어두운 표면은 영상 오버레이, 전면 메뉴, 푸터, 카드 리빌처럼 명확한 역상 문맥에서만 사용한다.

## 2. 색상 토큰

새 코드에서는 아래 **의미 기반 이름**을 사용한다. 기존 `--bg`, `--line`, `--pink`처럼 새 의미와 충돌하는 토큰을 새 화면에 재사용하지 않는다.

```yaml
colors:
  canvas:
    default: "#F4F4F1"
    soft: "#EFEFEB"
  surface:
    default: "#FFFFFF"
    muted: "#E7E7E2"
    placeholder: "#DDDDDD"
  ink:
    default: "#11110F"
    muted: "#686862"
    inverse-muted: "#858580"
  line:
    strong: "rgba(17,17,15,.40)"
    default: "rgba(17,17,15,.18)"
    soft: "rgba(17,17,15,.08)"
  pastel:
    green: "#C4E5AE"
    pink: "#FFDAFF"
    blue: "#A6C5E6"
    yellow: "#FFE888"
  brand:
    green: "#78BB53"
  state:
    success: "#3F7D38"
    warning: "#9A5B00"
    danger: "#B8324A"
    info: "#365CA8"
    focus: "#5B74FF"
  inverse:
    default: "#11110F"
    media: "#222222"
    text: "#FFFFFF"
```

### 사용 규칙

- 기본 본문은 `ink.default`, 보조 정보는 `ink.muted`를 사용한다.
- 흰 글자는 `inverse.default`, 충분히 어두운 미디어 스크림, 상태색처럼 대비가 검증된 면에만 쓴다.
- 밝은 파스텔 위에는 항상 `ink.default`를 쓴다. 파스텔 위 흰 글자는 금지한다.
- `brand.green`은 주 행동 또는 현재 활성 상태 하나에만 쓴다. 한 화면의 모든 버튼을 초록으로 만들지 않는다.
- 오류·성공·경고는 색만으로 구분하지 않고 아이콘, 제목, 설명을 함께 제공한다.
- IP 액센트는 배지, 작은 라인, 필터 선택처럼 IP를 식별하는 국소 요소에만 쓰며 전체 페이지 배경을 덮지 않는다.

### 기존 토큰 이행 규칙

- 기존 다크 토큰은 한 번에 의미를 뒤집지 않는다. 새 토큰을 먼저 추가하고 소비자를 화면 단위로 이동한다.
- `--holo`, rarity 색, IP 색은 카드 물성·메타데이터에 한해 유지한다.
- 기존 `.bg-atmos--*`, 전역 글로우, 다크 글래스 카드, 홀로 기본 CTA는 새 화면에서 사용하지 않는다.
- 모든 소비자가 옮겨진 뒤에만 사용되지 않는 기존 별칭을 제거한다.

## 3. 타이포그래피

```yaml
fonts:
  display: "Pretendard Variable, Pretendard, sans-serif"
  body: "Pretendard Variable, Pretendard, sans-serif"
  utility: "Space Mono, Pretendard, monospace"
type:
  hero-desktop: { size: "clamp(54px,11cqi,104px)", weight: 850, line-height: 1.08, letter-spacing: "-.03em" }
  hero-mobile: { size: "clamp(40px,12cqi,52px)", weight: 850, line-height: 1.12, letter-spacing: "-.03em" }
  section-macro: { size: "clamp(48px,6.2vw,116px)", weight: 840, line-height: 1.08, letter-spacing: "-.03em" }
  film: { size: "clamp(46px,5.4vw,102px)", weight: 840, line-height: 1.08, letter-spacing: "-.03em" }
  feature: { size: "clamp(40px,11cqi,76px)", weight: 840, line-height: 1.08, letter-spacing: "-.03em" }
  final-cta: { size: "clamp(58px,8.8vw,168px)", weight: 850, line-height: 1.08, letter-spacing: "-.03em" }
  card-title: { size: "clamp(22px,1.8vw,34px)", weight: 800, line-height: 1.2, letter-spacing: "-.025em" }
  eyebrow: { size: 11px, weight: 900, line-height: 1.5, letter-spacing: ".17em", transform: uppercase }
  body: { size: "15px–18px", weight: 450, line-height: 1.65 }
  utility: { size: "10px–13px", weight: 500, line-height: 1.5 }
  control: { line-height: 1.4 }
  wordmark: { line-height: 1 }
```

- 한국어 제목은 `word-break: keep-all`, `line-break: strict`, `overflow-wrap: normal`, `text-wrap: balance`를 기본으로 하며 기존 `<br>` 기반 편집 줄바꿈 안에서도 어절을 분할하지 않는다.
- 본문·목록·설명은 `word-break: keep-all`과 `overflow-wrap: break-word`를 사용한다. URL·이메일·주문/결제/티켓 ID·해시·관리자 원문처럼 기술 문자열에만 `overflow-wrap: anywhere`를 허용한다.
- 홈의 히어로와 피처 제목은 실제 카피 컨테이너 폭을 기준으로 `cqi` 단위를 사용하고, 미지원 환경을 위한 viewport 기반 fallback을 먼저 선언한다.
- 영문 대문자와 한글을 함께 쓸 때 시각 높이를 맞추고, 무조건적인 uppercase 변환으로 한글을 훼손하지 않는다.
- 본문과 폼 라벨에는 음수 자간을 적용하지 않는다.
- `font-weight: 840/850`을 지원하지 않는 환경에서는 가장 가까운 variable weight 또는 800을 사용한다.
- 모바일의 대형 제목은 1.12 행간을 사용하고 히어로·피처는 40px 아래로 축소하지 않으며, 줄 수 증가를 허용한다.

## 4. 레이아웃과 공간

```yaml
layout:
  header-container: "min(94vw,1500px)"
  editorial-container: "min(88vw,1680px)"
  feature-container: "min(91vw,1740px)"
  film-window: "min(89.38vw,1700px) × min(50.26vw,956px)"
  desktop-gutter: "6vw"
  mobile-gutter: "21px"
  carousel-gap-desktop: "28px"
  carousel-gap-mobile: "16px"
  section-space-large: "clamp(130px,11vw,215px)"
  section-space-medium: "clamp(120px,10vw,195px)"
```

- 홈은 넓은 에디토리얼 컨테이너를 쓰고, 검색·커머스·계정·관리처럼 읽기 밀도가 높은 화면은 `max-width: 1240–1440px` 안에서 유지한다.
- 한 섹션 안의 큰 제목, 설명, 행동은 같은 왼쪽 축을 공유한다.
- 가로 캐러셀은 마지막 카드 뒤에도 바깥 여백과 같은 종료 여백을 둔다.
- 정보 그리드는 CSS grid, 콘텐츠 순서는 DOM 순서로 결정한다. 시각 위치를 위해 의미 순서를 뒤집지 않는다.

## 5. 형태, 선, 깊이

```yaml
radii:
  image-hairline: 3px
  feature: 10px
  feature-mobile: 5px
  compact-card: 14px
  orbit-square: 20%
  chat: 22px
  collectible: 24px
  poster: 28px
  pill: 999px
  circle: 50%
```

- 표면은 기본적으로 평평하다. 흰 카드와 캔버스는 `line.soft` 또는 여백으로 구분한다.
- 큰 그림자는 떠 있는 헤더, 전면 메뉴, 모달에만 사용한다. 리스트 카드마다 깊은 그림자를 반복하지 않는다.
- 일반 버튼과 필터는 pill, 키아트·포스터는 낮은 radius, 수집형 카드는 24px radius를 쓴다.
- hover 깊이는 이동 2–4px 또는 이미지 확대 중 하나로만 표현한다. 둘을 과도하게 합치지 않는다.

## 6. 이미지와 아트 디렉션

### 자산 우선순위

1. `public/generated/ip`, `public/generated/goods`, `public/generated/cards`, `public/generated/events`의 현재 프로젝트 자산
2. 데이터가 가리키는 프로젝트 내부 public/storage 이미지
3. 동일 IP의 기존 자산을 활용한 크롭·레이아웃 변형
4. 위 세 단계로도 필수 장면이 비는 경우에만 새 이미지 생성

### 생성 이미지 규칙

- 생성물은 외부 사이트의 캐릭터, 구도, 사진을 복제하지 않고 현재 프로젝트의 IP 설정과 자산 방향을 기준으로 만든다.
- 생성 전에 어느 화면의 어떤 빈 슬롯을 해결하는지 명확히 한다. 단순 장식용 이미지를 대량 생성하지 않는다.
- 생성된 파일은 역할에 맞는 로컬 프로젝트 자산 폴더와 명확한 이름으로 저장하고, 기존 이미지 필드가 소비할 수 있는 로컬 경로로 연결한다.
- 생성물 때문에 스키마, 원격 Storage, Supabase 데이터, production 큐레이션을 변경하지 않는다. 그런 연결이 필요하면 디자인 구현과 분리해 별도 승인을 받는다.
- 16:9 히어로, 4:5 포스터, 1:1 IP 아바타, 카드 비율 등 소비처 비율을 먼저 정하고 생성한다.
- 중요한 얼굴·캐릭터·상품은 모바일 안전 영역을 포함한 crop에서 잘리지 않아야 한다.

### 표현 규칙

- 히어로는 실제 IP 이미지가 화면의 중심이다. 텍스트 가독성이 필요하면 단색 박스보다 부드러운 이미지 스크림을 우선한다.
- 상품과 티켓은 실제 형태·가격·상태를 명확히 보여주며 과도한 색 필터를 씌우지 않는다.
- `object-fit: cover`를 기본으로 쓰되 굿즈 누끼·카드 원본처럼 전체 형태가 중요한 경우 `contain`을 사용한다.
- 이미지가 없을 때는 깨진 링크 대신 `surface.placeholder` 면, 종류 아이콘, 명확한 대체 텍스트를 제공한다.

## 7. 모션과 상호작용

```yaml
duration:
  fast: 300ms
  control: 400ms
  header: 500ms
  overlay: 600ms
  media-hover: 650ms
  image: 750ms
  menu: 850ms
  hero-fade: 1000ms
  film-reveal: 1750ms
  copy-reveal: 2000ms
easing:
  header: "cubic-bezier(.22,.8,.28,1)"
  menu: "cubic-bezier(.7,0,.15,1)"
  media: "cubic-bezier(.2,.76,.25,1)"
  film: "cubic-bezier(.48,0,.14,1)"
  soft: "cubic-bezier(.2,.8,.2,1)"
  copy: "cubic-bezier(.18,.85,.2,1)"
```

### 공통 동작

- **떠 있는 헤더:** 문서 상단 80px까지는 보인다. 이후 스크롤 방향이 12px 이상 누적되면 아래로 갈 때 숨고 위로 갈 때 나타난다. 전환은 500ms다.
- **전면 메뉴:** 캡슐 메뉴 버튼에서 전체 화면 방사형 메뉴로 확장한다. 열림 동안 배경 스크롤을 잠그고 Escape·바깥 클릭·닫기 버튼을 지원하며 닫힌 뒤 트리거에 포커스를 돌려준다.
- **히어로:** 최대 5개 장면, 장면당 3초, 1초 crossfade. 이미지가 6초 동안 `scale(1.045)`에서 `1`로 이동하고 카피는 2초 clip reveal을 쓴다. 사용자가 조작하거나 탭이 비활성화되면 자동 재생을 멈춘다.
- **IP 궤도 마퀴:** 30초 선형 순환, hover/focus-within에서 일시 정지. 항목 hover는 이미지 1.25배/650ms, 오버레이 600ms다.
- **필름 윈도:** 장면당 4.2초. 원형 마스크는 250ms 지연 뒤 1.75초 동안 열리고, 이미지는 2초 동안 `scale(2)`에서 `1`로 안정된다.
- **가로 경험 카드:** native scroll과 `scroll-snap`을 사용한다. 카드 폭만큼 이동하며 데스크톱 28px, 모바일 16px 간격이다.
- **패럴랙스:** `requestAnimationFrame`으로 묶고 화면 밖에서는 중지한다. 포인터 위치보다 스크롤 진행률을 우선하며 레이아웃을 유발하는 속성은 움직이지 않는다.

### 모션 금지 구간

- 결제 입력, 주문 확정, 예매 확정, QR 표시, 관리자 저장 중에는 주변 자동 모션을 멈춘다.
- 로딩·성공·오류를 지연시키기 위한 장식 애니메이션을 넣지 않는다.
- `prefers-reduced-motion: reduce`에서는 CSS transition/animation과 JS autoplay/parallax를 모두 중지하고, 캐러셀은 즉시 이동한다.

## 8. 핵심 컴포넌트 패턴

| 패턴 | 목적 | 필수 규칙 |
|---|---|---|
| `floating-capsule-header` | 전역 탐색 | 좌측 워드마크, 중심/전면 탐색, 우측 검색·알림·장바구니·계정. 인증 라우트 숨김 규칙 유지 |
| `fullscreen-radial-menu` | 전체 메뉴 | focus trap, Escape, 스크롤 잠금, 현재 경로, 실제 라우트만 표시 |
| `cinematic-hero-carousel` | 홈 첫 장면 | 실제 카탈로그 파생, 최대 5개, 수동 컨트롤·상태 레이블·감속 모션 |
| `announcement-rail` | 운영 공지 | 활성 큐레이션만, 안전한 내부 링크, 공지가 없으면 영역 자체 제거 |
| `macro-section-heading` | 섹션 전환 | 대형 제목+짧은 설명+한 개의 명확한 진입 행동 |
| `ip-orbit-marquee` | IP 발견 | 실제 IP 목록, hover/focus 일시 정지, 각 항목은 `/ip/[id]` 링크 |
| `capsule-film-window` | 세계관 몰입 | 실제 이미지 1–3장, 장면 레이블, reduced motion 정지 화면 |
| `experience-snap-carousel` | 굿즈·이벤트·게시물 발견 | 실제 데이터, native scroll-snap, 키보드 조작, 빈 상태 |
| `pastel-story-panel` | 설명·캠페인 | 한 개 파스텔 면, 한 개 메시지, 한 개 행동 |
| `editorial-stat-grid` | 실제 현황 | 카탈로그 또는 집계에서 계산된 값만, 출처 없는 파트너·팬 수 금지 |
| `orbit-final-cta` | 최종 진입 | 큰 타이포와 실제 경로, 가입 강요보다 공개 탐색 우선 |
| `oversized-inverse-footer` | 역상 푸터 | 실제 약관·정책·보조 링크, 큰 워드마크, 작은 법적 정보 |
| `arrow-circle-action` | 보조 이동 | 명확한 접근성 이름, 화살표만 있을 때도 최소 44×44px |
| `flat-form-surface` | 인증·계정·관리 입력 | 흰 배경, hairline, label 상시 노출, 오류를 필드 근처에 표시 |
| `transaction-receipt` | 주문·예매·환불 | 금액·수량·상태의 명확한 계층, Space Mono 보조, 장식보다 신뢰 우선 |

### 전역 셸

- 데스크톱·모바일 모두 상단 캡슐 헤더를 기본으로 한다. 기존 고정 모바일 바텀탭은 제거한다.
- 모바일 핵심 진입점은 캡슐 헤더와 전면 메뉴에서 제공하며 장바구니 수량·안읽은 알림 상태를 유지한다.
- 검색, 알림, 장바구니, 계정은 로그인 상태와 현재 라우트에 따라 기존과 같은 노출 계약을 유지한다.
- `app/layout.tsx`의 `CartProvider`와 `AuthPresenceProvider`는 셸의 시각 구조가 바뀌어도 유지한다.
- 푸터는 `binder`, `exchange`, `market`, 약관 등 고아가 되기 쉬운 실제 링크를 계속 제공한다.

### 버튼, 칩, 입력

- primary는 `ink.default` 바탕/흰 글자 또는 `brand.green` 바탕/잉크 글자 중 한 화면에서 하나만 선택한다.
- secondary는 흰 면+`line.default`, tertiary는 텍스트+화살표다.
- 파괴 행동은 `state.danger`; primary 브랜드 색으로 위장하지 않는다.
- 버튼·입력·select의 최소 높이는 44px, 모바일 주요 CTA는 48–52px다.
- 입력은 placeholder만으로 라벨을 대체하지 않고, focus는 2px `state.focus` 외곽선을 쓴다.
- 필터 칩은 선택 상태를 채움, 체크 또는 굵기로 함께 표시한다.

### 카드

- 일반 콘텐츠 카드는 흰 평면+얇은 선+이미지로 구성하며 홀로 효과를 쓰지 않는다.
- 수집형 카드만 foil, rarity 광택, 3D tilt를 사용할 수 있다. reduced motion에서는 tilt를 제거한다.
- 카드 전체가 링크라면 내부 보조 버튼과 중첩 인터랙션을 만들지 않는다.

## 9. 홈 화면 정본

홈은 승인된 프로토타입의 리듬을 가장 충실히 이식하는 화면이다. 데이터 계약은 `app/page.tsx`의 네 prop을 그대로 유지한다.

```yaml
home-contract:
  props:
    - catalog
    - curation
    - followedIpIds
    - postPreviewByIpId
  server-source: getHomeSnapshot
  featured-limit: 5
  no-static-content-arrays: true
```

### 구성 순서

1. `floating-capsule-header`
2. `cinematic-hero-carousel`
3. `announcement-rail`
4. `macro-section-heading` + `ip-orbit-marquee`
5. `capsule-film-window`
6. `macro-section-heading` + `experience-snap-carousel`
7. `pastel-story-panel`
8. `editorial-stat-grid`
9. `orbit-final-cta`
10. `oversized-inverse-footer`

### 실제 데이터 매핑

- 히어로 첫 장면은 활성 `curation.hero`를 사용한다. 나머지는 실제 `catalog.events`, `catalog.goods`, featured IP를 중복 없이 채워 최대 5개로 만든다.
- 큐레이션이 없으면 공개 featured IP 또는 가장 가까운 활성 이벤트를 첫 장면으로 사용한다. 이미지가 하나도 없으면 가짜 배너 대신 명시적 카탈로그 빈 상태를 표시한다.
- 공지 레일은 활성 공지만 렌더링한다. 링크는 현재 앱의 안전한 내부 링크 검증을 통과해야 한다.
- IP 마퀴는 실제 카탈로그 IP를 사용한다. 항목이 데스크톱 5개, 모바일 3개보다 적으면 복제하지 않고 정적으로 가운데 정렬한다.
- 온보딩 사용자는 `followedIpIds`가 포함된 항목을 발견 레일 앞쪽에 배치할 수 있지만 전체 공개 카탈로그는 숨기지 않는다.
- 필름 장면은 실제 대표 IP·굿즈·이벤트·카드 이미지 중 최대 3개를 사용한다.
- 경험 캐러셀은 활성 이벤트, 구매 가능한 굿즈, 공개 게시물 프리뷰, 카드 컬렉션을 실제 경로로 연결한다.
- 통계는 카탈로그 수, 활성 이벤트 수, 실제 집계 팬 수처럼 현재 데이터로 계산 가능한 값만 쓴다. 고정 파트너 수나 과장된 숫자를 만들지 않는다.
- 모든 링크는 `lib/routes.ts`의 실제 경로 또는 기존 안전한 내부 href를 사용한다.

### 상태 처리

- 빈 카탈로그에서도 브랜드 소개, 공개 탐색 안내, 명시적 빈 상태는 남는다.
- 실패 의미는 현재 `getHomeSnapshot` 호출 단위와 기존 route error boundary를 유지한다. 부분 성공·섹션별 재시도는 서버 계약 변경이므로 이번 디자인 이행에 포함하지 않는다.
- 이미지 로딩 중에는 최종 비율과 같은 placeholder를 사용해 layout shift를 막는다.
- 자동 재생 컨트롤은 현재 장면, 전체 장면 수, 일시 정지 상태를 스크린리더에 전달한다.

## 10. 화면군별 플레이북

### 공개 발견

| 화면 | 라우트 | 목표 표현 | 기능 불변 조건 |
|---|---|---|---|
| 홈 | `/` | §9의 시네마틱 에디토리얼 구성 | `getHomeSnapshot`과 네 prop 유지 |
| IP 허브·상세 | `/ip`, `/ip/[id]` | 대형 키아트, IP별 파스텔 챕터, 굿즈·카드·이벤트·커뮤니티 레일 | 공개 읽기, 팔로우·알림 액션, 실제 IP accent 유지 |
| 굿즈샵 | `/shop` | 큰 카테고리 제목, 평평한 상품 그리드, 스티키 필터 | 재고·판매 상태·장바구니 수량 한도 유지 |
| 이벤트 | `/events`, `/events/[eventId]` | 포스터 중심 에디토리얼 목록과 상세 | 회차·잔여·알림·예매 진입 계약 유지 |
| 검색 | `/search` | 큰 검색 입력과 종류별 결과 챕터 | 실제 `getSearchSnapshot`, URL 검색 상태 유지 |
| 카드팩·바인더 | `/packs`, `/binder` | 밝은 전시장 안에서 카드 자체만 홀로 물성 | 카드풀·확률·소유·개봉 액션 계약 유지 |
| 마켓·교환 | `/market`, `/exchange` | 밝은 미래 기능 안내, 실제 범위와 준비 상태 명시 | v2 플레이스홀더와 보호 액션 유지 |

### 참여와 팬덤

| 화면 | 라우트 | 목표 표현 | 기능 불변 조건 |
|---|---|---|---|
| 커뮤니티 | `/community` | 에디토리얼 피드, 흰 게시물, 파스텔 채널 레일 | 작성·수정·좋아요·댓글·신고·차단 FormData 계약 유지 |
| 알림 | `/notifications`, `/notifications/settings` | 읽기 쉬운 inbox와 IP별 스위치 | 최신 50건, unread, 안전 링크, 설정 action 유지 |
| 게임 | `/games/[gameId]` | IP 세계 안의 독립 풀블리드 장면 | 서버 판정, 일일 한도, 결과·보상 계약 유지 |

### 인증과 계정

| 화면 | 라우트 | 목표 표현 | 기능 불변 조건 |
|---|---|---|---|
| 로그인·복구 | `/login`, `/update-password` | 파스텔/키아트 분할+흰 폼, 방해 없는 단일 과업 | OAuth, recovery, 필드 이름, redirect 유지 |
| 온보딩 | `/onboarding` | 단계별 IP 선택과 약관을 큰 카드로 분리 | 공개 범위·필수 동의·프로필 action 유지 |
| 이용 제한 | `/account-suspended` | 평온한 안내와 명확한 로그아웃 | 내부 사유·기간 비노출 유지 |
| 마이·설정 | `/my`, `/settings` | 프로필 에디토리얼 헤더+평면 기능 목록 | signed avatar, 업로드 claim, 독립 form 유지 |

### 거래와 신뢰

| 화면 | 라우트 | 목표 표현 | 기능 불변 조건 |
|---|---|---|---|
| 장바구니 | `/cart` | 제품 이미지가 큰 행+조용한 주문 요약 | local/DB 병합, 재고·품절·수량 계약 유지 |
| 체크아웃 | `/checkout`, `/checkout/[orderId]`, success/fail | 흰 종이형 2열, 모바일 1열, 명확한 타이머 | Toss mount ID, purpose, order ID, callback, payload 유지 |
| 주문 | `/orders`, `/orders/[orderId]` | `transaction-receipt`와 상태 타임라인 | DB snapshot, 취소·환불·카드팩 내역 유지 |
| 티켓 결제 | `/ticket-checkout/[ticketOrderId]`, success/fail | 포스터+회차+10분 선점 영수증 | 예약 RPC, Toss 계약, 웹훅 확정 유지 |
| 내 티켓 | `/tickets`, `/tickets/[ticketOrderId]` | 티켓 카드와 보호 QR, 상태·영수증 분리 | no-store QR, 본인 권한, 취소 가능 조건 유지 |

거래 화면에서는 장식 모션보다 금액, 수량, 남은 시간, 현재 상태, 다음 행동을 우선한다. 브라우저 성공 화면은 결제 완료의 진실원으로 표현하지 않고 서버 확인 중 상태를 정확히 보여준다.

### 관리자와 현장 운영

관리 화면은 같은 브랜드에 속하되 홈의 초대형 타이포와 자동 모션을 반복하지 않는다. `canvas.default` 위 흰 작업대, 조밀한 표, hairline, 고정된 action bar를 쓴다.

현재 15개 섹션인 **개요, 주문, IP, 굿즈, 카드, 카드풀, 발급 정책, 게임, 이벤트, 티켓 회차, 홈 큐레이션, 공지 발송, 모더레이션, 회원, 역할**을 모두 같은 작업대 규율로 이행한다. 역할 섹션의 기존 권한별 노출 조건을 유지한다.

| 화면군 | 현재 범위 | 목표 표현 | 기능 불변 조건 |
|---|---|---|---|
| 관리자 셸 | `/admin`의 15개 섹션 | 좌측/상단 탐색+master-detail, 1240–1440px 작업대 | staff 권한과 section query 유지 |
| 주문·회원·신고 | 검색, 상태 전이, 제재, moderation | 읽기 밀도 높은 표·상세·확인 dialog | 마스킹, 권한 계층, 감사, 멱등 operation ID 유지 |
| 굿즈·티켓·카드풀·정책·게임 | 카탈로그와 운영 설정 | field group과 상태 요약을 파스텔이 아닌 중립 면으로 분리 | 기존 action, hidden input, 잠금 규칙 유지 |
| 홈 큐레이션·아트워크 | 히어로/공지/특집과 업로드 claim | 실제 홈 비율 preview와 저장 상태 분리 | 검증·promote·remove opt-in·업로드 제한 유지 |
| 현장 검표 | `/admin/check-in` | 모바일 우선, 큰 카메라/결과/재시도 면 | same-origin API, 재검표·환불 상태, idempotence 유지 |

- 표와 폼의 select/button/input은 최소 44px를 유지한다.
- 저장·삭제·정지·환불처럼 영향이 큰 행동은 현재 대상과 결과를 dialog에서 다시 명시한다.
- 성공 토스트만으로 끝내지 않고 저장된 값이나 갱신된 상태를 화면에서 확인할 수 있게 한다.
- 개인정보, provider 식별자, raw 결제 payload, service-role 정보는 시각 개편 과정에서도 노출하지 않는다.

## 11. 상태, 피드백, 보조 화면

- **로딩:** 콘텐츠 최종 비율을 보존하는 skeleton. 전체 화면 spinner는 인증 callback처럼 정말 전체가 대기할 때만 사용한다.
- **빈 상태:** 무엇이 비었는지, 왜 비었을 수 있는지, 가능한 다음 행동 하나를 알려준다. 가짜 콘텐츠로 채우지 않는다.
- **오류:** 사용자 행동으로 해결 가능한지 구분하고, 재시도와 안전한 이탈 경로를 제공한다. 내부 오류 문자열과 민감 정보를 노출하지 않는다.
- **성공:** 완료된 대상, 다음 상태, 후속 링크를 명확히 한다. 결제는 서버 확인 전 “완료”로 표현하지 않는다.
- **404:** 큰 에디토리얼 숫자/문구, 홈·검색의 실제 링크. 존재하지 않는 추천 콘텐츠를 만들지 않는다.
- **disabled:** 단순 opacity만 낮추지 않고 cursor, `aria-disabled`/native disabled, 이유 설명을 일관되게 제공한다.

## 12. 반응형과 접근성

### 반응형

- `>=1200px`: 전체 에디토리얼 컴포지션, 다중 열, 넓은 여백.
- `721–1199px`: 타이포와 이미지 비율은 유지하되 보조 열을 접고 카드 수를 줄인다.
- `<=720px`: 21px gutter, 한 열 우선, 43–59px의 압축된 대형 타이포, 16px 캐러셀 간격.
- `<=420px`와 `<=360px`: 긴 금액·주문번호·관리 action, 소셜 로그인, 체크아웃 필드의 overflow를 별도로 검증한다.
- viewport 높이가 짧아도 메뉴 닫기, 결제 CTA, 검표 재시도에 접근할 수 있어야 한다.

### 접근성

- 일반 텍스트는 WCAG AA 대비를 충족하고, 큰 텍스트 기준을 핑계로 본문 대비를 낮추지 않는다.
- 모든 상호작용은 키보드로 가능하며, focus-visible은 2px `state.focus`와 충분한 offset을 쓴다.
- 아이콘 단독 버튼은 접근 가능한 이름을 갖고 최소 44×44px다.
- 캐러셀·마퀴는 정지 수단과 현재 위치 정보를 제공한다. 자동 재생은 포커스·hover·문서 비활성에서 멈춘다.
- 이미지 alt는 화면의 목적을 설명한다. 주변 텍스트와 완전히 중복되는 장식 이미지는 빈 alt를 쓴다.
- 오류는 해당 필드와 `aria-describedby`로 연결하고 첫 오류로 포커스를 이동한다.
- 모달·전면 메뉴는 포커스 trap, Escape, 복귀 포커스를 보장한다.
- 색, 움직임, 위치만으로 상태나 의미를 전달하지 않는다.

## 13. 백엔드·API 불변 계약

디자인 이행은 표현 계층 변경이다. 아래는 명시적 별도 기능 요청 없이는 수정하지 않는다.

```yaml
protected-boundaries:
  - supabase/migrations/**
  - supabase/tests/**
  - lib/supabase/**
  - lib/auth/**
  - lib/payments/**
  - lib/admin/**
  - proxy.ts
  - app/auth/callback/**
  - app/api/**
  - app/**/actions.ts
  - components/shell/CartProvider.tsx
  - components/shell/AuthPresenceProvider.tsx
  - components/payments/**
preferred-unchanged:
  - app/page.tsx
  - lib/catalog.ts
  - lib/catalog-source.ts
```

위 경로는 최소 보호 목록이지 전부가 아니다. 저장소 전체의 데이터 조회·검증·권한·mutation·redirect·provider·결제·주문·티켓·게임 판정 로직은 의미적으로 동결한다. 해당 컴포넌트에 시각용 wrapper나 class가 꼭 필요하면 동작 코드를 바꾸지 않는 최소 변경만 하고 집중 회귀 테스트로 계약을 증명한다.

- Server Component의 데이터 조회, page prop shape, redirect, `revalidatePath`/`revalidateTag`를 바꾸지 않는다.
- `<form action>`, Server Action import, field `name`, hidden input의 이름·값, operation ID를 보존한다.
- 장바구니의 비로그인 localStorage↔로그인 DB 동기화와 실패 rollback을 보존한다.
- 공개 IP·굿즈·카드·이벤트·커뮤니티 읽기를 로그인 뒤로 옮기지 않는다. 로그인은 구매, 카드팩 개봉, 게임, 예매, 작성, 팔로우 같은 보호 행동 시점에 요구한다.
- 가격, 재고, 카드 발급 RNG, 카드팩 발급·개봉, 티켓 수용량, 래플, QR 유효성을 클라이언트 상태로 이전하지 않는다.
- 토스페이먼츠의 결제 진실원은 웹훅이다. `#toss-payment-methods`, `#toss-agreement`, purpose, order ID, callback URL, confirm payload를 그대로 유지한다.
- service role, raw provider payload, secret은 서버 경계 밖으로 내보내지 않는다.
- 관리자 권한은 `profiles.role`과 RLS 양쪽의 기존 검증을 유지하고 모든 민감 작업의 감사 가능성을 보존한다.
- 게임은 렌더링을 바꿔도 서버 결과, WASM/physics, 일일 한도, 보상 확정을 변경하지 않는다.

### 회귀 기준선

- 디자인 이행 시작 전 기준선은 `764`개 test file, `7,523`개 test 통과다.
- 기존 행동 assertion을 삭제하거나 느슨하게 만들어 통과시키지 않는다. 시각 마크업 때문에 snapshot/문구 기대값을 바꿀 때도 기능 assertion은 유지한다.
- 홈·카탈로그: `app/page.test.tsx`, `components/screens/Home.test.tsx`, `lib/home-catalog.test.ts`, `lib/catalog.test.ts`, `lib/catalog-source.test.ts`
- 인증·보호 액션: `lib/auth/server.test.ts`, `lib/auth/onboarding.test.ts`, `app/auth/callback/route.test.ts`, 각 `app/**/actions.test.ts`
- 결제·API: `lib/payments/*.test.ts`, `components/payments/*.test.tsx`, `app/api/**/*.test.ts`
- 화면군 이행마다 관련 묶음을 먼저 통과시키고, 최종적으로 전체 `npm run test`를 실행한다.

## 14. Do / Don't

### Do

- 실제 IP 이미지와 콘텐츠를 크게 보여준다.
- 밝은 캔버스, 검정 잉크, 넓은 여백을 기본으로 한다.
- 파스텔은 섹션 의미를 만드는 넓은 한 면에 쓴다.
- 화면당 한 개의 지배적인 타이포그래피 순간과 한 개의 primary action을 만든다.
- 상호작용이 많은 표면일수록 모션과 장식을 줄인다.
- 모든 섹션에 실제 데이터, 오류, 빈 상태, 이미지 부재 상태를 설계한다.
- 카드만의 홀로 물성과 IP/rarity 메타데이터를 보존한다.

### Don't

- 다크 배경, 유리 카드, 네온 글로우를 전역 기본값으로 되돌리지 않는다.
- 외부 사이트의 코드·이미지·로고·문구를 가져오지 않는다.
- 프로토타입의 해시 링크, 정적 카드 배열, 고정 통계, 가짜 파트너 로고를 제품에 넣지 않는다.
- 모든 섹션을 서로 다른 파스텔로 칠해 장난감처럼 만들지 않는다.
- 일반 굿즈·이벤트·관리 카드에 foil, glow, 3D tilt를 사용하지 않는다.
- 새 디자인을 이유로 form field, action, API 경로, 서버 권한 검사를 교체하지 않는다.
- 미확정 취소·환불·양도 정책이나 존재하지 않는 화폐를 카피로 발명하지 않는다.
- 데스크톱을 단순 축소해 모바일로 만들거나, 핵심 행동을 hover에만 숨기지 않는다.

## 15. 구현 순서와 완료 조건

### 이행 순서

1. 현재 page prop, action, API, 결제·인증 contract test를 동결한다.
2. 새 의미 토큰, 폰트, 캔버스, 셸을 추가한다.
3. 홈을 승인 프로토타입과 같은 구조·리듬으로 구현한다.
4. IP, 굿즈샵, 이벤트, 검색, 카드팩·바인더, 플레이스홀더를 이행한다.
5. 커뮤니티, 팔로우, 알림을 이행한다.
6. 로그인, 온보딩, 마이, 설정을 이행한다.
7. 장바구니, 결제, 주문, 예매, 티켓을 이행한다.
8. 관리자 15개 섹션과 현장 검표를 이행한다.
9. 게임 표면을 같은 팔레트에 연결하되 게임 로직을 보존한다.
10. 사용되지 않는 구 시스템 CSS를 확인 후 제거하고 문서 상태를 실제 코드와 동기화한다.

### 화면별 완료 체크

- 기본, hover, focus, active, disabled, loading, empty, error, success 상태가 있다.
- 360px, 720px, 1199px, 1440px 이상에서 주요 콘텐츠와 행동이 잘리지 않는다.
- 키보드 탐색, 접근 가능한 이름, 포커스 복귀, reduced motion이 동작한다.
- 실제 데이터가 길거나 없거나 이미지가 없을 때도 레이아웃이 유지된다.
- 기존 Server Action, API, redirect, 결제·인증·권한 contract test가 그대로 통과한다.
- `npm run test`, `npm run lint`, `npm run build`가 통과한다.
- 실제 브라우저에서 홈, 공개 탐색, 인증, 장바구니, 체크아웃, 티켓, 관리자 핵심 경로를 smoke test한다.
- `git diff`와 `git status`에서 의도한 시각 변경 외의 파일이 섞이지 않았음을 확인한다.

### 정본 승격 규칙

전체 이행과 검증이 완료되어 frontmatter의 `status`는 `implemented`다. 토큰과 화면군 규칙의 코드 진실원은 `app/styles/editorial-*.css`, 기존 클래스·수집형 재질의 호환 진실원은 `app/globals.css`다. 이후 시각 계약을 바꾸면 이 문서와 해당 스타일·컴포넌트를 같은 변경에서 동기화한다.
