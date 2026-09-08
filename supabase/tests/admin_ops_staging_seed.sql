\set ON_ERROR_STOP on
begin;
select set_config('app.staging_seed_enabled','admin-ops-v1',true);
create temporary table initial_seed_count as select count(*) total from public.orders where id::text like 'de100000-%';
\ir ../seeds/admin-ops-staging.sql
select 1 / case when (select total from initial_seed_count)>0
 or (select count(*) from public.orders where id::text like 'de100000-%' and status='paid')=100
 then 1 else 0 end as assert_fresh_seed_has_100_paid_orders;

-- Simulate an older seed inserted after the shipment migration: filling this gap
-- must project the existing order fee/status, never recalculate the purchase.
delete from public.order_shipments where order_id='de100000-0000-4000-8000-000000000001';
update public.goods set name='[데모] 운영팀 수정값 보존' where id='demo-goods-001';
create temporary table expected_seed_goods as select id,to_jsonb(g) payload from public.goods g where id like 'demo-goods-%';
create temporary table expected_seed_orders as select id,to_jsonb(o) payload from public.orders o where id::text like 'de100000-%';
create temporary table expected_seed_shipments as select id,to_jsonb(s) payload from public.order_shipments s where order_id::text like 'de100000-%';
create temporary table expected_seed_messages as select id,to_jsonb(m) payload from public.inquiry_messages m where id::text like 'de400000-%';
\ir ../seeds/admin-ops-staging.sql

select 1 / case when not exists(select 1 from expected_seed_goods e join public.goods g using(id) where e.payload<>to_jsonb(g))
 and not exists(select 1 from expected_seed_orders e join public.orders o using(id) where e.payload<>to_jsonb(o))
 and not exists(select 1 from expected_seed_shipments e join public.order_shipments s using(id) where e.payload<>to_jsonb(s))
 and not exists(select 1 from expected_seed_messages e join public.inquiry_messages m using(id) where e.payload<>to_jsonb(m))
 then 1 else 0 end as assert_replay_preserves_operator_edits_and_order_money;
select 1 / case when (select count(*) from public.order_shipments where order_id::text like 'de100000-%')=120
 and not exists(select 1 from public.orders o where id::text like 'de100000-%'
   and o.shipping_fee<>(select coalesce(sum(s.shipping_fee),0) from public.order_shipments s where s.order_id=o.id))
 and not exists(select 1 from public.order_items i where order_id::text like 'de100000-%'
   and (variant_id is null or origin_id_snapshot is null or not exists(select 1 from public.order_shipment_items si where si.order_item_id=i.id)))
 then 1 else 0 end as assert_seed_shipment_and_option_snapshots;
rollback;
