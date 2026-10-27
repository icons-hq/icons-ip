\set ON_ERROR_STOP on
begin;
-- 10/14 회의 A3a·A6·A2·S7: 출고지시·서원 회신 후보·발송 지연 안내가 16자리 번호를 쓰고,
-- 고객 메일 작업에는 출고지 이름을 싣지 않는다. 전부 합성 롤백 데이터다.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000271401','authenticated','authenticated','number-label-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000271402','authenticated','authenticated','number-label-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000271401';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000271401','primary');
insert into public.verticals(key,label,color) values('number-label','번호 표기','#000000');
insert into public.ips(id,title,vertical_key) values('number-label','번호 표기','number-label');
insert into public.goods(id,ip_id,name,type,price,origin_id) values
 ('number-label','number-label','번호 표기 키링','문구',1000,'00000000-0000-4000-8000-000000042202');
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('52000000-0000-4000-8000-00000000000'||n)::uuid,'00000000-0000-4000-8000-000000271402','confirmed',4000,3000,
  jsonb_build_object('recipientName','합성 받는분','phone','01012342714','postalCode','04524','address1','서울특별시 중구 세종대로 110','address2','101호','deliveryNote',''),now()-interval '5 days'
from generate_series(1,2) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('72000000-0000-4000-8000-00000000000'||n)::uuid,('52000000-0000-4000-8000-00000000000'||n)::uuid,good_id,id,1,1000,'번호 표기 키링','문구','number-label'
from public.goods_variants cross join generate_series(1,2) n where good_id='number-label' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,exported_at)
select ('62000000-0000-4000-8000-00000000000'||n)::uuid,('52000000-0000-4000-8000-00000000000'||n)::uuid,'00000000-0000-4000-8000-000000042202','남양주',
 3000,'{}','ready',now()
from generate_series(1,2) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select ('52000000-0000-4000-8000-00000000000'||n)::uuid,('62000000-0000-4000-8000-00000000000'||n)::uuid,('72000000-0000-4000-8000-00000000000'||n)::uuid
from generate_series(1,2) n;
select order_number from public.orders where id='52000000-0000-4000-8000-000000000001' \gset
select order_number as second_order_number from public.orders where id='52000000-0000-4000-8000-000000000002' \gset
select shipment_number as first_number from public.order_shipments where id='62000000-0000-4000-8000-000000000001' \gset
select shipment_number as second_number from public.order_shipments where id='62000000-0000-4000-8000-000000000002' \gset
select 1/case when :'order_number' ~ '^[0-9]{8}1[0-9]{7}$' and :'first_number' ~ '^[0-9]{8}3[0-9]{7}$' then 1 else 0 end as assert_fixture_numbers_issued;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271401',true);

-- 1) 출고지시 응답의 배송 건마다 주문번호·배송건번호를 싣는다(서원 접미사 순서·덧붙인 열).
select public.admin_shipment_export(array['62000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002']::uuid[]) as export_data \gset
select 1/case when (select array_agg(value->>'orderNumber' order by value->>'id')=array[:'order_number',:'second_order_number']
   and array_agg(value->>'shipmentNumber' order by value->>'id')=array[:'first_number',:'second_number']
   from jsonb_array_elements(:'export_data'::jsonb->'shipments'))
 then 1 else 0 end as assert_export_carries_numbers;

-- 2) 서원 회신 대조 후보도 배송건번호를 준다.
select public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}',array['01012342714']) as candidates \gset
select 1/case when (select array_agg(value->>'shipmentNumber' order by value->>'id') from jsonb_array_elements(:'candidates'::jsonb->'shipments'))
   =array[:'first_number',:'second_number']
 then 1 else 0 end as assert_reply_candidates_carry_shipment_number;

-- 3) 발송 지연 안내: 어드민 표기는 출고지 · 배송건번호, 고객 본문과 메일은 번호만.
select public.admin_prepare_order_delay_notice('00000000-0000-4000-8000-000000271431',
 array['62000000-0000-4000-8000-000000000001']::uuid[],'발송 지연 안내','입고 일정을 확인하고 있습니다.',null);
reset role;
select 1/case when shipment_labels=array['남양주 · '||:'first_number']
 and message_body like '%안내 대상 배송 건: '||:'first_number'
 and message_body not like '%남양주%' and message_body not like '%: 00000001%'
 then 1 else 0 end as assert_prepared_labels_use_numbers
from private.order_delay_notice_targets where notice_id='00000000-0000-4000-8000-000000271431';
update private.order_delay_notice_delivery_control set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000271401',true);
select public.admin_request_order_delay_notice('00000000-0000-4000-8000-000000271431');
set local role service_role;
select value as job from jsonb_array_elements(public.claim_order_delay_email_jobs(25)) where value->>'orderId'='52000000-0000-4000-8000-000000000001' \gset
select 1/case when :'job'::jsonb->>'orderNumber'=:'order_number'
 and :'job'::jsonb->'shipmentLabels'=jsonb_build_array(:'first_number')
 and :'job'::text not like '%남양주%'
 then 1 else 0 end as assert_delay_email_job_numbers_without_origin;
reset role;

-- 4) 권한 계약은 그대로다.
select 1/case when not has_function_privilege('authenticated','public.claim_order_delay_email_jobs(integer)','EXECUTE')
 and has_function_privilege('service_role','public.claim_order_delay_email_jobs(integer)','EXECUTE')
 and not has_function_privilege('anon','public.admin_shipment_export(uuid[])','EXECUTE')
 and not has_function_privilege('anon','public.admin_origin_tracking_candidates(uuid,text[],text[])','EXECUTE')
 then 1 else 0 end as assert_grants_unchanged;
rollback;
