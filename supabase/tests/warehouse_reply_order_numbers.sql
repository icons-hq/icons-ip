\set ON_ERROR_STOP on
-- 1014-096(20261112120100): 김포 WMS 회신의 `주문번호(쇼핑몰)`가 16자리 주문번호여도, 11/12 이전 파일의 전체 UUID여도
-- 같은 배송 건을 찾는다. 찾지 못한 번호·형식이 다른 값은 그 줄만 실패하고, 같은 주문의 줄은 형식이 섞여도 한 묶음으로 본다.
-- 합포장 사전 검사도 주문번호 회신의 송장 충돌을 잠금 전에 막는다. 합성 데이터만 쓰고 rollback한다.
begin;
create function pg_temp.reply_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000112001','authenticated','authenticated','warehouse-reply-number@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000112001';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000112001','primary');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,export_template,is_active) values
 ('00000000-0000-4000-8000-000000112001','warehouse-reply-number','합성 김포','hanjin',3000,50000,'wms_csv',true);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('51120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000112001','confirmed',3000,3000,
 '{"recipientName":"합성 받는분","phone":"01000000000","postalCode":"00123","address1":"합성 주소"}',now()
from generate_series(1,7) n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
select ('61120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('51120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000112001','합성 김포',3000,'{}'
from generate_series(1,7) n;
select string_agg(order_number,',' order by id) as numbers from public.orders where id::text like '51120000-0000-4000-8000-%' \gset
select split_part(:'numbers',',',1) as number1, split_part(:'numbers',',',2) as number2, split_part(:'numbers',',',3) as number3,
 split_part(:'numbers',',',4) as number4, split_part(:'numbers',',',5) as number5, split_part(:'numbers',',',6) as number6 \gset
select 1/case when :'number1' ~ '^[0-9]{16}$' and :'number1'<>:'number2' then 1 else 0 end as assert_orders_have_display_numbers;

-- 해석 함수: UUID는 그대로, 숫자는 orders.order_number와 정확히 같을 때만 주문 id다. 접두·끝자리로 넘겨짚지 않는다.
select 1/case when private.warehouse_reply_order_id('51120000-0000-4000-8000-000000000001')='51120000-0000-4000-8000-000000000001'
 and private.warehouse_reply_order_id(:'number1')='51120000-0000-4000-8000-000000000001'
 and private.warehouse_reply_order_id(left(:'number1',15)) is null
 and private.warehouse_reply_order_id(right(:'number1',8)) is null
 and private.warehouse_reply_order_id('2099010110000001') is null
 and private.warehouse_reply_order_id('51120000') is null
 and private.warehouse_reply_order_id('') is null and private.warehouse_reply_order_id(null) is null
 and not has_function_privilege('authenticated','private.warehouse_reply_order_id(text)','execute')
 and not has_function_privilege('anon','private.warehouse_reply_order_id(text)','execute')
 and not has_function_privilege('service_role','private.warehouse_reply_order_id(text)','execute')
 then 1 else 0 end as assert_reference_resolver;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000112001',true);

-- 16자리 주문번호 회신과 이전 파일의 UUID 회신이 한 파일에 섞여도 각각 그 주문의 김포 배송 건을 발송한다.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000112001',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number1','trackingNumber','001234567801'),
 jsonb_build_object('line',3,'reference',' '||:'number1'||' ','trackingNumber','0012-3456-7801'),
 jsonb_build_object('line',4,'reference','51120000-0000-4000-8000-000000000002','trackingNumber','001234567802'),
 jsonb_build_object('line',5,'reference','2099010110000001','trackingNumber','001234567803'),
 jsonb_build_object('line',6,'reference','12345','trackingNumber','001234567804'),
 jsonb_build_object('line',7,'reference','202611ab10000001','trackingNumber','001234567805')
)) as mixed \gset
select 1/case when :'mixed'::jsonb->0->>'ok'='true' and :'mixed'::jsonb->0->>'dispatched'='true' and :'mixed'::jsonb->0->>'duplicate'='false'
 and :'mixed'::jsonb->0->>'reference'=:'number1'
 and :'mixed'::jsonb->1->>'ok'='true' and :'mixed'::jsonb->1->>'duplicate'='true'
 and :'mixed'::jsonb->2->>'ok'='true' and :'mixed'::jsonb->2->>'dispatched'='true'
 and :'mixed'::jsonb->3->>'error'='shipment_not_found'
 and :'mixed'::jsonb->4->>'error'='invalid_warehouse_order_reference'
 and :'mixed'::jsonb->5->>'error'='invalid_warehouse_order_reference'
 and (select status='shipping' and carrier='hanjin' and tracking_number='001234567801' from public.order_shipments where id='61120000-0000-4000-8000-000000000001')
 and (select status='shipping' and tracking_number='001234567802' from public.order_shipments where id='61120000-0000-4000-8000-000000000002')
 then 1 else 0 end as assert_number_and_uuid_replies_dispatch;

-- 같은 주문의 줄은 번호·UUID가 섞여도 한 묶음이다. 송장이 다르면 그 주문의 줄을 모두 실패시키고 바꾸지 않는다.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000112001',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number3','trackingNumber','001234567806'),
 jsonb_build_object('line',3,'reference','51120000-0000-4000-8000-000000000003','trackingNumber','001234567807'),
 jsonb_build_object('line',4,'reference',:'number4','trackingNumber','001234567808'),
 jsonb_build_object('line',5,'reference',:'number4','trackingNumber','bad')
)) as grouped \gset
select 1/case when :'grouped'::jsonb->0->>'error'='conflicting_shipment_tracking' and :'grouped'::jsonb->1->>'error'='conflicting_shipment_tracking'
 and :'grouped'::jsonb->2->>'error'='invalid_tracking_input' and :'grouped'::jsonb->3->>'error'='invalid_tracking_input'
 and (select bool_and(status='ready' and tracking_number is null) from public.order_shipments
  where id in('61120000-0000-4000-8000-000000000003','61120000-0000-4000-8000-000000000004'))
 then 1 else 0 end as assert_mixed_references_group_by_order;

-- 같은 회신을 다시 올리면 이미 같은 송장으로 발송된 건은 그대로다(번호 회신도 같다).
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000112001',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number1','trackingNumber','001234567801'))) as resent \gset
select 1/case when :'resent'::jsonb->0->>'ok'='true' and :'resent'::jsonb->0->>'dispatched'='false' then 1 else 0 end as assert_number_reply_resend_is_unchanged;

-- 합포장 사전 검사: 같은 합포장의 두 배송 건이 주문번호 회신에서 다른 송장이면 아무것도 바꾸기 전에 거절한다.
reset role;
insert into private.shipment_packs(id,created_by) values('71120000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000112001');
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest) values
 ('71120000-0000-4000-8000-000000000001','61120000-0000-4000-8000-000000000005','test'),
 ('71120000-0000-4000-8000-000000000001','61120000-0000-4000-8000-000000000006','test');
select pg_temp.reply_expect_error(format('select private.prepare_pack_tracking_batch(%L,%L)',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number5','trackingNumber','001234567809'),
 jsonb_build_object('line',3,'reference',:'number6','trackingNumber','001234567810')),'00000000-0000-4000-8000-000000112001'),'shipment_pack_tracking_conflict');
-- 번호와 UUID가 섞여도 같은 합포장으로 본다.
select pg_temp.reply_expect_error(format('select private.prepare_pack_tracking_batch(%L,%L)',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number5','trackingNumber','001234567809'),
 jsonb_build_object('line',3,'reference','51120000-0000-4000-8000-000000000006','trackingNumber','001234567810')),'00000000-0000-4000-8000-000000112001'),'shipment_pack_tracking_conflict');
set local role authenticated;
select pg_temp.reply_expect_error(format('select public.admin_import_warehouse_tracking_batch(%L,%L)','00000000-0000-4000-8000-000000112001',jsonb_build_array(
 jsonb_build_object('line',2,'reference',:'number5','trackingNumber','001234567809'),
 jsonb_build_object('line',3,'reference',:'number6','trackingNumber','001234567810'))),'shipment_pack_tracking_conflict');
reset role;
select 1/case when (select bool_and(status='ready' and tracking_number is null) from public.order_shipments
  where id in('61120000-0000-4000-8000-000000000005','61120000-0000-4000-8000-000000000006'))
 then 1 else 0 end as assert_pack_conflict_changes_nothing;

-- 다른 출고지 주문의 번호는 이 출고지의 배송 건이 아니다.
update public.order_shipments set origin_id='00000000-0000-4000-8000-000000042201' where id='61120000-0000-4000-8000-000000000007';
set local role authenticated;
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000112001',jsonb_build_array(
 jsonb_build_object('line',2,'reference',split_part(:'numbers',',',7),'trackingNumber','001234567811'))) as other_origin \gset
select 1/case when :'other_origin'::jsonb->0->>'error'='shipment_not_found' then 1 else 0 end as assert_other_origin_number_not_found;
reset role;
rollback;
