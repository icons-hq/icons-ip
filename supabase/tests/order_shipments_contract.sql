\set ON_ERROR_STOP on
begin;
select 1 / case when not has_column_privilege('authenticated','public.orders','shipping_carrier','UPDATE')
 and not has_column_privilege('service_role','public.orders','tracking_number','INSERT') then 1 else 0 end as assert_legacy_tracking_write_revoked;


update public.fulfillment_origins set is_active=true,base_fee=4000,free_threshold=60000 where id='00000000-0000-4000-8000-000000042202';
insert into public.verticals(key,label,color) values('shipments-contract-test','배송 테스트','#111111');
insert into public.ips(id,title,vertical_key,published_at) values('shipments-contract-test','배송 테스트','shipments-contract-test',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id) values
 ('shipment-contract-gimpo','shipments-contract-test','김포 굿즈','문구',10000,'ok',5,null,'00000000-0000-4000-8000-000000042201'),
 ('shipment-contract-seowon','shipments-contract-test','서원 굿즈','문구',15000,'ok',5,null,'00000000-0000-4000-8000-000000042202');
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('shipment-contract-gimpo');
select pg_temp.publish_goods_kc_fixture('shipment-contract-seowon');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000044701','authenticated','authenticated','shipments@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000044702','authenticated','authenticated','shipment-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000044703','authenticated','authenticated','shipment-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='배송 구매자',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='00000000-0000-4000-8000-000000044701';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000044702';
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000044701',good_id,id,1 from public.goods_variants where good_id in ('shipment-contract-gimpo','shipment-contract-seowon') and is_default;
select public.place_order('00000000-0000-4000-8000-000000044701','{"recipientName":"테스트","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}','00000000-0000-4000-8000-000000044710','card') as order_id \gset

select set_config('test.shipment_order',:'order_id',true);
update public.orders set status='confirmed' where id=:'order_id';
select id as shipment_one from public.order_shipments where order_id=:'order_id' and origin_id='00000000-0000-4000-8000-000000042201' \gset
select id as shipment_two from public.order_shipments where order_id=:'order_id' and origin_id='00000000-0000-4000-8000-000000042202' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044702',true);
select public.admin_update_shipment_status(:'shipment_one','shipping','hanjin','1234567890');
select public.admin_update_shipment_status(:'shipment_two','shipping','hanjin','9876543210');
select public.admin_update_shipment_status(:'shipment_one','delivered',null,null);
select 1 / case when jsonb_array_length(public.admin_order_detail(:'order_id')->'shipments')=2
 and (select count(*) from jsonb_array_elements(public.admin_order_detail(:'order_id')->'timeline') e where e->>'action'='shipped')=2
 and (select count(*) from jsonb_array_elements(public.admin_order_detail(:'order_id')->'timeline') e where e->>'action'='delivered')=1
 then 1 else 0 end as assert_staff_reads_each_shipment_and_timeline;
select 1 / case when (select status from public.orders where id=:'order_id')='shipping'
 and (select shipping_carrier is null and tracking_number is null from public.orders where id=:'order_id')
 then 1 else 0 end as assert_order_aggregate_does_not_rewrite_legacy_tracking;
reset role;
do $$ begin
 update public.orders set shipping_carrier='hanjin',tracking_number='1111111111' where id=current_setting('test.shipment_order')::uuid;
 raise exception 'legacy tracking write accepted';
exception when check_violation then
 if sqlerrm<>'legacy_order_tracking_frozen' then raise; end if;
end $$;
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status)
 values('order_shipped:'||:'order_id'||':'||:'shipment_one','order_shipped','shipments@example.test','발송','failed'),
 ('order_shipped:'||:'order_id'||':'||:'shipment_two','order_shipped','shipments@example.test','발송','failed');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044702',true);
select public.admin_request_email_resend('order_shipped:'||:'order_id'||':'||:'shipment_one');
select public.admin_request_email_resend('order_shipped:'||:'order_id'||':'||:'shipment_two');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044701',true);
select 1 / case when (select count(*) from public.order_shipments where order_id=:'order_id')=2 then 1 else 0 end as assert_customer_tracks_both_shipments;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000044703',true);
select 1 / case when not exists(select 1 from public.order_shipments where order_id=:'order_id') then 1 else 0 end as assert_other_customer_cannot_track;
reset role;
-- Production code and SQL must read the new relation; the immutable guard alone mentions both legacy columns.
select 1 / case when not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f' and p.proname<>'freeze_legacy_order_tracking'
 and p.prosrc ~ '(orders|order_record|target|purchase|o)\.(shipping_carrier|tracking_number)') then 1 else 0 end as assert_no_legacy_order_tracking_consumers;
rollback;
