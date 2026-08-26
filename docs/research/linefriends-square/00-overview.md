# linefriendssquare.com 재현 스펙 — 00. 개요와 인덱스

> 목적: [ADR-0011](../../adr/0011-lfs-storefront-redesign.md) 스토어프론트 전면 개편의 재현 스펙 번들. 이 문서들만 보고 레퍼런스 사이트 방문 없이 프론트를 재현할 수 있는 수준을 목표로 한다.
> 조사 시점: 2026-08-26. 데스크톱 1440×900 / 모바일 375×812, `getComputedStyle` 실측 + CSSOM authored 규칙 병행.

## 문서 인덱스

| 문서 | 범위 |
|---|---|
| [01-global-chrome.md](./01-global-chrome.md) | 공지바 · 3단 헤더 · GNB/메가메뉴 · 검색 진입 · 푸터 · 모바일 크롬(가로 탭 GNB·바텀시트·하단 5탭 바) |
| [02-home.md](./02-home.md) | 홈 본문 밴드 8개(히어로/콘텐츠 카드/좌탭 상품 그리드/배너+리스트 밴드×3/인기템/혜택 타일) |
| [03-collection-search-directory.md](./03-collection-search-directory.md) | 컬렉션(필터·정렬·VIEW MORE) · 검색(오버레이·결과) · 브랜드 디렉토리(A–Z) · 브랜드관 |
| [04-product-detail.md](./04-product-detail.md) | PDP(갤러리·정보칼럼·옵션·2CTA·품절/재입고·탭 패널·리뷰/Q&A·모바일 구매바) |
| [05-cart-auth-mypage.md](./05-cart-auth-mypage.md) | 카트(미니 체크아웃) · 로그인/가입 · 마이페이지 셸 · 쿠폰함 · 등급 |
| [06-event-campaign-static.md](./06-event-campaign-static.md) | 이벤트 허브 · 캠페인/드랍 아티클 · 공지 · 공고 · 정책 · about · 미니게임 |
| [07-design-tokens.md](./07-design-tokens.md) | 색 전수+액센트 사용처 맵 · 타이포 스케일 · 스페이싱 · radius/그림자 · 버튼/인풋/뱃지 · z-index · 모션 |
| [08-feature-inventory.md](./08-feature-inventory.md) | 기능 전수 × ICONS 현황 × 채택 티어(T-A/T-B/T-C) × DB 영향 |

보조 참조(로컬 전용, gitignored): `outputs/lfs-reference/` — 풀페이지 스크린샷 34장(17유형×2뷰포트) + detail 크롭 62장 + 초기 구조 조사(`lfs-structure-survey.md`). 이 저장소 밖으로 배포하지 않는다.

## 레퍼런스 정체 요약

- **Shopify + Dawn 기반 커스텀 테마**(`ipx-*` 레이어). 단일 반응형(모바일 별도 도메인 없음), 다크모드 없음.
- **화이트 캔버스 + 무채색 잉크(#121212/#111) + 단일 핑크 액센트(#F83BAA, 하드코딩)**. 유채색은 액센트와 일부 배지·타일뿐이고 색은 IP 상품 이미지가 낸다.
- **Pretendard 단일 서체**(영문 포함), html 10px 루트 기법, 국문 음수 letter-spacing(-0.2~-0.8px).
- **radius 0 기본의 각진 플랫**(버튼 2/4px, pill 예외), 그림자 실사용 1종, 스크롤 연출 전무 — 정적 카탈로그 톤.
- 컨테이너 1212px(콘텐츠 1180px), 상품 그리드 데스크톱 4열 / 모바일 2열.
- blogs를 캠페인 CMS로 사용(EVENT/DROP/콘텐츠/공지), 미니게임은 크롬 없는 스탠드얼론.

## 페이지 유형 → ICONS 라우트 매핑 (확정)

| LFS 표면 | ICONS 적용 |
|---|---|
| 홈 `/` | `/` 신규 홈(02 문서의 밴드 구성) |
| 컬렉션 `/collections/*` | `/shop`(카테고리·필터·정렬), NEW/BEST 큐레이션 컬렉션 |
| 상품 상세 `/products/*` | `/shop/[goodId]` |
| 검색 `/search` | `/search` + 헤더 검색 오버레이 |
| 카트 `/cart` | `/cart` (미니 체크아웃 문법) |
| 계정 `/account/login`·`register` | `/login`·가입 (플랫 448px 문법) |
| 마이페이지 셸 `/pages/wish-list` 등 | `/my` 허브 + 주문·티켓·문의·리뷰·설정·알림·위시리스트·쿠폰함 |
| 브랜드 디렉토리 `/pages/brand` + 브랜드관 | **온라인 팝업** `/ip`(A–Z 디렉토리) + `/ip/[id]`(개별 관: 풀블리드 배너+팔로우) |
| 이벤트 허브 `/pages/event` + 캠페인 아티클 | **이벤트** `/events` 재정의(캠페인 허브) + 캠페인 상세 |
| (해당 없음 — 기존 ICONS 도메인) | **오프라인 팝업** 예매: `/events`에서 신규 경로로 이사, 푸터 진입만 유지 |
| 미니게임 `/pages/*_game` | `/games/[gameId]` (이미 동일 문법 — 크롬만 정합) |
| (해당 없음) | `/packs`·`/binder`: 캠페인 랜딩·카탈로그 문법 차용 재조판 |
| (해당 없음) | `/community`: 콘텐츠 카드 문법 차용 재조판 |
| 정책 `/policies/*` | `/legal/*` (620px 문서 서식) |
| about `/pages/about-us` | `/about` — **구 홈 콘텐츠 섹션 보존**(새 전역 셸 아래) |
| 체크아웃(Shopify 표준) | **카피 대상 아님** — 현행 Korpay 플로우 유지, 크롬만 신 시스템 |

## 재현 원칙 (전 문서 공통)

1. **자산·문구 금지**: 레퍼런스의 이미지·캐릭터·로고·마케팅 카피·핑크(#F83BAA/#FD4BBB)는 재사용하지 않는다. 구조·수치·동작만 재현한다.
2. **액센트 치환**: 핑크 → brand-green `#78bb53`. 사용처 16곳 전수는 07 §1.2 표를 따른다(GNB 활성·카트 뱃지·카드 뱃지·할인율·하트·caret·칩·폼 검증·버튼 pink 변형 등).
3. **의도적 편차(전부 여기 기록)**:
   - `html 10px` 루트 기법 미채택 — Tailwind rem 스케일과 충돌. 수치는 px 직접 지정.
   - 카드 이미지 비율은 **3:4로 통일**(레퍼런스는 표면별 73:100/3:4 혼재).
   - 리뷰·Q&A는 외부 위젯(Stamped) 대신 자체 도메인으로 구현. 위시리스트도 자체 구현(레퍼런스는 Shopify 앱).
   - 채널톡·Global-e·AccessiBe·휴대폰 본인인증 등 외부 SaaS는 범위 외(T-C).
   - 폰트는 이미 Pretendard로 동일 — 추가 도입 없음.
4. **결함 미재현 목록**: 컬렉션/검색의 주기적 강제 리다이렉트 스크립트, 빈 결과 no-JS 마크업 텍스트 누출, VIEW MORE·검색 인풋의 Arial 폴백, Stamped의 숨김 처리된 분포 바/투표, 위젯 영문 노출, PDP "sticky 클래스만 있고 동작 안 함", 이벤트 카드의 기간·종료 상태 미표기.
5. 문서 간 충돌 시 나중 실측(개별 표면 문서)이 초기 구조 조사보다 우선한다.
