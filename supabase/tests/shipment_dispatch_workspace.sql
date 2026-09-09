\set ON_ERROR_STOP on
\timing on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000042989','authenticated','authenticated','dispatch-sql@example.test','{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000042989';
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at) select
 ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000042989','confirmed',10000,3000,'{"recipientName":"배송 테스트","phone":"01000000000","postalCode":"00123","address1":"테스트 주소"}',now() from generate_series(1,1000) n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) select
 ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042201','김포',3000,'{}' from generate_series(1,1000) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042989',true);
select 1 / case when public.admin_search_shipments('ready',null,'50000000',null,null,100,0)->>'total'='1000'
 and jsonb_array_length(public.admin_search_shipments('ready',null,'50000000',null,null,100,900)->'rows')=100
 and public.admin_search_shipments('ready','00000000-0000-4000-8000-000000042202','50000000')->>'total'='0'
 then 1 else 0 end as assert_directory_origin_filter_and_paging;
-- Header order and names belong to the selected warehouse and preserve staff/admin ACLs.
select updated_at as origin_stamp from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201' \gset
select public.admin_save_origin_export_columns('00000000-0000-4000-8000-000000042201',
 (select jsonb_agg(jsonb_build_object('key',value->>'key','header','창고 '||(value->>'header')) order by position desc) from public.fulfillment_origins origin,jsonb_array_elements(origin.export_columns) with ordinality x(value,position) where origin.id='00000000-0000-4000-8000-000000042201'),:'origin_stamp');
select 1 / case when (select export_columns->0->>'key' from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201')='carrier' then 1 else 0 end as assert_warehouse_column_order;
-- Mixed aliases in one upload must not overwrite the first successful tracking row.
select public.admin_import_shipment_tracking_batch('[{"line":1,"reference":"60000000-0000-4000-8000-000000000001","carrier":"hanjin","trackingNumber":"100000001"},{"line":2,"reference":"50000000-0000-4000-8000-000000000001","carrier":"hanjin","trackingNumber":"100000002"},{"line":3,"reference":"missing","carrier":"hanjin","trackingNumber":"100000003"}]') as partial_report \gset
select 1 / case when :'partial_report'::jsonb->0->>'ok'='true' and :'partial_report'::jsonb->1->>'error'='duplicate_shipment_reference' and :'partial_report'::jsonb->2->>'ok'='false' then 1 else 0 end as assert_row_partial_success_and_alias_collision;
select public.admin_import_shipment_tracking_batch((select jsonb_agg(jsonb_build_object('line',n,'reference','60000000-0000-4000-8000-'||lpad(n::text,12,'0'),'carrier','hanjin','trackingNumber',lpad(n::text,12,'0'))) from generate_series(1,1000) n)) as batch_result \gset
select 1 / case when jsonb_array_length(:'batch_result'::jsonb)=1000
 and not exists(select 1 from jsonb_array_elements(:'batch_result'::jsonb) where value->>'ok'<>'true')
 and (select count(*) from public.order_shipments where id::text like '60000000-%' and status='shipping')=1000
 then 1 else 0 end as assert_thousand_tracking_rows;
select public.admin_complete_shipments(array(select id from public.order_shipments where id::text like '60000000-%')) as complete_result \gset
select 1 / case when jsonb_array_length(:'complete_result'::jsonb)=1000 and not exists(select 1 from jsonb_array_elements(:'complete_result'::jsonb) where value->>'ok'<>'true') then 1 else 0 end as assert_thousand_delivery_completions;
reset role;
select 1 / case when not has_function_privilege('anon','public.admin_shipment_export(uuid[])','execute') and not has_function_privilege('service_role','public.admin_import_shipment_tracking_batch(jsonb)','execute') then 1 else 0 end as assert_export_and_mutation_acl;
rollback;
