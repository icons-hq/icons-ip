\set ON_ERROR_STOP on
-- ERP 주문 피드: service_role 만 · 결제된 주문만 · 개인정보 없음 · 키셋 커서. 모든 픽스처는 되돌린다.
begin;
create function pg_temp.ef_id(kind text,n integer) returns uuid language sql immutable as $$
 with source as(select md5('erp-order-feed:'||kind||':'||n) value)
 select (substr(value,1,8)||'-'||substr(value,9,4)||'-4'||substr(value,14,3)||'-8'||substr(value,18,3)||'-'||substr(value,21,12))::uuid from source;
$$;
create function pg_temp.ef_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'ERP order feed assertion: %',label;end if;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values(pg_temp.ef_id('buyer',1),'authenticated','authenticated','erp-order-feed@example.test',now(),'{}','{}');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values(pg_temp.ef_id('origin',1),'erp-order-feed-origin','피드 합성 출고지',0,'합성 반송 주소');
insert into public.ips(id,title,vertical_key) values('erp-order-feed-ip','피드 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('erp-order-feed-good','erp-order-feed-ip','피드 합성 굿즈','문구',1000,'ok',100,pg_temp.ef_id('origin',1));
insert into private.goods_variant_external_identity(variant_id,erp_code,erp_name,barcode)
 select v.id,'ERP-FEED-0001','피드 합성 품목','8800000000011' from public.goods_variants v where v.good_id='erp-order-feed-good' and v.is_default;

-- 1 결제(출고 전) · 2 출고(운송장) · 3 결제 없는 만료 취소(빠짐) · 4 결제 대기(빠짐) · 5 결제 뒤 취소
insert into public.orders(id,user_id,status,total,address,created_at,updated_at,payment_method)
 select pg_temp.ef_id('order',n),pg_temp.ef_id('buyer',1),
  (array['paid','shipping','canceled','pending','canceled'])[n]::public.order_status,
  2000+n,jsonb_build_object('recipientName','피드 합성 수취인','phone','01000000000','address1','합성 주소'),
  '2026-11-01T00:00:00Z','2026-11-01T00:00:00Z'::timestamptz+n*interval '1 minute','card'
 from generate_series(1,5)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ef_id('item',n),pg_temp.ef_id('order',n),g.id,v.id,n,1000,g.name,g.type,g.ip_id
 from generate_series(1,5)n join public.goods g on g.id='erp-order-feed-good' join public.goods_variants v on v.good_id=g.id and v.is_default;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider)
 values(pg_temp.ef_id('payment',5),pg_temp.ef_id('buyer',1),'order',pg_temp.ef_id('order',5),2005,'canceled','erp-feed-payment-5','erp-feed-idempotency-5','toss'),
  (pg_temp.ef_id('payment',3),pg_temp.ef_id('buyer',1),'order',pg_temp.ef_id('order',3),2003,'failed','erp-feed-payment-3','erp-feed-idempotency-3','toss');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at)
 values(pg_temp.ef_id('shipment',2),pg_temp.ef_id('order',2),pg_temp.ef_id('origin',1),'피드 합성 출고지',3000,'{}','shipping','hanjin','123456789012','2026-11-02T00:00:00Z');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
 values(pg_temp.ef_id('order',2),pg_temp.ef_id('shipment',2),pg_temp.ef_id('item',2));

select pg_temp.ef_assert(not has_function_privilege('anon','public.service_erp_order_feed(timestamptz,uuid,integer)','execute'),'anon cannot read the feed');
select pg_temp.ef_assert(not has_function_privilege('authenticated','public.service_erp_order_feed(timestamptz,uuid,integer)','execute'),'signed-in users cannot read the feed');
select pg_temp.ef_assert(has_function_privilege('service_role','public.service_erp_order_feed(timestamptz,uuid,integer)','execute'),'service role reads the feed');

set local role service_role;
create temp table ef_page on commit drop as
 select public.service_erp_order_feed(null,null,500) as body;
reset role;

do $$ declare body jsonb; mine jsonb; shipped jsonb;
begin
 select ef_page.body into body from ef_page;
 select coalesce(jsonb_agg(o order by o->>'changedAt'),'[]') into mine
 from jsonb_array_elements(body->'orders') o
 where (o->>'id')::uuid in(select pg_temp.ef_id('order',n) from generate_series(1,5)n);
 perform pg_temp.ef_assert(jsonb_array_length(mine)=3,'paid, shipped and paid-then-canceled orders only: '||mine::text);
 perform pg_temp.ef_assert((select array_agg((o->>'id')::uuid order by o->>'changedAt') from jsonb_array_elements(mine) o)
  =array[pg_temp.ef_id('order',1),pg_temp.ef_id('order',5),pg_temp.ef_id('order',2)],'expected orders in cursor order');
 perform pg_temp.ef_assert((select bool_and(o->>'orderNumber' is not null) from jsonb_array_elements(mine) o),'readable order number is carried');
 perform pg_temp.ef_assert(mine->0->'items'->0->>'erpCode'='ERP-FEED-0001','ERP code snapshot is carried');
 perform pg_temp.ef_assert(mine->0->'items'->0->>'barcode'='8800000000011','barcode snapshot is carried');
 select o into shipped from jsonb_array_elements(mine) o where (o->>'id')::uuid=pg_temp.ef_id('order',2);
 perform pg_temp.ef_assert(shipped->'shipments'->0->>'trackingNumber'='123456789012','tracking number is carried');
 perform pg_temp.ef_assert(shipped->'shipments'->0->'itemIds'->>0=pg_temp.ef_id('item',2)::text,'shipment lists its items');
 perform pg_temp.ef_assert((shipped->>'changedAt')::timestamptz>='2026-11-02T00:00:00Z','shipping moves the cursor');
 perform pg_temp.ef_assert(body::text not like '%피드 합성 수취인%' and body::text not like '%01000000000%' and body::text not like '%합성 주소%','no recipient data');
 perform pg_temp.ef_assert(body::text not like '%erp-feed-payment%' and body::text not like '%erp-order-feed@example.test%','no payment keys or emails');
end $$;

do $$ declare first jsonb; second jsonb;
begin
 select public.service_erp_order_feed(null,null,1) into first;
 perform pg_temp.ef_assert(jsonb_array_length(first->'orders')=1 and first->'next' is not null,'limit returns one order and a cursor');
 select public.service_erp_order_feed((first->'next'->>'at')::timestamptz,(first->'next'->>'id')::uuid,1) into second;
 perform pg_temp.ef_assert(second->'orders'->0->>'id' is distinct from first->'orders'->0->>'id','cursor moves past the previous page');
 select public.service_erp_order_feed('2999-01-01T00:00:00Z',null,10) into second;
 perform pg_temp.ef_assert(second->'orders'='[]'::jsonb and jsonb_typeof(second->'next')='null','empty page has no cursor');
end $$;
rollback;
