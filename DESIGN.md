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
  nav:            { status: 구현됨, ref: "globals.css:279-305; components/shell/Nav.tsx", note: "고정 68px, bg rgba(8,6,15,.6)+blur. 링크 6개(홈/IP 허브/굿즈샵/뽑기/팝업/커뮤니티), active=weight 600. 우측 검색·장바구니 아이콘 + 로그인(ghost)/시작하기(holo). /login에서 숨김" }
  mobnav:         { status: 구현됨, ref: "globals.css:520-538; components/shell/MobNav.tsx", note: "<920px 바텀탭 4개(홈/굿즈샵/뽑기/커뮤니티). 아이콘 없이 5px dot 인디케이터 + 라벨, active=holo dot" }
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
  shop:           { status: 구현됨, ref: "globals.css:411-440", note: "스티키 필터 바(WORLDS+정렬) + 4열 그리드(모바일 2열). 담기↔담김 토글" }
  gacha:          { status: 구현됨, ref: "globals.css:442-453", note: "카드풀 스위처 + 확률 칩 + 천장 게이지 + 클라이언트 리빌(popIn). mock 공시 — 실 카드풀은 ADR-0001" }
  event:          { status: 구현됨, ref: "globals.css:456-461", note: "featured 2열(1.05/.95) + 16:9 카드 그리드 + QR 가이드 3단계. 상태별 CTA(현장 정보/티켓 예매/오픈 알림 신청)" }
  binder:         { status: 구현됨, ref: "globals.css:464-468", note: "도감 그리드(미보유 잠금·dim은 mock 모드만) + 카드 상세 모달 + CTA 행" }
  community:      { status: 구현됨, ref: "globals.css:471-481", note: "230/1fr/280 3열(모바일 1열+채널 가로 스크롤). 컴팩트 컴포저 + 좋아요 pill + 랭킹 레일(실데이터 파생)" }
  search:         { status: 구현됨, ref: "globals.css:484-490", note: "통합 검색 히어로(60px pill 입력) + 스코프 칩 + 종류별 결과(IP pill/굿즈 카드/카드 타일/행)" }
  login:          { status: 구현됨, ref: "globals.css:493-494; Login.tsx", note: "스플릿(브랜드 패널+플로팅 카드 | 폼). 소셜 3종은 시각만(미배선). 셸 숨김" }
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
| 굿즈샵 | `/shop` | 최애의 물건들 헤더 + 스티키 WORLDS/정렬 바 + 4열 그리드 | 카탈로그, 담기 토글 |
| 뽑기 | `/gacha` | 카드풀 스위처 + 확률 칩 + 천장 게이지 + 클라이언트 리빌 + 라인업 | 카탈로그(카드 있는 IP), mock 공시 |
| 팝업 | `/events` | 필터 칩 → featured 2열 → 카드 그리드(상태별 CTA) → QR 가이드 | `selectFandomEvents` |
| 커뮤니티 | `/community` | 채널 레일 + 컴팩트 컴포저 + 피드 + 랭킹·카드풀 레일 | 실배선(작성·좋아요·댓글·신고·차단) |
| 바인더 | `/binder` | holo 스탯 + 달성률 + 도감 그리드 + 상세 모달 | 보유 개념은 mock 모드만(가챠 연동 전) |
| 검색 | `/search` | 통합 검색 히어로 + 스코프 칩 + 종류별 결과 | Postgres `getSearchSnapshot` |
| 로그인/온보딩 | `/login`, `/onboarding` | 스플릿 브랜드 패널 / 프로필+약관+최애 픽 타일 | Supabase 인증·온보딩 액션 |
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

- **<920px**: 상단 `.nav-links` 숨김, 하단 `.mobnav`(4탭 dot 바텀탭) 전환. safe-area inset 대응. `globals.css:520-538`
- 표면 그리드는 919px에서 1–2열로 붕괴(§frontmatter components의 각 그리드 참조), 620px 이하 보조 규칙. `globals.css:640-`
- 핸드오프의 모바일 정의(920 분기·바텀탭·1열)는 유지하되, 페이지별로 달랐던 바텀탭 구성은 다수결(홈/굿즈샵/뽑기/커뮤니티)로 고정.
- 모션은 `prefers-reduced-motion` 존중(티커·플로트·holo 애니 정지). 진입 애니메이션은 opacity를 쓰지 않는다(캡처 환경 규율).

## 11. Iteration Guide

1. 한 번에 한 컴포넌트/표면만 다룬다. 시각 근거는 핸드오프 파일에서 찾고, 값은 토큰·클래스로 정규화한다.
2. 토큰·컴포넌트를 `{colors.violet}`, `{rounded.pill}`, `ipworld-bento`처럼 이름으로 참조한다.
3. `[차용·미구현]`을 구현하면 상태를 `[구현됨]`으로 바꾸고 근거를 단다.
4. 버튼 변형은 모양(pill)이 아니라 채움/테두리/캔버스로만 달라진다.
5. 토큰 값 자체는 `app/globals.css`의 `@theme`에서 바꾸고, 이 문서는 그 뒤 동기화한다(코드가 진실).
