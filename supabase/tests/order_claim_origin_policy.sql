\set ON_ERROR_STOP on
begin;
-- Rollback-only synthetic catalog/order; no payment provider is called.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000045301','authenticated','authenticated','claim-origin-staff@example.test','{}','{}',now(),now()),
('00000000-0000-4000-8000-000000045302','authenticated','authenticated','claim-origin-owner@example.test','{}','{}',now(),now()),
('00000000-0000-4000-8000-000000045303','authenticated','authenticated','claim-origin-other@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000045301';
insert into public.ips(id,title,vertical_key) values('claim-origin-test','회수 계약 검증','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('claim-origin-test','claim-origin-test','회수 상품','문구',10000,'ok',20);
insert into public.orders(id,user_id,status,total,address) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','paid',30000,'{}');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '00000000-0000-4000-8000-000000045311','00000000-0000-4000-8000-000000045310','claim-origin-test',id,2,10000,'회수 상품','문구','claim-origin-test'
from public.goods_variants where good_id='claim-origin-test' and is_default;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '00000000-0000-4000-8000-000000045312','00000000-0000-4000-8000-000000045310','claim-origin-test',id,1,10000,'회수 상품','문구','claim-origin-test'
from public.goods_variants where good_id='claim-origin-test' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
('00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000042201','김포',0,'{}'),
('00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000042202','남양주',0,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045311'),
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045312');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
select public.admin_update_order_status('00000000-0000-4000-8000-000000045310','confirmed',null,null);
reset role;
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','cancel','발주 확인 뒤 취소','defect')='not_cancelable' then 1 else 0 end as assert_confirmed_cancel_denied;
-- Even a privileged status rollback cannot erase confirmation history.
update public.orders set status='paid',confirmed_at=null where id='00000000-0000-4000-8000-000000045310';
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','cancel','상태 롤백 뒤 취소','change_of_mind')='not_cancelable' then 1 else 0 end as assert_confirmation_is_monotonic;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045302',true);
select 1/case when public.order_claim_eligibility('00000000-0000-4000-8000-000000045310')='{"cancel":false,"return":false,"exchange":false}' then 1 else 0 end as assert_owner_state_projection;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045303',true);
select 1/case when public.order_claim_eligibility('00000000-0000-4000-8000-000000045310') is null then 1 else 0 end as assert_other_owner_hidden;
reset role;
-- Marking only existing shipments delivered is insufficient if an item is absent.
update public.order_shipments set status='delivered',shipped_at=now()-interval '2 days',delivered_at=now()-interval '1 day'
where order_id='00000000-0000-4000-8000-000000045310';
delete from public.order_shipment_items where order_item_id='00000000-0000-4000-8000-000000045312';
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','누락 배송 수량','defect')='not_claimable' then 1 else 0 end as assert_missing_item_denied;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045312');
update public.order_shipment_items set qty=1 where order_item_id='00000000-0000-4000-8000-000000045311';
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','일부 배송 수량','defect')='not_claimable' then 1 else 0 end as assert_partial_quantity_denied;
update public.order_shipment_items set qty=3 where order_item_id='00000000-0000-4000-8000-000000045311';
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','초과 배송 수량','defect')='not_claimable' then 1 else 0 end as assert_excess_quantity_denied;
update public.order_shipment_items set qty=2 where order_item_id='00000000-0000-4000-8000-000000045311';
select 1/case when public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','출고지 전체 회수','defect')='requested' then 1 else 0 end as assert_all_quantities_requested;
select id as claim_id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310' \gset
update public.fulfillment_origins set return_address='합성 반품 주소 '||code where id in('00000000-0000-4000-8000-000000042201','00000000-0000-4000-8000-000000042202');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
select public.admin_decide_order_claim(:'claim_id','approve',null);
select 1/case when jsonb_array_length(public.admin_order_claim_detail(:'claim_id')#>'{claim,collections}')=2 then 1 else 0 end as assert_two_origin_collections;
-- No order-wide acknowledgement can claim both warehouses received the goods.
do $$ declare claim_key uuid; begin
 select id into claim_key from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310';
 begin
 perform public.admin_record_order_claim_collection(claim_key,'collected');
 raise exception 'aggregate collection accepted';
 exception when check_violation then if sqlerrm<>'origin_collection_required' then raise; end if; end;
end $$;
-- Physical receipts are idempotent and cannot acknowledge another origin.
select public.admin_record_order_claim_origin_collection(:'claim_id','00000000-0000-4000-8000-000000045321',E'김포 실물 2개\n입고\t확인');
select public.admin_record_order_claim_origin_collection(:'claim_id','00000000-0000-4000-8000-000000045321',E'김포 실물 2개\n입고\t확인');
select 1/case when (public.admin_order_claim_detail(:'claim_id')#>>'{claim,collectionComplete}')::boolean=false
 and (public.admin_order_claim_detail(:'claim_id')#>>'{claim,stage}')='collecting' then 1 else 0 end as assert_first_origin_does_not_unlock_refund;
do $$ declare claim_key uuid; begin
 select id into claim_key from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310';
 begin perform public.admin_record_order_claim_origin_collection(claim_key,'00000000-0000-4000-8000-000000045321','다른 근거 덮어쓰기');raise exception 'receipt overwritten';
 exception when unique_violation then if sqlerrm<>'claim_collection_conflict' then raise;end if;end;
 begin perform public.admin_record_order_claim_refund(claim_key,'pg_cancel','filed',null);raise exception 'partial receipt refunded';
 exception when check_violation then if sqlerrm<>'claim_collections_incomplete' then raise;end if;end;
end $$;
reset role;
-- A direct server-role status write and the deepest stock/finalization seam must
-- refuse the same unfinished collection, even with a supplied provider key.
do $$ begin
 begin update public.orders set status='canceled' where id='00000000-0000-4000-8000-000000045310';raise exception 'raw cancel bypass';
 exception when check_violation then if sqlerrm<>'claim_collections_incomplete' then raise;end if;end;
 begin perform public.finalize_order_cancellation_with_provider_evidence('00000000-0000-4000-8000-000000045310','회수 전 취소',array['qa-only-claim-origin']);raise exception 'stock restored too early';
 exception when check_violation then if sqlerrm<>'claim_collections_incomplete' then raise;end if;end;
end $$;
select 1/case when (select stock_qty from public.goods_variants where good_id='claim-origin-test' and is_default)=20
 and not exists(select 1 from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id='00000000-0000-4000-8000-000000045310')
 and (select count(*) from public.audit_log where action='admin.order.claim_origin_collected' and target='order:00000000-0000-4000-8000-000000045310')=1
 then 1 else 0 end as assert_partial_receipt_preserves_stock_money_and_audit;
-- Origin settings after approval never rewrite the captured return address.
update public.fulfillment_origins set return_address='승인 이후 변경된 주소' where id='00000000-0000-4000-8000-000000042202';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045303',true);
select 1/case when not exists(select 1 from public.order_claim_collections where claim_id=:'claim_id') then 1 else 0 end as assert_foreign_collections_hidden;
do $$ declare claim_key uuid; begin
 -- Exact UUID is deliberately known; role alone must still reject the writer.
 begin perform public.admin_record_order_claim_origin_collection('00000000-0000-4000-8000-000000045399','00000000-0000-4000-8000-000000045322','고객의 입고 주장');raise exception 'customer collection accepted';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
select public.admin_record_order_claim_origin_collection(:'claim_id','00000000-0000-4000-8000-000000045322','남양주 실물 1개 입고 확인');
select 1/case when (public.admin_order_claim_detail(:'claim_id')#>>'{claim,collectionComplete}')::boolean
 and (public.admin_order_claim_detail(:'claim_id')#>>'{claim,stage}')='collected'
 and (select return_address_snapshot from public.order_claim_collections where claim_id=:'claim_id' and shipment_id='00000000-0000-4000-8000-000000045322')<>'승인 이후 변경된 주소'
 then 1 else 0 end as assert_final_receipt_keeps_immutable_address;
reset role;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,provider)
values('00000000-0000-4000-8000-000000045330','00000000-0000-4000-8000-000000045302','order','00000000-0000-4000-8000-000000045310',30000,'paid','qa-only-claim-origin','qa-only-claim-origin','{"qa_only":true}','toss');
set local role authenticated;
select public.admin_record_order_claim_refund(:'claim_id','pg_cancel','filed',null);
reset role;
select 1/case when public.assert_order_cancellation_reconciliation_allowed(:'claim_id','00000000-0000-4000-8000-000000045301')='allowed' then 1 else 0 end as assert_all_received_provider_preflight;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
values('00000000-0000-4000-8000-000000045331','toss','00000000-0000-4000-8000-000000045302','order','00000000-0000-4000-8000-000000045310',30000,'KRW','approved','qa-only-claim-approved','QA453APPROVED','QA453PRODUCT','00000000-0000-4000-8000-000000045330',now()+interval '10 minutes');
select 1/case when public.reconcile_expired_prepared_goods_cancellation(:'claim_id','00000000-0000-4000-8000-000000045301')='not_applicable' then 1 else 0 end as assert_approved_capture_uses_provider_reconciliation;
update public.payment_attempts set payment_id=null where id='00000000-0000-4000-8000-000000045331';
select 1/case when public.reconcile_expired_prepared_goods_cancellation(:'claim_id','00000000-0000-4000-8000-000000045301')='in_progress' then 1 else 0 end as assert_approved_without_ledger_stays_blocked;
update public.payment_attempts set payment_id='00000000-0000-4000-8000-000000045330' where id='00000000-0000-4000-8000-000000045331';
select public.complete_order_cancellation_request(:'claim_id',array['qa-only-claim-origin'],'00000000-0000-4000-8000-000000045301');
select public.complete_order_cancellation_request(:'claim_id',array['qa-only-claim-origin'],'00000000-0000-4000-8000-000000045301');
select 1/case when public.assert_order_cancellation_reconciliation_allowed(:'claim_id','00000000-0000-4000-8000-000000045301')='completed'
 and (select stock_qty from public.goods_variants where good_id='claim-origin-test' and is_default)=23
 and (select amount from public.refunds where payment_id='00000000-0000-4000-8000-000000045330')=30000
 and (select count(*) from public.audit_log where action='order.option_stock_restored' and target='order:00000000-0000-4000-8000-000000045310')=2
 then 1 else 0 end as assert_whole_refund_and_exact_stock_once;
select 1/case when not has_function_privilege('anon','public.order_claim_eligibility(uuid)','execute')
 and not has_function_privilege('authenticated','public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)','execute')
 and has_function_privilege('service_role','public.assert_order_cancellation_reconciliation_allowed(uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_record_order_claim_origin_collection(uuid,uuid,text)','execute')
 and not has_table_privilege('authenticated','public.order_claim_collections','update')
 and not has_table_privilege('service_role','public.order_cancellation_requests','insert')
 and not has_table_privilege('service_role','public.order_cancellation_requests','update')
 and not has_function_privilege('service_role','public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[])','execute')
 then 1 else 0 end as assert_rpc_and_table_acl_sealed;
rollback;
