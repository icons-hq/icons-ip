\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.purchase_report_id(kind text,n integer) returns uuid language sql immutable as $$
 select (substr(md5('customer-purchase-report:'||kind),1,8)||'-1111-4111-8111-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.purchase_report_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;
end $$;
create function pg_temp.purchase_report_expect(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
create function pg_temp.purchase_report_row(report jsonb,period text,group_key text) returns jsonb language sql immutable as $$
 select value from jsonb_array_elements(report->period->'rows') where value->>'group'=group_key;
$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.purchase_report_id('actor',n),'authenticated','authenticated','customer-purchase-report-'||n||'@example.test',now(),'{}','{}'
 from generate_series(1,140)n;
update public.profiles set role='staff' where id in(select pg_temp.purchase_report_id('actor',n) from generate_series(1,6)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.purchase_report_id('actor',1),'primary'),(pg_temp.purchase_report_id('actor',2),'agency'),
 (pg_temp.purchase_report_id('actor',3),'influencer'),(pg_temp.purchase_report_id('actor',4),'deputy'),
 (pg_temp.purchase_report_id('actor',5),'logistics');
insert into public.ips(id,title,vertical_key) values('customer-purchase-report-ip','구매 분석 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 values('customer-purchase-report-good','customer-purchase-report-ip','구매 분석 합성 상품','문구',1000,'ok',1000);

create temp table purchase_report_fixture(
 n integer primary key,customer integer,paid_at timestamptz,created_at timestamptz,
 subtotal bigint default 1000,coupon bigint default 0,credit bigint default 0,shipping bigint default 0,
 order_status public.order_status default 'paid',payment_status public.payment_status default 'paid',
 channel text default 'pg',override_total bigint
);
insert into purchase_report_fixture(n,customer,paid_at) values
 (1,101,'2012-07-01T00:00:00Z'::timestamptz-interval '4320 hours'),
 (2,101,'2012-07-01T00:00:00Z'),
 (3,102,'2012-07-01T00:00:00Z'::timestamptz-interval '4320 hours 0.000001 seconds'),
 (4,102,'2012-07-01T00:00:00Z'),
 (5,103,'2012-07-02T00:00:00Z'),(6,103,'2012-07-02T00:00:00Z'),
 (7,104,'2012-06-30T14:59:59.999999Z'),(8,104,'2012-07-31T14:59:59.999999Z'),
 (9,105,'2012-07-31T15:00:00Z'),(10,106,'2012-07-05T12:00:00Z'),
 (11,107,'2012-07-10T12:00:00Z'),(12,108,'2012-07-16T12:00:00Z'),
 (13,109,null),(14,110,null),(15,111,null),(16,112,null),(17,113,'2012-07-20T12:00:00Z'),
 (18,114,null),(19,115,'2012-06-30T15:00:00Z'),(20,116,'2012-07-31T15:00:00Z'),
 (21,117,'2012-07-25T00:00:00Z'),(22,118,'2012-06-30T14:59:59.999999Z'),(23,119,'2012-07-28T12:00:00Z'),
 (101,121,'2012-08-10T00:00:00Z'),(102,122,'2012-08-11T00:00:00Z'),
 (103,123,'2012-08-12T00:00:00Z'),(104,124,'2012-08-13T00:00:00Z'),
 (105,125,'2012-08-14T00:00:00Z'),(106,126,'2012-08-15T00:00:00Z'),
 (107,127,'2013-01-14T00:00:00Z');
update purchase_report_fixture set created_at=coalesce(paid_at-interval '1 hour','2012-07-18T00:00:00Z') where n is not null;
update purchase_report_fixture set subtotal=12000,coupon=1000,credit=2000,shipping=3000 where n=2;
update purchase_report_fixture set subtotal=6000,coupon=600,shipping=3000 where n=4;
update purchase_report_fixture set subtotal=2000 where n=6;
update purchase_report_fixture set subtotal=3000 where n=8;
update purchase_report_fixture set subtotal=5000,coupon=1000,credit=1000,shipping=2500,channel='bank' where n=10;
update purchase_report_fixture set subtotal=8000,coupon=800,credit=200,order_status='canceled',payment_status='refunded' where n=11;
update purchase_report_fixture set subtotal=3210,coupon=100,credit=10,shipping=1000,created_at='2011-01-01T00:00:00Z' where n=12;
update purchase_report_fixture set channel='none' where n in(13,15,16);
update purchase_report_fixture set channel='no_evidence',order_status='canceled',payment_status='refunded' where n=14;
update purchase_report_fixture set order_status='pending' where n=15;
update purchase_report_fixture set order_status='canceled' where n=16;
update purchase_report_fixture set channel='ticket',order_status='pending' where n=17;
update purchase_report_fixture set subtotal=7890,coupon=90,credit=50 where n=23;
update purchase_report_fixture set override_total=900 where n=101;
update purchase_report_fixture set coupon=1001,shipping=2000 where n=102;
update purchase_report_fixture set credit=1001,shipping=2000 where n=103;
update purchase_report_fixture set coupon=1000,shipping=1000 where n=105;
update purchase_report_fixture set subtotal=6000,coupon=1001,credit=999 where n=106;
update purchase_report_fixture set subtotal=10000000000000000 where n=107;

insert into public.orders(id,user_id,status,total,shipping_fee,discount_total,store_credit_total,created_at,payment_method)
 select pg_temp.purchase_report_id('order',n),pg_temp.purchase_report_id('actor',customer),order_status,
  coalesce(override_total,subtotal+shipping-coupon-credit),shipping,coupon,credit,created_at,
  case when channel='bank' then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end
 from purchase_report_fixture;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.purchase_report_id('item',f.n),pg_temp.purchase_report_id('order',f.n),g.id,v.id,
  case when f.n=106 then 3 when f.n=107 then 5000000 else 1 end,
  case when f.n=106 then 1000 when f.n=107 then 2000000000 else f.subtotal end,
  g.name,g.type,g.ip_id
 from purchase_report_fixture f cross join public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default
 where g.id='customer-purchase-report-good' and f.n<>104;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.purchase_report_id('item',206),pg_temp.purchase_report_id('order',106),g.id,v.id,2,1500,g.name,g.type,g.ip_id
 from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='customer-purchase-report-good';
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
 select pg_temp.purchase_report_id('payment',n),pg_temp.purchase_report_id('actor',customer),
  case when channel='ticket' then 'ticket'::public.payment_purpose else 'order'::public.payment_purpose end,
  pg_temp.purchase_report_id('order',n),coalesce(override_total,subtotal+shipping-coupon-credit),payment_status,
  'customer-purchase-report-payment-'||n,'customer-purchase-report-pay-key-'||n,
  case when channel='bank' then 'bank_transfer'::public.payment_provider else 'toss'::public.payment_provider end,
  '2010-01-01T00:00:00Z'
 from purchase_report_fixture where channel<>'none';
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.purchase_report_id('attempt',n),
  case when channel='bank' then 'bank_transfer'::public.payment_provider else 'toss'::public.payment_provider end,
  pg_temp.purchase_report_id('actor',customer),
  case when channel='ticket' then 'ticket'::public.payment_purpose else 'order'::public.payment_purpose end,
  pg_temp.purchase_report_id('order',n),coalesce(override_total,subtotal+shipping-coupon-credit)+case when n=21 then 1 else 0 end,
  'KRW','approved','customer-purchase-report-attempt-key-'||n,'customer-purchase-report-provider-order-'||n,
  'customer-purchase-report-provider-product-'||n,pg_temp.purchase_report_id('payment',n),now()+interval '1 day'
 from purchase_report_fixture where channel<>'none';
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 select pg_temp.purchase_report_id('attempt',n),'confirm_approved','customer-purchase-report-payment-'||n,
  'customer-purchase-report-evidence-'||n,paid_at from purchase_report_fixture where channel in('pg','ticket');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 values(pg_temp.purchase_report_id('attempt',23),'reconcile_approved','customer-purchase-report-payment-23','customer-purchase-report-evidence-later','2012-08-01T00:00:00Z');
insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo)
 values(pg_temp.purchase_report_id('order',10),pg_temp.purchase_report_id('attempt',10),pg_temp.purchase_report_id('actor',1),'2012-07-05T12:00:00Z','합성 입금 확인');
-- Provider evidence, when present even on a bank attempt, precedes the fallback.
-- Both dates stay in the same period; direct equality below detects a wrong MIN.
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 values(pg_temp.purchase_report_id('attempt',10),'confirm_approved','customer-purchase-report-payment-10','customer-purchase-report-bank-provider-evidence','2012-07-05T12:00:01Z');
-- FIXTURE END. Only reads below; every synthetic record is rolled back.
select pg_temp.purchase_report_assert(not exists(
 select 1 from public.orders purchase left join private.admin_customer_purchase_payment_times() actual on actual.order_id=purchase.id
 where actual.paid_at is distinct from private.admin_sales_order_date(purchase,'paid')
),'set-based payment dates match the existing helper including inner min, bank fallback and amount/purpose checks');
create function pg_temp.purchase_report_fingerprint() returns text language sql stable as $$
 select md5(jsonb_build_object(
  'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id in(select pg_temp.purchase_report_id('order',n) from purchase_report_fixture)),
  'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i where good_id='customer-purchase-report-good'),
  'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where ref_id in(select pg_temp.purchase_report_id('order',n) from purchase_report_fixture)),
  'attempts',(select jsonb_agg(to_jsonb(a) order by id) from public.payment_attempts a where ref_id in(select pg_temp.purchase_report_id('order',n) from purchase_report_fixture)),
  'evidence',(select jsonb_agg(to_jsonb(e) order by id) from private.payment_provider_evidence e where payment_attempt_id in(select pg_temp.purchase_report_id('attempt',n) from purchase_report_fixture)),
  'goods',(select to_jsonb(g) from public.goods g where id='customer-purchase-report-good'),
  'variants',(select jsonb_agg(to_jsonb(v) order by id) from public.goods_variants v where good_id='customer-purchase-report-good'),
  'audit',(select count(*) from public.audit_log),
  'oldCustomerReport',(select pg_get_functiondef('public.admin_customer_report(timestamptz,timestamptz)'::regprocedure))
 )::text);
$$;
create temp table purchase_report_before as select pg_temp.purchase_report_fingerprint() fingerprint;
create temp table purchase_report_results(kind text primary key,result jsonb);
grant select,insert on purchase_report_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',1)::text,true);
insert into purchase_report_results values('baseline',public.admin_customer_purchase_report('month','2012-07-01','2012-07-31','2012-06-01','2012-06-30'));
do $$declare report jsonb; all_row jsonb; new_row jsonb; repeat_row jsonb; bad jsonb; field text; begin
 select result into report from purchase_report_results where kind='baseline';
 all_row:=pg_temp.purchase_report_row(report,'current','all');
 new_row:=pg_temp.purchase_report_row(report,'current','new');
 repeat_row:=pg_temp.purchase_report_row(report,'current','repeat');
 perform pg_temp.purchase_report_assert((select string_agg(value->>'group',',' order by ord) from jsonb_array_elements(report->'current'->'rows') with ordinality a(value,ord))='all,new,repeat','stable group order');
 perform pg_temp.purchase_report_assert(all_row->>'customerCount'='9' and all_row->>'orderCount'='10','all goods payment events deduplicate evidence and multiple item rows');
 perform pg_temp.purchase_report_assert(new_row->>'customerCount'='7' and new_row->>'orderCount'='7','new includes just-outside 180 days and first equal timestamp');
 perform pg_temp.purchase_report_assert(repeat_row->>'customerCount'='3' and repeat_row->>'orderCount'='3','repeat includes exact 180 days and second equal timestamp');
 perform pg_temp.purchase_report_assert((new_row->>'customerCount')::integer+(repeat_row->>'customerCount')::integer>(all_row->>'customerCount')::integer,'one customer can be both groups while all deduplicates');
 perform pg_temp.purchase_report_assert(all_row->>'itemSubtotal'='49100' and all_row->>'couponAmount'='3590' and all_row->>'storeCreditAmount'='3260'
  and all_row->>'productSalesAmount'='45510' and all_row->>'cashProductAmount'='42250' and (all_row->>'averagePerCustomer')::numeric=5056.67,'snapshot money excludes shipping and separates credits; average per customer');
 perform pg_temp.purchase_report_assert(all_row->>'monetaryIssueOrderCount'='0','valid coupons and credits are not issues');
 perform pg_temp.purchase_report_assert(report->'current'->>'unknownPaidAtCount'='4','unproven paid/refunded and mismatched payment evidence counted by creation date, unpaid cancellation and tickets excluded');
 perform pg_temp.purchase_report_assert(pg_temp.purchase_report_row(report,'comparison','all')->>'orderCount'='2','KST exclusive boundary excludes last June event from July');
 perform pg_temp.purchase_report_assert(jsonb_array_length(report->'trend')=13 and report->'trend'->0->>'from'='2011-07-01'
  and report->'trend'->12->>'to'='2012-07-31' and report->'trend'->12=report->'current','13 ascending complete months match current period');
 perform pg_temp.purchase_report_assert((select value from jsonb_array_elements(report->'trend') value where value->>'from'='2012-01-01')->'rows'->0->>'orderCount'='2','180-day history remains visible in monthly trend');
 bad:=public.admin_customer_purchase_report('month','2012-08-01','2012-08-31');
 perform pg_temp.purchase_report_assert(bad->'comparison'='null'::jsonb,'optional comparison is explicit null');
 all_row:=pg_temp.purchase_report_row(bad,'current','all');
 perform pg_temp.purchase_report_assert(all_row->>'orderCount'='8' and all_row->>'monetaryIssueOrderCount'='4','bad total, excess coupon, excess credit and no item counted without dropping customers');
 foreach field in array array['itemSubtotal','couponAmount','storeCreditAmount','productSalesAmount','cashProductAmount','averagePerCustomer'] loop
  perform pg_temp.purchase_report_assert(all_row->field='null'::jsonb,'incomplete money is null: '||field);
 end loop;
 repeat_row:=pg_temp.purchase_report_row(bad,'current','repeat');
 perform pg_temp.purchase_report_assert(repeat_row->>'customerCount'='0' and repeat_row->>'itemSubtotal'='0' and repeat_row->'averagePerCustomer'='null'::jsonb,'empty groups have zero sums and no average');
 report:=public.admin_customer_purchase_report('month','2012-05-01','2012-05-31');
 perform pg_temp.purchase_report_assert(pg_temp.purchase_report_row(report,'current','all')->>'orderCount'='0','an empty period is not a loading or missing-data state');
 perform public.admin_customer_purchase_report('month','2012-01-01','2012-12-31');
 report:=public.admin_customer_purchase_report('week','2012-06-25','2012-07-01');
 perform pg_temp.purchase_report_assert(jsonb_array_length(report->'trend')=13 and report->'trend'->0->>'from'='2012-04-02'
  and report->'trend'->12->>'to'='2012-07-01' and report->'trend'->12=report->'current','weekly trend has 13 complete weeks and matches the current last week');
 report:=public.admin_customer_purchase_report('week','2012-09-24','2012-09-30');
 perform pg_temp.purchase_report_assert(report->'trend'->0->>'from'='2012-07-02' and report->'trend'->12->>'from'='2012-09-24'
  and report->'trend'->12->>'to'='2012-09-30','weekly query ending on month end still uses weekly periods');
end $$;

set local timezone='America/New_York';
select pg_temp.purchase_report_assert(public.admin_customer_purchase_report('month','2012-07-01','2012-07-31','2012-06-01','2012-06-30')=(select result from purchase_report_results where kind='baseline'),'KST boundaries and 180-day elapsed time are independent of session timezone');
set local timezone='UTC';
do $$declare today_kst date:=(statement_timestamp() at time zone 'Asia/Seoul')::date; report jsonb; week_start date; begin
 week_start:=date_trunc('week',today_kst::timestamp)::date;
 report:=public.admin_customer_purchase_report('week',week_start-7,week_start-1);
 perform pg_temp.purchase_report_assert(report->'trend'->12->>'from'=(week_start-7)::text
  and report->'trend'->12->>'to'=(week_start-1)::text,'weekly trend ends at selected complete week');
 perform pg_temp.purchase_report_expect(format('select public.admin_customer_purchase_report(%L,%L,%L)','week',week_start,week_start+6),'invalid_customer_purchase_range');
end $$;
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('day','2012-07-01','2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report(null,'2012-07-01','2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month',null,'2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2009-12-01','2009-12-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-02','2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-30')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('week','2012-07-03','2012-07-08')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-08-01','2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-01-01','2013-01-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31','2012-06-01',null)$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31','2012-06-02','2012-06-30')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','infinity')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','-infinity','2012-07-31')$q$,'invalid_customer_purchase_range');
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2013-01-01','2013-01-31')$q$,'customer_purchase_amount_out_of_range');

-- stats.read roles work; sales/CS-only and raw profiles.role never suffice.
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',2)::text,true);
select pg_temp.purchase_report_assert(public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')->'current'=(select result->'current' from purchase_report_results where kind='baseline'),'agency stats read');
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',3)::text,true);
select pg_temp.purchase_report_assert(public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')->'current'=(select result->'current' from purchase_report_results where kind='baseline'),'influencer stats read');
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',4)::text,true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',5)::text,true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',6)::text,true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',101)::text,true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
reset role;
select pg_temp.purchase_report_assert(not has_function_privilege('anon','public.admin_customer_purchase_report(text,date,date,date,date)','execute')
 and not has_function_privilege('service_role','public.admin_customer_purchase_report(text,date,date,date,date)','execute')
 and has_function_privilege('authenticated','public.admin_customer_purchase_report(text,date,date,date,date)','execute'),'explicit RPC ACL');
select pg_temp.purchase_report_assert(not has_function_privilege('anon','private.admin_customer_purchase_payment_times()','execute')
 and not has_function_privilege('authenticated','private.admin_customer_purchase_payment_times()','execute')
 and not has_function_privilege('service_role','private.admin_customer_purchase_payment_times()','execute'),'internal payment projection is sealed');
select pg_temp.purchase_report_assert(pg_temp.purchase_report_fingerprint()=(select fingerprint from purchase_report_before),'report reads preserve orders, payments, stock, evidence, audit and previous customer RPC');
-- Live authority loss is checked again on a repeated report request.
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.purchase_report_id('actor',2);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',2)::text,true);
select pg_temp.purchase_report_expect($q$select public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')$q$,'42501');
reset role;
-- PostgreSQL permits tightening this transaction after fixture writes. All data
-- still rolls back, while the final read must not acquire SELECT FOR SHARE locks.
set local transaction_read_only=on;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.purchase_report_id('actor',1)::text,true);
select pg_temp.purchase_report_assert(public.admin_customer_purchase_report('month','2012-07-01','2012-07-31')->'current'
 =(select result->'current' from purchase_report_results where kind='baseline'),'report succeeds inside an actual read-only transaction');
reset role;
rollback;
