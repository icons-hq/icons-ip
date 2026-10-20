\set ON_ERROR_STOP on
begin;
-- This capability test deliberately does not load the legacy regression helper.
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Capability tests must run without the legacy fixture helper';end if;
 if (select configured from private.operator_access_state where id) then
  raise exception 'Run operator capability fixtures in an unconfigured isolated test database';
 end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('bfc01300-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'operator-capability-'||n||'@example.test',now(),'{"testFixture":"operator-capability"}',
 jsonb_build_object('nickname','operator_cap_'||n),now(),now() from generate_series(1,10)n;
update public.profiles set role=case when right(id::text,2) in ('01','03','07') then 'admin'::public.user_role
 when right(id::text,2)='10' then 'user'::public.user_role else 'staff'::public.user_role end,
 nickname='operator_cap_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now()
where id::text like 'bfc01300-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
select ('bfc01300-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (array['owner','primary','deputy','influencer','agency','logistics'])[n] from generate_series(1,6)n;
insert into private.operator_legacy_cohort(profile_id,legacy_role) values
 ('bfc01300-0000-4000-8000-000000000007','admin'),('bfc01300-0000-4000-8000-000000000008','staff');
create temp table operator_role_expectations(n integer,manager_role text,caps text[]);
insert into operator_role_expectations values
 (1,'owner',array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage','sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read','promotion.manage','operators.manage','operators.transfer','platform.manage']),
 (2,'primary',array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage','sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read','promotion.manage','operators.manage','platform.manage']),
 (3,'deputy',array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage']),
 (4,'influencer',array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','sales.read','sales.restrictions','stats.read']),
 (5,'agency',array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','stats.read']),
 (6,'logistics',array['home','catalog.announcements']);
create temp table operator_rpc_cases as
select p.oid,p.oid::regprocedure::text as signature,c.capability,c.guard_kind,
 -- Actor-bound RPCs must receive the current actor before this probe can
 -- distinguish capability rejection from their expected account-binding guard.
 -- All business inputs remain NULL; the per-RPC suites cover their valid writes
 -- and wrong-actor rejection without weakening this role/capability matrix.
 format('select * from public.%I(%s)',p.proname,coalesce((select string_agg(
 case when t='uuid'::regtype and p.proargnames[ordinal] in ('p_expected_actor_id','p_actor_id') then 'auth.uid()'
 else 'NULL::'||format_type(t,null) end,',' order by ordinal)
 from unnest(p.proargtypes::oid[]) with ordinality types(t,ordinal)),'')) as invocation
from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
where c.guard_kind in ('read','write') and has_function_privilege('authenticated',p.oid,'execute');
grant select on operator_role_expectations,operator_rpc_cases to authenticated;

set local role authenticated;
do $$ declare r record; f record; access jsonb; actual text[]; failure text; code text; denied_count integer:=0; allowed_count integer:=0;
begin
 for r in select * from operator_role_expectations order by n loop
  perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-'||lpad(r.n::text,12,'0'),true);
  access:=public.admin_current_operator_access();
  select array_agg(value) into actual from jsonb_array_elements_text(access->'capabilities');
  if access->>'mode'<>'configured' or access->>'managerRole'<>r.manager_role or not(actual<@r.caps and actual@>r.caps) then
   raise exception 'role matrix mismatch %: %',r.manager_role,access; end if;
  for f in select * from operator_rpc_cases order by signature loop
   code:=null;failure:=null;
   begin execute f.invocation;
   exception when others then get stacked diagnostics code=returned_sqlstate,failure=message_text; end;
   if f.capability<>all(r.caps) then
    if code is distinct from '42501' then raise exception 'capability bypass role=% RPC=% SQLSTATE=% error=%',r.manager_role,f.signature,code,failure; end if;
    denied_count:=denied_count+1;
   else
    if code in ('42601','42703','42702','42P01','42883','42804') then raise exception 'RPC guard compile failure role=% RPC=% SQLSTATE=% error=%',r.manager_role,f.signature,code,failure; end if;
    if failure='operator_capability_required' then raise exception 'unexpected nested cap role=% RPC=%',r.manager_role,f.signature; end if;
    allowed_count:=allowed_count+1;
   end if;
  end loop;
 end loop;
 raise notice 'Role matrix + direct RPC entry coverage: % denied, % allowed/validated inputs',denied_count,allowed_count;
 -- A new raw staff account has no implicit compatibility authority.
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000009',true);
 if public.admin_current_operator_access()->>'mode'<>'none' or public.has_operator_capability('home') then raise exception 'new staff fallback'; end if;
 -- Compatibility preserves staff work but not prior admin-only mutations.
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000008',true);
 if public.admin_current_operator_access()->>'mode'<>'legacy' or not public.has_operator_capability('platform.manage')
  or public.has_operator_capability('platform.manage',true) or public.has_operator_capability('operators.manage') then raise exception 'legacy staff mismatch'; end if;
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000007',true);
 if not public.has_operator_capability('marketing.manage',true) or not public.has_operator_capability('operators.manage')
  or public.has_operator_capability('operators.transfer') then raise exception 'legacy admin mismatch'; end if;
 -- A raw admin explicitly assigned deputy does not retain financial/platform power.
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000003',true);
 if public.has_operator_capability('platform.manage') or public.has_operator_capability('sales.manage') then raise exception 'raw admin assignment escape'; end if;
 if public.admin_operator_store_settings()->'store' ? 'bank_transfer' then raise exception 'bank projection leaked'; end if;
 perform public.admin_goods_origin_options();perform public.admin_goods_ip_options();perform public.admin_curation_target_options();
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000006',true);
 if public.admin_operation_alerts()->'items'<>'[]'::jsonb or (public.admin_operation_alerts()->>'unreadCount')::integer<>0
  or public.admin_operation_tasks()<>'[]'::jsonb then raise exception 'logistics dashboard leak'; end if;
end $$;
reset role;

-- Actor-bound service upload entry points use the asset domain, not raw admin.
set local role service_role;
do $$ begin
 if not public.service_prepare_admin_artwork_upload('bfc01300-0000-4000-8000-000000000003',
  'catalog/good/bfc01350-0000-4000-8000-000000000001.webp','good','image/webp',128,now()+interval '5 minutes') then
  raise exception 'deputy good upload preparation denied';end if;
 if public.service_prepare_admin_artwork_upload('bfc01300-0000-4000-8000-000000000003',
  'catalog/ip/bfc01350-0000-4000-8000-000000000002.webp','ip','image/webp',128,now()+interval '5 minutes')
  or public.service_prepare_admin_artwork_upload('bfc01300-0000-4000-8000-000000000006',
  'catalog/good/bfc01350-0000-4000-8000-000000000003.webp','good','image/webp',128,now()+interval '5 minutes') then
  raise exception 'asset-domain service preparation bypass';end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000003',true);
do $$ begin
 if not public.can_stage_admin_artwork('catalog/good/bfc01350-0000-4000-8000-000000000001.webp') then
  raise exception 'owned allowed upload cannot stage';end if;
 begin perform public.admin_save_goods_preorder(null,null,null,'{"state":"active"}',null);raise exception 'deputy preorder activation allowed';
 exception when insufficient_privilege then if sqlerrm<>'preorder_admin_required' then raise;end if;end;
end $$;
reset role;
set local role service_role;
do $$ begin
 if not exists(select 1 from public.service_begin_admin_artwork_verification('bfc01300-0000-4000-8000-000000000003',
  'catalog/good/bfc01350-0000-4000-8000-000000000001.webp') where kind='good')
  or not public.service_verify_admin_artwork_upload('bfc01300-0000-4000-8000-000000000003',
  'catalog/good/bfc01350-0000-4000-8000-000000000001.webp',64) then
  raise exception 'allowed asset verification contract failed';end if;
end $$;
reset role;

-- Configured primary authority is independent of the historical raw staff role.
-- Peer primary/owner protection also applies to sanctions, including unsuspend.
set local role authenticated;
do $$ begin
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000002',true);
 if public.admin_member_moderation_context(array['bfc01300-0000-4000-8000-000000000003'::uuid])#>>'{0,canModerate}'<>'true'
  or public.admin_member_moderation_context(array['bfc01300-0000-4000-8000-000000000001'::uuid])#>>'{0,canModerate}'<>'false' then
  raise exception 'configured sanction controls mismatch';end if;
 perform public.admin_suspend_user('bfc01300-0000-4000-8000-000000000003','synthetic configured sanction');
 perform public.admin_unsuspend_user('bfc01300-0000-4000-8000-000000000003');
 begin perform public.admin_suspend_user('bfc01300-0000-4000-8000-000000000001','synthetic owner denial');raise exception 'owner sanction bypass';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000001',true);
 begin perform public.admin_suspend_user('bfc01300-0000-4000-8000-000000000002','synthetic primary denial');raise exception 'primary sanction bypass';exception when insufficient_privilege then null;end;
 begin perform public.admin_unsuspend_user('bfc01300-0000-4000-8000-000000000002');raise exception 'primary unsuspend bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Owner continuity is protected even through a direct profile/delete workflow.
do $$ begin
 begin update public.profiles set suspended_at=now() where id='bfc01300-0000-4000-8000-000000000001'; raise exception 'owner suspension allowed';
 exception when check_violation then if sqlerrm<>'operator_owner_transfer_required' then raise; end if; end;
 begin update public.profiles set role='user' where id='bfc01300-0000-4000-8000-000000000001'; raise exception 'owner downgrade allowed';
 exception when check_violation then if sqlerrm<>'operator_owner_transfer_required' then raise; end if; end;
 begin delete from auth.users where id='bfc01300-0000-4000-8000-000000000001'; raise exception 'owner deletion allowed';
 exception when check_violation then if sqlerrm<>'operator_owner_transfer_required' then raise; end if; end;
end $$;

-- RLS keeps own customer data, while only the permitted operating domains expand
-- access. These are synthetic records and are rolled back with the transaction.
insert into public.orders(id,user_id,status,total,address) values
 ('bfc01310-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000010','paid',1000,'{}'),
 ('bfc01310-0000-4000-8000-000000000002','bfc01300-0000-4000-8000-000000000007','pending',0,'{}');
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider) values
 ('bfc01320-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000010','order','bfc01310-0000-4000-8000-000000000001',1000,'paid','operator-capability-fixture-payment','operator-capability-fixture-payment','toss');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,status,stage,decided_by,provider_started_at,collection_required) values
 ('bfc01330-0000-4000-8000-000000000001','bfc01310-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000010','capability fixture cancellation','processing','processing','bfc01300-0000-4000-8000-000000000002',now(),false);
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values
 ('bfc01310-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000010','paid');
set local role authenticated;
do $$ declare cnt integer;
begin
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000003',true);
 select count(*) into cnt from public.orders where id::text like 'bfc01310%'; if cnt<>0 then raise exception 'deputy order RLS leak';end if;
 select count(*) into cnt from public.payment_summaries where id='bfc01320-0000-4000-8000-000000000001'; if cnt<>0 then raise exception 'deputy payment RLS leak';end if;
 select count(*) into cnt from public.store_settings; if cnt<>0 then raise exception 'deputy full store settings leak';end if;
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000004',true);
 select count(*) into cnt from public.orders where id::text like 'bfc01310%'; if cnt<>2 then raise exception 'influencer order read missing';end if;
 select count(*) into cnt from public.payment_summaries where id='bfc01320-0000-4000-8000-000000000001'; if cnt<>0 then raise exception 'influencer payment RLS leak';end if;
 if public.admin_operator_customer_history('bfc01300-0000-4000-8000-000000000010','orders',1)->>'total'<>'1' then raise exception 'customer order projection failed';end if;
 begin perform public.admin_operator_customer_history('bfc01300-0000-4000-8000-000000000010','claims',1);raise exception 'influencer claims history allowed'; exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000010',true);
 select count(*) into cnt from public.orders where id::text like 'bfc01310%'; if cnt<>1 then raise exception 'own customer order visibility changed';end if;
 select count(*) into cnt from public.payment_summaries where id='bfc01320-0000-4000-8000-000000000001'; if cnt<>1 then raise exception 'own payment visibility changed';end if;
end $$;
reset role;

-- The service starts with current authority, then may complete only that exact
-- authorized request after the manager loses sales access. Provider evidence is
-- synthetic here; no payment provider or external transaction is contacted.
set local role service_role;
select public.assert_order_cancellation_reconciliation_allowed('bfc01330-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000002');
reset role;
update private.operator_memberships set manager_role='deputy',revision=revision+1 where profile_id='bfc01300-0000-4000-8000-000000000002';
set local role service_role;
do $$ begin
 begin perform public.assert_order_cancellation_reconciliation_allowed('bfc01330-0000-4000-8000-000000000001','bfc01300-0000-4000-8000-000000000002');raise exception 'new work after revocation';exception when insufficient_privilege then null;end;
 begin perform public.complete_order_cancellation_request('bfc01330-0000-4000-8000-000000000001',array['operator-capability-fixture-payment'],'bfc01300-0000-4000-8000-000000000009');raise exception 'completion actor binding lost';exception when insufficient_privilege then null;end;
 perform public.complete_order_cancellation_request('bfc01330-0000-4000-8000-000000000001',array['operator-capability-fixture-payment'],'bfc01300-0000-4000-8000-000000000002');
end $$;
reset role;
do $$ begin
 if (select status from public.orders where id='bfc01310-0000-4000-8000-000000000001')<>'canceled'
  or (select status from public.payments where id='bfc01320-0000-4000-8000-000000000001')<>'refunded'
  or not exists(select 1 from public.refunds where payment_id='bfc01320-0000-4000-8000-000000000001' and status='done' and amount=1000) then
  raise exception 'authorized provider completion lost after role revocation';end if;
 -- The old broad role setter and private authority storage are never public APIs.
 if has_function_privilege('authenticated','public.admin_set_user_role(uuid,public.user_role)','execute')
  or has_function_privilege('service_role','public.admin_set_user_role(uuid,public.user_role)','execute')
  or has_function_privilege('authenticated','private.has_operator_capability(uuid,text,boolean)','execute')
  or has_table_privilege('authenticated','private.operator_memberships','select') then raise exception 'authority ACL leak';end if;
end $$;
-- A completed authorization receipt must not prevent the former operator from
-- leaving the service after their manager membership is revoked.
delete from private.operator_memberships where profile_id='bfc01300-0000-4000-8000-000000000002';
update public.profiles set role='user' where id='bfc01300-0000-4000-8000-000000000002';
-- Existing audit/decision retention has its own profile references. Clear only
-- this transaction's synthetic references to isolate the new receipt's FK rule;
-- this is not a substitute for the application's account-erasure workflow.
update public.audit_log set actor_id=null where actor_id='bfc01300-0000-4000-8000-000000000002';
update public.order_cancellation_requests set decided_by=null where decided_by='bfc01300-0000-4000-8000-000000000002';
delete from auth.users where id='bfc01300-0000-4000-8000-000000000002';
do $$ begin
 if exists(select 1 from public.profiles where id='bfc01300-0000-4000-8000-000000000002')
  or not exists(select 1 from private.operator_cancellation_authorizations where request_id='bfc01330-0000-4000-8000-000000000001' and actor_id='bfc01300-0000-4000-8000-000000000002') then
  raise exception 'former operator deletion or completion receipt retention failed';end if;
end $$;
update private.operator_access_state set configured=true,revision=revision+1 where id;
set constraints private.operator_owner_membership_invariant,private.operator_owner_setup_invariant immediate;
select set_config('request.jwt.claim.sub','bfc01300-0000-4000-8000-000000000007',true);
do $$ begin
 if public.admin_current_operator_access()->>'mode'<>'none' then raise exception 'legacy fallback survived activation';end if;
 begin delete from private.operator_memberships where profile_id='bfc01300-0000-4000-8000-000000000001';raise exception 'last owner removed';
 exception when check_violation then if sqlerrm<>'operator_owner_required' then raise;end if;end;
end $$;
rollback;
