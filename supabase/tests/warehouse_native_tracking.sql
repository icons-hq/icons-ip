\set ON_ERROR_STOP on
\timing on
begin;
-- Entirely synthetic rollback fixtures. No warehouse/customer source rows.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000042971','authenticated','authenticated','warehouse-native@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042971';
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,export_template,is_active) values
 ('00000000-0000-4000-8000-000000042971','warehouse-native','합성 김포','hanjin',5000,60000,'wms_csv',true),
 ('00000000-0000-4000-8000-000000042972','warehouse-other','합성 다른 출고지','hanjin',3000,50000,'standard',true);
insert into public.verticals(key,label,color) values('warehouse-native','물류 회신','#000000');
insert into public.ips(id,title,vertical_key) values('warehouse-native','물류 회신','warehouse-native');
insert into public.goods(id,ip_id,name,type,price,origin_id) values
 ('warehouse-native','warehouse-native','주문 당시 이름','문구',1234,'00000000-0000-4000-8000-000000042971');
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042971',case when n=42974 then 'pending'::public.order_status else 'confirmed'::public.order_status end,
 6234,5000,'{"recipientName":"합성 받는분","phone":"01000000000","postalCode":"00123","address1":"합성 주소"}',now()
from generate_series(42971,42975) n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '50000000-0000-4000-8000-000000042971',good_id,id,1,1234,'주문 당시 이름','문구','warehouse-native'
from public.goods_variants where good_id='warehouse-native' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
select ('60000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('50000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000042971','합성 김포',5000,'{}'
from generate_series(42971,42975) n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
values('61000000-0000-4000-8000-000000042971','50000000-0000-4000-8000-000000042971','00000000-0000-4000-8000-000000042972','합성 다른 출고지',3000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
select order_id,'60000000-0000-4000-8000-000000042971',id from public.order_items where order_id='50000000-0000-4000-8000-000000042971';
-- Live catalog and policy changes cannot become historical exported prices.
update public.goods set price=9000,name='현재 이름' where id='warehouse-native';
update public.fulfillment_origins set base_fee=9999 where id='00000000-0000-4000-8000-000000042971';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042971',true);

select public.admin_shipment_export(array['60000000-0000-4000-8000-000000042971'::uuid]) as exported \gset
select 1 / case when :'exported'::jsonb#>>'{shipments,0,shippingFee}'='5000'
 and :'exported'::jsonb#>>'{shipments,0,lines,0,unitPrice}'='1234'
 and :'exported'::jsonb#>>'{shipments,0,lines,0,goodName}'='주문 당시 이름'
 then 1 else 0 end as assert_export_uses_order_and_shipment_prices;

-- Exact same tracking repeats across item lines: one dispatch, original row outcomes.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":2,"reference":"50000000-0000-4000-8000-000000042971","trackingNumber":"0012-3456-7890"},
 {"line":3,"reference":"50000000-0000-4000-8000-000000042971","trackingNumber":"001234567890"}
]') as duplicate_report \gset
select 1 / case when :'duplicate_report'::jsonb->0->>'ok'='true' and :'duplicate_report'::jsonb->0->>'dispatched'='true'
 and :'duplicate_report'::jsonb->0->>'duplicate'='false' and :'duplicate_report'::jsonb->1->>'ok'='true'
 and :'duplicate_report'::jsonb->1->>'duplicate'='true' and :'duplicate_report'::jsonb->1->>'dispatched'='false'
 and :'duplicate_report'::jsonb->1->>'line'='3'
 and (select carrier='hanjin' and tracking_number='001234567890' and status='shipping' from public.order_shipments where id='60000000-0000-4000-8000-000000042971')
 and (select status='ready' and tracking_number is null from public.order_shipments where id='61000000-0000-4000-8000-000000042971')
 then 1 else 0 end as assert_dedupe_and_selected_origin_only;

-- Conflicting rows reject the entire group; another order is still processed.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":4,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567891"},
 {"line":5,"reference":"50000000-0000-4000-8000-000000042973","trackingNumber":"001234567893"},
 {"line":6,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567892"}
]') as conflict_report \gset
select 1 / case when :'conflict_report'::jsonb->0->>'error'='conflicting_shipment_tracking'
 and :'conflict_report'::jsonb->2->>'error'='conflicting_shipment_tracking' and :'conflict_report'::jsonb->1->>'ok'='true'
 and (select status='ready' and tracking_number is null from public.order_shipments where id='60000000-0000-4000-8000-000000042972')
 then 1 else 0 end as assert_conflicts_do_not_partially_mutate;

-- Invalid sibling input is grouped before mutation, including a forged carrier.
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":7,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567891"},
 {"line":8,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567891","carrier":"post"}
]') as forged_report \gset
select 1 / case when not exists(select 1 from jsonb_array_elements(:'forged_report') where value->>'error'<>'invalid_tracking_row')
 and (select status='ready' and tracking_number is null from public.order_shipments where id='60000000-0000-4000-8000-000000042972')
 then 1 else 0 end as assert_server_carrier_and_bad_sibling_guard;
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":9,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567891"},
 {"line":10,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"bad"}
]') as malformed_report \gset
select 1 / case when not exists(select 1 from jsonb_array_elements(:'malformed_report') where value->>'error'<>'invalid_tracking_input')
 and (select status='ready' and tracking_number is null from public.order_shipments where id='60000000-0000-4000-8000-000000042972')
 then 1 else 0 end as assert_invalid_tracking_rejects_whole_group;

select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":11,"reference":"50000000-0000-4000-8000-000000099999","trackingNumber":"001234567890"},
 {"line":12,"reference":"60000000-0000-4000-8000-000000042972","trackingNumber":"001234567890"},
 {"line":13,"reference":"00042972","trackingNumber":"001234567890"},
 {"line":14,"reference":"50000000-0000-4000-8000-000000042974","trackingNumber":"001234567890"}
]') as invalid_report \gset
select 1 / case when :'invalid_report'::jsonb->0->>'error'='shipment_not_found'
 and :'invalid_report'::jsonb->1->>'error'='shipment_not_found'
 and :'invalid_report'::jsonb->2->>'error'='invalid_warehouse_order_reference'
 and :'invalid_report'::jsonb->3->>'error'='invalid_shipment_transition'
 then 1 else 0 end as assert_unknown_alien_short_and_state_rejected;

-- A whole native order UUID cannot dispatch another origin's shipment.
reset role;
update public.fulfillment_origins set export_template='wms_csv' where id='00000000-0000-4000-8000-000000042972';
set local role authenticated;
select 1 / case when public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042972','[
 {"line":15,"reference":"50000000-0000-4000-8000-000000042972","trackingNumber":"001234567890"}
]')->0->>'error'='shipment_not_found' then 1 else 0 end as assert_foreign_origin_reference_rejected;

-- 1,000 source rows still produce one idempotent shipment mutation, not 1,000 audits.
select count(*) as before_audits from public.audit_log where target='order:50000000-0000-4000-8000-000000042971' \gset
select public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971',
 (select jsonb_agg(jsonb_build_object('line',n,'reference','50000000-0000-4000-8000-000000042971','trackingNumber','001234567890')) from generate_series(2,1001) n)) as thousand_report \gset
select 1 / case when jsonb_array_length(:'thousand_report')=1000
 and (select count(*) from jsonb_array_elements(:'thousand_report') where value->>'duplicate'='true')=999
 and not exists(select 1 from jsonb_array_elements(:'thousand_report') where value->>'ok'<>'true')
 and (select count(*) from public.audit_log where target='order:50000000-0000-4000-8000-000000042971')=:'before_audits'::integer
 then 1 else 0 end as assert_thousand_rows_and_idempotent_retry;
do $$ declare payload jsonb; begin
 foreach payload in array array['[]'::jsonb,'{}'::jsonb,(select jsonb_agg('{}'::jsonb) from generate_series(1,1001))] loop
  begin
   perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971',payload);
   raise exception 'invalid batch accepted';
  exception when invalid_parameter_value then if sqlerrm<>'invalid_tracking_batch' then raise; end if; end;
 end loop;
 begin
  perform public.admin_import_warehouse_tracking_batch(null,'[{"line":1,"reference":"50000000-0000-4000-8000-000000042971","trackingNumber":"001234567890"}]');
  raise exception 'missing origin accepted';
 exception when invalid_parameter_value then if sqlerrm<>'warehouse_origin_required' then raise; end if; end;
 begin
  perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000099999','[{}]');
  raise exception 'unknown origin accepted';
 exception when no_data_found then if sqlerrm<>'warehouse_origin_not_found' then raise; end if; end;
end $$;

-- Origin configuration is server-owned and mandatory even for valid rows.
reset role;
update public.fulfillment_origins set is_active=false where id='00000000-0000-4000-8000-000000042972';
set local role authenticated;
do $$ begin
 perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042972','[{}]');
 raise exception 'inactive origin accepted';
exception when check_violation then if sqlerrm<>'warehouse_origin_inactive' then raise; end if; end $$;
reset role;
update public.fulfillment_origins set is_active=true,export_template='standard' where id='00000000-0000-4000-8000-000000042972';
set local role authenticated;
do $$ begin
 perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042972','[{}]');
 raise exception 'standard origin accepted for native reply';
exception when check_violation then if sqlerrm<>'warehouse_template_required' then raise; end if; end $$;
reset role;
update public.fulfillment_origins set export_template='wms_csv',default_carrier=null where id='00000000-0000-4000-8000-000000042972';
set local role authenticated;
do $$ begin
 perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042972','[{}]');
 raise exception 'missing carrier accepted';
exception when check_violation then if sqlerrm<>'warehouse_carrier_required' then raise; end if; end $$;
reset role;
insert into public.shipping_carriers(code,label,tracking_url_template,is_active)
values('warehouse_native_inactive','합성 비활성 택배사','https://example.test/{trackingNumber}',false);
update public.fulfillment_origins set default_carrier='warehouse_native_inactive' where id='00000000-0000-4000-8000-000000042972';
set local role authenticated;
do $$ begin
 perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042972','[{}]');
 raise exception 'inactive default carrier accepted';
exception when check_violation then if sqlerrm<>'inactive_shipping_carrier' then raise; end if; end $$;

-- Defensive ambiguity check, despite the production unique(order_id,origin_id).
-- Only this rollback transaction suspends that constraint for a synthetic case.
reset role;
alter table public.order_shipments drop constraint order_shipments_order_id_origin_id_key;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
values('62000000-0000-4000-8000-000000042975','50000000-0000-4000-8000-000000042975','00000000-0000-4000-8000-000000042971','합성 중복',5000,'{}');
set local role authenticated;
select 1 / case when public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[
 {"line":16,"reference":"50000000-0000-4000-8000-000000042975","trackingNumber":"001234567890"}
]')->0->>'error'='shipment_reference_required'
 and not exists(select 1 from public.order_shipments where order_id='50000000-0000-4000-8000-000000042975' and status<>'ready')
 then 1 else 0 end as assert_ambiguous_order_origin_never_guessed;

-- Staff can import; customers cannot import or write shipment rows directly.
reset role;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000042971';
set local role authenticated;
do $$ begin
 perform public.admin_import_warehouse_tracking_batch('00000000-0000-4000-8000-000000042971','[{}]');
 raise exception 'customer imported warehouse rows';
exception when insufficient_privilege then null; end $$;
do $$ begin
 update public.order_shipments set tracking_number='999999999999',carrier='hanjin' where id='60000000-0000-4000-8000-000000042971';
 raise exception 'customer mutated shipment directly';
exception when insufficient_privilege then null; end $$;
reset role;
select 1 / case when not has_function_privilege('anon','public.admin_import_warehouse_tracking_batch(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_import_warehouse_tracking_batch(uuid,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_import_warehouse_tracking_batch(uuid,jsonb)','execute')
 then 1 else 0 end as assert_native_import_acl_sealed;
rollback;
