# linefriendssquare.com — 06. 이벤트 허브 · 캠페인 아티클 · 공지/공고 · 정적 페이지 · 미니게임

> 실측 기준: 2026-08-26, 데스크톱 1440×900 / 모바일 375×812, `getComputedStyle` 실측.
> 수집 방법: 라이브 세션(실 Chrome 채널) + 서버 렌더 HTML 오프라인 재현(원본 CSS, JS off) 병행 — 일부 경로에 Cloudflare 봇 챌린지가 있어 챌린지 우회 없이 이 조합으로 확인.
> 읽기 전용 원칙 준수: 코인 사용·가챠·출석 체크 등 참여 액션은 일절 실행하지 않고 구조·게스트 상태만 기록.
> 스크린샷: `outputs/lfs-reference/screenshots/07-event-hub-*.png`, `09-event-article-*.png`, `10-notice-article-*.png`,
> `12-policy-*.png`, `13-sitemap-page-*.png`, `14-about-*.png`, `15-notification-*.png`, `16-minigame-*.png` +
> `detail/06-event-hub-live-top.png`, `06-event-hub-{desktop,mobile}-nojs.png`, `06-lucky-live-{top,coin,mid}.png`,
> `detail/06-art{Lucky,Minini,Week,Drop,Lfs}-desktop-nojs.png`, `06-artLucky-mobile-nojs.png`,
> `detail/06-list{Event,Drop,Lfs,Notice}-desktop-nojs.png`, `06-notification-desktop-nojs.png`,
> `detail/06-about-desktop-nojs.png`, `06-sitemap-desktop-nojs.png`, `06-bbidori-live-{desktop,mobile}.png`.

---

## 1. 이벤트 허브 `/pages/event`

### 1.1 섹션 구성

```
main#MainContent
├─ section.ipx-blog-banner     … 상단 프로모 슬라이더
└─ section.ipx-blog-highlight  … 탭 + 아티클 카드 리스트 (페이지의 전부)
```

콘텐츠 칼럼 1180px(x=130). GNB에서 이벤트가 현재 페이지일 때 **핑크 텍스트 + 핑크 언더라인** 표시.

### 1.2 상단 배너 슬라이더

- swiper, 실측 **슬라이드 2장**(웰컴 쿠폰 / 포토리뷰 쿠폰). 슬라이드 = 통짜 링크(예: `/pages/welcome-discount`).
- 슬라이드 **1180×260**(모바일 375×175, 전폭). 중앙 슬라이드 양옆으로 다음 슬라이드가 살짝 보이는 캐러셀.
- 내비: 좌우 화살표 버튼 **44×44**, bg `rgba(0,0,0,.1)`(모바일 `small-hide`). 페이지네이션 불릿 없음.
- 배너 안 텍스트는 이미지가 아니라 **텍스트 레이어**(제목 + 서브 카피)를 이미지 위에 얹는 구조.

### 1.3 탭(필터)

- `ul.tab-list.page-width` — flex, gap 20px, 행높이 50px, 리스트 위 배치. 하단에 전폭 얇은 보더.
- 항목 3개: **ALL / EVENT / DROP** — `a[href="#highlight-blog-all|-2|-3"]` 앵커. 14px/700, active 검정+짧은 검정 언더바, 비활성 회색.
- 동작(라이브 실측): 리스트 3벌이 모두 프리렌더되고 `.tab-body.hidden` 토글. **ALL = 전체 아카이브(~100건), EVENT·DROP 탭 = 각 최근 10건만**. 페이지네이션·더보기 없음(ALL은 한 페이지에 전부 → 문서 높이 25,660px).

### 1.4 아티클 카드

- 그리드: `ul` 2열 — `li.blog-articles__article.largeThumb` **580px**, gap 20px (580+20+580=1180). 모바일 1열 **343px**.
- 카드 anatomy(`.article-card`):

| 요소 | 스펙 |
|---|---|
| 썸네일 | **580×387 (3:2)**, 모바일 343×229, radius 0 |
| 배지 `.card__badge` | 좌상단 absolute(8,8), **EVENT·DROP 모두 검정 bg + 흰 글자** 16px, height 29, padding 0 8 — 색이 아니라 텍스트로 유형 구분 |
| 제목 `.card__heading` | 18px/700 #111, 이미지 아래 |
| 부제 `.card__subtitle` | 15px/400 #616161, 1줄 |

- **기간 라벨·진행중/종료 상태 뱃지 없음.** 날짜는 일부 부제 카피에 인라인으로만 등장(예: "(8/13-19)"). 종료 이벤트는 시각 구분 없이 리스트 하단으로 밀리는 아카이브형.
- 카드 전체가 아티클 링크(`/blogs/event/*` 또는 `/blogs/drop/*` 혼합 노출).

---

## 2. 캠페인(이벤트) 아티클 `/blogs/event/*`

표본: `bonus-lukcy-ball`(게이미피케이션), `2026-jun-square-week`(게이미피케이션), `idle-minini-baby`(팝업 안내형).

### 2.1 공통 골격 — 블로그 템플릿이 아니라 "쇼케이스 랜딩"

- 표준 헤더/푸터 사이에 **단일 커스텀 섹션**. h1/작성일/공유 같은 아티클 크롬 없음.
- 풀블리드 테마 배경(예: 픽셀아트 그라데이션) + 중앙 히어로 타이틀 **이미지**(772×460 GIF 등).
- 에셋은 자체 CDN `vos.line-scdn.net/ipx-mall/images/out/showcase/YYMMDD/img/{pc|mo}/…` — **PC/MO 이미지 이원화**, DOM에도 `pc_only`/`mo_only` 블록 이원화.
- 본문 폭: 풀블리드 배경 위에 내부 패널 **980px**(mission_content 등, padding ~52 65).

### 2.2 게이미피케이션형 anatomy (bonus-lukcy-ball 실측, 게스트 상태)

```
(sticky) 인페이지 앵커 내브 .line_wrap.pc  … 화면 상단 고정 z2, 높이 48
    [▶ GACHA(active 검정박스)] [MY COIN] [MISSION] [B-MONTH]   …앵커 탭, 픽셀 폰트
    우측: [사용 가능 코인 🪙×0]  … .coin_box 160×46, 흰 bg + 2px 검정 보더
          [내 쿠폰] 버튼        … 클릭 시 보유 쿠폰(로그인 필요)
    (모바일: "메뉴 토글" 버튼으로 접힘)
├─ 히어로: 타이틀 GIF + 리드 카피
├─ 기간: "2026. 8. 7 오전 11시 ~ 8. 31 오후 11시 59분" (텍스트, 볼드)
├─ GACHA 섹션: 2패널
│    좌: "코인 1개 사용" 주황 pill + "럭키볼 뽑기" + 가챠머신 일러스트
│        + 버튼 "✕ 1개로 가챠돌리기" 215×60 — 게스트에서 disabled
│    우: "럭키볼 당첨 경품" + 사진/등수 패널(1~4등; 4등 = 장바구니 쿠폰)
│        ↳ 경품 쿠폰 코드(SMR_*)가 카트 프리셋·마이페이지 쿠폰함과 동일 체계
├─ MY COIN 섹션: 게스트 = "로그인 하기" 아웃라인 CTA 280×56
│        href="/account/login?checkout_url=%2Fblogs%2Fevent%2Fbonus-lukcy-ball" (복귀 파라미터)
│        + 사용 가능 코인 ×0 + 내 쿠폰 + "선물 교환소"
├─ MISSION 섹션(.mission_content 980px): ul.mission_ul — 미션 카드(아이콘 100×100)
│    · 출석 체크: "매일 1코인 적립(최대 10회), 8·18·28일 보너스 5개" + [출석하고 코인 받기]
│    · 주문하기: 최대 n회 + [바로 주문하러 가기]
│    · 리뷰 쓰기: 최대 n회
│    + ul.mission_bonus — 보너스 코인 규칙
├─ 유의사항/당첨자 발표 표(.td_date "2026.1.20"형 날짜 셀)
└─ CTA "상품 보러가기" .btn_primary 220×56 (관련 컬렉션으로)
```

- 참여 버튼(출석·가챠)은 전부 로그인+서버 상태 기반; 게스트에는 로그인 CTA가 그 자리에 노출. 코인 잔액 UI는 상시 노출(×0).
- 스크린샷: `detail/06-lucky-live-top.png`(히어로), `06-lucky-live-coin.png`(sticky 내브+GACHA), `06-lucky-live-mid.png`.

### 2.3 팝업 안내형 (idle-minini-baby)

같은 쇼케이스 골격에서 게임 요소만 빠진 구성: 타이틀 이미지 → 기간("2026.7.24 - 8.2") → 리드 카피 → 오프라인 매장 안내(매장명 리스트 + **"스토어 위치 보기"** 버튼 261×52, bg #FFA1CA, radius 4) → 특전 섹션(LIMITED PHOTO CARD — 구매 조건/랜덤 증정/선착순 문구 구조) → 현장 예약 안내 → SNS CTA(**INSTAGRAM 바로가기** 380×68).

### 2.4 이벤트 vs 드랍 vs 콘텐츠(lfs) 차이 요약

| | `/blogs/event/*` (+게임형 `/blogs/lfs/*`) | `/blogs/drop/*` |
|---|---|---|
| 렌더 방식 | 단일 커스텀 쇼케이스 섹션(외부 CDN 이미지) | **Shopify 섹션 조립형**(테마 섹션 반복) |
| 타이틀 | 이미지 로고 | 텍스트 `h1` 40px/700 좌정렬 |
| 인터랙션 | 코인/가챠/미션/앵커 내브 | 없음(공유 모달 정도) |
| 본문 | 자유 레이아웃 + 게임 UI | 이미지 스택 + 텍스트박스 |
| 하단 | 상품 보러가기 CTA | **Latest Drop** 관련 아티클 카드 |

## 3. 드랍 아티클 `/blogs/drop/*` (표본 bt21-ribboned-u)

```
├─ section ipx-blog-drop-header
│    히어로 이미지 1180×741 (콘텐츠 칼럼 상단)
│    h1 "BT21 RIBBONED U" 40px/700 (margin-bottom 8)
│    서브 카피 1줄 + .shareArea 해시태그(#BT21 #리본드유 …) + 공유(URL 복사 모달: 복사 버튼 88px + 닫기)
├─ section ipx-blog-drop-textbox (blog-drop-content)
│    16px/1.8 본문, 1212 칼럼 — 카피 2줄 + "🗓️2026.2.24 11AM KST OPEN / 📍LINE FRIENDS SQUARE" (이모지 메타 라인)
├─ section ipx-blog-drop-image × 7   … 1180px 풀폭 이미지 스택(룩북), 섹션당 1장
└─ Latest Drop  … 관련 드랍 카드 리스트(허브와 동일 카드 스타일)
```

- 작성일 표기 없음. 발매 정보는 본문 이모지 라인으로만.

## 4. 콘텐츠 블로그 `/blogs/lfs/*`

- 성격: 장기 챌린지·미니게임·B2B 안내 등 잡거리 채널. 표본 `2026squarechallenge` = **2.2 게이미피케이션형과 동일 구조**(출석 27회/주문 7회/리뷰 미션 + 코인 + 선물 교환).
- 미니게임류 아티클 존재: `happy-brown-day-game`(8.88초 맞추기), `truz_fruitsgame`(과일게임), `wishnini-house-puzzle`, `i-dle-minini-baby-room-tour-hidden-catch` — 게임 이벤트를 아티클 단위로 운영.

## 5. 블로그 리스트 페이지 `/blogs/{event|drop|lfs}`

- `h1` = 블로그명("Event"/"Drop"/"lfs") **40px/700 좌정렬**(margin 20 0), 그 아래 허브와 동일한 2열 580px 카드 그리드(배지 EVENT/DROP/LFS).
- 탭·필터 없음, 페이지네이션 요소 미검출(현재 분량은 단일 페이지 나열).
- 허브(/pages/event)와의 관계: 허브가 사실상 event+drop 통합 뷰, 개별 `/blogs/*`는 원본 아카이브.

---

## 6. 공지 `/blogs/notice`

### 6.1 목록 — 게시판이 아니라 아코디언

- 섹션 `ipx-notice`, page-width 1212. `h1` "NOTICE" 18px/700.
- 행 = `<details><summary>` **8건**: 좌 제목(`.notice-heading`) / 우 날짜(`<time>` "2025년 6월 10일" 14px #A0A0A0) + 쉐브론(15×8, #888). 행 간 보더, 행높이 ≈77px.
- 펼침 본문 `.notice-cont > .article-template__content` — 인라인 전개. 단, 주요 2건(멤버십·배송)은 본문이 비어 있고 **전용 URL로 운영**. 목록에는 레거시 행(shipping-info-ja 등 내부용 슬러그)도 그대로 노출.

### 6.2 공지 상세 (전용 URL형)

**`/blogs/notice/shipping_info`** — `article-template` + 커스텀 `content_wrap`:
- `h3` "배송 / 주문 안내" **40px/700** → `h4` 22px/700 섹션(배송비 & 일정 / 배송 지역 / 주문 프로세스 / 구매 제한 / 주문 한도 / For Global / 교환·반품) → 본문 16px/1.8 + 표. 콘텐츠 칼럼 1180.

**`/blogs/notice/membership`** — 상단 **Easylockdown 게이트 블록**(비로그인 대상 "지금 가입하시면 …" + [회원 가입] CTA, 1212 칼럼) + 멤버십 안내:
- 등급 표 **1192px**, 4등급 **WELCOME(가입 시) / SILVER(최근 1년 1~4회) / GOLD(5~9회) / VIP(10회+)** × 등급별 할인 쿠폰 묶음(5천/1만/2만/5만원, 최소구매조건 병기). "등급 쿠폰은 매월 1일 자동 발급, [마이페이지 > 쿠폰함]" 규칙 명시.
- 별도 페이지 없이 이 아티클이 푸터 "멤버십"·GNB "멤버십 안내"의 목적지.

---

## 7. 공고 게시판 `/pages/notification`

- 단일 섹션 `ipx_statement_account`. `h1` "공고".
- **테이블형**: 헤더 3열 `일자 | 내용 | 자료 다운로드`(파일 첨부 열 보유). 실측 시점 데이터 0건 — 헤더 행만 있는 빈 보드(전자공고용 법정 게시판 성격). 테이블 폭 1172.

---

## 8. 정책 문서 `/policies/*`

- Shopify 기본 폴리시 템플릿: `.shopify-policy__container` **620px**(padding 0 20 → 본문 580px) 중앙 1칼럼.
- 페이지 타이틀(h1)은 16px 소형이고, 실질 위계는 본문 첫 `h2`(20px/700)와 `h3`(굵은 조항 제목)가 담당. 본문 `p` **14px / line-height 1.6 / #222**, 조항 리스트 위주. 표 없음.
- 보유 문서: `privacy-policy`(개인정보처리방침, 본문 ~9,400px 높이), `terms-of-service`(서비스 약관, 텍스트 18,325자), `refund-policy`(환불 정책, **800자** 요약본 — 상세는 배송/주문 공지로 위임하는 구조).
- 모바일: 컨테이너 375 전폭(패딩만).

---

## 9. ABOUT US `/pages/about-us`

- **원페이지 마이크로사이트**: 표준 크롬 대신 **자체 미니 헤더**(좌 LFS 워드마크, 우 `Shop`(→/collections/shop)·`Join us`(→/account)) + 풀스크린 **비디오 히어로**(video.js, 오버레이: "Creating New Retail Experience" + 검정 박스 워드마크 + 하단 스크롤 화살표).
- 이후 세로 내러티브: 초대형 타이포 선언문("Creating New Retail Experience" ≈120px) → 브랜드 소개문 → 섹션 타이틀 **40px/700 중앙**으로 이어지는 5부:
  1) **라인프렌즈 스퀘어 스토어** — 국내(명동/홍대: 주소·영업시간·네이버지도 링크 카드) / 글로벌(NY·LA·도쿄·상하이: 구글맵) / 온라인(LFS·네이버스토어·카카오선물 등) 카드 + "전체보기".
  2) **라인프렌즈 스퀘어 팝업** — 가로 슬라이더(슬라이드 1440×675).
  3) **IP** 4) **CONTENTS** 5) **CONTACT**.
- 스토어 데이터(주소·시간·지도 링크)가 전부 하드코딩 텍스트.

---

## 10. 리테일 게이트 `/pages/site-map`

- 명칭은 사이트맵이지만 실체는 **오프라인/글로벌 스토어 링크 허브**(내부 페이지 사이트맵 아님).
- 단일 섹션 `ipx-site-map`, 좌정렬. 그룹 `h2` **34px/700** 3개 + 그룹 사이 두꺼운 회색 디바이더:

| 그룹 | 하위 라벨(볼드 소제목) | 링크(칩 버튼) |
|---|---|---|
| ONLINE STORE | — | GLOBAL(자기 자신) / NAVER STORE / USA / JAPAN / CHINA — 외부 스토어, **utm_source=owned_ONLINE_square** 부착 |
| OFFLINE STORE | KOREA / USA / JAPAN / CHINA | HONGDAE·MYEONGDONG(네이버지도), NEWYORK·LA·Universal CityWalk·SHIBUYA·SHANG HAI(구글맵) |
| SNS | — | INSTAGRAM / X (Twitter) — 15px 아이콘 + 라벨 |

- 링크 스타일: 소형 **칩/필 버튼**(1px 보더, 흰 bg, 대문자 ~11px), 가로 나열.

---

## 11. 미니게임 `/pages/bbidori_game` ("삐돌이의 칼퇴 모험")

- **헤더·푸터·플로트바 전무**(서버 HTML에조차 크롬 섹션 없음) — 풀 스탠드얼론 페이지. `body.type-page`, 흰 배경.
- 테마 밖 스택: **Tailwind CDN + jQuery 3.7.1** 직접 로드, 게임은 단일 `<canvas>`.
- 데스크톱 구성: 중앙 **500px 카드**(radius+shadow) — 제목("삐돌이의 칼퇴 모험 😫") + 조작 안내("키보드 방향키(← →) 또는 화면 터치…") + HUD 3박스(**레벨 / 버틴 시간 / 피한 업무**, 연회색 박스) + canvas **460×613**(bg #E5E7EB, 이모지 낙하물 + 캐릭터 스프라이트).
- 게임오버: canvas 위 다크 오버레이 바 — "칼퇴 실패!" + 결과 요약 + **[다시하기]**(Tailwind `bg-blue-500`, radius 5).
- **진입/복귀 UI 없음**: 사이트 어느 페이지에서도 이 URL로의 링크 미검출(비공개/시즌 한정 배포 URL로 추정), 페이지 안에도 스토어 복귀 링크·로고 없음(브라우저 뒤로가기 의존). 점수 저장·코인 연동 요소 미검출(로컬 완결형).
- 모바일: 같은 카드가 전폭으로, 터치 조작.
- 참고: 삐돌이 외 미니게임들은 §4의 `/blogs/lfs/*` 아티클 방식으로 운영되어 코인 이벤트와 연결됨 — 페이지형(bbidori)과 아티클형(코인 연동)의 2계열.

---

## 12. 푸터발 정적 페이지 유형 분류

| 푸터/보조 링크 | 실체 | 레이아웃 계열 |
|---|---|---|
| ABOUT US | `/pages/about-us` | 원페이지 마이크로사이트(§9) |
| 사이트맵 | `/pages/site-map` | 칩 링크 허브(§10) |
| 개인정보처리방침 · 서비스 약관 | `/policies/*` | Shopify 폴리시 620px 문서(§8) |
| 배송 · 환불 | `/blogs/notice/shipping_info` | 공지 상세형 문서(§6.2) |
| 멤버십 (GNB "멤버십 안내" 동일) | `/blogs/notice/membership` | 게이트 CTA + 등급 표(§6.2) |
| 공고 | `/pages/notification` | 빈 테이블 게시판(§7) |
| 1:1 문의 | `#openChat` | 페이지 아님 — 채널톡 위젯 오픈 |
| (비링크) 마케팅 동의 안내 | `/pages/marketing-agreement` | 문서형(수신 동의 고지) |

- **FAQ 전용 페이지는 없다.** 정책·배송·멤버십 공지 3종 + 채널톡이 그 역할을 나눠 갖는 구조.
- 정적 문서의 실질 서식은 2가지로 수렴: ① 620px 폴리시 문서(법무), ② 1180px 공지 상세(h3 40 + h4 22 + 표, 운영 문서).

---

## 13. 관찰 요약 (리디자인 참고)

1. 이벤트 시스템은 3층: **허브(/pages/event, 탭+카드 아카이브) → 쇼케이스 아티클(자유 랜딩 + 코인/가챠/미션) → 보상(쿠폰 코드)이 카트·쿠폰함으로 관통**.
2. 카드 그리드에 기간·상태 메타가 없어(배지=유형뿐) 진행중/종료 구분은 리스트 순서에만 의존 — 리디자인 시 개선 여지가 명확한 지점.
3. 드랍은 "룩북 이미지 스택 + 발매 일시 이모지 라인"이라는 초경량 서식, 이벤트는 완전 커스텀 — 두 서식이 분리된 CMS 전략.
4. 게이미피케이션 UI 문법: 픽셀아트 테마 + sticky 앵커 내브 + 코인 잔액 상시 노출 + 게스트에겐 같은 자리에서 로그인 CTA 치환(checkout_url 복귀).
5. 정적/문서 페이지는 서식 3종(폴리시 620 / 공지 1180 / 마이크로사이트)으로 전부 설명 가능. FAQ·전용 고객센터 페이지 없이 채널톡 단일 창구.
