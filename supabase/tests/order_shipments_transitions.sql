\set ON_ERROR_STOP on
begin;
select 1 / case when to_regprocedure('public.admin_update_shipment_status(uuid,text,text,text)') is not null then 1 else 0 end as assert_shipment_transitions;
-- Use a rollback-only synthetic order; payment-provider callbacks are not invoked.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000044601','authenticated','authenticated','shipment-ops@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000044602','authenticated','authenticated','shipment-customer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000044601';
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=8,
 evidence='TEST ONLY: multi-shipment confirmation' where singleton;
insert into public.ips(id,title,vertical_key) values('shipment-transitions-ip','TEST 배송 전이','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('shipment-transitions-a','shipment-transitions-ip','TEST 배송 굿즈 A','문구',11500,'ok',10),
 ('shipment-transitions-b','shipment-transitions-ip','TEST 배송 굿즈 B','문구',11500,'ok',10);
insert into public.orders(id,user_id,status,total,shipping_fee,address) values('00000000-0000-4000-8000-000000044610','00000000-0000-4000-8000-000000044602','paid',30000,7000,'{}');
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select '00000000-0000-4000-8000-000000044610',good_id,id,1,11500,'TEST 배송 굿즈','문구','shipment-transitions-ip'
 from public.goods_variants where good_id in('shipment-transitions-a','shipment-transitions-b') and is_default;
insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 values('00000000-0000-4000-8000-000000044602','order','00000000-0000-4000-8000-000000044610','toss',30000,'paid','TEST-shipment-transition-payment');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
 ('00000000-0000-4000-8000-000000044611','00000000-0000-4000-8000-000000044610','00000000-0000-4000-8000-000000042201','김포',3000,'{}'),
 ('00000000-0000-4000-8000-000000044612','00000000-0000-4000-8000-000000044610','00000000-0000-4000-8000-000000042202','남양주',4000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select s.order_id,s.id,i.id,1 from public.order_shipments s join public.order_items i on i.order_id=s.order_id
 where s.order_id='00000000-0000-4000-8000-000000044610'
  and i.good_id=case when s.id='00000000-0000-4000-8000-000000044611' then 'shipment-transitions-a' else 'shipment-transitions-b' end;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044601',true);
select public.admin_update_order_status('00000000-0000-4000-8000-000000044610','confirmed',null,null);
do $$ begin
 perform public.admin_update_order_status('00000000-0000-4000-8000-000000044610','shipping','hanjin','100000001');
 raise exception 'ambiguous order accepted';
exception when check_violation then if sqlerrm<>'shipment_reference_required' then raise; end if; end $$;
do $$ begin
 perform public.admin_update_shipment_status('00000000-0000-4000-8000-000000044611','shipping',null,null);
 raise exception 'untracked dispatch accepted';
exception when check_violation then if sqlerrm<>'tracking_required' then raise; end if; end $$;
select public.admin_update_shipment_status('00000000-0000-4000-8000-000000044611','shipping','hanjin','100000001');
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='shipping'
 and (select status from public.order_shipments where id='00000000-0000-4000-8000-000000044612')='ready' then 1 else 0 end as assert_partial_dispatch;
select public.admin_update_shipment_status('00000000-0000-4000-8000-000000044611','delivered',null,null);
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='shipping'
 and (select delivered_at from public.orders where id='00000000-0000-4000-8000-000000044610') is null then 1 else 0 end as assert_partial_arrival_not_complete;
select public.admin_import_shipment_tracking('00000000-0000-4000-8000-000000044612','hanjin','100000002');
select public.admin_update_shipment_status('00000000-0000-4000-8000-000000044612','delivered',null,null);
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='delivered'
 and (select delivered_at from public.orders where id='00000000-0000-4000-8000-000000044610')=(select max(delivered_at) from public.order_shipments where order_id='00000000-0000-4000-8000-000000044610') then 1 else 0 end as assert_all_arrived;
reset role;
update public.order_shipments set delivered_at=now()-interval '9 days' where id='00000000-0000-4000-8000-000000044611';
select public.settle_delivered_orders();
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='delivered' then 1 else 0 end as assert_latest_delivery_clock;
update public.order_shipments set delivered_at=now()-interval '9 days' where id='00000000-0000-4000-8000-000000044612';
select public.settle_delivered_orders();
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='delivered'
 then 1 else 0 end as delivery_date_correction_does_not_shorten_frozen_confirmation_deadline;
-- Simulate the passage of the explicitly configured confirmation deadline.
update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second' where order_id='00000000-0000-4000-8000-000000044610';
select public.settle_delivered_orders();
select 1 / case when (select status from public.orders where id='00000000-0000-4000-8000-000000044610')='done' then 1 else 0 end as assert_all_old_settled;
select 1 / case when not has_function_privilege('anon','public.admin_update_shipment_status(uuid,text,text,text)','EXECUTE') then 1 else 0 end as assert_anon_denied;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044602',true);
do $$ begin perform public.admin_update_shipment_tracking('00000000-0000-4000-8000-000000044611','hanjin','100000003');raise exception 'customer mutation accepted';exception when insufficient_privilege then null;end $$;
rollback;
