\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('78000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','loyalty-policy-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,3) n;
update public.profiles set role=(case when id='78000000-0000-4000-8000-000000000001' then 'admin' when id='78000000-0000-4000-8000-000000000002' then 'staff' else 'user' end)::public.user_role,
 birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '78000000-0000-4000-8000-%';
insert into public.ips(id,title,vertical_key,published_at) values('loyalty-policy-qa-ip','합성 등급 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock_qty) values('loyalty-policy-qa-good','loyalty-policy-qa-ip','합성 등급 상품','문구',1000,20000);
select pg_temp.publish_goods_kc_fixture('loyalty-policy-qa-good');
insert into public.orders(id,user_id,status,total,address,created_at)
select ('79000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'78000000-0000-4000-8000-000000000003',
 case when n=1003 then 'canceled'::public.order_status else 'paid'::public.order_status end,1000,'{}',case when n=1002 then now()-interval '91 days' else now()-interval '1 day' end
 from generate_series(1,1003) n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select o.id,'loyalty-policy-qa-good',v.id,5,1000,'합성 등급 상품','문구','loyalty-policy-qa-ip'
from public.orders o cross join public.goods_variants v where o.id::text like '79000000-0000-4000-8000-%' and v.good_id='loyalty-policy-qa-good' and v.is_default;

select 1/case when not has_table_privilege('authenticated','public.loyalty_settings','select')
 and not has_function_privilege('anon','public.get_my_loyalty_status()','execute')
 and not has_function_privilege('service_role','public.admin_save_loyalty_policy(jsonb,integer,uuid)','execute')
 and not has_function_privilege('authenticated','private.loyalty_activity(uuid)','execute') then 1 else 0 end as sealed_boundaries;
create function pg_temp.expect_loyalty_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q; exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and expected in ('forbidden','staff_required','staff required','staff access required','admin_required','admin required','purchase_cost_admin_required') then return;end if; if sqlerrm=expected then return; end if; raise; end; raise exception 'expected error: %',expected; end $$;

select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select 1/case when public.get_my_loyalty_status()->>'windowSpend'='1001000'
 and public.get_my_loyalty_status()->>'windowItemCount'='1001' and public.get_my_loyalty_status()->>'grade'='welcome'
 then 1 else 0 end as aggregate_over_1000_rows_and_read_only;
select pg_temp.expect_loyalty_error('select public.admin_get_loyalty_policy()','admin_required');
reset role;
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_loyalty_error('select public.admin_get_loyalty_policy()','admin_required');
reset role;
select set_config('request.jwt.claim.sub','78000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_get_loyalty_policy()#>>'{policy,revision}' as revision \gset
select public.admin_get_loyalty_policy()#>'{policy,tiers}' as original_tiers \gset
select '[{"grade":"silver","enabled":true,"amount":2000000,"itemCount":1000},{"grade":"gold","enabled":true,"amount":3000000,"itemCount":1002},{"grade":"platinum","enabled":true,"amount":4000000,"itemCount":2000}]'::jsonb as configured_tiers \gset
select public.admin_save_loyalty_policy(:'configured_tiers',:revision,'78000000-0000-4000-8000-000000000010') as saved \gset
select 1/case when public.admin_save_loyalty_policy(:'configured_tiers',:revision,'78000000-0000-4000-8000-000000000010')=:'saved'::jsonb then 1 else 0 end as retry_returns_exact_saved_result;
select pg_temp.expect_loyalty_error(format('select public.admin_save_loyalty_policy(%L,%s,%L)',:'original_tiers',:revision,'78000000-0000-4000-8000-000000000011'),'loyalty_policy_changed');
select pg_temp.expect_loyalty_error(format('select public.admin_save_loyalty_policy(%L,%s,%L)',:'original_tiers',:revision,'78000000-0000-4000-8000-000000000010'),'operation_conflict');
reset role;
select 1/case when (select loyalty_grade='welcome' from public.profiles where id='78000000-0000-4000-8000-000000000003')
 and not exists(select 1 from public.loyalty_grade_events where user_id='78000000-0000-4000-8000-000000000003')
 and not exists(select 1 from public.user_coupons where user_id='78000000-0000-4000-8000-000000000003')
 and (select count(*) from public.audit_log where id='78000000-0000-4000-8000-000000000010')=1 then 1 else 0 end as saving_policy_does_not_recalculate_or_issue;
select 1/case when private.recalculate_loyalty_grade('78000000-0000-4000-8000-000000000003')='silver' then 1 else 0 end as count_qualifies_without_amount;
select 1/case when (select basis->>'itemCount'='1001' and basis->>'policyRevision'=(:revision+1)::text and basis->'criteria'=:'configured_tiers'::jsonb
 from public.loyalty_grade_events where user_id='78000000-0000-4000-8000-000000000003' order by created_at desc limit 1) then 1 else 0 end as audit_basis_records_configured_policy;
select 1/case when private.loyalty_grade_for_activity(4000000,0,:'configured_tiers')='platinum' then 1 else 0 end as amount_qualifies_without_count;
select 1/case when not private.loyalty_criteria_valid(jsonb_set(:'configured_tiers','{1,amount}','2000000'))
 and not private.loyalty_criteria_valid(jsonb_set(:'configured_tiers','{0,enabled}','false'))
 and not private.loyalty_criteria_valid(jsonb_set(:'configured_tiers','{0,itemCount}','1.5'))
 and not private.loyalty_criteria_valid(jsonb_set(:'configured_tiers','{0,extra}','true'))
 and not private.loyalty_criteria_valid('{}') then 1 else 0 end as rejects_incoherent_settings;
-- A newly disabled automatic tier does not revoke a manual floor or held coupons.
set local role authenticated;
select public.admin_adjust_loyalty_grade('78000000-0000-4000-8000-000000000003','gold','합성 수동 하한');
select public.admin_save_loyalty_policy('[{"grade":"silver","enabled":false,"amount":null,"itemCount":null},{"grade":"gold","enabled":false,"amount":null,"itemCount":null},{"grade":"platinum","enabled":false,"amount":null,"itemCount":null}]',:revision+1,'78000000-0000-4000-8000-000000000012');
select 1/case when public.admin_recalculate_loyalty_grade('78000000-0000-4000-8000-000000000003')='gold' then 1 else 0 end as disabled_automatic_tiers_preserve_manual_floor;
reset role;
-- Expired manual events no longer provide a floor; existing timing remains 90 days.
update public.loyalty_grade_events set created_at=now()-interval '91 days' where user_id='78000000-0000-4000-8000-000000000003' and reason='manual_adjustment';
select 1/case when private.recalculate_loyalty_grade('78000000-0000-4000-8000-000000000003')='welcome' then 1 else 0 end as expired_floor_falls_back_to_current_policy;
update public.profiles set suspended_at=now(),suspension_reason='합성 정책 권한 검증' where id='78000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_loyalty_error('select public.admin_get_loyalty_policy()','admin_required');
reset role;
rollback;
