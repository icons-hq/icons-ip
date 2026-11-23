-- 성인 상품 전체 숨김을 반영한 주문 생성 함수의 운영자 계약 지문을 갱신한다.
select private.register_operator_internal_contract(
  'private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure
);
