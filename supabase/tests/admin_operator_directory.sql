\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','operator-qa-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,64) n;
update public.profiles p set role=(case when right(id::text,12)='000000000001' then 'admin' when right(id::text,12)='000000000002' then 'staff' else 'user' end)::public.user_role,
 nickname='operator-qa-'||case when right(id::text,12)='000000000064' then '%' else right(id::text,3) end,
 created_at=now()-right(id::text,3)::int*interval '1 day',birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like '81000000-0000-4000-8000-%';
insert into private.operator_legacy_cohort(profile_id,legacy_role)
select id,role from public.profiles where id::text like '81000000-0000-4000-8000-%' and role in ('staff','admin');
select 1/case when not has_table_privilege('authenticated','public.operator_assignments','select')
 and not has_function_privilege('anon','public.admin_search_operators(text,text,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_set_operator_duty(uuid,text,integer,uuid)','execute') then 1 else 0 end as sealed_api;
create function pg_temp.expect_operator_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q; exception when others then if sqlerrm=expected then return; end if; raise; end; raise exception 'expected error: %',expected; end $$;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_operator_error('select public.admin_search_operators()','operator_capability_required');
select pg_temp.expect_operator_error($q$select public.admin_set_operator_duty('81000000-0000-4000-8000-000000000002','cs',0,'81000000-0000-4000-8000-000000000100')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_search_operators('operator-qa')->>'total'='2'
 and public.admin_search_operators('operator-qa','all')->>'total'='64'
 and jsonb_array_length(public.admin_search_operators('operator-qa','all','all',4,20)->'rows')=4
 and public.admin_search_operators('operator-qa-63@example.test','all')#>>'{rows,0,id}'='81000000-0000-4000-8000-000000000063'
 and public.admin_search_operators('operator-qa-%','all')->>'total'='1'
 then 1 else 0 end as filters_precede_paging_and_old_accounts_searchable;
select 1/case when public.admin_search_operators('operator-qa-63@example.test','all')#>>'{rows,0,maskedEmail}'='o***@example.test'
 and position('operator-qa-63@example.test' in public.admin_search_operators('operator-qa-63@example.test','all')::text)=0 then 1 else 0 end as email_stays_masked;
select public.admin_set_operator_duty('81000000-0000-4000-8000-000000000002','cs',0,'81000000-0000-4000-8000-000000000100') as saved \gset
select 1/case when public.admin_set_operator_duty('81000000-0000-4000-8000-000000000002','cs',0,'81000000-0000-4000-8000-000000000100')=:'saved'::jsonb then 1 else 0 end as exact_retry;
select pg_temp.expect_operator_error($q$select public.admin_set_operator_duty('81000000-0000-4000-8000-000000000002','sales',0,'81000000-0000-4000-8000-000000000101')$q$,'operator_duty_changed');
select pg_temp.expect_operator_error($q$select public.admin_set_operator_duty('81000000-0000-4000-8000-000000000002','sales',0,'81000000-0000-4000-8000-000000000100')$q$,'operation_conflict');
select pg_temp.expect_operator_error($q$select public.admin_set_operator_duty('81000000-0000-4000-8000-000000000003','cs',0,'81000000-0000-4000-8000-000000000102')$q$,'operator_required');
select 1/case when public.admin_search_operators('operator-qa-002','staff')#>>'{rows,0,duty}'='cs'
 and public.admin_search_operators('operator-qa-002','staff')#>>'{rows,0,role}'='staff' then 1 else 0 end as duty_readback_does_not_grant_roles;
reset role;
select 1/case when (select count(*) from public.audit_log where id='81000000-0000-4000-8000-000000000100')=1 then 1 else 0 end as one_audit;
update public.profiles set suspended_at=now(),suspension_reason='합성 정지 필터' where id='81000000-0000-4000-8000-000000000002';
set local role authenticated;
select 1/case when public.admin_search_operators('operator-qa','operators','suspended')->>'total'='1'
 and public.admin_search_operators('operator-qa','operators','active')->>'total'='1' then 1 else 0 end as suspended_filter;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='합성 관리자 거절' where id='81000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_operator_error('select public.admin_search_operators()','operator_capability_required');
reset role;
rollback;
