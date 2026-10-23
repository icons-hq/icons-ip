-- L8a (#573, CH-02): consented first-party impressions and clicks for the
-- global-shell notices (text notice bar and image strip).
--
-- The same boundary as page views (20261020085250): service-role RPC only, the
-- analytics-v1 session token hash, idempotent event ids, per-session/global
-- rate limits, KST-day sessions and revocation by session deletion (cascade).
-- Nothing about the page, URL or person is stored — only which notice was seen
-- or clicked, when, and within which anonymous session. Raw rows follow the
-- 90-day session retention; the daily archive keeps per-notice totals with no
-- session identifier for 13 months, like private.store_analytics_daily.
create table private.store_analytics_notice_events (
 id uuid primary key,
 session_id uuid not null references private.store_analytics_sessions(id) on delete cascade,
 observed_at timestamptz not null,
 curation_id uuid not null,
 placement text not null check(placement in ('notice_bar','notice_strip')),
 interaction text not null check(interaction in ('impression','click')),
 payload_hash text not null check(payload_hash~'^[0-9a-f]{64}$')
);
create index store_analytics_notice_events_session on private.store_analytics_notice_events(session_id,curation_id,interaction);
create index store_analytics_notice_events_time on private.store_analytics_notice_events(observed_at);
create table private.store_analytics_notice_daily (
 day date not null, curation_id uuid not null,
 placement text not null check(placement in ('notice_bar','notice_strip')),
 impressions bigint not null check(impressions>=0), clicks bigint not null check(clicks>=0),
 impression_sessions bigint not null check(impression_sessions>=0), click_sessions bigint not null check(click_sessions>=0),
 observed_until timestamptz not null,
 primary key(day,curation_id,placement)
);
do $$declare name text;begin
 foreach name in array array['notice_events','notice_daily'] loop
  execute format('alter table private.store_analytics_%I enable row level security',name);
  execute format('revoke all on private.store_analytics_%I from public,anon,authenticated,service_role',name);
 end loop;
end $$;

create function public.record_store_analytics_notice_event(p_token_hash text,p_event_id uuid,p_curation_id uuid,p_interaction text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare session private.store_analytics_sessions; existing private.store_analytics_notice_events; at_time timestamptz;
 fingerprint text; notice_kind text; recorded integer;
begin
 perform private.store_analytics_require_service();
 if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' or p_event_id is null or p_curation_id is null
  or p_interaction is null or p_interaction not in ('impression','click') then
  raise invalid_parameter_value using message='analytics_invalid_event';end if;
 perform 1 from private.store_analytics_settings where id and enabled for share;
 if not found then raise object_not_in_prerequisite_state using message='analytics_disabled';end if;
 select * into session from private.store_analytics_sessions where token_hash=p_token_hash for update;
 at_time:=clock_timestamp();
 if not found or session.revoked_at is not null then raise invalid_authorization_specification using message='analytics_session_unavailable';end if;
 fingerprint:=encode(extensions.digest(jsonb_build_array('notice',p_curation_id,p_interaction)::text,'sha256'),'hex');
 select * into existing from private.store_analytics_notice_events where id=p_event_id;
 if found then
  if existing.session_id<>session.id or existing.payload_hash<>fingerprint then raise exception using errcode='PT409',message='analytics_event_conflict';end if;
  return jsonb_build_object('recorded',true,'replayed',true);
 end if;
 if at_time>=session.last_seen_at+interval '30 minutes' or at_time>=session.created_at+interval '24 hours'
  or (at_time at time zone 'Asia/Seoul')::date<>(session.created_at at time zone 'Asia/Seoul')::date then
  raise invalid_authorization_specification using message='analytics_session_expired';end if;
 -- Only a notice the public shell can show at this instant is countable; an
 -- arbitrary identifier, a disabled, scheduled, ended or other-kind row is not.
 select c.kind into notice_kind from public.home_curations c
  where c.id=p_curation_id and c.kind in ('notice_bar','notice_strip') and c.enabled and c.archived_at is null
   and c.active_from<=at_time and (c.active_to is null or c.active_to>at_time);
 if not found then raise no_data_found using message='analytics_notice_unavailable';end if;
 -- A click must follow an impression of the same notice in the same session.
 if p_interaction='click' and not exists(select 1 from private.store_analytics_notice_events e
  where e.session_id=session.id and e.curation_id=p_curation_id and e.interaction='impression') then
  raise invalid_parameter_value using message='analytics_notice_not_shown';end if;
 select count(*) into recorded from private.store_analytics_notice_events where session_id=session.id;
 if recorded>=500 then raise exception using errcode='P0429',message='analytics_rate_limited';end if;
 perform private.store_analytics_rate('notice-events',10000,at_time);
 -- Shares the session's page-view budget: one browsing session, one limit.
 perform private.store_analytics_rate('session:'||session.id::text,120,at_time);
 insert into private.store_analytics_notice_events(id,session_id,observed_at,curation_id,placement,interaction,payload_hash)
 values(p_event_id,session.id,at_time,p_curation_id,notice_kind,p_interaction,fingerprint);
 insert into private.store_analytics_health(minute,observed_at) values(date_trunc('minute',at_time),at_time) on conflict(minute) do nothing;
 return jsonb_build_object('recorded',true,'replayed',false);
end $$;
revoke all on function public.record_store_analytics_notice_event(text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.record_store_analytics_notice_event(text,uuid,uuid,text) to service_role;

-- Retention: unchanged except that each archived day first keeps its notice
-- totals (no session identifier) before the day's sessions — and with them the
-- raw notice rows — are deleted, and notice totals expire after 13 months.
create or replace function public.process_store_analytics_retention() returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); cutoff date; first_day date; day_value date; coverage jsonb; archived_count integer:=0; enabled_value boolean;
begin
 perform private.store_analytics_require_service();
 if not pg_try_advisory_xact_lock(hashtextextended('store-analytics:retention',0)) then return jsonb_build_object('busy',true);end if;
 select enabled,(activated_at at time zone 'Asia/Seoul')::date into enabled_value,first_day from private.store_analytics_settings where id for share;
 if enabled_value then
  insert into private.store_analytics_health(minute,observed_at) values(date_trunc('minute',at_time),at_time) on conflict(minute) do nothing;
 end if;
 -- Keep exactly the latest 90 Korean calendar dates, including today.
 cutoff:=(at_time at time zone 'Asia/Seoul')::date-89;
 if first_day is not null then
  for day_value in select day::date from generate_series(greatest(first_day,((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp,
   (cutoff-1)::timestamp,interval '1 day') days(day)
   where not exists(select 1 from private.store_analytics_daily_coverage where day=days.day::date) order by day limit 7 loop
   -- Revocation either completes before this snapshot or waits until all raw
   -- identifiers have been removed. Anonymous archived totals cannot be relinked.
   perform id from private.store_analytics_sessions where created_at>=day_value::timestamp at time zone 'Asia/Seoul'
    and created_at<(day_value+1)::timestamp at time zone 'Asia/Seoul' order by id for update;
   coverage:=private.store_analytics_day_coverage(day_value,at_time);
   insert into private.store_analytics_daily(day,dimension,key,page_views,product_views,sessions,link_landings,orders,converted_sessions,gross_amount,refund_amount,observed_until)
    select day_value,r.*,at_time from private.store_analytics_raw_rows(day_value) r;
   insert into private.store_analytics_notice_daily(day,curation_id,placement,impressions,clicks,impression_sessions,click_sessions,observed_until)
    select day_value,e.curation_id,e.placement,count(*) filter(where e.interaction='impression'),count(*) filter(where e.interaction='click'),
     count(distinct e.session_id) filter(where e.interaction='impression'),count(distinct e.session_id) filter(where e.interaction='click'),at_time
    from private.store_analytics_notice_events e join private.store_analytics_sessions s on s.id=e.session_id and s.revoked_at is null
    where e.observed_at>=day_value::timestamp at time zone 'Asia/Seoul' and e.observed_at<(day_value+1)::timestamp at time zone 'Asia/Seoul'
    group by e.curation_id,e.placement;
   insert into private.store_analytics_daily_coverage(day,state,expected_minutes,observed_minutes,observed_until)
    values(day_value,coverage->>'state',(coverage->>'expectedMinutes')::integer,(coverage->>'observedMinutes')::integer,at_time);
   delete from private.store_analytics_sessions where created_at>=day_value::timestamp at time zone 'Asia/Seoul' and created_at<(day_value+1)::timestamp at time zone 'Asia/Seoul';
   delete from private.store_analytics_health where minute>=day_value::timestamp at time zone 'Asia/Seoul' and minute<(day_value+1)::timestamp at time zone 'Asia/Seoul';
   archived_count:=archived_count+1;
  end loop;
 end if;
 delete from private.store_analytics_sessions where created_at<(((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp at time zone 'Asia/Seoul';
 delete from private.store_analytics_daily where day<((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date;
 delete from private.store_analytics_notice_daily where day<((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date;
 delete from private.store_analytics_daily_coverage where day<((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date;
 delete from private.store_analytics_health where minute<(((at_time at time zone 'Asia/Seoul')::date-interval '13 months')::date)::timestamp at time zone 'Asia/Seoul';
 delete from private.store_analytics_rate_buckets where bucket<date_trunc('minute',at_time)-interval '10 minutes';
 return jsonb_build_object('busy',false,'archivedDays',archived_count,'checkedAt',at_time);
end $$;
revoke all on function public.process_store_analytics_retention() from public,anon,authenticated,service_role;
grant execute on function public.process_store_analytics_retention() to service_role;

-- Per-notice totals for the operator traffic screen. Archived days come from
-- the identifier-free daily table, newer days from raw rows that are not yet
-- archived. Sessions never span a KST date, so summing daily distinct sessions
-- over the period counts each session once.
create function public.admin_store_analytics_notice_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare at_time timestamptz:=statement_timestamp(); today date:=(statement_timestamp() at time zone 'Asia/Seoul')::date; result jsonb;
begin
 if not public.has_operator_capability('stats.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_from is null or p_to is null or p_from>p_to or p_to-p_from>=60 or p_to>today then
  raise invalid_parameter_value using message='analytics_invalid_filter';end if;
 with archived as(
  select d.day,d.curation_id,d.placement,d.impressions,d.clicks,d.impression_sessions,d.click_sessions
  from private.store_analytics_notice_daily d
  where d.day between p_from and p_to and d.day>=(today-interval '13 months')::date
 ),raw as(
  select (e.observed_at at time zone 'Asia/Seoul')::date as day,e.curation_id,e.placement,
   count(*) filter(where e.interaction='impression')::bigint as impressions,
   count(*) filter(where e.interaction='click')::bigint as clicks,
   count(distinct e.session_id) filter(where e.interaction='impression')::bigint as impression_sessions,
   count(distinct e.session_id) filter(where e.interaction='click')::bigint as click_sessions
  from private.store_analytics_notice_events e
  join private.store_analytics_sessions s on s.id=e.session_id and s.revoked_at is null
  where e.observed_at>=p_from::timestamp at time zone 'Asia/Seoul' and e.observed_at<(p_to+1)::timestamp at time zone 'Asia/Seoul'
   and not exists(select 1 from private.store_analytics_daily_coverage c where c.day=(e.observed_at at time zone 'Asia/Seoul')::date)
  group by 1,2,3
 ),totals as(
  select f.curation_id,f.placement,sum(f.impressions)::bigint as impressions,sum(f.clicks)::bigint as clicks,
   sum(f.impression_sessions)::bigint as impression_sessions,sum(f.click_sessions)::bigint as click_sessions
  from (select * from archived union all select * from raw) f group by f.curation_id,f.placement
 )
 select jsonb_build_object('from',p_from,'to',p_to,'observedAt',at_time,
  'rows',coalesce((select jsonb_agg(jsonb_build_object('curationId',t.curation_id,'placement',t.placement,'title',c.title,
    'impressions',t.impressions,'clicks',t.clicks,'impressionSessions',t.impression_sessions,'clickSessions',t.click_sessions,
    'clickRate',case when t.impressions>0 then round(t.clicks::numeric*100/t.impressions,2) end)
   order by t.impressions desc,t.clicks desc,t.curation_id,t.placement)
   from totals t left join public.home_curations c on c.id=t.curation_id),'[]'::jsonb))
 into result;
 return result;
end $$;
revoke all on function public.admin_store_analytics_notice_report(date,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_store_analytics_notice_report(date,date) to authenticated;

select private.register_operator_rpc_contract('public.admin_store_analytics_notice_report(date,date)'::regprocedure,'stats.read','read',false);
select private.register_operator_internal_contract('public.record_store_analytics_notice_event(text,uuid,uuid,text)'::regprocedure);
select private.register_operator_internal_contract('public.process_store_analytics_retention()'::regprocedure);

notify pgrst,'reload schema';
