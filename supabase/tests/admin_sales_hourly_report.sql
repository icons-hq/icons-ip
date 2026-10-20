\set ON_ERROR_STOP on
-- DRAFT regression suite: approved isolated databases only, fixtures roll back.
begin;
set local timezone='UTC';
do $$begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    raise exception 'Run hourly authorization tests without the legacy fixture helper';
  end if;
end $$;
create function pg_temp.sh_id(kind integer,n integer) returns uuid language sql immutable as $$
  select ('a7c014'||lpad(kind::text,2,'0')||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.sh_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Hourly sales assertion: %',label;end if;end $$;
create function pg_temp.sh_expect(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement;exception when others then if sqlstate=expected then return;end if;raise;end;
  raise exception 'Expected SQLSTATE % from %',expected,statement;
end $$;
create temp table sh_clock as select
  (statement_timestamp() at time zone 'Asia/Seoul')::date as day,
  date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as starts_at,
  date_trunc('hour',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as cutoff;
alter table sh_clock add column comparison date;
update sh_clock set comparison=day-7;
grant select on sh_clock to authenticated;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.sh_id(0,n),'authenticated','authenticated','sales-hourly-'||n||'@example.test',now(),
  '{"testFixture":"sales-hourly"}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role='staff' where id in(select pg_temp.sh_id(0,n) from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (pg_temp.sh_id(0,1),'primary'),(pg_temp.sh_id(0,2),'deputy');
create temp table sh_results(label text primary key,value jsonb);
grant select,insert on sh_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,1)::text,true);
insert into sh_results select 'baseline',public.admin_sales_hourly_report(comparison,'sh-qa-one',cutoff) from sh_clock;
reset role;

insert into public.ips(id,title,vertical_key) values('sh-qa-one','시간대 검증 IP','character'),('sh-qa-other','시간대 다른 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
select 'sh-qa-'||lpad(n::text,2,'0'),'sh-qa-one','현재 상품명 '||n,'문구',1000,'ok',100 from generate_series(1,13)n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('sh-qa-other','sh-qa-other','혼합 IP 상품','문구',3000,'ok',100);
-- 1,001 independent orders in the last complete hour, even at KST midnight.
insert into public.orders(id,user_id,status,total,created_at)
select pg_temp.sh_id(1,n),pg_temp.sh_id(0,4),'paid',1000,c.cutoff-interval '30 minutes'
from generate_series(1,1001)n cross join sh_clock c;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sh_id(1,n),'sh-qa-01',1,1000,'주문 당시 상품 01','문구','sh-qa-one',v.id
from generate_series(1,1001)n cross join public.goods_variants v where v.good_id='sh-qa-01' and v.is_default;
insert into public.orders(id,user_id,status,total,shipping_fee,discount_total,store_credit_total,created_at)
select pg_temp.sh_id(2,n),pg_temp.sh_id(0,4),
 (case n when 2 then 'confirmed' when 6 then 'pending' when 7 then 'canceled' when 8 then 'shipping'
  when 9 then 'delivered' when 10 then 'done' when 11 then 'canceled' else 'paid' end)::public.order_status,
 case n when 1 then 6500 when 2 then 2000 when 8 then 1500 when 9 then 1600 when 10 then 1700
  when 12 then 1800 when 14 then 6100 when 16 then 2777 when 17 then 99000 when 20 then 11000 else 1000 end,
 case when n=1 then 3000 else 0 end,case when n=1 then 1000 else 0 end,case when n=1 then 500 else 0 end,
 case n when 1 then c.cutoff-interval '1 hour' when 2 then c.cutoff-interval '1 microsecond'
  when 3 then c.cutoff when 4 then c.cutoff+interval '1 microsecond'
  when 5 then c.cutoff-interval '1 hour 1 microsecond' when 12 then c.starts_at
  when 13 then c.starts_at-interval '1 microsecond'
  when 14 then c.cutoff-interval '7 days 30 minutes' when 15 then c.cutoff-interval '7 days'
  when 16 then c.cutoff-interval '7 days 30 minutes' when 17 then c.cutoff-interval '7 days 30 minutes'
  when 18 then c.starts_at-interval '7 days' else c.cutoff-interval '30 minutes' end
from generate_series(1,20)n cross join sh_clock c where n<>19;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sh_id(2,n),g.id,case when n in(1,2,16) then 2 when n=14 then 3 else 1 end,
 case n when 8 then 1500 when 9 then 1600 when 10 then 1700 when 12 then 1800 when 14 then 2000 when 16 then 1388 when 17 then 99000 else 1000 end,
 '주문 당시 '||g.id,'문구','sh-qa-one',v.id
from generate_series(1,18)n join public.goods g on g.id='sh-qa-'||lpad((case n when 1 then 2 when 2 then 3 when 8 then 4 when 9 then 5 when 10 then 6 when 12 then 8 when 14 then 1 when 16 then 2 when 17 then 13 else 7 end)::text,2,'0')
join public.goods_variants v on v.good_id=g.id and v.is_default;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sh_id(2,1),'sh-qa-other',1,3000,'혼합 IP 스냅샷','문구','sh-qa-other',id
from public.goods_variants where good_id='sh-qa-other' and is_default;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
select pg_temp.sh_id(2,20),g.id,1,1000,'주문 당시 '||g.id,'문구','sh-qa-one',v.id
from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default
where g.id between 'sh-qa-02' and 'sh-qa-12';
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
select pg_temp.sh_id(3,11),pg_temp.sh_id(0,4),'order',pg_temp.sh_id(2,11),1000,'refunded',
 'sales-hourly-refunded','sales-hourly-refunded-key','toss',cutoff-interval '30 minutes' from sh_clock;
insert into public.refunds(payment_id,amount,reason,status) values(pg_temp.sh_id(3,11),1000,'시간대 환불 제외 검증','done');
update public.goods set name='변경된 현재 상품명',ip_id='sh-qa-other' where id='sh-qa-01';

create function pg_temp.sh_fingerprint() returns text language sql stable as $$
 select md5(jsonb_build_object(
 'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where o.id::text like 'a7c014%'),
 'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where i.order_id::text like 'a7c014%'),
 'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where p.id::text like 'a7c014%'),
 'audit',(select count(*) from public.audit_log where actor_id::text like 'a7c014%'),
 'legacy',pg_get_functiondef('public.admin_sales_report(timestamptz,timestamptz,text)'::regprocedure),
 'hourly',pg_get_functiondef('public.admin_sales_hourly_report(date,text,timestamptz)'::regprocedure))::text);
$$;
create temp table sh_before as select pg_temp.sh_fingerprint() fingerprint;
select pg_temp.sh_assert(has_function_privilege('authenticated','public.admin_sales_hourly_report(date,text,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_sales_hourly_report(date,text,timestamptz)','execute')
 and not has_function_privilege('service_role','public.admin_sales_hourly_report(date,text,timestamptz)','execute')
 and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 where p.oid='public.admin_sales_hourly_report(date,text,timestamptz)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),'execute ACL sealed');
select pg_temp.sh_assert((select p.provolatile='s' and p.prosecdef and 'search_path=""'=any(p.proconfig)
 from pg_proc p where p.oid='public.admin_sales_hourly_report(date,text,timestamptz)'::regprocedure),'stable definer with empty search path');
select pg_temp.sh_assert(exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where p.oid='public.admin_sales_hourly_report(date,text,timestamptz)'::regprocedure and c.capability='stats.read'
 and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc)), 'operator read contract registered');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,1)::text,true);
insert into sh_results select 'actual',public.admin_sales_hourly_report(comparison,'sh-qa-one',cutoff) from sh_clock;
insert into sh_results select 'midnight',public.admin_sales_hourly_report(comparison,'sh-qa-one',starts_at) from sh_clock;
do $$declare r jsonb;b jsonb;m jsonb;other_ip jsonb;row jsonb;clock record;h integer;i integer;previous_orders bigint:=0;previous_revenue bigint:=0;comparison_orders bigint:=0;comparison_revenue bigint:=0;begin
 select * into clock from sh_clock; select value into r from sh_results where label='actual';select value into b from sh_results where label='baseline';select value into m from sh_results where label='midnight';h:=(r->>'completedHours')::integer;
 perform pg_temp.sh_assert(r->>'date'=clock.day::text and r->>'comparisonDate'=clock.comparison::text and (r->>'cutoff')::timestamptz=clock.cutoff,'KST metadata');
 perform pg_temp.sh_assert(jsonb_array_length(r->'hours')=24 and h=extract(hour from clock.cutoff at time zone 'Asia/Seoul')::integer,'24-hour shape and completed hour count');
 for i in 0..23 loop
  row:=r->'hours'->i; perform pg_temp.sh_assert((row->>'hour')::integer=i,'ordered unique hour');
  if i<h then
   perform pg_temp.sh_assert(jsonb_typeof(row->'orderCount')='number' and jsonb_typeof(row->'revenue')='number','complete zero is numeric');
   previous_orders:=previous_orders+(row->>'orderCount')::bigint;previous_revenue:=previous_revenue+(row->>'revenue')::bigint;
   comparison_orders:=comparison_orders+(row->>'comparisonOrderCount')::bigint;comparison_revenue:=comparison_revenue+(row->>'comparisonRevenue')::bigint;
   perform pg_temp.sh_assert((row->>'cumulativeOrderCount')::bigint=previous_orders and (row->>'cumulativeRevenue')::bigint=previous_revenue
    and (row->>'comparisonCumulativeOrderCount')::bigint=comparison_orders and (row->>'comparisonCumulativeRevenue')::bigint=comparison_revenue,'cumulative values sum completed hours only');
  else
   perform pg_temp.sh_assert(row-'hour'='{"orderCount":null,"revenue":null,"comparisonOrderCount":null,"comparisonRevenue":null,"cumulativeOrderCount":null,"cumulativeRevenue":null,"comparisonCumulativeOrderCount":null,"comparisonCumulativeRevenue":null}'::jsonb,'future or cutoff hour is null, not observed zero');
  end if;
 end loop;
 if h>0 then
  perform pg_temp.sh_assert((r#>>'{summary,current,orderCount}')::bigint=previous_orders and (r#>>'{summary,current,revenue}')::bigint=previous_revenue,'summary equals hourly current totals');
  perform pg_temp.sh_assert((r#>>'{summary,comparison,orderCount}')::bigint=comparison_orders and (r#>>'{summary,comparison,revenue}')::bigint=comparison_revenue,'summary equals comparison through same hour');
  -- The only additional pre-last-hour order joins today once there are 2+ completed hours.
  perform pg_temp.sh_assert((r#>>'{summary,current,orderCount}')::bigint-(b#>>'{summary,current,orderCount}')::bigint=1008+case when h>1 then 1 else 0 end,'1001 orders plus valid boundary/status/mixed orders without pending or canceled');
  perform pg_temp.sh_assert((r#>>'{summary,current,revenue}')::bigint-(b#>>'{summary,current,revenue}')::bigint=1027100+case when h>1 then 1000 else 0 end,'order total retains shipping discounts and credits, not item value');
  perform pg_temp.sh_assert(r#>>'{todayGoods,0,goodId}'='sh-qa-01' and r#>>'{todayGoods,0,qty}'='1001' and r#>>'{todayGoods,0,revenue}'='1001000','1001 rows aggregate fully with original IP snapshot');
 end if;
 perform pg_temp.sh_assert(jsonb_array_length(r->'lastHourGoods')=10 and r#>>'{lastHourGoods,0,goodId}'='sh-qa-01'
  and r#>>'{lastHourGoods,0,comparisonRevenue}'='6000','TOP10 compares same ID rather than comparison rank');
 perform pg_temp.sh_assert(r#>>'{lastHourGoods,1,goodId}'='sh-qa-02' and r#>>'{lastHourGoods,1,comparisonRevenue}'='2776'
  and r#>>'{lastHourGoods,2,goodId}'='sh-qa-03','tie order revenue then qty then ID');
 perform pg_temp.sh_assert(not exists(select 1 from jsonb_array_elements(r->'lastHourGoods')x where x->>'goodId' in('sh-qa-13','sh-qa-other')),'comparison-only and other-IP products do not replace current top rows');
 perform pg_temp.sh_assert(m->>'completedHours'='0' and m#>'{summary,current}'='null'::jsonb and m#>'{summary,comparison}'='null'::jsonb and m->'todayGoods'='[]'::jsonb,'midnight today has no observed hours or totals');
 perform pg_temp.sh_assert((m->>'lastHourFrom')::timestamptz=clock.starts_at-interval '1 hour'
  and (m->>'comparisonLastHourFrom')::timestamptz=clock.starts_at-interval '7 days 1 hour','midnight last-hour dates cross on both sides');
 perform pg_temp.sh_assert(exists(select 1 from jsonb_array_elements(m->'lastHourGoods')x where x->>'goodId'='sh-qa-07'),'just-before-midnight is included in midnight last hour');
 other_ip:=public.admin_sales_hourly_report(clock.comparison,'sh-qa-other',clock.cutoff);
 perform pg_temp.sh_assert(other_ip->'hours'=r->'hours' and other_ip->'summary'=r->'summary','IP never filters order count or order total');
 perform pg_temp.sh_assert(jsonb_array_length(other_ip->'lastHourGoods')=1 and other_ip#>>'{lastHourGoods,0,revenue}'='3000','mixed-order IP filter is item snapshot only');
 perform pg_temp.sh_assert(public.admin_sales_hourly_report(clock.comparison,'missing-ip',clock.cutoff)->'lastHourGoods'='[]'::jsonb,'unknown IP has empty goods without erasing order totals');
 perform pg_temp.sh_assert((public.admin_sales_hourly_report()->>'asOf')::timestamptz=statement_timestamp(),'asOf is one DB statement time');
 perform pg_temp.sh_assert(public.admin_sales_hourly_report()->>'comparisonDate'=clock.comparison::text,'default comparison date is seven days before DB today');
 raise notice 'hourly populated-today path checked: %, completed hours: %',h>0,h;
end $$;

do $$declare statement text;begin
 foreach statement in array array[
  $q$select public.admin_sales_hourly_report(p_compare_date:='infinity')$q$,
  $q$select public.admin_sales_hourly_report(p_compare_date:='-infinity')$q$,
  $q$select public.admin_sales_hourly_report(p_compare_date:=(statement_timestamp() at time zone 'Asia/Seoul')::date)$q$,
  $q$select public.admin_sales_hourly_report(p_compare_date:=(statement_timestamp() at time zone 'Asia/Seoul')::date+1)$q$,
  $q$select public.admin_sales_hourly_report(p_ip_id:=repeat('i',65))$q$,
  $q$select public.admin_sales_hourly_report(p_cutoff:='infinity')$q$,
  $q$select public.admin_sales_hourly_report(p_cutoff:='-infinity')$q$,
  $q$select public.admin_sales_hourly_report(p_cutoff:=(select cutoff+interval '1 hour' from sh_clock))$q$,
  $q$select public.admin_sales_hourly_report(p_cutoff:=(select cutoff-interval '1 microsecond' from sh_clock))$q$,
  $q$select public.admin_sales_hourly_report(p_cutoff:=(select starts_at-interval '1 hour' from sh_clock))$q$
 ] loop perform pg_temp.sh_expect(statement,'22023');end loop;
end $$;
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,2)::text,true);
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,3)::text,true);
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,4)::text,true);
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
reset role;
set local role anon;
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
reset role;
set local role service_role;
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
reset role;
select pg_temp.sh_assert(pg_temp.sh_fingerprint()=(select fingerprint from sh_before),'read preserves owned fixture orders/items/payments/audit and function definitions');
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.sh_id(0,1);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,1)::text,true);
select pg_temp.sh_expect('select public.admin_sales_hourly_report()','42501');
reset role;
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.sh_id(0,1);
set local transaction_read_only=on;
set local timezone='America/New_York';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.sh_id(0,1)::text,true);
select pg_temp.sh_assert((select public.admin_sales_hourly_report(comparison,'sh-qa-one',cutoff)->'hours'=(select value->'hours' from sh_results where label='actual') from sh_clock),'read-only execution and session timezone independence');
reset role;
rollback;
