# linefriendssquare.com — 05. 카트 · 인증(로그인/가입) · 마이페이지 셸

> 실측 기준: 2026-08-26, 데스크톱 1440×900 / 모바일 375×812, `getComputedStyle` 실측.
> 수집 방법: 라이브 세션 + 서버 렌더 HTML 오프라인 재현(원본 CSS 로드, JS off) 병행.
> `/account/register`·`/pages/*`(마이페이지) 경로는 헤드리스 브라우저에 Cloudflare 챌린지가 걸린다(챌린지는 우회하지 않았고, 실제 Chrome 채널 요청과 서버 HTML로 확인). 봇 판정에 민감한 경로라는 사실 자체가 리디자인 시 참고 포인트.
> 읽기 전용 원칙: 장바구니 담기·폼 제출·로그인 시도 없음. 담긴 카트 상태는 DOM/템플릿 마크업에서 유추한 구조만 기록.
> 스크린샷: `outputs/lfs-reference/screenshots/06-cart-*.png`, `11-login-*.png` +
> `detail/05-cart-empty-{desktop,mobile}.png`, `detail/05-login-{desktop,mobile}-full.png`, `detail/05-login-recover.png`,
> `detail/05-register-{desktop,mobile}-full.png`, `detail/05-mypage-{order,wish,coupon,rewards,update}-desktop.png`,
> `detail/05-mypage-order-mobile.png`, `detail/05-menu-mobile.png`.

---

## 1. 카트 `/cart`

### 1.1 페이지 섹션 구성 (위→아래)

```
main#MainContent
├─ section cart-items        … 타이틀 + 아이템 목록 + (우측) 주문 요약 aside — 한 섹션 안에 2컬럼
├─ section ipx-cart-coupon   … 쿠폰 리스트 (빈 카트에서는 .hidden)
├─ section ipx-cart-note     … 배송 메모 (빈 카트에서는 .hidden)
└─ section cart__footer-wrapper (ipx-main-cart-footer) … CSS만 제공, 빈 카트에서는 내용 없음
```

- 컨테이너: `.cart-row.ipx-cart.page-width` = **1212px** (margin 0 auto, 1440 기준 x=114), `mobile-no-gutter`.
- 섹션 상하 패딩: 데스크톱 36px / 모바일 27px (`cart-items-padding`).

### 1.2 2컬럼 레이아웃 (담긴 상태 골격)

`.cart-row`는 `display:flex; gap:40px`.

| 요소 | 값 |
|---|---|
| 좌: `cart-items.cart-block` | flex `0 1 auto`, 실측 **780px** |
| 우: `#cart-aside-total.cart-aside` | flex `0 0 360px` = **360px**, padding-top 58px(타이틀 라인 아래 정렬) |
| 타이틀 `h1.title--primary` "카트" | 22px/700 (`.title-wrapper-with-link`, 모바일에서는 `small-hide`로 숨김) |

빈 카트에서는 wrapper에 `.empty-cart`, `cart-items`에 `.is-empty`가 붙고 aside는 `.hidden`.

### 1.3 빈 상태 UI (실측)

구조: `cart-items.is-empty > .cart__warnings > .empty-content + .empty-cta`

| 요소 | 스펙 |
|---|---|
| 일러스트 | `empty-placeholder_300x300` PNG(검정 라인아트 스퀘어 캐릭터), 렌더 **146×178** |
| 문구 | `<p>` "카트가 비어 있습니다" — 16px/400, #121212, 일러스트 아래 중앙 |
| CTA | `a.button.button--secondary` "쇼핑 계속하기" → `/` — **220×60**, bg **#F83BAA**(핑크), 흰 글자 18px/700, radius 2px |
| 정렬 | 전부 수평 중앙, 전체 블록 높이 ≈440px |

모바일(375): 동일 스택, CTA **343×60**(좌우 16px 거터), 실측 bg **#000**(빈 상태 CTA 색상이 뷰포트별로 다름 — 데스크톱 핑크/모바일 검정, `--color-button` 오버라이드 차이).

숨김 상태로 존재: 비활성 주문 버튼 `a.cart__checkout-button.button--disabled` "0개 상품 주문하기".

### 1.4 담긴 상태 구조 (DOM/스크립트 유추 — 담아보지 않음)

- `form#cart(action=/cart, method=post) > .cart__items > .js-contents` : 행(row)은 **AJAX로 렌더**(서버 섹션 렌더링 결과 주입). `cart-items` 커스텀 엘리먼트가 담당, `data-single-quantity="true"`.
- `<cart-gwp>` : 사은품(GWP) 로직 + `#cart-json-data`(Shopify cart JSON 전문)를 **`localStorage['ipxCart']`에 저장**.
- 주문 요약 aside `.side-total` — `<table>`:

```
tbody  ├ th 총 상품금액 (n)     | td ₩0
       ├ th 총 할인금액          | td #cart-total-discount  -₩0
       └ th(안내행) "배송비는 결제 화면에서 확인할 수 있어요." (15px #A0A0A0)
             + <strong><span style="color:#f83baa"> 증정품 확인 유도 문구(핑크 볼드)
tfoot  └ th 예상 총액(16px/700)  | td #cart-total-price ₩0
```

  th 기본 16px/400 #616161, 테이블 14px 기준.
- 주문 CTA: `a#checkout-desktop.cart__checkout-button.button.button--secondary` → **`/checkout`**, 라벨 "**n개 상품 주문하기**"(수량 임베드), inline `--color-button:#000000`(검정). 0개면 `.button--disabled` + `disabled`.
- CTA 아래 `klarna-placement`(credit-promotion-badge, ko-KR) + `#cart-errors`.
- noscript 폴백: `<button type=submit form=cart>`.

### 1.5 쿠폰 섹션 `#ipx-cart-coupon` (담긴 상태에서 노출)

- 헤더: `h4` "쿠폰 리스트" 16px/700 + 물음표 툴팁(`.tooltip-icon` "?") — 호버 시 "쿠폰 사용 방법 … '직접 입력'을 선택하세요" 설명.
- 프리셋: `select#cart-coupon-preset.form-control` — **서버가 쿠폰 20종을 옵션으로 프리렌더**. 각 option에 `data-start/-expiration/-explain/-condition/-segments` 보유(예: `LUCKY_0808` "8,000 원 할인쿠폰", 조건 "4만원 이상 구매 시", 만료 `2026-08-08 23:59`; 이벤트 경품 교환권 `SMR_*` 포함).
- 선택 시 설명 3줄 출력: `#coupon-explanation` / `#cart-coupon-expiration` / `#cart-coupon-using-condition`.
- "직접 입력" 선택 → `#custom-cart-coupon`(기본 hidden): `input[name=coupon]`(placeholder "쿠폰을 입력해 주세요.") + `button#apply-custom-coupon` "쿠폰 적용"(button--secondary).
- 실패/대체 토스트 문구가 data 속성으로 정의: "쿠폰을 적용할 수 없습니다." / "혜택이 더 좋은 할인쿠폰이 적용됩니다."

### 1.6 배송 메모 섹션 `#ipx-cart-note`

- `h4` "배송 메모" + `select#cart-note-preset`: 프리셋 4종("배송 전에 미리 연락 바랍니다." / "부재시 경비실에 맡겨 주세요." / "부재시 전화 주시거나 문자 남겨 주세요." / "문앞에 바로 남겨놓아 주세요.") + "직접 입력".
- "직접 입력" → `#custom-cart-note`(hidden) `textarea[name=note]` placeholder "배송 메모를 입력해 주세요.".

**요약**: 주문 요약 사이드는 존재한다(우측 360px 고정 칼럼). 쿠폰·배송메모는 카트 페이지에서 선적용하는 구조(체크아웃 이전 단계에 상당한 기능이 들어와 있음)가 특징.

---

## 2. 로그인 `/account/login`

### 2.1 레이아웃 — 카드형 아님, 전폭 플랫

- 페이지 배경 흰색, 박스/그림자/테두리 없는 **플랫 중앙 1칼럼**.
- 래퍼 `.customer.login.ipx-customer`: **478px**(padding 36px 15px) 중앙 → 실질 콘텐츠 폭 **448px** (x=496~944).
- 모바일: 래퍼 **280px** 중앙(x=48), padding 27px 0.

### 2.2 폼 전수 (`form#customer_login`, POST `/account/login`)

| # | 요소 | 스펙 |
|---|---|---|
| 1 | `h1` "로그인" | 30px/700, 중앙, margin-bottom ≈20px |
| 2 | `input#CustomerEmail` | type=email, name=`customer[email]`, placeholder "이메일", required, autocomplete=email — **448×40**, border 1px `#DCDEE0`, radius 2px, 15px, padding 0 40px 0 14px(우측 40px는 상태 아이콘 여백) |
| 3 | `input#CustomerPassword` | type=password, name=`customer[password]`, placeholder "비밀번호", current-password — 위와 동일 스펙, 필드 간격 12px |
| 4 | 보조 링크 | `a[href="#recover"]` "비밀번호를 잊으셨나요?" — 15px, **#888**, underline, **우측 정렬**(폼 우변 끝) |
| 5 | 제출 | `button.button--full-width.button--secondary` "로그인" — **448×60**, bg #000, 흰 글자 18px/700, radius 2px |
| 6 | 가입 유도 | `a.button--full-width[href="/account/register"]` "이메일 회원가입" — **448×60**, 아웃라인 스타일(투명 배경 + 시각상 1px 검정 외곽선, 글자 rgba(18,18,18,.85) 18px/700), 로그인 버튼 아래 7px |
| 숨김 | `login_with_shop[analytics_trace_id]` hidden — Shop 로그인 추적용 |

라벨 없음(placeholder-only). hidden: `form_type=customer_login`, `utf8`.

### 2.3 SNS 로그인 `.ipx-social-form`

- 구분: 로그인 블록과 사이 **수평 디바이더**(margin-top 40 + padding-top 40).
- 헤더: `h5` "SNS 계정으로 로그인" 18px/700 중앙 + 서브 "비회원은 회원 가입 화면으로 이동합니다." 14px #888.
- 버튼 4개, **순서: 네이버 → 카카오 → LINE → 구글**. `button.{naver|kakao|line|google}.authButton[data-provider=…]`, 각 **55×55**, 아이콘은 인라인 SVG 원형(네이버 `#03C75A`, 카카오 `#FFEB00`+검정 말풍선, LINE 초록, 구글 회색 원 + G).
- 배치: `.buttonWrap` inline-flex **gap 24px**, 중앙 정렬(전체 292px).
- 페이스북/애플: DOM에 별도 서드파티 위젯(`hiko-container`: LINE/Google/Facebook/Apple 사각버튼)이 렌더되지만 **비표시** — 실제 노출은 위 4종뿐.

### 2.4 비밀번호 재설정 `#recover` — 오버레이가 아니라 in-place 스왑

- CSS `:target` 방식: URL 해시 `#recover` 시 로그인 h1/폼이 숨고 같은 448px 칼럼에 재설정 폼 표시(모달·백드롭 없음). `detail/05-login-recover.png`.
- 구성: `h1` "비밀번호 재설정" 20px/700 중앙 → 안내문 "비밀번호 재설정을 위해 이메일을 보내드리겠습니다." → `input#RecoverEmail`(placeholder "이메일", 40px) → `button` "제출"(448×60 검정). 취소 링크 없음(뒤로가기 의존). SNS 블록은 그대로 유지.
- 폼 action: POST `/account/recover`.

### 2.5 리턴 URL 관례

보호 액션에서 로그인으로 보낼 때 `/account/login?checkout_url=<원래 경로>` 쿼리를 쓴다(이벤트 아티클의 "로그인 하기" CTA 실측). 로그인 후 원위치 복귀 seam.

---

## 3. 회원가입 `/account/register`

> 라이브 헤드리스 접근은 Cloudflare 인터스티셜에 걸림. 아래는 서버 렌더 HTML(540KB, 정상 200)을 원본 CSS로 재현한 실측. `detail/05-register-desktop-full.png`.

### 3.1 레이아웃

- 래퍼 `.customer.register.ipx-register` **478px** 중앙(콘텐츠 448px). 모바일 전폭 375(패딩 27 0).
- `h1` "이메일 회원가입" 24px/700 중앙 + 아래 캐릭터 두들 일러스트(음표 든 스퀘어 캐릭터).
- 폼: `form#customer-register` (POST `/account`).

### 3.2 필드 — **좌측 라벨 + 우측 인풋의 가로 행** (`.ipx-form-group.row`)

| 행 | 라벨(14px #A0A0A0, `*`는 핑크) | 컨트롤 |
|---|---|---|
| 이메일* | label 폭 ≈90px | `input[name=customer[email]]` placeholder "이메일" — **344×40**, border #DCDEE0, r2 |
| 비밀번호* | 〃 | `input[password]` placeholder "**영문 숫자 특수문자 포함 8~20자**" |
| 휴대폰번호* | 〃 | `button#registerAuth.ipx-btn.pink` "**휴대폰 본인인증 하기**" — **344×40**, bg **#F83BAA**, 흰 15px/700 + readonly 더미 인풋(`customerPhoneDummy`, hidden) |

- 모바일도 가로 행 유지(라벨 69px + 인풋 260px, gap 14px).
- hidden 필드: `customer[last_name]`, `customer[note][dob]`, `customer[note][gender]`, `customer[phone]`, `token_version_id`, `shopifyToken` — **본인인증 결과(이름·생년월일·성별·전화번호)를 채워 넣는 구조**. 인증 벤더는 JS 핸들러(`#registerAuth`) 뒤라 정적으로 특정 불가.

### 3.3 약관 동의 `.agree-area` (실측 순서·필수 여부)

```
[□] 모두 동의하기                       … .agreeAll, 15px/700 (마스터)
──────────────────────────────
[✓] 서비스 이용 약관 (필수)              name=agree01 id=service   required  →  ›(chevron) /policies/terms-of-service (새 탭)
[✓] 개인정보 수집 및 이용 동의 (필수)      name=agree03 id=privacyCconsent required  → › 링크
[✓] 만 14세 이상입니다 (필수)            name=agree02 id=adult     required
[✓] 마케팅 활용 동의 / 할인쿠폰 수신 (이메일) (선택)  name=customer[note][Email marketing consent]
[✓] 마케팅 활용 동의 / 할인쿠폰 수신 (SMS) (선택)    name=customer[note][sms marketing consent]
```

- 체크박스는 네이티브 인풋을 1×1로 숨기고 라벨 앞 **체크 아이콘형** 커스텀 렌더(개별 항목), 마스터는 사각 박스형. 개별 라벨 15px #616161(gray-600).
- 각 필수 항목 우측에 `a.form-arrow`(9×11 chevron) — 약관 전문 페이지로 새 탭 이동.
- 아래 **법적 고지 회색 박스**: "본인은 만14세 이상이며 … '선택'항목에 동의하지 않아도 서비스 이용이 가능합니다." (개인정보 고지 전문).

### 3.4 제출

- `button[type=submit]` "회원가입" **448×60**, 서버 렌더 시 bg **#BBBBBB**(비활성 시각 상태) — 필수 동의+인증 충족 시 JS로 활성화되는 패턴(활성 색상은 미확인, 제출하지 않음).
- 폼 내 보조 링크: "로그인" → `/account/login`.

---

## 4. 마이페이지 셸

### 4.1 접근 게이트 — 비로그인은 전부 로그인으로 리다이렉트

`/pages/order-list`, `/pages/membership-benefits` 실측: 페이지 로드 직후 JS가 **`/account/login`으로 리다이렉트**(셸을 잠깐 그린 뒤 이동). 별도 "로그인 벽" UI는 없다 — 벽 = 로그인 페이지 그 자체. 서버 HTML에는 로그인 후 볼 셸 전체가 프리렌더되어 있어(게스트 상태 값으로) 아래 구조를 확정할 수 있다.

### 4.2 공통 셸 구조 (서버 렌더 실측, 1440)

```
main#MainContent  (콘텐츠 칼럼 1180px, x=130)
├─ section.ipx-account > .profile-area (small-hide medium-hide … 데스크톱 전용, 높이 120 + 하단 여백 32)
│   ├─ 셀1 620×120  bg #F6F8FA, padding 25 28 … 아바타(스퀘어 캐릭터 svg 72×72 원형) + "OO님, 안녕, 기분 좋은 하루예요!"
│   └─ 셀2(리스트) 560×120 … [멤버십 등급] Ⓜ 아이콘 + 등급 라벨(예: WELCOME, 초록 틴트 배지)
│       + "자세히 보기" 아웃라인 버튼 72×34(1px #DCDEE0, 12px #616161) → /pages/membership-benefits
│       + [좋아요] ♡ + 카운트
├─ section.ipx-account-aside  … 좌측 사이드 메뉴 200×~455 (1px 보더 카드)
└─ section.<콘텐츠>           … 우측 (wish/order/coupon/update 별 섹션)
```

### 4.3 사이드 메뉴(aside) 구성 — 그룹 3개

| 그룹(strong 16px/700) | 항목(15px; 현재 페이지 700 #111, 그 외 400 #616161) | 목적지 |
|---|---|---|
| 나의 쇼핑정보 | 주문/배송 조회 | `/pages/order-list` |
| 나의 계정설정 | 내 정보 수정 | `/pages/update-account` |
| | 배송지관리 | `#accountAddress` (내 정보 수정 페이지 내 앵커) |
| | 멤버십 | `/pages/membership-benefits` |
| | 쿠폰 | `/pages/coupon` |
| 고객센터 | 문의하기 | `#openChat` (채널톡 열기) |

그룹 사이 디바이더. **찜(wish-list)은 aside에 없다** — 헤더/상품 카드의 하트에서 진입.
모바일: aside가 렌더되지 않음(높이 0) — 마이페이지 내비는 데스크톱 전용, 모바일은 계정 아이콘/전체메뉴 경유.

### 4.4 페이지별 콘텐츠 (게스트 서버 렌더 기준)

**주문/배송 조회 `/pages/order-list`** (`ipx-order-history`)
- 상단: 주문 목록(로그인 필요 — 게스트 렌더에서는 Liquid 에러 문자열이 그대로 노출됨: `Array 'customer.orders' is not paginateable`).
- 하단 "주문 후 배송과정" 4단계 다이어그램(`.order-step-wrap`, 데스크톱 전용): 결제완료 → 배송 준비중 → 배송중 → 배송 완료. 단계별 라인 아이콘 + `›` 화살표, 제목 strong 14px, 설명 회색, 하단 **핑크(#F83BAA) 13px 주의문**: "채널톡을 통한 배송지 변경 및 주문 취소만 가능 / 옵션 변경 불가", "배송지 변경 및 주문 취소 불가", "배송완료 후 7일 이내 채널톡을 통해서만 교환 및 반품 가능" — CS가 채널톡 단일 창구.

**찜 `/pages/wish-list`** (`ipx_wish_list`)
- 카운트 탭 2개: `PRODUCT 0`(active) / `BRAND 0`. 빈 상태 `.no-data-wrap` "찜한 브랜드가 없습니다.".

**쿠폰 `/pages/coupon`** (`ipx_mycoupon`) — `detail/05-mypage-coupon-desktop.png`
- 헤더 "쿠폰" 17px/700 + 하단 보더.
- **2열 티켓형 쿠폰 카드**(우변 노치 펀칭). 카드 구성: 등급 배지 → 쿠폰 코드(굵게) → 쿠폰명 → `유효기간 | 값` → `사용조건 | 값(볼드)`.
- 배지 색 체계: WELCOME 초록 / SILVER 회색 / GOLD 옐로 / VIP 퍼플 / **이벤트 핑크**.
- 서버는 전체 쿠폰 카탈로그를 프리렌더(WELCOME, SILVER_5000/10000, GOLD_5000/10000/20000, VIP_5000/10000/20000/50000 + 이벤트 SMR_* — **카트 쿠폰 프리셋·이벤트 가챠 경품과 동일 코드 체계**), JS가 보유분만 남기는 구조. 빈 상태 `.empty_message` "사용 가능한 온라인 쿠폰이 없습니다".
- 하단 회색 안내 박스: "쿠폰 안내"(매월 1일 자동 지급, 온라인 전용, 장바구니 쿠폰 1장 제한, 배송비 제외 적용 등) + "쿠폰교환/반품/취소안내".

**내 정보 수정 `/pages/update-account`** (`ipx_update_account`)
- 블록 순서: 내 정보 수정(Email / 비밀번호 변경 / 이름 / 휴대폰번호 / 생년월일 — 휴대폰은 "본인인증 후 등록하기" 버튼) → **내 주소 관리**(#accountAddress 대상, Shopify customer_address) → **마케팅 정보 수신 동의**(설명문 + 메일 수신동의 / SMS 수신동의 토글 + "저장") → **약관 및 정책**(개인정보처리방침 / 이용약관 링크) → **회원 탈퇴**.
- "광고성 정보 수신 설정 변경 결과 안내" 모달 텍스트 보유(변경 확인 피드백).

**리워드 `/pages/rewards`**
- 별도 템플릿: **aside·프로필 없이** `h1` "Rewards"(52px/700)만 있는 빈 플레이스홀더 페이지. 실기능 없음.

### 4.5 모바일 전체메뉴 `/pages/menu` (`ipx-mobile-menu`)

모바일 햄버거의 목적지가 오버레이가 아니라 **독립 페이지**. 구성: 상단 "로그인/회원가입"(→ /account/login) + 인사문구 + 카트 링크 → GNB 아코디언(베스트/신제품/카테고리/K-POP/이벤트/브랜드/SALE) → LANGUAGE → 메뉴별 하위 패널(예: 이벤트 전체보기 + 진행중 아티클 링크 나열). `detail/05-menu-mobile.png`.

---

## 5. 관찰 요약 (리디자인 참고)

1. **카트가 미니 체크아웃**: 쿠폰 선택(프리셋+수동)·배송메모·GWP 확인이 카트 단계에 있고, 요약 aside 문구까지 서버 데이터로 구동. 확정은 `/checkout` 이동 후.
2. **인증 화면은 플랫 1칼럼(448px) + 검정 CTA + SNS 4종(네이버/카카오/LINE/구글)**. 재설정은 모달이 아니라 :target 스왑.
3. **가입은 본인인증 중심**: 이름/생년월일/성별/전화 전부 인증 결과로 hidden 채움. 폼 자체는 이메일+비번+동의 5종뿐.
4. **마이페이지는 로그인 전용**(게스트는 즉시 로그인으로), 셸 = 프로필 스트립 + 좌 200px 메뉴 + 우 콘텐츠. CS·배송지변경·반품 전부 채널톡 창구로 수렴.
5. 쿠폰 코드 체계(등급·이벤트)가 카트 프리셋, 마이페이지 쿠폰함, 이벤트 가챠 경품에서 **하나의 시스템으로 관통**된다.
