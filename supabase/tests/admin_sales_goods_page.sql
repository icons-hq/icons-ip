\set ON_ERROR_STOP on
-- Run only in an approved isolated database. Every fixture rolls back.
begin;
set local timezone='UTC';
do $$begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    raise exception 'Run sales goods authorization tests without the legacy fixture helper';
  end if;
end $$;
create function pg_temp.sg_id(kind integer,n integer) returns uuid language sql immutable as $$
  select ('a6c014'||lpad(kind::text,2,'0')||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.sg_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Sales goods assertion: %',label;end if;end $$;
create function pg_temp.sg_expect(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement;exception when others then if sqlstate=expected then return;end if;raise;end;
  raise exception 'Expected SQLSTATE % from %',expected,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.sg_id(0,n),'authenticated','authenticated','sales-goods-'||n||'@example.test',now(),
  '{"testFixture":"sales-goods"}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role='staff' where id in(select pg_temp.sg_id(0,n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (pg_temp.sg_id(0,1),'primary'),(pg_temp.sg_id(0,2),'deputy');
insert into public.ips(id,title,vertical_key) values
  ('sg-qa-page','순위 검증 IP','character'),('sg-qa-other','다른 검증 IP','character'),('sg-qa-large','대량 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
select 'sg-qa-'||lpad(n::text,3,'0'),'sg-qa-page','현재 상품명 '||n,'문구',1000,'ok',100 from generate_series(1,45)n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
select 'sg-qa-large-'||lpad(n::text,5,'0'),'sg-qa-large','대량 순위 검증 '||n,'문구',1000,'ok',100 from generate_series(1,10001)n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('sg-qa-other','sg-qa-other','다른 IP 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,discount_total,store_credit_total,created_at)
select pg_temp.sg_id(1,n),pg_temp.sg_id(0,4),
  (case n when 2 then 'confirmed' when 3 then 'shipping' when 4 then 'delivered' when 5 then 'done'
    when 9 then 'pending' when 10 then 'canceled' when 11 then 'canceled' else 'paid' end)::public.order_status,
  case n when 1 then 46500 when 6 then 500 when 12 then 10001000 else 1000 end,
  case when n=1 then 3000 else 0 end,case when n=1 then 1000 else 0 end,case when n=1 then 500 else 0 end,
  case n when 1 then '2026-10-01T00:00:00+09:00'::timestamptz
    when 6 then '2026-10-01T23:59:59.999999+09:00'::timestamptz
    when 7 then '2026-09-30T23:59:59.999999+09:00'::timestamptz
    when 8 then '2026-10-02T00:00:00+09:00'::timestamptz
    else '2026-10-01T12:00:00+09:00'::timestamptz end
from generate_series(1,13)n;
-- Goods refunds finish as canceled orders plus a refunded payment and done ledger.
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
values(pg_temp.sg_id(2,11),pg_temp.sg_id(0,4),'order',pg_temp.sg_id(1,11),1000,'refunded',
  'sales-goods-refunded-payment','sales-goods-refunded-key','toss','2026-10-01T12:00:00+09:00');
insert into public.refunds(payment_id,amount,reason,status)
values(pg_temp.sg_id(2,11),1000,'순위 환불 제외 검증','done');
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sg_id(1,1),g.id,case when g.id='sg-qa-045' then 2 else 1 end,
  case when g.id='sg-qa-045' then 500 else 1000 end,'주문 당시 '||g.id,'문구','sg-qa-page',v.id
from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default
where g.ip_id='sg-qa-page';
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sg_id(1,n),case when n=6 then 'sg-qa-002' else 'sg-qa-001' end,1,
  case when n=6 then 500 when n>=7 then 99000 else 1000 end,
  case when n=6 then '주문 당시 sg-qa-002' else '주문 당시 sg-qa-001' end,'문구','sg-qa-page',v.id
from generate_series(2,11)n join public.goods_variants v
  on v.good_id=case when n=6 then 'sg-qa-002' else 'sg-qa-001' end and v.is_default;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sg_id(1,12),g.id,1,1000,g.name,'문구',g.ip_id,v.id
from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.ip_id='sg-qa-large';
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sg_id(1,13),'sg-qa-other',1,1000,'다른 IP 스냅샷','문구','sg-qa-other',id
from public.goods_variants where good_id='sg-qa-other' and is_default;
-- A current catalog change cannot rewrite the historical IP/name snapshots.
update public.goods set name='변경된 이름',ip_id='sg-qa-other' where id='sg-qa-001';
create temp table sg_before as select
  pg_get_functiondef('public.admin_sales_report(timestamptz,timestamptz,text)'::regprocedure) report_definition,
  (select count(*) from public.audit_log) audit_count;

select pg_temp.sg_assert(
  has_function_privilege('authenticated','public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)','execute')
  and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid='public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'execute ACL is authenticated-only');
select pg_temp.sg_assert(exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where p.oid='public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)'::regprocedure
    and p.provolatile='s' and p.prosecdef and c.capability='stats.read' and c.guard_kind='read'
    and not c.legacy_admin_only and c.body_md5=md5(p.prosrc)),'stable read RPC registered');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,1)::text,true);
do $$declare page jsonb; old jsonb; filtered jsonb; query text;begin
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page');
  old:=public.admin_sales_report('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page');
  perform pg_temp.sg_assert(page->>'totalCount'='45' and page->>'page'='1' and jsonb_array_length(page->'rows')=20,'whole count differs from first page');
  perform pg_temp.sg_assert((select jsonb_agg(value-'rank' order by (value->>'rank')::integer) from jsonb_array_elements(page->'rows'))=old->'goods','exact existing TOP20 rows and arithmetic');
  perform pg_temp.sg_assert(page#>>'{rows,0,goodId}'='sg-qa-001' and page#>>'{rows,0,revenue}'='5000'
    and page#>>'{rows,0,qty}'='5' and page#>>'{rows,0,name}'='주문 당시 sg-qa-001'
    and page#>>'{rows,0,ipId}'='sg-qa-page','all five revenue statuses and order snapshots');
  perform pg_temp.sg_assert(page#>>'{rows,1,goodId}'='sg-qa-002' and page#>>'{rows,1,revenue}'='1500'
    and page#>>'{rows,2,goodId}'='sg-qa-045' and page#>>'{rows,3,goodId}'='sg-qa-003','revenue then qty then ID tie order; just-before-to included');
  perform pg_temp.sg_assert((page->>'asOf')::timestamptz=statement_timestamp(),'one statement snapshot time');
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page',2);
  perform pg_temp.sg_assert(page->>'totalCount'='45' and page#>>'{rows,0,rank}'='21'
    and page#>>'{rows,0,goodId}'='sg-qa-020' and jsonb_array_length(page->'rows')=20,'second page begins at rank 21 without a tie duplicate');
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page',2147483647);
  perform pg_temp.sg_assert(page->>'page'='3' and jsonb_array_length(page->'rows')=5
    and page#>>'{rows,4,goodId}'='sg-qa-044' and page#>>'{rows,4,rank}'='45','out-of-range page clamps to actual last page without overflow');
  foreach query in array array['','missing-ip'] loop
    page:=public.admin_sales_goods_page('2026-10-03T00:00:00+09:00','2026-10-04T00:00:00+09:00',query,999);
    perform pg_temp.sg_assert(page->>'totalCount'='0' and page->>'page'='1' and page->'rows'='[]'::jsonb,'zero rows have zero count and first page');
  end loop;
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','  sg-qa-other  ',1,50);
  perform pg_temp.sg_assert(page->>'totalCount'='1' and page#>>'{rows,0,goodId}'='sg-qa-other','trimmed IP is historical item filter, not current catalog filter');
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page',1,10001);
  perform pg_temp.sg_assert(jsonb_array_length(page->'rows')=45
    and (select sum((value->>'revenue')::integer) from jsonb_array_elements(page->'rows'))=49500,'all goods preserve gross item value before shipping, discounts and credit');
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-large',1,10001);
  perform pg_temp.sg_assert(page->>'totalCount'='10001' and jsonb_array_length(page->'rows')=10001
    and page#>>'{rows,10000,rank}'='10001','scalar JSON passes 1000 rows and retains explicit export sentinel');
  page:=public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-large',101,100);
  perform pg_temp.sg_assert(page->>'totalCount'='10001' and jsonb_array_length(page->'rows')=1 and page#>>'{rows,0,rank}'='10001','last large page count and final rank');
  perform pg_temp.sg_assert(extract(epoch from ('2025-03-01T00:00:00+09:00'::timestamptz-'2024-02-28T00:00:00+09:00'::timestamptz))/86400=367, 'previous-year derived range really spans 367 days');
  perform pg_temp.sg_assert(public.admin_sales_goods_page('2024-02-28T00:00:00+09:00','2025-03-01T00:00:00+09:00','sg-qa-page',1,10001)->>'totalCount'='0', '366-day selection may derive a valid 367-day year comparison');
  foreach query in array array[
    $q$select public.admin_sales_goods_page(null,'2026-10-02')$q$,
    $q$select public.admin_sales_goods_page('2026-10-01',null)$q$,
    $q$select public.admin_sales_goods_page('-infinity','2026-10-02')$q$,
    $q$select public.admin_sales_goods_page('2026-10-01','infinity')$q$,
    $q$select public.admin_sales_goods_page('2026-10-02','2026-10-02')$q$,
    $q$select public.admin_sales_goods_page('2026-01-01','2027-01-03 00:00:00.000001')$q$,
    $q$select public.admin_sales_goods_page('2026-10-01','2026-10-02',p_page:=null)$q$,
    $q$select public.admin_sales_goods_page('2026-10-01','2026-10-02',p_page:=0)$q$,
    $q$select public.admin_sales_goods_page('2026-10-01','2026-10-02',p_page_size:=null)$q$,
    $q$select public.admin_sales_goods_page('2026-10-01','2026-10-02',p_page_size:=10000)$q$
  ] loop perform pg_temp.sg_expect(query,'22023');end loop;
end $$;
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,2)::text,true);
select pg_temp.sg_expect($q$select public.admin_sales_goods_page('2026-10-01','2026-10-02')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,3)::text,true);
select pg_temp.sg_expect($q$select public.admin_sales_goods_page('2026-10-01','2026-10-02')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,4)::text,true);
select pg_temp.sg_expect($q$select public.admin_sales_goods_page('2026-10-01','2026-10-02')$q$,'42501');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.sg_id(0,1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,1)::text,true);
select pg_temp.sg_expect($q$select public.admin_sales_goods_page('2026-10-01','2026-10-02')$q$,'42501');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.sg_id(0,1);
select pg_temp.sg_assert((select report_definition=pg_get_functiondef('public.admin_sales_report(timestamptz,timestamptz,text)'::regprocedure)
  and audit_count=(select count(*) from public.audit_log) from sg_before),'existing report and audit remain unchanged');
set local transaction_read_only=on;
set local timezone='America/New_York';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sg_id(0,1)::text,true);
select pg_temp.sg_assert(public.admin_sales_goods_page('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00','sg-qa-page')->>'totalCount'='45','real read-only transaction and session timezone independence');
reset role;
rollback;
