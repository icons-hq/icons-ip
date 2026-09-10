\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql to this connection. All records roll back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000004951','authenticated','authenticated','settled-export-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004952','authenticated','authenticated','settled-export-user@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004953','authenticated','authenticated','settled-export-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='settled-export-'||right(id::text,4)||'@example.test',nickname='settled_export_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),
 role=case when id='00000000-0000-4000-8000-000000004951' then 'admin'::public.user_role when id='00000000-0000-4000-8000-000000004953' then 'staff'::public.user_role else 'user'::public.user_role end
where id in('00000000-0000-4000-8000-000000004951','00000000-0000-4000-8000-000000004952','00000000-0000-4000-8000-000000004953');
insert into public.ips(id,title,vertical_key,published_at) values('settled-export-ip','거래확정 합성 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values
 ('00000000-0000-4000-8000-000000004951','settled-export-origin-a','합성 출고지 A','hanjin',3000,'합성 반품 주소 A',true),
 ('00000000-0000-4000-8000-000000004952','settled-export-origin-b','합성 출고지 B','hanjin',2000,'합성 반품 주소 B',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('settled-export-a','settled-export-ip','합성 A','문구',10001,'ok',100,'00000000-0000-4000-8000-000000004951'),
 ('settled-export-b','settled-export-ip','합성 B','문구',10001,'ok',100,'00000000-0000-4000-8000-000000004951'),
 ('settled-export-c','settled-export-ip','합성 C','문구',9000,'ok',100,'00000000-0000-4000-8000-000000004952');
select pg_temp.publish_goods_kc_fixture('settled-export-a');
select pg_temp.publish_goods_kc_fixture('settled-export-b');
select pg_temp.publish_goods_kc_fixture('settled-export-c');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004951',true);
set local role authenticated;
select public.admin_save_goods_variant_external_identity(good_id,id,'000495-'||right(good_id,1),'=ERP 합성 '||right(good_id,1),'000000495-'||right(good_id,1),null)
from public.goods_variants where good_id in('settled-export-a','settled-export-b','settled-export-c') and is_default;
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,goods_scope,target_good_ids)
values('SETTLEDEXPORT','거래확정 합성 쿠폰','fixed',1001,0,now()-interval '1 day','active','selected_goods',array['settled-export-a','settled-export-b']);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004951',true);
set local role authenticated;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004951',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"synthetic settled export policy"}');
select public.admin_adjust_store_credit('10000000-0000-4000-8000-000000004952','00000000-0000-4000-8000-000000004952',1000,now()+interval '10 days','거래확정 합성 적립금',0);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004952',true);
select public.apply_cart_coupon_code('SETTLEDEXPORT');
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select '00000000-0000-4000-8000-000000004952',good_id,id,1 from public.goods_variants where good_id in('settled-export-a','settled-export-b','settled-export-c') and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004952','{"recipientName":"거래확정 합성","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','20000000-0000-4000-8000-000000004951','bank_transfer',1000) as export_order \gset
reset role;
select 1/case when (select total=32001 and shipping_fee=5000 and discount_total=1001 and store_credit_total=1000 from public.orders where id=:'export_order') then 1 else 0 end as canonical_checkout_money;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004951',true);
set local role authenticated;
select public.admin_confirm_bank_transfer_deposit(:'export_order','합성 입금확인 증빙');
reset role;
update public.orders set created_at='2026-08-31T15:00:00Z' where id=:'export_order';
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='00001234'||right(origin_id::text,4),shipped_at=now()-interval '10 days',delivered_at=now()-interval '9 days' where order_id=:'export_order';
update public.orders set status='delivered',delivered_at=now()-interval '9 days' where id=:'export_order';
set local role service_role;
select public.settle_delivered_orders();
reset role;
set local role authenticated;
select (public.admin_create_settled_export('30000000-0000-4000-8000-000000004951','{"from":"2026-09-01","to":"2026-09-01","query":"settled_export_4952"}')->>'id') as export_receipt \gset
select 1/case when (public.admin_read_settled_export(:'export_receipt')#>>'{orders,0,total}')::bigint=32001
 and jsonb_array_length(public.admin_read_settled_export(:'export_receipt')#>'{orders,0,items}')=3
 and jsonb_array_length(public.admin_read_settled_export(:'export_receipt')#>'{orders,0,shipments}')=2
 and (public.admin_read_settled_export(:'export_receipt')#>>'{orders,0,coupon,eligibleSubtotal}')::bigint=20002
 and (public.admin_read_settled_export(:'export_receipt')#>>'{orders,0,payments,0,approvedAt}')::timestamptz=(select confirmed_at from public.bank_transfer_confirmations where order_id=:'export_order')
 and (public.admin_read_settled_export(:'export_receipt')#>>'{orders,0,payments,0,approvedAt}')::timestamptz<>'2026-08-31T15:00:00Z'::timestamptz
 then 1 else 0 end as source_rows_and_real_payment_time_are_preserved;
reset role;
set local role authenticated;
select public.admin_save_goods_variant_external_identity(identity.good_id,identity.variant_id,'CHANGED-'||identity.erp_code,'현재 ERP 이름','CHANGED-'||identity.barcode,identity.updated_at)
from public.admin_list_goods_variant_external_identities() identity where identity.good_id in('settled-export-a','settled-export-b','settled-export-c');
reset role;
update public.coupons set target_good_ids=array['settled-export-c'] where code='SETTLEDEXPORT';
update public.order_shipments set tracking_number='09999999'||right(origin_id::text,4) where order_id=:'export_order';
set local role authenticated;
select 1/case when (public.admin_create_settled_export('30000000-0000-4000-8000-000000004951','{"from":"2026-09-01","to":"2026-09-01","query":"settled_export_4952"}')->>'id')=:'export_receipt'
 and exists(select 1 from jsonb_array_elements(public.admin_read_settled_export(:'export_receipt')#>'{orders,0,items}') item where item->>'erpCode' like '000495-%' and item->>'erpName' like '=ERP%')
 and not exists(select 1 from jsonb_array_elements(public.admin_read_settled_export(:'export_receipt')#>'{orders,0,shipments}') shipment where shipment->>'trackingNumber' like '09999999%')
 and public.admin_read_settled_export(:'export_receipt')#>'{orders,0,coupon,terms,targetGoodIds}'='["settled-export-a","settled-export-b"]'::jsonb
 then 1 else 0 end as replay_is_frozen_despite_catalog_coupon_and_tracking_changes;
do $$ begin
 begin perform public.admin_create_settled_export('30000000-0000-4000-8000-000000004951','{"query":"changed"}'); raise exception 'request filters changed';
 exception when check_violation then if sqlerrm<>'settled_export_request_conflict' then raise; end if; end;
 begin perform public.admin_create_settled_export('30000000-0000-4000-8000-000000004952','{"from":"2026-08-31","to":"2026-08-31","query":"settled_export_4952"}'); raise exception 'KST date crossed';
 exception when check_violation then if sqlerrm<>'settled_export_empty' then raise; end if; end;
 begin perform public.admin_create_settled_export('30000000-0000-4000-8000-000000004952','{"from":"2026-02-30"}'); raise exception 'invalid date accepted';
 exception when check_violation then if sqlerrm<>'settled_export_invalid_filters' then raise; end if; end;
 begin perform public.admin_create_settled_export('30000000-0000-4000-8000-000000004952','{"from":"2026-09-02","to":"2026-09-01"}'); raise exception 'reversed dates accepted';
 exception when check_violation then if sqlerrm<>'settled_export_invalid_filters' then raise; end if; end;
end $$;
reset role;
-- Model historical omissions. A current ERP mapping must not fill this gap.
delete from private.order_item_external_identity_snapshots where order_item_id in(select id from public.order_items where order_id=:'export_order');
update public.order_items set regular_unit_price_snapshot=null where order_id=:'export_order';
update public.coupon_redemptions set eligible_subtotal=null,terms_snapshot=null where order_id=:'export_order';
set local role authenticated;
select (public.admin_create_settled_export('30000000-0000-4000-8000-000000004952','{"query":"settled_export_4952"}')->>'id') as legacy_receipt \gset
select 1/case when not exists(select 1 from jsonb_array_elements(public.admin_read_settled_export(:'legacy_receipt')#>'{orders,0,items}') item where item->>'erpCode' is not null or item->>'erpName' is not null or item->>'regularUnitPrice' is not null)
 and public.admin_read_settled_export(:'legacy_receipt')#>'{orders,0,coupon,terms}'='null'::jsonb
 then 1 else 0 end as historical_omissions_stay_null;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004953',true);
do $$ begin
 begin perform public.admin_read_settled_export((select id from private.settled_export_receipts limit 1)); raise exception 'staff read another receipt';
 exception when insufficient_privilege then null; end;
end $$;
-- The literal receipt remains inaccessible even to another staff member.
select set_config('test.settled_export_receipt',:'export_receipt',true);
do $$ begin
 begin perform public.admin_read_settled_export(current_setting('test.settled_export_receipt')::uuid); raise exception 'cross-owner receipt read';
 exception when no_data_found then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004952',true);
do $$ begin
 begin perform public.admin_create_settled_export('30000000-0000-4000-8000-000000004953','{}'); raise exception 'customer export bypass';
 exception when insufficient_privilege then null; end;
 begin perform public.admin_read_settled_export(current_setting('test.settled_export_receipt')::uuid); raise exception 'customer read bypass';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_create_settled_export(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_create_settled_export(uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','private.collect_settled_export(date,date,text)','execute')
 and not has_table_privilege('authenticated','private.settled_export_receipts','select')
 and (select count(*) from public.audit_log where action='admin.settled_export.created' and actor_id='00000000-0000-4000-8000-000000004951')=2
 then 1 else 0 end as receipts_are_auditable_and_private;
rollback;
