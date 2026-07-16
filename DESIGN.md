---
name: ICONS — Holographic Midnight v2
description: >
  다크 홀로그래픽 K-pop 팬덤·수집·커머스 디자인 시스템.
  base 정체성은 ICONS-오리지널(홀로 스펙트럼 · foil · 글래스모픽)이며 외부에서 이식할 수 없다.
  v2부터 시각 진실원은 Claude Design 핸드오프(로컬 design/handoff/claude-design/, gitignored)이고,
  구현은 그 값을 app/globals.css 토큰·클래스로 정규화해 이식한 결과다.
  캔버스는 다크 단일이고, 결제·충전·가격 표면의 신뢰는 캔버스를 뒤집지 않고 다크 위 명료함으로 얻는다.

# 상태 범례
#   [구현됨]      코드에 존재 — app/globals.css 등에 근거(file:line). 코드가 진실.
#   [차용·미구현]  목표 구조. 아직 코드에 없음 — 에이전트는 클래스 존재를 가정하지 말 것.
#
# 토큰 진실원: app/globals.css 의 @theme 블록. 이 파일과 코드가 충돌하면 코드가 진실이다.
# 시각 진실원: design/handoff/claude-design/*.dc.html (로컬 참조용 — 페이지 간 불일치는 공통 토큰으로 정규화해 이식).

canvas: dark-only            # [구현됨] 트랜잭션도 다크 위 명료함으로 신뢰 확보

colors:                      # [구현됨] app/globals.css:9-33 — v1과 동일(핸드오프 v2가 같은 팔레트 사용)
  bg: "#08060F"
  bg-2: "#0C0A18"
  surface: "#15112A"
  surface-2: "#1C1638"
  surface-3: "#261C4D"
  line: "rgba(255,255,255,0.07)"
  line-2: "rgba(255,255,255,0.13)"
  line-3: "rgba(255,255,255,0.22)"
  text: "#F4F1FF"
  dim: "#A9A2CC"
  faint: "#6F688F"
  violet: "#8B5CFF"
  violet-2: "#A981FF"
  pink: "#FF4D9D"
  cyan: "#2DE2FF"
  mint: "#38F0C0"
  lime: "#C6FF3D"
  amber: "#FFB23D"

ip-accents:                  # [구현됨] lib/ip-display.ts — IP별 표시색·영문명. 미등재 IP는 vertical 색 fallback
  rilakkuma: "#FFD84D"
  maplestory: "#38F0C0"
  nongdamgom: "#F7A8C7"
  kakao-friends: "#FFD84D"
  attack-on-titan: "#A981FF"

rarity-colors:               # [구현됨] lib/rarity.ts RARITY_META — rarity 색 단일 진실원. HOLO 배지는 holo 그라데 처리
  truth: "lib/rarity.ts"

gradients-effects:           # [구현됨] app/globals.css:82-85,320-332 — 시그니처 하이프 어휘
  holo: "linear-gradient(115deg,#2DE2FF 0%,#8B5CFF 34%,#FF4D9D 66%,#FFB23D 100%)"
  holo-soft: "linear-gradient(115deg, rgba(45,226,255,.25),rgba(139,92,255,.25),rgba(255,77,157,.25),rgba(255,178,61,.25))"
  shadow: "0 24px 60px -20px rgba(0,0,0,.7)"
  glow-v: "0 0 0 1px rgba(139,92,255,.4), 0 16px 48px -12px rgba(139,92,255,.45)"
  foil: "color-dodge 오버레이 (수집형 카드 시그니처 — 틸트 카드 glare가 같은 어휘를 inline으로 사용)"
  atmos: "고정 배경 radial 블룸 — 라우트별 변형 .bg-atmos--*"

fonts:                       # [구현됨] app/globals.css:41-44 (next/font + Pretendard CDN)
  display: "Space Grotesk, Pretendard, sans-serif"
  body: "Pretendard, Space Grotesk, sans-serif"
  mono: "Space Mono, Pretendard, monospace"

typography:                  # [구현됨] app/globals.css:197-211
  h-xxl:   { font: display, size: "clamp(46px,9vw,104px)", weight: 700, lh: 1.05, ls: "-0.04em" }   # 홈 히어로
  h-xl:    { font: display, size: "clamp(36px,5vw,64px)", weight: 700, lh: 1.04, ls: "-0.04em" }    # 페이지 헤더(핸드오프 v2 표준)
  h-lg:    { font: display, size: "clamp(24px,3.2vw,36px)", weight: 700, lh: 1.05, ls: "-0.02em" }
  body:    { font: body,    size: "15–16px", weight: 400, lh: 1.5 }
  eyebrow: { font: mono,    size: "12px", ls: "0.22em", transform: uppercase, note: "기본 violet-2, 표면별 색 override(팝업=mint, 굿즈=amber, 커뮤니티=pink, 교환=cyan)" }
  tag:     { font: mono,    size: "11px", ls: "0.04em", transform: uppercase, color: dim }
  btn:     { size: "14.5px", weight: 600 }        # btn-sm 13px, btn-holo weight 700

rounded:                     # [구현됨] app/globals.css:35-39 (+ pill 999px)
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "26px"
  xl: "36px"
  pill: "999px"

layout:                      # [구현됨] app/globals.css:47,86-87
  maxw: "1240px"
  nav-h: "68px"
  breakpoint-nav: "920px"    # 핸드오프 v2 기준(구 1041px에서 전환)

components:
  # ---- 셸 [구현됨] ----
  nav:            { status: 구현됨, ref: "globals.css; components/shell/Nav.tsx", note: "고정 68px, bg rgba(8,6,15,.6)+blur. 링크 6개(홈/IP 허브/굿즈샵/카드팩/팝업/커뮤니티), active=weight 600. 우측 장바구니는 /cart로 이동하고 실제 총수량 배지를 표시. /login·/update-password에서 숨김" }
  mobnav:         { status: 구현됨, ref: "globals.css; components/shell/MobNav.tsx", note: "<920px 바텀탭 5개(홈/굿즈샵/카드팩/커뮤니티/장바구니). 장바구니는 실제 총수량 배지를 표시" }
  footer:         { status: 구현됨, ref: "components/shell/SiteFooter.tsx", note: "미니 푸터(브랜드+공시 캡션) + 고아 라우트 방지 보조 링크 줄(바인더·교환·마켓·약관)" }
  atmos:          { status: 구현됨, ref: "globals.css:106-183; components/shell/Atmos.tsx", note: "라우트별 radial 블룸 변형. 기본=홈. grain 오버레이는 v2에서 제거" }
  # ---- 기본 어휘 [구현됨] ----
  btn:            { status: 구현됨, ref: "globals.css:217-233", note: "pill 고정. primary=white on ink, holo=애니 CTA(weight 700), ghost=hairline, sm=38px" }
  chip:           { status: 구현됨, ref: "globals.css:236-256", note: "필터 pill h36. .on=white .08 bg + border .35, .on.accent=IP색 bg+잉크 글자(inline). .chip-sm=mono h30(상태·모드·등급 보조 필터)" }
  card:           { status: 구현됨, ref: "globals.css:269-276", note: "surface→bg-2 그라데, hairline, .lift=hover -6px" }
  money-caption:  { status: 구현됨, ref: "globals.css:263-266", note: "가챠 확률공시·환불·정책 안내 문구. mono 10.5px faint. 확약형 문구 금지(미확정 정책은 비확약형으로)" }
  sheen:          { status: 구현됨, ref: "globals.css:311-314", note: "키아트 대각 광택 스윕" }
  foil:           { status: 구현됨, ref: "globals.css:317-322", note: "수집형 카드 color-dodge 홀로 오버레이 — 이식 불가 시그니처. 틸트 카드 glare가 동일 어휘" }
  motion-hooks:   { status: 구현됨, ref: "components/ui/motion.ts", note: "useHeroParallax(히어로 키아트), useTilt(3D 카드 틸트+glare). prefers-reduced-motion 존중" }
  # ---- 표면별 [구현됨] ----
  home-ticker:    { status: 구현됨, ref: "globals.css:348-356", note: "라이브 티커 마퀴(tickerMove 32s). 내용은 카탈로그 파생(이벤트·재고·포스트·팬 수)" }
  verb-row:       { status: 구현됨, ref: "globals.css:358-365", note: "홈 4동사(사요/모아요/만나요/떠들어요) 레일" }
  ip-pick:        { status: 구현됨, ref: "globals.css:366-367", note: "홈 히어로 IP 픽커(132×84 키아트 + FANS 카운트)" }
  ipworld:        { status: 구현됨, ref: "globals.css:388-408", note: "IP 허브 = 허브·상세 병합. WORLDS 스위처 + 12col bento(굿즈7/가챠5×2/팝업4/커뮤니티3/도감4/팬덤3/라인업5). 셀 hover accent는 --cell-accent" }
  shop:           { status: 구현됨, ref: "globals.css", note: "스티키 필터 바(WORLDS+정렬) + 4열 그리드(모바일 2열). 공유 장바구니 수량 표시·재고 한도 내 +1 담기" }
  cart:           { status: 구현됨, ref: "app/cart/page.tsx; components/screens/Cart.tsx; globals.css", note: "비로그인 localStorage·로그인 DB 병합 장바구니. 수량·합계·재고·품절·판매 종료 행을 표시하고 주문 가능한 카트는 /checkout으로 연결" }
  checkout:       { status: 구현됨, ref: "app/checkout/*; components/screens/Checkout.tsx; components/screens/CheckoutOrder.tsx; components/payments/*; globals.css", note: "배송지 폼+주문 요약 2열(모바일 1열), 15분 재고 선점 타이머, 토스 결제위젯·약관, 결제 확인 중/완료/만료 상태 표면. 주문 영수증 금액은 DB 스냅샷" }
  ticket-booking: { status: 구현됨, ref: "app/events/[eventId]/*; app/ticket-checkout/*; components/screens/EventDetail.tsx; components/screens/TicketCheckout.tsx; components/payments/*; globals.css", note: "공개 이벤트 상세+회차/잔여/수량 선택, 10분 정원 선점, 토스 티켓 결제, 웹훅 확인 중/완료/종료 상태와 DB 기반 예매 영수증" }
  my-tickets:     { status: 구현됨, ref: "app/tickets/*; components/screens/Tickets.tsx; components/screens/TicketDetail.tsx; components/tickets/*; globals.css", note: "본인 예매를 사용 가능/진행 중/지난 티켓으로 묶고, 한 장씩 여는 보호 QR·티켓 상태·예매 영수증·이벤트 시작 전 미사용 전체 취소/전액 환불 상태를 표시" }
  orders:         { status: 구현됨, ref: "app/orders/*; components/screens/Orders.tsx; components/screens/OrderDetail.tsx; components/orders/*; globals.css", note: "본인 주문 최신순 원장 + 상태·불변 굿즈 스냅샷·배송지·안전 결제/환불 요약·실제 카드팩 발급 상세·배송 전 청약철회 요청 상태. 데스크톱 영수증 2열, 모바일 1열" }
  admin-orders:   { status: 구현됨, ref: "app/admin/*; components/admin/sections/Orders.tsx; globals.css", note: "staff 전용 DB-side 주문/구매자/상태/기간 검색 + 20건 master-detail + paid→shipping→done + 청약철회 승인·거절·재정합화. provider 식별자·raw 미노출" }
  admin-ticket:   { status: 구현됨, ref: "app/admin/*; components/admin/sections/TicketSection.tsx; globals.css", note: "staff 전용 회차 master-detail. 이벤트·회차명·가격·정원 편집, pending 선점 포함 sold/잔여·정원 상태 표시, 예매 이력 이후 메타데이터 잠금" }
  admin-card-pool: { status: 구현됨, ref: "app/admin/*; components/admin/sections/CardPoolSection.tsx; components/admin/sections/CardSection.tsx", note: "staff 전용 카드풀 master-detail. KST 운영 기간, 5등급 퍼센트 합계 100%, 확률 미설정 상태, 소속 카드·같은 IP 바인딩, 미사용 카드팩에 최신 구성·확률이 즉시 적용된다는 경고" }
  admin-reward-policy: { status: 구현됨, ref: "app/admin/*; components/admin/sections/*", note: "staff 전용 뽑기권 발급 정책 master-detail. 주문 대상 IP·선택 same-IP 굿즈, 독립 보상 카드풀, 최소 금액·발급 수량·KST 운영 기간·활성 상태와 누적 발급/사용 가능/개봉/회수 집계를 표시" }
  admin-game:      { status: 구현됨, ref: "app/admin/*; components/admin/sections/GameSection.tsx", note: "staff 전용 참여형 게임 master-detail. 카드 보상형 게임의 slug·제목·준비된 카드풀·같은 IP 온라인 이벤트·KST 운영 기간·일일 한도를 관리하고, 신규 시작은 빈 값으로 두며 플레이 이후 불변 필드 잠금·현재 시각이 운영 창에 포함되는 게임의 DB 시각 종료·PII-free 플레이 집계를 제공. goods variant는 #115 전까지 읽기 전용" }
  ticket-check-in: { status: 구현됨, ref: "app/admin/check-in/*; app/api/admin/check-in/*; components/admin/check-in/*; globals.css", note: "staff 전용 모바일 현장 검표. 카메라 QR·HID/수동 입력, 검표/재검표/환불 상태, same-origin service-only 원장·감사" }
  gacha:          { status: 구현됨, ref: "globals.css:442-453", note: "카드풀 스위처 + 확률 칩 + 천장 게이지 + 클라이언트 리빌(popIn). mock 공시 — 실 카드풀은 ADR-0001" }
  event:          { status: 구현됨, ref: "app/events/*; components/screens/Events.tsx; components/screens/EventDetail.tsx; globals.css", note: "목록 featured 2열+카드 그리드에서 공개 상세로 연결. 상세는 포스터 히어로와 회차 선택/예매 요약 2열, 모바일 1열" }
  binder:         { status: 구현됨, ref: "globals.css:464-468", note: "도감 그리드(미보유 잠금·dim은 mock 모드만) + 카드 상세 모달 + CTA 행" }
  community:      { status: 구현됨, ref: "globals.css:471-481", note: "230/1fr/280 3열(모바일 1열+채널 가로 스크롤). 컴팩트 컴포저 + 좋아요 pill + 랭킹 레일(실데이터 파생)" }
  search:         { status: 구현됨, ref: "globals.css:484-490", note: "통합 검색 히어로(60px pill 입력) + 스코프 칩 + 종류별 결과(IP pill/굿즈 카드/카드 타일/행)" }
  login:          { status: 구현됨, ref: "globals.css; components/screens/Login.tsx; components/screens/UpdatePassword.tsx", note: "스플릿 브랜드 패널에서 로그인·회원가입·비밀번호 재설정 메일 요청을 제공. /update-password는 새 비밀번호 2필드의 중앙 카드이며 두 라우트 모두 전역 셸을 숨김. 소셜 3종은 시각만(미배선)" }
  settings:       { status: 구현됨, ref: "app/settings/*; components/screens/Settings.tsx; lib/profile-upload.client.ts", note: "서로 독립된 프로필·약관 form. 브라우저는 private user-uploads signed token으로 JPEG/PNG/WebP를 직접 업로드하고, 서버가 metadata·magic bytes 검증 뒤 잠금 RPC로 확정. 원형 signed image가 없으면 서버 계산 닉네임 첫 글자(I fallback)를 표시" }
  market-exchange:{ status: 구현됨, ref: "globals.css:497-503", note: "v2 플레이스홀더 — 검수·에스크로 카피, mock 매물. 보호 액션은 로그인 게이트" }
  # ---- [차용·미구현] ----
  tier-card:      { status: 차용·미구현, note: "충전금 tier(충전 화면 미존재). featured 변형은 violet 반전 강조" }
  input-lg:       { status: 차용·미구현, note: "결제/충전 입력 ≥52px, violet focus 링 — 로그인 입력(50px)이 근사 구현" }
---

# ICONS — Holographic Midnight v2

> K-pop / IP 팬덤을 위한 수집형 카드 · 굿즈 · 가챠 · 예매 · 커뮤니티 플랫폼의 디자인 시스템.
> 이 문서는 에이전트가 코드를 만들 때 읽는 기계 판독용 스펙이다. 용어는 `CONTEXT.md`를 따른다.

## 1. Overview / 정체성

**Holographic Midnight**은 자정에 가까운 다크 캔버스 위에서 홀로그래픽 스펙트럼이 빛나는 시스템이다. 정서적 핵심은 **팬덤 하이프와 수집**이다. `{gradients-effects.holo}`, `{gradients-effects.foil}`, `{gradients-effects.atmos}`는 이 하이프를 만드는 엔진이며, **외부 어느 디자인 시스템에서도 이식할 수 없는 ICONS-오리지널 자산이다.**

v2부터 화면 구조·카피·모바일 규율의 **시각 진실원은 Claude Design 핸드오프**(`design/handoff/claude-design/*.dc.html`, 로컬 참조용·gitignored)다. 핸드오프는 페이지별 프로토타입이므로 **페이지 간 미세 불일치는 공통 토큰·클래스로 정규화**해 이식하고, 코드가 최종 진실이다.

### 3원칙
- **공개 브라우징.** IP·굿즈·카드·이벤트·커뮤니티 읽기는 기본 공개. 로그인은 구매·가챠·예매·작성·팔로우 시점에만 요구(미배선 CTA도 로그인 게이트로 보냄). `[구현됨]`
- **다크 몰입 단일 캔버스.** 결제·충전조차 캔버스를 밝게 뒤집지 않는다. `[구현됨]`
- **하이프와 신뢰의 고도 분리.** 몰입 히어로(하이프)와 공시·정책 문구(신뢰, `money-caption`)는 톤·밀도가 다르다. 미확정 정책은 확약하지 않는다. `[구현됨]`

## 2. Colors `[구현됨]`

토큰 진실원 `app/globals.css:9-33`(§frontmatter 표 참조). 추가된 색 계층:

- **IP 액센트** — IP별 표시색·영문명은 `lib/ip-display.ts`가 진실원. 카드·칩·라벨에서 IP를 가리킬 때 사용하고, 미등재 IP는 vertical 색으로 fallback.
- **Rarity 색** — `lib/rarity.ts RARITY_META`가 단일 진실원. 핸드오프가 페이지마다 다른 rarity 색을 쓰지만 코드에서는 META로 통일했다. HOLO 배지만 holo 그라데 + 잉크 글자 특례.
- 스펙트럼은 홀로 그라데로 뭉쳐 쓸 때 가장 강하다. 상태색 관습: mint=성공/LIVE·진행중, cyan=예매중, pink=알림/좋아요, violet=활성.

## 3. Typography `[구현됨]`

3-패밀리 역할 분담(진실원 `app/globals.css:41-44`). 디스플레이는 Space Grotesk, 본문은 Pretendard, 숫자·가격·확률·카운트·메타는 Space Mono.

- 페이지 헤더 표준은 `.h-xl`(clamp 36→64px, ls -.04em) — 핸드오프 v2의 지배적 스케일.
- 아이브로(`.eyebrow`)는 mono 12px + 22px 대시. 기본 violet-2, 표면별 색 override가 관습(팝업 mint · 굿즈 amber · 커뮤니티 pink · 교환 cyan).

## 4. Spacing · Layout · Grid `[구현됨]`

- 컨테이너 `{layout.maxw}` 1240px, `.wrap` 좌우 24px.
- 내비 높이 68px. **내비 전환 브레이크포인트 920px**(`--breakpoint-nav`, 코드 미디어쿼리 919/920).
- 페이지 헤더 오프셋은 `clamp(108px, 12vw, 140px)` 상단 패딩(고정 nav가 겹침), 섹션 패딩은 표면별 clamp.
- 표면별 그리드: `.ipworld-bento`(12col), `.shop-grid`(4col), `.event-grid`(auto-fill 300px), `.binder-grid`(auto-fill 180px), `.community-main`(230/1fr/280) 등 — frontmatter components 참조.

## 5. Shapes / Radius `[구현됨]`

`{rounded.*}` 스케일 유지. **버튼·칩은 항상 pill.** 카드 계열은 표면별로 16–26px(featured 26, 그리드 카드 18–22, 썸네일 10–14).

## 6. Elevation & Depth — 시그니처 `[구현됨]`

깊이는 그림자만이 아니라 **빛(글로우·foil·sheen·atmos)**으로 만든다.

| 효과 | 근거 | 용도 |
|---|---|---|
| `{gradients-effects.shadow}` / `glow-v` | `globals.css:84-85` | 카드 드롭 섀도 / holo CTA hover |
| `{gradients-effects.holo}` | `globals.css:82` | 브랜드 dot·`.holo-text`·`.btn-holo`·바텀탭 active dot·HOLO 배지 |
| `.sheen` | `globals.css:311-314` | 키아트 광택 스윕 |
| `.foil` + 틸트 glare | `globals.css:317-322`, `components/ui/motion.ts` | 수집형 카드 홀로 오버레이(이식 불가) |
| `.bg-atmos--*` | `globals.css:106-183` | 라우트별 radial 블룸(§frontmatter atmos). grain은 v2에서 제거 |

## 7. Components

frontmatter `components` 블록이 정본 인덱스다(셸 → 기본 어휘 → 표면별). 소비처는 `components/screens/*.tsx`(라우트 매핑은 `lib/routes.ts`).

모션 키프레임: `holoShift`(그라데 스윕) · `tickerMove`(마퀴) · `floatY`(카드 부유) · `popIn`(가챠 리빌) · `pulseDot`(LIVE 상태) · `rise`(진입, opacity 미사용 — 캡처 환경 규율). `globals.css:505-518`

## 8. 표면별 플레이북 ⭐

| 표면 | 라우트 | 구조 요약 | 데이터 |
|---|---|---|---|
| 홈 | `/` | 100svh 히어로(IP 픽커+패럴랙스 키아트) → 라이브 티커 → 4동사 레일 → 가챠 티저(틸트 HOLO 카드) → 조인/신뢰 | 카탈로그 + 포스트 프리뷰 파생 |
| IP 허브 | `/ip`, `/ip/[id]` | 시네마틱 히어로 + WORLDS 스위처(Link 내비) + bento. 허브=상세 병합, `/ip/[id]`가 정식 URL | `getCatalogIpDetail` + 팔로우 상태 |
| 굿즈샵 | `/shop` | 최애의 물건들 헤더 + 스티키 WORLDS/정렬 바 + 4열 그리드 | 카탈로그, 공유 장바구니 수량·재고 한도 내 +1 담기 |
| 장바구니 | `/cart` | 굿즈 행·수량 제어 + 재고 상태 + 주문 요약 | 비로그인 localStorage, 로그인 `cart_items` |
| 체크아웃 | `/checkout`, `/checkout/[orderId]`, `/checkout/success`, `/checkout/fail` | 배송지·주문 생성 → 결제위젯 → 승인·웹훅 확인 상태 | `place_order`, `orders`/`order_items`/`payments`, 토스페이먼츠 |
| 티켓 예매 | `/events/[eventId]`, `/ticket-checkout/[ticketOrderId]`, `/ticket-checkout/success`, `/ticket-checkout/fail` | 공개 회차·잔여 확인 → 수량 선택 → 10분 선점 → 결제위젯 → 웹훅 확정 상태 | 멱등 `reserve_tickets`, `ticket_orders`/`tickets`/`payments`, 토스페이먼츠 |
| 내 티켓 | `/tickets`, `/tickets/[ticketOrderId]` | 상태별 예매 목록 → 한 장씩 보호 QR·티켓 상태·예매 영수증 → 시작 전 전체 취소/환불 | 본인 안전 컬럼 + no-store QR Route + durable `ticket_cancellation_requests`/정합화 RPC |
| 현장 검표 | `/admin/check-in` | 모바일 카메라 QR 또는 HID·수동 코드 → 검표/재검표/환불 상태 표시 | staff-gated same-origin API + service-only 멱등 `check_in_ticket` + `check_ins`/`audit_log` |
| 주문 내역 | `/orders`, `/orders/[orderId]` | 최신 주문 원장 → 상태·굿즈·배송지·결제·카드팩 상세 영수증 → 배송 전 청약철회 요청/환불 상태 | 본인 `orders`/스냅샷 `order_items`/안전 결제·환불·요청 컬럼/실제 `draw_tickets` + 취소 API |
| 관리자 주문 | `/admin?section=orders` | DB-side 필터 → 20건 master-detail → 배송 전이·청약철회 승인/거절/재정합화 | staff-gated `admin_search_orders` + audited mutation RPC + 서버 전용 Toss 정합화 |
| 관리자 실재고 | `/admin?section=good` | 굿즈 master-detail → 현재 수량·운영/유효 상태 → 델타·사유 조정 | staff-gated, 멱등 `admin_adjust_stock` + `audit_log` |
| 관리자 티켓 회차 | `/admin?section=ticket` | 회차 master-detail → 이벤트·이름·가격·정원 편집 → 할당·잔여·정원 상태 | staff-gated, 멱등 `admin_upsert_ticket_type` + `audit_log` |
| 관리자 카드풀 | `/admin?section=pool` | 풀 master-detail → KST 운영 기간·5등급 확률 합계·미설정 상태·소속 카드·바인딩 관리 → 최신 확률 즉시 적용 경고 | staff-gated, 멱등 `admin_upsert_card_pool`/`admin_set_pool_odds` + `audit_log` |
| 관리자 발급 정책 | `/admin?section=policy` | 정책 master-detail → 대상 IP·선택 same-IP 굿즈·독립 카드풀·최소 금액·발급 수량·KST 기간·활성 상태 편집 → 누적 발급/사용 가능/개봉/회수 집계 | staff-gated, PII-free `admin_list_reward_policies` + 멱등 `admin_upsert_reward_policy` + `audit_log` |
| 관리자 참여형 게임 | `/admin?section=game` | 게임 master-detail → 카드풀·같은 IP 온라인 이벤트·KST 운영 기간·일일 한도 편집 → 플레이 이후 잠금·현재 시각이 운영 창에 포함되는 게임의 DB 시각 종료·플레이 집계 | staff-gated, PII-free `admin_list_games` + 멱등 `admin_upsert_game` + `audit_log`; goods variant는 읽기 전용 |
| 뽑기 | `/gacha` | 카드풀 스위처 + 확률 칩 + 천장 게이지 + 클라이언트 리빌 + 라인업 | 카탈로그(카드 있는 IP), mock 공시 |
| 팝업 | `/events`, `/events/[eventId]` | 필터 칩 → featured/카드 목록 → 공개 상세·회차 선택 → QR 가이드 | `selectFandomEvents`, 공개 `ticket_types` |
| 커뮤니티 | `/community` | 채널 레일 + 컴팩트 컴포저 + 피드 + 랭킹·카드풀 레일 | 실배선(작성·좋아요·댓글·신고·차단) |
| 바인더 | `/binder` | holo 스탯 + 달성률 + 도감 그리드 + 상세 모달 | 보유 개념은 mock 모드만(가챠 연동 전) |
| 검색 | `/search` | 통합 검색 히어로 + 스코프 칩 + 종류별 결과 | Postgres `getSearchSnapshot` |
| 로그인/온보딩/비밀번호 재설정 | `/login`, `/update-password`, `/onboarding` | 로그인 스플릿·새 비밀번호 중앙 카드·프로필/약관/최애 픽 타일 | Supabase Auth recovery·인증·온보딩 액션 |
| 설정 | `/settings` | 독립된 프로필·약관 form + 원형 signed-image 아바타(서버 계산 닉네임 첫 글자, `I` fallback) | private `user-uploads` browser direct upload → 서버 metadata·magic 검증 → service-role-only 잠금 identity RPC; 마케팅 동의는 별도 저장 |
| 마켓/교환 | `/market`, `/exchange` | v2 플레이스홀더(검수·에스크로 카피, mock 매물) | mock, 보호 액션은 로그인 게이트 |

**신뢰 표면 규율:** 확률 공시·환불(`ADR-0001` 근거)은 `money-caption`으로 또렷하게 유지한다. 반대로 **미확정 정책(취소 시한·양도·수수료·연령 한도)과 미정의 화폐(퍼즐·스타더스트 류)는 UI에 확약하지 않는다** — 비확약 안내문으로 대체.

## 9. Do's & Don'ts

### Do
- 다크 단일 캔버스 유지. 하이프/신뢰 고도 구분.
- 스펙트럼은 홀로 그라데로 뭉쳐 강조 지점에만. IP 색은 `ip-display`, rarity 색은 `RARITY_META`에서.
- 버튼·칩은 pill. 숫자·가격·확률·카운트는 mono.
- 반응형은 CSS 미디어쿼리(919/920)로 — 핸드오프의 JS isMobile 분기를 그대로 옮기지 말 것(SSR 하이드레이션).
- 빈 상태(카탈로그·필터·검색)를 항상 처리한다.

### Don't
- 결제·충전·가격 화면을 밝은 캔버스로 뒤집지 않는다.
- 스펙트럼으로 넓은 면을 칠하거나 본문 텍스트 색으로 쓰지 않는다.
- `foil`/glare를 수집형 카드 밖에 남발하지 않는다.
- 미확정 정책·미정의 화폐를 UI 카피로 발명하지 않는다(§8 신뢰 표면 규율).
- 카드(수집형 디지털)와 굿즈(실물), 교환(카드 C2C)과 마켓(굿즈 C2C)을 시각적으로 혼용하지 않는다(`CONTEXT.md`).

## 10. Responsive / 모바일 `[구현됨]`

- **<920px**: 상단 `.nav-links` 숨김, 하단 `.mobnav`(5탭, 장바구니 실수량 배지) 전환. safe-area inset 대응.
- 표면 그리드는 919px에서 1–2열로 붕괴(§frontmatter components의 각 그리드 참조), 620px 이하 보조 규칙. `globals.css:640-`
- 핸드오프의 모바일 정의(920 분기·바텀탭·1열)는 유지하고, 실장바구니 진입을 위해 탭을 5개로 구성.
- 모션은 `prefers-reduced-motion` 존중(티커·플로트·holo 애니 정지). 진입 애니메이션은 opacity를 쓰지 않는다(캡처 환경 규율).

## 11. Iteration Guide

1. 한 번에 한 컴포넌트/표면만 다룬다. 시각 근거는 핸드오프 파일에서 찾고, 값은 토큰·클래스로 정규화한다.
2. 토큰·컴포넌트를 `{colors.violet}`, `{rounded.pill}`, `ipworld-bento`처럼 이름으로 참조한다.
3. `[차용·미구현]`을 구현하면 상태를 `[구현됨]`으로 바꾸고 근거를 단다.
4. 버튼 변형은 모양(pill)이 아니라 채움/테두리/캔버스로만 달라진다.
5. 토큰 값 자체는 `app/globals.css`의 `@theme`에서 바꾸고, 이 문서는 그 뒤 동기화한다(코드가 진실).
