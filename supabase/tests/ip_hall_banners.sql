\set ON_ERROR_STOP on
-- L8b (#574, IP-06): PC/mobile IP hall banner artwork. Declarative ACL and
-- contract assertions, audited RPC writes, artwork-claim enforcement for the
-- RPC and for direct table writes, no-op re-saves and public read.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;end $$;

-- Sealed: only authenticated may call the RPC; the trigger helper has no grants.
select 1/case when has_function_privilege('authenticated','public.admin_save_ip_hall_banner(text,text,text)','execute')
 and not has_function_privilege('anon','public.admin_save_ip_hall_banner(text,text,text)','execute')
 and not has_function_privilege('service_role','public.admin_save_ip_hall_banner(text,text,text)','execute')
 and not has_function_privilege('public','public.admin_save_ip_hall_banner(text,text,text)','execute')
 then 1 else 0 end as rpc_acl;
select 1/case when bool_and(not has_function_privilege(r,'private.guard_ip_hall_banner_artwork()','execute')) then 1 else 0 end as trigger_helper_sealed
 from unnest(array['anon','authenticated','service_role'])r;
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where c.signature='public.admin_save_ip_hall_banner(text,text,text)' and c.capability='platform.manage' and c.guard_kind='write'
 and c.body_md5=md5(p.prosrc)) then 1 else 0 end as rpc_contract_registered;

insert into public.verticals(key,label,color) values('l8b-test','L8b 테스트','#111111') on conflict (key) do nothing;
insert into public.ips(id,title,vertical_key) values('l8b-hall-ip','L8b 배너 IP','l8b-test');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('97500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','ip-hall-banner-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '97500000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('97500000-0000-4000-8000-000000000001','primary'),('97500000-0000-4000-8000-000000000002','deputy'),('97500000-0000-4000-8000-000000000003','primary');
update private.operator_access_state set configured=true where id;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/ip/97510000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','97500000-0000-4000-8000-000000000001','ip','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,5)n;
-- A claim owned by another operator and a curation-kind claim are never usable here.
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at) values
 ('catalog/ip/97510000-0000-4000-8000-000000000009.webp','97500000-0000-4000-8000-000000000003','ip','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now()),
 ('catalog/curation/97510000-0000-4000-8000-000000000010.webp','97500000-0000-4000-8000-000000000001','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now());

select set_config('request.jwt.claim.sub','97500000-0000-4000-8000-000000000001',true);
set local role authenticated;
-- 1. Save PC + mobile; both claims are consumed and one audit row is written.
select public.admin_save_ip_hall_banner('l8b-hall-ip',' public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp ',
 'public-media/catalog/ip/97510000-0000-4000-8000-000000000002.webp') is not null as saved;
reset role;
select 1/case when hall_banner_image_path='public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp'
 and hall_banner_mobile_image_path='public-media/catalog/ip/97510000-0000-4000-8000-000000000002.webp' then 1 else 0 end as paths_saved_trimmed
 from public.ips where id='l8b-hall-ip';
select 1/case when count(*)=2 then 1 else 0 end as claims_attached from public.admin_artwork_upload_claims
 where path in ('catalog/ip/97510000-0000-4000-8000-000000000001.webp','catalog/ip/97510000-0000-4000-8000-000000000002.webp') and status='attached';
select 1/case when count(*)=1 then 1 else 0 end as audited_once from public.audit_log where action='catalog.ip.hall_banner' and target='ips:l8b-hall-ip';
set local role authenticated;
-- 2. Re-saving the same pair (or swapping it) needs no new claim; a no-op writes no audit.
select public.admin_save_ip_hall_banner('l8b-hall-ip','public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp',
 'public-media/catalog/ip/97510000-0000-4000-8000-000000000002.webp') is not null as same_pair;
select public.admin_save_ip_hall_banner('l8b-hall-ip','public-media/catalog/ip/97510000-0000-4000-8000-000000000002.webp',
 'public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp') is not null as swapped_pair;
reset role;
select 1/case when count(*)=2 then 1 else 0 end as noop_not_audited from public.audit_log where action='catalog.ip.hall_banner' and target='ips:l8b-hall-ip';
set local role authenticated;
-- 3. Clearing one side keeps the other; empty strings mean "no banner".
select public.admin_save_ip_hall_banner('l8b-hall-ip','  ',
 'public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp') is not null as cleared_pc;
reset role;
select 1/case when hall_banner_image_path is null and hall_banner_mobile_image_path='public-media/catalog/ip/97510000-0000-4000-8000-000000000001.webp'
 then 1 else 0 end as one_side_cleared from public.ips where id='l8b-hall-ip';
set local role authenticated;
-- 4. Invalid paths, foreign or wrong-kind claims and unknown IPs are refused.
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('l8b-hall-ip','/generated/ip/banner.webp',null)$q$,'invalid_ip_banner_image_path');
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('l8b-hall-ip','public-media/catalog/curation/97510000-0000-4000-8000-000000000010.webp',null)$q$,'invalid_ip_banner_image_path');
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('l8b-hall-ip','public-media/catalog/ip/97510000-0000-4000-8000-000000000009.webp',null)$q$,'unverified_artwork');
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('l8b-hall-ip','public-media/catalog/ip/97510000-0000-4000-8000-000000000099.webp',null)$q$,'unverified_artwork');
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('missing-ip',null,null)$q$,'catalog_record_missing');
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner(null,null,null)$q$,'invalid_ip_id');
-- 5. Operators have no UPDATE grant on ips (writes go through audited RPCs).
--    Server-side writers that do (service_role) still need the actor's claim.
reset role;
select 1/case when not has_table_privilege('authenticated','public.ips','update') then 1 else 0 end as no_direct_operator_update;
set local role service_role;
select pg_temp.expect_error($q$update public.ips set hall_banner_image_path='public-media/catalog/ip/97510000-0000-4000-8000-000000000009.webp' where id='l8b-hall-ip'$q$,'unverified_artwork');
update public.ips set hall_banner_image_path='public-media/catalog/ip/97510000-0000-4000-8000-000000000003.webp' where id='l8b-hall-ip';
reset role;
select 1/case when status='attached' then 1 else 0 end as direct_write_consumed_claim from public.admin_artwork_upload_claims
 where path='catalog/ip/97510000-0000-4000-8000-000000000003.webp';
-- The table check refuses non-IP keys even without the RPC.
select pg_temp.expect_error($q$update public.ips set hall_banner_mobile_image_path='public-media/catalog/curation/97510000-0000-4000-8000-000000000010.webp' where id='l8b-hall-ip'$q$,'23514');
-- 6. Capability: a deputy (no platform.manage) is denied before any input check.
select set_config('request.jwt.claim.sub','97500000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_error($q$select public.admin_save_ip_hall_banner('l8b-hall-ip',null,null)$q$,'operator_capability_required');
reset role;
-- 7. Anonymous visitors read the banner fields with the public IP row.
set local role anon;
select 1/case when hall_banner_mobile_image_path is not null then 1 else 0 end as anon_reads_banner from public.ips where id='l8b-hall-ip';
reset role;
rollback;
