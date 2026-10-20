\set ON_ERROR_STOP on
-- Synthetic fixtures in an isolated local DB; prepend goods_kc_fixture.sql.
begin;
load 'safeupdate';
create function pg_temp.address_id(kind text,n integer) returns uuid language sql immutable as $$select md5('order-address:'||kind||':'||n)::uuid$$;
create function pg_temp.address_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected address error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.address_id('user',n),'authenticated','authenticated','order-address-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,5)n;
update public.profiles set role='staff' where id in(select pg_temp.address_id('user',n)from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.address_id('user',1),'primary'),(pg_temp.address_id('user',2),'primary'),(pg_temp.address_id('user',3),'logistics'),(pg_temp.address_id('user',4),'influencer');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
select pg_temp.address_id('origin',n),'address-origin-'||n,'주소 검증 출고지 '||n,'hanjin',case when n=1 then 3000 else 2000 end,'합성 반송 주소',true from generate_series(1,2)n;
insert into public.ips(id,title,vertical_key)values('order-address-ip','주소 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
select 'order-address-good-'||n,'order-address-ip','주소 검증 상품 '||n,'문구',10000,'ok',100,pg_temp.address_id('origin',n) from generate_series(1,2)n;
insert into private.shipping_region_adoptions(origin_id,managed_from)values(pg_temp.address_id('origin',1),now()-interval '1 day');
insert into private.shipping_region_policies(id,origin_id,carrier_code,version,status,configuration,starts_at,confirmed_by,confirmed_at,updated_by)
values(pg_temp.address_id('policy',1),pg_temp.address_id('origin',1),'hanjin',1,'active',
 jsonb_build_object('unlistedDisposition','standard','feeUnit','per_shipment','chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',false,'chargeIndividualGoods',true,
 'rules',jsonb_build_array(
  jsonb_build_object('id',pg_temp.address_id('rule',1),'postalFrom','70000','postalTo','70999','addressPrefix','','regionLabel','합성 추가료','disposition','surcharge','amount',2500),
  jsonb_build_object('id',pg_temp.address_id('rule',2),'postalFrom','80000','postalTo','80999','addressPrefix','','regionLabel','합성 불가','disposition','unavailable','amount',null))),
 now()-interval '1 day',pg_temp.address_id('user',1),now(),pg_temp.address_id('user',1));
create function pg_temp.original_address() returns jsonb language sql immutable as $$
 select '{"recipientName":"합성 수령인","phone":"01000000000","postalCode":"10000","address1":"합성시 검증로 1","address2":"101호","deliveryNote":"문 앞"}'::jsonb;
$$;
create function pg_temp.new_address() returns jsonb language sql immutable as $$
 select pg_temp.original_address()||'{"recipientName":"합성 변경 수령인","phone":"01011111111"}'::jsonb;
$$;
create function pg_temp.create_address_order(n integer) returns void language plpgsql as $$
declare lines jsonb;quote jsonb;
begin
 insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,updated_at)
 values(pg_temp.address_id('order',n),pg_temp.address_id('user',5),'confirmed',25000,5000,pg_temp.original_address(),now()-interval '1 day',now()-interval '1 day');
 insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.address_id('item-'||n,g),pg_temp.address_id('order',n),'order-address-good-'||g,v.id,'주소 검증 상품 '||g,'문구','order-address-ip',1,10000
 from generate_series(1,2)g join public.goods_variants v on v.good_id='order-address-good-'||g and v.is_default;
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot))
 into lines from public.order_items where order_id=pg_temp.address_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"10000","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.address_id('order',n);
 perform private.create_order_shipments(pg_temp.address_id('order',n));
end $$;
select pg_temp.create_address_order(n) from generate_series(1,11)n;
create temp table address_before as select id,total,shipping_fee,discount_total,store_credit_total,shipping_fee_breakdown from public.orders where id in(select pg_temp.address_id('order',n) from generate_series(1,11)n);
create temp table address_shipments_before as select id,order_id,shipping_fee,shipping_fee_snapshot,updated_at from public.order_shipments where order_id in(select pg_temp.address_id('order',n) from generate_series(1,11)n);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',1)::text,true);
select public.admin_order_address_context(pg_temp.address_id('order',1)) as ctx \gset
select 1/case when :'ctx'::jsonb->>'allowed'='true' and :'ctx'::jsonb->>'shipmentCount'='2' then 1 else 0 end as whole_order_context;
select public.admin_change_order_address(pg_temp.address_id('op',1),pg_temp.address_id('order',1),(:'ctx'::jsonb->>'revision')::integer,pg_temp.new_address(),'고객의 합성 전화 요청',true) as receipt \gset
select 1/case when :'receipt'::jsonb->>'currentMatches'='true' and :'receipt'::jsonb#>>'{address,phone}'='01011111111'
 and public.admin_get_order_address_change(pg_temp.address_id('op',1))=:'receipt'::jsonb
 and public.admin_change_order_address(pg_temp.address_id('op',1),pg_temp.address_id('order',1),(:'ctx'::jsonb->>'revision')::integer,pg_temp.new_address(),'고객의 합성 전화 요청',true)=:'receipt'::jsonb
 then 1 else 0 end as exact_replay_and_readback;
select pg_temp.address_error(format('select public.admin_change_order_address(%L,%L,%L,%L,%L,true)',pg_temp.address_id('op',1),pg_temp.address_id('order',1),:'ctx'::jsonb->>'revision',pg_temp.new_address(),'다른 이유'),'23505');
select pg_temp.address_error(format('select public.admin_change_order_address(%L,%L,%L,%L,%L,true)',pg_temp.address_id('op',2),pg_temp.address_id('order',1),:'ctx'::jsonb->>'revision',pg_temp.original_address(),'낡은 화면'),'PT409');
select pg_temp.address_error(format('select public.admin_change_order_address(%L,%L,%L,%L,%L,false)',pg_temp.address_id('op',2),pg_temp.address_id('order',1),:'ctx'::jsonb->>'revision',pg_temp.original_address(),'미합의'),'22023');
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',2)::text,true);
select 1/case when public.admin_get_order_address_change(pg_temp.address_id('op',1)) is null
 and public.admin_order_address_context(pg_temp.address_id('order',1))#>>'{history,0,before,phone}'='01000000000' then 1 else 0 end as actor_bound_receipt_and_manager_history;
select pg_temp.address_error(format('select public.admin_change_order_address(%L,%L,%L,%L,%L,true)',pg_temp.address_id('op',1),pg_temp.address_id('order',1),:'ctx'::jsonb->>'revision',pg_temp.new_address(),'고객의 합성 전화 요청'),'23505');
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',3)::text,true);
select pg_temp.address_error('select public.admin_order_address_context(pg_temp.address_id(''order'',1))','42501');
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',4)::text,true);
select pg_temp.address_error('select public.admin_order_address_context(pg_temp.address_id(''order'',1))','42501');
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',5)::text,true);
select pg_temp.address_error('select public.admin_get_order_address_change(pg_temp.address_id(''op'',1))','42501');
reset role;
-- Dispatch/export, open claims, missing shipments and legacy quote all fail closed.
update public.order_shipments set exported_at=now() where order_id=pg_temp.address_id('order',3);
update public.order_shipments set status='shipping',shipped_at=now(),carrier='hanjin',tracking_number='ADDRESSTRACK1' where order_id=pg_temp.address_id('order',4) and origin_id=pg_temp.address_id('origin',1);
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage) values(pg_temp.address_id('order',5),pg_temp.address_id('user',5),'합성 요청','cancel','requested');
delete from public.order_shipments where order_id=pg_temp.address_id('order',6);
update public.order_shipments set shipping_fee_snapshot='{"legacy":true,"totalFee":3000}' where order_id=pg_temp.address_id('order',7);
insert into public.audit_log(actor_id,action,target,diff)values(pg_temp.address_id('user',1),'admin.shipment.exported','order:'||pg_temp.address_id('order',8),'{}');
create function pg_temp.try_address_change(n integer,address_value jsonb) returns jsonb language plpgsql as $$
declare context jsonb:=public.admin_order_address_context(pg_temp.address_id('order',n));
begin return public.admin_change_order_address(pg_temp.address_id('op',n+10),pg_temp.address_id('order',n),(context->>'revision')::integer,address_value,'합성 변경 근거',true);end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.address_id('user',1)::text,true);
select pg_temp.address_error('select pg_temp.try_address_change(3,pg_temp.new_address())','order_dispatched');
select pg_temp.address_error('select pg_temp.try_address_change(4,pg_temp.new_address())','order_not_ready');
select pg_temp.address_error('select pg_temp.try_address_change(5,pg_temp.new_address())','order_claim_open');
select pg_temp.address_error('select pg_temp.try_address_change(6,pg_temp.new_address())','shipments_missing');
select pg_temp.address_error('select pg_temp.try_address_change(8,pg_temp.new_address())','order_dispatched');
select pg_temp.address_error('select pg_temp.try_address_change(7,pg_temp.new_address()||''{"postalCode":"10001"}''::jsonb)','order_address_quote_unavailable');
select pg_temp.address_error('select pg_temp.try_address_change(2,pg_temp.new_address()||''{"postalCode":"70000"}''::jsonb)','order_address_shipping_fee_changed');
select pg_temp.address_error('select pg_temp.try_address_change(2,pg_temp.new_address()||''{"postalCode":"80000"}''::jsonb)','order_address_region_unavailable');
select pg_temp.address_error('select pg_temp.try_address_change(2,pg_temp.new_address()||''{"postalCode":"12"}''::jsonb)','invalid_order_address');
select pg_temp.address_error('select pg_temp.try_address_change(2,pg_temp.new_address()||''{"unexpected":"x"}''::jsonb)','invalid_order_address');
select pg_temp.address_error('select pg_temp.try_address_change(2,pg_temp.original_address())','order_address_unchanged');
select pg_temp.try_address_change(2,pg_temp.new_address()||'{"postalCode":"10001","address1":"합성시 새길 2"}'::jsonb);
select pg_temp.try_address_change(7,pg_temp.new_address());
-- An export prepared before an address change cannot be marked delivered to a warehouse afterward.
select public.admin_shipment_export(array(select id from public.order_shipments where order_id=pg_temp.address_id('order',9))) as prepared_export \gset
select pg_temp.try_address_change(9,pg_temp.new_address());
select pg_temp.address_error(format('select public.admin_mark_shipments_exported(%L::jsonb)',
 (select jsonb_agg(jsonb_build_object('id',v->>'id','updatedAt',v->>'updatedAt')) from jsonb_array_elements(:'prepared_export'::jsonb->'shipments')v)),'shipment_changed');
reset role;
-- Origin base price changes must not retroactively rewrite the paid quote.
update public.fulfillment_origins set base_fee=9999 where id in(pg_temp.address_id('origin',1),pg_temp.address_id('origin',2));
set local role authenticated;
select pg_temp.try_address_change(10,pg_temp.new_address()||'{"postalCode":"10002","address1":"합성시 다른길 3"}'::jsonb);
reset role;
select 1/case when not exists(select 1 from address_before b join public.orders o using(id) where
 (b.total,b.shipping_fee,b.discount_total,b.store_credit_total,b.shipping_fee_breakdown) is distinct from (o.total,o.shipping_fee,o.discount_total,o.store_credit_total,o.shipping_fee_breakdown))
 and not exists(select 1 from address_shipments_before b join public.order_shipments s using(id) where b.order_id<>pg_temp.address_id('order',7) and
 (b.shipping_fee,b.shipping_fee_snapshot) is distinct from (s.shipping_fee,s.shipping_fee_snapshot))
 and (select count(*) from private.order_address_changes where actor_id=pg_temp.address_id('user',1))=5
 and (select count(*) from public.audit_log where action='admin.order.address_changed' and actor_id=pg_temp.address_id('user',1))=5
 and not exists(select 1 from public.audit_log where action='admin.order.address_changed' and (diff?'before' or diff?'after' or diff?'address' or diff?'reason'))
 then 1 else 0 end as frozen_finance_and_private_address_history;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.address_id('user',1);
set local role authenticated;
select pg_temp.address_error('select public.admin_get_order_address_change(pg_temp.address_id(''op'',1))','42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.order_address_changes','SELECT')
 and not has_function_privilege('anon','public.admin_order_address_context(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)','EXECUTE')
 and not has_function_privilege('authenticated','private.order_address_change_receipt(uuid,uuid)','EXECUTE') then 1 else 0 end as sealed_address_history;
rollback;
