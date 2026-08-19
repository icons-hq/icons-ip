# ICONS 첫 실판매 준비 계획 (First Sale Readiness)

> 상태: Active · 작성 2026-08-06 · 구현 2026-08-07 · 현재 진실원 갱신 2026-08-18 · 근거: 그릴링 세션(범위 확정) + 코드베이스 전수 감사
> 대상 마일스톤: **홍실 퀘스트 굿즈 소프트런칭** — v1 출시([`launch-readiness-plan.md`](./launch-readiness-plan.md))와 **별개 마일스톤**이다.
> 이 문서는 **기준선·갭 분석·트랙 구조**의 진실원이다. 각 이슈의 스펙 진실원은 issue body다.
>
> **§3의 갭 분석은 2026-08-06 기준선이다.** 코드가 그 뒤로 움직였으므로 현재 상태는 §8을 본다.
> 기준선을 지우지 않는 이유는 "왜 이 작업을 했는가"의 근거가 거기 있기 때문이다.

---

## 1. 기준선 (확정 결정)

그릴링 세션에서 확정한 결정이다. 각 항목은 이후 갭 분석과 트랙 구조의 전제다.

| # | 결정 | 내용 |
|---|---|---|
| **D1** | **소프트런칭만** | 홍실 퀘스트 굿즈 3종·실재고 판매. 카탈로그 전체 오픈이 아니다. |
| **D2** | **범용 팝업 연동 판매 제외** | 범용 온라인 팝업 운영 레이어와 결합한 판매는 현 로드맵에서 Not Planned다. 19+ 유한 실물 쿠지는 이 프로토타입의 후속이 아니라 #212·#213의 별도 판매 도메인이다. |
| **D3** | **카드 리워드 루프 OFF** | 홍실에 카드·카드풀이 0이라 굿즈 주문 → 뽑기권 발급을 켜지 않는다. 대가로 **수동 뽑기권 발급 어드민 경로**가 필요하다(§3.5). |
| **D4** | **할당 재고 모델** | WMS 실재고 중 ICONS 판매용 물량을 격리하고, 그 물량에 대해 `goods.stock_qty`가 단일 진실원이 된다. → [ADR-0005](./adr/0005-icons-allocated-inventory.md) |
| **D5** | **배송비** | 기본 3,000원 · **5만원 이상 무료** · 반품은 고객 **착불 반송** · 도서산간 추가요금은 보류(H6). 정책값은 단일 상수로 관리하고 변경 시 배포한다. |
| **D6** | **굿즈 상세 = 표준 구성** | 대표 이미지 + 갤러리 최대 4장 + 텍스트 설명 + 상세 이미지 1장 + **고시정보**. 리치 텍스트 에디터는 채택하지 않는다. |
| **D7** | **고시정보 = 고정 컬럼** | 자유 텍스트도 JSONB key-value도 아닌 고정 컬럼. 라벨 붙은 폼 + 필수값 검증이 목적이다. |
| **D8** | **주문 이메일 도입** | 트랜잭션 이메일 인프라를 신설한다. v1의 "인앱 전용" 가정([launch-readiness-plan §6](./launch-readiness-plan.md))을 이 마일스톤에서 뒤집는다. |
| **D9** | **어드민 개선 = 안전장치 + 공통 시각화** | ID 덮어쓰기 방지 + `RecordList` 썸네일 전 섹션 + 내부 구현 노출 필드 정리. 공개화면 미리보기는 **굿즈만** 예외로 포함. |
| **D10** | **배송 후 청약철회 = 시스템 경로** | 수동 처리하지 않는다. 기존 청약철회 인프라의 상태 제약을 넓혀 재사용한다. |
| **D11** | **반품 입고 확인은 별도 상태가 아니다** | 운영자의 **승인 행위에 내포**된다. 상태기계를 늘리지 않는다. |
| **D12** | **법무 검토는 게이트가 아니다** | 초안 문서의 검토는 병행한다. 승인된 기본 경계에서는 공개 판매자 정보·통신판매업 신고번호·문의 창구를 [#239](https://github.com/icons-hq/icons-ip/issues/239)에서 확정하기 전 판매 gate를 열지 않는다. 굿즈 public gate는 2026-08-18 사용자 지시로 예외적으로 ON이 됐지만 #239가 해결·면제된 것은 아니다. 2026-08-21 법정 본문 활성화와 취소 운영도 [#207](https://github.com/icons-hq/icons-ip/issues/207)·[#208](https://github.com/icons-hq/icons-ip/issues/208)의 미해결 범위다. |

### 왜 이 마일스톤이 v1 출시와 분리되는가

[`launch-readiness-plan.md`](./launch-readiness-plan.md)는 "v1 기능이 존재하는가"의 진실원이고 대부분 완료 상태다. 이 문서는 "**실제로 돈을 받고 물건을 보낼 수 있는가**"를 다룬다. 두 질문의 답이 다르다. 이 계획을 작성한 2026-08-06에는 사업자 정보 표기·배송비·운송장·굿즈 상세페이지가 없었고, 현재 구현·운영 상태는 §8에서 갱신한다.

---

## 2. 현재 상태

### 2.1 홍실 퀘스트 자산 인벤토리

[`20260804061616_add_hong_sil_quest_catalog.sql`](../supabase/migrations/20260804061616_add_hong_sil_quest_catalog.sql) 기준.

| 자산 | 현황 |
|---|---|
| IP | 1건 — `hong-sil-quest` · `featured: false` · 팬 0 |
| 굿즈 | 3종 — 아크릴 블록 12,000원(`g13`) · 오로라 아크릴 키링 9,000원(`g14`) · 마그넷 인형 세트 27,000원(`g15`) |
| 굿즈 재고 | **3종 전부 `stock='soldout'`, `stock_qty=0`** — 마이그레이션 주석에 "재고 확정 전까지 비판매"로 명시 |
| 이벤트/팝업 | 0건 |
| 카드 · 카드풀 · 게임 | 각 0건 |

**옵션·예약판매 판정**: 3종 모두 단일 SKU 실물이고 사이즈·색상 변형이 없다. 굿즈 옵션(variant)과 예약판매는 이 마일스톤에서 **불필요**하다(§6).

**무료배송 임계 관련 참고**: 3종을 하나씩 담으면 48,000원으로 5만원 임계에 닿지 않는다. 상품 확대를 전제로 임계를 5만원으로 정했다(D5) — 소프트런칭 기간에는 무료배송이 거의 발동하지 않는다는 뜻이다. 의도된 것이다.

### 2.2 이미 배선되어 재사용 가능한 것

- **커머스 코어**: 장바구니 병합, `place_order` 원자적 재고 선점, 15분 pending 만료, 굿즈·티켓 provider-neutral attempt/claim/finalizer, Korpay SDK 인증·승인, 주문 내역·상세. 티켓은 승인 전 개별 티켓/QR을 만들지 않는다. 2026-08-18 굿즈 public gate는 ON, 티켓 gate와 canary는 OFF다.
- **청약철회 인프라**: `order_cancellation_claims` durable claim, orchestrator, 토스 취소 호출, `refunds` 장부, 재고 복원. **배송 전 범위에서만** 동작한다(§3.2).
- **어드민 주문 콘솔**: 상태·기간·쿼리 검색, 주문 항목 조회, 배송 상태 전이, 청약철회 승인/거절. 전부 audited.
- **어드민 카탈로그 콘솔**: IP·굿즈·카드·이벤트·큐레이션 upsert, 아트워크 업로드(**미리보기 있음**), 보관/복원, 멱등 실재고 조정.
- **어드민 카드 리워드 콘솔**: 카드풀 생성·등급별 확률(합계 100% 실시간 검증)·카드 바인딩·발급 정책. **코드 배포 없이 카드팩을 켤 수 있다** — D3을 나중에 뒤집을 때 쓴다.
- **주문번호**: `orderReferenceLabel`이 UUID 뒤 8자리를 대문자로 표시하고([`lib/orders.ts:139`](../lib/orders.ts)), 어드민 검색이 부분 일치로 그 값을 찾는다. **CS 전화 대응 가능 — 갭 아님.**

---

## 3. 갭 분석

### 3.1 법정 (Legal) — 판매 개시 즉시 리스크

| ID | 갭 | 근거 |
|---|---|---|
| **L1** | **사업자 정보 표기가 없다** — 상호·대표자·사업자등록번호·통신판매업신고번호·주소·연락처·호스팅 | [`SiteFooter.tsx`](../components/shell/SiteFooter.tsx) 메타 영역에 `© ICONS`만 |
| **L2** | **이용약관·개인정보처리방침 문서가 없다** — 푸터의 두 항목은 링크가 아닌 `<span>` 텍스트다. 그런데 [온보딩](../components/screens/Onboarding.tsx)에서 동의는 받고 있다 | 동의 대상 문서 부재 |
| **L3** | **상품정보제공고시 항목이 없다** — 소재·크기·제조사·원산지·제조연월·A/S 책임자 | `goods` 스키마에 필드 자체가 없음 |
| **L4** | **계약내용 서면(전자문서) 교부 경로가 인앱뿐** — 앱이 직접 보내는 메일이 0건 | 반면 [`OrderCancellation.tsx`](../components/orders/OrderCancellation.tsx)는 이미 "**서면을 받은 날부터** 7일"을 고지 중 |
| **L5** | **배송·교환/반품 정책 안내 페이지가 없다** | 해당 라우트 없음 |

### 3.2 커머스 (Commerce)

| ID | 갭 | 근거 |
|---|---|---|
| **C1** | **굿즈 상세페이지가 없다** | `app/shop/[id]` 라우트 부재. [`Shop.tsx`](../components/screens/Shop.tsx)의 카드는 `<Link>` 없이 "담기" 버튼만. ⚠️ [PRD §5.3](./PRD.md)은 "굿즈 상세"를 `M`으로 명시하고, [launch-readiness-plan §2](./launch-readiness-plan.md)는 이를 **완료로 오기**했다 |
| **C2** | **굿즈 콘텐츠 스키마가 없다** — 설명·갤러리·상세 이미지 | `goods` 컬럼은 `name/type/price/badge/stock/bg/image_path`가 전부 |
| **C3** | **배송비가 "무료" 하드코딩 3곳** | [Cart](../components/screens/Cart.tsx) · [Checkout](../components/screens/Checkout.tsx) · [OrderDetail](../components/screens/OrderDetail.tsx). DB에 배송비 컬럼 없음 |
| **C4** | **우편번호 검색이 없다** — 5자리 수기 입력 | [`Checkout.tsx`](../components/screens/Checkout.tsx) |
| **C5** | ~~배송 후 청약철회 경로가 없다~~ → #176에서 해소(§8) | `order_cancellation_claims.previous_status check (in ('pending','paid'))`([`order_cancellation_contract.sql`](../supabase/migrations/20260714180001_order_cancellation_contract.sql)). 사용자 UI도 `pending`·`paid`·`canceled` 분기뿐. **배송이 시작되면 사용자도 운영자도 시스템으로 처리할 수 없다** |

> **C5가 특히 위험한 이유**: 실물 커머스 반품의 대부분은 물건을 받아본 뒤 발생한다. 즉 이 경로가 실제 반품의 **주 경로**다. 지금 상태로 반품이 들어오면 토스 콘솔 수동 취소 → DB 수기 정합화가 유일한 방법이고, `refunds` 장부가 비어 정산이 어긋난다.

### 3.3 물류 (Fulfillment)

| ID | 갭 | 근거 |
|---|---|---|
| **F1** | **WMS 연동 표면을 모른다** — 제품명·API 여부·출고 지시 포맷·운송장 회수 경로 | 김단비 과장 확인 필요(§5) |
| **F2** | ~~운송장번호·택배사 필드가 없다~~ → #178에서 수기 경로 해소(§8) | [`lib/admin/orders.ts`](../lib/admin/orders.ts). 고객 배송조회 불가 → CS 100% 수동 |
| **F3** | **할당 재고가 확정되지 않았다** — `stock_qty`가 3종 모두 0 | D4의 격리 물량을 정하고 어드민에서 입력해야 함 |

> **재고 진실원 주의**: ICONS의 `place_order`는 `goods.stock_qty`를 원자적으로 선점하지만, 그 락은 **ICONS 안에서만** 유효하다. WMS는 이 락을 모른다. 두 숫자가 어긋나면 결제 완료 후에 재고 부족이 발견된다. D4의 격리가 이 문제를 코드가 아니라 운영으로 없앤다. → [ADR-0005](./adr/0005-icons-allocated-inventory.md)

### 3.4 알림 (Notifications)

| ID | 갭 | 근거 |
|---|---|---|
| **N1** | **트랜잭션 이메일 인프라가 없다** | Supabase Auth 메일만 존재. 앱이 직접 보내는 메일 0건. L4·F2와 함께 묶인다 |

### 3.5 어드민 (Admin Ops)

전수 감사 결과다. 원인은 "이미지가 안 보인다"보다 넓다 — **운영자에게 내부 구현(ID·CSS·slug·경로)을 노출하는 폼**이 뿌리다.

| ID | 갭 | 해당 | 심각도 |
|---|---|---|---|
| **A1** | **ID 수기 입력 → 중복 시 조용히 덮어씀** | IP(`rilakkuma`) · 굿즈(`g100`) · 카드(`c100`) · 이벤트(`e100`) · 게임(`slug`) **5곳**. 저장은 `on conflict (id) do update set` | **데이터 파손** |
| — | (참고) ID 자동 생성 | 카드풀 · 발급정책 · 큐레이션 · 티켓회차 **4곳** — 일관성 없음 | — |
| **A2** | **"배경 CSS" 자유입력** | IP · 굿즈 · 카드 · 이벤트 **4곳** | 개발지식 요구 |
| **A3** | **색상 hex 자유입력** | 이벤트 `액센트`(`#8B5CFF`) — 컬러피커 없음 | 개발지식 요구 |
| **A4** | **글리프 개행문자 직접 입력** | IP — 홍실은 `홍실\n퀘스트` | 개발지식 요구 |
| **A5** | **내부 경로 수기 입력** | 홈 큐레이션 `이동할 내부 경로` — 오타 시 404 | 운영 사고 |
| **A6** | **slug 개념 노출** | 게임 | 개발지식 요구 |
| **A7** | **목록에 썸네일이 없다** | **전 섹션** — `RecordList`가 텍스트만 | 식별 불가 |
| **A8** | **공개화면 미리보기가 없다** | 전 섹션 | 결과 확인 불가 |
| **A9** | **수동 뽑기권 발급 경로가 없다** | 발급 트리거는 `order_paid` 하나뿐, 소급 발급 불가 | D3의 대가 |

> **A2는 제거 후보**다. 아트워크 업로드가 이미 있고 그라디언트 폴백은 IP 액센트에서 파생할 수 있다. 다만 홍실 3종이 `bg`에 `url(...)`을 쓰고 있어 기존 데이터 호환을 확인한 뒤 제거할지 숨길지 판단한다.
>
> **A8은 굿즈만** 범위에 넣는다(D9). 굿즈 상세페이지를 새로 만드는 중이고, 첫 판매 3종의 상세페이지는 운영자가 판매 전에 반드시 확인해야 한다.

---

## 4. 트랙 구조

[GitHub Project #8](https://github.com/users/sangwopark19/projects/8)에 `Phase: First Sale`을 추가하고 기존 보드에서 관리한다. 새 보드를 만들지 않는다. `Track`에 **Fulfillment**·**Legal**을 추가했고 나머지는 기존 Track을 재사용한다.

에픽은 **[#168](https://github.com/sangwopark19/icons-ip/issues/168)**이다.

| Track | 이슈 | 갭 | Dependency |
|---|---|---|---|
| **Legal** | [#169](https://github.com/sangwopark19/icons-ip/issues/169) 법정 문서 3종 + 라우트 + 푸터 링크 | L2 · L5 | Unblocked |
| | [#170](https://github.com/icons-hq/icons-ip/issues/170) 사업자 정보 표기 컴포넌트 | L1 | 구현 완료 — 실제 값은 #239 |
| | [#239](https://github.com/icons-hq/icons-ip/issues/239) `[human]` 사업자 정보·통신판매 신고·문의 창구 확정 | L1 | Unblocked |
| | [#171](https://github.com/sangwopark19/icons-ip/issues/171) 굿즈 고시정보 스키마 + 어드민 입력 | L3 | Unblocked |
| **Commerce** | [#172](https://github.com/sangwopark19/icons-ip/issues/172) 굿즈 상세 콘텐츠 스키마 + 어드민 입력 | C2 | Unblocked |
| | [#173](https://github.com/sangwopark19/icons-ip/issues/173) **굿즈 상세페이지 `/shop/[goodId]`** | C1 | **Blocked** — #172·#171 |
| | [#174](https://github.com/sangwopark19/icons-ip/issues/174) 배송비 도입 (`orders.shipping_fee` 스냅샷) | C3 | Unblocked |
| | [#175](https://github.com/sangwopark19/icons-ip/issues/175) 우편번호 검색 도입 | C4 | Unblocked |
| | [#176](https://github.com/sangwopark19/icons-ip/issues/176) **배송 후 청약철회 경로** | C5 | Unblocked |
| **Fulfillment** | [#177](https://github.com/sangwopark19/icons-ip/issues/177) `[human]` 물류 연동 사양 확인 (H1~H7) | F1 | Unblocked |
| | [#178](https://github.com/sangwopark19/icons-ip/issues/178) 운송장 등록·조회 | F2 | 수기 경로는 착수 가능 → 구현 완료 |
| | [#179](https://github.com/icons-hq/icons-ip/issues/179) `[human]` 할당 재고 확정 + `stock_qty` 입력 | F3 | **Blocked** — #177 · #190 |
| **Notifications** | [#180](https://github.com/sangwopark19/icons-ip/issues/180) 트랜잭션 이메일 인프라 + 템플릿 2종 | N1 · L4 | Unblocked |
| **Admin Ops** | [#181](https://github.com/sangwopark19/icons-ip/issues/181) **ID 덮어쓰기 방지 5곳** (`bug`) | A1 | Unblocked |
| | [#182](https://github.com/sangwopark19/icons-ip/issues/182) `RecordList` 썸네일 전 섹션 | A7 | Unblocked |
| | [#183](https://github.com/sangwopark19/icons-ip/issues/183) 내부 구현 노출 필드 정리 | A2~A6 | Unblocked |
| | [#184](https://github.com/sangwopark19/icons-ip/issues/184) 굿즈 상세 미리보기 | A8 | **Blocked** — #173 |
| | [#185](https://github.com/sangwopark19/icons-ip/issues/185) 수동 뽑기권 발급 경로 | A9 | Unblocked |

### 4.1 의존성과 순서

```
#177 [human] H1~H7 (김단비) ──┬─→ #178 운송장 등록·조회
                              └─→ #179 할당 재고 확정 ──→ 판매 개시
#239 [human] 사업자 정보·문의 창구 ─→ 푸터·법정 문서 표기 ─→ 판매 개시
#87  [resolved] Korpay 계약·credential 확인 ─→ #207 Korpay rollout·canary ─→ 판매 개시
                                                    └─→ #208 수동 취소·모호 결제 운영

#172 굿즈 콘텐츠 스키마 ──┬─→ #173 굿즈 상세페이지 ──→ #184 굿즈 상세 미리보기
#171 고시정보 스키마 ─────┘

#180 이메일 인프라 ──┬─→ 주문확인 템플릿 (L4)
                     └─→ 배송시작 템플릿 (#178과 연동)
```

**병렬 착수 가능**(`Dependency: Unblocked`): #169 · #171 · #172 · #174 · #175 · #176 · #180 · #181 · #182 · #183 · #185.

**착수 불가**(사람 응답 대기): 사업자 정보 데이터 · WMS 연동 방식 · 할당 재고 수량.

> 운송장 입력의 **어드민 수기 필드 자체**는 H1~H7 없이도 만들 수 있다. WMS가 API를 제공하는 것으로 밝혀지면 그때 자동화하고, 수기 필드는 폴백으로 남긴다.

#### 정정 — `#179 → 판매 개시`는 한 단계가 아니다 (2026-08-10 실측)

위 그래프는 할당 수량만 확정되면 굿즈가 팔린다고 그렸지만, 굿즈를 판매 가능 상태로 만드는 데는 **두 개의 독립된 쓰기 경로**가 필요하다.

| 대상 | 경로 | 고시정보 검증 |
|---|---|---|
| `stock_qty` | 어드민 실재고 조정 → `admin_adjust_stock` | 없음 |
| `stock` 라벨 (`soldout`→`ok`) | 어드민 굿즈 등록·수정 폼 → `admin_upsert_good` | **7항목 전부 필수** |

`admin_adjust_stock`은 `set stock_qty = ...` 하나만 하고 `stock` 텍스트 컬럼을 건드리지 않는다. 굿즈 폼은 고시정보가 한 항목이라도 비면 저장을 거부한다(`lib/admin/catalog.ts`의 `readGoodsNotice` — L3에서 의도적으로 넣은 법정 표기 가드). 그리고 구매 버튼은 **둘 다** 통과해야 열린다 — `good.stock === 'soldout' || good.stockQty <= 0`이면 비활성(`components/shop/AddToCartButton.tsx`).

고시정보 7항목과 A/S 연락처는 #190에서 제품·운영 담당자가 직접 확정한다. #239의 공개 문의 창구와 같은 번호를 쓰려면 먼저 확정된 값을 다른 쪽에 맞추되, 두 이슈를 서로 `Blocked`로 만들지는 않는다. 실제 사슬은 이렇다.

```
#190 고시정보·콘텐츠·A/S 연락처 ─→ 굿즈 폼 저장 ─→ stock='ok' ─────────────┐
                                                                            ├─→ 구매 버튼 활성
#177 (H 전체) ─→ #179 할당 수량·WMS 격리 ─→ stock_qty > 0 ─────────────────┘
```

즉 **#179는 #177과 #190에 막혀 있고 Korpay 계약에는 종속되지 않는다.** Korpay 계약 완료와 현재 자격 증명 사용 가능 상태는 2026-08-14 확인됐으며, #239는 공개 판매자 정보·문의 창구 전용이다.

---

## 5. `[human]` 게이트

에이전트가 코드로 풀 수 없고, 답이 와야 설계가 확정되는 항목이다.

### 5.1 김단비 과장(카카오팀) 확인 — [#177](https://github.com/sangwopark19/icons-ip/issues/177)

물류 스택: **김포 창고 · 한진택배 · WMS 사용**(2026-08-06 확인).

| # | 확인 항목 | 무엇이 막혀 있나 |
|---|---|---|
| **H1** | WMS 제품명과 연동 표면 — API / 엑셀 업로드 / 수기 중 무엇인가 | F2 설계 전체 |
| **H2** | 한진 운송장 발급 주체와 번호 회수 경로 — ICONS가 언제 어떻게 받는가 | F2 |
| **H3** | 출고 지시 전달 방법 — 주문 정보를 WMS에 어떤 포맷으로 넘기는가 | F2 |
| **H4** | 김포 창고 출고 마감 시각·휴무일 | 배송 소요일 안내 문구(L5·C1) |
| **H5** | 반품 입고 주소와 절차 | L5 정책 문서 · C5 승인 흐름 |
| **H6** | 도서산간·제주 배송 가능 여부와 추가 요금 | D5의 보류 항목 |
| **H7** | **WMS 운영사 법인명** | 개인정보처리방침 **처리위탁** 항목(L2) |

> H7 주의: 개인정보처리방침의 처리위탁 목록에 **한진택배와 WMS 운영사**를 명시해야 한다. 법인명을 모르면 문서를 완성할 수 없다.

### 5.2 분리된 확인 항목

- **[#87](https://github.com/icons-hq/icons-ip/issues/87)** — 2026-08-14 사용자 확인으로 Korpay 계약 완료와 현재 운영 credential 사용 가능 상태가 확정됐다. 이는 공급사 서면 증거나 19+ 유한 실물 쿠지 승인이 아니다. 공개 전환 뒤 결제·원장 readback과 법정 본문 활성화는 #207, 문서화된 자동 취소 API가 없는 거래의 수동 운영은 #208이 추적한다. 기존 Toss는 알려진 legacy 거래 정리용으로만 보존한다.
- **[#239](https://github.com/icons-hq/icons-ip/issues/239)** — 상호·대표자·사업자등록번호·통신판매업 신고번호·주소·전화·이메일과 인앱 주문 상세의 서면 교부 충족 여부. 이 법적 판단과 별개로 D8과 #168은 #191 이메일 운영 활성화를 첫판매 크리티컬 패스로 유지한다.
- **[#190](https://github.com/icons-hq/icons-ip/issues/190)** — 홍실 3종 고시정보·상세 콘텐츠와 A/S 연락처. 대표 전화 또는 별도 고객센터 번호를 이 이슈에서 확정하고 #239의 공개 문의 창구와 일치시킨다.

---

## 6. 명시적 제외

이 마일스톤에서 하지 않는다. 각각 근거를 남긴다.

| 제외 항목 | 근거 |
|---|---|
| **카드 리워드 루프** | D3. 홍실에 카드가 0장. 어드민에서 코드 배포 없이 켤 수 있으므로 나중에 붙인다. 대신 A9(수동 발급)를 넣는다 |
| **범용 온라인 팝업 연동 판매** | D2. 현 로드맵에서 Not Planned. legacy 프로토타입을 활성화하지 않는다 |
| **굿즈 옵션(사이즈·색상)** | 홍실 3종이 전부 단일 SKU. YAGNI |
| **예약판매(프리오더)** | 첫 판매는 실재고. 입고예정일·순차배송 로직 불필요 |
| **부분 취소·부분 환불** | [`toss-api.ts`](../lib/payments/toss-api.ts)의 `cancelTossPayment`가 `cancelAmount` 없이 전액 취소 고정. D5의 착불 반송이 이를 우회한다. 부분환불을 지으려면 API·DB 인덱스·UI를 전부 고쳐야 하는데 소프트런칭 반품 건수로는 값을 못 한다 |
| **도서산간·제주 추가 요금** | H6 대기. 권역 판정 로직과 요금표가 필요한데 SKU 3종에는 과하다. 정책 페이지에 별도 안내로 처리 |
| **Q&A(공개 상품문의)** | 전환 기여는 크지만 판매 개시 블로커가 아니다. UGC 모더레이션 부담도 따라온다. 비공개 1:1 문의는 #253으로 열렸고, **리뷰는 "리뷰가 있어야 사람들이 구매한다"는 사용자 결정으로 이 표에서 빠져 v1 범위로 옮겼다**(#254, PRD §5.3) |
| **재입고 알림** | 첫 판매는 한정 수량 소진 모델. 재입고 자체가 미정 |
| **쿠폰 · 할인** | 정가 판매. 할인 도메인이 통째로 없다 |
| **묶음배송 · 분리배송** | 단일 창고·단일 출고 |
| **배송비 어드민 토글** | D5. 단일 상수로 두고 변경 시 배포. 상품이 늘고 임계를 자주 손대게 되면 그때 승격 |
| **반품 입고 확인 상태** | D11. 운영자 승인 행위에 내포. 물량이 붙으면 분리 검토 |
| **전 섹션 공개화면 미리보기** | D9. 섹션마다 다른 공개 컴포넌트를 재사용해야 해 섹션당 작업이 따로 붙는다. 굿즈만 예외 |

---

## 7. 별도 후속 기록

- **19+ 유한 실물 쿠지** — 범용 팝업 연동 판매나 legacy 게임 `goods` variant가 아니다. 예약→결제→개별 실물 unit 배정은 [#212](https://github.com/icons-hq/icons-ip/issues/212), 공개 잔여 확률·last-one·영수증·운영은 [#213](https://github.com/icons-hq/icons-ip/issues/213)에서 별도 추적한다. 일반 홍실 굿즈 첫 판매와도 판매 단위를 합치지 않는다.
- **물류 API 자동화** — 주문 → 출고 지시 → 운송장 회수 → 배송 상태를 전부 API로 잇는 방향. 첫 판매의 수기 운영에서 나온 실제 요구사항을 스펙 근거로 쓴다.
- **재고 공유 모델 전환** — [ADR-0005](./adr/0005-icons-allocated-inventory.md)의 할당 모델을 WMS 실시간 동기화로 바꾸는 것. 판매 채널이 늘면 필요해진다.

---

## 8. 구현 현황 (2026-08-07 구현 · 2026-08-10 실측 · 2026-08-18 진실원 갱신)

§3의 갭 중 에이전트가 코드로 풀 수 있는 것은 전부 닫혔다. 남은 것은 사람 응답에 종속된 항목뿐이다.

| 갭 | 이슈 | 상태 | 남은 것 |
|---|---|---|---|
| L2 · L5 법정 문서 3종 | [#169](https://github.com/sangwopark19/icons-ip/issues/169) | 구현 | 법무 검토 병행(D12) · WMS 운영사 법인명(H7) |
| L1 사업자 정보 표기 | [#170](https://github.com/icons-hq/icons-ip/issues/170) | 구조 구현 · **값 공백** | 공개 판매자 정보 7종과 문의 창구 → [#239](https://github.com/icons-hq/icons-ip/issues/239) |
| L3 고시정보 | [#171](https://github.com/sangwopark19/icons-ip/issues/171) | 구현 | 홍실 3종 실제 값 입력 → [#190](https://github.com/sangwopark19/icons-ip/issues/190) |
| C2 굿즈 콘텐츠 스키마 | [#172](https://github.com/sangwopark19/icons-ip/issues/172) | 구현 | 홍실 3종 이미지·설명 입력 → [#190](https://github.com/sangwopark19/icons-ip/issues/190) |
| C1 굿즈 상세페이지 | [#173](https://github.com/sangwopark19/icons-ip/issues/173) | 구현 | — |
| C3 배송비 | [#174](https://github.com/sangwopark19/icons-ip/issues/174) | 구현 | 도서산간 추가요금(H6) |
| C4 우편번호 검색 | [#175](https://github.com/sangwopark19/icons-ip/issues/175) | 구현 | — |
| C5 배송 후 청약철회 | [#176](https://github.com/sangwopark19/icons-ip/issues/176) | 구현 | 반품 입고 주소·절차(H5) |
| F2 운송장 등록·조회 | [#178](https://github.com/sangwopark19/icons-ip/issues/178) | **수기 경로만** 구현 | WMS 자동 수신(H1~H3) |
| F3 할당 재고 | [#179](https://github.com/sangwopark19/icons-ip/issues/179) | 미착수 | `stock_qty` 확정(H 전체) · `stock` 전환은 [#190](https://github.com/sangwopark19/icons-ip/issues/190) 선행(§4.1 정정) |
| N1 · L4 트랜잭션 이메일 | [#180](https://github.com/icons-hq/icons-ip/issues/180) · [#230](https://github.com/icons-hq/icons-ip/pull/230) | legacy 경로 유지 · Send Email Hook dark path 기본 OFF 배포 | 발신 도메인·키 rotation/drain·Production secret·Hook/readback·실수신 증거 → [#191](https://github.com/icons-hq/icons-ip/issues/191) |
| A1 ID 덮어쓰기 | [#181](https://github.com/sangwopark19/icons-ip/issues/181) | 구현 | — |
| A7 목록 썸네일 | [#182](https://github.com/sangwopark19/icons-ip/issues/182) | 구현 | — |
| A2~A6 내부 구현 필드 | [#183](https://github.com/sangwopark19/icons-ip/issues/183) | 구현 | — |
| A8 굿즈 미리보기 | [#184](https://github.com/sangwopark19/icons-ip/issues/184) | 구현 | — |
| A9 수동 뽑기권 발급 | [#185](https://github.com/sangwopark19/icons-ip/issues/185) | 구현 | — |

### 8.1 판매 개시를 아직 막는 것

아래 사람·운영 데이터 블로커와 결제 rollout 증거가 모두 필요하다. 2026-08-10에 프로덕션 `goods`와 Vercel production env를 직접 확인했고, 2026-08-14 결제 provider 전환 계약을 §8.3에 갱신했다. #87의 계약·credential human gate는 같은 날 사용자 확인으로 해소했으며 아래 미해결 블로커에 포함하지 않는다.

1. **[#239](https://github.com/icons-hq/icons-ip/issues/239)** — 공개 판매자 정보 7종·통신판매업 신고가 비어 있어 푸터와 법정 문서의 사업자 정보 표기를 완료할 수 없다. 문의 창구 중 **인앱 채널은 [#253](https://github.com/icons-hq/icons-ip/issues/253)의 1:1 문의(`/my/inquiries`)가 제공**하며 법정 문서 본문이 이 경로를 가리킨다(2026-08-18 개정). 비로그인 이용자와 기관 조회용 공개 연락처는 여전히 #239의 범위다.
2. **[#177](https://github.com/icons-hq/icons-ip/issues/177)** — H1~H7. 특히 H7(WMS 운영사 법인명)이 없으면 개인정보처리방침의 처리위탁 목록을 완성할 수 없다.
3. **[#190](https://github.com/icons-hq/icons-ip/issues/190)** — 홍실 3종의 고시정보 7항목 × 3 = **21칸이 전부 공백**이고 설명·갤러리·상세 이미지도 없다. A/S 연락처는 이 이슈에서 확정하며 Korpay 계약과 무관하다.
4. **[#179](https://github.com/icons-hq/icons-ip/issues/179)** — #177의 WMS 격리 계약과 #190의 필수 고시정보가 필요하다. 홍실 3종이 전부 `stock='soldout'`·`stock_qty=0`이라 지금은 아무것도 팔리지 않는다.
5. **[#191](https://github.com/icons-hq/icons-ip/issues/191)** — legacy Supabase custom SMTP의 `no-reply@iconsip.com` Gmail 수신과 SPF·DKIM·DMARC pass는 확인됐다. 그러나 dark outbox/Hook은 기본 OFF이고, 승인된 TTL·HMAC rotation/drain·Production secrets·최종 DNS/From/Reply-To readback·Hook enable·Auth 4흐름과 secure email change 2메일·탈퇴 통지·webhook canary·direct SMTP 0 증거가 없다. D8과 #168에 따라 첫판매 크리티컬 패스로 유지하며, #239는 서면 교부의 법적 충분성을 별도로 확인한다.
6. **[#207](https://github.com/icons-hq/icons-ip/issues/207)** — 굿즈·티켓 Korpay 인증·승인 경로가 연결됐고 2026-08-18 굿즈 public gate를 ON으로 배포했다. 티켓 gate와 canary는 OFF이며, 실제 결제·원장 readback과 2026-08-21 법정 본문 활성화가 남아 있다. 취소와 모호 결과는 #208 수동 운영 증거가 필요하다.

### 8.2 #178에서 남긴 범위

이슈 범위 4번(배송 시작 이메일에 운송장 포함)은 이메일 인프라([#180](https://github.com/sangwopark19/icons-ip/issues/180))에서 배선했다. WMS 자동 수신은 #177의 실제 연동 표면과 수기 운영 증거가 모인 뒤 별도 이슈로 만든다(§7). 폐기한 범용 팝업 범위에 종속하지 않는다.

### 8.3 결제 provider 전환 절차

- provider-neutral 원장(#204)은 기존 Production 결제 2건을 `provider=toss`로 backfill하고 민감 provider 증거를 private 원장으로 분리한다.
- #205와 #206에서 굿즈·티켓 checkout을 공통 seam으로 옮기고 실제 provider를 기본 OFF로 닫았다. Toss는 기존 거래 정리에만 남기며 신규 Toss live key·신규 공개 판매를 활성화하지 않는다.
- Korpay 계약 완료와 현재 운영 credential 사용 가능 상태는 2026-08-14 사용자 확인으로 확정됐다. 이는 공급사 서면 증거나 19+ 유한 실물 쿠지 승인 범위가 아니다. 구현은 인증결제 가이드 v1.2.2와 `@korpay/sdk` 1.1.8의 prepare SDK → form-urlencoded callback → confirm 계약을 따른다.
- 실자격 증명은 Production에만 sensitive 값으로 두고 Preview/CI에는 넣지 않는다. 목적별 gate 기본값은 OFF지만 2026-08-18 Production 굿즈 gate는 ON, 티켓 gate와 canary는 OFF다. gate를 내려도 이미 durable한 known callback은 계속 drain한다.
- 공식 가이드에는 자동 status/reconcile/cancel API가 문서화되어 있지 않다. 모호 결과는 자동 재시도하지 않고 `needs_review`로 보존하며 취소는 #208 수동 운영 절차를 따른다.
- 굿즈는 활성 admin이 공급사 원장에서 opaque 주문번호·금액의 전액 취소 완료를 확인한 뒤에만 DB claim/finalizer로 환불 장부·주문·재고를 멱등 종결한다. 이 경로는 공급사 취소를 실행하거나 모호한 승인을 재구성하지 않으며, 실제 접수 채널·직원 인계·모호 승인 처리는 #208에 남는다.
- 공개 전환 뒤 실제 결제 검증도 정확한 대상·금액·사용자·취소 계획을 고정하고 과금 직전에 다시 사용자 확인을 받는다. 공개 gate ON은 2026-08-21 법정 본문 활성화나 #208의 취소·모호 승인 운영을 대신하지 않는다.
- 기존 Toss 거래는 공급사 콘솔과 내부 원장에서 모두 종결될 때까지 known-only 조회·취소·웹훅과 server secret을 유지한다. 그 뒤 Toss runtime/secret 제거는 별도 PR이다.

### 8.4 담당자별 확인서

남은 사람 의존성을 추측값으로 채우지 않도록 답변 주체별 확인서를 분리했다. 회신은 각 이슈의 완료 근거가 되며, API 키·시크릿·비밀번호는 문서나 GitHub 이슈에 기록하지 않는다.

| 담당자 | 확인서 | 연결 이슈 |
|---|---|---|
| 사업자·법무 담당자 | [첫 실판매 사업자·법무 확인서](./questionnaires/first-sale-business-legal.md) | [#239](https://github.com/icons-hq/icons-ip/issues/239) |
| 카카오팀 김단비 과장님·WMS 물류 담당자 | [첫 실판매 물류·WMS 확인서](./questionnaires/first-sale-logistics-wms.md) | [#177](https://github.com/icons-hq/icons-ip/issues/177) · [#179](https://github.com/icons-hq/icons-ip/issues/179) |
| 홍실 퀘스트 굿즈 제작·MD 담당자 | [홍실 퀘스트 굿즈 운영 데이터 확인서](./questionnaires/first-sale-goods-data.md) | [#190](https://github.com/icons-hq/icons-ip/issues/190) |
| iconsip.com 도메인·이메일 인프라 담당자 | [트랜잭션 이메일 인프라 확인서](./questionnaires/first-sale-transactional-email.md) | [#191](https://github.com/icons-hq/icons-ip/issues/191) |

확인서는 2026-08-11에 작성돼 아직 회신이 없다. 사업자·법무 확인서의 `토스페이먼츠` 섹션은 2026-08-14 Korpay 전환 이후 historical이라 답변 대상이 아니다.

---

## 9. 가정

- 배송 실행 주체는 사내 물류(김포 창고)다. 3PL 위탁도 IP사 직배송도 아니다.
- 첫 판매 기간에는 ICONS 할당 재고를 다른 채널이 건드리지 않는다(D4의 전제).
- callback body와 클라이언트 성공 신호는 결제 확정의 진실원이 아니다. Toss는 알려진 기존 거래만 provider 재조회·웹훅으로 정리하고, 신규 Korpay는 서버 confirm의 엄격한 응답 검증과 DB 멱등 finalizer를 사용한다. 문서화되지 않은 reconcile/cancel endpoint를 가정하지 않는다. 돈·재고는 Postgres RPC + 행 잠금 + 멱등([`AGENTS.md`](../AGENTS.md) 불변).
- 법무 검토는 판매 개시를 막지 않는다(D12). 개인정보처리방침은 코드에서 추출한 **사실 기술**이라 내용 리스크가 낮고, 이용약관은 공정위 표준약관 기반이라 골격 리스크가 낮다는 판단이다.
