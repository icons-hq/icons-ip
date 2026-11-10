\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.enc_id(n integer) returns uuid language sql immutable as $$ select ('ebb6c180-99bc-4111-8111-'||lpad(n::text,12,'0'))::uuid; $$;
create function pg_temp.enc_assert(condition boolean,label text) returns void language plpgsql as $$ begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;end $$;
create function pg_temp.enc_error(statement text,expected text) returns void language plpgsql as $$ begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.enc_id(n),'authenticated','authenticated','encrypted-export-'||n||'@example.test',now(),'{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in(pg_temp.enc_id(1),pg_temp.enc_id(2),pg_temp.enc_id(3));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.enc_id(1),'primary'),(pg_temp.enc_id(2),'primary');
-- Synthetic immutable receipt only; no payment/order source or existing receipt is changed.
insert into private.settled_export_receipts(id,actor_id,request_id,filters,payload) values
 (pg_temp.enc_id(10),pg_temp.enc_id(1),pg_temp.enc_id(11),'{"query":"frozen"}',
 '{"capturedAt":"2020-01-01T00:00:00Z","orders":[{"items":[{},{}]},{"items":[{}]}]}');
create temp table enc_before as select md5(string_agg(to_jsonb(r)::text,',' order by id)) fingerprint from private.settled_export_receipts r;
set local role service_role;
select set_config('request.jwt.claim.sub',pg_temp.enc_id(1)::text,true);
do $$ declare event_id uuid; event public.audit_log; screen text;begin
 foreach screen in array array['orders','unpaid','dispatch','shipping','claims-cancels','claims-returns','claims-exchanges'] loop
  event_id:=public.service_record_encrypted_list_export((select auth.uid()),screen,'{"field":"recipient","query":"홍","from":"2020-01-01","sort":"oldest"}',3,2,repeat('a',64));
  select * into event from public.audit_log where id=event_id;
  perform pg_temp.enc_assert(event.actor_id=pg_temp.enc_id(1) and event.action='admin.list_export.file_issued'
   and event.target='admin_screen:'||screen and event.diff->>'rowCount'='3' and event.diff->>'recordCount'='2'
   and event.diff->>'fileSha256'=repeat('a',64) and event.diff->>'encryption'='ECMA-376-Agile'
   and event.diff->'filters'->>'query'='홍','all seven list audits preserve exact normalized filters');
 end loop;
 perform public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',0,0,repeat('b',64));
 perform public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',10000,10000,repeat('b',64));
 event_id:=public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(10),repeat('c',64));
 select * into event from public.audit_log where id=event_id;
 perform pg_temp.enc_assert(event.actor_id=pg_temp.enc_id(1) and event.action='admin.settled_export.file_issued'
  and event.target='settled_export:'||pg_temp.enc_id(10) and event.diff->>'orderCount'='2' and event.diff->>'itemCount'='3'
  and event.diff->'filters'='{"query":"frozen"}' and event.diff->>'capturedAt'='2020-01-01T00:00:00Z','settled derives counts and filters from frozen owner receipt');
 perform public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(10),repeat('d',64));
 perform pg_temp.enc_assert((select count(*)=2 from public.audit_log where actor_id=pg_temp.enc_id(1) and action='admin.settled_export.file_issued'),'each reissue has independent file audit');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'stats','{}',1,1,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{"password":"NeverRecord!"}',1,1,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{"query":{"password":"NeverRecord!"}}',1,1,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders',jsonb_build_object('query',repeat('a',2001)),1,1,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',10001,1,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',1,2,repeat('a',64))$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',1,1,'bad')$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(10),'bad')$q$,'22023');
 perform pg_temp.enc_error($q$select public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(99),repeat('a',64))$q$,'P0002');
end $$;
select set_config('request.jwt.claim.sub',pg_temp.enc_id(2)::text,true);
select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',1,1,repeat('a',64));
select pg_temp.enc_error($q$select public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(10),repeat('a',64))$q$,'P0002');
reset role;
-- Current membership revocation must block issuance even after a previous successful read.
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.enc_id(2);
set local role service_role;
select pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',1,1,repeat('a',64))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.enc_id(3)::text,true);
select pg_temp.enc_error($q$select public.service_record_encrypted_list_export((select auth.uid()),'orders','{}',1,1,repeat('a',64))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.enc_id(4)::text,true);
select pg_temp.enc_error($q$select public.service_record_encrypted_settled_export((select auth.uid()),pg_temp.enc_id(10),repeat('a',64))$q$,'42501');
reset role;
select pg_temp.enc_assert((select fingerprint from enc_before)=(select md5(string_agg(to_jsonb(r)::text,',' order by id)) from private.settled_export_receipts r),'all existing and synthetic receipts unchanged');
select pg_temp.enc_assert(not exists(select 1 from public.audit_log where actor_id in(select pg_temp.enc_id(n) from generate_series(1,4)n) and diff::text like '%NeverRecord!%'),'rejected values absent from audit');
select pg_temp.enc_assert(not has_function_privilege('anon','public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text)','execute')
 and not has_function_privilege('authenticated','public.service_record_encrypted_list_export(uuid,text,jsonb,integer,integer,text)','execute')
 and not has_function_privilege('anon','public.service_record_encrypted_settled_export(uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.service_record_encrypted_settled_export(uuid,uuid,text)','execute'),'anonymous and authenticated roles sealed');
set local role authenticated;
select pg_temp.enc_error($q$select public.service_record_encrypted_list_export(pg_temp.enc_id(1),'orders','{}',1,1,repeat('a',64))$q$,'42501');
select pg_temp.enc_error($q$select public.service_record_encrypted_settled_export(pg_temp.enc_id(1),pg_temp.enc_id(10),repeat('a',64))$q$,'42501');
reset role;
rollback;
