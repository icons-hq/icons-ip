\set ON_ERROR_STOP on
begin;
-- This integration test uses explicit memberships, never the legacy fixture hook.
do $$begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Release authority tests require an isolated database without the legacy fixture helper';end if;
end $$;

create function pg_temp.expect_release_error(statement text,expected_state text) returns void language plpgsql as $$
begin
 begin execute statement;
 exception when others then if sqlstate=expected_state then return;end if;raise;end;
 raise exception 'Expected SQLSTATE %',expected_state;
end $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('ed200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'release-authority-'||n||'@example.test','{}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role='staff',nickname='release_authority_'||right(id::text,1)
 where id::text like 'ed200000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('ed200000-0000-4000-8000-000000000001','primary'),
 ('ed200000-0000-4000-8000-000000000002','logistics');

select 1/case when not private.has_operator_capability('ed200000-0000-4000-8000-000000000003','sales.manage')
 then 1 else 0 end as raw_staff_is_not_an_operator;
set local role authenticated;
select set_config('request.jwt.claim.sub','ed200000-0000-4000-8000-000000000002',true);
select pg_temp.expect_release_error($sql$select public.admin_origin_tracking_candidates(
 '00000000-0000-4000-8000-000000042202','{}','{}')$sql$,'42501');
select pg_temp.expect_release_error($sql$select public.admin_origin_pending_export_ids(
 '00000000-0000-4000-8000-000000042202')$sql$,'42501');
select pg_temp.expect_release_error($sql$select public.admin_import_seowon_tracking_batch(
 '00000000-0000-4000-8000-000000042202','[]')$sql$,'42501');
select pg_temp.expect_release_error($sql$select public.admin_start_order_cancellation(
 'ed200000-0000-4001-8000-000000000001','out_of_stock',null,false)$sql$,'42501');
select set_config('request.jwt.claim.sub','ed200000-0000-4000-8000-000000000003',true);
select pg_temp.expect_release_error($sql$select public.admin_origin_tracking_candidates(
 '00000000-0000-4000-8000-000000042202','{}','{}')$sql$,'42501');
select pg_temp.expect_release_error($sql$select public.admin_start_order_cancellation(
 'ed200000-0000-4001-8000-000000000001','out_of_stock',null,false)$sql$,'42501');

select set_config('request.jwt.claim.sub','ed200000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_origin_tracking_candidates(
 '00000000-0000-4000-8000-000000042202','{}','{}')->'shipments'='[]'::jsonb
 then 1 else 0 end as authorized_reader_uses_the_bounded_candidate_contract;
select pg_temp.expect_release_error($sql$select public.admin_start_order_cancellation(
 'ed200000-0000-4001-8000-000000000001','out_of_stock',null,false)$sql$,'P0002');
reset role;
update private.operator_memberships set manager_role='logistics'
 where profile_id='ed200000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_release_error($sql$select public.admin_origin_pending_export_ids(
 '00000000-0000-4000-8000-000000042202')$sql$,'42501');
reset role;

select 1/case when not exists(
 select 1 from unnest(array[
  'public.admin_start_order_cancellation(uuid,text,text,boolean)',
  'public.admin_origin_tracking_candidates(uuid,text[],text[])',
  'public.admin_origin_pending_export_ids(uuid)',
  'public.admin_import_seowon_tracking_batch(uuid,jsonb)'
 ]) f(signature)
 where not has_function_privilege('authenticated',signature,'execute')
  or has_function_privilege('anon',signature,'execute')
  or has_function_privilege('service_role',signature,'execute')
) then 1 else 0 end as warehouse_and_staff_start_rpc_acls_are_sealed;
select 1/case when not has_function_privilege('authenticated',
 'public.place_order(jsonb,uuid,public.order_payment_method)','execute')
 and not has_function_privilege('service_role',
 'public.place_order(jsonb,uuid,public.order_payment_method)','execute')
 then 1 else 0 end as deployed_internal_checkout_seal_survives_admin_release;
rollback;
