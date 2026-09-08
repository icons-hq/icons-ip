\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-4000-8000-000000042990','authenticated','authenticated','export-sku@example.test','{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000042990';
insert into public.verticals(key,label,color) values('export-sku','출고 SKU','#000000');
insert into public.ips(id,title,vertical_key) values('export-sku','출고 SKU','export-sku');
insert into public.goods(id,ip_id,name,type,price,code) values('export-sku','export-sku','옵션 상품','문구',1000,'EXPORT-429');
update public.goods_variants set name='빨강',code='000123-RED' where good_id='export-sku';
insert into public.goods_variants(good_id,name,code,price,sort_order) values('export-sku','파랑','000124-BLUE',1000,1);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
 values('50000000-0000-4000-8000-000000042990','00000000-0000-4000-8000-000000042990','confirmed',5000,3000,'{"recipientName":"출고 테스트","phone":"01000000000","postalCode":"00123","address1":"테스트 주소"}',now());
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select '50000000-0000-4000-8000-000000042990',good_id,id,1,price,'옵션 상품','문구','export-sku' from public.goods_variants where good_id='export-sku';
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values('60000000-0000-4000-8000-000000042990','50000000-0000-4000-8000-000000042990','00000000-0000-4000-8000-000000042201','김포',3000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
 select order_id,'60000000-0000-4000-8000-000000042990',id from public.order_items where order_id='50000000-0000-4000-8000-000000042990';
-- Editing live catalog codes must not rewrite the shipment's order-item SKU snapshots.
update public.goods_variants set code=code||'-NEW' where good_id='export-sku';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042990',true);
select export_columns as original_columns,updated_at as origin_stamp from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201' \gset
select 1 / case when jsonb_array_length(:'original_columns'::jsonb)=12 then 1 else 0 end as assert_default_twelve_columns_unchanged;
select public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',
 :'original_columns'::jsonb||'[{"key":"variantCode","header":"창고 SKU"}]',:'origin_stamp') as optional_stamp \gset
select public.admin_shipment_export(array['60000000-0000-4000-8000-000000042990'::uuid]) as exported \gset
select 1 / case when :'exported'::jsonb#>>'{shipments,0,columns,12,header}'='창고 SKU'
 and (select array_agg(value->>'variantCode' order by value->>'variantCode') from jsonb_array_elements(:'exported'::jsonb#>'{shipments,0,lines}'))=array['000123-RED','000124-BLUE']
 and (select count(distinct value->>'goodCode') from jsonb_array_elements(:'exported'::jsonb#>'{shipments,0,lines}'))=1
 then 1 else 0 end as assert_distinct_order_snapshot_skus_exported;
-- Optional SKU can be removed again; required columns, unknown keys, duplicates and null keys stay invalid.
select public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',:'original_columns',:'optional_stamp');
do $$ declare columns_value jsonb; invalid jsonb; stamp timestamptz; begin
 select export_columns,updated_at into columns_value,stamp from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201';
 foreach invalid in array array[
  (columns_value-0)||'[{"key":"variantCode","header":"SKU"}]',
  columns_value||'[{"key":"unknown","header":"SKU"}]',
  columns_value||'[{"key":"variantCode","header":"SKU"},{"key":"variantCode","header":"duplicate"}]',
  columns_value||'[{"key":null,"header":"SKU"}]'
 ] loop
  begin
   perform public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',invalid,stamp);
   raise exception 'invalid columns accepted';
  exception when check_violation then if sqlerrm<>'invalid_export_columns' then raise; end if;
  end;
 end loop;
end $$;
reset role;
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042990';
set local role authenticated;
do $$ begin
 perform public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201','[]',now());
 raise exception 'staff changed warehouse mapping';
exception when insufficient_privilege then null; end $$;
select 1 / case when public.admin_shipment_export(array['60000000-0000-4000-8000-000000042990'::uuid])#>>'{shipments,0,lines,0,variantCode}' in ('000123-RED','000124-BLUE') then 1 else 0 end as assert_staff_export_allowed;
reset role;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000042990';
set local role authenticated;
do $$ begin
 perform public.admin_shipment_export(array['60000000-0000-4000-8000-000000042990'::uuid]);
 raise exception 'customer exported warehouse PII';
exception when insufficient_privilege then null; end $$;
reset role;
select 1 / case when not has_function_privilege('anon','public.admin_shipment_export(uuid[])','execute')
 and not has_function_privilege('service_role','public.admin_shipment_export(uuid[])','execute')
 and not has_function_privilege('authenticated','private.valid_shipment_export_columns(jsonb)','execute') then 1 else 0 end as assert_export_acl_sealed;
rollback;
