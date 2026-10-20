\set ON_ERROR_STOP on
begin;
load 'safeupdate';
-- Explicit operator memberships and synthetic data; no legacy fixture bypass.
create function pg_temp.sales_gap_id(kind text,n integer) returns uuid language sql immutable as $$
 with source as(select md5('sales-read-gap:'||kind||':'||n) value)
 select (substr(value,1,8)||'-'||substr(value,9,4)||'-4'||substr(value,14,3)||'-8'||substr(value,18,3)||'-'||substr(value,21,12))::uuid from source;
$$;
create function pg_temp.sales_gap_expect(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.sales_gap_id('actor',n),'authenticated','authenticated','sales-gap-'||n||'@example.test',now(),'{}','{}' from generate_series(1,6)n;
update public.profiles set role='staff' where id in(pg_temp.sales_gap_id('actor',1),pg_temp.sales_gap_id('actor',5),pg_temp.sales_gap_id('actor',6));
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.sales_gap_id('actor',1),'primary'),(pg_temp.sales_gap_id('actor',5),'primary'),(pg_temp.sales_gap_id('actor',6),'deputy');
update public.profiles set nickname='sales_read_gap_buyer',email='sales-read-gap-buyer@example.test' where id=pg_temp.sales_gap_id('actor',2);
update public.profiles set nickname='GAP1530 구매자',email='sales-read-gap-other@example.test' where id=pg_temp.sales_gap_id('actor',3);
update public.profiles set nickname='검색 이메일 고객',email='GAP1530@example.test' where id=pg_temp.sales_gap_id('actor',4);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,default_carrier)
 values(pg_temp.sales_gap_id('origin',1),'sales-read-gap-origin','조회 조건 합성 출고지',0,'합성 반송 주소','hanjin');
insert into public.ips(id,title,vertical_key) values('sales-read-gap-ip','조회 조건 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('sales-read-gap-good','sales-read-gap-ip','조회 조건 합성 상품','문구',1000,'ok',100,pg_temp.sales_gap_id('origin',1));
insert into public.goods_variants(id,good_id,name,code,attributes,price,stock_qty)
 values(pg_temp.sales_gap_id('variant',1),'sales-read-gap-good','GAP1530 옵션','GAP1530','{"색상":"합성"}',1000,10);
insert into public.orders(id,user_id,status,total,address,created_at,confirmed_at,shipped_at,delivered_at,done_at,payment_method)
 select pg_temp.sales_gap_id('order',n),pg_temp.sales_gap_id('actor',2),'delivered',1000,
 jsonb_build_object('recipientName','클레임 합성 수취인','phone','01000001530','postalCode','12345','address1','합성시 검증로 1530'),
 '2026-09-01T00:00:00Z','2026-09-10T00:00:00Z','2026-09-11T00:00:00Z','2026-09-12T00:00:00Z',null,
 case when n=6 then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end
 from generate_series(1,34)n where n<>10;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
 select pg_temp.sales_gap_id('payment',n),pg_temp.sales_gap_id('actor',2),'order',pg_temp.sales_gap_id('order',n),1000,'paid',
 'sales-gap-payment-'||n,'sales-gap-payment-idempotency-'||n,
 case when n=6 then 'bank_transfer'::public.payment_provider else 'toss'::public.payment_provider end,'2026-10-02T00:00:00Z'
 from generate_series(1,34)n where n<>10;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.sales_gap_id('attempt',n),case when n=6 then 'bank_transfer'::public.payment_provider else 'toss'::public.payment_provider end,
 pg_temp.sales_gap_id('actor',2),'order',pg_temp.sales_gap_id('order',n),1000,'KRW','approved','sales-gap-attempt-'||n,
 'sales-gap-order-'||n,'sales-gap-product-'||n,pg_temp.sales_gap_id('payment',n),now()+interval '1 day'
 from generate_series(1,34)n where n<>10;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 select pg_temp.sales_gap_id('attempt',n),'confirm_approved','sales-gap-payment-'||n,'sales-gap-transaction-'||n,
 case n when 1 then '2026-10-01T15:00:00Z'::timestamptz when 2 then '2026-10-02T14:59:59.999999Z'::timestamptz
 when 3 then '2026-10-01T14:59:59.999999Z'::timestamptz when 4 then '2026-10-02T15:00:00Z'::timestamptz
 when 7 then null when 8 then '2026-10-01T15:00:00Z'::timestamptz when 9 then '2026-09-20T00:00:00Z'::timestamptz
 else '2026-10-02T02:00:00Z'::timestamptz + n*interval '1 minute' end
 from generate_series(1,34)n where n not in(5,6,10);
insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo)
 values(pg_temp.sales_gap_id('order',6),pg_temp.sales_gap_id('attempt',6),pg_temp.sales_gap_id('actor',1),'2026-10-02T01:00:00Z','합성 입금 확인 근거');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,requested_at,collected_at,held_from,hold_reason,held_at)
 select pg_temp.sales_gap_id('claim',n),pg_temp.sales_gap_id('order',n),pg_temp.sales_gap_id('actor',2),'합성 검색 검증 요청',
 case when n in(1,5,7) then 'cancel' when n in(4,6) then 'exchange' else 'return' end,
 case when n=2 then 'collected' when n=6 then 'on_hold' else 'requested' end,
 '2026-10-10T00:00:00Z'::timestamptz-n*interval '1 minute',case when n in(2,6) then '2026-10-11T00:00:00Z'::timestamptz end,
 case when n=6 then 'collected' end,case when n=6 then '합성 교환 입고 검토' end,case when n=6 then '2026-10-11T01:00:00Z'::timestamptz end
 from generate_series(1,34)n where n<>10;
insert into public.orders(id,user_id,status,total,address,created_at,confirmed_at,shipped_at,delivered_at,done_at,payment_method)
 select pg_temp.sales_gap_id('order',n),pg_temp.sales_gap_id('actor',case n when 102 then 3 when 107 then 4 else 2 end),'done',1000,
 jsonb_build_object('recipientName',case when n=101 then 'GAP1530 수취인' else '검색용 별도 수취인' end,
  'phone',case when n=105 then '01015301234' else '01000001530' end,'postalCode','12345','address1','합성시 검증로 1530'),
 '2026-09-15T00:00:00Z'::timestamptz+n*interval '1 minute','2026-09-16T00:00:00Z','2026-09-17T00:00:00Z','2026-09-18T00:00:00Z','2026-10-02T01:00:00Z','card'
 from generate_series(101,108)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price,variant_name_snapshot,variant_code_snapshot)
 select pg_temp.sales_gap_id('item',n),pg_temp.sales_gap_id('order',n),'sales-read-gap-good',v.id,
 case when n=103 then 'GAP1530 상품명' else '조회 조건 합성 상품' end,'문구','sales-read-gap-ip',1,1000,
 case when n=106 then 'GAP1530 옵션' else '기본 옵션' end,case when n=106 then 'GAP1530' else 'NORMAL1530' end
 from generate_series(101,108)n cross join public.goods_variants v where v.good_id='sales-read-gap-good' and v.is_default=(n<>106);
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.sales_gap_id('shipment',n),pg_temp.sales_gap_id('order',n),pg_temp.sales_gap_id('origin',1),'조회 조건 합성 출고지',0,'{}','delivered','hanjin',
 case when n=104 then 'GAP1530000' else 'GAPSHIP'||n end,'2026-09-17T00:00:00Z','2026-09-18T00:00:00Z' from generate_series(101,108)n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
 select pg_temp.sales_gap_id('order',n),pg_temp.sales_gap_id('shipment',n),pg_temp.sales_gap_id('item',n),1 from generate_series(101,108)n;
-- FIXTURE END: concurrency and browser QA reuse only the synthetic setup above.
create temp table sales_gap_claim_before as select id,to_jsonb(c) original from public.order_cancellation_requests c where requested_by=pg_temp.sales_gap_id('actor',2);
create temp table sales_gap_money_before as select id,total,shipping_fee,discount_total,store_credit_total from public.orders where id in(select pg_temp.sales_gap_id('order',n) from generate_series(1,108)n);
create temp table sales_gap_payment_before as select id,to_jsonb(p) original from public.payments p where id in(select pg_temp.sales_gap_id('payment',n) from generate_series(1,34)n);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sales_gap_id('actor',1)::text,true);
select 1/case when
 (select count(*) from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=100))=28
 and (select sum(total) from public.admin_order_claim_stage_counts_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02'))=28
 and (select total from public.admin_order_claim_stage_counts_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02')where stage='on_hold')=1
 and (select count(*) from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='requested',p_from:='2026-10-02',p_to:='2026-10-02'))=0
 then 1 else 0 end as paid_kst_boundaries_and_counts_use_approval_events;
select 1/case when
 (select count(*) from public.admin_search_order_claims_console(p_claim_type:='cancel',p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02'))=1
 and (select count(*) from public.admin_search_order_claims_console(p_claim_type:='exchange',p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02'))=1
 and not exists(select 1 from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=100)
  where id in(pg_temp.sales_gap_id('claim',3),pg_temp.sales_gap_id('claim',4),pg_temp.sales_gap_id('claim',5),pg_temp.sales_gap_id('claim',7)))
 then 1 else 0 end as bank_confirmation_and_missing_proof_dates;
select 1/case when
 (select id from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=1,p_sort:='newest'))=pg_temp.sales_gap_id('claim',2)
 and (select id from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=1,p_sort:='oldest'))=
  least(pg_temp.sales_gap_id('claim',1),pg_temp.sales_gap_id('claim',8))
 and (select count(*) from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=20,p_offset:=20))=8
 and (select min(total_count) from public.admin_search_order_claims_console(p_query:='sales_read_gap_buyer',p_date_field:='paid',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=20,p_offset:=20))=28
 then 1 else 0 end as paid_sort_precedes_page_and_keeps_id_ties;
select pg_temp.sales_gap_expect($q$select public.admin_search_order_claims_console(p_date_field:='providerPayout')$q$,'invalid_claim_search');
select pg_temp.sales_gap_expect($q$select public.admin_order_claim_stage_counts_console(p_date_field:='providerPayout')$q$,'invalid_claim_search');
-- The same needle appears in different source fields. Each export must match
-- the corresponding list exactly, including product snapshots and normalized phones.
do $$ declare field text;needle text;expected jsonb;receipt jsonb;payload jsonb;index integer:=0;begin
 foreach field in array array['all','recipient','nickname','email','tracking','product','phone','order'] loop
  index:=index+1;
  needle:=case field when 'phone' then '010-1530-1234' when 'order' then pg_temp.sales_gap_id('order',108)::text else 'GAP1530' end;
  select coalesce(jsonb_agg(id::text order by id),'[]') into expected
   from public.admin_search_orders_console(p_status:='done',p_field:=field,p_query:=needle,p_date_field:='settled',p_from:='2026-10-02',p_to:='2026-10-02',p_limit:=100);
  receipt:=public.admin_create_settled_export(pg_temp.sales_gap_id('export',index),jsonb_build_object('field',field,'query',needle,'dateField','settled','from','2026-10-02','to','2026-10-02'));
  payload:=public.admin_read_settled_export((receipt->>'id')::uuid);
  if expected<>(select jsonb_agg(value->>'id' order by value->>'id') from jsonb_array_elements(payload->'orders'))
   or (receipt->>'orderCount')::integer<>jsonb_array_length(expected)
   or coalesce(payload#>>'{filters,field}','all')<>field then raise exception 'List/export field mismatch: %',field;end if;
 end loop;
end $$;
select 1/case when
 (select count(*) from public.admin_search_orders_console(p_status:='done',p_field:='all',p_query:='GAP1530'))=6
 and (select count(*) from public.admin_search_orders_console(p_status:='done',p_field:='recipient',p_query:='GAP1530'))=1
 and (select count(*) from public.admin_search_orders_console(p_status:='done',p_field:='product',p_query:='GAP1530'))=2
 then 1 else 0 end as mixed_field_fixtures_actually_require_field_selection;
select public.admin_create_settled_export(pg_temp.sales_gap_id('export',20),'{"query":"GAP1530"}')->>'id' as legacy_receipt \gset
select 1/case when public.admin_create_settled_export(pg_temp.sales_gap_id('export',20),'{"field":"all","query":"GAP1530"}')->>'id'=:'legacy_receipt'
 then 1 else 0 end as legacy_all_filter_replays_existing_receipt;
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',20),'{"field":"recipient","query":"GAP1530"}'),'settled_export_request_conflict');
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',21),'{"field":"made_up","query":"GAP1530"}'),'settled_export_invalid_filters');
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',21),'{"field":["recipient","all"],"query":"GAP1530"}'),'settled_export_invalid_filters');
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',21),'{"field":"recipient","query":"no-such-recipient"}'),'settled_export_empty');
select public.admin_create_settled_export(pg_temp.sales_gap_id('export',22),'{"field":"recipient","query":"GAP1530"}')->>'id' as frozen_receipt \gset
select set_config('test.sales_gap_receipt',:'frozen_receipt',true);
reset role;
update public.orders set address=jsonb_set(address,'{recipientName}','"현재 수취인 수정"') where id=pg_temp.sales_gap_id('order',101);
set local role authenticated;
select 1/case when
 (select count(*) from public.admin_search_orders_console(p_status:='done',p_field:='recipient',p_query:='GAP1530'))=0
 and public.admin_create_settled_export(pg_temp.sales_gap_id('export',22),'{"field":"recipient","query":"GAP1530"}')->>'id'=:'frozen_receipt'
 and public.admin_read_settled_export(:'frozen_receipt')#>>'{orders,0,id}'=pg_temp.sales_gap_id('order',101)::text
 then 1 else 0 end as response_loss_replay_keeps_frozen_selection;
select set_config('request.jwt.claim.sub',pg_temp.sales_gap_id('actor',5)::text,true);
select pg_temp.sales_gap_expect(format('select public.admin_read_settled_export(%L)',current_setting('test.sales_gap_receipt')),'settled_export_not_found');
select set_config('request.jwt.claim.sub',pg_temp.sales_gap_id('actor',6)::text,true);
select pg_temp.sales_gap_expect($q$select public.admin_search_order_claims_console(p_date_field:='paid')$q$,'42501');
select pg_temp.sales_gap_expect($q$select public.admin_order_claim_stage_counts_console(p_date_field:='paid')$q$,'42501');
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',30),'{"field":"tracking","query":"GAP1530"}'),'42501');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.sales_gap_id('actor',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sales_gap_id('actor',1)::text,true);
select pg_temp.sales_gap_expect(format('select public.admin_create_settled_export(%L,%L)',pg_temp.sales_gap_id('export',22),'{"field":"recipient","query":"GAP1530"}'),'42501');
select pg_temp.sales_gap_expect(format('select public.admin_read_settled_export(%L)',current_setting('test.sales_gap_receipt')),'42501');
reset role;
select 1/case when
 not has_function_privilege('anon','private.collect_settled_export_for_search(date,date,text,text,text)','execute')
 and not has_function_privilege('authenticated','private.collect_settled_export_for_search(date,date,text,text,text)','execute')
 and not has_function_privilege('service_role','private.collect_settled_export_for_search(date,date,text,text,text)','execute')
 and has_function_privilege('postgres','private.collect_settled_export_for_search(date,date,text,text,text)','execute')
 and not has_function_privilege('anon','public.admin_create_settled_export(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_create_settled_export(uuid,jsonb)','execute')
 and (select pg_get_userbyid(proowner)='postgres' from pg_proc where oid='public.admin_create_settled_export(uuid,jsonb)'::regprocedure)
 then 1 else 0 end as private_collector_is_sealed_but_existing_postgres_definer_can_execute;
select 1/case when not exists(select 1 from sales_gap_claim_before before join public.order_cancellation_requests c using(id)where before.original<>to_jsonb(c))
 and not exists(select 1 from sales_gap_payment_before before join public.payments p using(id)where before.original<>to_jsonb(p))
 and not exists(select 1 from sales_gap_money_before before join public.orders o using(id)
  where (before.total,before.shipping_fee,before.discount_total,before.store_credit_total) is distinct from (o.total,o.shipping_fee,o.discount_total,o.store_credit_total))
 and (select count(*) from public.audit_log where actor_id=pg_temp.sales_gap_id('actor',1) and action='admin.settled_export.created')=10
 then 1 else 0 end as search_and_export_preserve_claims_and_money_with_one_audit_per_receipt;
rollback;
