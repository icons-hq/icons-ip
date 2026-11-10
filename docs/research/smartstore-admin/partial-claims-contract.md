# 주문 전체 취소·반품 정책과 경계

확정: 2026-10-12. 사용자는 스마트스토어 대응 작업 중 **부분취소와 부분반품을 제공하지 않고 항상 주문 전체 취소·반품 및 결제금액 전액 환급만 허용**하기로 명시했다. 부분 거래는 구현 대기 항목이 아니라 이번 범위에서 제외한 제품 결정이다. 스마트스토어의 상품주문 단위 처리와 달라도 승인된 차이로 유지한다.

교환은 이 결정에서 일부 수량 정책을 새로 추론하지 않는다. 기존 주문 단위 회수·동일 상품 옵션 재출고·실제 수령 확인 계약을 유지한다.

## 유지하는 실제 계약

- 고객 API [`claims/route.ts`](../../../app/api/orders/[orderId]/claims/route.ts)는 주문 ID, 클레임 유형, 사유, 필요한 환불계좌를 받는다. 품목·수량·부분 금액을 받지 않으며, 예상하지 않은 body 키를 거부한다. 레거시 [`cancel/route.ts`](../../../app/api/orders/[orderId]/cancel/route.ts)도 같은 경계를 유지한다.
- [`request_order_claim`](../../../supabase/migrations/20260909001505_order_claim_origin_collection_policy.sql)은 주문 전체를 잠그고 신청 자격과 중복 요청을 판정한다. 반품은 필요한 모든 출고지의 회수를 확인한 뒤 환급한다.
- [`finalize_order_cancellation_with_provider_evidence`](../../../supabase/migrations/20260910091900_sales_preorder_checkout_fulfillment.sql)는 검증된 원결제 전액 환급과 전체 대상 재고·미개봉 리워드·혜택 처리를 멱등 확정한다. 부분 금액으로 재사용하지 않는다.
- [`toss-gateway.server.ts`](../../../lib/payments/toss-gateway.server.ts)와 [`cancellation-orchestrator.server.ts`](../../../lib/orders/cancellation-orchestrator.server.ts)의 전액 검증을 유지한다. [`korpay-gateway.server.ts`](../../../lib/payments/korpay-gateway.server.ts)의 기존 수동 확인 경계도 바꾸지 않는다.
- 최초 배송비를 포함한 기존 환급 금액 계약과 법정 기한·별도 수거비 증거 계약은 [ADR-0017](../../adr/0017-order-claim-intake-and-origin-collections.md)을 따른다. 이번 결정은 외부 제공사의 지원 기능이나 법정 권리를 재정의하지 않는다.

## 화면·요청 검증

고객 취소·반품 안내와 관리자 클레임 상세에 주문 전체·전액 처리를 표시한다. 품목 선택, 수량 입력, 환불액 직접 입력을 추가하지 않는다. `items`, `orderItemId`, `quantity`, `refundAmount` 등 부분 처리로 해석될 수 있는 추가 필드를 보내면 요청을 거부하며, 무시한 뒤 주문 전액을 취소하지 않는다. 승인된 기존 요청의 성공·실패·재시도 동작은 유지한다.

[판매·정산 대응 문서](sales-parity.md)에서는 이 차이를 미구현 갭에서 제외한다. PG 부분 취소 API·부분 환불 원장·수량 재고 배분·혜택 재산정은 이번 작업에 추가하지 않는다.
