\set ON_ERROR_STOP on
begin;
-- Entirely synthetic rollback fixtures. No warehouse/customer source rows.

-- 1) 남양주(서원) 출고지 시작값: 우체국택배 등록, 시드 상태의 남양주만 켠다.
select 1 / case when exists(select 1 from public.shipping_carriers where code='epost' and label='우체국택배' and is_active
   and tracking_url_template='https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1={trackingNumber}')
 and exists(select 1 from public.fulfillment_origins namyangju join public.fulfillment_origins gimpo on gimpo.code='gimpo'
   where namyangju.id='00000000-0000-4000-8000-000000042202' and namyangju.code='namyangju' and namyangju.default_carrier='epost'
   and namyangju.is_active and namyangju.base_fee=gimpo.base_fee and namyangju.free_threshold is not distinct from gimpo.free_threshold
   and namyangju.cutoff='10:00' and namyangju.export_template='seowon_xlsx')
 then 1 else 0 end as assert_namyangju_starts_on_epost_with_gimpo_fee;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000043101','authenticated','authenticated','warehouse-reply@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000043101';
insert into private.operator_memberships(profile_id,manager_role) values('00000000-0000-4000-8000-000000043101','primary');
insert into public.verticals(key,label,color) values('warehouse-reply','서원 회신','#000000');
insert into public.ips(id,title,vertical_key) values('warehouse-reply','서원 회신','warehouse-reply');
insert into public.goods(id,ip_id,name,type,price,origin_id) values
 ('warehouse-reply','warehouse-reply','주문 당시 키링','문구',1000,'00000000-0000-4000-8000-000000042202');
-- n: 1 발송 대기(전달 전) · 2 발송 대기(전달됨) · 3 최근 발송 · 4 45일 전 발송 · 5 취소 요청 중 · 6 취소된 주문
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('51000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000043101',
 case n when 3 then 'shipping'::public.order_status when 4 then 'shipping'::public.order_status when 6 then 'canceled'::public.order_status else 'confirmed'::public.order_status end,
 4000,3000,jsonb_build_object('recipientName','합성 받는분 '||n,'phone','0101234000'||n,'postalCode','04524',
  'address1','서울특별시 중구 세종대로 110','address2',n||'01호','deliveryNote','문 앞'),now()
from generate_series(1,6) n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('51000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,good_id,id,2,1000,'주문 당시 키링','문구','warehouse-reply'
from public.goods_variants cross join generate_series(1,6) n where good_id='warehouse-reply' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,exported_at)
select ('61000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('51000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042202','남양주',3000,'{}',
 case when n in (3,4) then 'shipping' when n=6 then 'canceled' else 'ready' end,
 case when n in (3,4) then 'epost' end,case when n in (3,4) then '601234500000'||n end,
 case n when 3 then now()-interval '1 day' when 4 then now()-interval '46 days' end,
 case when n in (2,3,4) then now() end
from generate_series(1,6) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select i.order_id,('61000000-0000-4000-8000-'||right(i.order_id::text,12))::uuid,i.id
from public.order_items i where i.good_id='warehouse-reply';
insert into public.order_cancellation_requests(order_id,requested_by,reason,status)
values('51000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000043101','합성 취소 요청','requested');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000043101',true);

-- 2) 대조 후보: 출고지시를 전달한 발송 대기 택배 건과 최근 45일 발송 건. 주문 당시 스냅샷 값을 그대로
--    주고, 회신 송장번호가 기간과 관계없이 이미 쓰였는지(45일 넘은 4번 포함)도 돌려준다.
select public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202',array['6012345000004','6012345000003','6012345999999'],
 array['01012340001','01012340002','01012340003','01012340004','01012340005','01012340006']) as candidates \gset
-- 후보는 회신에 나온 전화번호의 배송 건으로 좁힌다.
select 1 / case when jsonb_array_length(public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}',array['01012340003'])->'shipments')=1
 and jsonb_array_length(public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}','{}')->'shipments')=0
 then 1 else 0 end as assert_reply_candidates_filtered_by_phone;
select 1 / case when :'candidates'::jsonb->>'defaultCarrier'='epost' and :'candidates'::jsonb->>'template'='seowon_xlsx'
 and :'candidates'::jsonb->>'truncated'='false'
 and (select array_agg(right(value->>'id',1) order by value->>'id') from jsonb_array_elements(:'candidates'::jsonb->'shipments'))=array['2','3']
 and (select value#>>'{lines,0,phone}'='01012340002' and value#>>'{lines,0,address}'='서울특별시 중구 세종대로 110 201호'
   and value#>>'{lines,0,goodName}'='주문 당시 키링' and value#>>'{lines,0,qty}'='2' and value->>'status'='ready'
   from jsonb_array_elements(:'candidates'::jsonb->'shipments') where value->>'id' like '%2')
 and (select value->>'trackingNumber'='6012345000003' and value->>'status'='shipping'
   from jsonb_array_elements(:'candidates'::jsonb->'shipments') where value->>'id' like '%3')
 and :'candidates'::jsonb->'usedTracking'=jsonb_build_array(
   jsonb_build_object('trackingNumber','6012345000003','shipmentId','61000000-0000-4000-8000-000000000003'),
   jsonb_build_object('trackingNumber','6012345000004','shipmentId','61000000-0000-4000-8000-000000000004'))
 then 1 else 0 end as assert_reply_candidates_scope;
do $$ begin
 perform public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202',(select array_agg(n::text) from generate_series(1,1001) n),'{}');
 raise exception 'oversized waybill lookup accepted';
exception when invalid_parameter_value then if sqlerrm<>'invalid_tracking_batch' then raise; end if; end $$;

-- 3) 출고지별 새 출고지시: 전달 전·취소 요청 없음·발송 대기만, 품목 1,000줄까지.
-- A split shipment exports its allocated quantity, not the whole order item.
reset role;
savepoint allocated_reply_quantity;
update public.order_shipment_items set qty=1 where shipment_id='61000000-0000-4000-8000-000000000002';
set local role authenticated;
select 1/case when public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}',array['01012340002'])#>>'{shipments,0,lines,0,qty}'='1'
 then 1 else 0 end as reply_uses_shipment_allocation_quantity;
reset role;
rollback to allocated_reply_quantity;
set local role authenticated;

select 1 / case when public.admin_origin_pending_export_ids('00000000-0000-4000-8000-000000042202')
 =jsonb_build_object('ids',jsonb_build_array('61000000-0000-4000-8000-000000000001'),'total',1)
 then 1 else 0 end as assert_pending_export_excludes_exported_and_cancelling;
reset role;
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at,created_at)
select ('52000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000043101','confirmed',0,0,
 '{"recipientName":"합성 대량","phone":"01000000000","postalCode":"04524","address1":"합성 주소"}',now(),now()+n*interval '1 second'
from generate_series(1,3) n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('52000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,good_id,id,1,1000,'주문 당시 키링','문구','warehouse-reply'
from public.goods_variants cross join generate_series(1,3) n cross join generate_series(1,400) line where good_id='warehouse-reply' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
select ('62000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('52000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042202','남양주',0,'{}' from generate_series(1,3) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select i.order_id,('62000000-0000-4000-8000-'||right(i.order_id::text,12))::uuid,i.id from public.order_items i where i.order_id::text like '52000000-%';
set local role authenticated;
-- 400줄 배송 건 셋 + 1줄 배송 건 하나: 앞의 1줄 + 400 + 400 = 801줄까지만 고르고 나머지 수는 총계로 알린다.
select 1 / case when (select jsonb_array_length(value->'ids')=3 and value->>'total'='4'
   and not (value->'ids') ? '62000000-0000-4000-8000-000000000003'
   from (select public.admin_origin_pending_export_ids('00000000-0000-4000-8000-000000042202') value) pending)
 then 1 else 0 end as assert_pending_export_caps_item_rows;

-- 4) 일괄 등록은 발송 대기 건만 발송처리하고, 이미 발송된 건은 같은 값이면 그대로·다르면 거절한다.
select public.admin_import_shipment_tracking('61000000-0000-4000-8000-000000000001','epost','6012345000011') as first \gset
select count(*) as audits from public.audit_log where target='order:51000000-0000-4000-8000-000000000001' \gset
select public.admin_import_shipment_tracking('61000000-0000-4000-8000-000000000001','epost','6012345000011') as again \gset
select 1 / case when :'first'::jsonb->>'dispatched'='true' and :'again'::jsonb->>'dispatched'='false' and :'again'::jsonb->>'unchanged'='true'
 and (select count(*) from public.audit_log where target='order:51000000-0000-4000-8000-000000000001')=:'audits'::integer
 then 1 else 0 end as assert_resent_reply_is_unchanged;
do $$ declare attempt record; begin
 for attempt in select * from (values ('epost','6012345000012'),('hanjin','6012345000011')) v(carrier,tracking) loop
  begin
   perform public.admin_import_shipment_tracking('61000000-0000-4000-8000-000000000001',attempt.carrier,attempt.tracking);
   raise exception 'bulk import overwrote a dispatched waybill';
  exception when check_violation then if sqlerrm<>'shipment_tracking_conflict' then raise; end if; end;
 end loop;
end $$;
select 1 / case when public.admin_import_shipment_tracking_batch('[{"line":7,"reference":"61000000-0000-4000-8000-000000000003","carrier":"epost","trackingNumber":"6012345999999"}]')->0->>'error'='shipment_tracking_conflict'
 and (select carrier='epost' and tracking_number='6012345000011' and status='shipping' from public.order_shipments where id='61000000-0000-4000-8000-000000000001')
 and (select tracking_number='6012345000003' from public.order_shipments where id='61000000-0000-4000-8000-000000000003')
 then 1 else 0 end as assert_bulk_never_overwrites;
-- 정정 폼은 그대로 정정한다(감사 기록 포함).
select public.admin_update_shipment_tracking('61000000-0000-4000-8000-000000000003','epost','6012345000033');
select 1 / case when (select tracking_number='6012345000033' from public.order_shipments where id='61000000-0000-4000-8000-000000000003')
 and exists(select 1 from public.audit_log where target='order:51000000-0000-4000-8000-000000000003' and action='admin.shipment.tracking_updated')
 then 1 else 0 end as assert_correction_form_still_corrects;
do $$ begin
 perform public.admin_import_shipment_tracking('61000000-0000-4000-8000-000000000006','epost','6012345000066');
 raise exception 'canceled shipment accepted';
exception when check_violation then if sqlerrm<>'order_not_shipped' then raise; end if; end $$;

-- 5) 직원만 읽고, 고객·anon·service_role은 실행할 수 없다.
reset role;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000043101';
set local role authenticated;
do $$ begin
 perform public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}','{}');
 raise exception 'customer read reply candidates';
exception when insufficient_privilege then null; end $$;
do $$ begin
 perform public.admin_origin_pending_export_ids('00000000-0000-4000-8000-000000042202');
 raise exception 'customer read pending exports';
exception when insufficient_privilege then null; end $$;
reset role;
select 1 / case when not has_function_privilege('anon','public.admin_origin_tracking_candidates(uuid,text[],text[])','execute')
 and not has_function_privilege('service_role','public.admin_origin_tracking_candidates(uuid,text[],text[])','execute')
 and has_function_privilege('authenticated','public.admin_origin_tracking_candidates(uuid,text[],text[])','execute')
 and not has_function_privilege('anon','public.admin_origin_pending_export_ids(uuid)','execute')
 and not has_function_privilege('service_role','public.admin_origin_pending_export_ids(uuid)','execute')
 and has_function_privilege('authenticated','public.admin_origin_pending_export_ids(uuid)','execute')
 and not has_function_privilege('anon','public.admin_import_shipment_tracking(text,text,text)','execute')
 and not has_function_privilege('service_role','public.admin_import_shipment_tracking(text,text,text)','execute')
 then 1 else 0 end as assert_reply_exchange_acl_sealed;
rollback;
