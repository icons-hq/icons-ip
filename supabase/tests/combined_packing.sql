\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bf160000-0000-4000-8000-000000000001','authenticated','authenticated','combined-pack-admin@example.test',now(),'{}','{}',now(),now()),
 ('bf160000-0000-4000-8000-000000000002','authenticated','authenticated','combined-pack-buyer@example.test',now(),'{}','{}',now(),now()),
 ('bf160000-0000-4000-8000-000000000003','authenticated','authenticated','combined-pack-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 합포장 회귀 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bf160000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-8000-000000000002','bf160000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('bf160000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('combined-pack-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bf160000-0000-4000-8000-000000000010','combined-pack-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('combined-pack-a','combined-pack-ip','TEST 상품 A','문구',10000,'ok',100,'bf160000-0000-4000-8000-000000000010','policy',0),
 ('combined-pack-b','combined-pack-ip','TEST 상품 B','문구',5000,'ok',100,'bf160000-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','confirmation-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='combined-pack-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='combined-pack-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='combined-pack-ip';
select id as variant_a from public.goods_variants where good_id='combined-pack-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='combined-pack-b' and is_default \gset


insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('bf160000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('bf160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','bf160000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','bf160000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','bf160000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.confirm_order(n integer,delivered_at_value timestamptz default clock_timestamp()-interval '2 days') returns uuid language plpgsql as $$
declare oid uuid:=('bf160000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=gen_random_uuid();item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,store_credit_policy_snapshot) values(oid,'bf160000-0000-4000-8000-000000000002','confirmed',10000,
 '{"recipientName":"TEST 합포장","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
 '{"enabled":true,"earnKind":"fixed","earnValue":100,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":1000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits"}');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select oid,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='combined-pack-a' returning id into item;
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values('bf160000-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','combined-pack-payment-'||n);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(sid,oid,'bf160000-0000-4000-8000-000000000010','TEST 출고지',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 return oid;
end $$;
select pg_temp.confirm_order(n) from generate_series(1,8)n;
-- Different original shipping fees are preserved; grouping never reprices them.
update public.order_shipments set shipping_fee=case when order_id='bf160000-0000-4001-8000-000000000001' then 3000 else 4000 end where order_id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002');
update public.orders o set shipping_fee=s.shipping_fee,total=10000+s.shipping_fee from public.order_shipments s where s.order_id=o.id and o.id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002');
update public.payments p set amount=o.total from public.orders o where p.ref_id=o.id and o.id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002');
select array_agg(id order by id) as mismatch_ids from public.order_shipments where order_id in('bf160000-0000-4001-8000-000000000003','bf160000-0000-4001-8000-000000000004') \gset
update public.orders set address=jsonb_set(address,'{address2}','"TEST DIFFERENT ADDRESS"') where id='bf160000-0000-4001-8000-000000000004';
select pg_temp.as_actor(1);set local role authenticated;
select 1/case when public.admin_get_shipment_packs(:'mismatch_ids')->>'canCreate'='false' then 1 else 0 end as different_full_address_blocked;
reset role;
update public.orders set address=address-'address2',user_id='bf160000-0000-4000-8000-000000000003' where id='bf160000-0000-4001-8000-000000000004';
update public.payments set user_id='bf160000-0000-4000-8000-000000000003' where ref_id='bf160000-0000-4001-8000-000000000004';
set local role authenticated;
select 1/case when public.admin_get_shipment_packs(:'mismatch_ids')->>'canCreate'='false' then 1 else 0 end as different_buyer_blocked;
reset role;

select array_agg(id order by id) as integrity_ids from public.order_shipments where order_id in('bf160000-0000-4001-8000-000000000005','bf160000-0000-4001-8000-000000000006') \gset
savepoint integrity_case;
update public.payments set amount=1 where ref_id='bf160000-0000-4001-8000-000000000005';
set local role authenticated;
select 1/case when public.admin_get_shipment_packs(:'integrity_ids')->>'canCreate'='false' then 1 else 0 end as mismatched_payment_blocked;
reset role;rollback to integrity_case;
update public.order_shipment_items set qty=2 where order_id='bf160000-0000-4001-8000-000000000005';
set local role authenticated;
select 1/case when public.admin_get_shipment_packs(:'integrity_ids')->>'canCreate'='false' then 1 else 0 end as mismatched_quantity_blocked;
reset role;rollback to integrity_case;
select array_agg(id order by id) as ids from public.order_shipments where order_id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002') \gset
select id as sid1 from public.order_shipments where order_id='bf160000-0000-4001-8000-000000000001' \gset
select id as sid2 from public.order_shipments where order_id='bf160000-0000-4001-8000-000000000002' \gset
select pg_temp.as_actor(1);
set local role authenticated;
select public.admin_get_shipment_packs(:'ids') as preview \gset
select 1/case when :'preview'::jsonb->>'canCreate'='true' then 1 else 0 end as compatible_preview;
select public.admin_change_shipment_pack(:'ids','create',:'preview'::jsonb->>'version','TEST same recipient confirmed','bf160000-0000-4002-8000-000000000001','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001') as created \gset
select 1/case when public.admin_change_shipment_pack(:'ids','create',:'preview'::jsonb->>'version','TEST same recipient confirmed','bf160000-0000-4002-8000-000000000001','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001')=:'created'::jsonb then 1 else 0 end as frozen_replay;
select pg_temp.transaction_expect_error(format('select public.admin_change_shipment_pack(%L,%L,%L,%L,gen_random_uuid(),%L,%L)',:'ids','create',:'preview'::jsonb->>'version','TEST stale preview','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001'),'shipment_pack_changed');
select pg_temp.transaction_expect_error(format('select public.admin_shipment_export(array[%L::uuid])',:'sid1'),'shipment_pack_selection_required');
select public.admin_shipment_export(:'ids') as export \gset
select 1/case when jsonb_array_length(:'export'::jsonb->'shipments')=2 and :'export'::jsonb#>>'{shipments,0,pack,count}'='2' then 1 else 0 end as whole_export;
select public.admin_get_shipment_packs(array[:'sid1'::uuid]) as packed \gset
select public.admin_change_shipment_pack(array[:'sid1'::uuid],'release',:'packed'::jsonb->>'version','TEST release before warehouse instruction','bf160000-0000-4002-8000-000000000002','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001');
select pg_temp.transaction_expect_error(format('select public.admin_mark_shipments_exported(%L)',(select jsonb_agg(jsonb_build_object('id',value->'id','updatedAt',value->'updatedAt')) from jsonb_array_elements(:'export'::jsonb->'shipments'))),'shipment_changed');
select public.admin_get_shipment_packs(:'ids') as preview \gset
select public.admin_change_shipment_pack(:'ids','create',:'preview'::jsonb->>'version','TEST recreate package','bf160000-0000-4002-8000-000000000003','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001');
-- Contradictory sibling rows fail before either shipment changes.
select pg_temp.transaction_expect_error(format('select public.admin_import_shipment_tracking_batch(%L)',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK1111'),jsonb_build_object('line',2,'reference',:'sid2','carrier','hanjin','trackingNumber','TESTPACK2222'))),'shipment_pack_tracking_conflict');
reset role;
select 1/case when (select bool_and(status='ready') from public.order_shipments where id=any(:'ids')) then 1 else 0 end as no_partial_dispatch;
savepoint claim_race;
insert into public.order_cancellation_requests(order_id,requested_by,reason,reason_type,claim_type,stage) values('bf160000-0000-4001-8000-000000000002','bf160000-0000-4000-8000-000000000002','TEST new cancellation','change_of_mind','cancel','requested');
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'sid1','shipping','hanjin','TESTPACK1111'),'shipment_pack_ineligible');
select 1/case when not (public.admin_origin_pending_export_ids('bf160000-0000-4000-8000-000000000010')->'ids' ?| array[:'sid1',:'sid2'])
 then 1 else 0 end as blocked_sibling_excludes_the_whole_pack_from_batch_export;
reset role;
rollback to claim_race;
-- Address changes invalidate the package identity, not the original order price.
update public.orders set address=jsonb_set(address,'{address2}','"TEST CHANGED"') where id='bf160000-0000-4001-8000-000000000002';
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_update_shipment_status(%L,%L,%L,%L)',:'sid1','shipping','hanjin','TESTPACK1111'),'shipment_pack_address_changed');
reset role;
update public.orders set address=address-'address2' where id='bf160000-0000-4001-8000-000000000002';
set local role authenticated;
select public.admin_shipment_export(:'ids') as export \gset
select public.admin_mark_shipments_exported((select jsonb_agg(jsonb_build_object('id',value->'id','updatedAt',value->'updatedAt')) from jsonb_array_elements(:'export'::jsonb->'shipments')));
select public.admin_get_shipment_packs(:'ids') as packed \gset
select pg_temp.transaction_expect_error(format('select public.admin_change_shipment_pack(%L,%L,%L,%L,gen_random_uuid(),%L,%L)',:'ids','release',:'packed'::jsonb->>'version','TEST already exported','bf160000-0000-4000-8000-000000000001','bf160000-0000-4000-9000-000000000001'),'shipment_pack_release_blocked');
reset role;
update public.fulfillment_origins set export_template='seowon_xlsx' where id='bf160000-0000-4000-8000-000000000010';
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_import_seowon_tracking_batch(%L,%L)',
 'bf160000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK1111'))),
 'shipment_pack_selection_required');
select 1/case when (select bool_and(status='ready' and tracking_number is null) from public.order_shipments where id=any(:'ids')) then 1 else 0 end as incomplete_reply_changes_nothing;
select pg_temp.transaction_expect_error(format('select public.admin_import_seowon_tracking_batch(%L,%L)',
 'bf160000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK1111'),
 jsonb_build_object('line',2,'reference',:'sid2','carrier','hanjin','trackingNumber','TESTPACK2222'))),'shipment_pack_tracking_conflict');
select public.admin_import_seowon_tracking_batch('bf160000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK1111'),jsonb_build_object('line',2,'reference',:'sid2','carrier','hanjin','trackingNumber','TESTPACK1111'))) as imported \gset
select 1/case when :'imported'::jsonb#>>'{0,dispatched}'='true' and :'imported'::jsonb#>>'{1,unchanged}'='true'
 then 1 else 0 end as pack_dispatch_is_once_even_with_every_member_in_reply;
select public.admin_import_seowon_tracking_batch('bf160000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK1111'),jsonb_build_object('line',2,'reference',:'sid2','carrier','hanjin','trackingNumber','TESTPACK1111'))) as replay \gset
select 1/case when (select bool_and(value->>'unchanged'='true' and value->>'dispatched'='false') from jsonb_array_elements(:'replay'::jsonb)) then 1 else 0 end as repeated_reply_has_no_new_dispatch;
select pg_temp.transaction_expect_error(format('select public.admin_import_seowon_tracking_batch(%L,%L)',
 'bf160000-0000-4000-8000-000000000010',jsonb_build_array(jsonb_build_object('line',1,'reference',:'sid1','carrier','hanjin','trackingNumber','TESTPACK2222'),
 jsonb_build_object('line',2,'reference',:'sid2','carrier','hanjin','trackingNumber','TESTPACK2222'))),'shipment_tracking_conflict');
select 1/case when jsonb_array_length(:'imported'::jsonb#>'{0,packedShipments}')=2 then 1 else 0 end as each_original_order_notification;
select public.admin_update_shipment_status(:'sid1','shipping','hanjin','TESTPACK1111');
reset role;
select 1/case when (select count(*)=2 and bool_and(status='shipping' and tracking_number='TESTPACK1111') from public.order_shipments where id=any(:'ids')) then 1 else 0 end as atomic_dispatch;
set local role authenticated;
select public.admin_update_shipment_tracking(:'sid2','hanjin','TESTPACK3333');
select public.admin_complete_shipments(array[:'sid2'::uuid]) as completed \gset
select 1/case when jsonb_array_length(:'completed'::jsonb#>'{0,affectedIds}')=2 then 1 else 0 end as completion_count_includes_package;
reset role;
select 1/case when (select count(*)=2 and bool_and(status='delivered' and tracking_number='TESTPACK3333') from public.order_shipments where id=any(:'ids')) and
 (select count(*)=2 and sum(total)=27000 and sum(shipping_fee)=7000 from public.orders where id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002')) and
 not exists(select 1 from public.refunds r join public.order_cancellation_requests c on c.id=r.cancellation_request_id where c.order_id in('bf160000-0000-4001-8000-000000000001','bf160000-0000-4001-8000-000000000002')) then 1 else 0 end as whole_completion_original_money;
select pg_temp.as_actor(2);
set local role authenticated;
select pg_temp.transaction_expect_error(format('select public.admin_get_shipment_packs(%L)',:'ids'),'operator_capability_required');
reset role;
select 1/case when not has_function_privilege('service_role','public.admin_change_shipment_pack(uuid[],text,text,text,uuid,uuid,uuid)','execute')
 and not has_table_privilege('authenticated','private.shipment_pack_members','select') and not has_function_privilege('authenticated','private.shipment_pack_scope(uuid[])','execute') then 1 else 0 end as sealed_acl;
rollback;
