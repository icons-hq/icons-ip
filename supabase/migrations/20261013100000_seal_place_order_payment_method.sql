-- 3인자 주문 생성 본문 place_order(jsonb,uuid,order_payment_method)의 브라우저 롤 봉인을 복구한다.
--
-- 계약(20260722062300, 20260818140001 §10): 브라우저는 주문 생성 RPC를 직접 부르지 못한다.
-- 서버가 인증·정지 계정·결제수단 게이트(app/checkout/actions.ts)를 확인한 뒤 service role
-- 래퍼만 연다 — place_order(uuid,jsonb,uuid[,order_payment_method]),
-- place_order_with_store_credits(5·6인자). 결제수단도 같은 경계를 지나야 한다. 열어 두면
-- 브라우저가 무통장 24시간 재고 선점을 스스로 고를 수 있다.
--
-- 회귀: 20260908040000(order_shipments_expand)이 본문을 private.place_order_before_shipments로
-- 옮기고 3인자 래퍼를 새로 만들면서 authenticated에 execute를 줬다. 마지막 정의인
-- 20260910091900(sales_preorder_checkout_fulfillment)도 `to authenticated,postgres`를 유지했다.
-- 그래서 로그인 사용자가 /rest/v1/rpc/place_order를 직접 호출하면 앱 게이트(무통장 계좌 설정,
-- PG gate, 정지 계정)를 건너뛰고 주문을 만들 수 있었다.
--
-- 앱 경로는 영향이 없다. service role → place_order_with_store_credits → 4인자 래퍼 →
-- 이 3인자 래퍼 → private 본문이 모두 postgres 소유 security definer 체인이라 이 grant가 필요 없다.
-- 함수 본문은 바꾸지 않고 ACL만 고친다. create or replace가 아니므로 정의 회귀 위험이 없다.
--
-- 나머지 오버로드는 이 시점에 이미 브라우저 롤에 닫혀 있다(has_function_privilege로 확인).
-- (jsonb,uuid)와 private 본문은 postgres 전용이고, (uuid,jsonb,uuid)·4인자·store-credit
-- 5·6인자는 service_role 전용이다. supabase/tests/checkout_order.sql이 전부 선언적으로 단언한다.
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method)
  from public, anon, authenticated, service_role;
grant execute on function public.place_order(jsonb,uuid,public.order_payment_method)
  to postgres;
