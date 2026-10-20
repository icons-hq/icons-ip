\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000063001','authenticated','authenticated','coupon-console-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000063002','authenticated','authenticated','coupon-console-user@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000063001';
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,ends_at,status,recipient_segment,created_at) values
 ('CNS-QA-LIVE','가 적용 쿠폰','fixed',3000,10000,now()-interval '3 days',now()+interval '2 days','active','first_purchase','2026-10-01T00:00:00+09:00'),
 ('CNS-QA-PENDING','나 대기 쿠폰','percent',10,0,now()+interval '3 days',now()+interval '9 days','active','repeat_purchase','2026-10-02T00:00:00+09:00'),
 ('CNS-QA-END','다 완료 쿠폰','fixed',1000,0,now()-interval '9 days',now()-interval '3 days','active','all','2026-10-02T23:59:59+09:00'),
 ('CNS-QA-STOP','라 중지 쿠폰','fixed',2000,0,now()-interval '3 days',null,'archived','all','2026-10-03T00:00:00+09:00');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063001',true);
select 1/case when (select code from public.admin_search_coupon_console('CNS-QA-',p_filters:='{"phase":"live"}'))='CNS-QA-LIVE'
 and (select code from public.admin_search_coupon_console('CNS-QA-',p_filters:='{"phase":"scheduled","discountType":"percent","segment":"repeat_purchase"}'))='CNS-QA-PENDING'
 and (select code from public.admin_search_coupon_console('CNS-QA-',p_filters:='{"phase":"ended"}'))='CNS-QA-END'
 and (select code from public.admin_search_coupon_console('CNS-QA-',p_filters:='{"phase":"stopped"}'))='CNS-QA-STOP'
 then 1 else 0 end as phases_and_targets_are_server_filters;
select 1/case when (select total_count from public.admin_search_coupon_console('CNS-QA-',p_limit:=1,p_offset:=1,p_filters:='{"from":"2026-10-01","to":"2026-10-02","sort":"name_asc"}'))=3
 and (select code from public.admin_search_coupon_console('CNS-QA-',p_limit:=1,p_offset:=1,p_filters:='{"from":"2026-10-01","to":"2026-10-02","sort":"name_asc"}'))='CNS-QA-PENDING'
 and (select count(*) from public.admin_search_coupon_console('CNS-QA-%'))=0
 then 1 else 0 end as kst_range_total_sort_before_pagination_literal_search;
select public.admin_set_coupon_status('CNS-QA-LIVE',1,'archived');
select 1/case when (select status='archived' and terms_revision=2 from public.coupons where code='CNS-QA-LIVE')
 and (public.admin_set_coupon_status('CNS-QA-LIVE',2,'archived')->>'changed')::boolean=false then 1 else 0 end as stop_readback_and_same_state_replay;
do $$begin
 begin perform public.admin_set_coupon_status('CNS-QA-LIVE',1,'active');raise exception 'stale status accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_search_coupon_console(p_filters:='{"phase":"unknown"}');raise exception 'unknown phase accepted';exception when invalid_parameter_value then null;end;
end$$;
select public.admin_set_coupon_status('CNS-QA-LIVE',2,'active');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000063002',true);
do $$begin
 begin perform public.admin_search_coupon_console();raise exception 'nonstaff read accepted';exception when insufficient_privilege then null;end;
 begin perform public.admin_set_coupon_status('CNS-QA-LIVE',3,'archived');raise exception 'nonstaff write accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when (select count(*) from public.audit_log where action='commerce.coupon.status_changed' and target='coupons:CNS-QA-LIVE')=2
 and not has_function_privilege('anon','public.admin_search_coupon_console(text,text,integer,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_set_coupon_status(text,integer,text)','execute') then 1 else 0 end as audited_mutation_and_execute_boundary;
rollback;
