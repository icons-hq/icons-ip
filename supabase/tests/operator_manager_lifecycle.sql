\set ON_ERROR_STOP on
begin;
-- Every fixture and the temporary setup transition roll back together.
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','manager-lifecycle-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,9) n;
update public.profiles set role=(case when right(id::text,12) in ('000000000001','000000000002') then 'admin' when right(id::text,12)='000000000009' then 'user' else 'staff' end)::public.user_role,
  nickname='manager-lifecycle-'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like '82000000-0000-4000-8000-%';
update public.profiles set suspended_at=now(),suspension_reason='합성 정지 계정' where id='82000000-0000-4000-8000-000000000008';
insert into private.operator_legacy_cohort(profile_id,legacy_role)
select id,role from public.profiles where id::text like '82000000-0000-4000-8000-%' and role in ('staff','admin');
create function pg_temp.expect_manager_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q; exception when others then if sqlerrm=expected or sqlstate=expected then return; end if; raise; end; raise exception 'expected error: %',expected; end $$;
select 1/case when not has_function_privilege('anon','public.admin_activate_operator_access(jsonb,bigint,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_change_operator_role(uuid,text,integer,bigint,uuid)','execute')
  and not has_function_privilege('authenticated','public.admin_set_user_role(uuid,public.user_role)','execute')
  and not has_function_privilege('authenticated','private.operator_directory_rows(uuid[])','execute')
  and not has_table_privilege('authenticated','private.operator_memberships','select') then 1 else 0 end as sealed_authorization_boundary;

select jsonb_agg(jsonb_build_object('profileId',id,'managerRole',case
  when id='82000000-0000-4000-8000-000000000001' then 'primary'
  when id='82000000-0000-4000-8000-000000000002' then 'owner'
  when id='82000000-0000-4000-8000-000000000003' then 'primary'
  when id='82000000-0000-4000-8000-000000000004' then 'deputy'
  when id='82000000-0000-4000-8000-000000000005' then 'influencer'
  when id='82000000-0000-4000-8000-000000000006' then 'agency'
  when id='82000000-0000-4000-8000-000000000007' then 'logistics'
  else null end) order by id) as mapping from public.profiles where role in ('staff','admin') \gset

select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.expect_manager_error('select public.admin_search_operators()','operator_capability_required');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_search_operators('manager-lifecycle')->>'mode'='legacy'
  and public.admin_search_operators('manager-lifecycle')->>'total'='8'
  and jsonb_array_length(public.admin_search_operators()->'setupCandidates')=jsonb_array_length(:'mapping'::jsonb)
  then 1 else 0 end as complete_setup_roster;
select pg_temp.expect_manager_error($q$select public.admin_activate_operator_access('[]',1,'82000000-0000-4000-8000-000000000101')$q$,'operator_setup_incomplete');
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',(:'mapping'::jsonb)-0,'82000000-0000-4000-8000-000000000101'),'operator_setup_incomplete');
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',(:'mapping'::jsonb)||jsonb_build_array((:'mapping'::jsonb)->0),'82000000-0000-4000-8000-000000000101'),'operator_setup_incomplete');
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',
  (select jsonb_agg(case when value->>'profileId'='82000000-0000-4000-8000-000000000002' then value||'{"managerRole":"primary"}' else value end) from jsonb_array_elements(:'mapping'::jsonb)),
  '82000000-0000-4000-8000-000000000101'),'operator_owner_required');
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',
  (select jsonb_agg(case when value->>'profileId'='82000000-0000-4000-8000-000000000001' then value||'{"managerRole":"deputy"}' else value end) from jsonb_array_elements(:'mapping'::jsonb)),
  '82000000-0000-4000-8000-000000000101'),'operator_actor_mapping_required');
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',
  (select jsonb_agg(case when value->>'profileId'='82000000-0000-4000-8000-000000000008' then value||'{"managerRole":"deputy"}' else value end) from jsonb_array_elements(:'mapping'::jsonb)),
  '82000000-0000-4000-8000-000000000101'),'operator_suspended_target');
select public.admin_activate_operator_access(:'mapping'::jsonb,1,'82000000-0000-4000-8000-000000000102') as activated \gset
select 1/case when public.admin_activate_operator_access(:'mapping'::jsonb,1,'82000000-0000-4000-8000-000000000102')=:'activated'::jsonb
  and public.admin_current_operator_access()->>'managerRole'='primary'
  and public.admin_current_operator_access()->>'revision'='2'
  and public.admin_search_operators('manager-lifecycle')->>'total'='7'
  and jsonb_array_length(public.admin_search_operators()->'setupCandidates')=0
  and public.admin_search_operators('manager-lifecycle-002')#>>'{rows,0,duty}'='representative' then 1 else 0 end as activation_replay_and_readback;
select pg_temp.expect_manager_error(format('select public.admin_activate_operator_access(%L,1,%L)',:'mapping'::jsonb,'82000000-0000-4000-8000-000000000103'),'PT409');

select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000001','deputy',1,2,'82000000-0000-4000-8000-000000000104')$q$,'operator_self_change_denied');
select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000002','deputy',1,2,'82000000-0000-4000-8000-000000000104')$q$,'operator_owner_change_denied');
select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000003',null,1,2,'82000000-0000-4000-8000-000000000104')$q$,'operator_primary_revoke_denied');
select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000004','owner',1,2,'82000000-0000-4000-8000-000000000104')$q$,'invalid_operator_role');
select public.admin_change_operator_role('82000000-0000-4000-8000-000000000003','deputy',1,2,'82000000-0000-4000-8000-000000000105') as lowered \gset
select 1/case when public.admin_change_operator_role('82000000-0000-4000-8000-000000000003','deputy',1,2,'82000000-0000-4000-8000-000000000105')=:'lowered'::jsonb then 1 else 0 end as peer_change_exact_replay;
select public.admin_change_operator_role('82000000-0000-4000-8000-000000000003',null,2,3,'82000000-0000-4000-8000-000000000106') as revoked \gset
select 1/case when public.admin_change_operator_role('82000000-0000-4000-8000-000000000003',null,2,3,'82000000-0000-4000-8000-000000000106')=:'revoked'::jsonb then 1 else 0 end as revocation_exact_replay_after_membership_deleted;
select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000004','primary',1,2,'82000000-0000-4000-8000-000000000107')$q$,'PT409');
select pg_temp.expect_manager_error($q$select public.admin_change_operator_role('82000000-0000-4000-8000-000000000004','primary',1,4,'82000000-0000-4000-8000-000000000106')$q$,'operation_conflict');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000003',true);
select 1/case when public.admin_current_operator_access()->>'mode'='none' then 1 else 0 end as old_session_loses_access_without_token_refresh;
select pg_temp.expect_manager_error('select public.admin_search_operators()','operator_capability_required');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
select public.admin_change_operator_role('82000000-0000-4000-8000-000000000004','primary',1,4,'82000000-0000-4000-8000-000000000107');
select public.admin_set_operator_duty('82000000-0000-4000-8000-000000000001','cs',0,'82000000-0000-4000-8000-000000000108') as duty_saved \gset
select 1/case when public.admin_set_operator_duty('82000000-0000-4000-8000-000000000001','cs',0,'82000000-0000-4000-8000-000000000108')=:'duty_saved'::jsonb
  and public.admin_current_operator_access()->>'revision'='5' then 1 else 0 end as self_duty_allowed_without_authority_change;
select pg_temp.expect_manager_error($q$select public.admin_set_operator_duty('82000000-0000-4000-8000-000000000002','cs',0,'82000000-0000-4000-8000-000000000109')$q$,'operator_owner_change_denied');
select pg_temp.expect_manager_error($q$select public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000004',1,2,5,'82000000-0000-4000-8000-000000000110')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000004',true);
select 1/case when public.admin_search_operators('manager-lifecycle-004')#>>'{rows,0,role}'='staff'
  and public.admin_current_operator_access()->'capabilities' ? 'operators.manage' then 1 else 0 end as primary_role_does_not_require_raw_admin;
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_manager_error($q$select public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000005',1,1,5,'82000000-0000-4000-8000-000000000110')$q$,'operator_primary_target_required');
reset role;
update public.profiles set suspended_at=now(),suspension_reason='합성 승계 거절' where id='82000000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.expect_manager_error($q$select public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000004',1,2,5,'82000000-0000-4000-8000-000000000110')$q$,'operator_suspended_target');
reset role;
update public.profiles set suspended_at=null,suspension_reason=null where id='82000000-0000-4000-8000-000000000004';
set local role authenticated;
select public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000004',1,2,5,'82000000-0000-4000-8000-000000000110') as transferred \gset
select 1/case when public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000004',1,2,5,'82000000-0000-4000-8000-000000000110')=:'transferred'::jsonb
  and public.admin_current_operator_access()->>'managerRole'='primary'
  and not(public.admin_current_operator_access()->'capabilities' ? 'operators.transfer')
  and public.admin_search_operators('manager-lifecycle-004')#>>'{rows,0,duty}'='representative'
  then 1 else 0 end as transfer_receipt_replay_after_old_owner_demoted;
select pg_temp.expect_manager_error($q$select public.admin_transfer_operator_owner('82000000-0000-4000-8000-000000000001',2,1,6,'82000000-0000-4000-8000-000000000111')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_manager_error('select public.admin_search_operators()','operator_capability_required');
select 1/case when public.admin_current_operator_access()->'capabilities' ? 'sales.read'
  and not(public.admin_current_operator_access()->'capabilities' ? 'sales.manage') then 1 else 0 end as influencer_scope_stays_separate;
select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000007',true);
select 1/case when public.admin_current_operator_access()->'capabilities' ? 'catalog.announcements'
  and not(public.admin_current_operator_access()->'capabilities' ? 'sales.manage') then 1 else 0 end as logistics_is_not_dispatch;
reset role;
select 1/case when (select count(*) from private.operator_memberships where manager_role='owner')=1
  and (select manager_role from private.operator_memberships where profile_id='82000000-0000-4000-8000-000000000004')='owner'
  and (select role from public.profiles where id='82000000-0000-4000-8000-000000000003')='user'
  and (select count(*) from public.audit_log where id::text like '82000000-0000-4000-8000-%')=6 then 1 else 0 end as one_owner_six_distinct_audits;
rollback;
