\set ON_ERROR_STOP on
begin;
create function pg_temp.item_test_id(kind text,n integer) returns uuid language sql immutable as $$select md5('item-console:'||kind||':'||n)::uuid$$;
create function pg_temp.item_expect_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;raise exception 'Expected item console error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.item_test_id('user',n),'authenticated','authenticated','item-console-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,6)n;
update public.profiles set role='staff' where id in(select pg_temp.item_test_id('user',n) from generate_series(1,5)n);
update public.profiles set nickname='item_console_buyer' where id=pg_temp.item_test_id('user',6);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.item_test_id('user',1),'primary'),(pg_temp.item_test_id('user',2),'primary'),
 (pg_temp.item_test_id('user',3),'influencer'),(pg_temp.item_test_id('user',4),'deputy'),(pg_temp.item_test_id('user',5),'logistics');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
select pg_temp.item_test_id('origin',n),'item-console-'||n,'합성 출고지 '||n,0,'합성 반송 주소' from generate_series(1,2)n;
insert into public.ips(id,title,vertical_key) values('item-console-ip','상품주문 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
select 'item-console-good-'||n,'item-console-ip','현재 이름 '||n,'문구',1000,'ok',10000,pg_temp.item_test_id('origin',n) from generate_series(1,2)n;
insert into public.orders(id,user_id,status,total,address,created_at,confirmed_at,payment_method)
values (pg_temp.item_test_id('order',1),pg_temp.item_test_id('user',6),'paid',5000,'{"recipientName":"합성 수취인","phone":"010-0000-0101"}','2026-09-01T14:59:59Z',null,'card'),
 (pg_temp.item_test_id('order',2),pg_temp.item_test_id('user',6),'confirmed',1000,'{"recipientName":"합성 수취인"}','2026-09-01T15:00:00Z','2026-09-04T15:00:00Z','bank_transfer'),
 (pg_temp.item_test_id('order',3),pg_temp.item_test_id('user',6),'pending',0,'{"recipientName":"합성 수취인"}','2026-09-02T15:00:00Z',null,'bank_transfer');
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_name_snapshot,variant_code_snapshot,qty,unit_price)
select pg_temp.item_test_id('item',n),pg_temp.item_test_id('order',case when n<=2 then 1 else n-1 end),
 'item-console-good-'||case when n=2 then 2 else 1 end,v.id,
 case when n=1 then '주문 당시 100% 코튼' else '주문 당시 기본 상품' end,'문구','item-console-ip','선택 옵션 '||n,'ITEM-OPTION-'||n,
 case when n=1 then 2 else 1 end,case when n=2 then 3000 when n=4 then 0 else 1000 end
from generate_series(1,4)n join public.goods_variants v on v.good_id='item-console-good-'||case when n=2 then 2 else 1 end and v.is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at)
select pg_temp.item_test_id('shipment',n),pg_temp.item_test_id('order',1),pg_temp.item_test_id('origin',n),'합성 출고지 '||n,0,'{}','shipping','hanjin','ITEMTRACK000'||n,now() from generate_series(1,2)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select pg_temp.item_test_id('order',1),pg_temp.item_test_id('shipment',n),pg_temp.item_test_id('item',n),case when n=1 then 2 else 1 end from generate_series(1,2)n;
create temp table item_console_before as select to_jsonb(o) document from public.orders o where id in(select pg_temp.item_test_id('order',n) from generate_series(1,3)n);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',1)::text,true);
select public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer') as result \gset
select 1/case when :'result'::jsonb->>'total'='4' and :'result'::jsonb->>'orderCount'='3' and :'result'::jsonb->>'qty'='5'
 and :'result'::jsonb#>>'{counts,paid}'='2' and jsonb_array_length(:'result'::jsonb->'rows')=4 then 1 else 0 end as item_counts_not_order_counts;
select 1/case when public.admin_search_order_items_console(p_field:='tracking',p_query:='ITEM-TRACK-0001')->>'total'='1'
 and public.admin_search_order_items_console(p_field:='tracking',p_query:='ITEMTRACK0002')#>>'{rows,0,id}'=pg_temp.item_test_id('item',2)::text
 and public.admin_search_order_items_console(p_field:='product',p_query:='100%')#>>'{rows,0,goodName}'='주문 당시 100% 코튼'
 and public.admin_search_order_items_console(p_field:='product',p_query:='100%')->>'total'='1'
 and public.admin_search_order_items_console(p_field:='product',p_query:='현재 이름')->>'total'='0'
 and public.admin_search_order_items_console(p_field:='product',p_query:=(select variant_code_snapshot from public.order_items where id=pg_temp.item_test_id('item',2)))->>'total'='1'
 and public.admin_search_order_items_console(p_field:='item',p_query:=pg_temp.item_test_id('item',1)::text)#>>'{rows,0,itemAmount}'='2000'
 then 1 else 0 end as own_shipment_literal_search_and_order_snapshots;
select 1/case when public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_from:='2026-09-02',p_to:='2026-09-02')->>'total'='1'
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_date_field:='paid',p_from:='2026-09-01',p_to:='2026-09-30')->>'total'='0'
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_date_field:='confirmed',p_from:='2026-09-05',p_to:='2026-09-05')->>'total'='1'
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_status:='paid')#>>'{counts,confirmed}'='1'
 then 1 else 0 end as kst_dates_no_payment_fallback_and_unfiltered_status_counts;
select 1/case when public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_limit:=1,p_offset:=0,p_sort:='amount_high')#>>'{rows,0,id}'=pg_temp.item_test_id('item',2)::text
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_limit:=1,p_offset:=1,p_sort:='amount_high')#>>'{rows,0,id}'=pg_temp.item_test_id('item',1)::text
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_limit:=1,p_offset:=1)->>'fingerprint'=:'result'::jsonb->>'fingerprint'
 and public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_limit:=1,p_offset:=20)->>'total'='4'
 and jsonb_array_length(public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer',p_limit:=1,p_offset:=20)->'rows')=0
 then 1 else 0 end as pagination_and_fingerprint_stable;
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console(p_limit:=501)$q$,'22023');
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console(p_field:='invented')$q$,'22023');
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console(p_sort:='invented')$q$,'22023');
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',2)::text,true);
select 1/case when public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer')->>'total'='4' then 1 else 0 end as second_primary_reads;
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',3)::text,true);
select 1/case when public.admin_search_order_items_console(p_field:='nickname',p_query:='item_console_buyer')->>'total'='4' then 1 else 0 end as influencer_reads;
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',4)::text,true);
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console()$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',5)::text,true);
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console()$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',6)::text,true);
select pg_temp.item_expect_error($q$select public.admin_search_order_items_console()$q$,'42501');
reset role;
select 1/case when not exists((select document from item_console_before) except (select to_jsonb(o) from public.orders o where id in(select pg_temp.item_test_id('order',n) from generate_series(1,3)n)))
 and not has_function_privilege('anon','public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)','EXECUTE') then 1 else 0 end as no_mutation_and_sealed_roles;
-- A result over PostgREST's normal 1,000-row cap is paged inside a single JSON envelope.
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
select pg_temp.item_test_id('large',n),pg_temp.item_test_id('order',3),'item-console-good-1',v.id,'대량 전용 합성 상품','문구','item-console-ip',1,1000
from generate_series(1,1005)n cross join public.goods_variants v where v.good_id='item-console-good-1' and v.is_default;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.item_test_id('user',1)::text,true);
select 1/case when public.admin_search_order_items_console(p_field:='product',p_query:='대량 전용 합성',p_limit:=500)->>'total'='1005'
 and jsonb_array_length(public.admin_search_order_items_console(p_field:='product',p_query:='대량 전용 합성',p_limit:=500)->'rows')=500
 and jsonb_array_length(public.admin_search_order_items_console(p_field:='product',p_query:='대량 전용 합성',p_limit:=500,p_offset:=500)->'rows')=500
 and jsonb_array_length(public.admin_search_order_items_console(p_field:='product',p_query:='대량 전용 합성',p_limit:=500,p_offset:=1000)->'rows')=5
 then 1 else 0 end as complete_large_pagination;
reset role;
rollback;
