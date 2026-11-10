# 일반 주문·선물·정기배송의 공통 주문 계산과 생성

migration 파일 경로는 [배포 매핑](../../../supabase/manifests/admin-rollout-migration-map.json)을 반영했다. 아래 과거 검증·적용 기록은 당시 원본 DRAFT 기준이며 이번 운영 배포의 성공을 뜻하지 않는다.

이 문서의 `output/`·임시 경로는 내부에 보존한 로컬 검수 근거의 파일 참조이며, 해당 자료와 비공개 원본 캡처는 저장소에 첨부하지 않는다.

2026-10-14. 사용자가 선물·복수구매 할인·착불/수량 배송비·정기배송의 설계와 구현을 포함하도록 요청한 범위다. 공통 계약을 바탕으로 구현 중이며 새 거래 모델의 전체 완료나 운영 DB 변경을 실행했다는 기록은 아니다. [관리자 설정 구현 단계](goods-transaction-admin-implementation-qa.md)와 실제 거래 통합 검증을 구분한다. 기존 전체 주문·전액 환급, 운영 배포 별도 승인 경계를 유지한다.

## 현재 구현에서 보존할 것

- 기존 [주문 Action](../../../app/checkout/actions.ts)은 현재 사용자·온보딩·결제 게이트를 확인한 뒤 service-role 전용 `place_order_with_cart_snapshot`을 호출한다. 신규 [거래 Action](../../../app/checkout/transaction-actions.ts)은 실행 gate가 열린 주문서에서 확정 quote 기반 경로를 사용한다. 브라우저의 기대 사용자 ID는 서버에서 현재 인증 사용자와 대조하며 그 값만으로 권한을 부여하지 않는다.
- [카트 기대값](../../../supabase/migrations/20261020085146_checkout_cart_snapshot.sql), [쿠폰 기대값](../../../supabase/migrations/20260910103413_sales_checkout_coupon_expectation.sql), [적립금](../../../supabase/migrations/20260910083947_sales_store_credit_checkout.sql), [예약 공급](../../../supabase/migrations/20260910091900_sales_preorder_checkout_fulfillment.sql), [판매기간](../../../supabase/migrations/20261020085302_goods_sale_period.sql)의 최신 함수 본문과 권한을 기준으로 한다. 오래된 migration 하나를 전체 정본으로 간주하지 않는다.
- 승인·환급은 [PaymentGateway](../../../lib/payments/gateway.ts)의 provider 증거와 기존 DB finalizer로 확정한다. 새 할인이나 착불을 callback 성공 처리로 확정하지 않는다.
- `order_items.unit_price`는 기간 할인 후 단가, `orders.discount_total`은 쿠폰, `orders.shipping_fee`는 온라인 결제에 포함된 운임이다. 과거 필드를 새 의미로 바꾸지 않는다.
- 출고지별 물리 배송 1건, 기존 예약 공급/할당 재고, 구매 한도, 상품 직접입력 스냅샷, 쿠폰 예약·적립금 lot·환급 멱등성을 보존한다.

## Module의 Interface

`GoodsTransaction` Module은 확정 견적과 주문 생성을 제공한다. 일반 카트, 선물, 정기배송은 서로 다른 선택 원본 Adapter를 사용하고 같은 금액·재고 Implementation을 통과한다. 가격 산식은 DB 한 곳에 두며 TS의 독립 계산은 검증에만 사용한다.

```text
quote(source, actor, deliveryChoices, couponChoice, creditChoice)
  → quoteId, expiresAt, safeDisplay, issues

place(source, actor, quoteId, checkoutKey, paymentMethod)
  → orderId, originalReceipt
```

실제 공개 Action/RPC는 인증과 source 소유권을 검사하고 내부 Interface로 위임한다. 브라우저가 보낸 source kind나 user ID만으로 선물 수신자·다른 회원의 카트·구독에 접근할 수 없다.

| 선택 원본 Adapter | 보존/검증할 정체성 | 생성 시 원본에 가하는 변화 |
| --- | --- | --- |
| 일반 카트 | 사용자, 현재 카트 revision 또는 정규화된 상품/옵션/수량/직접입력 전체 | 기존 계약대로 주문한 카트를 비우되 기대값과 잠금으로 다른 탭의 변경을 보호 |
| 선물 | 선물 ID/revision, 보낸 사람, 수락자, 고정 선택, 주소/수락 revision | 해당 선물에 주문 ID를 한 번 결속. 구매자나 수신자의 현재 카트는 바꾸지 않음 |
| 정기배송 회차 | 구독 ID/약관 revision, 회차 번호·예정시각, 고정 선택, 배송/금액 동의 | 해당 회차에 주문 ID를 한 번 결속. 현재 카트나 다음 회차를 바꾸지 않음 |

각 Adapter가 신뢰할 수 있는 선택을 제공해도 생성 시 상품 공개/판매기간·구매자 계정·옵션·수량·공급·출고지·지역 정책·결제 허용 여부를 다시 확인한다. 선물 수신자와 주문의 결제자·쿠폰/적립금 소유자를 혼동하지 않는다.

## 확정 견적

공개 상품·비로그인 카트의 예상 금액은 기존 공개 조회를 확장한다. 결제 직전의 확정 견적은 로그인한 결제자에게 발급하며 private 저장소에 짧은 유효기간을 가진 원본을 보관한다. 견적 발급은 재고·쿠폰·적립금을 예약하지 않는다.

- 견적 원본은 선택, 주소 또는 선물 수신 주소 revision, 선/착불 선택, 보유 쿠폰 ID, 적립금 금액, 가격·할인·배송 정책 버전, 정수 합계, 유효기간을 결속한다.
- 브라우저에는 예측 불가능한 `quoteId`와 필요한 표시 DTO만 준다. 다른 사람의 주소 원문이나 주소를 대입해 추측할 수 있는 공개 해시를 내려주지 않는다.
- 견적은 기본 10분 이내이며 그보다 이른 가격/판매/지역 정책·쿠폰 사용 시작/종료·보유 쿠폰 만료 경계가 있으면 해당 시각까지다. 상태를 변경한 뒤 오래된 견적을 그대로 결제할 수 없다.
- 사용자별 미만료 견적 수와 입력/행수/JSON 크기에 제한을 두고, 만료된 주소 등 개인정보를 남기지 않는 정리 절차를 포함한다. 정확한 상한은 기존 카트 한도와 부하 검증 뒤 코드 상수로 고정한다.
- 주소 미정·수납 계약 미준비·지역 정책 불명확·지원하지 않는 공급은 명시적 issue다. 배송비 0원이나 결제 가능 상태로 치환하지 않는다.

주문 생성은 최신 상태를 잠금 아래 다시 계산한다. 합계 또는 고객이 확인해야 하는 조건이 견적과 달라지면 `transaction_quote_changed`로 중단하고 새 견적을 보여준다. 새로운 가격을 조용히 청구하지 않는다. 시간 경계를 판단하는 기준시각은 관련 잠금 획득 뒤 한 번 정하며, 잠금 대기 전 transaction 시작 시각으로 만료 조건을 연장하지 않는다.

현재 쿠폰 helper의 `statement_timestamp()`까지 명시적으로 검토한다. 새 생성 경로에서는 가격·쿠폰·보유 만료·판매/지역 정책 모두에 같은 잠금 후 기준시각을 전달한다. 기존 함수 ABI를 유지하는 wrapper와 새 시각 인자를 받는 내부 계산을 구분하고, 잠금 대기 중 쿠폰이 만료되는 실제 경합을 검사한다.

같은 `checkoutKey`의 성공 재시도는 원주문 영수증을 반환한다. 카트가 비워졌거나 견적이 만료된 뒤에도 이미 성공한 결과를 현재 가격으로 재계산하지 않는다. 같은 key에 다른 source/quote/결제수단을 보낸 경우는 충돌이다.

성공한 quote ID는 주문 ID에 한 번 결속한다. 재생 판단은 source/견적의 현재 만료 검사보다 먼저 수행해 견적 개인정보 정리 뒤에도 원래 요청이 재생되도록 한다. 개인정보를 보존 기간 밖까지 붙잡기 위해 재생 계약을 바꾸지 않는다.

## 금액과 공급

[할인·배송 설계](discounts-shipping-transaction-proposal.md)의 S/V/C/R/H/D를 공통 계약으로 사용한다.

```text
S = 기간 할인 후 품목 소계
V = 복수구매 할인
C = 쿠폰 할인
R = 적립금 사용
H = 온라인 결제에 포함된 선결제 운임
D = 배송 시 별도 지급할 착불 운임
T = S - V - C - R + H
```

T만 기존 payment attempt/payment/refund에 사용한다. D는 외부 수납 증거와 별도 원장이다. 새 주문에는 계산 버전과 품목별 V/C/R, 운임 구성요소별 H/D를 고정해 서버 합계·주문·배송·엑셀 간 불일치를 검출한다. 기존 주문은 V=0인 기존 계약으로 검증하고 누락된 과거 정책을 현재 값으로 채우지 않는다.

최신 `goods_order_snapshot_matches`는 금액뿐 아니라 예약 품목의 reservation이 같은 order/item/policy/quantity이고 `reserved|allocated` 상태인지도 확인한다. V/D 산식을 바꾸면서 이 공급 무결성 검사를 삭제하거나 약화하지 않는다.

새 주문의 공통 내부 생성 함수는 명시적 선택 목록을 받아 기존 재고·예약 공급 검사를 수행한다. 구독이나 선물을 만들기 위해 사용자의 카트를 임시 교체한 뒤 원복하는 방법은 사용하지 않는다. 일반 카트 wrapper만 실제 카트 조회/삭제를 소유한다.

현재 authenticated execute가 열린 구형 `place_order(jsonb,uuid,order_payment_method)`와 모든 service wrapper도 적용 대상이다. 새 정책이 켜진 선택은 확정 quote 없이 legacy 계산으로 주문할 수 없게 공통 검사로 닫는다. Action만 새 경로로 바꿔 직접 RPC 우회를 남기지 않는다. 새 정책이 없는 기존 호출은 같은 입력·스냅샷 계약을 유지한다.

쿠폰·적립금은 주문의 결제자 소유다. 정기배송의 다음 회차는 현재 카트에 선택된 쿠폰이나 남은 적립금을 자동으로 가져오지 않는다. 별도 동의한 회차 혜택 규칙이 없다면 미래 회차에는 쿠폰/적립금 0을 명시하고, 복수구매/기간가격은 같은 견적 산식으로 계산한다.

착불 D의 부담자도 별도로 정한다. 선물에서 수신자가 부담한다면 정확한 D·수납 주체/방법을 수락 내용에 결속하고 변경 후 다시 동의받아야 한다. 이 계약이 없는 선물은 선결제만 허용한다. 정기배송의 금액 재동의는 T뿐 아니라 D의 증가와 수납 주체/방법 변경도 포함한다.

## 잠금과 경합

기존 사용자 advisory lock을 모든 creator의 첫 공통 잠금으로 유지한다. 계정 정지·삭제 경로와 교착하지 않도록 account-action 잠금과 profile 공유 잠금을 source 잠금보다 먼저 취득한다. 선물처럼 관련 사용자가 둘 이상이면 각 계층에서 사용자 UUID를 정렬한다. 그 뒤 source ID의 잠금, 해당 source의 현재 상태, checkout key/기존 주문, 정렬된 상품/옵션/공급, 정렬된 출고지/운임, 쿠폰, 적립금 순서로 진행한다. 카트 Adapter와 기존 카트 변경 RPC도 같은 actor/account 순서를 따른다. 구체적인 row/advisory 순서는 최신 함수 호출 그래프 및 실제 경합으로 검증한다.

- 같은 사용자의 다른 주문에서 domain row를 잡은 뒤 사용자 잠금을 얻는 역방향 경로를 만들지 않는다.
- 구독 회차 획득은 `SKIP LOCKED`가 있더라도 SQL claim과 외부 결제 사이의 소유 lease·만료·fencing 값을 갖는다.
- 선물 수락/거절/기한 만료와 생성, 구독 일시정지/해지/금액 재동의와 회차 생성은 같은 source 잠금으로 직렬화한다.
- 외부 승인 진행 중에는 DB transaction을 열어 둔 채 네트워크를 기다리지 않는다. durable attempt를 먼저 확정하고 검증된 결과를 멱등 finalizer에 전달한다.
- 역할/계정 변경은 새 결제 시작을 막되, 이미 외부에서 발생한 결제의 증거를 저장하거나 환급을 복구하는 경로까지 사라지게 하지 않는다.

## 선물 주소의 별도 검토

현재 [checkout loader](../../../lib/checkout.server.ts)는 선물 전용 안전 조회를 먼저 수행하고, 본인의 일반 주문임이 확인된 경우에만 기존 원본 조회로 진행한다. 선물 조회 오류·권한 없음은 일반 조회로 우회하지 않는다. 선물 수신자의 비공개 주소를 공개 `orders.address`에 넣고 화면에서만 숨기는 방법은 금지한다. public 직접 조회 권한, 안전한 고객용 주문 DTO, private 배송 주소, 관리자·출고·회수·엑셀·이메일·계정 삭제를 함께 검토한다.

결제 시점은 2026-10-14 사용자가 **수신자 수락·주소 입력 후 구매자가 결제**하는 방식으로 확정했다. 수락된 주소로 공통 확정 견적을 계산하며, 구매자에게 수신자의 주소·연락처·지역 매칭 근거를 공개하지 않는다.

## 일반 주문서와 응답 복구

[신규 주문서](../../../components/screens/GoodsTransactionCheckout.tsx)는 주소·현재 카트·쿠폰·적립금·배송비 결제방법의 변경 즉시 이전 견적을 숨긴다. 선불 H를 포함한 온라인 T, 착불 D, 총 부담 T+D를 구분한다. 결제 대기와 주문 상세 화면은 같은 불변 영수증 표시를 사용한다. 상품 코드가 이후 변경돼도 주문 품목 ID와 옵션·수량·단가를 기준으로 원영수증을 검증한다.

주문 생성 결과가 불명확하면 새 주문을 만들지 않고 원 quote/key/결제수단으로 재개한다. 브라우저 sessionStorage에는 계정·로그인 세션·quote ID·checkout key·결제수단만 남기며 주소·연락처·직접입력 내용은 저장하지 않는다. 서버 재개 RPC는 이미 성공한 영수증을 gateway gate나 quote 개인정보 정리보다 먼저 반환한다. 미생성일 때만 현재 gate와 원 quote의 유효기간·카트·쿠폰을 다시 검사한다. 계정 또는 로그인 세션이 바뀌면 이전 입력과 늦은 응답을 폐기한다.

공개 Action의 요청은 UTF-8 JSON 2 MiB 이내로 검사하며, Next.js Action의 HTTP 본문 상한은 프레이밍 여유를 둔 3 MiB다. DB의 선택·견적 저장 크기도 별도로 검사한다. 1,000행의 DB 조회 페이지 크기를 주문 전체의 행수 상한으로 사용하지 않는다. 1,001개의 서로 다른 직접입력 선택을 보존하는 회귀를 검증했으며, 크기 상한 초과는 품목을 조용히 자르는 대신 분할 주문 안내와 함께 거절한다.

이 구현 단계에서 관련 14개 테스트 파일의 167개 사례·변경 TypeScript ESLint·전체 tsc를 통과했다. 이후 요청 크기 제한을 추가해 영향받은 3개 파일 24개 사례와 변경 코드/설정 ESLint를 재검증했다. 정확한 소스와 구현 검증 기록 (`output/goods-transaction-checkout-qa-20261014/implementation-verification.json`)을 남겼다. 이후 공통 계산 기반 migration 2개만 지정 로컬 OWN/FRESH/CANON에 적용했고, 각 원장 244→246 / 277→279 / 312→314와 기존 행·권한·RLS 보존, runtime OFF를 확인했다. 적용 근거 (`output/goods-transaction-design-20261014/named-foundation-summary.json`). 이후 선물·배송·알림 migration 6개도 동일 로컬 DB에 적용해 OWN252/FRESH285/CANON320, 기존 행·권한 보존과 신규 gate OFF를 확인했다. 선물 및 운영 적용 근거 (`output/gift-order-qa-20261014/named-gift/result.json`). 선물·일반 주문의 실제 전액 환불 및 철회 후 재접수 회귀를 포함한 격리 SQL 전체 검증도 통과했다. 금융 통합 검증 (`output/gift-order-qa-20261014/syntax-financial-27/result.json`). 정기배송·착불 후속 운영 migration의 지정 DB 적용, 실제 PC/390px 금융 화면, 전체 저장소 최종 테스트/build와 배포는 아직 별도 후속 검증이다.

## 주문 이후 운영과 알림

관리자 주문·클레임과 목록 파일은 v2 원영수증의 복수구매 할인 V·쿠폰 C·적립금 R·선불 H·착불 D를 사용한다. 착불은 온라인 결제·PG 환불에 더하지 않으며 별도 수납 주체와 환급 문의를 표시한다. 선물 클레임에서는 실제 요청자가 구매자인지 받는 분인지 구분하고 환불은 구매자 결제수단으로 처리한다.

선물의 실제 주소는 권한이 있는 운영 조회와 출고 파일에서만 private 배송 소유자를 통해 읽는다. 창고의 기존 김포 21열·서원 7열은 유지한다. 선물·착불이 포함되면 XLSX에 `배송 운영 안내` 시트를 추가하고 CSV는 기존 출고지시와 배송운영안내 2개 파일을 ZIP으로 제공한다. 수령인용 명세에는 가격·할인·결제정보를 표시하지 않고 내부 출고 파일을 동봉하지 않도록 포장 요청에 명시한다. 운송장 회신은 창고 본문 시트 1개와 정확한 형식의 배송 운영 안내 시트를 허용한다.

주문 확인·배송 이메일은 구매자와 선물 수령인별 멱등키를 사용한다. 구매자에게는 계약 금액을 알리되 수령인 주소·연락처·운송장을 숨기고, 수령인에게는 상품·수량·자신의 주소·운송장만 제공한다. 한쪽의 전송 실패·결과 불명은 별도로 보존하며 배송 작업 완료는 양쪽이 모두 전송된 경우에만 확정한다. 수신자 한 명에 대한 관리자 재발송은 그 대상만 재시도한다. 지연 안내도 미리보기에서 구매자·수령인 두 대상을 보여준 뒤 각각의 고정 발송 대상과 원래 durable intent로 처리한다. 모든 개발 검증은 합성 주소와 가짜 발송기로 수행하며 외부 이메일은 보내지 않는다.

## 정기배송과 토스 빌링의 별도 Seam

2026-10-14 [토스 자동결제 공식 문서](https://docs.tosspayments.com/guides/v2/billing), [API](https://docs.tosspayments.com/reference#자동결제), [SDK](https://docs.tosspayments.com/sdk/v2/js/payment#paymentrequestbillingauth)를 확인했다. 자동결제는 별도 리스크 검토/계약이 필요하며 가맹점이 주기를 직접 실행한다. 현재 계정의 빌링 계약 또는 키 권한을 확인한 것은 아니다.

정기배송의 `RecurringBilling` Module은 카드 등록 준비·일회 인증 결과 교환·회차 결제·조회·등록 해지를 소유한다. 실제 Toss Adapter와 테스트 Fake Adapter를 같은 Interface로 검증한다. 주문 가격/공급을 다시 구현하지 않고 위 `GoodsTransaction`이 만든 회차 주문과 기존 승인/환급 finalizer를 사용한다.

- 빌링 `customerKey`는 추측 불가능한 UUID로 발급한다. 카드번호/유효기간/비밀번호를 ICONS의 입력 폼이나 DB에 수집하지 않고 SDK 등록창을 쓴다.
- 빌링키는 서버에서 인증 암호화하고 암호문·키 버전만 private 저장한다. 평문은 브라우저 DTO·로그·감사·오류·XLSX에 포함하지 않는다. 등록 세션의 actor·nonce·만료·일회 교환 결과를 결속한다.
- 기존 주문서형 키와 빌링 개별 연동 키의 준비를 별도로 검사한다. 키가 있다는 사실만으로 공개 gate나 계약 준비 상태를 켜지 않는다. 신규 공개/실행 gate는 OFF다.
- 공식 자동결제 승인 API는 최대 60초이므로 최소 60초 provider timeout과 이를 수용할 실행 예산을 따로 둔다. 기존 일반 승인 25초 설정을 무조건 재사용하지 않는다.
- 외부 결과는 merchant/order ID·amount/currency·상태·BILLING 타입·결제수단을 검증한다. 불명확 결과는 같은 원래 시도와 provider 주문번호로 조회하며 새 회차/새 금액으로 재청구하지 않는다.
- 현재 `finalize_goods_payment_attempt`는 `unknown|needs_review`를 재생 반환한다. 조회 뒤 승인으로 수렴할 때는 기존 `claim_goods_payment_reconciliation`으로 재claim해 `confirming`과 새 token을 받고 `finalize_goods_payment_reconciliation`으로 종결한다. 단순 finalizer 재호출을 복구 완료로 보지 않는다.
- 같은 `toss` provider라도 일반 주문서형과 빌링의 credential/merchant가 다를 수 있다. attempt에 서버가 결속한 결제 흐름을 기준으로 confirm/reconcile/refund/webhook/정산 Adapter를 선택하며 브라우저의 provider/flow 값을 신뢰하지 않는다. 일반 결제 키로 빌링 환급을 호출하지 않는다.
- 현재 일반 결제 설정은 gck/gsk만 허용하고 결과 검증도 BILLING 타입/MID 결속을 제공하지 않는다. 별도 private binding에 `toss_order_form|toss_billing`, 불변 credential profile 식별자와 MID를 보존하고, 평문 키가 아닌 이 식별자로 과거 attempt의 조회·환급까지 올바른 Adapter에 전달한다. 키 교체와 과거 결제 복구에 필요한 설정도 운영 계약에 포함한다.
- 해지는 미래 회차를 중단한다. 이미 확정된 주문을 해지 동작만으로 환급 완료 처리하지 않는다. 해당 회차 취소/반품은 기존 전체 주문 계약을 따른다.

## 구현·검증 순서

1. 최신 함수/ACL/registry와 일반 주문 회귀 기준을 추출하고, 선택 원본과 금액 계산의 실제 변경 위치를 확정한다.
2. 복수구매 할인·확장 배송 정책과 공통 계산/생성을 구현한다. 일반 checkout부터 상품·카트·주문·결제·환급·원장·리포트·파일을 연결한다. UI 설정 저장만으로 완료 처리하지 않는다.
3. 선물과 정기배송은 각 원본 Adapter·권한·주소/동의·운영 화면을 구현하고 공통 생성에 연결한다. 미확인 외부 계약을 성공 상태로 표시하지 않는다.
4. 각 SQL을 새 격리 clone에서 적용하고 새 산식의 독립 oracle, 기존 주문/쿠폰/적립금/지역/예약/환급 회귀, 실제 두 세션 경합, ACL·PII·멱등·원장 대조를 검증한다. 현재 로컬 검증 DB에 적용하기 전 exact SHA와 결과를 검토한다.
5. 합성 데이터의 실제 PC/390px 입력→확정 견적→주문→Fake provider 승인/모호 결과→재조회→전체 환급→원장/파일 readback을 검증한다. 실제 PG·은행·운송사 거래는 이 테스트에 포함하지 않는다.

각 migration은 한 번 검증 DB에 적용한 뒤 불변으로 유지한다. 일반 주문이 무변경으로 유지되는 조합과 새 정책이 적용되는 조합을 모두 검증하며, 새 기능을 숨겨 기존 테스트만 통과한 상태를 완료로 보지 않는다.
