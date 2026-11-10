\set ON_ERROR_STOP on
-- L8a (#573, CH-02): consented impressions/clicks for global-shell notices.
-- Everything runs in one rolled-back transaction; counts are scoped to this
-- file's own sessions and notices, never to whole tables.
begin;
create function pg_temp.notice_id(n integer) returns uuid language sql immutable as $$select ('bfc03000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.notice_expect(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'Expected %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.notice_id(n),'authenticated','authenticated','notice-analytics-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.profiles set role='staff'::public.user_role,nickname='notice_stats_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),
 consents='{"terms":true,"privacy":true,"marketing":false}' where id::text like 'bfc03000-%';
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.notice_id(1),'primary'),(pg_temp.notice_id(2),'deputy');
-- Synthetic shell notices: an active bar, an active strip, an ended bar and a hero.
insert into public.home_curations(id,kind,title,image_path,link_path,display_order,active_from,active_to,enabled,payload) values
 (pg_temp.notice_id(10),'notice_bar','합성 텍스트 공지',null,'/events',0,now()-interval '1 hour',null,true,'{"page_types":["home","product"],"cta_label":"자세히 보기"}'),
 (pg_temp.notice_id(11),'notice_strip','합성 띠배너','public-media/catalog/curation/2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b.webp','/events',0,now()-interval '1 hour',null,true,null),
 (pg_temp.notice_id(12),'notice_bar','종료된 합성 공지',null,null,1,now()-interval '2 hours',now()-interval '1 hour',true,'{"page_types":["home"]}'),
 (pg_temp.notice_id(13),'hero','합성 히어로','public-media/catalog/curation/3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c.webp',null,0,now()-interval '1 hour',null,true,null);

-- Declarative seals: CI may mix Postgres minors, so privilege checks avoid
-- relying on the runtime denial path.
select 1/case when has_function_privilege('service_role','public.record_store_analytics_notice_event(text,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.record_store_analytics_notice_event(text,uuid,uuid,text)','execute')
 and not has_function_privilege('anon','public.record_store_analytics_notice_event(text,uuid,uuid,text)','execute')
 and has_function_privilege('authenticated','public.admin_store_analytics_notice_report(date,date)','execute')
 and not has_function_privilege('anon','public.admin_store_analytics_notice_report(date,date)','execute')
 and not has_function_privilege('service_role','public.admin_store_analytics_notice_report(date,date)','execute')
 and not has_function_privilege('authenticated','public.process_store_analytics_retention()','execute')
 and not has_table_privilege('service_role','private.store_analytics_notice_events','select')
 and not has_table_privilege('authenticated','private.store_analytics_notice_events','select')
 and not has_table_privilege('anon','private.store_analytics_notice_daily','select')
 and not has_table_privilege('service_role','private.store_analytics_notice_daily','select')
 and (select relrowsecurity from pg_class where oid='private.store_analytics_notice_events'::regclass)
 and (select relrowsecurity from pg_class where oid='private.store_analytics_notice_daily'::regclass)
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_store_analytics_notice_report(date,date)' and capability='stats.read' and guard_kind='read')
 then 1 else 0 end as notice_analytics_sealed;

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
-- Collection is off until a reviewed activation, for notices as for page views.
select public.set_store_analytics_collection(false,'analytics-v1');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(100),pg_temp.notice_id(10),'impression')$q$,'analytics_disabled');
select public.set_store_analytics_collection(true,'analytics-v1');
select public.start_store_analytics_session(repeat('a',64),'analytics-v1');
select public.record_store_analytics_event(repeat('a',64),pg_temp.notice_id(99),'home','home','direct','none','none');
select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(100),pg_temp.notice_id(10),'impression');
select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(100),pg_temp.notice_id(10),'impression') as notice_replay \gset
select 1/case when :'notice_replay'::jsonb->>'replayed'='true' then 1 else 0 end as exact_notice_event_replay;
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(100),pg_temp.notice_id(10),'click')$q$,'analytics_event_conflict');
-- Only a notice the shell can show now is countable.
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(101),pg_temp.notice_id(12),'impression')$q$,'analytics_notice_unavailable');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(101),pg_temp.notice_id(13),'impression')$q$,'analytics_notice_unavailable');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(101),pg_temp.notice_id(999),'impression')$q$,'analytics_notice_unavailable');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(101),pg_temp.notice_id(10),'hover')$q$,'analytics_invalid_event');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event('not-a-hash',pg_temp.notice_id(101),pg_temp.notice_id(10),'impression')$q$,'analytics_invalid_event');
-- A click needs an earlier impression of the same notice in the same session.
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(102),pg_temp.notice_id(11),'click')$q$,'analytics_notice_not_shown');
select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(103),pg_temp.notice_id(11),'impression');
select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(104),pg_temp.notice_id(11),'click');
select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(105),pg_temp.notice_id(10),'impression');
-- A second session sees the bar once and does not click it.
select public.start_store_analytics_session(repeat('b',64),'analytics-v1');
select public.record_store_analytics_notice_event(repeat('b',64),pg_temp.notice_id(106),pg_temp.notice_id(10),'impression');
-- Another session's impression does not unlock this session's click.
select public.start_store_analytics_session(repeat('c',64),'analytics-v1');
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('c',64),pg_temp.notice_id(107),pg_temp.notice_id(10),'click')$q$,'analytics_notice_not_shown');
reset role;
select 1/case when (select count(*) from private.store_analytics_notice_events where id between pg_temp.notice_id(100) and pg_temp.notice_id(107))=5
 and not exists(select 1 from private.store_analytics_notice_events where id in(pg_temp.notice_id(101),pg_temp.notice_id(102),pg_temp.notice_id(107)))
 and (select placement from private.store_analytics_notice_events where id=pg_temp.notice_id(103))='notice_strip'
 then 1 else 0 end as only_valid_notice_events_recorded;

-- Report: stats.read only; per-notice totals and click rate for today.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.notice_id(2)::text,true);
set local role authenticated;
select pg_temp.notice_expect($q$select public.admin_store_analytics_notice_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date)$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub',pg_temp.notice_id(1)::text,true);
select pg_temp.notice_expect($q$select public.admin_store_analytics_notice_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date+1)$q$,'analytics_invalid_filter');
select pg_temp.notice_expect($q$select public.admin_store_analytics_notice_report((now() at time zone 'Asia/Seoul')::date-60,(now() at time zone 'Asia/Seoul')::date)$q$,'analytics_invalid_filter');
select public.admin_store_analytics_notice_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as today_report \gset
select 1/case when exists(select 1 from jsonb_array_elements(:'today_report'::jsonb->'rows') r
  where r->>'curationId'=pg_temp.notice_id(10)::text and r->>'placement'='notice_bar' and r->>'title'='합성 텍스트 공지'
   and (r->>'impressions')::int=3 and (r->>'impressionSessions')::int=2 and (r->>'clicks')::int=0 and (r->>'clickRate')::numeric=0)
 and exists(select 1 from jsonb_array_elements(:'today_report'::jsonb->'rows') r
  where r->>'curationId'=pg_temp.notice_id(11)::text and r->>'placement'='notice_strip'
   and (r->>'impressions')::int=1 and (r->>'clicks')::int=1 and (r->>'clickSessions')::int=1 and (r->>'clickRate')::numeric=100)
 then 1 else 0 end as per_notice_totals_and_click_rate;
reset role;

-- Rate limits share the session budget and the per-session notice cap.
insert into private.store_analytics_rate_buckets(bucket,scope,requests)
select date_trunc('minute',clock_timestamp()),'session:'||id::text,120 from private.store_analytics_sessions where token_hash=repeat('b',64)
on conflict(bucket,scope) do update set requests=120;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('b',64),pg_temp.notice_id(108),pg_temp.notice_id(11),'impression')$q$,'analytics_rate_limited');
reset role;
insert into private.store_analytics_notice_events(id,session_id,observed_at,curation_id,placement,interaction,payload_hash)
select extensions.gen_random_uuid(),s.id,clock_timestamp(),pg_temp.notice_id(10),'notice_bar','impression',repeat('0',64)
from private.store_analytics_sessions s cross join generate_series(1,500) where s.token_hash=repeat('c',64);
set local role service_role;
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('c',64),pg_temp.notice_id(109),pg_temp.notice_id(11),'impression')$q$,'analytics_rate_limited');
reset role;
select 1/case when not exists(select 1 from private.store_analytics_notice_events where id in(pg_temp.notice_id(108),pg_temp.notice_id(109)))
 then 1 else 0 end as rate_rejection_has_no_partial_notice_event;

-- Session expiry uses server time.
update private.store_analytics_sessions set last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=repeat('b',64);
set local role service_role;
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('b',64),pg_temp.notice_id(110),pg_temp.notice_id(10),'impression')$q$,'analytics_session_expired');
-- Withdrawal deletes the session and, with it, every raw notice row.
select public.revoke_store_analytics_session(repeat('a',64));
select pg_temp.notice_expect($q$select public.record_store_analytics_notice_event(repeat('a',64),pg_temp.notice_id(111),pg_temp.notice_id(10),'impression')$q$,'analytics_session_unavailable');
reset role;
select 1/case when not exists(select 1 from private.store_analytics_notice_events where id in(pg_temp.notice_id(100),pg_temp.notice_id(103),pg_temp.notice_id(104),pg_temp.notice_id(105)))
 then 1 else 0 end as withdrawal_removes_raw_notice_rows;

-- Retention archives a 91-day-old day: identifier-free notice totals remain.
update private.store_analytics_settings set activated_at=(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul') where id;
insert into private.store_analytics_sessions(id,token_hash,notice_version,created_at,last_seen_at,event_count)
values(pg_temp.notice_id(300),repeat('d',64),'analytics-v1',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour',1),
 (pg_temp.notice_id(301),repeat('e',64),'analytics-v1',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '2 hours',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '2 hours',1);
insert into private.store_analytics_notice_events(id,session_id,observed_at,curation_id,placement,interaction,payload_hash)
select pg_temp.notice_id(n),case when n<=312 then pg_temp.notice_id(300) else pg_temp.notice_id(301) end,
 (((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour'+n*interval '1 second',
 pg_temp.notice_id(10),'notice_bar',case when n=312 then 'click' else 'impression' end,repeat('0',64)
from generate_series(310,313) n;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.process_store_analytics_retention();
reset role;
select 1/case when not exists(select 1 from private.store_analytics_sessions where id in(pg_temp.notice_id(300),pg_temp.notice_id(301)))
 and not exists(select 1 from private.store_analytics_notice_events where id between pg_temp.notice_id(310) and pg_temp.notice_id(313))
 and exists(select 1 from private.store_analytics_notice_daily where day=(clock_timestamp() at time zone 'Asia/Seoul')::date-91
  and curation_id=pg_temp.notice_id(10) and placement='notice_bar' and impressions=3 and clicks=1 and impression_sessions=2 and click_sessions=1)
 then 1 else 0 end as notice_totals_archived_without_identifiers;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.notice_id(1)::text,true);
set local role authenticated;
select public.admin_store_analytics_notice_report((now() at time zone 'Asia/Seoul')::date-91,(now() at time zone 'Asia/Seoul')::date-91) as archived_report \gset
select 1/case when jsonb_array_length(:'archived_report'::jsonb->'rows')=1
 and (:'archived_report'::jsonb#>>'{rows,0,impressions}')::int=3 and (:'archived_report'::jsonb#>>'{rows,0,clicks}')::int=1
 and (:'archived_report'::jsonb#>>'{rows,0,clickRate}')::numeric=33.33
 then 1 else 0 end as archived_notice_report;
reset role;
rollback;
