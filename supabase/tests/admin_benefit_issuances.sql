\set ON_ERROR_STOP on
-- Regression suite. Run only in an approved isolated database.
begin;
set local timezone='UTC';
do $$begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    raise exception 'Run benefit issuance authorization tests without the legacy fixture helper';
  end if;
end $$;

create function pg_temp.bi_id(p_kind integer,p_n integer) returns uuid language sql immutable as $$
  select ('a5c014'||lpad(p_kind::text,2,'0')||'-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid;
$$;
create function pg_temp.bi_assert(p_ok boolean,p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'Benefit issuance assertion: %',p_label;end if;
end $$;
create function pg_temp.bi_expect(p_statement text,p_state text) returns void language plpgsql as $$
begin
  begin execute p_statement;
  exception when others then if sqlstate=p_state then return;end if;raise;end;
  raise exception 'Expected SQLSTATE % from %',p_state,p_statement;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.bi_id(0,n),'authenticated','authenticated','benefit-issuance-'||n||'@example.test',now(),
  '{"testFixture":"benefit-issuances"}','{}',now(),now() from generate_series(1,10020)n;
update public.profiles set role='staff' where id in(select pg_temp.bi_id(0,n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values
  (pg_temp.bi_id(0,1),'primary'),(pg_temp.bi_id(0,2),'deputy'),(pg_temp.bi_id(0,3),'primary');
-- The fourth raw staff profile deliberately has neither membership nor legacy grant.
insert into public.coupons(code,name,discount_type,discount_value,starts_at,recipient_segment) values
  ('BI-QA-51',E'발급 50%_쿠폰\\검산','fixed',1000,'2026-01-01T00:00:00+09:00','first_purchase'),
  ('BI-QA-1001','천 건 초과 발급','percent',10,'2026-01-01T00:00:00+09:00','repeat_purchase'),
  ('BI-QA-10001','파일 상한 다음 한 건','fixed',1000,'2026-01-01T00:00:00+09:00','all'),
  ('BI-QA-COHORT','발급일과 사용일 구분','fixed',1000,'2026-01-01T00:00:00+09:00','all');
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at)
select pg_temp.bi_id(1,n),'BI-QA-51',pg_temp.bi_id(0,n+10),'admin_grant',
  case when n=51 then '2026-10-01T13:00:00+09:00'::timestamptz else '2026-10-01T12:00:00+09:00'::timestamptz end
from generate_series(1,51)n;
-- A repeat-purchase issuance must satisfy the real recipient trigger. These
-- matching paid orders occur after the first-purchase issuance above, before
-- the repeat-purchase issuance below; they do not redeem any report coupon.
insert into public.orders(id,user_id,status,total,created_at)
select pg_temp.bi_id(7,n),pg_temp.bi_id(0,n+10),'paid',5000,'2026-10-01T14:00:00+09:00'
from generate_series(1,1001)n;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider,created_at)
select pg_temp.bi_id(8,n),pg_temp.bi_id(0,n+10),'order',pg_temp.bi_id(7,n),5000,'paid',
  'benefit-issuance-prior-payment-'||n,'benefit-issuance-prior-key-'||n,'toss','2026-10-01T14:00:00+09:00'
from generate_series(1,1001)n;
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at)
select pg_temp.bi_id(2,n),'BI-QA-1001',pg_temp.bi_id(0,n+10),'admin_grant','2026-10-01T15:00:00+09:00'
from generate_series(1,1001)n;
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at)
select pg_temp.bi_id(3,n),'BI-QA-10001',pg_temp.bi_id(0,n+10),'admin_grant','2026-10-01T12:00:00+09:00'
from generate_series(1,10001)n;

-- Boundary and redemption fixtures: 9 in-period issuances, of which exactly 5
-- have a current applied redemption and a revenue-recognized order status.
insert into public.user_coupons(id,coupon_code,user_id,issued_source,issued_at)
select pg_temp.bi_id(4,n),'BI-QA-COHORT',pg_temp.bi_id(0,n+10005),'admin_grant',
  case n when 1 then '2026-09-30T23:59:59.999999+09:00'::timestamptz
    when 2 then '2026-10-01T00:00:00+09:00'::timestamptz
    when 3 then '2026-10-01T23:59:59.999999+09:00'::timestamptz
    when 5 then '2026-10-02T00:00:00+09:00'::timestamptz
    else '2026-10-01T12:00:00+09:00'::timestamptz end
from generate_series(1,11)n;
insert into public.orders(id,user_id,status,total,created_at)
select pg_temp.bi_id(5,n),pg_temp.bi_id(0,n+10005),
  (case n when 3 then 'pending' when 7 then 'done' when 8 then 'canceled'
    when 9 then 'confirmed' when 10 then 'shipping' when 11 then 'delivered' else 'paid' end)::public.order_status,
  5000,'2026-10-01T12:00:00+09:00'::timestamptz
from generate_series(1,11)n where n<>6;
insert into public.coupon_redemptions(id,user_coupon_id,coupon_code,user_id,order_id,discount_amount,status,applied_at,released_at)
select pg_temp.bi_id(6,n),pg_temp.bi_id(4,n),'BI-QA-COHORT',pg_temp.bi_id(0,n+10005),pg_temp.bi_id(5,n),1000,
  case when n=4 then 'released' else 'applied' end,
  case when n in(2,5) then '2026-10-03T12:00:00+09:00'::timestamptz else '2026-10-01T13:00:00+09:00'::timestamptz end,
  case when n=4 then '2026-10-01T14:00:00+09:00'::timestamptz else null end
from generate_series(1,11)n where n<>6;
-- Historical released usage cannot duplicate the row or override the later paid usage.
insert into public.orders(id,user_id,status,total,created_at)
values(pg_temp.bi_id(5,12),pg_temp.bi_id(0,10012),'canceled',5000,'2026-09-29T12:00:00+09:00');
insert into public.coupon_redemptions(id,user_coupon_id,coupon_code,user_id,order_id,discount_amount,status,applied_at,released_at)
values(pg_temp.bi_id(6,12),pg_temp.bi_id(4,7),'BI-QA-COHORT',pg_temp.bi_id(0,10012),pg_temp.bi_id(5,12),1000,
  'released','2026-09-29T12:00:00+09:00','2026-09-30T12:00:00+09:00');
-- The issuance status alone is not the paid-use predicate or a usability promise.
update public.user_coupons set status='used',used_at='2026-10-01T12:00:00+09:00' where id=pg_temp.bi_id(4,6);

create function pg_temp.bi_fingerprint() returns text language sql stable as $$
  select md5(jsonb_build_object(
    'coupons',(select jsonb_agg(to_jsonb(c) order by code) from public.coupons c where code like 'BI-QA-%'),
    'issuances',(select jsonb_agg(to_jsonb(u) order by id) from public.user_coupons u where coupon_code like 'BI-QA-%'),
    'redemptions',(select jsonb_agg(to_jsonb(r) order by id) from public.coupon_redemptions r where coupon_code like 'BI-QA-%'),
    'orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o where id::text like 'a5c01405-%' or id::text like 'a5c01407-%'),
    'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p where id::text like 'a5c01408-%'),
    'audit',(select count(*) from public.audit_log),
    'existingReport',pg_get_functiondef('public.admin_benefit_report(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure)
  )::text);
$$;
create temp table bi_before as select pg_temp.bi_fingerprint() fingerprint;
create temp table bi_results(label text primary key,value jsonb);
grant select,insert on bi_results to authenticated;

-- The PUBLIC default grant and every direct privileged role are sealed. Only
-- authenticated can enter, and the body checks the current operator capability.
select pg_temp.bi_assert(
  has_function_privilege('authenticated','public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)','execute')
  and not has_function_privilege('anon','public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)','execute')
  and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid='public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'execute ACL is authenticated-only');
select pg_temp.bi_assert((select p.provolatile='s' and p.prosecdef from pg_proc p
  where p.oid='public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure),'stable security definer');
select pg_temp.bi_assert(exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where p.oid='public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure
    and c.capability='marketing.manage' and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
  and exists(select 1 from private.operator_internal_contracts c
    where to_regprocedure(c.signature)='public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure),
  'read authorization and execution metadata receipts registered');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,1)::text,true);
insert into bi_results values
  ('page-one',public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51')),
  ('cohort',public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-COHORT'));
do $$declare report jsonb; next_page jsonb; summary jsonb; issuance jsonb; coupon text; expected integer; query text;begin
  select value into report from bi_results where label='page-one';
  perform pg_temp.bi_assert(report->>'totalCount'='51' and report->>'paidUseCount'='0' and jsonb_array_length(report->'rows')=50,'51 records are not a 50-row total');
  perform pg_temp.bi_assert(report#>>'{rows,0,id}'=pg_temp.bi_id(1,51)::text and report#>>'{rows,1,id}'=pg_temp.bi_id(1,1)::text
    and report#>>'{rows,49,id}'=pg_temp.bi_id(1,49)::text,'issued_at descending then id ascending ties');
  next_page:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51',p_offset:=50);
  perform pg_temp.bi_assert(next_page->>'totalCount'='51' and jsonb_array_length(next_page->'rows')=1
    and next_page#>>'{rows,0,id}'=pg_temp.bi_id(1,50)::text,'second page preserves total and last row');
  next_page:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51',p_offset:=51);
  perform pg_temp.bi_assert(next_page->>'totalCount'='51' and next_page->'rows'='[]'::jsonb,'past-last page remains an explicit empty page');

  foreach coupon in array array['BI-QA-51','BI-QA-1001','BI-QA-10001'] loop
    expected:=case coupon when 'BI-QA-51' then 51 when 'BI-QA-1001' then 1001 else 10001 end;
    report:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:=coupon,p_limit:=10001);
    summary:=public.admin_benefit_report('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:=coupon);
    perform pg_temp.bi_assert((report->>'totalCount')::integer=expected and jsonb_array_length(report->'rows')=expected,'full scalar JSON count: '||coupon);
    perform pg_temp.bi_assert(report->>'totalCount'=summary#>>'{summary,issued}' and report->>'paidUseCount'=summary#>>'{summary,cohortPaidUses}','existing summary parity: '||coupon);
    perform pg_temp.bi_assert((report->>'asOf')::timestamptz=statement_timestamp(),'one statement timestamp');
    perform pg_temp.bi_assert((select array_agg(key order by key) from jsonb_object_keys(report) keys(key))=array['asOf','paidUseCount','rows','totalCount'],'only safe top-level keys');
    for issuance in select value from jsonb_array_elements(report->'rows') loop
      perform pg_temp.bi_assert((select array_agg(key order by key) from jsonb_object_keys(issuance) keys(key))=array['couponCode','id','isPaidUse','issuedAt'],'no customer/order identity or PII row keys');
      perform pg_temp.bi_assert(issuance->>'couponCode'=coupon and jsonb_typeof(issuance->'isPaidUse')='boolean','typed coupon identity and boolean');
    end loop;
  end loop;
  perform pg_temp.bi_assert(report#>>'{rows,10000,id}'=pg_temp.bi_id(3,10001)::text,'export sentinel contains the 10001st row');
  report:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-10001',p_offset:=10000);
  perform pg_temp.bi_assert(report->>'totalCount'='10001' and jsonb_array_length(report->'rows')=1 and report#>>'{rows,0,id}'=pg_temp.bi_id(3,10001)::text,'last page is not a 1000-row transport ceiling');
  report:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-10001',p_limit:=10000);
  perform pg_temp.bi_assert(report->>'totalCount'='10001' and jsonb_array_length(report->'rows')=10000,'a bounded page never misrepresents total as exportable');

  select value into report from bi_results where label='cohort';
  summary:=public.admin_benefit_report('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-COHORT');
  perform pg_temp.bi_assert(report->>'totalCount'='9' and report->>'paidUseCount'='5'
    and report->>'totalCount'=summary#>>'{summary,issued}' and report->>'paidUseCount'=summary#>>'{summary,cohortPaidUses}','KST issuance cohort and current paid-use parity');
  perform pg_temp.bi_assert(not exists(select 1 from jsonb_array_elements(report->'rows') value where value->>'id' in(pg_temp.bi_id(4,1)::text,pg_temp.bi_id(4,5)::text)),'before-from and exact-to excluded even if used in range');
  perform pg_temp.bi_assert((select array_agg(value->>'id' order by value->>'id') from jsonb_array_elements(report->'rows') value where (value->>'isPaidUse')::boolean)
    =array[pg_temp.bi_id(4,2)::text,pg_temp.bi_id(4,7)::text,pg_temp.bi_id(4,9)::text,pg_temp.bi_id(4,10)::text,pg_temp.bi_id(4,11)::text],
    'outside-period paid use included; pending, released, canceled and status-only use excluded');
  perform pg_temp.bi_assert((select count(*) from jsonb_array_elements(report->'rows') value where value->>'id'=pg_temp.bi_id(4,7)::text)=1,'redemption history cannot duplicate an issuance');

  foreach query in array array['50%','%_쿠폰',E'\\검산','bi-qa-51'] loop
    report:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_query:=query,p_code:='BI-QA-51');
    perform pg_temp.bi_assert(report->>'totalCount'='51','literal query matches: '||query);
  end loop;
  report:=public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_query:='50_',p_code:='BI-QA-51');
  perform pg_temp.bi_assert(report->>'totalCount'='0' and report->>'paidUseCount'='0' and report->'rows'='[]'::jsonb,'underscore is not a wildcard and zero rows have zero counts');
  perform pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_discount:='percent')->>'totalCount'='0','current discount mismatch');
  perform pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_segment:='repeat_purchase')->>'totalCount'='0','current recipient mismatch');
  perform pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-UNKNOWN')->>'totalCount'='0','unknown selected coupon is empty');
  perform pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_query:=null,p_code:='BI-QA-51')->>'totalCount'='51','null search keeps existing report compatibility');
  perform public.admin_benefit_issuances('2026-01-01T00:00:00+09:00','2027-01-02T00:00:00+09:00',p_code:='BI-QA-51',p_limit:=1);
end $$;

-- Instants are KST boundaries even when the DB session serializes another zone.
set local timezone='America/New_York';
select pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-COHORT')->>'totalCount'='9','KST range independent of session timezone');
set local timezone='UTC';
do $$declare statement text;begin
  foreach statement in array array[
    $q$select public.admin_benefit_issuances(null,'2026-10-02',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01',null,p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('-infinity','2026-10-02',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','infinity',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-10-02','2026-10-02',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-10-03','2026-10-02',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-01-01','2027-01-02 00:00:00.000001',p_code:='BI-QA-51')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:=null)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='   ')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:=repeat('A',25))$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_query:=repeat('a',101))$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_discount:=null)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_discount:='other')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_segment:=null)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_segment:='other')$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_limit:=null)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_limit:=0)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_limit:=10002)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_offset:=null)$q$,
    $q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51',p_offset:=-1)$q$
  ] loop perform pg_temp.bi_expect(statement,'22023');end loop;
end $$;

-- Same request is denied for a deputy, an unmapped raw staff profile, a customer
-- and an authenticated connection with no current auth subject.
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,2)::text,true);
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,4)::text,true);
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,10)::text,true);
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
reset role;
set local role anon;
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
reset role;
set local role service_role;
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
reset role;
select pg_temp.bi_assert(pg_temp.bi_fingerprint()=(select fingerprint from bi_before),'all reads preserve coupon/issuance/redemption/order rows, audit and old RPC');

-- Filters use the current coupon definition, including an archived definition;
-- they do not pretend to have historical title/type/recipient snapshots.
update public.coupons set name='변경한 현재 쿠폰',discount_type='percent',discount_value=10,recipient_segment='repeat_purchase',status='archived' where code='BI-QA-51';
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,1)::text,true);
select pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51',p_query:='변경한 현재',p_discount:='percent',p_segment:='repeat_purchase')->>'totalCount'='51','updated current definition and archived coupon remain reportable');
select pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51',p_query:='50%')->>'totalCount'='0','old title is no longer a current definition match');
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,3)::text,true);
select pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-51')->>'totalCount'='51','second marketing operator initially allowed');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.bi_id(0,3);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,3)::text,true);
select pg_temp.bi_expect($q$select public.admin_benefit_issuances('2026-10-01','2026-10-02',p_code:='BI-QA-51')$q$,'42501');
reset role;

-- Tighten the fixture transaction to prove this read path does not write audit,
-- acquire row locks or depend on a write-only helper. All fixtures still roll back.
set local transaction_read_only=on;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.bi_id(0,1)::text,true);
select pg_temp.bi_assert(public.admin_benefit_issuances('2026-10-01T00:00:00+09:00','2026-10-02T00:00:00+09:00',p_code:='BI-QA-COHORT')->>'paidUseCount'='5','works in a real read-only transaction');
reset role;
rollback;
