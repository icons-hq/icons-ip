# ICONS 첫 실판매 준비 계획 (First Sale Readiness)

> 상태: Active · 작성 2026-08-06 · 구현 2026-08-07 · 근거: 그릴링 세션(범위 확정) + 코드베이스 전수 감사
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
| **D2** | **팝업 연동 판매 제외** | 온라인 팝업과 묶은 판매는 프로토타입이 완성도 있게 붙는 시점까지 미룬다. [#115](https://github.com/sangwopark19/icons-ip/issues/115) 에픽에 기록만 한다. |
| **D3** | **카드 리워드 루프 OFF** | 홍실에 카드·카드풀이 0이라 굿즈 주문 → 뽑기권 발급을 켜지 않는다. 대가로 **수동 뽑기권 발급 어드민 경로**가 필요하다(§3.5). |
| **D4** | **할당 재고 모델** | WMS 실재고 중 ICONS 판매용 물량을 격리하고, 그 물량에 대해 `goods.stock_qty`가 단일 진실원이 된다. → [ADR-0005](./adr/0005-icons-allocated-inventory.md) |
| **D5** | **배송비** | 기본 3,000원 · **5만원 이상 무료** · 반품은 고객 **착불 반송** · 도서산간 추가요금은 보류(H6). 정책값은 단일 상수로 관리하고 변경 시 배포한다. |
| **D6** | **굿즈 상세 = 표준 구성** | 대표 이미지 + 갤러리 최대 4장 + 텍스트 설명 + 상세 이미지 1장 + **고시정보**. 리치 텍스트 에디터는 채택하지 않는다. |
| **D7** | **고시정보 = 고정 컬럼** | 자유 텍스트도 JSONB key-value도 아닌 고정 컬럼. 라벨 붙은 폼 + 필수값 검증이 목적이다. |
| **D8** | **주문 이메일 도입** | 트랜잭션 이메일 인프라를 신설한다. v1의 "인앱 전용" 가정([launch-readiness-plan §6](./launch-readiness-plan.md))을 이 마일스톤에서 뒤집는다. |
| **D9** | **어드민 개선 = 안전장치 + 공통 시각화** | ID 덮어쓰기 방지 + `RecordList` 썸네일 전 섹션 + 내부 구현 노출 필드 정리. 공개화면 미리보기는 **굿즈만** 예외로 포함. |
| **D10** | **배송 후 청약철회 = 시스템 경로** | 수동 처리하지 않는다. 기존 청약철회 인프라의 상태 제약을 넓혀 재사용한다. |
| **D11** | **반품 입고 확인은 별도 상태가 아니다** | 운영자의 **승인 행위에 내포**된다. 상태기계를 늘리지 않는다. |
| **D12** | **법무 검토는 게이트가 아니다** | 초안으로 판매를 개시하고 검토는 병행한다. 사업자 정보만 [#87](https://github.com/sangwopark19/icons-ip/issues/87)에 종속된다. |

### 왜 이 마일스톤이 v1 출시와 분리되는가

[`launch-readiness-plan.md`](./launch-readiness-plan.md)는 "v1 기능이 존재하는가"의 진실원이고 대부분 완료 상태다. 이 문서는 "**실제로 돈을 받고 물건을 보낼 수 있는가**"를 다룬다. 두 질문의 답이 다르다 — 커머스 기능은 전부 배선됐지만 사업자 정보 표기도, 배송비도, 운송장도, 굿즈 상세페이지도 없다.

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

- **커머스 코어**: 장바구니 병합, `place_order` 원자적 재고 선점, 15분 pending 만료, 토스 결제위젯, 웹훅 확정, 주문 내역·상세.
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
| | [#170](https://github.com/sangwopark19/icons-ip/issues/170) 사업자 정보 표기 컴포넌트 | L1 | **Blocked** — #87 |
| | [#171](https://github.com/sangwopark19/icons-ip/issues/171) 굿즈 고시정보 스키마 + 어드민 입력 | L3 | Unblocked |
| **Commerce** | [#172](https://github.com/sangwopark19/icons-ip/issues/172) 굿즈 상세 콘텐츠 스키마 + 어드민 입력 | C2 | Unblocked |
| | [#173](https://github.com/sangwopark19/icons-ip/issues/173) **굿즈 상세페이지 `/shop/[goodId]`** | C1 | **Blocked** — #172·#171 |
| | [#174](https://github.com/sangwopark19/icons-ip/issues/174) 배송비 도입 (`orders.shipping_fee` 스냅샷) | C3 | Unblocked |
| | [#175](https://github.com/sangwopark19/icons-ip/issues/175) 우편번호 검색 도입 | C4 | Unblocked |
| | [#176](https://github.com/sangwopark19/icons-ip/issues/176) **배송 후 청약철회 경로** | C5 | Unblocked |
| **Fulfillment** | [#177](https://github.com/sangwopark19/icons-ip/issues/177) `[human]` 물류 연동 사양 확인 (H1~H7) | F1 | Unblocked |
| | [#178](https://github.com/sangwopark19/icons-ip/issues/178) 운송장 등록·조회 | F2 | 수기 경로는 착수 가능 → 구현 완료 |
| | [#179](https://github.com/sangwopark19/icons-ip/issues/179) `[human]` 할당 재고 확정 + `stock_qty` 입력 | F3 | **Blocked** — #177 |
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
#87  [human] 토스·신고 ────────→ #170 사업자 정보 표기 ──→ 판매 개시

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

고시정보 7항목 중 **A/S 연락처**가 #87 의존이므로, 실제 사슬은 이렇다.

```
#87 (연락처 확정) ─→ #190 고시정보 asContact ─→ 굿즈 폼 저장 ─→ stock='ok' ─┐
                                                                            ├─→ 구매 버튼 활성
#177 (H 전체) ─→ #179 할당 수량 ─→ 실재고 조정 ─→ stock_qty > 0 ───────────┘
```

즉 **#179는 #177뿐 아니라 #87에도 막혀 있다.** 나머지 6개 고시 항목(제조사·원산지·소재·크기중량·제조연월·A/S 책임자)은 굿즈 제작 정보라 #87 없이 먼저 모을 수 있다.

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

### 5.2 기존 이슈에 추가할 확인 항목

**[#87](https://github.com/sangwopark19/icons-ip/issues/87)** — 토스페이먼츠 상점 계약·라이브 키·통신판매업 신고 ([확인 요청 코멘트](https://github.com/sangwopark19/icons-ip/issues/87#issuecomment-5201806579))
- 사업자 정보 표기용 데이터 6종(상호·대표자·사업자등록번호·통신판매업신고번호·주소·연락처)
- **"인앱 주문 상세가 전자상거래법상 서면 교부로 충분한가"** — "아니오"면 D8의 이메일이 판매 개시 필수가 된다
- **A/S 연락처를 대표 전화와 같게 쓸 것인가, 고객센터를 따로 둘 것인가** — 고시정보 7항목 중 하나다. 이 답이 없으면 굿즈 폼이 저장되지 않아 `stock` 전환이 막힌다(§4.1 정정 · [#190](https://github.com/sangwopark19/icons-ip/issues/190))
- 라이브 키를 발급받은 뒤 Vercel에 적용하는 절차는 §8.3에 있다 — 키 교체만으로는 빌드가 통과하지 않는다

---

## 6. 명시적 제외

이 마일스톤에서 하지 않는다. 각각 근거를 남긴다.

| 제외 항목 | 근거 |
|---|---|
| **카드 리워드 루프** | D3. 홍실에 카드가 0장. 어드민에서 코드 배포 없이 켤 수 있으므로 나중에 붙인다. 대신 A9(수동 발급)를 넣는다 |
| **온라인 팝업 연동 판매** | D2. 프로토타입 단계. [#115](https://github.com/sangwopark19/icons-ip/issues/115)에 기록 |
| **굿즈 옵션(사이즈·색상)** | 홍실 3종이 전부 단일 SKU. YAGNI |
| **예약판매(프리오더)** | 첫 판매는 실재고. 입고예정일·순차배송 로직 불필요 |
| **부분 취소·부분 환불** | [`toss-api.ts`](../lib/payments/toss-api.ts)의 `cancelTossPayment`가 `cancelAmount` 없이 전액 취소 고정. D5의 착불 반송이 이를 우회한다. 부분환불을 지으려면 API·DB 인덱스·UI를 전부 고쳐야 하는데 소프트런칭 반품 건수로는 값을 못 한다 |
| **도서산간·제주 추가 요금** | H6 대기. 권역 판정 로직과 요금표가 필요한데 SKU 3종에는 과하다. 정책 페이지에 별도 안내로 처리 |
| **리뷰 · Q&A** | 전환 기여는 크지만 판매 개시 블로커가 아니다. UGC 모더레이션 부담도 따라온다 |
| **재입고 알림** | 첫 판매는 한정 수량 소진 모델. 재입고 자체가 미정 |
| **쿠폰 · 할인** | 정가 판매. 할인 도메인이 통째로 없다 |
| **묶음배송 · 분리배송** | 단일 창고·단일 출고 |
| **배송비 어드민 토글** | D5. 단일 상수로 두고 변경 시 배포. 상품이 늘고 임계를 자주 손대게 되면 그때 승격 |
| **반품 입고 확인 상태** | D11. 운영자 승인 행위에 내포. 물량이 붙으면 분리 검토 |
| **전 섹션 공개화면 미리보기** | D9. 섹션마다 다른 공개 컴포넌트를 재사용해야 해 섹션당 작업이 따로 붙는다. 굿즈만 예외 |

---

## 7. 후속 기록 (Post-launch)

[#115](https://github.com/sangwopark19/icons-ip/issues/115) 에픽에 [코멘트로 남겼다](https://github.com/sangwopark19/icons-ip/issues/115#issuecomment-5201802999).

- **홍실 팝업 연동 판매(C방식)** — 온라인 팝업 기간에 그 IP 굿즈를 파는 형태. 이벤트·게임·카드풀이 전부 필요하다. 프로토타입([PR #167](https://github.com/sangwopark19/icons-ip/pull/167), draft·머지 금지)이 완성도 있게 붙는 시점에 도입한다.
- **물류 API 자동화** — 주문 → 출고 지시 → 운송장 회수 → 배송 상태를 전부 API로 잇는 방향. 첫 판매의 수기 운영에서 나온 실제 요구사항을 스펙 근거로 쓴다.
- **재고 공유 모델 전환** — [ADR-0005](./adr/0005-icons-allocated-inventory.md)의 할당 모델을 WMS 실시간 동기화로 바꾸는 것. 판매 채널이 늘면 필요해진다.

---

## 8. 구현 현황 (2026-08-07 구현 · 2026-08-10 실측 갱신 · 2026-08-11 결제 키 갱신)

§3의 갭 중 에이전트가 코드로 풀 수 있는 것은 전부 닫혔다. 남은 것은 사람 응답에 종속된 항목뿐이다.

| 갭 | 이슈 | 상태 | 남은 것 |
|---|---|---|---|
| L2 · L5 법정 문서 3종 | [#169](https://github.com/sangwopark19/icons-ip/issues/169) | 구현 | 법무 검토 병행(D12) · WMS 운영사 법인명(H7) |
| L1 사업자 정보 표기 | [#170](https://github.com/sangwopark19/icons-ip/issues/170) | 구조 구현 · **값 공백** | [#87](https://github.com/sangwopark19/icons-ip/issues/87)의 사업자 정보 6종 |
| L3 고시정보 | [#171](https://github.com/sangwopark19/icons-ip/issues/171) | 구현 | 홍실 3종 실제 값 입력 → [#190](https://github.com/sangwopark19/icons-ip/issues/190) |
| C2 굿즈 콘텐츠 스키마 | [#172](https://github.com/sangwopark19/icons-ip/issues/172) | 구현 | 홍실 3종 이미지·설명 입력 → [#190](https://github.com/sangwopark19/icons-ip/issues/190) |
| C1 굿즈 상세페이지 | [#173](https://github.com/sangwopark19/icons-ip/issues/173) | 구현 | — |
| C3 배송비 | [#174](https://github.com/sangwopark19/icons-ip/issues/174) | 구현 | 도서산간 추가요금(H6) |
| C4 우편번호 검색 | [#175](https://github.com/sangwopark19/icons-ip/issues/175) | 구현 | — |
| C5 배송 후 청약철회 | [#176](https://github.com/sangwopark19/icons-ip/issues/176) | 구현 | 반품 입고 주소·절차(H5) |
| F2 운송장 등록·조회 | [#178](https://github.com/sangwopark19/icons-ip/issues/178) | **수기 경로만** 구현 | WMS 자동 수신(H1~H3) |
| F3 할당 재고 | [#179](https://github.com/sangwopark19/icons-ip/issues/179) | 미착수 | `stock_qty` 확정(H 전체) · `stock` 전환은 [#190](https://github.com/sangwopark19/icons-ip/issues/190) 선행(§4.1 정정) |
| N1 · L4 트랜잭션 이메일 | [#180](https://github.com/sangwopark19/icons-ip/issues/180) | 구현 · **env 공백** | provider 키·발신자·SPF/DKIM → [#191](https://github.com/sangwopark19/icons-ip/issues/191) |
| A1 ID 덮어쓰기 | [#181](https://github.com/sangwopark19/icons-ip/issues/181) | 구현 | — |
| A7 목록 썸네일 | [#182](https://github.com/sangwopark19/icons-ip/issues/182) | 구현 | — |
| A2~A6 내부 구현 필드 | [#183](https://github.com/sangwopark19/icons-ip/issues/183) | 구현 | — |
| A8 굿즈 미리보기 | [#184](https://github.com/sangwopark19/icons-ip/issues/184) | 구현 | — |
| A9 수동 뽑기권 발급 | [#185](https://github.com/sangwopark19/icons-ip/issues/185) | 구현 | — |

### 8.1 판매 개시를 아직 막는 것

코드가 아니라 사람이 풀어야 한다. 2026-08-10에 프로덕션 `goods`와 Vercel production env를 직접 확인해 갱신했고, 2026-08-11에 결제 키 항목을 빌드 로그 실측으로 확정했다(§8.3).

1. **[#87](https://github.com/sangwopark19/icons-ip/issues/87)** — 사업자 정보 6종. 없으면 푸터의 법정 표기가 비고, 법정 문서가 지정한 문의 창구가 존재하지 않는다. `BUSINESS_INFO`는 `hostingProvider`를 뺀 전 필드가 빈 문자열이다. 여기에 더해 **토스 라이브 키 전환**이 남아 있다 — 프로덕션이 테스트 키라는 것은 2026-08-11 빌드 로그로 **확정**됐다(§8.3). 라이브 키로 교체해야 실제 돈을 받는다. 교체는 플래그 하나를 지우는 일이 아니라 **4개를 한 번에** 바꾸는 일이고, 하나라도 어긋나면 빌드가 fail closed로 막힌다(§8.3).
2. **[#177](https://github.com/sangwopark19/icons-ip/issues/177)** — H1~H7. 특히 H7(WMS 운영사 법인명)이 없으면 개인정보처리방침의 처리위탁 목록을 완성할 수 없다.
3. **[#190](https://github.com/sangwopark19/icons-ip/issues/190)** — 운영 데이터 입력. 홍실 3종의 고시정보 7항목 × 3 = **21칸이 전부 공백**이고 설명·갤러리·상세 이미지도 없다. 고시정보가 차야 굿즈 폼이 저장되고, 그래야 `stock`이 `ok`로 바뀐다(§4.1 정정). A/S 연락처가 #87 의존이다.
4. **[#179](https://github.com/sangwopark19/icons-ip/issues/179)** — 할당 재고 확정. 홍실 3종이 전부 `stock='soldout'`·`stock_qty=0`이라 지금은 아무것도 팔리지 않는다.
5. **[#191](https://github.com/sangwopark19/icons-ip/issues/191)** — 발신 이메일 설정. `EMAIL_PROVIDER_API_KEY`·`EMAIL_FROM`이 Vercel production env에 없어 주문 확인 메일이 한 통도 나가지 않는다. **판매 개시 필수 여부는 #87의 "인앱 주문 상세가 서면 교부로 충분한가"에 달려 있다** — "아니오"면 블로커로 승격된다.

### 8.2 #178에서 남긴 범위

이슈 범위 4번(배송 시작 이메일에 운송장 포함)은 이메일 인프라([#180](https://github.com/sangwopark19/icons-ip/issues/180))에서 배선했다. WMS 자동 수신은 [#115](https://github.com/sangwopark19/icons-ip/issues/115)의 "물류 API 자동화"로 넘긴다 — 수기 운영에서 나온 실제 요구사항을 스펙 근거로 쓴다(§7).

### 8.3 토스 라이브 키 전환 절차

**현재 상태 (2026-08-11 실측).** 프로덕션은 테스트 키다. 키 값은 Vercel에서 Sensitive라 읽을 수 없지만 모드는 빌드 로그로 실측된다.

```
npx vercel inspect <production-deployment-url> --logs
→ Vercel production environment verified; Toss widget test mode
```

교차 확인 — [`scripts/check-vercel-build-env.mjs`](../scripts/check-vercel-build-env.mjs)는 live 모드에서 `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY`가 남아 있으면 빌드를 거부한다. Production에 variantKey가 설정돼 있는데 배포가 통과한다는 사실 자체가 test 모드의 증거다.

**프리뷰는 이미 분리했다** ([#199](https://github.com/sangwopark19/icons-ip/issues/199), 2026-08-11). 그전까지 `NEXT_PUBLIC_TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`는 Preview와 Production이 **하나의 항목**이어서, 그 값을 라이브로 바꾸면 모든 PR 프리뷰가 운영 상점 키를 갖게 되는 구조였다. 지금은 환경별 별도 항목이므로 Production만 교체하면 된다.

**전환 시 Production에서 처리할 4개.** 순차 작업이 아니라 한 배포 안에서 전부 맞아야 한다.

| # | 항목 | 조치 |
|---|---|---|
| 1 | `NEXT_PUBLIC_TOSS_CLIENT_KEY` · `TOSS_SECRET_KEY` | `live_gck_…` / `live_gsk_…` 쌍으로 교체. 두 키의 모드가 어긋나면 거부된다 |
| 2 | `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY` (Production 행) | **삭제**. live 모드에 테스트 UI variantKey가 남으면 거부된다 |
| 3 | `ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION` | **삭제**. live 모드에서는 필요 없다 |
| 4 | `TOSS_PAYMENT_KEY_PAIR_SHA256` | **라이브 쌍 기준으로 재계산**해 교체 |

**4번이 가장 놓치기 쉽다.** `productionCheckoutEnabled`는 live 모드에서 참이 되므로 지문 검증이 그대로 살아 있고, 테스트 키 시절 지문이 남아 있으면 `Invalid Vercel production payment key-pair fingerprint`로 배포가 막힌다. 계산식은 두 **원문 키 값**을 NUL로 이어 SHA-256이다.

```bash
printf '%s\0%s' "$NEXT_PUBLIC_TOSS_CLIENT_KEY" "$TOSS_SECRET_KEY" | shasum -a 256
```

**Preview는 손대지 않는다.** 프리뷰는 계속 테스트 키와 `ICONS_REVIEW` variantKey를 쓴다. 프리뷰 빌드는 `TOSS_PAYMENT_KEY_PAIR_SHA256`을 요구하지 않는다 — 지문 검증은 `productionCheckoutEnabled`(= `target === 'production'`) 조건 안에서만 돌기 때문이다.

전환 뒤 production 배포 로그가 `Toss widget live mode`로 바뀌는지 확인한다. 상점 계약·라이브 키 발급·웹훅 등록 자체는 [#87](https://github.com/sangwopark19/icons-ip/issues/87)의 human gate다.

---

## 9. 가정

- 배송 실행 주체는 사내 물류(김포 창고)다. 3PL 위탁도 IP사 직배송도 아니다.
- 첫 판매 기간에는 ICONS 할당 재고를 다른 채널이 건드리지 않는다(D4의 전제).
- 결제 확정의 진실원은 토스 웹훅이다. 돈·재고는 Postgres RPC + 행 잠금 + 멱등([`AGENTS.md`](../AGENTS.md) 불변).
- 법무 검토는 판매 개시를 막지 않는다(D12). 개인정보처리방침은 코드에서 추출한 **사실 기술**이라 내용 리스크가 낮고, 이용약관은 공정위 표준약관 기반이라 골격 리스크가 낮다는 판단이다.
