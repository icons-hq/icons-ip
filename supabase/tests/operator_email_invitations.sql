\set ON_ERROR_STOP on
begin;
-- Synthetic recipients, outbox rows and capability changes all roll back.
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','invite-fixture-'||n||'@example.test',case when n=5 then null else now() end,'{}','{}',now(),now() from generate_series(1,8) n;
update public.profiles set role=(case when right(id::text,12)='000000000001' then 'admin' when right(id::text,12)='000000000002' then 'staff' else 'user' end)::public.user_role,
 nickname='invite-fixture-'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '84000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('84000000-0000-4000-8000-000000000001','owner'),('84000000-0000-4000-8000-000000000002','deputy');
update private.operator_access_state set configured=true where id;
create function pg_temp.expect_invitation_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q; exception when others then if sqlerrm=expected or sqlstate=expected then return; end if; raise; end; raise exception 'expected error: %',expected; end $$;
create function pg_temp.invitation_entry(n integer,email_n integer default null,role_name text default 'deputy') returns jsonb language sql immutable as $$
 select jsonb_build_object('id',('85000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'email','invite-fixture-'||coalesce(email_n,n)||'@example.test','name','합성 초대 '||n,'managerRole',role_name,'duty','cs',
 'tokenHash',encode(extensions.digest('synthetic-token-'||n,'sha256'),'hex'),'sourceDigest',encode(extensions.digest('synthetic-source-'||n,'sha256'),'hex'),'recipientDigest',encode(extensions.digest('synthetic-recipient-'||coalesce(email_n,n),'sha256'),'hex'));
$$;
select 1/case when not has_function_privilege('anon','public.get_my_operator_invitation(text)','execute')
 and not has_function_privilege('authenticated','public.service_prepare_operator_invitation_email(uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_create_operator_invitations(jsonb,bigint,uuid)','execute')
 and not has_function_privilege('authenticated','private.insert_operator_invitation(jsonb,uuid,timestamptz)','execute')
 and not has_table_privilege('authenticated','private.operator_invitations','select') then 1 else 0 end as private_tokens_and_recipient_boundary;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_invitation_error('select public.admin_list_operator_invitations()','operator_capability_required');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(3)),1,'86000000-0000-4000-8000-000000000001')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations('[]',1,'86000000-0000-4000-8000-000000000001')$q$,'operator_invitation_batch_limit');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(3),pg_temp.invitation_entry(13,3)),1,'86000000-0000-4000-8000-000000000001')$q$,'operator_invitation_duplicate');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(3,null,'owner')),1,'86000000-0000-4000-8000-000000000001')$q$,'invalid_operator_invitation');
select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(3),pg_temp.invitation_entry(4,null,'primary'),pg_temp.invitation_entry(5,null,'agency')),1,'86000000-0000-4000-8000-000000000101') as created \gset
select 1/case when public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(5,null,'agency'),pg_temp.invitation_entry(3),pg_temp.invitation_entry(4,null,'primary')),1,'86000000-0000-4000-8000-000000000101')=:'created'::jsonb
 and public.admin_list_operator_invitations('합성 초대')->>'total'='3'
 and position('tokenHash' in public.admin_list_operator_invitations()::text)=0
 and position('invite-fixture-3@' in public.admin_list_operator_invitations()::text)=0 then 1 else 0 end as exact_batch_replay_and_masked_projection;
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(13,3)),2,'86000000-0000-4000-8000-000000000102')$q$,'operator_invitation_pending');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(1)),2,'86000000-0000-4000-8000-000000000102')$q$,'operator_already_manager');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(6)),1,'86000000-0000-4000-8000-000000000102')$q$,'PT409');

select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000008',true);
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(3)->>'tokenHash')->>'status'='unavailable' then 1 else 0 end as other_recipient_hidden;
select pg_temp.expect_invitation_error(format('select public.accept_operator_invitation(%L,%L)',pg_temp.invitation_entry(3)->>'tokenHash','86000000-0000-4000-8000-000000000201'),'operator_invitation_unavailable');
reset role;
update public.profiles set email='invite-fixture-3@example.test' where id='84000000-0000-4000-8000-000000000008';
set local role authenticated;
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(3)->>'tokenHash')->>'status'='unavailable' then 1 else 0 end as mutable_profile_email_cannot_claim_invitation;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000005',true);
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(5)->>'tokenHash')->>'status'='email_confirmation_required' then 1 else 0 end as unverified_email_blocked;
select pg_temp.expect_invitation_error(format('select public.accept_operator_invitation(%L,%L)',pg_temp.invitation_entry(5)->>'tokenHash','86000000-0000-4000-8000-000000000201'),'operator_invitation_email_unverified');

select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select public.admin_cancel_operator_invitation('85000000-0000-4000-8000-000000000004',1,2,'86000000-0000-4000-8000-000000000102') as cancelled \gset
select 1/case when public.admin_cancel_operator_invitation('85000000-0000-4000-8000-000000000004',1,2,'86000000-0000-4000-8000-000000000102')=:'cancelled'::jsonb then 1 else 0 end as cancellation_exact_replay;
select pg_temp.expect_invitation_error($q$select public.admin_reissue_operator_invitation('85000000-0000-4000-8000-000000000004',pg_temp.invitation_entry(14,8),2,3,'86000000-0000-4000-8000-000000000103')$q$,'operator_invitation_reissue_invalid');
select public.admin_reissue_operator_invitation('85000000-0000-4000-8000-000000000004',pg_temp.invitation_entry(14,4,'primary'),2,3,'86000000-0000-4000-8000-000000000103') as reissued \gset
select 1/case when public.admin_reissue_operator_invitation('85000000-0000-4000-8000-000000000004',pg_temp.invitation_entry(14,4,'primary'),2,3,'86000000-0000-4000-8000-000000000103')=:'reissued'::jsonb then 1 else 0 end as reissue_exact_replay;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000004',true);
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(4)->>'tokenHash')->>'status'='unavailable'
 and public.get_my_operator_invitation(pg_temp.invitation_entry(14,4)->>'tokenHash')->>'status'='pending' then 1 else 0 end as old_link_invalidated_new_link_pending;

select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000003',true);
select public.accept_operator_invitation(pg_temp.invitation_entry(3)->>'tokenHash','86000000-0000-4000-8000-000000000201') as accepted \gset
select 1/case when public.accept_operator_invitation(pg_temp.invitation_entry(3)->>'tokenHash','86000000-0000-4000-8000-000000000201')=:'accepted'::jsonb
 and public.admin_current_operator_access()->>'managerRole'='deputy' then 1 else 0 end as accepted_once_then_exact_receipt;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
select public.admin_change_operator_role('84000000-0000-4000-8000-000000000003',null,1,5,'86000000-0000-4000-8000-000000000104');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000003',true);
select 1/case when public.accept_operator_invitation(pg_temp.invitation_entry(3)->>'tokenHash','86000000-0000-4000-8000-000000000201')->>'accessActive'='false'
 and public.admin_current_operator_access()->>'mode'='none' then 1 else 0 end as accepted_link_never_restores_revoked_access;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000004',true);
select public.accept_operator_invitation(pg_temp.invitation_entry(14,4)->>'tokenHash','86000000-0000-4000-8000-000000000202');
select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(6),pg_temp.invitation_entry(7)),7,'86000000-0000-4000-8000-000000000105');
reset role;
set local role service_role;
select public.service_prepare_operator_invitation_email('85000000-0000-4000-8000-000000000006','84000000-0000-4000-8000-000000000004') as dispatch \gset
reset role;
select 1/case when (:'dispatch'::jsonb)->>'kind'='ready' then 1 else 0 end as dispatch_prepared_while_inviter_authorized;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_change_operator_role('84000000-0000-4000-8000-000000000004','deputy',1,8,'86000000-0000-4000-8000-000000000106');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000006',true);
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(6)->>'tokenHash')->>'status'='unavailable' then 1 else 0 end as inviter_demotion_blocks_acceptance;
select pg_temp.expect_invitation_error(format('select public.accept_operator_invitation(%L,%L)',pg_temp.invitation_entry(6)->>'tokenHash','86000000-0000-4000-8000-000000000203'),'operator_invitation_unavailable');
reset role;
select 1/case when (select count(*) from private.operator_invitations where created_by='84000000-0000-4000-8000-000000000004' and status='cancelled' and cancellation_reason='inviter_access_revoked')=2 then 1 else 0 end as pending_invites_cancelled_on_manage_loss;
set local role service_role;
select 1/case when public.claim_email_intent_dispatch((:'dispatch'::jsonb->>'intentId')::uuid,pg_temp.invitation_entry(6)->>'recipientDigest')->>'kind'='disabled'
 and public.service_finish_operator_invitation_email('85000000-0000-4000-8000-000000000006',(:'dispatch'::jsonb->>'claimId')::uuid,'delivery_disabled')
 and public.service_prepare_operator_invitation_email('85000000-0000-4000-8000-000000000006','84000000-0000-4000-8000-000000000001')->>'kind'='unavailable' then 1 else 0 end as dispatch_claim_rechecks_authority_but_existing_receipt_can_finish;
reset role;
update auth.users set email_confirmed_at=now() where id='84000000-0000-4000-8000-000000000005';
update private.operator_invitations set created_at=created_at-interval '8 days',expires_at=expires_at-interval '8 days' where id='85000000-0000-4000-8000-000000000005';
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select 1/case when public.get_my_operator_invitation(pg_temp.invitation_entry(5)->>'tokenHash')->>'status'='unavailable' then 1 else 0 end as expired_link_cannot_be_accepted;
select pg_temp.expect_invitation_error(format('select public.accept_operator_invitation(%L,%L)',pg_temp.invitation_entry(5)->>'tokenHash','86000000-0000-4000-8000-000000000203'),'operator_invitation_unavailable');
reset role;
select 1/case when (select count(*) from public.audit_log where id::text like '86000000-0000-4000-8000-%')=8
 and not exists(select 1 from public.audit_log where id::text like '86000000-0000-4000-8000-%' and (diff::text like '%@example.test%' or diff::text like '%tokenHash%' or diff::text like '%synthetic-token%'))
 and (select count(*) from private.email_intents where id in(select email_intent_id from private.operator_invitations where id::text like '85000000-0000-4000-8000-%'))=6 then 1 else 0 end as exact_audits_and_outbox_without_token_or_email;
-- At 999 assigned non-owner managers, a two-recipient batch must roll back
-- entirely. One pending invitation fills slot 1000 and acceptance replaces it.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('84000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','invite-capacity-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1000,1996) n;
update public.profiles set role='staff' where id::text like '84000000-0000-4000-8000-%' and right(id::text,12)::bigint between 1000 and 1996;
insert into private.operator_memberships(profile_id,manager_role) select id,'logistics' from public.profiles where id::text like '84000000-0000-4000-8000-%' and right(id::text,12)::bigint between 1000 and 1996;
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(8),pg_temp.invitation_entry(9)),9,'86000000-0000-4000-8000-000000000107')$q$,'operator_limit');
reset role;
select 1/case when not exists(select 1 from private.operator_invitations where id in('85000000-0000-4000-8000-000000000008','85000000-0000-4000-8000-000000000009')) then 1 else 0 end as capacity_batch_atomicity;
set local role authenticated;
select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(8)),9,'86000000-0000-4000-8000-000000000107');
select pg_temp.expect_invitation_error($q$select public.admin_create_operator_invitations(jsonb_build_array(pg_temp.invitation_entry(9)),10,'86000000-0000-4000-8000-000000000108')$q$,'operator_limit');
select set_config('request.jwt.claim.sub','84000000-0000-4000-8000-000000000008',true);
select public.accept_operator_invitation(pg_temp.invitation_entry(8)->>'tokenHash','86000000-0000-4000-8000-000000000203');
reset role;
select 1/case when (select count(*) from private.operator_memberships where manager_role<>'owner')=1000
 and (select status from private.operator_invitations where id='85000000-0000-4000-8000-000000000008')='accepted' then 1 else 0 end as acceptance_replaces_reserved_capacity;
rollback;
