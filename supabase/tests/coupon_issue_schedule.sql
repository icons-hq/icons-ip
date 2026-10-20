\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000076001','authenticated','authenticated','schedule-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000076002','authenticated','authenticated','schedule-user@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000076003','authenticated','authenticated','schedule-other@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000076001';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076001',true);
select public.admin_upsert_coupon_scheduled(jsonb_build_object(
 'target_code','SCHEDULE-QA','target_name','발급기간 분리 검증','target_discount_type','fixed','target_discount_value',1000,'target_min_subtotal',0,
 'target_starts_at',now()+interval '2 days','target_ends_at',now()+interval '10 days','target_status','active','target_recipient_segment','all','target_goods_scope','all','target_good_ids','[]'::jsonb,
 'target_issue_starts_at',now()-interval '1 day','target_issue_ends_at',now()+interval '1 day','target_valid_days',null));
select 1/case when (select count(*) from public.admin_search_coupon_console_scheduled('SCHEDULE-QA',p_filters:='{"phase":"live"}'))=1 then 1 else 0 end as phase_uses_issue_period_not_future_use_period;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076002',true);
select public.claim_coupon_code('schedule-qa');
select public.claim_coupon_code('SCHEDULE-QA');
select 1/case when (select count(*) from public.user_coupons where coupon_code='SCHEDULE-QA')=1 and (select issued_count from public.coupons where code='SCHEDULE-QA')=1 then 1 else 0 end as claim_before_use_and_repeat_does_not_consume_quota;
do $$begin
 begin perform public.apply_cart_coupon_code('SCHEDULE-QA');raise exception 'future use accepted';exception when check_violation then if sqlerrm<>'coupon_not_started' then raise;end if;end;
 begin perform public.admin_search_coupon_console_scheduled();raise exception 'user admin read accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.coupons set starts_at=now()-interval '2 days',issue_starts_at=now()-interval '3 days',issue_ends_at=now()-interval '1 day' where code='SCHEDULE-QA';
set local role authenticated;
select public.claim_coupon_code('SCHEDULE-QA');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076003',true);
do $$begin
 begin perform public.claim_coupon_code('SCHEDULE-QA');raise exception 'ended issue accepted';exception when check_violation then if sqlerrm<>'coupon_issue_ended' then raise;end if;end;
end$$;
reset role;
insert into public.coupons(code,name,discount_type,discount_value,starts_at,issue_starts_at,issue_ends_at,valid_days,issue_limit,status)
 values('SCHEDULE-DAYS','발급일 기준','fixed',1000,now()-interval '2 days',now()-interval '2 days',now()+interval '10 days',3,1,'active');
select 1/case when (select private.coupon_issue_expiry(c,'2026-10-01T16:00:00+09:00') from public.coupons c where code='SCHEDULE-DAYS')='2026-10-04T23:59:59.999+09:00'::timestamptz then 1 else 0 end as relative_days_end_of_kst_day;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076002',true);
select public.claim_coupon_code('SCHEDULE-DAYS');
reset role;
create temporary table held_schedule_snapshot as select id,expires_at from public.user_coupons where coupon_code='SCHEDULE-DAYS';
update public.coupons set valid_days=1,ends_at=now()+interval '1 hour' where code='SCHEDULE-DAYS';
select 1/case when (select h.expires_at=s.expires_at from public.user_coupons h join held_schedule_snapshot s using(id)) then 1 else 0 end as definition_changes_preserve_held_expiry;
-- The definition can close issuance while the issued coupon remains usable.
update public.coupons set ends_at=now()-interval '1 hour' where code='SCHEDULE-DAYS';
select 1/case when (select o_reason is null and o_discount=1000 from private.evaluate_coupon_target_lines(
 (select id from held_schedule_snapshot),'00000000-0000-4000-8000-000000076002','[{"good_id":"snapshot-fixture","subtotal":5000}]')) then 1 else 0 end as evaluator_uses_held_expiry;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076003',true);
do $$begin
 begin perform public.claim_coupon_code('SCHEDULE-DAYS');raise exception 'exhausted or expired definition issued';exception when check_violation then if sqlerrm not in('coupon_exhausted','coupon_expired') then raise;end if;end;
end$$;
reset role;
-- Relative-to-period changes and a future issuance restart do not postpone a held coupon.
update public.coupons set starts_at=now()+interval '1 day',issue_starts_at=now()+interval '1 day',issue_ends_at=now()+interval '10 days',ends_at=null,valid_days=7 where code='SCHEDULE-DAYS';
select 1/case when (select o_reason is null from private.evaluate_coupon_target_lines((select id from held_schedule_snapshot),'00000000-0000-4000-8000-000000076002','[{"good_id":"snapshot-fixture","subtotal":5000}]')) then 1 else 0 end as future_issue_restart_preserves_held_start;
update public.coupons set valid_days=null,starts_at=now()+interval '3 days',ends_at=now()+interval '20 days' where code='SCHEDULE-DAYS';
select 1/case when (select o_reason is null from private.evaluate_coupon_target_lines((select id from held_schedule_snapshot),'00000000-0000-4000-8000-000000076002','[{"good_id":"snapshot-fixture","subtotal":5000}]')) then 1 else 0 end as relative_to_period_preserves_held_start;
update public.coupons set issue_starts_at=now()-interval '4 days',issue_ends_at=null,starts_at=now()-interval '3 days',ends_at=now()-interval '1 day' where code='SCHEDULE-DAYS';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000076001',true);
select 1/case when (select count(*) from public.admin_search_coupon_console_scheduled('SCHEDULE-DAYS',p_filters:='{"phase":"ended"}'))=1 then 1 else 0 end as issue_end_defaults_to_use_end_for_phase;
reset role;

-- Grade awards outside the issue window are skipped; they must not abort a paid order.
insert into public.coupons(code,name,discount_type,discount_value,starts_at,issue_starts_at,issue_ends_at,valid_days,status,grade_benefit) values
 ('SCHEDULE-GRADE','등급 지급 중지기간','fixed',1000,now()-interval '4 days',now()-interval '4 days',now()-interval '1 day',7,'active','silver');
select private.grant_grade_benefit_coupons('00000000-0000-4000-8000-000000076003','welcome','silver');
select 1/case when not exists(select 1 from public.user_coupons where coupon_code='SCHEDULE-GRADE') then 1 else 0 end as closed_grade_issue_is_skipped;
select 1/case when not has_function_privilege('anon','public.claim_coupon_code(text)','execute')
 and not has_function_privilege('service_role','public.admin_upsert_coupon_scheduled(jsonb)','execute')
 and not has_function_privilege('authenticated','private.claim_coupon_code(text,uuid)','execute')
 and (select count(*) from public.audit_log where action='commerce.coupon.schedule_updated' and target='coupons:SCHEDULE-QA')=1 then 1 else 0 end as privileges_and_schedule_audit;
rollback;
