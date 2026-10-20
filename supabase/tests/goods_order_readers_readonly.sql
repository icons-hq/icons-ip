\set ON_ERROR_STOP on
-- Run after the common committed concurrency fixture in its leased clone.
-- READ ONLY is the real PostgREST contract for STABLE RPCs, including POST.
select 1/case when current_database()~'^icons_goods_transaction_[0-9a-f]{32}$'
 and exists(select 1 from private.operator_fixture_clone_identity where singleton and source_database='postgres'
  and replace(lease::text,'-','')=right(current_database(),32) and container_id~'^[0-9a-f]{64}$'
  and created_at>clock_timestamp()-interval '2 hours') then 1 else 0 end as assert_owned_reader_regression_clone;
begin;
select 1/case when (select configured from private.operator_access_state where id)
 and not exists(select 1 from auth.users where id in('9c140000-0000-4000-8000-000000000001','9c140000-0000-4000-8000-000000000002'))
 then 1 else 0 end as assert_new_reader_fixture_identifiers;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values('9c140000-0000-4000-8000-000000000001','authenticated','authenticated','goods-reader-primary@example.test',clock_timestamp(),'{"testFixture":"goods-reader-owned-clone"}','{}'),
 ('9c140000-0000-4000-8000-000000000002','authenticated','authenticated','goods-reader-user@example.test',clock_timestamp(),'{"testFixture":"goods-reader-owned-clone"}','{}');
update public.profiles set role='staff',nickname='TEST 읽기 관리자' where id='9c140000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('9c140000-0000-4000-8000-000000000001','primary');
commit;

begin read only;
set local role authenticated;
select set_config('request.jwt.claim.sub','9c140000-0000-4000-8000-000000000001',true);
select 1/case when current_setting('transaction_read_only')='on'
 and public.has_operator_capability('sales.read',false)
 and public.admin_get_order_delivery_snapshots('{}'::uuid[])='[]'::jsonb
 and public.admin_get_order_transaction_receipts('{}'::uuid[])='[]'::jsonb
 then 1 else 0 end as assert_both_readers_succeed_for_primary_in_read_only_transaction;
select set_config('request.jwt.claim.sub','9c140000-0000-4000-8000-000000000002',true);
do $$declare fn text;denied boolean;begin
 foreach fn in array array['public.admin_get_order_delivery_snapshots','public.admin_get_order_transaction_receipts'] loop
  denied:=false;
  begin execute 'select '||fn||'(''{}''::uuid[])';exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Order reader exposed to a nonstaff user: %',fn;end if;
 end loop;
end $$;
rollback;

begin;
delete from auth.users where id in('9c140000-0000-4000-8000-000000000001','9c140000-0000-4000-8000-000000000002');
commit;
select 1/case when not exists(select 1 from auth.users where id in('9c140000-0000-4000-8000-000000000001','9c140000-0000-4000-8000-000000000002'))
 then 1 else 0 end as assert_reader_fixtures_removed;
