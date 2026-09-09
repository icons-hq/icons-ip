\set ON_ERROR_STOP on
begin;
select 1/case when has_function_privilege('authenticated','public.admin_record_order_claim_reshipment_delivery(uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_record_order_claim_reshipment_delivery(uuid,text)','execute')
  and not has_function_privilege('service_role','public.admin_record_order_claim_reshipment_delivery(uuid,text)','execute')
  and not has_function_privilege('authenticated','private.order_all_items_delivered(uuid)','execute')
  and has_column_privilege('authenticated','public.order_cancellation_requests','reship_delivered_at','select')
  and not has_column_privilege('authenticated','public.order_cancellation_requests','reship_delivered_by','select')
  and not has_column_privilege('authenticated','public.order_cancellation_requests','reship_delivery_evidence','select')
  and not has_column_privilege('authenticated','public.order_cancellation_requests','reship_delivered_at','update')
  and not has_column_privilege('service_role','public.order_cancellation_requests','reship_delivered_at','update')
  then 1 else 0 end as assert_delivery_writer_and_sensitive_columns_sealed;
-- Synthetic full-order exchange, using public staff/owner RPCs. Rollback only;
-- neither a payment provider nor an external delivery API is called.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('45a10000-0000-4000-8000-000000000001','authenticated','authenticated','reship-delivery-staff@example.test','{}','{}',now(),now()),
('45a10000-0000-4000-8000-000000000002','authenticated','authenticated','reship-delivery-owner@example.test','{}','{}',now(),now()),
('45a10000-0000-4000-8000-000000000003','authenticated','authenticated','reship-delivery-other@example.test','{}','{}',now(),now()),
('45a10000-0000-4000-8000-000000000004','authenticated','authenticated','reship-delivery-other-staff@example.test','{}','{}',now(),now());
update public.profiles set role='staff',nickname='재출고45A'||right(id::text,4) where id in('45a10000-0000-4000-8000-000000000001','45a10000-0000-4000-8000-000000000004');
insert into public.ips(id,title,vertical_key) values('claim-reship-delivery-test','재출고 배송 확인','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
values('45a10000-0000-4000-8000-000000000050','claim-reship-delivery-test','합성 반송지',3000,'합성 재출고 반송 주소');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
values('claim-reship-delivery-test','claim-reship-delivery-test','합성 재출고 굿즈','문구',10000,'ok',20,'45a10000-0000-4000-8000-000000000050');
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
values('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','delivered',23000,3000,'{}',now()-interval '2 days',now()-interval '1 day');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '45a10000-0000-4000-8000-000000000011','45a10000-0000-4000-8000-000000000010','claim-reship-delivery-test',id,2,10000,'합성 재출고 굿즈','문구','claim-reship-delivery-test'
from public.goods_variants where good_id='claim-reship-delivery-test' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
values('45a10000-0000-4000-8000-000000000051','45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000050','합성 반송지',3000,'{}','delivered','hanjin','SALE45A10001',now()-interval '2 days',now()-interval '1 day');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
values('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000051','45a10000-0000-4000-8000-000000000011',2);
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,provider)
values('45a10000-0000-4000-8000-000000000030','45a10000-0000-4000-8000-000000000002','order','45a10000-0000-4000-8000-000000000010',23000,'paid','qa-only-reship-delivery','qa-only-reship-delivery','{"qa_only":true}','toss');
set local role authenticated;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000002',true);
select 1/case when public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')='{"cancel":false,"return":true,"exchange":true}' then 1 else 0 end as assert_first_delivered_order_is_still_claimable;
reset role;
select 1/case when public.request_order_claim('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','exchange','첫 교환','defect')='requested' then 1 else 0 end as assert_first_exchange_intake;
select id as exchange_id from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000001',true);
select public.admin_decide_order_claim(:'exchange_id','approve',null);
do $$ declare claim_key uuid; begin
  select id into claim_key from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010';
  begin perform public.admin_record_order_claim_reshipment_delivery(claim_key,'발송 전 배송완료 주장');
    raise exception 'delivery before dispatch accepted';
  exception when check_violation then if sqlerrm<>'claim_reshipment_not_dispatched' then raise; end if; end;
end $$;
select public.admin_record_order_claim_origin_collection(:'exchange_id','45a10000-0000-4000-8000-000000000051','실물 2개 입고 대조');
select public.admin_record_order_claim_reshipment(:'exchange_id','hanjin','EX45A1000001','[]');
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000002',true);
select 1/case when public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')='{"cancel":false,"return":false,"exchange":false}' then 1 else 0 end as assert_in_transit_exchange_does_not_reuse_original_delivery;
reset role;
select 1/case when public.request_order_claim('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','return','교환품 이동 중 반품','defect')='not_claimable' then 1 else 0 end as assert_writer_rechecks_replacement_delivery;
create temp table frozen_before_delivery on commit drop as select
  (select to_jsonb(o) from public.orders o where id='45a10000-0000-4000-8000-000000000010') as purchase,
  (select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id='45a10000-0000-4000-8000-000000000010') as items,
  (select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id='45a10000-0000-4000-8000-000000000010') as shipments,
  (select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id='45a10000-0000-4000-8000-000000000010') as payments,
  (select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id='claim-reship-delivery-test') as variants,
  (select to_jsonb(c)-array['reship_delivered_at','reship_delivered_by','reship_delivery_evidence','updated_at'] from public.order_cancellation_requests c where id=:'exchange_id') as claim;
set local role authenticated;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000003',true);
select 1/case when public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010') is null
  and not exists(select 1 from public.order_cancellation_requests where id=:'exchange_id') then 1 else 0 end as assert_other_owner_cannot_read_delivery;
do $$ begin
  begin perform public.admin_record_order_claim_reshipment_delivery('45a10000-0000-4000-8000-000000000099','고객이 쓴 배송 주장');
    raise exception 'customer receipt accepted';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000001',true);
do $$ declare claim_key uuid; value text; begin
  select id into claim_key from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010';
  foreach value in array array[null::text,'',repeat('가',501),E'앞\x01뒤'] loop
    begin perform public.admin_record_order_claim_reshipment_delivery(claim_key,value);
      raise exception 'invalid delivery evidence accepted';
    exception when check_violation then if sqlerrm<>'invalid_reshipment_delivery_evidence' then raise; end if; end;
  end loop;
end $$;
select 1/case when public.admin_record_order_claim_reshipment_delivery(:'exchange_id',E'운송장 배송완료와 실물 2개 수령 확인\n상담 기록 대조')='delivered' then 1 else 0 end as assert_staff_records_actual_replacement_delivery;
select 1/case when public.admin_order_claim_detail(:'exchange_id')#>>'{claim,reshipDeliveredAt}' is not null
  and public.admin_order_claim_detail(:'exchange_id')#>>'{claim,reshipDeliveredBy}'='45a10000-0000-4000-8000-000000000001'
  and public.admin_order_claim_detail(:'exchange_id')#>>'{claim,reshipDeliveryEvidence}'=E'운송장 배송완료와 실물 2개 수령 확인\n상담 기록 대조'
  and public.admin_order_claim_detail(:'exchange_id')#>>'{claim,reshipDeliveredByName}'=(select nickname from public.profiles where id='45a10000-0000-4000-8000-000000000001')
  and jsonb_array_length(public.admin_order_claim_detail(:'exchange_id')#>'{claim,collections}')=1
  then 1 else 0 end as assert_staff_detail_keeps_origin_and_delivery_receipt;
reset role;
create temp table first_receipt on commit drop as
select to_jsonb(c) as claim from public.order_cancellation_requests c where id=:'exchange_id';
set local role authenticated;
select 1/case when public.admin_record_order_claim_reshipment_delivery(:'exchange_id',E'운송장 배송완료와 실물 2개 수령 확인\n상담 기록 대조')='delivered' then 1 else 0 end as assert_exact_receipt_replay;
do $$ declare claim_key uuid; begin
  select id into claim_key from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010';
  begin perform public.admin_record_order_claim_reshipment_delivery(claim_key,'다른 배송 근거');raise exception 'delivery evidence overwritten';
  exception when unique_violation then if sqlerrm<>'reshipment_delivery_conflict' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000004',true);
do $$ declare claim_key uuid; begin
  select id into claim_key from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010';
  begin perform public.admin_record_order_claim_reshipment_delivery(claim_key,E'운송장 배송완료와 실물 2개 수령 확인\n상담 기록 대조');raise exception 'other actor claimed receipt';
  exception when unique_violation then if sqlerrm<>'reshipment_delivery_conflict' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000002',true);
select 1/case when (select reship_delivered_at is not null from public.order_cancellation_requests where id=:'exchange_id') then 1 else 0 end as assert_customer_reads_only_own_delivery_date;
do $$ begin
  begin perform reship_delivery_evidence from public.order_cancellation_requests;raise exception 'customer read internal delivery evidence';
  exception when insufficient_privilege then null; end;
  begin perform reship_delivered_by from public.order_cancellation_requests;raise exception 'customer read staff delivery identity';
  exception when insufficient_privilege then null; end;
end $$;
select 1/case when public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')='{"cancel":false,"return":true,"exchange":true}' then 1 else 0 end as assert_verified_replacement_reopens_return_exchange;
reset role;
select 1/case when (select to_jsonb(c) from public.order_cancellation_requests c where id=:'exchange_id')=(select claim from first_receipt)
  and (select count(*) from public.audit_log where target='order:45a10000-0000-4000-8000-000000000010' and action='admin.order.claim_reshipment_delivered')=1
  and exists(select 1 from public.audit_log where target='order:45a10000-0000-4000-8000-000000000010' and action='admin.order.claim_reshipment_delivered'
    and actor_id='45a10000-0000-4000-8000-000000000001' and diff->>'claimId'=:'exchange_id'
    and diff->>'evidence'=E'운송장 배송완료와 실물 2개 수령 확인\n상담 기록 대조') then 1 else 0 end as assert_receipt_and_audit_written_exactly_once;
select 1/case when (select purchase from frozen_before_delivery)=(select to_jsonb(o) from public.orders o where id='45a10000-0000-4000-8000-000000000010')
  and (select items from frozen_before_delivery)=(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where order_id='45a10000-0000-4000-8000-000000000010')
  and (select shipments from frozen_before_delivery)=(select jsonb_agg(to_jsonb(s) order by id) from public.order_shipments s where order_id='45a10000-0000-4000-8000-000000000010')
  and (select payments from frozen_before_delivery)=(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id='45a10000-0000-4000-8000-000000000010')
  and (select variants from frozen_before_delivery)=(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id='claim-reship-delivery-test')
  and (select claim from frozen_before_delivery)=(select to_jsonb(c)-array['reship_delivered_at','reship_delivered_by','reship_delivery_evidence','updated_at'] from public.order_cancellation_requests c where id=:'exchange_id')
  and not exists(select 1 from public.refunds where payment_id='45a10000-0000-4000-8000-000000000030')
  then 1 else 0 end as assert_confirmation_changes_no_order_prices_dates_money_or_stock;
select 1/case when public.request_order_claim('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','return','교환품 전체 수령 뒤 반품','defect')='requested' then 1 else 0 end as assert_new_return_intake_after_actual_delivery;
select id as return_id from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010' and claim_type='return' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000001',true);
do $$ declare claim_key uuid; begin
  select id into claim_key from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010' and claim_type='return';
  begin perform public.admin_record_order_claim_reshipment_delivery(claim_key,'반품은 재출고가 아님');raise exception 'nonexchange delivery accepted';
  exception when check_violation then if sqlerrm<>'claim_reshipment_not_dispatched' then raise; end if; end;
end $$;
select public.admin_decide_order_claim(:'return_id','reject','합성 경계 검증 종료');
reset role;
select public.request_order_claim('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','exchange','두 번째 교환','defect');
select id as second_exchange_id from public.order_cancellation_requests where order_id='45a10000-0000-4000-8000-000000000010' and claim_type='exchange' and stage='requested' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','45a10000-0000-4000-8000-000000000001',true);
select public.admin_decide_order_claim(:'second_exchange_id','approve',null);
select public.admin_record_order_claim_origin_collection(:'second_exchange_id','45a10000-0000-4000-8000-000000000051','두 번째 교환 실물 2개 입고');
select public.admin_record_order_claim_reshipment(:'second_exchange_id','hanjin','EX45A1000002','[]');
select 1/case when (public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')->>'return')::boolean=false then 1 else 0 end as assert_second_exchange_needs_new_delivery_confirmation;
select public.admin_record_order_claim_reshipment_delivery(:'second_exchange_id','두 번째 교환품 전체 수령 확인');
select 1/case when (public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')->>'return')::boolean then 1 else 0 end as assert_all_exchange_receipts_reopen_intake;
reset role;
update public.order_shipment_items set qty=1 where order_item_id='45a10000-0000-4000-8000-000000000011';
set local role authenticated;
select 1/case when (public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')->>'return')::boolean=false then 1 else 0 end as assert_replacement_receipts_do_not_bypass_original_quantity;
reset role;
update public.order_shipment_items set qty=2 where order_item_id='45a10000-0000-4000-8000-000000000011';
-- A historical completed exchange with a tracking number is not backfilled as
-- delivered merely because a more recent replacement has its own receipt.
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reship_carrier,reship_tracking_number,reshipped_at,completed_at)
values('45a10000-0000-4000-8000-000000000090','45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','합성 과거 교환','exchange','completed','hanjin','EX45A1000090',now()-interval '1 day',now()-interval '1 day');
set local role authenticated;
select 1/case when (public.order_claim_eligibility('45a10000-0000-4000-8000-000000000010')->>'return')::boolean=false then 1 else 0 end as assert_unknown_historical_receipt_stays_closed;
select public.admin_record_order_claim_reshipment_delivery('45a10000-0000-4000-8000-000000000090','과거 교환품 수령 사실 근거 대조');
reset role;
-- Existing reason-specific windows stay based on the original order receipt.
update public.order_shipments set delivered_at=now()-interval '8 days',shipped_at=now()-interval '9 days' where id='45a10000-0000-4000-8000-000000000051';
select 1/case when public.request_order_claim('45a10000-0000-4000-8000-000000000010','45a10000-0000-4000-8000-000000000002','return','새 배송 확인은 원 기한 연장이 아님','change_of_mind')='deadline_expired' then 1 else 0 end as assert_replacement_confirmation_does_not_extend_original_window;
rollback;
