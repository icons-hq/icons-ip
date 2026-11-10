\set ON_ERROR_STOP on
begin;

-- Synthetic rows only. Run on an isolated local database after the migration.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000061201','authenticated','authenticated','sales-console-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000061202','authenticated','authenticated','sales-console-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff',nickname='sales_console_staff' where id='00000000-0000-4000-8000-000000061201';
update public.profiles set nickname='sales_console_buyer',email='sales-console-buyer@example.test' where id='00000000-0000-4000-8000-000000061202';
insert into public.fulfillment_origins(id,code,name,base_fee,return_address) values
 ('00000000-0000-4000-8000-000000061201','sales-console-test','검색 검증 출고지',0,'합성 반송 주소');
insert into public.ips(id,title,vertical_key) values('sales-console-test','검색 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('sales-console-good','sales-console-test','필터 전용 상품','문구',10000,'ok',100,'00000000-0000-4000-8000-000000061201');
insert into public.orders(id,user_id,status,total,address,created_at,confirmed_at,shipped_at,delivered_at,done_at,payment_method,expires_at) values
 ('70000000-0000-4000-8000-000000061201','00000000-0000-4000-8000-000000061202','paid',10000,'{"recipientName":"검색 수취인","phone":"010000061201"}','2026-09-01T00:00:00Z',null,null,null,null,'card',null),
 ('70000000-0000-4000-8000-000000061202','00000000-0000-4000-8000-000000061202','confirmed',30000,'{"recipientName":"검색 수취인","phone":"010000061202"}','2026-09-01T00:00:00Z','2026-09-04T15:00:00Z',null,null,null,'card',null),
 ('70000000-0000-4000-8000-000000061203','00000000-0000-4000-8000-000000061202','done',20000,'{"recipientName":"검색 수취인","phone":"010000061203"}','2026-09-02T00:00:00Z','2026-09-03T00:00:00Z','2026-09-04T00:00:00Z','2026-09-05T00:00:00Z','2026-09-14T00:00:00Z','bank_transfer',null),
 ('70000000-0000-4000-8000-000000061204','00000000-0000-4000-8000-000000061202','pending',40000,'{"recipientName":"검색 수취인"}','2026-09-03T00:00:00Z',null,null,null,null,'bank_transfer','2026-09-04T00:00:00Z'),
 ('70000000-0000-4000-8000-000000061205','00000000-0000-4000-8000-000000061202','pending',50000,'{"recipientName":"검색 수취인"}','2026-09-03T00:00:00Z',null,null,null,null,'bank_transfer','2026-09-05T00:00:00Z');
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
select '72000000-0000-4000-8000-000000061202','70000000-0000-4000-8000-000000061202','sales-console-good',id,'필터 전용 상품','문구','sales-console-test',3,10000
from public.goods_variants where good_id='sales-console-good' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values
 ('71000000-0000-4000-8000-000000061201','70000000-0000-4000-8000-000000061201','00000000-0000-4000-8000-000000061201','검색 검증 출고지',0,'{}','ready',null,null,null,null),
 ('71000000-0000-4000-8000-000000061202','70000000-0000-4000-8000-000000061202','00000000-0000-4000-8000-000000061201','검색 검증 출고지',0,'{}','ready',null,null,null,null),
 ('71000000-0000-4000-8000-000000061203','70000000-0000-4000-8000-000000061203','00000000-0000-4000-8000-000000061201','검색 검증 출고지',0,'{}','delivered','hanjin','SALESCONSOLE61203','2026-09-04T00:00:00Z','2026-09-05T00:00:00Z');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values
 ('70000000-0000-4000-8000-000000061202','71000000-0000-4000-8000-000000061202','72000000-0000-4000-8000-000000061202',3);
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,requested_at,collected_at) values
 ('73000000-0000-4000-8000-000000061201','70000000-0000-4000-8000-000000061201','00000000-0000-4000-8000-000000061202','검색 검증 요청','return','requested','2026-09-01T00:00:00Z',null),
 ('73000000-0000-4000-8000-000000061202','70000000-0000-4000-8000-000000061202','00000000-0000-4000-8000-000000061202','검색 검증 회수','return','collected','2026-09-02T00:00:00Z','2026-09-04T15:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061201',true);
select 1/case when
 (select id from public.admin_search_orders_console(p_query:='sales_console_buyer',p_field:='nickname',p_limit:=1,p_offset:=1,p_sort:='amount_high'))='70000000-0000-4000-8000-000000061204'::uuid
 and (select total_count from public.admin_search_orders_console(p_query:='sales_console_buyer',p_field:='nickname',p_limit:=1,p_offset:=1,p_sort:='amount_high'))=5
 then 1 else 0 end as order_sort_applies_before_page;
select 1/case when
 (select id from public.admin_search_orders_console(p_field:='phone',p_query:='010-0000-61202'))='70000000-0000-4000-8000-000000061202'::uuid
 and (select id from public.admin_search_orders_console(p_field:='product',p_query:='필터 전용'))='70000000-0000-4000-8000-000000061202'::uuid
 and (select count(*) from public.admin_search_orders_console(p_query:='sales_console_buyer',p_date_field:='confirmed',p_from:='2026-09-05',p_to:='2026-09-05'))=1
 and (select count(*) from public.admin_search_orders_console(p_query:='sales_console_buyer',p_date_field:='paid',p_from:='2026-09-01',p_to:='2026-09-30'))=0
 then 1 else 0 end as field_and_business_date_are_real_not_row_created_time;
select 1/case when
 (public.admin_sales_order_counts(p_query:='sales_console_buyer',p_payment_method:='bank_transfer')->>'pending')::integer=2
 and (public.admin_sales_order_counts(p_query:='sales_console_buyer',p_payment_method:='bank_transfer')->>'paid')::integer=0
 and (public.admin_sales_order_counts(p_query:='sales_console_buyer',p_payment_method:='bank_transfer')->>'done')::integer=1
 then 1 else 0 end as status_counts_share_non_status_filters;
select 1/case when
 public.admin_search_shipments_console('ready',p_query:='필터 전용',p_field:='product',p_method:='parcel')->>'total'='1'
 and public.admin_search_shipments_console('ready',p_query:='필터 전용',p_field:='product',p_method:='parcel')#>>'{rows,0,items,0,qty}'='3'
 and public.admin_search_shipments_console('delivered',p_query:='SALES-CONSOLE-61203',p_field:='tracking')#>>'{rows,0,delivery,method}'='parcel'
 and public.admin_search_shipments_console('delivered',p_query:='sales_console_buyer',p_date_field:='delivered',p_from:='2026-09-05',p_to:='2026-09-05')->>'total'='1'
 then 1 else 0 end as shipment_filters_preserve_delivery_and_quantity;
select 1/case when
 (select id from public.admin_search_order_claims_console(p_claim_type:='return',p_query:='sales_console_buyer',p_field:='buyer',p_sort:='oldest',p_limit:=1,p_offset:=1))='73000000-0000-4000-8000-000000061202'::uuid
 and (select count(*) from public.admin_search_order_claims_console(p_claim_type:='return',p_query:='sales_console_buyer',p_date_field:='collected',p_from:='2026-09-05',p_to:='2026-09-05'))=1
 and (select total from public.admin_order_claim_stage_counts_console(p_claim_type:='return',p_query:='sales_console_buyer',p_date_field:='collected',p_from:='2026-09-05',p_to:='2026-09-05') where stage='collected')=1
 and (select total from public.admin_order_claim_stage_counts_console(p_claim_type:='return',p_query:='sales_console_buyer',p_date_field:='collected',p_from:='2026-09-05',p_to:='2026-09-05') where stage='requested')=0
 then 1 else 0 end as claim_date_sort_counts_share_filters;
select 1/case when
 (select order_id from public.admin_unpaid_bank_transfer_orders_console(p_query:='sales_console_buyer',p_sort:='oldest',p_limit:=1))='70000000-0000-4000-8000-000000061204'::uuid
 and (select order_id from public.admin_unpaid_bank_transfer_orders_console(p_query:='sales_console_buyer',p_sort:='newest',p_limit:=1))='70000000-0000-4000-8000-000000061205'::uuid
 and (select count(*) from public.admin_unpaid_bank_transfer_orders_console(p_query:='sales_console_buyer',p_state:='missing'))=2
 and (select count(*) from public.admin_unpaid_bank_transfer_orders_console(p_query:='sales_console_buyer',p_state:='prepared'))=0
 then 1 else 0 end as unpaid_deadline_sort_and_state_filter;
select public.admin_create_settled_export('74000000-0000-4000-8000-000000061201',
 '{"dateField":"settled","from":"2026-09-14","to":"2026-09-14","query":"sales_console_buyer"}') as report \gset
select 1/case when public.admin_read_settled_export((:'report'::jsonb->>'id')::uuid)#>>'{filters,dateField}'='settled'
 and public.admin_read_settled_export((:'report'::jsonb->>'id')::uuid)#>>'{orders,0,id}'='70000000-0000-4000-8000-000000061203'
 then 1 else 0 end as export_captures_same_date_basis;
do $$ begin
 begin perform public.admin_search_orders_console(p_sort:='arbitrary_sql'); raise exception 'invalid sort accepted';
 exception when invalid_parameter_value then null;end;
 begin perform public.admin_search_shipments_console('ready',p_date_field:='made_up'); raise exception 'invalid date accepted';
 exception when invalid_parameter_value then null;end;
 begin perform public.admin_create_settled_export('74000000-0000-4000-8000-000000061201','{"dateField":"ordered","query":"sales_console_buyer"}'); raise exception 'receipt filters changed';
 exception when check_violation then if sqlerrm<>'settled_export_request_conflict' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000061202',true);
do $$ begin
 begin perform public.admin_search_orders_console();raise exception 'customer search bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_sales_order_counts();raise exception 'customer counts bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_search_order_claims_console();raise exception 'customer claim bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_order_claim_stage_counts_console();raise exception 'customer claim counts bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_search_shipments_console('ready');raise exception 'customer shipment bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_unpaid_bank_transfer_orders_console();raise exception 'customer unpaid bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 1/case when not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.proname in ('admin_sales_order_date','admin_sales_order_matches','admin_validate_sales_search',
  'admin_search_orders_console','admin_sales_order_counts','admin_sales_claim_date','admin_sales_claim_matches',
  'admin_search_order_claims_console','admin_order_claim_stage_counts_console','admin_search_shipments_console',
  'admin_unpaid_bank_transfer_orders_console','collect_settled_export_for_date')
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
  or (n.nspname='private' and has_function_privilege('authenticated',p.oid,'execute')))) then 1 else 0 end as search_helpers_are_sealed;
rollback;
