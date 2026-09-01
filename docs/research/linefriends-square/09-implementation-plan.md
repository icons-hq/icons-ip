# linefriends-square 재현 스펙 — 09. 구현 계획

> [ADR-0011](../../adr/0011-lfs-storefront-redesign.md)의 실행 계획. 디자인 정본은 루트 `DESIGN.md`(White Catalog v4), 표면 수치는 R-스펙 00~08. 이 계획의 승인이 구현 착수 계약이다.

## 0. 전제와 게이트

- **통합 브랜치** `ps/feat/lfs-storefront-redesign`에 스테이지 PR을 쌓는다(각 PR의 base=통합 브랜치). main으로는 완성 시 **일괄 전환 PR 1개**만 낸다.
- preview 검수: 통합 브랜치 → main **draft PR을 1개 상시 유지**해 Vercel preview를 살려두고, 스테이지 머지마다 같은 링크로 확인한다(스키마 변경은 preview Supabase에 선적용되는 기존 파이프라인 사용, ADR-0006).
- **첫 판매 전 전환 완료가 목표**(사용자 확정). main의 첫 판매 게이트 작업(#315~#318)과 병행하며, 충돌 시 통합 브랜치가 rebase를 흡수한다.
- 어드민 화면 리디자인은 범위 외. 단, 신규 기능의 **운영 폼(큐레이션 kind·쿠폰·캠페인·Q&A 답변 등)은 기존 어드민 시스템 스타일로 최소 추가**한다(스타일 개편 아님).
- 돈·재고·발급 경계는 `DESIGN.md` §11 동결 목록을 따른다. 쿠폰(S7)만 서버 주문 생성 RPC에서 금액에 개입한다.

## 1. 스테이지 구조 (= PR 단위 = 티켓 단위)

| 스테이지 | 범위 | 주요 파일·작업 | 크기 |
|---|---|---|---|
| **S0 문서** ✅ | 용어·ADR·R-스펙·DESIGN v4 | 완료 (`d678eaf`·`a161f30`·`7f486cb`) | — |
| **S1 파운데이션** | 토큰·프리미티브·계약 테스트 | `app/styles/wc-foundation.css`(§2~5 토큰), 공유 컴포넌트 신설 `components/wc/`(ProductCard·PriceBlock·Badge·SectionHeading·Slider(native scroll-snap)·TabPanels·ViewMore·WcButton·QuantityStepper·EmptyState), `lib/routes.ts` NAV 단일화(신 GNB 7항목+모바일 5탭+유틸), `app/wc-design.test.ts` 신설, `not-found`/`error`/`loading` 기본 표면 | M |
| **S2 전역 셸** | 크롬 한 벌 통일 | `Nav.tsx`·`SiteFooter.tsx` 재작성(notice-strip·triple-header·underline-gnb·mega-menu·search-overlay·mobile-tab-gnb·bottom-tab-bar·category-sheet), `wc-chrome.css`, 푸터에 오프라인 팝업·`/about`·법적 링크. 홈 우회 조건(`Nav.tsx:36`)은 S3에서 제거 | M |
| **S3 홈 + 어바웃** | 새 홈·회사 소개 | migration① `home_curations` kind 확장(notice_strip·editor_pick·band_banner·best_tab·benefit), 새 `components/screens/Home.tsx`(밴드 8, `wc-home.css`), 구 홈 콘텐츠 → `app/about/page.tsx`+`components/screens/AboutLegacy.tsx`(+`about-legacy.css`, 자체 헤더/푸터 제거), 어드민 큐레이션 폼에 신규 kind 최소 지원 | L |
| **S4 커머스 코어** | 샵·PDP·검색·카트·위시·재입고 | migration② `goods` 확장(`compare_at_price`·배지 정규화·`type` 값 표준화), migration③ `wishlists`, migration④ `restock_alerts`(+재고 갱신 훅 발송: 기존 알림함·메일 경로), `/shop` 컬렉션(filter-sidebar·정렬·view-more), `/shop/[goodId]` PDP 전면(갤러리·buybox·2CTA·바로구매(기존 주문 경로)·restock-cta·panel-tabs·리뷰 문법 이식), `/search`+오버레이, `/cart` 미니 체크아웃(쿠폰 슬롯 자리만), NEW/BEST 큐레이션 컬렉션, `wc-catalog.css` | XL |
| **S5 발견·수집** | 온라인 팝업·카드·게임·커뮤니티 | `/ip` A–Z 디렉토리, `/ip/[id]` 개별 관(풀블리드 배너+팔로우), `/packs`·`/binder` 재조판(카드 foil 유지), `/games` 크롬 정합, `/community` content-card 재조판, `/market`·`/exchange` 플레이스홀더 재조판 | L |
| **S6 계정·거래** | 인증·마이·주문·티켓 크롬 | `/login`·`/update-password`·`/onboarding`·`/account-suspended`(flat-auth-form), `/my` 셸(mypage-shell)+알림·문의·리뷰·설정, `/orders`·`/checkout*`·`/tickets`·`/ticket-checkout*` 크롬 교체(결제·예매 계약 동결, 콜백 fail 표면 포함), `wc-account-commerce.css` | L |
| **S7 쿠폰·등급** (T-B) | 금액 개입 유일 지점 | migration⑤ 쿠폰(정의·발급·사용 원장, 조건·만료), **주문 생성 RPC 할인 통합**(서버 확정·멱등, `PaymentGateway` 불변)+회귀 테스트, 카트 쿠폰 select·마이 쿠폰함(coupon-ticket-card), migration⑥ 회원 등급(구매 실적 산정·등급 혜택 발급·프로필 스트립 뱃지), 어드민 최소 운영 폼 | XL |
| **S8 캠페인·코인·Q&A** (T-B) | 이벤트 재정의·참여 재화 | migration⑦ `campaigns`(EVENT/DROP·기간·랜딩 구성), `/events` 캠페인 허브로 재정의+캠페인 상세, **오프라인 팝업 이사**(`/offline-popups`+`[eventId]`, 기존 `/events/[eventId]` 캠페인 우선 조회 후 레거시 id 리다이렉트, 푸터 진입), migration⑧ 코인·출석(원장+체크인+**코인→뽑기권 교환 RPC**, 기존 발급 경로 재사용), migration⑨ `product_questions`(공개 Q&A)+PDP 탭+어드민 답변 폼, `wc-campaign.css` | XL |
| **S9 정리·전환** | 레거시 제거·QA·일괄 전환 | `globals.css` HM 토큰 제거(게임 스타일은 분리 추출), `editorial-shell/home/public/account-commerce.css` 제거(`editorial-foundation`은 어드민 의존 범위 확인 후 어드민 전용으로 축소), dead code(`MobNav`·`Atmos`)·dead CSS 제거, 테스트 재작성 마감, `docs/ARCHITECTURE.md`·`docs/PRD.md` 반영, DESIGN.md status→implemented, 전체 QA(§3) 후 **통합 PR → main** | L |

의존성: S1→S2→S3, S4~S6은 S2 이후 병렬 가능(파일 소유권 분리), S7은 S4 이후, S8은 S3(큐레이션)·S4 이후, S9는 전체 후.

**S9 수행 결과(2026-09-01)**: 구 시스템의 공개 표면 CSS 3파일(`editorial-shell`·`editorial-public`·`editorial-account-commerce`, 5,310줄)을 삭제하고 `globals.css`를 2,255→791줄로 줄여 **전역 하부(Tailwind·Pretendard·element 리셋)+어드민 잔존 어휘 전용**으로 계약을 좁혔다. 계획의 "HM 토큰 제거"는 전량 제거가 아니라 이 범위 축소로 착지했다 — 어드민이 아직 그 어휘를 쓴다(`editorial-foundation`도 컨슈머 0 규칙만 제거해 437→416줄로 잔존). dead 셸 5종(`MobNav`·`Atmos`·`AuthButton`·`NotificationBell`·`useHeaderScrollHide`)과 `lib/data.ts`의 mock 매물을 제거했다. **WC 재조판이 남은 공개 표면 3곳은 전용 격리 CSS로 자립**시켰다 — `/offline-popups`·`/offline-popups/[eventId]` → `offline-popups-legacy.css`, `/legal/*` → `legal-doc.css`, `/about` → 기존 `about-legacy.css`(재조판은 후속 작업). **`wc-foundation`의 전역 승격은 실측 후 보류** — body 밑색 `#f4f4f1`을 offline-popups가 그대로 쓰고 있어 승격이 시각을 바꾼다. 계약 테스트는 `wc-design.test.ts`(WC 계약)와 잔존 범위 기준으로 재작성한 `editorial-design.test.ts`(삭제 파일 재임포트 금지·wc CSS의 HM hex와 `--editorial-*` 참조 금지·globals 어드민 한정)로 나눴다. 문서는 `DESIGN.md`(status=implemented)·`AGENTS.md`·`docs/ARCHITECTURE.md`·`docs/PRD.md`에 반영했고, 남은 단계는 main 일괄 전환뿐이다.

## 2. DB 마이그레이션 목록 (9건)

| # | 대상 | 요지 | 원칙 |
|---|---|---|---|
| ① | `home_curations` | kind 확장 + 밴드 슬롯 필드 | 카탈로그성 — 공개 읽기·staff 쓰기 |
| ② | `goods` | `compare_at_price`(할인 표기), 배지·type 값 표준화 | 가격 표시는 서버 스냅샷 유지 |
| ③ | `wishlists` | user×good 유니크, RLS 본인 격리 | |
| ④ | `restock_alerts` | 신청·발송 상태, 재고 갱신 연동 | 발송은 기존 알림함·메일 producer 재사용 |
| ⑤ | 쿠폰 3테이블 | 정의/발급·보유/사용 원장 | **주문 생성 RPC에서만 차감·검증**(멱등·행 잠금), 감사 가능 |
| ⑥ | 회원 등급 | 실적 산정(뷰 또는 잡)·혜택 발급 이력 | 결제 무관, 등급은 파생 데이터 |
| ⑦ | `campaigns` | 유형·기간·랜딩 구성·상태 | 공개 읽기·staff 쓰기 |
| ⑧ | 코인·출석 | 코인 원장·출석 체크·뽑기권 교환 RPC | append-only 원장, 교환은 기존 뽑기권 발급 경로 호출, '가챠' 어휘 금지 |
| ⑨ | `product_questions` | 공개 질문·운영 답변 | 작성자 RLS + 공개 읽기, 모더레이션 가능 |

전 함수 공통: 생성 후 `revoke all from public, anon, authenticated, service_role` 봉인 → 필요한 롤에만 grant. 로컬 적용 검증 + SQL smoke(`npx supabase@2.101.0` — CI 미러) 필수.

## 3. 검증 전략

- 스테이지마다: `npm run lint` + `npm run build` + 관련 테스트 통과, migration 있으면 로컬 DB 적용+SQL smoke.
- 클래스명 단언 컴포넌트 테스트는 **표면을 이행하는 스테이지에서 함께 재작성**한다(행동 단언 유지, 시각 단언은 wc 기준으로). CSS 계약은 S1의 `wc-design.test.ts`가 승계(임포트 순서·토큰 hex·reduced-motion·focus ring).
- 행동 QA는 **prod 빌드로** 수행한다(이 저장소 `next dev`는 Playwright 하이드레이션 불가 이력).
- preview 검수 절차: 스테이지 머지 → draft PR preview에서 데스크톱 1440·모바일 375 스모크(홈·샵·PDP·카트·로그인 벽·마이) → 스크린샷을 R-스펙과 대조.
- S9 최종: 전체 `npm run test`, 카탈로그 실데이터 스모크, 체크아웃·예매 경로 회귀(결제 계약 테스트), 접근성 스팟 체크(키보드·대비·focus).

## 4. 승인과 함께 확정할 항목 (기본값 제안)

1. **모바일 하단 5탭 바 채택** — 초기 훑기와 달리 LFS에 실존(R-스펙 01). 카피 원칙대로 채택: 메뉴·굿즈샵·홈·위시·마이. *(미채택 시 S2에서 제외만 하면 됨)*
2. **오프라인 팝업 신규 경로 = `/offline-popups`** (레거시 `/events/[id]`는 캠페인 우선 조회 후 리다이렉트).
3. **본인인증 가입·SNS 로그인 확장은 T-C**(외부 계약) — 현행 인증 유지.
4. 상품 이미지 **3:4 통일**, **할인율·뱃지 색 green 단일**(DESIGN v4 반영됨).
5. **카테고리 축 = `goods.type` 값 표준화**(신규 분류 테이블 없이 시작, 어드민에서 관리).
6. **캐러셀은 native scroll-snap 자체 구현**(Swiper 의존성 미도입 — 기존 관례 유지).
7. 코인 소진처 1차 범위 = **뽑기권 교환**(캠페인 랜딩 내). 실물 경품 코인 가챠는 범위 외(prize_sale 도메인과 분리 유지).

## 5. 티켓 구조 (승인 후 생성)

- **에픽**: `feat(storefront): White Catalog 전면 개편 (ADR-0011)` — 본 계획 링크, 스테이지 체크리스트.
- 티켓 9장: S1 파운데이션 / S2 전역 셸 / S3 홈·어바웃 / S4 커머스 코어 / S5 발견·수집 / S6 계정·거래 / S7 쿠폰·등급 / S8 캠페인·코인·Q&A / S9 정리·전환. 각 티켓 본문에 대상 파일 범위·R-스펙 참조·DoD 명시.
- T-C 백로그 이슈 1장(채팅·다국어·접근성 SaaS·본인인증·SNS 로그인 — 재진입 조건 메모).

## 6. 리스크

- **규모**: 직접 편집 ~90파일(어드민 제외)+CSS ~10,800줄 교체+신규 도메인 5종. 스테이지 병렬화(S4~S6)로 흡수하되, 파일 소유권을 티켓에 명시해 충돌을 막는다.
- **쿠폰 금액 통합**이 유일한 고위험 지점 — 주문 생성 RPC 회귀 테스트를 선작성하고, Korpay 확정 경로는 손대지 않음을 계약 테스트로 증명한다.
- **main 병행 변경**(첫 판매 게이트)과의 rebase 비용 — 통합 브랜치를 주기적으로 main에 rebase한다.
- 레퍼런스 재조사 필요 시 Cloudflare 차단 이력 있음 — `outputs/lfs-reference/` 스크린샷·R-스펙으로 대체(재방문 최소화).
- 카탈로그 데이터 준비(카테고리 값 표준화·큐레이션 슬롯 채우기)는 코드와 별개의 운영 작업 — S3·S4에서 시드 기준만 제공.
