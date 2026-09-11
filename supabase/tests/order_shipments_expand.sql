\set ON_ERROR_STOP on
begin;
select 1 / case when to_regclass('public.order_shipments') is not null then 1 else 0 end as assert_shipment_schema;
update public.fulfillment_origins set is_active=true,base_fee=4000,free_threshold=60000 where id='00000000-0000-4000-8000-000000042202';
insert into public.verticals(key,label,color) values('shipments-test','배송 테스트','#111111');
insert into public.ips(id,title,vertical_key,published_at) values('shipments-test','배송 테스트','shipments-test',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id) values
 ('shipment-gimpo','shipments-test','김포 굿즈','문구',10000,'ok',5,null,'00000000-0000-4000-8000-000000042201'),
 ('shipment-seowon','shipments-test','서원 굿즈','문구',15000,'ok',5,null,'00000000-0000-4000-8000-000000042202');
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('shipment-gimpo');
select pg_temp.publish_goods_kc_fixture('shipment-seowon');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000042801','authenticated','authenticated','shipments@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000042802','authenticated','authenticated','shipment-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000042803','authenticated','authenticated','shipment-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='배송 구매자',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now() where id='00000000-0000-4000-8000-000000042801';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042802';
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000042801',good_id,id,1 from public.goods_variants where good_id in ('shipment-gimpo','shipment-seowon') and is_default;
select public.place_order('00000000-0000-4000-8000-000000042801','{"recipientName":"테스트","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}','00000000-0000-4000-8000-000000042810','card') as order_id \gset
select 1 / case when (select count(*) from public.order_shipments where order_id=:'order_id')=2
 and (select sum(shipping_fee) from public.order_shipments where order_id=:'order_id')=(select shipping_fee from public.orders where id=:'order_id')
 and (select count(*) from public.order_shipment_items where order_id=:'order_id')=2
 and not exists(select 1 from public.order_shipment_items link join public.order_shipments shipment on shipment.id=link.shipment_id join public.order_items item on item.id=link.order_item_id where link.order_id=:'order_id' and shipment.origin_id<>item.origin_id_snapshot)
 then 1 else 0 end as assert_atomic_origin_groups_and_fee;
select public.place_order('00000000-0000-4000-8000-000000042801','{"recipientName":"테스트","phone":"01012345678","postalCode":"00000","address1":"배송 금지 테스트 주소"}','00000000-0000-4000-8000-000000042810','card');
select 1 / case when (select count(*) from public.order_shipments where order_id=:'order_id')=2 then 1 else 0 end as assert_idempotent_shipments;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042801',true);
select 1 / case when (select count(*) from public.order_shipments where order_id=:'order_id')=2 and (select count(*) from public.order_shipment_items where order_id=:'order_id')=2 then 1 else 0 end as assert_owner_read;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042803',true);
select 1 / case when not exists(select 1 from public.order_shipments where order_id=:'order_id') and not exists(select 1 from public.order_shipment_items where order_id=:'order_id') then 1 else 0 end as assert_other_hidden;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042802',true);
select 1 / case when (select count(*) from public.order_shipments where order_id=:'order_id')=2 then 1 else 0 end as assert_staff_read;
reset role;
select 1 / case when not has_table_privilege('authenticated','public.order_shipments','UPDATE') and not has_table_privilege('service_role','public.order_shipments','UPDATE') and not has_function_privilege('authenticated','private.create_order_shipments(uuid)','EXECUTE') then 1 else 0 end as assert_writes_sealed;
-- Snapshot terms remain stable after catalogue/origin edits.
update public.fulfillment_origins set base_fee=base_fee+1000,name='수정된 창고' where id='00000000-0000-4000-8000-000000042201';
select 1 / case when not exists(select 1 from public.order_shipments where order_id=:'order_id' and origin_name_snapshot='수정된 창고') and (select sum(shipping_fee) from public.order_shipments where order_id=:'order_id')=(select shipping_fee from public.orders where id=:'order_id') then 1 else 0 end as assert_immutable_shipping_terms;
rollback;
