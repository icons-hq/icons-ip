-- ============================================================================
-- ICONS · 택배사 코드 허용 목록을 DB에서 강제
--
-- 20260807120002(#178)는 shipping_carrier에 형식(^[a-z0-9_]{2,32}$)만 걸었다.
-- 그래서 staff RPC가 'cj'·'zz'처럼 등록되지 않은 코드도 저장했는데, 렌더 쪽
-- lib/orders/shipment.ts의 findCarrier는 미등록 코드에 null을 돌려주고 주문 상세는
-- `order.shipment &&` 가드에서 배송 정보를 통째로 감춘다. 어드민 콘솔도 빈 값으로
-- 프리필돼 저장된 운송장을 확인할 수 없다. 결과적으로 "고객이 주문 상세에서
-- 배송을 추적할 수 있다"(#178)가 DB 어디에서도 보장되지 않았다.
--
-- 표시할 수 없는 코드는 저장하지 않는다. 허용 목록의 진실원은 여전히 앱의
-- SHIPPING_CARRIERS이고 DB는 같은 값을 복제해 강제한다 — 택배사 추가는 앱 상수와
-- 이 제약을 함께 바꾸는 마이그레이션을 요구한다. 계약 택배사가 늘어나는 빈도보다
-- 잘못 저장된 코드로 배송조회가 사라지는 비용이 크다.
-- ============================================================================

alter table public.orders
  drop constraint orders_shipping_carrier_check;

-- lib/orders/shipment.ts의 SHIPPING_CARRIERS와 같은 값이어야 한다. 양쪽을 함께 바꾼다.
alter table public.orders
  add constraint orders_shipping_carrier_check
    check (shipping_carrier is null or shipping_carrier in ('hanjin'));
