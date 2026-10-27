\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 스테이징 테스트 배송완료 (ADR-0025)
--
--   · 허용 행이 없는 DB(운영)는 상태 조회가 false이고 실행을 거절한다
--   · 허용 행은 검증된 스테이징 세션의 시드만 넣는다. 운영 프로젝트 ref 토큰은 함께 거절한다
--   · 발주확인 이후 택배 주문만, 운송장 없이 배송완료로 기록하고 발송 메일 대기열을 만들지 않는다
--   · 구매확정 기한 저장·감사·같은 요청 재전송은 기존 경계를 따른다
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_staging_test_tools()','execute')
  and not has_function_privilege('anon','public.admin_staging_test_tools()','execute')
  and not has_function_privilege('service_role','public.admin_staging_test_tools()','execute')
  and has_function_privilege('authenticated','public.admin_mark_staging_test_delivered(text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_mark_staging_test_delivered(text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_mark_staging_test_delivered(text,uuid)','execute')
  and not has_function_privilege('authenticated','private.staging_test_tools_available()','execute')
  and not has_table_privilege('authenticated','private.staging_test_tools','select,insert')
  and not has_table_privilege('service_role','private.staging_test_tools','select,insert')
) then 1 else 0 end as assert_sealed_acl;

create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a0c20000-0000-4000-8000-000000000001','authenticated','authenticated','staging-delivery-operator@example.test',now(),'{}','{}',now(),now()),
 ('a0c20000-0000-4000-8000-000000000002','authenticated','authenticated','staging-delivery-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 테스트 배송완료 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='a0c20000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('a0c20000-0000-4000-8000-000000000001','a0c20000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values('a0c20000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
create function pg_temp.as_actor(p uuid,iss text default 'http://127.0.0.1:54321/auth/v1') returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p,'role','authenticated','iss',iss)::text,true);
end $$;
insert into public.ips(id,title,vertical_key) values('staging-delivery-ip','TEST 테스트 배송완료 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('staging-delivery-goods','staging-delivery-ip','TEST 테스트 배송완료 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('a0c20000-0000-4000-8000-0000000000f1','staging-delivery-origin','TEST 테스트 배송완료 창고',0,'합성 반송 주소');
create function pg_temp.order_with(n integer,status public.order_status,shipment_status text default 'ready') returns uuid language plpgsql as $$
declare oid uuid:=('a0c20000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;item uuid;sid uuid:=gen_random_uuid();
begin
 insert into public.orders(id,user_id,status,total,address,confirmed_at) values(oid,'a0c20000-0000-4000-8000-000000000002',status,10000,
  '{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}',case when status<>'paid' then now() end);
 insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
  values(oid,'staging-delivery-goods',1,10000,'TEST 테스트 배송완료 굿즈','문구','staging-delivery-ip',(select id from public.goods_variants where good_id='staging-delivery-goods' and is_default))
  returning id into item;
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at)
  values(sid,oid,'a0c20000-0000-4000-8000-0000000000f1','TEST 테스트 배송완료 창고',0,'{}',shipment_status,
   case when shipment_status='shipping' then 'hanjin' end,case when shipment_status='shipping' then 'STAGINGTEST'||n end,case when shipment_status='shipping' then now() end);
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
  values('a0c20000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','pk-staging-delivery-'||n,'idem-staging-delivery-'||n);
 return oid;
end $$;
select pg_temp.order_with(1,'confirmed') as ready_order \gset
select order_number as ready_number from public.orders where id=:'ready_order' \gset
select pg_temp.order_with(2,'paid') as paid_order \gset
select order_number as paid_number from public.orders where id=:'paid_order' \gset
select pg_temp.order_with(3,'shipping','shipping') as shipping_order \gset
select order_number as shipping_number from public.orders where id=:'shipping_order' \gset

-- 운영과 같은 상태: 허용 행이 없다.
delete from private.staging_test_tools;
select pg_temp.as_actor('a0c20000-0000-4000-8000-000000000001');
set local role authenticated;
select 1/case when public.admin_staging_test_tools()->>'testDelivery'='false' then 1 else 0 end as assert_production_shape_hidden;
select pg_temp.expect_error(format('select public.admin_mark_staging_test_delivered(%L,gen_random_uuid())',:'ready_number'),'staging_test_delivery_unavailable');
reset role;

-- 스테이징 시드가 넣는 허용 행.
insert into private.staging_test_tools(singleton,marker) values(true,'admin-ops-v1');
select pg_temp.as_actor('a0c20000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.expect_error('select public.admin_staging_test_tools()','operator_capability_required');
select pg_temp.expect_error(format('select public.admin_mark_staging_test_delivered(%L,gen_random_uuid())',:'ready_number'),'operator_capability_required');
reset role;
-- 운영 프로젝트 ref가 담긴 토큰은 허용 행이 있어도 거절한다.
select pg_temp.as_actor('a0c20000-0000-4000-8000-000000000001','https://sbutbsghcxmxmxgrshwq.supabase.co/auth/v1');
set local role authenticated;
select 1/case when public.admin_staging_test_tools()->>'testDelivery'='false' then 1 else 0 end as assert_production_issuer_hidden;
select pg_temp.expect_error(format('select public.admin_mark_staging_test_delivered(%L,gen_random_uuid())',:'ready_number'),'staging_test_delivery_unavailable');
reset role;

select pg_temp.as_actor('a0c20000-0000-4000-8000-000000000001');
set local role authenticated;
select 1/case when public.admin_staging_test_tools()->>'testDelivery'='true' then 1 else 0 end as assert_staging_shape_visible;
select pg_temp.expect_error(format('select public.admin_mark_staging_test_delivered(%L,gen_random_uuid())',:'paid_number'),'staging_test_delivery_requires_confirmed');
select pg_temp.expect_error($$select public.admin_mark_staging_test_delivered('2031031419999999',gen_random_uuid())$$,'order_not_found');
select pg_temp.expect_error($$select public.admin_mark_staging_test_delivered('not-a-number',gen_random_uuid())$$,'invalid_staging_test_delivery');
select public.admin_mark_staging_test_delivered(:'ready_number','a0c20000-0000-4000-8000-0000000000a1') as delivered \gset
select 1/case when public.admin_mark_staging_test_delivered(:'ready_number','a0c20000-0000-4000-8000-0000000000a1')=:'delivered'::jsonb
 and (:'delivered'::jsonb->>'status')='delivered' and (:'delivered'::jsonb->>'deliveredShipments')='1' then 1 else 0 end as assert_delivered_and_replay;
select public.admin_mark_staging_test_delivered(:'shipping_number',gen_random_uuid());
reset role;
select 1/case when (select status='delivered' and delivered_at is not null and shipped_at is not null from public.orders where id=:'ready_order')
 and (select bool_and(status='delivered' and carrier is null and tracking_number is null and delivered_at is not null) from public.order_shipments where order_id=:'ready_order')
 and (select status='delivered' and tracking_number='STAGINGTEST3' from public.order_shipments where order_id=:'shipping_order')
 and not exists(select 1 from public.order_shipment_email_jobs where order_id in(:'ready_order',:'shipping_order'))
 and (select count(*)=2 from private.order_purchase_confirmations where order_id in(:'ready_order',:'shipping_order'))
 and (select count(*)=1 from public.audit_log where id='a0c20000-0000-4000-8000-0000000000a1' and action='admin.staging.test_delivered'
  and actor_id='a0c20000-0000-4000-8000-000000000001' and diff->>'staging'='true')
 then 1 else 0 end as assert_no_shipping_email_and_confirmation_window_starts;
select pg_temp.as_actor('a0c20000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_mark_staging_test_delivered(%L,gen_random_uuid())',:'ready_number'),'staging_test_delivery_requires_confirmed');
reset role;
rollback;
