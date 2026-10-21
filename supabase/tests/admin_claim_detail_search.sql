\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.claim_search_id(kind text,n integer) returns uuid language sql immutable as $$
 with source as(select md5('claim-detail-search:'||kind||':'||n) value)
 select (substr(value,1,8)||'-'||substr(value,9,4)||'-4'||substr(value,14,3)||'-8'||substr(value,18,3)||'-'||substr(value,21,12))::uuid from source;
$$;
create function pg_temp.claim_search_expect(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.claim_search_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.claim_search_id('actor',n),'authenticated','authenticated','claim-detail-search-'||n||'@example.test',now(),'{}','{}' from generate_series(1,6)n;
update public.profiles set role='staff' where id in(pg_temp.claim_search_id('actor',1),pg_temp.claim_search_id('actor',5),pg_temp.claim_search_id('actor',6));
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.claim_search_id('actor',1),'primary'),(pg_temp.claim_search_id('actor',5),'deputy');
update public.profiles set nickname='claim_detail_search_buyer' where id=pg_temp.claim_search_id('actor',2);
update public.profiles set nickname='클레임검색_받는이' where id=pg_temp.claim_search_id('actor',3);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values(pg_temp.claim_search_id('origin',1),'claim-detail-search-origin','상세검색 합성 출고지',0,'합성 반송 주소');
insert into public.ips(id,title,vertical_key) values('claim-detail-search-ip','클레임 상세검색 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('claim-detail-search-product','claim-detail-search-ip','product-name-only','문구',1000,'ok',1000,pg_temp.claim_search_id('origin',1)),
 ('claim-detail-search-product-extra','claim-detail-search-ip','접두사가 같은 다른 상품','문구',1000,'ok',1000,pg_temp.claim_search_id('origin',1)),
 ('claim-detail-search-other','claim-detail-search-ip','같은 주문의 다른 상품','문구',1000,'ok',1000,pg_temp.claim_search_id('origin',1));
insert into public.goods_variants(id,good_id,name,code,attributes,price,stock_qty)
 values(pg_temp.claim_search_id('variant',1),'claim-detail-search-product','추가 합성 옵션','CLAIM-DETAIL-ALT','{"색상":"합성"}',1000,100);
insert into public.orders(id,user_id,status,total,address,created_at,delivered_at,payment_method)
 select pg_temp.claim_search_id('order',n),pg_temp.claim_search_id('actor',case when n=107 then 3 else 2 end),
 case when n=109 then 'paid'::public.order_status else 'delivered'::public.order_status end,
 case when n=1 then 3000 else 1000 end,
 case when n=104 then null when n=105 then '{}'::jsonb else jsonb_build_object('recipientName',
   case when n<=101 or n>=109 then '클레임검색_받는이' when n=102 then 'Alpha_One% literal' when n=103 then 'ALPHA_OneX wildcard' else '별도 합성 수취인' end) end,
 '2026-09-01T00:00:00Z','2026-09-12T00:00:00Z','card' from generate_series(1,112)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.claim_search_id('item',n),pg_temp.claim_search_id('order',n),g.id,v.id,1,1000,g.name,g.type,g.ip_id
 from generate_series(1,112)n
 join public.goods g on g.id=case when n<=101 or n>=109 then 'claim-detail-search-product' when n=102 then 'claim-detail-search-product-extra' else 'claim-detail-search-other' end
 join public.goods_variants v on v.good_id=g.id and v.is_default;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 values(pg_temp.claim_search_id('item',201),pg_temp.claim_search_id('order',1),'claim-detail-search-product',pg_temp.claim_search_id('variant',1),1,1000,'product-name-only','문구','claim-detail-search-ip');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.claim_search_id('item',202),pg_temp.claim_search_id('order',1),'claim-detail-search-other',v.id,1,1000,'같은 주문의 다른 상품','문구','claim-detail-search-ip'
 from public.goods_variants v where v.good_id='claim-detail-search-other' and v.is_default;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,reason_type,claim_type,stage,requested_at,collected_at,held_from,hold_reason,held_at,withdrawn_at)
 select pg_temp.claim_search_id('claim',n),pg_temp.claim_search_id('order',n),pg_temp.claim_search_id('actor',case when n=107 then 3 else 2 end),
 '상세검색 합성 요청',case when n=99 then 'defect' else 'change_of_mind' end,
 case when n=109 then 'cancel' when n=110 then 'exchange' else 'return' end,
 case when n=99 then 'collecting' when n=100 or n=110 then 'collected' when n=101 then 'on_hold' when n=111 then 'withdrawn' when n=112 then 'rejected' else 'requested' end,
 '2026-10-10T00:00:00Z'::timestamptz+n*interval '1 second',
 case when n in(100,101,110) then '2026-10-11T00:00:00Z'::timestamptz end,
 case when n=101 then 'collected' end,case when n=101 then '상세검색 합성 보류' end,case when n=101 then '2026-10-11T01:00:00Z'::timestamptz end,
 case when n=111 then '2026-10-11T01:00:00Z'::timestamptz end
 from generate_series(1,112)n;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
 select pg_temp.claim_search_id('payment',n),pg_temp.claim_search_id('actor',2),'order',pg_temp.claim_search_id('order',n),
 case when n=1 then 3000 else 1000 end,'paid','claim-search-payment-'||n,'claim-search-payment-idempotency-'||n,'toss','2026-10-02T00:00:00Z'
 from unnest(array[1,101,112])n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.claim_search_id('attempt',n),'toss',pg_temp.claim_search_id('actor',2),'order',pg_temp.claim_search_id('order',n),
 case when n=1 then 3000 else 1000 end,'KRW','approved','claim-search-attempt-'||n,'claim-search-order-'||n,'claim-search-product-'||n,pg_temp.claim_search_id('payment',n),now()+interval '1 day'
 from unnest(array[1,101,112])n;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 select pg_temp.claim_search_id('attempt',n),'confirm_approved','claim-search-payment-'||n,'claim-search-transaction-'||n,
 case when n=1 then '2026-10-01T15:00:00Z'::timestamptz else '2026-10-02T14:59:59.999999Z'::timestamptz end from unnest(array[1,101])n;
-- FIXTURE END: every statement above is synthetic and the test rolls back.
create function pg_temp.claim_search_snapshot() returns text language sql as $$
 select md5(jsonb_build_object(
  'orders',(select jsonb_agg(to_jsonb(o) order by o.id) from public.orders o where o.id in(select pg_temp.claim_search_id('order',n) from generate_series(1,112)n)),
  'claims',(select jsonb_agg(to_jsonb(c) order by c.id) from public.order_cancellation_requests c where c.id in(select pg_temp.claim_search_id('claim',n) from generate_series(1,112)n)),
  'payments',(select jsonb_agg(to_jsonb(p) order by p.id) from public.payments p where p.id in(select pg_temp.claim_search_id('payment',n) from unnest(array[1,101,112])n)),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.good_id like 'claim-detail-search-%'),
  'variants',(select jsonb_agg(to_jsonb(v) order by v.id) from public.goods_variants v where v.good_id like 'claim-detail-search-%')
 )::text);
$$;
create temp table claim_search_before as select pg_temp.claim_search_snapshot() fingerprint;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.claim_search_id('actor',1)::text,true);
do $$declare total bigint; one uuid; all_ids uuid[]; paged_ids uuid[]; counts jsonb; begin
 -- More than one page; total_count is over claims, never over joined items.
 select max(total_count) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'클레임검색_받는이',p_limit=>100);
 perform pg_temp.claim_search_assert(total=103,'recipient total across requested and terminal stages');
 select array_agg(id order by requested_at,id) into all_ids from public.order_cancellation_requests
 where id in(select pg_temp.claim_search_id('claim',n) from generate_series(1,112)n where n<=101 or n in(111,112));
 select array_agg(id order by page,seq) into paged_ids from (
  select 1 page,c.id,c.ordinality seq from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'클레임검색_받는이',p_limit=>100,p_sort=>'oldest') with ordinality c
  union all select 2,c.id,c.ordinality from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'클레임검색_받는이',p_limit=>100,p_offset=>100,p_sort=>'oldest') with ordinality c
 )pages;
 perform pg_temp.claim_search_assert(paged_ids=all_ids,'all export pages preserve the same sorted claim IDs');
 select jsonb_object_agg(c.stage,c.total) into counts from public.admin_order_claim_stage_counts_console('return',null,null,null,'클레임검색_받는이','recipient','requested') c;
 perform pg_temp.claim_search_assert(counts->>'requested'='98' and counts->>'collecting'='1' and counts->>'collected'='1'
  and counts->>'on_hold'='1' and counts->>'withdrawn'='1' and counts->>'rejected'='1','recipient counts keep withdrawn and all stages');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_stage=>'collected',p_field=>'recipient',p_query=>'클레임검색_받는이');
 perform pg_temp.claim_search_assert(total=1,'selected stage filters the recipient result');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_reason_type=>'defect',p_field=>'recipient',p_query=>'클레임검색_받는이');
 perform pg_temp.claim_search_assert(total=1,'reason intersection');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'클레임검색_받는이',p_date_field=>'paid',p_from=>'2026-10-02',p_to=>'2026-10-02');
 perform pg_temp.claim_search_assert(total=2,'paid KST range requires provider evidence after detail filtering');
 select jsonb_object_agg(c.stage,c.total) into counts from public.admin_order_claim_stage_counts_console('return',null,'2026-10-02','2026-10-02','클레임검색_받는이','recipient','paid') c;
 perform pg_temp.claim_search_assert(counts->>'requested'='1' and counts->>'on_hold'='1' and counts->>'rejected'='0','paid counts share the detail match');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'claim_detail_search_buyer');
 perform pg_temp.claim_search_assert(total=0,'missing recipient never falls back to buyer');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'recipient',p_query=>'  alpha_one%  ');
 perform pg_temp.claim_search_assert(total=1,'case-insensitive recipient contains treats percent and underscore literally');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'item',p_query=>upper(pg_temp.claim_search_id('item',1)::text));
 perform pg_temp.claim_search_assert(total=1,'complete uppercase item UUID');
 select id into one from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'order',
  p_query=>(select order_number from public.orders where id=pg_temp.claim_search_id('order',1)));
 perform pg_temp.claim_search_assert(one=pg_temp.claim_search_id('claim',1),'displayed numeric order number selects the whole claim');
 select id into one from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'item',
  p_query=>(select product_order_number from public.order_items where id=pg_temp.claim_search_id('item',1)));
 perform pg_temp.claim_search_assert(one=pg_temp.claim_search_id('claim',1),'displayed numeric product-order number selects the whole claim');
 select id into one from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'item',p_query=>right(pg_temp.claim_search_id('item',1)::text,12));
 perform pg_temp.claim_search_assert(one=pg_temp.claim_search_id('claim',1),'partial item identifier selects its whole claim');
 select count(*) into total from public.order_items where order_id=pg_temp.claim_search_id('order',1);
 perform pg_temp.claim_search_assert(total=3,'nonmatching items remain present in the selected whole order');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'item',p_query=>'not-a-uuid_%');
 perform pg_temp.claim_search_assert(total=0,'invalid UUID-shaped text is literal search, not a cast error');
 select max(total_count) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'product',p_query=>'  CLAIM-DETAIL-SEARCH-PRODUCT  ',p_limit=>100);
 perform pg_temp.claim_search_assert(total=104,'product ID contains includes prefix sibling and deduplicates matching items');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'product',p_query=>'claim-detail-search-product-extra');
 perform pg_temp.claim_search_assert(total=1,'whole product ID can narrow its longer sibling');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'product',p_query=>'product-name-only');
 perform pg_temp.claim_search_assert(total=0,'product number does not search product names or seller codes');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'product',p_query=>'%');
 perform pg_temp.claim_search_assert(total=0,'product percent is not a wildcard');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'return',p_field=>'all',p_query=>pg_temp.claim_search_id('item',1)::text);
 perform pg_temp.claim_search_assert(total=1,'all search includes item identifiers');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'cancel',p_field=>'recipient',p_query=>'클레임검색_받는이');
 perform pg_temp.claim_search_assert(total=1,'cancel uses the same detail filter');
 select count(*) into total from public.admin_search_order_claims_console(p_claim_type=>'exchange',p_field=>'product',p_query=>'claim-detail-search-product');
 perform pg_temp.claim_search_assert(total=1,'exchange uses the same product filter');
 perform pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'unknown')$q$,'invalid_claim_search');
 perform pg_temp.claim_search_expect($q$select * from public.admin_order_claim_stage_counts_console(p_field=>'unknown')$q$,'invalid_claim_search');
 perform pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'product',p_query=>repeat('a',101))$q$,'claim search query too long');
 perform pg_temp.claim_search_expect($q$select * from public.admin_order_claim_stage_counts_console(p_field=>'product',p_query=>repeat('a',101))$q$,'invalid_claim_search');
end $$;
-- Exercise the existing authenticated download audit after the exact same filter.
select public.admin_record_list_export('claims-returns',jsonb_build_object('field','item','query',pg_temp.claim_search_id('item',1),'stage','all'),3,1);
select set_config('request.jwt.claim.sub',pg_temp.claim_search_id('actor',2)::text,true);
select pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'item',p_query=>'a')$q$,'operator_capability_required');
select pg_temp.claim_search_expect($q$select * from public.admin_order_claim_stage_counts_console(p_field=>'recipient',p_query=>'받는이')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.claim_search_id('actor',5)::text,true);
select pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'product',p_query=>'claim-detail-search-product')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.claim_search_id('actor',6)::text,true);
select pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'recipient',p_query=>'받는이')$q$,'operator_capability_required');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.claim_search_id('actor',1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.claim_search_id('actor',1)::text,true);
select pg_temp.claim_search_expect($q$select * from public.admin_search_order_claims_console(p_field=>'recipient',p_query=>'받는이')$q$,'operator_capability_required');
select pg_temp.claim_search_expect($q$select * from public.admin_order_claim_stage_counts_console(p_field=>'product',p_query=>'claim-detail-search-product')$q$,'operator_capability_required');
select pg_temp.claim_search_expect($q$select public.admin_record_list_export('claims-returns','{"field":"product","query":"claim-detail-search-product"}',104,104)$q$,'operator_capability_required');
reset role;
select pg_temp.claim_search_assert((select count(*)=1 from public.audit_log where actor_id=pg_temp.claim_search_id('actor',1) and action='admin.list_export.downloaded'
 and diff->'filters'->>'field'='item' and diff->>'recordCount'='1' and diff->>'rowCount'='3'),'authenticated export preserves detail filters and whole-order counts');
select pg_temp.claim_search_assert(not has_function_privilege('anon','public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','execute')
 and not has_function_privilege('service_role','public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','execute')
 and has_function_privilege('authenticated','public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','execute'),'public list ACL remains authenticated only');
select pg_temp.claim_search_assert(not has_function_privilege('anon','private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)','execute')
 and not has_function_privilege('authenticated','private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)','execute')
 and not has_function_privilege('service_role','private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)','execute'),'private helper remains sealed');
select pg_temp.claim_search_assert((select fingerprint from claim_search_before)=pg_temp.claim_search_snapshot(),'search preserves claims, orders, payment and stock');
rollback;
