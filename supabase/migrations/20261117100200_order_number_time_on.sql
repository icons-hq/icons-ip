-- 주문 시각 번호 전환을 켠다(1014-116·117).
-- 20261112150000_order_number_time은 전환을 꺼 둔 채(switched_at = infinity) 배포했고, 이 migration이
-- 런북 docs/runbooks/order-reference-numbers.md '전환 켜는 순서' 3번의 후속 migration이다.
-- 선행 확인(1·2번): 운영 production은 두 형식을 읽는 앱이고, AX ERP는 주문번호를 길이 제한 없는 문자열로 받는다.
-- 이 migration을 적용한 시각 이후(이상)에 만든 주문부터 주문번호·상품주문번호가 20자리다.
-- 이미 발급한 16자리 번호와 배송건번호(16자리)는 바뀌지 않는다. 이미 켜져 있으면 아무것도 바꾸지 않는다.
begin;
update private.commerce_number_time_switch set switched_at = clock_timestamp()
 where singleton and switched_at = 'infinity'::timestamptz;
commit;
