\set ON_ERROR_STOP on
begin;
create function pg_temp.marketing_expect(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected %',expected;end $$;
create function pg_temp.marketing_id(n integer) returns uuid language sql immutable as $$select ('bfc01900-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.marketing_id(n),'authenticated','authenticated','marketing-test-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,5)n;
update public.profiles set role=case when id in(pg_temp.marketing_id(1),pg_temp.marketing_id(2)) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='marketing_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":true}' where id::text like 'bfc01900-%';
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.marketing_id(1),'primary'),(pg_temp.marketing_id(2),'deputy');
insert into public.ips(id,title,vertical_key) select 'marketing-test-ip','마케팅 합성 IP',key from public.verticals limit 1;
insert into public.ip_follows(user_id,ip_id) values(pg_temp.marketing_id(3),'marketing-test-ip'),(pg_temp.marketing_id(4),'marketing-test-ip');
create function pg_temp.marketing_values(p_exclusion text default 'none') returns jsonb language sql as $$
 select jsonb_build_object('name','마케팅 합성 검사','segmentId',pg_temp.marketing_id(100),'segmentRevision',1,
 'content',jsonb_build_object('template','text','title','검사 안내','body','인앱 마케팅 원장 검사','imagePath',null,'goodIds','[]'::jsonb,'buttons',jsonb_build_array(jsonb_build_object('label','굿즈 보기','path','/shop'))),
 'schedule',jsonb_build_object('kind','once','at',(((statement_timestamp() at time zone 'Asia/Seoul')::date+1)+time '10:00') at time zone 'Asia/Seoul'),'exclusion',p_exclusion);
$$;

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(pg_temp.marketing_id(900),pg_temp.marketing_id(1),now(),now(),now()+interval '1 hour');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,issue_starts_at,issue_ends_at,ends_at,status,issue_limit)
 select code,'TEST 지정발급','fixed',1000,10000,now()-interval '1 day',now()-interval '1 day',now()+interval '7 days',now()+interval '30 days','active',cap
 from (values('BATCH-ALL',2),('BATCH-LIMIT',1),('BATCH-ATOMIC',10),('BATCH-SEG',10),('BATCH-CHANGE',10),('BATCH-EXPIRE',10)) f(code,cap);
update public.profiles set consents=consents||'{"marketing":false}' where id=pg_temp.marketing_id(4);
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.marketing_id(1),'session_id',pg_temp.marketing_id(900),'role','authenticated')::text,true);
set local role authenticated;
select public.admin_estimate_customer_segment('{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select public.admin_save_customer_segment(pg_temp.marketing_id(100),0,pg_temp.marketing_id(102),'마케팅 합성 세그먼트','{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select jsonb_build_object('kind','customers','userIds',jsonb_build_array(pg_temp.marketing_id(3),pg_temp.marketing_id(4))) as targets \gset
select public.admin_preview_coupon_issue(pg_temp.marketing_id(201),'BATCH-ALL',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900)) as preview \gset
select 1/case when :'preview'::jsonb->>'plannedCount'='2' and :'preview'::jsonb->>'canExecute'='true' and public.admin_preview_coupon_issue(pg_temp.marketing_id(201),'BATCH-ALL',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900))=:'preview'::jsonb then 1 else 0 end as assert_preview_exact_replay;
reset role;
select 1/case when not exists(select 1 from public.user_coupons where coupon_code='BATCH-ALL') then 1 else 0 end as assert_preview_no_issuance;
set local role authenticated;
select public.admin_execute_coupon_issue(pg_temp.marketing_id(201),pg_temp.marketing_id(1),pg_temp.marketing_id(900)) as result \gset
select 1/case when :'result'::jsonb->>'status'='completed' and :'result'::jsonb->>'issuedCount'='2' and public.admin_execute_coupon_issue(pg_temp.marketing_id(201),pg_temp.marketing_id(1),pg_temp.marketing_id(900))=:'result'::jsonb then 1 else 0 end as assert_execution_once;
select 1/case when public.admin_preview_coupon_issue(pg_temp.marketing_id(202),'BATCH-ALL',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'existingCount'='2' then 1 else 0 end as assert_existing_skip_preview;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(202),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'issuedCount'='0' then 1 else 0 end as assert_second_batch_no_duplicate;
select 1/case when public.admin_preview_coupon_issue(pg_temp.marketing_id(203),'BATCH-LIMIT',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'status'='invalid' then 1 else 0 end as assert_limit_before_issue;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(203),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'status'='invalid' then 1 else 0 end as assert_invalid_not_executed;
select pg_temp.marketing_expect(format('select public.admin_execute_coupon_issue(%L,%L,%L)',pg_temp.marketing_id(201),pg_temp.marketing_id(2),pg_temp.marketing_id(900)),'coupon_issue_auth_changed');
reset role;
select 1/case when (select issued_count=2 from public.coupons where code='BATCH-ALL') and (select count(*)=2 from public.user_coupons where coupon_code='BATCH-ALL' and issued_source='admin_grant')
 and not exists(select 1 from public.notifications where user_id in(pg_temp.marketing_id(3),pg_temp.marketing_id(4)) and source_type='coupon_issue_batch') then 1 else 0 end as assert_ledger_without_marketing_send;
-- Fail the second insert after the first succeeded; the batch must roll both back.
create function pg_temp.fail_second_coupon() returns trigger language plpgsql as $$begin raise exception 'test_insert_failure';end $$;
create trigger test_fail_second_coupon before insert on public.user_coupons for each row when(new.coupon_code='BATCH-ATOMIC' and new.user_id='bfc01900-0000-4000-8000-000000000004') execute function pg_temp.fail_second_coupon();
set local role authenticated;
select public.admin_preview_coupon_issue(pg_temp.marketing_id(204),'BATCH-ATOMIC',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900));
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(204),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'status'='failed' then 1 else 0 end as assert_error_captured;
reset role;
select 1/case when not exists(select 1 from public.user_coupons where coupon_code='BATCH-ATOMIC') and (select issued_count=0 from public.coupons where code='BATCH-ATOMIC') then 1 else 0 end as assert_whole_batch_rolled_back;
drop trigger test_fail_second_coupon on public.user_coupons;
set local role authenticated;
select jsonb_build_object('kind','segment','segmentId',pg_temp.marketing_id(100),'revision',1) as segment_target \gset
select 1/case when public.admin_preview_coupon_issue(pg_temp.marketing_id(205),'BATCH-SEG',:'segment_target',pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'targetCount'='2' then 1 else 0 end as assert_segment_without_marketing_filter;
reset role;
delete from public.ip_follows where user_id=pg_temp.marketing_id(4) and ip_id='marketing-test-ip';
set local role authenticated;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(205),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'error'='coupon_issue_segment_changed' then 1 else 0 end as assert_changed_segment_member_atomic_fail;
reset role;
insert into public.ip_follows(user_id,ip_id) values(pg_temp.marketing_id(4),'marketing-test-ip');
set local role authenticated;
select public.admin_preview_coupon_issue(pg_temp.marketing_id(206),'BATCH-SEG',:'segment_target',pg_temp.marketing_id(1),pg_temp.marketing_id(900));
reset role;
insert into public.ip_follows(user_id,ip_id) values(pg_temp.marketing_id(5),'marketing-test-ip');
set local role authenticated;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(206),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'issuedCount'='2' then 1 else 0 end as assert_no_new_members_after_preview;
select public.admin_preview_coupon_issue(pg_temp.marketing_id(207),'BATCH-CHANGE',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900));
select public.admin_preview_coupon_issue(pg_temp.marketing_id(208),'BATCH-EXPIRE',:'targets',pg_temp.marketing_id(1),pg_temp.marketing_id(900));
reset role;
update public.coupons set discount_value=2000 where code='BATCH-CHANGE';
update private.coupon_issue_batches set valid_until=now()-interval '1 second' where id=pg_temp.marketing_id(208);
set local role authenticated;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(207),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'error'='coupon_issue_policy_changed' then 1 else 0 end as assert_policy_revision;
select 1/case when public.admin_execute_coupon_issue(pg_temp.marketing_id(208),pg_temp.marketing_id(1),pg_temp.marketing_id(900))->>'error'='coupon_issue_preview_stale' then 1 else 0 end as assert_preview_expiry;
reset role;
select 1/case when not has_function_privilege('service_role','public.admin_execute_coupon_issue(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.issue_coupon_code(text,uuid,text)','execute')
 and not has_table_privilege('authenticated','private.coupon_issue_batches','select') then 1 else 0 end as assert_sealed_roles;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(2)::text,true);
set local role authenticated;
select pg_temp.marketing_expect(format('select public.admin_get_coupon_issue(%L)',pg_temp.marketing_id(201)),'operator_capability_required');
reset role;
rollback;
