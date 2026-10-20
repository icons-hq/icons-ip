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
-- Exact content and schedule contracts, including every template and forbidden links.
do $$declare content jsonb:=pg_temp.marketing_values()->'content'; normalized jsonb; at_value timestamptz:='2026-01-01 01:00Z';begin
 perform private.normalize_marketing_content(content);
 perform private.normalize_marketing_content(content||'{"template":"image","imagePath":"public-media/catalog/curation/bfc01900-0000-4000-8000-000000000001.png"}');
 perform private.normalize_marketing_content(content||'{"template":"product_list","goodIds":["one","two","three"]}');
 perform private.normalize_marketing_content(content||'{"template":"product_cards","goodIds":["one","two","three","four","five","six"]}');
 perform pg_temp.marketing_expect(format('select private.normalize_marketing_content(%L::jsonb)',content||'{"template":"product_list","goodIds":["one","two","three","four"]}'),'invalid_marketing_content');
 perform pg_temp.marketing_expect(format('select private.normalize_marketing_content(%L::jsonb)',content||'{"buttons":[{"label":"외부","path":"//example.test"}]}'),'invalid_marketing_button');
 perform pg_temp.marketing_expect(format('select private.normalize_marketing_content(%L::jsonb)',content||'{"buttons":[{"label":"관리자","path":"/admin"}]}'),'invalid_marketing_button');
 perform pg_temp.marketing_expect($q$select private.marketing_schedule_times('{"kind":"immediate"}','2026-01-01 12:00Z')$q$,'marketing_outside_window');
 if cardinality(private.marketing_schedule_times('{"kind":"weekly","startDate":"2026-01-02","endDate":"2026-01-31","weekday":5,"time":"10:00"}',at_value))<>5 then raise exception 'weekly occurrence count';end if;
 perform pg_temp.marketing_expect($q$select private.marketing_schedule_times('{"kind":"weekly","startDate":"2026-01-02","endDate":"2028-01-31","weekday":5,"time":"10:00"}','2026-01-01 01:00Z')$q$,'invalid_marketing_schedule');
end $$;
select 1/case when not has_table_privilege('authenticated','private.marketing_recipients','select') and not has_table_privilege('service_role','private.marketing_campaigns','insert')
 and not has_function_privilege('service_role','private.process_marketing_run(uuid,timestamptz)','execute') and not has_function_privilege('authenticated','public.process_due_marketing_campaigns(uuid)','execute') then 1 else 0 end as sealed;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
set local role authenticated;
select public.admin_estimate_customer_segment('{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select public.admin_save_customer_segment(pg_temp.marketing_id(100),0,pg_temp.marketing_id(102),'마케팅 합성 세그먼트','{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(201),0,pg_temp.marketing_id(301),pg_temp.marketing_values(),true,pg_temp.marketing_id(101)) as saved \gset
select 1/case when public.admin_save_marketing_campaign(pg_temp.marketing_id(201),0,pg_temp.marketing_id(301),pg_temp.marketing_values(),true,pg_temp.marketing_id(101))=:'saved'::jsonb then 1 else 0 end as idempotent_publication;
select 1/case when public.admin_marketing_campaigns('마케팅 합성')->>'total'='1' and jsonb_array_length(public.admin_get_marketing_campaign(pg_temp.marketing_id(201))->'runs')=1 then 1 else 0 end as persisted_readback;
select pg_temp.marketing_expect($q$select public.admin_save_marketing_campaign(pg_temp.marketing_id(201),1,gen_random_uuid(),pg_temp.marketing_values(),true,pg_temp.marketing_id(101))$q$,'marketing_campaign_changed');
select pg_temp.marketing_expect($q$select public.admin_save_marketing_campaign(pg_temp.marketing_id(202),0,gen_random_uuid(),pg_temp.marketing_values(),true,pg_temp.marketing_id(999))$q$,'customer_segment_estimate_required');
select pg_temp.marketing_expect($q$select public.admin_save_marketing_campaign(pg_temp.marketing_id(202),0,gen_random_uuid(),jsonb_set(pg_temp.marketing_values(),'{content}',(pg_temp.marketing_values()->'content')||'{"template":"image","imagePath":"public-media/catalog/curation/bfc01900-0000-4000-8000-000000000002.png"}'),false)$q$,'unverified_artwork');
select public.admin_save_marketing_campaign(pg_temp.marketing_id(202),0,pg_temp.marketing_id(302),pg_temp.marketing_values(),false);
select public.admin_save_marketing_campaign(pg_temp.marketing_id(202),1,pg_temp.marketing_id(303),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(203),0,pg_temp.marketing_id(304),pg_temp.marketing_values('received'),true,pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(204),0,pg_temp.marketing_id(305),pg_temp.marketing_values('read'),true,pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(205),0,pg_temp.marketing_id(306),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(206),0,pg_temp.marketing_id(307),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
select public.admin_save_marketing_campaign(pg_temp.marketing_id(207),0,pg_temp.marketing_id(308),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
select public.admin_change_marketing_campaign(pg_temp.marketing_id(207),1,pg_temp.marketing_id(309),'cancel');
select public.admin_change_marketing_campaign(pg_temp.marketing_id(207),2,pg_temp.marketing_id(310),'archive');
select 1/case when public.admin_get_marketing_campaign(pg_temp.marketing_id(207)) is null then 1 else 0 end as canceled_archived;
select pg_temp.marketing_expect($q$select public.admin_change_marketing_campaign(pg_temp.marketing_id(206),1,gen_random_uuid(),'archive')$q$,'marketing_campaign_active');
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(2)::text,true);
select pg_temp.marketing_expect('select public.admin_marketing_campaigns()','operator_capability_required');
select pg_temp.marketing_expect($q$select public.admin_save_marketing_campaign(pg_temp.marketing_id(208),0,gen_random_uuid(),pg_temp.marketing_values(),false)$q$,'operator_capability_required');
reset role;
-- Materialize then change consent; the estimate remains two, while only one actual notification is registered.
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(201);
update public.profiles set consents=consents||'{"marketing":false}' where id=pg_temp.marketing_id(4);
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(201);
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(201);
select 1/case when (select count(*) from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id=pg_temp.marketing_id(201) and rec.state='sent')=1
 and (select count(*) from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id=pg_temp.marketing_id(201) and rec.state='excluded')=1
 and (select consented_count from private.customer_segment_estimates where id=pg_temp.marketing_id(101))=2 then 1 else 0 end as current_consent_immutable_estimate;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(3)::text,true);
set local role authenticated;
reset role;
select rec.id as recipient_id from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id=pg_temp.marketing_id(201) and rec.state='sent' \gset
set local role authenticated;
select 1/case when public.get_my_marketing_message(:'recipient_id')#>>'{content,title}'='검사 안내' then 1 else 0 end as recipient_owns_content;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(5)::text,true);
select 1/case when public.get_my_marketing_message(:'recipient_id') is null then 1 else 0 end as other_customer_no_access;
reset role;
-- Sender revocation is checked even after the recipient list was materialized.
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(202);
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.marketing_id(1);
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(202);
select 1/case when (select state='blocked' and reason='sender_permission' from private.marketing_runs where campaign_id=pg_temp.marketing_id(202)) then 1 else 0 end as revoked_sender_blocked;
update private.operator_memberships set manager_role='primary' where profile_id=pg_temp.marketing_id(1);
-- A later run excludes previous receipt, or only the previous read record.
insert into private.marketing_runs(campaign_id,scheduled_at) select campaign_id,scheduled_at+interval '7 days' from private.marketing_runs where campaign_id in(pg_temp.marketing_id(203),pg_temp.marketing_id(204));
do $$declare r private.marketing_runs;begin
 for r in select * from private.marketing_runs where campaign_id in(pg_temp.marketing_id(203),pg_temp.marketing_id(204)) order by scheduled_at loop
  perform private.process_marketing_run(r.id,r.scheduled_at);perform private.process_marketing_run(r.id,r.scheduled_at);
  if r.campaign_id=pg_temp.marketing_id(204) then update public.notifications set read_at=r.scheduled_at where id in(select notification_id from private.marketing_recipients where run_id=r.id);end if;
 end loop;
 if (select count(*) from private.marketing_recipients rec join private.marketing_runs runs on runs.id=rec.run_id where runs.campaign_id in(pg_temp.marketing_id(203),pg_temp.marketing_id(204)) and rec.state='sent')<>2 then raise exception 'repeat exclusion failed';end if;
end $$;
-- Changed definitions and missed deadlines are explicit terminal states, not successful sends.
update private.customer_segments set revision=revision+1 where id=pg_temp.marketing_id(100);
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(205);
select 1/case when (select state='blocked' and reason='segment_changed' from private.marketing_runs where campaign_id=pg_temp.marketing_id(205)) then 1 else 0 end as changed_segment_blocked;
update private.customer_segments set revision=revision-1 where id=pg_temp.marketing_id(100);
select private.process_marketing_run(id,scheduled_at+interval '2 hours') from private.marketing_runs where campaign_id=pg_temp.marketing_id(206);
select 1/case when (select state='expired' from private.marketing_runs where campaign_id=pg_temp.marketing_id(206)) then 1 else 0 end as expired_is_not_sent;
select 1/case when not exists(select 1 from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id in(pg_temp.marketing_id(205),pg_temp.marketing_id(206),pg_temp.marketing_id(207))) then 1 else 0 end as no_blocked_notifications;
-- A real 100-recipient batch evaluates the non-inlineable segment function once.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.marketing_id(n),'authenticated','authenticated','marketing-batch-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(500,599)n;
update public.profiles set birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":true}' where id between pg_temp.marketing_id(500) and pg_temp.marketing_id(599);
insert into public.ip_follows(user_id,ip_id) select pg_temp.marketing_id(n),'marketing-test-ip' from generate_series(500,599)n;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
select public.admin_save_marketing_campaign(pg_temp.marketing_id(208),0,pg_temp.marketing_id(311),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
set local track_functions='pl';
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(208);
select coalesce((select calls from pg_stat_xact_user_functions where funcid='private.customer_segment_members(jsonb,timestamptz)'::regprocedure),0) as before_calls \gset
explain(analyze,buffers,costs off) select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(208);
select 1/case when (select calls from pg_stat_xact_user_functions where funcid='private.customer_segment_members(jsonb,timestamptz)'::regprocedure)=:before_calls+1
 and (select count(*) from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id=pg_temp.marketing_id(208) and rec.state='sent')=100 then 1 else 0 end as one_segment_resolution_for_100_recipients;
-- Exact 20:00 is a closed delivery window even when the start deadline has not elapsed.
select public.admin_save_marketing_campaign(pg_temp.marketing_id(209),0,pg_temp.marketing_id(312),pg_temp.marketing_values(),true,pg_temp.marketing_id(101));
update private.marketing_runs set scheduled_at=scheduled_at+interval '9 hours 30 minutes' where campaign_id=pg_temp.marketing_id(209);
select private.process_marketing_run(id,scheduled_at+interval '30 minutes') from private.marketing_runs where campaign_id=pg_temp.marketing_id(209);
select 1/case when (select state='queued' from private.marketing_runs where campaign_id=pg_temp.marketing_id(209)) then 1 else 0 end as twenty_oclock_no_start;
select private.process_marketing_run(id,scheduled_at+interval '29 minutes') from private.marketing_runs where campaign_id=pg_temp.marketing_id(209);
select private.process_marketing_run(id,scheduled_at+interval '30 minutes') from private.marketing_runs where campaign_id=pg_temp.marketing_id(209);
select 1/case when (select state='completed' and reason='delivery_window_ended' from private.marketing_runs where campaign_id=pg_temp.marketing_id(209))
 and not exists(select 1 from private.marketing_recipients rec join private.marketing_runs r on r.id=rec.run_id where r.campaign_id=pg_temp.marketing_id(209) and rec.state='sent') then 1 else 0 end as twenty_oclock_stops_remaining_batch;
rollback;
