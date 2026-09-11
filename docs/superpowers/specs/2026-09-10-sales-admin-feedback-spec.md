## Problem Statement

영업팀은 굿즈를 등록하고 주문을 발송한 뒤 실적을 검토하는 과정에서, ERP 식별자·계층 분류·가격·고시정보·판매 조건·배송 안내를 충분히 관리할 수 없고 주문/쿠폰 조회와 오류 복구에도 불편을 겪는다. 요구를 받았을 당시 없던 기능 일부는 신사업팀 피드백을 반영한 관리자 콘솔 통합 작업에서 이미 구현됐다. 이를 구분하지 않고 다시 개발하면 동일한 옵션·엑셀·배송 기능을 중복 구현하고, 실제로 남은 영업 요구와 운영 인수 조건을 놓치게 된다.

2026-09-07 영업팀 원문 36행을 2026-09-09 통합 배포 이후 코드와 대조한 결과, 6행은 기존 구현을 재사용하고, 16행은 일부 기능만 추가하며, 14행은 신규 설계·정책 해석 또는 오류 재현이 필요하다. 한 행에 여러 요구가 포함되어 있으므로 행 수를 독립 기능 수나 개발 공수로 해석하지 않는다. 별개인 기존 handoff 36개 이슈는 확인 시점에 28개 완료, 8개 실제 운영 인수 대기다.

## Solution

기존 White Catalog 관리자 콘솔과 상품·옵션·주문·배송 건·클레임·쿠폰 운영 기반을 유지하면서, 영업팀의 미반영 요구 전체를 확장한다. 상품 등록에서 고객의 주문, 운영자의 출고, 영업팀의 거래확정 검토까지 같은 식별자와 주문 당시 기록을 사용하도록 연결한다.

확정된 범위는 다음과 같다.

- 자동 상품/옵션 코드, ERP 코드, 바코드를 각각 관리하고 고객용 계층 카테고리에 ERP 분류를 연결한다.
- 공급가는 ICONS가 공급처에서 사오는 매입단가다. 안전재고는 판매량을 차감하지 않는 부족 경보 기준이다.
- 예약판매는 주문 시 결제하고 안내한 예정일에 발송한다.
- 주문 할인용 적립금을 기존 무료 코인과 분리해 도입한다. 쿠폰·회원 혜택은 기존 기반을 확장한다.
- 교환·반품비는 안내와 운영자가 확인한 금액을 기록한다. 자동 추가 결제나 환불액 차감은 포함하지 않는다.
- 해외 수령 고객도 원화로 결제하고 국내 배송대행지를 수취 주소로 사용한다. 이후 국제 배송대행은 고객이 진행한다.
- 거래확정 엑셀은 영업·정산 검토용으로 제공한다. ERP 자동 입력 파일을 만드는 작업은 아니다.

이 이슈는 전체 범위를 보존하는 종합 스펙이다. 아래에 명시한 미결 정책을 이미 승인된 기본값으로 취급하지 않으며, 구현 단위를 나눌 때 기존 완료 기능과 인수 대기 이슈를 복제하지 않는다.

## User Stories

괄호의 A/I/G/S 코드는 영업팀 원문 행의 추적 ID다. “goods”는 굿즈, “ICONS SKU”는 어드민의 상품/옵션 자체 코드, “credit”은 주문 할인용 적립금이다.

### 운영 접근과 카탈로그

1. As an admin operator, I want to identify my signed-in account and complete logout through a clear admin account flow, so that I know which session I am ending. (A01)
2. As an admin operator, I want to check password letter case while signing in, so that I can correct case-related input mistakes. (A02)
3. As an IP operator, I want to correct an IP's user-facing identifier without breaking linked records, so that registration mistakes can be fixed safely. (I01)
4. As an IP operator, I want to remove unused test registrations while preserving referenced business records, so that test data does not clutter the catalog. (I01)
5. As an artwork operator, I want recommended IP image dimensions and cropping guidance for each display surface, so that important artwork is not cut off unexpectedly. (I03)
6. As an admin operator, I want to enter goods information in the order of basic goods and images, prices, inventory, shipping and saving, so that registration follows my working process. (G01)
7. As an admin operator, I want selling price and consumer reference price labels to distinguish the base price from each option's final price, so that I do not register the wrong amount. (G04)
8. As an admin operator, I want to record the unit cost paid to our supplier, so that the supply price has one consistent business meaning. (G04)
9. As an authorized operator, I want purchase cost to stay within authorized operational views, so that customer-facing catalog responses do not expose internal costs. (G04)
10. As an admin operator, I want to manage a customer-facing category hierarchy independently of IP, so that goods can be found by their type and use. (G03)
11. As an admin operator, I want to map catalog categories to external ERP classifications, so that catalog organization can be reconciled with ERP reporting. (G03)
12. As an admin operator, I want ERP identifiers to remain separate from automatic ICONS SKUs, so that linking an ERP item does not overwrite the store's own code. (G17)
13. As an admin operator, I want to store barcodes separately from ICONS SKUs and ERP identifiers, so that scanning and code-based lookup remain unambiguous. (G18)
14. As an admin operator, I want to find goods by name, ICONS SKU, ERP identifier or barcode, so that I can locate the same item from different operational documents. (G17, G18)
15. As an admin operator, I want to schedule the start and end of a goods discount, so that a promotion does not require manual price changes at its boundaries. (G05)
16. As an online buyer, I want displayed discount rates to correspond to the price actually offered for my option, so that the promotion is understandable. (G05)
17. As an admin operator, I want to record applicable KC information, including its type, identifier and associated business, so that product disclosures contain the required evidence. (G06)
18. As an admin operator, I want publication validation to reflect the applicable KC information category, so that an unrelated generic checkbox does not stand in for product evidence. (G06)
19. As an artwork operator, I want square goods image guidance and previews of the actual supported crops, so that a 1000-by-1000 source can be prepared for the store's different surfaces. (G09)
20. As an admin operator, I want to enter and preview supported goods description HTML, so that richer product information can be prepared without a separate development task. (G10)
21. As an online buyer, I want published goods descriptions to render consistently and without executable embedded content, so that product information remains usable and trustworthy. (G10)
22. As an admin operator, I want to copy an entire goods registration into a distinct new draft, so that repeated product setup does not require re-entering every field. (G16)
23. As an admin operator, I want the existing draft, input recovery and public-component preview to include newly added fields, so that new functionality does not weaken the registration workflow. (G16)
24. As an admin operator, I want to maintain goods search keywords, so that customer discovery can account for relevant terms beyond the displayed name. (G19)
25. As an admin operator, I want to control goods display order in the agreed catalog contexts, so that merchandising order is intentional. (G19)
26. As an admin operator, I want to maintain an English goods name, so that overseas customers can identify goods while using domestic delivery and KRW payment. (G19)
27. As an online buyer, I want to select available additional goods alongside a main item, so that I can purchase the intended configuration together. (G19)
28. As an admin operator, I want additional goods to retain their own price, inventory and order records, so that an add-on selection cannot bypass normal commerce controls. (G19)

### 옵션·재고·판매 조건

29. As an admin operator, I want an explicit option availability control, so that I can stop offering an option without losing its historical references. (G07)
30. As an admin operator, I want an appropriate restoration flow for a previously stopped option, so that I can resume sales without recreating its identity. (G07)
31. As an inventory operator, I want an option-level low-stock threshold, so that I am warned when its allocated inventory reaches the threshold. (G08)
32. As an inventory operator, I want a threshold of three on a stock of ten to leave all ten available for sale, so that a warning setting is not mistaken for reserved inventory. (G08)
33. As an admin operator, I want to configure minimum and maximum quantities for a purchase, so that goods can follow the intended order-size rules. (G11)
34. As an admin operator, I want to configure a member purchase limit, so that repeated purchases are checked against the agreed counting policy. (G11)
35. As an admin operator, I want quantity limits to be checked when orders are created, including concurrent attempts, so that customers cannot bypass them through simultaneous requests. (G11)
36. As an online buyer, I want canceled, failed and refunded purchases to affect my purchase limit according to the same published policy, so that my remaining allowance is predictable. (G11)
37. As an online buyer, I want to pay when placing a preorder and see its planned dispatch date, so that I understand when the purchase is expected to ship. (G12)
38. As an admin operator, I want to configure preorder availability periods and controlled quantities, so that preorder demand cannot exceed the approved supply commitment. (G12)
39. As an online buyer, I want promised dispatch information to remain clear when ordering preorder and immediately available goods, so that mixed purchases do not conceal delivery timing. (G12)
40. As an admin operator, I want changes to a preorder's promised dispatch information to be traceable, so that affected orders can be handled consistently. (G12)
41. As an admin operator, I want to manage the supported payment methods available for goods, so that operational restrictions are applied by the server to the resulting order. (G15)
42. As an admin operator, I want the existing adult-goods flag and purchase gates to remain effective while registration is improved, so that changing metadata cannot accidentally enable restricted sales. (G17)

### 배송·고객 응대

43. As an admin operator, I want reusable shipping information templates, so that compatible goods do not require repeated entry of the same shipping terms. (G13)
44. As an online buyer, I want applicable domestic remote-area shipping charges and guidance to be available before payment, so that the charged shipping amount is understandable. (G13)
45. As an admin operator, I want to maintain the appropriate dispatch and exchange/return addresses, so that goods are sent to the correct operational destination. (G13)
46. As an online buyer, I want the applicable customer-support contact information to be available with shipping and return guidance, so that I can reach the responsible operator. (G13)
47. As an admin operator, I want to record and explain goods-specific exchange/return conditions and reasons for restrictions, so that operators can apply the agreed policy consistently. (G14)
48. As an admin operator, I want to display exchange/return costs and record the amount confirmed by an operator, so that the cost is auditable without automatically charging the customer or deducting a refund. (G14)
49. As an overseas buyer, I want to use my forwarding service's domestic Korean address, so that ICONS can deliver domestically before I arrange onward shipping. (G19)
50. As an overseas buyer, I want that purchase to remain a KRW transaction, so that using a domestic forwarding address does not require a separate international checkout. (G19)
51. As an admin operator, I want to choose order-search conditions such as recipient name, order identifier and tracking number, so that I can find an order from the information provided by a customer. (S01)
52. As an admin operator, I want to distinguish parcel delivery, quick delivery and customer pickup, so that each fulfillment method has appropriate information and handling. (S02)
53. As an admin operator, I want delivery or pickup completion to use evidence appropriate to the selected method, so that an invented parcel tracking number is not required for a non-parcel shipment. (S02)
54. As an admin operator, I want to open an order's details while retaining my list filters and selection, so that investigating one order does not interrupt batch work. (S05)
55. As an admin operator, I want to select delayed orders and prepare a customer-facing notice, so that affected customers can receive a consistent explanation. (S06)
56. As an admin operator, I want customer notices to remain separate from internal delay notes, so that staff-only information is not sent to customers. (S06)
57. As an admin operator, I want notice delivery results and retries to be tracked without duplicate sends, so that a partial failure can be recovered safely. (S06)

### 영업 산출물·쿠폰·적립금

58. As an admin operator, I want a settled-orders workbook containing settlement time, order identifier, tracking number, ERP item name, quantity, sales amount, shipping fee and payment time, so that the sales team can review the transaction. (S07)
59. As an admin operator, I want workbook totals to remain correct for multi-item and multi-shipment orders, so that shipping fees and discounts are not counted more than once. (S07)
60. As an admin operator, I want historical workbooks to use recorded transaction identities and amounts, so that later catalog edits do not silently rewrite earlier sales. (S07)
61. As an admin operator, I want settlement and payment timestamps to be distinguished from order creation, so that each report column describes the event it claims to describe. (S07)
62. As an admin operator, I want to search, filter and page through coupons, so that an existing promotion can be found without scanning the entire list. (S08)
63. As an admin operator, I want submitted coupon values to survive validation and save failures, so that I can correct an error without re-entering the form. (S09)
64. As an admin operator, I want coupon targeting for first and repeat purchases, so that promotions can serve the intended customer segment. (S10)
65. As an admin operator, I want coupon recipient eligibility to be distinct from eligible goods, so that issuing a coupon and calculating its discount use the intended rules. (S10)
66. As an online buyer, I want coupons in a mixed basket to discount only the eligible amount under the agreed policy, so that the checkout total is predictable. (S10)
67. As an admin operator, I want goods-specific promotion settings to work with existing member benefits, so that new targeting does not create an unintended second discount. (G19, S10)
68. As an online buyer, I want to see my order-discount credit balance and its history, so that I can understand what I can use and why the balance changed. (G19)
69. As an authorized operator, I want credit grants and adjustments to have an attributable source, so that operational corrections can be audited. (G19)
70. As an online buyer, I want credit use to be confirmed together with order creation, so that concurrent checkout attempts cannot spend the same credit twice. (G19)
71. As an online buyer, I want credit use and restoration to follow the agreed failure, cancellation and refund rules, so that retrying a request does not lose or duplicate credit. (G19)
72. As an admin operator, I want order-discount credits to remain separate from free participation coins and card rewards, so that the two systems cannot be confused or exchanged implicitly. (G19)

### 기존 기반 보존과 인수

73. As an admin operator, I want new goods fields to work with the existing workbook import, validation, retry and export flows, so that bulk work does not require a second import system. (G21)
74. As an admin operator, I want identifiers, leading zeros and unchanged values to survive workbook round trips, so that an export and reimport does not corrupt operational data. (G17, G18, G21)
75. As an admin operator, I want existing IP visibility, automatic codes, reviews and goods previews to remain available after the extension, so that completed functionality is preserved. (I02, G02, G16, G20)
76. As an admin operator, I want the existing Gimpo and Seowon formats and bulk tracking registration to remain compatible, so that new catalog fields do not disrupt warehouse work. (S03, S04)
77. As an authorized operator, I want sensitive operational changes to retain role checks and audit history, so that actions remain attributable under the existing permission model.
78. As an operations reviewer, I want the original acceptance scenarios and the new sales-team scenarios to have separate evidence, so that implementation success is not mistaken for completed human acceptance.
79. As an admin operator, I want the guide and change notes to explain delivered workflows in operational language, so that I can find and use the improvements without knowing their implementation.

## Implementation Decisions

### 확정된 제품 결정

1. **범위** — 원문 미반영 요구 전체를 대상으로 하며 기존 구현만 재사용한다. 화면 보완과 신규 판매 정책을 모두 이 종합 스펙에서 추적한다.
2. **식별자** — 자동 상품/옵션 코드, ERP 코드, 바코드를 분리한다. ERP 값을 자체 코드에 덮어쓰는 방식으로 요구를 충족했다고 보지 않는다.
3. **카테고리** — 고객용 계층 분류에 ERP 분류를 매핑한다. IP/버티컬과 굿즈 카테고리는 별개다.
4. **공급가** — ICONS가 공급처에서 사오는 매입단가다. 고객 판매가·소비자가·도매 판매가와 구분한다.
5. **안전재고** — 옵션별 경보 기준이다. 할당 재고 10개, 기준 3개이면 판매 가능한 물량은 10개이며 기준 이하에서 경보한다.
6. **예약판매** — 주문할 때 결제하고 예정일에 발송한다. 무결제 예약 접수나 발표용 예약 체험으로 대체하지 않는다.
7. **적립금** — 주문 할인용 별도 잔액이다. 무료 코인·카드팩·쿠폰과 분리한다. 기존 쿠폰 단독 할인 원칙은 이 확장 설계에서 개정되며, 현재 배포 코드가 적립금을 지원하는 것은 아니다.
8. **교환·반품비** — 비용 안내와 운영자가 확인한 금액 기록을 제공한다. 신규 자동 결제나 환불액 차감은 하지 않는다.
9. **국내 배송대행지** — 원화 결제와 국내 수취 주소를 유지한다. 국내 배송대행지 이후 운송은 고객이 진행한다.
10. **거래확정 엑셀** — 영업·정산 검토용이다. 요청한 8개 정보는 빠짐없이 포함하고, 명칭과 금액의 의미를 실제 기록과 일치시킨다.

### 유지할 계약과 재사용할 경계

- 기존 관리자 셸·공개 디자인 시스템·역할 모델을 유지한다. 어드민은 상품·상품코드·옵션을, 도메인은 굿즈·굿즈 코드·옵션을 사용한다. 카드·카드팩·티켓을 상품으로 합치지 않는다.
- 상품·IP 편집, 초안/공개/보관, 업로드, 실패 입력 보존, 미리보기는 기존 편집 흐름을 확장한다. 쿠폰 입력 소실은 실제 실패를 먼저 재현하고 이미 존재하는 폼 복구 계약을 적용한다.
- 기본 옵션을 포함한 옵션 목록과 옵션별 가격·할당 재고가 진실원이다. 기존 행 제거 시 참조 옵션 보관/미참조 옵션 삭제 기능을 재사용하면서 명시적 사용 상태와 복원 경험을 보완한다.
- 일반 굿즈 가격과 쿠폰 할인은 기존 주문 생성 경계에서 다시 평가한다. 적립금·구매한도·예약판매 제약도 동일한 주문 확정 흐름과 연결하며, 브라우저 값만으로 확정하지 않는다.
- 돈·재고·혜택의 선점·해제·취소는 서버 권한 검사, 행 잠금, 멱등 처리와 이력 보존을 사용한다. 기존 주문의 금액·굿즈/옵션 정체성·배송비 스냅샷을 카탈로그 수정으로 덮어쓰지 않는다.
- 결제 수단 허용 설정과 PG 선택은 다르다. 현재 기본 PG와 판매 제한 상품의 분기는 서버가 주문 단위로 파생한다. 상품 등록 개선을 이유로 관리자 PG 선택이나 19금 판매 개방을 추가하지 않는다.
- 출고지별 배송 건·복수 운송장·배송 상태 집계, 김포/서원 양식, 운송장 일괄 등록은 유지한다. 퀵/방문수령을 기존 택배사 이름이나 가짜 운송장으로 우회하지 않는다.
- 주문 전체 클레임과 출고지별 회수 확인을 유지한다. 비용 안내나 상품 제한 설명이 기존 CS 접수와 권리 검토를 일괄 차단하는 스위치가 되지 않게 한다.
- 기존 상품 엑셀 사전검증·부분실패·재업로드·이미지 연결·내보내기를 확장한다. 새로운 필드마다 별도 가져오기 엔진을 만들지 않는다.
- 내부 지연 메모와 고객 발송 문구는 별개의 데이터다. 기존 알림/배송 결과 처리 기반을 우선 검토하고, 확정되지 않은 채널을 임의로 활성화하지 않는다.
- 신규 고시·HTML·계층 분류·식별자 등은 단건 폼만 추가해서 완료 처리하지 않는다. 필요한 공개 조회·미리보기·검색·엑셀·운영 안내 소비자를 함께 맞춘다.
- 매입단가·내부 메모·감사 정보는 적절한 운영 조회에 한정한다. 고객용 응답에 내부 정보를 섞지 않는다. HTML은 저장·미리보기·공개 출력 모두에서 실행 가능한 내용과 유해 URL을 배제한다.

### 구현 범위의 구조

| 영역 | 확장할 모듈과 사용자에게 관측되는 계약 |
|---|---|
| 운영 접근·공통 폼 | 관리자 계정 동선, 비밀번호 입력 확인, 필드 순서·명칭·이미지 가이드, 쿠폰 오류 복구 |
| 카탈로그 | 식별자/외부 매핑, 계층 분류, 매입단가, KC 정보, 설명 콘텐츠, 상품 복사, 키워드·진열·영문 정보 |
| 판매 정책 | 명시적 옵션 사용 상태, 안전재고 경보, 수량 제한, 예약판매, 기간 할인, 수단 허용, 추가구성상품 |
| 혜택 | 상품·고객별 쿠폰 조건, 회원 혜택 연결, 별도 적립금 이력과 주문 할인 통합 |
| 배송·고객 응대 | 배송정보 재사용, 실제 방식별 발송/수령, 국내 추가요금, 교환·반품 안내/금액 기록, 국내 배송대행지, 지연 안내 |
| 조회·산출물 | 조건별 주문/쿠폰 검색, 목록 문맥을 보존하는 상세 열기, 거래확정 검토 엑셀, 새 필드의 상품 엑셀 |

이는 하나의 거대한 PR을 요구하지 않는다. 이미 검증된 기반을 유지하며 검토 가능한 목적별 구현 단위로 나누고, 원문 행과 사용자 스토리의 추적 관계를 보존한다. 구체적인 저장 구조와 API 변경은 아래 미결 정책이 필요한 영역에서 그 결정을 선행한 뒤 정한다.

## Testing Decisions

### 주 검증 경계

주 검증은 **운영자가 굿즈를 등록·공개하고, 구매자가 주문하며, 운영자가 출고·고객 응대 후 영업 검토 엑셀을 받는 업무 흐름**이다. 새로운 저수준 테스트 경계를 다수 만드는 대신 기존 편집 서버 액션, 주문 생성, 배송 건 전이, 쿠폰 평가, 엑셀 입출력 경계를 재사용한다. 이 검증 경계는 기존 코드와 대화에서 확인한 근거를 합성한 제안이며, 별도의 사용자 승인 응답을 받았다고 기록하지 않는다.

좋은 테스트는 사용자에게 보이는 성공/실패 결과와 서버에 보존된 결과를 검증한다. 내부 함수 호출 순서, 컴포넌트 구현 세부나 코드를 그대로 옮긴 예상값을 검증 대상으로 삼지 않는다. 아래 사례는 개발 완료 조건이며 이번 스펙 작성에서 실행했다는 뜻이 아니다.

| 대상 | 반드시 관측할 결과 | 기존 테스트 선례 |
|---|---|---|
| 폼·인증 동선 | 실제 쿠폰 오류를 먼저 재현하고 재입력 없이 수정 가능함을 검증. 업로드 경로·옵션·상세 입력 보존, 키보드 조작, 계정/로그아웃 결과 확인 | 상품/IP 폼 실패 입력 보존·초안·공개 컴포넌트 미리보기 테스트 |
| 이미지·설명 | 권장 이미지가 실제 목록·모바일/데스크톱 상세에서 어떻게 잘리는지 확인. HTML 미리보기와 공개 결과 일치, 실행 가능한 내용 차단 | 공통 업로드 검증·공개 카드/상세 미리보기 및 렌더링 검증 |
| 식별자·분류·복사 | 코드/ERP/바코드 구분, 검색 결과와 매핑 정합, 새 복제본의 별도 정체성, 참조 데이터와 과거 주문 보존 | 순차 코드·카탈로그 참조 보관·옵션 스냅샷 테스트 |
| 재고·구매 조건 | 안전재고 설정 자체로 수량이 줄지 않음. 판매 중지 옵션/수량 한도/예약기간의 우회 차단, 동시 주문에서도 정책 보존 | 옵션 재고·옵션 편집·주문 및 취소 복원 SQL 통합/동시성 테스트 |
| 가격·쿠폰·적립금 | 서버가 실제 선택 옵션과 대상 품목으로 금액 재평가. 동시 사용·중복 요청·실패·취소·환불에서 혜택 이력이 정확히 한 번 반영 | 쿠폰 발급 동시성·사용/복구 원장·주문 결제 통합 테스트 |
| 예약판매 | 기간 경계·수량·약속한 발송 정보 보존. 예약/즉시배송 혼합 주문은 확정된 정책과 일치 | 기존 주문 생성·출고지별 배송비·배송 건 스냅샷 및 상태 집계 테스트 |
| 배송·클레임 | 방식별 올바른 수령 증거, 국내 추가요금, 출고지별 주소, 기존 회수·환급·재고 보호. 비용 기록만으로 결제나 환불이 바뀌지 않음 | 출고지 정책/동시성·배송 건 전이·출고지별 클레임 회수/재출고 테스트 |
| 고객 안내 | 대상과 외부 문구를 확인할 수 있고 내부 메모가 섞이지 않음. 일부 실패 재시도에서 중복 발송 없음 | 기존 알림/배송 작업의 멱등 처리·재시도·권한 테스트 |
| 검색·상세 | 수취인·주문·운송장의 정확한 검색, 필터/페이지/선택 보존, 역할 밖 데이터 차단 | 주문 목록·상세·고객 조회의 역할 검사 및 필터 테스트 |
| 엑셀 | 필수 8개 정보, 실제 결제/확정 시각, 품목/배송 건 정합, 합계와 배송비 중복 0, 과거 주문 보존, 선행 0·공란·수식처럼 보이는 텍스트 보존 | 김포 21열·서원 7열·배송비 1회 반영·실패행 재처리·무수정 왕복 테스트 |

금융/재고의 경쟁 상태와 권한은 브라우저만으로 검증하지 않고 기존 서버 통합 테스트에서 직접 입증한다. 그 외 화면 동선은 실제 브라우저에서 확인한다. 임시 로컬 데이터 또는 격리된 비운영 환경과 합성 자료를 사용하고, 실제 운영팀 인수는 아래 기존 이슈의 측정 기록으로 별도 남긴다.

코드 구현 후 관련 앱 검사·빌드, 변경된 서버/DB 계약의 적용·권한·동시성 검증, 실제 브라우저 흐름 및 영향받는 엑셀 왕복을 수행한다. 이미 통과한 동일 검사를 이유 없이 반복하거나 모든 헬퍼를 새 단위 테스트로 감싸지 않는다.

## Out of Scope

- 이미 구현된 IP 게시 상태, 자동 상품/옵션 코드, 옵션 조합·재고 기반, 초안·미리보기, 리뷰 블라인드, 상품 엑셀 엔진, 김포/서원 양식 및 운송장 일괄 등록의 재개발. 새 기능이 소비하는 부분의 확장·회귀 검증은 포함한다.
- 기존 신사업팀 실제 운영 인수 8개를 기술 테스트로 대체하거나 새 이슈로 복제하는 것.
- ERP/WMS API 연동과 ERP 자동 입력 전용 거래확정 파일. ERP 코드/분류 매핑 및 영업 검토용 엑셀은 포함한다.
- ICONS가 직접 수행하는 국제 배송·국제 운임·다통화 결제. 국내 배송대행지와 원화 결제는 포함한다.
- 교환·반품비의 자동 추가 결제와 환불액 자동 차감, 부분 취소·부분 환불 원장의 신규 도입.
- 관리자 PG 임의 선택, 19금 상품의 실제 판매 개방, 성인인증/PG 계약 절차의 대체.
- 적립금의 유상 충전·현금 출금·타인 양도, 무료 코인·카드팩으로의 암묵적 전환, 유료 디지털 가챠의 재도입.
- 무결제 예약신청 서비스, 발표용 팝업 체험을 실제 예약/주문 원장으로 전용하는 것.
- 선택되지 않은 알림톡/SMS 등 신규 채널의 실제 연결·활성화와 제한 없는 임의 스크립트 실행형 HTML.
- 이 스펙 게시만으로 production 배포·DB 변경·실제 고객 메시지 발송·상업 오픈을 수행하는 것.

## Further Notes

### 합의와 미결 정책의 구분

최초 게시 때 Q1~Q10만 확정했고 Q11/Q12는 미답변으로 남겼다. 후속 구현 대화에서 운영 구조의 권장안을 채택했으며, 2026-09-11 사용자의 “권장안으로 진행해” 답변으로 Q11은 인앱 알림+주문 이메일, Q12는 제목·문단·목록·표·안전 링크·검증 이미지의 기본 문서 HTML로 확정했다. 실제 수치·외부 증빙·고객 발송·배포 승인은 별개다. 최신 계약은 [채택한 정책 구조](../plans/2026-09-10-sales-admin-policy-proposals.md)를 따른다.

| ID | 정책 항목과 합의 상태 | 지켜야 할 경계 |
|---|---|---|
| P01 | 지연 안내 채널(Q11): 인앱 알림+주문 이메일로 확정(2026-09-11) | 구매자·주문·고객 문구·채널별 결과를 보존하고 내부 메모를 발송하지 않음. 구현 승인은 실제 고객 발송 승인이 아님 |
| P02 | HTML 범위(Q12): 기본 문서 요소·안전 링크·검증 이미지로 확정(2026-09-11) | 임의 CSS 원형 이전은 제외하고 실행 가능한 삽입은 차단. 저장·미리보기·공개·엑셀의 허용 범위를 일치시킴 |
| P03 | IP ID/URL 변경, 테스트 초안 삭제 범위, 자체 코드·ERP·바코드의 중복/변경/이관 규칙 | 내부 참조와 거래 이력을 파괴하지 않음. 기존 코드 분리 결정만으로 전체 ID 변경을 허용하지 않음 |
| P04 | 카테고리 깊이·복수 소속·이동/삭제·ERP 매핑 개수 | 원문 예시는 4단계이므로 3단계로 임의 고정하지 않음 |
| P05 | 매입단가의 세금 포함 여부·옵션별 관리·조회 권한, 할인기간 경계와 옵션 할인율 표시 | 공급가를 도매가로 해석하지 않음. 과거 거래 금액을 변경하지 않음 |
| P06 | 주문당/회원당 한도의 상품·옵션 합산 범위, 집계 기간, 취소·환불 후 회복 | UI 숫자만으로 정책이 구현됐다고 보지 않음 |
| P07 | 예약판매의 승인 물량, 일반 재고와의 관계, 혼합 주문/출고 묶음, 예정일 변경 처리 | 선결제+예정일 발송만 확정. 무제한 판매나 재고 음수를 허용하지 않음 |
| P08 | 적립금의 적립 계기·금액·상한·만료·사용 하한/상한·쿠폰 중복·환불 복원 | 예시 금액/비율/유효기간을 실제 정책으로 넣지 않음. 무료 코인 원장과 분리 |
| P09 | 첫구매/재구매의 판정 사건, 발급 대상과 할인 대상, 혼합 장바구니·회원 혜택 중복 | 최초 주문 생성과 최초 유효 결제를 동일시하지 않음 |
| P10 | 배송 템플릿의 적용 범위, 실제 도서산간 요금표, 퀵/수령 증거, 교환/반품 주소·비용 정의 | 창고 파일 양식과 고객 배송정보를 혼동하지 않음. 비용 기록은 자동 청구가 아님 |
| P11 | 엑셀 행 단위, ERP 품명 진실원, 할인 전후 판매금액, 배송비 배분, 결제 시각의 기준 | 요청한 8개 정보를 충족하되 없는 값을 만들어내거나 금액을 중복 합산하지 않음 |
| P12 | 추가구성상품의 관계·선택 조건, 키워드 검색 범위, 진열 순서 적용 문맥, KC 유형별 필요한 증거 | 목록 필드만 만들고 판매·조회·고시 계약 전체가 구현된 것으로 처리하지 않음 |
| P13 | 로그아웃 계정 동선의 구체적 목적지, 비밀번호 대소문자 확인의 표현, 상세 열기의 탭/팝업 방식 | 기존 공통 인증·상세 화면을 재사용하고 실제 피드백을 재현해 해당 불편을 해소 |

`ready-for-agent`는 사용자가 요청한 게시 라벨이다. 전체 구현의 시작 가능 여부는 Project의 `Dependency`가 별도로 표현한다. 위 의존성이 남은 종합 구현은 `Blocked`로 표시하며, 미결 정책에 영향을 받지 않는 작업은 기존 계약을 확인해 후속 구현 단위로 분해할 수 있다. 이 문서는 전체 정책이 이미 확정됐거나 모든 구현을 무조건 시작할 수 있다고 주장하지 않는다.

### 원문 추적과 중복 제외

원문 ID는 A01~A02(전체 어드민), I01~I03(IP), G01~G21(굿즈), S01~S10(판매 관리)이다. 사용자 스토리와 함께 원문 전 항목을 추적한다.

| 원문 구분 | 처리 |
|---|---|
| I02, G02, G20, G21, S03, S04 | 기존 구현을 재사용. 신규 필드 연결과 실제 인수만 필요한 범위에 포함 |
| I03, G01, G04, G05, G07, G08, G13, G15, G16, G17, G18, G19, S01, S02, S05, S08 | 해당 행에서 이미 구현한 부분을 제외하고 잔여 요구를 추가 |
| A01, A02, I01, G03, G06, G09, G10, G11, G12, G14, S06, S07, S09, S10 | 신규 구현·계약 명확화 또는 오류 재현 대상 |

다음 기존 인수는 원래 이슈에서 이어간다: #410 IP 입력 보존, #414 문의→정확한 주문 이동, #423 단건 초안→공개, #425 30상품 일괄 등록 30분, #426 설정 변경, #429 100주문 출고/창고 인수, #430 실제 문의 응대, #434 S1~S5 전체 측정. 운영팀이 실제 수행해야 하는 시간·클릭·오류 기록을 에이전트 테스트로 대신 채우지 않는다.

#451의 초안/보관 직접 Data API 읽기 제한과 #453의 잔여 물류 인수·부분배송 CS·단일 교환 운송장 한계는 별도 미해결로 유지한다. #453의 이전 정책 미확정·공개 문서 미게시 상태는 이미 해소됐으므로 중복 요구로 되살리지 않는다. 종합 스펙 #437과 에픽 #408의 본문을 덮어쓰지 않는다.

### 근거와 검증 범위

- [영업팀 피드백 원문](https://claude.ai/public/artifacts/a96ca3f2-29c5-4a3b-b5f9-7b2a2df62652): 2026-09-07 작성, 실제 브라우저에서 본문 전체 확인.
- [기존 스펙 #437의 최신 완료/인수 구분](https://github.com/icons-hq/icons-ip/issues/437#issuecomment-5596167951), [에픽 #408 집계](https://github.com/icons-hq/icons-ip/issues/408#issuecomment-5596167967): 2026-09-10 조회 기준 28 완료/8 인수 대기.
- [통합 PR #452](https://github.com/icons-hq/icons-ip/pull/452), [staging 수정 #456](https://github.com/icons-hq/icons-ip/pull/456), [인수 문서 #457](https://github.com/icons-hq/icons-ip/pull/457): 병합 확인. 이전 #407/#435는 중복으로 종료됐다.
- [기존 배포 CI](https://github.com/icons-hq/icons-ip/actions/runs/34312767175): 이전 구현의 검증·배포 성공 근거다. 신규 기능의 검증 결과는 아니다.
- 현재 코드 대조 기준은 8d130febb876591ff1dbe61470a9952ec84312e0이다. 기존 통합 이후 관리자 코드 변경이 없음을 확인했다.
- KC는 제품군과 제도에 따라 구분해야 한다. [Safety Korea 대상품목](https://www.safetykorea.kr/policy/targetsSafetyCert2), [공급자적합성확인](https://www.safetykorea.kr/policy/targetsSafetyQuality)을 확인했으며 개별 굿즈의 인증 적합성을 이번 작업에서 판정한 것은 아니다.
- 관련 기존 테스트 실행 시도는 의존성 부재로 시작 전에 실패했다. 이번 문서 합성에서 앱/DB/브라우저 회귀 테스트가 통과했다고 주장하지 않는다. 특히 쿠폰 입력 소실은 실제 재현이 필요한 후보다.
- 원문의 요구 수와 중복 제외를 대조하고, 현재 용어집·제품 범위·기존 ADR의 영향을 검토했다. 후속 구현이 계약을 바꾸면 제품 범위·구조 설명·운영 가이드 및 필요한 ADR을 함께 갱신한다.
